<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * College Scholarship Module. A manager-maintained catalog of outside scholarships
 * youth apply to for college, with per-season lifecycle tracking. Youth browse a
 * board, see "you may be eligible" flags from their profile, follow scholarships to
 * be alerted when the window opens, and mark themselves as applied; managers record
 * outcomes and run reports. Distinct from the Sponsors module's sponsor-funded
 * scholarships (those are TRC awarding money to youth).
 */
final class CollegeScholarshipsController
{
    private const STATUSES = ['interested', 'applied', 'granted', 'partial', 'declined', 'no_decision'];

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        if ($m === null) return false;
        // The scholarships.manage permission lets an admin grant scholarship
        // management to any role (e.g. a "Scholarship Manager" role given to a
        // parent). Existing mentor/admin roles keep access via the role check.
        return Permissions::memberCan($pdo, $m, 'scholarships.manage', 'write')
            || Permissions::hasAnyRole($pdo, $m, ['Mentor', 'Admin', 'System Administrator', 'Executive Director']);
    }

    private static function csv(?string $s): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string)$s))));
    }

    /** Does this youth's profile satisfy the scholarship's structured eligibility? */
    private static function eligibleFor(array $s, array $member): bool
    {
        // College scholarships are for youth members. Mentors/parents/volunteers
        // can browse the board (see board()) but are never flagged eligible and
        // get no alerts. This is what filters out adults beyond college age.
        if (($member['member_type'] ?? '') !== 'youth') return false;

        $gy = $member['graduation_year'] ?? null;
        if ($s['elig_grad_year_min'] !== null && ($gy === null || (int)$gy < (int)$s['elig_grad_year_min'])) return false;
        if ($s['elig_grad_year_max'] !== null && ($gy === null || (int)$gy > (int)$s['elig_grad_year_max'])) return false;

        // Durable grade-band gate: e.g. "seniors only" (12..12) stays correct
        // every season because it is compared to the youth's CURRENT grade,
        // computed from their graduation year. Blank on either side = no bound.
        $classMin = $s['elig_class_min'] ?? null;
        $classMax = $s['elig_class_max'] ?? null;
        if ($classMin !== null || $classMax !== null) {
            $grade = self::currentGrade($member);
            if ($grade === null) return false;                       // no grad year on file -> can't confirm grade
            if ($classMin !== null && $grade < (int)$classMin) return false;
            if ($classMax !== null && $grade > (int)$classMax) return false;
        }

        if (!empty($s['elig_sex']) && strcasecmp((string)($member['sex'] ?? ''), (string)$s['elig_sex']) !== 0) return false;
        if (!empty($s['elig_races'])) {
            $races = array_map('strtolower', self::csv($s['elig_races']));
            if (!in_array(strtolower((string)($member['race'] ?? '')), $races, true)) return false;
        }
        return true;
    }

    /**
     * The youth's current U.S. grade level (typically 9-12) derived from
     * graduation_year. The school year is treated as flipping in July, so a
     * rising senior counts as grade 12 from July onward. Returns null when no
     * graduation year is on file; may return <9 (middle school) or >12 (already
     * in college) which naturally excludes them from grade-banded scholarships.
     */
    private static function currentGrade(array $member): ?int
    {
        $gy = $member['graduation_year'] ?? null;
        if ($gy === null || $gy === '') return null;
        $now = new \DateTime('now');
        $year = (int)$now->format('Y');
        $month = (int)$now->format('n');
        $seniorGradYear = $month >= 7 ? $year + 1 : $year; // seniors graduate the following spring
        return 12 - ((int)$gy - $seniorGradYear);
    }

    private static function isOpen(array $s, string $today): bool
    {
        if (!$s['is_active']) return false;
        if (!empty($s['open_date']) && $today < $s['open_date']) return false;
        if (!empty($s['close_date']) && $today > $s['close_date']) return false;
        return true;
    }

    private static function serialize(array $s): array
    {
        return [
            'id' => (int)$s['id'], 'name' => $s['name'], 'provider' => $s['provider'], 'info_url' => $s['info_url'],
            'description' => $s['description'],
            'amount_min' => $s['amount_min'] !== null ? (float)$s['amount_min'] : null,
            'amount_max' => $s['amount_max'] !== null ? (float)$s['amount_max'] : null,
            'renewable' => (bool)$s['renewable'], 'season' => $s['season'],
            'renewable_years' => isset($s['renewable_years']) && $s['renewable_years'] !== null ? (int)$s['renewable_years'] : null,
            'renewable_annual_amount' => isset($s['renewable_annual_amount']) && $s['renewable_annual_amount'] !== null ? (float)$s['renewable_annual_amount'] : null,
            'open_date' => $s['open_date'], 'close_date' => $s['close_date'], 'is_active' => (bool)$s['is_active'],
            'elig_grad_year_min' => $s['elig_grad_year_min'] !== null ? (int)$s['elig_grad_year_min'] : null,
            'elig_grad_year_max' => $s['elig_grad_year_max'] !== null ? (int)$s['elig_grad_year_max'] : null,
            'elig_class_min' => isset($s['elig_class_min']) && $s['elig_class_min'] !== null ? (int)$s['elig_class_min'] : null,
            'elig_class_max' => isset($s['elig_class_max']) && $s['elig_class_max'] !== null ? (int)$s['elig_class_max'] : null,
            'elig_sex' => $s['elig_sex'], 'elig_races' => $s['elig_races'], 'elig_states' => $s['elig_states'],
            'elig_min_gpa' => $s['elig_min_gpa'] !== null ? (float)$s['elig_min_gpa'] : null,
            'elig_tags' => $s['elig_tags'], 'elig_notes' => $s['elig_notes'],
        ];
    }

    private static function today(): string { return (new \DateTime('now'))->format('Y-m-d'); }

    /** Flatten a joined application row (application + scholarship, optionally + member) for the API. */
    private static function serializeApp(array $a): array
    {
        return [
            'id' => (int)$a['id'], 'scholarship_id' => (int)$a['scholarship_id'],
            'scholarship_name' => $a['scholarship_name'] ?? null, 'provider' => $a['provider'] ?? null,
            'info_url' => $a['info_url'] ?? null,
            'member_id' => (int)$a['member_id'], 'member_name' => $a['member_name'] ?? null,
            'season' => $a['season'], 'status' => $a['status'],
            'amount_min' => isset($a['amount_min']) && $a['amount_min'] !== null ? (float)$a['amount_min'] : null,
            'amount_max' => isset($a['amount_max']) && $a['amount_max'] !== null ? (float)$a['amount_max'] : null,
            'renewable' => isset($a['renewable']) ? (bool)$a['renewable'] : null,
            'renewable_years' => isset($a['renewable_years']) && $a['renewable_years'] !== null ? (int)$a['renewable_years'] : null,
            'renewable_annual_amount' => isset($a['renewable_annual_amount']) && $a['renewable_annual_amount'] !== null ? (float)$a['renewable_annual_amount'] : null,
            'amount_awarded' => $a['amount_awarded'] !== null ? (float)$a['amount_awarded'] : null,
            'youth_award_response' => $a['youth_award_response'] ?? null,
            'target_college' => $a['target_college'] ?? null,
            'thank_you_sent' => isset($a['thank_you_sent']) ? (bool)$a['thank_you_sent'] : false,
            'thank_you_date' => $a['thank_you_date'] ?? null,
            'applied_date' => $a['applied_date'], 'decision_date' => $a['decision_date'], 'notes' => $a['notes'],
        ];
    }

    // ── Youth / reader board ─────────────────────────────────────────────────

    /** GET /college-scholarships?season=&search=&only=eligible|following|open
     *  Active scholarships with the current member's follow/apply/eligibility state. */
    public static function board(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $where = ['is_active = 1']; $args = [];
        if (!empty($q['season'])) { $where[] = 'season = ?'; $args[] = $q['season']; }
        if (!empty($q['search'])) { $where[] = '(name LIKE ? OR provider LIKE ?)'; $args[] = '%' . $q['search'] . '%'; $args[] = '%' . $q['search'] . '%'; }
        $rows = $pdo->prepare("SELECT * FROM college_scholarships WHERE " . implode(' AND ', $where) . " ORDER BY (close_date IS NULL), close_date ASC, name");
        $rows->execute($args);
        $rows = $rows->fetchAll();

        $follows = self::followSet($pdo, (int)$m['id']);
        $apps = self::appMap($pdo, (int)$m['id']);
        $dismissed = self::dismissedSet($pdo, (int)$m['id']);
        $today = self::today();
        $out = [];
        foreach ($rows as $s) {
            $item = self::serialize($s);
            $item['following'] = isset($follows[(int)$s['id']]);
            $item['my_status'] = $apps[(int)$s['id']] ?? null;
            $item['eligible'] = self::eligibleFor($s, $m);
            $item['is_open'] = self::isOpen($s, $today);
            $item['dismissed'] = isset($dismissed[(int)$s['id']]);
            $item['dismiss_reason'] = $dismissed[(int)$s['id']] ?? null;
            $out[] = $item;
        }
        // Optional client-driven filters
        $only = $q['only'] ?? '';
        // The "Not eligible" view shows only dismissed ones (to review/undo);
        // every other view hides dismissed scholarships so they stop cluttering it.
        if ($only === 'dismissed') {
            $out = array_values(array_filter($out, fn($x) => $x['dismissed']));
        } else {
            $out = array_values(array_filter($out, fn($x) => !$x['dismissed']));
        }
        if ($only === 'eligible')  $out = array_values(array_filter($out, fn($x) => $x['eligible']));
        if ($only === 'following') $out = array_values(array_filter($out, fn($x) => $x['following']));
        if ($only === 'open')      $out = array_values(array_filter($out, fn($x) => $x['is_open']));
        return Http::json($res, $out);
    }

    /** GET /college-scholarships/stats — catalog-wide totals for the board header. */
    public static function stats(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        // Total value uses each scholarship's max award (falling back to min).
        $row = $pdo->query(
            "SELECT COUNT(*) AS n,
                    COALESCE(SUM(COALESCE(amount_max, amount_min, 0)), 0) AS total_value,
                    COALESCE(SUM(CASE WHEN renewable = 1 THEN 1 ELSE 0 END), 0) AS renewable_count
             FROM college_scholarships WHERE is_active = 1"
        )->fetch();
        return Http::json($res, [
            'count' => (int)$row['n'],
            'total_value' => (float)$row['total_value'],
            'renewable_count' => (int)$row['renewable_count'],
        ]);
    }

    /** GET /college-scholarships/alerts — open scholarships I follow or am eligible for and haven't applied to. Powers the dashboard nudge. */
    public static function alerts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT * FROM college_scholarships WHERE is_active = 1")->fetchAll();
        $follows = self::followSet($pdo, (int)$m['id']);
        $apps = self::appMap($pdo, (int)$m['id']);
        $dismissed = self::dismissedSet($pdo, (int)$m['id']);
        $today = self::today();
        $out = [];
        foreach ($rows as $s) {
            if (isset($dismissed[(int)$s['id']])) continue;
            if (!self::isOpen($s, $today)) continue;
            $applied = ($apps[(int)$s['id']] ?? null) !== null && $apps[(int)$s['id']] !== 'interested';
            if ($applied) continue;
            $following = isset($follows[(int)$s['id']]);
            $eligible = self::eligibleFor($s, $m);
            if (!$following && !$eligible) continue;
            $item = self::serialize($s);
            $item['following'] = $following; $item['eligible'] = $eligible;
            $out[] = $item;
        }
        return Http::json($res, $out);
    }

    private static function followSet(PDO $pdo, int $memberId): array
    {
        $st = $pdo->prepare("SELECT scholarship_id FROM college_scholarship_follows WHERE member_id = ?");
        $st->execute([$memberId]);
        $set = [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) $set[(int)$id] = true;
        return $set;
    }

    /** scholarship_id => reason ('not_eligible' | 'not_applying'). isset() still works for exclusion checks. */
    private static function dismissedSet(PDO $pdo, int $memberId): array
    {
        $st = $pdo->prepare("SELECT scholarship_id, reason FROM college_scholarship_dismissed WHERE member_id = ?");
        $st->execute([$memberId]);
        $set = [];
        foreach ($st->fetchAll() as $r) $set[(int)$r['scholarship_id']] = $r['reason'] ?? 'not_eligible';
        return $set;
    }

    private static function appMap(PDO $pdo, int $memberId): array
    {
        $st = $pdo->prepare("SELECT scholarship_id, status FROM college_scholarship_applications WHERE member_id = ?");
        $st->execute([$memberId]);
        $map = [];
        foreach ($st->fetchAll() as $r) $map[(int)$r['scholarship_id']] = $r['status'];
        return $map;
    }

    public static function follow(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $sid = (int)$route['id'];
        $pdo->prepare("INSERT IGNORE INTO college_scholarship_follows (scholarship_id, member_id, created_by_id, created_at) VALUES (?,?,?,NOW())")
            ->execute([$sid, (int)$m['id'], (int)$m['id']]);
        return Http::json($res, ['following' => true]);
    }

    public static function unfollow(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $pdo->prepare("DELETE FROM college_scholarship_follows WHERE scholarship_id = ? AND member_id = ?")
            ->execute([(int)$route['id'], (int)$m['id']]);
        return Http::json($res, ['following' => false]);
    }

    /** POST /college-scholarships/{id}/dismiss {reason?} — hide a scholarship. reason = not_eligible | not_applying. */
    public static function dismiss(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $reason = in_array($d['reason'] ?? '', ['not_eligible', 'not_applying'], true) ? $d['reason'] : 'not_eligible';
        $pdo->prepare("INSERT INTO college_scholarship_dismissed (scholarship_id, member_id, reason, created_at) VALUES (?,?,?,NOW())
                       ON DUPLICATE KEY UPDATE reason = VALUES(reason)")
            ->execute([(int)$route['id'], (int)$m['id'], $reason]);
        return Http::json($res, ['dismissed' => true, 'reason' => $reason]);
    }

    /** DELETE /college-scholarships/{id}/dismiss — undo a "not for me". */
    public static function undismiss(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $pdo->prepare("DELETE FROM college_scholarship_dismissed WHERE scholarship_id = ? AND member_id = ?")
            ->execute([(int)$route['id'], (int)$m['id']]);
        return Http::json($res, ['dismissed' => false]);
    }

    /** POST /college-scholarships/{id}/apply {status?} — youth marks interested/applied. */
    public static function apply(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $sid = (int)$route['id'];
        $sch = self::load($pdo, $sid);
        if (!$sch) return Http::error($res, 'Scholarship not found', 404);
        $d = (array)$req->getParsedBody();
        $status = in_array($d['status'] ?? 'applied', ['interested', 'applied'], true) ? $d['status'] : 'applied';
        $season = $sch['season'];
        $appliedDate = $status === 'applied' ? self::today() : null;
        $pdo->prepare(
            "INSERT INTO college_scholarship_applications (scholarship_id, member_id, season, status, applied_date, created_by_id, updated_by_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,NOW(),NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status),
                applied_date = COALESCE(college_scholarship_applications.applied_date, VALUES(applied_date)),
                updated_by_id = VALUES(updated_by_id), updated_at = NOW()"
        )->execute([$sid, (int)$m['id'], $season, $status, $appliedDate, (int)$m['id'], (int)$m['id']]);
        return Http::json($res, ['status' => $status]);
    }

    /** DELETE /college-scholarships/{id}/apply — youth withdraws their own interest/application (pre-decision). */
    public static function withdraw(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $pdo->prepare("DELETE FROM college_scholarship_applications WHERE scholarship_id = ? AND member_id = ? AND status IN ('interested','applied')")
            ->execute([(int)$route['id'], (int)$m['id']]);
        return Http::json($res, ['ok' => true]);
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $st = $pdo->prepare("SELECT * FROM college_scholarships WHERE id = ?");
        $st->execute([$id]);
        return $st->fetch() ?: null;
    }

    // ── Manager (Mentor/Admin) ───────────────────────────────────────────────

    /** GET /college-scholarships/manage — full catalog incl. inactive + counts. */
    public static function manageList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM college_scholarships ORDER BY (close_date IS NULL), close_date DESC, name")->fetchAll();
        $counts = $pdo->query(
            "SELECT s.id,
                (SELECT COUNT(*) FROM college_scholarship_follows f WHERE f.scholarship_id = s.id) AS followers,
                (SELECT COUNT(*) FROM college_scholarship_applications a WHERE a.scholarship_id = s.id AND a.status <> 'interested') AS applicants
             FROM college_scholarships s"
        )->fetchAll(PDO::FETCH_UNIQUE);
        $out = [];
        foreach ($rows as $s) {
            $item = self::serialize($s);
            $item['followers'] = (int)($counts[(int)$s['id']]['followers'] ?? 0);
            $item['applicants'] = (int)($counts[(int)$s['id']]['applicants'] ?? 0);
            $out[] = $item;
        }
        return Http::json($res, $out);
    }

    private const FIELDS = [
        'name', 'provider', 'info_url', 'description', 'amount_min', 'amount_max', 'renewable',
        'renewable_years', 'renewable_annual_amount', 'season',
        'open_date', 'close_date', 'is_active', 'elig_grad_year_min', 'elig_grad_year_max',
        'elig_class_min', 'elig_class_max', 'elig_sex',
        'elig_races', 'elig_states', 'elig_min_gpa', 'elig_tags', 'elig_notes',
    ];

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty(trim((string)($d['name'] ?? '')))) return Http::error($res, 'Name is required.', 422);
        $cols = []; $ph = []; $args = [];
        foreach (self::FIELDS as $f) { $cols[] = $f; $ph[] = '?'; $args[] = self::normField($f, $d[$f] ?? null); }
        $cols[] = 'created_by_id'; $ph[] = '?'; $args[] = (int)$m['id'];
        $cols[] = 'updated_by_id'; $ph[] = '?'; $args[] = (int)$m['id'];
        $cols[] = 'created_at'; $ph[] = 'NOW()';
        $cols[] = 'updated_at'; $ph[] = 'NOW()';
        $pdo->prepare("INSERT INTO college_scholarships (" . implode(',', $cols) . ") VALUES (" . implode(',', $ph) . ")")->execute($args);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'college_scholarships', $id, 'create', null, ['name' => $d['name']]);
        return Http::json($res, self::serialize(self::load($pdo, $id)), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::FIELDS as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::normField($f, $d[$f]); }
        }
        if (!$set) return Http::error($res, 'Nothing to update.', 422);
        $set[] = 'updated_by_id = ?'; $args[] = (int)$m['id'];
        $set[] = 'updated_at = NOW()';
        $args[] = $id;
        $pdo->prepare("UPDATE college_scholarships SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'college_scholarships', $id, 'update', null, null);
        $s = self::load($pdo, $id);
        if (!$s) return Http::error($res, 'Scholarship not found', 404);
        return Http::json($res, self::serialize($s));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $pdo->prepare("DELETE FROM college_scholarships WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'college_scholarships', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** Normalize a form value for its column (empty string → null for optional fields). */
    private static function normField(string $f, $v)
    {
        if ($f === 'is_active' || $f === 'renewable') return (int)(bool)$v;
        if (in_array($f, ['amount_min', 'amount_max', 'elig_min_gpa', 'elig_grad_year_min', 'elig_grad_year_max',
                          'elig_class_min', 'elig_class_max', 'renewable_years', 'renewable_annual_amount'], true)) {
            return ($v === '' || $v === null) ? null : $v;
        }
        $v = is_string($v) ? trim($v) : $v;
        return ($v === '' ? null : $v);
    }

    // ── Applications & reporting ─────────────────────────────────────────────

    /** GET /college-scholarships/applications?season=&status=&scholarship_id=&member_id= — manager report. */
    public static function report(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ['1=1']; $args = [];
        if (!empty($q['season'])) { $where[] = 'a.season = ?'; $args[] = $q['season']; }
        if (!empty($q['status'])) { $where[] = 'a.status = ?'; $args[] = $q['status']; }
        if (!empty($q['scholarship_id'])) { $where[] = 'a.scholarship_id = ?'; $args[] = (int)$q['scholarship_id']; }
        if (!empty($q['member_id'])) { $where[] = 'a.member_id = ?'; $args[] = (int)$q['member_id']; }
        $st = $pdo->prepare(
            "SELECT a.*, s.name AS scholarship_name, s.provider, s.info_url,
                    s.amount_min, s.amount_max, s.renewable, s.renewable_years, s.renewable_annual_amount,
                    TRIM(CONCAT(COALESCE(mem.first_name,''),' ',COALESCE(mem.last_name,''))) AS member_name
             FROM college_scholarship_applications a
             JOIN college_scholarships s ON s.id = a.scholarship_id
             JOIN members mem ON mem.id = a.member_id
             WHERE " . implode(' AND ', $where) . "
             ORDER BY s.name, member_name"
        );
        $st->execute($args);
        return Http::json($res, array_map([self::class, 'serializeApp'], $st->fetchAll()));
    }

    /** GET /college-scholarships/my-applications — the current member's own applications + a dollars-won rollup. Powers the youth profile panel. */
    public static function myApplications(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::applicationsForMember($pdo, (int)$m['id']));
    }

    /** GET /college-scholarships/members/{id}/applications — manager view of one youth's applications. */
    public static function memberApplications(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::applicationsForMember($pdo, (int)$route['id']));
    }

    /** The youth themselves, a manager, or an adult guardian in the youth's family. */
    private static function canActForYouth(PDO $pdo, ?array $m, int $youthId): bool
    {
        if (!$m) return false;
        if ((int)$m['id'] === $youthId) return true;
        if (self::canManage($pdo, $m)) return true;
        return MembersController::isFamilyParentOf($pdo, $m, $youthId);
    }

    /**
     * GET /college-scholarships/members/{id}/tracker — the self-contained College
     * Prep tracker for one youth: their applications (+checklists), their watchlist
     * (followed but not yet applied), and eligible/open scholarships to consider.
     * Computed for the target youth, so it's correct whoever is viewing (self,
     * guardian, or manager).
     */
    public static function tracker(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $youthId = (int)$route['id'];
        if (!self::canActForYouth($pdo, $m, $youthId)) return Http::error($res, 'Access denied', 403);
        $ys = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ys->execute([$youthId]);
        $youth = $ys->fetch();
        if (!$youth) return Http::error($res, 'Member not found', 404);

        $base = self::applicationsForMember($pdo, $youthId);
        $follows = self::followSet($pdo, $youthId);
        $apps = self::appMap($pdo, $youthId);
        $today = self::today();
        $appliedStatus = fn($sid) => ($apps[$sid] ?? null) !== null && $apps[$sid] !== 'interested';

        // Watchlist = scholarships the youth follows but hasn't applied to yet.
        // Carry the tagging note + who suggested it (when a mentor tagged them).
        $followMeta = [];
        $fm = $pdo->prepare("SELECT f.scholarship_id, f.suggested_note, f.created_by_id,
                                    TRIM(CONCAT(COALESCE(mb.first_name,''),' ',COALESCE(mb.last_name,''))) AS tagger
                             FROM college_scholarship_follows f
                             LEFT JOIN members mb ON mb.id = f.created_by_id
                             WHERE f.member_id = ?");
        $fm->execute([$youthId]);
        foreach ($fm->fetchAll() as $r) $followMeta[(int)$r['scholarship_id']] = $r;
        $watch = [];
        if ($follows) {
            $in = implode(',', array_fill(0, count($follows), '?'));
            $st = $pdo->prepare("SELECT * FROM college_scholarships WHERE id IN ($in) AND is_active = 1 ORDER BY (close_date IS NULL), close_date, name");
            $st->execute(array_keys($follows));
            foreach ($st->fetchAll() as $s) {
                $sid2 = (int)$s['id'];
                if ($appliedStatus($sid2)) continue;
                $item = self::serialize($s);
                $item['following'] = true;
                $item['my_status'] = $apps[$sid2] ?? null;
                $item['eligible'] = self::eligibleFor($s, $youth);
                $item['is_open'] = self::isOpen($s, $today);
                $meta = $followMeta[$sid2] ?? null;
                $item['suggested_note'] = $meta['suggested_note'] ?? null;
                // Only surface a "suggested by" when someone OTHER than the youth added it.
                $item['suggested_by'] = ($meta && (int)$meta['created_by_id'] !== $youthId && $meta['tagger'] !== '') ? $meta['tagger'] : null;
                $watch[] = $item;
            }
        }
        // Discovery: open scholarships the youth is eligible for, not already tracked
        // and not dismissed as "not for me".
        $dismissed = self::dismissedSet($pdo, $youthId);
        $eligibleOpen = [];
        foreach ($pdo->query("SELECT * FROM college_scholarships WHERE is_active = 1")->fetchAll() as $s) {
            $sid = (int)$s['id'];
            if (isset($follows[$sid]) || $appliedStatus($sid) || isset($dismissed[$sid])) continue;
            if (!self::isOpen($s, $today) || !self::eligibleFor($s, $youth)) continue;
            $item = self::serialize($s);
            $item['following'] = false; $item['my_status'] = $apps[$sid] ?? null;
            $item['eligible'] = true; $item['is_open'] = true;
            $eligibleOpen[] = $item;
            if (count($eligibleOpen) >= 12) break;
        }

        return Http::json($res, [
            'member_id' => $youthId,
            'is_self' => (int)$m['id'] === $youthId,
            'can_manage' => self::canManage($pdo, $m),
            'summary' => $base['summary'],
            'applications' => $base['applications'],
            'watchlist' => $watch,
            'eligible_open' => $eligibleOpen,
        ]);
    }

    /** POST /college-scholarships/members/{id}/follow/{sid} — add to a youth's watchlist. */
    public static function memberFollow(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $youthId = (int)$route['id'];
        if (!self::canActForYouth($pdo, $m, $youthId)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("INSERT IGNORE INTO college_scholarship_follows (scholarship_id, member_id, created_by_id, created_at) VALUES (?,?,?,NOW())")
            ->execute([(int)$route['sid'], $youthId, (int)$m['id']]);
        return Http::json($res, ['following' => true]);
    }

    /** DELETE /college-scholarships/members/{id}/follow/{sid} — remove from a youth's watchlist. */
    public static function memberUnfollow(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $youthId = (int)$route['id'];
        if (!self::canActForYouth($pdo, $m, $youthId)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM college_scholarship_follows WHERE scholarship_id = ? AND member_id = ?")
            ->execute([(int)$route['sid'], $youthId]);
        return Http::json($res, ['following' => false]);
    }

    /** POST /college-scholarships/members/{id}/apply/{sid} {status?} — mark a youth interested/applied. */
    public static function memberApply(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $youthId = (int)$route['id'];
        if (!self::canActForYouth($pdo, $m, $youthId)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['sid'];
        $sch = self::load($pdo, $sid);
        if (!$sch) return Http::error($res, 'Scholarship not found', 404);
        $d = (array)$req->getParsedBody();
        $status = in_array($d['status'] ?? 'applied', ['interested', 'applied'], true) ? $d['status'] : 'applied';
        $appliedDate = $status === 'applied' ? self::today() : null;
        $pdo->prepare(
            "INSERT INTO college_scholarship_applications (scholarship_id, member_id, season, status, applied_date, created_by_id, updated_by_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,NOW(),NOW())
             ON DUPLICATE KEY UPDATE status = VALUES(status),
                applied_date = COALESCE(college_scholarship_applications.applied_date, VALUES(applied_date)),
                updated_by_id = VALUES(updated_by_id), updated_at = NOW()"
        )->execute([$sid, $youthId, $sch['season'], $status, $appliedDate, (int)$m['id'], (int)$m['id']]);
        return Http::json($res, ['status' => $status]);
    }

    /** DELETE /college-scholarships/members/{id}/apply/{sid} — withdraw a youth's pre-decision application. */
    public static function memberWithdraw(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $youthId = (int)$route['id'];
        if (!self::canActForYouth($pdo, $m, $youthId)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM college_scholarship_applications WHERE scholarship_id = ? AND member_id = ? AND status IN ('interested','applied')")
            ->execute([(int)$route['sid'], $youthId]);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /college-scholarships/{id}/tag {member_ids:[], note?, notify?} — a mentor
     * tags one or more youth onto this scholarship. It lands on each youth's
     * Watchlist (with the note), and, when notify is set, emails the youth.
     */
    public static function tagYouth(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['id'];
        $sch = self::load($pdo, $sid);
        if (!$sch) return Http::error($res, 'Scholarship not found', 404);
        $d = (array)$req->getParsedBody();
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['member_ids'] ?? [])))));
        if (!$ids) return Http::error($res, 'Pick at least one youth to tag.', 422);
        $note = trim((string)($d['note'] ?? ''));
        $note = $note !== '' ? mb_substr($note, 0, 1000) : null;
        $notify = filter_var($d['notify'] ?? false, FILTER_VALIDATE_BOOLEAN);

        // Tag any youth (incl. alumni / recently graduated — they keep member_type
        // 'youth'); silently skip non-youth ids.
        $in = implode(',', array_fill(0, count($ids), '?'));
        $ys = $pdo->prepare("SELECT id, first_name, last_name, email FROM members WHERE id IN ($in) AND member_type = 'youth'");
        $ys->execute($ids);
        $youth = $ys->fetchAll();

        $up = $pdo->prepare(
            "INSERT INTO college_scholarship_follows (scholarship_id, member_id, created_by_id, suggested_note, created_at)
             VALUES (?,?,?,?,NOW())
             ON DUPLICATE KEY UPDATE created_by_id = VALUES(created_by_id), suggested_note = VALUES(suggested_note)"
        );
        $tagged = 0; $emailed = 0; $contacted = [];
        $mentorName = trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')) ?: 'A TRC mentor';
        $replyTo = !empty($m['email']) ? (string)$m['email'] : null;
        foreach ($youth as $y) {
            $up->execute([$sid, (int)$y['id'], (int)$m['id'], $note]);
            $tagged++;
            if ($notify && !empty($y['email']) && Mailer::enabled()) {
                if (self::sendTagEmail($y, $sch, $mentorName, $note, $replyTo)) {
                    $emailed++;
                    $contacted[] = ['name' => trim(($y['first_name'] ?? '') . ' ' . ($y['last_name'] ?? '')), 'email' => (string)$y['email']];
                }
            }
        }
        // These emails go straight to the youth — one youth-safety notice for the batch.
        \App\Core\YouthContact::notify($mentorName, "A scholarship for you: {$sch['name']}", $contacted);
        Audit::write($pdo, (int)$m['id'], 'college_scholarships', $sid, 'tag_youth', null, ['tagged' => $tagged, 'emailed' => $emailed]);
        return Http::json($res, ['tagged' => $tagged, 'emailed' => $emailed, 'skipped' => count($ids) - count($youth)]);
    }

    private static function sendTagEmail(array $youth, array $sch, string $mentorName, ?string $note, ?string $replyTo): bool
    {
        $name = htmlspecialchars($youth['first_name'] ?: 'there', ENT_QUOTES);
        $schName = htmlspecialchars($sch['name'], ENT_QUOTES);
        $bits = [];
        if (!empty($sch['provider']))   $bits[] = 'Provider: ' . htmlspecialchars($sch['provider'], ENT_QUOTES);
        if (!empty($sch['close_date'])) $bits[] = 'Deadline: ' . htmlspecialchars($sch['close_date'], ENT_QUOTES);
        if ($sch['amount_min'] !== null || $sch['amount_max'] !== null) {
            $lo = $sch['amount_min'] ?? $sch['amount_max']; $hi = $sch['amount_max'] ?? $sch['amount_min'];
            $bits[] = 'Award: $' . number_format((float)$lo) . ((float)$hi !== (float)$lo ? '–$' . number_format((float)$hi) : '');
        }
        $meta = $bits ? '<p style="color:#555;font-size:14px">' . implode(' &nbsp;·&nbsp; ', $bits) . '</p>' : '';
        $noteHtml = $note ? '<p style="font-size:15px;line-height:1.5;background:#f5f2fb;border-left:3px solid #7e57c2;padding:10px 14px;border-radius:4px">'
            . nl2br(htmlspecialchars($note, ENT_QUOTES)) . '</p>' : '';
        $link = !empty($sch['info_url'])
            ? '<p><a href="' . htmlspecialchars($sch['info_url'], ENT_QUOTES) . '" style="color:#1565c0">View the scholarship &amp; how to apply →</a></p>' : '';
        $body = "<p>Hi {$name},</p>"
            . "<p><strong>{$mentorName}</strong> added a scholarship to your Watchlist in TRCMS:</p>"
            . "<h3 style=\"margin:6px 0;color:#1a3a5c\">{$schName}</h3>"
            . $meta . $noteHtml . $link
            . "<p style=\"color:#555;font-size:14px\">It's saved on your <strong>College/Vo-Tech Prep</strong> tab under Watchlist — open TRCMS to see it and mark when you apply.</p>";
        return Mailer::send((string)$youth['email'], "A scholarship for you: {$sch['name']}", Mailer::wrap('A Scholarship for You', $body), null, null, $replyTo);
    }

    /** One youth's applications (with scholarship detail + checklists) plus a summary rollup. */
    private static function applicationsForMember(PDO $pdo, int $memberId): array
    {
        $st = $pdo->prepare(
            "SELECT a.*, s.name AS scholarship_name, s.provider, s.info_url,
                    s.amount_min, s.amount_max, s.renewable, s.renewable_years, s.renewable_annual_amount
             FROM college_scholarship_applications a
             JOIN college_scholarships s ON s.id = a.scholarship_id
             WHERE a.member_id = ?
             ORDER BY (a.decision_date IS NULL), a.decision_date DESC, s.name"
        );
        $st->execute([$memberId]);
        $rows = array_map([self::class, 'serializeApp'], $st->fetchAll());
        $reqs = self::requirementsByApp($pdo, array_map(fn($r) => $r['id'], $rows));
        foreach ($rows as &$r) { $r['requirements'] = $reqs[$r['id']] ?? []; }
        unset($r);
        // Dollars-won rollup: count a win only when granted/partial and not declined by the youth.
        $applied = 0; $won = 0; $totalWon = 0.0;
        foreach ($rows as $r) {
            if ($r['status'] !== 'interested') $applied++;
            $isWin = in_array($r['status'], ['granted', 'partial'], true) && $r['youth_award_response'] !== 'declined';
            if ($isWin) { $won++; if ($r['amount_awarded'] !== null) $totalWon += (float)$r['amount_awarded']; }
        }
        return [
            'member_id' => $memberId,
            'summary' => ['applied' => $applied, 'won' => $won, 'total_awarded' => $totalWon],
            'applications' => $rows,
        ];
    }

    private static function requirementsByApp(PDO $pdo, array $appIds): array
    {
        $appIds = array_values(array_filter(array_map('intval', $appIds)));
        if (!$appIds) return [];
        $in = implode(',', array_fill(0, count($appIds), '?'));
        $st = $pdo->prepare("SELECT * FROM college_scholarship_app_requirements WHERE application_id IN ($in) ORDER BY sort_order, id");
        $st->execute($appIds);
        $map = [];
        foreach ($st->fetchAll() as $r) {
            $map[(int)$r['application_id']][] = [
                'id' => (int)$r['id'], 'label' => $r['label'], 'is_complete' => (bool)$r['is_complete'],
                'due_date' => $r['due_date'], 'sort_order' => (int)$r['sort_order'],
            ];
        }
        return $map;
    }

    /** PUT /college-scholarships/applications/{app_id} {status, amount_awarded?, decision_date?, notes?} — manager records outcome. */
    public static function setOutcome(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['app_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (isset($d['status'])) {
            if (!in_array($d['status'], self::STATUSES, true)) return Http::error($res, 'Invalid status.', 422);
            $set[] = 'status = ?'; $args[] = $d['status'];
        }
        if (array_key_exists('amount_awarded', $d)) { $set[] = 'amount_awarded = ?'; $args[] = ($d['amount_awarded'] === '' || $d['amount_awarded'] === null) ? null : $d['amount_awarded']; }
        if (array_key_exists('decision_date', $d)) { $set[] = 'decision_date = ?'; $args[] = $d['decision_date'] ?: null; }
        if (array_key_exists('notes', $d)) { $set[] = 'notes = ?'; $args[] = $d['notes']; }
        if (array_key_exists('youth_award_response', $d)) {
            $r = $d['youth_award_response'];
            if ($r !== null && $r !== '' && !in_array($r, ['accepted', 'declined'], true)) return Http::error($res, 'Invalid award response.', 422);
            $set[] = 'youth_award_response = ?'; $args[] = ($r === '' || $r === null) ? null : $r;
        }
        if (array_key_exists('target_college', $d)) { $set[] = 'target_college = ?'; $args[] = ($d['target_college'] === '' ? null : $d['target_college']); }
        if (array_key_exists('thank_you_sent', $d)) { $set[] = 'thank_you_sent = ?'; $args[] = (int)(bool)$d['thank_you_sent']; }
        if (array_key_exists('thank_you_date', $d)) { $set[] = 'thank_you_date = ?'; $args[] = $d['thank_you_date'] ?: null; }
        if (!$set) return Http::error($res, 'Nothing to update.', 422);
        $set[] = 'updated_by_id = ?'; $args[] = (int)$m['id'];
        $set[] = 'updated_at = NOW()';
        $args[] = $id;
        $pdo->prepare("UPDATE college_scholarship_applications SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'college_scholarship_applications', $id, 'update', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /college-scholarships/rollover {from_season, to_season} — clone the catalog into a new season with cleared dates. */
    public static function rollover(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $from = trim((string)($d['from_season'] ?? ''));
        $to = trim((string)($d['to_season'] ?? ''));
        if ($to === '') return Http::error($res, 'A target season is required.', 422);
        $sel = $pdo->prepare("SELECT * FROM college_scholarships WHERE is_active = 1 AND " . ($from === '' ? 'season IS NULL' : 'season = ?'));
        $sel->execute($from === '' ? [] : [$from]);
        $n = 0;
        foreach ($sel->fetchAll() as $s) {
            $cols = []; $ph = []; $args = [];
            foreach (self::FIELDS as $f) {
                $cols[] = $f; $ph[] = '?';
                if ($f === 'season') $args[] = $to;
                elseif ($f === 'open_date' || $f === 'close_date') $args[] = null;   // fresh windows for the new season
                else $args[] = $s[$f];
            }
            $cols[] = 'created_by_id'; $ph[] = '?'; $args[] = (int)$m['id'];
            $cols[] = 'updated_by_id'; $ph[] = '?'; $args[] = (int)$m['id'];
            $cols[] = 'created_at'; $ph[] = 'NOW()';
            $cols[] = 'updated_at'; $ph[] = 'NOW()';
            $pdo->prepare("INSERT INTO college_scholarships (" . implode(',', $cols) . ") VALUES (" . implode(',', $ph) . ")")->execute($args);
            $n++;
        }
        Audit::write($pdo, (int)$m['id'], 'college_scholarships', null, 'rollover', null, ['from_season' => $from, 'to_season' => $to, 'cloned' => $n]);
        return Http::json($res, ['cloned' => $n, 'to_season' => $to]);
    }

    // ── Application requirements checklist ────────────────────────────────────

    private static function loadApp(PDO $pdo, int $id): ?array
    {
        $st = $pdo->prepare("SELECT * FROM college_scholarship_applications WHERE id = ?");
        $st->execute([$id]);
        return $st->fetch() ?: null;
    }

    /** The youth who owns the application, or any manager, may edit its checklist. */
    private static function canEditApp(PDO $pdo, ?array $m, array $app): bool
    {
        if (!$m) return false;
        if ((int)$app['member_id'] === (int)$m['id']) return true;
        if (self::canManage($pdo, $m)) return true;
        return MembersController::isFamilyParentOf($pdo, $m, (int)$app['member_id']);
    }

    /** POST /college-scholarships/applications/{app_id}/requirements {label, due_date?} */
    public static function addRequirement(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $app = self::loadApp($pdo, (int)$route['app_id']);
        if (!$app) return Http::error($res, 'Application not found', 404);
        if (!self::canEditApp($pdo, $m, $app)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $label = trim((string)($d['label'] ?? ''));
        if ($label === '') return Http::error($res, 'A label is required.', 422);
        $due = (($d['due_date'] ?? '') !== '') ? $d['due_date'] : null;
        $soSt = $pdo->prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) FROM college_scholarship_app_requirements WHERE application_id = ?");
        $soSt->execute([(int)$app['id']]);
        $so = (int)$soSt->fetchColumn();
        $pdo->prepare("INSERT INTO college_scholarship_app_requirements (application_id, label, is_complete, due_date, sort_order, created_at, updated_at) VALUES (?,?,0,?,?,NOW(),NOW())")
            ->execute([(int)$app['id'], $label, $due, $so]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'college_scholarship_app_requirements', $newId, 'create', null, ['application_id' => (int)$app['id'], 'label' => $label]);
        return Http::json($res, ['id' => $newId], 201);
    }

    /** PUT /college-scholarships/requirements/{req_id} {label?, is_complete?, due_date?} */
    public static function updateRequirement(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $rid = (int)$route['req_id'];
        $rs = $pdo->prepare("SELECT * FROM college_scholarship_app_requirements WHERE id = ?");
        $rs->execute([$rid]);
        $reqRow = $rs->fetch();
        if (!$reqRow) return Http::error($res, 'Requirement not found', 404);
        $app = self::loadApp($pdo, (int)$reqRow['application_id']);
        if (!$app || !self::canEditApp($pdo, $m, $app)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('label', $d)) {
            $label = trim((string)$d['label']);
            if ($label === '') return Http::error($res, 'A label is required.', 422);
            $set[] = 'label = ?'; $args[] = $label;
        }
        if (array_key_exists('is_complete', $d)) { $set[] = 'is_complete = ?'; $args[] = (int)(bool)$d['is_complete']; }
        if (array_key_exists('due_date', $d)) { $set[] = 'due_date = ?'; $args[] = $d['due_date'] ?: null; }
        if (!$set) return Http::error($res, 'Nothing to update.', 422);
        $set[] = 'updated_at = NOW()';
        $args[] = $rid;
        $pdo->prepare("UPDATE college_scholarship_app_requirements SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'college_scholarship_app_requirements', $rid, 'update', null, $d);
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /college-scholarships/requirements/{req_id} */
    public static function deleteRequirement(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $rid = (int)$route['req_id'];
        $rs = $pdo->prepare("SELECT * FROM college_scholarship_app_requirements WHERE id = ?");
        $rs->execute([$rid]);
        $reqRow = $rs->fetch();
        if (!$reqRow) return Http::error($res, 'Requirement not found', 404);
        $app = self::loadApp($pdo, (int)$reqRow['application_id']);
        if (!$app || !self::canEditApp($pdo, $m, $app)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM college_scholarship_app_requirements WHERE id = ?")->execute([$rid]);
        Audit::write($pdo, (int)$m['id'], 'college_scholarship_app_requirements', $rid, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /college-scholarships/seasons — distinct season labels for filters. */
    public static function seasons(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT DISTINCT season FROM college_scholarships WHERE season IS NOT NULL AND season <> '' ORDER BY season DESC")->fetchAll(PDO::FETCH_COLUMN);
        return Http::json($res, $rows);
    }
}
