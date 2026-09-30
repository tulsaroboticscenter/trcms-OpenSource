<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\FtcScout;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Scouting module — FTC-first competition scouting.
 *
 *  - Pre-event prediction is sourced from ftcscout.org (cached in scout_preevent_stats)
 *    and kept separate from live results (scout_live_stats) so it is never corrupted.
 *  - Human pit/match/observation scouting is captured with a client-generated UUID so
 *    offline devices can sync idempotently (INSERT ... ON DUPLICATE KEY UPDATE).
 *  - The season config (scout_seasons.config) drives the pit/match forms, so a new game
 *    is a new config row, not a code change. Game-specific answers live in `payload`.
 *
 * Permissions: scouting.scout (scouters submit + read), scouting.manage (set up events,
 * sync from ftcscout, ignore/consolidate reports, run analysis).
 *
 * DRAFT: analysis endpoints (reconcile, alliance modeling) are scoped stubs — they
 * depend on the reconciliation-rule config and modeling modes still being finalized.
 */
final class ScoutingController
{
    private const CONFIDENCE = ['low', 'medium', 'high', 'very_high'];

    // ─────────────────────────── helpers ───────────────────────────

    private static function canScout(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'scouting.scout', 'read');
    }

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'scouting.manage', 'write');
    }

    private static function uuid4(): string
    {
        $d = random_bytes(16);
        $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
        $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
    }

    private static function eventRow(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM scout_events WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function seasonRow(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM scout_seasons WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function jsonCol(mixed $v): mixed
    {
        return $v === null ? null : json_decode((string)$v, true);
    }

    /** Pre-event opr group from a stats column, tolerant of old (flat opr) and new ({opr,avg}) shapes. */
    private static function oprFrom(mixed $statsCol): array
    {
        $o = (array)self::jsonCol($statsCol);
        return (array)($o['opr'] ?? $o);
    }

    /** What the cached projections are based on: 'preview' (upcoming) or 'event_opr' (finished/training); null if none cached. */
    private static function projectionBasis(PDO $pdo, int $eid): ?string
    {
        $s = $pdo->prepare("SELECT stats FROM scout_preevent_stats WHERE scout_event_id=? AND stats IS NOT NULL LIMIT 1");
        $s->execute([$eid]);
        $row = $s->fetch();
        if (!$row) return null;
        return ((array)self::jsonCol($row['stats']))['source'] ?? 'preview';
    }

    // ─────────────────────────── season config ───────────────────────────

    /** GET /scouting/seasons — list season configs (active first). */
    public static function seasons(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM scout_seasons ORDER BY is_active DESC, season_year DESC, program")->fetchAll();
        return Http::json($res, ['items' => array_map([self::class, 'serializeSeason'], $rows)]);
    }

    /** GET /scouting/seasons/{season_id} */
    public static function getSeason(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $s = self::seasonRow($pdo, (int)$route['season_id']);
        if (!$s) return Http::error($res, 'Season not found', 404);
        return Http::json($res, self::serializeSeason($s));
    }

    /**
     * POST /scouting/seasons — create or update a season config (managers only).
     * Body: { id?, program, season_year, code, name, api_stats_type, config, is_active }.
     */
    public static function saveSeason(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        foreach (['season_year', 'code', 'name', 'config'] as $r) {
            if (!isset($d[$r]) || $d[$r] === '') return Http::error($res, "Missing field: $r", 422);
        }
        $config = is_string($d['config']) ? $d['config'] : json_encode($d['config'], JSON_UNESCAPED_SLASHES);
        if (json_decode($config) === null) return Http::error($res, 'config must be valid JSON', 422);
        $program = strtoupper((string)($d['program'] ?? 'FTC'));
        $args = [$program, (int)$d['season_year'], $d['code'], $d['name'], $d['api_stats_type'] ?? null, $config, (int)($d['is_active'] ?? 1)];

        if (!empty($d['id'])) {
            $pdo->prepare("UPDATE scout_seasons SET program=?, season_year=?, code=?, name=?, api_stats_type=?, config=?, is_active=?, updated_at=NOW() WHERE id=?")
                ->execute([...$args, (int)$d['id']]);
            $id = (int)$d['id'];
        } else {
            $pdo->prepare("INSERT INTO scout_seasons (program, season_year, code, name, api_stats_type, config, is_active) VALUES (?,?,?,?,?,?,?)")
                ->execute($args);
            $id = (int)$pdo->lastInsertId();
        }
        Audit::write($pdo, (int)$cur['id'], 'scout_season', $id, empty($d['id']) ? 'create' : 'update', null, ['code' => $d['code']]);
        return Http::json($res, self::serializeSeason(self::seasonRow($pdo, $id)), empty($d['id']) ? 201 : 200);
    }

    private static function serializeSeason(array $s): array
    {
        return [
            'id' => (int)$s['id'], 'program' => $s['program'], 'season_year' => (int)$s['season_year'],
            'code' => $s['code'], 'name' => $s['name'], 'api_stats_type' => $s['api_stats_type'],
            'config' => self::jsonCol($s['config']), 'is_active' => (bool)$s['is_active'],
            'created_at' => Time::naiveIso($s['created_at']), 'updated_at' => Time::naiveIso($s['updated_at']),
        ];
    }

    // ─────────────────────────── events + ftcscout sync ───────────────────────────

    /** GET /scouting/events — list scouted events (?active=1 to filter). */
    public static function listEvents(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $sql = "SELECT * FROM scout_events";
        $args = [];
        if (!empty($q['active'])) { $sql .= " WHERE is_active = 1"; }
        $sql .= " ORDER BY start_date DESC, name";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, ['items' => array_map([self::class, 'serializeEvent'], $s->fetchAll())]);
    }

    /** GET /scouting/events/{event_id} */
    public static function getEvent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $e = self::eventRow($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        return Http::json($res, self::serializeEvent($e, $pdo));
    }

    /** PATCH /scouting/events/{event_id} — update mutable event settings (managers only). */
    public static function patchEvent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $e = self::eventRow($pdo, $eid);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $d = (array)($req->getParsedBody() ?? []);
        if (array_key_exists('our_team_number', $d)) {
            $v = $d['our_team_number'] !== null && $d['our_team_number'] !== '' ? (int)$d['our_team_number'] : null;
            $pdo->prepare("UPDATE scout_events SET our_team_number=? WHERE id=?")->execute([$v, $eid]);
        }
        return Http::json($res, self::serializeEvent(self::eventRow($pdo, $eid), $pdo));
    }

    /**
     * POST /scouting/events — register an event to scout and pull its roster +
     * pre-event projections from ftcscout (managers only).
     * Body: { season_id, event_code }.
     */
    public static function createEvent(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $seasonId = (int)($d['season_id'] ?? 0);
        $code = trim((string)($d['event_code'] ?? ''));
        if (!$seasonId || $code === '') return Http::error($res, 'season_id and event_code are required', 422);
        $season = self::seasonRow($pdo, $seasonId);
        if (!$season) return Http::error($res, 'Season not found', 404);

        try {
            $bundle = FtcScout::eventBundle((int)$season['season_year'], $code, (string)$season['api_stats_type']);
        } catch (\Throwable $ex) {
            return Http::error($res, 'ftcscout lookup failed: ' . $ex->getMessage(), 502);
        }
        if (!$bundle) return Http::error($res, "Event '$code' not found on ftcscout", 404);

        $loc = $bundle['location'] ?? [];
        $training = !empty($d['training']) ? 1 : 0;   // #61: replay a finished event for practice
        $pdo->prepare("INSERT INTO scout_events (scout_season_id, event_code, name, division_code, city, state, start_date, end_date, is_training)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE name=VALUES(name), division_code=VALUES(division_code),
                         city=VALUES(city), state=VALUES(state), start_date=VALUES(start_date), end_date=VALUES(end_date), is_training=VALUES(is_training), updated_at=NOW()")
            ->execute([
                $seasonId, $bundle['code'], $bundle['name'] ?? $code, $bundle['divisionCode'] ?? null,
                $loc['city'] ?? null, $loc['state'] ?? null,
                isset($bundle['start']) ? substr((string)$bundle['start'], 0, 10) : null,
                isset($bundle['end']) ? substr((string)$bundle['end'], 0, 10) : null,
                $training,
            ]);
        $eventId = (int)$pdo->query("SELECT id FROM scout_events WHERE scout_season_id = $seasonId AND event_code = " . $pdo->quote($bundle['code']))->fetchColumn();

        [$teams, $stats] = self::cachePreEvent($pdo, $eventId, $bundle);
        Audit::write($pdo, (int)$cur['id'], 'scout_event', $eventId, 'create', null, ['code' => $code, 'teams' => $teams, 'projections' => $stats]);
        return Http::json($res, self::serializeEvent(self::eventRow($pdo, $eventId), $pdo) + ['synced_teams' => $teams, 'synced_projections' => $stats], 201);
    }

    /** POST /scouting/events/{event_id}/sync-preevent — refresh roster + pre-event projections. */
    public static function syncPreEvent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $e = self::eventRow($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $season = self::seasonRow($pdo, (int)$e['scout_season_id']);
        try {
            $bundle = FtcScout::eventBundle((int)$season['season_year'], $e['event_code'], (string)$season['api_stats_type']);
        } catch (\Throwable $ex) {
            return Http::error($res, 'ftcscout lookup failed: ' . $ex->getMessage(), 502);
        }
        if (!$bundle) return Http::error($res, 'Event no longer found on ftcscout', 404);
        [$teams, $stats] = self::cachePreEvent($pdo, (int)$e['id'], $bundle);
        return Http::json($res, ['ok' => true, 'synced_teams' => $teams, 'synced_projections' => $stats]);
    }

    /** Upsert roster + pre-event projections from an ftcscout event bundle. Returns [teamCount, statCount]. */
    private static function cachePreEvent(PDO $pdo, int $eventId, array $bundle): array
    {
        $teams = 0;
        $teamStmt = $pdo->prepare("INSERT INTO scout_event_teams (scout_event_id, team_number, team_name) VALUES (?,?,?)
                                   ON DUPLICATE KEY UPDATE team_name=VALUES(team_name), updated_at=NOW()");
        foreach (($bundle['teams'] ?? []) as $t) {
            $teamStmt->execute([$eventId, (int)$t['teamNumber'], $t['team']['name'] ?? null]);
            $teams++;
        }
        $stats = 0;
        $statStmt = $pdo->prepare("INSERT INTO scout_preevent_stats (scout_event_id, team_number, np_opr, stats, fetched_at) VALUES (?,?,?,?,NOW())
                                   ON DUPLICATE KEY UPDATE np_opr=VALUES(np_opr), stats=VALUES(stats), fetched_at=NOW()");
        // ftcscout only provides previewStats for UPCOMING events. For a finished event
        // (e.g. a training replay) previewStats is null, so fall back to the event's own
        // OPR as the projection baseline (tagged so the UI can say so).
        $preview = $bundle['previewStats'] ?? [];
        if ($preview) {
            $source = 'preview';
            $list = array_map(fn($p) => ['team' => (int)$p['teamNumber'], 'np' => $p['npOpr'] ?? null, 'stats' => $p['stats'] ?? null], $preview);
        } else {
            $source = 'event_opr';
            $list = array_map(fn($t) => ['team' => (int)$t['teamNumber'], 'np' => $t['stats']['opr']['totalPointsNp'] ?? null, 'stats' => $t['stats'] ?? null], $bundle['teams'] ?? []);
        }
        foreach ($list as $p) {
            if ($p['np'] === null) continue;
            $opr = $p['stats']['opr'] ?? null;
            $avg = $p['stats']['avg'] ?? null;
            $json = json_encode(['opr' => $opr, 'avg' => $avg, 'source' => $source], JSON_UNESCAPED_SLASHES);
            $statStmt->execute([$eventId, $p['team'], $p['np'], $json]);
            $stats++;
        }
        return [$teams, $stats];
    }

    /** POST /scouting/events/{event_id}/sync-schedule — pull the match schedule (once posted). */
    public static function syncSchedule(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $e = self::eventRow($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $season = self::seasonRow($pdo, (int)$e['scout_season_id']);
        $scoresType = preg_replace('/^TeamEventStats/', 'MatchScores', (string)$season['api_stats_type']) ?: 'MatchScores2025';
        try {
            $matches = FtcScout::schedule((int)$season['season_year'], $e['event_code'], $scoresType);
        } catch (\Throwable $ex) {
            return Http::error($res, 'ftcscout lookup failed: ' . $ex->getMessage(), 502);
        }
        // Store the real red/blue score (hidden) but never reset the `revealed` flag on re-sync.
        $stmt = $pdo->prepare("INSERT INTO scout_matches (scout_event_id, match_num, tournament_level, scheduled_start, red1, red2, blue1, blue2, has_been_played, red_score, blue_score, surrogates, fetched_at)
                               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())
                               ON DUPLICATE KEY UPDATE scheduled_start=VALUES(scheduled_start), red1=VALUES(red1), red2=VALUES(red2),
                                 blue1=VALUES(blue1), blue2=VALUES(blue2), has_been_played=VALUES(has_been_played),
                                 red_score=VALUES(red_score), blue_score=VALUES(blue_score), surrogates=VALUES(surrogates), fetched_at=NOW()");
        $n = 0;
        foreach ($matches as $m) {
            $red = [null, null]; $blue = [null, null]; $surr = [];
            foreach (($m['teams'] ?? []) as $t) {
                // ftcscout reports station as the WORD 'One'/'Two' (not 1/2) — map to slot 0/1.
                $stn = strtolower(trim((string)($t['station'] ?? 'one')));
                $slot = in_array($stn, ['two', '2'], true) ? 1 : 0;
                if (($t['alliance'] ?? '') === 'Red') $red[$slot] = (int)$t['teamNumber'];
                elseif (($t['alliance'] ?? '') === 'Blue') $blue[$slot] = (int)$t['teamNumber'];
                if (!empty($t['surrogate'])) $surr[] = (int)$t['teamNumber'];   // plays, but earns no stats credit
            }
            $sc = $m['scores'] ?? null;
            $stmt->execute([
                (int)$e['id'], (int)$m['matchNum'], $m['tournamentLevel'] ?? 'Quals',
                isset($m['scheduledStartTime']) ? substr(str_replace('T', ' ', (string)$m['scheduledStartTime']), 0, 19) : null,
                $red[0], $red[1], $blue[0], $blue[1], !empty($m['hasBeenPlayed']) ? 1 : 0,
                isset($sc['red']['totalPoints']) ? (int)$sc['red']['totalPoints'] : null,
                isset($sc['blue']['totalPoints']) ? (int)$sc['blue']['totalPoints'] : null,
                $surr ? implode(',', $surr) : null,
            ]);
            $n++;
        }
        $pdo->prepare("UPDATE scout_events SET schedule_synced_at = NOW() WHERE id = ?")->execute([(int)$e['id']]);
        return Http::json($res, ['ok' => true, 'matches' => $n]);
    }

    /** POST /scouting/events/{event_id}/sync-live — refresh current-event OPR (kept apart from pre-event). */
    public static function syncLive(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $e = self::eventRow($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $season = self::seasonRow($pdo, (int)$e['scout_season_id']);
        $scoresType = preg_replace('/^TeamEventStats/', 'MatchScores', (string)$season['api_stats_type']) ?: 'MatchScores2025';
        try {
            $liveData = FtcScout::liveData((int)$season['season_year'], $e['event_code'], (string)$season['api_stats_type'], $scoresType);
        } catch (\Throwable $ex) {
            return Http::error($res, 'ftcscout lookup failed: ' . $ex->getMessage(), 502);
        }
        $teams = $liveData['teams'];
        $matches = $liveData['matches'];

        // Update team live stats (OPR, rank, wins/losses/ties/rp).
        $stmt = $pdo->prepare("INSERT INTO scout_live_stats (scout_event_id, team_number, opr_total, `rank`, qual_matches_played, stats, fetched_at)
                               VALUES (?,?,?,?,?,?,NOW())
                               ON DUPLICATE KEY UPDATE opr_total=VALUES(opr_total), `rank`=VALUES(`rank`),
                                 qual_matches_played=VALUES(qual_matches_played), stats=VALUES(stats), fetched_at=NOW()");
        $n = 0;
        foreach ($teams as $t) {
            $st = $t['stats'] ?? null;
            if (!$st) continue;
            $opr = $st['opr'] ?? [];
            $statsJson = json_encode([
                'opr'    => $opr,
                'dev'    => $st['dev'] ?? null,
                'wins'   => $st['wins'] ?? null,
                'losses' => $st['losses'] ?? null,
                'ties'   => $st['ties'] ?? null,
                'dqs'    => $st['dqs'] ?? null,
                'rp'     => isset($st['rp']) ? round((float)$st['rp'], 1) : null,
            ], JSON_UNESCAPED_SLASHES);
            $stmt->execute([
                (int)$e['id'], (int)$t['teamNumber'], $opr['totalPoints'] ?? null,
                $st['rank'] ?? null, $st['qualMatchesPlayed'] ?? null, $statsJson,
            ]);
            $n++;
        }

        // Upsert all matches (including newly-scheduled playoff rounds) so the bracket
        // has full team assignments even before each round is played.
        $mUpsert = $pdo->prepare("INSERT INTO scout_matches
                (scout_event_id, match_num, tournament_level, red1, red2, blue1, blue2, has_been_played, red_score, blue_score, surrogates, fetched_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())
                ON DUPLICATE KEY UPDATE red1=VALUES(red1), red2=VALUES(red2),
                  blue1=VALUES(blue1), blue2=VALUES(blue2),
                  has_been_played=GREATEST(has_been_played, VALUES(has_been_played)),
                  red_score=COALESCE(VALUES(red_score), red_score),
                  blue_score=COALESCE(VALUES(blue_score), blue_score),
                  surrogates=COALESCE(VALUES(surrogates), surrogates), fetched_at=NOW()");

        // For playoff matches: collect Captain/Pick per alliance side to build rosters.
        // allianceNumber is determined by qual rank (captain's rank = alliance seed).
        $allianceRosters = []; // alliance_number(int) → ['captain','pick1','pick2']
        // We'll derive alliance numbers after collecting all captains by rank.
        $captainRank     = []; // teamNumber → qual rank (for seeding alliances)
        $allianceSides   = []; // "redTeams"|"blueTeams" per match → [role => teamNum]

        foreach ($matches as $m) {
            $red = [null, null]; $blue = [null, null]; $surr = [];
            $redRoles = []; $blueRoles = []; // role → teamNumber
            foreach (($m['teams'] ?? []) as $t) {
                $stn  = strtolower(trim((string)($t['station'] ?? 'one')));
                $slot = in_array($stn, ['two', '2'], true) ? 1 : 0;
                $tNum = (int)$t['teamNumber'];
                $role = $t['allianceRole'] ?? null; // Captain/FirstPick/SecondPick/Solo
                if (($t['alliance'] ?? '') === 'Red') {
                    $red[$slot] = $tNum;
                    if ($role) $redRoles[$role] = $tNum;
                } elseif (($t['alliance'] ?? '') === 'Blue') {
                    $blue[$slot] = $tNum;
                    if ($role) $blueRoles[$role] = $tNum;
                }
                if (!empty($t['surrogate'])) $surr[] = $tNum;
            }
            $sc = $m['scores'] ?? null;
            $rs = isset($sc['red']['totalPoints'])  ? (int)$sc['red']['totalPoints']  : null;
            $bs = isset($sc['blue']['totalPoints']) ? (int)$sc['blue']['totalPoints'] : null;
            $mUpsert->execute([
                (int)$e['id'], (int)$m['matchNum'], $m['tournamentLevel'] ?? 'Quals',
                $red[0], $red[1], $blue[0], $blue[1], !empty($m['hasBeenPlayed']) ? 1 : 0,
                $rs, $bs, $surr ? implode(',', $surr) : null,
            ]);

            // Extract alliance rosters from playoff matches
            if (($m['tournamentLevel'] ?? '') !== 'Quals') {
                foreach ([['roles' => $redRoles], ['roles' => $blueRoles]] as $side) {
                    $cap = $side['roles']['Captain'] ?? null;
                    if (!$cap) continue;
                    $capKey = (string)$cap;
                    if (!isset($allianceSides[$capKey])) {
                        $allianceSides[$capKey] = [
                            'captain' => $cap,
                            'pick1'   => $side['roles']['FirstPick']  ?? null,
                            'pick2'   => $side['roles']['SecondPick'] ?? null,
                        ];
                    }
                }
            }
        }

        // Assign alliance numbers by captain's qual rank (rank 1 = alliance 1)
        if (!empty($allianceSides)) {
            // Load current qual ranks
            $rankStmt = $pdo->prepare("SELECT team_number, `rank` FROM scout_live_stats WHERE scout_event_id=?");
            $rankStmt->execute([(int)$e['id']]);
            $ranks = [];
            foreach ($rankStmt->fetchAll() as $r) $ranks[(int)$r['team_number']] = (int)$r['rank'];

            $sides = array_values($allianceSides);
            usort($sides, fn($a, $b) => ($ranks[$a['captain']] ?? 999) <=> ($ranks[$b['captain']] ?? 999));

            $alliStmt = $pdo->prepare("INSERT INTO scout_event_alliances (scout_event_id, alliance_number, captain, pick1, pick2, fetched_at)
                VALUES (?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE captain=VALUES(captain), pick1=VALUES(pick1), pick2=VALUES(pick2), fetched_at=NOW()");
            foreach ($sides as $i => $s) {
                $alliStmt->execute([(int)$e['id'], $i + 1, $s['captain'], $s['pick1'], $s['pick2']]);
            }
        }

        return Http::json($res, ['ok' => true, 'teams' => $n, 'alliances' => count($allianceSides)]);
    }

    /**
     * GET /scouting/events/{event_id}/bundle — the self-contained offline bundle a
     * device caches before going offline: event meta, season config, roster, pre-event
     * projections, and the (possibly empty) match schedule.
     */
    public static function bundle(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $e = self::eventRow($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $eid = (int)$e['id'];

        $teams = $pdo->prepare("SELECT team_number, team_name, pit_priority, match_priority, watchlist, watch_column, watch_rank, did_not_show FROM scout_event_teams WHERE scout_event_id = ? ORDER BY team_number");
        $teams->execute([$eid]);
        $pre = $pdo->prepare("SELECT team_number, np_opr, stats FROM scout_preevent_stats WHERE scout_event_id = ?");
        $pre->execute([$eid]);
        $matches = $pdo->prepare("SELECT * FROM scout_matches WHERE scout_event_id = ? ORDER BY tournament_level, match_num");
        $matches->execute([$eid]);

        return Http::json($res, [
            'event' => self::serializeEvent($e),
            'season' => self::serializeSeason(self::seasonRow($pdo, (int)$e['scout_season_id'])),
            'teams' => array_map(fn($r) => [
                'team_number' => (int)$r['team_number'], 'team_name' => $r['team_name'],
                'pit_priority' => (bool)$r['pit_priority'], 'match_priority' => (bool)$r['match_priority'],
                'watchlist' => (bool)($r['watchlist'] ?? false),
                'watch_column' => $r['watch_column'] ?? null,
                'watch_rank' => isset($r['watch_rank']) && $r['watch_rank'] !== null ? (int)$r['watch_rank'] : null,
                'did_not_show' => (bool)($r['did_not_show'] ?? false),
            ], $teams->fetchAll()),
            'preevent_stats' => array_map(fn($r) => [
                'team_number' => (int)$r['team_number'], 'np_opr' => $r['np_opr'] !== null ? (float)$r['np_opr'] : null,
                'stats' => self::jsonCol($r['stats']),
            ], $pre->fetchAll()),
            'matches' => array_map([self::class, 'outMatch'], $matches->fetchAll()),
        ]);
    }

    private static function serializeEvent(array $e, ?PDO $pdo = null): array
    {
        $out = [
            'id' => (int)$e['id'], 'scout_season_id' => (int)$e['scout_season_id'], 'event_code' => $e['event_code'],
            'name' => $e['name'], 'division_code' => $e['division_code'], 'city' => $e['city'], 'state' => $e['state'],
            'start_date' => $e['start_date'], 'end_date' => $e['end_date'], 'is_active' => (bool)$e['is_active'],
            'is_training' => (bool)($e['is_training'] ?? false),
            'our_team_number' => isset($e['our_team_number']) && $e['our_team_number'] !== null ? (int)$e['our_team_number'] : null,
            'schedule_synced_at' => Time::naiveIso($e['schedule_synced_at']),
        ];
        if ($pdo) {
            $out['counts'] = [
                'teams' => (int)$pdo->query("SELECT COUNT(*) FROM scout_event_teams WHERE scout_event_id = {$e['id']}")->fetchColumn(),
                'matches' => (int)$pdo->query("SELECT COUNT(*) FROM scout_matches WHERE scout_event_id = {$e['id']}")->fetchColumn(),
                'pit_reports' => (int)$pdo->query("SELECT COUNT(*) FROM scout_pit_reports WHERE scout_event_id = {$e['id']}")->fetchColumn(),
                'match_records' => (int)$pdo->query("SELECT COUNT(*) FROM scout_match_records WHERE scout_event_id = {$e['id']}")->fetchColumn(),
            ];
        }
        return $out;
    }

    // ─────────────────────────── pit scouting ───────────────────────────

    /** GET /scouting/pit-reports?event_id=&team_number= */
    public static function listPit(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['event_id'])) { $where[] = 'scout_event_id = ?'; $args[] = (int)$q['event_id']; }
        if (isset($q['team_number'])) { $where[] = 'team_number = ?'; $args[] = (int)$q['team_number']; }
        if (empty($q['include_ignored'])) { $where[] = 'is_ignored = 0'; }
        $sql = "SELECT * FROM scout_pit_reports";
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= " ORDER BY team_number, created_at";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, ['items' => array_map([self::class, 'serializePit'], $s->fetchAll())]);
    }

    /** POST /scouting/pit-reports — create/replace a pit report (idempotent on client_uuid). */
    public static function createPit(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!Permissions::memberCan($pdo, $cur, 'scouting.scout', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['event_id']) || empty($d['team_number'])) return Http::error($res, 'event_id and team_number are required', 422);
        $uuid = !empty($d['client_uuid']) ? (string)$d['client_uuid'] : self::uuid4();
        $payload = isset($d['payload']) ? json_encode($d['payload'], JSON_UNESCAPED_SLASHES) : null;
        $pdo->prepare("INSERT INTO scout_pit_reports (client_uuid, scout_event_id, team_number, scouter_member_id, scouter_name, robot_nickname, payload, device_id, client_ts)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE scouter_name=VALUES(scouter_name), robot_nickname=VALUES(robot_nickname),
                         payload=VALUES(payload), updated_at=NOW()")
            ->execute([
                $uuid, (int)$d['event_id'], (int)$d['team_number'], (int)$cur['id'], $d['scouter_name'] ?? null,
                $d['robot_nickname'] ?? null, $payload, $d['device_id'] ?? null,
                !empty($d['client_ts']) ? substr((string)$d['client_ts'], 0, 19) : null,
            ]);
        $row = $pdo->prepare("SELECT * FROM scout_pit_reports WHERE client_uuid = ?"); $row->execute([$uuid]);
        return Http::json($res, self::serializePit($row->fetch()), 201);
    }

    /**
     * PATCH /scouting/events/{event_id}/teams/{team_number}/priority — set pre-event
     * scouting priority flags. Body: { pit_priority?, match_priority? }. Any scouter
     * may flag (collaborative planning); flags live on the per-event roster.
     */
    public static function setPriority(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!Permissions::memberCan($pdo, $cur, 'scouting.scout', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('pit_priority', $d)) { $set[] = 'pit_priority=?'; $args[] = !empty($d['pit_priority']) ? 1 : 0; }
        if (array_key_exists('match_priority', $d)) { $set[] = 'match_priority=?'; $args[] = !empty($d['match_priority']) ? 1 : 0; }
        if (array_key_exists('watchlist', $d)) {
            $on = !empty($d['watchlist']);
            $set[] = 'watchlist=?'; $args[] = $on ? 1 : 0;
            if (!$on) { $set[] = 'watch_column=NULL'; $set[] = 'watch_rank=NULL'; }   // leaving the watchlist clears its placement
        }
        if (array_key_exists('did_not_show', $d)) { $set[] = 'did_not_show=?'; $args[] = !empty($d['did_not_show']) ? 1 : 0; }
        if (!$set) return Http::error($res, 'No priority flags provided', 422);
        $args[] = (int)$route['event_id']; $args[] = (int)$route['team_number'];
        $pdo->prepare("UPDATE scout_event_teams SET " . implode(',', $set) . ", updated_at=NOW() WHERE scout_event_id=? AND team_number=?")->execute($args);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /scouting/events/{event_id}/watchlist — save the full watchlist layout
     * (shared across scouters). Body: { unassigned:[team#…], far:[team#…], goal:[team#…] }
     * in preference order. Each listed team gets watch_column + watch_rank (0-based)
     * and is marked watchlisted. Removing a team from the watchlist is done via the
     * priority endpoint ({ watchlist:false }), not here.
     */
    public static function saveWatchlist(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!Permissions::memberCan($pdo, $cur, 'scouting.scout', 'write')) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $groups = ['unassigned' => null, 'far' => 'far', 'goal' => 'goal'];
        $upd = $pdo->prepare("UPDATE scout_event_teams SET watchlist=1, watch_column=?, watch_rank=?, updated_at=NOW() WHERE scout_event_id=? AND team_number=?");
        $pdo->beginTransaction();
        try {
            foreach ($groups as $key => $col) {
                $list = is_array($d[$key] ?? null) ? array_values($d[$key]) : [];
                foreach ($list as $i => $tn) $upd->execute([$col, $i, $eid, (int)$tn]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            return Http::error($res, 'Failed to save watchlist', 500);
        }
        return Http::json($res, ['ok' => true]);
    }

    /** PATCH /scouting/pit-reports/{report_id}/ignore — set/clear the ignore flag (managers). */
    public static function setPitIgnore(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ignored = !empty($d['ignored']) ? 1 : 0;
        $pdo->prepare("UPDATE scout_pit_reports SET is_ignored = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$ignored, (int)$route['report_id']]);
        Audit::write($pdo, (int)$cur['id'], 'scout_pit_report', (int)$route['report_id'], 'set_ignore', null, ['ignored' => (bool)$ignored]);
        return Http::json($res, ['ok' => true, 'ignored' => (bool)$ignored]);
    }

    private static function serializePit(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'client_uuid' => $r['client_uuid'], 'scout_event_id' => (int)$r['scout_event_id'],
            'team_number' => (int)$r['team_number'],
            'scouter_member_id' => $r['scouter_member_id'] !== null ? (int)$r['scouter_member_id'] : null,
            'scouter_name' => $r['scouter_name'], 'robot_nickname' => $r['robot_nickname'],
            'payload' => self::jsonCol($r['payload']), 'is_ignored' => (bool)$r['is_ignored'],
            'created_at' => Time::naiveIso($r['created_at']), 'updated_at' => Time::naiveIso($r['updated_at']),
        ];
    }

    // ─────────────────────────── match schedule + match scouting ───────────────────────────

    /** GET /scouting/matches?event_id= */
    public static function listMatches(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        if (empty($q['event_id'])) return Http::error($res, 'event_id is required', 422);
        $s = $pdo->prepare("SELECT * FROM scout_matches WHERE scout_event_id = ? ORDER BY tournament_level, match_num");
        $s->execute([(int)$q['event_id']]);
        return Http::json($res, ['items' => array_map([self::class, 'outMatch'], $s->fetchAll())]);
    }

    /** Normalize a scout_matches row for output — actual scores stay hidden until revealed (training mode). */
    private static function outMatch(array $r): array
    {
        $rev = (bool)($r['revealed'] ?? false);
        $i = fn($k) => isset($r[$k]) && $r[$k] !== null ? (int)$r[$k] : null;
        return [
            'match_num' => (int)$r['match_num'], 'tournament_level' => $r['tournament_level'],
            'scheduled_start' => $r['scheduled_start'] ?? null,
            'red1' => $i('red1'), 'red2' => $i('red2'), 'blue1' => $i('blue1'), 'blue2' => $i('blue2'),
            'has_been_played' => (bool)$r['has_been_played'], 'revealed' => $rev,
            'red_score' => $rev ? $i('red_score') : null,
            'blue_score' => $rev ? $i('blue_score') : null,
        ];
    }

    /**
     * POST /scouting/events/{event_id}/matches/{match_num}/reveal — training-mode
     * "Score Match": flip the match to revealed and return the actual red/blue score
     * (so scouters can check their work against ground truth). ?level=Quals|Playoffs.
     */
    public static function revealMatch(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id']; $mn = (int)$route['match_num'];
        $lvl = $req->getQueryParams()['level'] ?? 'Quals';
        $row = $pdo->prepare("SELECT * FROM scout_matches WHERE scout_event_id=? AND match_num=? AND tournament_level=? LIMIT 1");
        $row->execute([$eid, $mn, $lvl]); $m = $row->fetch();
        if (!$m) return Http::error($res, 'Match not found (sync the schedule first)', 404);
        if ($m['red_score'] === null && $m['blue_score'] === null) return Http::error($res, 'No official score available for this match yet.', 409);
        $pdo->prepare("UPDATE scout_matches SET revealed=1 WHERE id=?")->execute([(int)$m['id']]);
        $m['revealed'] = 1;
        return Http::json($res, self::outMatch($m));
    }

    /**
     * DELETE /scouting/events/{event_id} — remove an event and CASCADE-wipe all of its
     * scouting data (roster, stats, schedule, pit/match/observation records). Manager
     * only. Used to clean up after a training-mode run (#61).
     */
    public static function deleteEvent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $e = self::eventRow($pdo, (int)$route['event_id']);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $pdo->prepare("DELETE FROM scout_events WHERE id=?")->execute([(int)$e['id']]);
        Audit::write($pdo, (int)$cur['id'], 'scout_event', (int)$e['id'], 'delete', null, ['code' => $e['event_code'], 'training' => (bool)$e['is_training']]);
        return Http::json($res, ['ok' => true, 'deleted_event' => $e['event_code']]);
    }

    /** GET /scouting/match-records?event_id=&match_num=&team_number= */
    public static function listMatchRecords(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['event_id'])) { $where[] = 'scout_event_id = ?'; $args[] = (int)$q['event_id']; }
        if (isset($q['match_num'])) { $where[] = 'match_num = ?'; $args[] = (int)$q['match_num']; }
        if (isset($q['team_number'])) { $where[] = 'scouted_team_number = ?'; $args[] = (int)$q['team_number']; }
        if (empty($q['include_ignored'])) { $where[] = 'is_ignored = 0'; }
        $sql = "SELECT * FROM scout_match_records";
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= " ORDER BY match_num, scouted_team_number";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, ['items' => array_map([self::class, 'serializeMatchRecord'], $s->fetchAll())]);
    }

    /** POST /scouting/match-records — create/replace a match record (idempotent on client_uuid). */
    public static function upsertMatchRecord(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!Permissions::memberCan($pdo, $cur, 'scouting.scout', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $err = self::writeMatchRecord($pdo, (int)$cur['id'], $d);
        if (is_string($err)) return Http::error($res, $err, 422);
        $row = $pdo->prepare("SELECT * FROM scout_match_records WHERE client_uuid = ?"); $row->execute([$err]);
        return Http::json($res, self::serializeMatchRecord($row->fetch()), 201);
    }

    /** Shared writer used by both the single endpoint and syncBatch. Returns client_uuid on success, or an error string. */
    private static function writeMatchRecord(PDO $pdo, int $memberId, array $d): string
    {
        if (empty($d['event_id']) || empty($d['match_num']) || empty($d['scouted_team_number'])) {
            return 'event_id, match_num and scouted_team_number are required';
        }
        $uuid = !empty($d['client_uuid']) ? (string)$d['client_uuid'] : self::uuid4();
        $confidence = in_array($d['confidence'] ?? '', self::CONFIDENCE, true) ? $d['confidence'] : null;
        $payload = isset($d['payload']) ? json_encode($d['payload'], JSON_UNESCAPED_SLASHES) : null;
        $pdo->prepare("INSERT INTO scout_match_records (client_uuid, scout_event_id, match_num, tournament_level, scouted_team_number, alliance, scouter_member_id, scouter_name, showed_up, whole_match, confidence, payload, device_id, client_ts)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE alliance=VALUES(alliance), showed_up=VALUES(showed_up), whole_match=VALUES(whole_match),
                         confidence=VALUES(confidence), payload=VALUES(payload), updated_at=NOW()")
            ->execute([
                $uuid, (int)$d['event_id'], (int)$d['match_num'], $d['tournament_level'] ?? 'Quals',
                (int)$d['scouted_team_number'], $d['alliance'] ?? null, $memberId, $d['scouter_name'] ?? null,
                isset($d['showed_up']) ? (int)(bool)$d['showed_up'] : 1,
                isset($d['whole_match']) ? (int)(bool)$d['whole_match'] : 1,
                $confidence, $payload, $d['device_id'] ?? null,
                !empty($d['client_ts']) ? substr((string)$d['client_ts'], 0, 19) : null,
            ]);
        return $uuid;
    }

    /** PATCH /scouting/match-records/{record_id}/ignore */
    public static function setMatchIgnore(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ignored = !empty($d['ignored']) ? 1 : 0;
        $pdo->prepare("UPDATE scout_match_records SET is_ignored = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$ignored, (int)$route['record_id']]);
        return Http::json($res, ['ok' => true, 'ignored' => (bool)$ignored]);
    }

    private static function serializeMatchRecord(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'client_uuid' => $r['client_uuid'], 'scout_event_id' => (int)$r['scout_event_id'],
            'match_num' => (int)$r['match_num'], 'tournament_level' => $r['tournament_level'],
            'scouted_team_number' => (int)$r['scouted_team_number'], 'alliance' => $r['alliance'],
            'scouter_member_id' => $r['scouter_member_id'] !== null ? (int)$r['scouter_member_id'] : null,
            'scouter_name' => $r['scouter_name'], 'showed_up' => (bool)$r['showed_up'], 'whole_match' => (bool)$r['whole_match'],
            'confidence' => $r['confidence'], 'payload' => self::jsonCol($r['payload']), 'is_ignored' => (bool)$r['is_ignored'],
            'created_at' => Time::naiveIso($r['created_at']), 'updated_at' => Time::naiveIso($r['updated_at']),
        ];
    }

    // ─────────────────────────── observations ───────────────────────────

    /** GET /scouting/observations?event_id=&team_number= */
    public static function listObservations(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['event_id'])) { $where[] = 'scout_event_id = ?'; $args[] = (int)$q['event_id']; }
        if (isset($q['team_number'])) { $where[] = 'team_number = ?'; $args[] = (int)$q['team_number']; }
        if (empty($q['include_ignored'])) { $where[] = 'is_ignored = 0'; }
        $sql = "SELECT * FROM scout_observations";
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        $sql .= " ORDER BY team_number, created_at DESC";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, ['items' => array_map([self::class, 'serializeObservation'], $s->fetchAll())]);
    }

    /** POST /scouting/observations — create an observation (idempotent on client_uuid). */
    public static function createObservation(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!Permissions::memberCan($pdo, $cur, 'scouting.scout', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $err = self::writeObservation($pdo, (int)$cur['id'], $d);
        if (is_string($err) && !preg_match('/^[0-9a-f-]{36}$/', $err)) return Http::error($res, $err, 422);
        $row = $pdo->prepare("SELECT * FROM scout_observations WHERE client_uuid = ?"); $row->execute([$err]);
        return Http::json($res, self::serializeObservation($row->fetch()), 201);
    }

    private static function writeObservation(PDO $pdo, int $memberId, array $d): string
    {
        if (empty($d['event_id']) || empty($d['team_number']) || empty($d['observation'])) {
            return 'event_id, team_number and observation are required';
        }
        $uuid = !empty($d['client_uuid']) ? (string)$d['client_uuid'] : self::uuid4();
        $tags = isset($d['tags']) ? json_encode($d['tags'], JSON_UNESCAPED_SLASHES) : null;
        $pdo->prepare("INSERT INTO scout_observations (client_uuid, scout_event_id, team_number, match_num, scouter_member_id, scouter_name, observation, tags, device_id, client_ts)
                       VALUES (?,?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE observation=VALUES(observation), tags=VALUES(tags)")
            ->execute([
                $uuid, (int)$d['event_id'], (int)$d['team_number'], !empty($d['match_num']) ? (int)$d['match_num'] : null,
                $memberId, $d['scouter_name'] ?? null, (string)$d['observation'], $tags, $d['device_id'] ?? null,
                !empty($d['client_ts']) ? substr((string)$d['client_ts'], 0, 19) : null,
            ]);
        return $uuid;
    }

    private static function serializeObservation(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'client_uuid' => $r['client_uuid'], 'scout_event_id' => (int)$r['scout_event_id'],
            'team_number' => (int)$r['team_number'], 'match_num' => $r['match_num'] !== null ? (int)$r['match_num'] : null,
            'scouter_member_id' => $r['scouter_member_id'] !== null ? (int)$r['scouter_member_id'] : null,
            'scouter_name' => $r['scouter_name'], 'observation' => $r['observation'], 'tags' => self::jsonCol($r['tags']),
            'is_ignored' => (bool)$r['is_ignored'], 'created_at' => Time::naiveIso($r['created_at']),
        ];
    }

    // ─────────────────────────── offline sync ───────────────────────────

    /**
     * POST /scouting/sync — bulk idempotent ingest from an offline device.
     * Body: { records: [ { kind: 'pit'|'match'|'observation', client_uuid, ... }, ... ] }.
     * Each record is upserted by its client_uuid; re-uploading is safe. Returns a
     * per-record result so the device knows what to mark as synced.
     */
    public static function syncBatch(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!Permissions::memberCan($pdo, $cur, 'scouting.scout', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $records = (array)($d['records'] ?? []);
        $results = []; $ok = 0;
        foreach ($records as $rec) {
            $rec = (array)$rec;
            $kind = $rec['kind'] ?? '';
            $uuid = $rec['client_uuid'] ?? null;
            try {
                $r = match ($kind) {
                    'pit'         => self::syncOnePit($pdo, (int)$cur['id'], $rec),
                    'match'       => self::writeMatchRecord($pdo, (int)$cur['id'], $rec),
                    'observation' => self::writeObservation($pdo, (int)$cur['id'], $rec),
                    default       => 'unknown kind: ' . $kind,
                };
                $isUuid = is_string($r) && preg_match('/^[0-9a-f-]{36}$/', $r);
                if ($isUuid) { $ok++; $results[] = ['client_uuid' => $r, 'kind' => $kind, 'status' => 'ok']; }
                else { $results[] = ['client_uuid' => $uuid, 'kind' => $kind, 'status' => 'error', 'detail' => $r]; }
            } catch (\Throwable $ex) {
                $results[] = ['client_uuid' => $uuid, 'kind' => $kind, 'status' => 'error', 'detail' => $ex->getMessage()];
            }
        }
        return Http::json($res, ['received' => count($records), 'accepted' => $ok, 'results' => $results]);
    }

    /** Pit upsert returning client_uuid (mirrors createPit's write half, for syncBatch). */
    private static function syncOnePit(PDO $pdo, int $memberId, array $d): string
    {
        if (empty($d['event_id']) || empty($d['team_number'])) return 'event_id and team_number are required';
        $uuid = !empty($d['client_uuid']) ? (string)$d['client_uuid'] : self::uuid4();
        $payload = isset($d['payload']) ? json_encode($d['payload'], JSON_UNESCAPED_SLASHES) : null;
        $pdo->prepare("INSERT INTO scout_pit_reports (client_uuid, scout_event_id, team_number, scouter_member_id, scouter_name, robot_nickname, payload, device_id, client_ts)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON DUPLICATE KEY UPDATE scouter_name=VALUES(scouter_name), robot_nickname=VALUES(robot_nickname), payload=VALUES(payload), updated_at=NOW()")
            ->execute([
                $uuid, (int)$d['event_id'], (int)$d['team_number'], $memberId, $d['scouter_name'] ?? null,
                $d['robot_nickname'] ?? null, $payload, $d['device_id'] ?? null,
                !empty($d['client_ts']) ? substr((string)$d['client_ts'], 0, 19) : null,
            ]);
        return $uuid;
    }

    // ─────────────────────────── analysis ───────────────────────────

    /** GET /scouting/events/{event_id}/board — teams ranked by pre-event npOpr, with live delta. */
    public static function preEventBoard(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $sql = "SELECT t.team_number, t.team_name, p.np_opr AS pre_np_opr, l.opr_total AS live_opr, l.`rank` AS live_rank
                FROM scout_event_teams t
                LEFT JOIN scout_preevent_stats p ON p.scout_event_id = t.scout_event_id AND p.team_number = t.team_number
                LEFT JOIN scout_live_stats     l ON l.scout_event_id = t.scout_event_id AND l.team_number = t.team_number  -- l.`rank` aliased below
                WHERE t.scout_event_id = ?
                ORDER BY p.np_opr IS NULL, p.np_opr DESC";
        $s = $pdo->prepare($sql); $s->execute([$eid]);
        $rows = array_map(fn($r) => [
            'team_number' => (int)$r['team_number'], 'team_name' => $r['team_name'],
            'pre_np_opr' => $r['pre_np_opr'] !== null ? (float)$r['pre_np_opr'] : null,
            'live_opr' => $r['live_opr'] !== null ? (float)$r['live_opr'] : null,
            'live_rank' => $r['live_rank'] !== null ? (int)$r['live_rank'] : null,
            'delta' => ($r['pre_np_opr'] !== null && $r['live_opr'] !== null) ? round((float)$r['live_opr'] - (float)$r['pre_np_opr'], 1) : null,
        ], $s->fetchAll());
        return Http::json($res, ['items' => $rows]);
    }

    /**
     * GET /scouting/matches/preview?event_id=&match_num= — the two difficulty scores
     * per alliance: pre-event (sum of partners' pre-event npOpr) and current-event
     * (sum of partners' live OPR). The gap flags risers vs. strugglers.
     */
    public static function matchPreview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        if (empty($q['event_id']) || !isset($q['match_num'])) return Http::error($res, 'event_id and match_num are required', 422);
        $eid = (int)$q['event_id'];
        $m = $pdo->prepare("SELECT * FROM scout_matches WHERE scout_event_id = ? AND match_num = ? ORDER BY tournament_level LIMIT 1");
        $m->execute([$eid, (int)$q['match_num']]);
        $match = $m->fetch();
        if (!$match) return Http::error($res, 'Match not found (schedule may not be synced yet)', 404);

        $score = function (array $teamNums) use ($pdo, $eid): array {
            $teamNums = array_values(array_filter($teamNums));
            if (!$teamNums) return ['teams' => [], 'pre' => null, 'live' => null];
            $ph = implode(',', array_fill(0, count($teamNums), '?'));
            $pre = $pdo->prepare("SELECT COALESCE(SUM(np_opr),0) FROM scout_preevent_stats WHERE scout_event_id = ? AND team_number IN ($ph)");
            $pre->execute([$eid, ...$teamNums]);
            $live = $pdo->prepare("SELECT SUM(opr_total), COUNT(*) FROM scout_live_stats WHERE scout_event_id = ? AND team_number IN ($ph)");
            $live->execute([$eid, ...$teamNums]);
            [$liveSum, $liveCnt] = $live->fetch(PDO::FETCH_NUM);
            return [
                'teams' => $teamNums,
                'pre' => round((float)$pre->fetchColumn(), 1),
                'live' => $liveCnt > 0 ? round((float)$liveSum, 1) : null,
            ];
        };
        $red = $score([$match['red1'], $match['red2']]);
        $blue = $score([$match['blue1'], $match['blue2']]);
        return Http::json($res, [
            'match_num' => (int)$match['match_num'], 'tournament_level' => $match['tournament_level'],
            'red' => $red, 'blue' => $blue,
        ]);
    }

    /**
     * GET /scouting/events/{event_id}/match-projections — for every scheduled match,
     * the projected red/blue alliance score (sum of pre-event npOPR), projected winner,
     * and points spread. When a match's actual result is available (real event played,
     * or training match revealed) it's included with an `outlier` flag where the projected
     * winner differs from the actual — surfacing matches worth a closer look.
     */
    public static function matchProjections(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $e = self::eventRow($pdo, $eid);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $training = (bool)$e['is_training'];

        // Per-team npOPR + name + OPR rank (1 = best npOPR).
        $pre = []; $names = [];
        $s = $pdo->prepare("SELECT team_number, np_opr FROM scout_preevent_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $pre[(int)$r['team_number']] = $r['np_opr'] !== null ? (float)$r['np_opr'] : null;
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];
        $rankOf = []; $rankList = array_keys(array_filter($pre, fn($v) => $v !== null));
        usort($rankList, fn($a, $b) => $pre[$b] <=> $pre[$a]);
        foreach ($rankList as $i => $tn) $rankOf[$tn] = $i + 1;

        // Live OPR from last syncLive.
        $liveOpr = [];
        $s = $pdo->prepare("SELECT team_number, opr_total FROM scout_live_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $liveOpr[(int)$r['team_number']] = $r['opr_total'] !== null ? round((float)$r['opr_total'], 1) : null;

        // TRC npOPR: confidence-weighted auto+leave+teleop+park (same logic as livePerformance).
        $W = ['low' => 0.25, 'medium' => 0.5, 'high' => 0.75, 'very_high' => 0.9];
        $num = fn($x) => is_numeric($x) ? (float)$x : 0.0;
        $trcAgg = [];
        $s = $pdo->prepare("SELECT scouted_team_number, confidence, payload FROM scout_match_records WHERE scout_event_id=? AND is_ignored=0 AND showed_up=1"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $t = (int)$r['scouted_team_number']; $w = $W[$r['confidence'] ?? ''] ?? 0.5;
            $pl = (array)self::jsonCol($r['payload']); $a = (array)($pl['auto'] ?? []); $te = (array)($pl['teleop'] ?? []); $eg = (array)($pl['endgame'] ?? []);
            $aMk = $num($a['closeMake'] ?? 0) + $num($a['farMake'] ?? 0);
            $tMk = $num($te['closeMake'] ?? 0) + $num($te['farMake'] ?? 0);
            $dnm = (($a['movement'] ?? '') === 'did_not_move' || !empty($a['did_not_move'])) ? 1 : 0;
            $pk  = strtolower((string)($eg['park'] ?? ($pl['park'] ?? '')));
            $pkP = str_contains($pk, 'full') || str_contains($pk, 'foul') ? 10 : (str_contains($pk, 'partial') ? 5 : 0);
            if (!isset($trcAgg[$t])) $trcAgg[$t] = ['w' => 0, 'a' => 0, 'te' => 0, 'dnm' => 0, 'park' => 0];
            $trcAgg[$t]['w'] += $w; $trcAgg[$t]['a'] += $w * $aMk; $trcAgg[$t]['te'] += $w * $tMk;
            $trcAgg[$t]['dnm'] += $w * $dnm; $trcAgg[$t]['park'] += $w * $pkP;
        }
        $trcNpOpr = [];
        foreach ($trcAgg as $t => $v) {
            if ($v['w'] <= 0) continue;
            $trcNpOpr[$t] = round(($v['a']/$v['w'])*3 + (1-$v['dnm']/$v['w'])*3 + ($v['te']/$v['w'])*3 + $v['park']/$v['w'], 1);
        }

        // An alliance: its two teams + the projected score sum.
        // $playoff=true → use live OPR (this event's data) as the projection basis;
        // falls back to pre-event npOPR if live isn't available yet for a team.
        $allianceObj = function (array $teamNums, array $surrSet, bool $playoff = false) use ($pre, $names, $rankOf, $liveOpr, $trcNpOpr) {
            $teams = [];
            foreach ($teamNums as $t) {
                $preOpr  = isset($pre[$t]) && $pre[$t] !== null ? round((float)$pre[$t], 1) : null;
                $liveO   = $liveOpr[$t] ?? null;
                // For playoffs prefer live OPR (from this event); for quals use pre-event npOPR.
                if ($playoff && $liveO !== null) {
                    $projOpr = $liveO; $projBasis = 'live';
                } else {
                    $projOpr = $preOpr; $projBasis = 'pre';
                }
                $teams[] = ['team_number' => $t, 'team_name' => $names[$t] ?? null,
                    'opr' => $preOpr, 'live_opr' => $liveO, 'trc_npopr' => $trcNpOpr[$t] ?? null,
                    'proj_opr' => $projOpr, 'proj_basis' => $projBasis,
                    'rank' => $rankOf[$t] ?? null, 'surrogate' => in_array($t, $surrSet, true)];
            }
            usort($teams, fn($a, $b) => ($b['proj_opr'] ?? -1e9) <=> ($a['proj_opr'] ?? -1e9));
            $proj = 0; foreach ($teams as $t) $proj += $t['proj_opr'] ?? 0;
            return ['teams' => $teams, 'proj' => round($proj, 1)];
        };

        $s = $pdo->prepare("SELECT * FROM scout_matches WHERE scout_event_id=? ORDER BY tournament_level, match_num"); $s->execute([$eid]);
        $rows = $s->fetchAll();

        $items = []; $outliers = 0; $correct = 0; $withActual = 0;
        $st = []; // team => projected W/L/T + avg projected score accumulator
        $bump = function (int $t) use (&$st) { if (!isset($st[$t])) $st[$t] = ['w' => 0, 'l' => 0, 't' => 0, 'sum' => 0.0, 'n' => 0]; };
        foreach ($rows as $m) {
            $redNums = array_values(array_filter([$m['red1'] !== null ? (int)$m['red1'] : null, $m['red2'] !== null ? (int)$m['red2'] : null], fn($x) => $x !== null));
            $blueNums = array_values(array_filter([$m['blue1'] !== null ? (int)$m['blue1'] : null, $m['blue2'] !== null ? (int)$m['blue2'] : null], fn($x) => $x !== null));
            $surrSet = array_values(array_filter(array_map('intval', explode(',', (string)($m['surrogates'] ?? '')))));
            $playoff = ($m['tournament_level'] !== 'Quals');
            $red = $allianceObj($redNums, $surrSet, $playoff); $blue = $allianceObj($blueNums, $surrSet, $playoff);
            $diff = $red['proj'] - $blue['proj'];
            $winner = abs($diff) < 1 ? 'Even' : ($diff > 0 ? 'Red' : 'Blue');

            // projected standings (qualification matches only): winner's teams +W,
            // loser's +L (Even -> T); accumulate avg projected score. Surrogates play
            // (counted in the alliance proj above) but earn NO stats credit, so skip them.
            if ($m['tournament_level'] === 'Quals') {
                foreach ($redNums as $t) { if (in_array($t, $surrSet, true)) continue; $bump($t); $st[$t]['sum'] += $red['proj']; $st[$t]['n']++; $st[$t][$winner === 'Red' ? 'w' : ($winner === 'Blue' ? 'l' : 't')]++; }
                foreach ($blueNums as $t) { if (in_array($t, $surrSet, true)) continue; $bump($t); $st[$t]['sum'] += $blue['proj']; $st[$t]['n']++; $st[$t][$winner === 'Blue' ? 'w' : ($winner === 'Red' ? 'l' : 't')]++; }
            }

            $showActual = $m['has_been_played'] && ($m['revealed'] || !$training) && $m['red_score'] !== null && $m['blue_score'] !== null;
            $actual = null; $isCorrect = null;
            if ($showActual) {
                $rs = (int)$m['red_score']; $bs = (int)$m['blue_score'];
                $aw = $rs === $bs ? 'Even' : ($rs > $bs ? 'Red' : 'Blue');
                $actual = ['red_score' => $rs, 'blue_score' => $bs, 'winner' => $aw, 'margin' => abs($rs - $bs),
                    'red_diff' => round($rs - $red['proj'], 1), 'blue_diff' => round($bs - $blue['proj'], 1)];
                if ($winner !== 'Even' && $aw !== 'Even') { $withActual++; $isCorrect = ($winner === $aw); $isCorrect ? $correct++ : $outliers++; }
            }
            $items[] = [
                'match_num' => (int)$m['match_num'], 'tournament_level' => $m['tournament_level'],
                'red' => $red, 'blue' => $blue, 'projected_winner' => $winner, 'spread' => round(abs($diff), 1),
                'projection_complete' => (count($redNums) > 0 && count($blueNums) > 0),
                'played' => (bool)$m['has_been_played'], 'actual' => $actual,
                'correct' => $isCorrect, 'outlier' => $isCorrect === false,
            ];
        }

        // Projected standings: rank by win rate, tiebreak by higher average projected score.
        $standings = [];
        foreach ($st as $t => $v) {
            $g = $v['w'] + $v['l'] + $v['t'];
            $standings[] = ['team_number' => $t, 'team_name' => $names[$t] ?? null, 'opr' => isset($pre[$t]) && $pre[$t] !== null ? round($pre[$t], 1) : null,
                'games_played' => $g, 'proj_wins' => $v['w'], 'proj_losses' => $v['l'], 'proj_ties' => $v['t'],
                'win_rate' => $g ? round($v['w'] / $g, 3) : 0, 'avg_proj_score' => $v['n'] ? round($v['sum'] / $v['n'], 1) : 0];
        }
        usort($standings, fn($a, $b) => ($b['win_rate'] <=> $a['win_rate']) ?: ($b['avg_proj_score'] <=> $a['avg_proj_score']));
        foreach ($standings as $i => &$row) $row['proj_rank'] = $i + 1;
        unset($row);

        return Http::json($res, [
            'count' => count($items), 'outliers' => $outliers, 'is_training' => $training,
            'projection_basis' => self::projectionBasis($pdo, $eid),
            'accuracy' => ['correct' => $correct, 'total' => $withActual, 'pct' => $withActual ? round(100 * $correct / $withActual) : null],
            'items' => $items, 'standings' => $standings,
        ]);
    }

    /**
     * GET /scouting/events/{event_id}/playoff-bracket
     *
     * Double-elimination bracket per the FTC competition manual (Section 13.7).
     * Alliances are inferred from match data (teams that appear together on the same
     * side = one alliance). Each alliance tracks W/L; 0 losses = upper bracket,
     * 1 loss = lower bracket, 2 losses = eliminated.
     *
     * Falls back to projecting the upper-bracket round-1 matchups from qual standings
     * when no playoff matches have been synced yet.
     */
    public static function playoffBracket(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $e = self::eventRow($pdo, $eid);
        if (!$e) return Http::error($res, 'Event not found', 404);

        // Team names
        $names = [];
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];

        // Live OPR + qual rank
        $liveOpr = []; $liveRank = [];
        $s = $pdo->prepare("SELECT team_number, opr_total, rank FROM scout_live_stats WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $liveOpr[(int)$r['team_number']]  = $r['opr_total'] !== null ? round((float)$r['opr_total'], 1) : null;
            $liveRank[(int)$r['team_number']] = (int)$r['rank'];
        }

        // Pre-event npOPR fallback
        $preOpr = [];
        $s = $pdo->prepare("SELECT team_number, np_opr FROM scout_preevent_stats WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $preOpr[(int)$r['team_number']] = $r['np_opr'] !== null ? round((float)$r['np_opr'], 1) : null;

        // TRC npOPR: confidence-weighted auto+leave+teleop+park from scouted match records
        $W = ['low' => 0.25, 'medium' => 0.5, 'high' => 0.75, 'very_high' => 0.9];
        $num = fn($x) => is_numeric($x) ? (float)$x : 0.0;
        $trcAgg = [];
        $s = $pdo->prepare("SELECT scouted_team_number, confidence, payload FROM scout_match_records WHERE scout_event_id=? AND is_ignored=0 AND showed_up=1");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $t  = (int)$r['scouted_team_number'];
            $w  = $W[$r['confidence'] ?? ''] ?? 0.5;
            $pl = (array)self::jsonCol($r['payload']);
            $a  = (array)($pl['auto'] ?? []);
            $te = (array)($pl['teleop'] ?? []);
            $eg = (array)($pl['endgame'] ?? []);
            $aMk  = $num($a['closeMake'] ?? 0) + $num($a['farMake'] ?? 0);
            $tMk  = $num($te['closeMake'] ?? 0) + $num($te['farMake'] ?? 0);
            $dnm  = (($a['movement'] ?? '') === 'did_not_move' || !empty($a['did_not_move'])) ? 1 : 0;
            $pk   = strtolower((string)($eg['park'] ?? ($pl['park'] ?? '')));
            $parkPts = str_contains($pk, 'full') || str_contains($pk, 'foul') ? 10 : (str_contains($pk, 'partial') ? 5 : 0);
            if (!isset($trcAgg[$t])) $trcAgg[$t] = ['w' => 0, 'a' => 0, 'te' => 0, 'dnm' => 0, 'park' => 0];
            $trcAgg[$t]['w'] += $w; $trcAgg[$t]['a'] += $w * $aMk; $trcAgg[$t]['te'] += $w * $tMk;
            $trcAgg[$t]['dnm'] += $w * $dnm; $trcAgg[$t]['park'] += $w * $parkPts;
        }
        $trcNpOpr = [];
        foreach ($trcAgg as $t => $v) {
            if ($v['w'] <= 0) continue;
            $trcNpOpr[$t] = round(($v['a'] / $v['w']) * 3 + (1 - $v['dnm'] / $v['w']) * 3 + ($v['te'] / $v['w']) * 3 + $v['park'] / $v['w'], 1);
        }

        $teamObj = function (int $t) use ($names, $liveOpr, $preOpr, $liveRank, $trcNpOpr): array {
            $live = $liveOpr[$t] ?? null; $pre = $preOpr[$t] ?? null;
            return ['team_number' => $t, 'team_name' => $names[$t] ?? null,
                'live_opr' => $live, 'pre_opr' => $pre, 'trc_npopr' => $trcNpOpr[$t] ?? null,
                'proj_opr' => $live ?? $pre, 'rank' => $liveRank[$t] ?? null];
        };

        $allianceProj = function (array $teamNums) use ($teamObj): array {
            $members = array_map($teamObj, $teamNums);
            usort($members, fn($a, $b) => ($b['proj_opr'] ?? -1e9) <=> ($a['proj_opr'] ?? -1e9));
            $proj = 0.0; foreach ($members as $m) $proj += $m['proj_opr'] ?? 0;
            return ['teams' => $members, 'proj' => round($proj, 1)];
        };

        // Fetch all non-Quals matches ordered by match_num
        $s = $pdo->prepare("SELECT * FROM scout_matches WHERE scout_event_id=? AND tournament_level != 'Quals' ORDER BY match_num");
        $s->execute([$eid]);
        $allPlayoff = $s->fetchAll();

        // ── No playoff data yet: project from qual standings ──────────────────
        if (empty($allPlayoff)) {
            $ranked = array_keys($liveRank);
            usort($ranked, fn($a, $b) => $liveRank[$a] <=> $liveRank[$b]);
            $n = count($ranked);
            // Table 13-2: alliance count scales with team count
            $ac = $n >= 41 ? 8 : ($n >= 21 ? 6 : ($n >= 11 ? 4 : ($n >= 4 ? 4 : 2)));
            $ac = min($ac, $n);

            $projAlliances = [];
            for ($i = 0; $i < $ac && isset($ranked[$i]); $i++) {
                $ap = $allianceProj([$ranked[$i]]);
                $projAlliances[] = array_merge($ap, [
                    'id' => 'A' . ($i + 1), 'seed' => $i + 1,
                    'wins' => 0, 'losses' => 0, 'status' => 'upper',
                ]);
            }

            // Upper bracket round-1 matchups (standard FTC seeding)
            // 4: 1v4, 2v3 | 6: 1v6, 2v5, 3v4 | 8: 1v8, 2v7, 3v6, 4v5
            $pairs = match($ac) {
                2 => [[0,1]],
                4 => [[0,3],[1,2]],
                6 => [[0,5],[1,4],[2,3]],
                8 => [[0,7],[1,6],[2,5],[3,4]],
                default => [[0,1]],
            };
            $projMatches = [];
            foreach ($pairs as [$ai, $bi]) {
                $a = $projAlliances[$ai] ?? null; $b = $projAlliances[$bi] ?? null;
                if (!$a || !$b) continue;
                $diff = $a['proj'] - $b['proj'];
                $projMatches[] = [
                    'match_num' => null, 'tournament_level' => 'Playoffs',
                    'round_label' => 'Upper Bracket – Round 1',
                    'red_alliance_id' => $a['id'], 'blue_alliance_id' => $b['id'],
                    'red_proj' => $a['proj'], 'blue_proj' => $b['proj'],
                    'spread' => round(abs($diff), 1),
                    'proj_winner' => abs($diff) < 1 ? 'Even' : ($diff > 0 ? 'Red' : 'Blue'),
                    'played' => false, 'red_score' => null, 'blue_score' => null,
                    'actual_winner' => null, 'correct' => null,
                    'red_diff' => null, 'blue_diff' => null,
                ];
            }

            return Http::json($res, [
                'source' => 'rankings', 'format' => 'double_elimination',
                'alliance_count' => $ac, 'alliances' => $projAlliances,
                'matches' => $projMatches, 'champion' => null,
            ]);
        }

        // ── Build alliances: prefer scout_event_alliances (from syncLive allianceRole data),
        //    fall back to inferring from match team assignments if the table is empty.
        $alliRows = $pdo->prepare("SELECT alliance_number, captain, pick1, pick2 FROM scout_event_alliances WHERE scout_event_id=? ORDER BY alliance_number");
        $alliRows->execute([$eid]);
        $alliData = $alliRows->fetchAll();

        $alliances = []; // id → alliance data (mutable W/L tracking)
        $keyToId   = [];

        if (!empty($alliData)) {
            // Real alliance selection data — alliance_number is the authoritative seed.
            foreach ($alliData as $row) {
                $nums = array_values(array_filter([(int)$row['captain'], (int)($row['pick1'] ?? 0), (int)($row['pick2'] ?? 0)]));
                $id   = 'A' . (int)$row['alliance_number'];
                sort($nums); $k = implode(',', $nums);
                $keyToId[$k] = $id;
                // Also register every pair subset so we match 2-team playoff sides
                // (pick2 may not play, so sides may only show captain+pick1)
                if (count($nums) === 3) {
                    $pairs = [[$nums[0],$nums[1]], [$nums[0],$nums[2]], [$nums[1],$nums[2]]];
                    foreach ($pairs as $p) { sort($p); $keyToId[implode(',', $p)] = $id; }
                }
                $alliances[$id] = array_merge($allianceProj($nums), [
                    'id' => $id, 'seed' => (int)$row['alliance_number'], 'team_key' => $k,
                    'wins' => 0, 'losses' => 0, 'status' => 'upper',
                ]);
            }
        } else {
            // No alliance table yet — infer from match team assignments (best effort).
            $teamKeyMap = [];
            foreach ($allPlayoff as $m) {
                $red  = array_values(array_filter([(int)($m['red1'] ?? 0),  (int)($m['red2'] ?? 0)]));
                $blue = array_values(array_filter([(int)($m['blue1'] ?? 0), (int)($m['blue2'] ?? 0)]));
                foreach ([$red, $blue] as $side) {
                    if (!$side) continue;
                    sort($side); $k = implode(',', $side);
                    if (!isset($teamKeyMap[$k])) $teamKeyMap[$k] = $side;
                }
            }
            $sortedKeys = array_keys($teamKeyMap);
            usort($sortedKeys, function ($ak, $bk) use ($teamKeyMap, $liveRank) {
                $ar = min(array_map(fn($t) => $liveRank[$t] ?? 999, $teamKeyMap[$ak]));
                $br = min(array_map(fn($t) => $liveRank[$t] ?? 999, $teamKeyMap[$bk]));
                return $ar <=> $br;
            });
            foreach ($sortedKeys as $i => $k) {
                $id = 'A' . ($i + 1);
                $keyToId[$k] = $id;
                $alliances[$id] = array_merge($allianceProj($teamKeyMap[$k]), [
                    'id' => $id, 'seed' => $i + 1, 'team_key' => $k,
                    'wins' => 0, 'losses' => 0, 'status' => 'upper',
                ]);
            }
        }

        // ── Process DB matches to build W/L state ────────────────────────────
        // We first pass through all DB matches to update alliance W/L so that
        // $findPlayed and the template can resolve winners/losers correctly.
        $matchesRaw = []; // keyed by alliance-pair for findPlayed lookup
        foreach ($allPlayoff as $m) {
            $red  = array_values(array_filter([(int)($m['red1'] ?? 0),  (int)($m['red2'] ?? 0)]));
            $blue = array_values(array_filter([(int)($m['blue1'] ?? 0), (int)($m['blue2'] ?? 0)]));
            sort($red); sort($blue);
            $redId  = $keyToId[implode(',', $red)]  ?? null;
            $blueId = $keyToId[implode(',', $blue)] ?? null;
            $redProj  = $redId  ? $alliances[$redId]['proj']  : 0.0;
            $blueProj = $blueId ? $alliances[$blueId]['proj'] : 0.0;
            $diff = $redProj - $blueProj;
            $played = (bool)$m['has_been_played'];
            $rs = ($played && $m['red_score']  !== null) ? (int)$m['red_score']  : null;
            $bs = ($played && $m['blue_score'] !== null) ? (int)$m['blue_score'] : null;
            $actualWinner = null;
            if ($played && $rs !== null && $bs !== null) {
                if ($rs > $bs) {
                    $actualWinner = 'Red';
                    if ($redId)  $alliances[$redId]['wins']++;
                    if ($blueId) $alliances[$blueId]['losses']++;
                } elseif ($bs > $rs) {
                    $actualWinner = 'Blue';
                    if ($blueId) $alliances[$blueId]['wins']++;
                    if ($redId)  $alliances[$redId]['losses']++;
                }
            }
            $redPlaying  = array_values(array_filter([(int)($m['red1'] ?? 0), (int)($m['red2'] ?? 0)]));
            $bluePlaying = array_values(array_filter([(int)($m['blue1'] ?? 0), (int)($m['blue2'] ?? 0)]));
            $entry = [
                'match_num' => (int)$m['match_num'], 'tournament_level' => $m['tournament_level'],
                'red_alliance_id' => $redId, 'blue_alliance_id' => $blueId,
                'red_proj' => $redProj, 'blue_proj' => $blueProj,
                'red_score' => $rs, 'blue_score' => $bs,
                'red_playing' => $redPlaying, 'blue_playing' => $bluePlaying,
                'spread' => round(abs($diff), 1),
                'proj_winner' => abs($diff) < 1 ? 'Even' : ($diff > 0 ? 'Red' : 'Blue'),
                'actual_winner' => $actualWinner, 'played' => $played,
                'correct' => ($actualWinner !== null && abs($diff) >= 1)
                             ? (($diff > 0 ? 'Red' : 'Blue') === $actualWinner) : null,
                'red_diff'  => ($played && $rs !== null) ? round($rs  - $redProj, 1) : null,
                'blue_diff' => ($played && $bs !== null) ? round($bs - $blueProj, 1) : null,
            ];
            $matchesRaw[] = $entry;
        }

        // Find the decisive played match between two alliances (highest match_num wins ties/replays)
        $findPlayed = function (string $id1, string $id2) use ($matchesRaw): ?array {
            $found = null;
            foreach ($matchesRaw as $m) {
                if (!$m['played']) continue;
                if (($m['red_alliance_id'] === $id1 && $m['blue_alliance_id'] === $id2) ||
                    ($m['red_alliance_id'] === $id2 && $m['blue_alliance_id'] === $id1)) {
                    if ($found === null || $m['match_num'] > ($found['match_num'] ?? 0)) $found = $m;
                }
            }
            return $found;
        };

        // Also find a scheduled-but-unplayed match between two alliances
        $findScheduled = function (string $id1, string $id2) use ($matchesRaw): ?array {
            foreach ($matchesRaw as $m) {
                if ($m['played']) continue;
                if (($m['red_alliance_id'] === $id1 && $m['blue_alliance_id'] === $id2) ||
                    ($m['red_alliance_id'] === $id2 && $m['blue_alliance_id'] === $id1)) return $m;
            }
            return null;
        };

        // ── Explicit bracket template (FTC §13.7) ────────────────────────────
        // Upper QF seeding order from DECODE 2025-26 competition manual:
        //   M1: A1 vs A8 | M2: A4 vs A5 | M3: A2 vs A7 | M4: A3 vs A6
        // Upper SF cross-pairs winners: (M1w vs M4w) and (M2w vs M3w)
        // Source notation: 's:N' = seed index (0-based), 'w:ID' = winner of pos, 'l:ID' = loser.
        // '!' prefix = conditional position (Grand Final Reset).
        $templates = [
            4 => [
                ['UQF1', 'Upper R1 \xc2\xb7 Match 1', 's:0', 's:3'],
                ['UQF2', 'Upper R1 \xc2\xb7 Match 2', 's:1', 's:2'],
                ['LR1',  'Lower R1',                  'l:UQF1', 'l:UQF2'],
                ['UF',   'Upper Final',                'w:UQF1', 'w:UQF2'],
                ['LF',   'Lower Final',                'l:UF',   'w:LR1'],
                ['GF',   'Grand Final',                'w:UF',   'w:LF'],
                ['!GFR', 'Grand Final Reset',          'w:UF',   'w:GF'],
            ],
            8 => [
                ['UQF1', 'Upper QF \xc2\xb7 Match 1', 's:0', 's:7'],  // A1 vs A8
                ['UQF2', 'Upper QF \xc2\xb7 Match 2', 's:3', 's:4'],  // A4 vs A5
                ['UQF3', 'Upper QF \xc2\xb7 Match 3', 's:1', 's:6'],  // A2 vs A7
                ['UQF4', 'Upper QF \xc2\xb7 Match 4', 's:2', 's:5'],  // A3 vs A6
                ['LR1a', 'Lower R1 \xc2\xb7 Match 1', 'l:UQF1', 'l:UQF2'],
                ['LR1b', 'Lower R1 \xc2\xb7 Match 2', 'l:UQF3', 'l:UQF4'],
                ['USF1', 'Upper SF \xc2\xb7 Match 1', 'w:UQF1', 'w:UQF4'],
                ['USF2', 'Upper SF \xc2\xb7 Match 2', 'w:UQF2', 'w:UQF3'],
                ['LR2a', 'Lower R2 \xc2\xb7 Match 1', 'l:USF1', 'w:LR1a'],
                ['LR2b', 'Lower R2 \xc2\xb7 Match 2', 'l:USF2', 'w:LR1b'],
                ['UF',   'Upper Final',                'w:USF1', 'w:USF2'],
                ['LSF',  'Lower SF',                   'w:LR2a', 'w:LR2b'],
                ['LF',   'Lower Final',                'l:UF',   'w:LSF'],
                ['GF',   'Grand Final',                'w:UF',   'w:LF'],
                ['!GFR', 'Grand Final Reset',          'w:UF',   'w:GF'],
            ],
        ];

        $bySeeds = array_values($alliances); // sorted by seed ascending
        $template = $templates[count($bySeeds)] ?? null;
        $defaultPlaying = fn(array $a) => array_column(array_slice($a['teams'], 0, 2), 'team_number');

        $matchesOut = [];
        if ($template !== null) {
            $resolved = []; // posId → ['winner' => alliance, 'loser' => alliance]

            $resolveAlly = function (string $src) use (&$resolved, $bySeeds): ?array {
                if ($src[0] === 's') return $bySeeds[(int)substr($src, 2)] ?? null;
                $pos = substr($src, 2);
                $dep = $resolved[$pos] ?? null;
                if (!$dep) return null;
                return $src[0] === 'w' ? $dep['winner'] : $dep['loser'];
            };

            foreach ($template as [$rawId, $label, $rSrc, $bSrc]) {
                $conditional = $rawId[0] === '!';
                $posId = ltrim($rawId, '!');
                $redA  = $resolveAlly($rSrc);
                $blueA = $resolveAlly($bSrc);
                if (!$redA || !$blueA) continue;

                if ($conditional) {
                    // GFR only needed if the lower-bracket team won the Grand Final
                    $gfRes = $resolved['GF'] ?? null;
                    $lfRes = $resolved['LF'] ?? null;
                    if (!$gfRes || !$lfRes || $gfRes['winner']['id'] !== $lfRes['winner']['id']) continue;
                }

                // Use real played match if it exists; fall back to scheduled-but-unplayed;
                // fall back to a fully projected entry.
                $played = $findPlayed($redA['id'], $blueA['id']);
                $sched  = !$played ? $findScheduled($redA['id'], $blueA['id']) : null;

                if ($played) {
                    $match = array_merge($played, ['round_label' => $label, 'is_projected' => false]);
                } elseif ($sched) {
                    $match = array_merge($sched, ['round_label' => $label, 'is_projected' => true]);
                } else {
                    $diff = $redA['proj'] - $blueA['proj'];
                    $match = [
                        'match_num' => null, 'tournament_level' => 'Playoffs',
                        'round_label' => $label, 'is_projected' => true,
                        'red_alliance_id' => $redA['id'], 'blue_alliance_id' => $blueA['id'],
                        'red_proj' => $redA['proj'], 'blue_proj' => $blueA['proj'],
                        'red_score' => null, 'blue_score' => null,
                        'red_playing'  => $defaultPlaying($redA),
                        'blue_playing' => $defaultPlaying($blueA),
                        'spread' => round(abs($diff), 1),
                        'proj_winner' => abs($diff) < 1 ? 'Even' : ($diff > 0 ? 'Red' : 'Blue'),
                        'played' => false, 'actual_winner' => null, 'correct' => null,
                        'red_diff' => null, 'blue_diff' => null,
                    ];
                }

                // Determine winner/loser for downstream positions
                $aw = $match['actual_winner'] ?? null;
                $pw = $match['proj_winner']   ?? 'Red';
                if ($aw === 'Red')      { $winner = $redA;  $loser = $blueA; }
                elseif ($aw === 'Blue') { $winner = $blueA; $loser = $redA; }
                else {
                    $winner = ($pw !== 'Blue') ? $redA : $blueA;
                    $loser  = ($winner === $redA) ? $blueA : $redA;
                }
                $resolved[$posId] = ['winner' => $winner, 'loser' => $loser];
                $matchesOut[] = $match;
            }
        } else {
            // No template for this alliance count — emit raw DB matches only
            $matchesOut = $matchesRaw;
        }

        // ── Final statuses and champion detection ─────────────────────────────
        $champion = null;
        foreach ($alliances as $id => &$a) {
            if ($a['losses'] >= 2)      $a['status'] = 'eliminated';
            elseif ($a['losses'] === 1) $a['status'] = 'lower';
            else                        $a['status'] = 'upper';
        }
        unset($a);
        // Champion = the only non-eliminated alliance after all real matches
        $active = array_filter($alliances, fn($a) => $a['losses'] < 2);
        if (count($active) === 1) {
            $ch = reset($active);
            $alliances[$ch['id']]['status'] = 'champion';
            $champion = $alliances[$ch['id']];
        }

        usort($alliances, fn($a, $b) => $a['seed'] <=> $b['seed']);

        return Http::json($res, [
            'source' => 'matches', 'format' => 'double_elimination',
            'alliance_count' => count($alliances),
            'alliances' => array_values($alliances),
            'matches' => $matchesOut,
            'champion' => $champion,
        ]);
    }

    /**
     * GET /scouting/events/{event_id}/pre-event-table — a flat, sortable detail row per
     * team: npOPR, Auto/Teleop OPR, artifact + penalty OPR components, and historical
     * npAVG/Auto/Teleop averages, with an OPR rank (1 = best npOPR). The client sorts.
     */
    public static function preEventTable(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $names = [];
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];
        $s = $pdo->prepare("SELECT team_number, np_opr, stats FROM scout_preevent_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        $num = fn($v) => is_numeric($v) ? round((float)$v, 1) : null;
        $rows = [];
        foreach ($s->fetchAll() as $r) {
            $all = (array)self::jsonCol($r['stats']); $opr = self::oprFrom($r['stats']); $avg = (array)($all['avg'] ?? []);
            $rows[] = [
                'team_number' => (int)$r['team_number'], 'team_name' => $names[(int)$r['team_number']] ?? null,
                'np_opr' => $r['np_opr'] !== null ? round((float)$r['np_opr'], 1) : null,
                'auto_opr' => $num($opr['autoPoints'] ?? null), 'teleop_opr' => $num($opr['dcPoints'] ?? null),
                'auto_artifact_opr' => $num($opr['autoArtifactPoints'] ?? null), 'teleop_artifact_opr' => $num($opr['dcArtifactPoints'] ?? null),
                'pen_drawn_opr' => $num($opr['penaltyPointsByOpp'] ?? null), 'pen_given_opr' => $num($opr['penaltyPointsCommitted'] ?? null),
                'np_avg' => $num($avg['totalPointsNp'] ?? null), 'auto_avg' => $num($avg['autoPoints'] ?? null), 'teleop_avg' => $num($avg['dcPoints'] ?? null),
            ];
        }
        // Rank by best npOPR (1 = best); teams without a projection sort last with null rank.
        usort($rows, fn($a, $b) => ($b['np_opr'] ?? -1e9) <=> ($a['np_opr'] ?? -1e9));
        $i = 0; foreach ($rows as &$row) { $row['opr_rank'] = $row['np_opr'] !== null ? ++$i : null; } unset($row);
        $columns = [
            ['key' => 'opr_rank', 'label' => 'Rank', 'num' => true],
            ['key' => 'team_number', 'label' => 'Team', 'num' => true],
            ['key' => 'team_name', 'label' => 'Name', 'num' => false],
            ['key' => 'np_opr', 'label' => 'npOPR', 'num' => true],
            ['key' => 'auto_opr', 'label' => 'AutoOPR', 'num' => true],
            ['key' => 'teleop_opr', 'label' => 'TeleOPR', 'num' => true],
            ['key' => 'np_avg', 'label' => 'npAVG', 'num' => true],
            ['key' => 'auto_avg', 'label' => 'AutoAVG', 'num' => true],
            ['key' => 'teleop_avg', 'label' => 'TeleAVG', 'num' => true],
            ['key' => 'auto_artifact_opr', 'label' => 'AutoArt', 'num' => true],
            ['key' => 'teleop_artifact_opr', 'label' => 'TeleArt', 'num' => true],
            ['key' => 'pen_drawn_opr', 'label' => 'PenFor', 'num' => true],
            ['key' => 'pen_given_opr', 'label' => 'PenAgst', 'num' => true],
        ];
        return Http::json($res, ['count' => count($rows), 'columns' => $columns, 'projection_basis' => self::projectionBasis($pdo, $eid), 'items' => $rows]);
    }

    /**
     * GET /scouting/events/{event_id}/team-summaries — per-team quick scouting summary
     * for the whole event: confidence-weighted avg artifacts scored in auto and teleop.
     * Used by the match picker to show each robot's scoring at a glance.
     */
    public static function teamSummaries(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $W = ['low' => 0.25, 'medium' => 0.5, 'high' => 0.75, 'very_high' => 0.9];
        $num = fn($x) => is_numeric($x) ? (float)$x : 0.0;
        $agg = [];
        $s = $pdo->prepare("SELECT scouted_team_number, confidence, payload FROM scout_match_records WHERE scout_event_id=? AND is_ignored=0 AND showed_up=1");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $t = (int)$r['scouted_team_number']; $w = $W[$r['confidence'] ?? ''] ?? 0.5;
            $pl = (array)self::jsonCol($r['payload']); $a = (array)($pl['auto'] ?? []); $te = (array)($pl['teleop'] ?? []);
            $aMk = $num($a['closeMake'] ?? 0) + $num($a['farMake'] ?? 0);
            $tMk = $num($te['closeMake'] ?? 0) + $num($te['farMake'] ?? 0);
            if (!isset($agg[$t])) $agg[$t] = ['w' => 0, 'a' => 0, 'te' => 0, 'n' => 0];
            $agg[$t]['w'] += $w; $agg[$t]['a'] += $w * $aMk; $agg[$t]['te'] += $w * $tMk; $agg[$t]['n']++;
        }
        $items = [];
        foreach ($agg as $t => $v) $items[] = ['team_number' => $t, 'records' => $v['n'],
            'auto_avg_made' => $v['w'] > 0 ? round($v['a'] / $v['w'], 1) : null,
            'teleop_avg_made' => $v['w'] > 0 ? round($v['te'] / $v['w'], 1) : null];
        return Http::json($res, ['items' => $items]);
    }

    /**
     * GET /scouting/events/{event_id}/team/{team_number}/report — the drive-team
     * scouting report for one robot: pre-event projection, live OPR + delta,
     * consolidated pit data (across non-ignored reports), confidence-weighted match
     * aggregates, and observations. This is what the drive team reads before a match.
     */
    public static function teamReport(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $team = (int)$route['team_number'];

        $nm = $pdo->prepare("SELECT team_name FROM scout_event_teams WHERE scout_event_id=? AND team_number=?");
        $nm->execute([$eid, $team]);
        $teamName = $nm->fetchColumn() ?: null;

        // Pre-event projection (baseline) + live OPR (kept separate).
        $p = $pdo->prepare("SELECT np_opr, stats FROM scout_preevent_stats WHERE scout_event_id=? AND team_number=?");
        $p->execute([$eid, $team]); $pre = $p->fetch() ?: null;
        $l = $pdo->prepare("SELECT opr_total, `rank`, qual_matches_played, stats FROM scout_live_stats WHERE scout_event_id=? AND team_number=?");
        $l->execute([$eid, $team]); $live = $l->fetch() ?: null;
        $preNp = $pre && $pre['np_opr'] !== null ? (float)$pre['np_opr'] : null;
        $liveOpr = $live && $live['opr_total'] !== null ? (float)$live['opr_total'] : null;

        // Pit consolidation: tally distinct values per field across non-ignored reports,
        // so the drive team sees agreement (and disagreement) at a glance.
        $pitStmt = $pdo->prepare("SELECT * FROM scout_pit_reports WHERE scout_event_id=? AND team_number=? ORDER BY created_at");
        $pitStmt->execute([$eid, $team]); $pitRows = $pitStmt->fetchAll();
        $tally = [];
        foreach ($pitRows as $r) {
            if ($r['is_ignored']) continue;
            foreach ((array)self::jsonCol($r['payload']) as $k => $v) {
                if ($k === 'message') continue;   // free-text color note — shown in Messages, not as a pit field
                $vs = is_array($v) ? implode(', ', $v) : (string)$v;
                if ($vs === '') continue;
                $tally[$k][$vs] = ($tally[$k][$vs] ?? 0) + 1;
            }
        }
        $consolidated = [];
        foreach ($tally as $k => $vals) {
            arsort($vals);
            $consolidated[$k] = array_map(fn($val, $cnt) => ['value' => $val, 'count' => $cnt], array_keys($vals), array_values($vals));
        }

        // Match aggregation — confidence-weighted over non-ignored records where the team showed up.
        $mr = $pdo->prepare("SELECT match_num, scouter_name, client_uuid, confidence, showed_up, payload FROM scout_match_records WHERE scout_event_id=? AND scouted_team_number=? AND is_ignored=0 ORDER BY match_num");
        $mr->execute([$eid, $team]); $mrows = $mr->fetchAll();
        $W = ['low' => 0.25, 'medium' => 0.5, 'high' => 0.75, 'very_high' => 0.9];
        $num = fn($x) => is_numeric($x) ? (float)$x : 0.0;
        $wsum = 0; $n = 0; $autoMakeW = 0; $autoAttW = 0; $teleMakeW = 0; $teleAttW = 0; $majW = 0; $minW = 0; $dnm = 0; $fail = 0;
        // close/far splits (weighted) for the per-zone breakdown lines
        $aCloseMkW = 0; $aCloseAtW = 0; $aFarMkW = 0; $aFarAtW = 0; $tCloseMkW = 0; $tCloseAtW = 0; $tFarMkW = 0; $tFarAtW = 0;
        $park = []; $pen = [];
        foreach ($mrows as $r) {
            if (!$r['showed_up']) continue;
            $w = $W[$r['confidence'] ?? ''] ?? 0.5;
            $pl = (array)self::jsonCol($r['payload']);
            $a = (array)($pl['auto'] ?? []); $t = (array)($pl['teleop'] ?? []); $e = (array)($pl['endgame'] ?? []);
            $aMake = $num($a['closeMake'] ?? 0) + $num($a['farMake'] ?? 0);
            $aAtt = $aMake + $num($a['closeMiss'] ?? 0) + $num($a['farMiss'] ?? 0);
            $tMake = $num($t['closeMake'] ?? 0) + $num($t['farMake'] ?? 0);
            $tAtt = $tMake + $num($t['closeMiss'] ?? 0) + $num($t['farMiss'] ?? 0);
            $n++; $wsum += $w;
            $autoMakeW += $w * $aMake; $autoAttW += $w * $aAtt;
            $teleMakeW += $w * $tMake; $teleAttW += $w * $tAtt;
            $aCloseMkW += $w * $num($a['closeMake'] ?? 0); $aCloseAtW += $w * ($num($a['closeMake'] ?? 0) + $num($a['closeMiss'] ?? 0));
            $aFarMkW += $w * $num($a['farMake'] ?? 0);     $aFarAtW += $w * ($num($a['farMake'] ?? 0) + $num($a['farMiss'] ?? 0));
            $tCloseMkW += $w * $num($t['closeMake'] ?? 0); $tCloseAtW += $w * ($num($t['closeMake'] ?? 0) + $num($t['closeMiss'] ?? 0));
            $tFarMkW += $w * $num($t['farMake'] ?? 0);     $tFarAtW += $w * ($num($t['farMake'] ?? 0) + $num($t['farMiss'] ?? 0));
            $majW += $w * ($num($a['majorPenalties'] ?? 0) + $num($t['majorPenalties'] ?? 0));
            $minW += $w * ($num($a['minorPenalties'] ?? 0) + $num($t['minorPenalties'] ?? 0));
            if (($a['movement'] ?? '') === 'did_not_move' || !empty($a['did_not_move'])) $dnm++;   // movement enum (new) or legacy flag
            if (!empty($t['majorFailure'])) $fail++;
            if (!empty($e['park'])) $park[$e['park']] = ($park[$e['park']] ?? 0) + 1;
            if (!empty($e['penalty'])) $pen[$e['penalty']] = ($pen[$e['penalty']] ?? 0) + 1;
        }
        $match = $n ? [
            'records' => $n,
            'auto_avg_made' => $wsum > 0 ? round($autoMakeW / $wsum, 1) : null,
            'auto_accuracy' => $autoAttW > 0 ? round($autoMakeW / $autoAttW, 2) : null,
            'auto_close_made' => $wsum > 0 ? round($aCloseMkW / $wsum, 1) : null,
            'auto_close_accuracy' => $aCloseAtW > 0 ? round($aCloseMkW / $aCloseAtW, 2) : null,
            'auto_far_made' => $wsum > 0 ? round($aFarMkW / $wsum, 1) : null,
            'auto_far_accuracy' => $aFarAtW > 0 ? round($aFarMkW / $aFarAtW, 2) : null,
            'teleop_avg_made' => $wsum > 0 ? round($teleMakeW / $wsum, 1) : null,
            'teleop_accuracy' => $teleAttW > 0 ? round($teleMakeW / $teleAttW, 2) : null,
            'teleop_close_made' => $wsum > 0 ? round($tCloseMkW / $wsum, 1) : null,
            'teleop_close_accuracy' => $tCloseAtW > 0 ? round($tCloseMkW / $tCloseAtW, 2) : null,
            'teleop_far_made' => $wsum > 0 ? round($tFarMkW / $wsum, 1) : null,
            'teleop_far_accuracy' => $tFarAtW > 0 ? round($tFarMkW / $tFarAtW, 2) : null,
            'avg_major_penalties' => $wsum > 0 ? round($majW / $wsum, 1) : null,
            'avg_minor_penalties' => $wsum > 0 ? round($minW / $wsum, 1) : null,
            'did_not_move_rate' => round($dnm / $n, 2),
            'major_failure_rate' => round($fail / $n, 2),
            'park_distribution' => $park,
            'penalty_distribution' => $pen,
        ] : null;

        $ob = $pdo->prepare("SELECT observation, tags, scouter_name, match_num, created_at FROM scout_observations WHERE scout_event_id=? AND team_number=? AND is_ignored=0 ORDER BY created_at DESC");
        $ob->execute([$eid, $team]);
        $obs = array_map(fn($r) => [
            'observation' => $r['observation'], 'tags' => self::jsonCol($r['tags']),
            'scouter_name' => $r['scouter_name'], 'match_num' => $r['match_num'] !== null ? (int)$r['match_num'] : null,
            'created_at' => Time::naiveIso($r['created_at']),
        ], $ob->fetchAll());

        try {
            $ps = $pdo->prepare("SELECT id, file_path, is_profile FROM scout_robot_photos WHERE scout_event_id=? AND team_number=? ORDER BY is_profile DESC, created_at");
            $ps->execute([$eid, $team]);
            $photos = array_map(fn($r) => ['id' => (int)$r['id'], 'url' => $r['file_path'], 'is_profile' => (bool)$r['is_profile']], $ps->fetchAll());
        } catch (\Throwable $e) {
            // Table may not exist yet if migration 0026 hasn't run.
            $photos = [];
        }

        // Per-match history: expand each scouted record into individual stats rows,
        // joined with the schedule so we can show alliance partners.
        $mhStmt = $pdo->prepare("
            SELECT mr.match_num, mr.tournament_level, mr.alliance, mr.scouter_name,
                   mr.showed_up, mr.whole_match, mr.confidence, mr.payload,
                   sm.red1, sm.red2, sm.blue1, sm.blue2,
                   sm.red_score, sm.blue_score, sm.has_been_played
            FROM scout_match_records mr
            LEFT JOIN scout_matches sm
                   ON sm.scout_event_id = mr.scout_event_id
                  AND sm.match_num      = mr.match_num
                  AND sm.tournament_level = mr.tournament_level
            WHERE mr.scout_event_id = ? AND mr.scouted_team_number = ? AND mr.is_ignored = 0
            ORDER BY mr.match_num
        ");
        $mhStmt->execute([$eid, $team]);
        $matchHistory = array_map(function ($r) use ($team, $num) {
            $pl = (array)self::jsonCol($r['payload']);
            $a  = (array)($pl['auto']    ?? []);
            $t  = (array)($pl['teleop']  ?? []);
            $e  = (array)($pl['endgame'] ?? []);
            $aMake = $num($a['closeMake'] ?? 0) + $num($a['farMake'] ?? 0);
            $aAtt  = $aMake + $num($a['closeMiss'] ?? 0) + $num($a['farMiss'] ?? 0);
            $tMake = $num($t['closeMake'] ?? 0) + $num($t['farMake'] ?? 0);
            $tAtt  = $tMake + $num($t['closeMiss'] ?? 0) + $num($t['farMiss'] ?? 0);
            $alliance = $r['alliance'];
            $partners = [];
            if ($alliance === 'Red') {
                if ($r['red1'] && (int)$r['red1'] !== $team) $partners[] = (int)$r['red1'];
                if ($r['red2'] && (int)$r['red2'] !== $team) $partners[] = (int)$r['red2'];
            } elseif ($alliance === 'Blue') {
                if ($r['blue1'] && (int)$r['blue1'] !== $team) $partners[] = (int)$r['blue1'];
                if ($r['blue2'] && (int)$r['blue2'] !== $team) $partners[] = (int)$r['blue2'];
            }
            $majPen = (int)($num($a['majorPenalties'] ?? 0) + $num($t['majorPenalties'] ?? 0));
            $minPen = (int)($num($a['minorPenalties'] ?? 0) + $num($t['minorPenalties'] ?? 0));
            return [
                'match_num'        => (int)$r['match_num'],
                'tournament_level' => $r['tournament_level'],
                'alliance'         => $alliance,
                'partners'         => $partners,
                'showed_up'        => (bool)$r['showed_up'],
                'whole_match'      => (bool)$r['whole_match'],
                'confidence'       => $r['confidence'],
                'scouter_name'     => $r['scouter_name'],
                'auto_made'        => $aMake,
                'auto_att'         => $aAtt,
                'auto_acc'         => $aAtt > 0 ? round($aMake / $aAtt, 2) : null,
                'auto_close_made'  => $num($a['closeMake'] ?? 0),
                'auto_far_made'    => $num($a['farMake']   ?? 0),
                'teleop_made'      => $tMake,
                'teleop_att'       => $tAtt,
                'teleop_acc'       => $tAtt > 0 ? round($tMake / $tAtt, 2) : null,
                'teleop_close_made'=> $num($t['closeMake'] ?? 0),
                'teleop_far_made'  => $num($t['farMake']   ?? 0),
                'major_penalties'  => $majPen,
                'minor_penalties'  => $minPen,
                'did_not_move'     => ($a['movement'] ?? '') === 'did_not_move' || !empty($a['did_not_move']),
                'major_failure'    => !empty($t['majorFailure']),
                'park'             => $e['park'] ?? null,
                'message'          => trim((string)($pl['message'] ?? '')),
                'red_score'        => $r['red_score'] !== null ? (int)$r['red_score'] : null,
                'blue_score'       => $r['blue_score'] !== null ? (int)$r['blue_score'] : null,
                'has_been_played'  => (bool)$r['has_been_played'],
            ];
        }, $mhStmt->fetchAll());

        return Http::json($res, [
            'team_number' => $team, 'team_name' => $teamName,
            'pre_event' => $pre ? ['np_opr' => $preNp, 'opr' => self::oprFrom($pre['stats']), 'avg' => ((array)self::jsonCol($pre['stats']))['avg'] ?? null] : null,
            'live' => $live ? [
                'opr_total' => $liveOpr, 'rank' => $live['rank'] !== null ? (int)$live['rank'] : null,
                'qual_matches_played' => $live['qual_matches_played'] !== null ? (int)$live['qual_matches_played'] : null,
                'delta' => ($preNp !== null && $liveOpr !== null) ? round($liveOpr - $preNp, 1) : null,
            ] : null,
            'pit' => ['report_count' => count($pitRows), 'consolidated' => $consolidated, 'reports' => array_map([self::class, 'serializePit'], $pitRows)],
            'match' => $match,
            'observations' => $obs,
            'messages' => self::scouterMessages($pitRows, $mrows),
            'photos' => $photos,
            'match_history' => $matchHistory,
        ]);
    }

    // ── Robot photos ────────────────────────────────────────────────────────────────

    private static function photosTableExists(\PDO $pdo): bool
    {
        try { $pdo->query("SELECT 1 FROM scout_robot_photos LIMIT 1"); return true; } catch (\Throwable $e) { return false; }
    }

    /** GET /scouting/events/{event_id}/teams/{team_number}/photos */
    public static function listRobotPhotos(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        if (!self::photosTableExists($pdo)) return Http::json($res, ['photos' => [], 'migration_pending' => true]);
        $eid = (int)$route['event_id']; $team = (int)$route['team_number'];
        $s = $pdo->prepare("SELECT id, file_path, is_profile FROM scout_robot_photos WHERE scout_event_id=? AND team_number=? ORDER BY is_profile DESC, created_at");
        $s->execute([$eid, $team]);
        return Http::json($res, ['photos' => array_map(fn($r) => ['id' => (int)$r['id'], 'url' => $r['file_path'], 'is_profile' => (bool)$r['is_profile']], $s->fetchAll())]);
    }

    /** POST /scouting/events/{event_id}/teams/{team_number}/photos  (JSON: {image_data: "data:image/jpeg;base64,..."}) */
    public static function uploadRobotPhoto(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        if (!self::photosTableExists($pdo)) return Http::error($res, 'Robot photos table not set up yet — run migration 0026.', 503);
        $eid = (int)$route['event_id']; $team = (int)$route['team_number'];
        $chk = $pdo->prepare("SELECT 1 FROM scout_event_teams WHERE scout_event_id=? AND team_number=?");
        $chk->execute([$eid, $team]);
        if (!$chk->fetch()) return Http::error($res, 'Team not in event', 404);

        // Accept a base64 data URL in a JSON body — avoids PHP multipart upload
        // size limits (upload_max_filesize) which are hard to override on Plesk FPM.
        // getParsedBody() may be null if Slim's BodyParsingMiddleware didn't run for
        // this route; fall back to decoding the raw body stream directly.
        $body = (array)$req->getParsedBody();
        if (empty($body)) {
            $raw = (string)$req->getBody();
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) $body = $decoded;
        }
        $dataUrl = $body['image_data'] ?? '';
        if (!$dataUrl || !preg_match('/^data:image\/(jpeg|png|webp|gif);base64,(.+)$/s', $dataUrl, $m)) {
            return Http::error($res, 'Missing or invalid image_data field (expected a base64 JPEG data URL).', 400);
        }
        $imageBytes = base64_decode($m[2], true);
        if ($imageBytes === false || strlen($imageBytes) < 100) {
            return Http::error($res, 'image_data could not be decoded.', 400);
        }
        if (strlen($imageBytes) > 8 * 1024 * 1024) {
            return Http::error($res, 'Image too large after decoding (max 8 MB).', 400);
        }
        $ext = '.' . $m[1];
        $filename = 'robot_' . $eid . '_' . $team . '_' . bin2hex(random_bytes(8)) . $ext;
        $dir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'uploads';
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            return Http::error($res, 'Upload directory could not be created — check server file permissions.', 500);
        }
        $written = file_put_contents($dir . DIRECTORY_SEPARATOR . $filename, $imageBytes);
        if ($written === false) {
            return Http::error($res, 'File save failed — check server write permissions on public/uploads.', 500);
        }
        $filePath = '/uploads/' . $filename;
        $ins = $pdo->prepare("INSERT INTO scout_robot_photos (scout_event_id, team_number, file_path, uploaded_by_member_id) VALUES (?,?,?,?)");
        $ins->execute([$eid, $team, $filePath, (int)$cur['id']]);
        return Http::json($res, ['id' => (int)$pdo->lastInsertId(), 'url' => $filePath, 'is_profile' => false], 201);
    }

    /** PATCH /scouting/events/{event_id}/teams/{team_number}/photos/{photo_id}/profile */
    public static function setProfilePhoto(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        if (!self::photosTableExists($pdo)) return Http::error($res, 'Robot photos table not set up yet — run migration 0026.', 503);
        $eid = (int)$route['event_id']; $team = (int)$route['team_number']; $pid = (int)$route['photo_id'];
        $chk = $pdo->prepare("SELECT id FROM scout_robot_photos WHERE id=? AND scout_event_id=? AND team_number=?");
        $chk->execute([$pid, $eid, $team]);
        if (!$chk->fetch()) return Http::error($res, 'Photo not found', 404);
        $pdo->prepare("UPDATE scout_robot_photos SET is_profile=0 WHERE scout_event_id=? AND team_number=?")->execute([$eid, $team]);
        $pdo->prepare("UPDATE scout_robot_photos SET is_profile=1 WHERE id=?")->execute([$pid]);
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /scouting/events/{event_id}/teams/{team_number}/photos/{photo_id} */
    public static function deleteRobotPhoto(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        if (!self::photosTableExists($pdo)) return Http::error($res, 'Robot photos table not set up yet — run migration 0026.', 503);
        $eid = (int)$route['event_id']; $team = (int)$route['team_number']; $pid = (int)$route['photo_id'];
        $s = $pdo->prepare("SELECT file_path FROM scout_robot_photos WHERE id=? AND scout_event_id=? AND team_number=?");
        $s->execute([$pid, $eid, $team]); $photo = $s->fetch();
        if (!$photo) return Http::error($res, 'Photo not found', 404);
        $abs = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . str_replace('/', DIRECTORY_SEPARATOR, $photo['file_path']);
        if (file_exists($abs)) @unlink($abs);
        $pdo->prepare("DELETE FROM scout_robot_photos WHERE id=?")->execute([$pid]);
        return Http::json($res, ['ok' => true]);
    }

    /** Collect "Message from scouter" notes (payload.message) from pit + match records, pit first then by match #. */
    private static function scouterMessages(array $pitRows, array $mrows): array
    {
        $messages = [];
        foreach ($pitRows as $r) {
            if (!empty($r['is_ignored'])) continue;
            $msg = trim((string)(((array)self::jsonCol($r['payload']))['message'] ?? ''));
            if ($msg !== '') $messages[] = ['source' => 'Pit Scouting', 'match_num' => null, 'scouter' => $r['scouter_name'] ?: 'Scout', 'text' => $msg, 'client_uuid' => $r['client_uuid'] ?? null];
        }
        foreach ($mrows as $r) {
            $msg = trim((string)(((array)self::jsonCol($r['payload']))['message'] ?? ''));
            if ($msg !== '') $messages[] = ['source' => 'Match ' . (int)$r['match_num'], 'match_num' => (int)$r['match_num'], 'scouter' => $r['scouter_name'] ?: 'Scout', 'text' => $msg, 'client_uuid' => $r['client_uuid'] ?? null];
        }
        usort($messages, fn($a, $b) => ($a['match_num'] ?? -1) <=> ($b['match_num'] ?? -1));
        return $messages;
    }

    /**
     * GET /scouting/events/{event_id}/reconcile — apply the season's reconciliationRules
     * to flag teams whose live performance diverges from their pre-event projection
     * (over/under-performers), so the strategy lead can spot risers and teams being
     * dragged down by partners/penalties. Needs live stats synced (compares pre vs live).
     *
     * Each rule: { metric, compare, against, operator, threshold, label, severity }.
     *   compare/against are value SOURCES — 'liveOpr' or 'preNpOpr' (pit-claim sources
     *   are not yet unit-mapped, so those rules are skipped). threshold is a number or
     *   "N*dev" (N times the team's no-penalty scoring std-dev; skipped if dev unknown).
     *   operator: gt/deltaGt (delta>thr), lt/deltaLt (delta<thr), abs_gt (|delta|>|thr|).
     */
    public static function reconcile(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $e = self::eventRow($pdo, $eid);
        if (!$e) return Http::error($res, 'Event not found', 404);
        $season = self::seasonRow($pdo, (int)$e['scout_season_id']);
        $config = (array)self::jsonCol($season['config'] ?? null);
        $rules = (array)($config['reconciliationRules'] ?? []);
        $metricMap = (array)($config['metricMap'] ?? []);

        $pre = [];
        $s = $pdo->prepare("SELECT team_number, np_opr, stats FROM scout_preevent_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $pre[(int)$r['team_number']] = ['np_opr' => $r['np_opr'] !== null ? (float)$r['np_opr'] : null, 'opr' => self::oprFrom($r['stats'])];
        $live = [];
        $s = $pdo->prepare("SELECT team_number, opr_total, `rank`, stats FROM scout_live_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) { $st = (array)self::jsonCol($r['stats']); $live[(int)$r['team_number']] = ['opr_total' => $r['opr_total'] !== null ? (float)$r['opr_total'] : null, 'rank' => $r['rank'] !== null ? (int)$r['rank'] : null, 'opr' => (array)($st['opr'] ?? $st), 'dev' => (array)($st['dev'] ?? [])]; }
        $names = [];
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];

        $field = fn($metric) => $metricMap[$metric] ?? $metric;
        $resolve = function (string $src, string $metric, int $team) use ($pre, $live, $field) {
            $f = $field($metric);
            if ($src === 'preNpOpr') return $metric === 'totalPointsNp' ? ($pre[$team]['np_opr'] ?? null) : ($pre[$team]['opr'][$f] ?? null);
            if ($src === 'liveOpr') return $live[$team]['opr'][$f] ?? ($metric === 'totalPointsNp' ? ($live[$team]['opr_total'] ?? null) : null);
            return null;   // 'pitClaimed' etc. — not unit-mapped in v1
        };
        $thr = function ($t, $dev) {
            if (is_numeric($t)) return (float)$t;
            if (is_string($t) && preg_match('/^\s*(-?\d*\.?\d+)\s*\*\s*dev\s*$/i', $t, $m)) return $dev === null ? null : (float)$m[1] * $dev;
            return null;
        };

        $results = []; $evaluated = 0; $noLive = 0; $skippedRules = 0;
        foreach (array_keys($pre) as $team) {
            if (!isset($live[$team])) { $noLive++; continue; }
            $evaluated++;
            $dev = $live[$team]['dev']['totalPointsNp'] ?? null; $dev = is_numeric($dev) ? (float)$dev : null;
            $flags = [];
            foreach ($rules as $rule) {
                $metric = $rule['metric'] ?? 'totalPointsNp';
                $a = $resolve($rule['compare'] ?? 'liveOpr', $metric, $team);
                $b = $resolve($rule['against'] ?? 'preNpOpr', $metric, $team);
                $t = $thr($rule['threshold'] ?? 0, $dev);
                if ($a === null || $b === null || $t === null) { $skippedRules++; continue; }
                $delta = $a - $b; $op = $rule['operator'] ?? 'gt'; $hit = false;
                if ($op === 'gt' || $op === 'deltaGt') $hit = $delta > $t;
                elseif ($op === 'lt' || $op === 'deltaLt') $hit = $delta < $t;
                elseif ($op === 'abs_gt') $hit = abs($delta) > abs($t);
                if ($hit) $flags[] = ['id' => $rule['id'] ?? null, 'label' => $rule['label'] ?? ($rule['id'] ?? 'flag'), 'severity' => $rule['severity'] ?? 'info', 'metric' => $metric, 'delta' => round($delta, 1), 'threshold' => round($t, 1)];
            }
            if ($flags) $results[] = [
                'team_number' => $team, 'team_name' => $names[$team] ?? null,
                'pre_np_opr' => $pre[$team]['np_opr'], 'live_opr' => $live[$team]['opr_total'], 'live_rank' => $live[$team]['rank'],
                'delta' => ($pre[$team]['np_opr'] !== null && $live[$team]['opr_total'] !== null) ? round($live[$team]['opr_total'] - $pre[$team]['np_opr'], 1) : null,
                'flags' => $flags,
            ];
        }
        usort($results, fn($x, $y) => abs((float)($y['delta'] ?? 0)) <=> abs((float)($x['delta'] ?? 0)));
        return Http::json($res, ['evaluated' => $evaluated, 'flagged' => count($results), 'no_live_data' => $noLive, 'rules' => count($rules), 'items' => $results]);
    }

    /**
     * GET /scouting/events/{event_id}/live-performance — all teams' pre-event OPR vs
     * live OPR in one response. Used by the Live Performance page to show the full
     * ranked table and feed the per-team match score chart.
     */

    /**
     * GET /scouting/events/{event_id}/live-rankings
     * Official event standings: rank + W-L-T + OPR from cached live stats,
     * with actual W-L-T computed from played scout_matches rows.
     */
    public static function liveRankings(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];

        // Team names
        $names = [];
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];

        // Official rank + OPR + ranking fields from last syncLive (stats JSON)
        $live = [];
        $s = $pdo->prepare("SELECT team_number, `rank`, opr_total, qual_matches_played, stats FROM scout_live_stats WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $st = (array)self::jsonCol($r['stats']);
            $live[(int)$r['team_number']] = [
                'rank' => $r['rank'] !== null ? (int)$r['rank'] : null,
                'opr'  => $r['opr_total'] !== null ? round((float)$r['opr_total'], 1) : null,
                'gp'   => $r['qual_matches_played'] !== null ? (int)$r['qual_matches_played'] : null,
                'wins'          => isset($st['wins'])          ? (int)$st['wins']                            : null,
                'losses'        => isset($st['losses'])        ? (int)$st['losses']                          : null,
                'ties'          => isset($st['ties'])          ? (int)$st['ties']                            : null,
                'rp'            => isset($st['rp'])            ? round((float)$st['rp'], 1)                  : null,
            ];
        }

        // W-L-T + match points from played Quals matches — used as fallback when
        // FTCScout hasn't returned wins/losses/ties yet (old cached stats JSON).
        $wlt = []; $matchPts = [];
        $s = $pdo->prepare("SELECT red1,red2,blue1,blue2,red_score,blue_score,surrogates
                             FROM scout_matches
                             WHERE scout_event_id=? AND tournament_level='Quals'
                               AND red_score IS NOT NULL AND blue_score IS NOT NULL");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $m) {
            $surr  = array_filter(array_map('intval', explode(',', (string)($m['surrogates'] ?? ''))));
            $reds  = array_filter([$m['red1']  !== null ? (int)$m['red1']  : null, $m['red2']  !== null ? (int)$m['red2']  : null]);
            $blues = array_filter([$m['blue1'] !== null ? (int)$m['blue1'] : null, $m['blue2'] !== null ? (int)$m['blue2'] : null]);
            $rs = (int)$m['red_score']; $bs = (int)$m['blue_score'];
            $rw = $rs > $bs ? 'w' : ($rs < $bs ? 'l' : 't');
            $bw = $bs > $rs ? 'w' : ($bs < $rs ? 'l' : 't');
            foreach ($reds  as $t) { if (in_array($t, $surr)) continue; $wlt[$t] = $wlt[$t] ?? ['w'=>0,'l'=>0,'t'=>0]; $wlt[$t][$rw]++; $matchPts[$t] = ($matchPts[$t] ?? 0) + $rs; }
            foreach ($blues as $t) { if (in_array($t, $surr)) continue; $wlt[$t] = $wlt[$t] ?? ['w'=>0,'l'=>0,'t'=>0]; $wlt[$t][$bw]++; $matchPts[$t] = ($matchPts[$t] ?? 0) + $bs; }
        }

        // Build rows: prefer FTCScout wins/losses/ties/rp; fall back to match data
        $allTeams = array_unique(array_merge(array_keys($live), array_keys($names)));
        $rows = [];
        foreach ($allTeams as $tn) {
            $l  = $live[$tn] ?? ['rank' => null, 'opr' => null, 'gp' => null, 'wins' => null, 'losses' => null, 'ties' => null, 'rp' => null];
            $fb     = $wlt[$tn]  ?? null;   // fallback W-L-T from match cache
            $wins   = $l['wins']   !== null ? $l['wins']   : ($fb['w'] ?? null);
            $losses = $l['losses'] !== null ? $l['losses'] : ($fb['l'] ?? null);
            $ties   = $l['ties']   !== null ? $l['ties']   : ($fb['t'] ?? null);
            $gp     = $l['gp'] ?? (($wins !== null || $losses !== null) ? (int)$wins + (int)$losses + (int)$ties : null);
            // For RP fallback use $fb (match scores) directly — avoids depending on qual_matches_played being populated
            $fbGp   = $fb ? ($fb['w'] + $fb['l'] + $fb['t']) : 0;
            $rp     = $l['rp'] !== null
                ? $l['rp']
                : ($fbGp > 0
                    ? round(($fb['w'] * 2 + $fb['t']) / $fbGp, 1)
                    : (($wins !== null && $gp > 0) ? round(((int)$wins * 2 + (int)$ties) / (int)$gp, 1) : null));
            $rows[] = [
                'team_number' => $tn,
                'team_name'   => $names[$tn] ?? null,
                'rank'        => $l['rank'],
                'opr'         => $l['opr'],
                'qual_gp'     => $gp,
                'wins'        => $wins,
                'losses'      => $losses,
                'ties'        => $ties,
                'rp'          => $rp,
                'match_pts'   => $matchPts[$tn] ?? null,
            ];
        }
        // Sort by official rank (null last), then by win total
        usort($rows, function ($a, $b) {
            if ($a['rank'] === null && $b['rank'] === null) return 0;
            if ($a['rank'] === null) return 1;
            if ($b['rank'] === null) return -1;
            return $a['rank'] <=> $b['rank'];
        });

        $hasLive = !empty($live);
        return Http::json($res, ['ok' => true, 'has_live' => $hasLive, 'count' => count($rows), 'rows' => $rows]);
    }

    public static function livePerformance(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];

        $names = [];
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];

        $pre = [];
        $s = $pdo->prepare("SELECT team_number, np_opr FROM scout_preevent_stats WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $pre[(int)$r['team_number']] = $r['np_opr'] !== null ? round((float)$r['np_opr'], 1) : null;

        $live = [];
        $s = $pdo->prepare("SELECT team_number, opr_total, `rank`, qual_matches_played FROM scout_live_stats WHERE scout_event_id=?");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $live[(int)$r['team_number']] = [
            'opr'  => $r['opr_total'] !== null ? round((float)$r['opr_total'], 1) : null,
            'rank' => $r['rank'] !== null ? (int)$r['rank'] : null,
            'gp'   => $r['qual_matches_played'] !== null ? (int)$r['qual_matches_played'] : null,
        ];

        // TRC npOPR: confidence-weighted auto+leave+teleop+park (no penalties).
        $W = ['low' => 0.25, 'medium' => 0.5, 'high' => 0.75, 'very_high' => 0.9];
        $num = fn($x) => is_numeric($x) ? (float)$x : 0.0;
        $trcAgg = [];
        $s = $pdo->prepare("SELECT scouted_team_number, confidence, payload FROM scout_match_records WHERE scout_event_id=? AND is_ignored=0 AND showed_up=1");
        $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $t  = (int)$r['scouted_team_number'];
            $w  = $W[$r['confidence'] ?? ''] ?? 0.5;
            $pl = (array)self::jsonCol($r['payload']);
            $a  = (array)($pl['auto'] ?? []);
            $te = (array)($pl['teleop'] ?? []);
            $eg = (array)($pl['endgame'] ?? []);
            $aMk  = $num($a['closeMake'] ?? 0) + $num($a['farMake'] ?? 0);
            $tMk  = $num($te['closeMake'] ?? 0) + $num($te['farMake'] ?? 0);
            $dnm  = (($a['movement'] ?? '') === 'did_not_move' || !empty($a['did_not_move'])) ? 1 : 0;
            $park = $eg['park'] ?? ($pl['park'] ?? '');
            $pk   = strtolower((string)$park);
            $parkPts = str_contains($pk, 'full') || str_contains($pk, 'foul') ? 10 : (str_contains($pk, 'partial') ? 5 : 0);
            if (!isset($trcAgg[$t])) $trcAgg[$t] = ['w' => 0, 'a' => 0, 'te' => 0, 'dnm' => 0, 'park' => 0, 'n' => 0];
            $trcAgg[$t]['w']    += $w;
            $trcAgg[$t]['a']    += $w * $aMk;
            $trcAgg[$t]['te']   += $w * $tMk;
            $trcAgg[$t]['dnm']  += $w * $dnm;
            $trcAgg[$t]['park'] += $w * $parkPts;
            $trcAgg[$t]['n']++;
        }
        $trcNpOpr = [];
        foreach ($trcAgg as $t => $v) {
            if ($v['w'] <= 0) continue;
            $auto   = ($v['a']    / $v['w']) * 3;
            $leave  = (1 - $v['dnm'] / $v['w']) * 3;
            $teleop = ($v['te']   / $v['w']) * 3;
            $park   = $v['park']  / $v['w'];
            $trcNpOpr[$t] = round($auto + $leave + $teleop + $park, 1);
        }

        $items = [];
        foreach ($names as $team => $name) {
            $p   = $pre[$team] ?? null;
            $l   = $live[$team] ?? null;
            $lo  = $l['opr'] ?? null;
            $delta = ($p !== null && $lo !== null) ? round($lo - $p, 1) : null;
            $items[] = [
                'team_number' => $team,
                'team_name'   => $name,
                'pre_opr'     => $p,
                'live_opr'    => $lo,
                'live_rank'   => $l['rank'] ?? null,
                'gp'          => $l['gp'] ?? null,
                'delta'       => $delta,
                'trc_npopr'   => $trcNpOpr[$team] ?? null,
                'has_live'    => $l !== null,
            ];
        }
        // Default sort: live OPR desc, then pre OPR desc for teams without live data.
        usort($items, fn($a, $b) =>
            ($b['live_opr'] ?? -1e9) <=> ($a['live_opr'] ?? -1e9) ?:
            ($b['pre_opr']  ?? -1e9) <=> ($a['pre_opr']  ?? -1e9)
        );
        $hasLive = count(array_filter($items, fn($i) => $i['has_live']));
        return Http::json($res, ['count' => count($items), 'has_live' => $hasLive, 'items' => $items]);
    }

    /** Standard normal CDF (Abramowitz & Stegun 7.1.26) — for closed-form win probability. */
    private static function normalCdf(float $z): float
    {
        $t = 1 / (1 + 0.2316419 * abs($z));
        $d = 0.3989422804014327 * exp(-$z * $z / 2);
        $p = $d * $t * (0.319381530 + $t * (-0.356563782 + $t * (1.781477937 + $t * (-1.821255978 + $t * 1.330274429))));
        return $z >= 0 ? 1 - $p : $p;
    }

    /**
     * GET /scouting/events/{event_id}/alliance-model?team=&mode=&exclude= — rank
     * candidate alliance partners. Five modes:
     *   - npopr     : FTC Scout npOPR (live when available, else pre-event)
     *   - trc_npopr : TRC-scouted npOPR (auto+leave+teleop+park, no penalties)
     *   - far       : avg artifacts scored from the far zone (auto + teleop)
     *   - goal_side : avg artifacts scored from the goal/near side (auto + teleop)
     *   - utility   : balanced scorer score = 2×min(close_avg, far_avg) — high only
     *                 when a robot scores meaningfully from BOTH zones
     */
    public static function allianceModel(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Not authenticated', 401);
        if (!self::canScout($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $q = $req->getQueryParams();
        $ourTeam = (int)($q['team'] ?? 0);
        if (!$ourTeam) return Http::error($res, 'team query param is required', 422);
        $mode = in_array($q['mode'] ?? '', ['npopr', 'trc_npopr', 'far', 'goal_side', 'utility'], true) ? $q['mode'] : 'npopr';
        $exclude = array_filter(array_map('intval', explode(',', (string)($q['exclude'] ?? ''))));
        $exclude[] = $ourTeam;

        $names = [];
        $s = $pdo->prepare("SELECT team_number, team_name FROM scout_event_teams WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) $names[(int)$r['team_number']] = $r['team_name'];

        // FTC Scout stat map: pre-event first, live overlays where present.
        $stat = [];
        $s = $pdo->prepare("SELECT team_number, np_opr FROM scout_preevent_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) { if ($r['np_opr'] !== null) $stat[(int)$r['team_number']] = ['np' => (float)$r['np_opr'], 'source' => 'pre']; }
        $s = $pdo->prepare("SELECT team_number, opr_total, stats FROM scout_live_stats WHERE scout_event_id=?"); $s->execute([$eid]);
        foreach ($s->fetchAll() as $r) {
            $st = (array)self::jsonCol($r['stats']); $opr = (array)($st['opr'] ?? []);
            $np = $opr['totalPointsNp'] ?? ($r['opr_total'] !== null ? (float)$r['opr_total'] : null);
            if ($np !== null) $stat[(int)$r['team_number']] = ['np' => (float)$np, 'source' => 'live'];
        }

        // TRC match-scouting aggregates: confidence-weighted per-team zone and endgame stats.
        $W = ['low' => 0.25, 'medium' => 0.5, 'high' => 0.75, 'very_high' => 0.9];
        $num = fn($x) => is_numeric($x) ? (float)$x : 0.0;
        $trcAgg = [];
        $mr = $pdo->prepare("SELECT scouted_team_number, confidence, payload FROM scout_match_records WHERE scout_event_id=? AND is_ignored=0 AND showed_up=1");
        $mr->execute([$eid]);
        foreach ($mr->fetchAll() as $r) {
            $t  = (int)$r['scouted_team_number'];
            $w  = $W[$r['confidence'] ?? ''] ?? 0.5;
            $pl = (array)self::jsonCol($r['payload']);
            $a  = (array)($pl['auto']    ?? []);
            $te = (array)($pl['teleop']  ?? []);
            $eg = (array)($pl['endgame'] ?? []);
            $aClose = $num($a['closeMake'] ?? 0);   $aFar = $num($a['farMake'] ?? 0);
            $tClose = $num($te['closeMake'] ?? 0);  $tFar = $num($te['farMake'] ?? 0);
            $dnm = (($a['movement'] ?? '') === 'did_not_move' || !empty($a['did_not_move'])) ? 1 : 0;
            $pk  = strtolower((string)($eg['park'] ?? ($pl['park'] ?? '')));
            $parkPts = str_contains($pk, 'full') || str_contains($pk, 'foul') ? 10 : (str_contains($pk, 'partial') ? 5 : 0);
            if (!isset($trcAgg[$t])) $trcAgg[$t] = ['w' => 0, 'auto' => 0, 'te' => 0, 'dnm' => 0, 'park' => 0, 'far' => 0, 'close' => 0, 'aFar' => 0, 'aClose' => 0, 'n' => 0, 'fail' => 0];
            $trcAgg[$t]['w']      += $w;
            $trcAgg[$t]['auto']   += $w * ($aClose + $aFar);
            $trcAgg[$t]['te']     += $w * ($tClose + $tFar);
            $trcAgg[$t]['dnm']    += $w * $dnm;
            $trcAgg[$t]['park']   += $w * $parkPts;
            $trcAgg[$t]['far']    += $w * ($aFar + $tFar);
            $trcAgg[$t]['close']  += $w * ($aClose + $tClose);
            $trcAgg[$t]['aFar']   += $w * $aFar;
            $trcAgg[$t]['aClose'] += $w * $aClose;
            $trcAgg[$t]['n']++;
            if (!empty($te['majorFailure'])) $trcAgg[$t]['fail']++;
        }
        $trcScores = [];
        foreach ($trcAgg as $t => $v) {
            if ($v['w'] <= 0) continue;
            $autoP   = ($v['auto'] / $v['w']) * 3;
            $leaveP  = (1 - $v['dnm'] / $v['w']) * 3;
            $teP     = ($v['te']   / $v['w']) * 3;
            $parkP   = $v['park']  / $v['w'];
            $farAvg  = $v['far']   / $v['w'];
            $closeAvg = $v['close'] / $v['w'];
            $trcScores[$t] = [
                'trc_npopr'  => round($autoP + $leaveP + $teP + $parkP, 1),
                'far'        => round($farAvg, 2),
                'goal_side'  => round($closeAvg, 2),
                'auto_far'   => round($v['aFar']   / $v['w'], 2),
                'auto_goal'  => round($v['aClose'] / $v['w'], 2),
                // Utility = 2×min(close,far): zero if a robot only scores in one zone,
                // scales up only when they contribute meaningfully from both.
                'utility'    => round(2 * min($farAvg, $closeAvg), 2),
                'n'         => $v['n'],
                'fail'      => $v['fail'],
            ];
        }

        $items = [];
        foreach ($names as $t => $name) {
            if (in_array($t, $exclude, true)) continue;
            $v  = $stat[$t]      ?? null;
            $sc = $trcScores[$t] ?? null;
            if ($mode === 'npopr' && ($v === null)) continue;
            if (in_array($mode, ['trc_npopr', 'far', 'goal_side', 'utility'], true) && $sc === null) continue;
            $rk = ['major_failure_rate' => ($sc && $sc['n']) ? round($sc['fail'] / $sc['n'], 2) : null, 'matches_scouted' => $sc['n'] ?? 0];
            $items[] = [
                'team_number' => $t,
                'team_name'   => $name,
                'np'          => $v  ? round($v['np'], 1)        : null,
                'source'      => $v  ? $v['source']              : null,
                'trc_npopr'   => $sc ? $sc['trc_npopr']  : null,
                'far'         => $sc ? $sc['far']        : null,
                'goal_side'   => $sc ? $sc['goal_side']  : null,
                'auto_far'    => $sc ? $sc['auto_far']   : null,
                'auto_goal'   => $sc ? $sc['auto_goal']  : null,
                'utility'     => $sc ? $sc['utility']    : null,
                'risk'        => $rk,
            ];
        }
        $sortKey = ['npopr' => 'np', 'trc_npopr' => 'trc_npopr', 'far' => 'far', 'goal_side' => 'goal_side', 'utility' => 'utility'][$mode];
        usort($items, fn($a, $b) => ($b[$sortKey] ?? -1e9) <=> ($a[$sortKey] ?? -1e9));

        return Http::json($res, ['mode' => $mode, 'count' => count($items), 'items' => $items]);
    }
}
