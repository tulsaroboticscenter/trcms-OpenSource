<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * The "My Volunteering" page — a self-service view for volunteers (and mentors/parents)
 * to find opportunities and report the time they've given.
 *
 * - Opportunities: upcoming events that need volunteers (open sign-up slots), then other
 *   upcoming events.
 * - My Hours: their contributed time totalled per event, for reporting volunteer hours to
 *   an employer. The page prints a clean statement.
 *
 * Gated on `volunteering.view` (seeded for Volunteer/Mentor/Parent; add a role later — e.g.
 * Sponsor — by granting it in Role Management). All data is the current member's own.
 */
final class VolunteeringController
{
    /**
     * GET /volunteering/opportunities — upcoming events explicitly opened to outside
     * volunteers (events.volunteer_open). Each carries its own sign-up details: our
     * internal sign-up (event page / open slots) plus an optional external link + note
     * (e.g. a FIRST volunteer site).
     */
    public static function opportunities(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'volunteering.view', 'read')) return Http::error($res, 'Access denied', 403);
        $mid = (int)$cur['id'];

        $sql =
            "SELECT e.id, e.name, e.event_date, e.start_time, e.location,
                    e.volunteer_signup_url, e.volunteer_signup_note,
                    (SELECT ep.status FROM event_participants ep
                      WHERE ep.event_id = e.id AND ep.member_id = ? LIMIT 1) AS my_rsvp,
                    (SELECT COUNT(*) FROM event_signup_slots s WHERE s.event_id = e.id) AS slot_count,
                    (SELECT COUNT(*) FROM event_signup_slots s
                      WHERE s.event_id = e.id
                        AND (s.capacity = 0
                             OR (SELECT COUNT(*) FROM event_signup_responses r WHERE r.slot_id = s.id) < s.capacity)
                    ) AS open_slots,
                    EXISTS (SELECT 1 FROM event_signup_responses r2
                              JOIN event_signup_slots s2 ON s2.id = r2.slot_id
                             WHERE s2.event_id = e.id AND r2.member_id = ?) AS im_signed_up
               FROM events e
              WHERE e.volunteer_open = 1 AND e.event_date >= CURDATE()
              ORDER BY e.event_date, e.start_time";
        $st = $pdo->prepare($sql);
        $st->execute([$mid, $mid]);
        $events = array_map(fn ($e) => [
            'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'],
            'start_time' => $e['start_time'], 'location' => $e['location'],
            'signup_url' => $e['volunteer_signup_url'] ?: null,
            'signup_note' => $e['volunteer_signup_note'] ?: null,
            'my_rsvp' => $e['my_rsvp'] ?: null,   // Attending / Maybe / Not Attending, or null
            'has_slots' => (int)$e['slot_count'] > 0,
            'open_slots' => (int)$e['open_slots'],
            'im_signed_up' => (bool)$e['im_signed_up'],
        ], $st->fetchAll());

        return Http::json($res, ['events' => $events]);
    }

    /** GET /volunteering/my-hours — the member's contributed time, totalled per event. */
    public static function myHours(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'volunteering.view', 'read')) return Http::error($res, 'Access denied', 403);
        $mid = (int)$cur['id'];

        // Time tied to an event, totalled per event.
        $ev = $pdo->prepare(
            "SELECT te.event_id, e.name, e.event_date, e.location, SUM(te.minutes) AS minutes
               FROM time_entries te
               JOIN events e ON e.id = te.event_id
              WHERE te.member_id = ? AND te.event_id IS NOT NULL
              GROUP BY te.event_id, e.name, e.event_date, e.location
              ORDER BY e.event_date DESC");
        $ev->execute([$mid]);
        $events = array_map(fn ($r) => [
            'event_id' => (int)$r['event_id'], 'name' => $r['name'],
            'event_date' => $r['event_date'], 'location' => $r['location'],
            'minutes' => (int)$r['minutes'], 'hours' => round(((int)$r['minutes']) / 60, 2),
        ], $ev->fetchAll());

        // Any contributed time NOT tied to an event, as a single line.
        $other = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE member_id = ? AND event_id IS NULL");
        $other->execute([$mid]);
        $otherMin = (int)$other->fetchColumn();

        // Unclassified check-in presence: for mentors/volunteers, time spent checked in
        // counts as volunteer time even if they never categorized it — otherwise their
        // hours look far too low (they just don't tag every meeting). Parents/youth do
        // NOT get this: a parent hanging out isn't volunteering, so they must classify a
        // check-in as a volunteer activity to earn credit. Mirrors the check-in fallback
        // in ActivityController::memberSummary so "My Volunteering" and "My Time" agree.
        $checkinMin = 0;
        if (in_array((string)($cur['member_type'] ?? ''), ['mentor', 'volunteer'], true)) {
            $ci = $pdo->prepare(
                "SELECT COALESCE(SUM(" . \App\Controllers\ActivityController::checkinMinutesSql('c') . "),0)
                   FROM checkins c
                  WHERE c.member_id = ? AND c.time_out IS NOT NULL
                    AND c.id NOT IN (SELECT checkin_id FROM time_entries WHERE checkin_id IS NOT NULL)");
            $ci->execute([$mid]);
            $checkinMin = (int)$ci->fetchColumn();
        }

        $eventMin = array_sum(array_column($events, 'minutes'));
        $totalMin = $eventMin + $otherMin + $checkinMin;

        return Http::json($res, [
            'member_name' => trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? '')),
            'org_name' => Config::get('ORG_NAME', 'Tulsa Robotics Center'),
            'events' => $events,
            'other_minutes' => $otherMin,
            'event_minutes' => $eventMin,
            'checkin_minutes' => $checkinMin,
            'total_minutes' => $totalMin,
            'total_hours' => round($totalMin / 60, 2),
        ]);
    }
}
