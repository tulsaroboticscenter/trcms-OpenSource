<?php
declare(strict_types=1);

namespace App\Reports;

use App\Core\Permissions;
use PDO;

/**
 * Resolves a viewer's reporting entitlement for a dataset: capability (what they
 * may do), row scope (which rows), and max field tier (which columns).
 *
 * Starts from preset role bundles (so the engine is useful before any admin
 * configuration) and then lets explicit report_permissions rows override —
 * the most permissive matching row wins. A report always runs as the viewer,
 * so these values follow whoever runs it.
 */
final class ReportAccess
{
    private const CAP_RANK   = ['none' => 0, 'run' => 1, 'build_scoped' => 2, 'build_full' => 3, 'publish' => 4, 'manage' => 5];
    private const SCOPE_RANK = ['none' => 0, 'self' => 1, 'own_teams' => 2, 'all' => 3];

    /** @return array{capability:string,row_scope:string,max_field_tier:string,roles:string[]} */
    public static function forViewer(PDO $pdo, array $member, string $datasetKey): array
    {
        $roles = Permissions::effectiveRolesFor($pdo, $member);

        // Preset bundle defaults from the member's roles.
        $cap = 'none'; $scope = 'none'; $tier = 'public';
        $apply = function (string $c, string $s, string $t) use (&$cap, &$scope, &$tier) {
            if (self::CAP_RANK[$c] > self::CAP_RANK[$cap]) $cap = $c;
            if (self::SCOPE_RANK[$s] > self::SCOPE_RANK[$scope]) $scope = $s;
            if (Field::tierRank($t) > Field::tierRank($tier)) $tier = $t;
        };
        foreach ($roles as $r) {
            if ($r === 'Admin' || $r === 'System Administrator') $apply('manage', 'all', 'financial');
            elseif ($r === 'Mentor') $apply('build_full', 'own_teams', 'pii');
            elseif ($r === 'Team Leader') $apply('build_scoped', 'own_teams', 'internal');
            else $apply('run', 'self', 'public');
        }
        if ($cap === 'none') $apply('run', 'self', 'public'); // any authenticated member can at least run

        // Explicit matrix overrides (most permissive across the viewer's roles).
        if ($roles) {
            $in = implode(',', array_fill(0, count($roles), '?'));
            $st = $pdo->prepare("SELECT capability, row_scope, max_field_tier FROM report_permissions WHERE dataset = ? AND role_name IN ($in)");
            $st->execute(array_merge([$datasetKey], array_values($roles)));
            foreach ($st->fetchAll() as $row) $apply($row['capability'], $row['row_scope'], $row['max_field_tier']);
        }

        return ['capability' => $cap, 'row_scope' => $scope, 'max_field_tier' => $tier, 'roles' => $roles];
    }

    public static function canBuild(array $access): bool
    {
        return self::CAP_RANK[$access['capability']] >= self::CAP_RANK['build_scoped'];
    }
    public static function canManage(array $access): bool
    {
        return self::CAP_RANK[$access['capability']] >= self::CAP_RANK['manage'];
    }
}
