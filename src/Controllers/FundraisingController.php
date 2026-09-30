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
 * Event "Team Fundraising Opportunity" feature.
 *
 * An event can distribute a pot of money to the youth who volunteered, split by
 * the hours each youth worked. Each youth's earnings are credited to the team(s)
 * they choose, landing as sub-lines under a "TRC Fundraising Opportunities"
 * fundraising category on the team's budget. Finalize is idempotent and can be
 * re-run any time (after fixing hours, adding people, or once a youth on multiple
 * teams picks where their money should go).
 */
final class FundraisingController
{
    private const CATEGORY_NAME = 'TRC Fundraising Opportunities';

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'events.fundraising', 'write');
    }

    private static function event(PDO $pdo, int $eid): ?array
    {
        $s = $pdo->prepare("SELECT * FROM events WHERE id = ?"); $s->execute([$eid]);
        return $s->fetch() ?: null;
    }

    private static function config(PDO $pdo, int $eid): array
    {
        $s = $pdo->prepare("SELECT * FROM event_fundraising WHERE event_id = ?"); $s->execute([$eid]);
        $r = $s->fetch();
        if (!$r) {
            $pdo->prepare("INSERT INTO event_fundraising (event_id) VALUES (?)")->execute([$eid]);
            $s->execute([$eid]); $r = $s->fetch();
        }
        return $r;
    }

    /**
     * team_season_id => label for the eligibility checklist. When $season is given
     * (an event's "benefits season"), only that season's team-seasons are offered,
     * so a summer fundraiser's earnings post into the upcoming season's budgets.
     */
    private static function allTeams(PDO $pdo, ?string $season = null): array
    {
        $sql = "SELECT ts.id, t.team_number, ts.team_name, ts.season, p.name AS program
                FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
                LEFT JOIN programs p ON p.id = t.program_id
                WHERE ts.status = 'active'";
        $args = [];
        if ($season !== null && $season !== '') { $sql .= " AND ts.season = ?"; $args[] = $season; }
        $sql .= " ORDER BY p.name, t.team_number";
        $st = $pdo->prepare($sql); $st->execute($args);
        $out = [];
        foreach ($st->fetchAll() as $r) $out[] = ['team_season_id' => (int)$r['id'], 'label' => self::teamLabel($r)];
        return $out;
    }

    private static function teamLabel(array $r): string
    {
        $name = $r['team_name'] ?: ('Team ' . $r['team_number']);
        $prog = $r['program'] ? $r['program'] . ' ' : '';
        return "#{$r['team_number']} {$name} · {$prog}{$r['season']}";
    }

    private static function teamLabelById(PDO $pdo, int $teamSeasonId): string
    {
        $s = $pdo->prepare(
            "SELECT t.team_number, ts.team_name, ts.season, p.name AS program
             FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
             LEFT JOIN programs p ON p.id = t.program_id WHERE ts.id = ?"
        );
        $s->execute([$teamSeasonId]);
        $r = $s->fetch();
        return $r ? self::teamLabel($r) : "Team season #$teamSeasonId";
    }

    /** Eligible team_season_ids for an event. */
    private static function eligibleTeamIds(PDO $pdo, int $eid): array
    {
        $s = $pdo->prepare("SELECT team_season_id FROM event_fundraising_teams WHERE event_id = ?");
        $s->execute([$eid]);
        return array_map('intval', array_column($s->fetchAll(), 'team_season_id'));
    }

    /** True if the member is a youth (only youth earn fundraising distributions). */
    private static function isYouth(PDO $pdo, int $memberId): bool
    {
        $s = $pdo->prepare("SELECT member_type FROM members WHERE id = ?"); $s->execute([$memberId]);
        return ($s->fetchColumn() ?: '') === 'youth';
    }

    /** A member's currently-active team-seasons. */
    private static function memberTeamSeasons(PDO $pdo, int $memberId): array
    {
        $s = $pdo->prepare("SELECT team_season_id FROM team_member_assignments WHERE member_id = ? AND status = 'active'");
        $s->execute([$memberId]);
        return array_map('intval', array_column($s->fetchAll(), 'team_season_id'));
    }

    /** member_id => total youth volunteer hours for the event (youth only, hours > 0). */
    private static function youthHours(PDO $pdo, int $eid): array
    {
        $s = $pdo->prepare(
            "SELECT c.member_id,
                    SUM(TIMESTAMPDIFF(SECOND, c.time_in, COALESCE(c.time_out, UTC_TIMESTAMP()))) AS secs
             FROM checkins c JOIN members m ON m.id = c.member_id
             WHERE c.event_id = ? AND c.member_id IS NOT NULL AND m.member_type = 'youth'
             GROUP BY c.member_id"
        );
        $s->execute([$eid]);
        $out = [];
        foreach ($s->fetchAll() as $r) {
            $h = round(((int)$r['secs']) / 3600, 2);
            if ($h > 0) $out[(int)$r['member_id']] = $h;
        }
        return $out;
    }

    /** A youth's chosen distribution teams (intersected with eligibility). */
    private static function distributionPref(PDO $pdo, int $eid, int $memberId, array $eligible): array
    {
        $s = $pdo->prepare("SELECT team_season_id FROM event_member_distribution WHERE event_id = ? AND member_id = ?");
        $s->execute([$eid, $memberId]);
        $chosen = array_map('intval', array_column($s->fetchAll(), 'team_season_id'));
        return array_values(array_intersect($chosen, $eligible));
    }

    /** Teams a youth's earnings are LOCKED to (set at finalize; survive team changes). */
    private static function lockedTeams(PDO $pdo, int $eid, int $memberId, array $eligible): array
    {
        $s = $pdo->prepare("SELECT team_season_id FROM event_member_distribution WHERE event_id = ? AND member_id = ? AND locked_at IS NOT NULL");
        $s->execute([$eid, $memberId]);
        $t = array_map('intval', array_column($s->fetchAll(), 'team_season_id'));
        return array_values(array_intersect($t, $eligible));
    }

    /** Persist a youth's team allocation as LOCKED — money stays with these teams. */
    private static function lockDistribution(PDO $pdo, int $eid, int $memberId, array $teams): void
    {
        $pdo->prepare("DELETE FROM event_member_distribution WHERE event_id = ? AND member_id = ?")->execute([$eid, $memberId]);
        $ins = $pdo->prepare("INSERT INTO event_member_distribution (event_id, member_id, team_season_id, locked_at) VALUES (?, ?, ?, NOW())");
        foreach ($teams as $tsid) $ins->execute([$eid, $memberId, (int)$tsid]);
    }

    /**
     * Resolve which team(s) a youth's earnings go to.
     * Returns ['status' => one of unassigned|auto|chosen|held|locked, 'teams' => int[]].
     *  - locked:     already anchored to a team at finalize — never moves, even if
     *                the youth later changes teams or graduates.
     *  - auto:       on exactly one eligible team (no choice needed)
     *  - chosen:     youth (or a manager on their behalf) picked eligible team(s)
     *  - held:       on multiple eligible teams but hasn't chosen yet
     *  - unassigned: earned hours but is on no eligible team (e.g. a graduating
     *                senior on a summer fundraiser) — a manager assigns the team.
     */
    private static function resolve(PDO $pdo, int $eid, int $memberId, array $eligible): array
    {
        // Locked assignments win: the dollars belong to the team, not the youth.
        $locked = self::lockedTeams($pdo, $eid, $memberId, $eligible);
        if ($locked) return ['status' => 'locked', 'teams' => $locked];
        $pref = self::distributionPref($pdo, $eid, $memberId, $eligible);
        if ($pref) return ['status' => 'chosen', 'teams' => $pref];
        $mine = array_values(array_intersect(self::memberTeamSeasons($pdo, $memberId), $eligible));
        if (count($mine) === 1) return ['status' => 'auto', 'teams' => $mine];
        if (count($mine) > 1) return ['status' => 'held', 'teams' => []];
        return ['status' => 'unassigned', 'teams' => []];
    }

    /** Ensure the team-season has a "TRC Fundraising Opportunities" category; return its id. */
    private static function ensureCategory(PDO $pdo, int $teamSeasonId): int
    {
        $s = $pdo->prepare("SELECT id FROM inv_budget_categories WHERE team_season_id = ? AND is_fundraising = 1 AND name = ?");
        $s->execute([$teamSeasonId, self::CATEGORY_NAME]);
        $r = $s->fetch();
        if ($r) return (int)$r['id'];
        $pdo->prepare("INSERT INTO inv_budget_categories (team_season_id, name, is_fundraising, budgeted_amount, actual_amount, created_at) VALUES (?, ?, 1, 0, 0, NOW())")
            ->execute([$teamSeasonId, self::CATEGORY_NAME]);
        return (int)$pdo->lastInsertId();
    }

    /**
     * Keep an event's fundraising team links on the season it BENEFITS. Each linked
     * team is moved to the same team's row in $toSeason (matched by team_id), and its
     * budget line re-resolved there — so a summer fundraiser tagged to the upcoming
     * season pays into that season's budgets instead of last season's. Any postings
     * this event made under the old season's category are removed (they re-post to the
     * new season on finalize). Teams with no row in the target season are left alone.
     * Idempotent: anything already on $toSeason is skipped.
     * @return array{links:int,choices:int} counts of what moved.
     */
    public static function repointTeamsToSeason(PDO $pdo, int $eventId, string $toSeason, ?int $actorId = null): array
    {
        if (trim($toSeason) === '') return ['links' => 0, 'choices' => 0];
        $rows = $pdo->prepare(
            "SELECT eft.id, eft.team_season_id, eft.budget_category_id, ts.team_id, ts.season
               FROM event_fundraising_teams eft JOIN team_seasons ts ON ts.id = eft.team_season_id
              WHERE eft.event_id = ?"
        );
        $rows->execute([$eventId]);
        $findTarget = $pdo->prepare("SELECT id FROM team_seasons WHERE team_id = ? AND season = ?");
        $already = $pdo->prepare("SELECT id FROM event_fundraising_teams WHERE event_id = ? AND team_season_id = ?");
        $moved = 0;
        foreach ($rows->fetchAll() as $r) {
            if ((string)$r['season'] === $toSeason) continue;              // already on the target season
            $findTarget->execute([(int)$r['team_id'], $toSeason]);
            $newTsid = (int)($findTarget->fetchColumn() ?: 0);
            if (!$newTsid) continue;                                       // team has no row in the new season
            // Drop what this event posted under the old season's category.
            if (!empty($r['budget_category_id'])) {
                $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE event_id = ? AND budget_category_id = ?")
                    ->execute([$eventId, (int)$r['budget_category_id']]);
            }
            $already->execute([$eventId, $newTsid]);
            if ($already->fetch()) {                                       // target link exists → drop the stale row
                $pdo->prepare("DELETE FROM event_fundraising_teams WHERE id = ?")->execute([(int)$r['id']]);
                continue;
            }
            $cat = self::ensureCategory($pdo, $newTsid);
            $pdo->prepare("UPDATE event_fundraising_teams SET team_season_id = ?, budget_category_id = ? WHERE id = ?")
                ->execute([$newTsid, $cat, (int)$r['id']]);
            $moved++;
        }

        // Each youth's chosen (or locked) distribution teams point at the old season's
        // rows too. Eligibility is matched by team_season_id, so leaving them behind
        // orphans every choice — the youth falls back to "on multiple teams, hasn't
        // chosen" and their earnings post NOWHERE. Move each choice to the same team's
        // row in the new season so the money still follows the team they picked.
        $emd = $pdo->prepare(
            "SELECT emd.id, emd.member_id, emd.team_season_id, ts.team_id, ts.season
               FROM event_member_distribution emd JOIN team_seasons ts ON ts.id = emd.team_season_id
              WHERE emd.event_id = ?"
        );
        $emd->execute([$eventId]);
        $dupe = $pdo->prepare("SELECT id FROM event_member_distribution WHERE event_id = ? AND member_id = ? AND team_season_id = ?");
        $choicesMoved = 0;
        foreach ($emd->fetchAll() as $r) {
            if ((string)$r['season'] === $toSeason) continue;
            $findTarget->execute([(int)$r['team_id'], $toSeason]);
            $newTsid = (int)($findTarget->fetchColumn() ?: 0);
            if (!$newTsid) continue;
            $dupe->execute([$eventId, (int)$r['member_id'], $newTsid]);
            if ($dupe->fetch()) {                                          // already chosen there → drop the stale row
                $pdo->prepare("DELETE FROM event_member_distribution WHERE id = ?")->execute([(int)$r['id']]);
                $choicesMoved++;
                continue;
            }
            $pdo->prepare("UPDATE event_member_distribution SET team_season_id = ? WHERE id = ?")
                ->execute([$newTsid, (int)$r['id']]);
            $choicesMoved++;
        }

        // Already finalized? Re-post so the earnings land on the new season's budgets
        // (same behaviour as changing the eligible team set). Finalize stays the gate:
        // this only re-posts an event you already finalized, it never posts a new one.
        // Note the choices alone may have moved (links already correct) — re-post then too.
        if (($moved > 0 || $choicesMoved > 0) && self::config($pdo, $eventId)['finalized_at']) {
            self::runFinalize($pdo, $eventId, $actorId ?? 0);
        }
        return ['links' => $moved, 'choices' => $choicesMoved];
    }

    /**
     * POST /events/fundraising/repoint-season  { to_season }
     * Season-transition repair: for every fundraiser tagged "benefits {to_season}",
     * move its team links onto that season's team-seasons. Fixes summer fundraisers
     * that were set up before the new team-seasons existed (their links stayed on the
     * prior season, so earnings would have posted to last season's budgets).
     * Safe to re-run — links already on the target season are skipped.
     */
    public static function repointSeason(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $to = trim((string)(((array)$req->getParsedBody())['to_season'] ?? ''));
        if ($to === '') return Http::error($res, 'to_season is required', 422);

        $evts = $pdo->prepare("SELECT id, name FROM events WHERE fundraising_opportunity = 1 AND benefits_season = ?");
        $evts->execute([$to]);
        $rows = $evts->fetchAll();
        $events = 0; $moved = 0; $choices = 0; $names = [];
        foreach ($rows as $e) {
            $n = self::repointTeamsToSeason($pdo, (int)$e['id'], $to, (int)$cur['id']);
            if ($n['links'] > 0 || $n['choices'] > 0) {
                $events++; $moved += $n['links']; $choices += $n['choices']; $names[] = $e['name'];
            }
        }
        Audit::write($pdo, (int)$cur['id'], 'event_fundraising_teams', null, 'update', null,
            ['repoint_season' => $to, 'events' => $events, 'team_links_moved' => $moved, 'youth_choices_moved' => $choices]);

        $parts = [];
        if ($moved > 0) $parts[] = "$moved team link(s)";
        if ($choices > 0) $parts[] = "$choices youth team-choice(s)";
        $msg = $rows
            ? ($events > 0
                ? 'Moved ' . implode(' and ', $parts) . " onto $to across $events fundraiser(s): " . implode(', ', $names)
                    . '. Already-finalized events were re-posted so the earnings land on the new season.'
                : "All " . count($rows) . " fundraiser(s) tagged for $to already point at $to — nothing to move.")
            : "No fundraisers are tagged \"benefits $to\" yet. Tag them on the event first (Events → the event → Fundraising), then re-run.";
        return Http::json($res, ['ok' => true, 'events' => $events, 'team_links_moved' => $moved,
            'youth_choices_moved' => $choices, 'message' => $msg]);
    }

    private static function memberName(PDO $pdo, int $memberId): string
    {
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([$memberId]);
        $r = $s->fetch();
        return $r ? trim("{$r['first_name']} {$r['last_name']}") : "Member #$memberId";
    }

    // ── Endpoints ───────────────────────────────────────────────────────────

    /** GET /events/{event_id}/fundraising — full management view. */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $event = self::event($pdo, $eid);
        if (!$event) return Http::error($res, 'Event not found', 404);

        $cfg = self::config($pdo, $eid);
        $total = $cfg['total_amount_available'] !== null ? (float)$cfg['total_amount_available'] : null;

        // Eligible teams + expected.
        $et = $pdo->prepare("SELECT team_season_id, expected_amount FROM event_fundraising_teams WHERE event_id = ?");
        $et->execute([$eid]);
        $eligibleTeams = [];
        foreach ($et->fetchAll() as $r) {
            $eligibleTeams[] = [
                'team_season_id' => (int)$r['team_season_id'],
                'label' => self::teamLabelById($pdo, (int)$r['team_season_id']),
                'expected_amount' => $r['expected_amount'] !== null ? (float)$r['expected_amount'] : null,
            ];
        }
        $eligible = array_column($eligibleTeams, 'team_season_id');

        // Per-youth roster (live preview).
        $hours = self::youthHours($pdo, $eid);
        $totalHours = array_sum($hours);
        $rate = ($totalHours > 0 && $total !== null) ? $total / $totalHours : 0.0;
        $roster = [];
        foreach ($hours as $mid => $h) {
            $resolved = self::resolve($pdo, $eid, $mid, $eligible);
            $earned = round($h * $rate, 2);
            $roster[] = [
                'member_id' => $mid,
                'name' => self::memberName($pdo, $mid),
                'hours' => $h,
                'earned' => $earned,
                'status' => $resolved['status'],
                'team_season_ids' => $resolved['teams'],
                'team_labels' => array_map(fn($t) => self::teamLabelById($pdo, $t), $resolved['teams']),
            ];
        }
        usort($roster, fn($a, $b) => strcmp($a['name'], $b['name']));

        $benefitsSeason = $event['benefits_season'] ?? null;
        return Http::json($res, [
            'event_id' => $eid,
            'event_name' => $event['name'],
            'enabled' => (bool)$event['fundraising_opportunity'],
            'benefits_season' => $benefitsSeason,
            'total_amount_available' => $total,
            'hourly_rate' => round($rate, 4),
            'total_youth_hours' => round($totalHours, 2),
            'finalized_at' => $cfg['finalized_at'],
            'eligible_teams' => $eligibleTeams,
            // When the event benefits a specific season, only offer that season's teams.
            'all_teams' => self::allTeams($pdo, $benefitsSeason),
            'roster' => $roster,
            'held_count' => count(array_filter($roster, fn($r) => $r['status'] === 'held')),
            'unassigned_count' => count(array_filter($roster, fn($r) => $r['status'] === 'unassigned')),
        ]);
    }

    /** PUT /events/{event_id}/fundraising — set total amount available. */
    public static function setConfig(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        self::config($pdo, $eid);
        $d = (array)$req->getParsedBody();
        $amt = ($d['total_amount_available'] ?? '') === '' || $d['total_amount_available'] === null ? null : (float)$d['total_amount_available'];
        $pdo->prepare("UPDATE event_fundraising SET total_amount_available = ?, updated_at = NOW() WHERE event_id = ?")->execute([$amt, $eid]);
        Audit::write($pdo, (int)$cur['id'], 'event_fundraising', $eid, 'update', null, ['total_amount_available' => $amt]);
        return Http::json($res, ['ok' => true]);
    }

    /** PUT /events/{event_id}/fundraising/teams — set the full eligible-team list. */
    public static function setTeams(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();
        $wanted = array_values(array_unique(array_map('intval', (array)($d['team_season_ids'] ?? []))));
        $current = self::eligibleTeamIds($pdo, $eid);

        // Add new eligible teams: create their category + eligibility row.
        foreach (array_diff($wanted, $current) as $tsid) {
            $catId = self::ensureCategory($pdo, (int)$tsid);
            $pdo->prepare("INSERT INTO event_fundraising_teams (event_id, team_season_id, budget_category_id) VALUES (?, ?, ?)")
                ->execute([$eid, (int)$tsid, $catId]);
        }
        // Remove de-selected teams: drop their event postings + eligibility row.
        foreach (array_diff($current, $wanted) as $tsid) {
            $cat = $pdo->prepare("SELECT budget_category_id FROM event_fundraising_teams WHERE event_id = ? AND team_season_id = ?");
            $cat->execute([$eid, (int)$tsid]);
            $catId = (int)($cat->fetch()['budget_category_id'] ?? 0);
            if ($catId) $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE event_id = ? AND budget_category_id = ?")->execute([$eid, $catId]);
            $pdo->prepare("DELETE FROM event_fundraising_teams WHERE event_id = ? AND team_season_id = ?")->execute([$eid, (int)$tsid]);
        }
        Audit::write($pdo, (int)$cur['id'], 'event_fundraising_teams', $eid, 'update', null, ['team_season_ids' => $wanted]);

        // If already finalized, re-post with the new team set.
        if (self::config($pdo, $eid)['finalized_at']) self::runFinalize($pdo, $eid, (int)$cur['id']);
        return self::get($req, $res, $route);
    }

    /** PATCH /events/{event_id}/fundraising/teams/{team_season_id} — set a team's expected amount. */
    public static function setExpected(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id']; $tsid = (int)$route['team_season_id'];
        // Managers, or a member who is on that team (youth entering their hoped-for amount).
        $onTeam = in_array($tsid, self::memberTeamSeasons($pdo, (int)$cur['id']), true);
        if (!self::canManage($pdo, $cur) && !$onTeam) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $amt = ($d['expected_amount'] ?? '') === '' || $d['expected_amount'] === null ? null : (float)$d['expected_amount'];
        $upd = $pdo->prepare("UPDATE event_fundraising_teams SET expected_amount = ? WHERE event_id = ? AND team_season_id = ?");
        $upd->execute([$amt, $eid, $tsid]);
        if ($upd->rowCount() === 0) return Http::error($res, 'That team is not eligible for this event.', 404);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /events/{event_id}/fundraising/calculate — snapshot the hourly rate (no posting). */
    public static function calculate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $cfg = self::config($pdo, $eid);
        $total = $cfg['total_amount_available'] !== null ? (float)$cfg['total_amount_available'] : null;
        $hours = self::youthHours($pdo, $eid);
        $totalHours = array_sum($hours);
        $rate = ($totalHours > 0 && $total !== null) ? $total / $totalHours : 0.0;
        $pdo->prepare("UPDATE event_fundraising SET hourly_rate = ?, total_youth_hours = ?, updated_at = NOW() WHERE event_id = ?")
            ->execute([$rate, $totalHours, $eid]);
        return self::get($req, $res, $route);
    }

    /** POST /events/{event_id}/fundraising/finalize — compute + post earnings (idempotent). */
    public static function finalize(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $cfg = self::config($pdo, $eid);
        if ($cfg['total_amount_available'] === null) {
            return Http::error($res, 'Enter the total amount available for the event before finalizing.', 400);
        }
        $result = self::runFinalize($pdo, $eid, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'event_fundraising', $eid, 'finalize', null, $result);
        return self::get($req, $res, $route);
    }

    /**
     * Core finalize routine (also re-run when team set / distribution changes after
     * the first finalize). Re-runs Calculate Hourly, clears prior postings for the
     * event, and posts per-(team,member) earnings for every resolved youth.
     */
    private static function runFinalize(PDO $pdo, int $eid, int $actorId): array
    {
        $cfg = self::config($pdo, $eid);
        $total = $cfg['total_amount_available'] !== null ? (float)$cfg['total_amount_available'] : 0.0;
        $hours = self::youthHours($pdo, $eid);
        $totalHours = array_sum($hours);
        $rate = $totalHours > 0 ? $total / $totalHours : 0.0;
        $eligible = self::eligibleTeamIds($pdo, $eid);

        // Clear previous postings for this event (idempotent re-run).
        $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE event_id = ?")->execute([$eid]);

        $posted = 0; $held = 0; $unassigned = 0; $today = date('Y-m-d');
        $ins = $pdo->prepare(
            "INSERT INTO inv_fundraising_donations (budget_category_id, event_id, member_id, name, expected_amount, received_amount, received_date, created_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, NOW())"
        );
        // TBD placeholder (received NULL) — shows a held youth's name under each
        // eligible team they're on, until they provide distribution guidance.
        $insTbd = $pdo->prepare(
            "INSERT INTO inv_fundraising_donations (budget_category_id, event_id, member_id, name, expected_amount, received_amount, received_date, created_at)
             VALUES (?, ?, ?, ?, NULL, NULL, NULL, NOW())"
        );
        foreach ($hours as $mid => $h) {
            $earned = round($h * $rate, 2);
            $resolved = self::resolve($pdo, $eid, (int)$mid, $eligible);
            if ($resolved['status'] === 'held') {
                $name = self::memberName($pdo, (int)$mid);
                $mineEligible = array_values(array_intersect(self::memberTeamSeasons($pdo, (int)$mid), $eligible));
                foreach ($mineEligible as $tsid) {
                    $catId = self::ensureCategory($pdo, (int)$tsid);
                    $insTbd->execute([$catId, $eid, (int)$mid, $name]);
                }
                $held++;
                continue;
            }
            if ($resolved['status'] === 'unassigned') {
                // Earned hours but on no eligible team (e.g. a graduating senior on a
                // summer fundraiser). Don't post/lose the money — surface it in the
                // roster as "needs a team" so a manager assigns it to the team it
                // was earned for. (Skipped here; visible via get()'s roster.)
                $unassigned++;
                continue;
            }
            if (!$resolved['teams']) continue;
            if ($earned <= 0) continue;
            $teams = $resolved['teams'];
            // Lock the allocation so a later re-finalize never moves this money to a
            // different team, even if the youth changes teams or leaves the program.
            if ($resolved['status'] !== 'locked') self::lockDistribution($pdo, $eid, (int)$mid, $teams);
            $n = count($teams);
            $per = round($earned / $n, 2);
            $name = self::memberName($pdo, (int)$mid);
            foreach ($teams as $i => $tsid) {
                $alloc = ($i === $n - 1) ? round($earned - $per * ($n - 1), 2) : $per; // remainder to last
                $catId = self::ensureCategory($pdo, (int)$tsid);
                $ins->execute([$catId, $eid, (int)$mid, $name, $alloc, $today]);
                $posted++;
            }
        }
        $pdo->prepare("UPDATE event_fundraising SET hourly_rate = ?, total_youth_hours = ?, finalized_at = NOW(), finalized_by_id = ?, updated_at = NOW() WHERE event_id = ?")
            ->execute([$rate, $totalHours, $actorId, $eid]);
        return ['posted_lines' => $posted, 'held_youth' => $held, 'unassigned_youth' => $unassigned, 'rate' => round($rate, 4), 'total_hours' => round($totalHours, 2)];
    }

    // ── Member-facing (Attend modal + Apply Earnings) ────────────────────────

    /**
     * Resolve which member a distribution request targets. Defaults to the caller;
     * mentors/admins/fundraising managers may act on behalf of another member.
     * Returns the member id, or null if the caller isn't allowed.
     */
    private static function targetMember(PDO $pdo, array $cur, $requested): ?int
    {
        $target = ($requested === null || $requested === '') ? (int)$cur['id'] : (int)$requested;
        if ($target === (int)$cur['id']) return $target;
        if (Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])
            || Permissions::memberCan($pdo, $cur, 'events.fundraising', 'write')) {
            return $target;
        }
        return null;
    }

    /** GET /events/{event_id}/fundraising/my-distribution — what the (target) youth must/can choose. */
    public static function myDistribution(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $event = self::event($pdo, $eid);
        if (!$event) return Http::error($res, 'Event not found', 404);
        $mid = self::targetMember($pdo, $cur, $req->getQueryParams()['member_id'] ?? null);
        if ($mid === null) return Http::error($res, 'Access denied', 403);
        $isYouth = self::isYouth($pdo, $mid);
        $eligible = self::eligibleTeamIds($pdo, $eid);
        $mine = $isYouth ? array_values(array_intersect(self::memberTeamSeasons($pdo, $mid), $eligible)) : [];
        $chosen = self::distributionPref($pdo, $eid, $mid, $eligible);
        // A manager may direct earnings to any eligible team (e.g. for a graduated
        // senior on no current team); a youth only sees the teams they're on.
        $pickFrom = self::canManage($pdo, $cur) ? $eligible : $mine;
        return Http::json($res, [
            'event_id' => $eid,
            'member_id' => $mid,
            'enabled' => (bool)$event['fundraising_opportunity'],
            'finalized' => self::config($pdo, $eid)['finalized_at'] !== null,
            'eligible_teams' => array_map(fn($t) => ['team_season_id' => $t, 'label' => self::teamLabelById($pdo, $t)], $pickFrom),
            'chosen_team_season_ids' => $chosen,
            // needs a choice only when a YOUTH is on >1 eligible team and hasn't chosen yet
            'needs_choice' => $isYouth && count($mine) > 1 && !$chosen,
            'single_team' => count($mine) === 1 ? $mine[0] : null,
        ]);
    }

    /** POST /events/{event_id}/fundraising/my-distribution — save the (target) youth's team choice. */
    public static function setMyDistribution(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();
        $mid = self::targetMember($pdo, $cur, $d['member_id'] ?? null);
        if ($mid === null) return Http::error($res, 'Access denied', 403);
        $eligible = self::eligibleTeamIds($pdo, $eid);
        $wanted = array_map('intval', (array)($d['team_season_ids'] ?? []));
        if (self::canManage($pdo, $cur)) {
            // Managers may direct earnings to any eligible team — needed to place a
            // graduated/transferred youth's earnings with the team they earned for.
            $picked = array_values(array_intersect($wanted, $eligible));
        } else {
            $mine = array_intersect(self::memberTeamSeasons($pdo, $mid), $eligible);
            $picked = array_values(array_intersect($wanted, $mine));
        }
        if (!$picked) return Http::error($res, 'Choose at least one eligible team.', 400);

        // A manager's deliberate assignment locks immediately (money belongs to the
        // team); a youth's own pre-finalize choice stays unlocked until finalize.
        $lock = self::canManage($pdo, $cur);
        $pdo->prepare("DELETE FROM event_member_distribution WHERE event_id = ? AND member_id = ?")->execute([$eid, $mid]);
        $ins = $pdo->prepare("INSERT INTO event_member_distribution (event_id, member_id, team_season_id, locked_at) VALUES (?, ?, ?, " . ($lock ? "NOW()" : "NULL") . ")");
        foreach ($picked as $tsid) $ins->execute([$eid, $mid, $tsid]);
        Audit::write($pdo, (int)$cur['id'], 'event_member_distribution', $eid, 'update', null, ['member_id' => $mid, 'team_season_ids' => $picked]);

        // If contributions were already finalized, re-run so this youth's earnings post now.
        $refinalized = false;
        if (self::config($pdo, $eid)['finalized_at']) { self::runFinalize($pdo, $eid, (int)$cur['id']); $refinalized = true; }
        return Http::json($res, ['ok' => true, 'team_season_ids' => $picked, 're_finalized' => $refinalized]);
    }

    /** GET /members/{member_id}/earnings-todo — events where this youth must pick a team. */
    public static function earningsTodo(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($mid !== (int)$cur['id'] && !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])) {
            return Http::error($res, 'Access denied', 403);
        }
        // Only youth earn fundraising distributions, so only youth get the prompt.
        if (!self::isYouth($pdo, $mid)) return Http::json($res, []);
        // Events the member checked into that are fundraising opportunities.
        $s = $pdo->prepare(
            "SELECT DISTINCT e.id, e.name, e.event_date
             FROM checkins c JOIN events e ON e.id = c.event_id
             WHERE c.member_id = ? AND e.fundraising_opportunity = 1"
        );
        $s->execute([$mid]);
        $todo = [];
        foreach ($s->fetchAll() as $e) {
            $eid = (int)$e['id'];
            $eligible = self::eligibleTeamIds($pdo, $eid);
            $mine = array_values(array_intersect(self::memberTeamSeasons($pdo, $mid), $eligible));
            $chosen = self::distributionPref($pdo, $eid, $mid, $eligible);
            if (count($mine) > 1 && !$chosen) {
                $todo[] = ['event_id' => $eid, 'event_name' => $e['name'], 'event_date' => $e['event_date']];
            }
        }
        return Http::json($res, $todo);
    }
}
