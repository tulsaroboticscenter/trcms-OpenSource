<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\EnrollmentService;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * FIRST Development Program (FDP).
 *
 * Youth start in the FDP and stay until they graduate.
 *
 * TWO SEPARATE THINGS, deliberately:
 *  - MEMBERSHIP lives here in `fdp_memberships` — who is in the program, per season,
 *    and when they graduated. This is what the roster page and profile pane show.
 *  - The FEE lives in `enrollments` like any other program. A youth pays the FDP fee
 *    on an FDP enrollment; when they land on an FTC or FRC team that same enrollment
 *    is re-pointed at the team's program by transferFeeToProgram(), so the money and
 *    payment history follow them and nobody is billed twice.
 *
 * Tracked per season. Graduation is a one-way door: once a member has graduated in
 * ANY season, auto-assign will not put them back in a later one.
 *
 * Graduation criteria are not yet defined, so graduating is a deliberate action by a
 * staff member with an optional note. When criteria are agreed, they can be evaluated
 * here without changing the shape of the data.
 */
final class FdpController
{
    /** The teams an FDP youth graduates INTO (used for fee transfer + eligibility). */
    public const FEEDER_PROGRAMS = ['FTC', 'FRC'];

    /**
     * Programs whose enrollment puts a youth on the FDP roster: the FTC/FRC feeders plus
     * the FDP program itself (a youth who enrols straight into the development program
     * belongs on its roster too).
     */
    public const ROSTER_PROGRAMS = ['FTC', 'FRC', 'FDP'];

    private static function canManage(PDO $pdo, array $cur): bool
    {
        return Permissions::memberCan($pdo, $cur, 'fdp.manage', 'write');
    }

    private static function year(Request $req): int
    {
        $y = (int)($req->getQueryParams()['year'] ?? 0);
        return $y ?: EnrollmentService::currentEnrollmentYear();
    }

    /** IDs of the feeder programs, resolved by name so renaming an id can't break it. */
    private static function feederProgramIds(PDO $pdo): array
    {
        $in = implode(',', array_fill(0, count(self::FEEDER_PROGRAMS), '?'));
        $s = $pdo->prepare("SELECT id FROM programs WHERE name IN ($in)");
        $s->execute(self::FEEDER_PROGRAMS);
        return array_map('intval', array_column($s->fetchAll(), 'id'));
    }

    /** Board-of-review outcomes. 'passed' is the one that grants eligibility. */
    private const REVIEW_OUTCOMES = ['passed', 'not_yet', 'deferred'];

    /** Default board-of-review rubric criteria (admin-editable in system_config). */
    private const DEFAULT_RUBRIC = ['Technical readiness', 'Communication', 'Teamwork & attitude', 'Commitment & reliability', 'Safety awareness'];

    /** The configured rubric criteria (falls back to DEFAULT_RUBRIC when unset). */
    private static function reviewRubric(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'fdp_review_rubric'"); $s->execute();
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode((string)$r['values'], true) : null;
        return (is_array($v) && $v) ? array_values(array_filter(array_map(fn($x) => trim((string)$x), $v))) : self::DEFAULT_RUBRIC;
    }

    /** Keep only known criteria with a 1–4 score; returns null when nothing valid remains. */
    private static function sanitizeScores(PDO $pdo, $raw): ?array
    {
        if (!is_array($raw)) return null;
        $allowed = array_flip(self::reviewRubric($pdo));
        $out = [];
        foreach ($raw as $k => $v) {
            $k = (string)$k;
            if (!isset($allowed[$k])) continue;
            $n = (int)$v;
            if ($n >= 1 && $n <= 4) $out[$k] = $n;
        }
        return $out ?: null;
    }

    /** GET /fdp/review-rubric — the board-of-review criteria for the record-review UI. */
    public static function reviewRubricEndpoint(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::reviewRubric($pdo));
    }

    /**
     * One youth's progress record (resume + board of review), or an empty shape when
     * nothing has been recorded yet. These are one-time facts, not per season.
     */
    private static function progressRow(PDO $pdo, int $memberId): array
    {
        $s = $pdo->prepare("SELECT p.*, r.first_name AS rf, r.last_name AS rl, u.first_name AS uf, u.last_name AS ul
                              FROM fdp_progress p
                              LEFT JOIN members r ON r.id = p.board_review_by_id
                              LEFT JOIN members u ON u.id = p.resume_updated_by_id
                             WHERE p.member_id = ?");
        $s->execute([$memberId]);
        $p = $s->fetch() ?: [];
        $outcome = $p['board_review_outcome'] ?? null;
        // A youth has a resume on file if they uploaded/linked one OR finished the
        // in-app resume builder — either counts for the FDP.
        $builderDone = ResumeController::isComplete($pdo, $memberId);
        return [
            'resume_url' => $p['resume_url'] ?? null,
            'resume_builder_complete' => $builderDone,
            'has_resume' => !empty($p['resume_url']) || $builderDone,
            'resume_updated_at' => isset($p['resume_updated_at']) ? Time::naiveIso($p['resume_updated_at']) : null,
            'resume_updated_by' => !empty($p['uf']) ? trim($p['uf'] . ' ' . $p['ul']) : null,
            'board_review_date' => $p['board_review_date'] ?? null,
            'board_review_outcome' => $outcome,
            'board_review_panel' => $p['board_review_panel'] ?? null,
            'board_review_notes' => $p['board_review_notes'] ?? null,
            'board_review_scores' => !empty($p['board_review_scores']) ? (json_decode((string)$p['board_review_scores'], true) ?: (object)[]) : (object)[],
            'board_review_by' => !empty($p['rf']) ? trim($p['rf'] . ' ' . $p['rl']) : null,
            'board_review_scheduled_at' => isset($p['board_review_scheduled_at']) ? Time::naiveIso($p['board_review_scheduled_at']) : null,
            'board_review_location' => $p['board_review_location'] ?? null,
            // Booked but no result recorded yet.
            'board_review_pending' => !empty($p['board_review_scheduled_at']) && empty($outcome),
            // The milestone never expires, so passing once makes them eligible for good.
            'eligible_for_interview' => $outcome === 'passed',
            'notes' => $p['notes'] ?? null,
        ];
    }

    /** Certifications completed, per member id. Computed so it can never drift. */
    private static function certCounts(PDO $pdo, array $memberIds): array
    {
        if (!$memberIds) return [];
        $in = implode(',', array_fill(0, count($memberIds), '?'));
        $s = $pdo->prepare("SELECT member_id, COUNT(*) AS n FROM member_certifications
                             WHERE member_id IN ($in) AND completed_date IS NOT NULL
                             GROUP BY member_id");
        $s->execute($memberIds);
        $out = [];
        foreach ($s->fetchAll() as $r) $out[(int)$r['member_id']] = (int)$r['n'];
        return $out;
    }

    /**
     * Interviews per member id: how many, and which teams. Phase 1 reads these for the
     * roster; the request/scheduling workflow arrives in Phase 2.
     */
    private static function interviewSummary(PDO $pdo, array $memberIds): array
    {
        if (!$memberIds) return [];
        $in = implode(',', array_fill(0, count($memberIds), '?'));
        $s = $pdo->prepare(
            "SELECT i.member_id, i.status, i.scheduled_at, t.team_number, ts.team_name
               FROM fdp_interviews i
               JOIN team_seasons ts ON ts.id = i.team_season_id
               JOIN teams t ON t.id = ts.team_id
              WHERE i.member_id IN ($in)
              ORDER BY i.scheduled_at IS NULL, i.scheduled_at DESC, i.id DESC");
        $s->execute($memberIds);
        $out = [];
        foreach ($s->fetchAll() as $r) {
            $mid = (int)$r['member_id'];
            $out[$mid] ??= ['count' => 0, 'teams' => []];
            $out[$mid]['count']++;
            $label = trim((string)$r['team_number'] . ($r['team_name'] ? ' · ' . $r['team_name'] : ''));
            $out[$mid]['teams'][] = ['team' => $label, 'status' => $r['status'], 'scheduled_at' => $r['scheduled_at']];
        }
        return $out;
    }

    /** Has this member graduated the FDP in any season? Graduation doesn't repeat. */
    public static function hasGraduated(PDO $pdo, int $memberId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM fdp_memberships WHERE member_id = ? AND status = 'graduated' LIMIT 1");
        $s->execute([$memberId]);
        return (bool)$s->fetchColumn();
    }

    /**
     * Ensure a member has an FDP row for a season. Returns true when one was created.
     * Skips anyone who already has a row that season or who has ever graduated.
     * Safe to call repeatedly — that's what makes the enrollment hook harmless.
     */
    public static function ensureMembership(PDO $pdo, int $memberId, int $year, string $source = 'auto', ?int $actorId = null): bool
    {
        $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $mt->execute([$memberId]);
        if (($mt->fetchColumn() ?: '') !== 'youth') return false;   // FDP is a youth program

        if (self::hasGraduated($pdo, $memberId)) return false;

        $ex = $pdo->prepare("SELECT 1 FROM fdp_memberships WHERE member_id = ? AND enrollment_year = ?");
        $ex->execute([$memberId, $year]);
        if ($ex->fetchColumn()) return false;

        $pdo->prepare("INSERT INTO fdp_memberships (member_id, enrollment_year, status, joined_date, joined_source, created_at, updated_at)
                       VALUES (?, ?, 'active', CURDATE(), ?, NOW(), NOW())")
            ->execute([$memberId, $year, $source]);
        // Pass the actor through as-is (null for system actions like self-signup); the
        // audit_logs.actor_id FK rejects 0, so never coerce null to 0.
        Audit::write($pdo, $actorId, 'fdp_memberships', (int)$pdo->lastInsertId(), 'create', null,
            ['member_id' => $memberId, 'enrollment_year' => $year, 'source' => $source]);
        return true;
    }

    /**
     * Move a youth's FDP enrollment fee onto the program of the team they just joined.
     *
     * Youth start in the FDP and pay the FDP fee there. When they land on an FTC or FRC
     * team, that same enrollment becomes an enrollment in the team's program — the row
     * is re-pointed rather than closed and re-created, so the amount due, everything
     * already paid, the payment method and the T&C signatures all travel with it and
     * the family is never asked to pay twice.
     *
     * No-ops when there is no FDP enrollment to move, or when the youth already has an
     * enrollment in the target program (nothing to transfer onto).
     *
     * @return array{moved:bool,reason:string,enrollment_id:?int}
     */
    public static function transferFeeToProgram(PDO $pdo, int $memberId, int $targetProgramId, int $year, ?int $actorId = null, string $context = 'when joining a team'): array
    {
        $fdpId = (int)($pdo->query("SELECT id FROM programs WHERE name = 'FDP'")->fetchColumn() ?: 0);
        if (!$fdpId || $targetProgramId <= 0 || $targetProgramId === $fdpId) {
            return ['moved' => false, 'reason' => 'not applicable', 'enrollment_id' => null];
        }

        // Already enrolled in the target program — nothing to move onto.
        $has = $pdo->prepare("SELECT 1 FROM enrollments WHERE member_id = ? AND program_id = ? AND enrollment_year = ? AND status <> 'cancelled' LIMIT 1");
        $has->execute([$memberId, $targetProgramId, $year]);
        if ($has->fetchColumn()) return ['moved' => false, 'reason' => 'already enrolled in that program', 'enrollment_id' => null];

        $s = $pdo->prepare("SELECT * FROM enrollments WHERE member_id = ? AND program_id = ? AND enrollment_year = ? AND status <> 'cancelled' ORDER BY id LIMIT 1");
        $s->execute([$memberId, $fdpId, $year]);
        $e = $s->fetch();
        if (!$e) return ['moved' => false, 'reason' => 'no FDP enrollment for this season', 'enrollment_id' => null];

        $target = $pdo->prepare("SELECT name FROM programs WHERE id = ?"); $target->execute([$targetProgramId]);
        $targetName = (string)($target->fetchColumn() ?: 'the team program');

        $note = trim((string)($e['notes'] ?? ''));
        $stamp = 'Fee transferred from FDP to ' . $targetName . ' on ' . date('n/j/Y') . ' ' . $context . '.';
        $note = $note !== '' ? $note . ' | ' . $stamp : $stamp;

        $pdo->prepare("UPDATE enrollments SET program_id = ?, notes = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$targetProgramId, $note, (int)$e['id']]);

        Audit::write($pdo, $actorId ?? 0, 'enrollments', (int)$e['id'], 'update',
            ['program_id' => (int)$e['program_id']],
            ['program_id' => $targetProgramId, 'transferred_from' => 'FDP',
             'amount_due' => $e['amount_due'], 'payment_amount' => $e['payment_amount']]);

        return ['moved' => true, 'reason' => 'transferred from FDP to ' . $targetName, 'enrollment_id' => (int)$e['id']];
    }

    /** GET /fdp?year= — the roster for a season, plus who is eligible but missing. */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $year = self::year($req);

        $s = $pdo->prepare(
            "SELECT f.*, m.first_name, m.last_name, m.member_number, m.photo_url, m.graduation_year,
                    g.first_name AS grad_by_first, g.last_name AS grad_by_last
               FROM fdp_memberships f
               JOIN members m ON m.id = f.member_id
               LEFT JOIN members g ON g.id = f.graduated_by_id
              WHERE f.enrollment_year = ?
                AND (m.is_active = 1 OR m.is_active IS NULL)
                AND (m.is_archived = 0 OR m.is_archived IS NULL)
              ORDER BY f.status, m.last_name, m.first_name"
        );
        $s->execute([$year]);
        $rows = $s->fetchAll();
        $ids = array_map(fn($r) => (int)$r['member_id'], $rows);
        $certs = self::certCounts($pdo, $ids);
        $ints = self::interviewSummary($pdo, $ids);
        $members = array_map(fn($r) => [
            'id' => (int)$r['id'], 'member_id' => (int)$r['member_id'],
            'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'member_number' => $r['member_number'], 'photo_url' => $r['photo_url'],
            'grade_label' => \App\Core\Grade::label(\App\Core\Grade::fromGraduationYear(
                $r['graduation_year'] !== null ? (int)$r['graduation_year'] : null, $year)),
            'status' => $r['status'],
            'joined_date' => $r['joined_date'], 'joined_source' => $r['joined_source'],
            'graduated_date' => $r['graduated_date'], 'graduated_note' => $r['graduated_note'],
            'graduated_by' => $r['grad_by_first'] ? trim($r['grad_by_first'] . ' ' . $r['grad_by_last']) : null,
            'notes' => $r['notes'],
            // Progress (Phase 1): what the youth has actually done.
            'certifications_completed' => $certs[(int)$r['member_id']] ?? 0,
            'interviews' => $ints[(int)$r['member_id']]['count'] ?? 0,
            'interview_teams' => $ints[(int)$r['member_id']]['teams'] ?? [],
            'progress' => self::progressRow($pdo, (int)$r['member_id']),
        ], $rows);

        return Http::json($res, [
            'year' => $year,
            'year_label' => $year . '–' . ($year + 1),
            'members' => $members,
            'active_count' => count(array_filter($members, fn($m) => $m['status'] === 'active')),
            'graduated_count' => count(array_filter($members, fn($m) => $m['status'] === 'graduated')),
            'eligible_missing' => self::eligibleMissing($pdo, $year),
        ]);
    }

    /**
     * GET /fdp/pipeline?year= — the placement funnel: every active FDP youth bucketed into
     * the furthest stage they've reached (In the FDP → Resume ready → Board passed/eligible →
     * Interviewing → Placed on a team), so staff can see where youth are stuck and how the
     * cohort is converting. Read-only aggregation over the same signals the roster shows.
     */
    public static function pipeline(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $year = self::year($req);

        $s = $pdo->prepare(
            "SELECT f.member_id, m.first_name, m.last_name, m.photo_url
               FROM fdp_memberships f JOIN members m ON m.id = f.member_id
              WHERE f.enrollment_year = ? AND f.status = 'active'
                AND (m.is_active = 1 OR m.is_active IS NULL)
                AND (m.is_archived = 0 OR m.is_archived IS NULL)
              ORDER BY m.last_name, m.first_name");
        $s->execute([$year]);
        $rows = $s->fetchAll();
        $ids = array_map(fn($r) => (int)$r['member_id'], $rows);
        $ints = self::interviewSummary($pdo, $ids);

        // Placed = on a team roster for a team-season in this year.
        $placed = [];
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $ps = $pdo->prepare("SELECT DISTINCT tma.member_id FROM team_member_assignments tma
                                  JOIN team_seasons ts ON ts.id = tma.team_season_id
                                 WHERE tma.member_id IN ($in) AND SUBSTRING_INDEX(ts.season, '-', 1) = ?");
            $ps->execute(array_merge($ids, [(string)$year]));
            foreach ($ps->fetchAll(\PDO::FETCH_COLUMN) as $mid) $placed[(int)$mid] = true;
        }

        $order = ['in_fdp', 'resume', 'eligible', 'interviewing', 'placed'];
        $labels = ['in_fdp' => 'In the FDP', 'resume' => 'Resume ready', 'eligible' => 'Board passed · eligible',
                   'interviewing' => 'Interviewing', 'placed' => 'Placed on a team'];
        $buckets = array_fill_keys($order, []);
        foreach ($rows as $r) {
            $mid = (int)$r['member_id'];
            $prog = self::progressRow($pdo, $mid);
            $intCount = $ints[$mid]['count'] ?? 0;
            $stage = 'in_fdp';
            if (isset($placed[$mid]))                       $stage = 'placed';
            elseif ($intCount > 0)                          $stage = 'interviewing';
            elseif (!empty($prog['eligible_for_interview'])) $stage = 'eligible';
            elseif (!empty($prog['has_resume']))            $stage = 'resume';
            $buckets[$stage][] = [
                'member_id' => $mid, 'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                'photo_url' => $r['photo_url'], 'has_resume' => !empty($prog['has_resume']),
                'eligible' => !empty($prog['eligible_for_interview']), 'interviews' => $intCount,
                'teams' => $ints[$mid]['teams'] ?? [],
            ];
        }
        $stages = array_map(fn($k) => ['key' => $k, 'label' => $labels[$k], 'count' => count($buckets[$k]), 'members' => $buckets[$k]], $order);
        return Http::json($res, ['year' => $year, 'year_label' => $year . '–' . ($year + 1), 'total' => count($rows), 'stages' => $stages]);
    }

    /**
     * Youth enrolled in a feeder program this season who have no FDP row and have
     * never graduated — i.e. what "Add all eligible" would create.
     */
    private static function eligibleMissing(PDO $pdo, int $year): array
    {
        $ids = self::feederProgramIds($pdo);
        if (!$ids) return [];
        $in = implode(',', array_fill(0, count($ids), '?'));
        $s = $pdo->prepare(
            "SELECT DISTINCT m.id, m.first_name, m.last_name
               FROM enrollments e
               JOIN members m ON m.id = e.member_id AND m.member_type = 'youth'
              WHERE e.program_id IN ($in) AND e.enrollment_year = ? AND e.status <> 'cancelled'
                AND (m.is_active = 1 OR m.is_active IS NULL)
                AND (m.is_archived = 0 OR m.is_archived IS NULL)
                AND NOT EXISTS (SELECT 1 FROM fdp_memberships f
                                 WHERE f.member_id = m.id AND f.enrollment_year = ?)
                AND NOT EXISTS (SELECT 1 FROM fdp_memberships f2
                                 WHERE f2.member_id = m.id AND f2.status = 'graduated')
              ORDER BY m.last_name, m.first_name"
        );
        $s->execute(array_merge($ids, [$year, $year]));
        return array_map(fn($r) => ['member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name'])], $s->fetchAll());
    }

    /** GET /fdp/member/{member_id} — this member's FDP history (self or a manager). */
    public static function forMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        $isSelf = ((int)$cur['id'] === $mid);
        $isParent = MembersController::isFamilyParentOf($pdo, $cur, $mid);
        if (!$isSelf && !$isParent && !self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);

        $s = $pdo->prepare("SELECT f.*, g.first_name AS gf, g.last_name AS gl FROM fdp_memberships f
                            LEFT JOIN members g ON g.id = f.graduated_by_id
                            WHERE f.member_id = ? ORDER BY f.enrollment_year DESC");
        $s->execute([$mid]);
        $rows = array_map(fn($r) => [
            'id' => (int)$r['id'], 'enrollment_year' => (int)$r['enrollment_year'],
            'year_label' => $r['enrollment_year'] . '–' . ($r['enrollment_year'] + 1),
            'status' => $r['status'], 'joined_date' => $r['joined_date'], 'joined_source' => $r['joined_source'],
            'graduated_date' => $r['graduated_date'], 'graduated_note' => $r['graduated_note'],
            'graduated_by' => $r['gf'] ? trim($r['gf'] . ' ' . $r['gl']) : null,
            'notes' => $r['notes'],
        ], $s->fetchAll());

        $ints = self::interviewSummary($pdo, [$mid]);
        return Http::json($res, [
            'member_id' => $mid,
            'can_manage' => self::canManage($pdo, $cur),
            'current_year' => EnrollmentService::currentEnrollmentYear(),
            'has_graduated' => self::hasGraduated($pdo, $mid),
            'history' => $rows,
            // Progress, visible to the youth, their parent/guardian, and managers.
            'certifications_completed' => self::certCounts($pdo, [$mid])[$mid] ?? 0,
            'interviews' => $ints[$mid]['count'] ?? 0,
            'interview_teams' => $ints[$mid]['teams'] ?? [],
            'progress' => self::progressRow($pdo, $mid),
        ]);
    }

    /**
     * PUT /fdp/member/{member_id}/progress — record a youth's resume and/or board of
     * review. Manager-only (fdp.manage): these are staff judgements, not self-reported.
     *
     * The board of review is a one-time milestone — passing it makes the youth eligible
     * to be interviewed by a team and does not expire — so it is stored per member, not
     * per season. Sending an outcome of 'passed' grants eligibility; 'not_yet' or
     * 'deferred' record that a review happened without granting it.
     *
     * `resume_url` accepts either an uploaded file's URL (POST /uploads/document) or a
     * pasted link. Sending an empty string clears it.
     */
    public static function setProgress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id'];
        $ex = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $ex->execute([$mid]);
        $type = $ex->fetchColumn();
        if ($type === false) return Http::error($res, 'Member not found', 404);
        if ($type !== 'youth') return Http::error($res, 'The FDP is a youth program.', 422);

        $d = (array)$req->getParsedBody();
        $outcome = array_key_exists('board_review_outcome', $d)
            ? (string)($d['board_review_outcome'] ?? '') : null;
        if ($outcome !== null && $outcome !== '' && !in_array($outcome, self::REVIEW_OUTCOMES, true)) {
            return Http::error($res, 'board_review_outcome must be one of: ' . implode(', ', self::REVIEW_OUTCOMES), 422);
        }
        $date = array_key_exists('board_review_date', $d) ? trim((string)($d['board_review_date'] ?? '')) : null;
        if ($date !== null && $date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return Http::error($res, 'board_review_date must be YYYY-MM-DD.', 422);
        }
        // Recording an outcome without a date is almost certainly a mistake — the
        // milestone is permanent, so when it happened matters.
        if ($outcome === 'passed' && ($date === null || $date === '')) {
            $existing = self::progressRow($pdo, $mid);
            if (empty($existing['board_review_date'])) $date = date('Y-m-d');
        }

        $pdo->prepare("INSERT INTO fdp_progress (member_id, created_at) VALUES (?, NOW())
                       ON DUPLICATE KEY UPDATE member_id = member_id")->execute([$mid]);

        $set = []; $args = [];
        if (array_key_exists('resume_url', $d)) {
            $url = trim((string)($d['resume_url'] ?? ''));
            $set[] = 'resume_url = ?';           $args[] = $url !== '' ? $url : null;
            $set[] = 'resume_updated_at = ?';    $args[] = $url !== '' ? date('Y-m-d H:i:s') : null;
            $set[] = 'resume_updated_by_id = ?'; $args[] = $url !== '' ? (int)$cur['id'] : null;
        }
        if ($outcome !== null) {
            $set[] = 'board_review_outcome = ?'; $args[] = $outcome !== '' ? $outcome : null;
            $set[] = 'board_review_by_id = ?';   $args[] = $outcome !== '' ? (int)$cur['id'] : null;
        }
        if ($date !== null)                        { $set[] = 'board_review_date = ?';  $args[] = $date !== '' ? $date : null; }
        if (array_key_exists('board_review_scheduled_at', $d)) {
            $v = trim((string)($d['board_review_scheduled_at'] ?? ''));
            $set[] = 'board_review_scheduled_at = ?';
            $args[] = $v !== '' ? str_replace('T', ' ', substr($v, 0, 16)) . ':00' : null;
        }
        if (array_key_exists('board_review_location', $d)) { $set[] = 'board_review_location = ?'; $args[] = trim((string)$d['board_review_location']) ?: null; }
        if (array_key_exists('board_review_panel', $d)) { $set[] = 'board_review_panel = ?'; $args[] = trim((string)$d['board_review_panel']) ?: null; }
        if (array_key_exists('board_review_notes', $d)) { $set[] = 'board_review_notes = ?'; $args[] = trim((string)$d['board_review_notes']) ?: null; }
        if (array_key_exists('board_review_scores', $d)) {
            $scores = self::sanitizeScores($pdo, $d['board_review_scores']);
            $set[] = 'board_review_scores = ?'; $args[] = $scores !== null ? json_encode($scores) : null;
        }
        if (array_key_exists('notes', $d))              { $set[] = 'notes = ?';              $args[] = trim((string)$d['notes']) ?: null; }

        if ($set) {
            $set[] = 'updated_at = NOW()';
            $args[] = $mid;
            $pdo->prepare("UPDATE fdp_progress SET " . implode(', ', $set) . " WHERE member_id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$cur['id'], 'fdp_progress', $mid, 'update', null, $d);
        return Http::json($res, self::progressRow($pdo, $mid));
    }

    /**
     * POST /fdp/board-review/schedule — book a board of review for one or more youth.
     * Body: { member_ids: [int], scheduled_at, panel?, location? }
     *
     * A board of review is usually a single sitting that considers several youth, so
     * this writes the same date/panel/location to each youth's progress row. It only
     * sets the appointment — the outcome is recorded per youth afterwards through the
     * existing progress endpoint, so scheduling never grants eligibility on its own.
     *
     * Manager-only (fdp.manage). Non-youth ids are skipped and reported.
     */
    public static function scheduleBoardReview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['member_ids'] ?? [])))));
        if (!$ids) return Http::error($res, 'Pick at least one youth.', 422);
        $when = trim((string)($d['scheduled_at'] ?? ''));
        if ($when === '') return Http::error($res, 'A date and time are required.', 422);
        $when = str_replace('T', ' ', substr($when, 0, 16)) . ':00';
        $panel = trim((string)($d['panel'] ?? '')) ?: null;
        $location = trim((string)($d['location'] ?? '')) ?: null;

        $in = implode(',', array_fill(0, count($ids), '?'));
        $q = $pdo->prepare("SELECT id FROM members WHERE id IN ($in) AND member_type = 'youth'");
        $q->execute($ids);
        $youthIds = array_map('intval', array_column($q->fetchAll(), 'id'));
        $skipped = array_values(array_diff($ids, $youthIds));
        if (!$youthIds) return Http::error($res, 'None of those are youth members.', 422);

        foreach ($youthIds as $mid) {
            $pdo->prepare("INSERT INTO fdp_progress (member_id, created_at) VALUES (?, NOW())
                           ON DUPLICATE KEY UPDATE member_id = member_id")->execute([$mid]);
            $pdo->prepare(
                "UPDATE fdp_progress
                    SET board_review_scheduled_at = ?, board_review_location = ?,
                        board_review_panel = COALESCE(?, board_review_panel), updated_at = NOW()
                  WHERE member_id = ?")
                ->execute([$when, $location, $panel, $mid]);
        }
        Audit::write($pdo, (int)$cur['id'], 'fdp_progress', null, 'schedule_board_review', null,
            ['member_ids' => $youthIds, 'scheduled_at' => $when, 'skipped' => $skipped]);

        // Tell each youth + their family the appointment is booked (best-effort).
        foreach ($youthIds as $mid) {
            $whenTxt = date('l, M j \a\t g:i A', strtotime($when));
            $body = "<p>A board of review has been scheduled for <strong>{when}</strong>"
                  . ($location ? ' at ' . htmlspecialchars($location) : '') . '.</p>'
                  . '<p>Passing the board of review is the milestone that makes a youth eligible to interview with a team.</p>';
            $body = str_replace('{when}', htmlspecialchars($whenTxt), $body);
            self::emailYouthFamily($pdo, $mid, 'Board of review scheduled', $body);
        }

        return Http::json($res, [
            'ok' => true, 'scheduled' => count($youthIds),
            'member_ids' => $youthIds, 'skipped_not_youth' => $skipped,
        ], 201);
    }

    /**
     * Email a youth AND their guardians a short FDP notice (best-effort). Public so the
     * onboarding work-assignment path can reuse it. Silently no-ops when mail is off or
     * no valid address is on file.
     */
    public static function emailYouthFamily(PDO $pdo, int $memberId, string $subject, string $bodyHtml): void
    {
        if (!Mailer::enabled()) return;
        $q = $pdo->prepare("SELECT first_name, email, guardian1_email, guardian2_email FROM members WHERE id = ?");
        $q->execute([$memberId]);
        $m = $q->fetch();
        if (!$m) return;
        $to = [];
        foreach ([$m['email'], $m['guardian1_email'], $m['guardian2_email']] as $e) {
            $e = trim((string)$e);
            if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) $to[$e] = true;
        }
        if (!$to) return;
        $appUrl = rtrim((string)\App\Core\Config::get('APP_URL', ''), '/');
        if ($appUrl) $bodyHtml .= "<p><a href='{$appUrl}/' style='color:#1565c0'>Open TRCMS &rarr;</a></p>";
        $html = Mailer::wrap('Development Program', $bodyHtml);
        foreach (array_keys($to) as $addr) { try { Mailer::send($addr, $subject, $html); } catch (\Throwable $e) { /* best effort */ } }
    }

    /**
     * Send reminder emails for FDP appointments coming up within ~2 days that haven't been
     * reminded in the last few days: scheduled interviews and booked board reviews. Called by
     * the cron (bin/run_fdp_reminders.php) and the manager "send now" endpoint.
     */
    public static function sendReminders(PDO $pdo): array
    {
        if (!Mailer::enabled()) return ['sent' => 0];
        $sent = 0;
        $iv = $pdo->query(
            "SELECT i.id, i.member_id, i.scheduled_at, i.location, m.first_name, t.team_number, ts.team_name
               FROM fdp_interviews i JOIN members m ON m.id = i.member_id
               JOIN team_seasons ts ON ts.id = i.team_season_id JOIN teams t ON t.id = ts.team_id
              WHERE i.status = 'scheduled' AND i.scheduled_at IS NOT NULL
                AND i.scheduled_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 2 DAY)
                AND (i.reminded_at IS NULL OR i.reminded_at <= DATE_SUB(CURDATE(), INTERVAL 3 DAY))")->fetchAll();
        foreach ($iv as $r) {
            $team = trim((string)$r['team_number'] . ($r['team_name'] ? ' · ' . $r['team_name'] : ''));
            $when = date('l, M j \a\t g:i A', strtotime((string)$r['scheduled_at']));
            $body = '<p>Reminder: <strong>' . htmlspecialchars((string)$r['first_name']) . '</strong> has an interview with <strong>'
                  . htmlspecialchars($team) . '</strong> on <strong>' . htmlspecialchars($when) . '</strong>'
                  . ($r['location'] ? ' at ' . htmlspecialchars((string)$r['location']) : '') . '.</p>';
            self::emailYouthFamily($pdo, (int)$r['member_id'], 'Interview reminder for ' . $r['first_name'], $body);
            $pdo->prepare("UPDATE fdp_interviews SET reminded_at = CURDATE() WHERE id = ?")->execute([(int)$r['id']]);
            $sent++;
        }
        $br = $pdo->query(
            "SELECT p.member_id, p.board_review_scheduled_at, p.board_review_location, m.first_name
               FROM fdp_progress p JOIN members m ON m.id = p.member_id
              WHERE p.board_review_scheduled_at IS NOT NULL AND p.board_review_outcome IS NULL
                AND p.board_review_scheduled_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 2 DAY)
                AND (p.board_review_reminded_at IS NULL OR p.board_review_reminded_at <= DATE_SUB(CURDATE(), INTERVAL 3 DAY))")->fetchAll();
        foreach ($br as $r) {
            $when = date('l, M j \a\t g:i A', strtotime((string)$r['board_review_scheduled_at']));
            $body = '<p>Reminder: <strong>' . htmlspecialchars((string)$r['first_name']) . '</strong> has a board of review on <strong>'
                  . htmlspecialchars($when) . '</strong>' . ($r['board_review_location'] ? ' at ' . htmlspecialchars((string)$r['board_review_location']) : '') . '.</p>';
            self::emailYouthFamily($pdo, (int)$r['member_id'], 'Board of review reminder for ' . $r['first_name'], $body);
            $pdo->prepare("UPDATE fdp_progress SET board_review_reminded_at = CURDATE() WHERE member_id = ?")->execute([(int)$r['member_id']]);
            $sent++;
        }
        return ['sent' => $sent];
    }

    /** POST /fdp/send-reminders — a manager triggers the FDP reminder run now. */
    public static function sendRemindersNow(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $r = self::sendReminders($pdo);
        Audit::write($pdo, (int)$cur['id'], 'fdp_interviews', null, 'fdp.reminders', null, $r);
        return Http::json($res, ['ok' => true] + $r);
    }

    /**
     * GET /fdp/eligible — youth who have passed their board of review, for teams
     * deciding who to interview. Readable by any member who can view a team roster's
     * worth of information; it exposes only name, grade and progress counts.
     */
    public static function eligible(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $year = self::year($req);
        // A youth drops off this list for exactly two reasons: they haven't passed their
        // board of review, or they're already placed on a team this season. Interviewing
        // with one team does NOT remove them — a youth may be considered by several
        // teams at once.
        $season = $year . '-' . ($year + 1);
        $s = $pdo->prepare(
            "SELECT m.id AS member_id, m.first_name, m.last_name, m.photo_url, m.graduation_year,
                    p.board_review_date, p.resume_url
               FROM fdp_progress p
               JOIN members m ON m.id = p.member_id
               JOIN fdp_memberships f ON f.member_id = m.id AND f.enrollment_year = ? AND f.status = 'active'
              WHERE p.board_review_outcome = 'passed'
                AND (m.is_active = 1 OR m.is_active IS NULL)
                AND (m.is_archived = 0 OR m.is_archived IS NULL)
                AND NOT EXISTS (
                      SELECT 1 FROM team_member_assignments tma
                        JOIN team_seasons ts ON ts.id = tma.team_season_id
                       WHERE tma.member_id = m.id AND ts.season = ?)
              ORDER BY m.last_name, m.first_name");
        $s->execute([$year, $season]);
        $rows = $s->fetchAll();
        $ids = array_map(fn ($r) => (int)$r['member_id'], $rows);
        $certs = self::certCounts($pdo, $ids);
        $ints = self::interviewSummary($pdo, $ids);
        $builder = ResumeController::completedSet($pdo, $ids);

        // Cert-matching (#3): when a team is named, show which of the certs it wants each youth
        // already holds, so a leader can interview the right candidates.
        $tsid = (int)(($req->getQueryParams())['team_season_id'] ?? 0);
        $needs = $tsid > 0 ? self::teamCertNeedList($pdo, $tsid) : [];   // [cert_id => name]
        $held = ($needs && $ids) ? self::certsHeld($pdo, $ids, array_keys($needs)) : [];  // [member_id => [cert_id,...]]

        return Http::json($res, [
            'year' => $year,
            'cert_needs' => array_values(array_map(fn ($id, $name) => ['id' => $id, 'name' => $name], array_keys($needs), $needs)),
            'members' => array_map(function ($r) use ($certs, $ints, $builder, $needs, $held, $year) {
                $mid = (int)$r['member_id'];
                $has = $held[$mid] ?? [];
                return [
                    'member_id' => $mid,
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'photo_url' => $r['photo_url'],
                    'grade_label' => \App\Core\Grade::label(\App\Core\Grade::fromGraduationYear(
                        $r['graduation_year'] !== null ? (int)$r['graduation_year'] : null, $year)),
                    'board_review_date' => $r['board_review_date'],
                    'has_resume' => !empty($r['resume_url']) || isset($builder[$mid]),
                    // Expose the link so the team view can open it: the uploaded/linked URL if
                    // there is one, otherwise the in-app resume when they finished the builder.
                    'resume_url' => $r['resume_url'] ?: null,
                    'resume_builder_complete' => isset($builder[$mid]),
                    'certifications_completed' => $certs[$mid] ?? 0,
                    'interviews' => $ints[$mid]['count'] ?? 0,
                    'matched_certs' => array_values(array_map(fn ($cid) => $needs[$cid], array_filter(array_keys($needs), fn ($cid) => in_array($cid, $has, true)))),
                    'missing_certs' => array_values(array_map(fn ($cid) => $needs[$cid], array_filter(array_keys($needs), fn ($cid) => !in_array($cid, $has, true)))),
                    'cert_match' => $needs ? count(array_intersect(array_keys($needs), $has)) . '/' . count($needs) : null,
                ];
            }, $rows),
        ]);
    }

    /** [certification_id => name] a team wants (empty if none set). */
    private static function teamCertNeedList(PDO $pdo, int $teamSeasonId): array
    {
        $s = $pdo->prepare("SELECT c.id, c.name FROM team_season_cert_needs n JOIN certifications c ON c.id = n.certification_id
                             WHERE n.team_season_id = ? ORDER BY c.display_order, c.name");
        $s->execute([$teamSeasonId]);
        $out = [];
        foreach ($s->fetchAll() as $r) $out[(int)$r['id']] = $r['name'];
        return $out;
    }

    /** [member_id => [certification_id,...]] completed, limited to a set of cert ids. */
    private static function certsHeld(PDO $pdo, array $memberIds, array $certIds): array
    {
        if (!$memberIds || !$certIds) return [];
        $mIn = implode(',', array_fill(0, count($memberIds), '?'));
        $cIn = implode(',', array_fill(0, count($certIds), '?'));
        $s = $pdo->prepare("SELECT member_id, certification_id FROM member_certifications
                             WHERE member_id IN ($mIn) AND certification_id IN ($cIn) AND completed_date IS NOT NULL");
        $s->execute(array_merge($memberIds, $certIds));
        $out = [];
        foreach ($s->fetchAll() as $r) $out[(int)$r['member_id']][] = (int)$r['certification_id'];
        return $out;
    }

    /** GET /fdp/team-cert-needs?team_season_id= — the certs a team wants + the full catalog to pick from. */
    public static function teamCertNeeds(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $tsid = (int)(($req->getQueryParams())['team_season_id'] ?? 0);
        if ($tsid <= 0) return Http::error($res, 'team_season_id is required.', 422);
        if (!self::canActForTeam($pdo, $cur, $tsid) && !self::onTeam($pdo, (int)$cur['id'], $tsid)
            && !Permissions::memberCan($pdo, $cur, 'teams.roster_others', 'read')) {
            return Http::error($res, 'Access denied', 403);
        }
        $needs = self::teamCertNeedList($pdo, $tsid);
        $cat = $pdo->query("SELECT id, name, section FROM certifications ORDER BY display_order, section, name")->fetchAll();
        return Http::json($res, [
            'team_season_id' => $tsid,
            'selected' => array_map('intval', array_keys($needs)),
            'catalog' => array_map(fn ($c) => ['id' => (int)$c['id'], 'name' => $c['name'], 'section' => $c['section']], $cat),
            'can_edit' => self::canActForTeam($pdo, $cur, $tsid),
        ]);
    }

    /** PUT /fdp/team-cert-needs — set the certs a team wants (team leader on that team, or a manager). */
    public static function setTeamCertNeeds(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $tsid = (int)($d['team_season_id'] ?? 0);
        if ($tsid <= 0) return Http::error($res, 'team_season_id is required.', 422);
        if (!self::canActForTeam($pdo, $cur, $tsid)) {
            return Http::error($res, 'Only a team leader on this team (or an FDP manager) can set this.', 403);
        }
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['certification_ids'] ?? [])))));
        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM team_season_cert_needs WHERE team_season_id = ?")->execute([$tsid]);
            if ($ids) {
                $ins = $pdo->prepare("INSERT IGNORE INTO team_season_cert_needs (team_season_id, certification_id, created_at) VALUES (?, ?, NOW())");
                foreach ($ids as $cid) $ins->execute([$tsid, $cid]);
            }
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); return Http::error($res, 'Could not save the certification list.', 500); }
        Audit::write($pdo, (int)$cur['id'], 'team_season_cert_needs', $tsid, 'update', null, ['certification_ids' => $ids]);
        return Http::json($res, ['ok' => true, 'selected' => $ids]);
    }

    // ── Phase 2: interviews between a team and an FDP youth ────────────────

    private const INTERVIEW_STATUSES = ['requested', 'scheduled', 'completed', 'declined', 'cancelled'];
    private const INTERVIEW_OUTCOMES = ['offered', 'not_selected', 'undecided'];

    /** Is this member on that team-season's roster? */
    private static function onTeam(PDO $pdo, int $memberId, int $teamSeasonId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE team_season_id = ? AND member_id = ? LIMIT 1");
        $s->execute([$teamSeasonId, $memberId]);
        return (bool)$s->fetchColumn();
    }

    /**
     * May this member act for a team on interviews? Team leaders (planning.manage) do
     * it for THEIR OWN team — being on the roster is what scopes it, so a leader on one
     * team can't book interviews for another. FDP managers and admins act for any team.
     */
    private static function canActForTeam(PDO $pdo, array $cur, int $teamSeasonId): bool
    {
        if (self::canManage($pdo, $cur)) return true;
        return Permissions::memberCan($pdo, $cur, 'planning.manage', 'write')
            && self::onTeam($pdo, (int)$cur['id'], $teamSeasonId);
    }

    /**
     * One interview with the names serializeInterview needs. Joined here rather than in
     * the caller so a create/update response carries the same shape as the list — a
     * bare SELECT * left the team and member unnamed.
     */
    private static function interviewRow(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare(
            "SELECT i.*, m.first_name, m.last_name, t.team_number, ts.team_name,
                    rq.first_name AS rq_first, rq.last_name AS rq_last,
                    EXISTS(SELECT 1 FROM team_member_assignments tma WHERE tma.team_season_id = i.team_season_id AND tma.member_id = i.member_id) AS placed
               FROM fdp_interviews i
               JOIN members m ON m.id = i.member_id
               JOIN team_seasons ts ON ts.id = i.team_season_id
               JOIN teams t ON t.id = ts.team_id
               LEFT JOIN members rq ON rq.id = i.requested_by_id
              WHERE i.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function serializeInterview(array $r): array
    {
        return [
            'id' => (int)$r['id'],
            'member_id' => (int)$r['member_id'],
            'member_name' => isset($r['first_name']) ? trim($r['first_name'] . ' ' . $r['last_name']) : null,
            'team_season_id' => (int)$r['team_season_id'],
            'team' => isset($r['team_number'])
                ? trim((string)$r['team_number'] . ($r['team_name'] ? ' · ' . $r['team_name'] : '')) : null,
            'enrollment_year' => (int)$r['enrollment_year'],
            'direction' => $r['direction'],
            'status' => $r['status'],
            'scheduled_at' => isset($r['scheduled_at']) ? Time::naiveIso($r['scheduled_at']) : null,
            'location' => $r['location'] ?? null,
            'outcome' => $r['outcome'] ?? null,
            'notes' => $r['notes'] ?? null,
            'placed' => (bool)($r['placed'] ?? false),   // youth is now on this team's roster
            'requested_by' => isset($r['rq_first']) && $r['rq_first'] ? trim($r['rq_first'] . ' ' . $r['rq_last']) : null,
            'created_at' => isset($r['created_at']) ? Time::naiveIso($r['created_at']) : null,
        ];
    }

    /**
     * POST /fdp/interviews — request an interview.
     * Body: { member_id, team_season_id, direction?: 'team'|'youth', notes? }
     *
     *  - direction 'team'  — a team leader asking to interview a youth. Requires
     *    planning.manage on their own team (or fdp.manage), and the youth must have
     *    passed their board of review.
     *  - direction 'youth' — the youth asking a team for an interview. The youth
     *    themselves (or a manager) may do this, and they must be eligible.
     */
    public static function requestInterview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        $tsid = (int)($d['team_season_id'] ?? 0);
        $direction = ($d['direction'] ?? 'team') === 'youth' ? 'youth' : 'team';
        if ($mid <= 0 || $tsid <= 0) return Http::error($res, 'member_id and team_season_id are required.', 422);

        $ts = $pdo->prepare("SELECT id, enrollment_year_from_season FROM (SELECT ts.id,
                               CAST(SUBSTRING_INDEX(ts.season, '-', 1) AS UNSIGNED) AS enrollment_year_from_season
                               FROM team_seasons ts WHERE ts.id = ?) x");
        $ts->execute([$tsid]);
        $team = $ts->fetch();
        if (!$team) return Http::error($res, 'Team season not found.', 404);
        $year = (int)$team['enrollment_year_from_season'];

        // Who is allowed to raise this request.
        if ($direction === 'team') {
            if (!self::canActForTeam($pdo, $cur, $tsid)) {
                return Http::error($res, 'Only a team leader on this team (or an FDP manager) can request an interview.', 403);
            }
        } else {
            $isSelf = ((int)$cur['id'] === $mid);
            if (!$isSelf && !self::canManage($pdo, $cur)) {
                return Http::error($res, 'Only the youth themselves can request an interview with a team.', 403);
            }
        }

        // The board of review is the gate: no interviews before it's passed.
        $prog = self::progressRow($pdo, $mid);
        if (!$prog['eligible_for_interview']) {
            return Http::error($res, 'This youth has not passed their board of review yet, so they are not eligible to interview.', 422);
        }

        // Don't stack duplicate open requests for the same pairing.
        $dupe = $pdo->prepare("SELECT id FROM fdp_interviews
                                WHERE member_id = ? AND team_season_id = ? AND status IN ('requested','scheduled') LIMIT 1");
        $dupe->execute([$mid, $tsid]);
        if ($existing = $dupe->fetchColumn()) {
            return Http::error($res, 'There is already an open interview for this youth and team.', 409);
        }

        $pdo->prepare("INSERT INTO fdp_interviews (member_id, team_season_id, enrollment_year, direction, status,
                        requested_by_id, notes, created_at, updated_at)
                       VALUES (?, ?, ?, ?, 'requested', ?, ?, NOW(), NOW())")
            ->execute([$mid, $tsid, $year, $direction, (int)$cur['id'], ($d['notes'] ?? '') ?: null]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'fdp_interviews', $id, 'create', null,
            ['member_id' => $mid, 'team_season_id' => $tsid, 'direction' => $direction]);
        return Http::json($res, self::serializeInterview(self::interviewRow($pdo, $id) ?? []), 201);
    }

    /**
     * PATCH /fdp/interviews/{id} — schedule it, record the outcome, decline or cancel.
     * The team side (leader on that team, or a manager) drives scheduling and outcome;
     * the youth may decline or cancel their own.
     */
    public static function updateInterview(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $row = self::interviewRow($pdo, (int)$route['id']);
        if (!$row) return Http::error($res, 'Interview not found', 404);

        $isYouth = ((int)$cur['id'] === (int)$row['member_id']);
        $teamSide = self::canActForTeam($pdo, $cur, (int)$row['team_season_id']);
        if (!$isYouth && !$teamSide) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('status', $d)) {
            $st = (string)$d['status'];
            if (!in_array($st, self::INTERVIEW_STATUSES, true)) {
                return Http::error($res, 'status must be one of: ' . implode(', ', self::INTERVIEW_STATUSES), 422);
            }
            // A youth can step away from an interview but can't schedule it or decide
            // its outcome — that's the team's call.
            if (!$teamSide && !in_array($st, ['declined', 'cancelled'], true)) {
                return Http::error($res, 'Only the team can schedule or complete an interview.', 403);
            }
            $set[] = 'status = ?'; $args[] = $st;
        }
        if (array_key_exists('scheduled_at', $d)) {
            if (!$teamSide) return Http::error($res, 'Only the team can schedule an interview.', 403);
            $v = trim((string)($d['scheduled_at'] ?? ''));
            $set[] = 'scheduled_at = ?'; $args[] = $v !== '' ? str_replace('T', ' ', substr($v, 0, 16)) . ':00' : null;
        }
        if (array_key_exists('location', $d) && $teamSide) { $set[] = 'location = ?'; $args[] = trim((string)$d['location']) ?: null; }
        if (array_key_exists('outcome', $d)) {
            if (!$teamSide) return Http::error($res, 'Only the team can record an interview outcome.', 403);
            $o = (string)($d['outcome'] ?? '');
            if ($o !== '' && !in_array($o, self::INTERVIEW_OUTCOMES, true)) {
                return Http::error($res, 'outcome must be one of: ' . implode(', ', self::INTERVIEW_OUTCOMES), 422);
            }
            $set[] = 'outcome = ?'; $args[] = $o !== '' ? $o : null;
        }
        if (array_key_exists('notes', $d)) { $set[] = 'notes = ?'; $args[] = trim((string)$d['notes']) ?: null; }

        if ($set) {
            $set[] = 'updated_at = NOW()';
            $args[] = (int)$row['id'];
            $pdo->prepare("UPDATE fdp_interviews SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$cur['id'], 'fdp_interviews', (int)$row['id'], 'update', null, $d);

        // Notify the youth + family when the team newly schedules the interview.
        if ($teamSide && array_key_exists('scheduled_at', $d) && trim((string)$d['scheduled_at']) !== '') {
            $fresh = self::interviewRow($pdo, (int)$row['id']);
            if ($fresh) {
                $team = trim((string)$fresh['team_number'] . ($fresh['team_name'] ? ' · ' . $fresh['team_name'] : ''));
                $when = date('l, M j \a\t g:i A', strtotime((string)$fresh['scheduled_at']));
                $body = '<p>An interview with <strong>' . htmlspecialchars($team) . '</strong> has been scheduled for <strong>'
                      . htmlspecialchars($when) . '</strong>' . (!empty($fresh['location']) ? ' at ' . htmlspecialchars((string)$fresh['location']) : '') . '.</p>';
                self::emailYouthFamily($pdo, (int)$row['member_id'], 'Interview scheduled with ' . $team, $body);
            }
        }
        return Http::json($res, self::serializeInterview(self::interviewRow($pdo, (int)$row['id']) ?? []));
    }

    /**
     * POST /fdp/interviews/{id}/place — place the youth on this interview's team roster,
     * closing the loop after an offer. Reuses the normal team-join behaviour: the youth's
     * FDP fee is moved to the team's program (best-effort) and a roster row is created, so
     * they drop off every team's eligible list. Team-side only, and only after an offer.
     */
    public static function placeOnTeam(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $row = self::interviewRow($pdo, (int)$route['id']);
        if (!$row) return Http::error($res, 'Interview not found', 404);
        if (!self::canActForTeam($pdo, $cur, (int)$row['team_season_id'])) {
            return Http::error($res, 'Only the team (or an FDP manager) can place a youth on the roster.', 403);
        }
        $mid = (int)$row['member_id']; $tsid = (int)$row['team_season_id'];
        if (($row['outcome'] ?? '') !== 'offered') {
            return Http::error($res, 'Record an offer on this interview before placing the youth on the team.', 422);
        }
        if (self::onTeam($pdo, $mid, $tsid)) {
            return Http::json($res, self::serializeInterview($row));   // already placed → idempotent
        }
        // Move the FDP fee to this team's program first (best-effort, mirrors a normal team add).
        $tq = $pdo->prepare("SELECT ts.season, t.program_id FROM team_seasons ts LEFT JOIN teams t ON t.id = ts.team_id WHERE ts.id = ?");
        $tq->execute([$tsid]); $t = $tq->fetch();
        if ($t && $t['program_id'] !== null) {
            $parts = explode('-', (string)$t['season']);
            $year = ctype_digit($parts[0] ?? '') ? (int)$parts[0] : EnrollmentService::currentEnrollmentYear();
            try { self::transferFeeToProgram($pdo, $mid, (int)$t['program_id'], $year, (int)$cur['id']); }
            catch (\Throwable $e) { error_log('[TRCMS] FDP placement fee transfer failed: ' . $e->getMessage()); }
        }
        $pdo->prepare("INSERT INTO team_member_assignments (team_season_id, member_id, date_joined, status, created_at, updated_at)
                       VALUES (?, ?, ?, 'active', NOW(), NOW())")->execute([$tsid, $mid, date('Y-m-d')]);
        $aid = (int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE fdp_interviews SET status = 'completed', updated_at = NOW() WHERE id = ?")->execute([(int)$row['id']]);
        Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', $aid, 'create', null,
            ['member_id' => $mid, 'team_season_id' => $tsid, 'via' => 'fdp_placement', 'interview_id' => (int)$row['id']]);
        return Http::json($res, self::serializeInterview(self::interviewRow($pdo, (int)$row['id']) ?? []), 201);
    }

    /**
     * GET /fdp/interviews?team_season_id= | ?member_id= — the list behind both
     * dashboards. A team sees its own; a youth (or their parent) sees theirs.
     */
    public static function listInterviews(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $tsid = (int)($q['team_season_id'] ?? 0);
        $mid = (int)($q['member_id'] ?? 0);
        if ($tsid <= 0 && $mid <= 0) return Http::error($res, 'Pass team_season_id or member_id.', 422);

        $where = []; $args = [];
        if ($tsid > 0) {
            // Anyone who can see the team's roster can see its interview schedule.
            if (!self::canActForTeam($pdo, $cur, $tsid) && !self::onTeam($pdo, (int)$cur['id'], $tsid)
                && !Permissions::memberCan($pdo, $cur, 'teams.roster_others', 'read')) {
                return Http::error($res, 'Access denied', 403);
            }
            $where[] = 'i.team_season_id = ?'; $args[] = $tsid;
        }
        if ($mid > 0) {
            $isSelf = ((int)$cur['id'] === $mid);
            $isParent = MembersController::isFamilyParentOf($pdo, $cur, $mid);
            if (!$isSelf && !$isParent && !self::canManage($pdo, $cur)
                && !Permissions::memberCan($pdo, $cur, 'planning.manage', 'write')) {
                return Http::error($res, 'Access denied', 403);
            }
            $where[] = 'i.member_id = ?'; $args[] = $mid;
        }
        $s = $pdo->prepare(
            "SELECT i.*, m.first_name, m.last_name, t.team_number, ts.team_name,
                    rq.first_name AS rq_first, rq.last_name AS rq_last,
                    EXISTS(SELECT 1 FROM team_member_assignments tma WHERE tma.team_season_id = i.team_season_id AND tma.member_id = i.member_id) AS placed
               FROM fdp_interviews i
               JOIN members m ON m.id = i.member_id
               JOIN team_seasons ts ON ts.id = i.team_season_id
               JOIN teams t ON t.id = ts.team_id
               LEFT JOIN members rq ON rq.id = i.requested_by_id
              WHERE " . implode(' AND ', $where) . "
              ORDER BY i.scheduled_at IS NULL, i.scheduled_at, i.id DESC");
        $s->execute($args);
        return Http::json($res, array_map([self::class, 'serializeInterview'], $s->fetchAll()));
    }

    /** POST /fdp/assign — add one member to the FDP for a season. */
    public static function assign(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        $year = (int)($d['year'] ?? 0) ?: EnrollmentService::currentEnrollmentYear();
        if ($mid <= 0) return Http::error($res, 'A member is required.', 400);

        $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?"); $mt->execute([$mid]);
        $type = $mt->fetchColumn();
        if ($type === false) return Http::error($res, 'Member not found', 404);
        if ($type !== 'youth') return Http::error($res, 'The FDP is for youth members.', 400);
        if (self::hasGraduated($pdo, $mid)) {
            return Http::error($res, 'This member has already graduated from the FDP.', 400);
        }
        if (!self::ensureMembership($pdo, $mid, $year, 'manual', (int)$cur['id'])) {
            return Http::error($res, 'This member is already in the FDP for that season.', 400);
        }
        return Http::json($res, ['ok' => true], 201);
    }

    /**
     * POST /fdp/transfer-fee — manually convert a youth's FDP enrollment to FTC or FRC
     * at no additional cost. The single FDP enrollment is re-pointed at the target
     * program by transferFeeToProgram(), carrying its amount due, payment and T&C — so
     * nothing extra is charged. Same operation the team-join auto-transfer performs;
     * this is the on-demand button for staff.
     */
    public static function transferFee(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        $program = strtoupper(trim((string)($d['program'] ?? '')));
        $year = (int)($d['year'] ?? 0) ?: EnrollmentService::currentEnrollmentYear();
        if ($mid <= 0) return Http::error($res, 'A member is required.', 400);
        if (!in_array($program, self::FEEDER_PROGRAMS, true)) {
            return Http::error($res, 'Transfer target must be ' . implode(' or ', self::FEEDER_PROGRAMS) . '.', 400);
        }
        $pid = (int)($pdo->query("SELECT id FROM programs WHERE name = " . $pdo->quote($program))->fetchColumn() ?: 0);
        if (!$pid) return Http::error($res, "The $program program is not set up.", 404);

        $result = self::transferFeeToProgram($pdo, $mid, $pid, $year, (int)$cur['id'], 'by staff (no additional cost)');
        if (!$result['moved']) {
            // Say WHY it couldn't move (no FDP enrollment, or already in the target).
            return Http::error($res, 'Nothing to transfer: ' . $result['reason'] . '.', 400);
        }
        return Http::json($res, ['ok' => true] + $result);
    }

    /** POST /fdp/assign-eligible — add every eligible youth for the season at once. */
    public static function assignEligible(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $year = (int)($d['year'] ?? 0) ?: EnrollmentService::currentEnrollmentYear();

        $added = 0;
        foreach (self::eligibleMissing($pdo, $year) as $e) {
            if (self::ensureMembership($pdo, (int)$e['member_id'], $year, 'bulk', (int)$cur['id'])) $added++;
        }
        Audit::write($pdo, (int)$cur['id'], 'fdp_memberships', null, 'bulk_assign', null, ['year' => $year, 'added' => $added]);
        return Http::json($res, ['ok' => true, 'added' => $added]);
    }

    /** POST /fdp/{id}/graduate — mark a membership graduated (or undo it). */
    public static function graduate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $s = $pdo->prepare("SELECT * FROM fdp_memberships WHERE id = ?"); $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Membership not found', 404);

        $d = (array)$req->getParsedBody();
        $undo = !empty($d['undo']);

        if ($undo) {
            $pdo->prepare("UPDATE fdp_memberships SET status = 'active', graduated_date = NULL,
                           graduated_by_id = NULL, graduated_note = NULL, updated_at = NOW() WHERE id = ?")->execute([$id]);
            Audit::write($pdo, (int)$cur['id'], 'fdp_memberships', $id, 'update', ['status' => $row['status']], ['status' => 'active']);
            return Http::json($res, ['ok' => true, 'status' => 'active']);
        }

        $date = trim((string)($d['graduated_date'] ?? '')) ?: date('Y-m-d');
        $note = trim((string)($d['note'] ?? '')) ?: null;
        $pdo->prepare("UPDATE fdp_memberships SET status = 'graduated', graduated_date = ?, graduated_by_id = ?,
                       graduated_note = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$date, (int)$cur['id'], $note, $id]);
        Audit::write($pdo, (int)$cur['id'], 'fdp_memberships', $id, 'update',
            ['status' => $row['status']], ['status' => 'graduated', 'graduated_date' => $date]);
        return Http::json($res, ['ok' => true, 'status' => 'graduated']);
    }

    /** DELETE /fdp/{id} — remove a membership (assigned by mistake). */
    public static function remove(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $s = $pdo->prepare("SELECT * FROM fdp_memberships WHERE id = ?"); $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Membership not found', 404);
        $pdo->prepare("DELETE FROM fdp_memberships WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'fdp_memberships', $id, 'delete',
            ['member_id' => $row['member_id'], 'enrollment_year' => $row['enrollment_year']], null);
        return Http::json($res, ['ok' => true]);
    }

    /** PATCH /fdp/{id} — update the free-text notes on a membership. */
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $d = (array)$req->getParsedBody();
        if (!array_key_exists('notes', $d)) return Http::json($res, ['ok' => true]);
        $pdo->prepare("UPDATE fdp_memberships SET notes = ?, updated_at = NOW() WHERE id = ?")
            ->execute([trim((string)$d['notes']) ?: null, $id]);
        Audit::write($pdo, (int)$cur['id'], 'fdp_memberships', $id, 'update', null, ['notes' => 'updated']);
        return Http::json($res, ['ok' => true]);
    }
}
