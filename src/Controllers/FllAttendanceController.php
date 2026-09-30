<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use App\Core\EnrollmentService;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * FLL attendance quick-tracking kiosk.
 *
 * A station device (or a mentor) opens an event that has quicktrack_enabled and gets a roster
 * grid of every current-season FLL (Explore + Challenge) team. Ticking a member's "In" / "Out"
 * box records a real check-in / check-out in the shared `checkins` table, so their presence
 * credits time through the normal model (memberSummary / Activity Impact). Anyone still checked
 * in when the operator taps "Close attendance" is credited the FULL event duration.
 *
 * Reuses the existing check-in row conventions: UTC timestamps (gmdate), the `time_out IS NULL`
 * = open convention, the migration-0185 unique-open guard, and ActivityController::logCheckinActivity.
 */
final class FllAttendanceController
{

    private static function appTz(): \DateTimeZone
    {
        return new \DateTimeZone(Config::get('APP_TIMEZONE', 'America/Chicago') ?: 'America/Chicago');
    }

    /** Access: the shared kiosk station (is_kiosk), a Mentor, or anyone with checkin.manage. */
    private static function gate(PDO $pdo, ?array $m): bool
    {
        if (!$m) return false;
        if (!empty($m['is_kiosk'])) return true;
        if (Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return true;
        return Permissions::memberCan($pdo, $m, 'checkin.manage', 'write');
    }

    private static function loadEvent(PDO $pdo, int $eventId): ?array
    {
        $s = $pdo->prepare(
            "SELECT id, name, event_date, start_time, end_time, quicktrack_enabled,
                    default_area_youth, default_area_adult, default_area_parent
             FROM events WHERE id = ?"
        );
        $s->execute([$eventId]);
        return $s->fetch() ?: null;
    }

    /** GET /fll-attendance/today — today's quick-tracking-enabled events, for the picker. */
    public static function today(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::gate($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $today = (new \DateTime('now', self::appTz()))->format('Y-m-d');
        $s = $pdo->prepare(
            "SELECT id, name, event_date, start_time, end_time
             FROM events
             WHERE quicktrack_enabled = 1 AND event_date = ?
             ORDER BY start_time IS NULL, start_time, name"
        );
        $s->execute([$today]);
        // Open (still checked-in) count per event, so the picker shows which event holds the
        // people currently checked in — helps a coordinator re-pick the right event after a refresh.
        $cs = $pdo->prepare("SELECT COUNT(*) FROM checkins WHERE event_id = ? AND time_out IS NULL");
        $events = array_map(function ($e) use ($cs) {
            $cs->execute([(int)$e['id']]);
            return [
                'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'],
                'start_time' => $e['start_time'], 'end_time' => $e['end_time'],
                'checked_in' => (int)$cs->fetchColumn(),
            ];
        }, $s->fetchAll());
        return Http::json($res, ['today' => $today, 'events' => $events]);
    }

    /** GET /fll-attendance/roster?event_id= — all current-season FLL teams + rosters + per-member state. */
    public static function roster(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::gate($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $eventId = (int)($req->getQueryParams()['event_id'] ?? 0);
        $event = self::loadEvent($pdo, $eventId);
        if (!$event) return Http::error($res, 'Event not found', 404);
        if (empty($event['quicktrack_enabled'])) {
            return Http::error($res, 'Quick tracking is not enabled for this event.', 400);
        }

        $season = EnrollmentService::currentSeason();
        $ts = $pdo->prepare(
            "SELECT ts.id AS team_season_id, ts.team_name, ts.team_id, t.team_number, t.program_id, p.name AS program
             FROM team_seasons ts
             JOIN teams t ON t.id = ts.team_id
             JOIN programs p ON p.id = t.program_id
             WHERE p.quick_attendance = 1 AND ts.season = ?
             ORDER BY t.program_id, t.team_number"
        );
        $ts->execute([$season]);
        $teamRows = $ts->fetchAll();

        $states = self::stateMap($pdo, $eventId);

        $rosterStmt = $pdo->prepare(
            "SELECT m.id AS member_id, m.first_name, m.last_name, m.member_type
             FROM team_member_assignments tma
             JOIN members m ON m.id = tma.member_id
             WHERE tma.team_season_id = ?
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_active = true OR m.is_active IS NULL)
             ORDER BY m.first_name, m.last_name"
        );

        $teams = [];
        foreach ($teamRows as $tr) {
            $rosterStmt->execute([(int)$tr['team_season_id']]);
            $members = [];
            foreach ($rosterStmt->fetchAll() as $a) {
                $mid = (int)$a['member_id'];
                $st = $states[$mid] ?? null;
                $members[] = [
                    'member_id'   => $mid,
                    'first_name'  => $a['first_name'],
                    'last_name'   => $a['last_name'],
                    'name'        => trim(($a['first_name'] ?? '') . ' ' . ($a['last_name'] ?? '')),
                    'member_type' => $a['member_type'],
                    'state'       => $st['state'] ?? 'none',
                    'time_in'     => $st ? Time::naiveIso($st['time_in']) : null,
                    'time_out'    => ($st && !empty($st['time_out'])) ? Time::naiveIso($st['time_out']) : null,
                ];
            }
            $teams[] = [
                'team_season_id' => (int)$tr['team_season_id'],
                'team_name'      => $tr['team_name'] ?: ('Team ' . $tr['team_number']),
                'team_number'    => $tr['team_number'],
                'program'        => $tr['program'],
                'program_id'     => (int)$tr['program_id'],
                'members'        => $members,
            ];
        }

        return Http::json($res, [
            'event' => [
                'id' => (int)$event['id'], 'name' => $event['name'], 'event_date' => $event['event_date'],
                'start_time' => $event['start_time'], 'end_time' => $event['end_time'],
            ],
            'season' => $season,
            'teams'  => $teams,
        ]);
    }

    /** POST /fll-attendance/mark  { event_id, member_id, field:'in'|'out', value:bool } */
    public static function mark(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::gate($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $eventId  = (int)($d['event_id'] ?? 0);
        $memberId = (int)($d['member_id'] ?? 0);
        $field    = (string)($d['field'] ?? '');
        $value    = self::truthy($d['value'] ?? false);
        if (!in_array($field, ['in', 'out'], true)) return Http::error($res, 'field must be "in" or "out"', 422);

        $event = self::loadEvent($pdo, $eventId);
        if (!$event || empty($event['quicktrack_enabled'])) {
            return Http::error($res, 'Event not found or quick tracking is off.', 404);
        }
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$memberId]);
        $member = $ms->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);

        $latest = self::latestCheckin($pdo, $eventId, $memberId);
        $now = gmdate('Y-m-d H:i:s');

        // ── Check IN ───────────────────────────────────────────────────────
        if ($field === 'in' && $value) {
            if ($latest) {
                return self::stateResp($res, $memberId, $latest['time_out'] === null ? 'in' : 'out', $latest);
            }
            // Participation gate (enrollment / T&C / payment) — same as the front-desk kiosk,
            // BUT waived for youth on this attendance kiosk: FLL coordinators track youth
            // attendance early-season before paperwork/fees are done, so a youth is always
            // checkable here. Adults still go through the gate.
            if (($member['member_type'] ?? '') !== 'youth') {
                $status = EnrollmentService::status($pdo, $memberId);
                if (empty($status['can_participate'])) {
                    return Http::json($res, ['ok' => false, 'warning' => true, 'member_id' => $memberId,
                        'state' => 'none', 'message' => self::blockedMsg($member, $status)]);
                }
            }
            $area = self::defaultArea($event, (string)$member['member_type']);
            $ins = $pdo->prepare("INSERT INTO checkins (member_id, event_id, time_in, activity_area) VALUES (?, ?, ?, ?)");
            try {
                $ins->execute([$memberId, $eventId, $now, $area]);
            } catch (\PDOException $e) {
                // migration-0185 unique-open guard: the member already has an open check-in
                // (likely at the front-desk station). Report it rather than opening a duplicate.
                if ($e->getCode() === '23000') {
                    // They already have an open check-in (often the front-desk kiosk). Don't error —
                    // adopt it for FLL attendance: point a bare (event-less) check-in at this event
                    // so it credits FLL, and report them as checked in.
                    $open = self::openCheckin($pdo, $memberId);
                    if ($open) {
                        if ($open['event_id'] === null) {
                            $pdo->prepare("UPDATE checkins SET event_id = ?, activity_area = COALESCE(activity_area, ?) WHERE id = ?")
                                ->execute([$eventId, $area, $open['id']]);
                        }
                        return self::stateResp($res, $memberId, 'in', $open);
                    }
                    return Http::json($res, ['ok' => false, 'warning' => true, 'member_id' => $memberId,
                        'state' => 'none',
                        'message' => "{$member['first_name']} already has an open check-in elsewhere — check them out there first."]);
                }
                throw $e;
            }
            return self::stateResp($res, $memberId, 'in', self::latestCheckin($pdo, $eventId, $memberId));
        }

        // ── Un-check IN (undo — remove the check-in and any credited time) ─
        if ($field === 'in' && !$value) {
            self::deleteMemberCheckins($pdo, $eventId, $memberId);
            return self::stateResp($res, $memberId, 'none', null);
        }

        // ── Check OUT ──────────────────────────────────────────────────────
        if ($field === 'out' && $value) {
            // Close their actual OPEN check-in wherever it was opened (front desk included), not
            // just one tied to this event — otherwise a member checked in elsewhere can't be
            // checked out from the FLL kiosk.
            $open = self::openCheckin($pdo, $memberId);
            if (!$open) {
                if ($latest && $latest['time_out'] !== null) return self::stateResp($res, $memberId, 'out', $latest);
                return Http::json($res, ['ok' => false, 'warning' => true, 'member_id' => $memberId,
                    'state' => 'none', 'message' => 'Check them in first.']);
            }
            $pdo->prepare("UPDATE checkins SET time_out = ? WHERE id = ?")->execute([$now, $open['id']]);
            $ci = $pdo->prepare("SELECT * FROM checkins WHERE id = ?"); $ci->execute([$open['id']]);
            $row = $ci->fetch();
            if ($row) self::creditCheckin($pdo, $row, $member, $event);
            $open['time_out'] = $now;
            return self::stateResp($res, $memberId, 'out', $open);
        }

        // ── Un-check OUT (reopen — clear time_out, drop the credited entry) ─
        if ($latest && $latest['time_out'] !== null) {
            $pdo->prepare("UPDATE checkins SET time_out = NULL WHERE id = ?")->execute([$latest['id']]);
            $pdo->prepare("DELETE FROM time_entries WHERE checkin_id = ?")->execute([$latest['id']]);
            $latest['time_out'] = null;
            return self::stateResp($res, $memberId, 'in', $latest);
        }
        return self::stateResp($res, $memberId, $latest ? 'in' : 'none', $latest);
    }

    /**
     * POST /fll-attendance/close  { event_id }
     * Close everyone still checked in for the event, crediting each the FULL event duration
     * (time_out = time_in + event length; defaults to 2h when the event has no times).
     */
    public static function close(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::gate($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $eventId = (int)($d['event_id'] ?? 0);
        $event = self::loadEvent($pdo, $eventId);
        if (!$event) return Http::error($res, 'Event not found', 404);

        $durationMin = self::eventDurationMin($event['start_time'] ?? null, $event['end_time'] ?? null);
        $sel = $pdo->prepare("SELECT * FROM checkins WHERE event_id = ? AND time_out IS NULL");
        $sel->execute([$eventId]);
        $open = $sel->fetchAll();
        $closed = 0;
        foreach ($open as $ci) {
            try {
                $inTs = strtotime(($ci['time_in'] ?? $ci['time_in']) . ' UTC');
                if ($inTs === false) $inTs = time();
                $timeOut = gmdate('Y-m-d H:i:s', $inTs + $durationMin * 60);
                $pdo->prepare("UPDATE checkins SET time_out = ? WHERE id = ?")->execute([$timeOut, (int)$ci['id']]);
                $closed++;
                $ci['time_out'] = $timeOut;
                $mm = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $mm->execute([(int)$ci['member_id']]);
                $mem = $mm->fetch();
                if ($mem) self::creditCheckin($pdo, $ci, $mem, $event);
            } catch (\Throwable $e) {
                // Skip one bad row so a single hiccup can't abort the whole close.
            }
        }
        return Http::json($res, ['ok' => true, 'closed' => $closed, 'duration_minutes' => $durationMin]);
    }

    // ── helpers ────────────────────────────────────────────────────────────

    /**
     * Log a closed check-in's time to the event's default activity. If the check-in row
     * never captured an activity_area (e.g. the event's default was set AFTER the person
     * checked in), fall back to the event's CURRENT default for their member type and
     * persist it, so the session still lands on the event's default activity as expected.
     */
    private static function creditCheckin(PDO $pdo, array $row, array $member, array $event): void
    {
        if (trim((string)($row['activity_area'] ?? '')) === '') {
            $area = self::defaultArea($event, (string)($member['member_type'] ?? ''));
            if ($area !== null) {
                $pdo->prepare("UPDATE checkins SET activity_area = ? WHERE id = ?")->execute([$area, (int)$row['id']]);
                $row['activity_area'] = $area;
            }
        }
        ActivityController::logCheckinActivity($pdo, $row, $member);
    }

    /**
     * Per-member check-in state for the kiosk, keyed by member_id.
     *
     * A member can only have ONE open check-in at a time (migration-0185 unique guard), so
     * "currently checked in" is a GLOBAL fact, not per-event. We therefore report a member as
     * 'in' whenever they have any open check-in — even one created at the front-desk/main kiosk —
     * so the FLL roster agrees with reality (and with the main kiosk) after a refresh. This event's
     * own completed check-ins drive the 'out' state and the displayed times.
     */
    private static function stateMap(PDO $pdo, int $eventId): array
    {
        $map = [];
        // This event's check-ins first (gives 'out' + this-event times).
        $s = $pdo->prepare("SELECT id, member_id, time_in, time_out FROM checkins WHERE event_id = ? ORDER BY id");
        $s->execute([$eventId]);
        foreach ($s->fetchAll() as $c) {
            $map[(int)$c['member_id']] = [
                'id'       => (int)$c['id'],
                'state'    => $c['time_out'] === null ? 'in' : 'out',
                'time_in'  => $c['time_in'],
                'time_out' => $c['time_out'],
            ];
        }
        // Overlay: anyone with an OPEN check-in anywhere is present → 'in' (front-desk check-ins
        // included). Only affects members shown on the roster; others are ignored by the caller.
        $o = $pdo->query("SELECT member_id, MAX(id) AS id, MAX(time_in) AS time_in FROM checkins WHERE time_out IS NULL GROUP BY member_id");
        foreach ($o->fetchAll() as $c) {
            $map[(int)$c['member_id']] = [
                'id'       => (int)$c['id'],
                'state'    => 'in',
                'time_in'  => $c['time_in'],
                'time_out' => null,
            ];
        }
        return $map;
    }

    /** A member's current OPEN check-in (any event), or null. One at most (migration-0185 guard). */
    private static function openCheckin(PDO $pdo, int $memberId): ?array
    {
        $s = $pdo->prepare("SELECT id, event_id, time_in, time_out FROM checkins WHERE member_id = ? AND time_out IS NULL ORDER BY id DESC LIMIT 1");
        $s->execute([$memberId]);
        $r = $s->fetch();
        if (!$r) return null;
        return ['id' => (int)$r['id'], 'event_id' => $r['event_id'] !== null ? (int)$r['event_id'] : null,
                'time_in' => $r['time_in'], 'time_out' => $r['time_out']];
    }

    private static function latestCheckin(PDO $pdo, int $eventId, int $memberId): ?array
    {
        $s = $pdo->prepare("SELECT id, time_in, time_out FROM checkins WHERE event_id = ? AND member_id = ? ORDER BY id DESC LIMIT 1");
        $s->execute([$eventId, $memberId]);
        $r = $s->fetch();
        if (!$r) return null;
        return ['id' => (int)$r['id'], 'time_in' => $r['time_in'], 'time_out' => $r['time_out']];
    }

    private static function deleteMemberCheckins(PDO $pdo, int $eventId, int $memberId): void
    {
        $sel = $pdo->prepare("SELECT id FROM checkins WHERE event_id = ? AND member_id = ?");
        $sel->execute([$eventId, $memberId]);
        $ids = array_map('intval', array_column($sel->fetchAll(), 'id'));
        if (!$ids) return;
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->prepare("DELETE FROM time_entries WHERE checkin_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM checkins WHERE id IN ($in)")->execute($ids);
    }

    private static function defaultArea(array $event, string $memberType): ?string
    {
        $col = $memberType === 'youth' ? 'default_area_youth'
            : ($memberType === 'parent' ? 'default_area_parent' : 'default_area_adult');
        $a = $event[$col] ?? null;
        return ($a === null || $a === '') ? null : (string)$a;
    }

    private static function stateResp(Response $res, int $memberId, string $state, ?array $latest): Response
    {
        return Http::json($res, [
            'ok'        => true,
            'member_id' => $memberId,
            'state'     => $state,
            'time_in'   => ($latest && !empty($latest['time_in']))  ? Time::naiveIso($latest['time_in'])  : null,
            'time_out'  => ($latest && !empty($latest['time_out'])) ? Time::naiveIso($latest['time_out']) : null,
        ]);
    }

    private static function blockedMsg(array $member, array $status): string
    {
        $fn = $member['first_name'] ?? 'This member';
        $y  = (int)($status['enrollment_year'] ?? EnrollmentService::currentEnrollmentYear());
        $yl = $y . '–' . ($y + 1);
        if (empty($status['enrolled'])) return "$fn doesn't have an active enrollment for the $yl season — see an admin to enroll.";
        if (empty($status['tc_ok']))    return "$fn still needs the $yl Terms & Conditions signed before checking in.";
        return "$fn isn't cleared to check in yet — see an admin.";
    }

    /** Event duration in minutes from local start/end wall-clock times; 120 (2h) when unknown. */
    private static function eventDurationMin(?string $start, ?string $end): int
    {
        if (!$start || !$end) return 120;
        $s = strtotime('1970-01-01 ' . $start . ' UTC');
        $e = strtotime('1970-01-01 ' . $end . ' UTC');
        if ($s === false || $e === false) return 120;
        $min = (int)round(($e - $s) / 60);
        return $min > 0 ? $min : 120;
    }

    private static function truthy($v): bool
    {
        if (is_bool($v)) return $v;
        if (is_int($v)) return $v !== 0;
        $s = strtolower(trim((string)$v));
        return $s !== '' && $s !== 'false' && $s !== '0' && $s !== 'no';
    }
}
