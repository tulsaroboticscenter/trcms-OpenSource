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
 * Wish List (Release 3.6). Things TRC or a team would like to acquire — with an
 * external vendor link, price, and priority. An item can be fulfilled by a donation
 * (donor = member / sponsor / free-form name); if the item is an asset it can spawn
 * an inventory asset that carries the donation for the life of the asset.
 */
final class WishListController
{
    private const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
    private const MANAGE_ROLES = ['Mentor', 'Admin', 'System Administrator', 'Executive Director', 'Team Leader'];

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::hasAnyRole($pdo, $m, self::MANAGE_ROLES);
    }

    private static function serialize(array $r): array
    {
        $donor = !empty($r['donor_member_name']) ? $r['donor_member_name']
            : (!empty($r['donor_sponsor_name']) ? $r['donor_sponsor_name']
            : (!empty($r['donor_name']) ? $r['donor_name'] : null));
        return [
            'id' => (int)$r['id'], 'scope' => $r['scope'],
            'team_season_id' => $r['team_season_id'] !== null ? (int)$r['team_season_id'] : null,
            'team_label' => !empty($r['team_number']) ? ('Team ' . $r['team_number'] . ($r['season'] ? ' · ' . $r['season'] : '')) : null,
            'name' => $r['name'], 'description' => $r['description'], 'url' => $r['url'],
            'price' => $r['price'] !== null ? (float)$r['price'] : null,
            'quantity' => (int)$r['quantity'], 'priority' => $r['priority'],
            'is_asset' => (bool)$r['is_asset'], 'status' => $r['status'],
            'fulfilled_qty' => (int)($r['fulfilled_qty'] ?? 0),
            'remaining_qty' => max(0, (int)$r['quantity'] - (int)($r['fulfilled_qty'] ?? 0)),
            'donation_count' => (int)($r['donation_count'] ?? 0),
            'needs_thanks' => (int)($r['unthanked_count'] ?? 0) > 0,
            'fulfilled_date' => $r['fulfilled_date'],
            'fulfilled_amount' => $r['fulfilled_amount'] !== null ? (float)$r['fulfilled_amount'] : null,
            'donor_member_id' => $r['donor_member_id'] !== null ? (int)$r['donor_member_id'] : null,
            'donor_sponsor_id' => $r['donor_sponsor_id'] !== null ? (int)$r['donor_sponsor_id'] : null,
            'donor_name' => $r['donor_name'], 'donor_display' => $donor,
            'fulfilled_notes' => $r['fulfilled_notes'],
            'linked_inv_item_id' => $r['linked_inv_item_id'] !== null ? (int)$r['linked_inv_item_id'] : null,
            'linked_asset_name' => $r['linked_asset_name'] ?? null,
            'linked_asset_tag' => $r['linked_asset_tag'] ?? null,
            'requested_by_id' => $r['requested_by_id'] !== null ? (int)$r['requested_by_id'] : null,
            'requested_by_name' => !empty($r['requested_by_name']) ? $r['requested_by_name'] : null,
        ];
    }

    private static function baseSelect(): string
    {
        return "SELECT w.*,
                       TRIM(CONCAT(COALESCE(dm.first_name,''),' ',COALESCE(dm.last_name,''))) AS donor_member_name,
                       ds.name AS donor_sponsor_name,
                       TRIM(CONCAT(COALESCE(rq.first_name,''),' ',COALESCE(rq.last_name,''))) AS requested_by_name,
                       ii.name AS linked_asset_name, ii.asset_tag AS linked_asset_tag,
                       t.team_number, ts.season,
                       (SELECT COALESCE(SUM(f.quantity),0) FROM wish_list_fulfillments f WHERE f.wish_id=w.id) AS fulfilled_qty,
                       (SELECT COUNT(*) FROM wish_list_fulfillments f WHERE f.wish_id=w.id) AS donation_count,
                       (SELECT COUNT(*) FROM wish_list_fulfillments f WHERE f.wish_id=w.id AND f.thanked=0) AS unthanked_count
                FROM wish_list_items w
                LEFT JOIN members dm ON dm.id = w.donor_member_id
                LEFT JOIN sponsors ds ON ds.id = w.donor_sponsor_id
                LEFT JOIN members rq ON rq.id = w.requested_by_id
                LEFT JOIN inv_items ii ON ii.id = w.linked_inv_item_id
                LEFT JOIN team_seasons ts ON ts.id = w.team_season_id
                LEFT JOIN teams t ON t.id = ts.team_id";
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare(self::baseSelect() . " WHERE w.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /** GET /wishlist?scope=&team_season_id=&status= */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $where = ['1=1']; $args = [];
        if (!empty($q['scope'])) { $where[] = 'w.scope = ?'; $args[] = $q['scope']; }
        if (!empty($q['team_season_id'])) { $where[] = 'w.team_season_id = ?'; $args[] = (int)$q['team_season_id']; }
        if (!empty($q['status'])) { $where[] = 'w.status = ?'; $args[] = $q['status']; }
        $st = $pdo->prepare(self::baseSelect() . " WHERE " . implode(' AND ', $where) .
            " ORDER BY FIELD(w.status,'open','fulfilled','archived'),
                       FIELD(w.priority,'urgent','high','normal','low'), w.created_at DESC");
        $st->execute($args);
        return Http::json($res, array_map([self::class, 'serialize'], $st->fetchAll()));
    }

    private static function writeFields(array $d): array
    {
        $out = [];
        if (array_key_exists('name', $d)) $out['name'] = trim((string)$d['name']);
        if (array_key_exists('description', $d)) $out['description'] = $d['description'] ?: null;
        if (array_key_exists('url', $d)) $out['url'] = $d['url'] ?: null;
        if (array_key_exists('price', $d)) $out['price'] = ($d['price'] === '' || $d['price'] === null) ? null : (float)$d['price'];
        if (array_key_exists('quantity', $d)) $out['quantity'] = max(1, (int)$d['quantity']);
        if (array_key_exists('priority', $d) && in_array($d['priority'], self::PRIORITIES, true)) $out['priority'] = $d['priority'];
        if (array_key_exists('is_asset', $d)) $out['is_asset'] = (int)(bool)$d['is_asset'];
        if (array_key_exists('scope', $d) && in_array($d['scope'], ['trc', 'team'], true)) $out['scope'] = $d['scope'];
        if (array_key_exists('team_season_id', $d)) $out['team_season_id'] = $d['team_season_id'] ? (int)$d['team_season_id'] : null;
        return $out;
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $f = self::writeFields($d);
        if (empty($f['name'])) return Http::error($res, 'A name is required.', 422);
        if (($f['scope'] ?? 'trc') === 'team' && empty($f['team_season_id'])) return Http::error($res, 'Pick a team for a team wish.', 422);
        if (($f['scope'] ?? 'trc') === 'trc') $f['team_season_id'] = null;
        $f['requested_by_id'] = (int)$m['id'];
        $f['created_by_id'] = (int)$m['id'];
        $cols = array_keys($f); $ph = implode(',', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO wish_list_items (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())")
            ->execute(array_values($f));
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'wish_list_items', $id, 'create', null, ['name' => $f['name']]);
        return Http::json($res, self::serialize(self::load($pdo, $id)), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['wish_id'];
        if (!self::load($pdo, $id)) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();
        $f = self::writeFields($d);
        if (array_key_exists('status', $d) && in_array($d['status'], ['open', 'fulfilled', 'archived'], true)) $f['status'] = $d['status'];
        if (!$f) return Http::error($res, 'Nothing to update.', 422);
        $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
        $args = array_values($f); $args[] = $id;
        $pdo->prepare("UPDATE wish_list_items SET $set, updated_at = NOW() WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'wish_list_items', $id, 'update', null, null);
        return Http::json($res, self::serialize(self::load($pdo, $id)));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM wish_list_items WHERE id = ?")->execute([(int)$route['wish_id']]);
        Audit::write($pdo, (int)$m['id'], 'wish_list_items', (int)$route['wish_id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /wishlist/{id}/fulfill — record a donation that covers the item. Body:
     * donor_member_id | donor_sponsor_id | donor_name, amount, date, notes,
     * create_asset (bool), asset_type. If the wish is an asset and create_asset is
     * set, spawn an inventory asset carrying the donation and link it.
     */
    public static function fulfill(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['wish_id'];
        $w = self::load($pdo, $id);
        if (!$w) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();

        $donorMember = !empty($d['donor_member_id']) ? (int)$d['donor_member_id'] : null;
        $donorSponsor = !empty($d['donor_sponsor_id']) ? (int)$d['donor_sponsor_id'] : null;
        $donorName = trim((string)($d['donor_name'] ?? '')) ?: null;
        $date = $d['date'] ?? null;
        $amount = (($d['amount'] ?? '') === '') ? null : (float)$d['amount'];
        $notes = $d['notes'] ?? null;
        // How many units this donation covers (partial fulfillment). Default to the
        // remaining need; never exceed it, always at least 1.
        $fulfilledSoFar = (int)($pdo->query("SELECT COALESCE(SUM(quantity),0) FROM wish_list_fulfillments WHERE wish_id=" . (int)$id)->fetchColumn());
        $remaining = (int)$w['quantity'] - $fulfilledSoFar;
        if ($remaining <= 0) return Http::error($res, 'This wish item is already fully fulfilled.', 400);
        $qty = isset($d['quantity']) && (int)$d['quantity'] > 0 ? (int)$d['quantity'] : $remaining;
        $qty = max(1, min($qty, $remaining));
        $thanked = !empty($d['thanked']) ? 1 : 0;

        $linkedInvId = $w['linked_inv_item_id'] !== null ? (int)$w['linked_inv_item_id'] : null;
        // Spawn an inventory asset that carries the donation, when asked and applicable.
        if (!empty($d['create_asset']) && (int)$w['is_asset'] === 1 && $linkedInvId === null) {
            $assetType = in_array($d['asset_type'] ?? '', ['asset_tagged', 'asset_nontagged'], true) ? $d['asset_type'] : 'asset_tagged';
            $tag = $assetType === 'asset_tagged' ? self::nextAssetTagFor($pdo) : null;
            $pdo->prepare(
                "INSERT INTO inv_items (item_type, name, url, cost, status, asset_tag, is_donated, donor_member_id, donor_sponsor_id, donor_name, donation_date, notes, created_at, updated_at)
                 VALUES (?,?,?,?, 'active', ?, 1, ?, ?, ?, ?, ?, NOW(), NOW())"
            )->execute([$assetType, $w['name'], $w['url'], $w['price'], $tag, $donorMember, $donorSponsor, $donorName, $date,
                'Fulfilled from wish list.']);
            $linkedInvId = (int)$pdo->lastInsertId();
        }

        // Record this donation. An item can accumulate several (partial fulfillment).
        $pdo->prepare(
            "INSERT INTO wish_list_fulfillments
               (wish_id, quantity, amount, donor_member_id, donor_sponsor_id, donor_name, fulfilled_date, notes,
                thanked, thanked_date, thanked_by_id, linked_inv_item_id, created_by_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, NOW(), NOW())"
        )->execute([$id, $qty, $amount, $donorMember, $donorSponsor, $donorName, $date, $notes,
            $thanked, $thanked ? ($date ?: date('Y-m-d')) : null, $thanked ? (int)$m['id'] : null,
            $linkedInvId, (int)$m['id']]);
        $donationId = (int)$pdo->lastInsertId();
        self::recomputeStatus($pdo, $id);
        Audit::write($pdo, (int)$m['id'], 'wish_list_fulfillments', $donationId, 'create', null, ['wish_id' => $id, 'quantity' => $qty, 'asset_id' => $linkedInvId]);
        return Http::json($res, self::serialize(self::load($pdo, $id)));
    }

    /**
     * Recompute an item's status + summary fields from its donations: fulfilled once
     * the donated quantity reaches the requested quantity; otherwise open. Summary
     * amount/date roll up all donations; the single-donor fields are only set when
     * there's exactly one donation (else the frontend shows the per-donation list).
     */
    private static function recomputeStatus(PDO $pdo, int $wishId): void
    {
        $item = $pdo->prepare("SELECT quantity, status FROM wish_list_items WHERE id = ?");
        $item->execute([$wishId]); $it = $item->fetch();
        if (!$it || $it['status'] === 'archived') return;
        $agg = $pdo->prepare("SELECT COUNT(*) c, COALESCE(SUM(quantity),0) q, COALESCE(SUM(amount),0) amt, MAX(fulfilled_date) d FROM wish_list_fulfillments WHERE wish_id = ?");
        $agg->execute([$wishId]); $a = $agg->fetch();
        $status = ((int)$a['q'] > 0 && (int)$a['q'] >= (int)$it['quantity']) ? 'fulfilled' : 'open';
        if ((int)$a['c'] === 1) {
            $one = $pdo->prepare("SELECT * FROM wish_list_fulfillments WHERE wish_id = ? LIMIT 1"); $one->execute([$wishId]); $f = $one->fetch();
            $pdo->prepare("UPDATE wish_list_items SET status=?, fulfilled_amount=?, fulfilled_date=?, donor_member_id=?, donor_sponsor_id=?, donor_name=?, fulfilled_notes=?, linked_inv_item_id=COALESCE(?, linked_inv_item_id), updated_at=NOW() WHERE id=?")
                ->execute([$status, $f['amount'], $f['fulfilled_date'], $f['donor_member_id'], $f['donor_sponsor_id'], $f['donor_name'], $f['notes'], $f['linked_inv_item_id'], $wishId]);
        } else {
            // Multiple (or zero) donations: roll up totals, clear the single-donor fields.
            $pdo->prepare("UPDATE wish_list_items SET status=?, fulfilled_amount=?, fulfilled_date=?, donor_member_id=NULL, donor_sponsor_id=NULL, donor_name=NULL, updated_at=NOW() WHERE id=?")
                ->execute([$status, (int)$a['c'] ? $a['amt'] : null, $a['d'], $wishId]);
        }
    }

    /** GET /wishlist/{wish_id}/donations — the donations recorded against an item. */
    public static function donations(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        // Security #13: the donor list carries donor names/amounts (PII) — restrict to wishlist
        // managers, the same audience that records fulfillments. Was readable by any member.
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['wish_id'];
        $s = $pdo->prepare(
            "SELECT f.*, TRIM(CONCAT(COALESCE(dm.first_name,''),' ',COALESCE(dm.last_name,''))) AS donor_member_name,
                    ds.name AS donor_sponsor_name,
                    TRIM(CONCAT(COALESCE(tb.first_name,''),' ',COALESCE(tb.last_name,''))) AS thanked_by_name
               FROM wish_list_fulfillments f
               LEFT JOIN members dm ON dm.id = f.donor_member_id
               LEFT JOIN sponsors ds ON ds.id = f.donor_sponsor_id
               LEFT JOIN members tb ON tb.id = f.thanked_by_id
              WHERE f.wish_id = ? ORDER BY f.fulfilled_date DESC, f.id DESC"
        );
        $s->execute([$id]);
        $out = array_map(fn($f) => [
            'id' => (int)$f['id'], 'wish_id' => (int)$f['wish_id'], 'quantity' => (int)$f['quantity'],
            'amount' => $f['amount'] !== null ? (float)$f['amount'] : null,
            'donor_display' => !empty($f['donor_member_name']) ? $f['donor_member_name'] : (!empty($f['donor_sponsor_name']) ? $f['donor_sponsor_name'] : $f['donor_name']),
            'donor_member_id' => $f['donor_member_id'] !== null ? (int)$f['donor_member_id'] : null,
            'donor_sponsor_id' => $f['donor_sponsor_id'] !== null ? (int)$f['donor_sponsor_id'] : null,
            'fulfilled_date' => $f['fulfilled_date'], 'notes' => $f['notes'],
            'thanked' => (bool)$f['thanked'], 'thanked_date' => $f['thanked_date'],
            'thanked_by_name' => !empty($f['thanked_by_name']) ? $f['thanked_by_name'] : null,
        ], $s->fetchAll());
        return Http::json($res, $out);
    }

    /** PATCH /wishlist/donations/{donation_id} — edit a donation / toggle thanked. */
    public static function updateDonation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $did = (int)$route['donation_id'];
        $row = $pdo->prepare("SELECT * FROM wish_list_fulfillments WHERE id = ?"); $row->execute([$did]); $f = $row->fetch();
        if (!$f) return Http::error($res, 'Donation not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('thanked', $d)) {
            $th = !empty($d['thanked']) ? 1 : 0;
            $set[] = 'thanked = ?'; $args[] = $th;
            $set[] = 'thanked_date = ?'; $args[] = $th ? date('Y-m-d') : null;
            $set[] = 'thanked_by_id = ?'; $args[] = $th ? (int)$m['id'] : null;
        }
        foreach (['quantity', 'amount', 'donor_name', 'fulfilled_date', 'notes'] as $k) {
            if (array_key_exists($k, $d)) { $set[] = "$k = ?"; $args[] = ($d[$k] === '' ? null : $d[$k]); }
        }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $did; $pdo->prepare("UPDATE wish_list_fulfillments SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        self::recomputeStatus($pdo, (int)$f['wish_id']);
        Audit::write($pdo, (int)$m['id'], 'wish_list_fulfillments', $did, 'update', null, $d);
        return Http::json($res, self::serialize(self::load($pdo, (int)$f['wish_id'])));
    }

    /** DELETE /wishlist/donations/{donation_id} — remove a donation, recompute status. */
    public static function deleteDonation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $did = (int)$route['donation_id'];
        $row = $pdo->prepare("SELECT wish_id FROM wish_list_fulfillments WHERE id = ?"); $row->execute([$did]); $f = $row->fetch();
        if (!$f) return Http::error($res, 'Donation not found', 404);
        $pdo->prepare("DELETE FROM wish_list_fulfillments WHERE id = ?")->execute([$did]);
        self::recomputeStatus($pdo, (int)$f['wish_id']);
        Audit::write($pdo, (int)$m['id'], 'wish_list_fulfillments', $did, 'delete', null, ['wish_id' => (int)$f['wish_id']]);
        return Http::json($res, self::serialize(self::load($pdo, (int)$f['wish_id'])));
    }

    /** Next TRC-##### asset tag (mirrors InventoryController::nextAssetTag). */
    private static function nextAssetTagFor(PDO $pdo): string
    {
        $rows = $pdo->query("SELECT asset_tag FROM inv_items WHERE asset_tag LIKE 'TRC-%'")->fetchAll(PDO::FETCH_COLUMN);
        $nxt = 1;
        foreach ($rows as $tag) {
            $n = (int)(explode('-', (string)$tag, 2)[1] ?? '');
            if ($n >= $nxt) $nxt = $n + 1;
        }
        return 'TRC-' . str_pad((string)$nxt, 5, '0', STR_PAD_LEFT);
    }
}
