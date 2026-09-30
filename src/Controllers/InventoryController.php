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
use Psr\Http\Message\UploadedFileInterface;

/** Port of app/modules/inventory/router.py (prefix /api/v1/inventory). */
final class InventoryController
{
    private const ASSET_TYPES = ['asset_tagged'];
    private const QUANTITY_TYPES = ['part', 'consumable'];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function f($v): ?float { return $v === null ? null : (float)$v; }

    private static function nextAssetTag(PDO $pdo): string
    {
        $rows = $pdo->query("SELECT asset_tag FROM inv_items WHERE asset_tag IS NOT NULL")->fetchAll();
        $nums = [];
        foreach ($rows as $r) {
            if (str_starts_with((string)$r['asset_tag'], 'TRC-')) {
                $n = explode('-', $r['asset_tag'], 2)[1] ?? '';
                if (ctype_digit($n)) $nums[] = (int)$n;
            }
        }
        $nxt = $nums ? max($nums) + 1 : 1;
        return 'TRC-' . str_pad((string)$nxt, 5, '0', STR_PAD_LEFT);
    }

    private static function locationPath(PDO $pdo, ?int $locId): ?string
    {
        if ($locId === null) return null;
        $parts = []; $cur = $locId; $guard = 0;
        while ($cur !== null && $guard < 10) {
            $s = $pdo->prepare("SELECT name, parent_id FROM inv_locations WHERE id = ?"); $s->execute([$cur]);
            $l = $s->fetch();
            if (!$l) break;
            $parts[] = $l['name'];
            $cur = $l['parent_id'] !== null ? (int)$l['parent_id'] : null;
            $guard++;
        }
        return implode(' › ', array_reverse($parts));
    }

    private static function loadItem(PDO $pdo, int $id): ?array
    {
        $sql = "SELECT i.*, cc.name AS category_name, ac.name AS asset_category_name, v.name AS vendor_name,
                       t.team_number AS assigned_team_number,
                       TRIM(CONCAT(COALESCE(dm.first_name,''),' ',COALESCE(dm.last_name,''))) AS donor_member_name,
                       ds.name AS donor_sponsor_name,
                       (SELECT COUNT(*) FROM repair_tickets rt WHERE rt.inv_item_id = i.id AND rt.status NOT IN ('complete','closed')) AS open_repairs,
                       iil.rack AS location_rack, iil.shelf AS location_shelf, iil.bin AS location_bin
                FROM inv_items i
                LEFT JOIN inv_categories cc ON cc.id = i.category_id
                LEFT JOIN asset_categories ac ON ac.id = i.asset_category_id
                LEFT JOIN members dm ON dm.id = i.donor_member_id
                LEFT JOIN sponsors ds ON ds.id = i.donor_sponsor_id
                LEFT JOIN inv_vendors v ON v.id = i.vendor_id
                LEFT JOIN team_seasons ts ON ts.id = i.assigned_team_season_id
                LEFT JOIN teams t ON t.id = ts.team_id
                LEFT JOIN inv_item_locations iil ON iil.item_id = i.id AND iil.location_id = i.location_id
                WHERE i.id = ?";
        $s = $pdo->prepare($sql); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function serializeItem(array $i): array
    {
        $pdo = Database::pdo();
        $minStock = $i['minimum_stock_level']; $curQty = $i['current_quantity'];
        $lowStock = $minStock !== null && $curQty !== null && (float)$curQty <= (float)$minStock;
        return [
            'id' => (int)$i['id'], 'item_type' => $i['item_type'], 'name' => $i['name'],
            'category' => $i['category'], 'subcategory' => $i['subcategory'],
            'category_id' => $i['category_id'] !== null ? (int)$i['category_id'] : null,
            'category_name' => $i['category_name'] ?? null,
            'asset_category_id' => isset($i['asset_category_id']) && $i['asset_category_id'] !== null ? (int)$i['asset_category_id'] : null,
            'asset_category_name' => $i['asset_category_name'] ?? null,
            'is_donated' => (bool)($i['is_donated'] ?? false),
            'donor_member_id' => isset($i['donor_member_id']) && $i['donor_member_id'] !== null ? (int)$i['donor_member_id'] : null,
            'donor_member_name' => !empty($i['donor_member_name']) ? $i['donor_member_name'] : null,
            'donor_sponsor_id' => isset($i['donor_sponsor_id']) && $i['donor_sponsor_id'] !== null ? (int)$i['donor_sponsor_id'] : null,
            'donor_sponsor_name' => $i['donor_sponsor_name'] ?? null,
            'donor_name' => $i['donor_name'] ?? null,
            'donation_date' => $i['donation_date'] ?? null,
            'donor_display' => !empty($i['donor_member_name']) ? $i['donor_member_name']
                : (!empty($i['donor_sponsor_name']) ? $i['donor_sponsor_name']
                : (!empty($i['donor_name']) ? $i['donor_name'] : null)),
            'description' => $i['description'],
            'part_number' => $i['part_number'], 'asset_tag' => $i['asset_tag'], 'serial_number' => $i['serial_number'],
            'url' => $i['url'], 'vendor_id' => $i['vendor_id'] !== null ? (int)$i['vendor_id'] : null,
            'vendor_name' => $i['vendor_name'] ?? null,
            'location_id' => $i['location_id'] !== null ? (int)$i['location_id'] : null,
            'location_path' => self::locationPath($pdo, $i['location_id'] !== null ? (int)$i['location_id'] : null),
            // rack/shelf/bin for the item's PRIMARY location (inv_item_locations), so the
            // item form + detail can show/edit the spot for single assets too (only present
            // on single-item loads via loadItem(); null in list responses).
            'location_spot' => (($i['location_rack'] ?? null) !== null || ($i['location_shelf'] ?? null) !== null || ($i['location_bin'] ?? null) !== null)
                ? ['rack' => $i['location_rack'] ?? null, 'shelf' => $i['location_shelf'] ?? null, 'bin' => $i['location_bin'] ?? null]
                : null,
            'assigned_team_season_id' => $i['assigned_team_season_id'] !== null ? (int)$i['assigned_team_season_id'] : null,
            'assigned_team' => ($i['assigned_team_number'] ?? null) !== null ? '#' . $i['assigned_team_number'] : null,
            'unit_of_measure' => $i['unit_of_measure'],
            'package_quantity' => $i['package_quantity'] !== null ? (int)$i['package_quantity'] : null,
            'current_quantity' => self::f($curQty), 'minimum_stock_level' => self::f($minStock),
            'reorder_flag' => (bool)$i['reorder_flag'], 'low_stock' => $lowStock,
            'is_discontinued' => (bool)($i['is_discontinued'] ?? false),
            'is_kit' => (bool)($i['is_kit'] ?? false),
            'cost' => self::f($i['cost']), 'purchase_date' => $i['purchase_date'],
            'warranty_info' => $i['warranty_info'], 'maintenance_schedule' => $i['maintenance_schedule'],
            'status' => $i['status'], 'battery_type' => $i['battery_type'], 'retirement_date' => $i['retirement_date'],
            'open_repairs' => (int)($i['open_repairs'] ?? 0),
            'tags' => $i['tags'] ? json_decode($i['tags'], true) : [], 'notes' => $i['notes'],
            'color' => $i['color'] ?? null, 'length' => $i['length'] ?? null, 'pitch' => $i['pitch'] ?? null,
            'pattern' => $i['pattern'] ?? null, 'inner_diameter' => $i['inner_diameter'] ?? null,
            'outer_diameter' => $i['outer_diameter'] ?? null, 'measurement_system' => $i['measurement_system'] ?? 'na',
        ];
    }

    private static function categoryWithDescendants(PDO $pdo, int $categoryId): array
    {
        $ids = [$categoryId];
        $s = $pdo->prepare("SELECT id FROM inv_categories WHERE parent_id = ?"); $s->execute([$categoryId]);
        foreach ($s->fetchAll() as $r) $ids[] = (int)$r['id'];
        return $ids;
    }

    private static function itemCountsByCategory(PDO $pdo): array
    {
        $rows = $pdo->query("SELECT category_id, COUNT(id) AS n FROM inv_items WHERE category_id IS NOT NULL GROUP BY category_id")->fetchAll();
        $out = [];
        foreach ($rows as $r) $out[(int)$r['category_id']] = (int)$r['n'];
        return $out;
    }

    // ── Categories ───────────────────────────────────────────────────────
    public static function listCategories(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $cats = $pdo->query("SELECT * FROM inv_categories WHERE is_active = true ORDER BY display_order, name")->fetchAll();
        $counts = self::itemCountsByCategory($pdo);
        $byParent = [];
        foreach ($cats as $c) if ($c['parent_id'] !== null) $byParent[(int)$c['parent_id']][] = $c;
        $tops = array_filter($cats, fn($c) => $c['parent_id'] === null);
        $node = function ($c) use ($byParent, $counts) {
            $kids = $byParent[(int)$c['id']] ?? [];
            $rolled = ($counts[(int)$c['id']] ?? 0);
            foreach ($kids as $k) $rolled += $counts[(int)$k['id']] ?? 0;
            return [
                'id' => (int)$c['id'], 'name' => $c['name'], 'parent_id' => $c['parent_id'] !== null ? (int)$c['parent_id'] : null,
                'icon_name' => $c['icon_name'], 'color' => $c['color'], 'display_order' => (int)$c['display_order'],
                'item_count' => $rolled,
                'children' => array_map(fn($k) => [
                    'id' => (int)$k['id'], 'name' => $k['name'], 'parent_id' => (int)$k['parent_id'],
                    'icon_name' => $k['icon_name'], 'color' => $k['color'], 'display_order' => (int)$k['display_order'],
                    'item_count' => $counts[(int)$k['id']] ?? 0, 'children' => [],
                ], $kids),
            ];
        };
        return Http::json($res, array_map($node, array_values($tops)));
    }

    public static function categoryVendors(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $ids = self::categoryWithDescendants($pdo, (int)$route['category_id']);
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $rows = $pdo->prepare("SELECT i.vendor_id, v.name AS vname, COUNT(i.id) AS n FROM inv_items i
                               LEFT JOIN inv_vendors v ON v.id = i.vendor_id WHERE i.category_id IN ($ph)
                               GROUP BY i.vendor_id, v.name ORDER BY COUNT(i.id) DESC");
        $rows->execute($ids);
        return Http::json($res, array_map(fn($r) => [
            'vendor_id' => $r['vendor_id'] !== null ? (int)$r['vendor_id'] : null,
            'vendor_name' => $r['vname'] ?: 'No vendor', 'item_count' => (int)$r['n'],
        ], $rows->fetchAll()));
    }

    public static function createCategory(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO inv_categories (name, parent_id, icon_name, color, display_order, is_active, created_at)
                              VALUES (?, ?, ?, ?, ?, true, NOW())");
        $ins->execute([trim((string)($d['name'] ?? '')), isset($d['parent_id']) ? (int)$d['parent_id'] : null,
            $d['icon_name'] ?? 'Package', $d['color'] ?? '#1565c0', (int)($d['display_order'] ?? 0)]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'inv_categories', $id, 'create', null, ['name' => $d['name'] ?? '', 'parent_id' => $d['parent_id'] ?? null]);
        return Http::json($res, ['id' => $id], 201);
    }

    public static function updateCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT 1 FROM inv_categories WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Category not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        $intF = ['parent_id', 'display_order'];
        foreach (['name', 'parent_id', 'icon_name', 'color', 'display_order'] as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = $f === 'name' ? trim((string)$d[$f]) : ($d[$f] !== null && in_array($f, $intF, true) ? (int)$d[$f] : $d[$f]);
            $set[] = "$f = ?"; $args[] = $v;
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE inv_categories SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'inv_categories', $id, 'update');
        return Http::json($res, ['ok' => true]);
    }

    public static function deleteCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT name FROM inv_categories WHERE id = ?"); $s->execute([$id]);
        $c = $s->fetch();
        if (!$c) return Http::error($res, 'Category not found', 404);
        Audit::write($pdo, (int)$cur['id'], 'inv_categories', $id, 'delete', ['name' => $c['name']], null);
        $pdo->prepare("DELETE FROM inv_categories WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Vendors ──────────────────────────────────────────────────────────
    public static function listVendors(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $includeInactive = filter_var($req->getQueryParams()['include_inactive'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $sql = "SELECT * FROM inv_vendors" . ($includeInactive ? '' : ' WHERE is_active = true') . " ORDER BY name";
        return Http::json($res, array_map(fn($v) => [
            'id' => (int)$v['id'], 'name' => $v['name'], 'contact_name' => $v['contact_name'],
            'contact_email' => $v['contact_email'], 'contact_phone' => $v['contact_phone'], 'url' => $v['url'],
            'account_number' => $v['account_number'], 'notes' => $v['notes'], 'is_active' => (bool)$v['is_active'],
        ], $pdo->query($sql)->fetchAll()));
    }

    private const VENDOR_FIELDS = ['name', 'contact_name', 'contact_email', 'contact_phone', 'url', 'account_number', 'notes'];

    public static function createVendor(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.vendors', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $vals = [];
        foreach (self::VENDOR_FIELDS as $f) $vals[$f] = $d[$f] ?? null;
        $ph = implode(',', array_fill(0, count(self::VENDOR_FIELDS), '?'));
        $ins = $pdo->prepare("INSERT INTO inv_vendors (" . implode(',', self::VENDOR_FIELDS) . ", is_active, created_at, updated_at) VALUES ($ph, true, NOW(), NOW())");
        $ins->execute(array_values($vals));
        $rs = $pdo->prepare("SELECT * FROM inv_vendors WHERE id = ?"); $rs->execute([(int)$pdo->lastInsertId()]); $r = $rs->fetch();
        Audit::write($pdo, (int)$cur['id'], 'inv_vendors', (int)$r['id'], 'create', null, ['name' => $r['name']]);
        return Http::json($res, ['id' => (int)$r['id'], 'name' => $r['name']], 201);
    }

    public static function updateVendor(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.vendors', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['vendor_id'];
        $s = $pdo->prepare("SELECT 1 FROM inv_vendors WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Vendor not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::VENDOR_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE inv_vendors SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'inv_vendors', $id, 'update');
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /inventory/vendors/{id} — hard-delete a vendor that isn't referenced anywhere. */
    public static function deleteVendor(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.vendors', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['vendor_id'];
        $s = $pdo->prepare("SELECT name FROM inv_vendors WHERE id = ?"); $s->execute([$id]);
        $v = $s->fetch();
        if (!$v) return Http::error($res, 'Vendor not found', 404);
        // Refuse if anything still points at this vendor — deactivate instead.
        $refs = 0;
        foreach (['inv_items', 'inv_item_sources', 'inv_boms', 'inv_purchase_orders'] as $tbl) {
            $c = $pdo->prepare("SELECT COUNT(*) FROM `$tbl` WHERE vendor_id = ?"); $c->execute([$id]);
            $refs += (int)$c->fetchColumn();
        }
        if ($refs > 0) {
            return Http::error($res, "This vendor is used by $refs inventory record(s), so it can't be deleted. Deactivate it instead to hide it from the list.", 409);
        }
        $pdo->prepare("DELETE FROM inv_vendors WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_vendors', $id, 'delete', ['name' => $v['name']], null);
        return Http::json($res, ['ok' => true]);
    }

    public static function toggleVendor(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.vendors', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['vendor_id'];
        $s = $pdo->prepare("SELECT is_active FROM inv_vendors WHERE id = ?"); $s->execute([$id]);
        $v = $s->fetch();
        if (!$v) return Http::error($res, 'Vendor not found', 404);
        $new = !(bool)$v['is_active'];
        $pdo->prepare("UPDATE inv_vendors SET is_active = ?, updated_at = NOW() WHERE id = ?")->execute([(int)$new, $id]);
        return Http::json($res, ['ok' => true, 'is_active' => $new]);
    }

    // ── Locations ────────────────────────────────────────────────────────
    public static function listLocations(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM inv_locations WHERE is_active = true ORDER BY name")->fetchAll();
        return Http::json($res, array_map(fn($l) => [
            'id' => (int)$l['id'], 'name' => $l['name'], 'kind' => $l['kind'],
            'parent_id' => $l['parent_id'] !== null ? (int)$l['parent_id'] : null,
            'path' => self::locationPath($pdo, (int)$l['id']), 'notes' => $l['notes'],
        ], $rows));
    }

    private const LOCATION_FIELDS = ['name', 'kind', 'parent_id', 'notes'];

    public static function createLocation(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.locations', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO inv_locations (name, kind, parent_id, notes, is_active, created_at) VALUES (?, ?, ?, ?, true, NOW())");
        $ins->execute([trim((string)($d['name'] ?? '')), $d['kind'] ?? 'bin', isset($d['parent_id']) ? (int)$d['parent_id'] : null, $d['notes'] ?? null]);
        $id = (int)$pdo->lastInsertId(); $rs = $pdo->prepare("SELECT * FROM inv_locations WHERE id = ?"); $rs->execute([$id]); $r = $rs->fetch();
        Audit::write($pdo, (int)$cur['id'], 'inv_locations', $id, 'create', null, ['name' => $r['name'], 'kind' => $d['kind'] ?? 'bin']);
        return Http::json($res, ['id' => $id, 'name' => $r['name'], 'path' => self::locationPath($pdo, $id)], 201);
    }

    public static function updateLocation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.locations', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['location_id'];
        $s = $pdo->prepare("SELECT 1 FROM inv_locations WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Location not found', 404);
        $d = (array)$req->getParsedBody();
        if (array_key_exists('parent_id', $d) && (int)$d['parent_id'] === $id) return Http::error($res, 'A location cannot be its own parent.', 400);
        $set = []; $args = [];
        foreach (self::LOCATION_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($f === 'parent_id' && $d[$f] !== null) ? (int)$d[$f] : $d[$f]; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE inv_locations SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'inv_locations', $id, 'update');
        return Http::json($res, ['ok' => true]);
    }

    public static function deactivateLocation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.locations', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['location_id'];
        $s = $pdo->prepare("SELECT 1 FROM inv_locations WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Location not found', 404);
        $cnt = $pdo->prepare("SELECT COUNT(*) AS n FROM inv_items WHERE location_id = ?"); $cnt->execute([$id]);
        if ((int)$cnt->fetch()['n'] > 0) return Http::error($res, 'Location has items assigned; move them first.', 400);
        $pdo->prepare("UPDATE inv_locations SET is_active = false WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Items ────────────────────────────────────────────────────────────
    public static function listItems(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['search'])) {
            $like = '%' . $q['search'] . '%';
            $where[] = "(i.name LIKE ? OR i.part_number LIKE ? OR i.asset_tag LIKE ? OR i.category LIKE ? OR i.serial_number LIKE ?)";
            array_push($args, $like, $like, $like, $like, $like);
        }
        if (!empty($q['item_type'])) { $where[] = "i.item_type = ?"; $args[] = $q['item_type']; }
        if (!empty($q['item_types'])) {
            $types = array_values(array_filter(array_map('trim', explode(',', (string)$q['item_types']))));
            if ($types) { $where[] = "i.item_type IN (" . implode(',', array_fill(0, count($types), '?')) . ")"; foreach ($types as $t) $args[] = $t; }
        }
        if (!empty($q['category'])) { $where[] = "i.category = ?"; $args[] = $q['category']; }
        if (!empty($q['asset_category_id'])) { $where[] = "i.asset_category_id = ?"; $args[] = (int)$q['asset_category_id']; }
        if (!empty($q['category_id'])) {
            $ids = self::categoryWithDescendants($pdo, (int)$q['category_id']);
            $where[] = "i.category_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")";
            array_push($args, ...$ids);
        }
        if (!empty($q['vendor_id'])) { $where[] = "i.vendor_id = ?"; $args[] = (int)$q['vendor_id']; }
        if (!empty($q['location_id'])) { $where[] = "i.location_id = ?"; $args[] = (int)$q['location_id']; }
        if (!empty($q['team_season_id'])) { $where[] = "i.assigned_team_season_id = ?"; $args[] = (int)$q['team_season_id']; }
        if (!empty($q['status'])) { $where[] = "i.status = ?"; $args[] = $q['status']; }
        if (filter_var($q['low_stock'] ?? false, FILTER_VALIDATE_BOOLEAN)) { $where[] = "i.minimum_stock_level IS NOT NULL AND i.current_quantity <= i.minimum_stock_level AND (i.is_discontinued = 0 OR i.is_discontinued IS NULL)"; }
        $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $cnt = $pdo->prepare("SELECT COUNT(*) AS n FROM inv_items i$whereSql"); $cnt->execute($args);
        $total = (int)$cnt->fetch()['n'];
        $skip = (int)($q['skip'] ?? 0); $limit = (int)($q['limit'] ?? 200);
        $base = "SELECT i.*, cc.name AS category_name, ac.name AS asset_category_name, v.name AS vendor_name, t.team_number AS assigned_team_number,
                        TRIM(CONCAT(COALESCE(dm.first_name,''),' ',COALESCE(dm.last_name,''))) AS donor_member_name,
                        ds.name AS donor_sponsor_name,
                        (SELECT COUNT(*) FROM repair_tickets rt WHERE rt.inv_item_id = i.id AND rt.status NOT IN ('complete','closed')) AS open_repairs
                 FROM inv_items i
                 LEFT JOIN inv_categories cc ON cc.id = i.category_id
                 LEFT JOIN asset_categories ac ON ac.id = i.asset_category_id
                 LEFT JOIN members dm ON dm.id = i.donor_member_id
                 LEFT JOIN sponsors ds ON ds.id = i.donor_sponsor_id
                 LEFT JOIN inv_vendors v ON v.id = i.vendor_id
                 LEFT JOIN team_seasons ts ON ts.id = i.assigned_team_season_id
                 LEFT JOIN teams t ON t.id = ts.team_id$whereSql ORDER BY i.name LIMIT $limit OFFSET $skip";
        $s = $pdo->prepare($base); $s->execute($args);
        return Http::json($res, ['total' => $total, 'items' => array_map([self::class, 'serializeItem'], $s->fetchAll())]);
    }

    public static function itemByTag(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT id FROM inv_items WHERE LOWER(asset_tag) = ?"); $s->execute([strtolower(trim($route['asset_tag']))]);
        $r = $s->fetch();
        if (!$r) return Http::error($res, 'No item found for that tag.', 404);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, (int)$r['id'])));
    }

    public static function itemLookup(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $pn = trim((string)($req->getQueryParams()['part_number'] ?? ''));
        if ($pn === '') return Http::error($res, 'No part number provided.', 404);
        $s = $pdo->prepare("SELECT id FROM inv_items WHERE LOWER(part_number) = ?"); $s->execute([strtolower($pn)]);
        $r = $s->fetch();
        if (!$r) return Http::error($res, 'No inventory item with that part number.', 404);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, (int)$r['id'])));
    }

    /** Distribution of an item's stock across locations/teams, with labels. */
    private static function holdingsFor(PDO $pdo, int $itemId): array
    {
        $s = $pdo->prepare(
            "SELECT h.id, h.location_id, h.team_season_id, h.quantity, l.name AS location_name,
                    t.team_number, ts.team_name,
                    il.rack, il.shelf, il.bin
             FROM inv_item_holdings h
             LEFT JOIN inv_locations l ON l.id = h.location_id
             LEFT JOIN team_seasons ts ON ts.id = h.team_season_id
             LEFT JOIN teams t ON t.id = ts.team_id
             LEFT JOIN inv_item_locations il ON il.item_id = h.item_id AND il.location_id = h.location_id
             WHERE h.item_id = ? AND h.quantity <> 0
             ORDER BY h.quantity DESC, h.id"
        );
        $s->execute([$itemId]);
        return array_map(function ($h) {
            $kind = $h['location_id'] !== null ? 'location' : ($h['team_season_id'] !== null ? 'team' : 'unassigned');
            $label = $kind === 'location' ? ($h['location_name'] ?? 'Location')
                : ($kind === 'team' ? ('Team ' . ($h['team_number'] ?? '?') . ($h['team_name'] ? ' — ' . $h['team_name'] : '')) : 'Unassigned');
            return [
                'id' => (int)$h['id'],
                'location_id' => $h['location_id'] !== null ? (int)$h['location_id'] : null,
                'team_season_id' => $h['team_season_id'] !== null ? (int)$h['team_season_id'] : null,
                'kind' => $kind, 'label' => $label, 'quantity' => self::f($h['quantity']),
                // rack/shelf/bin only apply to physical locations (not team holdings).
                'rack' => $h['location_id'] !== null ? ($h['rack'] ?? null) : null,
                'shelf' => $h['location_id'] !== null ? ($h['shelf'] ?? null) : null,
                'bin' => $h['location_id'] !== null ? ($h['bin'] ?? null) : null,
            ];
        }, $s->fetchAll());
    }

    /** The component parts that make up a kit, with names/part numbers. */
    private static function kitComponentsFor(PDO $pdo, int $kitId): array
    {
        $s = $pdo->prepare(
            "SELECT kc.id, kc.component_item_id, kc.quantity, i.name, i.part_number, i.unit_of_measure
             FROM inv_kit_components kc JOIN inv_items i ON i.id = kc.component_item_id
             WHERE kc.kit_item_id = ? ORDER BY i.name"
        );
        $s->execute([$kitId]);
        return array_map(fn($c) => [
            'id' => (int)$c['id'], 'component_item_id' => (int)$c['component_item_id'],
            'name' => $c['name'], 'part_number' => $c['part_number'], 'unit_of_measure' => $c['unit_of_measure'],
            'quantity' => self::f($c['quantity']),
        ], $s->fetchAll());
    }

    /** PUT /inventory/items/{id}/kit-components — replace a kit's component list. */
    public static function setKitComponents(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $kit = self::loadItem($pdo, $id);
        if (!$kit) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        $comps = is_array($d['components'] ?? null) ? $d['components'] : [];
        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM inv_kit_components WHERE kit_item_id = ?")->execute([$id]);
            $ins = $pdo->prepare("INSERT INTO inv_kit_components (kit_item_id, component_item_id, quantity) VALUES (?, ?, ?)");
            foreach ($comps as $c) {
                $cid = (int)($c['component_item_id'] ?? 0);
                $qty = (float)($c['quantity'] ?? 0);
                if ($cid <= 0 || $cid === $id || $qty <= 0) continue; // skip blanks and self-reference
                $ins->execute([$id, $cid, $qty]);
            }
            // Mark the item as a kit (kits don't hold their own stock).
            $pdo->prepare("UPDATE inv_items SET is_kit = 1, updated_at = NOW() WHERE id = ?")->execute([$id]);
            Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'update', null, ['kit_components' => count($comps)]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not save kit contents: ' . $e->getMessage(), 500);
        }
        return Http::json($res, ['ok' => true, 'kit_components' => self::kitComponentsFor($pdo, $id)]);
    }

    private static function sourcesFor(PDO $pdo, int $itemId): array
    {
        $s = $pdo->prepare(
            "SELECT s.id, s.vendor_id, s.vendor_part_number, s.price, s.url, s.is_preferred, s.notes,
                    v.name AS vendor_name
             FROM inv_item_sources s JOIN inv_vendors v ON v.id = s.vendor_id
             WHERE s.item_id = ? ORDER BY s.is_preferred DESC, (s.price IS NULL), s.price, v.name"
        );
        $s->execute([$itemId]);
        return array_map(fn($r) => [
            'id' => (int)$r['id'], 'vendor_id' => (int)$r['vendor_id'], 'vendor_name' => $r['vendor_name'],
            'vendor_part_number' => $r['vendor_part_number'], 'price' => self::f($r['price']),
            'url' => $r['url'], 'is_preferred' => (bool)$r['is_preferred'], 'notes' => $r['notes'],
        ], $s->fetchAll());
    }

    /** PUT /inventory/items/{id}/sources — replace the item's vendor-source list. */
    public static function setItemSources(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        $sources = is_array($d['sources'] ?? null) ? $d['sources'] : [];
        $num = function ($v) { $v = trim((string)$v); return ($v === '' || !is_numeric($v)) ? null : (float)$v; };
        $str = function ($v, $max) { $v = trim((string)$v); return $v === '' ? null : mb_substr($v, 0, $max); };
        $preferredSeen = false;
        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM inv_item_sources WHERE item_id = ?")->execute([$id]);
            $ins = $pdo->prepare("INSERT INTO inv_item_sources (item_id, vendor_id, vendor_part_number, price, url, is_preferred, notes, created_at, updated_at)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())");
            foreach ($sources as $s) {
                $vid = (int)($s['vendor_id'] ?? 0);
                if ($vid <= 0) continue; // a source must name a vendor
                // Only the first preferred wins, so there's at most one preferred source.
                $pref = (!$preferredSeen && !empty($s['is_preferred'])) ? 1 : 0;
                if ($pref) $preferredSeen = true;
                $ins->execute([$id, $vid, $str($s['vendor_part_number'] ?? '', 120), $num($s['price'] ?? ''),
                    $str($s['url'] ?? '', 500), $pref, $str($s['notes'] ?? '', 500)]);
            }
            Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'update', null, ['sources' => count($sources)]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not save vendor sources: ' . $e->getMessage(), 500);
        }
        return Http::json($res, ['ok' => true, 'sources' => self::sourcesFor($pdo, $id)]);
    }

    /** current_quantity = sum of holdings. */
    private static function recomputeQuantity(PDO $pdo, int $itemId): void
    {
        $pdo->prepare("UPDATE inv_items SET current_quantity = (SELECT COALESCE(SUM(quantity),0) FROM inv_item_holdings WHERE item_id = ?), updated_at = NOW() WHERE id = ?")
            ->execute([$itemId, $itemId]);
    }

    /** Find or create the holding bucket for a location OR team (or unassigned). Returns its id. */
    private static function holdingBucket(PDO $pdo, int $itemId, ?int $locationId, ?int $teamId): int
    {
        if ($locationId !== null)      { $where = 'location_id = ? AND team_season_id IS NULL'; $args = [$itemId, $locationId]; }
        elseif ($teamId !== null)      { $where = 'team_season_id = ? AND location_id IS NULL'; $args = [$itemId, $teamId]; }
        else                           { $where = 'location_id IS NULL AND team_season_id IS NULL'; $args = [$itemId]; }
        $q = $pdo->prepare("SELECT id FROM inv_item_holdings WHERE item_id = ? AND $where LIMIT 1");
        $q->execute($args);
        if ($row = $q->fetch()) return (int)$row['id'];
        $pdo->prepare("INSERT INTO inv_item_holdings (item_id, location_id, team_season_id, quantity) VALUES (?,?,?,0)")
            ->execute([$itemId, $locationId, $teamId]);
        return (int)$pdo->lastInsertId();
    }

    /** After a direct current_quantity edit, push the difference onto the item's home holding. */
    private static function reconcileHoldings(PDO $pdo, int $itemId): void
    {
        $i = self::loadItem($pdo, $itemId);
        if (!$i) return;
        $total = (float)($i['current_quantity'] ?? 0);
        $sum = (float)$pdo->query("SELECT COALESCE(SUM(quantity),0) FROM inv_item_holdings WHERE item_id = " . (int)$itemId)->fetchColumn();
        $delta = $total - $sum;
        if (abs($delta) < 0.0001) return;
        $loc = $i['location_id'] !== null ? (int)$i['location_id'] : null;
        $team = $i['assigned_team_season_id'] !== null ? (int)$i['assigned_team_season_id'] : null;
        $bid = self::holdingBucket($pdo, $itemId, $team !== null ? null : $loc, $team);
        $pdo->prepare("UPDATE inv_item_holdings SET quantity = quantity + ?, updated_at = NOW() WHERE id = ?")->execute([$delta, $bid]);
        $pdo->prepare("DELETE FROM inv_item_holdings WHERE id = ? AND quantity = 0")->execute([$bid]);
    }

    public static function getItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $i = self::loadItem($pdo, (int)$route['item_id']);
        if (!$i) return Http::error($res, 'Item not found', 404);
        $data = self::serializeItem($i);
        $data['holdings'] = self::holdingsFor($pdo, (int)$i['id']);
        $data['sources'] = self::sourcesFor($pdo, (int)$i['id']);
        $data['photos'] = self::photosFor($pdo, (int)$i['id']);
        if (!empty($i['is_kit'])) $data['kit_components'] = self::kitComponentsFor($pdo, (int)$i['id']);
        $mv = $pdo->prepare("SELECT mv.*, a.first_name, a.last_name FROM inv_movements mv
                             LEFT JOIN members a ON a.id = mv.actor_id WHERE mv.item_id = ? ORDER BY mv.created_at DESC LIMIT 50");
        $mv->execute([(int)$i['id']]);
        $data['movements'] = array_map(fn($m) => [
            'id' => (int)$m['id'], 'movement_type' => $m['movement_type'], 'quantity' => self::f($m['quantity']),
            'reason' => $m['reason'], 'notes' => $m['notes'],
            'actor' => ($m['first_name'] !== null || $m['last_name'] !== null) ? trim($m['first_name'] . ' ' . $m['last_name']) : null,
            'created_at' => Time::naiveIso($m['created_at']),
        ], $mv->fetchAll());
        return Http::json($res, $data);
    }

    private const ITEM_FIELDS = ['item_type', 'name', 'category', 'subcategory', 'category_id', 'description', 'part_number',
        'asset_tag', 'asset_category_id', 'serial_number', 'url', 'vendor_id', 'location_id', 'assigned_team_season_id', 'unit_of_measure', 'package_quantity',
        'current_quantity', 'minimum_stock_level', 'cost', 'purchase_date', 'warranty_info', 'maintenance_schedule',
        'status', 'battery_type', 'retirement_date', 'tags', 'notes', 'is_discontinued', 'is_kit',
        'is_donated', 'donor_member_id', 'donor_sponsor_id', 'donor_name', 'donation_date',
        'color', 'length', 'pitch', 'pattern', 'inner_diameter', 'outer_diameter', 'measurement_system'];
    private const ITEM_INT = ['category_id', 'asset_category_id', 'vendor_id', 'location_id', 'assigned_team_season_id', 'package_quantity', 'is_discontinued', 'is_kit', 'is_donated', 'donor_member_id', 'donor_sponsor_id'];
    private const ITEM_JSON = ['tags'];

    private static function itemPayload(array $d, array $allowed): array
    {
        $out = [];
        foreach ($allowed as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = $d[$f];
            if ($v !== null && in_array($f, self::ITEM_INT, true)) $v = (int)$v;
            elseif (in_array($f, self::ITEM_JSON, true)) $v = json_encode($v ?? []);
            $out[$f] = $v;
        }
        return $out;
    }

    /** Asset item types are uniquely identified by their asset tag, not part number. */
    private static function isAssetType(?string $itemType): bool
    {
        return in_array($itemType, ['asset_tagged', 'asset_nontagged'], true);
    }

    /**
     * Returns the name of an existing item that already uses this part number
     * (case-insensitive, ignoring blanks), or null if the part number is free.
     * Pass $excludeId to skip the item being updated.
     */
    private static function partNumberConflict(PDO $pdo, ?string $pn, ?int $excludeId = null): ?string
    {
        $pn = trim((string)$pn);
        if ($pn === '') return null;
        $sql = "SELECT name FROM inv_items WHERE LOWER(part_number) = ?";
        $args = [strtolower($pn)];
        if ($excludeId !== null) { $sql .= " AND id <> ?"; $args[] = $excludeId; }
        $sql .= " LIMIT 1";
        $s = $pdo->prepare($sql); $s->execute($args);
        $r = $s->fetch();
        return $r ? (string)$r['name'] : null;
    }

    /** Name of any other item already using this TRC Asset ID (case-insensitive), or null. */
    private static function assetTagConflict(PDO $pdo, ?string $tag, ?int $excludeId = null): ?string
    {
        $tag = trim((string)$tag);
        if ($tag === '') return null;
        $sql = "SELECT name FROM inv_items WHERE LOWER(asset_tag) = ?";
        $args = [strtolower($tag)];
        if ($excludeId !== null) { $sql .= " AND id <> ?"; $args[] = $excludeId; }
        $sql .= " LIMIT 1";
        $s = $pdo->prepare($sql); $s->execute($args);
        $r = $s->fetch();
        return $r ? (string)$r['name'] : null;
    }

    // ── Item photos (gallery) ────────────────────────────────────────────────

    private static function photosFor(PDO $pdo, int $itemId): array
    {
        $s = $pdo->prepare("SELECT id, url, caption, display_order FROM inv_item_photos
                            WHERE item_id = ? ORDER BY display_order, id");
        $s->execute([$itemId]);
        return array_map(fn($p) => [
            'id' => (int)$p['id'], 'url' => $p['url'], 'caption' => $p['caption'],
            'display_order' => (int)$p['display_order'],
        ], $s->fetchAll());
    }

    /** POST /inventory/items/{item_id}/photos — attach one or more uploaded photo URLs. */
    public static function addItemPhotos(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $itemId = (int)$route['item_id'];
        if (!self::loadItem($pdo, $itemId)) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        // Accept either a single {url, caption} or {photos: [{url, caption}, ...]}.
        $photos = isset($d['photos']) && is_array($d['photos']) ? $d['photos'] : [$d];
        $maxOrder = (int)$pdo->query("SELECT COALESCE(MAX(display_order), -1) FROM inv_item_photos WHERE item_id = " . $itemId)->fetchColumn();
        $ins = $pdo->prepare("INSERT INTO inv_item_photos (item_id, url, caption, display_order, uploaded_by, created_at)
                              VALUES (?, ?, ?, ?, ?, NOW())");
        $added = 0;
        foreach ($photos as $p) {
            $url = trim((string)($p['url'] ?? ''));
            if ($url === '') continue;
            $ins->execute([$itemId, $url, ($p['caption'] ?? null) ?: null, ++$maxOrder, (int)$cur['id']]);
            $added++;
        }
        if ($added === 0) return Http::error($res, 'No photo URLs provided.', 422);
        Audit::write($pdo, (int)$cur['id'], 'inv_item_photos', $itemId, 'create', null, ['added' => $added]);
        return Http::json($res, self::photosFor($pdo, $itemId), 201);
    }

    /** PATCH /inventory/photos/{photo_id} — edit caption. */
    public static function updateItemPhoto(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['photo_id'];
        $row = $pdo->prepare("SELECT item_id FROM inv_item_photos WHERE id = ?"); $row->execute([$pid]);
        $r = $row->fetch();
        if (!$r) return Http::error($res, 'Photo not found', 404);
        $d = (array)$req->getParsedBody();
        $pdo->prepare("UPDATE inv_item_photos SET caption = ? WHERE id = ?")
            ->execute([($d['caption'] ?? null) ?: null, $pid]);
        return Http::json($res, self::photosFor($pdo, (int)$r['item_id']));
    }

    /** DELETE /inventory/photos/{photo_id} */
    public static function deleteItemPhoto(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['photo_id'];
        $row = $pdo->prepare("SELECT item_id FROM inv_item_photos WHERE id = ?"); $row->execute([$pid]);
        $r = $row->fetch();
        if (!$r) return Http::error($res, 'Photo not found', 404);
        $pdo->prepare("DELETE FROM inv_item_photos WHERE id = ?")->execute([$pid]);
        Audit::write($pdo, (int)$cur['id'], 'inv_item_photos', (int)$r['item_id'], 'delete');
        return Http::json($res, self::photosFor($pdo, (int)$r['item_id']));
    }

    /** PUT /inventory/items/{item_id}/photos/order — reorder by array of photo ids. */
    public static function reorderItemPhotos(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $itemId = (int)$route['item_id'];
        $d = (array)$req->getParsedBody();
        $ids = $d['order'] ?? [];
        if (!is_array($ids)) return Http::error($res, 'order must be an array of photo ids', 422);
        $upd = $pdo->prepare("UPDATE inv_item_photos SET display_order = ? WHERE id = ? AND item_id = ?");
        foreach (array_values($ids) as $i => $pid) $upd->execute([$i, (int)$pid, $itemId]);
        return Http::json($res, self::photosFor($pdo, $itemId));
    }

    // ── Asset categories (separate from the catalog categories) ──────────────

    /** GET /inventory/asset-categories — list with a count of assets in each. */
    public static function listAssetCategories(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query(
            "SELECT ac.id, ac.name, ac.sort_order,
                    (SELECT COUNT(*) FROM inv_items i WHERE i.asset_category_id = ac.id) AS item_count
             FROM asset_categories ac ORDER BY ac.sort_order, ac.name"
        )->fetchAll();
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'name' => $r['name'], 'sort_order' => (int)$r['sort_order'], 'item_count' => (int)$r['item_count'],
        ], $rows));
    }

    public static function createAssetCategory(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') return Http::error($res, 'A category name is required.', 422);
        $ex = $pdo->prepare("SELECT id FROM asset_categories WHERE LOWER(name) = ?"); $ex->execute([strtolower($name)]);
        if ($eid = $ex->fetchColumn()) { // idempotent: return the existing one
            $r = $pdo->query("SELECT id, name, sort_order FROM asset_categories WHERE id = " . (int)$eid)->fetch();
            return Http::json($res, ['id' => (int)$r['id'], 'name' => $r['name'], 'sort_order' => (int)$r['sort_order'], 'item_count' => 0]);
        }
        $pdo->prepare("INSERT INTO asset_categories (name, sort_order, created_at) VALUES (?, ?, NOW())")
            ->execute([$name, (int)($d['sort_order'] ?? 0)]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'asset_categories', $id, 'create', null, ['name' => $name]);
        return Http::json($res, ['id' => $id, 'name' => $name, 'sort_order' => (int)($d['sort_order'] ?? 0), 'item_count' => 0], 201);
    }

    public static function updateAssetCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['asset_category_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('name', $d) && trim((string)$d['name']) !== '') { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('sort_order', $d)) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if (!$set) return Http::error($res, 'Nothing to update.', 422);
        $args[] = $id;
        try { $pdo->prepare("UPDATE asset_categories SET " . implode(', ', $set) . " WHERE id = ?")->execute($args); }
        catch (\Throwable $e) { return Http::error($res, 'That name is already in use.', 422); }
        Audit::write($pdo, (int)$cur['id'], 'asset_categories', $id, 'update', null, null);
        return Http::json($res, ['ok' => true]);
    }

    public static function deleteAssetCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['asset_category_id'];
        // Items keep existing; their asset_category_id is cleared by the FK (ON DELETE SET NULL).
        $pdo->prepare("DELETE FROM asset_categories WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'asset_categories', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    public static function createItem(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $payload = self::itemPayload($d, self::ITEM_FIELDS);
        // Assets are identified by their unique asset tag, so many units can share a
        // part number — only enforce part-number uniqueness for non-asset items.
        if (array_key_exists('part_number', $payload) && !self::isAssetType($payload['item_type'] ?? null)) {
            $conflict = self::partNumberConflict($pdo, $payload['part_number']);
            if ($conflict !== null) {
                return Http::error($res, "Part number \"" . trim((string)$payload['part_number']) . "\" is already used by \"$conflict\".", 422);
            }
        }
        if (!array_key_exists('item_type', $payload)) $payload['item_type'] = 'part';
        if (!array_key_exists('status', $payload) || $payload['status'] === null) $payload['status'] = 'active';
        // TRC Asset ID: use the one the user typed (must be unique) or auto-generate a
        // TRC-##### for tagged assets when left blank.
        if (array_key_exists('asset_tag', $payload)) $payload['asset_tag'] = trim((string)$payload['asset_tag']) ?: null;
        if (!empty($payload['asset_tag'])) {
            if (($c = self::assetTagConflict($pdo, $payload['asset_tag'])) !== null) {
                return Http::error($res, "TRC Asset ID \"" . trim((string)$payload['asset_tag']) . "\" is already used by \"$c\".", 422);
            }
        } elseif (in_array($payload['item_type'], self::ASSET_TYPES, true)) {
            $payload['asset_tag'] = self::nextAssetTag($pdo);
        }
        // A tagged asset is a single physical item — default it to quantity 1 so
        // its value (quantity x cost) computes correctly in reports.
        if ($payload['item_type'] === 'asset_tagged'
            && (!array_key_exists('current_quantity', $payload) || $payload['current_quantity'] === null || (float)$payload['current_quantity'] == 0.0)) {
            $payload['current_quantity'] = 1;
        }
        $cols = array_keys($payload);
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO inv_items (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())");
        $ins->execute(array_values($payload));
        $id = (int)$pdo->lastInsertId();
        // Seed a holding for any starting stock (team wins if both location & team set).
        $startQty = isset($payload['current_quantity']) ? (float)$payload['current_quantity'] : 0;
        if (abs($startQty) > 0.0001) {
            $loc = isset($payload['location_id']) && $payload['location_id'] !== null ? (int)$payload['location_id'] : null;
            $team = isset($payload['assigned_team_season_id']) && $payload['assigned_team_season_id'] !== null ? (int)$payload['assigned_team_season_id'] : null;
            $bid = self::holdingBucket($pdo, $id, $team !== null ? null : $loc, $team);
            $pdo->prepare("UPDATE inv_item_holdings SET quantity = ? WHERE id = ?")->execute([$startQty, $bid]);
        }
        $item = self::loadItem($pdo, $id);
        Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'create', null,
            ['name' => $item['name'], 'type' => $item['item_type'], 'asset_tag' => $item['asset_tag']]);
        return Http::json($res, self::serializeItem($item), 201);
    }

    /**
     * Bulk-create several assets that share common attributes, each with its own
     * TRC Asset ID and serial number. Body: the common item fields (same as create)
     * plus `variants`: [{asset_tag?, serial_number?}, ...]. Blank asset tags on an
     * asset type auto-generate a unique TRC-#####. All-or-nothing (one transaction).
     */
    public static function createItemsBulk(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $variants = $d['variants'] ?? null;
        if (!is_array($variants) || count($variants) === 0) return Http::error($res, 'Provide at least one asset to create.', 422);
        if (count($variants) > 200) return Http::error($res, 'Too many at once (max 200).', 422);

        // Common attributes shared by every asset (tag/serial are per-asset).
        $common = self::itemPayload($d, self::ITEM_FIELDS);
        unset($common['asset_tag'], $common['serial_number']);
        if (!array_key_exists('item_type', $common)) $common['item_type'] = 'part';
        if (!array_key_exists('status', $common) || $common['status'] === null) $common['status'] = 'active';
        if (array_key_exists('part_number', $common) && !self::isAssetType($common['item_type'] ?? null)
            && ($conflict = self::partNumberConflict($pdo, $common['part_number'])) !== null) {
            return Http::error($res, "Part number \"" . trim((string)$common['part_number']) . "\" is already used by \"$conflict\".", 422);
        }
        $isAsset = in_array($common['item_type'], self::ASSET_TYPES, true);

        $pdo->beginTransaction();
        try {
            $seen = [];               // asset tags used within this batch (lowercased)
            $created = [];
            foreach ($variants as $i => $v) {
                $v = (array)$v;
                $payload = $common;
                $tag = trim((string)($v['asset_tag'] ?? ''));
                $serial = trim((string)($v['serial_number'] ?? ''));
                if ($tag !== '') {
                    if (isset($seen[strtolower($tag)])) throw new \RuntimeException("TRC Asset ID \"$tag\" is repeated in this batch.");
                    if (($c = self::assetTagConflict($pdo, $tag)) !== null) throw new \RuntimeException("TRC Asset ID \"$tag\" is already used by \"$c\".");
                    $payload['asset_tag'] = $tag;
                } elseif ($isAsset) {
                    $payload['asset_tag'] = self::nextAssetTag($pdo);   // reads max incl. rows inserted earlier in this loop
                }
                if (!empty($payload['asset_tag'])) $seen[strtolower($payload['asset_tag'])] = true;
                if ($serial !== '') $payload['serial_number'] = $serial;
                // Tagged assets are single items → default quantity 1 for correct valuation.
                if ($payload['item_type'] === 'asset_tagged'
                    && (!array_key_exists('current_quantity', $payload) || $payload['current_quantity'] === null || (float)$payload['current_quantity'] == 0.0)) {
                    $payload['current_quantity'] = 1;
                }

                $cols = array_keys($payload);
                $ph = implode(',', array_fill(0, count($cols), '?'));
                $pdo->prepare("INSERT INTO inv_items (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())")
                    ->execute(array_values($payload));
                $id = (int)$pdo->lastInsertId();
                $created[] = $id;
                Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'create', null,
                    ['name' => $payload['name'] ?? null, 'type' => $payload['item_type'], 'asset_tag' => $payload['asset_tag'] ?? null, 'bulk' => true]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, $e->getMessage(), 422);
        }

        $out = array_map(fn($id) => self::serializeItem(self::loadItem($pdo, $id)), $created);
        return Http::json($res, ['created' => count($out), 'items' => $out], 201);
    }

    public static function updateItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        $updFields = array_values(array_filter(self::ITEM_FIELDS, fn($f) => $f !== 'item_type'));
        $payload = self::itemPayload((array)$req->getParsedBody(), $updFields);
        // Un-retiring is a System-Administrator-only action via the dedicated
        // reactivate endpoint — don't let it slip through a generic update.
        if (($item['status'] ?? '') === 'retired' && array_key_exists('status', $payload)
            && $payload['status'] !== 'retired' && !self::isSuperAdmin($pdo, $cur)) {
            unset($payload['status']);
        }
        if (array_key_exists('part_number', $payload) && !self::isAssetType($payload['item_type'] ?? $item['item_type'] ?? null)) {
            $conflict = self::partNumberConflict($pdo, $payload['part_number'], $id);
            if ($conflict !== null) {
                return Http::error($res, "Part number \"" . trim((string)$payload['part_number']) . "\" is already used by \"$conflict\".", 422);
            }
        }
        if (array_key_exists('asset_tag', $payload)) {
            $payload['asset_tag'] = trim((string)$payload['asset_tag']) ?: null;
            if ($payload['asset_tag'] !== null && ($c = self::assetTagConflict($pdo, $payload['asset_tag'], $id)) !== null) {
                return Http::error($res, "TRC Asset ID \"" . $payload['asset_tag'] . "\" is already used by \"$c\".", 422);
            }
        }
        $old = [];
        foreach ($payload as $k => $v) $old[$k] = $item[$k] ?? null;
        if ($payload) {
            $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($payload)));
            $args = array_values($payload); $args[] = $id;
            $pdo->prepare("UPDATE inv_items SET $set, updated_at = NOW() WHERE id = ?")->execute($args);
        }
        // Keep the holdings breakdown in step with a directly-edited total/location.
        if (array_key_exists('current_quantity', $payload) || array_key_exists('location_id', $payload) || array_key_exists('assigned_team_season_id', $payload)) {
            self::reconcileHoldings($pdo, $id);
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'update', $old, $payload);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, $id)));
    }

    /**
     * POST /inventory/items/{id}/transfer — move quantity from one holding
     * (location or team) to another. Doesn't change the item's total; it
     * redistributes where the stock lives.
     */
    public static function transferStock(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.move', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        if (!self::loadItem($pdo, $id)) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        $qty = (float)($d['quantity'] ?? 0);
        if ($qty <= 0) return Http::error($res, 'Transfer quantity must be greater than zero.', 422);
        $nz = fn($k) => isset($d[$k]) && $d[$k] !== '' && $d[$k] !== null ? (int)$d[$k] : null;
        $fromLoc = $nz('from_location_id'); $fromTeam = $nz('from_team_season_id');
        $toLoc = $nz('to_location_id'); $toTeam = $nz('to_team_season_id');
        if ($toLoc !== null && $toTeam !== null) return Http::error($res, 'A destination is a location OR a team, not both.', 422);
        if ($toLoc === null && $toTeam === null) return Http::error($res, 'Choose a destination location or team.', 422);

        $pdo->beginTransaction();
        try {
            $srcId = self::holdingBucket($pdo, $id, $fromLoc, $fromTeam);
            $sq = $pdo->prepare("SELECT quantity FROM inv_item_holdings WHERE id = ?"); $sq->execute([$srcId]);
            $srcQty = (float)$sq->fetchColumn();
            if ($srcQty < $qty) { $pdo->rollBack(); return Http::error($res, "Only " . self::f($srcQty) . " available at the source.", 422); }
            $dstId = self::holdingBucket($pdo, $id, $toLoc, $toTeam);
            $pdo->prepare("UPDATE inv_item_holdings SET quantity = quantity - ?, updated_at = NOW() WHERE id = ?")->execute([$qty, $srcId]);
            $pdo->prepare("UPDATE inv_item_holdings SET quantity = quantity + ?, updated_at = NOW() WHERE id = ?")->execute([$qty, $dstId]);
            $pdo->prepare("DELETE FROM inv_item_holdings WHERE id = ? AND quantity = 0")->execute([$srcId]);
            self::recomputeQuantity($pdo, $id);
            $pdo->prepare("INSERT INTO inv_movements (item_id, actor_id, movement_type, quantity, from_location_id, to_location_id, from_team_season_id, to_team_season_id, reason, created_at) VALUES (?,?, 'transfer', ?,?,?,?,?,?, NOW())")
                ->execute([$id, (int)$cur['id'], $qty, $fromLoc, $toLoc, $fromTeam, $toTeam, ($d['reason'] ?? null) ?: 'Stock transfer']);
            Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'transfer', null,
                ['quantity' => $qty, 'from' => ['location_id' => $fromLoc, 'team_season_id' => $fromTeam], 'to' => ['location_id' => $toLoc, 'team_season_id' => $toTeam]]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Transfer failed: ' . $e->getMessage(), 500);
        }
        return Http::json($res, ['ok' => true, 'holdings' => self::holdingsFor($pdo, $id)]);
    }

    /**
     * PUT /inventory/items/{id}/location-bin — set the rack/shelf/bin for this
     * item at a specific location. Upserts the (item, location) row; blank/empty
     * for all three clears the spot.
     */
    public static function setLocationBin(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.move', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        if (!self::loadItem($pdo, $id)) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        $locId = isset($d['location_id']) && $d['location_id'] !== '' ? (int)$d['location_id'] : null;
        if (!$locId) return Http::error($res, 'A location is required.', 422);
        $ls = $pdo->prepare("SELECT 1 FROM inv_locations WHERE id = ?"); $ls->execute([$locId]);
        if (!$ls->fetch()) return Http::error($res, 'Location not found', 404);
        $norm = function ($v) { $v = trim((string)($v ?? '')); return $v === '' ? null : $v; };
        $rack = $norm($d['rack'] ?? null); $shelf = $norm($d['shelf'] ?? null); $bin = $norm($d['bin'] ?? null);
        if ($rack === null && $shelf === null && $bin === null) {
            $pdo->prepare("DELETE FROM inv_item_locations WHERE item_id = ? AND location_id = ?")->execute([$id, $locId]);
        } else {
            $pdo->prepare(
                "INSERT INTO inv_item_locations (item_id, location_id, rack, shelf, bin)
                 VALUES (?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE rack = VALUES(rack), shelf = VALUES(shelf), bin = VALUES(bin), updated_at = NOW()"
            )->execute([$id, $locId, $rack, $shelf, $bin]);
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'set_location_bin', null,
            ['location_id' => $locId, 'rack' => $rack, 'shelf' => $shelf, 'bin' => $bin]);
        return Http::json($res, ['ok' => true, 'holdings' => self::holdingsFor($pdo, $id)]);
    }

    /**
     * GET /inventory/locations/{id}/contents — a "where is everything" listing
     * for one area: every item stored at this location (or any location nested
     * under it), with rack/shelf/bin, part number, name, and quantity on hand.
     */
    public static function locationContents(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $locId = (int)$route['location_id'];
        $root = $pdo->prepare("SELECT id, name FROM inv_locations WHERE id = ?"); $root->execute([$locId]);
        $rootLoc = $root->fetch();
        if (!$rootLoc) return Http::error($res, 'Location not found', 404);
        // Collect this location plus all descendants (areas can nest rooms/racks).
        $ids = [$locId]; $frontier = [$locId];
        while ($frontier) {
            $in = implode(',', array_map('intval', $frontier));
            $children = $pdo->query("SELECT id FROM inv_locations WHERE parent_id IN ($in)")->fetchAll(PDO::FETCH_COLUMN);
            $children = array_map('intval', $children);
            $children = array_values(array_diff($children, $ids));
            $ids = array_merge($ids, $children); $frontier = $children;
        }
        $in = implode(',', $ids);
        $stmt = $pdo->prepare(
            "SELECT i.id AS item_id, i.name, i.part_number, i.item_type, i.unit_of_measure,
                    l.id AS location_id, l.name AS location_name,
                    il.rack, il.shelf, il.bin,
                    h.quantity
             FROM inv_item_holdings h
             JOIN inv_items i ON i.id = h.item_id
             JOIN inv_locations l ON l.id = h.location_id
             LEFT JOIN inv_item_locations il ON il.item_id = h.item_id AND il.location_id = h.location_id
             WHERE h.location_id IN ($in) AND h.quantity <> 0
             ORDER BY COALESCE(il.rack,'~'), COALESCE(il.shelf,'~'), COALESCE(il.bin,'~'), i.name"
        );
        $stmt->execute();
        $rows = array_map(fn($r) => [
            'item_id' => (int)$r['item_id'], 'name' => $r['name'], 'part_number' => $r['part_number'],
            'item_type' => $r['item_type'], 'unit_of_measure' => $r['unit_of_measure'],
            'location_id' => (int)$r['location_id'], 'location_name' => $r['location_name'],
            'rack' => $r['rack'], 'shelf' => $r['shelf'], 'bin' => $r['bin'],
            'quantity' => self::f($r['quantity']),
        ], $stmt->fetchAll());
        return Http::json($res, ['location' => ['id' => (int)$rootLoc['id'], 'name' => $rootLoc['name']], 'items' => $rows]);
    }

    public static function moveItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.move', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        $mvType = $d['movement_type'] ?? '';
        $moved = isset($d['quantity']) && $d['quantity'] !== null ? (float)$d['quantity'] : null;
        $isQty = in_array($item['item_type'], self::QUANTITY_TYPES, true);
        $fromLoc = isset($d['from_location_id']) ? (int)$d['from_location_id'] : ($item['location_id'] !== null ? (int)$item['location_id'] : null);
        $toLoc = isset($d['to_location_id']) ? (int)$d['to_location_id'] : null;
        $curQty = $item['current_quantity'] !== null ? (float)$item['current_quantity'] : 0.0;

        $mv = $pdo->prepare("INSERT INTO inv_movements (item_id, actor_id, movement_type, quantity, from_location_id, to_location_id, from_team_season_id, to_team_season_id, reason, notes, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        $mv->execute([$id, (int)$cur['id'], $mvType, $moved, $fromLoc, $toLoc,
            isset($d['from_team_season_id']) ? (int)$d['from_team_season_id'] : null,
            isset($d['to_team_season_id']) ? (int)$d['to_team_season_id'] : null,
            $d['reason'] ?? null, $d['notes'] ?? null]);
        $mvId = (int)$pdo->lastInsertId();

        if ($mvType === 'location_to_location' && $toLoc !== null) {
            $partial = $isQty && $moved !== null && $moved < $curQty;
            if ($partial) {
                $tx = $pdo->prepare("SELECT id, current_quantity FROM inv_items WHERE id != ? AND item_type = ? AND location_id = ?
                                     AND LOWER(name) = ? AND (part_number = ? OR (part_number IS NULL AND ? IS NULL)) LIMIT 1");
                $tx->execute([$id, $item['item_type'], $toLoc, strtolower((string)$item['name']), $item['part_number'], $item['part_number']]);
                $target = $tx->fetch();
                if ($target) {
                    $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) + ?, updated_at = NOW() WHERE id = ?")
                        ->execute([$moved, (int)$target['id']]);
                } else {
                    $pdo->prepare("INSERT INTO inv_items (item_type, name, category, subcategory, description, part_number, url, vendor_id,
                                   unit_of_measure, package_quantity, minimum_stock_level, cost, status, notes, tags, location_id, current_quantity, created_at, updated_at)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
                        ->execute([$item['item_type'], $item['name'], $item['category'], $item['subcategory'], $item['description'],
                            $item['part_number'], $item['url'], $item['vendor_id'], $item['unit_of_measure'], $item['package_quantity'],
                            $item['minimum_stock_level'], $item['cost'], $item['status'] ?: 'active', $item['notes'], $item['tags'] ?: json_encode([]),
                            $toLoc, $moved]);
                }
                $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) - ?, updated_at = NOW() WHERE id = ?")->execute([$moved, $id]);
            } else {
                $pdo->prepare("UPDATE inv_items SET location_id = ?, updated_at = NOW() WHERE id = ?")->execute([$toLoc, $id]);
            }
        } else {
            if ($toLoc !== null) $pdo->prepare("UPDATE inv_items SET location_id = ?, updated_at = NOW() WHERE id = ?")->execute([$toLoc, $id]);
            if (in_array($mvType, ['inventory_to_team', 'team_to_team'], true) && isset($d['to_team_season_id']) && $d['to_team_season_id'] !== null) {
                $pdo->prepare("UPDATE inv_items SET assigned_team_season_id = ?, updated_at = NOW() WHERE id = ?")->execute([(int)$d['to_team_season_id'], $id]);
            }
            if ($mvType === 'team_to_inventory') $pdo->prepare("UPDATE inv_items SET assigned_team_season_id = NULL, updated_at = NOW() WHERE id = ?")->execute([$id]);
            if ($moved !== null && $isQty) {
                if ($mvType === 'consume') $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) - ?, updated_at = NOW() WHERE id = ?")->execute([$moved, $id]);
                elseif (in_array($mvType, ['receive', 'adjustment'], true)) $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) + ?, updated_at = NOW() WHERE id = ?")->execute([$moved, $id]);
            }
        }
        self::reconcileHoldings($pdo, $id); // keep the per-location/team breakdown summing to the total
        Audit::write($pdo, (int)$cur['id'], 'inv_movements', $mvId, 'create', null, ['item_id' => $id, 'type' => $mvType, 'quantity' => $moved]);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, $id)));
    }

    public static function retireItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        if (!self::loadItem($pdo, $id)) return Http::error($res, 'Item not found', 404);
        $pdo->prepare("UPDATE inv_items SET status = 'retired', updated_at = NOW() WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'update', null, ['status' => 'retired']);
        return Http::json($res, ['ok' => true]);
    }

    /** True only for a true System Administrator (NOT plain "Admin"). */
    private static function isSuperAdmin(\PDO $pdo, ?array $member): bool
    {
        if (!$member) return false;
        $eff = Permissions::effectiveRolesFor($pdo, $member);
        return (bool)array_intersect($eff, Permissions::superRoles());
    }

    /**
     * Reactivate a retired item. Deliberately restricted to System Administrators
     * — un-retiring should be a rare, intentional act, not a routine button.
     */
    public static function reactivateItem(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::isSuperAdmin($pdo, $cur)) return Http::error($res, 'Only a System Administrator can reactivate a retired item.', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        if (($item['status'] ?? '') !== 'retired') return Http::error($res, 'This item is not retired.', 422);
        $pdo->prepare("UPDATE inv_items SET status = 'active', retirement_date = NULL, updated_at = NOW() WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'update', ['status' => 'retired'], ['status' => 'active', 'reactivated' => true]);
        return Http::json($res, self::serializeItem(self::loadItem($pdo, $id)));
    }

    public static function deleteItemPermanent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['item_id'];
        $item = self::loadItem($pdo, $id);
        if (!$item) return Http::error($res, 'Item not found', 404);
        $snapshot = self::serializeItem($item);
        $pdo->prepare("DELETE FROM inv_items WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_items', $id, 'delete', $snapshot, null);
        return Http::json($res, ['ok' => true, 'deleted' => true]);
    }

    // ── Meta ─────────────────────────────────────────────────────────────
    public static function categoryNames(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT DISTINCT category FROM inv_items WHERE category IS NOT NULL")->fetchAll();
        $vals = array_values(array_filter(array_column($rows, 'category')));
        sort($vals);
        return Http::json($res, $vals);
    }

    public static function summary(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $total = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_items")->fetch()['n'];
        $low = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_items WHERE minimum_stock_level IS NOT NULL AND current_quantity <= minimum_stock_level AND (is_discontinued = 0 OR is_discontinued IS NULL)")->fetch()['n'];
        $assets = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_items WHERE item_type = 'asset_tagged'")->fetch()['n'];
        // Value = cost × qty for stock types and non-tagged assets (e.g. 10 chairs);
        // a non-tagged asset with no qty counts as 1. Tagged assets are always 1.
        $val = $pdo->query("SELECT COALESCE(SUM(COALESCE(cost,0) * CASE
                                WHEN item_type IN ('part','consumable') THEN COALESCE(current_quantity,0)
                                WHEN item_type = 'asset_nontagged' THEN COALESCE(NULLIF(current_quantity,0),1)
                                ELSE 1 END),0) AS v FROM inv_items")->fetch()['v'];
        $byType = [];
        foreach ($pdo->query("SELECT item_type, COUNT(id) AS n FROM inv_items GROUP BY item_type")->fetchAll() as $r) $byType[$r['item_type']] = (int)$r['n'];
        return Http::json($res, ['total_items' => $total, 'low_stock' => $low, 'tagged_assets' => $assets,
            'estimated_valuation' => self::f($val), 'by_type' => (object)$byType]);
    }

    // ── Category resolution (text → category tree) ───────────────────────
    /** Find-or-create a category node by name under an optional parent. Cached by "parentId|lowername". */
    private static function findOrCreateCategory(PDO $pdo, string $name, ?int $parentId, array &$cache): ?int
    {
        $name = trim($name);
        if ($name === '') return null;
        $key = ($parentId ?? 0) . '|' . strtolower($name);
        if (array_key_exists($key, $cache)) return $cache[$key];
        if ($parentId === null) {
            $s = $pdo->prepare("SELECT id FROM inv_categories WHERE LOWER(name) = ? AND parent_id IS NULL LIMIT 1");
            $s->execute([strtolower($name)]);
        } else {
            $s = $pdo->prepare("SELECT id FROM inv_categories WHERE LOWER(name) = ? AND parent_id = ? LIMIT 1");
            $s->execute([strtolower($name), $parentId]);
        }
        if ($row = $s->fetch()) return $cache[$key] = (int)$row['id'];
        $pdo->prepare("INSERT INTO inv_categories (name, parent_id, icon_name, color, display_order, is_active, created_at) VALUES (?, ?, 'Package', '#1565c0', 0, true, NOW())")
            ->execute([$name, $parentId]);
        return $cache[$key] = (int)$pdo->lastInsertId();
    }

    /** Resolve text category/subcategory to the most-specific category_id, creating nodes as needed. */
    private static function resolveCategoryId(PDO $pdo, ?string $category, ?string $subcategory, array &$cache): ?int
    {
        $category = trim((string)$category);
        if ($category === '') return null;
        $topId = self::findOrCreateCategory($pdo, $category, null, $cache);
        $sub = trim((string)$subcategory);
        if ($sub !== '' && $topId !== null) return self::findOrCreateCategory($pdo, $sub, $topId, $cache);
        return $topId;
    }

    /**
     * POST /inventory/categories/backfill — link items that have category text but
     * no category_id (e.g. everything from a CSV import before this was wired up)
     * into the category tree. Idempotent: only touches rows with category_id IS NULL.
     */
    public static function backfillCategoryLinks(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT id, category, subcategory FROM inv_items
                             WHERE category_id IS NULL AND category IS NOT NULL AND TRIM(category) <> ''")->fetchAll();
        $cache = []; $linked = 0;
        $upd = $pdo->prepare("UPDATE inv_items SET category_id = ?, updated_at = NOW() WHERE id = ?");
        $pdo->beginTransaction();
        try {
            foreach ($rows as $r) {
                $cid = self::resolveCategoryId($pdo, $r['category'], $r['subcategory'], $cache);
                if ($cid !== null) { $upd->execute([$cid, (int)$r['id']]); $linked++; }
            }
            Audit::write($pdo, (int)$cur['id'], 'inv_items', null, 'category_backfill', null, ['linked' => $linked, 'examined' => count($rows)]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Backfill failed: ' . $e->getMessage(), 500);
        }
        return Http::json($res, ['ok' => true, 'examined' => count($rows), 'linked' => $linked]);
    }

    /**
     * POST /inventory/items/merge-team-clones — one-time cleanup of the old
     * per-team duplicate rows. Receiving used to create a separate item row per
     * team for the same part number; we now track that with holdings on a single
     * canonical row. This folds each team-assigned duplicate back into its
     * canonical twin (moving its stock to a team holding and repointing history),
     * or, if it has no twin, converts it in place to a canonical row + holding.
     * Idempotent: once there are no team-assigned duplicates left, it does nothing.
     */
    public static function mergeTeamClones(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.items', 'write')) return Http::error($res, 'Access denied', 403);
        $clones = $pdo->query("SELECT id, part_number, assigned_team_season_id, COALESCE(current_quantity,0) AS qty
                               FROM inv_items
                               WHERE assigned_team_season_id IS NOT NULL AND part_number IS NOT NULL AND TRIM(part_number) <> ''")->fetchAll();
        $merged = 0; $converted = 0;
        $pdo->beginTransaction();
        try {
            foreach ($clones as $c) {
                $cid = (int)$c['id']; $team = (int)$c['assigned_team_season_id']; $qty = (float)$c['qty'];
                $k = $pdo->prepare("SELECT id FROM inv_items WHERE LOWER(part_number) = LOWER(?) AND assigned_team_season_id IS NULL AND id <> ? ORDER BY id LIMIT 1");
                $k->execute([$c['part_number'], $cid]);
                $canon = $k->fetch();
                if ($canon) {
                    $kid = (int)$canon['id'];
                    // Move the clone's stock onto a team holding of the canonical row.
                    if ($qty != 0.0) {
                        $bid = self::holdingBucket($pdo, $kid, null, $team);
                        $pdo->prepare("UPDATE inv_item_holdings SET quantity = quantity + ?, updated_at = NOW() WHERE id = ?")->execute([$qty, $bid]);
                    }
                    // Repoint history/links from the clone to the canonical row, then drop the clone.
                    $pdo->prepare("UPDATE inv_movements SET item_id = ? WHERE item_id = ?")->execute([$kid, $cid]);
                    $pdo->prepare("UPDATE inv_bom_lines SET item_id = ? WHERE item_id = ?")->execute([$kid, $cid]);
                    $pdo->prepare("UPDATE inv_kit_components SET component_item_id = ? WHERE component_item_id = ?")->execute([$kid, $cid]);
                    $pdo->prepare("UPDATE inv_kit_components SET kit_item_id = ? WHERE kit_item_id = ?")->execute([$kid, $cid]);
                    $pdo->prepare("DELETE FROM inv_item_holdings WHERE item_id = ?")->execute([$cid]);
                    $pdo->prepare("DELETE FROM inv_items WHERE id = ?")->execute([$cid]);
                    self::recomputeQuantity($pdo, $kid);
                    $merged++;
                } else {
                    // No canonical twin — make this row canonical and record its stock as a team holding.
                    $pdo->prepare("DELETE FROM inv_item_holdings WHERE item_id = ?")->execute([$cid]);
                    if ($qty != 0.0) {
                        $bid = self::holdingBucket($pdo, $cid, null, $team);
                        $pdo->prepare("UPDATE inv_item_holdings SET quantity = ?, updated_at = NOW() WHERE id = ?")->execute([$qty, $bid]);
                    }
                    $pdo->prepare("UPDATE inv_items SET assigned_team_season_id = NULL, updated_at = NOW() WHERE id = ?")->execute([$cid]);
                    self::recomputeQuantity($pdo, $cid);
                    $converted++;
                }
            }
            Audit::write($pdo, (int)$cur['id'], 'inv_items', null, 'merge_team_clones', null, ['merged' => $merged, 'converted' => $converted]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Merge failed: ' . $e->getMessage(), 500);
        }
        return Http::json($res, ['ok' => true, 'examined' => count($clones), 'merged' => $merged, 'converted' => $converted]);
    }

    // ── Bulk import ──────────────────────────────────────────────────────
    public static function importItems(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.import', 'write')) return Http::error($res, 'Access denied', 403);
        $files = $req->getUploadedFiles();
        /** @var UploadedFileInterface|null $file */
        $file = $files['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded', 400);
        $text = (string)$file->getStream();
        $text = preg_replace('/^\xEF\xBB\xBF/', '', $text);
        $lines = preg_split('/\r\n|\r|\n/', $text);
        $header = null; $created = 0; $updated = 0; $errors = []; $vendorCache = [];
        $seen = [];   // part_number (lowercased) => item id, for matches within this file
        $catCache = []; // category text -> category_id, resolved once per file
        $idx = 1;
        foreach ($lines as $line) {
            if ($line === '') { $idx++; continue; }
            $cells = str_getcsv($line, ',', '"', '\\');
            if ($header === null) {
                // Normalize headers so column names are forgiving: trim, lowercase,
                // and turn spaces/dashes into underscores. This lets "Package Quantity",
                // "product-url", "Part Number", etc. all match their canonical keys.
                $header = array_map(function ($h) {
                    return preg_replace('/[\s\-]+/', '_', strtolower(trim((string)$h)));
                }, $cells);
                $idx++; continue;
            }
            $row = [];
            foreach ($header as $i => $h) $row[$h] = $cells[$i] ?? '';
            // Accept a few common aliases for canonical fields.
            if (!isset($row['url']) && isset($row['product_url'])) $row['url'] = $row['product_url'];
            if (!isset($row['package_quantity']) && isset($row['pkg_quantity'])) $row['package_quantity'] = $row['pkg_quantity'];
            $name = trim((string)($row['name'] ?? ''));
            if ($name === '') { $errors[] = "Row $idx: missing name"; $idx++; continue; }
            $vname = trim((string)($row['vendor'] ?? ''));
            $vendorId = null;
            if ($vname !== '') {
                $key = strtolower($vname);
                if (!array_key_exists($key, $vendorCache)) {
                    $vs = $pdo->prepare("SELECT id FROM inv_vendors WHERE LOWER(TRIM(name)) = ?"); $vs->execute([$key]);
                    $v = $vs->fetch();
                    if (!$v) {
                        $vi = $pdo->prepare("INSERT INTO inv_vendors (name, is_active, created_at, updated_at) VALUES (?, true, NOW(), NOW())");
                        $vi->execute([$vname]); $v = ['id' => $pdo->lastInsertId()];
                    }
                    $vendorCache[$key] = (int)$v['id'];
                }
                $vendorId = $vendorCache[$key];
            }
            $num = function ($k) use ($row) {
                $v = trim((string)($row[$k] ?? ''));
                return ($v === '' || !is_numeric($v)) ? null : (float)$v;
            };
            $itype = trim((string)($row['item_type'] ?? 'part')) ?: 'part';
            $partNo = trim((string)($row['part_number'] ?? ''));
            $category = trim((string)($row['category'] ?? '')) ?: null;
            $subcategory = trim((string)($row['subcategory'] ?? '')) ?: null;
            // Link the text category/subcategory into the category tree (creating
            // nodes as needed) so imported items show up when browsing by category.
            $categoryId = self::resolveCategoryId($pdo, $category, $subcategory, $catCache);
            $url = trim((string)($row['url'] ?? '')) ?: null;
            $uom = trim((string)($row['unit_of_measure'] ?? '')) ?: null;
            $notes = trim((string)($row['notes'] ?? '')) ?: null;
            $pkgQty = (function () use ($row) {
                $v = trim((string)($row['package_quantity'] ?? ''));
                return ($v === '' || !is_numeric($v)) ? null : (int)$v;
            })();

            // Match an existing item by part number (case-insensitive), either
            // already in the system or seen earlier in this same file. When matched,
            // refresh the descriptive/catalog fields but DON'T touch the part number
            // or the quantities (on-hand and minimum stock are the org's, not the
            // vendor's). This keeps re-running a vendor file safe and idempotent.
            $matchId = null;
            if ($partNo !== '') {
                $pnKey = strtolower($partNo);
                if (isset($seen[$pnKey])) {
                    $matchId = $seen[$pnKey];
                } else {
                    $ex = $pdo->prepare("SELECT id FROM inv_items WHERE LOWER(part_number) = ? LIMIT 1");
                    $ex->execute([$pnKey]);
                    $hit = $ex->fetch();
                    if ($hit) $matchId = (int)$hit['id'];
                }
            }

            if ($matchId !== null) {
                // Refresh catalog fields. For the optional catalog columns, a blank
                // cell in a later file preserves the existing value rather than wiping it.
                // category_id only fills when empty, so a manual re-categorization isn't clobbered.
                $pdo->prepare("UPDATE inv_items SET name = ?, item_type = ?, category = ?,
                        subcategory = COALESCE(?, subcategory), url = COALESCE(?, url),
                        package_quantity = COALESCE(?, package_quantity), category_id = COALESCE(category_id, ?),
                        unit_of_measure = ?, cost = ?, notes = ?, vendor_id = ?, updated_at = NOW() WHERE id = ?")
                    ->execute([$name, $itype, $category, $subcategory, $url, $pkgQty, $categoryId, $uom, $num('cost'), $notes, $vendorId, $matchId]);
                $updated++;
                if ($partNo !== '') $seen[strtolower($partNo)] = $matchId;
                $idx++;
                continue;
            }

            $assetTag = in_array($itype, self::ASSET_TYPES, true) ? self::nextAssetTag($pdo) : null;
            $pdo->prepare("INSERT INTO inv_items (name, item_type, category, subcategory, category_id, url, package_quantity, part_number, unit_of_measure, current_quantity, minimum_stock_level, cost, notes, vendor_id, status, asset_tag, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())")
                ->execute([$name, $itype, $category, $subcategory, $categoryId, $url, $pkgQty, $partNo ?: null,
                    $uom, $num('current_quantity') ?? 0, $num('minimum_stock_level'),
                    $num('cost'), $notes, $vendorId, $assetTag]);
            $created++;
            if ($partNo !== '') $seen[strtolower($partNo)] = (int)$pdo->lastInsertId();
            $idx++;
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_items', null, 'import', null, ['created' => $created, 'updated' => $updated]);
        return Http::json($res, ['ok' => true, 'created' => $created, 'updated' => $updated, 'errors' => $errors]);
    }
}
