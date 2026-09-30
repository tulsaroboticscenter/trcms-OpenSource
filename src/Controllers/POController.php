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

/** Port of app/modules/inventory/po_router.py (prefix /api/v1/inventory). */
final class POController
{
    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function f($v): ?float { return $v === null ? null : (float)$v; }

    private static function unitCost($price, $pk): ?float
    {
        if ($price === null) return null;
        $pk = (float)($pk ?? 0);
        return $pk > 0 ? (float)$price / $pk : (float)$price;
    }

    private static function nextPoNumber(PDO $pdo): string
    {
        $rows = $pdo->query("SELECT po_number FROM inv_purchase_orders WHERE po_number IS NOT NULL")->fetchAll();
        $nums = [];
        foreach ($rows as $r) {
            if (str_starts_with((string)$r['po_number'], 'PO-')) {
                $n = explode('-', $r['po_number'], 2)[1] ?? '';
                if (ctype_digit($n)) $nums[] = (int)$n;
            }
        }
        return 'PO-' . str_pad((string)($nums ? max($nums) + 1 : 1), 5, '0', STR_PAD_LEFT);
    }

    private static function poBoms(PDO $pdo, int $poId): array
    {
        $s = $pdo->prepare("SELECT b.*, t.team_number FROM inv_boms b
                            LEFT JOIN team_seasons ts ON ts.id = b.team_season_id
                            LEFT JOIN teams t ON t.id = ts.team_id WHERE b.po_id = ? ORDER BY b.id");
        $s->execute([$poId]);
        return $s->fetchAll();
    }

    private static function bomLines(PDO $pdo, int $bomId): array
    {
        $s = $pdo->prepare("SELECT * FROM inv_bom_lines WHERE bom_id = ? ORDER BY display_order, id"); $s->execute([$bomId]);
        return $s->fetchAll();
    }

    private static function loadPo(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT po.*, v.name AS vendor_name, cb.first_name AS cb_first, cb.last_name AS cb_last
                            FROM inv_purchase_orders po
                            LEFT JOIN inv_vendors v ON v.id = po.vendor_id
                            LEFT JOIN members cb ON cb.id = po.created_by_id WHERE po.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function serializePo(PDO $pdo, array $po, bool $withDetail = true): array
    {
        $boms = self::poBoms($pdo, (int)$po['id']);
        $expected = 0.0; $receivedCount = 0; $totalLines = 0;
        $bomLines = [];
        foreach ($boms as $b) {
            $lines = self::bomLines($pdo, (int)$b['id']);
            $bomLines[(int)$b['id']] = $lines;
            foreach ($lines as $l) {
                $totalLines++;
                if ($l['is_received']) $receivedCount++;
                $pk = (float)($l['package_quantity'] ?? 0);
                $units = $l['ordered_quantity'] !== null ? (float)$l['ordered_quantity'] : (float)($l['quantity_required'] ?? 0);
                $pkgs = ($pk > 0 && $units > 0) ? ceil($units / $pk) : $units;
                $price = $l['actual_purchase_price'] !== null ? $l['actual_purchase_price'] : $l['expected_price'];
                if ($price !== null) $expected += $pkgs * (float)$price;
            }
        }
        $expected += (float)($po['shipping'] ?? 0) + (float)($po['tax'] ?? 0);
        $data = [
            'id' => (int)$po['id'], 'po_number' => $po['po_number'],
            'vendor_id' => $po['vendor_id'] !== null ? (int)$po['vendor_id'] : null, 'vendor_name' => $po['vendor_name'],
            'status' => $po['status'], 'payment_method' => $po['payment_method'], 'invoice_url' => $po['invoice_url'],
            'shipping' => self::f($po['shipping']), 'tax' => self::f($po['tax']), 'order_date' => $po['order_date'],
            'order_number' => $po['order_number'], 'confirmation_number' => $po['confirmation_number'],
            'shipment_address' => $po['shipment_address'], 'expected_delivery_date' => $po['expected_delivery_date'],
            'tracking_number' => $po['tracking_number'], 'notes' => $po['notes'],
            'created_by' => ($po['cb_first'] !== null || $po['cb_last'] !== null) ? trim($po['cb_first'] . ' ' . $po['cb_last']) : null,
            'created_at' => Time::naiveIso($po['created_at']),
            'bom_count' => count($boms), 'line_count' => $totalLines, 'received_lines' => $receivedCount,
            'estimated_total' => round($expected, 2),
        ];
        if ($withDetail) {
            $data['boms'] = array_map(fn($b) => [
                'id' => (int)$b['id'], 'name' => $b['name'], 'status' => $b['status'],
                'team' => ($b['team_number'] ?? null) !== null ? '#' . $b['team_number'] : null,
                'team_season_id' => $b['team_season_id'] !== null ? (int)$b['team_season_id'] : null,
                'needed_by' => $b['needed_by'] ?? null, 'needed_by_date' => $b['needed_by_date'] ?? null,
                'lines' => array_map(fn($l) => [
                    'id' => (int)$l['id'], 'description' => $l['description'], 'part_number' => $l['part_number'],
                    'url' => $l['url'] ?? null,
                    'quantity_required' => self::f($l['quantity_required']), 'ordered_quantity' => self::f($l['ordered_quantity']),
                    'expected_price' => self::f($l['expected_price']), 'actual_purchase_price' => self::f($l['actual_purchase_price']),
                    'received_quantity' => self::f($l['received_quantity']), 'damaged_quantity' => self::f($l['damaged_quantity']),
                    'missing_quantity' => self::f($l['missing_quantity']), 'is_received' => (bool)$l['is_received'],
                    'destination_type' => $l['destination_type'],
                    'destination_team_season_id' => $l['destination_team_season_id'] !== null ? (int)$l['destination_team_season_id'] : null,
                    'receiving_budget_category_id' => $l['receiving_budget_category_id'] !== null ? (int)$l['receiving_budget_category_id'] : null,
                    'budget_category_id' => $l['budget_category_id'] !== null ? (int)$l['budget_category_id'] : null,
                    'item_id' => $l['item_id'] !== null ? (int)$l['item_id'] : null,
                ], $bomLines[(int)$b['id']]),
            ], $boms);
            $data['fees'] = self::feeSummary($pdo, $po);
        }
        return $data;
    }

    /** Effective budget category a line was (or would be) charged to, mirroring applyReceipt. */
    private static function lineEffectiveCat(array $l, ?int $bomCat): ?int
    {
        if ($l['receiving_budget_category_id'] !== null) return (int)$l['receiving_budget_category_id'];
        if ($l['budget_category_id'] !== null) return (int)$l['budget_category_id'];
        return $bomCat;
    }

    /** What a line contributes to a budget: its received charge if received, else its ordered cost. */
    private static function lineChargeAmount(array $l): float
    {
        $price = $l['actual_purchase_price'] !== null ? $l['actual_purchase_price'] : $l['expected_price'];
        if ($price === null) return 0.0;
        $recv = (float)($l['received_quantity'] ?? 0);
        if ($recv > 0) {
            $unit = self::unitCost($price, $l['package_quantity']);
            return $unit !== null ? $recv * $unit : 0.0;
        }
        $pk = (float)($l['package_quantity'] ?? 0);
        $units = $l['ordered_quantity'] !== null ? (float)$l['ordered_quantity'] : (float)($l['quantity_required'] ?? 0);
        $pkgs = ($pk > 0 && $units > 0) ? ceil($units / $pk) : $units;
        return $pkgs * (float)$price;
    }

    /**
     * Shipping/tax split: each budget category items were charged to gets a share of the PO's
     * shipping and tax in proportion to its spend, plus what's already been charged. The category
     * is read per LINE (the one it was received against), falling back to the BOM's category —
     * matching how the items themselves were charged. Lines with no category are "unassigned".
     */
    private static function feeSummary(PDO $pdo, array $po): array
    {
        $poId = (int)$po['id'];
        $shipping = round((float)($po['shipping'] ?? 0), 2);
        $tax = round((float)($po['tax'] ?? 0), 2);

        $sub = []; $meta = []; $unassigned = 0.0;
        foreach (self::poBoms($pdo, $poId) as $b) {
            $bomCat = $b['budget_category_id'] !== null ? (int)$b['budget_category_id'] : null;
            $teamLabel = ($b['team_number'] ?? null) !== null ? '#' . $b['team_number'] : null;
            foreach (self::bomLines($pdo, (int)$b['id']) as $l) {
                $amount = self::lineChargeAmount($l);
                if ($amount <= 0) continue;
                $cat = self::lineEffectiveCat($l, $bomCat);
                if ($cat === null) { $unassigned += $amount; continue; }
                $sub[$cat] = ($sub[$cat] ?? 0) + $amount;
                if (!isset($meta[$cat])) $meta[$cat] = ['team' => $teamLabel, 'name' => null];
            }
        }
        if ($sub) {
            $ids = array_keys($sub);
            $in = implode(',', array_fill(0, count($ids), '?'));
            $cs = $pdo->prepare(
                "SELECT bc.id, bc.name, t.team_number
                   FROM inv_budget_categories bc
                   LEFT JOIN team_seasons ts ON ts.id = bc.team_season_id
                   LEFT JOIN teams t ON t.id = ts.team_id
                  WHERE bc.id IN ($in)");
            $cs->execute($ids);
            foreach ($cs->fetchAll() as $r) {
                $meta[(int)$r['id']]['name'] = $r['name'];
                if (($r['team_number'] ?? null) !== null) $meta[(int)$r['id']]['team'] = '#' . $r['team_number'];
            }
        }
        $grand = array_sum($sub) + $unassigned;

        // What's already charged lives as itemized ad-hoc expenses tagged with this PO + fee_kind.
        $chg = []; $chargedAt = null;
        $cq = $pdo->prepare(
            "SELECT budget_category_id,
                    SUM(CASE WHEN fee_kind = 'shipping' THEN amount ELSE 0 END) AS shipping_amount,
                    SUM(CASE WHEN fee_kind = 'tax'      THEN amount ELSE 0 END) AS tax_amount,
                    MAX(created_at) AS charged_at
               FROM team_adhoc_expenses
              WHERE source_po_id = ? AND fee_kind IS NOT NULL
              GROUP BY budget_category_id");
        $cq->execute([$poId]);
        foreach ($cq->fetchAll() as $r) { $chg[(int)$r['budget_category_id']] = $r; $chargedAt = $r['charged_at']; }

        $cats = [];
        foreach ($sub as $cat => $s) {
            $share = $grand > 0 ? $s / $grand : 0;
            $cats[] = [
                'budget_category_id' => $cat,
                'category_name' => $meta[$cat]['name'] ?? ('Category #' . $cat),
                'team' => $meta[$cat]['team'] ?? null,
                'subtotal' => round($s, 2),
                'proposed_shipping' => round($shipping * $share, 2),
                'proposed_tax' => round($tax * $share, 2),
                'charged_shipping' => isset($chg[$cat]) ? (float)$chg[$cat]['shipping_amount'] : null,
                'charged_tax' => isset($chg[$cat]) ? (float)$chg[$cat]['tax_amount'] : null,
            ];
        }
        usort($cats, fn($a, $b) => $b['subtotal'] <=> $a['subtotal']);

        return [
            'shipping' => $shipping, 'tax' => $tax,
            'grand_subtotal' => round($grand, 2), 'unassigned_subtotal' => round($unassigned, 2),
            'categories' => $cats,
            'charged' => !empty($chg), 'charged_at' => $chargedAt ? Time::naiveIso($chargedAt) : null,
        ];
    }

    /** Nudge the largest allocation so per-category amounts sum exactly to the target. */
    private static function balanceAlloc(array &$alloc, string $key, float $target): void
    {
        if (!$alloc) return;
        $sum = 0.0; foreach ($alloc as $a) $sum += $a[$key];
        $diff = round($target - $sum, 2);
        if ($diff == 0.0) return;
        $maxCid = null; $maxVal = -1.0;
        foreach ($alloc as $cid => $a) { if ($a[$key] > $maxVal) { $maxVal = $a[$key]; $maxCid = $cid; } }
        if ($maxCid !== null) $alloc[$maxCid][$key] = round($alloc[$maxCid][$key] + $diff, 2);
    }

    /**
     * POST /pos/{po_id}/fees — charge (or re-charge) the PO's shipping & tax to team budgets.
     * Body: optional { shipping, tax } to set the PO totals first (so a receiver can enter them
     * here even when the BOMs are locked), and optional { allocations: [{budget_category_id,
     * shipping_amount, tax_amount}] }. With no allocations it auto-splits proportionally. Reverses
     * any prior charge first so it never double-counts.
     */
    public static function chargeFees(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.receive', 'write')) return Http::error($res, 'Access denied', 403);
        $po = self::loadPo($pdo, (int)$route['po_id']);
        if (!$po) return Http::error($res, 'Purchase order not found', 404);

        $d = (array)$req->getParsedBody();
        // Let the receiver set/adjust the PO's shipping & tax right here (no need to unlock a BOM
        // or open Order Details). inventory.receive covers this since it's part of costing a receipt.
        $totalSets = []; $totalVals = [];
        foreach (['shipping', 'tax'] as $tf) {
            if (array_key_exists($tf, $d)) {
                $totalSets[] = "$tf = ?";
                $totalVals[] = ($d[$tf] === '' || $d[$tf] === null) ? null : max(0.0, round((float)$d[$tf], 2));
            }
        }
        if ($totalSets) {
            $totalVals[] = (int)$po['id'];
            $pdo->prepare("UPDATE inv_purchase_orders SET " . implode(',', $totalSets) . ", updated_at = NOW() WHERE id = ?")->execute($totalVals);
            $po = self::loadPo($pdo, (int)$po['id']);
        }

        $summary = self::feeSummary($pdo, $po);
        $valid = [];
        foreach ($summary['categories'] as $c) $valid[$c['budget_category_id']] = $c;
        if (!$valid) return Http::error($res, 'No team budget categories on this PO to charge. Receive the items to a team budget category first.', 422);

        $alloc = [];
        if (isset($d['allocations']) && is_array($d['allocations'])) {
            foreach ($d['allocations'] as $a) {
                $cid = (int)($a['budget_category_id'] ?? 0);
                if (!isset($valid[$cid])) continue;   // only categories that belong to this PO
                $alloc[$cid] = [
                    'shipping' => max(0.0, round((float)($a['shipping_amount'] ?? 0), 2)),
                    'tax'      => max(0.0, round((float)($a['tax_amount'] ?? 0), 2)),
                ];
            }
        } else {
            foreach ($summary['categories'] as $c) {
                $alloc[$c['budget_category_id']] = ['shipping' => $c['proposed_shipping'], 'tax' => $c['proposed_tax']];
            }
            self::balanceAlloc($alloc, 'shipping', $summary['shipping']);
            self::balanceAlloc($alloc, 'tax', $summary['tax']);
        }

        self::applyFeeCharges($pdo, (int)$po['id'], $alloc, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', (int)$po['id'], 'charge_fees', null, ['allocations' => $alloc]);
        return Http::json($res, self::serializePo($pdo, self::loadPo($pdo, (int)$po['id'])));
    }

    /** DELETE /pos/{po_id}/fees — reverse any shipping/tax charged from this PO. */
    public static function clearFees(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.receive', 'write')) return Http::error($res, 'Access denied', 403);
        $po = self::loadPo($pdo, (int)$route['po_id']);
        if (!$po) return Http::error($res, 'Purchase order not found', 404);
        self::applyFeeCharges($pdo, (int)$po['id'], [], (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', (int)$po['id'], 'clear_fees', null, null);
        return Http::json($res, self::serializePo($pdo, self::loadPo($pdo, (int)$po['id'])));
    }

    /**
     * Reverse this PO's existing fee expenses, then record the given per-category allocation as
     * itemized ad-hoc expenses ("Shipping — PO …" / "Tax — PO …") on each team's budget. The
     * ad-hoc rows already count toward the category's spend, so actual_amount is left alone.
     */
    private static function applyFeeCharges(PDO $pdo, int $poId, array $alloc, int $actorId): void
    {
        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM team_adhoc_expenses WHERE source_po_id = ?")->execute([$poId]);

            $po = self::loadPo($pdo, $poId);
            $poNum = ($po['po_number'] ?? '') !== '' ? $po['po_number'] : (string)$poId;
            $vendor = $po['vendor_name'] ?? null;
            $expDate = $po['order_date'] ?: date('Y-m-d');
            $tsStmt = $pdo->prepare("SELECT team_season_id FROM inv_budget_categories WHERE id = ?");
            $ins = $pdo->prepare(
                "INSERT INTO team_adhoc_expenses
                   (team_season_id, source_po_id, budget_category_id, vendor, description, fee_kind, amount, purchaser_id, expense_date, created_by_id)
                 VALUES (?,?,?,?,?,?,?,?,?,?)");
            foreach ($alloc as $cid => $a) {
                if ($a['shipping'] <= 0 && $a['tax'] <= 0) continue;
                $tsStmt->execute([(int)$cid]);
                $tsid = $tsStmt->fetchColumn();
                if ($tsid === false) continue;   // category no longer exists
                if ($a['shipping'] > 0) $ins->execute([(int)$tsid, $poId, (int)$cid, $vendor, "Shipping — PO {$poNum}", 'shipping', $a['shipping'], $actorId, $expDate, $actorId]);
                if ($a['tax'] > 0)      $ins->execute([(int)$tsid, $poId, (int)$cid, $vendor, "Tax — PO {$poNum}", 'tax', $a['tax'], $actorId, $expDate, $actorId]);
            }
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); throw $e; }
    }

    // ── PO endpoints ─────────────────────────────────────────────────────
    public static function listPos(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $conds = []; $args = [];
        if (!empty($q['status'])) { $conds[] = "status = ?"; $args[] = $q['status']; }
        else {
            // In the "All" view, hide the closed-out statuses unless explicitly asked for:
            // archived (season-closed) and cancelled are noise for day-to-day purchasing.
            $hidden = [];
            if (!filter_var($q['include_archived'] ?? false, FILTER_VALIDATE_BOOLEAN)) $hidden[] = 'archived';
            if (!filter_var($q['include_cancelled'] ?? false, FILTER_VALIDATE_BOOLEAN)) $hidden[] = 'cancelled';
            if ($hidden) {
                $conds[] = 'status NOT IN (' . implode(',', array_fill(0, count($hidden), '?')) . ')';
                $args = array_merge($args, $hidden);
            }
        }
        $where = $conds ? ' WHERE ' . implode(' AND ', $conds) : '';
        $s = $pdo->prepare("SELECT id FROM inv_purchase_orders$where ORDER BY created_at DESC"); $s->execute($args);
        return Http::json($res, array_map(fn($r) => self::serializePo($pdo, self::loadPo($pdo, (int)$r['id']), false), $s->fetchAll()));
    }

    public static function getPo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $po = self::loadPo($pdo, (int)$route['po_id']);
        if (!$po) return Http::error($res, 'Purchase order not found', 404);
        return Http::json($res, self::serializePo($pdo, $po));
    }

    public static function createPo(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.po', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO inv_purchase_orders (po_number, vendor_id, payment_method, notes, status, created_by_id, created_at, updated_at)
                              VALUES (?, ?, ?, ?, 'pending', ?, NOW(), NOW())");
        $ins->execute([self::nextPoNumber($pdo), isset($d['vendor_id']) ? (int)$d['vendor_id'] : null,
            $d['payment_method'] ?? null, $d['notes'] ?? null, (int)$cur['id']]);
        $poId = (int)$pdo->lastInsertId();
        $bomIds = $d['bom_ids'] ?? [];
        $attached = []; $vendorId = isset($d['vendor_id']) ? (int)$d['vendor_id'] : null;
        foreach ($bomIds as $bid) {
            $bs = $pdo->prepare("SELECT * FROM inv_boms WHERE id = ?"); $bs->execute([(int)$bid]);
            $b = $bs->fetch();
            if ($b) {
                $pdo->prepare("UPDATE inv_boms SET po_id = ? WHERE id = ?")->execute([$poId, (int)$b['id']]);
                $attached[] = $b;
                if (!$vendorId && $b['vendor_id']) { $vendorId = (int)$b['vendor_id']; $pdo->prepare("UPDATE inv_purchase_orders SET vendor_id = ? WHERE id = ?")->execute([$vendorId, $poId]); }
            }
        }
        foreach (['order_number', 'confirmation_number', 'shipment_address', 'expected_delivery_date', 'tracking_number', 'order_date', 'invoice_url'] as $field) {
            foreach ($attached as $b) {
                if ($b[$field] !== null && $b[$field] !== '') { $pdo->prepare("UPDATE inv_purchase_orders SET $field = ? WHERE id = ?")->execute([$b[$field], $poId]); break; }
            }
        }
        foreach (['shipping', 'tax'] as $field) {
            $total = array_sum(array_map(fn($b) => (float)($b[$field] ?? 0), $attached));
            if ($total) $pdo->prepare("UPDATE inv_purchase_orders SET $field = ? WHERE id = ?")->execute([$total, $poId]);
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', $poId, 'create', null, ['po_number' => self::loadPo($pdo, $poId)['po_number'], 'boms' => $bomIds]);
        return Http::json($res, self::serializePo($pdo, self::loadPo($pdo, $poId)), 201);
    }

    private const PO_FIELDS = ['vendor_id', 'payment_method', 'invoice_url', 'shipping', 'tax', 'order_date', 'order_number',
        'confirmation_number', 'shipment_address', 'expected_delivery_date', 'tracking_number', 'notes'];

    public static function updatePo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.po', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['po_id'];
        if (!self::loadPo($pdo, $id)) return Http::error($res, 'Purchase order not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::PO_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($f === 'vendor_id' && $d[$f] !== null) ? (int)$d[$f] : $d[$f]; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE inv_purchase_orders SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', $id, 'update');
        return Http::json($res, self::serializePo($pdo, self::loadPo($pdo, $id)));
    }

    public static function addBomToPo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.po', 'write')) return Http::error($res, 'Access denied', 403);
        $poId = (int)$route['po_id']; $bomId = (int)$route['bom_id'];
        if (!self::loadPo($pdo, $poId)) return Http::error($res, 'Purchase order not found', 404);
        $bs = $pdo->prepare("SELECT 1 FROM inv_boms WHERE id = ?"); $bs->execute([$bomId]);
        if (!$bs->fetch()) return Http::error($res, 'BOM not found', 404);
        $pdo->prepare("UPDATE inv_boms SET po_id = ? WHERE id = ?")->execute([$poId, $bomId]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', $bomId, 'po.add_bom', null, ['po_id' => $poId]);
        return Http::json($res, self::serializePo($pdo, self::loadPo($pdo, $poId)));
    }

    /**
     * DELETE /inventory/pos/{po_id}/permanent — System Administrator only.
     * Permanently removes a purchase order. Its BOMs are automatically detached
     * (inv_boms.po_id is ON DELETE SET NULL) so they revert to standalone BOMs.
     */
    public static function deletePoPermanent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !in_array('System Administrator', Permissions::effectiveRolesFor($pdo, $cur), true)) {
            return Http::error($res, 'Only a System Administrator can permanently delete a purchase order.', 403);
        }
        $id = (int)$route['po_id'];
        $po = self::loadPo($pdo, $id);
        if (!$po) return Http::error($res, 'Purchase order not found', 404);
        $cnt = $pdo->prepare("SELECT COUNT(*) FROM inv_boms WHERE po_id = ?"); $cnt->execute([$id]);
        $bomCount = (int)$cnt->fetchColumn();
        // Ordered BOMs revert to Pending so they aren't left orphaned as "Ordered".
        $pdo->prepare("UPDATE inv_boms SET status = 'ready_to_order', ordered_flag = 0, order_date = NULL WHERE po_id = ? AND status = 'ordered'")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', $id, 'delete', $po, null);
        $pdo->prepare("DELETE FROM inv_purchase_orders WHERE id = ?")->execute([$id]); // BOMs detach via SET NULL
        return Http::json($res, ['ok' => true, 'boms_detached' => $bomCount]);
    }

    public static function removeBomFromPo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.po', 'write')) return Http::error($res, 'Access denied', 403);
        // Detach; if it had already been ordered on this PO, revert it to Pending.
        $pdo->prepare("UPDATE inv_boms SET po_id = NULL,
                status = CASE WHEN status = 'ordered' THEN 'ready_to_order' ELSE status END,
                ordered_flag = CASE WHEN status = 'ordered' THEN 0 ELSE ordered_flag END,
                order_date = CASE WHEN status = 'ordered' THEN NULL ELSE order_date END
             WHERE id = ? AND po_id = ?")->execute([(int)$route['bom_id'], (int)$route['po_id']]);
        Audit::write($pdo, (int)$cur['id'], 'inv_boms', (int)$route['bom_id'], 'po.remove_bom', null, ['po_id' => (int)$route['po_id']]);
        return Http::json($res, ['ok' => true]);
    }

    public static function submitPo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.po', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['po_id'];
        $po = self::loadPo($pdo, $id);
        if (!$po) return Http::error($res, 'Purchase order not found', 404);
        $orderDate = $po['order_date'] ?: date('Y-m-d');
        $pdo->prepare("UPDATE inv_purchase_orders SET status = 'ordered', order_date = ?, updated_at = NOW() WHERE id = ?")->execute([$orderDate, $id]);
        foreach (self::poBoms($pdo, $id) as $b) {
            if (in_array($b['status'], ['draft', 'ready_to_order'], true)) {
                $bOrderDate = $b['order_date'] ?: date('Y-m-d');
                $pdo->prepare("UPDATE inv_boms SET status = 'ordered', ordered_flag = true, is_locked = true, order_date = ?, updated_at = NOW() WHERE id = ?")->execute([$bOrderDate, (int)$b['id']]);
            }
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', $id, 'update', null, ['status' => 'ordered']);
        return Http::json($res, self::serializePo($pdo, self::loadPo($pdo, $id)));
    }

    public static function cancelPo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.po', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['po_id'];
        if (!self::loadPo($pdo, $id)) return Http::error($res, 'Purchase order not found', 404);
        $pdo->prepare("UPDATE inv_purchase_orders SET status = 'cancelled', updated_at = NOW() WHERE id = ?")->execute([$id]);
        // Ordered-but-not-received BOMs revert to Pending and detach so they can be
        // re-ordered on a new PO. Received/partially-received BOMs keep their status.
        $pdo->prepare("UPDATE inv_boms SET status = 'ready_to_order', ordered_flag = 0, order_date = NULL, po_id = NULL WHERE po_id = ? AND status = 'ordered'")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', $id, 'cancel', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Receiving ────────────────────────────────────────────────────────
    private static function createItemFromLine(PDO $pdo, array $line, ?int $teamSeasonId, ?int $locationId): int
    {
        $price = $line['actual_purchase_price'] !== null ? $line['actual_purchase_price'] : $line['expected_price'];
        $name = substr((string)($line['description'] ?: ($line['part_number'] ?: 'Received item')), 0, 300);
        $vendorId = null;
        if ($line['bom_id']) { $bs = $pdo->prepare("SELECT vendor_id FROM inv_boms WHERE id = ?"); $bs->execute([(int)$line['bom_id']]); $b = $bs->fetch(); $vendorId = $b && $b['vendor_id'] !== null ? (int)$b['vendor_id'] : null; }
        $ins = $pdo->prepare("INSERT INTO inv_items (item_type, name, part_number, url, package_quantity, cost, vendor_id, assigned_team_season_id, location_id, current_quantity, status, created_at, updated_at)
                              VALUES ('part', ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', NOW(), NOW())");
        $ins->execute([$name, $line['part_number'], $line['url'], $line['package_quantity'], $price, $vendorId, $teamSeasonId, $locationId]);
        return (int)$pdo->lastInsertId();
    }

    private static function enrichItemFromLine(PDO $pdo, int $itemId, array $line): void
    {
        $s = $pdo->prepare("SELECT * FROM inv_items WHERE id = ?"); $s->execute([$itemId]); $item = $s->fetch();
        if (!$item) return;
        $set = []; $args = [];
        if ($line['description'] && trim((string)($item['description'] ?? '')) === '') { $set[] = 'description = ?'; $args[] = $line['description']; }
        if ($line['url'] && trim((string)($item['url'] ?? '')) === '') { $set[] = 'url = ?'; $args[] = $line['url']; }
        if ($line['package_quantity'] !== null && $item['package_quantity'] === null) { $set[] = 'package_quantity = ?'; $args[] = (int)$line['package_quantity']; }
        if ($line['part_number'] && trim((string)($item['part_number'] ?? '')) === '') { $set[] = 'part_number = ?'; $args[] = $line['part_number']; }
        if ($line['actual_purchase_price'] !== null) { $set[] = 'cost = ?'; $args[] = $line['actual_purchase_price']; }
        elseif ($item['cost'] === null && $line['expected_price'] !== null) { $set[] = 'cost = ?'; $args[] = $line['expected_price']; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $itemId; $pdo->prepare("UPDATE inv_items SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
    }

    private static function stockItemForReceipt(PDO $pdo, array &$line, ?string $destType, ?int $destTeam, ?int $locationId): int
    {
        // Resolve the ONE canonical item for this line. We never create per-team
        // clones any more — where stock lives (team or location) is recorded via
        // inv_item_holdings, so a part number stays a single inventory row.
        $destType = $destType ?: 'inventory';
        $pn = trim((string)($line['part_number'] ?? ''));
        $itemId = null;
        if ($line['item_id']) { $s = $pdo->prepare("SELECT id FROM inv_items WHERE id = ?"); $s->execute([(int)$line['item_id']]); $r = $s->fetch(); $itemId = $r ? (int)$r['id'] : null; }
        if (!$itemId && $pn !== '') {
            // Prefer the unassigned/canonical row; fall back to any row with this part number.
            $s = $pdo->prepare("SELECT id FROM inv_items WHERE LOWER(part_number) = ? ORDER BY (assigned_team_season_id IS NOT NULL), id LIMIT 1");
            $s->execute([strtolower($pn)]); $r = $s->fetch(); $itemId = $r ? (int)$r['id'] : null;
        }
        if (!$itemId) $itemId = self::createItemFromLine($pdo, $line, null, $destType === 'team' ? null : $locationId);
        // Only adopt a location for general-inventory receipts; team stock is tracked by holding.
        if ($destType !== 'team' && $locationId) {
            $s = $pdo->prepare("SELECT location_id FROM inv_items WHERE id = ?"); $s->execute([$itemId]); $it = $s->fetch();
            if ($it && $it['location_id'] === null) $pdo->prepare("UPDATE inv_items SET location_id = ? WHERE id = ?")->execute([$locationId, $itemId]);
        }
        if ($line['item_id'] === null) { $pdo->prepare("UPDATE inv_bom_lines SET item_id = ? WHERE id = ?")->execute([$itemId, (int)$line['id']]); $line['item_id'] = $itemId; }
        self::enrichItemFromLine($pdo, $itemId, $line);
        return $itemId;
    }

    /**
     * Stock one allocation of received quantity (#45 Layer B). Normally adds the
     * quantity to the line's own stock item. But if the line's item is a KIT, the
     * kit itself holds no stock — instead it explodes into its component parts,
     * adding (component qty × received) of each to the same destination, so the
     * individual parts land in inventory / on the team. Returns a list of what was
     * actually stocked: [['item_id'=>…, 'quantity'=>…, 'label'=>component name|null]].
     */
    private static function stockReceipt(PDO $pdo, array &$line, float $qty, ?string $destType, ?int $destTeam, ?int $locationId): array
    {
        $destType = $destType ?: 'inventory';
        $kit = self::kitForLine($pdo, $line);
        if ($kit === null) {
            $targetId = self::stockItemForReceipt($pdo, $line, $destType, $destTeam, $locationId);
            $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) + ?, updated_at = NOW() WHERE id = ?")->execute([$qty, $targetId]);
            self::addHolding($pdo, $targetId, $destType === 'team' ? null : $locationId, $destType === 'team' ? $destTeam : null, $qty);
            return [['item_id' => $targetId, 'quantity' => $qty, 'label' => null]];
        }
        // Keep the BOM line pointed at the kit SKU (so the line shows as received),
        // but stock the components rather than the kit.
        if ($line['item_id'] === null) {
            $pdo->prepare("UPDATE inv_bom_lines SET item_id = ? WHERE id = ?")->execute([$kit['kit_item_id'], (int)$line['id']]);
            $line['item_id'] = $kit['kit_item_id'];
        }
        $out = [];
        foreach ($kit['components'] as $c) {
            $compQty = $qty * (float)$c['quantity'];
            if ($compQty <= 0) continue;
            $cid = self::componentStockId($pdo, $c, $destType, $destTeam, $locationId);
            $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) + ?, updated_at = NOW() WHERE id = ?")->execute([$compQty, $cid]);
            self::addHolding($pdo, $cid, $destType === 'team' ? null : $locationId, $destType === 'team' ? $destTeam : null, $compQty);
            $out[] = ['item_id' => $cid, 'quantity' => $compQty, 'label' => $c['name']];
        }
        return $out;
    }

    /** Add received quantity to the item's holding bucket for this location/team (creating it if needed). */
    private static function addHolding(PDO $pdo, int $itemId, ?int $locationId, ?int $teamId, float $qty): void
    {
        if ($qty == 0.0) return;
        if ($locationId !== null)      { $where = 'location_id = ? AND team_season_id IS NULL'; $args = [$itemId, $locationId]; }
        elseif ($teamId !== null)      { $where = 'team_season_id = ? AND location_id IS NULL'; $args = [$itemId, $teamId]; }
        else                           { $where = 'location_id IS NULL AND team_season_id IS NULL'; $args = [$itemId]; }
        $q = $pdo->prepare("SELECT id FROM inv_item_holdings WHERE item_id = ? AND $where LIMIT 1");
        $q->execute($args);
        if ($row = $q->fetch()) {
            $pdo->prepare("UPDATE inv_item_holdings SET quantity = quantity + ?, updated_at = NOW() WHERE id = ?")->execute([$qty, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO inv_item_holdings (item_id, location_id, team_season_id, quantity, created_at, updated_at) VALUES (?,?,?,?,NOW(),NOW())")
                ->execute([$itemId, $locationId, $teamId, $qty]);
        }
    }

    /** "9462 - Toefur's Titans" for a team_season_id, or "team N" as a fallback. */
    private static function teamLabel(PDO $pdo, ?int $teamSeasonId): string
    {
        if (!$teamSeasonId) return 'inventory';
        $s = $pdo->prepare("SELECT t.team_number, ts.team_name FROM team_seasons ts JOIN teams t ON t.id = ts.team_id WHERE ts.id = ?");
        $s->execute([$teamSeasonId]);
        $r = $s->fetch();
        if (!$r) return "team $teamSeasonId";
        $num = trim((string)($r['team_number'] ?? ''));
        $name = trim((string)($r['team_name'] ?? ''));
        return trim($num . ($name !== '' ? " - $name" : "")) ?: "team $teamSeasonId";
    }

    /** If the BOM line's item is a kit (by item_id, or by part number), return its components; else null. */
    private static function kitForLine(PDO $pdo, array $line): ?array
    {
        $kitId = null;
        if (!empty($line['item_id'])) {
            $s = $pdo->prepare("SELECT id, is_kit FROM inv_items WHERE id = ?"); $s->execute([(int)$line['item_id']]);
            $it = $s->fetch();
            if ($it && (int)$it['is_kit'] === 1) $kitId = (int)$it['id'];
        }
        if ($kitId === null) {
            $pn = trim((string)($line['part_number'] ?? ''));
            if ($pn !== '') {
                $s = $pdo->prepare("SELECT id FROM inv_items WHERE LOWER(part_number) = ? AND is_kit = 1 AND assigned_team_season_id IS NULL LIMIT 1");
                $s->execute([strtolower($pn)]); $r = $s->fetch(); if ($r) $kitId = (int)$r['id'];
            }
        }
        if ($kitId === null) return null;
        $cs = $pdo->prepare("SELECT kc.component_item_id, kc.quantity, i.name, i.part_number
                             FROM inv_kit_components kc JOIN inv_items i ON i.id = kc.component_item_id
                             WHERE kc.kit_item_id = ?");
        $cs->execute([$kitId]);
        $comps = $cs->fetchAll();
        if (!$comps) return null; // a kit with no components defined → stock it normally
        return ['kit_item_id' => $kitId, 'components' => $comps];
    }

    /** The canonical stock item for one kit component — team/location is tracked via holdings. */
    private static function componentStockId(PDO $pdo, array $comp, string $destType, ?int $destTeam, ?int $locationId): int
    {
        $cid = (int)$comp['component_item_id'];
        // Only adopt a location for general-inventory receipts; team stock is a holding.
        if ($destType !== 'team' && $locationId) {
            $s = $pdo->prepare("SELECT location_id FROM inv_items WHERE id = ?"); $s->execute([$cid]); $it = $s->fetch();
            if ($it && $it['location_id'] === null) $pdo->prepare("UPDATE inv_items SET location_id = ? WHERE id = ?")->execute([$locationId, $cid]);
        }
        return $cid;
    }

    private static function applyReceipt(PDO $pdo, array $line, $recv, int $actorId, $damaged, $missing, string $destType, ?int $destTeam, ?int $catId, ?string $packingSlip, ?string $notes, ?int $locationId): void
    {
        $expectedQty = $line['ordered_quantity'] !== null ? (float)$line['ordered_quantity'] : (float)($line['quantity_required'] ?? 0);
        $isReceived = ((float)$recv >= $expectedQty && (float)$recv > 0);
        $effCatOnLine = $catId !== null ? $catId : ($line['receiving_budget_category_id'] !== null ? (int)$line['receiving_budget_category_id'] : null);
        $pdo->prepare("UPDATE inv_bom_lines SET received_quantity = ?, damaged_quantity = ?, missing_quantity = ?, destination_type = ?, destination_team_season_id = ?, receiving_budget_category_id = ?, packing_slip_url = ?, received_at = NOW(), is_received = ? WHERE id = ?")
            ->execute([$recv, $damaged, $missing, $destType, $destTeam, $effCatOnLine, $packingSlip, (int)$isReceived, (int)$line['id']]);
        $line['item_id'] = $line['item_id'] !== null ? (int)$line['item_id'] : null;
        $stocked = [];
        if ($recv) {
            $stocked = self::stockReceipt($pdo, $line, (float)$recv, $destType, $destTeam, $locationId);
        }
        $bomCat = null;
        if ($line['bom_id']) { $bs = $pdo->prepare("SELECT budget_category_id FROM inv_boms WHERE id = ?"); $bs->execute([(int)$line['bom_id']]); $bb = $bs->fetch(); $bomCat = $bb && $bb['budget_category_id'] !== null ? (int)$bb['budget_category_id'] : null; }
        $effectiveCat = $catId !== null ? $catId : (($line['budget_category_id'] !== null ? (int)$line['budget_category_id'] : null) ?? $bomCat);
        $unit = self::unitCost($line['actual_purchase_price'] !== null ? $line['actual_purchase_price'] : $line['expected_price'], $line['package_quantity']);
        // Budget is charged once for what was purchased (the line/kit price), not per
        // exploded component — the kit's price already covers its parts.
        if ($effectiveCat && $unit !== null && $recv) {
            $pdo->prepare("UPDATE inv_budget_categories SET actual_amount = COALESCE(actual_amount,0) + ?, updated_at = NOW() WHERE id = ?")->execute([(float)$recv * $unit, $effectiveCat]);
        }
        $destLabel = $destType === 'team' ? self::teamLabel($pdo, $destTeam) : 'inventory';
        foreach ($stocked as $st) {
            $reason = "Received against BOM #{$line['bom_id']} → $destLabel" . ($st['label'] ? " (kit part: {$st['label']})" : "");
            $pdo->prepare("INSERT INTO inv_movements (item_id, movement_type, quantity, to_team_season_id, to_location_id, actor_id, reason, notes, created_at) VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, NOW())")
                ->execute([$st['item_id'], $st['quantity'], $destTeam, $locationId, $actorId, $reason, $notes]);
        }
    }

    private static function recomputeStatuses(PDO $pdo, int $bomId): string
    {
        $lines = self::bomLines($pdo, $bomId);
        $allRecv = count($lines) > 0;
        $anyRecv = false;
        foreach ($lines as $l) { if (!$l['is_received']) $allRecv = false; if ((float)($l['received_quantity'] ?? 0) > 0) $anyRecv = true; }
        $bs = $pdo->prepare("SELECT status, po_id FROM inv_boms WHERE id = ?"); $bs->execute([$bomId]); $bom = $bs->fetch();
        $newStatus = $allRecv ? 'received' : ($anyRecv ? 'partially_received' : $bom['status']);
        $pdo->prepare("UPDATE inv_boms SET status = ? WHERE id = ?")->execute([$newStatus, $bomId]);
        if ($bom['po_id'] !== null) {
            $poId = (int)$bom['po_id'];
            $poBoms = self::poBoms($pdo, $poId);
            $poAll = count($poBoms) > 0; $poAny = false;
            foreach ($poBoms as $b) {
                $bl = self::bomLines($pdo, (int)$b['id']);
                $thisAll = count($bl) > 0;
                foreach ($bl as $l) { if (!$l['is_received']) $thisAll = false; if ((float)($l['received_quantity'] ?? 0) > 0) $poAny = true; }
                if (!$thisAll) $poAll = false;
            }
            $ps = $pdo->prepare("SELECT status FROM inv_purchase_orders WHERE id = ?"); $ps->execute([$poId]); $cur = $ps->fetch();
            $poStatus = $poAll ? 'complete' : ($poAny ? 'partially_received' : $cur['status']);
            $pdo->prepare("UPDATE inv_purchase_orders SET status = ? WHERE id = ?")->execute([$poStatus, $poId]);
        }
        return $newStatus;
    }

    private static function loadLine(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM inv_bom_lines WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function receiveLine(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.receive', 'write')) return Http::error($res, 'Access denied', 403);
        $line = self::loadLine($pdo, (int)$route['line_id']);
        if (!$line) return Http::error($res, 'BOM line not found', 404);
        $d = (array)$req->getParsedBody();
        $recv = $d['received_quantity'] ?? 0;
        $expectedQty = $line['ordered_quantity'] !== null ? (float)$line['ordered_quantity'] : (float)($line['quantity_required'] ?? 0);
        if ($expectedQty > 0 && (float)$recv > $expectedQty + 0.001) {
            return Http::error($res, "Received quantity ({$recv}) exceeds the ordered quantity ({$expectedQty}).", 422);
        }
        self::applyReceipt($pdo, $line, $recv, (int)$cur['id'], $d['damaged_quantity'] ?? null, $d['missing_quantity'] ?? null,
            $d['destination_type'] ?? 'inventory', isset($d['destination_team_season_id']) ? (int)$d['destination_team_season_id'] : null,
            isset($d['receiving_budget_category_id']) ? (int)$d['receiving_budget_category_id'] : null,
            $d['packing_slip_url'] ?? null, $d['notes'] ?? null, isset($d['location_id']) ? (int)$d['location_id'] : null);
        $bomStatus = self::recomputeStatuses($pdo, (int)$line['bom_id']);
        $line = self::loadLine($pdo, (int)$line['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_bom_lines', (int)$line['id'], 'receive', null, ['received' => self::f($recv), 'destination' => $d['destination_type'] ?? 'inventory']);
        return Http::json($res, ['ok' => true, 'line_id' => (int)$line['id'], 'is_received' => (bool)$line['is_received'], 'bom_status' => $bomStatus]);
    }

    public static function receiveSplit(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.receive', 'write')) return Http::error($res, 'Access denied', 403);
        $line = self::loadLine($pdo, (int)$route['line_id']);
        if (!$line) return Http::error($res, 'BOM line not found', 404);
        $d = (array)$req->getParsedBody();
        $allocs = array_values(array_filter($d['allocations'] ?? [], fn($a) => isset($a['quantity']) && (float)$a['quantity'] > 0));
        if (!$allocs) return Http::error($res, 'Enter at least one allocation with a quantity.', 400);
        $total = array_sum(array_map(fn($a) => (float)$a['quantity'], $allocs));
        $expectedQty = $line['ordered_quantity'] !== null ? (float)$line['ordered_quantity'] : (float)($line['quantity_required'] ?? 0);
        // Guard against over-receipt: the allocations can't exceed what was ordered.
        // (Small epsilon for float noise.) This stops a duplicated allocation from
        // silently stocking 2× the ordered quantity.
        if ($expectedQty > 0 && $total > $expectedQty + 0.001) {
            return Http::error($res, "Allocated total ({$total}) exceeds the ordered quantity ({$expectedQty}). Reduce the allocations so they don't exceed what was ordered.", 422);
        }
        $isReceived = ($total >= $expectedQty && $total > 0);
        if (count($allocs) === 1) {
            $a = $allocs[0];
            $pdo->prepare("UPDATE inv_bom_lines SET received_quantity = ?, damaged_quantity = ?, missing_quantity = ?, packing_slip_url = ?, received_at = NOW(), is_received = ?, destination_type = ?, destination_team_season_id = ?, receiving_budget_category_id = ? WHERE id = ?")
                ->execute([$total, $d['damaged_quantity'] ?? null, $d['missing_quantity'] ?? null, $d['packing_slip_url'] ?? null, (int)$isReceived,
                    $a['destination_type'] ?? 'inventory', isset($a['destination_team_season_id']) ? (int)$a['destination_team_season_id'] : null,
                    isset($a['receiving_budget_category_id']) ? (int)$a['receiving_budget_category_id'] : null, (int)$line['id']]);
        } else {
            $pdo->prepare("UPDATE inv_bom_lines SET received_quantity = ?, damaged_quantity = ?, missing_quantity = ?, packing_slip_url = ?, received_at = NOW(), is_received = ?, destination_type = 'split', destination_team_season_id = NULL, receiving_budget_category_id = NULL WHERE id = ?")
                ->execute([$total, $d['damaged_quantity'] ?? null, $d['missing_quantity'] ?? null, $d['packing_slip_url'] ?? null, (int)$isReceived, (int)$line['id']]);
        }
        $unit = self::unitCost($line['actual_purchase_price'] !== null ? $line['actual_purchase_price'] : $line['expected_price'], $line['package_quantity']);
        $bomCat = null;
        if ($line['bom_id']) { $bs = $pdo->prepare("SELECT budget_category_id FROM inv_boms WHERE id = ?"); $bs->execute([(int)$line['bom_id']]); $bb = $bs->fetch(); $bomCat = $bb && $bb['budget_category_id'] !== null ? (int)$bb['budget_category_id'] : null; }
        foreach ($allocs as $a) {
            $destType = $a['destination_type'] ?? 'inventory';
            $destTeam = isset($a['destination_team_season_id']) ? (int)$a['destination_team_season_id'] : null;
            $locId = isset($a['location_id']) ? (int)$a['location_id'] : null;
            // Stock this allocation — exploding the kit into its parts if applicable.
            $stocked = self::stockReceipt($pdo, $line, (float)$a['quantity'], $destType, $destTeam, $locId);
            $allocCat = (isset($a['receiving_budget_category_id']) ? (int)$a['receiving_budget_category_id'] : null)
                ?? ($line['budget_category_id'] !== null ? (int)$line['budget_category_id'] : null) ?? $bomCat;
            if ($allocCat && $unit !== null) {
                $pdo->prepare("UPDATE inv_budget_categories SET actual_amount = COALESCE(actual_amount,0) + ?, updated_at = NOW() WHERE id = ?")->execute([(float)$a['quantity'] * $unit, $allocCat]);
            }
            $dest = $destType === 'team' ? self::teamLabel($pdo, $destTeam) : 'inventory';
            foreach ($stocked as $st) {
                $reason = "Received against BOM #{$line['bom_id']} → $dest" . ($st['label'] ? " (kit part: {$st['label']})" : "");
                $pdo->prepare("INSERT INTO inv_movements (item_id, movement_type, quantity, to_team_season_id, to_location_id, actor_id, reason, notes, created_at) VALUES (?, 'receive', ?, ?, ?, ?, ?, ?, NOW())")
                    ->execute([$st['item_id'], $st['quantity'], $destTeam, $locId, (int)$cur['id'], $reason, $d['notes'] ?? null]);
            }
        }
        $bomStatus = self::recomputeStatuses($pdo, (int)$line['bom_id']);
        $line = self::loadLine($pdo, (int)$line['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_bom_lines', (int)$line['id'], 'receive', null, ['received' => self::f($total), 'allocations' => count($allocs)]);
        return Http::json($res, ['ok' => true, 'line_id' => (int)$line['id'], 'is_received' => (bool)$line['is_received'], 'received_total' => self::f($total), 'bom_status' => $bomStatus]);
    }

    public static function receiveAll(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.receive', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['po_id'];
        if (!self::loadPo($pdo, $id)) return Http::error($res, 'Purchase order not found', 404);
        $received = 0; $touched = [];
        foreach (self::poBoms($pdo, $id) as $b) {
            $bomCat = $b['budget_category_id'] !== null ? (int)$b['budget_category_id'] : null;
            foreach (self::bomLines($pdo, (int)$b['id']) as $l) {
                if ($l['is_received']) continue;
                $need = (float)($l['quantity_required'] ?? 0); $pk = (float)($l['package_quantity'] ?? 0);
                $base = ($pk > 0 && $need > 0) ? ceil($need / $pk) * $pk : $need;
                $qty = $l['ordered_quantity'] !== null ? (float)$l['ordered_quantity'] : $base;
                if ($qty <= 0) continue;
                self::applyReceipt($pdo, $l, $qty, (int)$cur['id'], null, null, 'inventory', null, $bomCat, null, 'Received via Receive All', null);
                $received++; $touched[(int)$b['id']] = true;
            }
        }
        foreach (array_keys($touched) as $bid) self::recomputeStatuses($pdo, $bid);
        Audit::write($pdo, (int)$cur['id'], 'inv_purchase_orders', $id, 'receive_all', null, ['lines_received' => $received]);
        return Http::json($res, ['ok' => true, 'lines_received' => $received]);
    }

    public static function quickbooksExport(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.po', 'read')) return Http::error($res, 'Access denied', 403);
        $po = self::loadPo($pdo, (int)$route['po_id']);
        if (!$po) return Http::error($res, 'Purchase order not found', 404);
        $vendor = $po['vendor_name'] ?? '';
        $billDate = $po['order_date'] ?: date('Y-m-d');
        $rows = [["Bill No", "Vendor", "Bill Date", "Team", "Category", "Item Description", "Qty", "Unit Price", "Amount", "Payment Method"]];
        foreach (self::poBoms($pdo, (int)$po['id']) as $b) {
            $team = ($b['team_number'] ?? null) !== null ? '#' . $b['team_number'] : '';
            $cat = '';
            if ($b['budget_category_id']) { $cs = $pdo->prepare("SELECT name FROM inv_budget_categories WHERE id = ?"); $cs->execute([(int)$b['budget_category_id']]); $c = $cs->fetch(); $cat = $c ? $c['name'] : ''; }
            foreach (self::bomLines($pdo, (int)$b['id']) as $l) {
                if ($l['ordered_quantity'] !== null) $units = (float)$l['ordered_quantity'];
                else { $pk0 = (float)($l['package_quantity'] ?? 0); $need = (float)($l['quantity_required'] ?? 0); $units = ($pk0 > 0 && $need > 0) ? ceil($need / $pk0) * $pk0 : $need; }
                $pk = (float)($l['package_quantity'] ?? 0);
                $pkgs = ($pk > 0 && $units > 0) ? ceil($units / $pk) : $units;
                $unit = $l['actual_purchase_price'] !== null ? $l['actual_purchase_price'] : $l['expected_price'];
                $amount = $unit !== null ? round((float)$pkgs * (float)$unit, 2) : '';
                $rows[] = [$po['po_number'], $vendor, $billDate, $team, $cat, $l['description'] ?: ($l['part_number'] ?: ''),
                    self::f($pkgs), $unit !== null ? self::f($unit) : '', $amount, $po['payment_method'] ?: ''];
            }
        }
        // Match Python csv.writer: QUOTE_MINIMAL + \r\n line terminator.
        $field = function ($v): string {
            $s = (string)$v;
            return preg_match('/[",\r\n]/', $s) ? '"' . str_replace('"', '""', $s) . '"' : $s;
        };
        $csv = '';
        foreach ($rows as $r) $csv .= implode(',', array_map($field, $r)) . "\r\n";
        $filename = ($po['po_number'] ?: 'purchase-order') . '-quickbooks.csv';
        $res->getBody()->write($csv);
        return $res->withHeader('Content-Type', 'text/csv')->withHeader('Content-Disposition', "attachment; filename=$filename");
    }
}
