<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\StrategyEvidence;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Season Strategy — Goals (Phase 1). Team-scoped, measurable season goals with an
 * owner, a metric/target, a progress log, and an auto-derived at-risk flag.
 * Follows PlanningController conventions: PDO, JSON in/out, permission-gated,
 * Audit::write on every create/update/delete. Portfolio/Readiness are later phases.
 */
final class SeasonGoalsController
{
    private const CATEGORIES = ['robot', 'outreach', 'portfolio', 'team', 'fundraising', 'competition', 'skills', 'other'];
    private const METRIC_TYPES = ['count', 'currency', 'percent', 'hours', 'milestone'];
    private const METRIC_SOURCES = ['manual', 'impact_hours', 'budget', 'outreach_events', 'task_progress', 'certifications'];
    private const PRIORITIES = ['low', 'med', 'high'];
    private const STATUSES = ['draft', 'active', 'at_risk', 'achieved', 'missed', 'archived'];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function teamOr404(PDO $pdo, int $tsid): ?array
    {
        $s = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s->execute([$tsid]);
        return $s->fetch() ?: null;
    }

    /** Team-seasons this member is rostered on — the teams they're "associated with". */
    private static function memberTeamIds(PDO $pdo, ?array $m): array
    {
        if (!$m) return [];
        $s = $pdo->prepare("SELECT DISTINCT team_season_id FROM team_member_assignments WHERE member_id = ?");
        $s->execute([(int)$m['id']]);
        return array_map('intval', array_column($s->fetchAll(), 'team_season_id'));
    }

    /** May this member reach goals for teams they're NOT on? (Mentors/admins via goals.view_others.) */
    private static function seesAllTeams(PDO $pdo, ?array $m): bool
    {
        return self::perm($pdo, $m, 'goals.view_others', 'read');
    }

    /**
     * May this member view/act on this team's goals? True for staff who see all teams,
     * or for a member rostered on the team. Keeps a youth scoped to their own team(s).
     */
    private static function mayAccessTeam(PDO $pdo, ?array $m, int $tsid): bool
    {
        return self::seesAllTeams($pdo, $m) || in_array($tsid, self::memberTeamIds($pdo, $m), true);
    }

    /** The team_season_id a goal belongs to, or null if the goal is gone. */
    private static function goalTeamId(PDO $pdo, int $goalId): ?int
    {
        $s = $pdo->prepare("SELECT team_season_id FROM season_goals WHERE id = ?");
        $s->execute([$goalId]); $r = $s->fetchColumn();
        return $r === false ? null : (int)$r;
    }

    private static function memberBrief(PDO $pdo, ?int $id): ?array
    {
        if ($id === null) return null;
        $s = $pdo->prepare("SELECT id, first_name, last_name, member_type, photo_url FROM members WHERE id = ?");
        $s->execute([$id]); $m = $s->fetch();
        if (!$m) return null;
        return ['member_id' => (int)$m['id'], 'name' => trim($m['first_name'] . ' ' . $m['last_name']),
            'member_type' => $m['member_type'], 'photo_url' => $m['photo_url']];
    }

    /** Percent toward target (0–100), or milestone/status-based when there is no numeric target. */
    private static function progressPct(array $g): int
    {
        $target = $g['target_value'] !== null ? (float)$g['target_value'] : null;
        $cur = (float)($g['current_value'] ?? 0);
        if ($g['metric_type'] === 'milestone' || $target === null || $target <= 0) {
            if ($g['status'] === 'achieved') return 100;
            return $target && $target > 0 ? (int)min(100, round($cur / $target * 100)) : 0;
        }
        return (int)max(0, min(100, round($cur / $target * 100)));
    }

    /** Fraction of the goal's window that has elapsed (0–100), or null if no dated window. */
    private static function elapsedPct(array $g, string $today): ?int
    {
        if (empty($g['start_date']) || empty($g['due_date'])) return null;
        $start = strtotime((string)$g['start_date']); $due = strtotime((string)$g['due_date']); $now = strtotime($today);
        if ($due <= $start) return null;
        return (int)max(0, min(100, round(($now - $start) / ($due - $start) * 100)));
    }

    /**
     * Auto-derive at-risk (FR-G6): an active goal is at risk when it's past due and
     * unfinished, or when progress lags the elapsed time (mirrors the Season Plan
     * overdue idea — behind where it should be by now).
     */
    private static function atRisk(array $g, int $pct, ?int $elapsed, string $today): bool
    {
        if (in_array($g['status'], ['achieved', 'missed', 'archived', 'draft'], true)) return false;
        if ($pct >= 100) return false;
        if (!empty($g['due_date']) && strtotime((string)$g['due_date']) < strtotime($today)) return true; // overdue
        if ($elapsed !== null && $pct < $elapsed) return true;                                             // behind pace
        return false;
    }

    private static function serialize(PDO $pdo, array $g): array
    {
        $today = date('Y-m-d');
        $pct = self::progressPct($g);
        $elapsed = self::elapsedPct($g, $today);
        $atRisk = self::atRisk($g, $pct, $elapsed, $today);
        $cnt = $pdo->prepare("SELECT COUNT(*) FROM season_goal_updates WHERE goal_id = ?"); $cnt->execute([(int)$g['id']]);
        return [
            'id' => (int)$g['id'], 'team_season_id' => (int)$g['team_season_id'], 'season' => $g['season'],
            'title' => $g['title'], 'description' => $g['description'], 'category' => $g['category'],
            'owner' => self::memberBrief($pdo, $g['owner_member_id'] !== null ? (int)$g['owner_member_id'] : null),
            'owner_member_id' => $g['owner_member_id'] !== null ? (int)$g['owner_member_id'] : null,
            'metric_type' => $g['metric_type'],
            'target_value' => $g['target_value'] !== null ? (float)$g['target_value'] : null,
            'current_value' => (float)($g['current_value'] ?? 0), 'unit' => $g['unit'],
            'metric_source' => $g['metric_source'],
            'start_date' => $g['start_date'], 'due_date' => $g['due_date'],
            'priority' => $g['priority'], 'status' => $g['status'],
            'linked_deadline_id' => $g['linked_deadline_id'] !== null ? (int)$g['linked_deadline_id'] : null,
            'progress_pct' => $pct, 'elapsed_pct' => $elapsed, 'at_risk' => $atRisk,
            'update_count' => (int)$cnt->fetchColumn(),
            'created_at' => Time::naiveIso($g['created_at'] ?? null), 'updated_at' => Time::naiveIso($g['updated_at'] ?? null),
        ];
    }

    private static function loadGoal(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM season_goals WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function enum($v, array $allowed, string $default): string
    {
        return in_array($v, $allowed, true) ? (string)$v : $default;
    }

    // ── Team goals ────────────────────────────────────────────────────────────

    /** GET /strategy/team/{team_season_id}/goals — the team's goals + mission. */
    public static function listGoals(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $ts = self::teamOr404($pdo, $tsid);
        if (!$ts) return Http::error($res, 'Team season not found', 404);
        if (!self::mayAccessTeam($pdo, $m, $tsid)) return Http::error($res, 'You can only view your own team\'s goals.', 403);
        $s = $pdo->prepare("SELECT * FROM season_goals WHERE team_season_id = ? AND status <> 'archived' ORDER BY FIELD(priority,'high','med','low'), due_date IS NULL, due_date, id");
        $s->execute([$tsid]);
        $goals = array_map(fn($g) => self::serialize($pdo, $g), $s->fetchAll());
        return Http::json($res, [
            'team_season_id' => $tsid, 'mission' => $ts['mission'] ?? null,
            'can_manage' => self::perm($pdo, $m, 'goals.manage', 'write'),
            'goals' => $goals,
        ]);
    }

    /** PUT /strategy/team/{team_season_id}/mission — set the one-sentence team mission. */
    public static function setMission(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        if (!self::teamOr404($pdo, $tsid)) return Http::error($res, 'Team season not found', 404);
        if (!self::mayAccessTeam($pdo, $m, $tsid)) return Http::error($res, 'You can only manage your own team\'s goals.', 403);
        $d = (array)$req->getParsedBody();
        $mission = array_key_exists('mission', $d) ? (trim((string)$d['mission']) ?: null) : null;
        $pdo->prepare("UPDATE team_seasons SET mission = ? WHERE id = ?")->execute([$mission, $tsid]);
        Audit::write($pdo, (int)$m['id'], 'team_seasons', $tsid, 'strategy.set_mission', null, ['len' => strlen((string)$mission)]);
        return Http::json($res, ['ok' => true, 'mission' => $mission]);
    }

    /** POST /strategy/team/{team_season_id}/goals — create a goal. */
    public static function createGoal(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $ts = self::teamOr404($pdo, $tsid);
        if (!$ts) return Http::error($res, 'Team season not found', 404);
        if (!self::mayAccessTeam($pdo, $m, $tsid)) return Http::error($res, 'You can only manage your own team\'s goals.', 403);
        $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? ''));
        if ($title === '') return Http::error($res, 'A goal title is required.', 422);
        $pdo->prepare(
            "INSERT INTO season_goals
                (team_season_id, season, title, description, category, owner_member_id, metric_type,
                 target_value, current_value, unit, metric_source, start_date, due_date, priority, status,
                 linked_deadline_id, created_by_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())"
        )->execute([
            $tsid, $ts['season'] ?? null, $title, ($d['description'] ?? null) ?: null,
            self::enum($d['category'] ?? null, self::CATEGORIES, 'other'),
            !empty($d['owner_member_id']) ? (int)$d['owner_member_id'] : null,
            self::enum($d['metric_type'] ?? null, self::METRIC_TYPES, 'count'),
            isset($d['target_value']) && $d['target_value'] !== '' ? (float)$d['target_value'] : null,
            isset($d['current_value']) && $d['current_value'] !== '' ? (float)$d['current_value'] : 0,
            ($d['unit'] ?? null) ?: null,
            self::enum($d['metric_source'] ?? null, self::METRIC_SOURCES, 'manual'),
            ($d['start_date'] ?? null) ?: null, ($d['due_date'] ?? null) ?: null,
            self::enum($d['priority'] ?? null, self::PRIORITIES, 'med'),
            self::enum($d['status'] ?? null, self::STATUSES, 'active'),
            !empty($d['linked_deadline_id']) ? (int)$d['linked_deadline_id'] : null,
            (int)$m['id'],
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'season_goals', $id, 'create', null, ['title' => $title, 'team_season_id' => $tsid]);
        return Http::json($res, self::serialize($pdo, self::loadGoal($pdo, $id)), 201);
    }

    /** PATCH /strategy/goals/{goal_id} — edit a goal. */
    public static function updateGoal(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['goal_id'];
        if (!self::loadGoal($pdo, $id)) return Http::error($res, 'Goal not found', 404);
        if (!self::mayAccessTeam($pdo, $m, (int)self::goalTeamId($pdo, $id))) return Http::error($res, 'You can only manage your own team\'s goals.', 403);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        $str = function (string $col, $val) use (&$set, &$args) { $set[] = "$col = ?"; $args[] = ($val !== '' ? $val : null); };
        if (array_key_exists('title', $d) && trim((string)$d['title']) !== '') { $set[] = 'title = ?'; $args[] = trim((string)$d['title']); }
        if (array_key_exists('description', $d)) $str('description', $d['description']);
        if (array_key_exists('category', $d)) { $set[] = 'category = ?'; $args[] = self::enum($d['category'], self::CATEGORIES, 'other'); }
        if (array_key_exists('owner_member_id', $d)) { $set[] = 'owner_member_id = ?'; $args[] = !empty($d['owner_member_id']) ? (int)$d['owner_member_id'] : null; }
        if (array_key_exists('metric_type', $d)) { $set[] = 'metric_type = ?'; $args[] = self::enum($d['metric_type'], self::METRIC_TYPES, 'count'); }
        if (array_key_exists('target_value', $d)) { $set[] = 'target_value = ?'; $args[] = ($d['target_value'] !== '' && $d['target_value'] !== null) ? (float)$d['target_value'] : null; }
        if (array_key_exists('current_value', $d)) { $set[] = 'current_value = ?'; $args[] = (float)($d['current_value'] ?: 0); }
        if (array_key_exists('unit', $d)) $str('unit', $d['unit']);
        if (array_key_exists('metric_source', $d)) { $set[] = 'metric_source = ?'; $args[] = self::enum($d['metric_source'], self::METRIC_SOURCES, 'manual'); }
        if (array_key_exists('start_date', $d)) $str('start_date', $d['start_date']);
        if (array_key_exists('due_date', $d)) $str('due_date', $d['due_date']);
        if (array_key_exists('priority', $d)) { $set[] = 'priority = ?'; $args[] = self::enum($d['priority'], self::PRIORITIES, 'med'); }
        if (array_key_exists('status', $d)) { $set[] = 'status = ?'; $args[] = self::enum($d['status'], self::STATUSES, 'active'); }
        if (array_key_exists('linked_deadline_id', $d)) { $set[] = 'linked_deadline_id = ?'; $args[] = !empty($d['linked_deadline_id']) ? (int)$d['linked_deadline_id'] : null; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE season_goals SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'season_goals', $id, 'update', null, array_keys($d));
        return Http::json($res, self::serialize($pdo, self::loadGoal($pdo, $id)));
    }

    /** DELETE /strategy/goals/{goal_id} */
    public static function deleteGoal(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['goal_id'];
        if (!self::loadGoal($pdo, $id)) return Http::error($res, 'Goal not found', 404);
        if (!self::mayAccessTeam($pdo, $m, (int)self::goalTeamId($pdo, $id))) return Http::error($res, 'You can only manage your own team\'s goals.', 403);
        $pdo->prepare("DELETE FROM season_goal_updates WHERE goal_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM season_goals WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'season_goals', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Progress updates ──────────────────────────────────────────────────────

    /** GET /strategy/goals/{goal_id}/updates — the progress log. */
    public static function listUpdates(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.view', 'read')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['goal_id'];
        if (!self::mayAccessTeam($pdo, $m, (int)self::goalTeamId($pdo, $id))) return Http::error($res, 'You can only view your own team\'s goals.', 403);
        $s = $pdo->prepare("SELECT * FROM season_goal_updates WHERE goal_id = ? ORDER BY logged_at DESC, id DESC");
        $s->execute([$id]);
        return Http::json($res, array_map(fn($u) => [
            'id' => (int)$u['id'], 'goal_id' => (int)$u['goal_id'],
            'member' => self::memberBrief($pdo, $u['member_id'] !== null ? (int)$u['member_id'] : null),
            'value' => $u['value'] !== null ? (float)$u['value'] : null,
            'note' => $u['note'], 'logged_at' => Time::naiveIso($u['logged_at'] ?? null),
            'evidence' => StrategyEvidence::serialize($pdo, $u['evidence_id'] !== null ? (int)$u['evidence_id'] : null),
        ], $s->fetchAll()));
    }

    /** GET /strategy/goals/{goal_id}/evidence — the judging-ready evidence trail (FR-E2). */
    public static function evidenceTrail(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.view', 'read')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['goal_id'];
        if (!self::mayAccessTeam($pdo, $m, (int)self::goalTeamId($pdo, $id))) return Http::error($res, 'You can only view your own team\'s goals.', 403);
        $s = $pdo->prepare("SELECT u.logged_at, u.note, e.* FROM season_goal_updates u
                            JOIN strategy_evidence e ON e.id = u.evidence_id
                            WHERE u.goal_id = ? ORDER BY u.logged_at DESC, u.id DESC");
        $s->execute([$id]);
        return Http::json($res, array_map(fn($e) => [
            'id' => (int)$e['id'], 'source_type' => $e['source_type'], 'external_url' => $e['external_url'],
            'label' => $e['label'], 'note' => $e['note'], 'logged_at' => Time::naiveIso($e['logged_at'] ?? null),
        ], $s->fetchAll()));
    }

    /**
     * POST /strategy/goals/{goal_id}/updates — log a progress update. If `value` is
     * given it becomes the goal's current_value (manual metric). Optionally sets status.
     */
    public static function logProgress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['goal_id'];
        $goal = self::loadGoal($pdo, $id);
        if (!$goal) return Http::error($res, 'Goal not found', 404);
        if (!self::mayAccessTeam($pdo, $m, (int)$goal['team_season_id'])) return Http::error($res, 'You can only manage your own team\'s goals.', 403);
        $d = (array)$req->getParsedBody();
        $value = (isset($d['value']) && $d['value'] !== '' && $d['value'] !== null) ? (float)$d['value'] : null;
        $note = isset($d['note']) ? (trim((string)$d['note']) ?: null) : null;
        $evidenceId = StrategyEvidence::create($pdo, is_array($d['evidence'] ?? null) ? $d['evidence'] : null, (int)$m['id']);
        if ($value === null && $note === null && $evidenceId === null) return Http::error($res, 'Enter a value, a note, or evidence.', 422);
        $pdo->prepare("INSERT INTO season_goal_updates (goal_id, member_id, value, note, evidence_id, logged_at) VALUES (?,?,?,?,?,NOW())")
            ->execute([$id, (int)$m['id'], $value, $note, $evidenceId]);
        // Manual metric: the logged value is the new current_value.
        if ($value !== null && $goal['metric_source'] === 'manual') {
            $pdo->prepare("UPDATE season_goals SET current_value = ?, updated_at = NOW() WHERE id = ?")->execute([$value, $id]);
        }
        if (!empty($d['status'])) {
            $pdo->prepare("UPDATE season_goals SET status = ?, updated_at = NOW() WHERE id = ?")
                ->execute([self::enum($d['status'], self::STATUSES, $goal['status']), $id]);
        }
        Audit::write($pdo, (int)$m['id'], 'season_goals', $id, 'strategy.goal_progress', null, ['value' => $value]);
        return Http::json($res, self::serialize($pdo, self::loadGoal($pdo, $id)), 201);
    }

    /** DELETE /strategy/goal-updates/{update_id} */
    public static function deleteProgress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $uid = (int)$route['update_id'];
        $s = $pdo->prepare("SELECT goal_id FROM season_goal_updates WHERE id = ?"); $s->execute([$uid]);
        $u = $s->fetch();
        if (!$u) return Http::error($res, 'Update not found', 404);
        if (!self::mayAccessTeam($pdo, $m, (int)self::goalTeamId($pdo, (int)$u['goal_id']))) return Http::error($res, 'You can only manage your own team\'s goals.', 403);
        $pdo->prepare("DELETE FROM season_goal_updates WHERE id = ?")->execute([$uid]);
        Audit::write($pdo, (int)$m['id'], 'season_goal_updates', $uid, 'delete', null, ['goal_id' => (int)$u['goal_id']]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Cross-team overview (/goals page) ─────────────────────────────────────

    /** GET /strategy/goals — every current-season team's goals, grouped by team. */
    public static function overview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = "g.status <> 'archived'"; $args = [];
        if (!empty($q['season'])) { $where .= " AND ts.season = ?"; $args[] = (string)$q['season']; }
        if (!empty($q['category'])) { $where .= " AND g.category = ?"; $args[] = (string)$q['category']; }
        if (!empty($q['team_season_id'])) { $where .= " AND g.team_season_id = ?"; $args[] = (int)$q['team_season_id']; }
        // A member who can't see all teams only sees goals for teams they're on.
        if (!self::seesAllTeams($pdo, $m)) {
            $ids = self::memberTeamIds($pdo, $m);
            if (!$ids) return Http::json($res, ['teams' => []]);
            $where .= " AND g.team_season_id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")";
            $args = array_merge($args, $ids);
        }
        $s = $pdo->prepare(
            "SELECT g.*, ts.season AS ts_season, ts.team_name, t.team_number
             FROM season_goals g
             JOIN team_seasons ts ON ts.id = g.team_season_id
             LEFT JOIN teams t ON t.id = ts.team_id
             WHERE $where ORDER BY ts.team_name, FIELD(g.priority,'high','med','low'), g.due_date IS NULL, g.due_date, g.id"
        );
        $s->execute($args);
        $teams = [];
        foreach ($s->fetchAll() as $g) {
            $tsid = (int)$g['team_season_id'];
            if (!isset($teams[$tsid])) {
                $label = trim(($g['team_number'] ? '#' . $g['team_number'] . ' ' : '') . ($g['team_name'] ?? '')) ?: 'Team';
                $teams[$tsid] = ['team_season_id' => $tsid, 'team_label' => $label, 'season' => $g['ts_season'], 'goals' => []];
            }
            $teams[$tsid]['goals'][] = self::serialize($pdo, $g);
        }
        return Http::json($res, ['teams' => array_values($teams)]);
    }

    /** GET /strategy/team/{team_season_id}/goals.csv — a per-team goals status export (FR-X3). */
    public static function goalsCsv(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'goals.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        if (!self::teamOr404($pdo, $tsid)) return Http::error($res, 'Team season not found', 404);
        if (!self::mayAccessTeam($pdo, $m, $tsid)) return Http::error($res, 'You can only view your own team\'s goals.', 403);
        $s = $pdo->prepare("SELECT * FROM season_goals WHERE team_season_id = ? AND status <> 'archived' ORDER BY FIELD(priority,'high','med','low'), due_date IS NULL, due_date, id");
        $s->execute([$tsid]);
        $field = fn($v) => preg_match('/[",\r\n]/', (string)$v) ? '"' . str_replace('"', '""', (string)$v) . '"' : (string)$v;
        $csv = implode(',', ['Goal', 'Category', 'Status', 'Priority', 'Owner', 'Metric', 'Current', 'Target', 'Unit', 'Progress %', 'Due', 'At risk']) . "\r\n";
        foreach ($s->fetchAll() as $g) {
            $ser = self::serialize($pdo, $g);
            $csv .= implode(',', array_map($field, [
                $g['title'], $g['category'], $g['status'], $g['priority'], $ser['owner']['name'] ?? '',
                $g['metric_type'], $ser['current_value'], $ser['target_value'] ?? '', $g['unit'] ?? '',
                $ser['progress_pct'], $g['due_date'] ?? '', $ser['at_risk'] ? 'Yes' : 'No',
            ])) . "\r\n";
        }
        $res->getBody()->write($csv);
        return $res->withHeader('Content-Type', 'text/csv')->withHeader('Content-Disposition', 'attachment; filename=team-goals.csv');
    }
}
