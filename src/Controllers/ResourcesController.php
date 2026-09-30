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
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/resources/router.py (prefix /api/v1/resources). */
final class ResourcesController
{
    private const RESOURCE_SCOPES = ['team', 'trc'];
    private const ATTRIBUTE_TYPES = ['url', 'text', 'longtext', 'file', 'select'];

    private static function canManage(PDO $pdo, array $m): bool
    {
        return Permissions::memberCan($pdo, $m, 'resources.manage', 'write');
    }

    /** Granting/revoking access is a separate permission from managing resources. */
    private static function canGrant(PDO $pdo, array $m): bool
    {
        return Permissions::memberCan($pdo, $m, 'resources.grant', 'write');
    }

    // ── serialization ────────────────────────────────────────────────────
    private static function serializeType(array $t): array
    {
        return [
            'id' => (int)$t['id'], 'name' => $t['name'], 'icon' => $t['icon'],
            'attributes' => $t['attributes'] ? json_decode($t['attributes'], true) : [],
            'sort_order' => (int)($t['sort_order'] ?? 0), 'is_active' => (bool)$t['is_active'],
        ];
    }

    private static function serializeResource(PDO $pdo, array $r, int $viewerId, bool $isManager): array
    {
        $rt = null;
        if ($r['resource_type_id']) {
            $s = $pdo->prepare("SELECT * FROM resource_types WHERE id = ?"); $s->execute([(int)$r['resource_type_id']]);
            $rt = $s->fetch() ?: null;
        }
        $as = $pdo->prepare("SELECT ra.*, m.first_name, m.last_name FROM resource_access ra
                             LEFT JOIN members m ON m.id = ra.member_id WHERE ra.resource_id = ?");
        $as->execute([(int)$r['id']]);
        $access = $as->fetchAll();
        $granted = array_filter($access, fn($a) => $a['status'] === 'granted');
        $pending = array_filter($access, fn($a) => $a['status'] === 'requested');
        $mine = null;
        foreach ($access as $a) { if ((int)$a['member_id'] === $viewerId) { $mine = $a; break; } }
        $d = [
            'id' => (int)$r['id'], 'name' => $r['name'], 'scope' => $r['scope'],
            'team_season_id' => $r['team_season_id'] !== null ? (int)$r['team_season_id'] : null,
            'resource_type' => $rt ? self::serializeType($rt) : null,
            'values' => $r['values'] ? json_decode($r['values'], true) : new \stdClass(),
            'notes' => $r['notes'], 'resets_each_season' => (bool)$r['resets_each_season'],
            'needs_update' => (bool)$r['needs_update'], 'sort_order' => (int)($r['sort_order'] ?? 0),
            'granted_count' => count($granted), 'pending_count' => count($pending),
            'my_status' => $mine ? $mine['status'] : null,
        ];
        if ($isManager) {
            usort($access, fn($x, $y) => [$x['status'] !== 'requested', (int)$x['member_id']] <=> [$y['status'] !== 'requested', (int)$y['member_id']]);
            $d['access'] = array_map(fn($a) => [
                'member_id' => (int)$a['member_id'],
                'member_name' => self::name($a),
                'status' => $a['status'],
                'requested_at' => Time::naiveIso($a['requested_at']),
                'granted_at' => Time::naiveIso($a['granted_at']),
            ], array_values($access));
        }
        return $d;
    }

    private static function name(array $row): ?string
    {
        if (($row['first_name'] ?? null) === null && ($row['last_name'] ?? null) === null) return null;
        return trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
    }

    private static function loadResources(PDO $pdo, string $extraWhere, array $args): array
    {
        $s = $pdo->prepare("SELECT * FROM resources WHERE is_archived = false AND $extraWhere ORDER BY sort_order, id");
        $s->execute($args);
        return $s->fetchAll();
    }

    private static function cleanAttributes($attrs): array
    {
        $out = [];
        foreach (($attrs ?: []) as $a) {
            $key = trim((string)($a['key'] ?? ''));
            if ($key === '') continue;
            $atype = in_array($a['type'] ?? null, self::ATTRIBUTE_TYPES, true) ? $a['type'] : 'text';
            $out[] = [
                'key' => $key, 'label' => trim((string)($a['label'] ?? $key)) ?: $key,
                'type' => $atype, 'required' => (bool)($a['required'] ?? false),
                'options' => $atype === 'select' ? ($a['options'] ?? null) : null,
            ];
        }
        return $out;
    }

    // ── Types ────────────────────────────────────────────────────────────
    public static function listTypes(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT * FROM resource_types WHERE is_active = true ORDER BY sort_order, name")->fetchAll();
        return Http::json($res, array_map([self::class, 'serializeType'], $rows));
    }

    public static function createType(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor || !Permissions::isSuperAdmin($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO resource_types (name, icon, attributes, sort_order, is_active, created_at)
                              VALUES (?, ?, ?, ?, true, NOW())");
        $ins->execute([trim((string)($d['name'] ?? '')), ($d['icon'] ?? null) ?: null,
            json_encode(self::cleanAttributes($d['attributes'] ?? [])), (int)($d['sort_order'] ?? 0)]);
        $id = (int)$pdo->lastInsertId();
        $s = $pdo->prepare("SELECT * FROM resource_types WHERE id = ?"); $s->execute([$id]); $t = $s->fetch();
        Audit::write($pdo, (int)$actor['id'], 'resource_types', $id, 'create', null, ['name' => $t['name']]);
        return Http::json($res, self::serializeType($t), 201);
    }

    public static function updateType(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor || !Permissions::isSuperAdmin($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['type_id'];
        $s = $pdo->prepare("SELECT * FROM resource_types WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Resource type not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (!empty($d['name'])) { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('icon', $d)) { $set[] = 'icon = ?'; $args[] = ($d['icon'] ?? null) ?: null; }
        if (array_key_exists('attributes', $d) && $d['attributes'] !== null) { $set[] = 'attributes = ?'; $args[] = json_encode(self::cleanAttributes($d['attributes'])); }
        if (array_key_exists('sort_order', $d) && $d['sort_order'] !== null) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE resource_types SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$actor['id'], 'resource_types', $id, 'update');
        $s2 = $pdo->prepare("SELECT * FROM resource_types WHERE id = ?"); $s2->execute([$id]);
        return Http::json($res, self::serializeType($s2->fetch()));
    }

    public static function deactivateType(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor || !Permissions::isSuperAdmin($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['type_id'];
        $s = $pdo->prepare("SELECT 1 FROM resource_types WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Resource type not found', 404);
        $pdo->prepare("UPDATE resource_types SET is_active = false WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$actor['id'], 'resource_types', $id, 'deactivate');
        return Http::json($res, ['ok' => true]);
    }

    // ── Resources ────────────────────────────────────────────────────────
    public static function listTeamResources(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'resources.view', 'read')) return Http::error($res, 'Access denied', 403);
        $mgr = self::canGrant($pdo, $cur);
        $rows = self::loadResources($pdo, "scope = 'team' AND team_season_id = ?", [(int)$route['team_season_id']]);
        return Http::json($res, array_map(fn($r) => self::serializeResource($pdo, $r, (int)$cur['id'], $mgr), $rows));
    }

    public static function listTrcResources(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'resources.trc', 'read')) return Http::error($res, 'Access denied', 403);
        $mgr = self::canGrant($pdo, $cur);
        $rows = self::loadResources($pdo, "scope = 'trc'", []);
        return Http::json($res, array_map(fn($r) => self::serializeResource($pdo, $r, (int)$cur['id'], $mgr), $rows));
    }

    private static function loadResource(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM resources WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function createResource(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $actor)) return Http::error($res, "You don't have permission to manage resources.", 403);
        $d = (array)$req->getParsedBody();
        $scope = $d['scope'] ?? 'team';
        if (!in_array($scope, self::RESOURCE_SCOPES, true)) return Http::error($res, 'scope must be one of ' . json_encode(self::RESOURCE_SCOPES), 400);
        if ($scope === 'team' && empty($d['team_season_id'])) return Http::error($res, 'team_season_id is required for team resources.', 400);
        $ins = $pdo->prepare("INSERT INTO resources (resource_type_id, scope, team_season_id, name, `values`, notes, resets_each_season, needs_update, sort_order, is_archived, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, false, ?, false, NOW(), NOW())");
        $ins->execute([
            isset($d['resource_type_id']) ? (int)$d['resource_type_id'] : null, $scope,
            $scope === 'team' ? (int)$d['team_season_id'] : null, trim((string)($d['name'] ?? '')),
            json_encode($d['values'] ?? new \stdClass()), ($d['notes'] ?? null) ?: null,
            (int)(bool)($d['resets_each_season'] ?? false), (int)($d['sort_order'] ?? 0),
        ]);
        $id = (int)$pdo->lastInsertId();
        $r = self::loadResource($pdo, $id);
        Audit::write($pdo, (int)$actor['id'], 'resources', $id, 'create', null, ['name' => $r['name'], 'scope' => $r['scope']]);
        return Http::json($res, self::serializeResource($pdo, $r, (int)$actor['id'], self::canGrant($pdo, $actor)), 201);
    }

    public static function updateResource(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $actor)) return Http::error($res, "You don't have permission to manage resources.", 403);
        $r = self::loadResource($pdo, (int)$route['resource_id']);
        if (!$r) return Http::error($res, 'Resource not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (!empty($d['name'])) { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('resource_type_id', $d) && $d['resource_type_id'] !== null) { $set[] = 'resource_type_id = ?'; $args[] = $d['resource_type_id'] ? (int)$d['resource_type_id'] : null; }
        if (array_key_exists('values', $d) && $d['values'] !== null) { $set[] = '`values` = ?'; $args[] = json_encode($d['values']); $set[] = 'needs_update = false'; }
        if (array_key_exists('notes', $d) && $d['notes'] !== null) { $set[] = 'notes = ?'; $args[] = $d['notes'] ?: null; }
        if (array_key_exists('resets_each_season', $d) && $d['resets_each_season'] !== null) { $set[] = 'resets_each_season = ?'; $args[] = (int)(bool)$d['resets_each_season']; }
        if (array_key_exists('sort_order', $d) && $d['sort_order'] !== null) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = (int)$r['id']; $pdo->prepare("UPDATE resources SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$actor['id'], 'resources', (int)$r['id'], 'update', null, $d);
        return Http::json($res, self::serializeResource($pdo, self::loadResource($pdo, (int)$r['id']), (int)$actor['id'], self::canGrant($pdo, $actor)));
    }

    public static function deleteResource(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $actor)) return Http::error($res, "You don't have permission to manage resources.", 403);
        $id = (int)$route['resource_id'];
        if (!self::loadResource($pdo, $id)) return Http::error($res, 'Resource not found', 404);
        $pdo->prepare("DELETE FROM resources WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$actor['id'], 'resources', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Access ───────────────────────────────────────────────────────────
    private static function upsertAccess(PDO $pdo, int $resourceId, int $memberId): array
    {
        $s = $pdo->prepare("SELECT * FROM resource_access WHERE resource_id = ? AND member_id = ?");
        $s->execute([$resourceId, $memberId]);
        $a = $s->fetch();
        if (!$a) {
            $ins = $pdo->prepare("INSERT INTO resource_access (resource_id, member_id, status, requested_at) VALUES (?, ?, 'requested', NOW())");
            $ins->execute([$resourceId, $memberId]);
            $s2 = $pdo->prepare("SELECT * FROM resource_access WHERE id = ?"); $s2->execute([(int)$pdo->lastInsertId()]);
            return $s2->fetch();
        }
        return $a;
    }

    public static function requestAccess(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $rid = (int)$route['resource_id'];
        $r = self::loadResource($pdo, $rid);
        if (!$r) return Http::error($res, 'Resource not found', 404);
        $need = $r['scope'] === 'trc' ? 'resources.trc' : 'resources.view';
        if (!Permissions::memberCan($pdo, $cur, $need, 'read')) return Http::error($res, 'Access denied', 403);
        // Look up any existing row so we can tell a brand-new/re-request apart from a
        // repeat click (only the former should notify the managers).
        $es = $pdo->prepare("SELECT * FROM resource_access WHERE resource_id = ? AND member_id = ?");
        $es->execute([$rid, (int)$cur['id']]);
        $existing = $es->fetch();
        if ($existing && $existing['status'] === 'granted') return Http::json($res, ['ok' => true, 'status' => 'granted']);
        $wasRequested = $existing && $existing['status'] === 'requested';
        if ($existing) {
            $pdo->prepare("UPDATE resource_access SET status = 'requested', requested_at = NOW() WHERE id = ?")->execute([(int)$existing['id']]);
        } else {
            $pdo->prepare("INSERT INTO resource_access (resource_id, member_id, status, requested_at) VALUES (?, ?, 'requested', NOW())")
                ->execute([$rid, (int)$cur['id']]);
        }
        if (!$wasRequested) self::notifyManagersOfRequest($pdo, $r, $cur);
        return Http::json($res, ['ok' => true, 'status' => 'requested']);
    }

    /**
     * Email resource managers that a new access request is waiting (best-effort).
     * Recipients = active members with a valid email who can grant access:
     * super roles (Admin / System Administrator) or any role granted
     * resources.grant at write level.
     */
    private static function notifyManagersOfRequest(PDO $pdo, array $resource, array $requester): void
    {
        if (!Mailer::enabled()) return;
        // Send to ONE configured mailbox (Admin → Email Settings → "Resource access
        // email", default info@…), NOT to every member who can grant access — that
        // fan-out spammed general members (incl. youth) with access-request emails.
        $to = EmailSettingsController::resourceEmail($pdo);
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return;

        $who = trim(($requester['first_name'] ?? '') . ' ' . ($requester['last_name'] ?? ''));
        if ($who === '') $who = 'A member';
        $resName = htmlspecialchars((string)($resource['name'] ?? 'a resource'));
        $appUrl = rtrim((string)Config::get('APP_URL', ''), '/');
        $link = $appUrl ? "<p><a href='{$appUrl}/resources' style='color:#1565c0'>Review access requests in TRCMS →</a></p>" : '';
        $body = "<p><strong>" . htmlspecialchars($who) . "</strong> has requested access to <strong>{$resName}</strong>.</p>"
              . "<p>They won't be able to open it until a resource manager grants access.</p>{$link}";
        $html = Mailer::wrap('New Resource Access Request', $body);
        $subject = 'Access requested: ' . (string)($resource['name'] ?? 'resource');
        Mailer::send($to, $subject, $html);
    }

    public static function grantAccess(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canGrant($pdo, $actor)) return Http::error($res, "You don't have permission to grant access.", 403);
        $rid = (int)$route['resource_id'];
        if (!self::loadResource($pdo, $rid)) return Http::error($res, 'Resource not found', 404);
        $d = (array)$req->getParsedBody();
        $memberId = (int)($d['member_id'] ?? 0);
        $a = self::upsertAccess($pdo, $rid, $memberId);
        $notesSet = array_key_exists('notes', $d) ? ', notes = ?' : '';
        $args = [(int)$actor['id']];
        if ($notesSet) $args[] = ($d['notes'] ?? null) ?: null;
        $args[] = (int)$a['id'];
        $pdo->prepare("UPDATE resource_access SET status = 'granted', granted_at = NOW(), granted_by_member_id = ?$notesSet WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$actor['id'], 'resource_access', $rid, 'grant', null, ['member_id' => $memberId]);
        return Http::json($res, ['ok' => true, 'status' => 'granted']);
    }

    public static function revokeAccess(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canGrant($pdo, $actor)) return Http::error($res, "You don't have permission to manage access.", 403);
        $rid = (int)$route['resource_id'];
        $d = (array)$req->getParsedBody();
        $s = $pdo->prepare("SELECT id FROM resource_access WHERE resource_id = ? AND member_id = ?");
        $s->execute([$rid, (int)($d['member_id'] ?? 0)]);
        $a = $s->fetch();
        if ($a) {
            $pdo->prepare("UPDATE resource_access SET status = 'revoked' WHERE id = ?")->execute([(int)$a['id']]);
            Audit::write($pdo, (int)$actor['id'], 'resource_access', $rid, 'revoke', null, ['member_id' => (int)($d['member_id'] ?? 0)]);
        }
        return Http::json($res, ['ok' => true, 'status' => 'revoked']);
    }

    public static function pendingRequests(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canGrant($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $sql = "SELECT ra.resource_id, ra.member_id, ra.requested_at, r.name AS resource_name, m.first_name, m.last_name
                FROM resource_access ra JOIN resources r ON r.id = ra.resource_id
                LEFT JOIN members m ON m.id = ra.member_id WHERE ra.status = 'requested'";
        $args = [];
        if (!empty($q['team_season_id'])) { $sql .= " AND r.team_season_id = ?"; $args[] = (int)$q['team_season_id']; }
        if (!empty($q['scope'])) { $sql .= " AND r.scope = ?"; $args[] = $q['scope']; }
        $sql .= " ORDER BY ra.requested_at";
        $s = $pdo->prepare($sql); $s->execute($args);
        $out = [];
        foreach ($s->fetchAll() as $a) {
            $out[] = [
                'resource_id' => (int)$a['resource_id'], 'resource_name' => $a['resource_name'],
                'member_id' => (int)$a['member_id'], 'member_name' => self::name($a),
                'requested_at' => Time::naiveIso($a['requested_at']),
            ];
        }
        return Http::json($res, $out);
    }

    /**
     * GET /resources/access-log?scope=trc|team[&team_season_id=]
     * Consolidated access requests + history for a manager: pending requests to
     * act on, plus recently granted/revoked entries (who acted, when). (#144)
     */
    public static function accessLog(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canGrant($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['scope'])) { $where[] = "r.scope = ?"; $args[] = $q['scope']; }
        if (!empty($q['team_season_id'])) { $where[] = "r.team_season_id = ?"; $args[] = (int)$q['team_season_id']; }
        $clause = $where ? ('AND ' . implode(' AND ', $where)) : '';
        $sql = "SELECT ra.resource_id, ra.member_id, ra.status, ra.requested_at, ra.granted_at,
                       r.name AS resource_name, m.first_name, m.last_name,
                       gb.first_name AS gb_first, gb.last_name AS gb_last
                  FROM resource_access ra
                  JOIN resources r ON r.id = ra.resource_id
                  LEFT JOIN members m ON m.id = ra.member_id
                  LEFT JOIN members gb ON gb.id = ra.granted_by_member_id
                 WHERE ra.status IN ('requested','granted','revoked') $clause
                 ORDER BY COALESCE(ra.granted_at, ra.requested_at) DESC
                 LIMIT 300";
        $s = $pdo->prepare($sql); $s->execute($args);
        $pending = []; $history = [];
        foreach ($s->fetchAll() as $a) {
            $row = [
                'resource_id' => (int)$a['resource_id'], 'resource_name' => $a['resource_name'],
                'member_id' => (int)$a['member_id'], 'member_name' => self::name($a),
                'status' => $a['status'],
                'requested_at' => Time::naiveIso($a['requested_at']),
                'granted_at' => Time::naiveIso($a['granted_at'] ?? null),
                'acted_by' => trim((string)($a['gb_first'] ?? '') . ' ' . (string)($a['gb_last'] ?? '')) ?: null,
            ];
            if ($a['status'] === 'requested') $pending[] = $row; else $history[] = $row;
        }
        return Http::json($res, ['pending' => $pending, 'history' => $history]);
    }

    // ── Season rollover ──────────────────────────────────────────────────
    public static function seasonRollover(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor || !Permissions::isSuperAdmin($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $from = $q['from_season'] ?? null; $to = $q['to_season'] ?? null;
        if (!$from || !$to) return Http::error($res, 'from_season and to_season are required', 422);
        $result = self::rollover($pdo, $from, $to, (int)$actor['id']);
        return Http::json($res, array_merge(['ok' => true, 'from_season' => $from, 'to_season' => $to], $result));
    }

    /** Public entry point so other modules (inventory season-rollover) can reuse it. */
    public static function rolloverResources(PDO $pdo, string $fromSeason, string $toSeason, ?int $actorId): array
    {
        return self::rollover($pdo, $fromSeason, $toSeason, $actorId);
    }

    private static function rollover(PDO $pdo, string $fromSeason, string $toSeason, ?int $actorId): array
    {
        $oldStmt = $pdo->prepare("SELECT team_id, id FROM team_seasons WHERE season = ?"); $oldStmt->execute([$fromSeason]);
        $old = []; foreach ($oldStmt->fetchAll() as $ts) $old[(int)$ts['team_id']] = (int)$ts['id'];
        $newStmt = $pdo->prepare("SELECT team_id, id FROM team_seasons WHERE season = ?"); $newStmt->execute([$toSeason]);
        $new = []; foreach ($newStmt->fetchAll() as $ts) $new[(int)$ts['team_id']] = (int)$ts['id'];
        $copied = 0; $reset = 0;
        foreach ($old as $teamId => $oldTs) {
            $newTs = $new[$teamId] ?? null;
            if (!$newTs) continue;
            $src = $pdo->prepare("SELECT * FROM resources WHERE scope = 'team' AND team_season_id = ? AND is_archived = false");
            $src->execute([$oldTs]);
            foreach ($src->fetchAll() as $s) {
                $isReset = (bool)$s['resets_each_season'];
                $ins = $pdo->prepare("INSERT INTO resources (resource_type_id, scope, team_season_id, name, notes, resets_each_season, sort_order, `values`, needs_update, is_archived, created_at, updated_at)
                                      VALUES (?, 'team', ?, ?, ?, ?, ?, ?, ?, false, NOW(), NOW())");
                $ins->execute([
                    $s['resource_type_id'] !== null ? (int)$s['resource_type_id'] : null, $newTs, $s['name'], $s['notes'],
                    (int)(bool)$s['resets_each_season'], (int)($s['sort_order'] ?? 0),
                    $isReset ? json_encode(new \stdClass()) : ($s['values'] ?: json_encode(new \stdClass())),
                    (int)$isReset,
                ]);
                $nrId = (int)$pdo->lastInsertId();
                if ($isReset) { $reset++; continue; }
                $copied++;
                $acc = $pdo->prepare("SELECT * FROM resource_access WHERE resource_id = ? AND status = 'granted'");
                $acc->execute([(int)$s['id']]);
                foreach ($acc->fetchAll() as $a) {
                    $pdo->prepare("INSERT INTO resource_access (resource_id, member_id, status, granted_at, granted_by_member_id, requested_at)
                                   VALUES (?, ?, 'granted', ?, ?, NOW())")
                        ->execute([$nrId, (int)$a['member_id'], $a['granted_at'], $a['granted_by_member_id'] !== null ? (int)$a['granted_by_member_id'] : null]);
                }
            }
        }
        Audit::write($pdo, $actorId, 'resources', null, 'resource_season_rollover', null, ['from' => $fromSeason, 'to' => $toSeason, 'copied' => $copied, 'reset' => $reset]);
        return ['copied_forward' => $copied, 'reset_blank' => $reset];
    }
}
