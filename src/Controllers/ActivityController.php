<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/activity/router.py (prefix /api/v1/activity). */
final class ActivityController
{
    private const ITEM_TYPES = ['activity', 'task'];
    // A single time entry covers one day, so it can't exceed 24 hours. Guards against a
    // mistyped hours/minutes value (e.g. a stray 101,098-hour entry).
    private const MAX_ENTRY_MIN = 1440;
    private const TOO_LONG_MSG = "A single entry can't be more than 24 hours — please check the value (split multi-day time into separate days).";
    private const ATTENDED = ['attending', 'attended', 'going', 'present', 'yes'];

    /** A single check-in session can't exceed a day; a forgotten checkout closed days later must
     *  not inflate presence totals (mirrors MAX_ENTRY_MIN for manual entries). */
    public const MAX_CHECKIN_MIN = 1440;

    /**
     * SQL expression for one completed check-in's credited minutes: floored at 0 (guards a
     * time_out earlier than time_in) and capped at a day. Use inside SUM(...) wherever check-in
     * presence is totaled, so a single bad row can't balloon the report/My Time.
     */
    public static function checkinMinutesSql(string $alias = 'c'): string
    {
        return "LEAST(GREATEST(TIMESTAMPDIFF(MINUTE, {$alias}.time_in, {$alias}.time_out), 0), " . self::MAX_CHECKIN_MIN . ")";
    }

    // ── helpers ──────────────────────────────────────────────────────────
    private static function isVolunteerMember(array $m): bool
    {
        return in_array($m['member_type'], ['mentor', 'volunteer'], true);
    }

    /**
     * UTC [start, end] timestamps spanning a local (org timezone) calendar date
     * 'YYYY-MM-DD'. Check-in time_in is stored in UTC, so matching on the naive
     * UTC DATE() drops evening check-ins that fall on the next UTC day — which is
     * most TRC meetings. Reckon the day locally, like CheckinController does.
     */
    private static function localDayWindow(string $date): array
    {
        $tz = new \DateTimeZone(Config::get('APP_TIMEZONE', 'America/Chicago') ?: 'America/Chicago');
        $s = new \DateTime($date . ' 00:00:00', $tz); $s->setTimezone(new \DateTimeZone('UTC'));
        $e = new \DateTime($date . ' 23:59:59', $tz); $e->setTimezone(new \DateTimeZone('UTC'));
        return [$s->format('Y-m-d H:i:s'), $e->format('Y-m-d H:i:s')];
    }

    /**
     * A time entry NOT tied to a check-in (and not tied to an event) risks double-counting
     * the member's check-in time for that day: the check-in already auto-logs its own hours.
     * Returns a warning (to confirm) when the member has a check-in on the entry's local day
     * — flagged as a precise clock overlap when the entry carries start/end times that fall
     * inside a check-in window — or null when there's nothing to warn about. Purely advisory;
     * the caller decides whether to block until acknowledged.
     */
    private static function checkinConflict(PDO $pdo, int $memberId, string $date, ?string $startTime, ?string $endTime): ?array
    {
        [$dayStart, $dayEnd] = self::localDayWindow($date);
        $cs = $pdo->prepare(
            "SELECT time_in, time_out FROM checkins
              WHERE member_id = ? AND time_out IS NOT NULL AND time_in <= ? AND time_out >= ?
              ORDER BY time_in");
        $cs->execute([$memberId, $dayEnd, $dayStart]);
        $rows = $cs->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) return null;

        $tz = new \DateTimeZone(Config::get('APP_TIMEZONE', 'America/Chicago') ?: 'America/Chicago');
        $utc = new \DateTimeZone('UTC');
        $entryStartUtc = $entryEndUtc = null;
        if ($startTime && $endTime) {
            $entryStartUtc = (new \DateTime("$date " . substr($startTime, 0, 8), $tz))->setTimezone($utc)->format('Y-m-d H:i:s');
            $entryEndUtc   = (new \DateTime("$date " . substr($endTime, 0, 8), $tz))->setTimezone($utc)->format('Y-m-d H:i:s');
        }

        $totalMin = 0; $windows = []; $precise = false;
        foreach ($rows as $r) {
            $ti = new \DateTime($r['time_in'], $utc); $to = new \DateTime($r['time_out'], $utc);
            $totalMin += max(0, (int)round(($to->getTimestamp() - $ti->getTimestamp()) / 60));
            // Overlap when the entry's window intersects the check-in's (UTC string compare is chronological).
            if ($entryStartUtc !== null && $r['time_in'] < $entryEndUtc && $r['time_out'] > $entryStartUtc) $precise = true;
            $windows[] = (clone $ti)->setTimezone($tz)->format('g:i') . '–' . (clone $to)->setTimezone($tz)->format('g:i A');
        }
        $windowStr = implode(', ', $windows);
        $hrs = rtrim(rtrim(number_format($totalMin / 60, 1), '0'), '.');
        $msg = $precise
            ? "This overlaps a check-in you already have that day ($windowStr) — that time is already counted. Tag it to the check-in instead, or log it anyway if it's genuinely separate."
            : "You were checked in that day ($windowStr, {$hrs}h already logged). Make sure this isn't the same time before logging it.";
        return ['message' => $msg, 'checkin_minutes' => $totalMin, 'windows' => $windows, 'precise_overlap' => $precise];
    }

    private static function configList(PDO $pdo, string $cat, array $default): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?"); $s->execute([$cat]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        return (is_array($v) && $v) ? $v : $default;
    }

    private static function volunteerAreas(PDO $pdo): array
    {
        return array_map('strtolower', self::configList($pdo, 'volunteer_areas_outreach', ['Outreach']));
    }

    private static function deriveIsVolunteer(PDO $pdo, array $member, ?string $area): bool
    {
        if (self::isVolunteerMember($member)) return true;
        return $area !== null && $area !== '' && in_array(strtolower($area), self::volunteerAreas($pdo), true);
    }

    private static function canManage(PDO $pdo, array $cur): bool
    {
        return Permissions::memberCan($pdo, $cur, 'activity.manage', 'write');
    }

    /** Returns null on allowed, or an error Response on denied. */
    private static function requireAccess(PDO $pdo, array $cur, int $memberId, Response $res, bool $needLog = false): ?Response
    {
        if ((int)$cur['id'] === $memberId) {
            if ($needLog && !Permissions::memberCan($pdo, $cur, 'activity.log', 'write')) {
                return Http::error($res, "You don't have permission to log time.", 403);
            }
            return null;
        }
        if (!self::canManage($pdo, $cur)) {
            return Http::error($res, "You don't have permission to manage others' time.", 403);
        }
        return null;
    }

    private static function seasonFor(PDO $pdo, string $entryDate, ?int $teamSeasonId): string
    {
        if ($teamSeasonId) {
            $s = $pdo->prepare("SELECT season FROM team_seasons WHERE id = ?"); $s->execute([$teamSeasonId]);
            $r = $s->fetch();
            if ($r && $r['season']) return $r['season'];
        }
        // #193: time buckets on the post-Worlds cutover (May), so off-season/summer hours roll
        // into the new season. Enrollment's July boundary is unaffected.
        [$y, $mo] = [(int)substr($entryDate, 0, 4), (int)substr($entryDate, 5, 2)];
        $yy = $mo >= EnrollmentService::TIME_SEASON_START_MONTH ? $y : $y - 1;
        return $yy . '-' . ($yy + 1);
    }

    private static function rollupPlanning(PDO $pdo, ?string $itemType, ?int $itemId): void
    {
        if (!$itemType || !$itemId) return;
        $s = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS t FROM time_entries WHERE item_type = ? AND item_id = ?");
        $s->execute([$itemType, $itemId]);
        $total = (int)$s->fetch()['t'];
        $table = $itemType === 'activity' ? 'season_activities' : ($itemType === 'task' ? 'team_tasks' : null);
        if ($table) $pdo->prepare("UPDATE $table SET actual_minutes = ? WHERE id = ?")->execute([$total, $itemId]);
    }

    private static function serialize(array $e): array
    {
        $min = (int)($e['minutes'] ?? 0);
        return [
            'id' => (int)$e['id'], 'member_id' => (int)$e['member_id'],
            'entry_date' => $e['entry_date'], 'season' => $e['season'],
            'minutes' => $min, 'hours' => round($min / 60, 2), 'area' => $e['area'],
            'entry_method' => $e['entry_method'] ?? null,
            'start_time' => $e['start_time'] ? substr($e['start_time'], 0, 5) : null,
            'end_time' => $e['end_time'] ? substr($e['end_time'], 0, 5) : null,
            'is_volunteer' => (bool)$e['is_volunteer'],
            'team_season_id' => $e['team_season_id'] !== null ? (int)$e['team_season_id'] : null,
            'source' => $e['source'], 'checkin_id' => $e['checkin_id'] !== null ? (int)$e['checkin_id'] : null,
            'event_id' => $e['event_id'] !== null ? (int)$e['event_id'] : null,
            'item_type' => $e['item_type'], 'item_id' => $e['item_id'] !== null ? (int)$e['item_id'] : null,
            'notes' => $e['notes'], 'verified' => (bool)$e['verified'],
        ];
    }

    /** "HH:MM[:SS]" → minutes since midnight, or null if unparseable. */
    private static function hhmmToMin(?string $t): ?int
    {
        if (!$t || !preg_match('/^(\d{1,2}):(\d{2})/', trim($t), $mm)) return null;
        $h = (int)$mm[1]; $m = (int)$mm[2];
        if ($h > 23 || $m > 59) return null;
        return $h * 60 + $m;
    }

    /**
     * Resolve a duration from a payload: a start/stop time RANGE, decimal HOURS,
     * or raw minutes (back-compat). Returns
     * [minutes, entry_method|null, start_time|null, end_time|null, errorString|null].
     */
    private static function resolveDuration(array $d): array
    {
        $hasRange = !empty($d['start_time']) && !empty($d['end_time']);
        if ($hasRange) {
            $sm = self::hhmmToMin((string)$d['start_time']);
            $em = self::hhmmToMin((string)$d['end_time']);
            if ($sm === null || $em === null) return [0, null, null, null, 'Enter a valid start and end time.'];
            $min = $em - $sm;
            if ($min <= 0) return [0, null, null, null, 'The end time must be after the start time.'];
            $norm = fn($t) => substr((string)$t, 0, 5) . ':00';
            return [$min, 'range', $norm($d['start_time']), $norm($d['end_time']), null];
        }
        if (isset($d['hours']) && $d['hours'] !== '' && $d['hours'] !== null) {
            $min = (int)round(((float)$d['hours']) * 60);
            if ($min <= 0) return [0, null, null, null, 'Hours must be greater than zero.'];
            if ($min > self::MAX_ENTRY_MIN) return [0, null, null, null, self::TOO_LONG_MSG];
            return [$min, 'hours', null, null, null];
        }
        if (isset($d['minutes']) && $d['minutes'] !== '' && $d['minutes'] !== null) {
            $min = (int)$d['minutes'];
            if ($min <= 0) return [0, null, null, null, 'Time must be greater than zero.'];
            if ($min > self::MAX_ENTRY_MIN) return [0, null, null, null, self::TOO_LONG_MSG];
            return [$min, 'hours', null, null, null];
        }
        return [0, null, null, null, 'Enter hours, or a start and end time.'];
    }

    /**
     * Reject an implausible entry date: a future date (catches year typos like 2061) or one
     * absurdly far in the past. Returns null when the date is fine.
     */
    private static function dateSanityError(?string $date): ?string
    {
        $t = strtotime((string)$date);
        if ($t === false) return 'Enter a valid date.';
        if ($t > strtotime(date('Y-m-d') . ' 23:59:59')) return "That date is in the future — please check the date (a common typo is the year).";
        if ($t < strtotime('2015-01-01')) return "That date looks wrong — please check the year.";
        return null;
    }

    /**
     * A person can't be present more than 24 hours in a single day, so their total logged time for
     * one date can't exceed 24h. Sums existing minutes for (member, date) — optionally excluding an
     * entry being edited — and returns an error when adding $addMin would push the day over 24h.
     * Prevents one member stacking many 24-hour entries onto the same date.
     */
    private static function dayCapError(PDO $pdo, int $memberId, string $date, int $addMin, ?int $excludeId = null): ?string
    {
        $sql = "SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE member_id = ? AND entry_date = ?";
        $args = [$memberId, $date];
        if ($excludeId) { $sql .= " AND id <> ?"; $args[] = $excludeId; }
        $st = $pdo->prepare($sql); $st->execute($args);
        $existing = (int)$st->fetchColumn();
        if ($existing + $addMin > self::MAX_ENTRY_MIN) {
            $remain = max(0, self::MAX_ENTRY_MIN - $existing);
            $rh = rtrim(rtrim(number_format($remain / 60, 2), '0'), '.');
            return $remain > 0
                ? "That would put more than 24 hours of logged time on one day for this member. At most {$rh} more hours can be logged for {$date}."
                : "This date ({$date}) already has 24 hours logged for this member — no more can be added.";
        }
        return null;
    }

    /** Insert one time_entry from a normalized field set; returns the new id. */
    private static function insertEntry(PDO $pdo, array $member, array $f): int
    {
        $ins = $pdo->prepare("INSERT INTO time_entries
            (member_id, entry_date, season, minutes, area, entry_method, start_time, end_time, is_volunteer,
             team_season_id, source, checkin_id, event_id, item_type, item_id, notes, created_by_member_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())");
        $ins->execute([
            (int)$member['id'], $f['entry_date'], $f['season'], $f['minutes'], $f['area'],
            $f['entry_method'], $f['start_time'], $f['end_time'],
            (int)self::deriveIsVolunteer($pdo, $member, $f['area']),
            $f['team_season_id'], $f['source'], $f['checkin_id'], $f['event_id'],
            $f['item_type'], $f['item_id'], $f['notes'], (int)$f['actor_id'],
        ]);
        return (int)$pdo->lastInsertId();
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM time_entries WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function sessionMinutes(?string $in, ?string $out): int
    {
        if (!$in || !$out) return 0;
        return max(0, (int)floor((strtotime($out) - strtotime($in)) / 60));
    }

    /**
     * Auto-create a time-log entry from a completed check-in using the activity
     * area captured at check-in (event default check-in activities feature).
     * No-op when the area is empty ("no default" — e.g. a parent just hanging out),
     * or when the session has no elapsed time, or an entry already exists for this
     * check-in. Returns the number of minutes logged (0 = nothing logged).
     */
    public static function logCheckinActivity(PDO $pdo, array $checkin, array $member): int
    {
        $area = trim((string)($checkin['activity_area'] ?? ''));
        if ($area === '') return 0;
        $minutes = self::sessionMinutes($checkin['time_in'] ?? null, $checkin['time_out'] ?? null);
        if ($minutes <= 0) return 0;
        $cid = (int)$checkin['id'];
        $ex = $pdo->prepare("SELECT COUNT(*) FROM time_entries WHERE checkin_id = ?");
        $ex->execute([$cid]);
        if ((int)$ex->fetchColumn() > 0) {
            // Already partly tagged (the member logged categories): don't add a
            // second full-session row, but still capture any uncategorized remainder
            // so the whole session is recorded (#160).
            $rid = self::captureCheckinRemainder($pdo, $member, $cid, (int)$member['id']);
            if (!$rid) return 0;
            $r = self::load($pdo, $rid);
            return (int)($r['minutes'] ?? 0);
        }
        $edate = $checkin['time_in'] ? substr($checkin['time_in'], 0, 10) : date('Y-m-d');
        $ins = $pdo->prepare("INSERT INTO time_entries (member_id, entry_date, season, minutes, area, is_volunteer, source, checkin_id, event_id, created_by_member_id, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, 'checkin', ?, ?, ?, NOW(), NOW())");
        $ins->execute([(int)$member['id'], $edate, self::seasonFor($pdo, $edate, null), $minutes, $area,
            (int)self::deriveIsVolunteer($pdo, $member, $area), $cid,
            $checkin['event_id'] !== null ? (int)$checkin['event_id'] : null, (int)$member['id']]);
        return $minutes;
    }

    /**
     * How much of a check-in's session is still unallocated.
     *
     * "Allocated" counts only real categorized entries — the uncategorized remainder
     * row (#160) is leftover time, not a claim on it, so categorizing part of it must
     * be allowed. Returns null when the check-in doesn't constrain anything (still
     * checked in, missing, or a zero-length session); callers treat null as "no cap".
     *
     * @return array{session:int,allocated:int,available:int}|null
     */
    private static function checkinCapacity(PDO $pdo, int $checkinId, ?int $excludeEntryId = null): ?array
    {
        $cs = $pdo->prepare("SELECT time_in, time_out FROM checkins WHERE id = ?");
        $cs->execute([$checkinId]);
        $ci = $cs->fetch();
        if (!$ci || empty($ci['time_out'])) return null;
        $session = self::sessionMinutes($ci['time_in'], $ci['time_out']);
        if ($session <= 0) return null;

        $sql = "SELECT COALESCE(SUM(minutes),0) FROM time_entries
                 WHERE checkin_id = ? AND COALESCE(notes, '') <> ?";
        $args = [$checkinId, self::REMAINDER_NOTE];
        if ($excludeEntryId !== null) { $sql .= " AND id <> ?"; $args[] = $excludeEntryId; }
        $ss = $pdo->prepare($sql); $ss->execute($args);
        $allocated = (int)$ss->fetchColumn();

        return ['session' => $session, 'allocated' => $allocated,
                'available' => max(0, $session - $allocated)];
    }

    /**
     * The over-allocation response. 422 with the numbers the UI needs to tell the
     * person what happened and reset the field to what's actually left.
     */
    private static function overAllocated(Response $res, int $wanted, array $cap): Response
    {
        $fmt = fn (int $m) => rtrim(rtrim(number_format($m / 60, 2, '.', ''), '0'), '.');
        $detail = 'That is more time than the check-in covers. The check-in is '
            . $fmt($cap['session']) . ' hours'
            . ($cap['allocated'] > 0 ? ', with ' . $fmt($cap['allocated']) . ' already logged to other activities' : '')
            . ', so at most ' . $fmt($cap['available']) . ' hours can be added here.';
        return Http::json($res, [
            'detail' => $detail,
            'error' => 'checkin_time_exceeded',
            'requested_minutes' => $wanted,
            'session_minutes' => $cap['session'],
            'allocated_minutes' => $cap['allocated'],
            'available_minutes' => $cap['available'],
        ], 422);
    }

    /** Marks the auto-added leftover row from #160. One place so queries agree. */
    private const REMAINDER_NOTE = 'Remaining check-in time (uncategorized)';

    /**
     * Minutes of grace on the check-in capacity cap. Session length is floor()'d
     * while a logged duration is round()'d, so a member logging "the whole session"
     * could land 1 minute over and hit a confusing "0.02 hours can be added" error.
     * This absorbs that rounding sliver on the manual add/split path (the primary
     * classify flow — classifyCheckin — is cap-free and unaffected).
     */
    private const CHECKIN_CAP_GRACE = 2;

    /**
     * #160: guarantee a check-in's FULL session time is captured, no more and no less.
     * Clears any previous remainder row, then re-adds one for whatever the categorized
     * entries don't cover, so presence time is never dropped AND categorizing more of
     * the leftover shrinks it instead of double-counting. No-op while still checked in
     * or when the session is empty. Returns the new entry id, or null if none added.
     */
    private static function captureCheckinRemainder(PDO $pdo, array $member, int $checkinId, int $actorId): ?int
    {
        $cs = $pdo->prepare("SELECT time_in, time_out, activity_area, event_id FROM checkins WHERE id = ?");
        $cs->execute([$checkinId]);
        $ci = $cs->fetch();
        if (!$ci || empty($ci['time_out'])) return null;
        $session = self::sessionMinutes($ci['time_in'], $ci['time_out']);
        if ($session <= 0) return null;

        // Drop the old leftover row first — it is derived, never edited by hand.
        $pdo->prepare("DELETE FROM time_entries WHERE checkin_id = ? AND COALESCE(notes, '') = ?")
            ->execute([$checkinId, self::REMAINDER_NOTE]);

        $ss = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE checkin_id = ?");
        $ss->execute([$checkinId]);
        $remainder = $session - (int)$ss->fetchColumn();
        if ($remainder <= 0) return null;
        $edate = !empty($ci['time_in']) ? substr((string)$ci['time_in'], 0, 10) : date('Y-m-d');
        return self::insertEntry($pdo, $member, [
            'entry_date' => $edate, 'season' => self::seasonFor($pdo, $edate, null),
            'minutes' => $remainder, 'area' => (trim((string)($ci['activity_area'] ?? '')) ?: null),
            'entry_method' => null, 'start_time' => null, 'end_time' => null,
            'team_season_id' => null, 'source' => 'checkin', 'checkin_id' => $checkinId,
            'event_id' => $ci['event_id'] !== null ? (int)$ci['event_id'] : null,
            'item_type' => null, 'item_id' => null,
            'notes' => self::REMAINDER_NOTE, 'actor_id' => $actorId,
        ]);
    }

    /**
     * The single shared list of activity/support areas used by ALL member types.
     * One-time self-healing merge: the first time this runs after deploy, it folds
     * the legacy "mentor_support_areas" list into "activity_areas" (de-duped,
     * case-insensitive, order preserved) and removes the legacy row, so admins
     * manage one list going forward. Uses each environment's own data — nothing
     * hardcoded — so it's safe on dev and prod alike.
     */
    private static function mergedActivityAreas(PDO $pdo): array
    {
        $read = function (string $cat) use ($pdo): ?array {
            $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
            $s->execute([$cat]);
            $r = $s->fetch();
            $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
            return is_array($v) ? $v : null;
        };
        $activity = $read('activity_areas');
        $mentor   = $read('mentor_support_areas');

        if ($mentor === null) {
            return $activity ?: ['Design', 'Build', 'Programming', 'Other'];
        }

        // Merge legacy mentor list into activity_areas (activity items first).
        $base = $activity ?: ['Design', 'Build', 'Programming', 'Other'];
        $seen = [];
        $merged = [];
        foreach (array_merge($base, $mentor) as $x) {
            $x = trim((string)$x);
            $key = strtolower($x);
            if ($x === '' || isset($seen[$key])) continue;
            $seen[$key] = true; $merged[] = $x;
        }
        $has = $pdo->prepare("SELECT id FROM system_config WHERE category = 'activity_areas'"); $has->execute();
        if ($has->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, label = 'Activity Areas', updated_at = NOW() WHERE category = 'activity_areas'")
                ->execute([json_encode($merged)]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('activity_areas', 'Activity Areas', ?)")
                ->execute([json_encode($merged)]);
        }
        $pdo->prepare("DELETE FROM system_config WHERE category = 'mentor_support_areas'")->execute();
        return $merged;
    }

    // ── Areas ────────────────────────────────────────────────────────────
    public static function areas(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = $req->getQueryParams()['member_id'] ?? null;
        $target = $cur;
        if ($mid) {
            $s = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $s->execute([(int)$mid]);
            $t = $s->fetch(); if ($t) $target = $t;
        }
        $isVol = self::isVolunteerMember($target);
        // Everyone now shares ONE activity-area list (youth, parents, volunteers,
        // mentors). is_volunteer_member is still returned for the reporting label.
        $areas = self::mergedActivityAreas($pdo);
        return Http::json($res, ['areas' => $areas, 'is_volunteer_member' => $isVol]);
    }

    // ── Seasons ──────────────────────────────────────────────────────────
    public static function seasons(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT DISTINCT season FROM time_entries WHERE season IS NOT NULL")->fetchAll();
        $seasons = array_filter(array_column($rows, 'season'));
        rsort($seasons);
        return Http::json($res, array_values($seasons));
    }

    // ── Member entries ───────────────────────────────────────────────────
    public static function memberEntries(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($d = self::requireAccess($pdo, $cur, $mid, $res)) return $d;
        $q = $req->getQueryParams();
        $sql = "SELECT * FROM time_entries WHERE member_id = ?"; $args = [$mid];
        if (!empty($q['season'])) { $sql .= " AND season = ?"; $args[] = $q['season']; }
        if (!empty($q['from_date'])) { $sql .= " AND entry_date >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $sql .= " AND entry_date <= ?"; $args[] = $q['to_date']; }
        $sql .= " ORDER BY entry_date DESC, id DESC";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, array_map([self::class, 'serialize'], $s->fetchAll()));
    }

    public static function createEntry(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        if ($err = self::requireAccess($pdo, $cur, $mid, $res, true)) return $err;
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$mid]);
        $member = $ms->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);
        [$minutes, $method, $startTime, $endTime, $durErr] = self::resolveDuration($d);
        if ($durErr) return Http::error($res, $durErr, 400);
        $itemType = $d['item_type'] ?? null;
        if ($itemType && !in_array($itemType, self::ITEM_TYPES, true)) {
            return Http::error($res, 'item_type must be one of ' . json_encode(self::ITEM_TYPES), 400);
        }
        $checkinId = $d['checkin_id'] ?? null; $eventId = $d['event_id'] ?? null;
        // Activity time tied to a check-in can never exceed what that check-in covers.
        if ($checkinId && ($cap = self::checkinCapacity($pdo, (int)$checkinId)) && $minutes > $cap['available'] + self::CHECKIN_CAP_GRACE) {
            return self::overAllocated($res, $minutes, $cap);
        }
        $source = $checkinId ? 'checkin' : ($eventId ? 'event' : 'manual');
        $edate = $d['entry_date'];
        // Reject a nonsense date (future / year typo) and cap total logged time at 24h/day.
        if ($de = self::dateSanityError($edate)) return Http::error($res, $de, 400);
        if ($ce = self::dayCapError($pdo, $mid, $edate, $minutes)) return Http::error($res, $ce, 400);
        // Guard against double-counting check-in time: a free (untied, non-event) entry on a
        // day the member was already checked in must be acknowledged before it's saved.
        if (!$checkinId && !$eventId && empty($d['acknowledge_overlap'])
            && ($conflict = self::checkinConflict($pdo, $mid, $edate, $startTime, $endTime))) {
            return Http::json($res, ['error' => 'checkin_overlap', 'needs_confirm' => true,
                'detail' => $conflict['message'], 'checkin_minutes' => $conflict['checkin_minutes'],
                'windows' => $conflict['windows'], 'precise_overlap' => $conflict['precise_overlap']], 409);
        }
        $tsid = $d['team_season_id'] ?? null;
        $area = ($d['area'] ?? null) ?: null;
        $id = self::insertEntry($pdo, $member, [
            'entry_date' => $edate, 'season' => self::seasonFor($pdo, $edate, $tsid ? (int)$tsid : null),
            'minutes' => $minutes, 'area' => $area, 'entry_method' => $method, 'start_time' => $startTime, 'end_time' => $endTime,
            'team_season_id' => $tsid ? (int)$tsid : null, 'source' => $source,
            'checkin_id' => $checkinId ? (int)$checkinId : null, 'event_id' => $eventId ? (int)$eventId : null,
            'item_type' => $itemType, 'item_id' => isset($d['item_id']) ? (int)$d['item_id'] : null,
            'notes' => ($d['notes'] ?? null) ?: null, 'actor_id' => (int)$cur['id'],
        ]);
        $e = self::load($pdo, $id);
        if ($checkinId) self::captureCheckinRemainder($pdo, $member, (int)$checkinId, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'time_entries', $id, 'create', null, $d);
        self::rollupPlanning($pdo, $e['item_type'], $e['item_id'] !== null ? (int)$e['item_id'] : null);
        return Http::json($res, self::serialize($e), 201);
    }

    /**
     * POST /activity/entries/bulk — log a whole daily timesheet at once: one date
     * (and optional check-in/event/team), with multiple sub-entries, each its own
     * area, duration (hours or start/stop), and comment.
     * Body: { member_id, entry_date, checkin_id?, event_id?, team_season_id?,
     *         entries: [ { area, hours? | start_time?+end_time? | minutes?, notes?, item_type?, item_id? } ] }
     */
    public static function createEntries(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        if ($err = self::requireAccess($pdo, $cur, $mid, $res, true)) return $err;
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$mid]);
        $member = $ms->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);
        $edate = $d['entry_date'] ?? date('Y-m-d');
        $tsid = !empty($d['team_season_id']) ? (int)$d['team_season_id'] : null;
        $checkinId = !empty($d['checkin_id']) ? (int)$d['checkin_id'] : null;
        $eventId = !empty($d['event_id']) ? (int)$d['event_id'] : null;
        $rows = is_array($d['entries'] ?? null) ? $d['entries'] : [];
        if (!$rows) return Http::error($res, 'Add at least one activity to log.', 400);

        // Validate every row first so the whole timesheet succeeds or fails together.
        $prepared = [];
        foreach ($rows as $i => $row) {
            $row = (array)$row;
            [$min, $method, $st, $et, $rErr] = self::resolveDuration($row);
            if ($rErr) return Http::error($res, "Activity " . ($i + 1) . ": $rErr", 400);
            $itemType = $row['item_type'] ?? null;
            if ($itemType && !in_array($itemType, self::ITEM_TYPES, true)) return Http::error($res, 'Invalid item_type.', 400);
            $prepared[] = [
                'entry_date' => $edate, 'season' => self::seasonFor($pdo, $edate, $tsid),
                'minutes' => $min, 'area' => ($row['area'] ?? null) ?: null,
                'entry_method' => $method, 'start_time' => $st, 'end_time' => $et,
                'team_season_id' => $tsid, 'source' => $checkinId ? 'checkin' : ($eventId ? 'event' : 'manual'),
                'checkin_id' => $checkinId, 'event_id' => $eventId,
                'item_type' => $itemType, 'item_id' => isset($row['item_id']) ? (int)$row['item_id'] : null,
                'notes' => ($row['notes'] ?? null) ?: null, 'actor_id' => (int)$cur['id'],
            ];
        }
        // Reject a nonsense date, and cap the whole timesheet so one day can't exceed 24 hours.
        if ($de = self::dateSanityError($edate)) return Http::error($res, $de, 400);
        if ($ce = self::dayCapError($pdo, $mid, $edate, (int)array_sum(array_column($prepared, 'minutes')))) return Http::error($res, $ce, 400);
        // The whole timesheet is checked against the check-in together — logging three
        // rows that each fit but together overrun is the same mistake.
        if ($checkinId && ($cap = self::checkinCapacity($pdo, $checkinId))) {
            $wanted = array_sum(array_column($prepared, 'minutes'));
            if ($wanted > $cap['available'] + self::CHECKIN_CAP_GRACE) return self::overAllocated($res, $wanted, $cap);
        }
        // Untied timesheet on a day with a check-in → confirm before double-counting.
        if (!$checkinId && !$eventId && empty($d['acknowledge_overlap'])) {
            $conflict = null;
            foreach ($prepared as $f) {
                $c = self::checkinConflict($pdo, $mid, $f['entry_date'], $f['start_time'], $f['end_time']);
                if ($c) { $conflict = $c; if ($c['precise_overlap']) break; }
            }
            if ($conflict) {
                return Http::json($res, ['error' => 'checkin_overlap', 'needs_confirm' => true,
                    'detail' => $conflict['message'], 'checkin_minutes' => $conflict['checkin_minutes'],
                    'windows' => $conflict['windows'], 'precise_overlap' => $conflict['precise_overlap']], 409);
            }
        }
        $created = [];
        foreach ($prepared as $f) {
            $id = self::insertEntry($pdo, $member, $f);
            self::rollupPlanning($pdo, $f['item_type'], $f['item_id']);
            $created[] = self::serialize(self::load($pdo, $id));
        }
        // #160: capture any uncategorized remainder so the full check-in session is logged.
        if ($checkinId && ($rid = self::captureCheckinRemainder($pdo, $member, $checkinId, (int)$cur['id']))) {
            $created[] = self::serialize(self::load($pdo, $rid));
        }
        Audit::write($pdo, (int)$cur['id'], 'time_entries', $created[0]['id'] ?? null, 'create',
            null, ['bulk' => true, 'count' => count($created), 'entry_date' => $edate, 'checkin_id' => $checkinId]);
        return Http::json($res, $created, 201);
    }

    /**
     * GET /activity/member/{member_id}/checkins?date=YYYY-MM-DD — that member's
     * check-ins on a day (default today), so a daily log can be tied to one.
     */
    public static function checkinsForDay(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($err = self::requireAccess($pdo, $cur, $mid, $res)) return $err;
        $date = $req->getQueryParams()['date'] ?? date('Y-m-d');
        [$winStart, $winEnd] = self::localDayWindow($date);
        $s = $pdo->prepare("SELECT c.*, e.name AS event_name FROM checkins c
                            LEFT JOIN events e ON e.id = c.event_id
                            WHERE c.member_id = ? AND c.time_in BETWEEN ? AND ? ORDER BY c.time_in DESC");
        $s->execute([$mid, $winStart, $winEnd]);
        $out = [];
        foreach ($s->fetchAll() as $c) {
            $out[] = [
                'checkin_id' => (int)$c['id'],
                'event_id' => $c['event_id'] !== null ? (int)$c['event_id'] : null,
                'event_name' => $c['event_name'],
                'time_in' => Time::naiveIso($c['time_in']),
                'time_out' => $c['time_out'] ? Time::naiveIso($c['time_out']) : null,
                'open' => $c['time_out'] === null,
            ];
        }
        return Http::json($res, $out);
    }

    public static function editEntry(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $e = self::load($pdo, (int)$route['entry_id']);
        if (!$e) return Http::error($res, 'Entry not found', 404);
        if ($err = self::requireAccess($pdo, $cur, (int)$e['member_id'], $res)) return $err;
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([(int)$e['member_id']]);
        $member = $ms->fetch();
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        $newMinutes = null;   // set when the payload changes the duration
        $entryDate = $e['entry_date']; $tsid = $e['team_season_id'];
        if (array_key_exists('entry_date', $d) && $d['entry_date'] !== null) { $entryDate = $d['entry_date']; $set[] = 'entry_date = ?'; $args[] = $entryDate; }
        // Duration: accept a start/stop range, decimal hours, or raw minutes.
        if (array_key_exists('start_time', $d) || array_key_exists('end_time', $d)
            || array_key_exists('hours', $d) || array_key_exists('minutes', $d)) {
            [$min, $method, $st, $et, $durErr] = self::resolveDuration($d);
            if ($durErr) return Http::error($res, $durErr, 400);
            $newMinutes = $min;
            $set[] = 'minutes = ?'; $args[] = $min;
            $set[] = 'entry_method = ?'; $args[] = $method;
            $set[] = 'start_time = ?'; $args[] = $st;
            $set[] = 'end_time = ?'; $args[] = $et;
        }
        // Keep an edit from setting a nonsense date or pushing the member's day over 24h (excludes this row).
        if ($de = self::dateSanityError($entryDate)) return Http::error($res, $de, 400);
        if ($ce = self::dayCapError($pdo, (int)$e['member_id'], $entryDate, $newMinutes ?? (int)$e['minutes'], (int)$e['id'])) {
            return Http::error($res, $ce, 400);
        }
        if (array_key_exists('area', $d) && $d['area'] !== null) {
            $area = $d['area'] ?: null;
            $set[] = 'area = ?'; $args[] = $area;
            $set[] = 'is_volunteer = ?'; $args[] = (int)self::deriveIsVolunteer($pdo, $member, $area);
        }
        if (array_key_exists('team_season_id', $d)) {
            // Null/empty clears the team credit back to "just me".
            $tsid = !empty($d['team_season_id']) ? (int)$d['team_season_id'] : null;
            $set[] = 'team_season_id = ?'; $args[] = $tsid;
        }
        if (array_key_exists('notes', $d) && $d['notes'] !== null) { $set[] = 'notes = ?'; $args[] = $d['notes'] ?: null; }
        // Editing the auto-generated "remaining check-in time" leftover by hand (e.g. giving it an
        // activity/area) turns it into a real, classified entry — so clear the derived marker. Without
        // this, the remainder recompute below deletes the very row we just edited, and the reload comes
        // back null and crashes serialize(). (Only when the caller isn't already setting notes.)
        if (($e['notes'] ?? null) === self::REMAINDER_NOTE && !array_key_exists('notes', $d)) {
            $set[] = 'notes = ?'; $args[] = null;
        }
        // Tie (or untie) the entry to a check-in. Empty/null clears it back to manual.
        if (array_key_exists('checkin_id', $d)) {
            $cid = !empty($d['checkin_id']) ? (int)$d['checkin_id'] : null;
            $eid = null;
            if ($cid !== null) {
                $cs = $pdo->prepare("SELECT event_id FROM checkins WHERE id = ? AND member_id = ?");
                $cs->execute([$cid, (int)$e['member_id']]);
                $crow = $cs->fetch();
                if (!$crow) return Http::error($res, 'Check-in not found for this member.', 404);
                $eid = $crow['event_id'] !== null ? (int)$crow['event_id'] : null;
            }
            $set[] = 'checkin_id = ?'; $args[] = $cid;
            $set[] = 'event_id = ?'; $args[] = $eid;
            $set[] = 'source = ?'; $args[] = $cid ? 'checkin' : ($eid ? 'event' : 'manual');
        }
        if ((array_key_exists('entry_date', $d) && $d['entry_date'] !== null) || (array_key_exists('team_season_id', $d) && $d['team_season_id'] !== null)) {
            $set[] = 'season = ?'; $args[] = self::seasonFor($pdo, $entryDate, $tsid ? (int)$tsid : null);
        }
        // Same cap on the way in as on create: the edited duration, plus everything
        // else already logged to that check-in, must still fit the session. Excludes
        // this entry so editing 1h -> 1.5h is measured against the OTHER entries.
        $effCheckin = array_key_exists('checkin_id', $d)
            ? (!empty($d['checkin_id']) ? (int)$d['checkin_id'] : null)
            : ($e['checkin_id'] !== null ? (int)$e['checkin_id'] : null);
        $effMinutes = $newMinutes ?? (int)$e['minutes'];
        if ($effCheckin && ($cap = self::checkinCapacity($pdo, $effCheckin, (int)$e['id']))
            && $effMinutes > $cap['available'] + self::CHECKIN_CAP_GRACE) {
            return self::overAllocated($res, $effMinutes, $cap);
        }

        if ($set) {
            $set[] = 'updated_at = NOW()';
            $args[] = (int)$e['id'];
            $pdo->prepare("UPDATE time_entries SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$cur['id'], 'time_entries', (int)$e['id'], 'update', null, $d);
        // Leftover time is derived, so it has to be recomputed after any change --
        // including on the check-in this entry was moved OFF of.
        $oldCheckin = $e['checkin_id'] !== null ? (int)$e['checkin_id'] : null;
        foreach (array_unique(array_filter([$effCheckin, $oldCheckin])) as $cid2) {
            self::captureCheckinRemainder($pdo, $member, (int)$cid2, (int)$cur['id']);
        }
        $e2 = self::load($pdo, (int)$e['id']);
        if (!$e2) return Http::json($res, ['ok' => true, 'removed' => true]);   // absorbed by the remainder recompute
        self::rollupPlanning($pdo, $e2['item_type'], $e2['item_id'] !== null ? (int)$e2['item_id'] : null);
        return Http::json($res, self::serialize($e2));
    }

    public static function deleteEntry(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $e = self::load($pdo, (int)$route['entry_id']);
        if (!$e) return Http::error($res, 'Entry not found', 404);
        if ($err = self::requireAccess($pdo, $cur, (int)$e['member_id'], $res)) return $err;
        $itemType = $e['item_type']; $itemId = $e['item_id'] !== null ? (int)$e['item_id'] : null;
        $pdo->prepare("DELETE FROM time_entries WHERE id = ?")->execute([(int)$e['id']]);
        Audit::write($pdo, (int)$cur['id'], 'time_entries', (int)$e['id'], 'delete', null, null);
        if ($e['checkin_id'] !== null) {
            $ms2 = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms2->execute([(int)$e['member_id']]);
            if ($m2 = $ms2->fetch()) self::captureCheckinRemainder($pdo, $m2, (int)$e['checkin_id'], (int)$cur['id']);
        }
        self::rollupPlanning($pdo, $itemType, $itemId);
        return Http::json($res, ['ok' => true]);
    }

    public static function verifyEntry(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, "You don't have permission to verify time.", 403);
        $e = self::load($pdo, (int)$route['entry_id']);
        if (!$e) return Http::error($res, 'Entry not found', 404);
        $vq = $req->getQueryParams()['verified'] ?? 'true';
        $verified = filter_var($vq, FILTER_VALIDATE_BOOLEAN);
        $pdo->prepare("UPDATE time_entries SET verified = ?, verified_by_member_id = ? WHERE id = ?")
            ->execute([(int)$verified, $verified ? (int)$cur['id'] : null, (int)$e['id']]);
        Audit::write($pdo, (int)$cur['id'], 'time_entries', (int)$e['id'], 'verify', null, ['verified' => $verified]);
        return Http::json($res, self::serialize(self::load($pdo, (int)$e['id'])));
    }

    // ── Uncategorized check-in sessions ──────────────────────────────────
    public static function uncategorized(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($err = self::requireAccess($pdo, $cur, $mid, $res)) return $err;
        $cs = $pdo->prepare("SELECT c.*, e.name AS event_name FROM checkins c LEFT JOIN events e ON e.id = c.event_id
                             WHERE c.member_id = ? AND c.time_out IS NOT NULL ORDER BY c.time_in DESC");
        $cs->execute([$mid]);
        $alloc = [];
        $as = $pdo->prepare("SELECT checkin_id, COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE member_id = ? AND checkin_id IS NOT NULL GROUP BY checkin_id");
        $as->execute([$mid]);
        foreach ($as->fetchAll() as $r) $alloc[(int)$r['checkin_id']] = (int)$r['m'];
        $out = [];
        foreach ($cs->fetchAll() as $c) {
            $total = self::sessionMinutes($c['time_in'], $c['time_out']);
            $used = $alloc[(int)$c['id']] ?? 0;
            $remaining = $total - $used;
            if ($remaining <= 0) continue;
            $out[] = [
                'checkin_id' => (int)$c['id'],
                'date' => $c['time_in'] ? substr($c['time_in'], 0, 10) : null,
                'time_in' => Time::naiveIso($c['time_in']),
                'time_out' => Time::naiveIso($c['time_out']),
                'session_minutes' => $total, 'allocated_minutes' => $used, 'remaining_minutes' => $remaining,
                'event_id' => $c['event_id'] !== null ? (int)$c['event_id'] : null, 'event_name' => $c['event_name'],
            ];
        }
        return Http::json($res, $out);
    }

    public static function loggableEvents(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($err = self::requireAccess($pdo, $cur, $mid, $res)) return $err;
        $rows = $pdo->prepare("SELECT e.id, e.name, e.event_date, e.start_time, e.end_time, ep.status
                               FROM events e JOIN event_participants ep ON ep.event_id = e.id
                               WHERE ep.member_id = ? AND e.event_type LIKE '%outreach%' AND e.event_date <= ?");
        $rows->execute([$mid, date('Y-m-d')]);
        $lg = $pdo->prepare("SELECT DISTINCT event_id FROM time_entries WHERE member_id = ? AND event_id IS NOT NULL");
        $lg->execute([$mid]);
        $logged = array_map('intval', array_column($lg->fetchAll(), 'event_id'));
        $out = [];
        foreach ($rows->fetchAll() as $r) {
            if (!in_array(strtolower(trim((string)($r['status'] ?? ''))), self::ATTENDED, true)) continue;
            if (in_array((int)$r['id'], $logged, true)) continue;
            $out[] = ['event_id' => (int)$r['id'], 'name' => $r['name'],
                'date' => $r['event_date'], 'suggested_minutes' => self::eventMinutes($r['start_time'], $r['end_time'])];
        }
        return Http::json($res, $out);
    }

    private static function eventMinutes(?string $start, ?string $end): int
    {
        if ($start && $end) {
            $s = (int)substr($start, 0, 2) * 60 + (int)substr($start, 3, 2);
            $e = (int)substr($end, 0, 2) * 60 + (int)substr($end, 3, 2);
            if ($e > $s) return $e - $s;
        }
        return 120;
    }

    public static function tagCheckout(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $actor, 'activity.log', 'write')) return Http::error($res, 'Access denied', 403);
        $cid = (int)$route['checkin_id'];
        $cs = $pdo->prepare("SELECT * FROM checkins WHERE id = ?"); $cs->execute([$cid]);
        $c = $cs->fetch();
        if (!$c) return Http::error($res, 'Check-in not found', 404);
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([(int)$c['member_id']]);
        $member = $ms->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);
        // Capacity ignores the uncategorized leftover row, so tagging at checkout can
        // claim time that #160 had parked there rather than seeing "nothing remaining".
        $cap = self::checkinCapacity($pdo, $cid);
        $remaining = $cap ? $cap['available'] : 0;
        $d = (array)$req->getParsedBody();
        $req_min = isset($d['minutes']) ? (int)$d['minutes'] : 0;
        // Asking for more than the check-in covers is refused, not quietly trimmed --
        // the person should see what happened and correct it.
        if ($cap && $req_min > 0 && $req_min > $cap['available'] + self::CHECKIN_CAP_GRACE) {
            return self::overAllocated($res, $req_min, $cap);
        }
        $minutes = ($req_min > 0) ? $req_min : $remaining;
        if ($minutes <= 0) return Http::error($res, 'No remaining check-in time to log.', 400);
        $area = ($d['area'] ?? null) ?: null;
        $edate = $c['time_in'] ? substr($c['time_in'], 0, 10) : date('Y-m-d');
        $ins = $pdo->prepare("INSERT INTO time_entries (member_id, entry_date, season, minutes, area, is_volunteer, source, checkin_id, event_id, created_by_member_id, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, 'checkin', ?, ?, ?, NOW(), NOW())");
        $ins->execute([(int)$member['id'], $edate, self::seasonFor($pdo, $edate, null), $minutes, $area,
            (int)self::deriveIsVolunteer($pdo, $member, $area), $cid, $c['event_id'] !== null ? (int)$c['event_id'] : null, (int)$actor['id']]);
        $newId = (int)$pdo->lastInsertId();
        self::captureCheckinRemainder($pdo, $member, $cid, (int)$actor['id']);
        return Http::json($res, self::serialize(self::load($pdo, $newId)), 201);
    }

    /**
     * POST /activity/checkin/{checkin_id}/classify — set the category for a WHOLE
     * check-in's session in one step. This is how a member classifies an
     * "unclassified" check-in or re-labels one (e.g. summer-camp → outreach), on
     * ANY date. It replaces whatever is tied to the check-in with a single
     * full-session entry of the chosen area, so it is CAP-FREE by construction —
     * the entry always equals the session length and can never over/under-allocate
     * (which is what produced the confusing "0.02 hours can be added" errors).
     * An empty area clears it back to unclassified (the presence time still counts
     * via the check-in fallback in the summaries).
     */
    public static function classifyCheckin(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $cid = (int)$route['checkin_id'];
        $cs = $pdo->prepare("SELECT * FROM checkins WHERE id = ?"); $cs->execute([$cid]);
        $c = $cs->fetch();
        if (!$c) return Http::error($res, 'Check-in not found', 404);
        if ($err = self::requireAccess($pdo, $cur, (int)$c['member_id'], $res, true)) return $err;
        if (empty($c['time_out'])) return Http::error($res, 'This check-in is still open — check out before classifying its time.', 400);
        $session = self::sessionMinutes($c['time_in'], $c['time_out']);
        if ($session <= 0) return Http::error($res, 'This check-in has no elapsed time to classify.', 400);
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([(int)$c['member_id']]);
        $member = $ms->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);

        $area = trim((string)((array)$req->getParsedBody())['area'] ?? '');
        $area = $area !== '' ? $area : null;
        // Replace everything tied to this check-in with one full-session entry.
        $pdo->prepare("DELETE FROM time_entries WHERE checkin_id = ?")->execute([$cid]);
        if ($area === null) {
            Audit::write($pdo, (int)$cur['id'], 'checkins', $cid, 'classify_checkin', null, ['area' => null]);
            return Http::json($res, ['ok' => true, 'checkin_id' => $cid, 'area' => null, 'minutes' => 0, 'cleared' => true]);
        }
        $edate = $c['time_in'] ? substr((string)$c['time_in'], 0, 10) : date('Y-m-d');
        $id = self::insertEntry($pdo, $member, [
            'entry_date' => $edate, 'season' => self::seasonFor($pdo, $edate, null),
            'minutes' => $session, 'area' => $area, 'entry_method' => null, 'start_time' => null, 'end_time' => null,
            'team_season_id' => null, 'source' => 'checkin', 'checkin_id' => $cid,
            'event_id' => $c['event_id'] !== null ? (int)$c['event_id'] : null,
            'item_type' => null, 'item_id' => null, 'notes' => null, 'actor_id' => (int)$cur['id'],
        ]);
        Audit::write($pdo, (int)$cur['id'], 'time_entries', $id, 'classify_checkin', null, ['checkin_id' => $cid, 'area' => $area]);
        return Http::json($res, self::serialize(self::load($pdo, $id)), 201);
    }

    // ── Summaries ────────────────────────────────────────────────────────
    private static function byArea(array $rows): array
    {
        $out = [];
        foreach ($rows as $r) $out[$r['area'] ?: 'Uncategorized'] = (int)($r['m'] ?? 0);
        return $out;
    }

    public static function memberSummary(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($err = self::requireAccess($pdo, $cur, $mid, $res)) return $err;
        $q = $req->getQueryParams();
        $where = "member_id = ?"; $args = [$mid];
        if (!empty($q['season'])) { $where .= " AND season = ?"; $args[] = $q['season']; }
        if (!empty($q['from_date'])) { $where .= " AND entry_date >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where .= " AND entry_date <= ?"; $args[] = $q['to_date']; }
        $tot = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where"); $tot->execute($args);
        $vol = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where AND is_volunteer = true"); $vol->execute($args);
        $ba = $pdo->prepare("SELECT area, COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where GROUP BY area"); $ba->execute($args);
        $entryMin = (int)$tot->fetch()['m'];
        $volMin = (int)$vol->fetch()['m'];

        // Also count time from completed check-ins that haven't been separately
        // logged as an entry — so the My Time total matches the rows shown.
        [$cFrom, $cTo] = self::checkinWindow($q);
        $cArgs = [$mid];
        $cWhere = "c.member_id = ? AND c.time_out IS NOT NULL AND c.id NOT IN (SELECT checkin_id FROM time_entries WHERE checkin_id IS NOT NULL)";
        if ($cFrom) { $cWhere .= " AND c.time_in >= ?"; $cArgs[] = $cFrom; }
        if ($cTo)   { $cWhere .= " AND c.time_in <= ?"; $cArgs[] = $cTo; }
        $cs = $pdo->prepare("SELECT COALESCE(SUM(" . self::checkinMinutesSql('c') . "),0) AS m FROM checkins c WHERE $cWhere");
        $cs->execute($cArgs);
        $checkinMin = (int)$cs->fetch()['m'];

        // For mentors/volunteers, their presence time counts as community/volunteer time too.
        $ms = $pdo->prepare("SELECT member_type FROM members WHERE id = ?"); $ms->execute([$mid]);
        $isVolMember = in_array((string)$ms->fetchColumn(), ['mentor', 'volunteer'], true);

        $byArea = self::byArea($ba->fetchAll());
        if ($checkinMin > 0) $byArea['Check-ins'] = ($byArea['Check-ins'] ?? 0) + $checkinMin;

        return Http::json($res, ['member_id' => $mid,
            'total_minutes' => $entryMin + $checkinMin,
            'volunteer_minutes' => $volMin + ($isVolMember ? $checkinMin : 0),
            'checkin_minutes' => $checkinMin,
            'by_area' => (object)$byArea]);
    }

    /** Date window for counting check-ins in a summary: explicit from/to, else the season (SEASON_START_MONTH → day before next). */
    public static function checkinWindow(array $q): array
    {
        if (!empty($q['from_date']) || !empty($q['to_date'])) {
            return [!empty($q['from_date']) ? $q['from_date'] . ' 00:00:00' : null,
                    !empty($q['to_date']) ? $q['to_date'] . ' 23:59:59' : null];
        }
        if (!empty($q['season']) && preg_match('/^(\d{4})-(\d{4})$/', (string)$q['season'], $m)) {
            $gm = sprintf('%02d', EnrollmentService::SEASON_START_MONTH);
            $end = date('Y-m-d', strtotime($m[2] . "-$gm-01 -1 day"));
            return [$m[1] . "-$gm-01 00:00:00", $end . ' 23:59:59'];
        }
        return [null, null];
    }

    public static function teamSummary(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'activity.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $q = $req->getQueryParams();
        $where = "team_season_id = ?"; $args = [$tsid];
        if (!empty($q['from_date'])) { $where .= " AND entry_date >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where .= " AND entry_date <= ?"; $args[] = $q['to_date']; }
        $tot = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where"); $tot->execute($args);
        $vol = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where AND is_volunteer = true"); $vol->execute($args);
        $ba = $pdo->prepare("SELECT area, COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where GROUP BY area"); $ba->execute($args);
        // Who contributed the time (name + minutes), most hours first.
        $bm = $pdo->prepare("SELECT te.member_id AS id,
                                    TRIM(CONCAT(COALESCE(mm.first_name,''),' ',COALESCE(mm.last_name,''))) AS name,
                                    COALESCE(SUM(te.minutes),0) AS m,
                                    COALESCE(SUM(CASE WHEN te.is_volunteer THEN te.minutes ELSE 0 END),0) AS v
                             FROM time_entries te JOIN members mm ON mm.id = te.member_id
                             WHERE $where GROUP BY te.member_id, name ORDER BY m DESC, name");
        $bm->execute($args);
        $byMember = array_map(fn($r) => [
            'member_id' => (int)$r['id'],
            'name' => ($r['name'] !== '' ? $r['name'] : 'Member #' . $r['id']),
            'minutes' => (int)$r['m'],
            'volunteer_minutes' => (int)$r['v'],
        ], $bm->fetchAll());
        return Http::json($res, ['team_season_id' => $tsid, 'total_minutes' => (int)$tot->fetch()['m'],
            'volunteer_minutes' => (int)$vol->fetch()['m'], 'by_area' => (object)self::byArea($ba->fetchAll()),
            'contributors' => count($byMember), 'by_member' => $byMember]);
    }

    public static function orgImpact(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'activity.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = "1=1"; $args = [];
        if (!empty($q['season'])) { $where .= " AND season = ?"; $args[] = $q['season']; }
        if (!empty($q['from_date'])) { $where .= " AND entry_date >= ?"; $args[] = $q['from_date']; }
        if (!empty($q['to_date'])) { $where .= " AND entry_date <= ?"; $args[] = $q['to_date']; }
        $tot = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where"); $tot->execute($args);
        $vol = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where AND is_volunteer = true"); $vol->execute($args);
        $ba = $pdo->prepare("SELECT area, COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE $where GROUP BY area"); $ba->execute($args);
        $tq = "SELECT m.member_type, COALESCE(SUM(t.minutes),0) AS mins FROM members m JOIN time_entries t ON t.member_id = m.id WHERE $where GROUP BY m.member_type";
        $tr = $pdo->prepare($tq); $tr->execute($args);
        $byType = [];
        foreach ($tr->fetchAll() as $r) $byType[$r['member_type']] = (int)$r['mins'];
        return Http::json($res, ['total_minutes' => (int)$tot->fetch()['m'], 'volunteer_minutes' => (int)$vol->fetch()['m'],
            'by_area' => (object)self::byArea($ba->fetchAll()), 'by_member_type' => (object)$byType]);
    }
}
