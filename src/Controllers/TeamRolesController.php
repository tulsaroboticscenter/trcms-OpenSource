<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Team Member Roles (#127). Team-leader-defined roles unique to each team/season
 * (Design Lead, Build Team…), separate from the admin system roles. Members can
 * hold several; roles can be assigned to Season Plan activities. Team managers
 * (planning.manage) maintain them; everyone on the team can view.
 */
final class TeamRolesController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'planning.manage', 'write');
    }

    private static function members(PDO $pdo, int $roleId): array
    {
        $s = $pdo->prepare(
            "SELECT m.id, m.first_name, m.last_name FROM team_role_members trm
             JOIN members m ON m.id = trm.member_id WHERE trm.team_role_id = ? ORDER BY m.first_name, m.last_name"
        );
        $s->execute([$roleId]);
        return array_map(fn($r) => ['member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name'])], $s->fetchAll());
    }

    /** GET /planning/team/{team_season_id}/roles */
    /** True if the member is on that team season, or may view any team's roster. */
    private static function canViewTeam(PDO $pdo, int $memberId, int $teamSeasonId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE team_season_id = ? AND member_id = ? LIMIT 1");
        $s->execute([$teamSeasonId, $memberId]);
        if ($s->fetchColumn()) return true;
        $m = Auth::loadMember($pdo, $memberId);
        return $m !== null && Permissions::memberCan($pdo, $m, 'teams.roster_others', 'read');
    }

    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $tsid = (int)$route['team_season_id'];
        // Security #13: team-internal — team members or a roster-viewer only.
        if (!self::canViewTeam($pdo, (int)$me['id'], $tsid)) return Http::error($res, 'Access denied', 403);
        $st = $pdo->prepare("SELECT * FROM team_roles WHERE team_season_id = ? ORDER BY sort_order, name");
        $st->execute([$tsid]);
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'name' => $r['name'], 'sort_order' => (int)$r['sort_order'],
            'members' => self::members($pdo, (int)$r['id']),
        ], $st->fetchAll()));
    }

    public static function create(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') return Http::error($res, 'A role name is required.', 422);
        $pdo->prepare("INSERT INTO team_roles (team_season_id, name, sort_order, created_by_id, created_at) VALUES (?,?,?,?,NOW())")
            ->execute([$tsid, $name, (int)($d['sort_order'] ?? 0), (int)$m['id']]);
        $id = (int)$pdo->lastInsertId();
        if (!empty($d['member_ids'])) self::syncMembers($pdo, $id, (array)$d['member_ids']);
        Audit::write($pdo, (int)$m['id'], 'team_roles', $id, 'create', null, ['name' => $name]);
        return self::list($req, $res, $route);
    }

    /** PATCH /planning/roles/{role_id} — rename, reorder, or set members. */
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['role_id'];
        $r = $pdo->prepare("SELECT * FROM team_roles WHERE id = ?"); $r->execute([$id]); $role = $r->fetch();
        if (!$role) return Http::error($res, 'Role not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('name', $d) && trim((string)$d['name']) !== '') { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('sort_order', $d)) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE team_roles SET " . implode(', ', $set) . " WHERE id = ?")->execute($args); }
        if (array_key_exists('member_ids', $d)) self::syncMembers($pdo, $id, (array)$d['member_ids']);
        Audit::write($pdo, (int)$m['id'], 'team_roles', $id, 'update', null, null);
        $route['team_season_id'] = (int)$role['team_season_id'];
        return self::list($req, $res, $route);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM team_roles WHERE id = ?")->execute([(int)$route['role_id']]);
        Audit::write($pdo, (int)$m['id'], 'team_roles', (int)$route['role_id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /planning/team/{team_season_id}/roles/reorder — set the display order from a
     * dragged list. Body: { ordered_ids: [roleId, …] }. Each role's sort_order becomes
     * its index in the list. Only ids that actually belong to this team-season are
     * touched, so a stale or tampered id can't reorder another team's roles.
     */
    public static function reorder(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $d = (array)$req->getParsedBody();
        $ids = array_values(array_filter(array_map('intval', (array)($d['ordered_ids'] ?? []))));
        if (!$ids) return Http::error($res, 'ordered_ids is required.', 422);

        // Which of those ids really belong to this team-season.
        $own = [];
        $q = $pdo->prepare("SELECT id FROM team_roles WHERE team_season_id = ?");
        $q->execute([$tsid]);
        foreach ($q->fetchAll() as $r) $own[(int)$r['id']] = true;

        $upd = $pdo->prepare("UPDATE team_roles SET sort_order = ? WHERE id = ? AND team_season_id = ?");
        $order = 0;
        foreach ($ids as $id) {
            if (!isset($own[$id])) continue;
            $upd->execute([$order++, $id, $tsid]);
        }
        Audit::write($pdo, (int)$m['id'], 'team_roles', $tsid, 'reorder', null, ['ordered_ids' => $ids]);
        return self::list($req, $res, $route);
    }

    private static function syncMembers(PDO $pdo, int $roleId, array $ids): void
    {
        $pdo->prepare("DELETE FROM team_role_members WHERE team_role_id = ?")->execute([$roleId]);
        foreach (array_unique(array_map('intval', $ids)) as $mid) {
            if ($mid) $pdo->prepare("INSERT IGNORE INTO team_role_members (team_role_id, member_id) VALUES (?, ?)")->execute([$roleId, $mid]);
        }
    }
}
