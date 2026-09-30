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
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/visitors/router.py */
final class VisitorsController
{
    private const LIFECYCLE = [
        ['new', 'New Inquiry'], ['visited', 'Visited'], ['follow_up', 'Follow-Up'],
        ['visit_scheduled', 'Visit Scheduled'],
        ['waitlisted', 'Waitlisted'], ['not_interested', 'Not Interested'], ['enrolled', 'Enrolled'],
    ];
    private const REFERRAL = [
        'word_of_mouth' => 'Word of mouth', 'google' => 'Google search',
        'magazine_ad' => 'Ad in local magazine', 'event' => 'Saw us at an event', 'other' => 'Other',
    ];

    private static function guard(PDO $pdo, Request $req, array $roles): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, $roles)) return ['err' => 403, 'detail' => 'You do not have permission to perform this action'];
        return ['member' => $m];
    }

    /**
     * Permission gate for visitor endpoints. Passes when the member has the required
     * level on `visitors.records` ('read' for views, 'write' for changes). This honors
     * the module grant set in Role Management — including a station/kiosk account that
     * was granted the Visitors module — instead of a hardcoded role name, which is why
     * a check-in station granted "Visitor Records" can now actually load and search the
     * list. Same return shape as guard().
     */
    private static function guardPerm(PDO $pdo, Request $req, string $level): array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::memberCan($pdo, $m, 'visitors.records', $level)) {
            return ['err' => 403, 'detail' => 'You do not have permission to perform this action'];
        }
        return ['member' => $m];
    }

    private static function statusLabel(string $s): string
    {
        foreach (self::LIFECYCLE as [$c, $l]) if ($c === $s) return $l;
        return $s;
    }

    private static function serialize(array $v): array
    {
        return [
            'id' => (int)$v['id'],
            'visitor_number' => $v['visitor_number'],
            'first_name' => $v['first_name'],
            'middle_name' => $v['middle_name'],
            'last_name' => $v['last_name'],
            'full_name' => $v['first_name'] . ' ' . $v['last_name'],
            'birthday' => $v['birthday'],
            'grade' => isset($v['grade']) && $v['grade'] !== null ? (int)$v['grade'] : null,
            'grade_label' => isset($v['grade']) && $v['grade'] !== null ? \App\Core\Grade::label((int)$v['grade']) : null,
            'phone' => $v['phone'],
            'email' => $v['email'],
            'address_line1' => $v['address_line1'],
            'address_line2' => $v['address_line2'],
            'city' => $v['city'],
            'state' => $v['state'],
            'zip_code' => $v['zip_code'],
            'guardian1_name' => $v['guardian1_name'],
            'guardian1_phone' => $v['guardian1_phone'],
            'guardian1_email' => $v['guardian1_email'],
            'referral_source' => $v['referral_source'],
            'referral_source_label' => self::REFERRAL[$v['referral_source'] ?? ''] ?? ($v['referral_source'] ?? ''),
            'referral_detail' => $v['referral_detail'],
            'program_interest_id' => $v['program_interest_id'] !== null ? (int)$v['program_interest_id'] : null,
            'program_interest_name' => $v['program_interest_name'] ?? null,
            'additional_info' => $v['additional_info'],
            'status' => $v['status'],
            'status_label' => self::statusLabel((string)$v['status']),
            'owner_id' => isset($v['owner_id']) && $v['owner_id'] !== null ? (int)$v['owner_id'] : null,
            'owner_name' => !empty($v['owner_name']) ? $v['owner_name'] : null,
            'next_follow_up_date' => $v['next_follow_up_date'] ?? null,
            'scheduled_visit_date' => $v['scheduled_visit_date'] ?? null,
            'school_id' => isset($v['school_id']) && $v['school_id'] !== null ? (int)$v['school_id'] : null,
            'school_name' => !empty($v['school_name']) ? $v['school_name'] : null,
            'parent_mentor_interest' => (bool)($v['parent_mentor_interest'] ?? false),
            'converted_member_id' => $v['converted_member_id'] !== null ? (int)$v['converted_member_id'] : null,
            'is_archived' => (bool)($v['is_archived'] ?? false),
            'inquiry_date' => $v['inquiry_date'],
            'created_at' => $v['created_at'],
            'updated_at' => $v['updated_at'],
        ];
    }

    private static function loadJoined(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare("SELECT v.*, p.name AS program_interest_name, sch.name AS school_name,
                                      TRIM(CONCAT(COALESCE(o.first_name,''),' ',COALESCE(o.last_name,''))) AS owner_name
                               FROM visitors v
                               LEFT JOIN programs p ON p.id = v.program_interest_id
                               LEFT JOIN members o ON o.id = v.owner_id
                               LEFT JOIN schools sch ON sch.id = v.school_id
                               WHERE v.id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    public static function statuses(Request $req, Response $res): Response
    {
        $out = array_map(fn($s) => ['code' => $s[0], 'label' => $s[1]], self::LIFECYCLE);
        return Http::json($res, $out);
    }

    public static function nextVisitorNumber(PDO $pdo): string
    {
        $used = [];
        foreach ($pdo->query("SELECT visitor_number FROM visitors")->fetchAll() as $r) {
            if ($r['visitor_number'] !== null && ctype_digit((string)$r['visitor_number'])) {
                $used[(int)$r['visitor_number']] = true;
            }
        }
        for ($n = 10000; $n < 100000; $n++) if (!isset($used[$n])) return (string)$n;
        throw new \RuntimeException('No visitor numbers available');
    }

    /** Public kiosk endpoint — no auth. */
    /** Per-IP hourly cap for ANONYMOUS public submissions (shares the public-form log). */
    private const PUBLIC_RATE_LIMIT_PER_HOUR = 12;

    private static function clientIpHash(Request $req): string
    {
        // Security #7: use the trusted-proxy-aware client IP so a forged X-Forwarded-For
        // can't hand each request a new rate-limit key.
        $ip = Http::clientIp($req) ?? '0.0.0.0';
        return hash('sha256', 'visitorform|' . $ip);
    }

    /** True if this IP is over the hourly anonymous-submission cap; records the hit otherwise. */
    private static function publicRateLimited(PDO $pdo, Request $req): bool
    {
        $ipHash = self::clientIpHash($req);
        $rl = $pdo->prepare("SELECT COUNT(id) FROM volunteer_submit_log WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 HOUR)");
        $rl->execute([$ipHash]);
        $over = (int)$rl->fetchColumn() >= self::PUBLIC_RATE_LIMIT_PER_HOUR;
        if (!$over) $pdo->prepare("INSERT INTO volunteer_submit_log (ip_hash, created_at) VALUES (?, NOW())")->execute([$ipHash]);
        return $over;
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $d = (array)$req->getParsedBody();
        $cur = Auth::currentMember($pdo, $req);
        // This endpoint doubles as an authenticated staff "Add Visitor" and an anonymous
        // public kiosk/self-signup. Apply anti-abuse controls to ANONYMOUS submissions only —
        // staff adding many visitors at a busy event from one network IP must not be limited.
        if (!$cur) {
            if (trim((string)($d['website'] ?? '')) !== '') { // honeypot: bots fill it, humans don't
                return Http::json($res, ['id' => 0, 'visitor_number' => null,
                    'name' => trim((string)($d['first_name'] ?? '') . ' ' . (string)($d['last_name'] ?? ''))], 201);
            }
            if (self::publicRateLimited($pdo, $req)) {
                return Http::error($res, 'Too many submissions from this connection. Please try again later.', 429);
            }
        }
        if (empty($d['first_name']) || empty($d['last_name'])) {
            return Http::error($res, 'first_name and last_name are required.', 422);
        }
        $cols = ['first_name', 'middle_name', 'last_name', 'birthday', 'grade', 'phone', 'email',
            'address_line1', 'address_line2', 'city', 'state', 'zip_code',
            'guardian1_name', 'guardian1_phone', 'guardian1_email',
            'referral_source', 'referral_detail', 'program_interest_id', 'additional_info', 'parent_mentor_interest',
            'scheduled_visit_date'];
        $d['parent_mentor_interest'] = (int)!empty($d['parent_mentor_interest']); // NOT NULL column
        $d['grade'] = (isset($d['grade']) && $d['grade'] !== '' && $d['grade'] !== null) ? (int)$d['grade'] : null;
        // Empty string is not a valid DATE — store NULL when no scheduled date is given.
        $d['scheduled_visit_date'] = (isset($d['scheduled_visit_date']) && $d['scheduled_visit_date'] !== '') ? substr((string)$d['scheduled_visit_date'], 0, 10) : null;
        $fields = ['visitor_number', 'status'];
        $vals = [self::nextVisitorNumber($pdo), 'new'];   // model default status = "new"
        foreach ($cols as $c) { $fields[] = $c; $vals[] = $d[$c] ?? null; }
        // Optional link to a camp camper (#141) — lets repeat visits log onto this
        // same record rather than creating duplicates. F8: this is STAFF-only and must
        // reference a real camper. An anonymous submitter must not be able to bind a
        // fabricated visitor to a real child's camp record, or enumerate valid camper ids
        // by probing this field — so it's ignored entirely for unauthenticated callers.
        $camperId = null;
        if ($cur !== null && !empty($d['camper_id'])) {
            $cid = (int)$d['camper_id'];
            $chk = $pdo->prepare("SELECT 1 FROM campers WHERE id = ?"); $chk->execute([$cid]);
            if ($chk->fetchColumn()) $camperId = $cid;
        }
        if ($camperId) { $fields[] = 'camper_id'; $vals[] = $camperId; }
        $ph = implode(',', array_fill(0, count($fields), '?'));
        $sql = "INSERT INTO visitors (" . implode(',', $fields) . ") VALUES ($ph)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($vals);
        $vid = (int)$pdo->lastInsertId();
        // For a camper walk-in, record the first visit as an interaction so the
        // "when did they visit" history starts right away.
        if ($camperId) {
            $pdo->prepare("INSERT INTO visitor_interactions (visitor_id, member_id, method, notes, occurred_at) VALUES (?,?, 'visit', 'Visited TRC (from camp record)', ?)")
                ->execute([$vid, null, date('Y-m-d')]);
        }
        Audit::write($pdo, null, 'visitors', $vid, 'create', null, $d);
        // Capture the family's meeting-night preference at the earliest touch, against the
        // program they're interested in, so it's known the moment they're waitlisted. See
        // Core\NightPrefs. Only writes when night fields were actually supplied.
        $npProgram = !empty($d['program_interest_id']) ? (int)$d['program_interest_id'] : 0;
        if ($npProgram) {
            $npFields = \App\Controllers\NightPrefsController::extractFields($d);
            if ($npFields) {
                \App\Core\NightPrefs::save($pdo, null, $vid, $npProgram, \App\Core\NightPrefs::currentSeason(),
                    $npFields, 'intake', null);
            }
        }
        $vs = $pdo->prepare("SELECT * FROM visitors WHERE id = ?"); $vs->execute([$vid]); $v = $vs->fetch();
        self::notifyVisitorSignup($pdo, $v, $d);
        return Http::json($res, [
            'id' => (int)$v['id'], 'visitor_number' => $v['visitor_number'],
            'name' => $v['first_name'] . ' ' . $v['last_name'],
        ], 201);
    }

    /** Email the admin team when a new visitor signs up. Best-effort. */
    private static function notifyVisitorSignup(PDO $pdo, array $v, array $d): void
    {
        if (!Mailer::enabled()) return;
        try {
            $to = EmailSettingsController::visitorEmail($pdo);
            $name = trim(($v['first_name'] ?? '') . ' ' . ($v['last_name'] ?? ''));
            $guardian = trim((string)($v['guardian1_name'] ?? ''));
            $contact = array_filter([
                'Email' => $v['email'] ?? null,
                'Phone' => $v['phone'] ?? null,
                'Guardian' => $guardian ?: null,
                'Guardian phone' => $v['guardian1_phone'] ?? null,
                'Guardian email' => $v['guardian1_email'] ?? null,
            ]);
            $url = rtrim((string)(\App\Core\Config::get('APP_URL', '') ?? ''), '/') . '/visitors/' . $v['id'];
            $rows = '';
            foreach ($contact as $k => $val) $rows .= "<li><strong>{$k}:</strong> " . htmlspecialchars((string)$val) . "</li>";
            if (!empty($v['additional_info'])) $rows .= "<li><strong>Notes:</strong> " . htmlspecialchars((string)$v['additional_info']) . "</li>";
            $subject = "New visitor signup: " . ($name ?: 'A visitor');
            $body = "<p>A new visitor signed up through the website form.</p>"
                . "<ul><li><strong>Name:</strong> " . htmlspecialchars($name ?: '—') . " (#" . htmlspecialchars((string)$v['visitor_number']) . ")</li>"
                . $rows . "</ul>"
                . "<p>Open their record" . ($url ? ": <a href=\"{$url}\">{$url}</a>" : "."). "</p>";
            Mailer::send($to, $subject, Mailer::wrap('New Visitor Signup', $body), strip_tags($body));
        } catch (\Throwable $e) { /* a notification failure must not block the public signup */ }
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "read")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['search'])) {
            $where[] = "(v.first_name LIKE ? OR v.last_name LIKE ? OR v.email LIKE ? OR v.guardian1_name LIKE ? OR v.visitor_number LIKE ?)";
            $s = '%' . $q['search'] . '%'; array_push($args, $s, $s, $s, $s, $s);
        }
        if (!empty($q['status'])) { $where[] = "v.status = ?"; $args[] = $q['status']; }
        // Converted visitors (now members) drop off the working list — their records
        // are kept for conversion-rate tracking, not deleted. Only include_converted=1
        // brings them back. This used to also switch off whenever a status filter was
        // set, so clicking any status pill silently re-listed people who are already
        // members.
        $includeConverted = filter_var($q['include_converted'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if (!$includeConverted) {
            $where[] = "v.converted_member_id IS NULL";
        }
        // Archived visitors are hidden from the list/search by default. archived_only=1 returns
        // just them (to find one to un-archive); include_archived=1 shows both.
        if (filter_var($q['archived_only'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $where[] = "v.is_archived = 1";
        } elseif (!filter_var($q['include_archived'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $where[] = "v.is_archived = 0";
        }
        if (!empty($q['program_interest_id'])) { $where[] = "v.program_interest_id = ?"; $args[] = (int)$q['program_interest_id']; }
        if (!empty($q['school_id'])) { $where[] = "v.school_id = ?"; $args[] = (int)$q['school_id']; }
        if (isset($q['age_min']) && $q['age_min'] !== '') { $where[] = "(v.birthday IS NOT NULL AND TIMESTAMPDIFF(YEAR, v.birthday, CURDATE()) >= ?)"; $args[] = (int)$q['age_min']; }
        if (isset($q['age_max']) && $q['age_max'] !== '') { $where[] = "(v.birthday IS NOT NULL AND TIMESTAMPDIFF(YEAR, v.birthday, CURDATE()) <= ?)"; $args[] = (int)$q['age_max']; }
        // Scheduled/expected-visitor filter (#177): scheduled=1 (any), or a date window.
        $scheduledView = filter_var($q['scheduled'] ?? false, FILTER_VALIDATE_BOOLEAN)
            || !empty($q['scheduled_from']) || !empty($q['scheduled_to']);
        if ($scheduledView) $where[] = "v.scheduled_visit_date IS NOT NULL";
        if (!empty($q['scheduled_from'])) { $where[] = "v.scheduled_visit_date >= ?"; $args[] = substr((string)$q['scheduled_from'], 0, 10); }
        if (!empty($q['scheduled_to']))   { $where[] = "v.scheduled_visit_date <= ?"; $args[] = substr((string)$q['scheduled_to'], 0, 10); }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $c = $pdo->prepare("SELECT count(*) AS c FROM visitors v $clause"); $c->execute($args);
        $total = (int)$c->fetch()['c'];
        $skip = max(0, (int)($q['skip'] ?? 0)); $limit = min(500, max(1, (int)($q['limit'] ?? 100)));
        // In the scheduled view, order by the expected date (soonest first) instead of inquiry date.
        $order = $scheduledView ? "v.scheduled_visit_date ASC, v.last_name, v.first_name" : "v.inquiry_date DESC";
        $stmt = $pdo->prepare("SELECT v.*, p.name AS program_interest_name FROM visitors v
                               LEFT JOIN programs p ON p.id = v.program_interest_id $clause
                               ORDER BY $order LIMIT $limit OFFSET $skip");
        $stmt->execute($args);
        return Http::json($res, ['total' => $total, 'visitors' => array_map([self::class, 'serialize'], $stmt->fetchAll())]);
    }

    /**
     * GET /visitors/campers/search?q= — find camp campers by name so a walk-in
     * visit can be documented without re-entering their info (#141). Returns each
     * camper's prefill fields, a camp label, and the id/number of an existing
     * visitor record already linked to them (so repeat visits reuse it).
     */
    public static function searchCampers(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "read")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $q = trim((string)($req->getQueryParams()['q'] ?? ''));
        if (mb_strlen($q) < 2) return Http::json($res, ['campers' => []]);
        $like = '%' . $q . '%';
        // Most-recent camp session per camper for a friendly label; guardian pulled
        // from the linked camp contact; existing linked visitor for de-dup.
        $sql = "SELECT c.id, c.first_name, c.last_name, c.grade, c.school, c.age_band,
                       ct.name AS guardian_name, ct.email AS guardian_email, ct.phone AS guardian_phone,
                       v.id AS existing_visitor_id, v.visitor_number AS existing_visitor_number,
                       (SELECT MAX(cs.year) FROM camp_registrations cr
                          JOIN camp_sessions se ON se.id = cr.session_id
                          JOIN camp_seasons cs ON cs.id = se.season_id
                         WHERE cr.camper_id = c.id) AS last_camp_year
                  FROM campers c
                  LEFT JOIN camp_contacts ct ON ct.id = c.contact_id
                  LEFT JOIN visitors v ON v.camper_id = c.id
                 WHERE CONCAT(COALESCE(c.first_name,''),' ',COALESCE(c.last_name,'')) LIKE ?
                    OR c.last_name LIKE ?
                 ORDER BY c.last_name, c.first_name
                 LIMIT 25";
        $st = $pdo->prepare($sql);
        $st->execute([$like, $like]);
        $out = array_map(fn($r) => [
            'camper_id' => (int)$r['id'],
            'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
            'grade' => $r['grade'], 'school' => $r['school'], 'age_band' => $r['age_band'],
            'guardian_name' => $r['guardian_name'], 'guardian_email' => $r['guardian_email'], 'guardian_phone' => $r['guardian_phone'],
            'last_camp_year' => $r['last_camp_year'] !== null ? (string)$r['last_camp_year'] : null,
            'existing_visitor_id' => $r['existing_visitor_id'] !== null ? (int)$r['existing_visitor_id'] : null,
            'existing_visitor_number' => $r['existing_visitor_number'] ?? null,
        ], $st->fetchAll());
        return Http::json($res, ['campers' => $out]);
    }

    public static function stats(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "read")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        // Counts drive the status pills above the visitor list, so they must count the
        // same rows the list shows — i.e. exclude converted visitors. (The recruiting
        // analytics funnel deliberately still counts everyone, converted included.)
        $rows = $pdo->query("SELECT status, count(*) AS c FROM visitors
                             WHERE converted_member_id IS NULL AND is_archived = 0 GROUP BY status")->fetchAll();
        $out = [];
        foreach ($rows as $r) $out[$r['status']] = (int)$r['c'];
        return Http::json($res, $out);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "read")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $v = self::loadJoined($pdo, (int)$route['visitor_id']);
        if (!$v) return Http::error($res, 'Visitor not found', 404);
        $is = $pdo->prepare("SELECT vi.*, TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS member_name
                             FROM visitor_interactions vi LEFT JOIN members m ON m.id = vi.member_id
                             WHERE vi.visitor_id = ? ORDER BY COALESCE(vi.occurred_at, vi.created_at) DESC, vi.id DESC");
        $is->execute([(int)$v['id']]);
        $interactions = array_map(fn($r) => [
            'id' => (int)$r['id'], 'method' => $r['method'], 'notes' => $r['notes'],
            'occurred_at' => $r['occurred_at'], 'member_name' => !empty($r['member_name']) ? $r['member_name'] : null,
        ], $is->fetchAll());
        return Http::json($res, self::serialize($v) + ['interactions' => $interactions]);
    }

    /** POST /visitors/{id}/email — send an email to the visitor's guardian, with optional CC (#168). */
    public static function sendEmail(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $vid = (int)$route['visitor_id'];
        $vs = $pdo->prepare("SELECT * FROM visitors WHERE id = ?"); $vs->execute([$vid]);
        $v = $vs->fetch();
        if (!$v) return Http::error($res, 'Visitor not found', 404);

        $d = (array)$req->getParsedBody();
        $subject = trim((string)($d['subject'] ?? ''));
        $body = (string)($d['body'] ?? '');
        if ($subject === '' || trim($body) === '') return Http::error($res, 'A subject and message are required.', 422);

        $to = trim((string)($v['guardian1_email'] ?: ($v['email'] ?? '')));
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return Http::error($res, 'This visitor has no valid email address on file.', 422);
        }
        // CC: accept an array or a comma-separated string; keep only valid, de-duplicated addresses.
        $ccRaw = $d['cc'] ?? [];
        $ccList = is_array($ccRaw) ? $ccRaw : explode(',', (string)$ccRaw);
        $cc = [];
        foreach ($ccList as $addr) {
            $addr = trim((string)$addr);
            if ($addr !== '' && filter_var($addr, FILTER_VALIDATE_EMAIL) && strcasecmp($addr, $to) !== 0) $cc[strtolower($addr)] = $addr;
        }
        $cc = array_values($cc);

        $html = Mailer::wrap($subject, '<p>' . nl2br(htmlspecialchars($body)) . '</p>');
        // Mailer::send()'s $cc is a comma-separated string, not an array.
        $ok = Mailer::send($to, $subject, $html, $body, $cc ? implode(',', $cc) : null);
        if (!$ok) return Http::error($res, 'The email could not be sent: ' . (Mailer::lastError() ?? 'unknown error'), 502);

        // Log it as an email interaction so it shows in the visitor's history.
        $note = 'Email sent: "' . $subject . '"' . ($cc ? ' (cc: ' . implode(', ', $cc) . ')' : '');
        $pdo->prepare("INSERT INTO visitor_interactions (visitor_id, member_id, method, notes, occurred_at) VALUES (?,?,?,?,?)")
            ->execute([$vid, $actor ? (int)$actor['id'] : null, 'email', $note, date('Y-m-d')]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitor_interactions', (int)$pdo->lastInsertId(), 'create', null, ['visitor_id' => $vid, 'email_to' => $to, 'cc' => $cc]);
        return self::get($req, $res, ['visitor_id' => $vid]);
    }

    /** POST /visitors/{id}/interactions — log a call/email/visit. */
    public static function addInteraction(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $vid = (int)$route['visitor_id'];
        $ex = $pdo->prepare("SELECT 1 FROM visitors WHERE id = ?"); $ex->execute([$vid]);
        if (!$ex->fetch()) return Http::error($res, 'Visitor not found', 404);
        $d = (array)$req->getParsedBody();
        $pdo->prepare("INSERT INTO visitor_interactions (visitor_id, member_id, method, notes, occurred_at) VALUES (?,?,?,?,?)")
            ->execute([$vid, $actor ? (int)$actor['id'] : null, $d['method'] ?? null, $d['notes'] ?? null,
                !empty($d['occurred_at']) ? substr((string)$d['occurred_at'], 0, 10) : date('Y-m-d')]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitor_interactions', $newId, 'create', null, ['visitor_id' => $vid]);
        return self::get($req, $res, ['visitor_id' => $vid]);
    }

    /**
     * POST /visitors/{id}/followup-done — mark the assigned follow-up complete. Records a
     * "Follow-up completed" entry in the contact log and clears the next-follow-up date so
     * the visitor drops off the pending-follow-ups list and stops the reminder emails. The
     * owner and pipeline status are left as-is (the person just did the outreach).
     */
    public static function completeFollowup(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $vid = (int)$route['visitor_id'];
        $ex = $pdo->prepare("SELECT id FROM visitors WHERE id = ?"); $ex->execute([$vid]);
        if (!$ex->fetch()) return Http::error($res, 'Visitor not found', 404);
        $d = (array)$req->getParsedBody();
        $note = trim((string)($d['notes'] ?? ''));
        $logNote = 'Follow-up completed' . ($note !== '' ? ' — ' . $note : '');
        // Record the completion in the contact history…
        $pdo->prepare("INSERT INTO visitor_interactions (visitor_id, member_id, method, notes, occurred_at) VALUES (?,?,?,?,?)")
            ->execute([$vid, $actor ? (int)$actor['id'] : null, 'follow_up', $logNote, date('Y-m-d')]);
        // …then clear the pending follow-up so it leaves the list and reminders stop.
        $pdo->prepare("UPDATE visitors SET next_follow_up_date = NULL, follow_up_reminded_at = NULL WHERE id = ?")->execute([$vid]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitors', $vid, 'followup_done', null, ['notes' => $note]);
        return self::get($req, $res, ['visitor_id' => $vid]);
    }

    /** POST /visitors/{id}/archive — hide a visitor from the list/search, counts and reminders. */
    public static function archive(Request $req, Response $res, array $route): Response
    {
        return self::setArchived($req, $res, $route, true);
    }

    /** POST /visitors/{id}/unarchive — restore an archived visitor to the working list. */
    public static function unarchive(Request $req, Response $res, array $route): Response
    {
        return self::setArchived($req, $res, $route, false);
    }

    private static function setArchived(Request $req, Response $res, array $route, bool $archived): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $vid = (int)$route['visitor_id'];
        $ex = $pdo->prepare("SELECT id FROM visitors WHERE id = ?"); $ex->execute([$vid]);
        if (!$ex->fetch()) return Http::error($res, 'Visitor not found', 404);
        $actorId = $actor ? (int)$actor['id'] : null;
        $pdo->prepare("UPDATE visitors SET is_archived = ?, archived_at = ?, archived_by_id = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$archived ? 1 : 0, $archived ? date('Y-m-d H:i:s') : null, $archived ? $actorId : null, $vid]);
        Audit::write($pdo, $actorId, 'visitors', $vid, $archived ? 'archive' : 'unarchive', null, null);
        return self::get($req, $res, ['visitor_id' => $vid]);
    }

    /**
     * POST /visitors/{id}/visited — one-click "Mark visited today". Logs a dated
     * in-person interaction (so there's a durable record of the visit and who logged it)
     * and advances the pipeline to "Visited" — but only from an earlier, uncommitted
     * stage (New Inquiry / Visit Scheduled). It never regresses a further-along visitor
     * (Follow-Up / Waitlisted), disturbs an Enrolled family, or reopens a Not-Interested
     * record; for those the visit is still logged, the status is left as-is.
     */
    public static function markVisitedToday(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $vid = (int)$route['visitor_id'];
        $st = $pdo->prepare("SELECT id, status FROM visitors WHERE id = ?"); $st->execute([$vid]);
        $v = $st->fetch();
        if (!$v) return Http::error($res, 'Visitor not found', 404);

        $d = (array)$req->getParsedBody();
        $note = trim((string)($d['notes'] ?? ''));
        if ($note === '') $note = 'Visited';
        $pdo->prepare("INSERT INTO visitor_interactions (visitor_id, member_id, method, notes, occurred_at) VALUES (?,?,?,?,?)")
            ->execute([$vid, $actor ? (int)$actor['id'] : null, 'in_person', $note, date('Y-m-d')]);
        if (in_array($v['status'], ['new', 'visit_scheduled'], true)) {
            $pdo->prepare("UPDATE visitors SET status = 'visited', updated_at = NOW() WHERE id = ?")->execute([$vid]);
        }
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitors', $vid, 'marked_visited', null, ['date' => date('Y-m-d')]);
        return self::get($req, $res, ['visitor_id' => $vid]);
    }

    public static function deleteInteraction(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $iid = (int)$route['interaction_id'];
        $s = $pdo->prepare("SELECT visitor_id FROM visitor_interactions WHERE id = ?"); $s->execute([$iid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Not found', 404);
        $pdo->prepare("DELETE FROM visitor_interactions WHERE id = ?")->execute([$iid]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitor_interactions', $iid, 'delete', null, null);
        return self::get($req, $res, ['visitor_id' => (int)$r['visitor_id']]);
    }

    /** DELETE /visitors/{id} — permanently delete a visitor. System Administrator only. */
    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        // Empty role list = System Administrator (super) only.
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Only a System Administrator can delete a contact.', 403);
        $id = (int)$route['visitor_id'];
        $ex = $pdo->prepare("SELECT 1 FROM visitors WHERE id = ?"); $ex->execute([$id]);
        if (!$ex->fetch()) return Http::error($res, 'Visitor not found', 404);
        // Remove waitlist entries first (their FK only nulls the link), then the
        // visitor (interactions cascade; mentor_prospects.from_visitor_id nulls).
        $pdo->prepare("DELETE FROM waitlist_entries WHERE visitor_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM visitors WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'visitors', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /visitors/analytics — recruiting funnel + conversion by source/school/program. */
    public static function analytics(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "read")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }

        $funnel = [];
        foreach ($pdo->query("SELECT status, COUNT(*) AS n FROM visitors GROUP BY status")->fetchAll() as $r) $funnel[$r['status']] = (int)$r['n'];
        $total = array_sum($funnel);
        $enrolled = $funnel['enrolled'] ?? 0;

        $bySource = array_map(fn($r) => [
            'source' => $r['referral_source'] ?: '(unspecified)',
            'label' => self::REFERRAL[$r['referral_source'] ?? ''] ?? ($r['referral_source'] ?: '(unspecified)'),
            'count' => (int)$r['c'], 'enrolled' => (int)$r['e'],
        ], $pdo->query("SELECT referral_source, COUNT(*) c, SUM(status='enrolled') e FROM visitors GROUP BY referral_source ORDER BY c DESC")->fetchAll());

        $bySchool = array_map(fn($r) => ['school_id' => (int)$r['school_id'], 'school' => $r['name'], 'count' => (int)$r['c'], 'enrolled' => (int)$r['e']],
            $pdo->query("SELECT v.school_id, s.name, COUNT(*) c, SUM(v.status='enrolled') e
                         FROM visitors v JOIN schools s ON s.id = v.school_id
                         GROUP BY v.school_id, s.name ORDER BY c DESC")->fetchAll());

        $byProgram = array_map(fn($r) => ['program' => $r['name'] ?: '(none)', 'count' => (int)$r['c'], 'enrolled' => (int)$r['e']],
            $pdo->query("SELECT p.name, COUNT(*) c, SUM(v.status='enrolled') e
                         FROM visitors v LEFT JOIN programs p ON p.id = v.program_interest_id
                         GROUP BY v.program_interest_id, p.name ORDER BY c DESC")->fetchAll());

        $byMonth = array_map(fn($r) => ['month' => $r['m'], 'count' => (int)$r['c']],
            array_reverse($pdo->query("SELECT DATE_FORMAT(inquiry_date,'%Y-%m') m, COUNT(*) c
                         FROM visitors WHERE inquiry_date IS NOT NULL GROUP BY m ORDER BY m DESC LIMIT 12")->fetchAll()));

        return Http::json($res, [
            'total_inquiries' => $total, 'enrolled' => $enrolled,
            'conversion_rate' => $total > 0 ? round($enrolled / $total * 100, 1) : 0.0,
            'funnel' => $funnel, 'by_source' => $bySource, 'by_school' => $bySchool,
            'by_program' => $byProgram, 'by_month' => $byMonth,
        ]);
    }

    /** GET /visitors/followups — prospects with a follow-up date set (dashboard). */
    public static function followups(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "read")) { if (isset($g['err'])) return Http::json($res, []); }
        $s = $pdo->query("SELECT v.id, v.first_name, v.last_name, v.status, v.next_follow_up_date,
                                 TRIM(CONCAT(COALESCE(o.first_name,''),' ',COALESCE(o.last_name,''))) AS owner_name
                          FROM visitors v LEFT JOIN members o ON o.id = v.owner_id
                          WHERE v.next_follow_up_date IS NOT NULL
                            AND v.is_archived = 0
                            AND v.status NOT IN ('enrolled','not_interested')
                          ORDER BY v.next_follow_up_date LIMIT 25");
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'name' => trim("{$r['first_name']} {$r['last_name']}"), 'status' => $r['status'],
            'next_follow_up_date' => $r['next_follow_up_date'], 'owner_name' => !empty($r['owner_name']) ? $r['owner_name'] : null,
        ], $s->fetchAll()));
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guardPerm($pdo, $req, "write")) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $id = (int)$route['visitor_id'];
        $prev = $pdo->prepare("SELECT owner_id, next_follow_up_date FROM visitors WHERE id = ?"); $prev->execute([$id]);
        $before = $prev->fetch();
        if (!$before) return Http::error($res, 'Visitor not found', 404);
        $d = (array)$req->getParsedBody();
        $allowed = ['status', 'additional_info', 'phone', 'email', 'guardian1_name', 'guardian1_phone', 'guardian1_email', 'program_interest_id',
            'first_name', 'middle_name', 'last_name', 'birthday', 'grade', 'address_line1', 'address_line2', 'city', 'state', 'zip_code'];
        $set = []; $args = [];
        foreach ($allowed as $f) if (array_key_exists($f, $d) && $d[$f] !== null) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        // Owner and next-follow-up accept null to clear the assignment/date.
        if (array_key_exists('owner_id', $d)) { $set[] = 'owner_id = ?'; $args[] = ($d['owner_id'] === null || $d['owner_id'] === '') ? null : (int)$d['owner_id']; }
        if (array_key_exists('next_follow_up_date', $d)) { $set[] = 'next_follow_up_date = ?'; $args[] = ($d['next_follow_up_date'] === null || $d['next_follow_up_date'] === '') ? null : substr((string)$d['next_follow_up_date'], 0, 10); }
        if (array_key_exists('scheduled_visit_date', $d)) { $set[] = 'scheduled_visit_date = ?'; $args[] = ($d['scheduled_visit_date'] === null || $d['scheduled_visit_date'] === '') ? null : substr((string)$d['scheduled_visit_date'], 0, 10); }
        if (array_key_exists('school_id', $d)) { $set[] = 'school_id = ?'; $args[] = ($d['school_id'] === null || $d['school_id'] === '') ? null : (int)$d['school_id']; }
        if (array_key_exists('parent_mentor_interest', $d)) { $set[] = 'parent_mentor_interest = ?'; $args[] = (int)!empty($d['parent_mentor_interest']); }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE visitors SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
            Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitors', $id, 'update', null, $d); }

        // Notify the owner when a follow-up assignment (owner + date) is newly made or changed.
        $newOwner = array_key_exists('owner_id', $d) ? (($d['owner_id'] === null || $d['owner_id'] === '') ? null : (int)$d['owner_id']) : ($before['owner_id'] !== null ? (int)$before['owner_id'] : null);
        $newDate  = array_key_exists('next_follow_up_date', $d) ? (($d['next_follow_up_date'] === null || $d['next_follow_up_date'] === '') ? null : substr((string)$d['next_follow_up_date'], 0, 10)) : ($before['next_follow_up_date'] ?? null);
        $changed  = (array_key_exists('owner_id', $d) && $newOwner !== ($before['owner_id'] !== null ? (int)$before['owner_id'] : null))
                 || (array_key_exists('next_follow_up_date', $d) && $newDate !== ($before['next_follow_up_date'] ?? null));
        if ($changed && $newOwner !== null && $newDate !== null) {
            // A re-notify means we should remind again if it comes due, so clear the reminder stamp.
            $pdo->prepare("UPDATE visitors SET follow_up_reminded_at = NULL WHERE id = ?")->execute([$id]);
            self::notifyFollowupOwner($pdo, $id, $newOwner);
        }
        return Http::json($res, self::serialize(self::loadJoined($pdo, $id)));
    }

    /** Email a follow-up owner that they've been assigned a prospect (best-effort). */
    private static function notifyFollowupOwner(PDO $pdo, int $visitorId, int $ownerId): void
    {
        if (!Mailer::enabled()) return;
        $q = $pdo->prepare("SELECT v.first_name, v.last_name, v.next_follow_up_date,
                                   o.email AS owner_email, o.first_name AS owner_first
                              FROM visitors v JOIN members o ON o.id = ?
                             WHERE v.id = ?");
        $q->execute([$ownerId, $visitorId]);
        $r = $q->fetch();
        if (!$r) return;
        $to = trim((string)$r['owner_email']);
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return;
        $visitor = trim($r['first_name'] . ' ' . $r['last_name']);
        $date = $r['next_follow_up_date'] ? date('l, M j', strtotime((string)$r['next_follow_up_date'])) : null;
        $body = '<p>Hi' . ($r['owner_first'] ? ' ' . htmlspecialchars((string)$r['owner_first']) : '') . ',</p>'
              . '<p>You\'ve been assigned to follow up with prospective member <strong>' . htmlspecialchars($visitor) . '</strong>'
              . ($date ? ' by <strong>' . htmlspecialchars($date) . '</strong>' : '') . '.</p>';
        $appUrl = rtrim((string)Config::get('APP_URL', ''), '/');
        if ($appUrl) $body .= "<p><a href='{$appUrl}/visitors' style='color:#1565c0'>Open the Visitors list &rarr;</a></p>";
        try { Mailer::send($to, 'Follow-up assigned: ' . $visitor, Mailer::wrap('Prospect follow-up', $body), strip_tags($body)); }
        catch (\Throwable $e) { /* best effort */ }
    }

    /**
     * Email follow-up owners about prospects due today or overdue that haven't been reminded in the
     * last few days, then stamp follow_up_reminded_at. Called by the cron (bin/run_visitor_followup_
     * reminders.php) and the "send now" endpoint. Skips enrolled / not-interested / converted.
     */
    public static function sendFollowupReminders(PDO $pdo): array
    {
        if (!Mailer::enabled()) return ['sent' => 0];
        $rows = $pdo->query(
            "SELECT v.id, v.first_name, v.last_name, v.next_follow_up_date,
                    o.email AS owner_email, o.first_name AS owner_first
               FROM visitors v JOIN members o ON o.id = v.owner_id
              WHERE v.next_follow_up_date IS NOT NULL
                AND v.next_follow_up_date <= CURDATE()
                AND v.status NOT IN ('enrolled', 'not_interested')
                AND v.converted_member_id IS NULL
                AND v.is_archived = 0
                AND (v.follow_up_reminded_at IS NULL OR v.follow_up_reminded_at <= DATE_SUB(CURDATE(), INTERVAL 3 DAY))")
            ->fetchAll();
        $appUrl = rtrim((string)Config::get('APP_URL', ''), '/');
        $sent = 0;
        $mark = $pdo->prepare("UPDATE visitors SET follow_up_reminded_at = CURDATE() WHERE id = ?");
        foreach ($rows as $r) {
            $to = trim((string)$r['owner_email']);
            if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) continue;
            $visitor = trim($r['first_name'] . ' ' . $r['last_name']);
            $date = date('M j', strtotime((string)$r['next_follow_up_date']));
            $overdue = $r['next_follow_up_date'] < date('Y-m-d');
            $body = '<p>Reminder: your follow-up with prospective member <strong>' . htmlspecialchars($visitor) . '</strong> '
                  . ($overdue ? 'was due on <strong>' . htmlspecialchars($date) . '</strong> and is now overdue' : 'is due <strong>today (' . htmlspecialchars($date) . ')</strong>') . '.</p>';
            if ($appUrl) $body .= "<p><a href='{$appUrl}/visitors' style='color:#1565c0'>Open the Visitors list &rarr;</a></p>";
            $subject = ($overdue ? 'Overdue follow-up: ' : 'Follow-up due today: ') . $visitor;
            if (Mailer::send($to, $subject, Mailer::wrap('Prospect follow-up reminder', $body), strip_tags($body))) { $mark->execute([(int)$r['id']]); $sent++; }
        }
        return ['sent' => $sent];
    }

    /** POST /visitors/followups/send-reminders — a staff member triggers the reminder run now. */
    public static function sendFollowupRemindersNow(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req, ['Mentor'])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $r = self::sendFollowupReminders($pdo);
        return Http::json($res, ['ok' => true] + $r);
    }

    /**
     * GET /visitors/duplicate-members — unconverted visitors who appear to already be a
     * member (matched on email, or on name + birthday). Powers the bulk "merge duplicates"
     * cleanup after an import that created both a visitor and a member for the same person.
     */
    public static function duplicateMembers(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req, [])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $rows = $pdo->query(
            "SELECT v.id AS visitor_id, v.visitor_number,
                    TRIM(CONCAT(v.first_name,' ',v.last_name)) AS visitor_name, v.email AS visitor_email,
                    m.id AS member_id, m.member_number,
                    TRIM(CONCAT(m.first_name,' ',m.last_name)) AS member_name, m.member_type,
                    CASE WHEN v.email <> '' AND LOWER(v.email) = LOWER(m.email) THEN 'email' ELSE 'name + birthday' END AS matched_on
             FROM visitors v
             JOIN members m ON (
                    (v.email <> '' AND LOWER(v.email) = LOWER(m.email))
                 OR (LOWER(v.first_name) = LOWER(m.first_name) AND LOWER(v.last_name) = LOWER(m.last_name)
                     AND v.birthday IS NOT NULL AND m.birthday IS NOT NULL AND v.birthday = m.birthday)
                 )
             WHERE v.converted_member_id IS NULL
             GROUP BY v.id, m.id
             ORDER BY v.last_name, v.first_name"
        )->fetchAll(PDO::FETCH_ASSOC);
        $out = array_map(fn($r) => [
            'visitor_id' => (int)$r['visitor_id'], 'visitor_number' => $r['visitor_number'],
            'visitor_name' => $r['visitor_name'], 'visitor_email' => $r['visitor_email'],
            'member_id' => (int)$r['member_id'], 'member_number' => $r['member_number'],
            'member_name' => $r['member_name'], 'member_type' => $r['member_type'],
            'matched_on' => $r['matched_on'],
        ], $rows);
        return Http::json($res, ['total' => count($out), 'matches' => $out]);
    }

    /**
     * GET /visitors/duplicate-visitors — pairs of unconverted visitors that look like the
     * same person (matched by email, or name + birthday), for visitor↔visitor merge cleanup.
     */
    public static function duplicateVisitors(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req, [])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $rows = $pdo->query(
            "SELECT v1.id AS keep_id, v1.visitor_number AS keep_number,
                    TRIM(CONCAT(v1.first_name,' ',v1.last_name)) AS keep_name, v1.email AS keep_email,
                    v2.id AS dup_id, v2.visitor_number AS dup_number,
                    TRIM(CONCAT(v2.first_name,' ',v2.last_name)) AS dup_name, v2.email AS dup_email,
                    CASE
                      WHEN v1.email <> '' AND LOWER(v1.email) = LOWER(v2.email) THEN 'email'
                      WHEN v1.birthday IS NOT NULL AND v2.birthday IS NOT NULL AND v1.birthday = v2.birthday THEN 'name + birthday'
                      ELSE 'name + guardian email'
                    END AS matched_on
             FROM visitors v1
             JOIN visitors v2 ON v1.id < v2.id AND (
                    (v1.email <> '' AND LOWER(v1.email) = LOWER(v2.email))
                 OR (LOWER(v1.first_name) = LOWER(v2.first_name) AND LOWER(v1.last_name) = LOWER(v2.last_name)
                     AND (
                          (v1.birthday IS NOT NULL AND v2.birthday IS NOT NULL AND v1.birthday = v2.birthday)
                          -- Same name + same family (guardian) email, even with no birthday on file.
                          -- Name is required too, so siblings sharing a guardian email are NOT flagged.
                       OR (v1.guardian1_email <> '' AND LOWER(v1.guardian1_email) = LOWER(v2.guardian1_email))
                     ))
                 )
             WHERE v1.converted_member_id IS NULL AND v2.converted_member_id IS NULL
             ORDER BY v1.last_name, v1.first_name, v1.id"
        )->fetchAll(PDO::FETCH_ASSOC);
        $out = array_map(fn($r) => [
            'keep_id' => (int)$r['keep_id'], 'keep_number' => $r['keep_number'], 'keep_name' => $r['keep_name'], 'keep_email' => $r['keep_email'],
            'dup_id' => (int)$r['dup_id'], 'dup_number' => $r['dup_number'], 'dup_name' => $r['dup_name'], 'dup_email' => $r['dup_email'],
            'matched_on' => $r['matched_on'],
        ], $rows);
        return Http::json($res, ['total' => count($out), 'pairs' => $out]);
    }

    /**
     * POST /visitors/{visitor_id}/merge-visitor { into } — merge this visitor (the duplicate)
     * INTO the survivor. Moves interactions, waitlist entries, and night preferences to the
     * survivor (skipping ones the survivor already has for a program+season), fills the
     * survivor's blank fields from the duplicate, then deletes the duplicate row.
     */
    public static function mergeVisitor(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req, [])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $loser = (int)$route['visitor_id'];
        $survivor = (int)(((array)$req->getParsedBody())['into'] ?? 0);
        if (!$survivor || $survivor === $loser) return Http::error($res, 'A different survivor visitor (into) is required.', 422);
        $chk = $pdo->prepare("SELECT converted_member_id FROM visitors WHERE id = ?");
        $chk->execute([$loser]); $lRow = $chk->fetch();
        $chk->execute([$survivor]); $sRow = $chk->fetch();
        if (!$lRow || !$sRow) return Http::error($res, 'Visitor not found.', 404);
        if ($lRow['converted_member_id'] || $sRow['converted_member_id']) return Http::error($res, 'Converted visitors cannot be merged.', 400);

        // Interactions always move (no uniqueness to worry about).
        $pdo->prepare("UPDATE visitor_interactions SET visitor_id = ? WHERE visitor_id = ?")->execute([$survivor, $loser]);

        // Waitlist + night prefs move unless the survivor already has one for that program+season.
        foreach (['waitlist_entries', 'night_preferences'] as $tbl) {
            $rows = $pdo->prepare("SELECT id, program_id, season FROM $tbl WHERE visitor_id = ?");
            $rows->execute([$loser]);
            foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $dup = $pdo->prepare("SELECT 1 FROM $tbl WHERE visitor_id = ? AND program_id = ? AND season = ?");
                $dup->execute([$survivor, $r['program_id'], $r['season']]);
                if ($dup->fetchColumn()) {
                    $pdo->prepare("DELETE FROM $tbl WHERE id = ?")->execute([(int)$r['id']]);
                } else {
                    $pdo->prepare("UPDATE $tbl SET visitor_id = ? WHERE id = ?")->execute([$survivor, (int)$r['id']]);
                }
            }
        }

        // Fill the survivor's blank contact fields from the duplicate (non-destructive).
        $fields = ['birthday', 'phone', 'email', 'address_line1', 'address_line2', 'city', 'state', 'zip_code',
                   'guardian1_name', 'guardian1_phone', 'guardian1_email', 'referral_source', 'referral_detail',
                   'program_interest_id', 'additional_info', 'school_id'];
        $cols = implode(',', $fields);
        $lv = $pdo->prepare("SELECT $cols FROM visitors WHERE id = ?"); $lv->execute([$loser]); $l = $lv->fetch(PDO::FETCH_ASSOC) ?: [];
        $sv = $pdo->prepare("SELECT $cols FROM visitors WHERE id = ?"); $sv->execute([$survivor]); $sd = $sv->fetch(PDO::FETCH_ASSOC) ?: [];
        $set = []; $args = [];
        foreach ($fields as $f) {
            if (trim((string)($sd[$f] ?? '')) === '' && trim((string)($l[$f] ?? '')) !== '') { $set[] = "$f = ?"; $args[] = $l[$f]; }
        }
        if ($set) { $args[] = $survivor; $pdo->prepare("UPDATE visitors SET " . implode(', ', $set) . " WHERE id = ?")->execute($args); }

        // Remove the duplicate. Interactions were already moved off it.
        $pdo->prepare("DELETE FROM visitors WHERE id = ?")->execute([$loser]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitors', $loser, 'merge_visitor', null, ['into' => $survivor]);
        return Http::json($res, ['ok' => true, 'survivor_id' => $survivor]);
    }

    public static function prefill(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req, [])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $stmt = $pdo->prepare("SELECT * FROM visitors WHERE id = ?"); $stmt->execute([(int)$route['visitor_id']]);
        $v = $stmt->fetch();
        if (!$v) return Http::error($res, 'Visitor not found', 404);
        return Http::json($res, [
            'visitor_id' => (int)$v['id'], 'first_name' => $v['first_name'], 'middle_name' => $v['middle_name'],
            'last_name' => $v['last_name'], 'birthday' => $v['birthday'], 'email' => $v['email'], 'phone' => $v['phone'],
            'address_line1' => $v['address_line1'], 'address_line2' => $v['address_line2'], 'city' => $v['city'],
            'state' => $v['state'], 'zip_code' => $v['zip_code'], 'guardian1_name' => $v['guardian1_name'],
            'guardian1_phone' => $v['guardian1_phone'], 'guardian1_email' => $v['guardian1_email'],
            'additional_info' => $v['additional_info'] ?? null,
            'program_interest_id' => $v['program_interest_id'] !== null ? (int)$v['program_interest_id'] : null,
        ]);
    }

    public static function convert(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req, [])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $actor = $g['member'] ?? null;
        $id = (int)$route['visitor_id'];
        $d = (array)$req->getParsedBody();
        $stmt = $pdo->prepare("SELECT visitor_number FROM visitors WHERE id = ?"); $stmt->execute([$id]);
        $v = $stmt->fetch();
        if (!$v) return Http::error($res, 'Visitor not found', 404);
        $newMemberId = (int)($d['member_id'] ?? 0);
        $pdo->prepare("UPDATE visitors SET status='enrolled', converted_member_id=? WHERE id=?")
            ->execute([$newMemberId, $id]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'visitors', $id, 'update', null, ['status' => 'enrolled', 'converted_member_id' => $newMemberId]);
        if ($newMemberId) {
            // The night preference they gave as a visitor follows them onto the member record.
            \App\Core\NightPrefs::carryVisitorToMember($pdo, $id, $newMemberId);
            // Any waitlist entry filed under the visitor now also points at the member, so
            // it isn't orphaned once they have a real member record. Converting IS taking
            // the spot, so the entry is marked accepted — otherwise the enrolled member
            // keeps showing as still waiting on the list.
            $pdo->prepare("UPDATE waitlist_entries SET member_id = ?, status = 'accepted', responded_at = NOW() WHERE visitor_id = ? AND (member_id IS NULL OR member_id = 0)")
                ->execute([$newMemberId, $id]);
            self::backfillMemberFromVisitor($pdo, $id, $newMemberId);
        }
        return Http::json($res, ['ok' => true, 'visitor_number' => $v['visitor_number']]);
    }

    /**
     * Merge a visitor's contact details onto the member, but ONLY into fields the member
     * has left blank — never overwrite existing member data. Used both when creating a new
     * member from a visitor (no-op, the member already has the data) and when merging a
     * visitor into an EXISTING member (fills the gaps). Handled in PHP (not SQL COALESCE)
     * so the DATE `birthday` column doesn't hit a strict-mode compare-to-'' error.
     */
    private static function backfillMemberFromVisitor(PDO $pdo, int $visitorId, int $memberId): void
    {
        $fields = ['birthday', 'phone', 'email', 'address_line1', 'address_line2', 'city',
                   'state', 'zip_code', 'guardian1_name', 'guardian1_phone', 'guardian1_email'];
        $cols = implode(',', $fields);
        $vs = $pdo->prepare("SELECT $cols FROM visitors WHERE id = ?"); $vs->execute([$visitorId]);
        $v = $vs->fetch(PDO::FETCH_ASSOC); if (!$v) return;
        $ms = $pdo->prepare("SELECT $cols FROM members WHERE id = ?"); $ms->execute([$memberId]);
        $m = $ms->fetch(PDO::FETCH_ASSOC); if (!$m) return;

        $set = []; $args = [];
        foreach ($fields as $f) {
            $mv = trim((string)($m[$f] ?? ''));
            $vv = trim((string)($v[$f] ?? ''));
            if ($mv === '' && $vv !== '') { $set[] = "$f = ?"; $args[] = $vv; }
        }
        if ($set) {
            $args[] = $memberId;
            $pdo->prepare("UPDATE members SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        }
    }
}
