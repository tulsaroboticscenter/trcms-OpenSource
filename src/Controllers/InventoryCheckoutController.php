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

/** Port of app/modules/inventory/checkout_router.py (prefix /api/v1/inventory). */
final class InventoryCheckoutController
{
    private const QTY_TYPES = ['part', 'consumable'];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function f($v): ?float { return $v === null ? null : (float)$v; }

    private static function loadCheckout(PDO $pdo, int $id): ?array
    {
        $sql = "SELECT c.*, COALESCE(i.name, c.custom_item_name) AS item_name, i.asset_tag, i.item_type, i.current_quantity AS item_qty,
                       mem.first_name AS mem_first, mem.last_name AS mem_last,
                       t.team_number,
                       rb.first_name AS rb_first, rb.last_name AS rb_last,
                       ab.first_name AS ab_first, ab.last_name AS ab_last,
                       eb.first_name AS eb_first, eb.last_name AS eb_last
                FROM inv_checkouts c
                LEFT JOIN inv_items i ON i.id = c.item_id
                LEFT JOIN members mem ON mem.id = c.member_id
                LEFT JOIN team_seasons ts ON ts.id = c.team_season_id
                LEFT JOIN teams t ON t.id = ts.team_id
                LEFT JOIN members rb ON rb.id = c.requested_by_id
                LEFT JOIN members ab ON ab.id = c.approved_by_id
                LEFT JOIN members eb ON eb.id = c.extension_requested_by_id
                WHERE c.id = ?";
        $s = $pdo->prepare($sql); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function nm($f, $l): ?string
    {
        if ($f === null && $l === null) return null;
        return trim(($f ?? '') . ' ' . ($l ?? ''));
    }

    private static function serializeCheckout(array $c): array
    {
        $overdue = $c['status'] === 'out' && $c['expected_return_date'] && $c['expected_return_date'] < date('Y-m-d');
        $holder = null;
        if ($c['checkout_type'] === 'team' && ($c['team_number'] ?? null) !== null) $holder = 'Team #' . $c['team_number'];
        elseif (($c['mem_first'] ?? null) !== null || ($c['mem_last'] ?? null) !== null) $holder = self::nm($c['mem_first'] ?? null, $c['mem_last'] ?? null);
        return [
            'id' => (int)$c['id'], 'item_id' => $c['item_id'] !== null ? (int)$c['item_id'] : null,
            'item_name' => $c['item_name'] ?? null, 'is_custom_item' => $c['item_id'] === null,
            'asset_tag' => $c['asset_tag'] ?? null, 'checkout_type' => $c['checkout_type'], 'quantity' => self::f($c['quantity']),
            'status' => $c['status'], 'overdue' => $overdue, 'holder' => $holder,
            'member_id' => $c['member_id'] !== null ? (int)$c['member_id'] : null,
            'team_season_id' => $c['team_season_id'] !== null ? (int)$c['team_season_id'] : null,
            'event_id' => $c['event_id'] !== null ? (int)$c['event_id'] : null,
            'checkout_date' => Time::naiveIso($c['checkout_date']), 'expected_return_date' => $c['expected_return_date'],
            'returned_date' => Time::naiveIso($c['returned_date']),
            'condition_out' => $c['condition_out'], 'condition_in' => $c['condition_in'],
            'damage_report' => $c['damage_report'], 'notes' => $c['notes'],
            'requested_by' => self::nm($c['rb_first'] ?? null, $c['rb_last'] ?? null),
            'approved_by' => self::nm($c['ab_first'] ?? null, $c['ab_last'] ?? null),
            // A pending due-date extension request from the holder, awaiting an approver.
            'extension_pending' => !empty($c['extension_requested_date']),
            'extension_requested_date' => $c['extension_requested_date'] ?? null,
            'extension_requested_by' => self::nm($c['eb_first'] ?? null, $c['eb_last'] ?? null),
            'extension_requested_at' => isset($c['extension_requested_at']) ? Time::naiveIso($c['extension_requested_at']) : null,
            'extension_note' => $c['extension_note'] ?? null,
        ];
    }

    public static function listCheckouts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['status'])) { $where[] = "c.status = ?"; $args[] = $q['status']; }
        if (!empty($q['member_id'])) { $where[] = "c.member_id = ?"; $args[] = (int)$q['member_id']; }
        if (!empty($q['item_id'])) { $where[] = "c.item_id = ?"; $args[] = (int)$q['item_id']; }
        // The extension queue: checkouts with a pending due-date extension request.
        if (filter_var($q['extension_pending'] ?? false, FILTER_VALIDATE_BOOLEAN)) $where[] = "c.extension_requested_date IS NOT NULL";
        $sql = "SELECT id FROM inv_checkouts c" . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY c.created_at DESC";
        $s = $pdo->prepare($sql); $s->execute($args);
        $rows = array_map(fn($r) => self::serializeCheckout(self::loadCheckout($pdo, (int)$r['id'])), $s->fetchAll());
        if (filter_var($q['overdue'] ?? false, FILTER_VALIDATE_BOOLEAN)) $rows = array_values(array_filter($rows, fn($r) => $r['overdue']));
        return Http::json($res, $rows);
    }

    private static function applyStockOnOut(PDO $pdo, int $checkoutId, array $item, $quantity, ?int $approvedBy): void
    {
        if (in_array($item['item_type'], self::QTY_TYPES, true) && $quantity) {
            $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) - ?, updated_at = NOW() WHERE id = ?")
                ->execute([$quantity, (int)$item['id']]);
            $pdo->prepare("INSERT INTO inv_movements (item_id, movement_type, quantity, actor_id, reason, created_at) VALUES (?, 'checkout', ?, ?, ?, NOW())")
                ->execute([(int)$item['id'], $quantity, $approvedBy, "Checkout #$checkoutId"]);
        }
    }

    public static function createCheckout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.checkout', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        // An item is either an inventory record (item_id) or a free-text label
        // (custom_item_name) for things we assemble/borrow that aren't in inventory.
        $itemId = isset($d['item_id']) && (int)$d['item_id'] > 0 ? (int)$d['item_id'] : null;
        $customName = trim((string)($d['custom_item_name'] ?? $d['item_name'] ?? ''));
        $item = null;
        if ($itemId) {
            $is = $pdo->prepare("SELECT * FROM inv_items WHERE id = ?"); $is->execute([$itemId]);
            $item = $is->fetch();
            if (!$item) return Http::error($res, 'Item not found', 404);
            $customName = null; // an inventory item names itself
        } elseif ($customName === '') {
            return Http::error($res, 'Select an inventory item or enter an item name.', 422);
        }
        // Who it's checked out TO is required — a team for a team checkout, otherwise a member.
        // (A request with no holder is what left "checked out to" blank in the summary.)
        $checkoutType = $d['checkout_type'] ?? 'individual';
        if ($checkoutType === 'team') {
            if (empty($d['team_season_id'])) return Http::error($res, 'Choose the team this equipment is checked out to.', 422);
        } elseif (empty($d['member_id'])) {
            return Http::error($res, 'Choose who this equipment is checked out to.', 422);
        }
        $canApprove = self::perm($pdo, $cur, 'inventory.checkout_approve', 'write');
        $qty = array_key_exists('quantity', $d) ? $d['quantity'] : 1;
        $status = $canApprove ? 'out' : 'requested';
        $ins = $pdo->prepare("INSERT INTO inv_checkouts (item_id, custom_item_name, checkout_type, quantity, member_id, team_season_id, event_id, expected_return_date, condition_out, notes, status, requested_by_id, checkout_date, approved_by_id, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, " . ($canApprove ? 'NOW()' : 'NULL') . ", ?, NOW())");
        $ins->execute([
            $itemId, $customName ?: null, $checkoutType, $qty,
            isset($d['member_id']) ? (int)$d['member_id'] : null, isset($d['team_season_id']) ? (int)$d['team_season_id'] : null,
            isset($d['event_id']) ? (int)$d['event_id'] : null, $d['expected_return_date'] ?? null,
            $d['condition_out'] ?? null, $d['notes'] ?? null, $status, (int)$cur['id'], $canApprove ? (int)$cur['id'] : null,
        ]);
        $cid = (int)$pdo->lastInsertId();
        // Only inventory-backed checkouts touch stock; free-text items never do.
        if ($canApprove && $item) self::applyStockOnOut($pdo, $cid, $item, $qty, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $cid, 'create', null, ['item_id' => $itemId, 'custom_item_name' => $customName, 'status' => $status]);
        return Http::json($res, self::serializeCheckout(self::loadCheckout($pdo, $cid)), 201);
    }

    /**
     * PATCH /inventory/checkouts/{id} — edit a checkout record (approver/manager).
     * Corrects holder, dates (checkout + expected/actual return), condition, notes,
     * and a free-text item's label. Does NOT re-run stock adjustments — use the
     * approve/return actions for stock movement; this is for fixing the record.
     */
    public static function updateCheckout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.checkout_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['checkout_id'];
        $c = self::loadCheckout($pdo, $id);
        if (!$c) return Http::error($res, 'Checkout not found', 404);
        $d = (array)$req->getParsedBody();

        $set = []; $args = [];
        $str = ['checkout_type', 'condition_out', 'condition_in', 'notes', 'expected_return_date', 'checkout_date', 'returned_date'];
        foreach ($str as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($d[$f] === '' || $d[$f] === null) ? null : $d[$f]; }
        }
        foreach (['member_id', 'team_season_id', 'event_id'] as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = !empty($d[$f]) ? (int)$d[$f] : null; }
        }
        // Free-text label — only editable while the checkout isn't an inventory item.
        if (array_key_exists('custom_item_name', $d) && $c['item_id'] === null) {
            $name = trim((string)$d['custom_item_name']);
            if ($name === '') return Http::error($res, 'An item name is required.', 422);
            $set[] = "custom_item_name = ?"; $args[] = $name;
        }
        if (!$set) return Http::error($res, 'Nothing to update.', 422);
        $args[] = $id;
        $pdo->prepare("UPDATE inv_checkouts SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $id, 'update', null, $d);
        return Http::json($res, self::serializeCheckout(self::loadCheckout($pdo, $id)));
    }

    public static function approveCheckout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.checkout_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['checkout_id'];
        $c = self::loadCheckout($pdo, $id);
        if (!$c) return Http::error($res, 'Checkout not found', 404);
        if ($c['status'] !== 'requested') return Http::error($res, "Cannot approve a checkout that is '{$c['status']}'.", 400);
        $pdo->prepare("UPDATE inv_checkouts SET status = 'out', checkout_date = NOW(), approved_by_id = ? WHERE id = ?")->execute([(int)$cur['id'], $id]);
        $is = $pdo->prepare("SELECT * FROM inv_items WHERE id = ?"); $is->execute([(int)$c['item_id']]); $item = $is->fetch();
        if ($item) self::applyStockOnOut($pdo, $id, $item, $c['quantity'], (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $id, 'update', null, ['status' => 'out']);
        return Http::json($res, self::serializeCheckout(self::loadCheckout($pdo, $id)));
    }

    public static function returnCheckout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.checkout_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['checkout_id'];
        $c = self::loadCheckout($pdo, $id);
        if (!$c) return Http::error($res, 'Checkout not found', 404);
        if ($c['status'] !== 'out') return Http::error($res, 'Only an item that is out can be returned.', 400);
        $d = (array)$req->getParsedBody();
        $notesSet = !empty($d['notes']) ? ', notes = ?' : '';
        $args = [$d['condition_in'] ?? null, $d['damage_report'] ?? null];
        if ($notesSet) $args[] = $d['notes'];
        $args[] = $id;
        $pdo->prepare("UPDATE inv_checkouts SET status = 'returned', returned_date = NOW(), condition_in = ?, damage_report = ?$notesSet WHERE id = ?")->execute($args);
        if (($c['item_type'] ?? null) !== null && in_array($c['item_type'], self::QTY_TYPES, true) && $c['quantity']) {
            $pdo->prepare("UPDATE inv_items SET current_quantity = COALESCE(current_quantity,0) + ?, updated_at = NOW() WHERE id = ?")->execute([$c['quantity'], (int)$c['item_id']]);
            $pdo->prepare("INSERT INTO inv_movements (item_id, movement_type, quantity, actor_id, reason, created_at) VALUES (?, 'checkin_return', ?, ?, ?, NOW())")
                ->execute([(int)$c['item_id'], $c['quantity'], (int)$cur['id'], "Returned from checkout #$id"]);
        }
        Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $id, 'update', null, ['status' => 'returned', 'damage' => (bool)($d['damage_report'] ?? null)]);
        return Http::json($res, self::serializeCheckout(self::loadCheckout($pdo, $id)));
    }

    public static function cancelCheckout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.checkout', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['checkout_id'];
        $c = self::loadCheckout($pdo, $id);
        if (!$c) return Http::error($res, 'Checkout not found', 404);
        if ($c['status'] === 'out') return Http::error($res, 'An item that is out must be returned, not cancelled.', 400);
        $pdo->prepare("UPDATE inv_checkouts SET status = 'cancelled' WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Extension requests ────────────────────────────────────────────────

    /** Is this member the holder or original requester of the checkout? */
    private static function isHolder(array $c, int $memberId): bool
    {
        return ($c['member_id'] !== null && (int)$c['member_id'] === $memberId)
            || ($c['requested_by_id'] !== null && (int)$c['requested_by_id'] === $memberId);
    }

    /**
     * GET /inventory/my-checkouts — the equipment the signed-in member currently holds.
     * Their own checkouts that are still out, so they can see due dates and ask for an
     * extension. No inventory permission needed — it only ever returns the caller's own.
     */
    public static function myCheckouts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$m['id'];
        $s = $pdo->prepare(
            "SELECT id FROM inv_checkouts
              WHERE status = 'out' AND (member_id = ? OR requested_by_id = ?)
              ORDER BY expected_return_date IS NULL, expected_return_date, id DESC");
        $s->execute([$mid, $mid]);
        $rows = array_map(fn ($r) => self::serializeCheckout(self::loadCheckout($pdo, (int)$r['id'])), $s->fetchAll());
        return Http::json($res, $rows);
    }

    /**
     * POST /inventory/checkouts/{id}/request-extension — the holder asks to keep the
     * item longer. Body: { requested_date (YYYY-MM-DD), note? }.
     *
     * The holder or original requester may ask for their own checkout; inventory managers
     * may ask on anyone's behalf. Records a pending request that surfaces in the checkout
     * queue for an approver; it does NOT change the due date until approved.
     */
    public static function requestExtension(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['checkout_id'];
        $c = self::loadCheckout($pdo, $id);
        if (!$c) return Http::error($res, 'Checkout not found', 404);

        $mayAsk = self::isHolder($c, (int)$cur['id']) || self::perm($pdo, $cur, 'inventory.checkout', 'write');
        if (!$mayAsk) return Http::error($res, 'You can only request an extension on your own checked-out equipment.', 403);
        if ($c['status'] !== 'out') return Http::error($res, 'Only equipment that is currently out can be extended.', 422);

        $d = (array)$req->getParsedBody();
        $newDate = trim((string)($d['requested_date'] ?? ''));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $newDate)) return Http::error($res, 'Enter the new date you would like to keep it until.', 422);
        if ($newDate < date('Y-m-d')) return Http::error($res, 'The new date must be in the future.', 422);
        // It's an EXTENSION — must be later than the current due date (if one is set).
        if (!empty($c['expected_return_date']) && $newDate <= $c['expected_return_date']) {
            return Http::error($res, 'Pick a date later than the current due date of ' . $c['expected_return_date'] . '.', 422);
        }
        $note = trim((string)($d['note'] ?? ''));

        $pdo->prepare("UPDATE inv_checkouts SET extension_requested_date = ?, extension_requested_by_id = ?, extension_requested_at = NOW(), extension_note = ? WHERE id = ?")
            ->execute([$newDate, (int)$cur['id'], $note !== '' ? mb_substr($note, 0, 500) : null, $id]);
        Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $id, 'extension_requested', null,
            ['requested_date' => $newDate, 'note' => $note]);
        return Http::json($res, self::serializeCheckout(self::loadCheckout($pdo, $id)));
    }

    /**
     * POST /inventory/checkouts/{id}/extension/{decision} — an approver processes a
     * pending extension request. decision = 'approve' (move the due date to the requested
     * one) or 'deny' (keep the current due date). Either way the request is cleared.
     */
    public static function decideExtension(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.checkout_approve', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['checkout_id'];
        $decision = (string)$route['decision'];
        if (!in_array($decision, ['approve', 'deny'], true)) return Http::error($res, 'Unknown decision.', 400);

        $c = self::loadCheckout($pdo, $id);
        if (!$c) return Http::error($res, 'Checkout not found', 404);
        if (empty($c['extension_requested_date'])) return Http::error($res, 'There is no pending extension request on this checkout.', 422);

        if ($decision === 'approve') {
            $pdo->prepare("UPDATE inv_checkouts SET expected_return_date = extension_requested_date,
                            extension_requested_date = NULL, extension_requested_by_id = NULL,
                            extension_requested_at = NULL, extension_note = NULL WHERE id = ?")->execute([$id]);
            Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $id, 'extension_approved',
                ['expected_return_date' => $c['expected_return_date']],
                ['expected_return_date' => $c['extension_requested_date']]);
        } else {
            $pdo->prepare("UPDATE inv_checkouts SET extension_requested_date = NULL, extension_requested_by_id = NULL,
                            extension_requested_at = NULL, extension_note = NULL WHERE id = ?")->execute([$id]);
            Audit::write($pdo, (int)$cur['id'], 'inv_checkouts', $id, 'extension_denied', null,
                ['kept_due_date' => $c['expected_return_date'], 'requested_was' => $c['extension_requested_date']]);
        }
        return Http::json($res, self::serializeCheckout(self::loadCheckout($pdo, $id)));
    }

    // ── Battery testing ──────────────────────────────────────────────────
    public static function listBatteryTests(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'inventory.view', 'read')) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT bt.*, tb.first_name, tb.last_name FROM inv_battery_tests bt
                            LEFT JOIN members tb ON tb.id = bt.tested_by_id WHERE bt.item_id = ?
                            ORDER BY bt.test_date DESC, bt.id DESC");
        $s->execute([(int)$route['item_id']]);
        return Http::json($res, array_map(fn($t) => [
            'id' => (int)$t['id'], 'test_date' => $t['test_date'],
            'resistance_beak' => self::f($t['resistance_beak']), 'resistance_gobilda' => self::f($t['resistance_gobilda']),
            'result' => $t['result'], 'notes' => $t['notes'], 'tested_by' => self::nm($t['first_name'], $t['last_name']),
        ], $s->fetchAll()));
    }

    public static function addBatteryTest(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'inventory.battery', 'write')) return Http::error($res, 'Access denied', 403);
        $itemId = (int)$route['item_id'];
        $is = $pdo->prepare("SELECT * FROM inv_items WHERE id = ?"); $is->execute([$itemId]); $item = $is->fetch();
        if (!$item) return Http::error($res, 'Item not found', 404);
        $d = (array)$req->getParsedBody();
        $result = $d['result'] ?? '';
        if (!in_array($result, ['pass', 'marginal', 'fail'], true)) return Http::error($res, 'result must be pass, marginal, or fail', 400);
        $ins = $pdo->prepare("INSERT INTO inv_battery_tests (item_id, tested_by_id, test_date, resistance_beak, resistance_gobilda, result, notes, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
        $ins->execute([$itemId, (int)$cur['id'], $d['test_date'] ?? date('Y-m-d'), $d['resistance_beak'] ?? null,
            $d['resistance_gobilda'] ?? null, $result, $d['notes'] ?? null]);
        $tid = (int)$pdo->lastInsertId();
        $newStatus = $item['status'];
        if ($result === 'fail') $newStatus = 'failed';
        elseif (in_array($item['status'], [null, 'active', 'in_service'], true)) $newStatus = 'in_service';
        if ($newStatus !== $item['status']) $pdo->prepare("UPDATE inv_items SET status = ?, updated_at = NOW() WHERE id = ?")->execute([$newStatus, $itemId]);
        Audit::write($pdo, (int)$cur['id'], 'inv_battery_tests', $tid, 'create', null, ['item_id' => $itemId, 'result' => $result]);
        return Http::json($res, ['id' => $tid, 'result' => $result, 'item_status' => $newStatus], 201);
    }
}
