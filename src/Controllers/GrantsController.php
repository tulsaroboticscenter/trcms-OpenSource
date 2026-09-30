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
 * Grant Tracking module. Tracks grant opportunities, per-team eligibility /
 * submission / award, correspondence, custom Q&A fields, reminders, and rolls
 * awards into each team's budget as a fundraising "Grants" line that turns
 * green (received) when the award is recorded.
 */
final class GrantsController
{
    private const GRANTS_CATEGORY = 'Grants';
    private const DISTRIBUTION = ['check_trc', 'electronic_trc', 'first_account', 'other'];

    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'grants.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'grants.manage', 'write'); }

    private static function grant(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM `grants` WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function teamLabel(PDO $pdo, ?int $tsid): string
    {
        if ($tsid === null) return 'TRC (organization)';
        $s = $pdo->prepare("SELECT t.team_number, ts.team_name, ts.season, p.name AS program
                            FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
                            LEFT JOIN programs p ON p.id = t.program_id WHERE ts.id = ?");
        $s->execute([$tsid]); $r = $s->fetch();
        if (!$r) return "Team season #$tsid";
        $name = $r['team_name'] ?: ('Team ' . $r['team_number']);
        return "#{$r['team_number']} {$name} · " . ($r['program'] ? $r['program'] . ' ' : '') . $r['season'];
    }

    private static function num($v): ?float { return $v === null || $v === '' ? null : (float)$v; }
    private static function intOrNull($v): ?int { return $v === null || $v === '' ? null : (int)$v; }
    private static function dateOrNull($v): ?string { return $v === null || $v === '' ? null : substr((string)$v, 0, 10); }

    private static function serializeGrant(array $g): array
    {
        return [
            'id' => (int)$g['id'], 'name' => $g['name'], 'funder_name' => $g['funder_name'],
            'scope' => $g['scope'], 'recurrence' => $g['recurrence'], 'status' => $g['status'],
            'season' => $g['season'] ?? null,
            'submitted_by_id' => self::intOrNull($g['submitted_by_id']),
            'submitted_date' => $g['submitted_date'], 'expected_response_date' => $g['expected_response_date'],
            'num_rounds' => self::intOrNull($g['num_rounds']), 'current_round' => self::intOrNull($g['current_round']),
            'restricted_funds' => (bool)$g['restricted_funds'], 'restriction_note' => $g['restriction_note'],
            'available_date' => $g['available_date'], 'remind_date' => $g['remind_date'], 'remind_note' => $g['remind_note'],
            'links' => $g['links'] ? json_decode($g['links'], true) : [],
            'description' => $g['description'],
        ];
    }

    private static function serializeTeamRow(PDO $pdo, array $t): array
    {
        return [
            'id' => (int)$t['id'], 'grant_id' => (int)$t['grant_id'],
            'team_season_id' => self::intOrNull($t['team_season_id']),
            'is_trc' => (bool)$t['is_trc'],
            'team_label' => self::teamLabel($pdo, self::intOrNull($t['team_season_id'])),
            'eligible' => (bool)$t['eligible'], 'submitted' => (bool)$t['submitted'],
            'submitted_date' => $t['submitted_date'] ?? null,
            'amount_requested' => self::num($t['amount_requested']),
            'outcome' => $t['outcome'], 'amount_received' => self::num($t['amount_received']),
            // Restricted portion of the award; unrestricted is the remainder of whatever's
            // in hand (received) or, if not yet awarded, of the requested amount.
            'restricted_amount' => self::num($t['restricted_amount'] ?? null),
            'unrestricted_amount' => self::num(max(0, (float)($t['amount_received'] ?? $t['amount_requested'] ?? 0) - (float)($t['restricted_amount'] ?? 0))),
            'distribution_method' => $t['distribution_method'], 'distribution_note' => $t['distribution_note'],
            'received_date' => $t['received_date'], 'notes' => $t['notes'],
        ];
    }

    // ── Grant CRUD ───────────────────────────────────────────────────────────

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = '1=1'; $args = [];
        if (!empty($q['status'])) { $where .= ' AND status = ?'; $args[] = $q['status']; }
        // Season = which season's budgets the grant funds — lets you pull up a past
        // year's submissions and awards.
        if (!empty($q['season'])) { $where .= ' AND season = ?'; $args[] = $q['season']; }
        if (!empty($q['scope'])) { $where .= ' AND scope = ?'; $args[] = $q['scope']; }
        if (!empty($q['funder'])) { $where .= ' AND funder_name LIKE ?'; $args[] = '%' . $q['funder'] . '%'; }
        $s = $pdo->prepare("SELECT * FROM `grants` WHERE $where ORDER BY COALESCE(submitted_date, available_date, created_at) DESC, id DESC");
        $s->execute($args);
        $rows = $s->fetchAll();
        $sumStmt = $pdo->prepare("SELECT COUNT(*) AS teams, COALESCE(SUM(amount_requested),0) AS requested,
                                  COALESCE(SUM(CASE WHEN outcome='awarded' THEN amount_received ELSE 0 END),0) AS received,
                                  SUM(CASE WHEN outcome='awarded' THEN 1 ELSE 0 END) AS awarded
                                  FROM grant_teams WHERE grant_id = ?");
        $out = [];
        foreach ($rows as $g) {
            $sumStmt->execute([(int)$g['id']]); $sum = $sumStmt->fetch();
            $out[] = self::serializeGrant($g) + [
                'team_count' => (int)$sum['teams'], 'awarded_count' => (int)$sum['awarded'],
                'total_requested' => round((float)$sum['requested'], 2), 'total_received' => round((float)$sum['received'], 2),
            ];
        }
        return Http::json($res, $out);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $g = self::grant($pdo, (int)$route['grant_id']);
        if (!$g) return Http::error($res, 'Grant not found', 404);
        $gid = (int)$g['id'];

        $ts = $pdo->prepare("SELECT * FROM grant_teams WHERE grant_id = ? ORDER BY is_trc DESC, id");
        $ts->execute([$gid]);
        $teams = array_map(fn($t) => self::serializeTeamRow($pdo, $t), $ts->fetchAll());

        $cs = $pdo->prepare("SELECT * FROM grant_correspondence WHERE grant_id = ? ORDER BY COALESCE(correspondence_date, created_at) DESC, id DESC");
        $cs->execute([$gid]);
        $corr = array_map(fn($c) => [
            'id' => (int)$c['id'], 'subject' => $c['subject'], 'sender' => $c['sender'],
            'correspondence_date' => $c['correspondence_date'], 'body' => $c['body'],
            'attachment_url' => $c['attachment_url'], 'created_at' => $c['created_at'],
        ], $cs->fetchAll());

        $fs = $pdo->prepare("SELECT * FROM grant_custom_fields WHERE grant_id = ? ORDER BY display_order, id");
        $fs->execute([$gid]);
        $fields = array_map(fn($f) => ['id' => (int)$f['id'], 'label' => $f['label'], 'response' => $f['response']], $fs->fetchAll());

        $byName = null;
        if ($g['submitted_by_id']) {
            $b = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $b->execute([(int)$g['submitted_by_id']]);
            if ($r = $b->fetch()) $byName = trim("{$r['first_name']} {$r['last_name']}");
        }

        return Http::json($res, self::serializeGrant($g) + [
            'submitted_by_name' => $byName,
            'teams' => $teams, 'correspondence' => $corr, 'custom_fields' => $fields,
        ]);
    }

    private const GRANT_FIELDS = ['name', 'funder_name', 'scope', 'recurrence', 'status', 'restriction_note',
        'remind_note', 'description'];

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Grant name is required.', 422);
        // A grant belongs to a SEASON (which season's budgets its money lands in).
        // Default to the current season so a grant raised any time lands on the
        // season you're actually in, not on whatever season a team picker resolves to.
        $season = trim((string)($d['season'] ?? '')) ?: \App\Core\EnrollmentService::currentSeason();
        $pdo->prepare("INSERT INTO `grants` (name, funder_name, scope, recurrence, status, season, submitted_by_id, submitted_date,
            expected_response_date, num_rounds, current_round, restricted_funds, restriction_note, available_date, remind_date,
            remind_note, links, description, created_by_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $d['name'], $d['funder_name'] ?? null, $d['scope'] ?? 'multi_team', $d['recurrence'] ?? 'one_time',
                $d['status'] ?? 'researching', $season, self::intOrNull($d['submitted_by_id'] ?? null), self::dateOrNull($d['submitted_date'] ?? null),
                self::dateOrNull($d['expected_response_date'] ?? null), self::intOrNull($d['num_rounds'] ?? null), self::intOrNull($d['current_round'] ?? null),
                (int)!empty($d['restricted_funds']), $d['restriction_note'] ?? null, self::dateOrNull($d['available_date'] ?? null),
                self::dateOrNull($d['remind_date'] ?? null), $d['remind_note'] ?? null,
                isset($d['links']) ? json_encode($d['links']) : null, $d['description'] ?? null, (int)$cur['id'],
            ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'grants', $id, 'create', null, ['name' => $d['name']]);
        return self::get($req, $res, ['grant_id' => $id]);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $gid = (int)$route['grant_id'];
        $before = self::grant($pdo, $gid);
        if (!$before) return Http::error($res, 'Grant not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        // Changing which season a grant is for moves its team links onto that season's
        // team-seasons (tracking preserved), so the money shows on the right budgets.
        $newSeason = null;
        if (array_key_exists('season', $d)) {
            $newSeason = trim((string)($d['season'] ?? '')) ?: null;
            $set[] = 'season = ?'; $args[] = $newSeason;
            unset($d['season']);
        }
        $seasonChanged = $newSeason !== null && $newSeason !== ($before['season'] ?? null);
        foreach (self::GRANT_FIELDS as $f) if ($f !== 'season' && array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        foreach (['submitted_date', 'expected_response_date', 'available_date', 'remind_date'] as $f)
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::dateOrNull($d[$f]); }
        foreach (['submitted_by_id', 'num_rounds', 'current_round'] as $f)
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::intOrNull($d[$f]); }
        if (array_key_exists('restricted_funds', $d)) { $set[] = 'restricted_funds = ?'; $args[] = (int)!empty($d['restricted_funds']); }
        if (array_key_exists('links', $d)) { $set[] = 'links = ?'; $args[] = $d['links'] === null ? null : json_encode($d['links']); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $gid; $pdo->prepare("UPDATE `grants` SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        if ($seasonChanged) {
            $movedLinks = self::moveGrantLinksToSeason($pdo, $gid, (string)$newSeason);
            if ($movedLinks > 0) {
                Audit::write($pdo, (int)$cur['id'], 'grant_teams', $gid, 'update', null,
                    ['repointed_to_season' => $newSeason, 'links_moved' => $movedLinks]);
            }
        }
        Audit::write($pdo, (int)$cur['id'], 'grants', $gid, 'update', null, $d + ($seasonChanged ? ['season' => $newSeason] : []));
        return self::get($req, $res, ['grant_id' => $gid]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $gid = (int)$route['grant_id'];
        if (!self::grant($pdo, $gid)) return Http::error($res, 'Grant not found', 404);
        // Remove the budget lines this grant created, then the grant (cascades teams/corr/fields).
        $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE grant_id = ?")->execute([$gid]);
        $pdo->prepare("DELETE FROM `grants` WHERE id = ?")->execute([$gid]);
        Audit::write($pdo, (int)$cur['id'], 'grants', $gid, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Per-team tracking + budget sync ──────────────────────────────────────

    /** PUT /grants/{id}/teams — set the eligible team list (+ optional TRC row). */
    public static function setTeams(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $gid = (int)$route['grant_id'];
        if (!self::grant($pdo, $gid)) return Http::error($res, 'Grant not found', 404);
        $d = (array)$req->getParsedBody();
        $wanted = array_values(array_unique(array_map('intval', (array)($d['team_season_ids'] ?? []))));
        $includeTrc = !empty($d['include_trc']);

        $cur2 = $pdo->prepare("SELECT id, team_season_id, is_trc FROM grant_teams WHERE grant_id = ?"); $cur2->execute([$gid]);
        $existing = $cur2->fetchAll();
        $existingTeamIds = array_map('intval', array_column(array_filter($existing, fn($r) => $r['team_season_id'] !== null), 'team_season_id'));
        $hasTrc = (bool)array_filter($existing, fn($r) => (int)$r['is_trc'] === 1);

        foreach (array_diff($wanted, $existingTeamIds) as $tsid) {
            $pdo->prepare("INSERT INTO grant_teams (grant_id, team_season_id, eligible) VALUES (?, ?, 1)")->execute([$gid, (int)$tsid]);
        }
        foreach (array_diff($existingTeamIds, $wanted) as $tsid) {
            self::removeTeamRow($pdo, $gid, (int)$tsid);
        }
        if ($includeTrc && !$hasTrc) $pdo->prepare("INSERT INTO grant_teams (grant_id, team_season_id, is_trc, eligible) VALUES (?, NULL, 1, 1)")->execute([$gid]);
        if (!$includeTrc && $hasTrc) $pdo->prepare("DELETE FROM grant_teams WHERE grant_id = ? AND is_trc = 1")->execute([$gid]);

        Audit::write($pdo, (int)$cur['id'], 'grant_teams', $gid, 'update', null, ['team_season_ids' => $wanted, 'include_trc' => $includeTrc]);
        return self::get($req, $res, ['grant_id' => $gid]);
    }

    /**
     * POST /grants/repoint-season  { from_season, to_season }
     * Season-transition repair: for every grant marked "for {to}" whose team links are
     * still on {from}, move the links onto the SAME team's {to} row so the grant shows
     * on the new season's budgets. Driven by the grant's OWN season field — a grant
     * created at any time shows on the season it's tagged for. Grants tagged for other
     * seasons are untouched (their budget lines are that season's history).
     *
     * Rows are MOVED, not recreated: amount requested, outcome, award amount and
     * distribution notes are preserved and the budget line is rebuilt. Idempotent.
     */
    public static function repointSeason(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $from = trim((string)($d['from_season'] ?? ''));
        $to = trim((string)($d['to_season'] ?? ''));
        if ($from === '' || $to === '') return Http::error($res, 'from_season and to_season are required', 422);
        if ($from === $to) return Http::error($res, 'from_season and to_season must differ', 422);

        // Every grant tagged for {to} whose links are still on {from} — regardless of
        // when it was created.
        $gs = $pdo->prepare(
            "SELECT DISTINCT g.id, g.name
               FROM grants g
               JOIN grant_teams gt  ON gt.grant_id = g.id AND gt.team_season_id IS NOT NULL
               JOIN team_seasons ts ON ts.id = gt.team_season_id
              WHERE g.season = ? AND ts.season = ?"
        );
        $gs->execute([$to, $from]);
        $moved = 0; $names = [];
        foreach ($gs->fetchAll() as $g) {
            $n = self::moveGrantLinksToSeason($pdo, (int)$g['id'], $to);
            if ($n > 0) { $moved += $n; $names[] = $g['name']; }
        }
        Audit::write($pdo, (int)$cur['id'], 'grant_teams', null, 'update', null,
            ['repoint_from' => $from, 'repoint_to' => $to, 'links_moved' => $moved]);

        $msg = $moved > 0
            ? "Moved $moved grant/team link(s) onto $to: " . implode(', ', $names)
                . '. Amounts requested/awarded were preserved and the budget lines rebuilt.'
            : "No grant/team links needed moving — every grant marked for $to already points at $to."
                . " If a grant is still missing from a team's budget: set its Season to $to on the grant, and make sure it has an"
                . " amount requested (a grant with no requested amount and no award has no budget line).";
        return Http::json($res, ['ok' => true, 'links_moved' => $moved, 'message' => $msg]);
    }

    /**
     * Move one grant's team links onto $toSeason: each link goes to the SAME team's
     * row in that season. The grant_teams row is MOVED, not recreated — amount
     * requested, outcome, award amount and distribution notes are preserved — and its
     * budget line is rebuilt on the new season. Teams with no row in $toSeason are
     * left alone. Idempotent. Returns the number of links moved.
     */
    private static function moveGrantLinksToSeason(PDO $pdo, int $gid, string $toSeason): int
    {
        if (trim($toSeason) === '') return 0;
        $rows = $pdo->prepare(
            "SELECT gt.id, gt.team_season_id, gt.budget_donation_id, ts.team_id, ts.season
               FROM grant_teams gt JOIN team_seasons ts ON ts.id = gt.team_season_id
              WHERE gt.grant_id = ? AND gt.team_season_id IS NOT NULL"
        );
        $rows->execute([$gid]);
        $findTarget = $pdo->prepare("SELECT id FROM team_seasons WHERE team_id = ? AND season = ?");
        $dupe = $pdo->prepare("SELECT id FROM grant_teams WHERE grant_id = ? AND team_season_id = ?");
        $moved = 0;
        foreach ($rows->fetchAll() as $r) {
            if ((string)$r['season'] === $toSeason) continue;          // already there
            $findTarget->execute([(int)$r['team_id'], $toSeason]);
            $newTsid = (int)($findTarget->fetchColumn() ?: 0);
            if (!$newTsid) continue;                                    // team has no row in that season
            $dupe->execute([$gid, $newTsid]);
            if ($dupe->fetch()) continue;                               // already linked there
            if (!empty($r['budget_donation_id'])) {
                $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([(int)$r['budget_donation_id']]);
            }
            $pdo->prepare("UPDATE grant_teams SET team_season_id = ?, budget_donation_id = NULL WHERE id = ?")
                ->execute([$newTsid, (int)$r['id']]);
            self::syncTeamBudget($pdo, (int)$r['id']);
            $moved++;
        }
        return $moved;
    }

    private static function removeTeamRow(PDO $pdo, int $gid, int $tsid): void
    {
        $s = $pdo->prepare("SELECT budget_donation_id FROM grant_teams WHERE grant_id = ? AND team_season_id = ?");
        $s->execute([$gid, $tsid]); $row = $s->fetch();
        if ($row && $row['budget_donation_id']) $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([(int)$row['budget_donation_id']]);
        $pdo->prepare("DELETE FROM grant_teams WHERE grant_id = ? AND team_season_id = ?")->execute([$gid, $tsid]);
    }

    /** PATCH /grants/teams/{grant_team_id} — update one team's grant tracking + sync its budget. */
    public static function updateTeam(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $gtid = (int)$route['grant_team_id'];
        $s = $pdo->prepare("SELECT * FROM grant_teams WHERE id = ?"); $s->execute([$gtid]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Grant team row not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['eligible', 'submitted'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = (int)!empty($d[$f]); }
        foreach (['amount_requested', 'amount_received', 'restricted_amount'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::num($d[$f]); }
        if (array_key_exists('outcome', $d) && in_array($d['outcome'], ['pending', 'awarded', 'declined'], true)) { $set[] = 'outcome = ?'; $args[] = $d['outcome']; }
        if (array_key_exists('distribution_method', $d)) { $set[] = 'distribution_method = ?'; $args[] = in_array($d['distribution_method'], self::DISTRIBUTION, true) ? $d['distribution_method'] : null; }
        if (array_key_exists('distribution_note', $d)) { $set[] = 'distribution_note = ?'; $args[] = $d['distribution_note']; }
        if (array_key_exists('submitted_date', $d)) { $set[] = 'submitted_date = ?'; $args[] = self::dateOrNull($d['submitted_date']); }
        if (array_key_exists('received_date', $d)) { $set[] = 'received_date = ?'; $args[] = self::dateOrNull($d['received_date']); }
        if (array_key_exists('notes', $d)) { $set[] = 'notes = ?'; $args[] = $d['notes']; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $gtid; $pdo->prepare("UPDATE grant_teams SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }

        // Re-load and sync the team's budget line.
        $s->execute([$gtid]); $row = $s->fetch();
        self::syncTeamBudget($pdo, $gtid);
        Audit::write($pdo, (int)$cur['id'], 'grant_teams', $gtid, 'update', null, $d);
        return self::get($req, $res, ['grant_id' => (int)$row['grant_id']]);
    }

    private static function ensureGrantsCategory(PDO $pdo, int $teamSeasonId): int
    {
        $s = $pdo->prepare("SELECT id FROM inv_budget_categories WHERE team_season_id = ? AND is_fundraising = 1 AND name = ?");
        $s->execute([$teamSeasonId, self::GRANTS_CATEGORY]);
        $r = $s->fetch();
        if ($r) return (int)$r['id'];
        $pdo->prepare("INSERT INTO inv_budget_categories (team_season_id, name, is_fundraising, budgeted_amount, actual_amount, created_at) VALUES (?, ?, 1, 0, 0, NOW())")
            ->execute([$teamSeasonId, self::GRANTS_CATEGORY]);
        return (int)$pdo->lastInsertId();
    }

    /**
     * Sync a grant_team row to a fundraising "Grants" budget line on the team.
     * Expected = amount requested. Received = award amount (only when awarded) —
     * which makes the line show as funded/green in the budget panel.
     */
    private static function syncTeamBudget(PDO $pdo, int $gtid): void
    {
        $s = $pdo->prepare("SELECT * FROM grant_teams WHERE id = ?"); $s->execute([$gtid]); $t = $s->fetch();
        if (!$t || $t['team_season_id'] === null) return; // TRC-level rows have no team budget
        $tsid = (int)$t['team_season_id'];
        $g = self::grant($pdo, (int)$t['grant_id']);
        $label = $g['funder_name'] ? "{$g['name']} ({$g['funder_name']})" : $g['name'];
        $requested = self::num($t['amount_requested']);
        $received = ($t['outcome'] === 'awarded') ? self::num($t['amount_received']) : null;
        $restricted = self::num($t['restricted_amount'] ?? null);
        $donId = self::intOrNull($t['budget_donation_id']);

        // No request amount and no award → remove any line we created.
        if ($requested === null && $received === null) {
            if ($donId) { $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([$donId]);
                $pdo->prepare("UPDATE grant_teams SET budget_donation_id = NULL WHERE id = ?")->execute([$gtid]); }
            return;
        }
        $cat = self::ensureGrantsCategory($pdo, $tsid);
        if ($donId) {
            $pdo->prepare("UPDATE inv_fundraising_donations SET budget_category_id = ?, name = ?, expected_amount = ?, received_amount = ?, received_date = ?, restricted_amount = ?, grant_id = ? WHERE id = ?")
                ->execute([$cat, $label, $requested, $received, $t['received_date'], $restricted, (int)$t['grant_id'], $donId]);
        } else {
            $pdo->prepare("INSERT INTO inv_fundraising_donations (budget_category_id, grant_id, name, expected_amount, received_amount, received_date, restricted_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())")
                ->execute([$cat, (int)$t['grant_id'], $label, $requested, $received, $t['received_date'], $restricted]);
            $pdo->prepare("UPDATE grant_teams SET budget_donation_id = ? WHERE id = ?")->execute([(int)$pdo->lastInsertId(), $gtid]);
        }
    }

    // ── Correspondence ───────────────────────────────────────────────────────

    public static function addCorrespondence(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $gid = (int)$route['grant_id'];
        if (!self::grant($pdo, $gid)) return Http::error($res, 'Grant not found', 404);
        $d = (array)$req->getParsedBody();
        $pdo->prepare("INSERT INTO grant_correspondence (grant_id, subject, sender, correspondence_date, body, attachment_url, created_by_id) VALUES (?,?,?,?,?,?,?)")
            ->execute([$gid, $d['subject'] ?? null, $d['sender'] ?? null, self::dateOrNull($d['correspondence_date'] ?? null),
                $d['body'] ?? null, $d['attachment_url'] ?? null, (int)$cur['id']]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'grant_correspondence', $newId, 'create', null, ['grant_id' => $gid]);
        return self::get($req, $res, ['grant_id' => $gid]);
    }

    public static function deleteCorrespondence(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $cid = (int)$route['correspondence_id'];
        $s = $pdo->prepare("SELECT grant_id FROM grant_correspondence WHERE id = ?"); $s->execute([$cid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Not found', 404);
        $pdo->prepare("DELETE FROM grant_correspondence WHERE id = ?")->execute([$cid]);
        Audit::write($pdo, (int)$cur['id'], 'grant_correspondence', $cid, 'delete', null, null);
        return self::get($req, $res, ['grant_id' => (int)$r['grant_id']]);
    }

    // ── Custom fields ────────────────────────────────────────────────────────

    public static function addField(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $gid = (int)$route['grant_id'];
        if (!self::grant($pdo, $gid)) return Http::error($res, 'Grant not found', 404);
        $d = (array)$req->getParsedBody();
        if (empty($d['label'])) return Http::error($res, 'Field label is required.', 422);
        $pdo->prepare("INSERT INTO grant_custom_fields (grant_id, label, response, display_order) VALUES (?,?,?,?)")
            ->execute([$gid, $d['label'], $d['response'] ?? null, (int)($d['display_order'] ?? 0)]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'grant_custom_fields', $newId, 'create', null, ['grant_id' => $gid, 'label' => $d['label']]);
        return self::get($req, $res, ['grant_id' => $gid]);
    }

    public static function updateField(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $fid = (int)$route['field_id'];
        $s = $pdo->prepare("SELECT grant_id FROM grant_custom_fields WHERE id = ?"); $s->execute([$fid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('label', $d)) { $set[] = 'label = ?'; $args[] = $d['label']; }
        if (array_key_exists('response', $d)) { $set[] = 'response = ?'; $args[] = $d['response']; }
        if ($set) { $args[] = $fid; $pdo->prepare("UPDATE grant_custom_fields SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'grant_custom_fields', $fid, 'update', null, $d);
        return self::get($req, $res, ['grant_id' => (int)$r['grant_id']]);
    }

    public static function deleteField(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $fid = (int)$route['field_id'];
        $s = $pdo->prepare("SELECT grant_id FROM grant_custom_fields WHERE id = ?"); $s->execute([$fid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Not found', 404);
        $pdo->prepare("DELETE FROM grant_custom_fields WHERE id = ?")->execute([$fid]);
        Audit::write($pdo, (int)$cur['id'], 'grant_custom_fields', $fid, 'delete', null, null);
        return self::get($req, $res, ['grant_id' => (int)$r['grant_id']]);
    }

    // ── Reminders + reports ──────────────────────────────────────────────────

    /** GET /grants/reminders — upcoming availability/reminder dates (dashboard). */
    public static function reminders(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::json($res, []);
        $today = date('Y-m-d');
        // Only grants whose reminder has actually ARRIVED (remind/available date is today
        // or earlier) and still need action: not yet submitted and not in a resolved status.
        // A future remind date must NOT appear early. Once submitted (or marked awarded/
        // declined/closed/not applying), the reminder drops off the banner.
        $s = $pdo->prepare("SELECT id, name, funder_name, available_date, remind_date, remind_note
                            FROM `grants`
                            WHERE ((remind_date IS NOT NULL AND remind_date <= ?) OR (available_date IS NOT NULL AND available_date <= ?))
                              AND submitted_date IS NULL
                              AND status NOT IN ('submitted','awarded','declined','closed','not_applying')
                            ORDER BY COALESCE(remind_date, available_date) LIMIT 50");
        $s->execute([$today, $today]);
        return Http::json($res, array_map(fn($g) => [
            'id' => (int)$g['id'], 'name' => $g['name'], 'funder_name' => $g['funder_name'],
            'available_date' => $g['available_date'], 'remind_date' => $g['remind_date'], 'remind_note' => $g['remind_note'],
        ], $s->fetchAll()));
    }

    /** POST /grants/{grant_id}/mark-submitted — acknowledge a grant as submitted so its
     *  reminder clears from the dashboard banner. Records who/when if not already set. */
    public static function markSubmitted(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['grant_id'];
        $g = self::grant($pdo, $id);
        if (!$g) return Http::error($res, 'Grant not found', 404);
        // #184: only ADVANCE a pre-submission grant to 'submitted'. A grant already at
        // submitted/awarded/partially_awarded/declined/closed keeps its real status — clearing
        // the reminder must not regress it (the banner was flipping decided grants to Submitted).
        $advance = in_array((string)$g['status'], ['researching', 'open'], true);
        $pdo->prepare("UPDATE `grants` SET status = " . ($advance ? "'submitted'" : "status") . ",
                          submitted_date = COALESCE(submitted_date, CURDATE()),
                          submitted_by_id = COALESCE(submitted_by_id, ?),
                          updated_at = NOW()
                        WHERE id = ?")->execute([(int)$cur['id'], $id]);
        Audit::write($pdo, (int)$cur['id'], 'grants', $id, 'mark_submitted', null,
            ['status' => $advance ? 'submitted' : (string)$g['status']]);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /grants/reports — money received by team, by funder, by year, + life total. */
    public static function reports(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);

        $byTeam = $pdo->query(
            "SELECT gt.team_season_id, gt.is_trc, COALESCE(SUM(gt.amount_received),0) AS received
             FROM grant_teams gt WHERE gt.outcome = 'awarded'
             GROUP BY gt.team_season_id, gt.is_trc ORDER BY received DESC"
        )->fetchAll();
        $teams = array_map(fn($r) => [
            'team_season_id' => self::intOrNull($r['team_season_id']),
            'label' => $r['is_trc'] || $r['team_season_id'] === null ? 'TRC (organization)' : self::teamLabel($pdo, (int)$r['team_season_id']),
            'received' => round((float)$r['received'], 2),
        ], $byTeam);

        $byFunder = $pdo->query(
            "SELECT g.funder_name, COALESCE(SUM(gt.amount_received),0) AS received, COUNT(DISTINCT g.id) AS grants
             FROM grant_teams gt JOIN `grants` g ON g.id = gt.grant_id
             WHERE gt.outcome = 'awarded' GROUP BY g.funder_name ORDER BY received DESC"
        )->fetchAll();
        $funders = array_map(fn($r) => ['funder_name' => $r['funder_name'] ?: '(unspecified)', 'received' => round((float)$r['received'], 2), 'grants' => (int)$r['grants']], $byFunder);

        $byYear = $pdo->query(
            "SELECT YEAR(COALESCE(gt.received_date, g.submitted_date, g.created_at)) AS yr, COALESCE(SUM(gt.amount_received),0) AS received
             FROM grant_teams gt JOIN `grants` g ON g.id = gt.grant_id
             WHERE gt.outcome = 'awarded' GROUP BY yr ORDER BY yr DESC"
        )->fetchAll();
        $years = array_map(fn($r) => ['year' => (int)$r['yr'], 'received' => round((float)$r['received'], 2)], $byYear);

        // By SEASON — the season the grant funds, which is what "how did we do in
        // 2025-2026?" actually means. (by_year above is the calendar year the money
        // landed, which straddles a season.) Counts submissions as well as awards so a
        // past season's full picture is visible, not just what was won.
        $bySeason = $pdo->query(
            "SELECT g.season,
                    COUNT(DISTINCT g.id) AS grants,
                    SUM(CASE WHEN gt.outcome = 'awarded' THEN 1 ELSE 0 END) AS awarded_count,
                    COALESCE(SUM(gt.amount_requested),0) AS requested,
                    COALESCE(SUM(CASE WHEN gt.outcome = 'awarded' THEN gt.amount_received ELSE 0 END),0) AS received
               FROM `grants` g JOIN grant_teams gt ON gt.grant_id = g.id
              WHERE g.season IS NOT NULL
              GROUP BY g.season ORDER BY g.season DESC"
        )->fetchAll();
        $seasons = array_map(fn($r) => [
            'season' => $r['season'], 'grants' => (int)$r['grants'], 'awarded_count' => (int)$r['awarded_count'],
            'requested' => round((float)$r['requested'], 2), 'received' => round((float)$r['received'], 2),
        ], $bySeason);

        $life = (float)$pdo->query("SELECT COALESCE(SUM(amount_received),0) FROM grant_teams WHERE outcome='awarded'")->fetchColumn();

        return Http::json($res, ['by_team' => $teams, 'by_funder' => $funders, 'by_year' => $years,
            'by_season' => $seasons, 'life_total' => round($life, 2)]);
    }
}
