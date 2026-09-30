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

/** Port of app/modules/inventory/reports_router.py (prefix /api/v1/inventory). */
final class InventoryReportsController
{
    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function f($v): ?float { return $v === null ? null : (float)$v; }

    /** received_quantity × (actual_purchase_price ?? expected_price). */
    private static function lineSpend(array $l): float
    {
        $qty = (float)($l['received_quantity'] ?? 0);
        $unit = $l['actual_purchase_price'] !== null ? $l['actual_purchase_price'] : $l['expected_price'];
        return $unit !== null ? $qty * (float)$unit : 0.0;
    }

    public static function overview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $totalItems = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_items")->fetch()['n'];
        $lowStock = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_items WHERE minimum_stock_level IS NOT NULL AND current_quantity <= minimum_stock_level")->fetch()['n'];
        $taggedAssets = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_items WHERE item_type = 'asset_tagged'")->fetch()['n'];
        $valuation = $pdo->query("SELECT COALESCE(SUM(COALESCE(cost,0) * CASE WHEN item_type IN ('part','consumable') THEN COALESCE(current_quantity,0) ELSE 1 END),0) AS v FROM inv_items")->fetch()['v'];
        $openPos = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_purchase_orders WHERE status IN ('pending','ordered','partially_received')")->fetch()['n'];
        $outCheckouts = (int)$pdo->query("SELECT COUNT(id) AS n FROM inv_checkouts WHERE status = 'out'")->fetch()['n'];
        $ov = $pdo->prepare("SELECT COUNT(id) AS n FROM inv_checkouts WHERE status = 'out' AND expected_return_date IS NOT NULL AND expected_return_date < ?");
        $ov->execute([date('Y-m-d')]);
        $overdue = (int)$ov->fetch()['n'];
        $totalSpend = 0.0;
        foreach ($pdo->query("SELECT received_quantity, actual_purchase_price, expected_price FROM inv_bom_lines WHERE received_quantity > 0")->fetchAll() as $l) {
            $totalSpend += self::lineSpend($l);
        }
        return Http::json($res, [
            'total_items' => $totalItems, 'low_stock' => $lowStock, 'tagged_assets' => $taggedAssets,
            'estimated_valuation' => self::f($valuation), 'open_pos' => $openPos,
            'outstanding_checkouts' => $outCheckouts, 'overdue_checkouts' => $overdue,
            'total_spend' => round($totalSpend, 2),
        ]);
    }

    public static function spend(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $groupBy = $req->getQueryParams()['group_by'] ?? 'team';
        $boms = $pdo->query("SELECT b.id, b.vendor_id, b.budget_category_id, b.team_season_id,
                             v.name AS vendor_name, bc.name AS budget_name, t.team_number
                             FROM inv_boms b
                             LEFT JOIN inv_vendors v ON v.id = b.vendor_id
                             LEFT JOIN inv_budget_categories bc ON bc.id = b.budget_category_id
                             LEFT JOIN team_seasons ts ON ts.id = b.team_season_id
                             LEFT JOIN teams t ON t.id = ts.team_id")->fetchAll();
        $buckets = [];
        foreach ($boms as $b) {
            $ls = $pdo->prepare("SELECT received_quantity, actual_purchase_price, expected_price FROM inv_bom_lines WHERE bom_id = ? AND received_quantity > 0");
            $ls->execute([(int)$b['id']]);
            $spend = 0.0;
            foreach ($ls->fetchAll() as $l) $spend += self::lineSpend($l);
            if ($spend <= 0) continue;
            if ($groupBy === 'vendor') $key = $b['vendor_name'] ?: 'Unassigned';
            elseif ($groupBy === 'category') $key = $b['budget_name'] ?: 'Uncategorized';
            else $key = ($b['team_number'] ?? null) !== null ? '#' . $b['team_number'] : 'Unassigned';
            $buckets[$key] = ($buckets[$key] ?? 0.0) + $spend;
        }
        $rows = [];
        foreach ($buckets as $k => $v) $rows[] = ['label' => $k, 'amount' => round($v, 2)];
        usort($rows, fn($a, $b) => $b['amount'] <=> $a['amount']);
        return Http::json($res, ['group_by' => $groupBy, 'rows' => $rows, 'total' => round(array_sum(array_column($rows, 'amount')), 2)]);
    }

    public static function lowStock(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT i.*, v.name AS vendor_name FROM inv_items i LEFT JOIN inv_vendors v ON v.id = i.vendor_id
                             WHERE i.minimum_stock_level IS NOT NULL AND i.current_quantity <= i.minimum_stock_level ORDER BY i.name")->fetchAll();
        return Http::json($res, array_map(fn($i) => [
            'id' => (int)$i['id'], 'name' => $i['name'], 'category' => $i['category'],
            'current_quantity' => self::f($i['current_quantity']), 'minimum_stock_level' => self::f($i['minimum_stock_level']),
            'unit_of_measure' => $i['unit_of_measure'], 'vendor_name' => $i['vendor_name'],
        ], $rows));
    }

    public static function openPos(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $pos = $pdo->query("SELECT p.id, p.po_number, p.status, p.order_date, v.name AS vendor_name
                            FROM inv_purchase_orders p LEFT JOIN inv_vendors v ON v.id = p.vendor_id
                            WHERE p.status IN ('pending','ordered','partially_received') ORDER BY p.created_at DESC")->fetchAll();
        $out = [];
        foreach ($pos as $p) {
            $cnt = $pdo->prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN bl.is_received THEN 1 ELSE 0 END),0) AS recv
                                  FROM inv_bom_lines bl JOIN inv_boms b ON b.id = bl.bom_id WHERE b.po_id = ?");
            $cnt->execute([(int)$p['id']]); $c = $cnt->fetch();
            $out[] = [
                'id' => (int)$p['id'], 'po_number' => $p['po_number'], 'vendor_name' => $p['vendor_name'],
                'status' => $p['status'], 'line_count' => (int)$c['total'], 'received_lines' => (int)$c['recv'],
                'order_date' => $p['order_date'],
            ];
        }
        return Http::json($res, $out);
    }

    public static function backorders(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT bl.id AS line_id, bl.bom_id, bl.description, bl.part_number, bl.ordered_quantity, bl.received_quantity,
                             v.name AS vendor_name FROM inv_bom_lines bl
                             LEFT JOIN inv_boms b ON b.id = bl.bom_id LEFT JOIN inv_vendors v ON v.id = b.vendor_id
                             WHERE bl.backorder_flag = true")->fetchAll();
        return Http::json($res, array_map(fn($l) => [
            'line_id' => (int)$l['line_id'], 'bom_id' => (int)$l['bom_id'],
            'description' => $l['description'] ?: $l['part_number'], 'vendor_name' => $l['vendor_name'],
            'ordered_quantity' => self::f($l['ordered_quantity']), 'received_quantity' => self::f($l['received_quantity']),
        ], $rows));
    }

    // ── Season rollover ──────────────────────────────────────────────────
    private static function seasonIds(PDO $pdo, string $season): array
    {
        $s = $pdo->prepare("SELECT id FROM team_seasons WHERE season = ?"); $s->execute([$season]);
        return array_map('intval', array_column($s->fetchAll(), 'id'));
    }

    private static function nextSeason(string $season): ?string
    {
        $parts = explode('-', $season);
        if (!ctype_digit($parts[0] ?? '')) return null;
        $y = (int)$parts[0];
        return ($y + 1) . '-' . ($y + 2);
    }

    public static function rolloverPreview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor || !Permissions::isSuperAdmin($pdo, $actor)) return Http::error($res, 'Access denied', 403);
        $season = $req->getQueryParams()['season'] ?? null;
        if (!$season) return Http::error($res, 'season is required', 422);
        $ids = self::seasonIds($pdo, $season);
        if (!$ids) return Http::json($res, ['season' => $season, 'boms' => 0, 'pos' => 0, 'total_spend' => 0.0, 'note' => 'No team-seasons match that season.']);
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $boms = $pdo->prepare("SELECT id, po_id FROM inv_boms WHERE team_season_id IN ($ph) AND status != 'archived'");
        $boms->execute($ids);
        $bomRows = $boms->fetchAll();
        $totalSpend = 0.0; $poIds = [];
        foreach ($bomRows as $b) {
            $ls = $pdo->prepare("SELECT received_quantity, actual_purchase_price, expected_price FROM inv_bom_lines WHERE bom_id = ? AND received_quantity > 0");
            $ls->execute([(int)$b['id']]);
            foreach ($ls->fetchAll() as $l) $totalSpend += self::lineSpend($l);
            if ($b['po_id'] !== null) $poIds[(int)$b['po_id']] = true;
        }
        return Http::json($res, ['season' => $season, 'boms' => count($bomRows), 'pos' => count($poIds), 'total_spend' => round($totalSpend, 2)]);
    }

    public static function runRollover(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::isSuperAdmin($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $season = $q['season'] ?? null;
        if (!$season) return Http::error($res, 'season is required', 422);
        $ids = self::seasonIds($pdo, $season);
        if (!$ids) return Http::error($res, 'No team-seasons match that season.', 400);
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $boms = $pdo->prepare("SELECT id, po_id FROM inv_boms WHERE team_season_id IN ($ph) AND status != 'archived'");
        $boms->execute($ids);
        $bomRows = $boms->fetchAll();
        $totalSpend = 0.0; $poIds = [];
        foreach ($bomRows as $b) {
            $ls = $pdo->prepare("SELECT received_quantity, actual_purchase_price, expected_price FROM inv_bom_lines WHERE bom_id = ? AND received_quantity > 0");
            $ls->execute([(int)$b['id']]);
            foreach ($ls->fetchAll() as $l) $totalSpend += self::lineSpend($l);
            $pdo->prepare("UPDATE inv_boms SET status = 'archived', is_locked = true WHERE id = ?")->execute([(int)$b['id']]);
            if ($b['po_id'] !== null) $poIds[(int)$b['po_id']] = true;
        }
        $posArchived = 0;
        foreach (array_keys($poIds) as $pid) {
            $chk = $pdo->prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END),0) AS arch FROM inv_boms WHERE po_id = ?");
            $chk->execute([$pid]); $c = $chk->fetch();
            if ((int)$c['total'] > 0 && (int)$c['total'] === (int)$c['arch']) {
                $pdo->prepare("UPDATE inv_purchase_orders SET status = 'archived' WHERE id = ?")->execute([$pid]);
                $posArchived++;
            }
        }
        $target = $q['to_season'] ?? self::nextSeason($season);
        $resourcesResult = ['copied_forward' => 0, 'reset_blank' => 0];
        if ($target) $resourcesResult = ResourcesController::rolloverResources($pdo, $season, $target, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', null, 'season_rollover', null, [
            'season' => $season, 'boms_archived' => count($bomRows), 'pos_archived' => $posArchived,
            'total_spend' => round($totalSpend, 2), 'resources_copied' => $resourcesResult['copied_forward'],
            'resources_reset' => $resourcesResult['reset_blank'],
        ]);
        return Http::json($res, [
            'ok' => true, 'season' => $season, 'to_season' => $target,
            'boms_archived' => count($bomRows), 'pos_archived' => $posArchived, 'total_spend' => round($totalSpend, 2),
            'resources_copied_forward' => $resourcesResult['copied_forward'], 'resources_reset_blank' => $resourcesResult['reset_blank'],
            'note' => 'Inventory items and assets carry forward. New-season budgets start fresh. Team resources rolled into the new season (reset-flagged ones cleared).',
        ]);
    }
}
