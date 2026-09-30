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
 * "What are you bringing" / potluck sign-up (migration 0207). Opt-in per event: an
 * organizer (Mentor+) turns it on and lists the items they need with a quantity
 * (Side Dishes x5, Desserts x4, …); any signed-in member signs up for what — and how
 * many — they'll bring, or adds an "Other" item. Structurally mirrors the event
 * signup-slots feature (EventSignupsController).
 */
final class EventBringController
{
    /** Organizer gate: only event managers (Mentor+) may toggle it or edit the item list. */
    private static function mgr(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::hasAnyRole($pdo, $m, ['Mentor']);
    }

    private static function name(array $r): string
    {
        return trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: ('Member #' . (int)$r['member_id']);
    }

    /** GET /events/{event_id}/bring — the requested items + who's bringing what. */
    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $meId = (int)$m['id'];

        $ev = $pdo->prepare("SELECT bring_enabled FROM events WHERE id = ?"); $ev->execute([$eid]);
        $evRow = $ev->fetch();
        if ($evRow === false) return Http::error($res, 'Event not found', 404);

        $its = $pdo->prepare("SELECT * FROM event_bring_items WHERE event_id = ? ORDER BY display_order, id");
        $its->execute([$eid]);
        $items = $its->fetchAll();

        // All sign-ups for this event, grouped by item (and NULL item = "Other").
        $sg = $pdo->prepare(
            "SELECT s.*, mm.first_name, mm.last_name
               FROM event_bring_signups s
               LEFT JOIN members mm ON mm.id = s.member_id
              WHERE s.event_id = ? ORDER BY s.created_at, s.id");
        $sg->execute([$eid]);
        $byItem = []; $other = [];
        foreach ($sg->fetchAll() as $r) {
            $row = [
                'id' => (int)$r['id'],
                'member_id' => $r['member_id'] !== null ? (int)$r['member_id'] : null,
                'name' => self::name($r),
                'qty' => (int)$r['qty'], 'note' => $r['note'],
                'is_me' => $r['member_id'] !== null && (int)$r['member_id'] === $meId,
            ];
            if ($r['bring_item_id'] !== null) {
                $byItem[(int)$r['bring_item_id']][] = $row;
            } else {
                $row['other_name'] = $r['other_name'];
                $other[] = $row;
            }
        }
        $itemsOut = array_map(function ($it) use ($byItem) {
            $sg = $byItem[(int)$it['id']] ?? [];
            $claimed = array_sum(array_map(fn($x) => (int)$x['qty'], $sg));
            return [
                'id' => (int)$it['id'], 'name' => $it['name'],
                'qty_needed' => (int)$it['qty_needed'], 'notes' => $it['notes'],
                'display_order' => (int)$it['display_order'],
                'claimed_qty' => $claimed,
                'remaining' => max(0, (int)$it['qty_needed'] - $claimed),
                'signups' => $sg,
            ];
        }, $items);

        return Http::json($res, [
            'event_id' => $eid,
            'bring_enabled' => (bool)$evRow['bring_enabled'],
            'can_manage' => self::mgr($pdo, $m),
            'items' => $itemsOut,
            'other_signups' => $other,
        ]);
    }

    /**
     * POST /events/{event_id}/bring — organizer saves the whole config: the on/off flag
     * and the full item list (reconciled — new items inserted, edited ones updated, and
     * removed ones deleted along with their sign-ups). Body: { enabled, items:[{id?, name,
     * qty_needed, notes}] }.
     */
    public static function saveConfig(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage this event.', 403);
        $eid = (int)$route['event_id'];
        $ev = $pdo->prepare("SELECT id FROM events WHERE id = ?"); $ev->execute([$eid]);
        if (!$ev->fetch()) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();

        $enabled = (int)!empty($d['enabled']);
        $pdo->prepare("UPDATE events SET bring_enabled = ? WHERE id = ?")->execute([$enabled, $eid]);

        $items = is_array($d['items'] ?? null) ? $d['items'] : [];
        $keepIds = [];
        $order = 0;
        foreach ($items as $it) {
            if (!is_array($it)) continue;
            $name = trim((string)($it['name'] ?? ''));
            if ($name === '') continue;   // skip blank rows
            $name = mb_substr($name, 0, 150);
            $qty = max(1, (int)($it['qty_needed'] ?? 1));
            $notes = trim((string)($it['notes'] ?? '')); $notes = $notes === '' ? null : mb_substr($notes, 0, 300);
            $id = isset($it['id']) && (int)$it['id'] > 0 ? (int)$it['id'] : 0;
            if ($id) {
                $pdo->prepare("UPDATE event_bring_items SET name = ?, qty_needed = ?, notes = ?, display_order = ? WHERE id = ? AND event_id = ?")
                    ->execute([$name, $qty, $notes, $order, $id, $eid]);
                $keepIds[] = $id;
            } else {
                $pdo->prepare("INSERT INTO event_bring_items (event_id, name, qty_needed, notes, display_order, created_at) VALUES (?,?,?,?,?,NOW())")
                    ->execute([$eid, $name, $qty, $notes, $order]);
                $keepIds[] = (int)$pdo->lastInsertId();
            }
            $order++;
        }
        // Delete items the organizer removed (their sign-ups cascade via FK).
        $del = "SELECT id FROM event_bring_items WHERE event_id = ?";
        $args = [$eid];
        if ($keepIds) { $del .= " AND id NOT IN (" . implode(',', array_fill(0, count($keepIds), '?')) . ")"; $args = array_merge($args, $keepIds); }
        $gone = $pdo->prepare($del); $gone->execute($args);
        foreach ($gone->fetchAll(PDO::FETCH_COLUMN) as $gid) {
            $pdo->prepare("DELETE FROM event_bring_items WHERE id = ?")->execute([(int)$gid]);
        }
        Audit::write($pdo, (int)$m['id'], 'events', $eid, 'bring_config', null, ['enabled' => $enabled, 'items' => count($keepIds)]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /**
     * POST /events/{event_id}/bring/signup — the current member signs up to bring an item
     * (bring_item_id) or an "Other" item (other_name). Signing up again for the same listed
     * item updates the quantity/note rather than duplicating.
     * Body: { bring_item_id?, other_name?, qty, note? }.
     */
    public static function signUp(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $qty = max(1, (int)($d['qty'] ?? 1));
        $note = trim((string)($d['note'] ?? '')); $note = $note === '' ? null : mb_substr($note, 0, 300);
        $itemId = isset($d['bring_item_id']) && (int)$d['bring_item_id'] > 0 ? (int)$d['bring_item_id'] : null;
        $otherName = trim((string)($d['other_name'] ?? ''));

        if ($itemId !== null) {
            $chk = $pdo->prepare("SELECT id FROM event_bring_items WHERE id = ? AND event_id = ?");
            $chk->execute([$itemId, $eid]);
            if (!$chk->fetch()) return Http::error($res, 'That item is not on this event.', 404);
            // Upsert this member's claim on a listed item (don't stack duplicate rows).
            $ex = $pdo->prepare("SELECT id FROM event_bring_signups WHERE event_id = ? AND bring_item_id = ? AND member_id = ?");
            $ex->execute([$eid, $itemId, (int)$m['id']]);
            if ($row = $ex->fetch()) {
                $pdo->prepare("UPDATE event_bring_signups SET qty = ?, note = ? WHERE id = ?")->execute([$qty, $note, (int)$row['id']]);
            } else {
                $pdo->prepare("INSERT INTO event_bring_signups (event_id, bring_item_id, member_id, qty, note, created_at) VALUES (?,?,?,?,?,NOW())")
                    ->execute([$eid, $itemId, (int)$m['id'], $qty, $note]);
            }
        } else {
            if ($otherName === '') return Http::error($res, 'Choose an item or name what you\'re bringing.', 422);
            $pdo->prepare("INSERT INTO event_bring_signups (event_id, bring_item_id, member_id, other_name, qty, note, created_at) VALUES (?,NULL,?,?,?,?,NOW())")
                ->execute([$eid, (int)$m['id'], mb_substr($otherName, 0, 150), $qty, $note]);
        }
        Audit::write($pdo, (int)$m['id'], 'event_bring_signups', (int)$pdo->lastInsertId(), 'bring_signup', null, ['event_id' => $eid, 'item_id' => $itemId]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /** DELETE /events/bring/signups/{signup_id} — remove a sign-up (own, or any as organizer). */
    public static function cancelSignup(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $sid = (int)$route['signup_id'];
        $s = $pdo->prepare("SELECT * FROM event_bring_signups WHERE id = ?"); $s->execute([$sid]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Sign-up not found', 404);
        $mine = $row['member_id'] !== null && (int)$row['member_id'] === (int)$m['id'];
        if (!$mine && !self::mgr($pdo, $m)) return Http::error($res, 'You can only remove your own sign-up.', 403);
        $pdo->prepare("DELETE FROM event_bring_signups WHERE id = ?")->execute([$sid]);
        Audit::write($pdo, (int)$m['id'], 'event_bring_signups', $sid, 'bring_cancel', null, ['event_id' => (int)$row['event_id']]);
        return self::list($req, $res, ['event_id' => (string)$row['event_id']]);
    }
}
