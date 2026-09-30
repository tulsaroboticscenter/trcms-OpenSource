<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\EnrollmentService;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Port of app/modules/reports/router.py — JSON report endpoints.
 * (CSV exports are a later port; the frontend tables use these JSON endpoints.)
 */
final class ReportsController
{
    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return $y . '-' . ($y + 1);
    }

    private static function currentEnrollmentYear(): int
    {
        return EnrollmentService::currentEnrollmentYear();
    }

    /**
     * Report access is governed by Role Permissions. Baseline is the
     * reports.view resource (read); pass $adminOnly for the admin-only reports
     * (e.g. the permissions/usage views), which still require Admin/SysAdmin.
     */
    private static function gate(PDO $pdo, Request $req, string $resource = 'reports.view', string $level = 'read', bool $adminOnly = false): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if ($adminOnly) {
            if (!Permissions::hasAnyRole($pdo, $m, ['Admin', 'System Administrator'])) {
                return ['err' => 403, 'detail' => 'You do not have permission to perform this action'];
            }
            return null;
        }
        if (!Permissions::memberCan($pdo, $m, $resource, $level)) {
            return ['err' => 403, 'detail' => 'You do not have permission to view reports'];
        }
        return null;
    }

    /**
     * GET /reports/youth-special-notes?enrollment_year=&program_id= — the member-side counterpart
     * of the Summer Camp "Special Notes" tab: youth enrolled in a program this season with their
     * medical / allergy / accommodation notes, general special notes, and photo-release status, so
     * staff can see who needs attention at a glance. Filterable by program. Confidential medical PII —
     * requires reports.view AND members.view_medical.
     */
    public static function youthSpecialNotes(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'members.view_medical', 'read')) {
            return Http::error($res, 'You do not have permission to view medical information.', 403);
        }
        $q = $req->getQueryParams();
        $year = !empty($q['enrollment_year']) ? (int)$q['enrollment_year'] : self::currentEnrollmentYear();
        $programId = !empty($q['program_id']) ? (int)$q['program_id'] : null;

        $where = ["e.enrollment_year = ?", "e.status <> 'cancelled'", "m.member_type = 'youth'"];
        $args = [$year];
        if ($programId) { $where[] = "e.program_id = ?"; $args[] = $programId; }
        if (empty($q['include_archived'])) { $where[] = "(m.is_archived = 0 OR m.is_archived IS NULL)"; }
        $clause = 'WHERE ' . implode(' AND ', $where);

        // One row per youth+program enrolled this season, joined to their season medical record.
        $stmt = $pdo->prepare(
            "SELECT DISTINCT m.id AS member_id, m.first_name, m.last_name, m.graduation_year,
                    m.special_notes, e.program_id, p.name AS program, tc.media_release_granted,
                    md.health_problems, md.food_allergies, md.environmental_allergies, md.medication_allergies,
                    md.medications_current, md.accommodations, md.notes AS medical_notes,
                    md.self_administer, md.otc_permission, md.treatment_authorized
               FROM enrollments e
               JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
               LEFT JOIN member_medical md ON md.member_id = m.id AND md.enrollment_year = e.enrollment_year
               LEFT JOIN member_annual_tc tc ON tc.member_id = m.id AND tc.enrollment_year = e.enrollment_year
               $clause
              ORDER BY m.last_name, m.first_name, p.name"
        );
        $stmt->execute($args);
        $rows = [];
        foreach ($stmt->fetchAll() as $r) {
            $gy = $r['graduation_year'] !== null ? (int)$r['graduation_year'] : null;
            $media = $r['media_release_granted']; // NULL not answered, 1 granted, 0 declined
            $rows[] = [
                'member_id' => (int)$r['member_id'],
                'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
                'grade_label' => $gy !== null ? \App\Core\Grade::label(\App\Core\Grade::fromGraduationYear($gy)) : null,
                'program_id' => $r['program_id'] !== null ? (int)$r['program_id'] : null, 'program' => $r['program'],
                'health_problems' => $r['health_problems'], 'medical_notes' => $r['medical_notes'],
                'food_allergies' => $r['food_allergies'], 'environmental_allergies' => $r['environmental_allergies'],
                'medication_allergies' => $r['medication_allergies'], 'medications_current' => $r['medications_current'],
                'accommodations' => $r['accommodations'], 'special_notes' => $r['special_notes'],
                'self_administer' => $r['self_administer'] !== null ? (bool)$r['self_administer'] : null,
                'otc_permission' => $r['otc_permission'],
                'has_medical_record' => $r['treatment_authorized'] !== null || $r['health_problems'] !== null
                    || $r['food_allergies'] !== null || $r['medications_current'] !== null || $r['accommodations'] !== null,
                'media_release' => $media === null ? 'unanswered' : ((int)$media === 1 ? 'granted' : 'declined'),
            ];
        }
        return Http::json($res, ['enrollment_year' => $year, 'program_id' => $programId, 'youth' => $rows]);
    }

    /**
     * Employer matching-gift & grant report. Adults (parents/mentors/volunteers) who have
     * recorded an employer, with the corporate-philanthropy signals TRC can act on:
     * donation matching, volunteer grants ("Dollars for Doers"), and grants a nonprofit can
     * apply for. Gated on members.view_employer. ?only_offers=1 limits to employers that
     * offer at least one of the three.
     */
    public static function employerMatching(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'members.view_employer', 'read')) {
            return Http::error($res, 'You do not have permission to view employer information.', 403);
        }
        $q = $req->getQueryParams();
        $where = [
            "m.member_type IN ('parent','mentor','volunteer')",
            "(m.is_archived = 0 OR m.is_archived IS NULL)",
            "m.employer_name IS NOT NULL AND TRIM(m.employer_name) <> ''",
        ];
        if (!empty($q['only_offers'])) {
            $where[] = "(m.employer_matches_donations = 'yes' OR m.employer_volunteer_grants = 'yes' OR m.employer_offers_grants = 'yes')";
        }
        $clause = 'WHERE ' . implode(' AND ', $where);
        $stmt = $pdo->query(
            "SELECT m.id, m.first_name, m.last_name, m.member_type, m.employer_name, m.employer_job_title,
                    m.employer_matches_donations, m.employer_volunteer_grants, m.employer_offers_grants,
                    m.employer_program_info, m.employer_matching_help, m.employer_notes
               FROM members m $clause
              ORDER BY m.employer_name, m.last_name, m.first_name"
        );
        $rows = [];
        foreach ($stmt->fetchAll() as $r) {
            $rows[] = [
                'member_id' => (int)$r['id'], 'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
                'member_type' => $r['member_type'], 'employer_name' => $r['employer_name'],
                'employer_job_title' => $r['employer_job_title'],
                'matches_donations' => $r['employer_matches_donations'],
                'volunteer_grants' => $r['employer_volunteer_grants'],
                'offers_grants' => $r['employer_offers_grants'],
                'program_info' => $r['employer_program_info'],
                'matching_help' => (bool)$r['employer_matching_help'],
                'notes' => $r['employer_notes'],
            ];
        }
        return Http::json($res, ['people' => $rows]);
    }

    public static function memberDirectory(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $where = ["(m.is_kiosk = false OR m.is_kiosk IS NULL)", "(m.is_system = false OR m.is_system IS NULL)"];
        $args = [];
        $isActive = !isset($q['is_active']) ? true : filter_var($q['is_active'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($isActive !== null) { $where[] = "m.is_active = ?"; $args[] = (int)$isActive; }
        if (!empty($q['member_type'])) { $where[] = "m.member_type = ?"; $args[] = $q['member_type']; }
        if (empty($q['include_archived'])) { $where[] = "(m.is_archived = false OR m.is_archived IS NULL)"; }
        // Currently-enrolled only: drop youth without an active enrollment for the
        // current year (e.g. alumni). Non-youth don't enroll, so they're kept.
        if (!empty($q['enrolled_only']) && filter_var($q['enrolled_only'], FILTER_VALIDATE_BOOLEAN)) {
            $where[] = "(m.member_type <> 'youth' OR EXISTS (
                SELECT 1 FROM enrollments e
                WHERE e.member_id = m.id AND e.enrollment_year = ? AND e.status = 'active'))";
            $args[] = EnrollmentService::currentEnrollmentYear();
        }
        $clause = 'WHERE ' . implode(' AND ', $where);
        $stmt = $pdo->prepare(
            "SELECT m.*,
                    (SELECT f.family_name FROM family_members fm JOIN families f ON f.id = fm.family_id
                     WHERE fm.member_id = m.id ORDER BY fm.is_primary_contact DESC, fm.id LIMIT 1) AS family_name
             FROM members m $clause ORDER BY m.last_name, m.first_name"
        );
        $stmt->execute($args);
        $members = $stmt->fetchAll();

        // active team numbers per member (current + any active assignment)
        $teamStmt = $pdo->prepare(
            "SELECT t.team_number FROM team_member_assignments a
             JOIN team_seasons ts ON ts.id = a.team_season_id
             JOIN teams t ON t.id = ts.team_id
             WHERE a.member_id = ? AND a.status = 'active'"
        );
        $out = [];
        foreach ($members as $m) {
            $teamStmt->execute([(int)$m['id']]);
            $teams = array_column($teamStmt->fetchAll(), 'team_number');
            $out[] = [
                'id' => (int)$m['id'], 'member_number' => $m['member_number'],
                'last_name' => $m['last_name'], 'first_name' => $m['first_name'],
                'member_type' => $m['member_type'], 'email' => $m['email'], 'phone' => $m['phone'],
                'school' => $m['school'], 'guardian1_name' => $m['guardian1_name'],
                'guardian1_phone' => $m['guardian1_phone'], 'guardian1_email' => $m['guardian1_email'],
                'family_name' => $m['family_name'] ?: null,
                'teams' => $teams,
            ];
        }
        return Http::json($res, $out);
    }

    public static function teamList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $season = $q['season'] ?? self::currentSeason();
        $args = [$season];
        $sql = "SELECT ts.*, t.team_number, p.name AS program FROM team_seasons ts
                JOIN teams t ON t.id = ts.team_id LEFT JOIN programs p ON p.id = t.program_id
                WHERE ts.season = ?";
        if (!empty($q['program_id'])) { $sql .= " AND t.program_id = ?"; $args[] = (int)$q['program_id']; }
        $sql .= " ORDER BY ts.team_id";
        $stmt = $pdo->prepare($sql); $stmt->execute($args);
        // Only current roster members — a youth who dropped ('not_active') or transferred to
        // another team is left off the list, not just dimmed.
        $memStmt = $pdo->prepare(
            "SELECT a.*, m.first_name, m.last_name, m.member_type, m.is_archived, m.is_active, m.shirt_size
             FROM team_member_assignments a JOIN members m ON m.id = a.member_id
             WHERE a.team_season_id = ? AND a.status NOT IN ('not_active', 'transferred')"
        );
        $out = [];
        foreach ($stmt->fetchAll() as $ts) {
            $memStmt->execute([(int)$ts['id']]);
            $members = []; $shirtTally = [];
            foreach ($memStmt->fetchAll() as $a) {
                if (empty($q['include_archived']) && !empty($a['is_archived'])) continue;
                // Leave off members who are no longer active (unless explicitly included).
                if (empty($q['include_inactive']) && isset($a['is_active']) && !$a['is_active']) continue;
                // FIRST-YPP flags come from the mentor's own compliance record (null for youth).
                $f = ($a['member_type'] ?? '') === 'youth' ? null : \App\Core\ComplianceService::memberFirstFlags($pdo, (int)$a['member_id']);
                $shirt = trim((string)($a['shirt_size'] ?? ''));
                if ($shirt !== '') $shirtTally[$shirt] = ($shirtTally[$shirt] ?? 0) + 1;
                $members[] = [
                    'member_id' => (int)$a['member_id'], 'first_name' => $a['first_name'], 'last_name' => $a['last_name'],
                    'member_type' => $a['member_type'], 'status' => $a['status'], 'primary_role' => $a['primary_role'],
                    'shirt_size' => $shirt !== '' ? $shirt : null,
                    'registered_on_first' => $f ? $f['first'] : null,
                    'first_consent_release' => $f ? $f['consent_release'] : null,
                    'background_check' => $f ? $f['background_check'] : null,
                    'ypt' => $f ? $f['ypt'] : null,
                    'role_specific' => $f ? $f['role_specific'] : null,
                ];
            }
            $out[] = [
                'team_number' => $ts['team_number'], 'team_name' => $ts['team_name'],
                'program' => $ts['program'], 'season' => $ts['season'], 'status' => $ts['status'],
                'members' => $members,
                'shirt_tally' => self::orderShirtTally($shirtTally),
            ];
        }
        // FDP roster as its own group (skipped when filtering to a specific competition program).
        if (empty($q['program_id']) && ($fdp = self::fdpGroup($pdo, $season, $q))) $out[] = $fdp;
        return Http::json($res, $out);
    }

    /** Build a CSV download Response from a header row plus data rows (RFC-4180 quoting). */
    /**
     * The FDP roster as a pseudo-team for the Team List report — FDP membership lives in
     * fdp_memberships (per enrollment_year), not team_seasons, so it's assembled separately here
     * in the same shape as a team entry (members + shirt tally). Null when it has no members.
     */
    private static function fdpGroup(PDO $pdo, string $season, array $q): ?array
    {
        $year = (int)substr($season, 0, 4);
        if ($year < 2000) $year = EnrollmentService::currentEnrollmentYear();
        $s = $pdo->prepare(
            "SELECT f.member_id, f.status AS fdp_status, m.first_name, m.last_name, m.member_type,
                    m.is_archived, m.is_active, m.shirt_size
               FROM fdp_memberships f JOIN members m ON m.id = f.member_id
              WHERE f.enrollment_year = ?
              ORDER BY m.last_name, m.first_name");
        $s->execute([$year]);
        $members = []; $tally = [];
        foreach ($s->fetchAll() as $a) {
            if (empty($q['include_archived']) && !empty($a['is_archived'])) continue;
            if (empty($q['include_inactive']) && isset($a['is_active']) && !$a['is_active']) continue;
            $f = ($a['member_type'] ?? '') === 'youth' ? null : \App\Core\ComplianceService::memberFirstFlags($pdo, (int)$a['member_id']);
            $shirt = trim((string)($a['shirt_size'] ?? ''));
            if ($shirt !== '') $tally[$shirt] = ($tally[$shirt] ?? 0) + 1;
            $members[] = [
                'member_id' => (int)$a['member_id'], 'first_name' => $a['first_name'], 'last_name' => $a['last_name'],
                'member_type' => $a['member_type'], 'status' => $a['fdp_status'] ?: 'active', 'primary_role' => null,
                'shirt_size' => $shirt !== '' ? $shirt : null,
                'registered_on_first' => $f ? $f['first'] : null,
                'first_consent_release' => $f ? $f['consent_release'] : null,
                'background_check' => $f ? $f['background_check'] : null,
                'ypt' => $f ? $f['ypt'] : null,
                'role_specific' => $f ? $f['role_specific'] : null,
            ];
        }
        if (!$members) return null;
        return ['team_number' => 'FDP', 'team_name' => 'FDP (Fundamentals of Design Program)',
                'program' => 'FDP', 'season' => $season, 'status' => 'active',
                'members' => $members, 'shirt_tally' => self::orderShirtTally($tally)];
    }

    /** Order a shirt-size count map into [{size,count}] using the canonical size sequence; unknowns last. */
    private static function orderShirtTally(array $tally): array
    {
        $order = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL', 'A3XL'];
        uksort($tally, function ($a, $b) use ($order) {
            $ia = array_search($a, $order, true); $ib = array_search($b, $order, true);
            $ia = $ia === false ? PHP_INT_MAX : $ia; $ib = $ib === false ? PHP_INT_MAX : $ib;
            return $ia === $ib ? strcmp((string)$a, (string)$b) : $ia <=> $ib;
        });
        $out = [];
        foreach ($tally as $size => $count) $out[] = ['size' => $size, 'count' => (int)$count];
        return $out;
    }

    private static function csvResponse(Response $res, string $filename, array $header, array $rows): Response
    {
        // Security #12: neutralize formula injection first, then apply CSV quoting.
        $esc = function ($v) {
            $s = \App\Core\Csv::formulaSafe($v);
            return preg_match('/[",\r\n]/', $s) ? '"' . str_replace('"', '""', $s) . '"' : $s;
        };
        $csv = implode(',', array_map($esc, $header)) . "\r\n";
        foreach ($rows as $row) $csv .= implode(',', array_map($esc, $row)) . "\r\n";
        $res->getBody()->write($csv);
        return $res->withHeader('Content-Type', 'text/csv')
                   ->withHeader('Content-Disposition', 'attachment; filename=' . $filename);
    }

    /** GET /reports/team-list/csv — per-team rosters (one row per member) for a season. */
    public static function teamListCsv(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $season = $q['season'] ?? self::currentSeason();
        $args = [$season];
        $sql = "SELECT ts.*, t.team_number, p.name AS program FROM team_seasons ts
                JOIN teams t ON t.id = ts.team_id LEFT JOIN programs p ON p.id = t.program_id
                WHERE ts.season = ?";
        if (!empty($q['program_id'])) { $sql .= " AND t.program_id = ?"; $args[] = (int)$q['program_id']; }
        $sql .= " ORDER BY ts.team_id";
        $stmt = $pdo->prepare($sql); $stmt->execute($args);
        $memStmt = $pdo->prepare(
            "SELECT a.*, m.first_name, m.last_name, m.member_type, m.is_archived, m.is_active, m.shirt_size
             FROM team_member_assignments a JOIN members m ON m.id = a.member_id
             WHERE a.team_season_id = ? AND a.status NOT IN ('not_active', 'transferred')
             ORDER BY m.last_name, m.first_name");
        $rows = [];
        foreach ($stmt->fetchAll() as $ts) {
            $memStmt->execute([(int)$ts['id']]);
            $any = false; $tally = [];
            foreach ($memStmt->fetchAll() as $a) {
                if (empty($q['include_archived']) && !empty($a['is_archived'])) continue;
                if (empty($q['include_inactive']) && isset($a['is_active']) && !$a['is_active']) continue;
                $any = true;
                $shirt = trim((string)($a['shirt_size'] ?? ''));
                if ($shirt !== '') $tally[$shirt] = ($tally[$shirt] ?? 0) + 1;
                $rows[] = [$ts['team_number'], $ts['team_name'], $ts['program'], $ts['season'], $ts['status'],
                    trim($a['first_name'] . ' ' . $a['last_name']), $a['member_type'], $a['status'], $a['primary_role'], $shirt];
            }
            // A team with no (non-archived) members still gets a row so it appears in the export.
            if (!$any) $rows[] = [$ts['team_number'], $ts['team_name'], $ts['program'], $ts['season'], $ts['status'], '', '', '', '', ''];
            // Per-team shirt-size summary row (blank member columns), for ordering.
            $summary = implode(', ', array_map(fn($t) => "{$t['size']}×{$t['count']}", self::orderShirtTally($tally)));
            $rows[] = [$ts['team_number'], $ts['team_name'], $ts['program'], $ts['season'], $ts['status'], 'SHIRT SIZE TOTALS', '', '', '', $summary];
        }
        // FDP roster as its own group (skipped when filtering to a specific competition program).
        if (empty($q['program_id']) && ($fdp = self::fdpGroup($pdo, $season, $q))) {
            foreach ($fdp['members'] as $m) {
                $rows[] = [$fdp['team_number'], $fdp['team_name'], $fdp['program'], $fdp['season'], $fdp['status'],
                    trim($m['first_name'] . ' ' . $m['last_name']), $m['member_type'], $m['status'], '', $m['shirt_size'] ?? ''];
            }
            $fSummary = implode(', ', array_map(fn($t) => "{$t['size']}×{$t['count']}", $fdp['shirt_tally']));
            $rows[] = [$fdp['team_number'], $fdp['team_name'], $fdp['program'], $fdp['season'], $fdp['status'], 'SHIRT SIZE TOTALS', '', '', '', $fSummary];
        }
        return self::csvResponse($res, "team-list-$season.csv",
            ['Team Number', 'Team Name', 'Program', 'Season', 'Team Status', 'Member', 'Member Type', 'Assignment Status', 'Primary Role', 'Shirt Size'], $rows);
    }

    /** GET /reports/member-directory/csv — one row per member. */
    public static function memberDirectoryCsv(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $where = ["(m.is_kiosk = false OR m.is_kiosk IS NULL)", "(m.is_system = false OR m.is_system IS NULL)"];
        $args = [];
        $isActive = !isset($q['is_active']) ? true : filter_var($q['is_active'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($isActive !== null) { $where[] = "m.is_active = ?"; $args[] = (int)$isActive; }
        if (!empty($q['member_type'])) { $where[] = "m.member_type = ?"; $args[] = $q['member_type']; }
        if (empty($q['include_archived'])) { $where[] = "(m.is_archived = false OR m.is_archived IS NULL)"; }
        if (!empty($q['enrolled_only']) && filter_var($q['enrolled_only'], FILTER_VALIDATE_BOOLEAN)) {
            $where[] = "(m.member_type <> 'youth' OR EXISTS (SELECT 1 FROM enrollments e WHERE e.member_id = m.id AND e.enrollment_year = ? AND e.status = 'active'))";
            $args[] = EnrollmentService::currentEnrollmentYear();
        }
        $clause = 'WHERE ' . implode(' AND ', $where);
        $stmt = $pdo->prepare(
            "SELECT m.*, (SELECT f.family_name FROM family_members fm JOIN families f ON f.id = fm.family_id
                          WHERE fm.member_id = m.id ORDER BY fm.is_primary_contact DESC, fm.id LIMIT 1) AS family_name
             FROM members m $clause ORDER BY m.last_name, m.first_name");
        $stmt->execute($args);
        $teamStmt = $pdo->prepare(
            "SELECT t.team_number FROM team_member_assignments a
             JOIN team_seasons ts ON ts.id = a.team_season_id JOIN teams t ON t.id = ts.team_id
             WHERE a.member_id = ? AND a.status = 'active'");
        $rows = [];
        foreach ($stmt->fetchAll() as $m) {
            $teamStmt->execute([(int)$m['id']]);
            $teams = implode(' ', array_column($teamStmt->fetchAll(), 'team_number'));
            $rows[] = [$m['member_number'], $m['last_name'], $m['first_name'], $m['member_type'], $m['email'], $m['phone'],
                $m['school'], $m['guardian1_name'], $m['guardian1_phone'], $m['guardian1_email'], $m['family_name'] ?: '', $teams];
        }
        return self::csvResponse($res, "member-directory.csv",
            ['Member #', 'Last Name', 'First Name', 'Type', 'Email', 'Phone', 'School', 'Guardian', 'Guardian Phone', 'Guardian Email', 'Family', 'Teams'], $rows);
    }

    /** Clean membership-lifecycle label from the raw enrollment.status — keeps payment words ('paid') out. */
    private static function membershipStatusLabel(?string $status): string
    {
        return match ($status) {
            'active', 'paid' => 'Active',
            'pending'        => 'Pending',
            'expired'        => 'Expired',
            'not_active'     => 'Inactive',
            'cancelled'      => 'Cancelled',
            default          => $status ? ucfirst($status) : '—',
        };
    }

    /** Payment status — Paid / Scholarship / Partial / Pending — from the settled/credit signals. */
    private static function paymentStatusLabel(bool $override, bool $covered, float $credit, ?string $datePayment, float $paid): string
    {
        if ($override) return 'Paid';
        $hasCash = !empty($datePayment) || $paid > 0.005;
        if ($covered) return ($credit > 0.005 && !$hasCash) ? 'Scholarship' : 'Paid';
        return $hasCash ? 'Partial' : 'Pending';
    }

    /** GET /reports/enrollment-status/csv — one row per enrollment (admin only, mirrors the JSON report). */
    public static function enrollmentStatusCsv(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req, 'reports.view', 'read', true)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $year = !empty($q['enrollment_year']) ? (int)$q['enrollment_year'] : self::currentEnrollmentYear();
        $includeInactive = filter_var($q['include_inactive'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $stmt = $pdo->prepare(
            "SELECT e.*, m.member_number, m.first_name, m.last_name, m.is_archived, m.is_active, m.shirt_size AS member_shirt_size, p.name AS program
             FROM enrollments e JOIN members m ON m.id = e.member_id LEFT JOIN programs p ON p.id = e.program_id
             WHERE e.enrollment_year = ? ORDER BY m.last_name, m.first_name, e.program_id");
        $stmt->execute([$year]);
        $credits = [];
        $cs = $pdo->prepare("SELECT enrollment_id, SUM(amount) AS c FROM scholarship_awards
                              WHERE enrollment_year = ? AND status = 'applied' AND enrollment_id IS NOT NULL GROUP BY enrollment_id");
        $cs->execute([$year]);
        foreach ($cs->fetchAll() as $r) $credits[(int)$r['enrollment_id']] = round((float)$r['c'], 2);
        $rows = [];
        foreach ($stmt->fetchAll() as $e) {
            if (empty($q['include_archived']) && !empty($e['is_archived'])) continue;
            if (!$includeInactive && isset($e['is_active']) && (int)$e['is_active'] === 0) continue;
            $ty = (bool)$e['tc_youth_agreed']; $tp = (bool)$e['tc_parent_agreed'];
            $amountDue = $e['amount_due'] !== null ? (float)$e['amount_due'] : null;
            $balance = $amountDue !== null ? round($amountDue - (float)($e['payment_amount'] ?? 0), 2) : null;
            $settled = $balance !== null ? ($balance <= 0.005 ? 'Yes' : 'No') : '';
            $credit = (float)($credits[(int)$e['id']] ?? 0);
            $covered = $balance !== null ? ($balance <= 0.005) : false;
            $membership = self::membershipStatusLabel($e['status']);
            $payStatus = self::paymentStatusLabel((bool)$e['payment_override'], $covered, $credit, $e['date_payment'], (float)($e['payment_amount'] ?? 0));
            $rows[] = [$e['member_number'], $e['last_name'], $e['first_name'], $e['program'], $membership, $payStatus,
                $e['amount_due'], $e['payment_amount'], $credit, $balance, $settled, $e['payment_method'], $e['scholarship_fund'],
                $e['member_shirt_size'], $ty ? 'Yes' : 'No', $tp ? 'Yes' : 'No', ($ty && $tp) ? 'Yes' : 'No'];
        }
        return self::csvResponse($res, "enrollment-$year.csv",
            ['Member #', 'Last Name', 'First Name', 'Program', 'Membership', 'Payment Status', 'Amount Due', 'Paid', 'Scholarship', 'Balance', 'Settled', 'Method', 'Scholarship Fund', 'Shirt Size', 'Youth T&C', 'Parent T&C', 'Fully Signed'], $rows);
    }

    /** GET /reports/activity-impact/csv — hours per member. */
    public static function activityImpactCsv(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $memberId = !empty($q['member_id']) ? (int)$q['member_id'] : null;
        $where = []; $args = [];
        if (!empty($q['season'])) { $where[] = "season = ?"; $args[] = $q['season']; }
        if (!empty($q['from_date'])) { $where[] = "entry_date >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where[] = "entry_date <= ?"; $args[] = $q['to_date']; }
        if ($memberId) { $where[] = "member_id = ?"; $args[] = $memberId; }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $stmt = $pdo->prepare("SELECT member_id, minutes, is_volunteer FROM time_entries $clause");
        $stmt->execute($args);
        $perMember = [];
        foreach ($stmt->fetchAll() as $e) {
            $mid = (int)$e['member_id'];
            $perMember[$mid] ??= ['total' => 0, 'vol' => 0, 'checkin' => 0];
            $perMember[$mid]['total'] += (int)$e['minutes'];
            if ($e['is_volunteer']) $perMember[$mid]['vol'] += (int)$e['minutes'];
        }
        // Include unlogged check-in presence so totals match the on-screen report / My Time.
        [$cFrom, $cTo] = \App\Controllers\ActivityController::checkinWindow($q);
        $cWhere = "c.time_out IS NOT NULL AND c.id NOT IN (SELECT checkin_id FROM time_entries WHERE checkin_id IS NOT NULL)";
        $cArgs = [];
        if ($memberId) { $cWhere .= " AND c.member_id = ?"; $cArgs[] = $memberId; }
        if ($cFrom) { $cWhere .= " AND c.time_in >= ?"; $cArgs[] = $cFrom; }
        if ($cTo)   { $cWhere .= " AND c.time_in <= ?"; $cArgs[] = $cTo; }
        $cstmt = $pdo->prepare("SELECT c.member_id, COALESCE(SUM(" . \App\Controllers\ActivityController::checkinMinutesSql('c') . "),0) AS m FROM checkins c WHERE $cWhere GROUP BY c.member_id");
        $cstmt->execute($cArgs);
        foreach ($cstmt->fetchAll() as $r) {
            $mid = (int)$r['member_id']; $m = (int)$r['m'];
            if ($m <= 0) continue;
            $perMember[$mid] ??= ['total' => 0, 'vol' => 0, 'checkin' => 0];
            $perMember[$mid]['checkin'] += $m;
        }
        $rows = [];
        if ($perMember) {
            $ids = implode(',', array_map('intval', array_keys($perMember)));
            $mrows = $pdo->query("SELECT id, member_number, first_name, last_name, member_type FROM members WHERE id IN ($ids)")->fetchAll();
            $mmap = []; foreach ($mrows as $m) $mmap[(int)$m['id']] = $m;
            foreach ($perMember as $mid => $agg) {
                $m = $mmap[$mid] ?? null; if (!$m) continue;
                $isVol = in_array($m['member_type'], ['mentor', 'volunteer'], true);
                $totalMin = $agg['total'] + $agg['checkin'];
                $volMin = $agg['vol'] + ($isVol ? $agg['checkin'] : 0);
                $rows[] = [$m['member_number'], $m['last_name'], $m['first_name'], $m['member_type'],
                    round($totalMin / 60, 1), round($volMin / 60, 1)];
            }
            usort($rows, fn ($a, $b) => $b[4] <=> $a[4]);
        }
        return self::csvResponse($res, "activity-impact.csv",
            ['Member #', 'Last Name', 'First Name', 'Type', 'Total Hours', 'Volunteer Hours'], $rows);
    }

    public static function enrollmentStatus(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req, 'reports.view', 'read', true)) return Http::error($res, $g['detail'], $g['err']);  // admin only
        $q = $req->getQueryParams();
        $year = !empty($q['enrollment_year']) ? (int)$q['enrollment_year'] : self::currentEnrollmentYear();
        $includeInactive = filter_var($q['include_inactive'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $stmt = $pdo->prepare(
            "SELECT e.*, m.member_number, m.first_name, m.last_name, m.is_archived, m.is_active, m.shirt_size AS member_shirt_size, p.name AS program
             FROM enrollments e JOIN members m ON m.id = e.member_id
             LEFT JOIN programs p ON p.id = e.program_id
             WHERE e.enrollment_year = ? ORDER BY e.member_id, e.program_id"
        );
        $stmt->execute([$year]);
        // Active scholarship credits per enrollment for the season, so a fee covered by a
        // scholarship reads as settled (not "unpaid") — a scholarship lowers amount_due but
        // isn't a cash payment, so date_payment stays empty.
        $credits = [];
        $cs = $pdo->prepare("SELECT enrollment_id, SUM(amount) AS c FROM scholarship_awards
                              WHERE enrollment_year = ? AND status = 'applied' AND enrollment_id IS NOT NULL
                           GROUP BY enrollment_id");
        $cs->execute([$year]);
        foreach ($cs->fetchAll() as $r) $credits[(int)$r['enrollment_id']] = round((float)$r['c'], 2);
        $out = [];
        foreach ($stmt->fetchAll() as $e) {
            if (empty($q['include_archived']) && !empty($e['is_archived'])) continue;
            if (!$includeInactive && isset($e['is_active']) && (int)$e['is_active'] === 0) continue;
            $ty = (bool)$e['tc_youth_agreed']; $tp = (bool)$e['tc_parent_agreed'];
            $amountDue = $e['amount_due'] !== null ? (float)$e['amount_due'] : null;
            $paid = $e['payment_amount'] !== null ? (float)$e['payment_amount'] : 0.0;
            $balance = $amountDue !== null ? round($amountDue - $paid, 2) : null;
            $credit = $credits[(int)$e['id']] ?? 0.0;
            $covered = $balance !== null ? ($balance <= 0.005) : false;
            $out[] = [
                'member_id' => (int)$e['member_id'], 'member_number' => $e['member_number'],
                'first_name' => $e['first_name'], 'last_name' => $e['last_name'], 'program' => $e['program'],
                'status' => $e['status'], 'date_enrolled' => $e['date_enrolled'], 'date_payment' => $e['date_payment'],
                'membership_status' => self::membershipStatusLabel($e['status']),
                'payment_status' => self::paymentStatusLabel((bool)$e['payment_override'], $covered, (float)$credit, $e['date_payment'], $paid),
                'payment_amount' => $e['payment_amount'] !== null ? (float)$e['payment_amount'] : null,
                'payment_override' => isset($e['payment_override']) ? (bool)$e['payment_override'] : null,
                'payment_method' => $e['payment_method'], 'scholarship_fund' => $e['scholarship_fund'],
                'amount_due' => $amountDue, 'balance' => $balance, 'scholarship_credit' => $credit,
                'covered' => $covered,
                'is_active' => isset($e['is_active']) ? (bool)$e['is_active'] : true,
                'shirt_size' => $e['member_shirt_size'], 'tc_youth_agreed' => $ty, 'tc_parent_agreed' => $tp,
                'fully_signed' => $ty && $tp,
            ];
        }
        return Http::json($res, ['enrollment_year' => $year, 'enrollments' => $out]);
    }

    public static function attendanceSummary(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $where = ["c.time_out IS NOT NULL"]; $args = [];
        if (!empty($q['from_date'])) { $where[] = "date(c.time_in) >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where[] = "date(c.time_in) <= ?"; $args[] = $q['to_date']; }
        // Scope to one member, or to a team's roster (with an optional mentors/adults toggle).
        if (!empty($q['member_id'])) { $where[] = "c.member_id = ?"; $args[] = (int)$q['member_id']; }
        if (!empty($q['team_season_id'])) {
            $where[] = "c.member_id IN (SELECT member_id FROM team_member_assignments WHERE team_season_id = ?)";
            $args[] = (int)$q['team_season_id'];
        }
        // include_mentors defaults to true; when explicitly off, drop mentors/adults (youth only).
        if (isset($q['include_mentors']) && in_array(strtolower((string)$q['include_mentors']), ['0', 'false', 'no'], true)) {
            $where[] = "m.member_type NOT IN ('mentor', 'parent', 'volunteer')";
        }
        $clause = 'WHERE ' . implode(' AND ', $where);
        $stmt = $pdo->prepare(
            "SELECT c.member_id, count(c.id) AS checkin_count,
                    sum(TIMESTAMPDIFF(SECOND, c.time_in, c.time_out) / 3600.0) AS total_hours,
                    m.member_number, m.first_name, m.last_name, m.member_type, m.is_archived
             FROM checkins c JOIN members m ON m.id = c.member_id
             $clause GROUP BY c.member_id, m.member_number, m.first_name, m.last_name, m.member_type, m.is_archived"
        );
        $stmt->execute($args);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            if (empty($q['include_archived']) && !empty($r['is_archived'])) continue;
            $out[] = [
                'member_id' => (int)$r['member_id'], 'member_number' => $r['member_number'],
                'first_name' => $r['first_name'], 'last_name' => $r['last_name'], 'member_type' => $r['member_type'],
                'checkin_count' => (int)$r['checkin_count'], 'total_hours' => round((float)$r['total_hours'], 1),
            ];
        }
        usort($out, fn($a, $b) => [$b['checkin_count'], $a['last_name']] <=> [$a['checkin_count'], $b['last_name']]);
        return Http::json($res, $out);
    }

    /**
     * GET /reports/not-checked-in — re-engagement list: active members who did
     * NOT check in at all during the filtered window (with last-seen + contact),
     * so we can follow up ("we've been missing you"). Same filters as Attendance
     * Summary. Sorted longest-absent first.
     */
    public static function notCheckedIn(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();

        $to = !empty($q['to_date']) ? (string)$q['to_date'] : date('Y-m-d');
        $from = !empty($q['from_date']) ? (string)$q['from_date'] : date('Y-m-d', strtotime('-30 days', strtotime($to)));

        // Only active, non-archived members belong on the Not Attending report. (is_archived is
        // nullable, so match NULL as not-archived rather than dropping those members.)
        $where = ['m.is_active = 1', '(m.is_archived = 0 OR m.is_archived IS NULL)'];
        $args = [];
        // Youth-only toggle (include_mentors default true, like Attendance Summary).
        if (isset($q['include_mentors']) && in_array(strtolower((string)$q['include_mentors']), ['0', 'false', 'no'], true)) {
            $where[] = "m.member_type NOT IN ('mentor','parent','volunteer')";
        }
        // Exclude station/kiosk/system accounts.
        $where[] = "(m.is_kiosk = 0 OR m.is_kiosk IS NULL)";
        $where[] = "(m.is_system = 0 OR m.is_system IS NULL)";
        if (!empty($q['member_type'])) { $where[] = "m.member_type = ?"; $args[] = (string)$q['member_type']; }
        if (!empty($q['team_season_id'])) {
            $where[] = "m.id IN (SELECT member_id FROM team_member_assignments WHERE team_season_id = ?)";
            $args[] = (int)$q['team_season_id'];
        }
        // The core condition: no check-in within the window.
        $where[] = "m.id NOT IN (SELECT c.member_id FROM checkins c WHERE DATE(c.time_in) BETWEEN ? AND ?)";
        $args[] = $from; $args[] = $to;

        $sql = "SELECT m.id, m.member_number, m.first_name, m.last_name, m.member_type,
                       m.email, m.phone, m.guardian1_name, m.guardian1_email, m.guardian1_phone,
                       (SELECT MAX(c2.time_in) FROM checkins c2 WHERE c2.member_id = m.id) AS last_checkin
                  FROM members m
                 WHERE " . implode(' AND ', $where);
        $st = $pdo->prepare($sql);
        $st->execute($args);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $last = $r['last_checkin'];
            $daysSince = $last ? (int)floor((strtotime($to) - strtotime((string)$last)) / 86400) : null;
            $out[] = [
                'member_id' => (int)$r['id'], 'member_number' => $r['member_number'],
                'first_name' => $r['first_name'], 'last_name' => $r['last_name'], 'member_type' => $r['member_type'],
                'email' => $r['email'], 'phone' => $r['phone'],
                'guardian1_name' => $r['guardian1_name'], 'guardian1_email' => $r['guardian1_email'], 'guardian1_phone' => $r['guardian1_phone'],
                'last_checkin' => $last ? substr((string)$last, 0, 10) : null,
                'days_since' => $daysSince,
            ];
        }
        // Longest-absent first (never-attended at the top), then by name.
        usort($out, function ($a, $b) {
            $ax = $a['days_since'] ?? PHP_INT_MAX;
            $bx = $b['days_since'] ?? PHP_INT_MAX;
            return $bx <=> $ax ?: strcmp((string)$a['last_name'], (string)$b['last_name']);
        });
        return Http::json($res, ['from' => $from, 'to' => $to, 'members' => $out]);
    }

    public static function activityImpact(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $memberId = !empty($q['member_id']) ? (int)$q['member_id'] : null;
        $where = []; $args = [];
        if (!empty($q['season'])) { $where[] = "season = ?"; $args[] = $q['season']; }
        if (!empty($q['from_date'])) { $where[] = "entry_date >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where[] = "entry_date <= ?"; $args[] = $q['to_date']; }
        if ($memberId) { $where[] = "member_id = ?"; $args[] = $memberId; }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $stmt = $pdo->prepare("SELECT member_id, minutes, area, is_volunteer FROM time_entries $clause");
        $stmt->execute($args);
        $byArea = []; $perMember = [];
        foreach ($stmt->fetchAll() as $e) {
            $min = (int)$e['minutes'];
            $a = $e['area'] ?: 'Uncategorized';
            $byArea[$a] = ($byArea[$a] ?? 0) + $min;
            $mid = (int)$e['member_id'];
            $perMember[$mid] ??= ['total' => 0, 'vol' => 0, 'checkin' => 0];
            $perMember[$mid]['total'] += $min;
            if ($e['is_volunteer']) $perMember[$mid]['vol'] += $min;
        }

        // Add presence time from completed check-ins that weren't separately logged as an entry,
        // so totals match each member's My Time / check-in card (same rule as memberSummary).
        [$cFrom, $cTo] = \App\Controllers\ActivityController::checkinWindow($q);
        $cWhere = "c.time_out IS NOT NULL AND c.id NOT IN (SELECT checkin_id FROM time_entries WHERE checkin_id IS NOT NULL)";
        $cArgs = [];
        if ($memberId) { $cWhere .= " AND c.member_id = ?"; $cArgs[] = $memberId; }
        if ($cFrom) { $cWhere .= " AND c.time_in >= ?"; $cArgs[] = $cFrom; }
        if ($cTo)   { $cWhere .= " AND c.time_in <= ?"; $cArgs[] = $cTo; }
        $cstmt = $pdo->prepare("SELECT c.member_id, COALESCE(SUM(" . \App\Controllers\ActivityController::checkinMinutesSql('c') . "),0) AS m FROM checkins c WHERE $cWhere GROUP BY c.member_id");
        $cstmt->execute($cArgs);
        $totalCheckin = 0;
        foreach ($cstmt->fetchAll() as $r) {
            $mid = (int)$r['member_id']; $m = (int)$r['m'];
            if ($m <= 0) continue;
            $perMember[$mid] ??= ['total' => 0, 'vol' => 0, 'checkin' => 0];
            $perMember[$mid]['checkin'] += $m;
            $totalCheckin += $m;
        }
        if ($totalCheckin > 0) $byArea['Check-ins'] = ($byArea['Check-ins'] ?? 0) + $totalCheckin;

        $total = 0; $vol = 0; $byType = []; $members = [];
        if ($perMember) {
            $ids = implode(',', array_map('intval', array_keys($perMember)));
            $mrows = $pdo->query("SELECT id, member_number, first_name, last_name, member_type FROM members WHERE id IN ($ids)")->fetchAll();
            $mmap = [];
            foreach ($mrows as $m) $mmap[(int)$m['id']] = $m;
            foreach ($perMember as $mid => $agg) {
                $m = $mmap[$mid] ?? null; if (!$m) continue;
                // Presence time counts toward volunteer hours only for mentors/volunteers.
                $isVol = in_array($m['member_type'], ['mentor', 'volunteer'], true);
                $totalMin = $agg['total'] + $agg['checkin'];
                $volMin = $agg['vol'] + ($isVol ? $agg['checkin'] : 0);
                $total += $totalMin; $vol += $volMin;
                $byType[$m['member_type']] = ($byType[$m['member_type']] ?? 0) + $totalMin;
                $members[] = [
                    'member_id' => $mid, 'member_number' => $m['member_number'],
                    'first_name' => $m['first_name'], 'last_name' => $m['last_name'], 'member_type' => $m['member_type'],
                    'total_hours' => round($totalMin / 60, 1), 'volunteer_hours' => round($volMin / 60, 1),
                ];
            }
            usort($members, fn($a, $b) => $b['total_hours'] <=> $a['total_hours']);
        }
        arsort($byArea); arsort($byType);
        $areaOut = []; foreach ($byArea as $a => $mn) $areaOut[] = ['area' => $a, 'hours' => round($mn / 60, 1)];
        $typeOut = []; foreach ($byType as $t => $mn) $typeOut[] = ['member_type' => $t, 'hours' => round($mn / 60, 1)];
        return Http::json($res, [
            'total_hours' => round($total / 60, 1), 'volunteer_hours' => round($vol / 60, 1),
            'by_area' => $areaOut, 'by_member_type' => $typeOut, 'members' => $members,
        ]);
    }

    /**
     * GET /reports/permissions — every (non-kiosk, non-system) member with their
     * effective roles and resolved per-module access level. Admin-only, since it
     * exposes the whole access map. Read-only.
     */
    public static function permissionsReport(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req, 'reports.view', 'read', true)) return Http::error($res, $g['detail'], $g['err']);

        $modules = [];
        foreach (Permissions::catalog() as $mid => $mod) {
            $modules[] = ['id' => $mid, 'label' => $mod['label'] ?? $mid];
        }

        $rows = $pdo->query(
            "SELECT * FROM members
             WHERE (is_kiosk = false OR is_kiosk IS NULL)
               AND (is_system = false OR is_system IS NULL)
               AND (is_archived = false OR is_archived IS NULL)
             ORDER BY last_name, first_name"
        )->fetchAll();

        $members = [];
        foreach ($rows as $m) {
            $resolved = Permissions::memberResourceLevel($pdo, $m);
            $members[] = [
                'id' => (int)$m['id'],
                'name' => trim(($m['last_name'] ?? '') . ', ' . ($m['first_name'] ?? ''), ', '),
                'member_type' => $m['member_type'],
                'is_active' => (bool)$m['is_active'],
                'is_super' => !empty($resolved['is_super']),
                'roles' => Permissions::effectiveRolesFor($pdo, $m),
                'modules' => $resolved['modules'] ?? [],
            ];
        }
        return Http::json($res, ['modules' => $modules, 'members' => $members]);
    }

    /**
     * GET /reports/classroom-email-readiness — Phase 0 of the Google Classroom
     * integration: can we match TRCMS members to Classroom students by email? Reports,
     * for active youth + mentors, who has no email, whose email is off the Workspace
     * domain (they'd only match if that exact address is their Classroom login), and
     * duplicate emails (ambiguous matches). ?domain= overrides the Workspace domain.
     */
    public static function classroomEmailReadiness(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req, 'reports.view', 'read', true)) return Http::error($res, $g['detail'], $g['err']);
        $domain = strtolower(trim((string)($req->getQueryParams()['domain'] ?? 'tulsaroboticscenter.org')));

        $rows = $pdo->query(
            "SELECT id, first_name, last_name, member_type, email
               FROM members
              WHERE member_type IN ('youth','mentor')
                AND (is_active = 1 OR is_active IS NULL)
                AND (is_kiosk = 0 OR is_kiosk IS NULL)
                AND (is_system = 0 OR is_system IS NULL)
                AND (is_archived = 0 OR is_archived IS NULL)
              ORDER BY last_name, first_name"
        )->fetchAll();

        $nm = fn($m) => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? ''));
        $missing = []; $withEmail = 0; $onDomain = 0; $offDomain = [];
        $domains = []; $byEmail = [];
        foreach ($rows as $m) {
            $email = strtolower(trim((string)($m['email'] ?? '')));
            $entry = ['id' => (int)$m['id'], 'name' => $nm($m), 'member_type' => $m['member_type'], 'email' => $email];
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $missing[] = $entry; continue; }
            $withEmail++;
            $byEmail[$email][] = $entry;
            $d = substr(strrchr($email, '@') ?: '@', 1);
            $domains[$d] = ($domains[$d] ?? 0) + 1;
            if ($d === $domain) { $onDomain++; } else { $offDomain[] = $entry; }
        }
        // Duplicate emails = same address on 2+ members (ambiguous student→member match).
        $duplicates = [];
        foreach ($byEmail as $email => $mem) {
            if (count($mem) > 1) $duplicates[] = ['email' => $email, 'members' => $mem];
        }
        arsort($domains);
        $domainList = [];
        foreach ($domains as $d => $c) $domainList[] = ['domain' => $d, 'count' => $c];

        return Http::json($res, [
            'workspace_domain' => $domain,
            'total' => count($rows),
            'with_email' => $withEmail,
            'missing_email_count' => count($missing),
            'on_domain_count' => $onDomain,
            'off_domain_count' => count($offDomain),
            'duplicate_count' => count($duplicates),
            'missing_email' => $missing,
            'off_domain' => $offDomain,
            'duplicates' => $duplicates,
            'domains' => $domainList,
        ]);
    }

    /**
     * GET /reports/active-members — headcount + demographic breakdowns for the
     * active (non-archived) roster. Powers the business-plan dashboard charts.
     * Excludes kiosk/system accounts. Archived members are always excluded.
     */
    public static function activeMembers(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);

        // "Active members" = active Youth & Mentors only (#120). Parents, volunteers,
        // sponsors, and others are tracked separately as supporting participants and
        // must NOT count toward the active-member number or appear in the charts.
        // Alumni (graduated youth, flagged is_alumni) are NOT counted as active youth/members —
        // they're reported as their own stat, like inactive/archived.
        $notAlumni = "(m.is_alumni = false OR m.is_alumni IS NULL)";
        $memberTypes = "m.member_type IN ('youth', 'mentor')";
        $base = "FROM members m
                 WHERE m.is_active = 1
                   AND $memberTypes
                   AND $notAlumni
                   AND (m.is_archived = false OR m.is_archived IS NULL)
                   AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
                   AND (m.is_system = false OR m.is_system IS NULL)";

        $total = (int)$pdo->query("SELECT COUNT(*) $base")->fetchColumn();

        // Supporting participants (active, non-kiosk/system) kept as stats, by type.
        $supportingRows = $pdo->query(
            "SELECT m.member_type AS label, COUNT(*) AS count
             FROM members m
             WHERE m.is_active = 1
               AND m.member_type NOT IN ('youth', 'mentor')
               AND $notAlumni
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
               AND (m.is_system = false OR m.is_system IS NULL)
             GROUP BY m.member_type ORDER BY count DESC, label"
        )->fetchAll(PDO::FETCH_ASSOC);
        $supporting = array_map(fn($r) => ['label' => ucfirst((string)$r['label'] ?: 'Other'), 'count' => (int)$r['count']], $supportingRows);

        // Quick counts of the members NOT in the active roster (#115).
        $notKioskSys = "(m.is_kiosk = false OR m.is_kiosk IS NULL) AND (m.is_system = false OR m.is_system IS NULL)";
        $inactiveCount = (int)$pdo->query("SELECT COUNT(*) FROM members m WHERE m.is_active = 0 AND (m.is_archived = false OR m.is_archived IS NULL) AND $notKioskSys")->fetchColumn();
        $archivedCount = (int)$pdo->query("SELECT COUNT(*) FROM members m WHERE m.is_archived = 1 AND $notKioskSys")->fetchColumn();
        $alumniCount = (int)$pdo->query("SELECT COUNT(*) FROM members m WHERE m.is_alumni = 1 AND m.is_active = 1 AND (m.is_archived = false OR m.is_archived IS NULL) AND $notKioskSys")->fetchColumn();

        // Simple one-column breakdown helper with NULL/blank → "Not specified".
        $breakdown = function (string $expr) use ($pdo, $base): array {
            $rows = $pdo->query(
                "SELECT COALESCE(NULLIF(TRIM($expr), ''), 'Not specified') AS label, COUNT(*) AS count
                 $base GROUP BY label ORDER BY count DESC, label"
            )->fetchAll(PDO::FETCH_ASSOC);
            return array_map(fn($r) => ['label' => $r['label'], 'count' => (int)$r['count']], $rows);
        };

        // Age bands from birthday (youth-oriented buckets); NULL → Unknown.
        $ageRows = $pdo->query(
            "SELECT CASE
                        WHEN m.birthday IS NULL THEN 'Unknown'
                        WHEN TIMESTAMPDIFF(YEAR, m.birthday, CURDATE()) < 9  THEN 'Under 9'
                        WHEN TIMESTAMPDIFF(YEAR, m.birthday, CURDATE()) BETWEEN 9 AND 11  THEN '9–11'
                        WHEN TIMESTAMPDIFF(YEAR, m.birthday, CURDATE()) BETWEEN 12 AND 14 THEN '12–14'
                        WHEN TIMESTAMPDIFF(YEAR, m.birthday, CURDATE()) BETWEEN 15 AND 18 THEN '15–18'
                        ELSE '19+ (adult)'
                    END AS label, COUNT(*) AS count
             $base GROUP BY label"
        )->fetchAll(PDO::FETCH_ASSOC);
        $ageOrder = ['Under 9' => 0, '9–11' => 1, '12–14' => 2, '15–18' => 3, '19+ (adult)' => 4, 'Unknown' => 5];
        $byAge = array_map(fn($r) => ['label' => $r['label'], 'count' => (int)$r['count']], $ageRows);
        usort($byAge, fn($a, $b) => ($ageOrder[$a['label']] ?? 9) <=> ($ageOrder[$b['label']] ?? 9));

        // Free/reduced lunch eligibility (economic-diversity indicator), youth only.
        $frlRows = $pdo->query(
            "SELECT CASE
                        WHEN m.free_reduced_lunch_eligible = 1 THEN 'Eligible'
                        WHEN m.free_reduced_lunch_eligible = 0 THEN 'Not eligible'
                        ELSE 'Not specified'
                    END AS label, COUNT(*) AS count
             $base AND m.member_type = 'youth' GROUP BY label"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Active members still missing Gender, Race, and/or Birthday — a work list so staff can
        // chase the gaps and fill them in. Same active youth/mentor scope as the headcount above.
        $missingRows = $pdo->query(
            "SELECT m.id, m.member_number, m.first_name, m.last_name, m.member_type,
                    (NULLIF(TRIM(m.sex), '')  IS NULL) AS missing_sex,
                    (NULLIF(TRIM(m.race), '') IS NULL) AS missing_race,
                    (m.birthday IS NULL)               AS missing_birthday
             $base AND (NULLIF(TRIM(m.sex), '') IS NULL OR NULLIF(TRIM(m.race), '') IS NULL OR m.birthday IS NULL)
             ORDER BY m.last_name, m.first_name"
        )->fetchAll(PDO::FETCH_ASSOC);
        $missingDemographics = array_map(fn($r) => [
            'member_id'       => (int)$r['id'],
            'member_number'   => $r['member_number'],
            'name'            => trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')),
            'member_type'     => $r['member_type'],
            'missing_sex'     => (bool)$r['missing_sex'],
            'missing_race'    => (bool)$r['missing_race'],
            'missing_birthday'=> (bool)$r['missing_birthday'],
        ], $missingRows);

        return Http::json($res, [
            'generated_at'   => date('c'),
            'total_active'   => $total,
            'inactive_count' => $inactiveCount,
            'archived_count' => $archivedCount,
            'alumni_count'   => $alumniCount,
            'missing_demographics' => $missingDemographics,
            'by_member_type' => $breakdown('m.member_type'),
            'supporting'     => $supporting,   // parents/volunteers/others — kept as stats, excluded from total
            'by_program'     => (function () use ($pdo) {
                $year = self::currentEnrollmentYear();
                // Youth are bucketed by the program of their CURRENT-season enrollment. Match any
                // status that represents a real membership (pending/paid/active/etc.) and exclude
                // only cancelled and expired — the enrollment 'active' status is rare, so filtering
                // on it alone dropped almost everyone into "No program". Mentors have no program
                // enrollment, so they're counted as their own "Mentors" category, not "No program".
                $stmt = $pdo->prepare(
                    "SELECT COALESCE(p.name, 'No program') AS label, COUNT(DISTINCT m.id) AS count
                     FROM members m
                     LEFT JOIN enrollments e ON e.member_id = m.id AND e.enrollment_year = ?
                                            AND e.status NOT IN ('cancelled', 'expired')
                     LEFT JOIN programs p ON p.id = e.program_id
                     WHERE m.is_active = 1
                       AND m.member_type = 'youth'
                       AND (m.is_alumni = false OR m.is_alumni IS NULL)
                       AND (m.is_archived = false OR m.is_archived IS NULL)
                       AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
                       AND (m.is_system = false OR m.is_system IS NULL)
                     GROUP BY label"
                );
                $stmt->execute([$year]);
                $out = array_map(fn($r) => ['label' => $r['label'], 'count' => (int)$r['count']], $stmt->fetchAll(PDO::FETCH_ASSOC));

                $mentors = (int)$pdo->query(
                    "SELECT COUNT(*) FROM members m
                      WHERE m.is_active = 1 AND m.member_type = 'mentor'
                        AND (m.is_alumni = false OR m.is_alumni IS NULL)
                        AND (m.is_archived = false OR m.is_archived IS NULL)
                        AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
                        AND (m.is_system = false OR m.is_system IS NULL)"
                )->fetchColumn();
                if ($mentors > 0) $out[] = ['label' => 'Mentors', 'count' => $mentors];

                // Sort by count desc, but keep the catch-all "No program" last.
                usort($out, function ($a, $b) {
                    if ($a['label'] === 'No program') return 1;
                    if ($b['label'] === 'No program') return -1;
                    return ($b['count'] <=> $a['count']) ?: strcmp($a['label'], $b['label']);
                });
                return $out;
            })(),
            'by_sex'         => $breakdown('m.sex'),
            'by_race'        => $breakdown('m.race'),
            'by_age_band'    => $byAge,
            'by_frl_youth'   => array_map(fn($r) => ['label' => $r['label'], 'count' => (int)$r['count']], $frlRows),
        ]);
    }

    /**
     * Active members and the certifications each has completed. Excludes inactive/archived and
     * kiosk/system accounts. One entry per active member (even with zero certs, so the report
     * doubles as a "who still needs certifications" list).
     */
    private static function certificationsByMemberRows(PDO $pdo): array
    {
        $members = $pdo->query(
            "SELECT m.id, m.member_number, m.first_name, m.last_name, m.member_type
             FROM members m
             WHERE m.is_active = 1
               AND (m.is_alumni = false OR m.is_alumni IS NULL)
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
               AND (m.is_system = false OR m.is_system IS NULL)
             ORDER BY m.last_name, m.first_name"
        )->fetchAll(PDO::FETCH_ASSOC);
        if (!$members) return [];

        // All completed certifications for those members, in catalog order.
        $certs = $pdo->query(
            "SELECT mc.member_id, c.code, c.name, c.section, mc.completed_date
             FROM member_certifications mc
             JOIN certifications c ON c.id = mc.certification_id
             JOIN members m ON m.id = mc.member_id
             WHERE mc.status = 'completed'
               AND m.is_active = 1
               AND (m.is_alumni = false OR m.is_alumni IS NULL)
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
               AND (m.is_system = false OR m.is_system IS NULL)
             ORDER BY c.section, c.code"
        )->fetchAll(PDO::FETCH_ASSOC);
        $byMember = [];
        foreach ($certs as $r) {
            $byMember[(int)$r['member_id']][] = [
                'code' => $r['code'], 'name' => $r['name'], 'section' => $r['section'],
                'completed_date' => $r['completed_date'],
            ];
        }

        $out = [];
        foreach ($members as $m) {
            $mid = (int)$m['id'];
            $list = $byMember[$mid] ?? [];
            $out[] = [
                'member_id' => $mid, 'member_number' => $m['member_number'],
                'name' => trim($m['first_name'] . ' ' . $m['last_name']),
                'last_name' => $m['last_name'], 'first_name' => $m['first_name'],
                'member_type' => $m['member_type'],
                'cert_count' => count($list),
                'certifications' => $list,
            ];
        }
        return $out;
    }

    /** GET /reports/certifications-by-member — active members + their completed certifications. */
    public static function certificationsByMember(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $rows = self::certificationsByMemberRows($pdo);
        return Http::json($res, [
            'generated_at' => date('c'),
            'member_count' => count($rows),
            'certified_count' => count(array_filter($rows, fn($r) => $r['cert_count'] > 0)),
            'members' => $rows,
        ]);
    }

    /** GET /reports/certifications-by-member/csv — one row per member+certification. */
    public static function certificationsByMemberCsv(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $rows = [];
        foreach (self::certificationsByMemberRows($pdo) as $m) {
            if (!$m['certifications']) {
                $rows[] = [$m['member_number'], $m['last_name'], $m['first_name'], ucfirst((string)$m['member_type']), '', '', '', ''];
                continue;
            }
            foreach ($m['certifications'] as $c) {
                $rows[] = [$m['member_number'], $m['last_name'], $m['first_name'], ucfirst((string)$m['member_type']),
                    $c['code'], $c['name'], $c['section'], $c['completed_date']];
            }
        }
        return self::csvResponse($res, 'certifications-by-member.csv',
            ['Member #', 'Last Name', 'First Name', 'Member Type', 'Cert Code', 'Certification', 'Section', 'Completed'], $rows);
    }

    /** Grade label for the youth-by-grade report — high-school years read as class names. */
    private static function gradeLabel(?int $grade): string
    {
        if ($grade === null) return 'Unknown (no graduation year)';
        return match ($grade) {
            9  => 'Freshman',
            10 => 'Sophomore',
            11 => 'Junior',
            12 => 'Senior',
            default => \App\Core\Grade::label($grade) ?? 'Unknown',
        };
    }

    /** Active youth grouped by current-season school grade (9–12 shown as class names). */
    private static function youthByGradeGroups(PDO $pdo): array
    {
        $season = self::currentEnrollmentYear();
        $rows = $pdo->query(
            "SELECT id, member_number, first_name, last_name, graduation_year
             FROM members m
             WHERE m.is_active = 1
               AND m.member_type = 'youth'
               AND (m.is_alumni = false OR m.is_alumni IS NULL)
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_kiosk = false OR m.is_kiosk IS NULL)
               AND (m.is_system = false OR m.is_system IS NULL)
             ORDER BY m.last_name, m.first_name"
        )->fetchAll(PDO::FETCH_ASSOC);

        // Current-season program(s) per youth (from their non-cancelled/expired enrollments),
        // in program display order, so each name can carry its program tag(s) — e.g. FTC, or FTC/FDP.
        $progMap = [];
        $ps = $pdo->query(
            "SELECT DISTINCT e.member_id, p.name, p.display_order
             FROM enrollments e JOIN programs p ON p.id = e.program_id
             WHERE e.enrollment_year = " . (int)$season . " AND e.status NOT IN ('cancelled', 'expired')
             ORDER BY e.member_id, p.display_order, p.name"
        );
        foreach ($ps->fetchAll(PDO::FETCH_ASSOC) as $r) $progMap[(int)$r['member_id']][] = $r['name'];

        $groups = [];  // sort-key => group
        foreach ($rows as $r) {
            $gy = $r['graduation_year'] !== null ? (int)$r['graduation_year'] : null;
            $grade = \App\Core\Grade::fromGraduationYear($gy, $season);
            $sortKey = $grade === null ? PHP_INT_MAX : $grade;   // Unknown sorts last
            if (!isset($groups[$sortKey])) {
                $groups[$sortKey] = ['grade' => $grade, 'label' => self::gradeLabel($grade), 'count' => 0, 'members' => []];
            }
            $groups[$sortKey]['count']++;
            $groups[$sortKey]['members'][] = [
                'member_id' => (int)$r['id'], 'member_number' => $r['member_number'],
                'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                'last_name' => $r['last_name'], 'first_name' => $r['first_name'],
                'graduation_year' => $gy,
                'programs' => $progMap[(int)$r['id']] ?? [],
            ];
        }
        ksort($groups);
        return ['season_year' => $season, 'season_label' => $season . '–' . ($season + 1), 'groups' => array_values($groups)];
    }

    /** GET /reports/youth-by-grade — active youth grouped by grade (HS years as class names). */
    public static function youthByGrade(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $data = self::youthByGradeGroups($pdo);
        $data['total'] = array_sum(array_map(fn($g) => $g['count'], $data['groups']));
        $data['generated_at'] = date('c');
        return Http::json($res, $data);
    }

    /** GET /reports/youth-by-grade/csv — one row per youth with their grade/class. */
    public static function youthByGradeCsv(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $data = self::youthByGradeGroups($pdo);
        $rows = [];
        foreach ($data['groups'] as $g) {
            foreach ($g['members'] as $m) {
                $rows[] = [$m['member_number'], $m['last_name'], $m['first_name'], $g['label'],
                    $g['grade'] ?? '', $m['graduation_year'] ?? '', implode(' / ', $m['programs'] ?? [])];
            }
        }
        return self::csvResponse($res, 'youth-by-grade.csv',
            ['Member #', 'Last Name', 'First Name', 'Grade / Class', 'Grade #', 'Graduation Year', 'Program(s)'], $rows);
    }

    /** GET /reports/certification-options — the certification catalog, for the holders picker. */
    public static function certificationOptions(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $rows = $pdo->query("SELECT id, code, name, section, status FROM certifications ORDER BY section, code")->fetchAll(PDO::FETCH_ASSOC);
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'code' => $r['code'], 'name' => $r['name'],
            'section' => $r['section'], 'status' => $r['status'],
        ], $rows));
    }

    /**
     * GET /reports/certification-holders?cert_ids=1,2&match=any|all — active members who hold the
     * selected certification(s), each with which of them they hold, their current-season team(s),
     * and their FDP status, so the report can be grouped by team or FDP. match=all requires the
     * member to hold every selected certification; match=any (default) requires at least one.
     */
    public static function certificationHolders(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::gate($pdo, $req)) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $certIds = array_values(array_unique(array_filter(array_map('intval', explode(',', (string)($q['cert_ids'] ?? ''))))));
        $match = (($q['match'] ?? 'any') === 'all') ? 'all' : 'any';
        $season = self::currentEnrollmentYear();
        $teamSeason = $season . '-' . ($season + 1);

        if (!$certIds) return Http::json($res, ['match' => $match, 'certifications' => [], 'member_count' => 0, 'members' => []]);
        $in = implode(',', array_fill(0, count($certIds), '?'));

        $cm = $pdo->prepare("SELECT id, code, name FROM certifications WHERE id IN ($in) ORDER BY section, code");
        $cm->execute($certIds);
        $certs = array_map(fn($r) => ['id' => (int)$r['id'], 'code' => $r['code'], 'name' => $r['name']], $cm->fetchAll(PDO::FETCH_ASSOC));

        $mc = $pdo->prepare(
            "SELECT mc.member_id, mc.certification_id, mc.completed_date, c.code,
                    m.member_number, m.first_name, m.last_name, m.member_type
             FROM member_certifications mc
             JOIN certifications c ON c.id = mc.certification_id
             JOIN members m ON m.id = mc.member_id
             WHERE mc.status = 'completed' AND mc.certification_id IN ($in)
               AND m.is_active = 1 AND (m.is_alumni = false OR m.is_alumni IS NULL)
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_kiosk = false OR m.is_kiosk IS NULL) AND (m.is_system = false OR m.is_system IS NULL)
             ORDER BY m.last_name, m.first_name");
        $mc->execute($certIds);
        $members = [];
        foreach ($mc->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $mid = (int)$r['member_id'];
            if (!isset($members[$mid])) {
                $members[$mid] = ['member_id' => $mid, 'member_number' => $r['member_number'],
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
                    'member_type' => $r['member_type'], 'certs' => [], 'teams' => [], 'fdp' => null];
            }
            $members[$mid]['certs'][] = ['id' => (int)$r['certification_id'], 'code' => $r['code'], 'completed_date' => $r['completed_date']];
        }

        if ($match === 'all') {
            $need = count($certIds);
            $members = array_filter($members, fn($m) => count(array_unique(array_map(fn($c) => $c['id'], $m['certs']))) >= $need);
        }
        if (!$members) return Http::json($res, ['match' => $match, 'certifications' => $certs, 'member_count' => 0, 'members' => []]);

        $mids = array_keys($members);
        $inM = implode(',', array_fill(0, count($mids), '?'));

        // Current-season team memberships.
        $ts = $pdo->prepare(
            "SELECT a.member_id, t.team_number, ts.team_name
             FROM team_member_assignments a
             JOIN team_seasons ts ON ts.id = a.team_season_id
             JOIN teams t ON t.id = ts.team_id
             WHERE a.member_id IN ($inM) AND ts.season = ? AND a.status = 'active'
             ORDER BY t.team_number");
        $ts->execute(array_merge($mids, [$teamSeason]));
        foreach ($ts->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $members[(int)$r['member_id']]['teams'][] = ['team_number' => $r['team_number'], 'team_name' => $r['team_name']];
        }

        // Current-year FDP membership.
        $fd = $pdo->prepare("SELECT member_id, status FROM fdp_memberships WHERE member_id IN ($inM) AND enrollment_year = ?");
        $fd->execute(array_merge($mids, [$season]));
        foreach ($fd->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $members[(int)$r['member_id']]['fdp'] = $r['status'];
        }

        return Http::json($res, [
            'match' => $match, 'certifications' => $certs, 'team_season' => $teamSeason,
            'member_count' => count($members), 'members' => array_values($members),
        ]);
    }
}
