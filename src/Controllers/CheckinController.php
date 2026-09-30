<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use App\Core\EnrollmentService;
use App\Core\ComplianceService;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Port of app/modules/checkin/router.py — read/roster/checkout endpoints.
 * (The POST / toggle is deferred until the enrollment service is ported, since
 * it gates on enrollment status.)
 */
final class CheckinController
{
    /** The organization's local timezone (check-in days are reckoned locally). */
    private static function appTz(): \DateTimeZone
    {
        return new \DateTimeZone(Config::get('APP_TIMEZONE', 'America/Chicago') ?: 'America/Chicago');
    }

    /**
     * Start of "today" in the org's local timezone, expressed as a UTC string —
     * so it lines up with checkins.time_in, which is stored in UTC (gmdate()).
     * Using PHP's raw date() here breaks late in the day when the server clock is
     * UTC: it rolls over to "tomorrow" while it's still today locally, hiding the
     * day's check-ins.
     */
    private static function todayStart(): string
    {
        $d = new \DateTime('now', self::appTz());
        $d->setTime(0, 0, 0);
        $d->setTimezone(new \DateTimeZone('UTC'));
        return $d->format('Y-m-d H:i:s');
    }

    /** UTC [start, end] timestamps spanning a local calendar date 'YYYY-MM-DD'. */
    private static function dayWindow(string $date): array
    {
        $tz = self::appTz();
        $s = new \DateTime($date . ' 00:00:00', $tz); $s->setTimezone(new \DateTimeZone('UTC'));
        $e = new \DateTime($date . ' 23:59:59', $tz); $e->setTimezone(new \DateTimeZone('UTC'));
        return [$s->format('Y-m-d H:i:s'), $e->format('Y-m-d H:i:s')];
    }

    /** A valid 'YYYY-MM-DD' from the query, or null. */
    private static function dateParam(Request $req): ?string
    {
        $d = $req->getQueryParams()['date'] ?? null;
        return (is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) ? $d : null;
    }

    /**
     * Normalize a datetime to the naive 'YYYY-MM-DD HH:MM:SS' we store. Accepts
     * 'YYYY-MM-DDTHH:MM', a space-separated form, and tolerates fractional seconds
     * and a trailing timezone marker (Z or +hh:mm) — kept as the literal wall-clock.
     */
    private static function normTime($v): ?string
    {
        if ($v === null || $v === '') return null;
        $s = str_replace('T', ' ', trim((string)$v));
        $s = preg_replace('/\.\d+/', '', $s);                 // drop fractional seconds
        $s = preg_replace('/\s*(Z|[+\-]\d{2}:?\d{2})$/i', '', (string)$s); // drop tz marker
        $s = trim((string)$s);
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $s)) $s .= ':00';
        return preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $s) ? $s : null;
    }

    /** Today's local calendar date (Y-m-d) for comparing against DATE columns like event_date. */
    private static function today(): string
    {
        return (new \DateTime('now', self::appTz()))->format('Y-m-d');
    }

    private static function tagAtCheckout(PDO $pdo): bool
    {
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'activity_tag_at_checkout'");
        $stmt->execute();
        $r = $stmt->fetch();
        if (!$r || !$r['values']) return false;
        $v = json_decode($r['values'], true);
        return is_array($v) && isset($v[0]) && strtolower((string)$v[0]) === 'true';
    }

    /** The event's default check-in activity area for a member type (null if none). */
    private static function eventDefaultArea(PDO $pdo, ?int $eventId, string $memberType): ?string
    {
        if (!$eventId) return null;
        $col = $memberType === 'youth' ? 'default_area_youth'
            : ($memberType === 'parent' ? 'default_area_parent' : 'default_area_adult');
        $st = $pdo->prepare("SELECT `$col` AS a FROM events WHERE id = ?");
        $st->execute([$eventId]);
        $a = $st->fetchColumn();
        return ($a === false || $a === null || $a === '') ? null : (string)$a;
    }

    private static function serializeCheckin(array $c): array
    {
        return [
            'id' => (int)$c['id'],
            'member_id' => (int)$c['member_id'],
            'event_id' => $c['event_id'] !== null ? (int)$c['event_id'] : null,
            'time_in' => Time::naiveIso($c['time_in']),
            'time_out' => Time::naiveIso($c['time_out']),
            'event_name' => $c['event_name'] ?? null,
            'minutes' => (!empty($c['time_in']) && !empty($c['time_out']))
                ? max(0, (int)floor((strtotime($c['time_out']) - strtotime($c['time_in'])) / 60)) : 0,
            'has_visitor' => isset($c['has_visitor']) ? (bool)$c['has_visitor'] : null,
            'visitor_name' => $c['visitor_name'] ?? null,
            'notes' => $c['notes'] ?? null,
            'activity_area' => $c['activity_area'] ?? null,
            'created_at' => Time::naiveIso($c['created_at'] ?? null),
        ];
    }

    /** POST / — public kiosk check-in/out toggle (gated on enrollment status). */
    public static function toggle(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $d = (array)$req->getParsedBody();
        $memberId = (int)($d['member_id'] ?? 0);
        $mstmt = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $mstmt->execute([$memberId]);
        $member = $mstmt->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);

        // Who may check in whom. F6: the request must be AUTHENTICATED — either the
        // shared kiosk station account (is_kiosk, may check anyone in/out) or a member
        // signed into the app (self / own youth, or staff for anyone). A tokenless
        // request used to skip this guard entirely, letting an anonymous caller force
        // check-in/out of any member_id and read back their name + enrollment/compliance
        // status; that is now rejected. The physical front-desk kiosk signs in as its
        // is_kiosk station account, so it is unaffected.
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) {
            return Http::error($res, 'Please sign in, or use the front-desk check-in station, to check in.', 401);
        }
        if (empty($cur['is_kiosk']) && !self::mayManageCheckin($pdo, $cur, $memberId)) {
            return Http::error($res, 'You can only check yourself or your own youth in. Please use the front-desk kiosk to check others in.', 403);
        }

        if (!empty($member['is_archived'])) {
            return Http::json($res, ['ok' => false, 'warning' => true,
                'message' => 'This member is archived and cannot check in. Please see a System Administrator.']);
        }

        $status = EnrollmentService::status($pdo, $memberId);
        if (!$status['can_participate']) {
            $fn = $member['first_name']; $mtype = $member['member_type'];
            $yl = $status['enrollment_year'] . '–' . ($status['enrollment_year'] + 1);
            if ($mtype === 'mentor' && empty($status['tc_ok'])) {
                $msg = "Hi $fn! You need to sign the TRC Terms & Conditions for the $yl season before you can check in. Please see an admin to complete your annual T&C agreement.";
            } elseif ($mtype === 'parent' || $mtype === 'volunteer') {
                $msg = "Hi $fn! There was an unexpected issue with your check-in. Please see an admin.";
            } elseif (empty($status['enrolled'])) {
                $msg = "Hi $fn! You don't have an active enrollment for the $yl season. Please see an admin to enroll before checking in.";
            } elseif (empty($status['tc_ok'])) {
                $msg = "Hi $fn! Before you can check in, both you and a parent/guardian must complete the TRC Terms & Conditions. Please see a mentor to complete this step.";
            } else {
                $msg = "Hi $fn! Your enrollment fee has not been paid. Please see an admin to complete payment or arrange an override.";
            }
            return Http::json($res, ['ok' => false, 'warning' => true, 'message' => $msg]);
        }

        $now = gmdate('Y-m-d H:i:s');
        $ox = $pdo->prepare("SELECT * FROM checkins WHERE member_id = ? AND time_out IS NULL LIMIT 1");
        $ox->execute([$memberId]);
        $open = $ox->fetch();
        if ($open) {
            $pdo->prepare("UPDATE checkins SET time_out = ? WHERE id = ?")->execute([$now, (int)$open['id']]);
            $minutes = (int)floor((strtotime($now . ' UTC') - strtotime($open['time_in'] . ' UTC')) / 60);
            $msg = "See you later, {$member['first_name']}! You were here for {$minutes} minutes.";
            if (!empty($status['in_grace_period'])) {
                $msg .= " Reminder: your new season enrollment is due soon (grace period ends {$status['grace_ends']}).";
            }
            // Auto-log the time entry using the activity chosen at check-in (event
            // default check-in activities). No-op when no area was captured — e.g. a
            // parent who just hangs out — so we don't inflate the activity log.
            $open['time_out'] = $now;
            $autoLogged = ActivityController::logCheckinActivity($pdo, $open, $member);
            return Http::json($res, ['ok' => true, 'action' => 'checked_out', 'message' => $msg,
                'checkin_id' => (int)$open['id'], 'member_id' => $memberId, 'minutes' => $minutes,
                'auto_logged_minutes' => $autoLogged,
                // Only prompt the manual tag step when we did NOT already auto-log.
                'tag_at_checkout' => $autoLogged > 0 ? false : self::tagAtCheckout($pdo)]);
        }

        // Compliance gate: YPT + background check must be current before a NEW check-in.
        // Applies to mentors and to any adult flagged requires_ypt ("TRC Volunteer", #182).
        // Applied after the checkout branch above so an already checked-in member is never
        // trapped. NOT waived by the Admin/System Administrator role — only by the explicit
        // is_compliance_exempt flag.
        if (ComplianceService::requiresCompliance($member)) {
            $comp = ComplianceService::checkinComplianceOk($pdo, $member);
            if (!$comp['ok']) {
                $fn = $member['first_name'];
                return Http::json($res, ['ok' => false, 'warning' => true,
                    'message' => "Hi $fn! You're not cleared to check in yet — your {$comp['reason']} must be completed and current. Please see an admin."]);
            }
        }

        // Capture the activity area for auto-logging at check-out. If the client
        // sends 'activity_area' (from the check-in dropdown) use it verbatim (empty
        // string = "don't log"); otherwise fall back to the event's default for this
        // member type.
        $eventId = $d['event_id'] ?? null;
        if (array_key_exists('activity_area', $d)) {
            $area = trim((string)$d['activity_area']);
            $area = $area === '' ? null : $area;
        } else {
            $area = self::eventDefaultArea($pdo, $eventId ? (int)$eventId : null, (string)$member['member_type']);
        }
        $ins = $pdo->prepare("INSERT INTO checkins (member_id, event_id, time_in, has_visitor, visitor_name, notes, activity_area) VALUES (?, ?, ?, ?, ?, ?, ?)");
        try {
            $ins->execute([$memberId, $eventId, $now, (int)!empty($d['has_visitor']), $d['visitor_name'] ?? null, $d['notes'] ?? null, $area]);
        } catch (\PDOException $e) {
            // The unique index on open check-ins (migration 0185) rejects a second,
            // concurrent check-in — a kiosk double-tap or two devices at once. They're
            // already checked in, so report that cleanly instead of erroring or opening
            // a duplicate row.
            if ($e->getCode() === '23000') {
                return Http::json($res, ['ok' => true, 'action' => 'already_checked_in',
                    'message' => "You're already checked in, {$member['first_name']}."]);
            }
            throw $e;
        }
        $grace = null;
        if (!empty($status['in_grace_period'])) {
            $grace = "Reminder: you haven't enrolled for the new season yet. Grace period ends {$status['grace_ends']} ({$status['grace_days_remaining']} days). Please enroll soon to avoid losing access.";
        }
        return Http::json($res, ['ok' => true, 'action' => 'checked_in',
            'message' => "Welcome, {$member['first_name']}!", 'grace_warning' => $grace]);
    }

    public static function memberCheckins(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $memberId = (int)$route['member_id'];
        if ($m['id'] != $memberId
            && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            && !Permissions::memberCan($pdo, $m, 'checkin.manage', 'write')
            && !Permissions::memberCan($pdo, $m, 'members.directory', 'read')) {
            return Http::error($res, 'Access denied', 403);
        }
        $q = $req->getQueryParams();
        $skip = max(0, (int)($q['skip'] ?? 0)); $limit = min(500, max(1, (int)($q['limit'] ?? 50)));
        $where = "c.member_id = ?"; $args = [$memberId];
        if (!empty($q['from_date'])) { $where .= " AND DATE(c.time_in) >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where .= " AND DATE(c.time_in) <= ?"; $args[] = $q['to_date']; }
        $stmt = $pdo->prepare("SELECT c.*, e.name AS event_name FROM checkins c
                               LEFT JOIN events e ON e.id = c.event_id
                               WHERE $where ORDER BY c.time_in DESC LIMIT $limit OFFSET $skip");
        $stmt->execute($args);
        return Http::json($res, array_map([self::class, 'serializeCheckin'], $stmt->fetchAll()));
    }

    public static function eventCheckins(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $stmt = $pdo->prepare("SELECT * FROM checkins WHERE event_id = ? ORDER BY time_in");
        $stmt->execute([(int)$route['event_id']]);
        return Http::json($res, array_map([self::class, 'serializeCheckin'], $stmt->fetchAll()));
    }

    public static function adjustTimes(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['checkin_id'];
        $cur = $pdo->prepare("SELECT * FROM checkins WHERE id = ?"); $cur->execute([$id]);
        $ci = $cur->fetch();
        if (!$ci) return Http::error($res, 'Check-in record not found', 404);
        // Members can adjust their own check-in times; editing someone else's needs
        // the checkin.manage permission (Mentors keep access for the event screen).
        if ((int)$ci['member_id'] !== (int)$m['id']
            && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            && !Permissions::memberCan($pdo, $m, 'checkin.manage', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $d = (array)$req->getParsedBody();
        $newIn = array_key_exists('time_in', $d) ? self::normTime($d['time_in']) : $ci['time_in'];
        $newOut = array_key_exists('time_out', $d) ? self::normTime($d['time_out']) : $ci['time_out'];
        if ($newIn === null) return Http::error($res, 'Time in is required.', 400);
        if ($newOut !== null && $newOut < $newIn) return Http::error($res, 'Time out cannot be before time in.', 400);
        $pdo->prepare("UPDATE checkins SET time_in = ?, time_out = ? WHERE id = ?")->execute([$newIn, $newOut, $id]);
        Audit::write($pdo, (int)$m['id'], 'checkins', $id, 'update',
            ['time_in' => $ci['time_in'], 'time_out' => $ci['time_out']],
            ['time_in' => $newIn, 'time_out' => $newOut, 'reason' => 'adjust_times']);

        // If the check-in was shortened, keep any activity time tied to it within the
        // new duration — otherwise the auto-logged activity minutes can exceed the
        // time actually present (#154). One entry → set it to the new duration; many
        // → scale them down proportionally so the total matches.
        $capped = false;
        if ($newOut !== null) {
            $newMinutes = max(0, (int)floor((strtotime($newOut) - strtotime($newIn)) / 60));
            $te = $pdo->prepare("SELECT id, minutes FROM time_entries WHERE checkin_id = ? ORDER BY id");
            $te->execute([$id]);
            $entries = $te->fetchAll();
            $total = 0; foreach ($entries as $e) $total += (int)$e['minutes'];
            if ($entries && $total > $newMinutes) {
                if (count($entries) === 1) {
                    $pdo->prepare("UPDATE time_entries SET minutes = ?, updated_at = NOW() WHERE id = ?")->execute([$newMinutes, (int)$entries[0]['id']]);
                } else {
                    $assigned = 0; $n = count($entries);
                    foreach ($entries as $i => $e) {
                        $share = ($i === $n - 1) ? ($newMinutes - $assigned)
                            : ($total > 0 ? (int)floor($newMinutes * ((int)$e['minutes'] / $total)) : 0);
                        $assigned += $share;
                        $pdo->prepare("UPDATE time_entries SET minutes = ?, updated_at = NOW() WHERE id = ?")->execute([max(0, $share), (int)$e['id']]);
                    }
                }
                $capped = true;
                Audit::write($pdo, (int)$m['id'], 'time_entries', null, 'update', ['prev_total' => $total], ['capped_to' => $newMinutes, 'checkin_id' => $id, 'entries' => count($entries)]);
            }
        }
        return Http::json($res, ['ok' => true, 'id' => $id, 'time_in' => Time::utcIso($newIn), 'time_out' => Time::utcIso($newOut), 'activity_capped' => $capped]);
    }

    /** Whether the current member may edit/delete/add a check-in for $memberId. */
    /** True if $m is a (non-youth) guardian sharing a family with youth $youthId. */
    private static function isParentOf(PDO $pdo, array $m, int $youthId): bool
    {
        if (($m['member_type'] ?? '') === 'youth') return false;
        $s = $pdo->prepare(
            "SELECT 1 FROM family_members a
               JOIN family_members b ON a.family_id = b.family_id
               JOIN members y ON y.id = b.member_id
              WHERE a.member_id = ? AND b.member_id = ? AND y.member_type = 'youth' LIMIT 1");
        $s->execute([(int)$m['id'], $youthId]);
        return (bool)$s->fetchColumn();
    }

    /**
     * Who may check in / manage a check-in for member $memberId from the app:
     * yourself, a parent of that youth, or staff (Mentor role / checkin.manage).
     * The kiosk is handled separately and is not limited by this.
     */
    private static function mayManageCheckin(PDO $pdo, array $m, int $memberId): bool
    {
        return (int)$m['id'] === $memberId
            || self::isParentOf($pdo, $m, $memberId)
            || Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            || Permissions::memberCan($pdo, $m, 'checkin.manage', 'write');
    }

    /** DELETE /checkin/{checkin_id} — remove a check-in (own, or with checkin.manage). */
    public static function deleteCheckin(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['checkin_id'];
        $s = $pdo->prepare("SELECT * FROM checkins WHERE id = ?"); $s->execute([$id]);
        $ci = $s->fetch();
        if (!$ci) return Http::error($res, 'Check-in record not found', 404);
        if (!self::mayManageCheckin($pdo, $m, (int)$ci['member_id'])) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM checkins WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'checkins', $id, 'delete', $ci, null);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /checkin/member/{member_id} — add a check-in for a member at an explicit
     * time (for backfilling a missed check-in). Body: { time_in, time_out?, event_id? }.
     */
    public static function createManualCheckin(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $memberId = (int)$route['member_id'];
        if (!self::mayManageCheckin($pdo, $m, $memberId)) return Http::error($res, 'Access denied', 403);
        $exists = $pdo->prepare("SELECT id FROM members WHERE id = ?"); $exists->execute([$memberId]);
        if (!$exists->fetch()) return Http::error($res, 'Member not found', 404);
        $d = (array)$req->getParsedBody();
        $in = self::normTime($d['time_in'] ?? null);
        $out = self::normTime($d['time_out'] ?? null);
        if ($in === null) return Http::error($res, 'A check-in date and time is required.', 400);
        if ($out !== null && $out < $in) return Http::error($res, 'Check-out cannot be before check-in.', 400);
        $eventId = !empty($d['event_id']) ? (int)$d['event_id'] : null;
        $pdo->prepare("INSERT INTO checkins (member_id, event_id, time_in, time_out, created_at) VALUES (?, ?, ?, ?, NOW())")
            ->execute([$memberId, $eventId, $in, $out]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'checkins', $id, 'create',
            null, ['member_id' => $memberId, 'time_in' => $in, 'time_out' => $out, 'event_id' => $eventId, 'reason' => 'manual_add']);
        $r = $pdo->prepare("SELECT c.*, e.name AS event_name FROM checkins c LEFT JOIN events e ON e.id = c.event_id WHERE c.id = ?");
        $r->execute([$id]);
        return Http::json($res, self::serializeCheckin($r->fetch()), 201);
    }

    public static function todayEvents(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $today = self::today();
        $stmt = $pdo->prepare(
            "SELECT * FROM events
             WHERE event_date <= ?
               AND ((end_date IS NOT NULL AND end_date >= ?) OR (end_date IS NULL AND event_date = ?))
               AND (is_informational = 0 OR is_informational IS NULL)
             ORDER BY start_time"
        );
        $stmt->execute([$today, $today, $today]);
        $attStmt = $pdo->prepare("SELECT count(*) AS c FROM event_participants WHERE event_id = ? AND status = 'Attending'");
        $ciStmt = $pdo->prepare(
            "SELECT count(*) AS c FROM checkins WHERE time_in >= ? AND event_id = ? AND time_out IS NULL"
        );
        $out = [];
        foreach ($stmt->fetchAll() as $e) {
            $attStmt->execute([(int)$e['id']]);
            $ciStmt->execute([self::todayStart(), (int)$e['id']]);
            $out[] = [
                'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'],
                'end_date' => $e['end_date'], 'start_time' => $e['start_time'], 'event_type' => $e['event_type'],
                'location' => $e['location'],
                'requires_logistics' => isset($e['requires_logistics']) ? (bool)$e['requires_logistics'] : null,
                'attending_count' => (int)$attStmt->fetch()['c'],
                'checkin_count' => (int)$ciStmt->fetch()['c'],
            ];
        }
        return Http::json($res, $out);
    }

    /**
     * GET /checkin/my-status — the signed-in member's own check-in state plus any event happening
     * right now they could check into. Powers the dashboard check-in card (#186).
     */
    public static function myCheckinStatus(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$me['id'];

        $o = $pdo->prepare("SELECT c.id, c.time_in, c.event_id, e.name AS event_name
                              FROM checkins c LEFT JOIN events e ON e.id = c.event_id
                             WHERE c.member_id = ? AND c.time_out IS NULL
                          ORDER BY c.time_in DESC LIMIT 1");
        $o->execute([$mid]);
        $open = $o->fetch();

        // Today's non-informational events that are on right now (started, not yet ended — with a
        // 30-min cushion each side so people can check in a little early or after a meeting runs long).
        $today = self::today();
        $ev = $pdo->prepare(
            "SELECT id, name, start_time, end_time, location FROM events
              WHERE event_date <= ? AND ((end_date IS NOT NULL AND end_date >= ?) OR (end_date IS NULL AND event_date = ?))
                AND (is_informational = 0 OR is_informational IS NULL)
           ORDER BY start_time");
        $ev->execute([$today, $today, $today]);
        $earlyBound = date('H:i:s', strtotime('+30 minutes'));
        $lateBound  = date('H:i:s', strtotime('-30 minutes'));
        $events = [];
        foreach ($ev->fetchAll() as $e) {
            $started  = empty($e['start_time']) || $e['start_time'] <= $earlyBound;
            $notEnded = empty($e['end_time']) || $e['end_time'] >= $lateBound;
            if ($started && $notEnded) {
                $events[] = ['id' => (int)$e['id'], 'name' => $e['name'],
                             'start_time' => $e['start_time'], 'location' => $e['location']];
            }
        }

        return Http::json($res, [
            'open' => $open ? [
                'checkin_id' => (int)$open['id'],
                'since' => Time::utcIso($open['time_in']),
                'event_id' => $open['event_id'] !== null ? (int)$open['event_id'] : null,
                'event_name' => $open['event_name'] ?? null,
            ] : null,
            'events_now' => $events,
        ]);
    }

    /**
     * GET /checkin/active — everyone currently checked in (no checkout yet),
     * across walk-ins and events. Powers the "Currently Checked In" list on the
     * Member Check-In screen.
     */
    public static function activeCheckins(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $stmt = $pdo->query(
            "SELECT c.id AS checkin_id, c.member_id, c.time_in, c.event_id, e.name AS event_name,
                    m.first_name, m.last_name, m.member_type, m.member_number, m.photo_url
             FROM checkins c
             JOIN members m ON m.id = c.member_id
             LEFT JOIN events e ON e.id = c.event_id
             WHERE c.time_out IS NULL AND (m.is_system = 0 OR m.is_system IS NULL)
               AND (m.is_archived = 0 OR m.is_archived IS NULL)
             ORDER BY c.time_in DESC"
        );
        $out = [];
        foreach ($stmt->fetchAll() as $c) {
            $out[] = [
                'checkin_id' => (int)$c['checkin_id'],
                'member_id' => (int)$c['member_id'],
                'first_name' => $c['first_name'], 'last_name' => $c['last_name'],
                'member_type' => $c['member_type'], 'member_number' => $c['member_number'],
                'photo_url' => $c['photo_url'],
                'event_id' => $c['event_id'] !== null ? (int)$c['event_id'] : null,
                'event_name' => $c['event_name'],
                'time_in' => Time::utcIso($c['time_in']),
            ];
        }
        return Http::json($res, $out);
    }

    public static function roster(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $ex = $pdo->prepare("SELECT * FROM events WHERE id = ?"); $ex->execute([$eid]);
        $event = $ex->fetch();
        if (!$event) return Http::error($res, 'Event not found', 404);

        // RSVP'd Attending — keyed by member_id
        $pstmt = $pdo->prepare(
            "SELECT ep.id AS participant_id, ep.section_label,
                    m.id AS member_id, m.first_name, m.last_name, m.member_type,
                    m.member_number, m.photo_url, m.is_archived
             FROM event_participants ep JOIN members m ON m.id = ep.member_id
             WHERE ep.event_id = ? AND ep.status = 'Attending' AND (m.is_system = 0 OR m.is_system IS NULL)"
        );
        $pstmt->execute([$eid]);
        $entries = [];
        foreach ($pstmt->fetchAll() as $p) {
            $entries[(int)$p['member_id']] = $p + ['participant_id' => (int)$p['participant_id'], 'section_label' => $p['section_label']];
        }

        // Check-ins for the selected day (default today) — this event OR walk-in,
        // most recent per member. A date lets you review/fix a prior day of a
        // multi-day event.
        $date = self::dateParam($req);
        if ($date !== null) {
            [$start, $end] = self::dayWindow($date);
            $timeWhere = "c.time_in >= ? AND c.time_in <= ?"; $timeArgs = [$start, $end];
        } else {
            $timeWhere = "c.time_in >= ?"; $timeArgs = [self::todayStart()];
        }
        $cstmt = $pdo->prepare(
            "SELECT c.id AS checkin_id, c.member_id, c.time_in, c.time_out,
                    m.first_name, m.last_name, m.member_type, m.member_number, m.photo_url, m.is_archived
             FROM checkins c JOIN members m ON m.id = c.member_id
             WHERE $timeWhere AND c.event_id = ? AND (m.is_system = 0 OR m.is_system IS NULL)
             ORDER BY c.time_in DESC"
        );
        $cstmt->execute([...$timeArgs, $eid]);
        $ciMap = [];
        foreach ($cstmt->fetchAll() as $c) {
            $mid = (int)$c['member_id'];
            if (!isset($ciMap[$mid])) $ciMap[$mid] = $c;
        }
        foreach ($ciMap as $mid => $c) {
            if (!isset($entries[$mid])) {
                $entries[$mid] = $c + ['participant_id' => null, 'section_label' => 'Walk-In'];
            }
        }

        $roster = [];
        foreach ($entries as $mid => $mem) {
            if (!empty($mem['is_archived'])) continue;
            $ci = $ciMap[$mid] ?? null;
            $roster[] = [
                'member_id' => (int)$mid,
                'first_name' => $mem['first_name'], 'last_name' => $mem['last_name'],
                'member_type' => $mem['member_type'], 'member_number' => $mem['member_number'], 'photo_url' => $mem['photo_url'],
                'participant_id' => $mem['participant_id'],
                'section_label' => $mem['section_label'],
                'checkin_id' => $ci ? (int)$ci['checkin_id'] : null,
                'checked_in' => $ci !== null && $ci['time_out'] === null,
                'checked_out' => $ci !== null && $ci['time_out'] !== null,
                'time_in' => $ci ? Time::utcIso($ci['time_in']) : null,
                'time_out' => $ci ? Time::utcIso($ci['time_out']) : null,
            ];
        }
        // Order by member-type category (Youth, Mentor, Parent, Volunteer), then last name.
        $typeRank = ['youth' => 0, 'mentor' => 1, 'parent' => 2, 'volunteer' => 3];
        usort($roster, function ($a, $b) use ($typeRank) {
            $ra = $typeRank[$a['member_type']] ?? 9;
            $rb = $typeRank[$b['member_type']] ?? 9;
            return [$ra, strtolower((string)$a['last_name']), strtolower((string)$a['first_name'])]
               <=> [$rb, strtolower((string)$b['last_name']), strtolower((string)$b['first_name'])];
        });

        return Http::json($res, [
            'event' => [
                'id' => (int)$event['id'], 'name' => $event['name'], 'event_date' => $event['event_date'],
                'end_date' => $event['end_date'], 'start_time' => $event['start_time'],
                'location' => $event['location'], 'event_type' => $event['event_type'],
                'default_area_youth'  => $event['default_area_youth']  ?? null,
                'default_area_adult'  => $event['default_area_adult']  ?? null,
                'default_area_parent' => $event['default_area_parent'] ?? null,
            ],
            'roster' => $roster,
            'date' => $date ?? self::today(),
        ]);
    }

    public static function eventCheckout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id']; $mid = (int)$route['member_id'];
        // Security #9: only a shared kiosk, a check-in manager (Mentor role or checkin.manage),
        // or the member themselves may close a check-in. Mirrors eventCheckoutAll's gate.
        // Previously ANY authenticated member could check ANY other member out of ANY event
        // (attendance / volunteer-hour tampering).
        if ((int)$m['id'] !== $mid
            && empty($m['is_kiosk'])
            && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            && !Permissions::memberCan($pdo, $m, 'checkin.manage', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $date = self::dateParam($req);
        if ($date !== null) {
            [$start, $end] = self::dayWindow($date);
            $stmt = $pdo->prepare(
                "SELECT * FROM checkins WHERE member_id = ? AND time_in >= ? AND time_in <= ? AND time_out IS NULL
                 AND event_id = ? ORDER BY time_in DESC LIMIT 1"
            );
            $stmt->execute([$mid, $start, $end, $eid]);
        } else {
            $stmt = $pdo->prepare(
                "SELECT * FROM checkins WHERE member_id = ? AND time_in >= ? AND time_out IS NULL
                 AND event_id = ? ORDER BY time_in DESC LIMIT 1"
            );
            $stmt->execute([$mid, self::todayStart(), $eid]);
        }
        $ci = $stmt->fetch();
        if (!$ci) return Http::error($res, 'No open check-in found for this member at this event.', 404);
        $now = gmdate('Y-m-d H:i:s');
        $pdo->prepare("UPDATE checkins SET time_out = ? WHERE id = ?")->execute([$now, (int)$ci['id']]);
        $minutes = (int)floor((strtotime($now . ' UTC') - strtotime($ci['time_in'] . ' UTC')) / 60);
        $mstmt = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $mstmt->execute([$mid]);
        $member = $mstmt->fetch();
        $ci['time_out'] = $now;
        $autoLogged = $member ? ActivityController::logCheckinActivity($pdo, $ci, $member) : 0;
        return Http::json($res, [
            'ok' => true,
            'message' => "Checked out {$member['first_name']} {$member['last_name']} after {$minutes} min.",
            'time_out' => Time::utcIso($now), 'minutes' => $minutes,
            'checkin_id' => (int)$ci['id'], 'member_id' => $mid,
            'auto_logged_minutes' => $autoLogged,
            'tag_at_checkout' => $autoLogged > 0 ? false : self::tagAtCheckout($pdo),
        ]);
    }

    /**
     * Remove an accidentally-checked-in attendee: permanently delete that
     * member's check-in record(s) for this event. Gated by the checkin.manage
     * permission so admins can grant the ability to specific roles.
     */
    public static function removeAttendee(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $m, 'checkin.manage', 'write')) {
            return Http::error($res, "You don't have permission to remove check-ins.", 403);
        }
        $eid = (int)$route['event_id']; $mid = (int)$route['member_id'];
        $sel = $pdo->prepare("SELECT id FROM checkins WHERE event_id = ? AND member_id = ?");
        $sel->execute([$eid, $mid]);
        $ids = array_map('intval', array_column($sel->fetchAll(), 'id'));
        if (!$ids) return Http::error($res, 'No check-in found for this member at this event.', 404);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->prepare("DELETE FROM checkins WHERE id IN ($in)")->execute($ids);
        foreach ($ids as $cid) Audit::write($pdo, (int)$m['id'], 'checkins', $cid, 'delete', null, ['event_id' => $eid, 'member_id' => $mid, 'reason' => 'remove_attendee']);
        return Http::json($res, ['ok' => true, 'removed' => count($ids), 'member_id' => $mid]);
    }

    public static function eventCheckoutAll(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        // A shared kiosk station (is_kiosk) may check everyone out, exactly as it checks them
        // in — matching the per-member checkout, which the station already uses. Otherwise
        // require the usual check-in manager (Mentor role or checkin.manage).
        if (empty($m['is_kiosk'])
            && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            && !Permissions::memberCan($pdo, $m, 'checkin.manage', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $eid = (int)$route['event_id'];
        $now = gmdate('Y-m-d H:i:s');
        $date = self::dateParam($req);
        // Grab the open check-ins first so we can auto-log each one's activity.
        if ($date !== null) {
            [$start, $end] = self::dayWindow($date);
            $sel = $pdo->prepare(
                "SELECT * FROM checkins WHERE time_in >= ? AND time_in <= ? AND time_out IS NULL AND event_id = ?"
            );
            $sel->execute([$start, $end, $eid]);
        } else {
            $sel = $pdo->prepare(
                "SELECT * FROM checkins WHERE time_in >= ? AND time_out IS NULL AND event_id = ?"
            );
            $sel->execute([self::todayStart(), $eid]);
        }
        $open = $sel->fetchAll();
        $logged = 0; $checkedOut = 0; $failed = 0;
        foreach ($open as $ci) {
            // Check each person out independently so one bad row (e.g. an activity-log hiccup)
            // can't abort the whole batch and leave the rest still checked in.
            try {
                $pdo->prepare("UPDATE checkins SET time_out = ? WHERE id = ?")->execute([$now, (int)$ci['id']]);
                $checkedOut++;
                $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([(int)$ci['member_id']]);
                $mem = $ms->fetch();
                $ci['time_out'] = $now;
                if ($mem && ActivityController::logCheckinActivity($pdo, $ci, $mem) > 0) $logged++;
            } catch (\Throwable $e) {
                $failed++;
            }
        }
        return Http::json($res, ['ok' => true, 'checked_out' => $checkedOut, 'auto_logged' => $logged, 'failed' => $failed]);
    }
}
