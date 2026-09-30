<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\WelcomeEmail;
use App\Core\YouthContact;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Public, no-login volunteer sign-up — the form embedded on the marketing site
 * (tulsaroboticscenter.org) via an iframe pointing at trcms.tulsaroboticscenter.org/volunteer.
 *
 * A submission creates a full member with the Volunteer type/role and sends a welcome
 * email (the same createSelfSignup path a self-signing visitor uses). Being a member with
 * an email is what puts them "on the mailing list": the Communications bulk sender reaches
 * every member who isn't in email_optouts. If they decline the mailing list, we record an
 * opt-out so that choice is honored.
 *
 * Because this is an OPEN endpoint that provisions accounts, it is defended the same way the
 * public camp form is: a honeypot field, a per-IP hourly rate limit, and de-duplication —
 * an email that already belongs to a member is linked to (their interest noted), never
 * turned into a second account.
 */
final class VolunteerSignupController
{
    private const RATE_LIMIT_PER_HOUR = 15;

    private static function s($v): ?string { $v = trim((string)($v ?? '')); return $v === '' ? null : $v; }
    private static function cap($v, int $max = 2000): ?string { $v = self::s($v); return $v === null ? null : mb_substr($v, 0, $max); }

    private static function ipHash(Request $req): string
    {
        // Security #7: trusted-proxy-aware client IP so a forged X-Forwarded-For can't
        // defeat the rate limiter by handing each request a fresh key.
        $ip = Http::clientIp($req) ?? '0.0.0.0';
        return hash('sha256', 'volunteer|' . $ip);
    }

    /** A config JSON array (interest list), or the default when unset/empty. */
    private static function configList(PDO $pdo, string $cat, array $default): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([$cat]);
        $v = ($r = $s->fetch()) ? json_decode((string)$r['values'], true) : null;
        return (is_array($v) && $v) ? array_values(array_filter(array_map('strval', $v))) : $default;
    }

    /** The form settings object {open, intro}. */
    private static function settings(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'volunteer_signup'");
        $s->execute();
        $v = ($r = $s->fetch()) ? json_decode((string)$r['values'], true) : null;
        $open = !is_array($v) || !array_key_exists('open', $v) ? true : (bool)$v['open'];
        $intro = is_array($v) && !empty($v['intro']) ? (string)$v['intro']
            : 'Thanks for your interest in volunteering with us! Tell us a little about yourself and how you would like to help.';
        return ['open' => $open, 'intro' => $intro];
    }

    /**
     * GET /public/volunteer-signup — what the form shows: the org name, intro text,
     * the interest checklist, and whether sign-ups are currently open.
     */
    public static function intro(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $set = self::settings($pdo);
        return Http::json($res, [
            'org_name'  => Config::get('ORG_NAME', 'Tulsa Robotics Center'),
            'open'      => $set['open'],
            'intro'     => $set['intro'],
            'interests' => self::configList($pdo, 'volunteer_interests', [
                'Event support', 'Mentoring / coaching a team', 'Fundraising & grant writing',
                'Marketing, social media & photography', 'Administrative & office help',
                'Build / technical / shop help',
            ]),
        ]);
    }

    /**
     * POST /public/mailing-list — the lightweight track: add me to the mailing list.
     * No account is created; we just capture the contact so we can keep them informed.
     */
    public static function subscribe(Request $req, Response $res): Response
    {
        // Volunteer-track mailing list — shares the volunteer sign-up "open" toggle.
        return self::handleSubscribe($req, $res, 'volunteer_form', 'mailing-list sign-up', true,
            'Thanks! You\'re on our mailing list — we\'ll keep you posted on ways to get involved.');
    }

    /**
     * POST /public/program-interest — the camps & programs mailing list (no auth).
     * A standalone contact-capture form for families interested in summer camps and
     * program opportunities (QR code / website link). Distinct source so these are
     * identifiable, and NOT gated by the volunteer sign-up toggle — this list is always
     * open so a printed QR code keeps working.
     */
    public static function programInterest(Request $req, Response $res): Response
    {
        return self::handleSubscribe($req, $res, 'program_interest', 'program-interest sign-up', false,
            'Thanks! You\'re on our list — we\'ll keep you posted about summer camps and program opportunities.');
    }

    /**
     * Shared mailing-list capture used by both public tracks. Keeps the honeypot,
     * rate limit, email validation, no-enumeration-oracle response, and upsert in ONE
     * place so those protections can't drift between the two forms.
     */
    private static function handleSubscribe(Request $req, Response $res, string $source, string $kind, bool $gated, string $message): Response
    {
        $pdo = Database::pdo();
        $d = (array)$req->getParsedBody();

        if (self::s($d['website'] ?? null) !== null) return Http::json($res, ['ok' => true]); // honeypot
        if (self::rateLimited($pdo, $req)) return Http::error($res, 'Too many submissions from this connection. Please try again later.', 429);
        if ($gated && !self::settings($pdo)['open']) return Http::error($res, 'Sign-ups are closed right now. Please check back soon!', 403);

        $first = self::cap($d['first_name'] ?? null, 80);
        $last  = self::cap($d['last_name'] ?? null, 80);
        $email = self::cap($d['email'] ?? null, 190);
        $phone = self::cap($d['phone'] ?? null, 40);
        if (!$email) return Http::error($res, 'An email address is required.', 422);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'Please enter a valid email address.', 422);

        $interests = self::interestList($d);
        $note = self::intakeNote($interests, self::cap($d['comments'] ?? null, 2000), self::cap($d['how_heard'] ?? null, 200), $kind);

        // Already a member? They're already reachable by the bulk sender — just note the
        // interest on their record and make sure they're not opted out.
        $ex = $pdo->prepare("SELECT id, special_notes FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1");
        $ex->execute([$email]);
        if ($exist = $ex->fetch()) {
            $mid = (int)$exist['id'];
            $merged = trim((string)($exist['special_notes'] ?? ''));
            $pdo->prepare("UPDATE members SET special_notes = ? WHERE id = ?")
                ->execute([$merged === '' ? $note : $merged . "\n\n" . $note, $mid]);
            self::resubscribeEmail($pdo, $email);
            Audit::write($pdo, null, 'members', $mid, 'mailing_list_interest', null, ['via' => $source]);
            // Same response as a brand-new subscriber below — the public form must not
            // reveal whether an email is already in the system (no enumeration oracle).
            return Http::json($res, ['ok' => true, 'message' => $message]);
        }

        // Upsert the subscriber. A resubmit refreshes their details and re-subscribes.
        $pdo->prepare(
            "INSERT INTO mailing_list_subscribers (first_name, last_name, email, phone, interests, notes, source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
               first_name = VALUES(first_name), last_name = VALUES(last_name),
               phone = COALESCE(VALUES(phone), phone), interests = VALUES(interests),
               notes = VALUES(notes), source = VALUES(source), unsubscribed_at = NULL, updated_at = NOW()")
            ->execute([$first, $last, $email, $phone, $interests ? json_encode(array_values($interests)) : null, $note, $source]);
        self::resubscribeEmail($pdo, $email);

        return Http::json($res, ['ok' => true, 'message' => $message]);
    }

    /** POST /public/volunteer-signup — the account track: create a Volunteer member (no auth). */
    public static function submit(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $d = (array)$req->getParsedBody();

        if (self::s($d['website'] ?? null) !== null) return Http::json($res, ['ok' => true]); // honeypot
        if (self::rateLimited($pdo, $req)) return Http::error($res, 'Too many submissions from this connection. Please try again later.', 429);
        if (!self::settings($pdo)['open']) return Http::error($res, 'Volunteer sign-ups are closed right now. Please check back soon!', 403);

        $first = self::cap($d['first_name'] ?? null, 80);
        $last  = self::cap($d['last_name'] ?? null, 80);
        $email = self::cap($d['email'] ?? null, 190);
        $phone = self::cap($d['phone'] ?? null, 40);
        if (!$first || !$last) return Http::error($res, 'Your first and last name are required.', 422);
        if (!$email) return Http::error($res, 'An email address is required.', 422);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'Please enter a valid email address.', 422);

        $interests = self::interestList($d);
        $note = self::intakeNote($interests, self::cap($d['comments'] ?? null, 2000),
            self::cap($d['how_heard'] ?? null, 200), 'volunteer account sign-up', self::cap($d['availability'] ?? null, 500));
        // Default to on: the whole point of the form is the mailing list. Only an explicit
        // decline (checkbox present and false) opts them out.
        $wantsEmail = !array_key_exists('mailing_list', $d) || !empty($d['mailing_list']);

        // Already a member? Never open a second account — note the interest on the record
        // we have and tell them we've got it. (No welcome email: it would reset a live
        // account's password.)
        $ex = $pdo->prepare("SELECT id, first_name, last_name, special_notes FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1");
        $ex->execute([$email]);
        if ($exist = $ex->fetch()) {
            $mid = (int)$exist['id'];
            $merged = trim((string)($exist['special_notes'] ?? ''));
            $merged = $merged === '' ? $note : $merged . "\n\n" . $note;
            $pdo->prepare("UPDATE members SET special_notes = ? WHERE id = ?")->execute([$merged, $mid]);
            if (!$wantsEmail) self::optOut($pdo, $email);
            Audit::write($pdo, null, 'members', $mid, 'volunteer_interest', null,
                ['via' => 'public_volunteer_form', 'interests' => $interests]);
            self::notifyStaff($pdo, $first . ' ' . $last, $email, $phone, $interests, $note, true, $mid);
            // Identical to the new-account response below so the public form never reveals
            // whether an email already has an account (no enumeration oracle). The wording
            // covers both cases: a returning member is pointed at sign-in / Forgot password.
            return Http::json($res, [
                'ok' => true,
                'welcome_email_sent' => false,
                'login_url' => rtrim((string)Config::get('APP_URL', ''), '/'),
                'message' => 'Thanks for signing up to volunteer! Check your email to finish setting up your account — if you already have one, just sign in or use "Forgot password." Someone from our team will be in touch about how you can help.',
            ]);
        }

        // New volunteer member.
        $memberId = null;
        $pdo->beginTransaction();
        try {
            $memberId = MembersController::createSelfSignup($pdo, [
                'first_name'    => $first,
                'last_name'     => $last,
                'email'         => $email,
                'phone'         => $phone,
                'address_line1' => self::cap($d['address_line1'] ?? null, 190),
                'city'          => self::cap($d['city'] ?? null, 80),
                'state'         => self::cap($d['state'] ?? null, 40),
                'zip_code'      => self::cap($d['zip_code'] ?? null, 20),
            ], 'volunteer');
            $pdo->prepare("UPDATE members SET special_notes = ? WHERE id = ?")->execute([$note, $memberId]);
            if (!$wantsEmail) self::optOut($pdo, $email);
            Audit::write($pdo, null, 'members', $memberId, 'create', null,
                ['from' => 'public_volunteer_form', 'interests' => $interests]);
            // If they were already a mailing-list subscriber, the member record is now the
            // source of truth: link it and drop the subscriber row from the list so a bulk
            // send to "members + mailing list" doesn't reach them twice.
            self::linkSubscriber($pdo, $email, (int)$memberId);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'We could not complete your sign-up. Please contact us and we will finish it for you.', 500);
        }

        // Welcome email (credentials) — after the commit, isolated: a mail failure must
        // never cost them the account they just created.
        $emailSent = false;
        try {
            $m = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $m->execute([$memberId]);
            if ($row = $m->fetch()) {
                $out = WelcomeEmail::issue($pdo, $row, null, Http::clientIp($req));
                $emailSent = (bool)($out['email_sent'] ?? false);
            }
        } catch (\Throwable $e) { /* reported to staff below */ }

        // Staff notice — isolated, never blocks the volunteer's result.
        try {
            self::notifyStaff($pdo, $first . ' ' . $last, $email, $phone, $interests, $note, false, (int)$memberId);
        } catch (\Throwable $e) { /* never block on a staff notification */ }

        return Http::json($res, [
            'ok' => true,
            'welcome_email_sent' => $emailSent,
            'login_url' => rtrim((string)Config::get('APP_URL', ''), '/'),
            // Same wording as the already-a-member branch above — the response must not
            // disclose whether this email was new or existing.
            'message' => 'Thanks for signing up to volunteer! Check your email to finish setting up your account — if you already have one, just sign in or use "Forgot password." Someone from our team will be in touch about how you can help.',
        ]);
    }

    /** Record a submission for the per-IP rate limit; true if over the hourly cap. */
    private static function rateLimited(PDO $pdo, Request $req): bool
    {
        $ipHash = self::ipHash($req);
        $rl = $pdo->prepare("SELECT COUNT(id) FROM volunteer_submit_log WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 HOUR)");
        $rl->execute([$ipHash]);
        $over = (int)$rl->fetchColumn() >= self::RATE_LIMIT_PER_HOUR;
        if (!$over) $pdo->prepare("INSERT INTO volunteer_submit_log (ip_hash, created_at) VALUES (?, NOW())")->execute([$ipHash]);
        return $over;
    }

    /** The submitted interests, capped and cleaned. */
    private static function interestList(array $d): array
    {
        return is_array($d['interests'] ?? null)
            ? array_values(array_filter(array_map(fn ($x) => self::cap($x, 160), $d['interests'])))
            : [];
    }

    /** A human-readable intake note folded into the member/subscriber record for staff. */
    private static function intakeNote(array $interests, ?string $comments, ?string $howHeard, string $kind, ?string $availability = null): string
    {
        $lines = [ucfirst($kind) . ' via public form on ' . date('Y-m-d') . '.'];
        if ($interests)   $lines[] = 'Interested in: ' . implode('; ', $interests) . '.';
        if ($availability) $lines[] = 'Availability: ' . $availability;
        if ($howHeard)     $lines[] = 'How they heard about us: ' . $howHeard;
        if ($comments)     $lines[] = 'Comments: ' . $comments;
        return implode("\n", $lines);
    }

    /** Clear any mailing-list opt-out for this email (they asked back on). */
    private static function resubscribeEmail(PDO $pdo, string $email): void
    {
        $pdo->prepare("UPDATE email_optouts SET unsubscribed_at = NULL WHERE email = ?")->execute([strtolower(trim($email))]);
    }

    /** Point a subscriber row at the member who now owns this email, and drop it off the list. */
    private static function linkSubscriber(PDO $pdo, string $email, int $memberId): void
    {
        $pdo->prepare("UPDATE mailing_list_subscribers SET member_id = ?, unsubscribed_at = NOW(), updated_at = NOW()
                        WHERE LOWER(email) = LOWER(?) AND member_id IS NULL")
            ->execute([$memberId, $email]);
    }

    /** Record a mailing-list opt-out for this email (idempotent). */
    private static function optOut(PDO $pdo, string $email): void
    {
        $email = strtolower(trim($email));
        if ($email === '') return;
        $token = bin2hex(random_bytes(16));
        $pdo->prepare("INSERT INTO email_optouts (email, token, unsubscribed_at, created_at)
                       VALUES (?, ?, NOW(), NOW())
                       ON DUPLICATE KEY UPDATE unsubscribed_at = NOW()")
            ->execute([$email, $token]);
    }

    /** One short email to the volunteer-coordination address for each sign-up. */
    private static function notifyStaff(PDO $pdo, string $name, string $email, ?string $phone,
        array $interests, string $note, bool $existing, int $memberId): void
    {
        if (!Mailer::enabled()) return;
        // Dedicated, configurable "volunteer sign-up" address (Admin → Email Settings),
        // defaulting to the org info box.
        $to = trim(EmailSettingsController::volunteerEmail($pdo));
        if ($to === '') $to = YouthContact::infoEmail();
        if ($to === '') return;

        $esc = fn (?string $s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $appUrl = rtrim((string)Config::get('APP_URL', ''), '/');
        $rows = '<p><strong>' . $esc($name) . '</strong> signed up to volunteer'
            . ($existing ? ' (already had an account — interest noted, no new account created).' : '.') . '</p>'
            . '<ul>'
            . '<li>Email: ' . $esc($email) . '</li>'
            . ($phone ? '<li>Phone: ' . $esc($phone) . '</li>' : '')
            . ($interests ? '<li>Interested in: ' . $esc(implode('; ', $interests)) . '</li>' : '')
            . '</ul>'
            . '<pre style="white-space:pre-wrap;font:13px/1.5 system-ui">' . $esc($note) . '</pre>'
            . ($appUrl && $memberId ? '<p><a href="' . $esc($appUrl . '/members/' . $memberId) . '">Open their member record</a></p>' : '');
        $subject = 'New volunteer sign-up: ' . $name;
        try {
            Mailer::send($to, $subject, Mailer::wrap('Volunteer sign-up', $rows), strip_tags($rows));
        } catch (\Throwable $e) { /* best effort */ }
    }

    // ── Staff-facing mailing-list management ─────────────────────────────────

    /** The bulk sender's audience — anyone Mentor+ manages the list too. */
    private static function requireStaff(PDO $pdo, Request $req): ?array
    {
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) return null;
        return $cur;
    }

    private static function serializeSubscriber(array $r): array
    {
        return [
            'id'         => (int)$r['id'],
            'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
            'name'       => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: (string)$r['email'],
            'email'      => $r['email'], 'phone' => $r['phone'],
            'interests'  => $r['interests'] ? (json_decode((string)$r['interests'], true) ?: []) : [],
            'notes'      => $r['notes'], 'source' => $r['source'],
            'member_id'  => $r['member_id'] !== null ? (int)$r['member_id'] : null,
            'subscribed' => $r['unsubscribed_at'] === null,
            'created_at' => $r['created_at'],
        ];
    }

    /** GET /mailing-list/subscribers — staff view of the list. ?include_unsubscribed=1, ?search= */
    public static function listSubscribers(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::requireStaff($pdo, $req)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ['member_id IS NULL']; $args = [];   // members are managed on the roster, not here
        if (empty($q['include_unsubscribed'])) $where[] = 'unsubscribed_at IS NULL';
        if (!empty($q['search'])) {
            $where[] = '(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)';
            $like = '%' . $q['search'] . '%'; array_push($args, $like, $like, $like);
        }
        $sql = 'SELECT * FROM mailing_list_subscribers WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at DESC LIMIT 2000';
        $st = $pdo->prepare($sql); $st->execute($args);
        $rows = array_map([self::class, 'serializeSubscriber'], $st->fetchAll());
        $counts = $pdo->query("SELECT
              SUM(member_id IS NULL AND unsubscribed_at IS NULL) AS active,
              SUM(member_id IS NULL AND unsubscribed_at IS NOT NULL) AS unsubscribed
            FROM mailing_list_subscribers")->fetch() ?: [];
        return Http::json($res, [
            'subscribers' => $rows,
            'active' => (int)($counts['active'] ?? 0),
            'unsubscribed' => (int)($counts['unsubscribed'] ?? 0),
        ]);
    }

    /** PATCH /mailing-list/subscribers/{id} — { subscribed: bool } to unsubscribe/resubscribe. */
    public static function setSubscribed(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!self::requireStaff($pdo, $req)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $sub = !empty($d['subscribed']);
        $st = $pdo->prepare("UPDATE mailing_list_subscribers SET unsubscribed_at = " . ($sub ? 'NULL' : 'NOW()') . ", updated_at = NOW() WHERE id = ?");
        $st->execute([(int)$route['id']]);
        return Http::json($res, ['ok' => true, 'subscribed' => $sub]);
    }
}
