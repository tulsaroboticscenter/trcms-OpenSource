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
 * Member groups (YLC, committees, crews…). A group has members and can be tied
 * to events; a group's upcoming events surface to its members' dashboards.
 */
final class GroupsController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        // Admins/System Administrators pass as super; others need groups.manage granted.
        return $m !== null && Permissions::memberCan($pdo, $m, 'groups.manage', 'write');
    }

    /** A non-'manual' group derives its membership automatically (can't be hand-edited). */
    private static function isAuto(array $group): bool
    {
        return ($group['source'] ?? 'manual') !== 'manual';
    }

    /** Member rows for a group, honoring its source ('ylc' → current YLC members). */
    private static function memberRows(PDO $pdo, array $group): array
    {
        if (($group['source'] ?? 'manual') === 'ylc') {
            return $pdo->query(
                "SELECT m.id, m.first_name, m.last_name, m.member_type
                 FROM youth_roles y JOIN members m ON m.id = y.member_id
                 WHERE y.ylc_member = 1 AND m.is_active = 1 AND (m.is_archived = 0 OR m.is_archived IS NULL)
                 ORDER BY m.first_name, m.last_name")->fetchAll();
        }
        $s = $pdo->prepare(
            "SELECT m.id, m.first_name, m.last_name, m.member_type, gm.role_label FROM member_group_members gm
             JOIN members m ON m.id = gm.member_id WHERE gm.group_id = ? ORDER BY m.first_name, m.last_name");
        $s->execute([(int)$group['id']]);
        return $s->fetchAll();
    }

    private static function memberCount(PDO $pdo, array $group): int
    {
        if (($group['source'] ?? 'manual') === 'ylc') {
            return (int)$pdo->query(
                "SELECT COUNT(*) FROM youth_roles y JOIN members m ON m.id = y.member_id
                 WHERE y.ylc_member = 1 AND m.is_active = 1 AND (m.is_archived = 0 OR m.is_archived IS NULL)")->fetchColumn();
        }
        $s = $pdo->prepare("SELECT COUNT(*) FROM member_group_members WHERE group_id = ?");
        $s->execute([(int)$group['id']]);
        return (int)$s->fetchColumn();
    }

    private static function upcomingEvents(PDO $pdo, int $groupId, int $limit = 20): array
    {
        $s = $pdo->prepare(
            "SELECT e.id, e.name, e.event_date, e.start_time, e.location
             FROM event_groups eg JOIN events e ON e.id = eg.event_id
             WHERE eg.group_id = ? AND (e.event_date >= CURDATE() OR e.end_date >= CURDATE())
             ORDER BY e.event_date, e.start_time LIMIT $limit");
        $s->execute([$groupId]);
        return array_map(fn($e) => [
            'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'],
            'start_time' => $e['start_time'], 'location' => $e['location'],
        ], $s->fetchAll());
    }

    // GET /groups — all groups + member counts.
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT * FROM member_groups ORDER BY is_active DESC, name")->fetchAll();
        return Http::json($res, array_map(fn($g) => [
            'id' => (int)$g['id'], 'name' => $g['name'], 'description' => $g['description'],
            'is_active' => (bool)$g['is_active'], 'member_count' => self::memberCount($pdo, $g),
            'source' => $g['source'] ?? 'manual', 'auto_managed' => self::isAuto($g),
        ], $rows));
    }

    // GET /groups/{group_id} — group with members + upcoming events.
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['group_id'];
        $g = $pdo->prepare("SELECT * FROM member_groups WHERE id = ?"); $g->execute([$id]);
        $group = $g->fetch();
        if (!$group) return Http::error($res, 'Group not found', 404);
        // Security #13: group info stays visible, but the MEMBER ROSTER is shown only to a member
        // of the group or a group manager — it was previously readable for any group by anyone.
        $inGroup = $pdo->prepare("SELECT 1 FROM member_group_members WHERE group_id = ? AND member_id = ? LIMIT 1");
        $inGroup->execute([$id, (int)$me['id']]);
        $canSeeMembers = (bool)$inGroup->fetchColumn() || Permissions::memberCan($pdo, $me, 'groups.manage', 'write');
        $positionOptions = null;
        if (!empty($group['position_options'])) {
            $decoded = json_decode((string)$group['position_options'], true);
            if (is_array($decoded)) $positionOptions = array_values(array_filter(array_map('strval', $decoded), fn($p) => trim($p) !== ''));
        }
        return Http::json($res, [
            'id' => (int)$group['id'], 'name' => $group['name'], 'description' => $group['description'],
            'is_active' => (bool)$group['is_active'],
            'source' => $group['source'] ?? 'manual', 'auto_managed' => self::isAuto($group),
            'position_options' => $positionOptions,
            'members' => $canSeeMembers ? array_map(fn($m) => [
                'id' => (int)$m['id'], 'name' => trim("{$m['first_name']} {$m['last_name']}"), 'member_type' => $m['member_type'],
                'role' => $m['role_label'] ?? null,
            ], self::memberRows($pdo, $group)) : [],
            'upcoming_events' => self::upcomingEvents($pdo, $id),
        ]);
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'A group name is required.', 422);
        try {
            $pdo->prepare("INSERT INTO member_groups (name, description, created_by_id, created_at) VALUES (?,?,?,NOW())")
                ->execute([$d['name'], $d['description'] ?? null, (int)$cur['id']]);
        } catch (\Throwable $e) { return Http::error($res, 'A group with that name already exists.', 409); }
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'member_groups', $id, 'create', null, ['name' => $d['name']]);
        return self::get($req, $res, ['group_id' => $id]);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['group_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'description', 'is_active'] as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $f === 'is_active' ? (int)(bool)$d[$f] : $d[$f]; }
        }
        // Per-group position/title options: a list of strings, or empty to fall back to defaults.
        if (array_key_exists('position_options', $d)) {
            $opts = array_values(array_filter(array_map(fn($p) => trim((string)$p), (array)$d['position_options']), fn($p) => $p !== ''));
            $set[] = 'position_options = ?'; $args[] = $opts ? json_encode($opts) : null;
        }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE member_groups SET " . implode(', ', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'member_groups', $id, 'update');
        return self::get($req, $res, ['group_id' => $id]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['group_id'];
        $pdo->prepare("DELETE FROM member_group_members WHERE group_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM event_groups WHERE group_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM member_groups WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'member_groups', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // PUT /groups/{group_id}/members — set the full member list.
    public static function setMembers(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['group_id'];
        $gr = $pdo->prepare("SELECT * FROM member_groups WHERE id = ?"); $gr->execute([$id]); $group = $gr->fetch();
        if (!$group) return Http::error($res, 'Group not found', 404);
        if (self::isAuto($group)) return Http::error($res, "This group's members are managed automatically and can't be edited by hand.", 422);
        $body = (array)$req->getParsedBody();
        $wanted = array_values(array_unique(array_map('intval', (array)($body['member_ids'] ?? []))));
        // Optional per-member position (President/Vice President/Secretary/…), keyed by
        // member id. Used to identify a group's officers (e.g. who can lock its minutes).
        $positions = (array)($body['positions'] ?? []);
        $pdo->prepare("DELETE FROM member_group_members WHERE group_id = ?")->execute([$id]);
        $ins = $pdo->prepare("INSERT IGNORE INTO member_group_members (group_id, member_id, role_label) VALUES (?, ?, ?)");
        foreach ($wanted as $mid) {
            if ($mid <= 0) continue;
            $role = trim((string)($positions[(string)$mid] ?? ''));
            $ins->execute([$id, $mid, $role !== '' ? mb_substr($role, 0, 50) : null]);
        }
        Audit::write($pdo, (int)$cur['id'], 'member_groups', $id, 'set_members', null, ['count' => count($wanted)]);
        return self::get($req, $res, ['group_id' => $id]);
    }

    // GET /groups/mine/events — upcoming events across the caller's groups (dashboard).
    public static function myUpcomingEvents(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$cur['id'];

        // Groups the caller belongs to: hand-picked memberships, plus any
        // auto-managed 'ylc' group when the caller is a current YLC member.
        $groupIds = [];
        $mm = $pdo->prepare("SELECT group_id FROM member_group_members WHERE member_id = ?"); $mm->execute([$mid]);
        foreach ($mm->fetchAll() as $r) $groupIds[] = (int)$r['group_id'];
        $yq = $pdo->prepare("SELECT 1 FROM youth_roles WHERE member_id = ? AND ylc_member = 1"); $yq->execute([$mid]);
        if ($yq->fetch()) {
            foreach ($pdo->query("SELECT id FROM member_groups WHERE source = 'ylc'")->fetchAll() as $r) $groupIds[] = (int)$r['id'];
        }
        $groupIds = array_values(array_unique($groupIds));
        if (!$groupIds) return Http::json($res, []);

        $in = implode(',', array_fill(0, count($groupIds), '?'));
        $s = $pdo->prepare(
            "SELECT DISTINCT e.id, e.name, e.event_date, e.start_time, e.location, g.name AS group_name, g.id AS group_id
             FROM event_groups eg
             JOIN member_groups g ON g.id = eg.group_id
             JOIN events e ON e.id = eg.event_id
             WHERE eg.group_id IN ($in) AND (e.event_date >= CURDATE() OR e.end_date >= CURDATE())
             ORDER BY e.event_date, e.start_time LIMIT 30");
        $s->execute($groupIds);
        return Http::json($res, array_map(fn($e) => [
            'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'],
            'start_time' => $e['start_time'], 'location' => $e['location'],
            'group_id' => (int)$e['group_id'], 'group_name' => $e['group_name'],
        ], $s->fetchAll()));
    }
}
