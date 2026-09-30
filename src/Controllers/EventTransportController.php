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
 * Event transportation planning (migrations 0221–0223). Opt-in per event: an organizer (Mentor+)
 * turns it on for an off-site event, then each member answers TWO legs — a ride TO the event and a
 * ride BACK. Each leg is: have a ride / need a ride / can drive others (+ seats) / not sure. A
 * coordinator can then seat the members who need a ride into drivers offering seats, separately for
 * each leg. Parents/guardians may answer on behalf of a youth in their family.
 */
final class EventTransportController
{
    private const LEG_VALUES = ['have', 'need', 'drive', 'not_sure'];
    private const LEGS = ['to', 'back'];

    private static function mgr(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::hasAnyRole($pdo, $m, ['Mentor']);
    }

    private static function name(array $r): string
    {
        return trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) ?: ('Member #' . (int)$r['member_id']);
    }

    private static function legVal($v): ?string
    {
        $v = trim((string)$v);
        return in_array($v, self::LEG_VALUES, true) ? $v : null;
    }

    /** GET /events/{event_id}/transport — the question state, my answer, and (for managers) everyone's. */
    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $meId = (int)$m['id'];

        $ev = $pdo->prepare("SELECT transport_enabled FROM events WHERE id = ?"); $ev->execute([$eid]);
        $evRow = $ev->fetch();
        if ($evRow === false) return Http::error($res, 'Event not found', 404);
        $canManage = self::mgr($pdo, $m);

        $rs = $pdo->prepare(
            "SELECT r.*, mm.first_name, mm.last_name, ep.status AS rsvp_status
               FROM event_transport_responses r
               LEFT JOIN members mm ON mm.id = r.member_id
               LEFT JOIN event_participants ep ON ep.event_id = r.event_id AND ep.member_id = r.member_id
              WHERE r.event_id = ? ORDER BY mm.last_name, mm.first_name");
        $rs->execute([$eid]);
        $all = $rs->fetchAll();

        $summary = ['need_to' => 0, 'need_back' => 0, 'drive_to' => 0, 'drive_back' => 0,
                    'have_to' => 0, 'have_back' => 0, 'seats_to' => 0, 'seats_back' => 0];
        $mine = null; $rows = [];
        foreach ($all as $r) {
            $to = self::legVal($r['ride_to']); $back = self::legVal($r['ride_back']);
            if ($to === 'need') $summary['need_to']++;   if ($back === 'need') $summary['need_back']++;
            if ($to === 'have') $summary['have_to']++;   if ($back === 'have') $summary['have_back']++;
            if ($to === 'drive') { $summary['drive_to']++; $summary['seats_to'] += (int)($r['seats_available'] ?? 0); }
            if ($back === 'drive') { $summary['drive_back']++; $summary['seats_back'] += (int)($r['seats_available'] ?? 0); }
            $row = self::serializeRow($r, $meId);
            if ((int)$r['member_id'] === $meId) $mine = $row;
            $rows[] = $row;
        }

        // Youth in the caller's family (parents/guardians) with each one's current answer,
        // so a parent can set the plan for their youth right here.
        $myYouth = [];
        if (($m['member_type'] ?? '') !== 'youth') {
            $yq = $pdo->prepare(
                "SELECT DISTINCT y.id, y.first_name, y.last_name, r.ride_to, r.ride_back, r.seats_available, r.note
                   FROM family_members fa
                   JOIN family_members fy ON fy.family_id = fa.family_id
                   JOIN members y ON y.id = fy.member_id AND y.member_type = 'youth' AND y.is_active = 1
                   LEFT JOIN event_transport_responses r ON r.event_id = ? AND r.member_id = y.id
                  WHERE fa.member_id = ? ORDER BY y.first_name, y.last_name");
            $yq->execute([$eid, $meId]);
            foreach ($yq->fetchAll() as $y) {
                $myYouth[] = [
                    'member_id' => (int)$y['id'],
                    'name' => trim(($y['first_name'] ?? '') . ' ' . ($y['last_name'] ?? '')),
                    'ride_to' => self::legVal($y['ride_to']),
                    'ride_back' => self::legVal($y['ride_back']),
                    'seats_available' => $y['seats_available'] !== null ? (int)$y['seats_available'] : null,
                    'note' => $y['note'],
                ];
            }
        }

        // Everyone can see who's driving or needs a ride (either leg) so they can pair up;
        // managers see the full roster.
        $visible = fn($x) => in_array('drive', [$x['ride_to'], $x['ride_back']], true)
            || in_array('need', [$x['ride_to'], $x['ride_back']], true) || $x['is_me'];

        return Http::json($res, [
            'event_id' => $eid,
            'transport_enabled' => (bool)$evRow['transport_enabled'],
            'can_manage' => $canManage,
            'my_response' => $mine,
            'my_youth' => $myYouth,
            'summary' => $summary,
            'responses' => $canManage ? $rows : array_values(array_filter($rows, $visible)),
            // Per-leg vehicle-assignment plan (managers only).
            'plan' => $canManage ? [
                'to' => self::buildLegPlan($rows, 'to'),
                'back' => self::buildLegPlan($rows, 'back'),
            ] : null,
        ]);
    }

    private static function serializeRow(array $r, int $meId): array
    {
        return [
            'member_id' => (int)$r['member_id'], 'name' => self::name($r),
            'ride_to' => self::legVal($r['ride_to']), 'ride_back' => self::legVal($r['ride_back']),
            'seats_available' => $r['seats_available'] !== null ? (int)$r['seats_available'] : null,
            'assigned_driver_to_id' => $r['assigned_driver_to_id'] !== null ? (int)$r['assigned_driver_to_id'] : null,
            'assigned_driver_back_id' => $r['assigned_driver_back_id'] !== null ? (int)$r['assigned_driver_back_id'] : null,
            'rsvp_status' => $r['rsvp_status'] ?: null,
            'note' => $r['note'], 'is_me' => (int)$r['member_id'] === $meId,
        ];
    }

    /** For one leg ('to'|'back'): drivers with their assigned riders + open seats, unassigned riders, have-own-ride. */
    private static function buildLegPlan(array $rows, string $leg): array
    {
        $respKey = "ride_$leg";
        $assignKey = "assigned_driver_{$leg}_id";
        $drivers = [];
        foreach ($rows as $r) {
            if ($r[$respKey] === 'drive') {
                $drivers[$r['member_id']] = [
                    'member_id' => $r['member_id'], 'name' => $r['name'],
                    'seats' => $r['seats_available'], 'note' => $r['note'], 'riders' => [],
                ];
            }
        }
        $unassigned = [];
        foreach ($rows as $r) {
            if ($r[$respKey] !== 'need') continue;
            $rider = ['member_id' => $r['member_id'], 'name' => $r['name'], 'note' => $r['note'], 'rsvp_status' => $r['rsvp_status'] ?? null];
            $did = $r[$assignKey];
            if ($did !== null && isset($drivers[$did])) $drivers[$did]['riders'][] = $rider;
            else $unassigned[] = $rider;   // unassigned, or the driver is no longer offering this leg
        }
        foreach ($drivers as &$d) {
            $d['filled'] = count($d['riders']);
            $d['open_seats'] = $d['seats'] !== null ? max(0, (int)$d['seats'] - $d['filled']) : null;
        }
        unset($d);
        $haveRide = [];
        foreach ($rows as $r) {
            if ($r[$respKey] === 'have') {
                $haveRide[] = ['member_id' => $r['member_id'], 'name' => $r['name'], 'note' => $r['note'], 'rsvp_status' => $r['rsvp_status'] ?? null];
            }
        }
        return ['drivers' => array_values($drivers), 'unassigned_riders' => $unassigned, 'have_ride' => $haveRide];
    }

    /**
     * POST /events/{event_id}/transport/assign — a coordinator seats a rider in a driver's vehicle
     * for one leg (or unassigns). Body: { rider_member_id, driver_member_id|null, leg: 'to'|'back' }.
     */
    public static function assign(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage this event.', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $leg = in_array(($d['leg'] ?? ''), self::LEGS, true) ? (string)$d['leg'] : 'to';
        $respKey = "ride_$leg";
        $assignKey = "assigned_driver_{$leg}_id";
        $riderId = (int)($d['rider_member_id'] ?? 0);
        $driverId = isset($d['driver_member_id']) && $d['driver_member_id'] !== null && $d['driver_member_id'] !== ''
            ? (int)$d['driver_member_id'] : null;

        $rr = $pdo->prepare("SELECT $respKey AS leg_resp FROM event_transport_responses WHERE event_id = ? AND member_id = ?");
        $rr->execute([$eid, $riderId]);
        $riderResp = $rr->fetchColumn();
        if ($riderResp === false || $riderResp !== 'need') return Http::error($res, 'That member is not requesting a ride for this leg.', 422);

        if ($driverId !== null) {
            $dr = $pdo->prepare("SELECT $respKey AS leg_resp, seats_available FROM event_transport_responses WHERE event_id = ? AND member_id = ?");
            $dr->execute([$eid, $driverId]);
            $drv = $dr->fetch();
            if (!$drv || $drv['leg_resp'] !== 'drive') return Http::error($res, 'That driver is not offering to drive this leg.', 422);
            $seats = $drv['seats_available'] !== null ? (int)$drv['seats_available'] : null;
            if ($seats !== null) {
                $cnt = $pdo->prepare("SELECT COUNT(*) FROM event_transport_responses WHERE event_id = ? AND $assignKey = ? AND member_id <> ?");
                $cnt->execute([$eid, $driverId, $riderId]);
                if ((int)$cnt->fetchColumn() >= $seats) return Http::error($res, 'That driver\'s seats are already full for this leg.', 409);
            }
        }

        $pdo->prepare("UPDATE event_transport_responses SET $assignKey = ? WHERE event_id = ? AND member_id = ?")
            ->execute([$driverId, $eid, $riderId]);
        Audit::write($pdo, (int)$m['id'], 'event_transport_responses', $eid, 'transport_assign', null,
            ['rider' => $riderId, 'driver' => $driverId, 'leg' => $leg]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /** POST /events/{event_id}/transport/config — organizer turns the question on/off. Body: { enabled }. */
    public static function saveConfig(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::mgr($pdo, $m)) return Http::error($res, 'You do not have permission to manage this event.', 403);
        $eid = (int)$route['event_id'];
        $ev = $pdo->prepare("SELECT id FROM events WHERE id = ?"); $ev->execute([$eid]);
        if (!$ev->fetch()) return Http::error($res, 'Event not found', 404);
        $enabled = (int)!empty(((array)$req->getParsedBody())['enabled']);
        $pdo->prepare("UPDATE events SET transport_enabled = ? WHERE id = ?")->execute([$enabled, $eid]);
        Audit::write($pdo, (int)$m['id'], 'events', $eid, 'transport_config', null, ['enabled' => $enabled]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }

    /**
     * POST /events/{event_id}/transport/respond — set a transportation answer (both legs). By
     * default it's the current member's own; a parent/guardian may pass `member_id` to set it for a
     * youth in their family. Body: { ride_to?, ride_back?, seats_available?, note?, member_id? }.
     * When both legs are empty the answer is cleared.
     */
    public static function respond(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $ev = $pdo->prepare("SELECT id FROM events WHERE id = ?"); $ev->execute([$eid]);
        if (!$ev->fetch()) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();

        // Yourself; a parent/guardian for a youth in their family; or a coordinator (Mentor) for
        // any participant (they run the transportation plan on the Logistics page).
        $targetId = isset($d['member_id']) && (int)$d['member_id'] > 0 ? (int)$d['member_id'] : (int)$m['id'];
        if ($targetId !== (int)$m['id'] && !self::mgr($pdo, $m) && !MembersController::isFamilyParentOf($pdo, $m, $targetId)) {
            return Http::error($res, 'You can only set transportation for yourself or a youth in your family.', 403);
        }

        $to = self::legVal($d['ride_to'] ?? '');
        $back = self::legVal($d['ride_back'] ?? '');
        if ($to === null && $back === null) {   // clear the answer
            $pdo->prepare("DELETE FROM event_transport_responses WHERE event_id = ? AND member_id = ?")->execute([$eid, $targetId]);
            return self::list($req, $res, ['event_id' => (string)$eid]);
        }

        $driving = ($to === 'drive' || $back === 'drive');
        $seats = $driving && isset($d['seats_available']) && $d['seats_available'] !== '' && $d['seats_available'] !== null
            ? max(0, (int)$d['seats_available']) : null;
        $note = trim((string)($d['note'] ?? '')); $note = $note === '' ? null : mb_substr($note, 0, 300);

        $pdo->prepare(
            "INSERT INTO event_transport_responses (event_id, member_id, ride_to, ride_back, seats_available, note)
             VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE ride_to = VALUES(ride_to), ride_back = VALUES(ride_back),
                                     seats_available = VALUES(seats_available), note = VALUES(note)")
            ->execute([$eid, $targetId, $to, $back, $seats, $note]);
        // Drop any stale seat assignment for a leg the member no longer needs a ride on.
        $pdo->prepare(
            "UPDATE event_transport_responses
                SET assigned_driver_to_id   = CASE WHEN ride_to   = 'need' THEN assigned_driver_to_id   ELSE NULL END,
                    assigned_driver_back_id = CASE WHEN ride_back = 'need' THEN assigned_driver_back_id ELSE NULL END
              WHERE event_id = ? AND member_id = ?")
            ->execute([$eid, $targetId]);
        Audit::write($pdo, (int)$m['id'], 'event_transport_responses', $eid, 'transport_respond', null,
            ['ride_to' => $to, 'ride_back' => $back, 'for_member' => $targetId]);
        return self::list($req, $res, ['event_id' => (string)$eid]);
    }
}
