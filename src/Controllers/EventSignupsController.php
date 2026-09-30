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
 * #152 — SignupGenius-style coverage sign-ups on an event. An organizer (Mentor+)
 * defines slots (a coverage area and/or time window, each with a needed capacity);
 * any signed-in member can sign themselves up for the slots they can cover. Used
 * for big multi-area events (e.g. Maker Faire) where people are only free for
 * certain times/stations.
 */
final class EventSignupsController
{
    /** Organizer gate: only event managers (Mentor+) may edit slots / others' responses. */
    private static function mgr(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::hasAnyRole($pdo, $m, ['Mentor']);
    }

    private static function displayName(array $r): string
    {
        if ($r['member_id'] !== null) return trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: ('Member #' . $r['member_id']);
        return trim((string)($r['guest_name'] ?? '')) ?: 'Guest';
    }

    /** GET /events/{event_id}/signups — slots with their responses + fill state. */
    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $meId = (int)$m['id'];

        $slots = $pdo->prepare("SELECT * FROM event_signup_slots WHERE event_id = ? ORDER BY sort_order, slot_date, start_time, id");
        $slots->execute([$eid]);
        $slotRows = $slots->fetchAll();
        if (!$slotRows) {
            return Http::json($res, ['event_id' => $eid, 'can_manage' => self::mgr($pdo, $m), 'slots' => []]);
        }
        $ids = array_map(fn($s) => (int)$s['id'], $slotRows);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $resp = $pdo->prepare(
            "SELECT r.*, mm.first_name, mm.last_name
               FROM event_signup_responses r
               LEFT JOIN members mm ON mm.id = r.member_id
              WHERE r.slot_id IN ($in) ORDER BY r.created_at, r.id");
        $resp->execute($ids);
        $bySlot = [];
        foreach ($resp->fetchAll() as $r) {
            $bySlot[(int)$r['slot_id']][] = [
                'id' => (int)$r['id'], 'member_id' => $r['member_id'] !== null ? (int)$r['member_id'] : null,
                'name' => self::displayName($r), 'notes' => $r['notes'],
                'is_me' => $r['member_id'] !== null && (int)$r['member_id'] === $meId,
            ];
        }
        $out = array_map(function ($s) use ($bySlot, $meId) {
            $rs = $bySlot[(int)$s['id']] ?? [];
            $cap = (int)$s['capacity'];
            return [
                'id' => (int)$s['id'], 'area' => $s['area'], 'title' => $s['title'],
                'slot_date' => $s['slot_date'], 'start_time' => $s['start_time'] ? substr((string)$s['start_time'], 0, 5) : null,
                'end_time' => $s['end_time'] ? substr((string)$s['end_time'], 0, 5) : null,
                'capacity' => $cap, 'notes' => $s['notes'], 'sort_order' => (int)$s['sort_order'],
                'responses' => $rs, 'filled' => count($rs),
                'is_full' => $cap > 0 && count($rs) >= $cap,
                'me_signed_up' => (bool)array_filter($rs, fn($r) => $r['is_me']),
            ];
        }, $slotRows);
        return Http::json($res, ['event_id' => $eid, 'can_manage' => self::mgr($pdo, $m), 'slots' => $out]);
    }

    private static function timeOrNull($v): ?string
    {
        $v = trim((string)$v);
        return $v === '' ? null : $v;
    }

    /** POST /events/{event_id}/signups — organizer adds one slot. */
    public static function createSlot(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage sign-ups.', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $next = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),0)+1 FROM event_signup_slots WHERE event_id = " . $eid)->fetchColumn();
        $id = self::insertSlot($pdo, $eid, $d, $next);
        Audit::write($pdo, (int)$m['id'], 'event_signup_slots', $id, 'create', null, ['event_id' => $eid]);
        return self::list($req, $res, $route);
    }

    private static function insertSlot(PDO $pdo, int $eid, array $d, int $sort): int
    {
        $cap = array_key_exists('capacity', $d) && $d['capacity'] !== '' ? max(0, (int)$d['capacity']) : 1;
        $pdo->prepare(
            "INSERT INTO event_signup_slots (event_id, area, title, slot_date, start_time, end_time, capacity, notes, sort_order, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,NOW())"
        )->execute([
            $eid,
            ($d['area'] ?? '') === '' ? null : mb_substr((string)$d['area'], 0, 200),
            ($d['title'] ?? '') === '' ? null : mb_substr((string)$d['title'], 0, 200),
            ($d['slot_date'] ?? '') === '' ? null : $d['slot_date'],
            self::timeOrNull($d['start_time'] ?? ''), self::timeOrNull($d['end_time'] ?? ''),
            $cap, ($d['notes'] ?? '') === '' ? null : mb_substr((string)$d['notes'], 0, 400), $sort,
        ]);
        return (int)$pdo->lastInsertId();
    }

    /**
     * POST /events/{event_id}/signups/bulk — generate a grid of slots: for each area,
     * split [start,end) into fixed-length blocks, each with the given capacity.
     * Body: { areas:[], slot_date?, start_time, end_time, block_minutes, capacity }.
     */
    public static function bulkCreate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage sign-ups.', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $areas = array_values(array_filter(array_map(fn($a) => trim((string)$a), (array)($d['areas'] ?? [])), fn($a) => $a !== ''));
        if (!$areas) $areas = [null];   // time-only slots (no areas)
        $start = self::timeOrNull($d['start_time'] ?? '');
        $end = self::timeOrNull($d['end_time'] ?? '');
        $block = max(0, (int)($d['block_minutes'] ?? 0));
        $cap = array_key_exists('capacity', $d) && $d['capacity'] !== '' ? max(0, (int)$d['capacity']) : 1;
        $date = ($d['slot_date'] ?? '') === '' ? null : $d['slot_date'];

        // Build the time blocks (a single open block if no interval given).
        $blocks = [];
        if ($start && $end && $block > 0) {
            $s = strtotime($start); $e = strtotime($end);
            for ($t = $s; $t < $e; $t += $block * 60) {
                $bEnd = min($t + $block * 60, $e);
                $blocks[] = [date('H:i', $t), date('H:i', $bEnd)];
            }
        } else {
            $blocks[] = [$start, $end];
        }
        $sort = (int)$pdo->query("SELECT COALESCE(MAX(sort_order),0) FROM event_signup_slots WHERE event_id = " . $eid)->fetchColumn();
        $created = 0;
        foreach ($areas as $area) {
            foreach ($blocks as [$bs, $be]) {
                self::insertSlot($pdo, $eid, ['area' => $area, 'start_time' => $bs, 'end_time' => $be, 'capacity' => $cap, 'slot_date' => $date], ++$sort);
                $created++;
            }
        }
        Audit::write($pdo, (int)$m['id'], 'event_signup_slots', null, 'bulk_create', null, ['event_id' => $eid, 'created' => $created]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /** PATCH /events/signups/slots/{slot_id} — organizer edits a slot. */
    public static function updateSlot(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage sign-ups.', 403);
        $sid = (int)$route['slot_id'];
        $cur = $pdo->prepare("SELECT event_id FROM event_signup_slots WHERE id = ?"); $cur->execute([$sid]);
        $eid = $cur->fetchColumn();
        if ($eid === false) return Http::error($res, 'Slot not found', 404);
        $d = (array)$req->getParsedBody();
        $map = ['area' => 'area', 'title' => 'title', 'slot_date' => 'slot_date', 'start_time' => 'start_time', 'end_time' => 'end_time', 'capacity' => 'capacity', 'notes' => 'notes'];
        $set = []; $args = [];
        foreach ($map as $k => $col) {
            if (!array_key_exists($k, $d)) continue;
            if ($k === 'capacity') { $set[] = "$col = ?"; $args[] = max(0, (int)$d[$k]); }
            elseif (in_array($k, ['start_time', 'end_time'], true)) { $set[] = "$col = ?"; $args[] = self::timeOrNull($d[$k]); }
            else { $set[] = "$col = ?"; $args[] = ($d[$k] === '') ? null : $d[$k]; }
        }
        if ($set) { $args[] = $sid; $pdo->prepare("UPDATE event_signup_slots SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /** DELETE /events/signups/slots/{slot_id} — organizer removes a slot (+ its responses). */
    public static function deleteSlot(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage sign-ups.', 403);
        $sid = (int)$route['slot_id'];
        $cur = $pdo->prepare("SELECT event_id FROM event_signup_slots WHERE id = ?"); $cur->execute([$sid]);
        $eid = $cur->fetchColumn();
        if ($eid === false) return Http::error($res, 'Slot not found', 404);
        $pdo->prepare("DELETE FROM event_signup_slots WHERE id = ?")->execute([$sid]);
        Audit::write($pdo, (int)$m['id'], 'event_signup_slots', $sid, 'delete', null, ['event_id' => (int)$eid]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /**
     * POST /events/signups/slots/{slot_id}/signup — the current member signs up (or an
     * organizer adds a member/guest via member_id / guest_name). Rejects a full slot.
     */
    public static function signUp(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $sid = (int)$route['slot_id'];
        $slot = $pdo->prepare("SELECT * FROM event_signup_slots WHERE id = ?"); $slot->execute([$sid]);
        $s = $slot->fetch();
        if (!$s) return Http::error($res, 'Slot not found', 404);
        $eid = (int)$s['event_id'];
        $d = (array)$req->getParsedBody();

        $isMgr = self::mgr($pdo, $m);
        $guestName = trim((string)($d['guest_name'] ?? ''));
        // Non-managers can only sign up themselves; managers may add a member or guest.
        $memberId = (int)$m['id'];
        if ($isMgr && !empty($d['member_id'])) $memberId = (int)$d['member_id'];
        $asGuest = $isMgr && $guestName !== '' && empty($d['member_id']);

        $cap = (int)$s['capacity'];
        if ($cap > 0) {
            $filled = (int)$pdo->query("SELECT COUNT(*) FROM event_signup_responses WHERE slot_id = " . $sid)->fetchColumn();
            if ($filled >= $cap) return Http::error($res, 'That slot is already full.', 409);
        }
        if (!$asGuest) {
            $ex = $pdo->prepare("SELECT 1 FROM event_signup_responses WHERE slot_id = ? AND member_id = ?");
            $ex->execute([$sid, $memberId]);
            if ($ex->fetch()) return Http::error($res, 'Already signed up for this slot.', 409);
        }
        $pdo->prepare(
            "INSERT INTO event_signup_responses (slot_id, member_id, guest_name, notes, created_by_id, created_at)
             VALUES (?,?,?,?,?,NOW())"
        )->execute([$sid, $asGuest ? null : $memberId, $asGuest ? mb_substr($guestName, 0, 200) : null,
            ($d['notes'] ?? '') === '' ? null : mb_substr((string)$d['notes'], 0, 400), (int)$m['id']]);
        Audit::write($pdo, (int)$m['id'], 'event_signup_responses', (int)$pdo->lastInsertId(), 'signup', null, ['slot_id' => $sid, 'event_id' => $eid]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /**
     * DELETE /events/signups/responses/{response_id} — cancel a sign-up. A member may
     * remove their own; an organizer may remove anyone's.
     */
    public static function cancel(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $rid = (int)$route['response_id'];
        $r = $pdo->prepare(
            "SELECT r.*, s.event_id FROM event_signup_responses r JOIN event_signup_slots s ON s.id = r.slot_id WHERE r.id = ?");
        $r->execute([$rid]);
        $row = $r->fetch();
        if (!$row) return Http::error($res, 'Sign-up not found', 404);
        $mine = $row['member_id'] !== null && (int)$row['member_id'] === (int)$m['id'];
        if (!$mine && !self::mgr($pdo, $m)) return Http::error($res, 'You can only cancel your own sign-up.', 403);
        $pdo->prepare("DELETE FROM event_signup_responses WHERE id = ?")->execute([$rid]);
        Audit::write($pdo, (int)$m['id'], 'event_signup_responses', $rid, 'cancel', null, ['event_id' => (int)$row['event_id']]);
        return self::list($req, $res, ['event_id' => (string)$row['event_id']]);
    }
}
