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

/** Port of app/modules/events/router.py — core endpoints (logistics/hotels/recurring deferred). */
final class EventsController
{
    private const DEFAULT_TYPES = ['Regular Meeting', 'Add-On Meeting', 'Board Meeting', 'Program Team Meeting',
        'Committee Meeting', 'Training', 'Scrimmage', 'Competition',
        'Outreach Event', 'Open House', 'Information Session', 'Parent Meeting', 'Field Trip', 'Other'];

    private const BASE = "SELECT e.*,
        c.first_name AS c_fn, c.last_name AS c_ln,
        m1.first_name AS m1_fn, m1.last_name AS m1_ln,
        m2.first_name AS m2_fn, m2.last_name AS m2_ln,
        EXISTS(SELECT 1 FROM event_logistics el WHERE el.event_id = e.id) AS has_log
        FROM events e
        LEFT JOIN members c ON c.id = e.coordinator_id
        LEFT JOIN members m1 ON m1.id = e.mentor1_id
        LEFT JOIN members m2 ON m2.id = e.mentor2_id";

    private static function name(?string $fn, ?string $ln): ?string
    {
        return ($fn !== null) ? trim($fn . ' ' . $ln) : null;
    }

    /**
     * Make an external URL absolute so it renders as a real link, not a path relative to
     * the current page. A value like "meet.google.com/abc" would otherwise resolve to
     * "https://trcms…/events/meet.google.com/abc" when clicked from the event page.
     */
    private static function normalizeUrl(?string $u): ?string
    {
        $u = trim((string)($u ?? ''));
        if ($u === '') return null;
        if (preg_match('#^[a-zA-Z][a-zA-Z0-9+.\-]*://#', $u)) return $u; // already has a scheme
        return 'https://' . ltrim($u, '/');
    }

    private static function serialize(PDO $pdo, array $e, ?int $mentorsAttending = null): array
    {
        $links = $pdo->prepare("SELECT team_season_id FROM event_team_links WHERE event_id = ?");
        $links->execute([(int)$e['id']]);
        // RSVP tallies for the list/calendar (#117).
        $rc = $pdo->prepare("SELECT status, COUNT(*) AS c FROM event_participants WHERE event_id = ? GROUP BY status");
        $rc->execute([(int)$e['id']]);
        $rsvp = ['attending' => 0, 'maybe' => 0, 'not_attending' => 0];
        foreach ($rc->fetchAll() as $r) {
            if ($r['status'] === 'Attending') $rsvp['attending'] = (int)$r['c'];
            elseif ($r['status'] === 'Maybe') $rsvp['maybe'] = (int)$r['c'];
            elseif ($r['status'] === 'Not Attending') $rsvp['not_attending'] = (int)$r['c'];
        }
        // Mentor coverage is now driven by RSVPs, not the mentor-slot assignments:
        // it's met once 2+ distinct mentors have responded "Attending". Applies to
        // recurring events too (no more automatic pass). List endpoints pass the
        // count in (batched) to avoid an N+1; single-event loads compute it here.
        if ($mentorsAttending === null) {
            $ma = $pdo->prepare(
                "SELECT COUNT(DISTINCT ep.member_id) AS c
                   FROM event_participants ep
                   JOIN member_system_roles msr ON msr.member_id = ep.member_id
                   JOIN system_roles sr ON sr.id = msr.role_id AND sr.name LIKE 'Mentor%'
                  WHERE ep.status = 'Attending' AND ep.member_id IS NOT NULL AND ep.event_id = ?"
            );
            $ma->execute([(int)$e['id']]);
            $mentorsAttending = (int)$ma->fetchColumn();
        }
        $coverageMet = $mentorsAttending >= 2;
        return [
            'rsvp' => $rsvp,
            'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'], 'end_date' => $e['end_date'] ?? null,
            'start_time' => $e['start_time'], 'end_time' => $e['end_time'], 'location' => $e['location'], 'details' => $e['details'],
            'meeting_mode' => $e['meeting_mode'] ?? 'in_person', 'remote_url' => self::normalizeUrl($e['remote_url'] ?? null), 'remote_details' => $e['remote_details'] ?? null,
            'event_type' => $e['event_type'],
            'is_informational' => (bool)($e['is_informational'] ?? false),
            'is_tentative' => (bool)($e['is_tentative'] ?? false),
            'coordinator_id' => $e['coordinator_id'] !== null ? (int)$e['coordinator_id'] : null,
            'coordinator_name' => self::name($e['c_fn'] ?? null, $e['c_ln'] ?? null),
            'post_to_public_calendar' => (bool)$e['post_to_public_calendar'],
            'mentor_coverage_met' => $coverageMet,
            'mentors_attending' => $mentorsAttending,
            'mentor1_id' => $e['mentor1_id'] !== null ? (int)$e['mentor1_id'] : null,
            'mentor1_name' => self::name($e['m1_fn'] ?? null, $e['m1_ln'] ?? null),
            'mentor2_id' => $e['mentor2_id'] !== null ? (int)$e['mentor2_id'] : null,
            'mentor2_name' => self::name($e['m2_fn'] ?? null, $e['m2_ln'] ?? null),
            'requires_logistics' => (bool)$e['requires_logistics'],
            'default_area_youth'  => $e['default_area_youth']  ?? null,
            'default_area_adult'  => $e['default_area_adult']  ?? null,
            'default_area_parent' => $e['default_area_parent'] ?? null,
            'fundraising_opportunity' => (bool)($e['fundraising_opportunity'] ?? false),
            'benefits_season' => $e['benefits_season'] ?? null,
            'volunteer_open' => (bool)($e['volunteer_open'] ?? false),
            'bring_enabled' => (bool)($e['bring_enabled'] ?? false),
            'transport_enabled' => (bool)($e['transport_enabled'] ?? false),
            'quicktrack_enabled' => (bool)($e['quicktrack_enabled'] ?? false),
            'volunteer_signup_url' => $e['volunteer_signup_url'] ?? null,
            'volunteer_signup_note' => $e['volunteer_signup_note'] ?? null,
            'has_logistics' => (bool)$e['has_log'],
            'event_url' => self::normalizeUrl($e['event_url'] ?? null),
            'is_recurring' => isset($e['is_recurring']) ? (bool)$e['is_recurring'] : false,
            'recurrence_group_id' => $e['recurrence_group_id'] ?? null,
            'recurrence_description' => $e['recurrence_description'] ?? null,
            'recurrence_index' => isset($e['recurrence_index']) ? (int)$e['recurrence_index'] : 1,
            'team_season_ids' => array_map('intval', array_column($links->fetchAll(), 'team_season_id')),
            'group_ids' => self::eventGroupIds($pdo, (int)$e['id']),
            'created_at' => Time::naiveIso($e['created_at'] ?? null),
        ];
    }

    private static function eventGroupIds(PDO $pdo, int $eventId): array
    {
        $s = $pdo->prepare("SELECT group_id FROM event_groups WHERE event_id = ?"); $s->execute([$eventId]);
        return array_map('intval', array_column($s->fetchAll(), 'group_id'));
    }

    private static function syncGroups(PDO $pdo, int $eventId, array $ids): void
    {
        $pdo->prepare("DELETE FROM event_groups WHERE event_id = ?")->execute([$eventId]);
        $ins = $pdo->prepare("INSERT IGNORE INTO event_groups (event_id, group_id) VALUES (?, ?)");
        foreach (array_unique(array_map('intval', $ids)) as $gid) { if ($gid > 0) $ins->execute([$eventId, $gid]); }
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare(self::BASE . " WHERE e.id = ?"); $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    private static function syncTeamLinks(PDO $pdo, int $eventId, ?string $category, array $ids): void
    {
        $pdo->prepare("DELETE FROM event_team_links WHERE event_id = ?")->execute([$eventId]);
        $cat = $category ?: 'Other';
        foreach (array_unique(array_map('intval', $ids)) as $tsid) {
            $pdo->prepare("INSERT INTO event_team_links (event_id, team_season_id, category) VALUES (?, ?, ?)")->execute([$eventId, $tsid, $cat]);
        }
    }

    private static function mgr(PDO $pdo, Request $req, array $roles = ['Mentor']): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, $roles)) return ['err' => 403, 'detail' => 'You do not have permission to perform this action'];
        return ['member' => $m];
    }

    public static function types(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'event_types'"); $stmt->execute();
        $r = $stmt->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        $types = (is_array($v) && $v) ? $v : self::DEFAULT_TYPES;
        // Always offer the governance/meeting types (#151), even when a custom list
        // is configured. Insert them before a trailing "Other" so it stays last.
        $ensure = ['Board Meeting', 'Program Team Meeting', 'Committee Meeting'];
        $missing = array_values(array_diff($ensure, $types));
        if ($missing) {
            $otherPos = array_search('Other', $types, true);
            if ($otherPos !== false) {
                array_splice($types, $otherPos, 0, $missing);
            } else {
                $types = array_merge($types, $missing);
            }
        }
        return Http::json($res, $types);
    }

    /** GET /events/birthdays?month=1-12 — active members whose birthday falls in that month. */
    public static function birthdays(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        // Staff-only: the birthday overlay lists every active member's birth month+day,
        // which must not be enumerable by an ordinary member (esp. minors' dates by a peer).
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $month = (int)($req->getQueryParams()['month'] ?? (int)date('n'));
        if ($month < 1 || $month > 12) return Http::error($res, 'Invalid month', 422);
        $s = $pdo->prepare(
            "SELECT id, first_name, last_name, member_type, DAY(birthday) AS day
             FROM members
             WHERE birthday IS NOT NULL AND MONTH(birthday) = ?
               AND is_active = 1
               AND (is_system = 0 OR is_system IS NULL)
               AND (is_kiosk = 0 OR is_kiosk IS NULL)
             ORDER BY DAY(birthday), first_name, last_name"
        );
        $s->execute([$month]);
        $out = array_map(fn($r) => [
            'member_id' => (int)$r['id'],
            'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'member_type' => $r['member_type'],
            'day' => (int)$r['day'],
        ], $s->fetchAll());
        return Http::json($res, ['month' => $month, 'birthdays' => $out]);
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['from_date'])) { $where[] = "(e.event_date >= ? OR e.end_date >= ?)"; $args[] = $q['from_date']; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where[] = "e.event_date <= ?"; $args[] = $q['to_date']; }
        if (!empty($q['event_type'])) { $where[] = "e.event_type = ?"; $args[] = $q['event_type']; }
        if (!empty($q['search'])) { $where[] = "e.name LIKE ?"; $args[] = '%' . $q['search'] . '%'; }
        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $c = $pdo->prepare("SELECT count(*) AS c FROM events e $clause"); $c->execute($args);
        $total = (int)$c->fetch()['c'];
        $skip = max(0, (int)($q['skip'] ?? 0)); $limit = min(1000, max(1, (int)($q['limit'] ?? 200)));
        $stmt = $pdo->prepare(self::BASE . " $clause ORDER BY e.event_date ASC, e.start_time ASC LIMIT $limit OFFSET $skip");
        $stmt->execute($args);
        // Pass 0 so serialize() skips its per-event coverage query; attachAvailability
        // fills in the real mentors-attending count (and coverage) in one batched pass.
        $events = array_map(fn($e) => self::serialize($pdo, $e, 0), $stmt->fetchAll());
        self::attachAvailability($pdo, (int)$cur['id'], $events);
        return Http::json($res, ['total' => $total, 'events' => $events]);
    }

    /**
     * Enrich a list of serialized events (by reference) with two fields used by the
     * calendar's "Check Mentor Availability" and "RSVP Status" overlays:
     *   mentor_attending — # of distinct members holding a Mentor* system role who
     *                      RSVP'd Attending (the "2-deep leadership" coverage signal).
     *   my_rsvp          — the current member's own RSVP status for the event, or null.
     * Batched into two queries regardless of how many events are on screen.
     */
    private static function attachAvailability(PDO $pdo, int $memberId, array &$events): void
    {
        $ids = array_column($events, 'id');
        if (!$ids) return;
        $in = implode(',', array_fill(0, count($ids), '?'));

        $mc = $pdo->prepare(
            "SELECT ep.event_id, COUNT(DISTINCT ep.member_id) AS c
               FROM event_participants ep
               JOIN member_system_roles msr ON msr.member_id = ep.member_id
               JOIN system_roles sr ON sr.id = msr.role_id AND sr.name LIKE 'Mentor%'
              WHERE ep.status = 'Attending' AND ep.member_id IS NOT NULL AND ep.event_id IN ($in)
              GROUP BY ep.event_id"
        );
        $mc->execute($ids);
        $mentor = [];
        foreach ($mc->fetchAll() as $r) $mentor[(int)$r['event_id']] = (int)$r['c'];

        $mr = $pdo->prepare("SELECT event_id, status FROM event_participants WHERE member_id = ? AND event_id IN ($in)");
        $mr->execute(array_merge([$memberId], $ids));
        $mine = [];
        foreach ($mr->fetchAll() as $r) $mine[(int)$r['event_id']] = $r['status'];

        foreach ($events as &$e) {
            $cnt = $mentor[$e['id']] ?? 0;
            $e['mentor_attending'] = $cnt;
            // Coverage (RSVP-based, 2+ mentors attending) — overrides the placeholder
            // serialize() set for the list path.
            $e['mentors_attending'] = $cnt;
            $e['mentor_coverage_met'] = $cnt >= 2;
            $e['my_rsvp'] = $mine[$e['id']] ?? null;
        }
        unset($e);
    }

    /**
     * The full set of `events` columns written when creating an event, built from the request
     * body. SINGLE source of truth shared by both create() and createRecurring() so a recurring
     * series retains every setting a single event does (recurrence adds its own columns on top).
     * Excludes team/group links — those are join tables synced separately (syncTeamLinks/syncGroups).
     */
    private static function buildEventRow(array $d, int $coverage): array
    {
        return [
            'name' => $d['name'], 'event_date' => $d['event_date'], 'end_date' => $d['end_date'] ?? null,
            'start_time' => $d['start_time'] ?? null, 'end_time' => $d['end_time'] ?? null,
            'location' => $d['location'] ?? null, 'details' => $d['details'] ?? null, 'event_type' => $d['event_type'] ?? null,
            'meeting_mode' => in_array($d['meeting_mode'] ?? '', ['in_person', 'remote', 'hybrid'], true) ? $d['meeting_mode'] : 'in_person',
            'remote_url' => self::normalizeUrl($d['remote_url'] ?? null),
            'remote_details' => ($d['remote_details'] ?? '') === '' ? null : $d['remote_details'],
            'is_informational' => (int)!empty($d['is_informational']),
            'is_tentative' => (int)!empty($d['is_tentative']),
            'quicktrack_enabled' => (int)!empty($d['quicktrack_enabled']),
            'event_url' => self::normalizeUrl($d['event_url'] ?? null), 'coordinator_id' => $d['coordinator_id'] ?? null,
            'post_to_public_calendar' => (int)!empty($d['post_to_public_calendar']),
            'mentor1_id' => $d['mentor1_id'] ?? null, 'mentor2_id' => $d['mentor2_id'] ?? null,
            'mentor_coverage_met' => $coverage, 'requires_logistics' => (int)!empty($d['requires_logistics']),
            'fundraising_opportunity' => (int)!empty($d['fundraising_opportunity']),
            'benefits_season' => ($d['benefits_season'] ?? '') === '' ? null : $d['benefits_season'],
            'default_area_youth'  => ($d['default_area_youth']  ?? '') === '' ? null : $d['default_area_youth'],
            'default_area_adult'  => ($d['default_area_adult']  ?? '') === '' ? null : $d['default_area_adult'],
            'default_area_parent' => ($d['default_area_parent'] ?? '') === '' ? null : $d['default_area_parent'],
            'volunteer_open' => (int)!empty($d['volunteer_open']),
            'volunteer_signup_url'  => ($d['volunteer_signup_url']  ?? '') === '' ? null : $d['volunteer_signup_url'],
            'volunteer_signup_note' => ($d['volunteer_signup_note'] ?? '') === '' ? null : $d['volunteer_signup_note'],
        ];
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::mgr($pdo, $req)) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $d = (array)$req->getParsedBody();
        if (empty($d['name']) || empty($d['event_date'])) return Http::error($res, 'name and event_date are required', 422);
        $teamIds = $d['team_season_ids'] ?? null;
        $coverage = (!empty($d['mentor1_id']) && !empty($d['mentor2_id'])) ? 1 : 0;
        $row = self::buildEventRow($d, $coverage);
        $cols = array_keys($row);
        $ins = $pdo->prepare("INSERT INTO events (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")");
        $ins->execute(array_values($row));
        $eid = (int)$pdo->lastInsertId();
        if ($teamIds !== null) self::syncTeamLinks($pdo, $eid, $d['event_type'] ?? null, (array)$teamIds);
        if (array_key_exists('group_ids', $d)) self::syncGroups($pdo, $eid, (array)$d['group_ids']);
        if (!empty($d['requires_logistics'])) $pdo->prepare("INSERT INTO event_logistics (event_id) VALUES (?)")->execute([$eid]);
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'events', $eid, 'create', null, $d);
        return Http::json($res, self::serialize($pdo, self::load($pdo, $eid)), 201);
    }

    public static function teamEvents(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $tsid = (int)$route['team_season_id'];
        $includePast = filter_var($req->getQueryParams()['include_past'] ?? false, FILTER_VALIDATE_BOOLEAN);
        // Match events linked to ANY of this team's season rows (by team_id), not just
        // the requested season — so future events linked under a prior season still show
        // after the season boundary rolls over (and before team-seasons are recreated).
        $sql = "SELECT MIN(l.category) AS category, e.id AS event_id, e.name, e.event_date, e.end_date,
                       e.start_time, e.location, e.event_type
                FROM team_seasons ts_req
                JOIN team_seasons ts_all ON ts_all.team_id = ts_req.team_id
                JOIN event_team_links l ON l.team_season_id = ts_all.id
                JOIN events e ON e.id = l.event_id
                WHERE ts_req.id = ?";
        $args = [$tsid];
        if (!$includePast) { $sql .= " AND COALESCE(e.end_date, e.event_date) >= ?"; $args[] = date('Y-m-d'); }
        $sql .= " GROUP BY e.id, e.name, e.event_date, e.end_date, e.start_time, e.location, e.event_type
                  ORDER BY e.event_date, e.start_time";
        $stmt = $pdo->prepare($sql); $stmt->execute($args);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['category' => $r['category'] ?: ($r['event_type'] ?: 'Other'), 'event_id' => (int)$r['event_id'],
                'name' => $r['name'], 'event_date' => $r['event_date'], 'end_date' => $r['end_date'],
                'start_time' => $r['start_time'], 'location' => $r['location'], 'event_type' => $r['event_type']];
        }
        return Http::json($res, $out);
    }

    public static function upcoming(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $days = (int)($req->getQueryParams()['days'] ?? 30);
        $until = date('Y-m-d', strtotime("+$days days"));
        $stmt = $pdo->prepare(self::BASE . " WHERE e.event_date >= ? AND e.event_date <= ? ORDER BY e.event_date, e.start_time");
        $stmt->execute([date('Y-m-d'), $until]);
        return Http::json($res, array_map(fn($e) => self::serialize($pdo, $e), $stmt->fetchAll()));
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $e = self::load($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        return Http::json($res, self::serialize($pdo, $e));
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::mgr($pdo, $req)) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $id = (int)$route['event_id'];
        $cur = self::load($pdo, $id);
        if (!$cur) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();
        $teamIds = array_key_exists('team_season_ids', $d) ? $d['team_season_ids'] : null;
        unset($d['team_season_ids']);
        $groupIds = array_key_exists('group_ids', $d) ? (array)$d['group_ids'] : null;
        unset($d['group_ids']);
        $boolFields = ['post_to_public_calendar', 'mentor_coverage_met', 'requires_logistics', 'fundraising_opportunity', 'is_informational', 'is_tentative', 'volunteer_open', 'quicktrack_enabled'];
        $allowed = ['name', 'event_date', 'start_time', 'end_time', 'location', 'details', 'event_type', 'is_informational', 'is_tentative', 'coordinator_id',
            'post_to_public_calendar', 'mentor1_id', 'mentor2_id', 'mentor_coverage_met', 'requires_logistics', 'fundraising_opportunity', 'event_url', 'end_date', 'benefits_season',
            'meeting_mode', 'remote_url', 'remote_details', 'volunteer_open', 'quicktrack_enabled'];
        // Absolute-ize link fields so they never render as a path relative to the event page.
        if (array_key_exists('remote_url', $d)) $d['remote_url'] = self::normalizeUrl($d['remote_url']);
        if (array_key_exists('event_url', $d)) $d['event_url'] = self::normalizeUrl($d['event_url']);
        // benefits_season is nullable: an empty value clears it (back to in-season).
        // Track a CHANGE so the fundraising team links can follow it (below).
        $newBenefits = null;
        if (array_key_exists('benefits_season', $d)) {
            $newBenefits = ($d['benefits_season'] ?? '') === '' ? null : (string)$d['benefits_season'];
            $set[] = 'benefits_season = ?'; $args[] = $newBenefits;
            unset($d['benefits_season']);
        }
        $benefitsChanged = $newBenefits !== null && $newBenefits !== ($cur['benefits_season'] ?? null);
        // Default check-in activities are nullable: empty string = "no default" (NULL).
        foreach (['default_area_youth', 'default_area_adult', 'default_area_parent'] as $af) {
            if (array_key_exists($af, $d)) {
                $set[] = "$af = ?"; $args[] = ($d[$af] ?? '') === '' ? null : $d[$af];
                unset($d[$af]);
            }
        }
        // Volunteer sign-up link/note are nullable: empty string clears them.
        foreach (['volunteer_signup_url', 'volunteer_signup_note'] as $vf) {
            if (array_key_exists($vf, $d)) {
                $set[] = "$vf = ?"; $args[] = ($d[$vf] ?? '') === '' ? null : $d[$vf];
                unset($d[$vf]);
            }
        }
        foreach ($allowed as $f) {
            if ($f === 'benefits_season') continue;
            if (array_key_exists($f, $d) && $d[$f] !== null) {
                $set[] = "$f = ?";
                $args[] = in_array($f, $boolFields, true) ? (int)(bool)$d[$f] : $d[$f];
            }
        }
        // mentor coverage auto-set
        $m1 = $d['mentor1_id'] ?? $cur['mentor1_id']; $m2 = $d['mentor2_id'] ?? $cur['mentor2_id'];
        if ($m1 && $m2) { $set[] = "mentor_coverage_met = ?"; $args[] = 1; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE events SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        // Retagging which season a fundraiser benefits moves its team links onto that
        // season's team-seasons, so the earnings land in the right season's budgets
        // instead of silently staying on last season's.
        if ($benefitsChanged) {
            $rp = FundraisingController::repointTeamsToSeason($pdo, $id, (string)$newBenefits, (int)$m['id']);
            if ($rp['links'] > 0 || $rp['choices'] > 0) {
                Audit::write($pdo, (int)$m['id'], 'event_fundraising_teams', $id, 'update', null,
                    ['repointed_to_season' => $newBenefits, 'teams_moved' => $rp['links'], 'youth_choices_moved' => $rp['choices']]);
            }
        }
        if ($teamIds !== null) self::syncTeamLinks($pdo, $id, $d['event_type'] ?? $cur['event_type'], (array)$teamIds);
        if ($groupIds !== null) self::syncGroups($pdo, $id, $groupIds);
        $fresh = self::load($pdo, $id);
        if ($fresh['requires_logistics'] && !$fresh['has_log']) $pdo->prepare("INSERT INTO event_logistics (event_id) VALUES (?)")->execute([$id]);
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'events', $id, 'update', null, $d);
        return Http::json($res, self::serialize($pdo, self::load($pdo, $id)));
    }

    /**
     * Remove the child rows that would otherwise BLOCK an event delete. Most
     * children cascade or null automatically, but a few are ON DELETE NO ACTION
     * (checkins, event_participants, and the logistics chain
     * event_logistics → hotel_rooms → hotel_room_assignments); event_groups has no
     * enforced FK and would orphan. We clear those here, deepest first. Rows on
     * SET NULL (time_entries, reservations, camp_sessions, inv_checkouts,
     * season_deadlines) keep their data and just lose the event link, so logged
     * hours / financial records survive the deletion.
     */
    private static function purgeEventChildren(PDO $pdo, array $ids): void
    {
        if (!$ids) return;
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->prepare("DELETE hra FROM hotel_room_assignments hra
                        JOIN hotel_rooms hr ON hr.id = hra.room_id
                        JOIN event_logistics el ON el.id = hr.logistics_id
                       WHERE el.event_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE hr FROM hotel_rooms hr
                        JOIN event_logistics el ON el.id = hr.logistics_id
                       WHERE el.event_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM event_logistics WHERE event_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM checkins WHERE event_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM event_participants WHERE event_id IN ($in)")->execute($ids);
        $pdo->prepare("DELETE FROM event_groups WHERE event_id IN ($in)")->execute($ids);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::mgr($pdo, $req, [])) { if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']); }
        $id = (int)$route['event_id'];
        $ev = self::load($pdo, $id);
        if (!$ev) return Http::error($res, 'Event not found', 404);
        $pdo->beginTransaction();
        try {
            self::purgeEventChildren($pdo, [$id]);
            $pdo->prepare("DELETE FROM events WHERE id = ?")->execute([$id]);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('[TRCMS] event delete failed for ' . $id . ': ' . $e->getMessage());
            return Http::error($res, 'Could not delete this event — it may still be linked to other records.', 409);
        }
        // Snapshot the deleted event so the audit log shows WHAT was deleted, not just its id.
        // (The audit row's own created_at is the deletion timestamp; we also keep the event's
        // original created_at here so both the created and deleted dates are visible together.)
        $snapshot = ['name' => $ev['name'] ?? null, 'event_date' => $ev['event_date'] ?? null,
            'start_time' => $ev['start_time'] ?? null, 'event_type' => $ev['event_type'] ?? null,
            'location' => $ev['location'] ?? null, 'created_at' => $ev['created_at'] ?? null];
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'events', $id, 'delete', $snapshot, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Attendance ───────────────────────────────────────────────────────
    /** Build one attendance roster row from a member's info + (optional) check-in aggregate. */
    private static function attRow(int $mid, array $info, ?array $ci, ?string $section, bool $walkIn): array
    {
        $secs = $ci ? (int)$ci['secs'] : 0;
        return [
            'member_id' => $mid,
            'first_name' => $info['first_name'], 'last_name' => $info['last_name'],
            'member_type' => $info['member_type'], 'member_number' => $info['member_number'], 'photo_url' => $info['photo_url'],
            'section_label' => $section,
            'present' => $ci !== null,
            'walk_in' => $walkIn,
            'still_in' => $ci ? (bool)$ci['still_in'] : false,
            'hours' => round($secs / 3600, 2),
        ];
    }

    public static function attendance(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        if (!self::load($pdo, $eid)) return Http::error($res, 'Event not found', 404);

        // Expected attendees (RSVP'd "Attending").
        $ps = $pdo->prepare("SELECT ep.section_label, m.id, m.first_name, m.last_name, m.member_type, m.member_number, m.photo_url
                             FROM event_participants ep JOIN members m ON m.id = ep.member_id
                             WHERE ep.event_id = ? AND ep.status = 'Attending' AND (m.is_system = 0 OR m.is_system IS NULL)");
        $ps->execute([$eid]);

        // Everyone who actually checked in — including walk-ins not on the RSVP
        // list — with total time on site. Open sessions count up to now. All
        // timestamps are UTC (checkins.time_in/out + UTC_TIMESTAMP()).
        $cs = $pdo->prepare(
            "SELECT c.member_id, m.first_name, m.last_name, m.member_type, m.member_number, m.photo_url,
                    SUM(TIMESTAMPDIFF(SECOND, c.time_in, COALESCE(c.time_out, UTC_TIMESTAMP()))) AS secs,
                    COUNT(*) AS sessions,
                    MAX(CASE WHEN c.time_out IS NULL THEN 1 ELSE 0 END) AS still_in
             FROM checkins c JOIN members m ON m.id = c.member_id
             WHERE c.event_id = ? AND c.member_id IS NOT NULL AND (m.is_system = 0 OR m.is_system IS NULL)
             GROUP BY c.member_id, m.first_name, m.last_name, m.member_type, m.member_number, m.photo_url"
        );
        $cs->execute([$eid]);
        $checkins = [];
        foreach ($cs->fetchAll() as $r) $checkins[(int)$r['member_id']] = $r;

        $roster = []; $seen = [];
        foreach ($ps->fetchAll() as $p) {
            $mid = (int)$p['id']; $seen[$mid] = true;
            $roster[] = self::attRow($mid, $p, $checkins[$mid] ?? null, $p['section_label'], false);
        }
        // Walk-ins: checked in but never on the expected list.
        foreach ($checkins as $mid => $r) {
            if (isset($seen[$mid])) continue;
            $roster[] = self::attRow((int)$mid, $r, $r, 'Walk-In', true);
        }

        // Outside-volunteer privacy (mirrors the RSVP list): a volunteer sees no roster;
        // anyone without events.view_volunteers sees it with outside volunteers removed.
        // Filter both the roster and the check-in map so the totals stay consistent.
        $hideVolunteers = ($cur['member_type'] ?? '') === 'volunteer'
            || !Permissions::memberCan($pdo, $cur, 'events.view_volunteers', 'read');
        if (($cur['member_type'] ?? '') === 'volunteer') {
            $roster = []; $checkins = [];
        } elseif ($hideVolunteers) {
            $roster = array_values(array_filter($roster, fn ($r) => ($r['member_type'] ?? '') !== 'volunteer'));
            $checkins = array_filter($checkins, fn ($r) => ($r['member_type'] ?? '') !== 'volunteer');
        }

        usort($roster, fn($a, $b) => [!$a['present'], strtolower((string)$a['last_name'])] <=> [!$b['present'], strtolower((string)$b['last_name'])]);

        $expectedCount = count(array_filter($roster, fn($r) => !$r['walk_in']));
        $expectedPresent = count(array_filter($roster, fn($r) => $r['present'] && !$r['walk_in']));
        $totalSecs = 0; foreach ($checkins as $r) $totalSecs += (int)$r['secs'];

        // Break the total hours down by member-type category (+ grand total).
        $hoursByType = ['youth' => 0.0, 'mentor' => 0.0, 'parent' => 0.0, 'volunteer' => 0.0];
        foreach ($roster as $r) {
            $t = $r['member_type'];
            if (!array_key_exists($t, $hoursByType)) $hoursByType[$t] = 0.0;
            $hoursByType[$t] += (float)$r['hours'];
        }
        foreach ($hoursByType as $k => $v) $hoursByType[$k] = round($v, 2);

        return Http::json($res, [
            'event_id' => $eid,
            'total_attending' => $expectedCount,                       // expected (RSVP'd)
            'present_count' => count(array_filter($roster, fn($r) => $r['present'])), // actually checked in (incl. walk-ins)
            'absent_count' => max(0, $expectedCount - $expectedPresent),
            'walk_in_count' => count(array_filter($roster, fn($r) => $r['walk_in'])),
            'total_hours' => round($totalSecs / 3600, 2),
            'hours_by_type' => $hoursByType,
            'roster' => $roster,
        ]);
    }

    // ── Logistics ────────────────────────────────────────────────────────
    private static function serializeRoom(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'room_label' => $r['room_label'], 'room_number' => $r['room_number'],
            'room_type' => $r['room_type'], 'room_rate' => $r['room_rate'] !== null ? (float)$r['room_rate'] : null,
            'max_occupants' => $r['max_occupants'] !== null ? (int)$r['max_occupants'] : null,
            'confirmation_number' => $r['confirmation_number'], 'canceled' => (bool)$r['canceled'],
            'cancellation_number' => $r['cancellation_number'], 'paid_by_trc' => (bool)$r['paid_by_trc'],
            'reimbursement_amount' => $r['reimbursement_amount'] !== null ? (float)$r['reimbursement_amount'] : null,
            'reimbursement_by_id' => $r['reimbursement_by_id'] !== null ? (int)$r['reimbursement_by_id'] : null,
            'reimbursement_date' => $r['reimbursement_date'], 'reimbursement_method' => $r['reimbursement_method'],
            'reimbursement_reference' => $r['reimbursement_reference'],
        ];
    }

    private static function serializeLogistics(PDO $pdo, array $lg): array
    {
        $rs = $pdo->prepare("SELECT * FROM hotel_rooms WHERE logistics_id = ? ORDER BY id"); $rs->execute([(int)$lg['id']]);
        $rooms = [];
        foreach ($rs->fetchAll() as $r) {
            $room = self::serializeRoom($r);
            $as = $pdo->prepare("SELECT hra.id, hra.member_id, m.first_name, m.last_name
                                 FROM hotel_room_assignments hra
                                 LEFT JOIN members m ON m.id = hra.member_id
                                 WHERE hra.room_id = ? ORDER BY m.last_name, m.first_name, hra.id");
            $as->execute([(int)$r['id']]);
            $room['assignments'] = array_map(fn($a) => [
                'id' => (int)$a['id'], 'member_id' => (int)$a['member_id'],
                'member_name' => trim((string)$a['first_name'] . ' ' . (string)$a['last_name']) ?: ('Member #' . (int)$a['member_id']),
            ], $as->fetchAll());
            $rooms[] = $room;
        }
        $i = fn($k) => $lg[$k] !== null ? (int)$lg[$k] : null;
        $f = fn($k) => ($lg[$k] !== null && $lg[$k] !== '') ? (float)$lg[$k] : null;
        return [
            'id' => (int)$lg['id'], 'event_id' => (int)$lg['event_id'], 'logistics_lead_id' => $i('logistics_lead_id'),
            'destination_address' => $lg['destination_address'], 'meetup_location' => $lg['meetup_location'],
            'meetup_address' => $lg['meetup_address'], 'meetup_time' => $lg['meetup_time'], 'num_days' => $i('num_days'),
            'travel_required' => $lg['travel_required'] !== null ? (bool)$lg['travel_required'] : null, 'travel_lead_id' => $i('travel_lead_id'),
            'participating_teams' => $lg['participating_teams'] ? json_decode($lg['participating_teams'], true) : [],
            'housing_needed' => $lg['housing_needed'] !== null ? (bool)$lg['housing_needed'] : null, 'housing_arranger_id' => $i('housing_arranger_id'),
            'official_hotel_name' => $lg['official_hotel_name'], 'hotel_address_line1' => $lg['hotel_address_line1'],
            'hotel_address_line2' => $lg['hotel_address_line2'], 'hotel_city' => $lg['hotel_city'], 'hotel_state' => $lg['hotel_state'],
            'hotel_zip' => $lg['hotel_zip'], 'hotel_contact_name' => $lg['hotel_contact_name'], 'hotel_contact_phone' => $lg['hotel_contact_phone'],
            'hotel_contact_email' => $lg['hotel_contact_email'], 'equipment_lead_id' => $i('equipment_lead_id'),
            'meal_coordinator_id' => $i('meal_coordinator_id'), 'budget_per_meal' => $f('budget_per_meal'),
            'total_meal_budget' => $f('total_meal_budget'), 'youth_meal_contribution' => $f('youth_meal_contribution'),
            'youth_meals_responsible_for' => $i('youth_meals_responsible_for'), 'meal_notes' => $lg['meal_notes'] ?? null,
            'equipment_checklist' => $lg['equipment_checklist'] ? json_decode($lg['equipment_checklist'], true) : [],
            'hotel_rooms' => $rooms,
        ];
    }

    private static function loadLogistics(PDO $pdo, int $eventId): ?array
    {
        $s = $pdo->prepare("SELECT * FROM event_logistics WHERE event_id = ?"); $s->execute([$eventId]);
        return $s->fetch() ?: null;
    }

    public static function getLogistics(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $lg = self::loadLogistics($pdo, (int)$route['event_id']);
        if (!$lg) return Http::error($res, 'No logistics record for this event', 404);
        return Http::json($res, self::serializeLogistics($pdo, $lg));
    }

    private const LOGISTICS_INT = ['logistics_lead_id', 'num_days', 'travel_lead_id', 'housing_arranger_id',
        'equipment_lead_id', 'meal_coordinator_id', 'youth_meals_responsible_for'];
    private const LOGISTICS_BOOL = ['travel_required', 'housing_needed'];
    private const LOGISTICS_JSON = ['participating_teams', 'equipment_checklist'];
    private const LOGISTICS_FIELDS = ['logistics_lead_id', 'destination_address', 'meetup_location', 'meetup_address',
        'meetup_time', 'num_days', 'travel_required', 'travel_lead_id', 'participating_teams', 'housing_needed',
        'housing_arranger_id', 'official_hotel_name', 'hotel_address_line1', 'hotel_address_line2', 'hotel_city',
        'hotel_state', 'hotel_zip', 'hotel_contact_name', 'hotel_contact_phone', 'hotel_contact_email',
        'equipment_lead_id', 'meal_coordinator_id', 'budget_per_meal', 'total_meal_budget', 'youth_meal_contribution',
        'youth_meals_responsible_for', 'meal_notes', 'equipment_checklist'];

    public static function upsertLogistics(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $eid = (int)$route['event_id'];
        $lg = self::loadLogistics($pdo, $eid);
        if (!$lg) {
            $pdo->prepare("INSERT INTO event_logistics (event_id) VALUES (?)")->execute([$eid]);
            $lg = self::loadLogistics($pdo, $eid);
        }
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::LOGISTICS_FIELDS as $f) {
            if (!array_key_exists($f, $d) || $d[$f] === null) continue;
            $v = $d[$f];
            if (in_array($f, self::LOGISTICS_INT, true)) $v = (int)$v;
            elseif (in_array($f, self::LOGISTICS_BOOL, true)) $v = (int)(bool)$v;
            elseif (in_array($f, self::LOGISTICS_JSON, true)) $v = json_encode($v);
            $set[] = "$f = ?"; $args[] = $v;
        }
        if ($set) { $args[] = (int)$lg['id']; $pdo->prepare("UPDATE event_logistics SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'event_logistics', (int)$lg['id'], 'update', null, $d);
        return Http::json($res, self::serializeLogistics($pdo, self::loadLogistics($pdo, $eid)));
    }

    // ── Hotel rooms ──────────────────────────────────────────────────────
    public static function addRoom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $lg = self::loadLogistics($pdo, (int)$route['event_id']);
        if (!$lg) return Http::error($res, 'No logistics record for this event', 404);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO hotel_rooms (logistics_id, room_label, room_type, room_rate, max_occupants, confirmation_number, paid_by_trc, canceled)
                              VALUES (?, ?, ?, ?, ?, ?, ?, false)");
        $ins->execute([(int)$lg['id'], $d['room_label'] ?? '', $d['room_type'] ?? null, $d['room_rate'] ?? null,
            isset($d['max_occupants']) ? (int)$d['max_occupants'] : null, $d['confirmation_number'] ?? null,
            (int)(bool)($d['paid_by_trc'] ?? true)]);
        $rid = (int)$pdo->lastInsertId();
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'hotel_rooms', $rid, 'create', null, $d);
        $rs = $pdo->prepare("SELECT * FROM hotel_rooms WHERE id = ?"); $rs->execute([$rid]);
        return Http::json($res, self::serializeRoom($rs->fetch()), 201);
    }

    private const ROOM_FIELDS = ['room_label', 'room_number', 'room_type', 'room_rate', 'max_occupants', 'confirmation_number',
        'canceled', 'cancellation_number', 'paid_by_trc', 'reimbursement_amount', 'reimbursement_by_id', 'reimbursement_date',
        'reimbursement_method', 'reimbursement_reference'];
    private const ROOM_INT = ['max_occupants', 'reimbursement_by_id'];
    private const ROOM_BOOL = ['canceled', 'paid_by_trc'];

    public static function updateRoom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $id = (int)$route['room_id'];
        $rs = $pdo->prepare("SELECT 1 FROM hotel_rooms WHERE id = ?"); $rs->execute([$id]);
        if (!$rs->fetch()) return Http::error($res, 'Room not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::ROOM_FIELDS as $f) {
            if (!array_key_exists($f, $d) || $d[$f] === null) continue;
            $v = $d[$f];
            if (in_array($f, self::ROOM_INT, true)) $v = (int)$v;
            elseif (in_array($f, self::ROOM_BOOL, true)) $v = (int)(bool)$v;
            $set[] = "$f = ?"; $args[] = $v;
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE hotel_rooms SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'hotel_rooms', $id, 'update', null, $d);
        $r2 = $pdo->prepare("SELECT * FROM hotel_rooms WHERE id = ?"); $r2->execute([$id]);
        return Http::json($res, self::serializeRoom($r2->fetch()));
    }

    public static function assignRoom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $rid = (int)$route['room_id'];
        $rs = $pdo->prepare("SELECT 1 FROM hotel_rooms WHERE id = ?"); $rs->execute([$rid]);
        if (!$rs->fetch()) return Http::error($res, 'Room not found', 404);
        $mid = (int)(($req->getParsedBody()['member_id']) ?? 0);
        $ex = $pdo->prepare("SELECT 1 FROM hotel_room_assignments WHERE room_id = ? AND member_id = ?"); $ex->execute([$rid, $mid]);
        if ($ex->fetch()) return Http::error($res, 'Member already assigned to this room', 400);
        $pdo->prepare("INSERT INTO hotel_room_assignments (room_id, member_id) VALUES (?, ?)")->execute([$rid, $mid]);
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'hotel_room_assignments', (int)$pdo->lastInsertId(), 'create', null, ['room_id' => $rid, 'member_id' => $mid]);
        return Http::json($res, ['ok' => true]);
    }

    public static function removeFromRoom(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $a = $pdo->prepare("SELECT id FROM hotel_room_assignments WHERE room_id = ? AND member_id = ?");
        $a->execute([(int)$route['room_id'], (int)$route['member_id']]);
        $row = $a->fetch();
        if (!$row) return Http::error($res, 'Assignment not found', 404);
        $pdo->prepare("DELETE FROM hotel_room_assignments WHERE id = ?")->execute([(int)$row['id']]);
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'hotel_room_assignments', (int)$row['id'], 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * GET /events/{event_id}/participants/room-assignments
     * Map of member_id (string) → room label for everyone assigned to a hotel
     * room on this event, so the Participants pane can flag who still needs one.
     * Joins assignments → rooms → logistics so it covers ALL of the event's rooms
     * (this endpoint was previously missing, which is why assigned people showed
     * "No room assigned").
     */
    public static function roomAssignments(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $s = $pdo->prepare(
            "SELECT hra.member_id, hr.room_label, hr.room_number
             FROM hotel_room_assignments hra
             JOIN hotel_rooms hr ON hr.id = hra.room_id
             JOIN event_logistics el ON el.id = hr.logistics_id
             WHERE el.event_id = ? AND (hr.canceled = 0 OR hr.canceled IS NULL)"
        );
        $s->execute([$eid]);
        $map = [];
        foreach ($s->fetchAll() as $r) {
            $label = ($r['room_label'] !== null && $r['room_label'] !== '')
                ? $r['room_label']
                : ($r['room_number'] ? ('Room ' . $r['room_number']) : 'Assigned');
            $map[(string)(int)$r['member_id']] = $label;
        }
        return Http::json($res, $map);
    }

    // ── Recurring events ─────────────────────────────────────────────────
    private static function generateDates(string $start, array $o): array
    {
        $dates = []; $cur = $start;
        $pattern = $o['pattern'] ?? 'weekly'; $interval = max((int)($o['interval'] ?? 1), 1);
        $endType = $o['end_type'] ?? 'occurrences';
        $advance = function (string $d) use ($pattern, $interval): string {
            $t = strtotime($d);
            if ($pattern === 'daily' || $pattern === 'custom') return date('Y-m-d', strtotime("+$interval day", $t));
            if ($pattern === 'weekly') return date('Y-m-d', strtotime("+$interval week", $t));
            if ($pattern === 'biweekly') return date('Y-m-d', strtotime("+2 week", $t));
            if ($pattern === 'monthly') {
                [$y, $mo, $day] = array_map('intval', explode('-', $d));
                $mo2 = $mo + 1; $y2 = $y + intdiv($mo2 - 1, 12); $mo2 = (($mo2 - 1) % 12) + 1;
                $maxDay = (int)date('t', strtotime(sprintf('%04d-%02d-01', $y2, $mo2)));
                return sprintf('%04d-%02d-%02d', $y2, $mo2, min($day, $maxDay));
            }
            return date('Y-m-d', strtotime("+1 week", $t));
        };
        if ($endType === 'occurrences') {
            $n = min((int)($o['occurrences'] ?? 52) ?: 52, 52);
            for ($k = 0; $k < $n; $k++) { $dates[] = $cur; $cur = $advance($cur); }
        } elseif ($endType === 'until_date' && !empty($o['until_date'])) {
            while ($cur <= $o['until_date'] && count($dates) < 52) { $dates[] = $cur; $cur = $advance($cur); }
        }
        return $dates;
    }

    private static function recurrenceDescription(array $o, int $count): string
    {
        $interval = (int)($o['interval'] ?? 1); $s = $interval !== 1 ? 's' : '';
        $labels = [
            'daily' => "Daily (every {$interval} day{$s})", 'weekly' => "Weekly (every {$interval} week{$s})",
            'biweekly' => 'Every 2 weeks', 'monthly' => 'Monthly', 'custom' => "Every {$interval} day{$s}",
        ];
        $label = $labels[$o['pattern'] ?? ''] ?? ($o['pattern'] ?? '');
        if (($o['end_type'] ?? '') === 'until_date' && !empty($o['until_date'])) return "{$label}, until {$o['until_date']} ({$count} occurrences)";
        return "{$label}, {$count} occurrences";
    }

    private static function uuid4(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40); $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    public static function createRecurring(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $d = (array)$req->getParsedBody();
        $rec = (array)($d['recurrence'] ?? []);
        $dates = self::generateDates($d['event_date'] ?? date('Y-m-d'), $rec);
        if (!$dates) return Http::error($res, 'Recurrence options produced no dates. Check your end condition.', 400);
        $groupId = self::uuid4();
        $description = self::recurrenceDescription($rec, count($dates));
        $coverage = (!empty($d['mentor1_id']) && !empty($d['mentor2_id'])) ? 1 : 0;
        $teamIds = $d['team_season_ids'] ?? null;
        $createdIds = [];
        foreach ($dates as $i => $eventDate) {
            // Same column set as a single event (buildEventRow), plus the recurrence fields —
            // so every setting (quick tracking, meeting mode, default areas, volunteers, etc.)
            // and the team/group links carry onto each occurrence instead of being dropped.
            $row = self::buildEventRow($d, $coverage) + [
                'is_recurring' => 1,
                'recurrence_group_id' => $groupId,
                'recurrence_description' => $description,
                'recurrence_index' => $i + 1,
            ];
            $row['event_date'] = $eventDate;   // override per occurrence
            $cols = array_keys($row);
            $ins = $pdo->prepare("INSERT INTO events (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")");
            $ins->execute(array_values($row));
            $eid = (int)$pdo->lastInsertId();
            if ($teamIds !== null) self::syncTeamLinks($pdo, $eid, $d['event_type'] ?? null, (array)$teamIds);
            if (array_key_exists('group_ids', $d)) self::syncGroups($pdo, $eid, (array)$d['group_ids']);
            if (!empty($d['requires_logistics'])) $pdo->prepare("INSERT INTO event_logistics (event_id) VALUES (?)")->execute([$eid]);
            $createdIds[] = $eid;
        }
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'events', $createdIds[0] ?? null, 'create',
            null, ['recurring' => true, 'recurrence_group_id' => $groupId, 'count' => count($createdIds), 'name' => $d['name'] ?? null]);
        return Http::json($res, ['ok' => true, 'recurrence_group_id' => $groupId, 'description' => $description,
            'count' => count($dates), 'event_ids' => $createdIds, 'first_date' => $dates[0], 'last_date' => $dates[count($dates) - 1]], 201);
    }

    public static function getRecurrenceGroup(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $stmt = $pdo->prepare(self::BASE . " WHERE e.recurrence_group_id = ? ORDER BY e.event_date, e.start_time");
        $stmt->execute([$route['group_id']]);
        $rows = $stmt->fetchAll();
        if (!$rows) return Http::error($res, 'Recurrence group not found', 404);
        return Http::json($res, array_map(fn($e) => self::serialize($pdo, $e), $rows));
    }

    public static function deleteRecurrenceGroup(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $g = self::mgr($pdo, $req, []); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $gid = $route['group_id'];
        $from = $req->getQueryParams()['from_date'] ?? null;
        $where = "recurrence_group_id = ?"; $args = [$gid];
        if ($from) { $where .= " AND event_date >= ?"; $args[] = $from; }
        $idStmt = $pdo->prepare("SELECT id, name, event_date FROM events WHERE $where ORDER BY event_date"); $idStmt->execute($args);
        $rows = $idStmt->fetchAll();
        $ids = array_map('intval', array_column($rows, 'id'));
        $deleted = count($ids);
        $eventName = $rows[0]['name'] ?? null;   // the series name, for the audit log
        if ($ids) {
            $pdo->beginTransaction();
            try {
                self::purgeEventChildren($pdo, $ids);
                $in = implode(',', array_fill(0, count($ids), '?'));
                $pdo->prepare("DELETE FROM events WHERE id IN ($in)")->execute($ids);
                $pdo->commit();
            } catch (\Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                error_log('[TRCMS] recurring event delete failed for group ' . $gid . ': ' . $e->getMessage());
                return Http::error($res, 'Could not delete these events — some may still be linked to other records.', 409);
            }
        }
        Audit::write($pdo, isset($g['member']) ? (int)$g['member']['id'] : null, 'events', null, 'delete',
            ['name' => $eventName, 'recurrence_group_id' => $gid, 'deleted' => $deleted],
            ['recurring' => true, 'recurrence_group_id' => $gid, 'deleted' => $deleted]);
        return Http::json($res, ['ok' => true, 'deleted' => $deleted]);
    }

    public static function previewRecurrence(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $startDate = $req->getQueryParams()['start_date'] ?? null;
        if (!$startDate) return Http::error($res, 'start_date is required', 422);
        $o = (array)$req->getParsedBody();
        $dates = self::generateDates($startDate, $o);
        return Http::json($res, [
            'count' => count($dates), 'dates' => $dates, 'description' => self::recurrenceDescription($o, count($dates)),
            'first_date' => $dates[0] ?? null, 'last_date' => $dates ? $dates[count($dates) - 1] : null,
        ]);
    }
}
