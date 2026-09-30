<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Port of app/modules/teams/router.py — read endpoints.
 * (Per-team view-permission filtering is simplified for now; write endpoints
 * and the program-enrollment guard are ported later.)
 */
final class TeamsController
{
    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return $y . '-' . ($y + 1);
    }

    private static function seasonsCompeted(?string $rookie, string $current): int
    {
        if (!$rookie) return 0;
        $r = (int)explode('-', $rookie)[0];
        $c = (int)explode('-', $current)[0];
        return max(0, $c - $r + 1);
    }

    private static function serializeSeason(?array $s): array
    {
        if (!$s) return [];
        $b = fn($k) => isset($s[$k]) && $s[$k] !== null ? (bool)$s[$k] : $s[$k] ?? null;
        // discord_links is a Text column (raw JSON string); Python returns it unparsed.
        return [
            'id'             => (int)$s['id'],
            'team_id'        => (int)$s['team_id'],
            'season'         => $s['season'],
            'team_name'      => $s['team_name'],
            'status'         => $s['status'],
            'instagram'      => $s['instagram'] ?? null,
            'tiktok'         => $s['tiktok'] ?? null,
            'youtube'        => $s['youtube'] ?? null,
            'x_account'      => $s['x_account'] ?? null,
            'website'        => $s['website'] ?? null,
            'discord_links'  => $s['discord_links'] ?? null,
            'robot_name'     => $s['robot_name'] ?? null,
            'robot_photo_url' => $s['robot_photo_url'] ?? null,
            'team_logo_url'  => $s['team_logo_url'] ?? null,
            'team_photo_url' => $s['team_photo_url'] ?? null,
            'theme_preset'   => $s['theme_preset'] ?? null,
            'theme_font'     => $s['theme_font'] ?? null,
            'theme_accent'   => $s['theme_accent'] ?? null,
        ];
    }

    private static function currentSeasonRow(PDO $pdo, int $teamId): ?array
    {
        $stmt = $pdo->prepare("SELECT * FROM team_seasons WHERE team_id = ? AND season = ?");
        $stmt->execute([$teamId, self::currentSeason()]);
        return $stmt->fetch() ?: null;
    }

    /**
     * The season row to treat as "current" for display. Right after the season
     * boundary rolls over — before the Season Transition creates the new
     * team-seasons OR before rosters are rolled forward into them — the current
     * season may not exist, or exist but be empty. In those cases fall back to the
     * team's most recent season that actually HAS a roster, so a team's members,
     * identity, and event flags stay visible instead of vanishing across the roll.
     */
    private static function currentOrLatestSeasonRow(PDO $pdo, int $teamId): ?array
    {
        $cur = self::currentSeasonRow($pdo, $teamId);
        // Use the current season only once it has its own roster.
        if ($cur && self::seasonHasRoster($pdo, (int)$cur['id'])) return $cur;
        // Otherwise the most recent season that still has members on it.
        $stmt = $pdo->prepare(
            "SELECT ts.* FROM team_seasons ts
              WHERE ts.team_id = ?
                AND EXISTS (SELECT 1 FROM team_member_assignments tma JOIN members m ON m.id = tma.member_id
                             WHERE tma.team_season_id = ts.id
                               AND (m.is_archived = false OR m.is_archived IS NULL)
                               AND (m.is_active = true OR m.is_active IS NULL))
              ORDER BY ts.season DESC LIMIT 1"
        );
        $stmt->execute([$teamId]);
        if ($row = $stmt->fetch()) return $row;
        // No season has a roster yet — fall back to the current or the latest row.
        if ($cur) return $cur;
        $stmt = $pdo->prepare("SELECT * FROM team_seasons WHERE team_id = ? ORDER BY season DESC LIMIT 1");
        $stmt->execute([$teamId]);
        return $stmt->fetch() ?: null;
    }

    private static function seasonHasRoster(PDO $pdo, int $teamSeasonId): bool
    {
        $s = $pdo->prepare(
            "SELECT 1 FROM team_member_assignments tma JOIN members m ON m.id = tma.member_id
              WHERE tma.team_season_id = ?
                AND (m.is_archived = false OR m.is_archived IS NULL)
                AND (m.is_active = true OR m.is_active IS NULL) LIMIT 1"
        );
        $s->execute([$teamSeasonId]);
        return (bool)$s->fetchColumn();
    }

    private static function serializeTeam(PDO $pdo, array $t): array
    {
        $current = self::currentSeason();
        $cs = self::currentOrLatestSeasonRow($pdo, (int)$t['id']);
        return [
            'id'               => (int)$t['id'],
            'team_number'      => $t['team_number'],
            'program_id'       => $t['program_id'] !== null ? (int)$t['program_id'] : null,
            'program_name'     => $t['program_name'] ?? null,
            'rookie_season'    => $t['rookie_season'] ?? null,
            'seasons_competed' => self::seasonsCompeted($t['rookie_season'] ?? null, $current),
            'current_season'   => $cs ? self::serializeSeason($cs) : null,
        ];
    }

    // ── Routes ───────────────────────────────────────────────────────────

    public static function list(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        $q = $request->getQueryParams();
        $sql = "SELECT t.*, p.name AS program_name FROM teams t LEFT JOIN programs p ON p.id = t.program_id";
        $where = []; $args = [];
        if (!empty($q['program_id'])) { $where[] = "t.program_id = ?"; $args[] = (int)$q['program_id']; }
        // Without the teams.profiles_others permission (Admin → Role Management), a
        // member sees only teams they're rostered on. The Youth Member role is seeded
        // to deny it, so youth see only their own teams — configurable per role.
        if (!Permissions::memberCan($pdo, $cur, 'teams.profiles_others', 'read')) {
            $where[] = "t.id IN (SELECT ts.team_id FROM team_seasons ts
                                   JOIN team_member_assignments tma ON tma.team_season_id = ts.id
                                  WHERE tma.member_id = ?)";
            $args[] = (int)$cur['id'];
        }
        if ($where) $sql .= " WHERE " . implode(' AND ', $where);
        $sql .= " ORDER BY t.team_number";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($args);
        $out = array_map(fn($t) => self::serializeTeam($pdo, $t), $stmt->fetchAll());
        return Http::json($response, $out);
    }

    public static function currentSeason2(Request $request, Response $response): Response
    {
        return Http::json($response, ['season' => self::currentSeason()]);
    }

    /** True if the member is (or was) rostered on any season of this team. */
    private static function isOnTeam(PDO $pdo, int $memberId, int $teamId): bool
    {
        $s = $pdo->prepare(
            "SELECT 1 FROM team_seasons ts
               JOIN team_member_assignments tma ON tma.team_season_id = ts.id
              WHERE ts.team_id = ? AND tma.member_id = ? LIMIT 1");
        $s->execute([$teamId, $memberId]);
        return (bool)$s->fetchColumn();
    }

    /**
     * Whether the viewer may see a team's PROFILE. Governed by role permissions
     * (Admin → Role Management): teams.profiles_own for a team you're rostered on,
     * teams.profiles_others for any other team. Defaults grant both; the Youth
     * Member role is seeded to deny "_others" so youth see only their own teams —
     * fully configurable per role.
     */
    private static function mayViewTeamProfile(PDO $pdo, array $cur, int $teamId): bool
    {
        $key = self::isOnTeam($pdo, (int)$cur['id'], $teamId) ? 'teams.profiles_own' : 'teams.profiles_others';
        return Permissions::memberCan($pdo, $cur, $key, 'read');
    }

    /** Same, for a team's ROSTER (teams.roster_own / teams.roster_others). */
    private static function mayViewTeamRoster(PDO $pdo, array $cur, int $teamId): bool
    {
        $key = self::isOnTeam($pdo, (int)$cur['id'], $teamId) ? 'teams.roster_own' : 'teams.roster_others';
        return Permissions::memberCan($pdo, $cur, $key, 'read');
    }

    /**
     * The YLC roles that are TEAM leadership, as opposed to program-wide council
     * offices (President, Secretary, Treasurer, At Large) which are not team-specific
     * and must not appear on a team page.
     *
     * Editable in system_config category 'team_leadership_roles' (a JSON array of role
     * names, matching the names in the YLC role list) so the titles can change without
     * a code change. "Vice Captain" and "Vice President" are both defaulted so the pane
     * keeps working either side of a rename.
     */
    private const DEFAULT_TEAM_LEADERSHIP_ROLES = ['Team Leader', 'Vice Captain', 'Vice President', 'Quartermaster'];

    private static function teamLeadershipRoles(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'team_leadership_roles'");
        $s->execute();
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode((string)$r['values'], true) : null;
        $list = (is_array($v) && $v) ? $v : self::DEFAULT_TEAM_LEADERSHIP_ROLES;
        return array_values(array_filter(array_map(fn ($x) => trim((string)$x), $list), fn ($x) => $x !== ''));
    }

    /** The team_id + season string for a team_season row, or [0, ''] if unknown. */
    private static function seasonInfo(PDO $pdo, int $seasonId): array
    {
        $s = $pdo->prepare("SELECT team_id, season FROM team_seasons WHERE id = ?");
        $s->execute([$seasonId]);
        $r = $s->fetch();
        return $r ? [(int)$r['team_id'], (string)$r['season']] : [0, ''];
    }

    /** May the current member assign/remove this team's leadership? */
    private static function mayManageLeadership(PDO $pdo, array $cur): bool
    {
        return Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor']);
    }

    /**
     * GET /teams/seasons/{season_id}/leadership — the team's leadership for the season.
     *
     * Leadership is the Youth Leadership Council roles TIED TO THIS TEAM: a TEAM-level YLC
     * role (see teamLeadershipRoles()) whose term matches the season AND whose team_id is
     * this team. A crossover youth who leads another team no longer shows here. Program-
     * wide council offices (President, …) are team-agnostic and never appear.
     *
     * Returns the leaders plus, for a manager, the roster candidates and assignable roles
     * so the pane can edit. Read visibility matches the roster.
     */
    public static function seasonLeadership(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        $sid = (int)$route['season_id'];
        [$teamId, $season] = self::seasonInfo($pdo, $sid);
        if (!$teamId) return Http::error($response, 'Team season not found', 404);
        if (!self::mayViewTeamRoster($pdo, $cur, $teamId)) {
            return Http::error($response, 'You can only view teams you are a member of.', 403);
        }
        $roles = self::teamLeadershipRoles($pdo);
        $canManage = self::mayManageLeadership($pdo, $cur);

        $leaders = [];
        if ($roles) {
            $in = implode(',', array_fill(0, count($roles), '?'));
            $order = implode(',', array_fill(0, count($roles), '?'));
            // Tied to THIS team (y.team_id = ts.team_id), matching the season term.
            $stmt = $pdo->prepare(
                "SELECT y.id AS ylc_id, m.id AS member_id, m.first_name, m.last_name, m.photo_url, y.role
                   FROM ylc_memberships y
                   JOIN team_seasons ts ON ts.id = ? AND y.team_id = ts.team_id AND y.term = ts.season
                   JOIN members m ON m.id = y.member_id
                  WHERE y.role IN ($in)
                    AND (m.is_archived = false OR m.is_archived IS NULL)
                    AND (m.is_active = true OR m.is_active IS NULL)
                  ORDER BY FIELD(y.role, $order), m.last_name, m.first_name"
            );
            $stmt->execute(array_merge([$sid], $roles, $roles));
            foreach ($stmt->fetchAll() as $r) {
                $leaders[] = [
                    'ylc_id' => (int)$r['ylc_id'],
                    'member_id' => (int)$r['member_id'],
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'photo_url' => $r['photo_url'] ?: null,
                    'role' => $r['role'] ?: 'At Large',
                ];
            }
        }

        // Roster youth a manager can pick from, with their current team role here (if any).
        $candidates = [];
        if ($canManage) {
            $cs = $pdo->prepare(
                "SELECT m.id AS member_id, m.first_name, m.last_name, m.photo_url,
                        (SELECT y.role FROM ylc_memberships y
                          WHERE y.member_id = m.id AND y.team_id = ? AND y.term = ? LIMIT 1) AS current_role
                   FROM team_member_assignments tma
                   JOIN members m ON m.id = tma.member_id
                  WHERE tma.team_season_id = ? AND m.member_type = 'youth'
                    AND (m.is_archived = false OR m.is_archived IS NULL)
                    AND (m.is_active = true OR m.is_active IS NULL)
                  ORDER BY m.last_name, m.first_name"
            );
            $cs->execute([$teamId, $season, $sid]);
            foreach ($cs->fetchAll() as $r) {
                $candidates[] = [
                    'member_id' => (int)$r['member_id'],
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'photo_url' => $r['photo_url'] ?: null,
                    'current_role' => $r['current_role'] ?: null,
                ];
            }
        }

        return Http::json($response, [
            'leaders' => $leaders,
            'can_manage' => $canManage,
            'roles' => $roles,
            'candidates' => $candidates,
        ]);
    }

    /**
     * POST /teams/seasons/{season_id}/leadership — assign a team-level YLC role to a
     * roster member, tied to this team. Body: { member_id, role }.
     *
     * Writes a ylc_memberships row (member_id, term = season, team_id = this team, role);
     * a youth may hold one such row per team, so this never disturbs a role they hold on
     * another team or a program-wide council office (team_id NULL).
     */
    public static function assignLeadership(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        if (!self::mayManageLeadership($pdo, $cur)) return Http::error($response, 'Access denied', 403);

        $sid = (int)$route['season_id'];
        [$teamId, $season] = self::seasonInfo($pdo, $sid);
        if (!$teamId) return Http::error($response, 'Team season not found', 404);

        $d = (array)$request->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        $role = trim((string)($d['role'] ?? ''));

        $roles = self::teamLeadershipRoles($pdo);
        if (!in_array($role, $roles, true)) {
            return Http::error($response, 'Pick a team leadership role: ' . implode(', ', $roles) . '.', 422);
        }
        // The member must be on this team's roster for the season.
        $on = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE team_season_id = ? AND member_id = ?");
        $on->execute([$sid, $mid]);
        if (!$on->fetchColumn()) return Http::error($response, 'That member is not on this team\'s roster.', 422);

        // One team-leadership row per (member, team, term): update it or create it.
        $find = $pdo->prepare("SELECT id FROM ylc_memberships WHERE member_id = ? AND team_id = ? AND term = ?");
        $find->execute([$mid, $teamId, $season]);
        if ($row = $find->fetch()) {
            $pdo->prepare("UPDATE ylc_memberships SET role = ? WHERE id = ?")->execute([$role, (int)$row['id']]);
            Audit::write($pdo, (int)$cur['id'], 'ylc_memberships', (int)$row['id'], 'update', null,
                ['member_id' => $mid, 'team_id' => $teamId, 'term' => $season, 'role' => $role]);
        } else {
            $pdo->prepare("INSERT INTO ylc_memberships (member_id, team_id, term, role) VALUES (?, ?, ?, ?)")
                ->execute([$mid, $teamId, $season, $role]);
            Audit::write($pdo, (int)$cur['id'], 'ylc_memberships', (int)$pdo->lastInsertId(), 'create', null,
                ['member_id' => $mid, 'team_id' => $teamId, 'term' => $season, 'role' => $role]);
        }
        return self::seasonLeadership($request, $response, $route);
    }

    /**
     * DELETE /teams/seasons/{season_id}/leadership/{member_id} — remove a member's team
     * leadership role for THIS team (leaves any role they hold on other teams alone).
     */
    public static function removeLeadership(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        if (!self::mayManageLeadership($pdo, $cur)) return Http::error($response, 'Access denied', 403);

        $sid = (int)$route['season_id'];
        [$teamId, $season] = self::seasonInfo($pdo, $sid);
        if (!$teamId) return Http::error($response, 'Team season not found', 404);
        $mid = (int)$route['member_id'];

        $find = $pdo->prepare("SELECT id FROM ylc_memberships WHERE member_id = ? AND team_id = ? AND term = ?");
        $find->execute([$mid, $teamId, $season]);
        foreach ($find->fetchAll() as $row) {
            $pdo->prepare("DELETE FROM ylc_memberships WHERE id = ?")->execute([(int)$row['id']]);
            Audit::write($pdo, (int)$cur['id'], 'ylc_memberships', (int)$row['id'], 'delete',
                ['member_id' => $mid, 'team_id' => $teamId, 'term' => $season], null);
        }
        return self::seasonLeadership($request, $response, $route);
    }

    /** team_id that owns a given team_season, or 0. */
    private static function teamIdForSeason(PDO $pdo, int $seasonId): int
    {
        $s = $pdo->prepare("SELECT team_id FROM team_seasons WHERE id = ?");
        $s->execute([$seasonId]);
        return (int)($s->fetchColumn() ?: 0);
    }

    public static function get(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        $teamId = (int)$route['team_id'];
        $stmt = $pdo->prepare("SELECT t.*, p.name AS program_name FROM teams t LEFT JOIN programs p ON p.id = t.program_id WHERE t.id = ?");
        $stmt->execute([$teamId]);
        $t = $stmt->fetch();
        if (!$t) return Http::error($response, 'Team not found', 404);
        if (!self::mayViewTeamProfile($pdo, $cur, $teamId)) return Http::error($response, 'You can only view teams you are a member of.', 403);
        return Http::json($response, self::serializeTeam($pdo, $t));
    }

    /**
     * Past seasons are gated by the teams.season_history permission (Admin → Role
     * Management, denied by default). Without it a member sees only the season the
     * team page resolves to — so the season switcher, and walking to a prior season
     * by URL, are governed by the same role setting.
     */
    private static function maySeeSeasonHistory(PDO $pdo, array $cur): bool
    {
        return Permissions::memberCan($pdo, $cur, 'teams.season_history', 'read');
    }

    public static function teamSeasons(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        $teamId = (int)$route["team_id"];
        if (!self::mayViewTeamProfile($pdo, $cur, $teamId)) return Http::error($response, 'You can only view teams you are a member of.', 403);
        // No history permission → only the season they'd see anyway (no switcher).
        if (!self::maySeeSeasonHistory($pdo, $cur)) {
            $row = self::currentOrLatestSeasonRow($pdo, $teamId);
            return Http::json($response, $row ? [self::serializeSeason($row)] : []);
        }
        $stmt = $pdo->prepare("SELECT * FROM team_seasons WHERE team_id = ? ORDER BY season DESC");
        $stmt->execute([$teamId]);
        return Http::json($response, array_map([self::class, 'serializeSeason'], $stmt->fetchAll()));
    }

    public static function season(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        $teamId = self::teamIdForSeason($pdo, (int)$route['season_id']);
        if (!self::mayViewTeamProfile($pdo, $cur, $teamId)) return Http::error($response, 'You can only view teams you are a member of.', 403);
        // Looking at a season OTHER than the one this team currently resolves to is
        // "season history" — gate it so the URL can't walk around the switcher.
        $active = self::currentOrLatestSeasonRow($pdo, $teamId);
        if ($active && (int)$active['id'] !== (int)$route['season_id'] && !self::maySeeSeasonHistory($pdo, $cur)) {
            return Http::error($response, "You don't have permission to view this team's past seasons.", 403);
        }
        $stmt = $pdo->prepare(
            "SELECT ts.*, t.team_number, t.rookie_season, p.name AS program_name
             FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
             LEFT JOIN programs p ON p.id = t.program_id WHERE ts.id = ?"
        );
        $stmt->execute([(int)$route['season_id']]);
        $s = $stmt->fetch();
        if (!$s) return Http::error($response, 'Team season not found', 404);
        $out = self::serializeSeason($s);
        $out['team_number']      = $s['team_number'];
        $out['program_name']     = $s['program_name'];
        $out['rookie_season']    = $s['rookie_season'];
        $out['seasons_competed'] = self::seasonsCompeted($s['rookie_season'], $s['season']);
        return Http::json($response, $out);
    }

    public static function seasonMembers(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) return Http::error($response, 'Invalid token', 401);
        $sid = (int)$route['season_id'];
        if (!self::mayViewTeamRoster($pdo, $cur, self::teamIdForSeason($pdo, $sid))) return Http::error($response, 'You can only view teams you are a member of.', 403);
        $stmt = $pdo->prepare(
            "SELECT tma.*, m.member_number, m.first_name, m.last_name, m.photo_url,
                    m.member_type, m.robotics_experience_years
             FROM team_member_assignments tma
             JOIN members m ON m.id = tma.member_id
             WHERE tma.team_season_id = ?
               AND (m.is_archived = false OR m.is_archived IS NULL)
               AND (m.is_active = true OR m.is_active IS NULL)
             ORDER BY tma.status, tma.id"
        );
        $stmt->execute([$sid]);
        // seasons_on_team per member (count assignments on the same team)
        $teamIdStmt = $pdo->prepare("SELECT team_id FROM team_seasons WHERE id = ?");
        $teamIdStmt->execute([$sid]);
        $teamId = (int)($teamIdStmt->fetch()['team_id'] ?? 0);
        $out = [];
        foreach ($stmt->fetchAll() as $a) {
            $cnt = $pdo->prepare(
                "SELECT count(*) AS c FROM team_member_assignments x
                 JOIN team_seasons xs ON xs.id = x.team_season_id
                 WHERE x.member_id = ? AND xs.team_id = ?"
            );
            $cnt->execute([(int)$a['member_id'], $teamId]);
            $out[] = [
                'id'               => (int)$a['id'],
                'team_season_id'   => (int)$a['team_season_id'],
                'member_id'        => (int)$a['member_id'],
                'member_number'    => $a['member_number'],
                'first_name'       => $a['first_name'],
                'last_name'        => $a['last_name'],
                'photo_url'        => $a['photo_url'],
                'member_type'      => $a['member_type'],
                'robotics_experience_years' => $a['robotics_experience_years'] !== null ? (int)$a['robotics_experience_years'] : null,
                'seasons_on_team'  => (int)($cnt->fetch()['c'] ?? 1),
                'date_joined'      => $a['date_joined'],
                'date_left'        => $a['date_left'],
                'status'           => $a['status'],
                'primary_role'     => $a['primary_role'],
                'secondary_role'   => $a['secondary_role'],
            ] + self::firstFlags($pdo, $a);
        }
        return Http::json($response, $out);
    }

    /**
     * FIRST-YPP compliance flags shown on the team roster, pulled read-only from the mentor's
     * own compliance record (the single source of truth) — not stored per team. Youth get nulls.
     */
    private static function firstFlags(PDO $pdo, array $a): array
    {
        if (($a['member_type'] ?? '') === 'youth') {
            return ['registered_on_first' => null, 'first_consent_release' => null,
                    'background_check' => null, 'ypt' => null, 'role_specific' => null];
        }
        $f = \App\Core\ComplianceService::memberFirstFlags($pdo, (int)$a['member_id']);
        return [
            'registered_on_first'   => $f['first'],
            'first_consent_release' => $f['consent_release'],
            'background_check'      => $f['background_check'],
            'ypt'                   => $f['ypt'],
            'role_specific'         => $f['role_specific'],
        ];
    }

    // ── Write endpoints ──────────────────────────────────────────────────

    private static function loadTeam(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT t.*, p.name AS program_name FROM teams t LEFT JOIN programs p ON p.id = t.program_id WHERE t.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $num = (string)($d['team_number'] ?? '');
        $ex = $pdo->prepare("SELECT 1 FROM teams WHERE team_number = ?"); $ex->execute([$num]);
        if ($ex->fetch()) return Http::error($res, 'Team number already exists', 400);
        $ins = $pdo->prepare("INSERT INTO teams (team_number, program_id, rookie_season) VALUES (?, ?, ?)");
        $ins->execute([$num, (int)($d['program_id'] ?? 0), $d['rookie_season'] ?? null]);
        $teamId = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO team_seasons (team_id, season, team_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', NOW(), NOW())")
            ->execute([$teamId, self::currentSeason(), "Team {$num}"]);
        Audit::write($pdo, (int)$cur['id'], 'teams', $teamId, 'create', null, ['team_number' => $num, 'program_id' => (int)($d['program_id'] ?? 0)]);
        return Http::json($res, self::serializeTeam($pdo, self::loadTeam($pdo, $teamId)), 201);
    }

    public static function memberTeams(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ((int)$cur['id'] !== $mid && !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT tma.*, ts.id AS ts_id, ts.team_name, ts.season, ts.team_id,
                            t.team_number, p.name AS program_name
                            FROM team_member_assignments tma
                            LEFT JOIN team_seasons ts ON ts.id = tma.team_season_id
                            LEFT JOIN teams t ON t.id = ts.team_id
                            LEFT JOIN programs p ON p.id = t.program_id
                            WHERE tma.member_id = ? ORDER BY tma.id DESC");
        $s->execute([$mid]);
        $out = array_map(fn($a) => [
            'assignment_id' => (int)$a['id'], 'team_season_id' => $a['ts_id'] !== null ? (int)$a['ts_id'] : null,
            'team_id' => $a['team_id'] !== null ? (int)$a['team_id'] : null, 'team_number' => $a['team_number'],
            'team_name' => $a['team_name'], 'program_name' => $a['program_name'], 'season' => $a['season'],
            'status' => $a['status'], 'primary_role' => $a['primary_role'], 'secondary_role' => $a['secondary_role'],
            'date_joined' => $a['date_joined'], 'date_left' => $a['date_left'],
        ], $s->fetchAll());
        return Http::json($res, $out);
    }

    private const SEASON_FIELDS = ['team_name', 'status', 'instagram', 'tiktok', 'youtube', 'x_account', 'website',
        'discord_links', 'robot_name', 'robot_photo_url', 'team_logo_url', 'team_photo_url'];

    public static function createSeason(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $teamId = (int)($d['team_id'] ?? 0); $season = (string)($d['season'] ?? '');
        $ex = $pdo->prepare("SELECT 1 FROM team_seasons WHERE team_id = ? AND season = ?"); $ex->execute([$teamId, $season]);
        if ($ex->fetch()) return Http::error($res, 'Season already exists for this team', 400);
        $cols = ['team_id', 'season']; $vals = [$teamId, $season];
        $cols[] = 'status'; $vals[] = $d['status'] ?? 'active';
        foreach (self::SEASON_FIELDS as $f) {
            if ($f === 'status' || !array_key_exists($f, $d)) continue;
            $cols[] = $f; $vals[] = $d[$f];
        }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO team_seasons (" . implode(',', $cols) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())");
        $ins->execute($vals);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'team_seasons', $newId, 'create', null, ['team_id' => $teamId, 'season' => $season]);
        $s = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s->execute([$newId]);
        return Http::json($res, self::serializeSeason($s->fetch()), 201);
    }

    /**
     * POST /teams/seasons/create-all  { from_season, to_season }
     * Season-transition bulk step: for every team that has a `from_season` row,
     * create its `to_season` row if one doesn't exist yet. Durable identity is
     * carried forward (team name, logo, socials/Discord, website, theme); season-
     * specific data is left blank (robot, banner, carryover) and budgets/plan/
     * resources start empty because they're keyed to the new season row.
     */
    public static function createSeasonsForAll(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $from = trim((string)($d['from_season'] ?? ''));
        $to = trim((string)($d['to_season'] ?? ''));
        if ($from === '' || $to === '') return Http::error($res, 'from_season and to_season are required', 422);
        if ($from === $to) return Http::error($res, 'from_season and to_season must differ', 422);

        // Identity fields carried forward onto the new season.
        $carry = ['team_name', 'instagram', 'tiktok', 'youtube', 'x_account', 'website',
                  'discord_links', 'team_logo_url', 'theme_preset', 'theme_font', 'theme_accent'];

        $src = $pdo->prepare("SELECT * FROM team_seasons WHERE season = ?");
        $src->execute([$from]);
        $rows = $src->fetchAll();
        $exists = $pdo->prepare("SELECT 1 FROM team_seasons WHERE team_id = ? AND season = ?");
        $ins = $pdo->prepare("INSERT INTO team_seasons (team_id, season, status, " . implode(', ', $carry) . ", created_at, updated_at)
                              VALUES (?, ?, 'active', " . implode(', ', array_fill(0, count($carry), '?')) . ", NOW(), NOW())");
        $created = 0; $skipped = 0;
        foreach ($rows as $r) {
            $exists->execute([(int)$r['team_id'], $to]);
            if ($exists->fetch()) { $skipped++; continue; }
            $vals = [(int)$r['team_id'], $to];
            foreach ($carry as $c) $vals[] = $r[$c] ?? null;
            $ins->execute($vals);
            $newId = (int)$pdo->lastInsertId();
            Audit::write($pdo, (int)$cur['id'], 'team_seasons', $newId, 'create', null,
                ['team_id' => (int)$r['team_id'], 'season' => $to, 'via' => 'season_transition_bulk']);
            $created++;
        }
        return Http::json($res, ['ok' => true, 'created' => $created, 'skipped' => $skipped,
            'message' => "Created $created new {$to} team-season(s)" . ($skipped ? ", $skipped already existed." : ".")]);
    }

    /**
     * POST /teams/seasons/roll-rosters  { from_season, to_season }
     * Season-transition step: carry each team's roster forward from {from_season}
     * into {to_season}. For every {from} team-season we find-or-create the matching
     * {to} team-season (identity carried) and copy its members — but only ACTIVE,
     * non-archived, non-alumni members (graduated seniors stay in the Hall of Fame,
     * inactive/archived members are dropped). Team roles carry forward; FIRST
     * registration + Consent & Release start unsigned so they're re-collected.
     * Idempotent: members already on the {to} roster are skipped, so it's safe to
     * re-run after adding people to some teams by hand.
     */
    public static function rollRostersForward(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $from = trim((string)($d['from_season'] ?? ''));
        $to = trim((string)($d['to_season'] ?? ''));
        if ($from === '' || $to === '') return Http::error($res, 'from_season and to_season are required', 422);
        if ($from === $to) return Http::error($res, 'from_season and to_season must differ', 422);

        $identity = ['team_name', 'instagram', 'tiktok', 'youtube', 'x_account', 'website',
                     'discord_links', 'team_logo_url', 'theme_preset', 'theme_font', 'theme_accent'];
        $fromRows = $pdo->prepare("SELECT * FROM team_seasons WHERE season = ?");
        $fromRows->execute([$from]);
        $rows = $fromRows->fetchAll();

        $findTo = $pdo->prepare("SELECT id FROM team_seasons WHERE team_id = ? AND season = ?");
        $insTo = $pdo->prepare("INSERT INTO team_seasons (team_id, season, status, " . implode(', ', $identity) . ", created_at, updated_at)
                                VALUES (?, ?, 'active', " . implode(', ', array_fill(0, count($identity), '?')) . ", NOW(), NOW())");
        $eligible = $pdo->prepare(
            "SELECT a.member_id, a.primary_role, a.secondary_role
               FROM team_member_assignments a JOIN members m ON m.id = a.member_id
              WHERE a.team_season_id = ?
                AND (m.is_archived = 0 OR m.is_archived IS NULL)
                AND (m.is_active = 1 OR m.is_active IS NULL)
                AND (m.is_alumni = 0 OR m.is_alumni IS NULL)"
        );
        $exists = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE team_season_id = ? AND member_id = ?");
        $insA = $pdo->prepare("INSERT INTO team_member_assignments (team_season_id, member_id, date_joined, primary_role, secondary_role, status, registered_on_first, first_consent_release, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, 'active', false, false, NOW(), NOW())");

        $teams = 0; $rolled = 0; $skippedExisting = 0; $seasonsCreated = 0;
        $pdo->beginTransaction();
        try {
            foreach ($rows as $fr) {
                $teamId = (int)$fr['team_id'];
                $findTo->execute([$teamId, $to]);
                $toId = (int)($findTo->fetchColumn() ?: 0);
                if (!$toId) {
                    $vals = [$teamId, $to];
                    foreach ($identity as $c) $vals[] = $fr[$c] ?? null;
                    $insTo->execute($vals);
                    $toId = (int)$pdo->lastInsertId();
                    $seasonsCreated++;
                }
                $teams++;
                $eligible->execute([(int)$fr['id']]);
                foreach ($eligible->fetchAll() as $a) {
                    $mid = (int)$a['member_id'];
                    $exists->execute([$toId, $mid]);
                    if ($exists->fetch()) { $skippedExisting++; continue; }
                    $insA->execute([$toId, $mid, date('Y-m-d'), $a['primary_role'], $a['secondary_role']]);
                    $rolled++;
                }
            }
            Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', null, 'roster.roll_forward', null,
                ['from' => $from, 'to' => $to, 'teams' => $teams, 'rolled' => $rolled, 'seasons_created' => $seasonsCreated]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, $e->getMessage(), 422);
        }

        return Http::json($res, ['ok' => true, 'teams' => $teams, 'rolled' => $rolled,
            'skipped_existing' => $skippedExisting, 'seasons_created' => $seasonsCreated,
            'message' => "Rolled $rolled member(s) forward into $to across $teams team(s)"
                . ($seasonsCreated ? " ($seasonsCreated new team-season(s) created)" : "")
                . ($skippedExisting ? "; $skippedExisting already on the new roster." : ".")]);
    }

    /**
     * POST /teams/seasons/first-reg-reset  { season }
     * Season-transition step: reset each {season} roster assignment's FIRST
     * registration + Consent & Release flags to unsigned, so the team re-collects
     * them for the new year. Prior seasons keep their own assignment rows (and
     * their flags) on file, so who was registered/consented each season is retained.
     */
    public static function resetSeasonFirstReg(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return Http::error($res, 'Access denied', 403);
        $season = trim((string)(((array)$req->getParsedBody())['season'] ?? ''));
        if ($season === '') return Http::error($res, 'season is required', 422);
        $up = $pdo->prepare(
            "UPDATE team_member_assignments SET registered_on_first = 0, first_consent_release = 0, updated_at = NOW()
              WHERE team_season_id IN (SELECT id FROM team_seasons WHERE season = ?)
                AND (registered_on_first = 1 OR first_consent_release = 1)"
        );
        $up->execute([$season]);
        $n = $up->rowCount();
        Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', null, 'first_reg_season_reset', null, ['season' => $season, 'reset' => $n]);
        return Http::json($res, ['ok' => true, 'season' => $season, 'reset' => $n,
            'message' => "Reset FIRST registration & Consent/Release for $n roster assignment(s) in $season."]);
    }

    public static function updateSeason(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['season_id'];
        $s = $pdo->prepare("SELECT 1 FROM team_seasons WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Season not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::SEASON_FIELDS as $f) if (array_key_exists($f, $d) && $d[$f] !== null) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE team_seasons SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'team_seasons', $id, 'update', null, $d);
        $s2 = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s2->execute([$id]);
        return Http::json($res, self::serializeSeason($s2->fetch()));
    }

    /** Curated theme options — must match the presets/fonts in the frontend. */
    private const THEME_PRESETS = ['classic', 'bold', 'midnight', 'forest', 'sunset', 'pink', 'purple', 'retro', 'mono'];
    private const THEME_FONTS    = ['sans', 'serif', 'rounded', 'slab', 'display'];

    /**
     * PATCH /teams/seasons/{season_id}/theme — set the team page theme.
     * Allowed for mentors/admins OR anyone granted the teams.theme permission
     * (e.g. a team captain). Values are validated against the curated lists.
     */
    public static function updateTheme(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $allowed = Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])
            || Permissions::memberCan($pdo, $cur, 'teams.theme', 'write');
        if (!$allowed) return Http::error($res, "You don't have permission to customize the team theme.", 403);
        $id = (int)$route['season_id'];
        $s = $pdo->prepare("SELECT 1 FROM team_seasons WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Season not found', 404);
        $d = (array)$req->getParsedBody();

        $preset = self::pick($d['theme_preset'] ?? null, self::THEME_PRESETS);
        $font   = self::pick($d['theme_font'] ?? null, self::THEME_FONTS);
        $accentRaw = trim((string)($d['theme_accent'] ?? ''));
        $accent = preg_match('/^#[0-9a-fA-F]{6}$/', $accentRaw) ? strtolower($accentRaw) : null;

        $pdo->prepare("UPDATE team_seasons SET theme_preset = ?, theme_font = ?, theme_accent = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$preset, $font, $accent, $id]);
        Audit::write($pdo, (int)$cur['id'], 'team_seasons', $id, 'theme',
            null, ['theme_preset' => $preset, 'theme_font' => $font, 'theme_accent' => $accent]);
        $s2 = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s2->execute([$id]);
        return Http::json($res, self::serializeSeason($s2->fetch()));
    }

    /** Return $v only if it's in the allow-list (empty/unknown → null). */
    private static function pick($v, array $allowed): ?string
    {
        $v = trim((string)($v ?? ''));
        return ($v !== '' && in_array($v, $allowed, true)) ? $v : null;
    }

    /**
     * PATCH /teams/seasons/{season_id}/photo — set (or clear) the team page banner photo.
     * Allowed for mentors/admins OR anyone granted the teams.photo permission (e.g. a
     * team leader), so a captain can keep the team page's photo current without being
     * able to edit the rest of the profile. Send team_photo_url = "" (or null) to clear it.
     */
    public static function updateTeamPhoto(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $allowed = Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])
            || Permissions::memberCan($pdo, $cur, 'teams.photo', 'write');
        if (!$allowed) return Http::error($res, "You don't have permission to change the team photo.", 403);
        $id = (int)$route['season_id'];
        $s = $pdo->prepare("SELECT 1 FROM team_seasons WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Season not found', 404);
        $d = (array)$req->getParsedBody();
        $url = trim((string)($d['team_photo_url'] ?? ''));
        $url = $url === '' ? null : mb_substr($url, 0, 1000);
        $pdo->prepare("UPDATE team_seasons SET team_photo_url = ?, updated_at = NOW() WHERE id = ?")->execute([$url, $id]);
        Audit::write($pdo, (int)$cur['id'], 'team_seasons', $id, 'photo', null, ['team_photo_url' => $url]);
        $s2 = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s2->execute([$id]);
        return Http::json($res, self::serializeSeason($s2->fetch()));
    }

    /** Mirrors _serialize_assignment: joins member, counts seasons on this team. */
    private static function serializeAssignment(PDO $pdo, int $assignmentId): ?array
    {
        $s = $pdo->prepare("SELECT tma.*, m.member_number, m.first_name, m.last_name, m.photo_url, m.member_type, m.robotics_experience_years
                            FROM team_member_assignments tma JOIN members m ON m.id = tma.member_id WHERE tma.id = ?");
        $s->execute([$assignmentId]);
        $a = $s->fetch();
        if (!$a) return null;
        $tid = $pdo->prepare("SELECT team_id FROM team_seasons WHERE id = ?"); $tid->execute([(int)$a['team_season_id']]);
        $teamId = (int)($tid->fetch()['team_id'] ?? 0);
        $cnt = $pdo->prepare("SELECT COUNT(*) AS c FROM team_member_assignments x JOIN team_seasons xs ON xs.id = x.team_season_id WHERE x.member_id = ? AND xs.team_id = ?");
        $cnt->execute([(int)$a['member_id'], $teamId]);
        return [
            'id' => (int)$a['id'], 'team_season_id' => (int)$a['team_season_id'], 'member_id' => (int)$a['member_id'],
            'member_number' => $a['member_number'], 'first_name' => $a['first_name'], 'last_name' => $a['last_name'],
            'photo_url' => $a['photo_url'], 'member_type' => $a['member_type'],
            'robotics_experience_years' => $a['robotics_experience_years'] !== null ? (int)$a['robotics_experience_years'] : null,
            'seasons_on_team' => (int)($cnt->fetch()['c'] ?? 1),
            'date_joined' => $a['date_joined'], 'date_left' => $a['date_left'], 'status' => $a['status'],
            'primary_role' => $a['primary_role'], 'secondary_role' => $a['secondary_role'],
        ] + self::firstFlags($pdo, $a);
    }

    /**
     * Enrollment statuses that mean "registered for this season" for rostering purposes.
     *
     *   pending — registered, still finishing T&C / shirt size / payment. Rosterable:
     *             families are given a grace period to pay, and mentors need to build
     *             teams during it. Payment is chased through the compliance report,
     *             not by holding a kid off the roster.
     *   paid    — completed with money (set by PaymentsController).
     *   active  — completed comped / zero-fee (set by EnrollmentController).
     *
     * 'expired' (rolled to a past season) and a missing row are still refused — those
     * mean the youth genuinely isn't signed up for this program yet.
     */
    private const ROSTERABLE_ENROLLMENT_STATUSES = ['active', 'paid', 'pending'];

    /** Youth (non-exempt) must be registered for the team's program before rostering. */
    private static function requireProgramEnrollment(PDO $pdo, int $memberId, int $teamSeasonId, Response $res): ?Response
    {
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$memberId]); $member = $ms->fetch();
        if (!$member) return Http::error($res, 'Member not found', 404);
        if ($member['member_type'] !== 'youth' || !empty($member['is_compliance_exempt'])) return null;
        $ts = $pdo->prepare("SELECT ts.season, t.program_id, p.name AS program_name FROM team_seasons ts
                             LEFT JOIN teams t ON t.id = ts.team_id LEFT JOIN programs p ON p.id = t.program_id WHERE ts.id = ?");
        $ts->execute([$teamSeasonId]); $row = $ts->fetch();
        if (!$row || $row['program_id'] === null) return null;
        $enrollYear = null;
        $parts = explode('-', (string)$row['season']);
        if (ctype_digit($parts[0] ?? '')) $enrollYear = (int)$parts[0];
        $ph = implode(',', array_fill(0, count(self::ROSTERABLE_ENROLLMENT_STATUSES), '?'));
        $sql = "SELECT 1 FROM enrollments WHERE member_id = ? AND program_id = ? AND status IN ($ph)";
        $args = array_merge([$memberId, (int)$row['program_id']], self::ROSTERABLE_ENROLLMENT_STATUSES);
        if ($enrollYear !== null) { $sql .= " AND enrollment_year = ?"; $args[] = $enrollYear; }
        $eq = $pdo->prepare($sql . " LIMIT 1"); $eq->execute($args);
        if (!$eq->fetch()) {
            $seasonTxt = $row['season'] ? " for the {$row['season']} season" : '';
            $name = "{$member['first_name']} {$member['last_name']}";
            return Http::error($res, "{$name} is not registered for {$row['program_name']}{$seasonTxt}. Add their {$row['program_name']} enrollment before assigning them to this team — it doesn't need to be paid yet.", 400);
        }
        return null;
    }

    /**
     * Move a youth's FDP fee onto this team's program when they join it. Never fatal —
     * if it can't run, requireProgramEnrollment still decides whether the roster add is
     * allowed, and the fee can be moved by hand.
     */
    private static function transferFdpFeeForTeam(PDO $pdo, int $memberId, int $teamSeasonId, int $actorId): void
    {
        try {
            $q = $pdo->prepare("SELECT ts.season, t.program_id FROM team_seasons ts
                                LEFT JOIN teams t ON t.id = ts.team_id WHERE ts.id = ?");
            $q->execute([$teamSeasonId]);
            $row = $q->fetch();
            if (!$row || $row['program_id'] === null) return;
            $parts = explode('-', (string)$row['season']);
            $year = ctype_digit($parts[0] ?? '') ? (int)$parts[0] : EnrollmentService::currentEnrollmentYear();
            FdpController::transferFeeToProgram($pdo, $memberId, (int)$row['program_id'], $year, $actorId);
        } catch (\Throwable $e) {
            error_log('[TRCMS] FDP fee transfer failed: ' . $e->getMessage());
        }
    }

    public static function addMember(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        // Roster management is now a grantable permission (teams.roster_manage), so a lead mentor
        // can add members without being an admin. Admins/System Administrators pass automatically.
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'teams.roster_manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $tsid = (int)($d['team_season_id'] ?? 0); $mid = (int)($d['member_id'] ?? 0);
        $ex = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE team_season_id = ? AND member_id = ?"); $ex->execute([$tsid, $mid]);
        if ($ex->fetch()) return Http::error($res, 'Member is already assigned to this team season', 400);
        // A youth may be holding an FDP enrollment rather than one for this team's
        // program — that's the normal path, since they start in the FDP. Move the fee
        // across BEFORE the enrollment gate runs, so the transfer is what lets them be
        // rostered instead of the gate turning them away.
        self::transferFdpFeeForTeam($pdo, $mid, $tsid, (int)$cur['id']);
        if ($err = self::requireProgramEnrollment($pdo, $mid, $tsid, $res)) return $err;
        $ins = $pdo->prepare("INSERT INTO team_member_assignments (team_season_id, member_id, date_joined, primary_role, secondary_role, status, registered_on_first, first_consent_release, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, 'active', false, false, NOW(), NOW())");
        $ins->execute([$tsid, $mid, $d['date_joined'] ?? date('Y-m-d'), $d['primary_role'] ?? null, $d['secondary_role'] ?? null]);
        $aid = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', $aid, 'create', null, ['member_id' => $mid, 'team_season_id' => $tsid, 'primary_role' => $d['primary_role'] ?? null]);
        return Http::json($res, self::serializeAssignment($pdo, $aid), 201);
    }

    public static function getMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $a = self::serializeAssignment($pdo, (int)$route['assignment_id']);
        if (!$a) return Http::error($res, 'Assignment not found', 404);
        // Security #13: your own assignment, or a roster-viewer's (teams.roster_others).
        if ((int)($a['member_id'] ?? 0) !== (int)$me['id']
            && !Permissions::memberCan($pdo, $me, 'teams.roster_others', 'read')) {
            return Http::error($res, 'Access denied', 403);
        }
        return Http::json($res, $a);
    }

    // FIRST-YPP flags (registered_on_first / first_consent_release) are no longer edited per team;
    // they're pulled from the mentor's own compliance record. Kept out of the editable field list.
    private const ASSIGN_FIELDS = ['status', 'date_left', 'primary_role', 'secondary_role'];
    private const ASSIGN_BOOL = [];

    public static function updateMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator', 'Mentor'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['assignment_id'];
        $s = $pdo->prepare("SELECT * FROM team_member_assignments WHERE id = ?"); $s->execute([$id]);
        $a = $s->fetch();
        if (!$a) return Http::error($res, 'Assignment not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = []; $old = []; $new = [];
        foreach (self::ASSIGN_FIELDS as $f) {
            if (!array_key_exists($f, $d) || $d[$f] === null) continue;
            $v = in_array($f, self::ASSIGN_BOOL, true) ? (int)(bool)$d[$f] : $d[$f];
            $set[] = "$f = ?"; $args[] = $v; $old[$f] = $a[$f] ?? null; $new[$f] = $d[$f];
        }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE team_member_assignments SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', $id, 'update', $old, $new);
        return Http::json($res, self::serializeAssignment($pdo, $id));
    }

    public static function removeMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        // Soft-remove (marks the assignment not-active). Same grantable permission as adding, so a
        // lead mentor who can build the roster can also take someone off it. Hard delete (purge)
        // stays System Administrator-only.
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'teams.roster_manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['assignment_id'];
        $s = $pdo->prepare("SELECT * FROM team_member_assignments WHERE id = ?"); $s->execute([$id]);
        $a = $s->fetch();
        if (!$a) return Http::error($res, 'Assignment not found', 404);
        $today = date('Y-m-d');
        $pdo->prepare("UPDATE team_member_assignments SET status = 'not_active', date_left = ?, updated_at = NOW() WHERE id = ?")->execute([$today, $id]);
        Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', $id, 'remove', null,
            ['status' => 'not_active', 'date_left' => $today, 'member_id' => (int)$a['member_id'], 'team_season_id' => (int)$a['team_season_id']]);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * DELETE /teams/members/{assignment_id}/purge — System-Administrator-only hard
     * removal: permanently delete a member's roster assignment for one season so they
     * disappear from the roster entirely (unlike the soft remove, which leaves a
     * 'not_active' row). Only this one season's assignment is removed; other seasons
     * and the member record are untouched. The action is audited.
     */
    public static function purgeMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['System Administrator'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['assignment_id'];
        $s = $pdo->prepare("SELECT * FROM team_member_assignments WHERE id = ?"); $s->execute([$id]);
        $a = $s->fetch();
        if (!$a) return Http::error($res, 'Assignment not found', 404);
        $pdo->prepare("DELETE FROM team_member_assignments WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'team_member_assignments', $id, 'delete', $a,
            ['member_id' => (int)$a['member_id'], 'team_season_id' => (int)$a['team_season_id'], 'permanent' => true]);
        return Http::json($res, ['ok' => true]);
    }
}
