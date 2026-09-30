<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/shopping/router.py (prefix /api/v1/shopping). */
final class ShoppingController
{
    private const ITEM_FIELDS = ['name', 'quantity', 'unit', 'category_id', 'store_id', 'priority', 'needed_by', 'notes', 'url', 'photo_url', 'est_price'];
    private const NUMERIC = ['quantity', 'est_price'];
    private const INT_FIELDS = ['category_id', 'store_id'];

    private static function f($v): ?float { return $v === null ? null : (float)$v; }

    private static function name($row, string $prefix): ?string
    {
        $fn = $row[$prefix . '_first'] ?? null; $ln = $row[$prefix . '_last'] ?? null;
        if ($fn === null && $ln === null) return null;
        return trim(($fn ?? '') . ' ' . ($ln ?? ''));
    }

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    // ── item serialization (row already joined) ──────────────────────────
    private static function loadItem(PDO $pdo, int $id): ?array
    {
        $sql = "SELECT i.*, c.name AS category_name, c.color AS category_color, st.name AS store_name,
                       rb.first_name AS rb_first, rb.last_name AS rb_last,
                       cb.first_name AS cb_first, cb.last_name AS cb_last,
                       pb.first_name AS pb_first, pb.last_name AS pb_last
                FROM shopping_items i
                LEFT JOIN shopping_categories c ON c.id = i.category_id
                LEFT JOIN shopping_stores st ON st.id = i.store_id
                LEFT JOIN members rb ON rb.id = i.requested_by_id
                LEFT JOIN members cb ON cb.id = i.claimed_by_id
                LEFT JOIN members pb ON pb.id = i.purchased_by_id
                WHERE i.id = ?";
        $s = $pdo->prepare($sql); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function serializeItem(array $i): array
    {
        return [
            'id' => (int)$i['id'], 'name' => $i['name'],
            'quantity' => self::f($i['quantity']), 'unit' => $i['unit'],
            'category_id' => $i['category_id'] !== null ? (int)$i['category_id'] : null,
            'category_name' => $i['category_name'] ?? null, 'category_color' => $i['category_color'] ?? null,
            'store_id' => $i['store_id'] !== null ? (int)$i['store_id'] : null, 'store_name' => $i['store_name'] ?? null,
            'priority' => $i['priority'], 'needed_by' => $i['needed_by'],
            'notes' => $i['notes'], 'url' => $i['url'], 'photo_url' => $i['photo_url'],
            'est_price' => self::f($i['est_price']),
            'requested_by' => self::name($i, 'rb'), 'requested_by_id' => $i['requested_by_id'] !== null ? (int)$i['requested_by_id'] : null,
            'claimed_by' => self::name($i, 'cb'), 'claimed_by_id' => $i['claimed_by_id'] !== null ? (int)$i['claimed_by_id'] : null,
            'status' => $i['status'],
            'purchased_by' => self::name($i, 'pb'),
            'actual_amount' => self::f($i['actual_amount']),
            'created_at' => Time::naiveIso($i['created_at']),
            'claimed_at' => Time::naiveIso($i['claimed_at'] ?? null),
            'purchased_at' => Time::naiveIso($i['purchased_at'] ?? null),
        ];
    }

    // ── Lookups ──────────────────────────────────────────────────────────
    public static function listStores(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'shopping.view', 'read')) return Http::error($res, 'Access denied', 403);
        $includeInactive = filter_var($req->getQueryParams()['include_inactive'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $sql = "SELECT * FROM shopping_stores" . ($includeInactive ? '' : ' WHERE is_active = true') . " ORDER BY display_order, name";
        $rows = $pdo->query($sql)->fetchAll();
        return Http::json($res, array_map(fn($s) => [
            'id' => (int)$s['id'], 'name' => $s['name'], 'is_active' => (bool)$s['is_active'],
            'display_order' => (int)$s['display_order'],
        ], $rows));
    }

    public static function listCategories(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'shopping.view', 'read')) return Http::error($res, 'Access denied', 403);
        $includeInactive = filter_var($req->getQueryParams()['include_inactive'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $sql = "SELECT * FROM shopping_categories" . ($includeInactive ? '' : ' WHERE is_active = true') . " ORDER BY display_order, name";
        $rows = $pdo->query($sql)->fetchAll();
        return Http::json($res, array_map(fn($c) => [
            'id' => (int)$c['id'], 'name' => $c['name'], 'destination' => $c['destination'], 'color' => $c['color'],
            'icon_name' => $c['icon_name'], 'display_order' => (int)$c['display_order'], 'is_active' => (bool)$c['is_active'],
        ], $rows));
    }

    public static function listStaples(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'shopping.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM shopping_staples WHERE is_active = true ORDER BY display_order, name")->fetchAll();
        return Http::json($res, array_map(fn($s) => [
            'id' => (int)$s['id'], 'name' => $s['name'],
            'default_category_id' => $s['default_category_id'] !== null ? (int)$s['default_category_id'] : null,
            'default_store_id' => $s['default_store_id'] !== null ? (int)$s['default_store_id'] : null,
            'default_unit' => $s['default_unit'], 'default_quantity' => self::f($s['default_quantity']),
        ], $rows));
    }

    // ── Items ────────────────────────────────────────────────────────────
    public static function listItems(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'shopping.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['status'])) { $where[] = "i.status = ?"; $args[] = $q['status']; }
        elseif (!filter_var($q['include_done'] ?? false, FILTER_VALIDATE_BOOLEAN)) { $where[] = "i.status IN ('needed','claimed')"; }
        if (!empty($q['store_id'])) { $where[] = "i.store_id = ?"; $args[] = (int)$q['store_id']; }
        if (!empty($q['category_id'])) { $where[] = "i.category_id = ?"; $args[] = (int)$q['category_id']; }
        $sql = "SELECT i.*, c.name AS category_name, c.color AS category_color, st.name AS store_name,
                       rb.first_name AS rb_first, rb.last_name AS rb_last,
                       cb.first_name AS cb_first, cb.last_name AS cb_last,
                       pb.first_name AS pb_first, pb.last_name AS pb_last
                FROM shopping_items i
                LEFT JOIN shopping_categories c ON c.id = i.category_id
                LEFT JOIN shopping_stores st ON st.id = i.store_id
                LEFT JOIN members rb ON rb.id = i.requested_by_id
                LEFT JOIN members cb ON cb.id = i.claimed_by_id
                LEFT JOIN members pb ON pb.id = i.purchased_by_id";
        if ($where) $sql .= " WHERE " . implode(' AND ', $where);
        $sql .= " ORDER BY i.status, i.priority DESC, i.created_at DESC";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, array_map([self::class, 'serializeItem'], $s->fetchAll()));
    }

    /**
     * GET /shopping/items/history — previously purchased items, one row per
     * distinct name (most recent), so they can be re-added with one click.
     */
    public static function history(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'shopping.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ["i.status = 'purchased'"]; $args = [];
        if (!empty($q['search'])) { $where[] = "i.name LIKE ?"; $args[] = '%' . $q['search'] . '%'; }
        $sql = "SELECT i.*, c.name AS category_name, c.color AS category_color, st.name AS store_name,
                       rb.first_name AS rb_first, rb.last_name AS rb_last,
                       cb.first_name AS cb_first, cb.last_name AS cb_last,
                       pb.first_name AS pb_first, pb.last_name AS pb_last
                FROM shopping_items i
                LEFT JOIN shopping_categories c ON c.id = i.category_id
                LEFT JOIN shopping_stores st ON st.id = i.store_id
                LEFT JOIN members rb ON rb.id = i.requested_by_id
                LEFT JOIN members cb ON cb.id = i.claimed_by_id
                LEFT JOIN members pb ON pb.id = i.purchased_by_id
                WHERE " . implode(' AND ', $where) . "
                ORDER BY i.purchased_at DESC, i.id DESC LIMIT 500";
        $s = $pdo->prepare($sql); $s->execute($args);
        // Dedupe by name (keep the most-recent purchase) and collect every past
        // purchase of that name as `entries` (already reverse-chron via the SQL
        // ORDER BY purchased_at DESC) so the row can expand to show who bought it,
        // when, and how much.
        $seen = []; $out = [];
        foreach ($s->fetchAll() as $r) {
            $key = mb_strtolower(trim((string)$r['name']));
            $entry = [
                'id' => (int)$r['id'],
                'purchased_by' => self::name($r, 'pb'),
                'purchased_at' => Time::naiveIso($r['purchased_at'] ?? null),
                'quantity' => self::f($r['quantity']),
                'unit' => $r['unit'],
                'store_name' => $r['store_name'] ?? null,
            ];
            if (isset($seen[$key])) {
                $out[$seen[$key]]['times_bought']++;
                $out[$seen[$key]]['entries'][] = $entry;
                continue;
            }
            if (count($out) >= 80) continue; // still count/collect entries for names already seen
            $item = self::serializeItem($r);
            $item['times_bought'] = 1;
            $item['entries'] = [$entry];
            $seen[$key] = count($out);
            $out[] = $item;
        }
        return Http::json($res, $out);
    }

    private static function itemPayload(array $d): array
    {
        $cols = []; $vals = [];
        foreach (self::ITEM_FIELDS as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = $d[$f];
            if ($v !== null && in_array($f, self::INT_FIELDS, true)) $v = (int)$v;
            $cols[$f] = $v;
        }
        return $cols;
    }

    public static function addItem(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.add', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (trim((string)($d['name'] ?? '')) === '') return Http::error($res, 'Item name is required.', 400);
        $payload = self::itemPayload($d);
        $payload['name'] = trim((string)$payload['name']);
        if (!array_key_exists('quantity', $payload) || $payload['quantity'] === null) $payload['quantity'] = 1;
        $payload['requested_by_id'] = (int)$cur['id'];
        $payload['status'] = 'needed';
        $cols = array_keys($payload);
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO shopping_items (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())");
        $ins->execute(array_values($payload));
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'shopping_items', $id, 'create', null, ['name' => $payload['name']]);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, $id)), 201);
    }

    public static function updateItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.add', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        if (!self::loadItem($pdo, $id)) return Http::error($res, 'Item not found', 404);
        $payload = self::itemPayload((array)$req->getParsedBody());
        if ($payload) {
            $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($payload)));
            $args = array_values($payload); $args[] = $id;
            $pdo->prepare("UPDATE shopping_items SET $set, updated_at = NOW() WHERE id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$cur['id'], 'shopping_items', $id, 'update', null, $payload);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, $id)));
    }

    private static function transition(Request $req, Response $res, array $route, callable $apply): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.add', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        $apply($pdo, $id, $item, $cur);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, $id)));
    }

    public static function claimItem(Request $req, Response $res, array $route): Response
    {
        return self::transition($req, $res, $route, function (PDO $pdo, int $id, array $item, array $cur) {
            $pdo->prepare("UPDATE shopping_items SET claimed_by_id = ?, claimed_at = NOW(), status = 'claimed', updated_at = NOW() WHERE id = ?")
                ->execute([(int)$cur['id'], $id]);
        });
    }

    public static function unclaimItem(Request $req, Response $res, array $route): Response
    {
        return self::transition($req, $res, $route, function (PDO $pdo, int $id, array $item, array $cur) {
            $status = $item['status'] === 'claimed' ? 'needed' : $item['status'];
            $pdo->prepare("UPDATE shopping_items SET claimed_by_id = NULL, claimed_at = NULL, status = ?, updated_at = NOW() WHERE id = ?")
                ->execute([$status, $id]);
        });
    }

    public static function gotIt(Request $req, Response $res, array $route): Response
    {
        return self::transition($req, $res, $route, function (PDO $pdo, int $id, array $item, array $cur) {
            $pdo->prepare("UPDATE shopping_items SET status = 'purchased', purchased_by_id = ?, purchased_at = NOW(), updated_at = NOW() WHERE id = ?")
                ->execute([(int)$cur['id'], $id]);
            Audit::write($pdo, (int)$cur['id'], 'shopping_items', $id, 'update', null, ['status' => 'purchased']);
        });
    }

    public static function reopenItem(Request $req, Response $res, array $route): Response
    {
        return self::transition($req, $res, $route, function (PDO $pdo, int $id, array $item, array $cur) {
            $pdo->prepare("UPDATE shopping_items SET status = 'needed', purchased_by_id = NULL, purchased_at = NULL, updated_at = NOW() WHERE id = ?")
                ->execute([$id]);
        });
    }

    public static function deleteItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.add', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        Audit::write($pdo, (int)$cur['id'], 'shopping_items', $id, 'delete', ['name' => $item['name']], null);
        $pdo->prepare("DELETE FROM shopping_items WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Catalog management ───────────────────────────────────────────────
    public static function createStore(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO shopping_stores (name, is_active, display_order, created_at) VALUES (?, true, ?, NOW())");
        $ins->execute([trim((string)($d['name'] ?? '')), (int)($d['display_order'] ?? 0)]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'shopping_stores', $newId, 'create', null, ['name' => trim((string)($d['name'] ?? ''))]);
        $rs = $pdo->prepare("SELECT * FROM shopping_stores WHERE id = ?"); $rs->execute([$newId]); $r = $rs->fetch();
        return Http::json($res, ['id' => (int)$r['id'], 'name' => $r['name']], 201);
    }

    public static function updateStore(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['store_id'];
        $s = $pdo->prepare("SELECT 1 FROM shopping_stores WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Store not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'is_active', 'display_order'] as $f) {
            if (array_key_exists($f, $d)) {
                $set[] = "$f = ?";
                $args[] = $f === 'is_active' ? (int)(bool)$d[$f] : ($f === 'display_order' ? (int)$d[$f] : $d[$f]);
            }
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE shopping_stores SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'shopping_stores', $id, 'update', null, $d);
        return Http::json($res, ['ok' => true]);
    }

    public static function createCategory(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO shopping_categories (name, destination, color, icon_name, display_order, is_active, created_at)
                              VALUES (?, ?, ?, ?, ?, true, NOW())");
        $ins->execute([trim((string)($d['name'] ?? '')), $d['destination'] ?? 'none', $d['color'] ?? '#1565c0',
            $d['icon_name'] ?? 'ShoppingCart', (int)($d['display_order'] ?? 0)]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'shopping_categories', $newId, 'create', null, ['name' => trim((string)($d['name'] ?? ''))]);
        $rs = $pdo->prepare("SELECT * FROM shopping_categories WHERE id = ?"); $rs->execute([$newId]); $r = $rs->fetch();
        return Http::json($res, ['id' => (int)$r['id'], 'name' => $r['name']], 201);
    }

    public static function updateCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT 1 FROM shopping_categories WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Category not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'destination', 'color', 'icon_name', 'display_order', 'is_active'] as $f) {
            if (array_key_exists($f, $d)) {
                $set[] = "$f = ?";
                $args[] = $f === 'is_active' ? (int)(bool)$d[$f] : ($f === 'display_order' ? (int)$d[$f] : $d[$f]);
            }
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE shopping_categories SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'shopping_categories', $id, 'update', null, $d);
        return Http::json($res, ['ok' => true]);
    }

    public static function createStaple(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $fields = ['name', 'default_category_id', 'default_store_id', 'default_unit', 'default_quantity', 'display_order'];
        $intF = ['default_category_id', 'default_store_id', 'display_order'];
        $payload = [];
        foreach ($fields as $f) {
            if (array_key_exists($f, $d)) $payload[$f] = ($d[$f] !== null && in_array($f, $intF, true)) ? (int)$d[$f] : $d[$f];
        }
        $payload['name'] = trim((string)($payload['name'] ?? ''));
        $cols = array_keys($payload);
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO shopping_staples (" . implode(',', $cols) . ", is_active) VALUES ($ph, true)");
        $ins->execute(array_values($payload));
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'shopping_staples', $newId, 'create', null, ['name' => $payload['name']]);
        $rs = $pdo->prepare("SELECT * FROM shopping_staples WHERE id = ?"); $rs->execute([$newId]); $r = $rs->fetch();
        return Http::json($res, ['id' => (int)$r['id'], 'name' => $r['name']], 201);
    }

    public static function deleteStaple(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'shopping.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['staple_id'];
        $s = $pdo->prepare("SELECT 1 FROM shopping_staples WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Staple not found', 404);
        $pdo->prepare("DELETE FROM shopping_staples WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'shopping_staples', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }
}
