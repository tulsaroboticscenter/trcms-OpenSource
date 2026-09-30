<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\EmailTracking;
use App\Core\EnrollmentService;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/communications/router.py (prefix /api/v1/comms). */
final class CommunicationsController
{
    private const TEMPLATE_CATEGORIES = ['visitor', 'member', 'volunteer', 'sponsor', 'summer_camp', 'general'];

    // Program-wide links available in every template (resolved in baseContext()).
    private const PROGRAM_LINK_VARS = ['google_classroom_url', 'discord_invite_url'];

    private const VARIABLES_FOR_RECIPIENT = [
        'member'    => ['first_name', 'last_name', 'member_number', 'email', 'guardian1_name', 'guardian1_email', 'program', 'team', 'org_name', 'login_url', 'employer_form_url', 'google_classroom_url', 'discord_invite_url'],
        'visitor'   => ['first_name', 'last_name', 'email', 'guardian1_name', 'guardian1_email', 'program_interest', 'visitor_number', 'signup_url', 'org_name', 'login_url', 'google_classroom_url', 'discord_invite_url'],
        'volunteer' => ['first_name', 'last_name', 'email', 'org_name', 'google_classroom_url', 'discord_invite_url'],
        'sponsor'   => ['contact_name', 'org_name', 'email'],
        'general'   => ['org_name', 'login_url', 'google_classroom_url', 'discord_invite_url'],
    ];

    // ── helpers ──────────────────────────────────────────────────────────
    private static function orgName(): string { return Config::get('ORG_NAME', 'Tulsa Robotics Center'); }
    private static function appUrl(): string { return Config::get('APP_URL', 'http://localhost:5173'); }
    private static function emailEnabled(): bool { return Mailer::enabled(); }

    /**
     * Program-wide merge values available to EVERY template (like org_name / login_url):
     * the Google Classroom join link (set in the Certifications module) and the Discord
     * invite (whichever TRC resource an admin designated — see emailLinkSettings()).
     * Both render to '' when unset, so a template referencing them just shows nothing.
     */
    private static function baseContext(PDO $pdo): array
    {
        return [
            'org_name' => self::orgName(),
            'login_url' => self::appUrl(),
            'google_classroom_url' => self::googleClassroomUrl($pdo),
            'discord_invite_url' => self::discordInviteUrl($pdo),
        ];
    }

    /** A system_config category's decoded JSON value map (or []). */
    private static function configMap(PDO $pdo, string $category): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([$category]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode((string)$r['values'], true) : null;
        return is_array($v) ? $v : [];
    }

    /** The Google Classroom link set in the Certifications module (system_config). */
    private static function googleClassroomUrl(PDO $pdo): string
    {
        return trim((string)(self::configMap($pdo, 'certifications')['classroom_url'] ?? ''));
    }

    /** The id of the TRC resource an admin picked as the Discord invite (0 if none). */
    private static function discordResourceId(PDO $pdo): int
    {
        return (int)(self::configMap($pdo, 'communications')['discord_resource_id'] ?? 0);
    }

    /** The Discord invite link, resolved from the designated resource ('' if none). */
    private static function discordInviteUrl(PDO $pdo): string
    {
        $id = self::discordResourceId($pdo);
        return $id > 0 ? self::resolveResourceUrl($pdo, $id) : '';
    }

    /**
     * The URL held by a resource, whatever its type. Reads the resource_type's attribute
     * schema and returns the value of its first url/file attribute; falls back to common
     * url-ish keys, then to any value that looks like a link. '' if the resource is gone,
     * archived, or holds no URL.
     */
    private static function resolveResourceUrl(PDO $pdo, int $resourceId): string
    {
        $s = $pdo->prepare(
            "SELECT r.`values`, rt.attributes
               FROM resources r
               LEFT JOIN resource_types rt ON rt.id = r.resource_type_id
              WHERE r.id = ? AND (r.is_archived = 0 OR r.is_archived IS NULL)");
        $s->execute([$resourceId]);
        $row = $s->fetch();
        if (!$row) return '';
        $values = $row['values'] ? json_decode((string)$row['values'], true) : [];
        if (!is_array($values) || !$values) return '';

        // Prefer the key the type marks as a URL/file attribute.
        $attrs = $row['attributes'] ? json_decode((string)$row['attributes'], true) : [];
        if (is_array($attrs)) {
            foreach ($attrs as $a) {
                if (in_array($a['type'] ?? '', ['url', 'file'], true) && !empty($values[$a['key'] ?? ''])) {
                    return trim((string)$values[$a['key']]);
                }
            }
        }
        // Fall back to common url-ish keys.
        foreach (['url', 'link', 'resource_link', 'file_url', 'canva_url'] as $k) {
            if (!empty($values[$k])) return trim((string)$values[$k]);
        }
        // Last resort: the first value that looks like a link.
        foreach ($values as $v) {
            if (is_string($v) && preg_match('#^https?://#i', trim($v))) return trim($v);
        }
        return '';
    }

    /**
     * Substitute {{var}} tokens from $ctx. With $escapeHtml=true (HTML body
     * contexts) each value is HTML-escaped, so member-editable fields (first/last
     * name, guardian names) can't inject markup or script into the delivered email
     * or the stored Message History that staff later view (F7). Subjects and
     * plain-text render with $escapeHtml=false — escaping there would leak literal
     * "&amp;" into a subject line. Unknown tokens are left intact so a missing
     * variable is visible rather than silently blank.
     */
    private static function renderVariables(string $tpl, array $ctx, bool $escapeHtml = false): string
    {
        return preg_replace_callback('/\{\{(\w+)\}\}/', function ($m) use ($ctx, $escapeHtml) {
            $k = $m[1];
            if (!array_key_exists($k, $ctx)) return '{{' . $k . '}}';
            $v = (string)$ctx[$k];
            return $escapeHtml ? htmlspecialchars($v, ENT_QUOTES, 'UTF-8') : $v;
        }, $tpl);
    }

    private static function htmlToText(string $html): string
    {
        $text = html_entity_decode($html, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/<[^>]+>/', "\n", $text);
        return trim(preg_replace("/\n{2,}/", "\n", $text));
    }

    /**
     * Wrap a message body in the email shell. A custom header/footer layout (#101)
     * may be supplied; null parts fall back to the built-in TRCMS branding.
     */
    private static function wrapEmailHtml(string $bodyHtml, ?string $headerHtml = null, ?string $footerHtml = null, ?string $unsubUrl = null): string
    {
        $org = self::orgName(); $url = self::appUrl();
        $header = ($headerHtml !== null && trim($headerHtml) !== '')
            ? $headerHtml
            : '<div class="header"><h1>' . $org . '</h1><p>Program Management System</p></div>';
        $footer = ($footerHtml !== null && trim($footerHtml) !== '')
            ? $footerHtml
            : '<div class="footer">' . $org . ' · <a href="' . $url . '" style="color:#aaa">' . $url . '</a></div>';
        $unsub = $unsubUrl
            ? '<div class="footer" style="padding-top:0"><a href="' . $unsubUrl . '" style="color:#aaa">Unsubscribe</a> from these emails</div>'
            : '';
        return '<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto}
  .header{background:#1a3a5c;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0}
  .header h1{margin:0;font-size:22px}.header p{margin:4px 0 0;font-size:12px;opacity:.7}
  .body{background:#f8fafc;padding:28px;border:1px solid #e2e8f0}
  .footer{padding:14px 28px;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #e2e8f0}
</style></head>
<body>
  ' . $header . '
  <div class="body">' . $bodyHtml . '</div>
  ' . $footer . $unsub . '
</body></html>';
    }

    /** Get-or-create the stable unsubscribe token for an email address (#100). */
    private static function unsubTokenFor(PDO $pdo, string $email): string
    {
        $email = strtolower(trim($email));
        $s = $pdo->prepare("SELECT token FROM email_optouts WHERE email = ?");
        $s->execute([$email]);
        if ($row = $s->fetch()) return $row['token'];
        $token = bin2hex(random_bytes(16));
        $pdo->prepare("INSERT IGNORE INTO email_optouts (email, token) VALUES (?, ?)")->execute([$email, $token]);
        $s->execute([$email]); $row = $s->fetch();
        return $row ? $row['token'] : $token;
    }

    /** True if this email has unsubscribed from mass emails. */
    private static function isUnsubscribed(PDO $pdo, string $email): bool
    {
        $s = $pdo->prepare("SELECT unsubscribed_at FROM email_optouts WHERE email = ?");
        $s->execute([strtolower(trim($email))]);
        $r = $s->fetch();
        return $r && $r['unsubscribed_at'] !== null;
    }

    /**
     * The set of member ids that have explicitly OPTED OUT of a communication category
     * (member_comm_preferences.opted_in = 0), as a member_id => true lookup. Default is
     * opted-in (no row), so only explicit opt-outs are returned. Empty when no category
     * is chosen — a categoryless send targets everyone as before.
     */
    private static function optedOutMemberIds(PDO $pdo, string $category): array
    {
        $category = trim($category);
        if ($category === '') return [];
        $s = $pdo->prepare("SELECT member_id FROM member_comm_preferences WHERE preference_type = ? AND opted_in = 0");
        $s->execute([$category]);
        return array_fill_keys(array_map('intval', array_column($s->fetchAll(), 'member_id')), true);
    }

    private static function unsubUrlFor(PDO $pdo, string $email): string
    {
        return self::appUrl() . '/api/v1/comms/unsubscribe/' . self::unsubTokenFor($pdo, $email);
    }

    /**
     * PUBLIC (no login) — unsubscribe (or re-subscribe) from mass emails via the
     * tokenised link in an email footer. GET /comms/unsubscribe/{token}[?resubscribe=1]
     */
    public static function unsubscribe(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $token = trim((string)($route['token'] ?? ''));
        $resub = !empty($req->getQueryParams()['resubscribe']);
        $s = $pdo->prepare("SELECT id, email FROM email_optouts WHERE token = ?");
        $s->execute([$token]); $row = $s->fetch();
        $page = function (string $title, string $body, int $status = 200) use ($res) {
            $html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' . htmlspecialchars($title) . '</title></head>'
                . '<body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;padding:40px 16px;color:#1a3a5c">'
                . '<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;text-align:center">' . $body . '</div></body></html>';
            $res->getBody()->write($html);
            return $res->withHeader('Content-Type', 'text/html; charset=utf-8')->withStatus($status);
        };
        if (!$row) return $page('Unsubscribe', '<h2 style="margin:0 0 8px">Link not recognized</h2><p style="color:#667">This unsubscribe link is invalid or has expired.</p>', 404);
        $org = htmlspecialchars(self::orgName());
        $base = self::appUrl() . '/api/v1/comms/unsubscribe/' . rawurlencode($token);
        if ($resub) {
            $pdo->prepare("UPDATE email_optouts SET unsubscribed_at = NULL WHERE id = ?")->execute([(int)$row['id']]);
            return $page('Re-subscribed', '<h2 style="margin:0 0 8px">You\'re re-subscribed</h2><p style="color:#667">You\'ll receive ' . $org . ' emails again. You can unsubscribe any time.</p>');
        }
        $pdo->prepare("UPDATE email_optouts SET unsubscribed_at = NOW() WHERE id = ?")->execute([(int)$row['id']]);
        return $page('Unsubscribed', '<h2 style="margin:0 0 8px">You\'ve been unsubscribed</h2>'
            . '<p style="color:#667">' . htmlspecialchars((string)$row['email']) . ' will no longer receive mass emails from ' . $org . '. Important account messages may still be sent.</p>'
            . '<p style="margin-top:18px"><a href="' . $base . '?resubscribe=1" style="color:#1565c0">Changed your mind? Re-subscribe</a></p>');
    }

    /**
     * Resolve the header/footer for an email: the chosen layout, else the default
     * layout, else [null, null] (built-in branding). {{variables}} are rendered
     * with the recipient context so a layout can include e.g. {{org_name}}.
     */
    private static function layoutParts(PDO $pdo, ?int $layoutId, array $ctx): array
    {
        $row = null;
        if ($layoutId) {
            $s = $pdo->prepare("SELECT header_html, footer_html FROM email_layouts WHERE id = ?");
            $s->execute([$layoutId]); $row = $s->fetch() ?: null;
        }
        if (!$row) {
            $s = $pdo->query("SELECT header_html, footer_html FROM email_layouts WHERE is_default = 1 LIMIT 1");
            $row = $s->fetch() ?: null;
        }
        if (!$row) return [null, null];
        // Newlines the author typed should render as line breaks (HTML otherwise
        // collapses them), so the email matches what they entered in the editor.
        $render = fn($html) => $html !== null ? nl2br(self::renderVariables((string)$html, $ctx, true), false) : null;
        return [$render($row['header_html']), $render($row['footer_html'])];
    }

    private static function buildContext(PDO $pdo, string $type, int $id): array
    {
        $base = self::baseContext($pdo);
        if ($type === 'member') {
            $s = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $s->execute([$id]); $m = $s->fetch();
            if ($m) {
                $base = array_merge($base, [
                    'first_name' => $m['first_name'] ?? '', 'last_name' => $m['last_name'] ?? '',
                    'member_number' => $m['member_number'] ?? '', 'email' => $m['email'] ?? '',
                    'member_type' => $m['member_type'] ?? '',
                    'guardian1_name' => $m['guardian1_name'] ?? '', 'guardian1_email' => $m['guardian1_email'] ?? '',
                    'full_name' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')),
                    // Personalized no-login employer form link. Built for EVERY member so a
                    // recipient can never get an empty href ("<a href=''>" — a button that goes
                    // nowhere). The token is per-member and the form saves to whoever opens it;
                    // it's aimed at working adults, youth simply have no employer info to add.
                    'employer_form_url' => (($__eft = \App\Controllers\EmployerFormController::tokenFor((int)$id)) !== null)
                        ? self::appUrl() . '/employer/' . rawurlencode($__eft) : '',
                ]);
            }
        } elseif ($type === 'visitor') {
            $s = $pdo->prepare("SELECT v.*, p.name AS program_name FROM visitors v LEFT JOIN programs p ON p.id = v.program_interest_id WHERE v.id = ?");
            $s->execute([$id]); $v = $s->fetch();
            if ($v) {
                $base = array_merge($base, [
                    'first_name' => $v['first_name'] ?? '', 'last_name' => $v['last_name'] ?? '',
                    'full_name' => trim(($v['first_name'] ?? '') . ' ' . ($v['last_name'] ?? '')),
                    'email' => $v['email'] ?? '', 'visitor_number' => $v['visitor_number'] ?? '',
                    'guardian1_name' => $v['guardian1_name'] ?? '', 'guardian1_email' => $v['guardian1_email'] ?? '',
                    'program_interest' => $v['program_name'] ?? '',
                    // Per-visitor join link. Minted on first use and reused while it is
                    // live, so re-sending a follow-up doesn't invalidate the earlier one.
                    // Empty for anyone who is already a member — the template just renders
                    // nothing rather than offering them a signup.
                    'signup_url' => VisitorSignupController::signupUrlFor($pdo, (int)$id) ?? '',
                ]);
            }
        }
        return $base;
    }

    /**
     * Per-recipient RSVP button links for an embedded event (#96). For a member
     * recipient these are tokenised no-login links; for a non-member they fall
     * back to the event page (RSVP after login).
     */
    /** Event ids to embed, from event_ids[] (multi, #96) or a single event_id. */
    private static function embeddedEventIds(array $d): array
    {
        $ids = is_array($d['event_ids'] ?? null) ? $d['event_ids'] : [];
        if (!$ids && !empty($d['event_id'])) $ids = [$d['event_id']];
        return array_values(array_unique(array_filter(array_map('intval', $ids), fn($v) => $v > 0)));
    }

    /**
     * Per-recipient RSVP button links for one or more embedded events (#96). Keys
     * are suffixed with the event id ({{rsvp_attending_<id>}}) so multiple event
     * cards in one email each get their own buttons. Member recipients get
     * tokenised no-login links; non-members fall back to the event page.
     */
    private static function rsvpContextFor(PDO $pdo, array $eventIds, int $memberId): array
    {
        $base = self::appUrl();
        $out = [];
        foreach ($eventIds as $eid) {
            $eid = (int)$eid;
            if ($eid <= 0) continue;
            if ($memberId > 0) {
                $token = ParticipantsController::tokenFor($pdo, $eid, $memberId);
                $link = fn(string $r) => $base . "/api/v1/events/$eid/rsvp-link/" . rawurlencode($token) . '?r=' . rawurlencode($r);
                $out["rsvp_attending_$eid"] = $link('Attending');
                $out["rsvp_not_attending_$eid"] = $link('Not Attending');
                $out["rsvp_maybe_$eid"] = $link('Maybe');
            } else {
                $ev = $base . "/events/$eid";
                $out["rsvp_attending_$eid"] = $ev;
                $out["rsvp_not_attending_$eid"] = $ev;
                $out["rsvp_maybe_$eid"] = $ev;
            }
        }
        return $out;
    }

    private static function serializeTemplate(array $t): array
    {
        return [
            'id' => (int)$t['id'], 'name' => $t['name'], 'category' => $t['category'],
            'description' => $t['description'], 'subject_template' => $t['subject_template'],
            'body_html_template' => $t['body_html_template'],
            'available_variables' => $t['available_variables'] ? json_decode($t['available_variables'], true) : [],
            'reply_enabled' => (bool)$t['reply_enabled'], 'is_active' => (bool)$t['is_active'],
            'created_by_id' => $t['created_by_id'] !== null ? (int)$t['created_by_id'] : null,
            'created_at' => Time::naiveIso($t['created_at']), 'updated_at' => Time::naiveIso($t['updated_at']),
        ];
    }

    // ── Template endpoints ───────────────────────────────────────────────
    public static function listTemplates(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $activeOnly = !isset($q['active_only']) || filter_var($q['active_only'], FILTER_VALIDATE_BOOLEAN);
        $sql = "SELECT * FROM email_templates WHERE 1=1"; $args = [];
        if ($activeOnly) $sql .= " AND is_active = true";
        if (!empty($q['category'])) { $sql .= " AND category = ?"; $args[] = $q['category']; }
        $sql .= " ORDER BY category, name";
        $stmt = $pdo->prepare($sql); $stmt->execute($args);
        return Http::json($res, array_map([self::class, 'serializeTemplate'], $stmt->fetchAll()));
    }

    // ── Email header/footer layouts (#101) ──────────────────────────────
    private static function serializeLayout(array $l): array
    {
        return [
            'id' => (int)$l['id'], 'name' => $l['name'],
            'header_html' => $l['header_html'], 'footer_html' => $l['footer_html'],
            'is_default' => (bool)$l['is_default'],
            'created_at' => Time::naiveIso($l['created_at']), 'updated_at' => Time::naiveIso($l['updated_at']),
        ];
    }

    public static function listLayouts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT * FROM email_layouts ORDER BY is_default DESC, name")->fetchAll();
        return Http::json($res, array_map([self::class, 'serializeLayout'], $rows));
    }

    public static function getLayout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $s = $pdo->prepare("SELECT * FROM email_layouts WHERE id = ?"); $s->execute([(int)$route['layout_id']]);
        $l = $s->fetch();
        return $l ? Http::json($res, self::serializeLayout($l)) : Http::error($res, 'Layout not found', 404);
    }

    public static function createLayout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') return Http::error($res, 'A layout name is required.', 422);
        $isDefault = !empty($d['is_default']);
        if ($isDefault) $pdo->exec("UPDATE email_layouts SET is_default = 0");
        $ins = $pdo->prepare("INSERT INTO email_layouts (name, header_html, footer_html, is_default, created_by_id) VALUES (?, ?, ?, ?, ?)");
        $ins->execute([$name, ($d['header_html'] ?? '') ?: null, ($d['footer_html'] ?? '') ?: null, (int)$isDefault, (int)$m['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'email_layouts', $id, 'create');
        $s = $pdo->prepare("SELECT * FROM email_layouts WHERE id = ?"); $s->execute([$id]);
        return Http::json($res, self::serializeLayout($s->fetch()), 201);
    }

    public static function updateLayout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['layout_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('name', $d)) { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('header_html', $d)) { $set[] = 'header_html = ?'; $args[] = ($d['header_html'] ?? '') ?: null; }
        if (array_key_exists('footer_html', $d)) { $set[] = 'footer_html = ?'; $args[] = ($d['footer_html'] ?? '') ?: null; }
        if (array_key_exists('is_default', $d)) {
            if (!empty($d['is_default'])) $pdo->exec("UPDATE email_layouts SET is_default = 0");
            $set[] = 'is_default = ?'; $args[] = (int)!empty($d['is_default']);
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE email_layouts SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'email_layouts', $id, 'update');
        $s = $pdo->prepare("SELECT * FROM email_layouts WHERE id = ?"); $s->execute([$id]);
        $l = $s->fetch();
        return $l ? Http::json($res, self::serializeLayout($l)) : Http::error($res, 'Layout not found', 404);
    }

    public static function deleteLayout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM email_layouts WHERE id = ?")->execute([(int)$route['layout_id']]);
        Audit::write($pdo, (int)$m['id'], 'email_layouts', (int)$route['layout_id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Email attachments + inline images (#102) ────────────────────────
    private static function uploadDir(): string
    {
        $dir = dirname(__DIR__, 2) . '/public/uploads/email';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        return $dir;
    }

    public static function uploadAttachment(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $file = ($req->getUploadedFiles()['file'] ?? null);
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded.', 400);
        $size = (int)$file->getSize();
        if ($size > 10 * 1024 * 1024) return Http::error($res, 'File too large (max 10 MB).', 422);
        $orig = preg_replace('#[\r\n"\\\\/]#', '', (string)($file->getClientFilename() ?: 'attachment'));
        $mime = (string)($file->getClientMediaType() ?: 'application/octet-stream');
        $inline = !empty(((array)$req->getParsedBody())['inline'] ?? null) || !empty($req->getQueryParams()['inline']);
        $ext = preg_replace('/[^a-zA-Z0-9]/', '', (string)pathinfo($orig, PATHINFO_EXTENSION));
        $token = bin2hex(random_bytes(16));
        $stored = $token . ($ext !== '' ? '.' . $ext : '');
        try { $file->moveTo(self::uploadDir() . '/' . $stored); }
        catch (\Throwable $e) { return Http::error($res, 'Could not store the file.', 500); }
        $pdo->prepare("INSERT INTO email_attachments (token, filename, stored_name, mime_type, size_bytes, is_inline, uploaded_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
            ->execute([$token, $orig, $stored, $mime, $size, $inline ? 1 : 0, (int)$cur['id']]);
        return Http::json($res, [
            'id' => (int)$pdo->lastInsertId(), 'filename' => $orig, 'mime_type' => $mime, 'size' => $size,
            'is_inline' => (bool)$inline, 'url' => self::appUrl() . '/uploads/email/' . $stored,
        ], 201);
    }

    public static function deleteAttachment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['attachment_id'];
        $s = $pdo->prepare("SELECT stored_name FROM email_attachments WHERE id = ?"); $s->execute([$id]);
        if ($row = $s->fetch()) @unlink(self::uploadDir() . '/' . $row['stored_name']);
        $pdo->prepare("DELETE FROM email_attachments WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'email_attachments', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /** Resolve attachment ids → Mailer attachment specs (non-inline only). */
    private static function attachmentsForIds(PDO $pdo, array $ids): array
    {
        $ids = array_values(array_filter(array_map('intval', $ids)));
        if (!$ids) return [];
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $s = $pdo->prepare("SELECT filename, stored_name, mime_type FROM email_attachments WHERE id IN ($ph) AND is_inline = 0");
        $s->execute($ids);
        $dir = self::uploadDir();
        return array_map(fn($r) => ['path' => $dir . '/' . $r['stored_name'], 'name' => $r['filename'], 'mime' => $r['mime_type'] ?: 'application/octet-stream'], $s->fetchAll());
    }

    public static function templateCategories(Request $req, Response $res): Response
    {
        return Http::json($res, self::TEMPLATE_CATEGORIES);
    }

    public static function templateVariables(Request $req, Response $res): Response
    {
        $type = $req->getQueryParams()['recipient_type'] ?? 'general';
        return Http::json($res, self::VARIABLES_FOR_RECIPIENT[$type] ?? self::VARIABLES_FOR_RECIPIENT['general']);
    }

    /** TRC-scoped resources that carry a URL — the picker for the Discord invite. */
    private static function urlResourceOptions(PDO $pdo): array
    {
        $rows = $pdo->query(
            "SELECT r.id, r.name, rt.name AS type
               FROM resources r
               LEFT JOIN resource_types rt ON rt.id = r.resource_type_id
              WHERE r.scope = 'trc' AND (r.is_archived = 0 OR r.is_archived IS NULL)
              ORDER BY r.name")->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $url = self::resolveResourceUrl($pdo, (int)$r['id']);
            if ($url === '') continue;   // only resources we can actually link to
            $out[] = ['id' => (int)$r['id'], 'name' => $r['name'], 'type' => $r['type'], 'url' => $url];
        }
        return $out;
    }

    /**
     * GET /comms/email-links — the program-wide links usable in templates, plus the
     * picker for the Discord invite (which TRC resource backs {{discord_invite_url}}).
     */
    public static function getEmailLinks(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, [
            // Google Classroom is set in the Certifications module — read-only here.
            'google_classroom_url' => self::googleClassroomUrl($pdo),
            'discord_resource_id' => self::discordResourceId($pdo) ?: null,
            'discord_invite_url' => self::discordInviteUrl($pdo),
            'resource_options' => self::urlResourceOptions($pdo),
            'can_manage' => Permissions::hasAnyRole($pdo, $m, ['Mentor']),
        ]);
    }

    /**
     * PUT /comms/email-links — designate which TRC resource is the Discord invite.
     * Body: { discord_resource_id: int|null }. null/0 clears it.
     */
    public static function setEmailLinks(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();

        $id = (int)($d['discord_resource_id'] ?? 0);
        if ($id > 0) {
            // Must be a live TRC-scoped resource that actually resolves to a URL.
            $chk = $pdo->prepare("SELECT scope, is_archived FROM resources WHERE id = ?");
            $chk->execute([$id]);
            $r = $chk->fetch();
            if (!$r || $r['scope'] !== 'trc' || !empty($r['is_archived'])) {
                return Http::error($res, 'Pick a current program (TRC) resource.', 422);
            }
            if (self::resolveResourceUrl($pdo, $id) === '') {
                return Http::error($res, "That resource has no link to use — pick one with a URL.", 422);
            }
        }

        $cfg = self::configMap($pdo, 'communications');
        $cfg['discord_resource_id'] = $id > 0 ? $id : null;
        $json = json_encode($cfg);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'communications'"); $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('communications', 'Communications', ?)")->execute([$json]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'update', null, ['category' => 'communications', 'discord_resource_id' => $id ?: null]);

        return self::getEmailLinks($req, $res);
    }

    public static function getTemplate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $s = $pdo->prepare("SELECT * FROM email_templates WHERE id = ?"); $s->execute([(int)$route['template_id']]);
        $t = $s->fetch();
        if (!$t) return Http::error($res, 'Template not found', 404);
        return Http::json($res, self::serializeTemplate($t));
    }

    public static function createTemplate(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO email_templates (name, category, description, subject_template, body_html_template, available_variables, reply_enabled, is_active, created_by_id, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, true, ?, NOW(), NOW())");
        $ins->execute([
            $d['name'] ?? '', $d['category'] ?? 'general', $d['description'] ?? null,
            $d['subject_template'] ?? '', $d['body_html_template'] ?? '',
            isset($d['available_variables']) ? json_encode($d['available_variables']) : json_encode([]),
            (int)(bool)($d['reply_enabled'] ?? false), (int)$m['id'],
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'email_templates', $id, 'create', null, $d);
        $s = $pdo->prepare("SELECT * FROM email_templates WHERE id = ?"); $s->execute([$id]);
        return Http::json($res, self::serializeTemplate($s->fetch()), 201);
    }

    public static function updateTemplate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['template_id'];
        $s = $pdo->prepare("SELECT * FROM email_templates WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Template not found', 404);
        $d = (array)$req->getParsedBody();
        $bools = ['reply_enabled', 'is_active'];
        $jsonF = ['available_variables'];
        $set = []; $args = [];
        foreach (['name', 'category', 'description', 'subject_template', 'body_html_template', 'available_variables', 'reply_enabled', 'is_active'] as $f) {
            if (array_key_exists($f, $d) && $d[$f] !== null) {
                $set[] = "$f = ?";
                $args[] = in_array($f, $bools, true) ? (int)(bool)$d[$f] : (in_array($f, $jsonF, true) ? json_encode($d[$f]) : $d[$f]);
            }
        }
        $set[] = "updated_at = NOW()";
        array_push($args, $id);
        $pdo->prepare("UPDATE email_templates SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'email_templates', $id, 'update', null, $d);
        $s2 = $pdo->prepare("SELECT * FROM email_templates WHERE id = ?"); $s2->execute([$id]);
        return Http::json($res, self::serializeTemplate($s2->fetch()));
    }

    public static function deleteTemplate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['template_id'];
        $s = $pdo->prepare("SELECT 1 FROM email_templates WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Template not found', 404);
        // Hard delete. Detach it from any logged messages first so the FK is safe;
        // those messages keep their stored subject/body, they just lose the link.
        $pdo->prepare("UPDATE communication_messages SET template_id = NULL WHERE template_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM email_templates WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'email_templates', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Preview ──────────────────────────────────────────────────────────
    public static function preview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        // Staff-only, same as send(): the preview echoes recipient context (member/guardian
        // email + names) for an arbitrary recipient_id, so it must not be reachable by an
        // ordinary member enumerating others' contacts.
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $rtype = $d['recipient_type'] ?? 'general'; $rid = (int)($d['recipient_id'] ?? 0);
        $ctx = self::buildContext($pdo, $rtype, $rid);
        $eventIds = self::embeddedEventIds($d);
        if ($eventIds) $ctx = array_merge($ctx, self::rsvpContextFor($pdo, $eventIds, $rtype === 'member' ? $rid : 0));
        $subject = self::renderVariables($d['subject_template'] ?? '', $ctx);
        $bodyHtml = self::renderVariables($d['body_html_template'] ?? '', $ctx, true);
        [$hdr, $ftr] = self::layoutParts($pdo, isset($d['layout_id']) ? (int)$d['layout_id'] : null, $ctx);
        return Http::json($res, [
            'subject' => $subject,
            'body_html' => self::wrapEmailHtml($bodyHtml, $hdr, $ftr),
            'body_text' => self::htmlToText($bodyHtml),
            'context_used' => (object)$ctx,
        ]);
    }

    /** Youth-safety oversight notice — shared with every other send flow. */
    private static function notifyYouthContact(string $senderName, string $subject, array $youths): void
    {
        \App\Core\YouthContact::notify($senderName, $subject, $youths);
    }

    /**
     * Render an ACTIVE template (looked up by exact name) for one recipient and send it
     * as a system email — for automated flows like self-signup onboarding, where there's
     * no interactive sender, thread or tracking. Reuses the same variable rendering and
     * branding as the composer so a template behaves identically here.
     *
     * Returns a record the caller can log/report:
     *   ['template'=>name, 'template_found'=>bool, 'sent'=>bool, 'to'=>?, 'cc'=>?,
     *    'subject'=>?, 'error'=>?].
     * `template_found=false` (nothing sent) when no active template has that name, so the
     * caller can flag a misnamed template rather than silently dropping the email.
     */
    public static function sendNamedTemplate(
        PDO $pdo,
        string $templateName,
        string $recipientType,
        int $recipientId,
        string $toEmail,
        ?string $toName = null,
        ?string $ccEmail = null,
        array $extraCtx = []
    ): array {
        $out = ['template' => $templateName, 'template_found' => false, 'sent' => false,
                'to' => trim($toEmail) ?: null, 'cc' => $ccEmail ?: null, 'subject' => null, 'error' => null];

        $t = $pdo->prepare("SELECT * FROM email_templates WHERE name = ? AND is_active = 1 LIMIT 1");
        $t->execute([$templateName]);
        $tpl = $t->fetch();
        if (!$tpl) { $out['error'] = 'no active template with that name'; return $out; }
        $out['template_found'] = true;

        $toEmail = trim($toEmail);
        if ($toEmail === '' || !filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
            $out['error'] = 'no valid recipient email';
            return $out;
        }

        $ctx = self::buildContext($pdo, $recipientType, $recipientId);
        foreach ($extraCtx as $k => $v) { if (is_scalar($v)) $ctx[(string)$k] = (string)$v; }

        $subject = self::renderVariables((string)$tpl['subject_template'], $ctx);
        $bodyHtml = self::renderVariables((string)$tpl['body_html_template'], $ctx, true);
        $wrapped = self::wrapEmailHtml($bodyHtml);
        $plain = self::htmlToText($bodyHtml);
        $out['subject'] = $subject;

        if (self::emailEnabled()) {
            try { $out['sent'] = Mailer::send($toEmail, $subject, $wrapped, $plain, $ccEmail ?: null); }
            catch (\Throwable $e) { $out['sent'] = false; $out['error'] = 'mail server error'; }
        } else {
            $out['error'] = 'email disabled';
        }
        return $out;
    }

    // ── Send ─────────────────────────────────────────────────────────────
    /** Combine a manual CC (string or list) with the always-CC address into a deduped
     *  comma-separated string for Mailer, or null when there's nothing to CC. */
    private static function buildCc($manual, ?string $always): ?string
    {
        $parts = is_array($manual) ? $manual : preg_split('/[,;\s]+/', (string)$manual, -1, PREG_SPLIT_NO_EMPTY);
        $parts[] = (string)$always;
        $set = [];
        foreach ($parts as $e) { $e = trim((string)$e); if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) $set[strtolower($e)] = $e; }
        return $set ? implode(', ', array_values($set)) : null;
    }

    public static function send(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $type = $d['recipient_type'] ?? ''; $rid = (int)($d['recipient_id'] ?? 0);
        $ctx = self::buildContext($pdo, $type, $rid);
        $eventIds = self::embeddedEventIds($d);
        if ($eventIds) $ctx = array_merge($ctx, self::rsvpContextFor($pdo, $eventIds, $type === 'member' ? $rid : 0));
        // Prefer the recipient's own email; otherwise the message goes to their guardian.
        // Address it to whoever actually receives it — a youth with no email of their own
        // should show the PARENT's name in the To, not the youth's.
        $ownEmail = trim((string)($ctx['email'] ?? ''));
        if ($ownEmail !== '') {
            $toEmail = $ownEmail;
            $toName = ($ctx['full_name'] ?? '') ?: (($ctx['contact_name'] ?? '') ?: $toEmail);
        } else {
            $toEmail = trim((string)($ctx['guardian1_email'] ?? ''));
            $gname = trim((string)($ctx['guardian1_name'] ?? ''));
            $toName = $gname !== '' ? $gname
                : (trim((string)($ctx['full_name'] ?? '')) !== '' ? 'Parent of ' . $ctx['full_name'] : $toEmail);
        }
        if (!$toEmail) return Http::error($res, 'Recipient has no email address on file.', 400);

        $finalSubject = self::renderVariables($d['subject'] ?? '', $ctx);
        $finalBodyHtml = self::renderVariables($d['body_html'] ?? '', $ctx, true);
        [$hdr, $ftr] = self::layoutParts($pdo, isset($d['layout_id']) ? (int)$d['layout_id'] : null, $ctx);
        $wrapped = self::wrapEmailHtml($finalBodyHtml, $hdr, $ftr);
        $plain = self::htmlToText($finalBodyHtml);
        $replyEnabled = (bool)($d['reply_enabled'] ?? false);

        $token = self::uuid4();
        $ins = $pdo->prepare("INSERT INTO communication_threads (subject, recipient_type, recipient_id, recipient_email, recipient_name, reply_enabled, reply_token, status, created_by_id, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NOW(), NOW())");
        $ins->execute([$finalSubject, $type, $rid, $toEmail, $toName, (int)$replyEnabled, $token, (int)$cur['id']]);
        $threadId = (int)$pdo->lastInsertId();

        // Open/click tracking: send a tracked copy of the HTML; store the clean one.
        $trackToken = EmailTracking::token();
        $trackBase = EmailTracking::base();
        $sendHtml = $wrapped; $trackLinks = [];
        if ($trackBase !== '') { [$sendHtml, $trackLinks] = EmailTracking::apply($wrapped, $trackToken, $trackBase); }

        $emailEnabled = self::emailEnabled();
        $emailSent = false; $error = null;
        if ($emailEnabled) {
            try {
                // Replies go to the configured From address (Admin → Email Settings).
                // The per-thread reply+<token> address isn't used yet — there's no inbound
                // mailbox/ingestion for it, so routing there would bounce.
                $replyTo = $replyEnabled ? Mailer::fromAddress() : null;
                // Route through Mailer so the configured SMTP relay (and DB-stored
                // settings) are used — not raw mail(), which bypasses the relay.
                $cc = self::buildCc($d['cc'] ?? null, EmailSettingsController::alwaysCc($pdo));
                $emailSent = Mailer::send($toEmail, $finalSubject, $sendHtml, $plain, $cc, $replyTo, self::attachmentsForIds($pdo, (array)($d['attachment_ids'] ?? [])) ?: null);
                if (!$emailSent) $error = Mailer::lastError() ?? 'Send failed.';
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }

        $delivered = $emailSent || !$emailEnabled;
        $status = $delivered ? 'sent' : 'failed';
        $msg = $pdo->prepare("INSERT INTO communication_messages (thread_id, sender_id, sender_name, direction, subject, body_html, body_text, status, sent_at, error_message, template_id, track_token, created_at)
                              VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, " . ($delivered ? 'NOW()' : 'NULL') . ", ?, ?, ?, NOW())");
        $msg->execute([
            $threadId, (int)$cur['id'], trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? '')),
            $finalSubject, $wrapped, $plain, $status, $error,
            isset($d['template_id']) ? (int)$d['template_id'] : null,
            ($trackBase !== '' && $delivered) ? $trackToken : null,
        ]);
        $messageId = (int)$pdo->lastInsertId();
        if ($trackBase !== '' && $delivered) self::persistTrackedLinks($pdo, $messageId, $trackLinks);

        // Youth-safety oversight: emailed a youth at their OWN address (no adult on it).
        if ($delivered && $type === 'member' && ($ctx['member_type'] ?? '') === 'youth' && $ownEmail !== '') {
            self::notifyYouthContact(trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? '')),
                $finalSubject, [['name' => $toName, 'email' => $toEmail]]);
        }

        return Http::json($res, [
            'ok' => true, 'thread_id' => $threadId, 'message_id' => $messageId,
            'email_sent' => $emailSent, 'email_enabled' => $emailEnabled,
            'recipient_email' => $toEmail, 'subject' => $finalSubject, 'error' => $error,
            'body_html' => $wrapped, 'body_text' => $plain,
        ], 201);
    }

    // ── Bulk / group recipients ──────────────────────────────────────────

    /** GET /comms/team-seasons — one row per team (its latest season) for the group picker. */
    public static function teamSeasonsForPicker(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query(
            "SELECT ts.id, t.team_number, ts.season, ts.team_name
             FROM team_seasons ts
             JOIN teams t ON t.id = ts.team_id
             JOIN (SELECT team_id, MAX(season) AS ms FROM team_seasons GROUP BY team_id) latest
               ON latest.team_id = ts.team_id AND latest.ms = ts.season
             ORDER BY t.team_number"
        )->fetchAll();
        return Http::json($res, array_map(fn($r) => [
            'team_season_id' => (int)$r['id'], 'team_number' => $r['team_number'],
            'season' => $r['season'], 'team_name' => $r['team_name'],
        ], $rows));
    }

    /**
     * POST /comms/resolve-recipients — expand group selectors + individuals into a
     * de-duplicated (by email) recipient list, each with a context member for variables.
     * Body: { teams:[{team_season_id,members,parents,mentors}], programs:[{program_id,...}],
     *         org:["mentors","youth","parents","volunteers"], individuals:[member_id,...] }
     */
    public static function resolveRecipients(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();

        // Inactive member accounts (is_active = 0) are dropped from EVERY audience by default,
        // so no blast reaches someone who has left the program. "Include Inactive Accounts" in
        // the composer flips this on for a deliberate all-hands send. $activeAnd is spliced into
        // queries selecting straight from `members` (no alias); aliased queries inline the check.
        $includeInactive = filter_var($d['include_inactive'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $activeAnd = $includeInactive ? '' : ' AND COALESCE(is_active, 1) = 1';

        // Optional communication category (e.g. "Weekly Newsletter"): members who opted out of it
        // are dropped, so an "Open House" blast can skip newsletter opt-outs. Categoryless = everyone.
        $category = trim((string)($d['category'] ?? ''));
        $optedOut = self::optedOutMemberIds($pdo, $category);

        $list = []; $seen = []; $noEmail = 0; $skippedOptout = 0;
        $add = function (?int $memberId, ?string $email, ?string $name, string $kind) use (&$list, &$seen, &$noEmail, &$skippedOptout, $optedOut): void {
            $email = trim((string)$email);
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $noEmail++; return; }
            if ($memberId !== null && isset($optedOut[$memberId])) { $skippedOptout++; return; }
            $key = strtolower($email);
            if (isset($seen[$key])) return;
            $seen[$key] = true;
            $list[] = ['member_id' => $memberId, 'email' => $email, 'name' => trim((string)$name) ?: $email, 'kind' => $kind];
        };
        // Visitors are prospective (no member row yet); they carry a visitor_id so the send
        // resolves their context and stores the thread as recipient_type='visitor'.
        $addVisitor = function (int $visitorId, ?string $email, ?string $name) use (&$list, &$seen, &$noEmail): void {
            $email = trim((string)$email);
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $noEmail++; return; }
            $key = strtolower($email);
            if (isset($seen[$key])) return;
            $seen[$key] = true;
            $list[] = ['member_id' => null, 'visitor_id' => $visitorId, 'email' => $email, 'name' => trim((string)$name) ?: $email, 'kind' => 'visitor'];
        };
        // Mailing-list subscribers have no member/visitor row; they carry a subscriber_id so
        // the send stores the thread as recipient_type='subscriber'.
        $addSubscriber = function (int $subscriberId, ?string $email, ?string $name) use (&$list, &$seen, &$noEmail): void {
            $email = trim((string)$email);
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $noEmail++; return; }
            $key = strtolower($email);
            if (isset($seen[$key])) return;
            $seen[$key] = true;
            $list[] = ['member_id' => null, 'subscriber_id' => $subscriberId, 'email' => $email, 'name' => trim((string)$name) ?: $email, 'kind' => 'subscriber'];
        };
        // Pull members of given member_types from a set of member ids (or all), and their parents.
        // Inactive accounts are excluded unless the sender opted to include them (see $activeAnd).
        $addMembersByIds = function (array $ids, string $kind) use ($pdo, $add, $activeAnd): void {
            if (!$ids) return;
            $in = implode(',', array_fill(0, count($ids), '?'));
            $st = $pdo->prepare("SELECT id, first_name, last_name, email FROM members WHERE id IN ($in)$activeAnd");
            $st->execute($ids);
            foreach ($st->fetchAll() as $m) $add((int)$m['id'], $m['email'], trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')), $kind);
        };
        $addParentsOfYouth = function (array $youthIds) use ($pdo, $add, $activeAnd, $includeInactive): void {
            if (!$youthIds) return;
            $in = implode(',', array_fill(0, count($youthIds), '?'));
            // Guardian emails stored on the youth record (context = the youth). Skip guardians of
            // inactive youth unless including inactive — an inactive family isn't blasted.
            $g = $pdo->prepare("SELECT id, first_name, last_name, guardian1_name, guardian1_email, guardian2_name, guardian2_email FROM members WHERE id IN ($in)$activeAnd");
            $g->execute($youthIds);
            foreach ($g->fetchAll() as $m) {
                if (!empty($m['guardian1_email'])) $add((int)$m['id'], $m['guardian1_email'], $m['guardian1_name'] ?: ('Parent of ' . $m['first_name']), 'parent');
                if (!empty($m['guardian2_email'])) $add((int)$m['id'], $m['guardian2_email'], $m['guardian2_name'] ?: ('Parent of ' . $m['first_name']), 'parent');
            }
            // Parent-type member accounts in the same family (context = the parent account).
            // Exclude inactive parent accounts unless including inactive.
            $pActive = $includeInactive ? '' : ' AND COALESCE(pm.is_active, 1) = 1';
            $p = $pdo->prepare("SELECT DISTINCT pm.id, pm.first_name, pm.last_name, pm.email
                FROM family_members fmy
                JOIN family_members fmp ON fmp.family_id = fmy.family_id
                JOIN members pm ON pm.id = fmp.member_id
                WHERE fmy.member_id IN ($in) AND pm.member_type = 'parent' AND (pm.is_archived = 0 OR pm.is_archived IS NULL)$pActive");
            $p->execute($youthIds);
            foreach ($p->fetchAll() as $m) $add((int)$m['id'], $m['email'], trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')), 'parent');
        };
        $rosterIds = function (int $tsid, string $type) use ($pdo): array {
            $st = $pdo->prepare("SELECT m.id FROM team_member_assignments tma JOIN members m ON m.id = tma.member_id
                WHERE tma.team_season_id = ? AND tma.date_left IS NULL AND m.member_type = ? AND (m.is_archived = 0 OR m.is_archived IS NULL)");
            $st->execute([$tsid, $type]);
            return array_map('intval', array_column($st->fetchAll(), 'id'));
        };

        // Teams
        foreach (($d['teams'] ?? []) as $t) {
            $tsid = (int)($t['team_season_id'] ?? 0); if (!$tsid) continue;
            $youth = $rosterIds($tsid, 'youth');
            if (!empty($t['members'])) $addMembersByIds($youth, 'youth');
            if (!empty($t['mentors'])) $addMembersByIds($rosterIds($tsid, 'mentor'), 'mentor');
            if (!empty($t['parents'])) $addParentsOfYouth($youth);
        }
        // Programs (current enrollment year)
        $year = EnrollmentService::currentEnrollmentYear();
        foreach (($d['programs'] ?? []) as $p) {
            $pid = (int)($p['program_id'] ?? 0); if (!$pid) continue;
            $idsByType = function (string $type) use ($pdo, $pid, $year): array {
                $st = $pdo->prepare("SELECT DISTINCT m.id FROM enrollments e JOIN members m ON m.id = e.member_id
                    WHERE e.program_id = ? AND e.enrollment_year = ? AND e.status <> 'cancelled' AND m.member_type = ? AND (m.is_archived = 0 OR m.is_archived IS NULL)");
                $st->execute([$pid, $year, $type]);
                return array_map('intval', array_column($st->fetchAll(), 'id'));
            };
            $youth = $idsByType('youth');
            if (!empty($p['members'])) $addMembersByIds($youth, 'youth');
            if (!empty($p['parents'])) $addParentsOfYouth($youth);
            if (!empty($p['mentors'])) {
                // Mentors aren't enrolled — they support a program either by being tagged
                // on their profile (member_program_support) or by being on one of that
                // program's team rosters. Union both.
                $mx = $pdo->prepare("SELECT DISTINCT m.id FROM members m
                    LEFT JOIN member_program_support mps ON mps.member_id = m.id AND mps.program_id = ?
                    LEFT JOIN team_member_assignments tma ON tma.member_id = m.id AND tma.date_left IS NULL
                    LEFT JOIN team_seasons ts ON ts.id = tma.team_season_id
                    LEFT JOIN teams t ON t.id = ts.team_id AND t.program_id = ?
                    WHERE m.member_type = 'mentor' AND (m.is_archived = 0 OR m.is_archived IS NULL)
                      AND (mps.id IS NOT NULL OR t.id IS NOT NULL)");
                $mx->execute([$pid, $pid]);
                $addMembersByIds(array_map('intval', array_column($mx->fetchAll(), 'id')), 'mentor');
            }
        }
        // Org-wide by member type
        foreach (($d['org'] ?? []) as $scope) {
            if ($scope === 'parents') {
                $allYouth = array_map('intval', array_column($pdo->query("SELECT id FROM members WHERE member_type='youth' AND (is_archived=0 OR is_archived IS NULL)$activeAnd")->fetchAll(), 'id'));
                $addParentsOfYouth($allYouth);
            } else {
                $type = rtrim((string)$scope, 's'); // mentors→mentor, youth→youth, volunteers→volunteer
                $st = $pdo->prepare("SELECT id FROM members WHERE member_type = ? AND (is_archived=0 OR is_archived IS NULL)"); $st->execute([$type]);
                $addMembersByIds(array_map('intval', array_column($st->fetchAll(), 'id')), $type);
            }
        }
        // Compliance groups (#179): reach families by this season's enrollment status —
        // not re-registered (still pending), T&C not signed, an unpaid/partial balance, or
        // on a payment plan / fee override. This exposes who owes money / hasn't finished,
        // so it's restricted to Admin / System Administrator (NOT every mentor). Youth
        // resolve to their guardians; adult enrollees to themselves. Inactive accounts are
        // excluded unless "include inactive" is set.
        $compSel = $d['compliance'] ?? null;
        if (is_array($compSel) && $compSel
            && Permissions::isSuperAdmin($pdo, $cur)) {
            $valid = ['not_registered', 'tc_incomplete', 'unpaid', 'payment_plan'];
            $sel = array_values(array_intersect($valid, array_map('strval', $compSel)));
            if ($sel) {
                $conds = [];
                foreach ($sel as $s) {
                    if ($s === 'not_registered') {
                        // Season rollover creates a 'pending' enrollment that auto-confirms
                        // (to active/paid) once payment + T&C + shirt size are done. Still
                        // pending = the family hasn't finished re-registering.
                        $conds[] = "e.status = 'pending'";
                    } elseif ($s === 'tc_incomplete') {
                        $conds[] = "NOT (COALESCE(e.tc_youth_agreed,0)=1 AND COALESCE(e.tc_parent_agreed,0)=1)";
                    } elseif ($s === 'unpaid') {
                        $conds[] = "(e.date_payment IS NULL AND COALESCE(e.payment_override,0)=0
                                     AND (COALESCE(e.amount_due,0) - COALESCE(e.payment_amount,0)) > 0)";
                    } elseif ($s === 'payment_plan') {
                        $conds[] = "(COALESCE(e.payment_override,0)=1 OR pp.enrollment_id IS NOT NULL)";
                    }
                }
                $cq = $pdo->prepare(
                    "SELECT DISTINCT m.id, m.member_type
                       FROM enrollments e
                       JOIN members m ON m.id = e.member_id
                       LEFT JOIN enrollment_payment_plans pp ON pp.enrollment_id = e.id
                      WHERE e.enrollment_year = ? AND e.status <> 'cancelled'
                        AND (m.is_archived = 0 OR m.is_archived IS NULL)
                        AND (" . implode(' OR ', $conds) . ")");
                $cq->execute([$year]);
                $cYouth = []; $cAdult = [];
                foreach ($cq->fetchAll() as $r) {
                    if (($r['member_type'] ?? '') === 'youth') $cYouth[] = (int)$r['id'];
                    else $cAdult[] = (int)$r['id'];
                }
                if ($cYouth) $addParentsOfYouth($cYouth);
                if ($cAdult) $addMembersByIds($cAdult, 'compliance');
            }
        }
        // Explicit individuals
        $indiv = array_values(array_filter(array_map('intval', (array)($d['individuals'] ?? []))));
        if ($indiv) $addMembersByIds($indiv, 'individual');

        // Visitors (prospective inquiries not yet converted). Filter by status, program
        // interest and/or visit date, or 'all'. Each resolves to their own email, else the
        // guardian's.
        $vconf = $d['visitors'] ?? null;
        $vDate = static function ($v): string {
            $v = trim((string)$v);
            return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : '';
        };
        $vFrom = is_array($vconf) ? $vDate($vconf['from_date'] ?? '') : '';
        $vTo   = is_array($vconf) ? $vDate($vconf['to_date'] ?? '')   : '';
        if (is_array($vconf) && (!empty($vconf['all']) || !empty($vconf['statuses']) || !empty($vconf['program_id']) || !empty($vconf['ids']) || $vFrom !== '' || $vTo !== '')) {
            $vwhere = ['converted_member_id IS NULL']; $vargs = [];
            if (!empty($vconf['ids']) && is_array($vconf['ids'])) {
                $vids = array_values(array_filter(array_map('intval', $vconf['ids'])));
                if ($vids) { $vwhere[] = 'id IN (' . implode(',', array_fill(0, count($vids), '?')) . ')'; foreach ($vids as $x) $vargs[] = $x; }
            }
            if (!empty($vconf['statuses']) && is_array($vconf['statuses'])) {
                $vwhere[] = 'status IN (' . implode(',', array_fill(0, count($vconf['statuses']), '?')) . ')';
                foreach ($vconf['statuses'] as $s) $vargs[] = (string)$s;
            }
            if (!empty($vconf['program_id'])) { $vwhere[] = 'program_interest_id = ?'; $vargs[] = (int)$vconf['program_id']; }
            // "Visited between" — a visitor counts if this is when they first came in
            // (inquiry_date) OR they have a logged interaction in the window. Repeat visits
            // reuse the existing visitor row and log to visitor_interactions, so matching on
            // inquiry_date alone would miss a returning family at an open house.
            if ($vFrom !== '' || $vTo !== '') {
                $from = $vFrom !== '' ? $vFrom : '1900-01-01';
                $to   = $vTo   !== '' ? $vTo   : '2999-12-31';
                $vwhere[] = '(DATE(inquiry_date) BETWEEN ? AND ?
                              OR EXISTS (SELECT 1 FROM visitor_interactions vi
                                         WHERE vi.visitor_id = visitors.id
                                           AND vi.occurred_at BETWEEN ? AND ?))';
                $vargs[] = $from; $vargs[] = $to; $vargs[] = $from; $vargs[] = $to;
            }
            $vs = $pdo->prepare("SELECT id, first_name, last_name, email, guardian1_name, guardian1_email
                                 FROM visitors WHERE " . implode(' AND ', $vwhere));
            $vs->execute($vargs);
            foreach ($vs->fetchAll() as $v) {
                $own = trim((string)($v['email'] ?? ''));
                if ($own !== '') { $email = $own; $name = trim(($v['first_name'] ?? '') . ' ' . ($v['last_name'] ?? '')); }
                else { $email = (string)($v['guardian1_email'] ?? ''); $name = trim((string)($v['guardian1_name'] ?? '')) ?: ('Parent of ' . ($v['first_name'] ?? '')); }
                $addVisitor((int)$v['id'], $email, $name);
            }
        }

        // Mailing-list subscribers (volunteers/newsletter contacts with no account). Only
        // the active, non-member rows — a subscriber who became a member is reached through
        // the members source instead, so they aren't emailed twice.
        if (!empty($d['mailing_list'])) {
            $ss = $pdo->query("SELECT id, first_name, last_name, email FROM mailing_list_subscribers
                                WHERE member_id IS NULL AND unsubscribed_at IS NULL");
            foreach ($ss->fetchAll() as $s) {
                $addSubscriber((int)$s['id'], $s['email'], trim(($s['first_name'] ?? '') . ' ' . ($s['last_name'] ?? '')));
            }
        }

        return Http::json($res, ['count' => count($list), 'skipped_no_email' => $noEmail, 'skipped_optout' => $skippedOptout, 'recipients' => $list]);
    }

    /**
     * POST /comms/send-bulk — send a personalized email to an explicit recipient list
     * (already resolved client-side). Each recipient gets variables filled from their
     * context member, its own thread, and a delivery via the configured relay.
     */
    public static function sendBulk(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $recips = is_array($d['recipients'] ?? null) ? $d['recipients'] : [];
        if (!$recips) return Http::error($res, 'No recipients.', 422);
        if (count($recips) > 1000) return Http::error($res, 'Too many recipients (max 1000 per send).', 422);
        $subjectTpl = (string)($d['subject'] ?? '');
        $bodyTpl = (string)($d['body_html'] ?? '');
        $replyEnabled = (bool)($d['reply_enabled'] ?? false);
        $templateId = isset($d['template_id']) ? (int)$d['template_id'] : null;
        $eventIds = self::embeddedEventIds($d);
        $layoutId = (int)($d['layout_id'] ?? 0);
        $includeUnsub = !empty($d['include_unsubscribe']);
        $skippedUnsub = 0;
        // Category opt-out is enforced HERE too (not just at resolve) so a member who opted out of
        // this category is never emailed, even if the client posts a stale recipient list.
        $category = trim((string)($d['category'] ?? ''));
        $optedOut = self::optedOutMemberIds($pdo, $category);
        $skippedOptout = 0;
        $bulkAtts = self::attachmentsForIds($pdo, (array)($d['attachment_ids'] ?? [])) ?: null;
        $emailEnabled = self::emailEnabled();
        $trackBase = EmailTracking::base();
        $senderName = trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? ''));
        $replyTo = $replyEnabled ? Mailer::fromAddress() : null;

        // One batch id ties every thread from this bulk send together so the
        // Message History can show it as a single, expandable line. Personalized
        // = the template uses per-recipient variables, so each email differs.
        $batchId = self::uuid4();
        $personalized = (strpos($subjectTpl, '{{') !== false || strpos($bodyTpl, '{{') !== false) ? 1 : 0;

        $sent = 0; $failed = 0; $errors = []; $seen = [];
        $youthContacted = [];   // youth emailed at their own address — one oversight notice at the end
        // Identify who the send went to, so the CC/copy (below) can name the recipients
        // and — for a single-recipient send — be personalized just like the real message.
        $copyRecipients = []; $firstCtx = null;
        foreach ($recips as $r) {
            $email = trim((string)($r['email'] ?? ''));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $failed++; $errors[] = ['email' => $email, 'error' => 'invalid address']; continue; }
            $key = strtolower($email);
            if (isset($seen[$key])) continue; // defensive de-dup
            $seen[$key] = true;
            // Honour unsubscribes for mass emails that include the unsubscribe link.
            if ($includeUnsub && self::isUnsubscribed($pdo, $email)) { $skippedUnsub++; continue; }
            $memberId = isset($r['member_id']) && $r['member_id'] !== null ? (int)$r['member_id'] : 0;
            if ($memberId && isset($optedOut[$memberId])) { $skippedOptout++; continue; }
            $visitorId = isset($r['visitor_id']) && $r['visitor_id'] !== null ? (int)$r['visitor_id'] : 0;
            $subscriberId = isset($r['subscriber_id']) && $r['subscriber_id'] !== null ? (int)$r['subscriber_id'] : 0;
            $name = trim((string)($r['name'] ?? '')) ?: $email;

            $ctx = $visitorId ? self::buildContext($pdo, 'visitor', $visitorId)
                : ($memberId ? self::buildContext($pdo, 'member', $memberId)
                : (self::baseContext($pdo) + ['full_name' => $name]));
            // Caller-supplied per-recipient merge variables (e.g. camper personalization, #106).
            // Only ADD keys — never let a caller-supplied var overwrite a trusted
            // context value (org_name, login_url, member fields, rsvp links, …),
            // which could otherwise swap links in an org-branded email.
            if (!empty($r['vars']) && is_array($r['vars'])) {
                foreach ($r['vars'] as $vk => $vv) {
                    if (is_scalar($vv) && !array_key_exists((string)$vk, $ctx)) $ctx[(string)$vk] = (string)$vv;
                }
            }
            if ($eventIds) $ctx = array_merge($ctx, self::rsvpContextFor($pdo, $eventIds, $memberId));
            if (count($copyRecipients) < 1000) $copyRecipients[] = ['name' => $name, 'email' => $email];
            if ($firstCtx === null) $firstCtx = $ctx;
            $subject = self::renderVariables($subjectTpl, $ctx);
            $bodyHtml = self::renderVariables($bodyTpl, $ctx, true);
            [$hdr, $ftr] = self::layoutParts($pdo, $layoutId ?: null, $ctx);
            $unsubUrl = $includeUnsub ? self::unsubUrlFor($pdo, $email) : null;
            $wrapped = self::wrapEmailHtml($bodyHtml, $hdr, $ftr, $unsubUrl);
            $plain = self::htmlToText($bodyHtml);
            $token = self::uuid4();

            $recipType = $visitorId ? 'visitor' : ($subscriberId ? 'subscriber' : 'member');
            $recipId = $visitorId ?: ($subscriberId ?: $memberId);
            $ins = $pdo->prepare("INSERT INTO communication_threads (subject, recipient_type, recipient_id, recipient_email, recipient_name, reply_enabled, reply_token, status, created_by_id, batch_id, batch_personalized, created_at, updated_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NOW(), NOW())");
            $ins->execute([$subject, $recipType, $recipId, $email, $name, (int)$replyEnabled, $token, (int)$cur['id'], $batchId, $personalized]);
            $threadId = (int)$pdo->lastInsertId();

            // Open/click tracking — a tracked copy is sent; the stored body stays clean.
            $trackToken = EmailTracking::token();
            $sendHtml = $wrapped; $trackLinks = [];
            if ($trackBase !== '') { [$sendHtml, $trackLinks] = EmailTracking::apply($wrapped, $trackToken, $trackBase); }

            $ok = false; $err = null;
            if ($emailEnabled) {
                try { $ok = Mailer::send($email, $subject, $sendHtml, $plain, null, $replyTo, $bulkAtts); if (!$ok) $err = Mailer::lastError() ?? 'Send failed.'; }
                catch (\Throwable $e) { $err = $e->getMessage(); }
            }
            $delivered = $ok || !$emailEnabled;
            $pdo->prepare("INSERT INTO communication_messages (thread_id, sender_id, sender_name, direction, subject, body_html, body_text, status, sent_at, error_message, template_id, track_token, created_at)
                           VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, " . ($delivered ? 'NOW()' : 'NULL') . ", ?, ?, ?, NOW())")
                ->execute([$threadId, (int)$cur['id'], $senderName, $subject, $wrapped, $plain, $delivered ? 'sent' : 'failed', $err, $templateId, ($trackBase !== '' && $delivered) ? $trackToken : null]);
            if ($trackBase !== '' && $delivered) self::persistTrackedLinks($pdo, (int)$pdo->lastInsertId(), $trackLinks);
            if ($ok) {
                $sent++;
                // A 'youth' recipient was resolved to their OWN email (guardians resolve as
                // a 'parent' recipient), so this is a youth contacted with no adult on the mail.
                if (($r['kind'] ?? '') === 'youth') $youthContacted[] = ['name' => $name, 'email' => $email];
            } elseif ($emailEnabled) { $failed++; $errors[] = ['email' => $email, 'error' => $err]; }
        }

        // One youth-safety notice for the whole send (not one per youth).
        self::notifyYouthContact($senderName, $subjectTpl, $youthContacted);

        // Optional CC / "send a copy to" (#150) + always-CC info@ (#172): ONE copy of
        // the message for the record — not one per recipient. The copy names WHO the
        // send went to so staff can see it, and for a single-recipient send it is
        // personalized exactly like the real message (so {{first_name}} etc. show the
        // real person, not a raw tag). Per-recipient ACTION links (RSVP / signup /
        // employer form) are blanked — those are the recipient's to act on, and the
        // copy reader must not be able to respond on their behalf.
        $copySent = 0;
        $copyTo = $d['copy_to'] ?? null;
        $copyList = is_array($copyTo) ? $copyTo : preg_split('/[,;\s]+/', (string)$copyTo, -1, PREG_SPLIT_NO_EMPTY);
        if ($always = EmailSettingsController::alwaysCc($pdo)) $copyList[] = $always;

        // Keys that carry a recipient's own tokenized action link — always blanked in a copy.
        $blankAction = function (array $ctx): array {
            foreach (array_keys($ctx) as $k) {
                if ($k === 'signup_url' || $k === 'employer_form_url' || strncmp($k, 'rsvp_', 5) === 0) $ctx[$k] = '';
            }
            return $ctx;
        };
        $esc = fn(string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        if (count($copyRecipients) === 1 && $firstCtx !== null) {
            // Single recipient: mirror the real message, minus their action links.
            $copyCtx = $blankAction($firstCtx);
            $r0 = $copyRecipients[0];
            $copyNote = '<p style="font-size:12px;color:#667">Copy of the message sent to <strong>'
                . $esc($r0['name']) . '</strong> &lt;' . $esc($r0['email']) . '&gt;.</p>';
        } else {
            // Multiple recipients: one copy can't personalize per person, so blank the
            // personal fields (no raw {{tags}}) and list who it went to in the note.
            $copyCtx = self::baseContext($pdo);
            foreach (['first_name', 'last_name', 'full_name', 'member_number', 'visitor_number',
                      'email', 'member_type', 'guardian1_name', 'guardian1_email', 'program_interest',
                      'signup_url', 'employer_form_url'] as $bk) { $copyCtx[$bk] = ''; }
            $list = array_map(fn($x) => $x['name'] . ' <' . $x['email'] . '>', array_slice($copyRecipients, 0, 50));
            $more = count($copyRecipients) > 50 ? ' … and ' . (count($copyRecipients) - 50) . ' more' : '';
            $copyNote = '<p style="font-size:12px;color:#667">Copy of the message sent to ' . $sent
                . ' recipient(s). Personalized fields are blank in this copy.</p>'
                . '<p style="font-size:12px;color:#667"><strong>Recipients:</strong> '
                . $esc(implode('; ', $list)) . $more . '</p>';
        }

        $copySeen = [];
        foreach ((array)$copyList as $cc) {
            $cc = trim((string)$cc);
            if ($cc === '' || !filter_var($cc, FILTER_VALIDATE_EMAIL) || isset($copySeen[strtolower($cc)])) continue;
            $copySeen[strtolower($cc)] = true;
            $subject = 'Copy: ' . self::renderVariables($subjectTpl, $copyCtx);
            $bodyHtml = self::renderVariables($bodyTpl, $copyCtx, true);
            [$hdr, $ftr] = self::layoutParts($pdo, $layoutId ?: null, $copyCtx);
            $wrapped = self::wrapEmailHtml($copyNote . $bodyHtml, $hdr, $ftr, null);
            $plain = self::htmlToText($bodyHtml);
            if ($emailEnabled) {
                try { if (Mailer::send($cc, $subject, $wrapped, $plain, null, $replyTo, $bulkAtts)) $copySent++; } catch (\Throwable $e) { /* best-effort */ }
            } else { $copySent++; }
        }

        return Http::json($res, ['ok' => true, 'total' => count($seen), 'sent' => $sent, 'failed' => $failed,
            'skipped_unsubscribed' => $skippedUnsub, 'skipped_optout' => $skippedOptout, 'copies_sent' => $copySent,
            'email_enabled' => $emailEnabled, 'errors' => array_slice($errors, 0, 25)], 201);
    }

    // ── Threads ──────────────────────────────────────────────────────────
    /**
     * GET /comms/messages — admin-wide message history across ALL recipients,
     * with optional filters. Query params:
     *   team_season_id  — recipient is/was on any season of that team
     *   program_id      — recipient enrolled in, supports, or rosters that program
     *   member_type     — youth | mentor | parent | volunteer | sponsor | visitor
     *   search          — matches subject, recipient name, or email
     *   limit, offset   — pagination (default 100)
     */
    public static function messageHistory(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);

        $q = $req->getQueryParams();
        $where = ['1=1']; $params = [];

        // Team — resolve the picker's team_season_id to its team, match any season.
        $tsid = (int)($q['team_season_id'] ?? 0);
        if ($tsid > 0) {
            $r = $pdo->prepare("SELECT team_id FROM team_seasons WHERE id = ?"); $r->execute([$tsid]);
            $teamId = (int)($r->fetchColumn() ?: 0);
            if ($teamId > 0) {
                $where[] = "t.recipient_type = 'member' AND EXISTS (
                    SELECT 1 FROM team_member_assignments tma
                    JOIN team_seasons ts ON ts.id = tma.team_season_id
                    WHERE tma.member_id = t.recipient_id AND ts.team_id = ?)";
                $params[] = $teamId;
            } else {
                $where[] = "0=1"; // unknown team → no rows
            }
        }

        // Program — enrolled youth, profile-tagged mentors, or roster on that program's teams.
        $pid = (int)($q['program_id'] ?? 0);
        if ($pid > 0) {
            $where[] = "t.recipient_type = 'member' AND (
                EXISTS (SELECT 1 FROM enrollments e WHERE e.member_id = t.recipient_id AND e.program_id = ? AND e.status <> 'cancelled')
                OR EXISTS (SELECT 1 FROM member_program_support mps WHERE mps.member_id = t.recipient_id AND mps.program_id = ?)
                OR EXISTS (SELECT 1 FROM team_member_assignments tma
                    JOIN team_seasons ts ON ts.id = tma.team_season_id
                    JOIN teams tt ON tt.id = ts.team_id
                    WHERE tma.member_id = t.recipient_id AND tt.program_id = ?))";
            array_push($params, $pid, $pid, $pid);
        }

        // Member / recipient type.
        $mtype = trim((string)($q['member_type'] ?? ''));
        if ($mtype !== '') {
            switch ($mtype) {
                case 'visitor':
                    $where[] = "t.recipient_type = 'visitor'"; break;
                case 'sponsor':
                    $where[] = "t.recipient_type = 'sponsor'"; break;
                case 'volunteer':
                    $where[] = "(t.recipient_type = 'volunteer' OR m.member_type = 'volunteer')"; break;
                case 'parent':
                    $where[] = "(m.member_type = 'parent' OR (t.recipient_email <> '' AND (
                        LOWER(t.recipient_email) = LOWER(COALESCE(m.guardian1_email, ''))
                        OR LOWER(t.recipient_email) = LOWER(COALESCE(m.guardian2_email, '')))))";
                    break;
                default: // youth, mentor, etc.
                    $where[] = "m.member_type = ?"; $params[] = $mtype; break;
            }
        }

        // Date range (on thread creation). Inclusive of both endpoints (YYYY-MM-DD).
        $dateFrom = trim((string)($q['date_from'] ?? ''));
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom)) {
            $where[] = "t.created_at >= ?"; $params[] = $dateFrom . ' 00:00:00';
        }
        $dateTo = trim((string)($q['date_to'] ?? ''));
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
            $where[] = "t.created_at < DATE_ADD(?, INTERVAL 1 DAY)"; $params[] = $dateTo . ' 00:00:00';
        }

        // Free-text search.
        $search = trim((string)($q['search'] ?? ''));
        if ($search !== '') {
            $like = '%' . $search . '%';
            $where[] = "(t.subject LIKE ? OR t.recipient_name LIKE ? OR t.recipient_email LIKE ?)";
            array_push($params, $like, $like, $like);
        }

        $whereSql = implode(' AND ', $where);
        $limit = min(200, max(1, (int)($q['limit'] ?? 50)));
        $offset = max(0, (int)($q['offset'] ?? 0));

        // A "group key" ties together the threads of a single bulk send (shared
        // batch_id); a one-off send is its own group ('s'<thread id>).
        $gk = "COALESCE(t.batch_id, CONCAT('s', t.id))";

        // Total = number of distinct groups matching the filters.
        $total = (int)(function () use ($pdo, $whereSql, $params, $gk) {
            $c = $pdo->prepare("SELECT COUNT(*) FROM (
                    SELECT $gk AS gk FROM communication_threads t
                    LEFT JOIN members m ON m.id = t.recipient_id AND t.recipient_type = 'member'
                    WHERE $whereSql GROUP BY gk) z");
            $c->execute($params);
            return $c->fetchColumn();
        })();

        // Page of groups, ordered by most-recent activity.
        $pageSql = "SELECT $gk AS gk, MAX(t.created_at) AS last_at
                    FROM communication_threads t
                    LEFT JOIN members m ON m.id = t.recipient_id AND t.recipient_type = 'member'
                    WHERE $whereSql
                    GROUP BY gk
                    ORDER BY last_at DESC, gk DESC
                    LIMIT $limit OFFSET $offset";
        $ps = $pdo->prepare($pageSql); $ps->execute($params);
        $pageGroups = $ps->fetchAll();
        $keys = array_column($pageGroups, 'gk');

        $groups = [];
        if ($keys) {
            // Pull every (filter-matching) recipient thread for the page's groups.
            $inKeys = implode(',', array_fill(0, count($keys), '?'));
            $detailSql = "SELECT t.id, $gk AS gk, t.subject, t.recipient_type, t.recipient_id,
                                 t.recipient_name, t.recipient_email, t.created_at, t.batch_id, t.batch_personalized,
                                 m.member_type, m.first_name AS m_first, m.last_name AS m_last,
                                 m.guardian1_email, m.guardian2_email,
                                 cb.first_name AS cb_first, cb.last_name AS cb_last,
                                 (SELECT cm.status FROM communication_messages cm WHERE cm.thread_id = t.id ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_status,
                                 (SELECT cm.opened_at FROM communication_messages cm WHERE cm.thread_id = t.id ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_opened_at,
                                 (SELECT cm.clicked_at FROM communication_messages cm WHERE cm.thread_id = t.id ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_clicked_at
                          FROM communication_threads t
                          LEFT JOIN members m ON m.id = t.recipient_id AND t.recipient_type = 'member'
                          LEFT JOIN members cb ON cb.id = t.created_by_id
                          WHERE ($gk) IN ($inKeys) AND $whereSql
                          ORDER BY t.recipient_name, t.id";
            $ds = $pdo->prepare($detailSql);
            $ds->execute(array_merge($keys, $params));

            $buckets = []; // gk => assembled group
            foreach ($ds->fetchAll() as $t) {
                $key = $t['gk'];
                $email = strtolower(trim((string)$t['recipient_email']));
                $g1 = strtolower(trim((string)($t['guardian1_email'] ?? '')));
                $g2 = strtolower(trim((string)($t['guardian2_email'] ?? '')));
                if ($t['recipient_type'] !== 'member') {
                    $audience = $t['recipient_type'];
                } elseif ($t['member_type'] === 'parent' || ($email !== '' && ($email === $g1 || $email === $g2))) {
                    $audience = 'parent';
                } else {
                    $audience = $t['member_type'] ?: 'member';
                }
                if (!isset($buckets[$key])) {
                    $buckets[$key] = [
                        'group_key' => $key, 'batch_id' => $t['batch_id'],
                        'subject' => $t['subject'],
                        'sent_by' => trim(($t['cb_first'] ?? '') . ' ' . ($t['cb_last'] ?? '')) ?: null,
                        'created_at' => $t['created_at'],
                        'batch_personalized' => $t['batch_personalized'] !== null ? (int)$t['batch_personalized'] : null,
                        '_subjects' => [], 'recipients' => [],
                        'sent_count' => 0, 'failed_count' => 0, 'opened_count' => 0, 'clicked_count' => 0,
                    ];
                }
                $b = &$buckets[$key];
                $b['_subjects'][$t['subject']] = true;
                if ($t['created_at'] > $b['created_at']) $b['created_at'] = $t['created_at'];
                if ($t['last_status'] === 'sent') $b['sent_count']++;
                elseif ($t['last_status'] === 'failed') $b['failed_count']++;
                if (!empty($t['last_opened_at'])) $b['opened_count']++;
                if (!empty($t['last_clicked_at'])) $b['clicked_count']++;
                $b['recipients'][] = [
                    'thread_id' => (int)$t['id'],
                    'recipient_name' => $t['recipient_name'] ?: trim(($t['m_first'] ?? '') . ' ' . ($t['m_last'] ?? '')),
                    'recipient_email' => $t['recipient_email'],
                    'audience' => $audience,
                    'last_status' => $t['last_status'],
                    'opened' => !empty($t['last_opened_at']),
                    'clicked' => !empty($t['last_clicked_at']),
                ];
                unset($b);
            }

            // Emit in page order.
            foreach ($pageGroups as $pg) {
                $b = $buckets[$pg['gk']] ?? null;
                if (!$b) continue;
                $count = count($b['recipients']);
                // Personalized if the send used variables, or (legacy) subjects differ.
                $personalized = ($b['batch_personalized'] === 1) || (count($b['_subjects']) > 1);
                $audiences = array_values(array_unique(array_column($b['recipients'], 'audience')));
                $groups[] = [
                    'group_key' => $b['group_key'],
                    'is_group' => $count > 1,
                    'thread_id' => $count === 1 ? $b['recipients'][0]['thread_id'] : null,
                    'subject' => $b['subject'],
                    'personalized' => $personalized,
                    'recipient_count' => $count,
                    'sent_count' => $b['sent_count'],
                    'failed_count' => $b['failed_count'],
                    'opened_count' => $b['opened_count'],
                    'clicked_count' => $b['clicked_count'],
                    'audiences' => $audiences,
                    'sent_by' => $b['sent_by'],
                    'created_at' => Time::naiveIso($b['created_at']),
                    'recipients' => $b['recipients'],
                ];
            }
        }

        return Http::json($res, ['total' => $total, 'limit' => $limit, 'offset' => $offset, 'groups' => $groups]);
    }

    /**
     * Who may read a recipient's message history: anyone with the "Message History"
     * profile permission (profile.communications — Mentors/Parents/staff per Role
     * Management), plus you always see your own, and a guardian sees their youth's.
     * Members without it (incl. youth) can't read other members' messages.
     */
    private static function mayViewRecipientHistory(PDO $pdo, array $cur, string $type, int $rid): bool
    {
        if (Permissions::memberCan($pdo, $cur, 'profile.communications', 'read')) return true;
        if ($type === 'member') {
            if ((int)$cur['id'] === $rid) return true;
            $s = $pdo->prepare(
                "SELECT 1 FROM family_members a
                   JOIN family_members b ON a.family_id = b.family_id
                   JOIN members y ON y.id = b.member_id
                  WHERE a.member_id = ? AND b.member_id = ? AND y.member_type = 'youth' LIMIT 1");
            $s->execute([(int)$cur['id'], $rid]);
            if ($s->fetchColumn()) return true;
        }
        return false;
    }

    public static function recipientThreads(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $type = $q['recipient_type'] ?? ''; $rid = (int)($q['recipient_id'] ?? 0);
        if (!self::mayViewRecipientHistory($pdo, $cur, (string)$type, $rid)) return Http::error($res, 'Access denied', 403);
        $ts = $pdo->prepare("SELECT * FROM communication_threads WHERE recipient_type = ? AND recipient_id = ? ORDER BY created_at DESC");
        $ts->execute([$type, $rid]);
        $out = [];
        foreach ($ts->fetchAll() as $t) {
            $ms = $pdo->prepare("SELECT created_at, sender_name, status, opened_at, clicked_at FROM communication_messages WHERE thread_id = ? ORDER BY created_at");
            $ms->execute([(int)$t['id']]); $msgs = $ms->fetchAll();
            $last = $msgs ? end($msgs) : null;
            $out[] = [
                'id' => (int)$t['id'], 'subject' => $t['subject'], 'recipient_email' => $t['recipient_email'],
                'reply_enabled' => (bool)$t['reply_enabled'], 'status' => $t['status'],
                'created_at' => Time::naiveIso($t['created_at']), 'message_count' => count($msgs),
                'last_message_at' => Time::naiveIso($last ? $last['created_at'] : $t['created_at']),
                'last_sender' => $last ? $last['sender_name'] : null,
                'last_status' => $last ? $last['status'] : null,
                'opened' => $last ? !empty($last['opened_at']) : false,
                'clicked' => $last ? !empty($last['clicked_at']) : false,
            ];
        }
        return Http::json($res, $out);
    }

    public static function getThread(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['thread_id'];
        $s = $pdo->prepare("SELECT * FROM communication_threads WHERE id = ?"); $s->execute([$id]);
        $t = $s->fetch();
        if (!$t) return Http::error($res, 'Thread not found', 404);
        if (!self::mayViewRecipientHistory($pdo, $cur, (string)$t['recipient_type'], (int)$t['recipient_id']))
            return Http::error($res, 'Access denied', 403);
        $ms = $pdo->prepare("SELECT * FROM communication_messages WHERE thread_id = ? ORDER BY created_at");
        $ms->execute([$id]);
        $messages = [];
        foreach ($ms->fetchAll() as $m) {
            $messages[] = [
                'id' => (int)$m['id'], 'sender_id' => $m['sender_id'] !== null ? (int)$m['sender_id'] : null,
                'sender_name' => $m['sender_name'] ?: 'System', 'direction' => $m['direction'],
                'subject' => $m['subject'], 'body_html' => $m['body_html'], 'body_text' => $m['body_text'],
                'status' => $m['status'], 'sent_at' => Time::naiveIso($m['sent_at']),
                'created_at' => Time::naiveIso($m['created_at']),
                'opened_at' => Time::naiveIso($m['opened_at'] ?? null),
                'open_count' => isset($m['open_count']) ? (int)$m['open_count'] : 0,
                'clicked_at' => Time::naiveIso($m['clicked_at'] ?? null),
                'click_count' => isset($m['click_count']) ? (int)$m['click_count'] : 0,
            ];
        }
        return Http::json($res, [
            'id' => (int)$t['id'], 'subject' => $t['subject'], 'recipient_type' => $t['recipient_type'],
            'recipient_id' => (int)$t['recipient_id'], 'recipient_email' => $t['recipient_email'],
            'recipient_name' => $t['recipient_name'], 'reply_enabled' => (bool)$t['reply_enabled'],
            'status' => $t['status'], 'created_at' => Time::naiveIso($t['created_at']), 'messages' => $messages,
        ]);
    }

    public static function closeThread(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['thread_id'];
        $s = $pdo->prepare("SELECT 1 FROM communication_threads WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Thread not found', 404);
        $pdo->prepare("UPDATE communication_threads SET status = 'closed' WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Preferences ──────────────────────────────────────────────────────
    private static function preferenceTypes(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'member_comm_preference_types'"); $s->execute();
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        return (is_array($v) && $v) ? $v : [
            'Weekly Newsletter', 'Event Reminders', 'Enrollment Renewal Notices', 'Team Updates',
            'Volunteer Opportunities', 'Sponsorship Opportunities', 'Fundraising Updates', 'Emergency / Urgent Notices',
        ];
    }

    public static function getPreferences(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($cur['id'] != $mid && !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $types = self::preferenceTypes($pdo);
        $rows = $pdo->prepare("SELECT preference_type, opted_in FROM member_comm_preferences WHERE member_id = ?");
        $rows->execute([$mid]);
        $saved = [];
        foreach ($rows->fetchAll() as $r) $saved[$r['preference_type']] = (bool)$r['opted_in'];
        $out = [];
        foreach ($types as $t) $out[] = ['preference_type' => $t, 'opted_in' => $saved[$t] ?? true];
        return Http::json($res, $out);
    }

    public static function updatePreferences(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($cur['id'] != $mid && !Permissions::isSuperAdmin($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        foreach (($d['preferences'] ?? []) as $pref) {
            $ptype = trim((string)($pref['preference_type'] ?? ''));
            if ($ptype === '') continue;
            $opted = (int)(bool)($pref['opted_in'] ?? true);
            $stmt = $pdo->prepare("INSERT INTO member_comm_preferences (member_id, preference_type, opted_in, updated_at)
                                   VALUES (?, ?, ?, NOW())
                                   ON DUPLICATE KEY UPDATE opted_in = VALUES(opted_in), updated_at = NOW()");
            $stmt->execute([$mid, $ptype, $opted]);
        }
        return Http::json($res, ['ok' => true]);
    }

    public static function preferenceTypesEndpoint(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::preferenceTypes($pdo));
    }

    // ── Email drafts (#132) — per-author saved compositions ────────────────────
    public static function listDrafts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT id, subject, updated_at FROM email_drafts WHERE created_by_id = ? ORDER BY updated_at DESC");
        $s->execute([(int)$cur['id']]);
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'subject' => $r['subject'] ?: '(no subject)', 'updated_at' => Time::naiveIso($r['updated_at']),
        ], $s->fetchAll()));
    }

    public static function getDraft(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $s = $pdo->prepare("SELECT * FROM email_drafts WHERE id = ? AND created_by_id = ?");
        $s->execute([(int)$route['draft_id'], (int)$cur['id']]);
        $r = $s->fetch();
        if (!$r) return Http::error($res, 'Draft not found', 404);
        return Http::json($res, ['id' => (int)$r['id'], 'subject' => $r['subject'], 'payload' => json_decode((string)$r['payload'], true)]);
    }

    /** POST /comms/drafts (new) or PUT /comms/drafts/{id} (update). Body: {subject, payload}. */
    public static function saveDraft(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $subject = mb_substr(trim((string)($d['subject'] ?? '')), 0, 300);
        $payload = json_encode($d['payload'] ?? []);
        $draftId = isset($route['draft_id']) ? (int)$route['draft_id'] : 0;
        if ($draftId) {
            $own = $pdo->prepare("SELECT id FROM email_drafts WHERE id = ? AND created_by_id = ?");
            $own->execute([$draftId, (int)$cur['id']]);
            if (!$own->fetch()) return Http::error($res, 'Draft not found', 404);
            $pdo->prepare("UPDATE email_drafts SET subject = ?, payload = ?, updated_at = NOW() WHERE id = ?")
                ->execute([$subject, $payload, $draftId]);
        } else {
            $pdo->prepare("INSERT INTO email_drafts (created_by_id, subject, payload, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())")
                ->execute([(int)$cur['id'], $subject, $payload]);
            $draftId = (int)$pdo->lastInsertId();
        }
        return Http::json($res, ['id' => $draftId, 'subject' => $subject], $route ? 200 : 201);
    }

    public static function deleteDraft(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $pdo->prepare("DELETE FROM email_drafts WHERE id = ? AND created_by_id = ?")->execute([(int)$route['draft_id'], (int)$cur['id']]);
        return Http::json($res, ['ok' => true]);
    }

    /** Store the tracked links for a sent message so /track/c/{token} can redirect + count. */
    private static function persistTrackedLinks(\PDO $pdo, int $messageId, array $links): void
    {
        if (!$links) return;
        $ins = $pdo->prepare("INSERT INTO comm_email_links (link_token, message_id, url, created_at) VALUES (?, ?, ?, NOW())");
        foreach ($links as $token => $url) {
            $ins->execute([(string)$token, $messageId, mb_substr((string)$url, 0, 1024)]);
        }
    }

    private static function uuid4(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
}
