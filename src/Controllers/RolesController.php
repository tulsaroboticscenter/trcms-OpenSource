<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\ComplianceService;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/roles/router.py — YLC + mentor compliance. */
final class RolesController
{
    private const YLC_ROLES = ['President', 'Vice President', 'Treasurer', 'Fundraising Lead', 'Quartermaster', 'Team Leader', 'At Large'];
    private const EXPERTISE = ['Programming', 'Design', 'CAD / OnShape', 'Fusion 360', '3D Printing', 'CNC',
        'Portfolio / Documentation', 'Fundraising', 'Business / Finance', 'Social Media',
        'Electrical / Wiring', 'Field Building', 'Project Management', 'Safety Officer'];

    // ── helpers ───────────────────────────────────────────────────────────

    private static function ylcHistory(PDO $pdo, int $memberId): array
    {
        $stmt = $pdo->prepare(
            "SELECT y.*, t.team_number FROM ylc_memberships y
               LEFT JOIN teams t ON t.id = y.team_id
              WHERE y.member_id = ?");
        $stmt->execute([$memberId]);
        $rows = $stmt->fetchAll();
        usort($rows, fn($a, $b) => strcmp((string)$b['term'], (string)$a['term']));
        return array_map(fn($m) => [
            'id' => (int)$m['id'], 'term' => $m['term'], 'role' => $m['role'] ?: 'At Large', 'notes' => $m['notes'],
            // A team-level role assigned on a team page carries its team; council roles don't.
            'team_id' => $m['team_id'] !== null ? (int)$m['team_id'] : null,
            'team_number' => $m['team_number'] ?? null,
        ], $rows);
    }

    private static function syncYouthSummary(PDO $pdo, int $memberId): array
    {
        $rows = $pdo->prepare("SELECT * FROM ylc_memberships WHERE member_id = ?");
        $rows->execute([$memberId]); $all = $rows->fetchAll();
        if ($all) {
            usort($all, fn($a, $b) => strcmp((string)$b['term'], (string)$a['term']));
            $latest = $all[0];
            $vals = [1, $latest['role'] ?: 'At Large', $latest['term']];
        } else {
            $vals = [0, null, null];
        }
        $ex = $pdo->prepare("SELECT id FROM youth_roles WHERE member_id = ?"); $ex->execute([$memberId]);
        if ($ex->fetch()) {
            $pdo->prepare("UPDATE youth_roles SET ylc_member = ?, ylc_role = ?, ylc_term = ? WHERE member_id = ?")->execute([...$vals, $memberId]);
        } else {
            $pdo->prepare("INSERT INTO youth_roles (member_id, ylc_member, ylc_role, ylc_term) VALUES (?, ?, ?, ?)")->execute([$memberId, ...$vals]);
        }
        $y = $pdo->prepare("SELECT * FROM youth_roles WHERE member_id = ?"); $y->execute([$memberId]);
        return $y->fetch();
    }

    private static function serializeYouth(PDO $pdo, array $r, array $member): array
    {
        return [
            'member_id' => (int)$r['member_id'], 'first_name' => $member['first_name'], 'last_name' => $member['last_name'],
            'photo_url' => $member['photo_url'], 'ylc_member' => (bool)$r['ylc_member'], 'ylc_role' => $r['ylc_role'],
            'ylc_term' => $r['ylc_term'], 'ylc_history' => self::ylcHistory($pdo, (int)$r['member_id']),
        ];
    }

    private static function serializeAdult(PDO $pdo, array $r, array $member): array
    {
        $compliant = $r['ypt_complete'] && $r['background_check_complete'];
        $areas = isset($r['areas_of_expertise']) && $r['areas_of_expertise'] ? json_decode($r['areas_of_expertise'], true) : [];
        // Has this adult signed the current-season TRC annual T&C? (Shown alongside
        // YPT/background check; does not itself gate FIRST-YPP compliance.)
        $yr = \App\Core\EnrollmentService::currentEnrollmentYear();
        $tc = $pdo->prepare("SELECT signed_at FROM member_annual_tc WHERE member_id = ? AND enrollment_year = ?");
        $tc->execute([(int)$r['member_id'], $yr]);
        $tcRow = $tc->fetch();
        return [
            'member_id' => (int)$r['member_id'], 'first_name' => $member['first_name'], 'last_name' => $member['last_name'],
            'photo_url' => $member['photo_url'],
            'ypt_complete' => (bool)$r['ypt_complete'], 'ypt_date' => $r['ypt_date'],
            'background_check_complete' => (bool)$r['background_check_complete'], 'background_check_date' => $r['background_check_date'],
            'first_complete' => (bool)($r['first_complete'] ?? false), 'first_date' => $r['first_date'] ?? null,
            'consent_release_complete' => (bool)($r['consent_release_complete'] ?? false), 'consent_release_date' => $r['consent_release_date'] ?? null,
            'role_specific_complete' => (bool)($r['role_specific_complete'] ?? false), 'role_specific_date' => $r['role_specific_date'] ?? null,
            'trc_tc' => (bool)($tcRow && $tcRow['signed_at']), 'trc_tc_date' => $tcRow['signed_at'] ?? null,
            'role' => $r['role'], 'areas_of_expertise' => is_array($areas) ? $areas : [],
            'service_years' => $r['service_years'] !== null ? (int)$r['service_years'] : null,
            'on_hold' => (bool)$r['on_hold'], 'on_hold_note' => $r['on_hold_note'], 'is_compliant' => (bool)$compliant,
            // #182: whether this adult must meet YPT/background-check compliance. Mentors
            // always do; other adults only when the requires_ypt flag is set ("TRC Volunteer").
            'member_type' => $member['member_type'] ?? null,
            'requires_ypt' => (bool)($member['requires_ypt'] ?? false),
        ];
    }

    private static function member(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $s->execute([$id]); return $s->fetch() ?: null;
    }

    // ── config ────────────────────────────────────────────────────────────

    public static function ylcRoles(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'ylc_roles'"); $stmt->execute();
        $r = $stmt->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        return Http::json($res, (is_array($v) && $v) ? $v : self::YLC_ROLES);
    }

    public static function expertise(Request $req, Response $res): Response
    {
        return Http::json($res, self::EXPERTISE);
    }

    // ── YLC ───────────────────────────────────────────────────────────────

    public static function ylcList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $term = $req->getQueryParams()['term'] ?? null;
        // Only currently-active, non-archived members belong on the YLC page.
        $where = ['m.is_active = 1', '(m.is_archived = 0 OR m.is_archived IS NULL)'];
        $args = [];
        if ($term) { $where[] = 'y.term = ?'; $args[] = $term; }
        $sql = "SELECT y.id, y.member_id, y.role, y.term, m.first_name, m.last_name, m.photo_url
                FROM ylc_memberships y JOIN members m ON m.id = y.member_id
                WHERE " . implode(' AND ', $where);
        $stmt = $pdo->prepare($sql); $stmt->execute($args);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['id' => (int)$r['id'], 'member_id' => (int)$r['member_id'], 'first_name' => $r['first_name'],
                'last_name' => $r['last_name'], 'photo_url' => $r['photo_url'], 'ylc_member' => true,
                'ylc_role' => $r['role'] ?: 'At Large', 'ylc_term' => $r['term']];
        }
        usort($out, fn($a, $b) => [$a['ylc_role'], $a['last_name'], $a['first_name']] <=> [$b['ylc_role'], $b['last_name'], $b['first_name']]);
        return Http::json($res, $out);
    }

    public static function ylcTerms(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT DISTINCT term FROM ylc_memberships WHERE term IS NOT NULL")->fetchAll();
        $terms = array_filter(array_column($rows, 'term'));
        rsort($terms);
        return Http::json($res, array_values($terms));
    }

    public static function getYouth(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $y = $pdo->prepare("SELECT * FROM youth_roles WHERE member_id = ?"); $y->execute([$mid]);
        $r = $y->fetch();
        $member = self::member($pdo, $mid);
        if (!$r) {
            return Http::json($res, ['member_id' => $mid, 'first_name' => $member['first_name'] ?? '',
                'last_name' => $member['last_name'] ?? '', 'photo_url' => $member['photo_url'] ?? null,
                'ylc_member' => false, 'ylc_role' => null, 'ylc_term' => null, 'ylc_history' => []]);
        }
        return Http::json($res, self::serializeYouth($pdo, $r, $member));
    }

    public static function addYlcTerm(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id'];
        $member = self::member($pdo, $mid);
        if (!$member) return Http::error($res, 'Member not found', 404);
        $d = (array)$req->getParsedBody();
        $term = trim((string)($d['term'] ?? '')) ?: null;
        $role = trim((string)($d['role'] ?? '')) ?: 'At Large';
        // Council/at-large rows only (team_id IS NULL). Team-level roles are tied to a
        // team and managed from the team page — this must never touch one.
        $find = $term !== null
            ? $pdo->prepare("SELECT id FROM ylc_memberships WHERE member_id = ? AND term = ? AND team_id IS NULL")
            : $pdo->prepare("SELECT id FROM ylc_memberships WHERE member_id = ? AND term IS NULL AND team_id IS NULL");
        $find->execute($term !== null ? [$mid, $term] : [$mid]);
        $ex = $find->fetch();
        if ($ex) {
            $pdo->prepare("UPDATE ylc_memberships SET role = ?, notes = COALESCE(?, notes) WHERE id = ?")
                ->execute([$role, $d['notes'] ?? null, (int)$ex['id']]);
            Audit::write($pdo, (int)$m['id'], 'ylc_memberships', (int)$ex['id'], 'update', null, ['member_id' => $mid, 'term' => $term, 'role' => $role]);
        } else {
            $pdo->prepare("INSERT INTO ylc_memberships (member_id, term, role, notes) VALUES (?, ?, ?, ?)")
                ->execute([$mid, $term, $role, $d['notes'] ?? null]);
            Audit::write($pdo, (int)$m['id'], 'ylc_memberships', (int)$pdo->lastInsertId(), 'create', null, ['member_id' => $mid, 'term' => $term, 'role' => $role]);
        }
        $r = self::syncYouthSummary($pdo, $mid);
        return Http::json($res, self::serializeYouth($pdo, $r, $member), 201);
    }

    public static function deleteYlcTerm(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rid = (int)$route['record_id'];
        $f = $pdo->prepare("SELECT member_id FROM ylc_memberships WHERE id = ?"); $f->execute([$rid]);
        $rec = $f->fetch();
        if (!$rec) return Http::error($res, 'YLC record not found', 404);
        $pdo->prepare("DELETE FROM ylc_memberships WHERE id = ?")->execute([$rid]);
        Audit::write($pdo, (int)$m['id'], 'ylc_memberships', $rid, 'delete', ['member_id' => (int)$rec['member_id']], null);
        self::syncYouthSummary($pdo, (int)$rec['member_id']);
        return Http::json($res, ['ok' => true]);
    }

    public static function upsertYouth(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id'];
        $member = self::member($pdo, $mid);
        if (!$member) return Http::error($res, 'Member not found', 404);
        $d = (array)$req->getParsedBody();
        if (!empty($d['ylc_member'])) {
            $term = trim((string)($d['ylc_term'] ?? '')) ?: null;
            $role = trim((string)($d['ylc_role'] ?? '')) ?: 'At Large';
            // Council/at-large rows only (team_id IS NULL); team roles live on the team page.
            $find = $term !== null
                ? $pdo->prepare("SELECT id FROM ylc_memberships WHERE member_id = ? AND term = ? AND team_id IS NULL")
                : $pdo->prepare("SELECT id FROM ylc_memberships WHERE member_id = ? AND term IS NULL AND team_id IS NULL");
            $find->execute($term !== null ? [$mid, $term] : [$mid]);
            if ($ex = $find->fetch()) {
                $pdo->prepare("UPDATE ylc_memberships SET role = ? WHERE id = ?")->execute([$role, (int)$ex['id']]);
            } else {
                $pdo->prepare("INSERT INTO ylc_memberships (member_id, term, role) VALUES (?, ?, ?)")->execute([$mid, $term, $role]);
            }
        }
        $r = self::syncYouthSummary($pdo, $mid);
        Audit::write($pdo, (int)$m['id'], 'members', $mid, 'youth.roles', null, ['ylc' => !empty($d['ylc_member'])]);
        return Http::json($res, self::serializeYouth($pdo, $r, $member));
    }

    // ── compliance dashboards ─────────────────────────────────────────────

    public static function youthCompliance(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $compliantOnly = $req->getQueryParams()['compliant_only'] ?? null;
        $co = $compliantOnly === null ? null : filter_var($compliantOnly, FILTER_VALIDATE_BOOLEAN);
        $y = EnrollmentService::currentEnrollmentYear();
        $season = $y . '-' . ($y + 1);
        $youth = $pdo->query("SELECT id, first_name, last_name, photo_url, is_archived FROM members
                              WHERE member_type = 'youth' AND is_active = true ORDER BY last_name, first_name")->fetchAll();
        $aStmt = $pdo->prepare(
            "SELECT a.registered_on_first, a.first_consent_release FROM team_member_assignments a
             JOIN team_seasons ts ON ts.id = a.team_season_id
             WHERE a.member_id = ? AND a.status = 'active' AND ts.season = ?"
        );
        $out = [];
        foreach ($youth as $mem) {
            if (!empty($mem['is_archived'])) continue;
            $st = \App\Core\EnrollmentService::status($pdo, (int)$mem['id']);
            $enrolled = !empty($st['enrolled']); $trcTc = !empty($st['tc_ok']);
            $aStmt->execute([(int)$mem['id'], $season]);
            $assigns = $aStmt->fetchAll();
            $firstReg = false; $firstTc = false;
            foreach ($assigns as $a) { if (!empty($a['registered_on_first'])) $firstReg = true; if (!empty($a['first_consent_release'])) $firstTc = true; }
            $isCompliant = $enrolled && $trcTc && $firstReg && $firstTc;
            $row = ['member_id' => (int)$mem['id'], 'first_name' => $mem['first_name'], 'last_name' => $mem['last_name'],
                'photo_url' => $mem['photo_url'], 'enrolled' => $enrolled, 'trc_tc' => $trcTc,
                'first_registered' => $firstReg, 'first_tc' => $firstTc, 'on_team' => count($assigns) > 0, 'is_compliant' => $isCompliant];
            if ($co !== null && $isCompliant !== $co) continue;
            $out[] = $row;
        }
        return Http::json($res, ['season' => $season, 'youth' => $out]);
    }

    public static function adults(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $compliantOnly = $req->getQueryParams()['compliant_only'] ?? null;
        $co = $compliantOnly === null ? null : filter_var($compliantOnly, FILTER_VALIDATE_BOOLEAN);
        $mentors = $pdo->query("SELECT * FROM members WHERE " . ComplianceService::COMPLIANCE_REQUIRED_SQL . " AND is_active = true ORDER BY last_name, first_name")->fetchAll();
        $out = [];
        foreach ($mentors as $mem) {
            $r = $pdo->prepare("SELECT * FROM adult_roles WHERE member_id = ?"); $r->execute([(int)$mem['id']]);
            $role = $r->fetch();
            if ($role) {
                $s = self::serializeAdult($pdo, $role, $mem);
            } else {
                $s = ['member_id' => (int)$mem['id'], 'first_name' => $mem['first_name'], 'last_name' => $mem['last_name'],
                    'photo_url' => $mem['photo_url'], 'ypt_complete' => false, 'ypt_date' => null,
                    'background_check_complete' => false, 'background_check_date' => null,
                    'first_complete' => false, 'first_date' => null,
                    'consent_release_complete' => false, 'consent_release_date' => null,
                    'role_specific_complete' => false, 'role_specific_date' => null, 'role' => null,
                    'areas_of_expertise' => [], 'service_years' => 0, 'on_hold' => false, 'on_hold_note' => null, 'is_compliant' => false,
                    'member_type' => $mem['member_type'] ?? null, 'requires_ypt' => (bool)($mem['requires_ypt'] ?? false)];
            }
            if ($co !== null && $s['is_compliant'] !== $co) continue;
            $out[] = $s;
        }
        return Http::json($res, $out);
    }

    public static function getAdult(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !(bool)array_intersect(Permissions::effectiveRolesFor($pdo, $m), ['Admin', 'System Administrator'])) {
            return Http::error($res, 'Access denied', 403);
        }
        $member = self::member($pdo, $mid);
        $r = $pdo->prepare("SELECT * FROM adult_roles WHERE member_id = ?"); $r->execute([$mid]); $role = $r->fetch();
        $base = $role ? self::serializeAdult($pdo, $role, $member) : [
            'member_id' => $mid, 'first_name' => $member['first_name'] ?? '', 'last_name' => $member['last_name'] ?? '',
            'photo_url' => $member['photo_url'] ?? null, 'ypt_complete' => false, 'ypt_date' => null,
            'background_check_complete' => false, 'background_check_date' => null, 'role' => null,
            'areas_of_expertise' => [], 'service_years' => 0, 'on_hold' => false, 'on_hold_note' => null, 'is_compliant' => false];
        $base['compliance_status'] = ComplianceService::memberComplianceStatus($pdo, $mid);
        return Http::json($res, $base);
    }

    public static function upsertAdult(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        // Admins manage everything; a member may edit their OWN areas of expertise only —
        // compliance (YPT/background check), role, service and on-hold stay admin-verified (#146).
        $isAdmin = Permissions::isSuperAdmin($pdo, $m);
        if (!$isAdmin && (int)$m['id'] !== $mid) return Http::error($res, 'Access denied', 403);
        $ex = $pdo->prepare("SELECT 1 FROM adult_roles WHERE member_id = ?"); $ex->execute([$mid]);
        if (!$ex->fetch()) $pdo->prepare("INSERT INTO adult_roles (member_id) VALUES (?)")->execute([$mid]);
        $d = (array)$req->getParsedBody();
        $map = $isAdmin
            ? ['ypt_complete' => 'bool', 'ypt_date' => 'raw', 'background_check_complete' => 'bool',
               'background_check_date' => 'raw', 'first_complete' => 'bool', 'first_date' => 'raw',
               'consent_release_complete' => 'bool', 'consent_release_date' => 'raw',
               'role_specific_complete' => 'bool', 'role_specific_date' => 'raw',
               'role' => 'raw', 'areas_of_expertise' => 'json',
               'service_years' => 'raw', 'on_hold' => 'bool', 'on_hold_note' => 'raw']
            : ['areas_of_expertise' => 'json']; // self-service: expertise only
        $set = []; $args = [];
        foreach ($map as $f => $type) {
            if (!array_key_exists($f, $d)) continue;
            $v = $d[$f];
            // Explicit null clears a nullable field (e.g. correcting/removing an
            // erroneous YPT or background-check date). Booleans are never nulled.
            if ($v === null) {
                if ($type === 'bool') continue;
                $set[] = "$f = NULL";
                continue;
            }
            $set[] = "$f = ?";   // MySQL JSON columns accept a JSON string directly
            $args[] = $type === 'bool' ? (int)(bool)$v : ($type === 'json' ? json_encode($v) : $v);
        }
        if ($set) { $args[] = $mid; $pdo->prepare("UPDATE adult_roles SET " . implode(',', $set) . " WHERE member_id = ?")->execute($args); }
        // #182: "Requires YPT" ("TRC Volunteer") lives on members, admin-only. Setting it
        // holds this adult to the same YPT + background-check compliance as a mentor.
        if ($isAdmin && array_key_exists('requires_ypt', $d)) {
            $pdo->prepare("UPDATE members SET requires_ypt = ? WHERE id = ?")->execute([(int)(bool)$d['requires_ypt'], $mid]);
        }
        $r = $pdo->prepare("SELECT * FROM adult_roles WHERE member_id = ?"); $r->execute([$mid]);
        $base = self::serializeAdult($pdo, $r->fetch(), self::member($pdo, $mid));
        $base['compliance_status'] = ComplianceService::memberComplianceStatus($pdo, $mid);
        Audit::write($pdo, (int)$m['id'], 'members', $mid, 'adult.roles');
        return Http::json($res, $base);
    }

    public static function complianceHistory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !(bool)array_intersect(Permissions::effectiveRolesFor($pdo, $m), ['Admin', 'System Administrator'])) {
            return Http::error($res, 'Access denied', 403);
        }
        $stmt = $pdo->prepare("SELECT * FROM mentor_compliance_records WHERE member_id = ? ORDER BY completed_date DESC");
        $stmt->execute([$mid]);
        return Http::json($res, array_map([ComplianceService::class, 'serializeRecord'], $stmt->fetchAll()));
    }

    /** Admins can delete an erroneous logged compliance record (#82). */
    public static function deleteComplianceRecord(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !(bool)array_intersect(Permissions::effectiveRolesFor($pdo, $m), ['Admin', 'System Administrator'])) {
            return Http::error($res, 'Access denied', 403);
        }
        $mid = (int)$route['member_id']; $rid = (int)$route['record_id'];
        $s = $pdo->prepare("SELECT * FROM mentor_compliance_records WHERE id = ? AND member_id = ?");
        $s->execute([$rid, $mid]);
        $rec = $s->fetch();
        if (!$rec) return Http::error($res, 'Record not found', 404);
        $pdo->prepare("DELETE FROM mentor_compliance_records WHERE id = ?")->execute([$rid]);
        Audit::write($pdo, (int)$m['id'], 'mentor_compliance_records', $rid, 'delete', $rec, null);
        return Http::json($res, ['ok' => true, 'compliance_status' => ComplianceService::memberComplianceStatus($pdo, $mid)]);
    }

    public static function addComplianceRecord(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id'];
        $d = (array)$req->getParsedBody();
        $type = $d['compliance_type'] ?? '';
        if (!in_array($type, ['ypt', 'background_check', 'first', 'consent_release', 'role_specific'], true)) return Http::error($res, "compliance_type must be 'ypt', 'background_check', 'first', 'consent_release', or 'role_specific'", 400);
        $cfg = ComplianceService::config($pdo);
        $validYears = [
            'ypt' => $cfg['ypt_valid_years'], 'background_check' => $cfg['bgcheck_valid_years'],
            'first' => $cfg['first_valid_years'], 'consent_release' => $cfg['consent_release_valid_years'],
            'role_specific' => $cfg['role_specific_valid_years'],
        ][$type];
        $completed = $d['completed_date'];
        $expires = ComplianceService::computeExpires($completed, $validYears);
        $ins = $pdo->prepare("INSERT INTO mentor_compliance_records (member_id, compliance_type, enrollment_year, completed_date, expires_date, notes, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $ins->execute([$mid, $type, (int)$d['enrollment_year'], $completed, $expires, $d['notes'] ?? null, (int)$m['id']]);
        $recId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'mentor_compliance_records', $recId, 'create', null, ['member_id' => $mid, 'compliance_type' => $type, 'completed_date' => $completed]);
        $rs = $pdo->prepare("SELECT * FROM mentor_compliance_records WHERE id = ?"); $rs->execute([$recId]); $rec = $rs->fetch();
        $ex = $pdo->prepare("SELECT 1 FROM adult_roles WHERE member_id = ?"); $ex->execute([$mid]);
        if (!$ex->fetch()) $pdo->prepare("INSERT INTO adult_roles (member_id) VALUES (?)")->execute([$mid]);
        $col = [
            'ypt' => ['ypt_complete', 'ypt_date'],
            'first' => ['first_complete', 'first_date'],
            'background_check' => ['background_check_complete', 'background_check_date'],
            'consent_release' => ['consent_release_complete', 'consent_release_date'],
            'role_specific' => ['role_specific_complete', 'role_specific_date'],
        ][$type];
        $pdo->prepare("UPDATE adult_roles SET {$col[0]} = 1, {$col[1]} = ? WHERE member_id = ?")->execute([$completed, $mid]);
        return Http::json($res, array_merge(ComplianceService::serializeRecord($rec),
            ['compliance_status' => ComplianceService::memberComplianceStatus($pdo, $mid)]), 201);
    }

    public static function expiring(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        return Http::json($res, ComplianceService::expiringMentors($pdo));
    }

    /** GET /roles/compliance/items — configured compliance item labels/enabled/gates (any member). */
    public static function complianceItems(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, [
            'items'    => array_values(ComplianceService::items($pdo)),
            'can_edit' => Permissions::memberCan($pdo, $m, 'admin.config', 'write'),
        ]);
    }

    /** PUT /roles/compliance/items — save the compliance item configuration (admin.config). */
    public static function saveComplianceItems(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $list = $d['items'] ?? null;
        if (!is_array($list)) return Http::error($res, 'An items list is required.', 422);
        // Accept either a keyed map or a list of {key,...} objects.
        $byKey = [];
        foreach ($list as $k => $v) {
            if (is_array($v) && isset($v['key'])) $byKey[(string)$v['key']] = $v;
            elseif (is_array($v)) $byKey[(string)$k] = $v;
        }
        ComplianceService::saveItems($pdo, $byKey);
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'update', null, ['category' => 'compliance_items']);
        return Http::json($res, ['items' => array_values(ComplianceService::items($pdo))]);
    }
}
