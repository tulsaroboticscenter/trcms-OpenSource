<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/admin/router.py (prefix /api/v1/admin). */
final class AdminController
{
    private const LEVELS = ['none', 'read', 'write'];
    private const PROTECTED_ROLE_NAMES = ['System Administrator', 'Admin', 'Mentor', 'Youth Member', 'Parent', 'Volunteer', 'Default'];
    private const SECURITY_DEFAULTS = [
        'lockout_enabled' => true, 'lockout_threshold' => 5, 'lockout_window_minutes' => 15,
        'lockout_duration_minutes' => 15, 'geo_block_enabled' => false, 'allowed_countries' => ['US', 'CA'],
        'two_factor_enabled' => false,
    ];
    private const STATION_ROLE_NAMES = ['Event Check-In Station', 'Visitor Registration Station',
        'Parts Room Station', 'Team Tasks Station', 'FLL Attendance Station', 'Generic Station'];
    private const PROFILE_PANE_CATALOG = [
        ['key' => 'contact', 'label' => 'Contact Information'], ['key' => 'personal', 'label' => 'Personal Information'],
        ['key' => 'emergency', 'label' => 'Emergency Contact'], ['key' => 'guardian', 'label' => 'Parent / Guardian'],
        ['key' => 'notes', 'label' => 'Notes'], ['key' => 'my_events', 'label' => 'My Upcoming Events'],
        ['key' => 'my_activities', 'label' => 'My Assigned Tasks'], ['key' => 'checkins', 'label' => 'Check-Ins'],
        ['key' => 'certifications', 'label' => 'Certifications'], ['key' => 'enrollments', 'label' => 'Enrollments'],
        ['key' => 'teams', 'label' => 'Teams'], ['key' => 'system_roles', 'label' => 'System Permissions'],
        ['key' => 'ylc', 'label' => 'Youth Leadership Council (YLC)'], ['key' => 'compliance', 'label' => 'FIRST Compliance & Expertise'],
        ['key' => 'mentor_tc', 'label' => 'Annual T&C Agreement'], ['key' => 'seasons', 'label' => 'FIRST Game Participation & Experience'],
        ['key' => 'family', 'label' => 'Family'], ['key' => 'communications', 'label' => 'System Email History'],
        ['key' => 'comm_prefs', 'label' => 'Communication Preferences'], ['key' => 'privacy', 'label' => 'Profile Privacy'],
        ['key' => 'employer', 'label' => 'Employer & Matching Gifts'],
    ];
    private const PROFILE_ZONES = [
        ['key' => 'main', 'label' => 'Main Page'], ['key' => 'side', 'label' => 'Side Panel'],
        ['key' => 'account', 'label' => 'Account Info Page'], ['key' => 'email', 'label' => 'Email Page'],
    ];
    /** Per-pane default zone when an admin hasn't explicitly placed it (otherwise 'main'). */
    private const PROFILE_PANE_DEFAULTS = ['employer' => 'account', 'communications' => 'email'];

    private static function sysAdmin(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::isSuperAdmin($pdo, $m); }
    private static function adminOrSys(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::hasAnyRole($pdo, $m, ['Admin', 'System Administrator']); }
    private static function canPerm(PDO $pdo, ?array $m, string $key, string $lvl): bool { return $m !== null && Permissions::memberCan($pdo, $m, $key, $lvl); }

    // ── Security settings ────────────────────────────────────────────────
    private static function securitySettings(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'security_settings'"); $s->execute();
        $r = $s->fetch();
        $settings = self::SECURITY_DEFAULTS;
        if ($r && $r['values']) { $v = json_decode($r['values'], true); if (is_array($v)) $settings = array_merge($settings, $v); }
        return $settings;
    }

    public static function getSecuritySettings(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.security', 'read')) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::securitySettings($pdo));
    }

    public static function updateSecuritySettings(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.security', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $merged = self::securitySettings($pdo);
        $previous = $merged;   // snapshot BEFORE merging, so the audit shows what changed
        foreach (array_keys(self::SECURITY_DEFAULTS) as $k) if (array_key_exists($k, $d) && $d[$k] !== null) $merged[$k] = $d[$k];
        $s = $pdo->prepare("SELECT id FROM system_config WHERE category = 'security_settings'"); $s->execute();
        $row = $s->fetch();
        if (!$row) $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('security_settings', 'Security Settings', ?)")->execute([json_encode($merged)]);
        else $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($merged), (int)$row['id']]);
        // Record the PRIOR policy too. Without it you can't tell whether an admin
        // weakened the lockout threshold or switched 2FA off — the single most
        // security-relevant change in this whole console.
        Audit::write($pdo, (int)$cur['id'], 'system_config', 0, 'security_settings_update',
            ['security_settings' => $previous], ['security_settings' => $merged], null, Http::clientIp($req));
        return Http::json($res, $merged);
    }

    public static function listLoginAttempts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.security', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (filter_var($q['failed_only'] ?? false, FILTER_VALIDATE_BOOLEAN)) $where[] = "success = false";
        if (!empty($q['username'])) { $where[] = "username LIKE ?"; $args[] = '%' . $q['username'] . '%'; }
        // Filter to one member — every attempt (success or failure) whose typed username
        // resolved to this member. Lets an admin pull a single user's whole login history.
        if (!empty($q['member_id'])) { $where[] = "member_id = ?"; $args[] = (int)$q['member_id']; }
        // A member-scoped lookup wants everything we have, so allow a much larger page.
        $cap = !empty($q['member_id']) ? 5000 : 500;
        $limit = min((int)($q['limit'] ?? 100), $cap);
        $sql = "SELECT * FROM login_attempts" . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY created_at DESC LIMIT $limit";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'username' => $r['username'], 'member_id' => $r['member_id'] !== null ? (int)$r['member_id'] : null,
            'ip_address' => $r['ip_address'], 'country' => $r['country'], 'user_agent' => $r['user_agent'],
            'success' => (bool)$r['success'], 'reason' => $r['reason'], 'created_at' => Time::naiveIso($r['created_at']),
        ], $s->fetchAll()));
    }

    // ── Stats ────────────────────────────────────────────────────────────
    public static function stats(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.system_stats', 'read')) return Http::error($res, 'Access denied', 403);
        $y = EnrollmentService::currentEnrollmentYear();
        $mc = $pdo->query("SELECT member_type, COUNT(id) AS n FROM members WHERE is_active = true AND (is_kiosk = false OR is_kiosk IS NULL) AND (is_system = false OR is_system IS NULL) GROUP BY member_type")->fetchAll();
        $counts = []; foreach ($mc as $r) $counts[$r['member_type']] = (int)$r['n'];
        $scalar = function ($sql, $args = []) use ($pdo) { $s = $pdo->prepare($sql); $s->execute($args); return (int)$s->fetch()['n']; };
        $activeEnr = $scalar("SELECT COUNT(id) AS n FROM enrollments WHERE enrollment_year = ? AND status = 'active'", [$y]);
        $unpaidEnr = $scalar("SELECT COUNT(id) AS n FROM enrollments WHERE enrollment_year = ? AND date_payment IS NULL AND payment_override = false", [$y]);
        $unsignedTc = $scalar("SELECT COUNT(id) AS n FROM enrollments WHERE enrollment_year = ? AND (tc_youth_agreed = false OR tc_parent_agreed = false)", [$y]);
        $newVisitors = $scalar("SELECT COUNT(id) AS n FROM visitors WHERE status = 'new'");
        $checkinsToday = $scalar("SELECT COUNT(id) AS n FROM checkins WHERE DATE(time_in) = ?", [date('Y-m-d')]);
        $activeTeams = $scalar("SELECT COUNT(id) AS n FROM team_seasons WHERE status = 'active'");
        return Http::json($res, [
            'enrollment_year' => $y,
            'members' => [
                'youth' => $counts['youth'] ?? 0, 'mentor' => $counts['mentor'] ?? 0,
                'parent' => $counts['parent'] ?? 0, 'volunteer' => $counts['volunteer'] ?? 0,
                'total' => array_sum($counts),
            ],
            'enrollments' => ['active' => $activeEnr, 'unpaid' => $unpaidEnr, 'unsigned_tc' => $unsignedTc],
            'visitors' => ['new' => $newVisitors], 'checkins_today' => $checkinsToday, 'active_teams' => $activeTeams,
        ]);
    }

    // ── Roles ────────────────────────────────────────────────────────────
    public static function listRoles(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'members.system_permissions', 'read')) return Http::error($res, 'Access denied', 403);
        $roles = $pdo->query("SELECT * FROM system_roles ORDER BY name")->fetchAll();
        $out = [];
        foreach ($roles as $r) {
            $mc = $pdo->prepare("SELECT COUNT(id) AS n FROM member_system_roles WHERE role_id = ?"); $mc->execute([(int)$r['id']]);
            $out[] = [
                'id' => (int)$r['id'], 'name' => $r['name'], 'display_name' => $r['display_name'] ?: $r['name'],
                'is_protected' => in_array($r['name'], self::PROTECTED_ROLE_NAMES, true), 'description' => $r['description'],
                'is_active' => (bool)$r['is_active'], 'member_count' => (int)$mc->fetch()['n'],
            ];
        }
        return Http::json($res, $out);
    }

    public static function createRole(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ex = $pdo->prepare("SELECT 1 FROM system_roles WHERE name = ?"); $ex->execute([$d['name'] ?? '']);
        if ($ex->fetch()) return Http::error($res, 'Role already exists', 400);
        $ins = $pdo->prepare("INSERT INTO system_roles (name, display_name, description, is_active) VALUES (?, ?, ?, true)");
        $ins->execute([$d['name'] ?? '', $d['display_name'] ?? null, $d['description'] ?? null]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'system_roles', $newId, 'create', null, $d);
        $rs = $pdo->prepare("SELECT * FROM system_roles WHERE id = ?"); $rs->execute([$newId]); $r = $rs->fetch();
        return Http::json($res, ['id' => (int)$r['id'], 'name' => $r['name'], 'display_name' => $r['display_name'],
            'description' => $r['description'], 'is_active' => (bool)$r['is_active']], 201);
    }

    public static function updateRole(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['role_id'];
        $s = $pdo->prepare("SELECT * FROM system_roles WHERE id = ?"); $s->execute([$id]);
        $role = $s->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        $isProtected = in_array($role['name'], self::PROTECTED_ROLE_NAMES, true);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (!empty($d['name']) && $d['name'] !== $role['name']) {
            if ($isProtected) return Http::error($res, 'This is a built-in role — its internal name is locked. Change its display name instead.', 400);
            $set[] = 'name = ?'; $args[] = $d['name'];
        }
        if (array_key_exists('display_name', $d) && $d['display_name'] !== null) { $set[] = 'display_name = ?'; $args[] = trim((string)$d['display_name']) ?: null; }
        if (array_key_exists('description', $d) && $d['description'] !== null) { $set[] = 'description = ?'; $args[] = $d['description']; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE system_roles SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'system_roles', $id, 'update', null, $d);
        $s2 = $pdo->prepare("SELECT * FROM system_roles WHERE id = ?"); $s2->execute([$id]); $role = $s2->fetch();
        return Http::json($res, ['id' => (int)$role['id'], 'name' => $role['name'], 'display_name' => $role['display_name'] ?: $role['name'],
            'is_protected' => $isProtected, 'description' => $role['description'], 'is_active' => (bool)$role['is_active']]);
    }

    public static function toggleRole(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['role_id'];
        $s = $pdo->prepare("SELECT is_active FROM system_roles WHERE id = ?"); $s->execute([$id]);
        $role = $s->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        $new = !(bool)$role['is_active'];
        $pdo->prepare("UPDATE system_roles SET is_active = ? WHERE id = ?")->execute([(int)$new, $id]);
        Audit::write($pdo, (int)$cur['id'], 'system_roles', $id, 'update', null, ['is_active' => $new]);
        return Http::json($res, ['ok' => true, 'is_active' => $new]);
    }

    /**
     * DELETE /admin/roles/{role_id} — permanently remove a custom role.
     * System Administrator only. Built-in roles can't be deleted. The role is
     * unassigned from any members first (they keep their other roles / revert to
     * Default); its permissions cascade-delete automatically.
     */
    public static function deleteRole(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !in_array('System Administrator', Permissions::effectiveRolesFor($pdo, $cur), true)) {
            return Http::error($res, 'Only a System Administrator can delete a role.', 403);
        }
        $id = (int)$route['role_id'];
        $s = $pdo->prepare("SELECT * FROM system_roles WHERE id = ?"); $s->execute([$id]);
        $role = $s->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        if (in_array($role['name'], self::PROTECTED_ROLE_NAMES, true)) {
            return Http::error($res, 'This is a built-in role and cannot be deleted.', 400);
        }
        $mc = $pdo->prepare("SELECT COUNT(*) FROM member_system_roles WHERE role_id = ?"); $mc->execute([$id]);
        $memberCount = (int)$mc->fetchColumn();

        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM member_system_roles WHERE role_id = ?")->execute([$id]); // unassign
            $pdo->prepare("DELETE FROM system_roles WHERE id = ?")->execute([$id]);             // role_permissions cascade
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not delete the role: ' . $e->getMessage(), 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'system_roles', $id, 'delete', $role, null);
        return Http::json($res, ['ok' => true, 'members_unassigned' => $memberCount]);
    }

    // ── Permissions ──────────────────────────────────────────────────────
    public static function permissionCatalog(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.roles', 'read')) return Http::error($res, 'Access denied', 403);
        $modules = [];
        foreach (Permissions::catalog() as $id => $mod) $modules[] = ['id' => $id, 'label' => $mod['label'], 'items' => $mod['items']];
        return Http::json($res, ['levels' => self::LEVELS, 'modules' => $modules]);
    }

    public static function getRolePermissions(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.roles', 'read')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['role_id'];
        $s = $pdo->prepare("SELECT * FROM system_roles WHERE id = ?"); $s->execute([$id]); $role = $s->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        $rp = $pdo->prepare("SELECT resource_key, level FROM role_permissions WHERE role_id = ?"); $rp->execute([$id]);
        $stored = []; foreach ($rp->fetchAll() as $r) $stored[$r['resource_key']] = $r['level'];
        $perms = [];
        foreach (Permissions::allResourceKeys() as $key) $perms[$key] = $stored[$key] ?? Permissions::defaultLevel($key);
        return Http::json($res, ['role_id' => $id, 'role_name' => $role['name'], 'permissions' => (object)$perms]);
    }

    public static function setRolePermissions(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['role_id'];
        $s = $pdo->prepare("SELECT name FROM system_roles WHERE id = ?"); $s->execute([$id]); $role = $s->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        $incoming = (array)(($req->getParsedBody()['permissions'] ?? null) ?: []);
        $validKeys = Permissions::allResourceKeys();
        $pdo->prepare("DELETE FROM role_permissions WHERE role_id = ?")->execute([$id]);
        foreach ($incoming as $key => $level) {
            if (!in_array($key, $validKeys, true) || !in_array($level, self::LEVELS, true)) continue;
            $pdo->prepare("INSERT INTO role_permissions (role_id, resource_key, level) VALUES (?, ?, ?)")->execute([$id, $key, $level]);
        }
        Audit::write($pdo, (int)$cur['id'], 'role_permissions', $id, 'update', null, ['role' => $role['name'], 'count' => count($incoming)]);
        return Http::json($res, ['ok' => true, 'role_id' => $id]);
    }

    // ── Role members / member roles ──────────────────────────────────────
    public static function getRoleMembers(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.roles', 'read')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['role_id'];
        $s = $pdo->prepare("SELECT name FROM system_roles WHERE id = ?"); $s->execute([$id]); $role = $s->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        $ms = $pdo->prepare("SELECT m.* FROM members m JOIN member_system_roles msr ON msr.member_id = m.id
                             WHERE msr.role_id = ? ORDER BY m.last_name, m.first_name");
        $ms->execute([$id]);
        $members = array_map(fn($m) => [
            'id' => (int)$m['id'], 'first_name' => $m['first_name'], 'last_name' => $m['last_name'],
            'member_number' => $m['member_number'], 'member_type' => $m['member_type'], 'photo_url' => $m['photo_url'],
            'is_active' => (bool)$m['is_active'],
        ], $ms->fetchAll());
        return Http::json($res, ['role_id' => $id, 'role_name' => $role['name'], 'members' => $members]);
    }

    public static function getMemberRoles(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'members.system_permissions', 'read')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$id]); $m = $ms->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);
        $rs = $pdo->prepare("SELECT sr.id, sr.name, sr.display_name, sr.is_active FROM member_system_roles msr
                             JOIN system_roles sr ON sr.id = msr.role_id WHERE msr.member_id = ?");
        $rs->execute([$id]);
        $roles = array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'],
            'display_name' => $r['display_name'] ?: $r['name'], 'is_active' => (bool)$r['is_active']], $rs->fetchAll());
        return Http::json($res, ['member_id' => (int)$m['id'], 'member_number' => $m['member_number'],
            'first_name' => $m['first_name'], 'last_name' => $m['last_name'], 'member_type' => $m['member_type'], 'roles' => $roles]);
    }

    public static function assignRole(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'members.system_permissions', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0); $rid = (int)($d['role_id'] ?? 0);
        $mx = $pdo->prepare("SELECT 1 FROM members WHERE id = ?"); $mx->execute([$mid]);
        if (!$mx->fetch()) return Http::error($res, 'Member not found', 404);
        $rx = $pdo->prepare("SELECT name FROM system_roles WHERE id = ?"); $rx->execute([$rid]);
        $roleName = $rx->fetchColumn();
        if ($roleName === false) return Http::error($res, 'Role not found', 404);
        // The top-level roles (Admin / System Administrator) may ONLY be handed out by someone who
        // already holds that level. members.system_permissions on its own is NOT enough — otherwise a
        // member with it (e.g. a lead mentor) could promote themselves or anyone else to Admin.
        // System Administrator is stricter still: only a System Administrator may grant it.
        $privilegedRoles = array_values(array_unique(array_merge(Permissions::superRoles(), ['Admin'])));
        if (in_array($roleName, $privilegedRoles, true) && !Permissions::isSuperAdmin($pdo, $cur)) {
            return Http::error($res, 'Only an administrator can assign the Admin or System Administrator role.', 403);
        }
        if ($roleName === 'System Administrator' && !in_array('System Administrator', Permissions::effectiveRolesFor($pdo, $cur), true)) {
            return Http::error($res, 'Only a System Administrator can assign the System Administrator role.', 403);
        }
        $ex = $pdo->prepare("SELECT 1 FROM member_system_roles WHERE member_id = ? AND role_id = ?"); $ex->execute([$mid, $rid]);
        if ($ex->fetch()) return Http::error($res, 'Member already has this role', 400);
        $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")->execute([$mid, $rid]);
        // Assigning a real role supersedes the placeholder "Default" role.
        $rname = $pdo->prepare("SELECT name FROM system_roles WHERE id = ?"); $rname->execute([$rid]);
        if (($rname->fetchColumn() ?: '') !== 'Default') {
            $pdo->prepare("DELETE msr FROM member_system_roles msr JOIN system_roles sr ON sr.id = msr.role_id
                           WHERE msr.member_id = ? AND sr.name = 'Default'")->execute([$mid]);
        }
        Audit::write($pdo, (int)$cur['id'], 'member_system_roles', (int)$pdo->lastInsertId(), 'create', null, ['member_id' => $mid, 'role_id' => $rid]);
        return Http::json($res, ['ok' => true]);
    }

    public static function removeRole(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'members.system_permissions', 'write')) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id']; $rid = (int)$route['role_id'];
        // Removing a top-level role is as sensitive as granting it: only an administrator may strip
        // Admin, and only a System Administrator may strip System Administrator — otherwise a member
        // with members.system_permissions could demote the real admins and lock them out.
        $rn = $pdo->prepare("SELECT name FROM system_roles WHERE id = ?"); $rn->execute([$rid]);
        $targetRole = (string)($rn->fetchColumn() ?: '');
        $privilegedRoles = array_values(array_unique(array_merge(Permissions::superRoles(), ['Admin'])));
        if (in_array($targetRole, $privilegedRoles, true) && !Permissions::isSuperAdmin($pdo, $cur)) {
            return Http::error($res, 'Only an administrator can remove the Admin or System Administrator role.', 403);
        }
        if ($targetRole === 'System Administrator'
            && !in_array('System Administrator', Permissions::effectiveRolesFor($pdo, $cur), true)) {
            return Http::error($res, 'Only a System Administrator can remove the System Administrator role.', 403);
        }
        $a = $pdo->prepare("SELECT id FROM member_system_roles WHERE member_id = ? AND role_id = ?"); $a->execute([$mid, $rid]);
        $row = $a->fetch();
        if (!$row) return Http::error($res, 'Role assignment not found', 404);
        $pdo->prepare("DELETE FROM member_system_roles WHERE id = ?")->execute([(int)$row['id']]);
        Audit::write($pdo, (int)$cur['id'], 'member_system_roles', (int)$row['id'], 'delete', ['member_id' => $mid, 'role_id' => $rid], null);
        return Http::json($res, ['ok' => true]);
    }

    public static function resetPassword(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.password_reset', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $pw = (string)($d['new_password'] ?? '');
        if ($err = Auth::passwordError($pw)) return Http::error($res, $err, 400);
        $id = (int)$route['member_id'];
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$id]); $m = $ms->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);
        // Holding admin.password_reset lets you reset SOMEONE — not anyone. You can't
        // reset an account more privileged than your own (a Mentor - Lead taking over
        // the System Administrator). The UI hid that account; this actually stops it.
        if (!Permissions::canManageCredentialsOf($pdo, $cur, $id)) {
            return Http::error($res, "You don't have permission to reset this account's password.", 403);
        }
        // Force the member to set their own password at next login.
        $pdo->prepare("UPDATE members SET password_hash = ?, force_password_change = true WHERE id = ?")->execute([password_hash($pw, PASSWORD_BCRYPT), $id]);
        // Security #3: kick every existing session for the reset account.
        Auth::bumpTokenVersion($pdo, $id);
        // Record the IP: without it an admin-initiated reset is indistinguishable from
        // a member's own "Forgot password?" in the audit log, which is exactly what made
        // a lockout investigation hard. Also name the path explicitly.
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'password_reset', null,
            ['target_member_id' => $id, 'method' => 'admin_reset'], null, Http::clientIp($req));
        return Http::json($res, ['ok' => true, 'message' => "Password reset for {$m['first_name']} {$m['last_name']}"]);
    }

    public static function impersonate(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.impersonate', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $roleName = $d['role_name'] ?? '';
        $token = Auth::encode([
            'sub' => (string)$cur['id'], 'roles' => [$roleName], 'type' => 'impersonation',
            'impersonating' => $roleName, 'real_admin_id' => (int)$cur['id'],
            'tv' => (int)($cur['token_version'] ?? 0),   // security #3: dies when the admin's own token_version bumps
        ]);
        // Impersonation was previously unrecorded: an admin could assume any role and
        // nothing said who, which role, when, or from where. Anything they then do
        // carries the role in audit_logs.impersonating_role via the request context.
        Audit::write($pdo, (int)$cur['id'], 'members', (int)$cur['id'], 'impersonate_start', null,
            ['impersonating_role' => $roleName], $roleName, Http::clientIp($req));
        return Http::json($res, ['access_token' => $token, 'token_type' => 'bearer', 'impersonating' => $roleName]);
    }

    // ── Programs ─────────────────────────────────────────────────────────
    public static function listPrograms(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.programs', 'read')) return Http::error($res, 'Access denied', 403);
        $progs = $pdo->query("SELECT * FROM programs ORDER BY display_order, name")->fetchAll();
        $out = [];
        foreach ($progs as $p) {
            $tc = $pdo->prepare("SELECT COUNT(id) AS n FROM teams WHERE program_id = ?"); $tc->execute([(int)$p['id']]);
            $ec = $pdo->prepare("SELECT COUNT(id) AS n FROM enrollments WHERE program_id = ? AND status = 'active'"); $ec->execute([(int)$p['id']]);
            $out[] = [
                'id' => (int)$p['id'], 'name' => $p['name'], 'full_name' => $p['full_name'], 'affiliation' => $p['affiliation'],
                'age_range' => $p['age_range'], 'status' => $p['status'], 'description' => $p['description'],
                'display_order' => (int)$p['display_order'], 'quick_attendance' => (bool)($p['quick_attendance'] ?? false),
                'team_count' => (int)$tc->fetch()['n'],
                'active_enrollment_count' => (int)$ec->fetch()['n'],
            ];
        }
        return Http::json($res, $out);
    }

    private const PROGRAM_FIELDS = ['name', 'full_name', 'affiliation', 'age_range', 'status', 'description', 'display_order', 'quick_attendance'];

    public static function createProgram(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.programs', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ex = $pdo->prepare("SELECT 1 FROM programs WHERE name = ?"); $ex->execute([$d['name'] ?? '']);
        if ($ex->fetch()) return Http::error($res, 'Program name already exists', 400);
        $ins = $pdo->prepare("INSERT INTO programs (name, full_name, affiliation, age_range, status, description, display_order, quick_attendance)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $ins->execute([$d['name'] ?? '', $d['full_name'] ?? null, $d['affiliation'] ?? null, $d['age_range'] ?? null,
            $d['status'] ?? 'active', $d['description'] ?? null, (int)($d['display_order'] ?? 0), (int)!empty($d['quick_attendance'])]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'programs', $newId, 'create', null, $d);
        $ps = $pdo->prepare("SELECT * FROM programs WHERE id = ?"); $ps->execute([$newId]); $p = $ps->fetch();
        return Http::json($res, self::serializeProgram($p), 201);
    }

    private static function serializeProgram(array $p): array
    {
        return ['id' => (int)$p['id'], 'name' => $p['name'], 'full_name' => $p['full_name'],
            'affiliation' => $p['affiliation'], 'age_range' => $p['age_range'], 'status' => $p['status'],
            'description' => $p['description'], 'display_order' => (int)$p['display_order'],
            'quick_attendance' => (bool)($p['quick_attendance'] ?? false)];
    }

    public static function updateProgram(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.programs', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['program_id'];
        $ps = $pdo->prepare("SELECT * FROM programs WHERE id = ?"); $ps->execute([$id]); $p = $ps->fetch();
        if (!$p) return Http::error($res, 'Program not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::PROGRAM_FIELDS as $f) if (array_key_exists($f, $d) && $d[$f] !== null) {
            $set[] = "$f = ?";
            $args[] = $f === 'display_order' ? (int)$d[$f] : ($f === 'quick_attendance' ? (int)!empty($d[$f]) : $d[$f]);
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE programs SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'programs', $id, 'update', null, $d);
        $ps2 = $pdo->prepare("SELECT * FROM programs WHERE id = ?"); $ps2->execute([$id]); $p = $ps2->fetch();
        return Http::json($res, self::serializeProgram($p));
    }

    // ── Audit log ────────────────────────────────────────────────────────
    public static function auditLog(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.security', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['table_name'])) { $where[] = "table_name = ?"; $args[] = $q['table_name']; }
        if (!empty($q['actor_id'])) { $where[] = "actor_id = ?"; $args[] = (int)$q['actor_id']; }
        if (!empty($q['action'])) { $where[] = "action = ?"; $args[] = (string)$q['action']; }
        if (!empty($q['from_date'])) { $where[] = "created_at >= ?"; $args[] = substr((string)$q['from_date'], 0, 10) . ' 00:00:00'; }
        if (!empty($q['to_date'])) { $where[] = "created_at <= ?"; $args[] = substr((string)$q['to_date'], 0, 10) . ' 23:59:59'; }
        $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $cnt = $pdo->prepare("SELECT COUNT(*) AS n FROM audit_logs$whereSql"); $cnt->execute($args);
        $total = (int)$cnt->fetch()['n'];
        $skip = (int)($q['skip'] ?? 0); $limit = (int)($q['limit'] ?? 100);
        $s = $pdo->prepare("SELECT * FROM audit_logs$whereSql ORDER BY created_at DESC LIMIT $limit OFFSET $skip");
        $s->execute($args);
        $logs = $s->fetchAll();
        $actorIds = array_values(array_unique(array_filter(array_map(fn($l) => $l['actor_id'] !== null ? (int)$l['actor_id'] : null, $logs), fn($v) => $v !== null)));
        $names = [];
        if ($actorIds) {
            $ph = implode(',', array_fill(0, count($actorIds), '?'));
            $ns = $pdo->prepare("SELECT id, first_name, last_name FROM members WHERE id IN ($ph)"); $ns->execute($actorIds);
            foreach ($ns->fetchAll() as $m) $names[(int)$m['id']] = trim($m['first_name'] . ' ' . $m['last_name']);
        }
        $result = array_map(fn($l) => [
            'id' => (int)$l['id'], 'actor_id' => $l['actor_id'] !== null ? (int)$l['actor_id'] : null,
            'actor_name' => $l['actor_id'] !== null ? ($names[(int)$l['actor_id']] ?? null) : null,
            'impersonating_role' => $l['impersonating_role'], 'table_name' => $l['table_name'],
            'record_id' => $l['record_id'] !== null ? (int)$l['record_id'] : null, 'action' => $l['action'],
            'old_values' => $l['old_values'] ? json_decode($l['old_values'], true) : null,
            'new_values' => $l['new_values'] ? json_decode($l['new_values'], true) : null,
            'ip_address' => $l['ip_address'], 'created_at' => Time::naiveIso($l['created_at']),
        ], $logs);
        // Every distinct action ever recorded, for the filter dropdown (independent of the
        // current filters so the list is always complete).
        $actions = $pdo->query("SELECT DISTINCT action FROM audit_logs WHERE action IS NOT NULL AND action <> '' ORDER BY action")->fetchAll(PDO::FETCH_COLUMN);
        return Http::json($res, ['total' => $total, 'logs' => $result, 'actions' => $actions]);
    }

    // ── Profile layout ───────────────────────────────────────────────────
    private static function loadProfileLayout(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'profile_layout'"); $s->execute();
        $r = $s->fetch();
        $saved = ($r && $r['values']) ? json_decode($r['values'], true) : [];
        if (!is_array($saved)) $saved = [];
        $out = [];
        foreach (self::PROFILE_PANE_CATALOG as $p) $out[$p['key']] = $saved[$p['key']] ?? (self::PROFILE_PANE_DEFAULTS[$p['key']] ?? 'main');
        return $out;
    }

    public static function getProfileLayout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, ['panes' => self::PROFILE_PANE_CATALOG, 'zones' => self::PROFILE_ZONES, 'placement' => (object)self::loadProfileLayout($pdo)]);
    }

    public static function setProfileLayout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.layouts', 'write')) return Http::error($res, 'Access denied', 403);
        $placement = (array)(($req->getParsedBody()['placement'] ?? null) ?: []);
        $validPanes = array_column(self::PROFILE_PANE_CATALOG, 'key');
        $validZones = array_column(self::PROFILE_ZONES, 'key');
        $clean = [];
        foreach ($placement as $k => $v) if (in_array($k, $validPanes, true) && in_array($v, $validZones, true)) $clean[$k] = $v;
        $s = $pdo->prepare("SELECT id FROM system_config WHERE category = 'profile_layout'"); $s->execute(); $row = $s->fetch();
        if (!$row) { $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('profile_layout', 'Member Profile Layout', ?)")->execute([json_encode($clean)]); $cfgId = (int)$pdo->lastInsertId(); }
        else { $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($clean), (int)$row['id']]); $cfgId = (int)$row['id']; }
        Audit::write($pdo, (int)$cur['id'], 'system_config', $cfgId, 'set_profile_layout', null, $clean);
        return Http::json($res, ['ok' => true, 'placement' => (object)self::loadProfileLayout($pdo)]);
    }

    // ── Team-profile pane tabs ───────────────────────────────────────────
    /** The team-profile panes that can be organized into tabs. */
    private const TEAM_PANE_CATALOG = [
        ['key' => 'leadership', 'label' => 'Team Leadership'],
        ['key' => 'roster', 'label' => 'Roster'],
        ['key' => 'social', 'label' => 'Social Media'],
        ['key' => 'discord', 'label' => 'Discord Channels'],
        ['key' => 'events', 'label' => 'Team Events'],
        ['key' => 'plan', 'label' => 'Season Plan'],
        ['key' => 'issues', 'label' => 'Issue Log'],
        ['key' => 'teamroles', 'label' => 'Team Roles'],
        ['key' => 'interviews', 'label' => 'FDP Interviews'],
        ['key' => 'certs', 'label' => 'Certification Score'],
        ['key' => 'time', 'label' => 'Time & Impact'],
        ['key' => 'resources', 'label' => 'Resources'],
        ['key' => 'budget', 'label' => 'Team Budget'],
        ['key' => 'boms', 'label' => 'Purchasing (BOMs)'],
    ];
    private const TEAM_PANE_TABS = [
        ['key' => 'general', 'label' => 'General'],
        ['key' => 'season_plan', 'label' => 'Season Plan'],
        ['key' => 'season', 'label' => 'Continuous Improvement'],
        ['key' => 'team_info', 'label' => 'Finances'],
        ['key' => 'resources', 'label' => 'Resources'],
    ];
    /** Default tab for each pane when nothing has been configured yet. */
    private const TEAM_PANE_DEFAULT_TAB = [
        'leadership' => 'general', 'roster' => 'general', 'social' => 'general', 'discord' => 'general', 'events' => 'general',
        'plan' => 'season_plan', 'issues' => 'season_plan', 'teamroles' => 'season_plan', 'interviews' => 'general',
        'certs' => 'season', 'time' => 'season',
        'resources' => 'resources', 'budget' => 'team_info', 'boms' => 'team_info',
    ];

    private static function loadTeamPaneTabs(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'team_pane_tabs'"); $s->execute();
        $r = $s->fetch();
        $saved = ($r && $r['values']) ? json_decode($r['values'], true) : [];
        if (!is_array($saved)) $saved = [];
        $validTabs = array_column(self::TEAM_PANE_TABS, 'key');
        $out = [];
        foreach (self::TEAM_PANE_CATALOG as $p) {
            $k = $p['key'];
            $out[$k] = (isset($saved[$k]) && in_array($saved[$k], $validTabs, true))
                ? $saved[$k] : (self::TEAM_PANE_DEFAULT_TAB[$k] ?? 'general');
        }
        return $out;
    }

    public static function getTeamPaneLayout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, ['panes' => self::TEAM_PANE_CATALOG, 'tabs' => self::TEAM_PANE_TABS, 'placement' => (object)self::loadTeamPaneTabs($pdo)]);
    }

    public static function setTeamPaneLayout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $cur, 'admin.layouts', 'write')) return Http::error($res, 'Access denied', 403);
        $placement = (array)(($req->getParsedBody()['placement'] ?? null) ?: []);
        $validPanes = array_column(self::TEAM_PANE_CATALOG, 'key');
        $validTabs = array_column(self::TEAM_PANE_TABS, 'key');
        $clean = [];
        foreach ($placement as $k => $v) if (in_array($k, $validPanes, true) && in_array($v, $validTabs, true)) $clean[$k] = $v;
        $s = $pdo->prepare("SELECT id FROM system_config WHERE category = 'team_pane_tabs'"); $s->execute(); $row = $s->fetch();
        if (!$row) { $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('team_pane_tabs', 'Team Profile Pane Tabs', ?)")->execute([json_encode($clean)]); $cfgId = (int)$pdo->lastInsertId(); }
        else { $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($clean), (int)$row['id']]); $cfgId = (int)$row['id']; }
        Audit::write($pdo, (int)$cur['id'], 'system_config', $cfgId, 'set_team_pane_tabs', null, $clean);
        return Http::json($res, ['ok' => true, 'placement' => (object)self::loadTeamPaneTabs($pdo)]);
    }

    // ── Stations ─────────────────────────────────────────────────────────
    private static function stationRoleSummary(PDO $pdo): array
    {
        $out = [];
        foreach (self::STATION_ROLE_NAMES as $rname) {
            $rs = $pdo->prepare("SELECT id FROM system_roles WHERE name = ?"); $rs->execute([$rname]); $role = $rs->fetch();
            if (!$role) continue;
            $ps = $pdo->prepare("SELECT resource_key, level FROM role_permissions WHERE role_id = ?"); $ps->execute([(int)$role['id']]);
            $perms = []; foreach ($ps->fetchAll() as $p) $perms[$p['resource_key']] = $p['level'];
            $out[$rname] = (object)$perms;
        }
        return $out;
    }

    private static function stationRoleFor(PDO $pdo, int $memberId): ?string
    {
        $s = $pdo->prepare("SELECT sr.name FROM member_system_roles msr JOIN system_roles sr ON sr.id = msr.role_id WHERE msr.member_id = ?");
        $s->execute([$memberId]);
        foreach ($s->fetchAll() as $r) if (in_array($r['name'], self::STATION_ROLE_NAMES, true)) return $r['name'];
        return null;
    }

    public static function listStations(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canPerm($pdo, Auth::currentMember($pdo, $req), 'admin.roles', 'read')) return Http::error($res, 'Access denied', 403);
        $stations = $pdo->query("SELECT * FROM members WHERE is_kiosk = true ORDER BY first_name")->fetchAll();
        return Http::json($res, [
            'role_types' => (object)self::stationRoleSummary($pdo),
            'stations' => array_map(fn($s) => [
                'id' => (int)$s['id'], 'name' => $s['first_name'], 'username' => $s['username'],
                'is_active' => (bool)$s['is_active'], 'station_role' => self::stationRoleFor($pdo, (int)$s['id']),
            ], $stations),
        ]);
    }

    private static function nextMemberNumber(PDO $pdo): string
    {
        $rows = $pdo->query("SELECT member_number FROM members WHERE member_number IS NOT NULL")->fetchAll();
        $used = [];
        foreach ($rows as $r) if (ctype_digit((string)$r['member_number'])) $used[(int)$r['member_number']] = true;
        for ($n = 10000; $n < 100000; $n++) if (!isset($used[$n])) return (string)$n;
        return '99999';
    }

    public static function createStation(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $actor, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (!in_array($d['station_role'] ?? '', self::STATION_ROLE_NAMES, true)) return Http::error($res, 'Unknown station type.', 400);
        $ux = $pdo->prepare("SELECT 1 FROM members WHERE LOWER(username) = LOWER(?)"); $ux->execute([$d['username'] ?? '']);
        if ($ux->fetch()) return Http::error($res, 'That username is already taken.', 400);
        if ($err = Auth::passwordError((string)($d['password'] ?? ''))) return Http::error($res, $err, 400);
        $rs = $pdo->prepare("SELECT id FROM system_roles WHERE name = ?"); $rs->execute([$d['station_role']]); $role = $rs->fetch();
        if (!$role) return Http::error($res, 'Station role not found — run migrations.', 400);
        $ins = $pdo->prepare("INSERT INTO members (member_number, username, password_hash, member_type, first_name, last_name, is_kiosk, is_active, force_password_change)
                              VALUES (?, ?, ?, 'volunteer', ?, '(Station)', true, true, false)");
        $ins->execute([self::nextMemberNumber($pdo), $d['username'], password_hash((string)($d['password'] ?? ''), PASSWORD_BCRYPT), $d['name'] ?? '']);
        $ss = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ss->execute([(int)$pdo->lastInsertId()]); $st = $ss->fetch();
        $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")->execute([(int)$st['id'], (int)$role['id']]);
        Audit::write($pdo, (int)$actor['id'], 'members', (int)$st['id'], 'create_station', null, ['username' => $d['username'], 'station_role' => $d['station_role']]);
        return Http::json($res, ['id' => (int)$st['id'], 'username' => $st['username'], 'name' => $st['first_name'], 'station_role' => $d['station_role'], 'is_active' => true]);
    }

    private static function getStation(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ? AND is_kiosk = true"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function resetStationPassword(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $actor, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['station_id'];
        if (!self::getStation($pdo, $id)) return Http::error($res, 'Station not found', 404);
        $d = (array)$req->getParsedBody();
        if ($err = Auth::passwordError((string)($d['password'] ?? ''))) return Http::error($res, $err, 400);
        $pdo->prepare("UPDATE members SET password_hash = ? WHERE id = ?")->execute([password_hash((string)($d['password'] ?? ''), PASSWORD_BCRYPT), $id]);
        Audit::write($pdo, (int)$actor['id'], 'members', $id, 'reset_station_password');
        return Http::json($res, ['ok' => true]);
    }

    public static function setStationActive(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $actor, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['station_id'];
        if (!self::getStation($pdo, $id)) return Http::error($res, 'Station not found', 404);
        $isActive = filter_var($req->getQueryParams()['is_active'] ?? null, FILTER_VALIDATE_BOOLEAN);
        $pdo->prepare("UPDATE members SET is_active = ? WHERE id = ?")->execute([(int)$isActive, $id]);
        Audit::write($pdo, (int)$actor['id'], 'members', $id, 'set_station_active', null, ['is_active' => $isActive]);
        return Http::json($res, ['ok' => true, 'is_active' => $isActive]);
    }

    public static function deleteStation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::canPerm($pdo, $actor, 'admin.roles', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['station_id'];
        $s = self::getStation($pdo, $id);
        if (!$s) return Http::error($res, 'Station not found', 404);
        $pdo->prepare("DELETE FROM members WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$actor['id'], 'members', $id, 'delete_station', ['username' => $s['username']], null);
        return Http::json($res, ['ok' => true]);
    }
}
