<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * RBAC permission engine — a faithful port of app/core/permissions.py.
 * The catalog/defaults are loaded from config/permissions.json (generated from
 * the Python source, so they stay identical).
 */
final class Permissions
{
    private static ?array $cfg = null;
    private const RANK = ['none' => 0, 'read' => 1, 'write' => 2];

    private static function cfg(): array
    {
        if (self::$cfg === null) {
            $path = __DIR__ . '/../../config/permissions.json';
            self::$cfg = json_decode((string)file_get_contents($path), true);
        }
        return self::$cfg;
    }

    public static function catalog(): array { return self::cfg()['PERMISSION_CATALOG']; }
    public static function superRoles(): array { return self::cfg()['SUPER_ROLES']; }
    public static function memberTypeRoleMap(): array { return self::cfg()['MEMBER_TYPE_ROLE_MAP']; }

    public static function defaultLevel(string $key): string
    {
        return self::cfg()['RESOURCE_DEFAULTS'][$key] ?? self::cfg()['DEFAULT_LEVEL'];
    }

    public static function allResourceKeys(): array
    {
        $keys = [];
        foreach (self::catalog() as $mod) {
            foreach ($mod['items'] as $item) {
                $keys[] = $item['key'];
            }
        }
        return $keys;
    }

    public static function resourceModuleMap(): array
    {
        $out = [];
        foreach (self::catalog() as $moduleId => $mod) {
            foreach ($mod['items'] as $item) {
                $out[$item['key']] = $moduleId;
            }
        }
        return $out;
    }

    private static function maxLevel(string $a, string $b): string
    {
        return (self::RANK[$a] ?? 0) >= (self::RANK[$b] ?? 0) ? $a : $b;
    }

    /** Mirrors resolve_member_permissions(). */
    public static function resolve(PDO $pdo, array $roleNames, bool $denyDefault = false): array
    {
        $isSuper = (bool)array_intersect($roleNames, self::superRoles()) && !$denyDefault;
        $allKeys = self::allResourceKeys();
        $resMap  = self::resourceModuleMap();

        if ($isSuper) {
            $resources = array_fill_keys($allKeys, 'write');
            $modules = [];
            foreach (array_keys(self::catalog()) as $m) {
                $modules[$m] = 'write';
            }
            return ['is_super' => true, 'resources' => $resources, 'modules' => $modules, 'deny' => false];
        }

        $byResource = [];
        if ($roleNames) {
            $in = implode(',', array_fill(0, count($roleNames), '?'));
            $sql = "SELECT rp.resource_key, rp.level
                    FROM role_permissions rp
                    JOIN system_roles sr ON sr.id = rp.role_id
                    WHERE sr.name IN ($in) AND sr.is_active = true";
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array_values($roleNames));
            foreach ($stmt->fetchAll() as $r) {
                $k = $r['resource_key'];
                $byResource[$k] = isset($byResource[$k]) ? self::maxLevel($byResource[$k], $r['level']) : $r['level'];
            }
        }

        $resources = [];
        foreach ($allKeys as $k) {
            $resources[$k] = $byResource[$k] ?? ($denyDefault ? 'none' : self::defaultLevel($k));
        }

        $modules = [];
        foreach ($resources as $k => $level) {
            $mod = $resMap[$k];
            $modules[$mod] = self::maxLevel($modules[$mod] ?? 'none', $level);
        }

        return ['is_super' => false, 'resources' => $resources, 'modules' => $modules, 'deny' => $denyDefault];
    }

    /** Explicit active roles + implicit-by-type (none for kiosks). */
    public static function effectiveRolesFor(PDO $pdo, array $member): array
    {
        $stmt = $pdo->prepare(
            "SELECT sr.name FROM member_system_roles msr
             JOIN system_roles sr ON sr.id = msr.role_id
             WHERE msr.member_id = ? AND sr.is_active = true"
        );
        $stmt->execute([$member['id']]);
        $names = array_column($stmt->fetchAll(), 'name');

        if (!empty($member['is_kiosk'])) {
            return array_values(array_unique($names));
        }
        // An unassigned member (no explicit role beyond "Default") does NOT silently
        // inherit their member_type role — they resolve to "Default" only, so access
        // is explicit and locked down until an admin assigns a real role.
        $nonDefault = array_values(array_diff($names, ['Default']));
        if (!$nonDefault) {
            return $names ? ['Default'] : [];
        }
        // Has a real role → keep the implicit member_type role as before.
        $implicit = self::memberTypeRoleMap()[$member['member_type']] ?? null;
        if ($implicit) {
            $names[] = $implicit;
        }
        return array_values(array_unique($names));
    }

    /**
     * May $actor reset the password / manage the credentials of member $targetId?
     *
     * The permission check (admin.password_reset / members.edit_others) only decides
     * whether you can reset SOMEONE. It says nothing about WHO, so a Mentor - Lead
     * holding admin.password_reset could reset the System Administrator's account and
     * take it over — the UI merely hid that account (is_system=1); the API did not
     * stop it. This is the missing target check.
     *
     * Rule: you can't reset an account more privileged than yourself.
     *   - Only a System Administrator may reset a System Administrator.
     *   - Only an Admin or System Administrator may reset an Admin.
     * Resetting your own account is always allowed (recovery shouldn't self-lock).
     */
    public static function canManageCredentialsOf(PDO $pdo, array $actor, int $targetId): bool
    {
        if ((int)$actor['id'] === $targetId) return true;

        $ts = $pdo->prepare("SELECT * FROM members WHERE id = ?");
        $ts->execute([$targetId]);
        $target = $ts->fetch();
        if (!$target) return true;   // let the caller's own 404 handling take over

        $targetRoles = self::effectiveRolesFor($pdo, $target);
        $actorRoles  = self::effectiveRolesFor($pdo, $actor);

        if (in_array('System Administrator', $targetRoles, true)) {
            return in_array('System Administrator', $actorRoles, true);
        }
        if (in_array('Admin', $targetRoles, true)) {
            return in_array('System Administrator', $actorRoles, true)
                || in_array('Admin', $actorRoles, true);
        }
        return true;
    }

    /** Mirrors require_roles(): Admin/System Administrator always pass; otherwise
     *  the member must effectively hold one of the named roles. */
    public static function hasAnyRole(PDO $pdo, array $member, array $roles): bool
    {
        $eff = self::effectiveRolesFor($pdo, $member);
        if (array_intersect($eff, self::superRoles()) || in_array('Admin', $eff, true)) {
            return true;
        }
        return (bool)array_intersect($eff, $roles);
    }

    /**
     * Admin / System Administrator only. Self-documenting replacement for the
     * hasAnyRole($pdo, $m, []) idiom, whose empty-array "= superuser only" contract
     * is easy to misread (F9). Delegates to hasAnyRole with no named roles, so the
     * two are guaranteed identical — Admin and every super role pass, nobody else.
     */
    public static function isSuperAdmin(PDO $pdo, array $member): bool
    {
        return self::hasAnyRole($pdo, $member, []);
    }

    public static function memberResourceLevel(PDO $pdo, array $member): array
    {
        $eff = self::effectiveRolesFor($pdo, $member);
        // Kiosks and unassigned ("Default"-only / no-role) members resolve with a
        // deny-default floor: they get ONLY what their (typically empty) roles grant,
        // never the permissive write fallback.
        $deny = !empty($member['is_kiosk']) || $eff === [] || $eff === ['Default'];
        return self::resolve($pdo, $eff, $deny);
    }

    public static function memberCan(PDO $pdo, array $member, string $key, string $level = 'write'): bool
    {
        $perms = self::memberResourceLevel($pdo, $member);
        if ($perms['is_super']) {
            return true;
        }
        // For a deny-default member (unassigned / Default-only / kiosk) an unknown
        // key is "none", never the permissive write fallback.
        $have = $perms['resources'][$key] ?? (!empty($perms['deny']) ? 'none' : self::defaultLevel($key));
        return (self::RANK[$have] ?? 0) >= (self::RANK[$level] ?? 0);
    }
}
