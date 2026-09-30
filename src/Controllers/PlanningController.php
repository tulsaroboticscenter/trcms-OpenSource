<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/planning/router.py (prefix /api/v1/planning). */
final class PlanningController
{
    private const ACTIVITY_STATUSES = ['not_started', 'in_progress', 'blocked', 'done'];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return $y . '-' . ($y + 1);
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

    private static function teamOr404(PDO $pdo, int $tsid): ?array
    {
        $s = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s->execute([$tsid]);
        return $s->fetch() ?: null;
    }

    // ── activity serialization ───────────────────────────────────────────
    private static function serializeActivity(PDO $pdo, array $a): array
    {
        $deps = $pdo->prepare("SELECT sa.id, sa.name, sa.status FROM season_activity_dependencies d
                               JOIN season_activities sa ON sa.id = d.depends_on_id WHERE d.activity_id = ?");
        $deps->execute([(int)$a['id']]);
        $blockedBy = array_map(fn($d) => ['id' => (int)$d['id'], 'name' => $d['name'], 'status' => $d['status']], $deps->fetchAll());
        $asg = $pdo->prepare("SELECT member_id FROM season_activity_assignees WHERE activity_id = ? ORDER BY id");
        $asg->execute([(int)$a['id']]);
        $assignees = [];
        foreach ($asg->fetchAll() as $r) { $b = self::memberBrief($pdo, (int)$r['member_id']); if ($b) $assignees[] = $b; }
        return [
            'id' => (int)$a['id'], 'category_id' => (int)$a['category_id'], 'team_season_id' => (int)$a['team_season_id'],
            'name' => $a['name'], 'description' => $a['description'], 'target_date' => $a['target_date'],
            'start_date' => $a['start_date'] ?? null,
            'duration_days' => isset($a['duration_days']) && $a['duration_days'] !== null ? (int)$a['duration_days'] : null,
            'percent_complete' => (int)($a['percent_complete'] ?? 0),
            'status' => $a['status'], 'lead' => self::memberBrief($pdo, $a['lead_member_id'] !== null ? (int)$a['lead_member_id'] : null),
            'assigned_role_id' => $a['assigned_role_id'] !== null ? (int)$a['assigned_role_id'] : null,
            'assigned_role_name' => (function () use ($pdo, $a) {
                if (empty($a['assigned_role_id'])) return null;
                $s = $pdo->prepare("SELECT name FROM team_roles WHERE id = ?"); $s->execute([(int)$a['assigned_role_id']]);
                return $s->fetchColumn() ?: null;
            })(),
            'assignees' => $assignees, 'blocked_by' => $blockedBy,
            'is_blocked' => (bool)count(array_filter($blockedBy, fn($b) => $b['status'] !== 'done')),
            'estimated_minutes' => $a['estimated_minutes'] !== null ? (int)$a['estimated_minutes'] : null,
            'actual_minutes' => (int)($a['actual_minutes'] ?? 0),
            'completed_at' => Time::naiveIso($a['completed_at']), 'sort_order' => (int)($a['sort_order'] ?? 0),
        ];
    }

    /** Brief {team_season_id, team_name, team_number} for a team-season, or null. */
    private static function teamBrief(PDO $pdo, ?int $tsid): ?array
    {
        if ($tsid === null) return null;
        $s = $pdo->prepare("SELECT ts.id, ts.team_name, t.team_number FROM team_seasons ts
                            LEFT JOIN teams t ON t.id = ts.team_id WHERE ts.id = ?");
        $s->execute([$tsid]); $r = $s->fetch();
        if (!$r) return null;
        return ['team_season_id' => (int)$r['id'],
            'team_name' => $r['team_name'] ?: ($r['team_number'] !== null ? 'Team ' . $r['team_number'] : 'Team'),
            'team_number' => $r['team_number']];
    }

    /** Ordered rotation teams for a recurring task. */
    private static function rotationTeams(PDO $pdo, int $taskId): array
    {
        $s = $pdo->prepare("SELECT team_season_id FROM team_task_rotation WHERE task_id = ? ORDER BY position, id");
        $s->execute([$taskId]);
        $out = [];
        foreach ($s->fetchAll() as $r) { $b = self::teamBrief($pdo, (int)$r['team_season_id']); if ($b) $out[] = $b; }
        return $out;
    }

    private static function serializeTask(PDO $pdo, array $t, ?array $actor = null): array
    {
        $linkedName = null;
        if ($t['linked_activity_id']) {
            $s = $pdo->prepare("SELECT name FROM season_activities WHERE id = ?"); $s->execute([(int)$t['linked_activity_id']]);
            $r = $s->fetch(); $linkedName = $r ? $r['name'] : null;
        }
        $recurrence = $t['recurrence'] ?? 'none';
        return [
            'id' => (int)$t['id'], 'team_season_id' => $t['team_season_id'] !== null ? (int)$t['team_season_id'] : null,
            'title' => $t['title'], 'description' => $t['description'], 'category' => $t['category'], 'status' => $t['status'],
            'linked_activity_id' => $t['linked_activity_id'] !== null ? (int)$t['linked_activity_id'] : null,
            'linked_activity_name' => $linkedName,
            'assigned_team' => self::teamBrief($pdo, isset($t['assigned_team_season_id']) && $t['assigned_team_season_id'] !== null ? (int)$t['assigned_team_season_id'] : null),
            'is_private' => (bool)($t['is_private'] ?? false),
            'assigned_member' => self::memberBrief($pdo, isset($t['assigned_member_id']) && $t['assigned_member_id'] !== null ? (int)$t['assigned_member_id'] : null),
            'recurrence' => $recurrence,
            'due_date' => $t['due_date'] ?? null,
            'rotation' => $recurrence !== 'none' ? self::rotationTeams($pdo, (int)$t['id']) : [],
            'rotation_index' => (int)($t['rotation_index'] ?? 0),
            'created_by' => self::memberBrief($pdo, $t['created_by_member_id'] !== null ? (int)$t['created_by_member_id'] : null),
            'claimed_by' => self::memberBrief($pdo, $t['claimed_by_member_id'] !== null ? (int)$t['claimed_by_member_id'] : null),
            'completed_by' => self::memberBrief($pdo, $t['completed_by_member_id'] !== null ? (int)$t['completed_by_member_id'] : null),
            'completed_by_team' => self::teamBrief($pdo, isset($t['completed_by_team_season_id']) && $t['completed_by_team_season_id'] !== null ? (int)$t['completed_by_team_season_id'] : null),
            'actual_minutes' => (int)($t['actual_minutes'] ?? 0),
            'progress_pct' => isset($t['progress_pct']) && $t['progress_pct'] !== null ? (int)$t['progress_pct'] : null,
            'progress_updates' => self::taskUpdates($pdo, (int)$t['id']),
            'can_post_progress' => $actor ? self::canUpdateProgress($pdo, $actor, $t) : null,
            'created_at' => Time::naiveIso($t['created_at']), 'claimed_at' => Time::naiveIso($t['claimed_at']),
            'completed_at' => Time::naiveIso($t['completed_at']),
        ];
    }

    /** Progress-update thread for a task, newest first. */
    private static function taskUpdates(PDO $pdo, int $taskId): array
    {
        $s = $pdo->prepare("SELECT * FROM team_task_updates WHERE task_id = ? ORDER BY id DESC");
        $s->execute([$taskId]);
        return array_map(fn($u) => [
            'id' => (int)$u['id'],
            'body' => $u['body'],
            'progress_pct' => $u['progress_pct'] !== null ? (int)$u['progress_pct'] : null,
            'member_id' => $u['member_id'] !== null ? (int)$u['member_id'] : null,
            'member' => self::memberBrief($pdo, $u['member_id'] !== null ? (int)$u['member_id'] : null),
            'created_at' => Time::naiveIso($u['created_at']),
        ], $s->fetchAll());
    }

    private const RECURRENCES = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];

    /** Next due date given the current one (or today) and a recurrence. */
    private static function nextDue(?string $from, string $recurrence): ?string
    {
        if ($recurrence === 'none') return $from;
        $d = new \DateTime($from ?: date('Y-m-d'));
        $d->modify(['daily' => '+1 day', 'weekly' => '+1 week', 'biweekly' => '+2 weeks', 'monthly' => '+1 month'][$recurrence]);
        return $d->format('Y-m-d');
    }

    /**
     * Persist a task's rotation team list (ordered) and set its current
     * responsible team to the team at rotation_index. Returns the current
     * assigned_team_season_id (or null when the list is empty).
     */
    private static function saveRotation(PDO $pdo, int $taskId, array $teamSeasonIds, int $index = 0): ?int
    {
        $pdo->prepare("DELETE FROM team_task_rotation WHERE task_id = ?")->execute([$taskId]);
        $ids = array_values(array_unique(array_map('intval', $teamSeasonIds)));
        $ins = $pdo->prepare("INSERT INTO team_task_rotation (task_id, team_season_id, position) VALUES (?, ?, ?)");
        foreach ($ids as $pos => $tsid) { if ($tsid > 0) $ins->execute([$taskId, $tsid, $pos]); }
        if (!$ids) return null;
        $index = (($index % count($ids)) + count($ids)) % count($ids);
        return $ids[$index];
    }

    private static function loadActivity(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM season_activities WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function loadTask(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM team_tasks WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function activeMemberIds(PDO $pdo, int $tsid): array
    {
        $s = $pdo->prepare("SELECT member_id FROM team_member_assignments WHERE team_season_id = ? AND status = 'active'");
        $s->execute([$tsid]);
        return array_map('intval', array_column($s->fetchAll(), 'member_id'));
    }

    private static function trcMembers(PDO $pdo): array
    {
        return $pdo->query("SELECT id, first_name, last_name, member_type, photo_url FROM members
                            WHERE is_active = true AND member_type IN ('youth','mentor')
                            AND (is_archived = false OR is_archived IS NULL)
                            AND (is_kiosk = false OR is_kiosk IS NULL)
                            AND (is_system = false OR is_system IS NULL)")->fetchAll();
    }

    // ── Pickers ──────────────────────────────────────────────────────────
    public static function planningTeams(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->prepare("SELECT ts.id, ts.team_name, t.team_number, p.name AS program,
                               COALESCE(p.display_order, 999) AS prog_order, COALESCE(p.name, 'ZZ') AS prog_name
                               FROM team_seasons ts LEFT JOIN teams t ON t.id = ts.team_id
                               LEFT JOIN programs p ON p.id = t.program_id
                               WHERE ts.season = ? AND ts.status = 'active'");
        $rows->execute([self::currentSeason()]);
        $list = $rows->fetchAll();
        usort($list, fn($a, $b) => [(int)$a['prog_order'], $a['prog_name'], (string)$a['team_number']] <=> [(int)$b['prog_order'], $b['prog_name'], (string)$b['team_number']]);
        return Http::json($res, array_map(fn($ts) => [
            'team_season_id' => (int)$ts['id'], 'team_number' => $ts['team_number'],
            'team_name' => $ts['team_name'] ?: ($ts['team_number'] !== null ? 'Team ' . $ts['team_number'] : 'Team'),
            'program' => $ts['program'],
        ], $list));
    }

    public static function teamMembers(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.view', 'read')) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT mem.id FROM team_member_assignments tma JOIN members mem ON mem.id = tma.member_id
                            WHERE tma.team_season_id = ? AND tma.status = 'active' AND (mem.is_archived = false OR mem.is_archived IS NULL)");
        $s->execute([(int)$route['team_season_id']]);
        $out = [];
        foreach ($s->fetchAll() as $r) { $b = self::memberBrief($pdo, (int)$r['id']); if ($b) $out[] = $b; }
        usort($out, fn($a, $b) => [$a['member_type'] !== 'mentor', $a['name'] ?? ''] <=> [$b['member_type'] !== 'mentor', $b['name'] ?? '']);
        return Http::json($res, $out);
    }

    // ── Season Plan ──────────────────────────────────────────────────────
    public static function getPlan(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        if (!self::teamOr404($pdo, $tsid)) return Http::error($res, 'Team season not found', 404);
        $cs = $pdo->prepare("SELECT * FROM season_categories WHERE team_season_id = ? ORDER BY sort_order, id");
        $cs->execute([$tsid]);
        $out = [];
        foreach ($cs->fetchAll() as $c) {
            $as = $pdo->prepare("SELECT * FROM season_activities WHERE category_id = ? ORDER BY sort_order, id");
            $as->execute([(int)$c['id']]);
            $acts = array_map(fn($a) => self::serializeActivity($pdo, $a), $as->fetchAll());
            // #122: category completion is the average of its activities' percent_complete
            // (equal weight — each activity is an equal share of the category). 100%
            // requires every activity at 100%. An empty category reads as 0%.
            $catPct = $acts ? (int)round(array_sum(array_map(fn($a) => $a['percent_complete'], $acts)) / count($acts)) : 0;
            $out[] = ['id' => (int)$c['id'], 'name' => $c['name'], 'color' => $c['color'],
                'sort_order' => (int)($c['sort_order'] ?? 0),
                'percent_complete' => $catPct,
                'activities' => $acts];
        }
        return Http::json($res, $out);
    }

    public static function createCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        if (!self::teamOr404($pdo, $tsid)) return Http::error($res, 'Team season not found', 404);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO season_categories (team_season_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, NOW())");
        $ins->execute([$tsid, trim((string)($d['name'] ?? '')), $d['color'] ?? null, (int)($d['sort_order'] ?? 0)]);
        $cs = $pdo->prepare("SELECT * FROM season_categories WHERE id = ?"); $cs->execute([(int)$pdo->lastInsertId()]); $c = $cs->fetch();
        Audit::write($pdo, (int)$actor['id'], 'season_categories', (int)$c['id'], 'create', null, ['name' => $c['name']]);
        return Http::json($res, ['id' => (int)$c['id'], 'name' => $c['name'], 'color' => $c['color'],
            'sort_order' => (int)$c['sort_order'], 'activities' => []], 201);
    }

    public static function updateCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT * FROM season_categories WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Category not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (!empty($d['name'])) { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('color', $d)) { $set[] = 'color = ?'; $args[] = ($d['color'] ?? null) ?: null; }
        if (array_key_exists('sort_order', $d) && $d['sort_order'] !== null) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE season_categories SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$actor['id'], 'season_categories', $id, 'update', null, $d);
        $s2 = $pdo->prepare("SELECT * FROM season_categories WHERE id = ?"); $s2->execute([$id]); $c = $s2->fetch();
        return Http::json($res, ['id' => (int)$c['id'], 'name' => $c['name'], 'color' => $c['color'], 'sort_order' => (int)$c['sort_order']]);
    }

    public static function deleteCategory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['category_id'];
        $s = $pdo->prepare("SELECT 1 FROM season_categories WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Category not found', 404);
        $pdo->prepare("DELETE FROM season_categories WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$actor['id'], 'season_categories', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Team deadlines (#125) ─────────────────────────────────────────────────

    /** GET /planning/team/{tsid}/deadlines — team deadlines with linked-event info. */
    public static function listDeadlines(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $tsid = (int)$route['team_season_id'];
        $st = $pdo->prepare(
            "SELECT d.*, e.name AS event_name, e.event_date
             FROM season_deadlines d LEFT JOIN events e ON e.id = d.event_id
             WHERE d.team_season_id = ? ORDER BY d.deadline_date, d.name"
        );
        $st->execute([$tsid]);
        return Http::json($res, array_map(fn($d) => [
            'id' => (int)$d['id'], 'name' => $d['name'], 'deadline_date' => $d['deadline_date'],
            'event_id' => $d['event_id'] !== null ? (int)$d['event_id'] : null,
            'event_name' => $d['event_name'], 'notes' => $d['notes'],
        ], $st->fetchAll()));
    }

    public static function createDeadline(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $d = (array)$req->getParsedBody();
        $eventId = !empty($d['event_id']) ? (int)$d['event_id'] : null;
        $name = trim((string)($d['name'] ?? ''));
        $date = $d['deadline_date'] ?? null;
        // If linked to an event, default the name/date from it.
        if ($eventId) {
            $ev = $pdo->prepare("SELECT name, event_date FROM events WHERE id = ?"); $ev->execute([$eventId]);
            if ($e = $ev->fetch()) { if ($name === '') $name = $e['name']; if (!$date) $date = $e['event_date']; }
        }
        if ($name === '' || !$date) return Http::error($res, 'A name and date (or a linked event) are required.', 422);
        $pdo->prepare("INSERT INTO season_deadlines (team_season_id, name, deadline_date, event_id, notes, created_by_id, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,NOW(),NOW())")
            ->execute([$tsid, $name, $date, $eventId, $d['notes'] ?? null, (int)$actor['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$actor['id'], 'season_deadlines', $id, 'create', null, ['name' => $name]);
        return self::listDeadlines($req, $res, $route);
    }

    public static function deleteDeadline(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM season_deadlines WHERE id = ?")->execute([(int)$route['deadline_id']]);
        Audit::write($pdo, (int)$actor['id'], 'season_deadlines', (int)$route['deadline_id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /**
     * Dependency-aware reschedule (#124). Walk the plan in dependency order and
     * push each activity FORWARD when (a) a blocker now finishes later, or (b) the
     * activity itself is overdue (not done, target in the past). Durations are
     * preserved; nothing is ever pulled earlier. With ?preview=1 the proposed
     * changes are returned without saving. POST /planning/team/{tsid}/reschedule
     */
    public static function reschedule(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $preview = !empty(($req->getQueryParams()['preview'] ?? ''));

        $rows = $pdo->prepare("SELECT id, name, start_date, target_date, duration_days, status FROM season_activities WHERE team_season_id = ?");
        $rows->execute([$tsid]);
        $acts = [];
        foreach ($rows->fetchAll() as $r) $acts[(int)$r['id']] = $r;
        if (!$acts) return Http::json($res, ['changes' => [], 'applied' => false]);

        // Dependency edges: activity depends_on blocker.
        $deps = [];
        $ds = $pdo->prepare("SELECT d.activity_id, d.depends_on_id FROM season_activity_dependencies d
                             JOIN season_activities a ON a.id = d.activity_id WHERE a.team_season_id = ?");
        $ds->execute([$tsid]);
        foreach ($ds->fetchAll() as $e) $deps[(int)$e['activity_id']][] = (int)$e['depends_on_id'];

        $today = strtotime(date('Y-m-d') . ' 00:00:00');
        $day = 86400;
        $ts = fn($d) => $d ? strtotime($d . ' 00:00:00') : null;

        // Topological order (blockers before dependents); skip cycles gracefully.
        $order = []; $state = [];
        $visit = function ($id) use (&$visit, &$order, &$state, $deps, $acts) {
            if (($state[$id] ?? 0) === 2) return;
            if (($state[$id] ?? 0) === 1) return; // cycle — break
            $state[$id] = 1;
            foreach ($deps[$id] ?? [] as $b) if (isset($acts[$b])) $visit($b);
            $state[$id] = 2; $order[] = $id;
        };
        foreach (array_keys($acts) as $id) $visit($id);

        // Working copy of dates (timestamps), computed as we go.
        $curStart = []; $curTarget = []; $dur = [];
        foreach ($acts as $id => $a) {
            $s = $ts($a['start_date']); $t = $ts($a['target_date']);
            $d = $a['duration_days'] !== null ? (int)$a['duration_days'] : (($s !== null && $t !== null) ? (int)round(($t - $s) / $day) : null);
            $curStart[$id] = $s; $curTarget[$id] = $t; $dur[$id] = $d;
        }

        $changes = [];
        foreach ($order as $id) {
            $a = $acts[$id];
            $s = $curStart[$id]; $t = $curTarget[$id]; $d = $dur[$id];
            if ($s === null && $t === null) continue;               // unscheduled — nothing to move
            if ($d === null) $d = ($s !== null && $t !== null) ? (int)round(($t - $s) / $day) : 0;

            // Latest finish among blockers (using their possibly-updated targets;
            // an unfinished blocker overdue today still blocks until at least today).
            $blockFinish = null;
            foreach ($deps[$id] ?? [] as $b) {
                if (!isset($acts[$b])) continue;
                $bt = $curTarget[$b] ?? $ts($acts[$b]['target_date']);
                if ($bt === null) continue;
                if (($acts[$b]['status'] ?? '') !== 'done' && $bt < $today) $bt = $today;
                $blockFinish = max($blockFinish ?? $bt, $bt);
            }

            $newStart = $s ?? ($t !== null ? $t - $d * $day : null);
            if ($blockFinish !== null) {
                $cand = $blockFinish + $day;                        // start the day after the blocker is due
                if ($newStart === null || $cand > $newStart) $newStart = $cand;
            }
            $newTarget = $newStart !== null ? $newStart + $d * $day : $t;
            // Self overdue: an unfinished activity must end no earlier than today.
            if (($a['status'] ?? '') !== 'done' && $newTarget !== null && $newTarget < $today) {
                $newTarget = $today; $newStart = $today - $d * $day;
            }

            // Forward-only: apply solely if it moves later.
            $moved = ($newStart !== null && $s !== null && $newStart > $s) || ($newTarget !== null && $t !== null && $newTarget > $t)
                  || ($s === null && $newStart !== null) ;
            if ($moved) {
                $curStart[$id] = $newStart; $curTarget[$id] = $newTarget; $dur[$id] = $d;
                $changes[] = [
                    'id' => $id, 'name' => $a['name'],
                    'from_start' => $a['start_date'], 'to_start' => $newStart !== null ? date('Y-m-d', $newStart) : null,
                    'from_target' => $a['target_date'], 'to_target' => $newTarget !== null ? date('Y-m-d', $newTarget) : null,
                ];
            }
        }

        if (!$preview && $changes) {
            $upd = $pdo->prepare("UPDATE season_activities SET start_date = ?, target_date = ?, duration_days = ?, updated_at = NOW() WHERE id = ?");
            foreach ($changes as $c) {
                $upd->execute([$c['to_start'], $c['to_target'], $dur[$c['id']], $c['id']]);
            }
            Audit::write($pdo, (int)$actor['id'], 'season_activities', $tsid, 'reschedule', null, ['count' => count($changes)]);
        }
        return Http::json($res, ['changes' => $changes, 'applied' => (!$preview && (bool)$changes)]);
    }

    /**
     * Reconcile the (start_date, target_date, duration_days) trio so any two
     * determine the third. Dates win when both are set (duration is derived).
     * duration_days = whole days between start and target.
     */
    private static function reconcileSchedule(?string $start, ?string $target, ?int $dur): array
    {
        $day = 86400;
        $ts = $start ? strtotime($start . ' 00:00:00') : null;
        $tt = $target ? strtotime($target . ' 00:00:00') : null;
        if ($ts !== null && $tt !== null) {
            $dur = (int)round(($tt - $ts) / $day);
        } elseif ($ts !== null && $dur !== null) {
            $tt = $ts + $dur * $day; $target = date('Y-m-d', $tt);
        } elseif ($tt !== null && $dur !== null) {
            $ts = $tt - $dur * $day; $start = date('Y-m-d', $ts);
        }
        return [$start, $target, $dur];
    }

    private static function applyActivityFields(PDO $pdo, int $aid, array $d, Response $res): ?Response
    {
        $set = []; $args = [];
        if (array_key_exists('name', $d) && $d['name'] !== null) { $set[] = 'name = ?'; $args[] = trim((string)$d['name']); }
        if (array_key_exists('description', $d) && $d['description'] !== null) { $set[] = 'description = ?'; $args[] = $d['description'] ?: null; }

        // Schedule trio (#121): start_date, target_date (the "Target Due Date"), and
        // duration_days are kept consistent — given any two, the third is derived.
        // duration_days = DATEDIFF(target_date, start_date).
        $hasStart = array_key_exists('start_date', $d);
        $hasTarget = array_key_exists('target_date', $d);
        $hasDur = array_key_exists('duration_days', $d);
        if ($hasStart || $hasTarget || $hasDur) {
            $cur = $pdo->prepare("SELECT start_date, target_date, duration_days FROM season_activities WHERE id = ?");
            $cur->execute([$aid]); $cr = $cur->fetch() ?: [];
            $norm = fn($v) => ($v === '' || $v === null) ? null : $v;
            $start  = $hasStart  ? $norm($d['start_date'])  : ($cr['start_date'] ?? null);
            $target = $hasTarget ? $norm($d['target_date']) : ($cr['target_date'] ?? null);
            $dur    = $hasDur    ? ($norm($d['duration_days']) === null ? null : (int)$d['duration_days']) : (isset($cr['duration_days']) ? (int)$cr['duration_days'] : null);
            // If exactly two of the three were explicitly provided, that pair wins —
            // derive the third from it even if the DB held a stale value for it.
            $provided = ($hasStart ? 1 : 0) + ($hasTarget ? 1 : 0) + ($hasDur ? 1 : 0);
            if ($provided === 2) {
                if (!$hasTarget) { $target = null; }
                elseif (!$hasStart) { $start = null; }
                elseif (!$hasDur) { $dur = null; }
            }
            [$start, $target, $dur] = self::reconcileSchedule($start, $target, $dur);
            $set[] = 'start_date = ?';    $args[] = $start;
            $set[] = 'target_date = ?';   $args[] = $target;
            $set[] = 'duration_days = ?'; $args[] = $dur;
        }
        if (array_key_exists('percent_complete', $d) && $d['percent_complete'] !== null) {
            $set[] = 'percent_complete = ?'; $args[] = max(0, min(100, (int)$d['percent_complete']));
        }
        if (array_key_exists('status', $d) && $d['status'] !== null) {
            if (!in_array($d['status'], self::ACTIVITY_STATUSES, true)) return Http::error($res, 'status must be one of ' . json_encode(self::ACTIVITY_STATUSES), 400);
            $set[] = 'status = ?'; $args[] = $d['status'];
            $set[] = $d['status'] === 'done' ? 'completed_at = NOW()' : 'completed_at = NULL';
            // Keep progress in sync at the extremes unless the client also sent one.
            if (!array_key_exists('percent_complete', $d)) {
                if ($d['status'] === 'done') { $set[] = 'percent_complete = 100'; }
                elseif ($d['status'] === 'not_started') { $set[] = 'percent_complete = 0'; }
            }
        }
        if (array_key_exists('lead_member_id', $d) && $d['lead_member_id'] !== null) { $set[] = 'lead_member_id = ?'; $args[] = $d['lead_member_id'] ? (int)$d['lead_member_id'] : null; }
        if (array_key_exists('assigned_role_id', $d)) { $set[] = 'assigned_role_id = ?'; $args[] = $d['assigned_role_id'] ? (int)$d['assigned_role_id'] : null; }
        if (array_key_exists('estimated_minutes', $d) && $d['estimated_minutes'] !== null) { $set[] = 'estimated_minutes = ?'; $args[] = (int)$d['estimated_minutes']; }
        if (array_key_exists('sort_order', $d) && $d['sort_order'] !== null) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $aid; $pdo->prepare("UPDATE season_activities SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        if (array_key_exists('assignee_ids', $d) && $d['assignee_ids'] !== null) {
            $pdo->prepare("DELETE FROM season_activity_assignees WHERE activity_id = ?")->execute([$aid]);
            foreach (array_unique(array_map('intval', $d['assignee_ids'])) as $mid) {
                $pdo->prepare("INSERT INTO season_activity_assignees (activity_id, member_id) VALUES (?, ?)")->execute([$aid, $mid]);
            }
        }
        if (array_key_exists('depends_on_ids', $d) && $d['depends_on_ids'] !== null) {
            $pdo->prepare("DELETE FROM season_activity_dependencies WHERE activity_id = ?")->execute([$aid]);
            foreach (array_unique(array_map('intval', $d['depends_on_ids'])) as $did) {
                if ($did && $did !== $aid) $pdo->prepare("INSERT INTO season_activity_dependencies (activity_id, depends_on_id) VALUES (?, ?)")->execute([$aid, $did]);
            }
        }
        return null;
    }

    public static function createActivity(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $cid = (int)$route['category_id'];
        $cs = $pdo->prepare("SELECT * FROM season_categories WHERE id = ?"); $cs->execute([$cid]);
        $cat = $cs->fetch();
        if (!$cat) return Http::error($res, 'Category not found', 404);
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['name'] ?? '')) ?: 'Untitled';
        $ins = $pdo->prepare("INSERT INTO season_activities (category_id, team_season_id, name, status, actual_minutes, sort_order, created_at, updated_at)
                              VALUES (?, ?, ?, 'not_started', 0, 0, NOW(), NOW())");
        $ins->execute([$cid, (int)$cat['team_season_id'], $name]);
        $aid = (int)$pdo->lastInsertId();
        if ($err = self::applyActivityFields($pdo, $aid, $d, $res)) return $err;
        $a = self::loadActivity($pdo, $aid);
        Audit::write($pdo, (int)$actor['id'], 'season_activities', $aid, 'create', null, ['name' => $a['name']]);
        return Http::json($res, self::serializeActivity($pdo, $a), 201);
    }

    public static function updateActivity(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $aid = (int)$route['activity_id'];
        if (!self::loadActivity($pdo, $aid)) return Http::error($res, 'Activity not found', 404);
        $d = (array)$req->getParsedBody();
        if ($err = self::applyActivityFields($pdo, $aid, $d, $res)) return $err;
        return Http::json($res, self::serializeActivity($pdo, self::loadActivity($pdo, $aid)));
    }

    public static function deleteActivity(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $aid = (int)$route['activity_id'];
        if (!self::loadActivity($pdo, $aid)) return Http::error($res, 'Activity not found', 404);
        $pdo->prepare("DELETE FROM season_activity_dependencies WHERE depends_on_id = ?")->execute([$aid]);
        $pdo->prepare("DELETE FROM season_activities WHERE id = ?")->execute([$aid]);
        Audit::write($pdo, (int)$actor['id'], 'season_activities', $aid, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Task board ───────────────────────────────────────────────────────
    private static function listTasksWhere(PDO $pdo, string $where, array $args, bool $includeDone, ?array $actor = null): array
    {
        if (!$includeDone) $where .= " AND status != 'done'";
        $s = $pdo->prepare("SELECT * FROM team_tasks WHERE $where ORDER BY status, created_at DESC");
        $s->execute($args);
        return array_map(fn($t) => self::serializeTask($pdo, $t, $actor), $s->fetchAll());
    }

    /**
     * Whether the viewer may see this team-season's task board. If they're rostered
     * on the team, planning.view is enough; for any OTHER team it also requires the
     * planning.tasks_others permission (Admin → Role Management). The Youth Member
     * role is seeded to deny it, so youth see only TRC tasks + their own team's —
     * fully configurable per role.
     */
    private static function mayViewTeamTasks(PDO $pdo, ?array $m, int $tsid): bool
    {
        if (!$m) return false;
        $s = $pdo->prepare(
            "SELECT 1 FROM team_member_assignments tma
               JOIN team_seasons ts2 ON ts2.id = tma.team_season_id
              WHERE ts2.team_id = (SELECT team_id FROM team_seasons WHERE id = ?)
                AND tma.member_id = ? LIMIT 1");
        $s->execute([$tsid, (int)$m['id']]);
        $isOwn = (bool)$s->fetchColumn();
        return $isOwn || Permissions::memberCan($pdo, $m, 'planning.tasks_others', 'read');
    }

    public static function listTasks(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.view', 'read')) return Http::error($res, 'Access denied', 403);
        $includeDone = filter_var($req->getQueryParams()['include_done'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $tsid = (int)$route['team_season_id'];
        // Youth may only see their own team's tasks (TRC tasks stay open to all).
        if (!self::mayViewTeamTasks($pdo, $m, $tsid)) return Http::error($res, 'You can only view your own team\'s tasks.', 403);
        // A team's board shows tasks created for that team plus general tasks a
        // team has picked up or that its recurring rotation currently lands on.
        return Http::json($res, self::listTasksWhere($pdo, "is_private = 0 AND (team_season_id = ? OR assigned_team_season_id = ?)", [$tsid, $tsid], $includeDone, $m));
    }

    private static function createTaskRow(PDO $pdo, ?int $tsid, array $d, array $actor): array
    {
        $creator = !empty($d['created_by_member_id']) ? (int)$d['created_by_member_id'] : (!empty($actor['is_kiosk']) ? null : (int)$actor['id']);
        $ins = $pdo->prepare("INSERT INTO team_tasks (team_season_id, title, description, status, category, linked_activity_id, created_by_member_id, actual_minutes, created_at)
                              VALUES (?, ?, ?, 'open', ?, ?, ?, 0, NOW())");
        $ins->execute([$tsid, trim((string)$d['title']), ($d['description'] ?? null) ?: null, ($d['category'] ?? null) ?: null,
            isset($d['linked_activity_id']) ? (int)$d['linked_activity_id'] : null, $creator]);
        $id = (int)$pdo->lastInsertId();
        self::applyTaskConfig($pdo, $id, $d);
        return self::loadTask($pdo, $id);
    }

    /**
     * Apply #112 team assignment and #114 recurrence/rotation from a payload to
     * an existing task. A task with a responsible team (directly assigned or the
     * current team in a rotation) sits in 'claimed' status for that team until
     * an individual claims or it is completed; without one it stays 'open'.
     */
    private static function applyTaskConfig(PDO $pdo, int $id, array $d): void
    {
        $t = self::loadTask($pdo, $id);
        if (!$t) return;
        $assigned = isset($t['assigned_team_season_id']) && $t['assigned_team_season_id'] !== null ? (int)$t['assigned_team_season_id'] : null;
        $recurrence = $t['recurrence'] ?? 'none';
        $due = $t['due_date'] ?? null;
        $rotationIndex = (int)($t['rotation_index'] ?? 0);
        $touched = false;

        if (array_key_exists('recurrence', $d)) {
            $recurrence = in_array($d['recurrence'], self::RECURRENCES, true) ? (string)$d['recurrence'] : 'none';
            $touched = true;
            if ($recurrence === 'none') {
                $due = null; $rotationIndex = 0; self::saveRotation($pdo, $id, []);
            } else {
                $due = !empty($d['due_date']) ? (string)$d['due_date'] : ($due ?: date('Y-m-d'));
                if (array_key_exists('rotation_team_ids', $d)) {
                    $rotationIndex = 0;
                    $assigned = self::saveRotation($pdo, $id, (array)$d['rotation_team_ids'], 0);
                }
            }
        }
        if (array_key_exists('assigned_team_season_id', $d)) {
            $assigned = ($d['assigned_team_season_id'] === '' || $d['assigned_team_season_id'] === null) ? null : (int)$d['assigned_team_season_id'];
            $touched = true;
        }
        if (!$touched) return;
        $status = $t['status'];
        if ($status !== 'done') $status = $assigned !== null ? 'claimed' : 'open';
        $pdo->prepare("UPDATE team_tasks SET assigned_team_season_id = ?, recurrence = ?, due_date = ?, rotation_index = ?, status = ? WHERE id = ?")
            ->execute([$assigned, $recurrence, $due, $rotationIndex, $status, $id]);
    }

    public static function createTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        if (!self::teamOr404($pdo, $tsid)) return Http::error($res, 'Team season not found', 404);
        $d = (array)$req->getParsedBody();
        if (trim((string)($d['title'] ?? '')) === '') return Http::error($res, 'Task title is required.', 400);
        return Http::json($res, self::serializeTask($pdo, self::createTaskRow($pdo, $tsid, $d, $actor)), 201);
    }

    public static function trcMembersList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.view', 'read')) return Http::error($res, 'Access denied', 403);
        $out = array_map(fn($r) => ['member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'member_type' => $r['member_type'], 'photo_url' => $r['photo_url']], self::trcMembers($pdo));
        usort($out, fn($a, $b) => [$a['member_type'] !== 'mentor', $a['name'] ?? ''] <=> [$b['member_type'] !== 'mentor', $b['name'] ?? '']);
        return Http::json($res, $out);
    }

    public static function listTrcTasks(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.view', 'read')) return Http::error($res, 'Access denied', 403);
        $includeDone = filter_var($req->getQueryParams()['include_done'] ?? false, FILTER_VALIDATE_BOOLEAN);
        return Http::json($res, self::listTasksWhere($pdo, "team_season_id IS NULL AND is_private = 0", [], $includeDone, $m));
    }

    public static function createTrcTask(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (trim((string)($d['title'] ?? '')) === '') return Http::error($res, 'Task title is required.', 400);

        // A private task is directed at one member and stays off the shared boards —
        // only that member (on their Dashboard) and managers can see it.
        if (!empty($d['is_private'])) {
            $mid = (int)($d['assigned_member_id'] ?? 0);
            $ids = array_map(fn($r) => (int)$r['id'], self::trcMembers($pdo));
            if (!in_array($mid, $ids, true)) return Http::error($res, 'Choose an active TRC member to assign this task to.', 400);
            $task = self::createTaskRow($pdo, null, $d, $actor);
            $due = !empty($d['due_date']) ? substr((string)$d['due_date'], 0, 10) : null;
            $pdo->prepare("UPDATE team_tasks SET is_private = 1, assigned_member_id = ?, due_date = ? WHERE id = ?")
                ->execute([$mid, $due, (int)$task['id']]);
            $task = self::loadTask($pdo, (int)$task['id']);
            Audit::write($pdo, (int)$actor['id'], 'team_tasks', (int)$task['id'], 'task.assign_private', null, ['assigned_member_id' => $mid]);
            self::notifyTaskAssignee($pdo, $task, $mid);
            return Http::json($res, self::serializeTask($pdo, $task), 201);
        }

        return Http::json($res, self::serializeTask($pdo, self::createTaskRow($pdo, null, $d, $actor)), 201);
    }

    /** Email a member that a private task was assigned to them. Best-effort. */
    private static function notifyTaskAssignee(PDO $pdo, array $task, int $memberId): void
    {
        if (!Mailer::enabled()) return;
        $s = $pdo->prepare("SELECT first_name, email FROM members WHERE id = ?");
        $s->execute([$memberId]);
        $m = $s->fetch();
        if (!$m || empty($m['email'])) return;
        $title = htmlspecialchars((string)$task['title'], ENT_QUOTES);
        $due = !empty($task['due_date']) ? ' It\'s due <strong>' . htmlspecialchars((string)$task['due_date'], ENT_QUOTES) . '</strong>.' : '';
        $name = htmlspecialchars((string)($m['first_name'] ?? ''), ENT_QUOTES);
        $html = "<p>Hi {$name},</p><p>A task has been assigned to you at the Tulsa Robotics Center: <strong>{$title}</strong>.{$due}</p>"
            . "<p>You can see it — and mark it done — under <strong>My Tasks</strong> on your TRCMS dashboard.</p>";
        try { Mailer::send((string)$m['email'], 'A task was assigned to you', $html); } catch (\Throwable $e) { /* best-effort */ }
    }

    /** GET /planning/my-tasks — the current member's private (personal) tasks. */
    public static function listMyTasks(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $includeDone = filter_var($req->getQueryParams()['include_done'] ?? false, FILTER_VALIDATE_BOOLEAN);
        return Http::json($res, self::listTasksWhere($pdo, "is_private = 1 AND assigned_member_id = ?", [(int)$m['id']], $includeDone, $m));
    }

    /** GET /planning/private-tasks — every private task, for managers to track (task-write). */
    public static function listPrivateTasks(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        $includeDone = filter_var($req->getQueryParams()['include_done'] ?? false, FILTER_VALIDATE_BOOLEAN);
        return Http::json($res, self::listTasksWhere($pdo, "is_private = 1", [], $includeDone, $m));
    }

    public static function editTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['task_id'];
        $task = self::loadTask($pdo, $id);
        if (!$task) return Http::error($res, 'Task not found', 404);
        // The task's author can always edit their own task; otherwise the general
        // task-write (or planning manage) permission is required.
        $isAuthor = $task['created_by_member_id'] !== null && (int)$task['created_by_member_id'] === (int)$actor['id'];
        if (!$isAuthor && !self::perm($pdo, $actor, 'planning.tasks', 'write') && !self::perm($pdo, $actor, 'planning.manage', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('title', $d) && $d['title'] !== null && trim((string)$d['title']) !== '') { $set[] = 'title = ?'; $args[] = trim((string)$d['title']); }
        if (array_key_exists('description', $d) && $d['description'] !== null) { $set[] = 'description = ?'; $args[] = $d['description'] ?: null; }
        if (array_key_exists('category', $d) && $d['category'] !== null) { $set[] = 'category = ?'; $args[] = $d['category'] ?: null; }
        if (array_key_exists('linked_activity_id', $d) && $d['linked_activity_id'] !== null) { $set[] = 'linked_activity_id = ?'; $args[] = $d['linked_activity_id'] ? (int)$d['linked_activity_id'] : null; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE team_tasks SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        self::applyTaskConfig($pdo, $id, $d);
        Audit::write($pdo, (int)$actor['id'], 'team_tasks', $id, 'update', null, $d);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id)));
    }

    /**
     * Anyone doing the work: the author, whoever claimed it, any member of the
     * team the task is assigned to, or a task writer / planning manager.
     */
    private static function canUpdateProgress(PDO $pdo, array $actor, array $task): bool
    {
        $aid = (int)$actor['id'];
        if (($task['created_by_member_id'] !== null && (int)$task['created_by_member_id'] === $aid)
            || ($task['claimed_by_member_id'] !== null && (int)$task['claimed_by_member_id'] === $aid)
            || (isset($task['assigned_member_id']) && $task['assigned_member_id'] !== null && (int)$task['assigned_member_id'] === $aid)) {
            return true;
        }
        // A task assigned to a team can be updated by any active member of that team.
        if (isset($task['assigned_team_season_id']) && $task['assigned_team_season_id'] !== null
            && in_array($aid, self::activeMemberIds($pdo, (int)$task['assigned_team_season_id']), true)) {
            return true;
        }
        return self::perm($pdo, $actor, 'planning.tasks', 'write') || self::perm($pdo, $actor, 'planning.manage', 'write');
    }

    /** POST /planning/tasks/{task_id}/progress — post a progress update and/or set percent complete. */
    public static function addProgress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['task_id'];
        $task = self::loadTask($pdo, $id);
        if (!$task) return Http::error($res, 'Task not found', 404);
        if (!self::canUpdateProgress($pdo, $actor, $task)) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $body = trim((string)($d['body'] ?? ''));
        $pct = null;
        if (array_key_exists('progress_pct', $d) && $d['progress_pct'] !== null && $d['progress_pct'] !== '') {
            $pct = max(0, min(100, (int)$d['progress_pct']));
        }
        if ($body === '' && $pct === null) return Http::error($res, 'Add a note or set a percent complete.', 422);

        $pdo->prepare("INSERT INTO team_task_updates (task_id, member_id, body, progress_pct, created_at) VALUES (?, ?, ?, ?, NOW())")
            ->execute([$id, (int)$actor['id'], $body ?: null, $pct]);
        if ($pct !== null) {
            $pdo->prepare("UPDATE team_tasks SET progress_pct = ? WHERE id = ?")->execute([$pct, $id]);
        }
        Audit::write($pdo, (int)$actor['id'], 'team_tasks', $id, 'task.progress', null, $pct !== null ? ['progress_pct' => $pct] : null);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id), $actor));
    }

    /** DELETE /planning/tasks/progress/{update_id} — remove a progress update (its author or a manager). */
    public static function deleteProgress(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        $uid = (int)$route['update_id'];
        $s = $pdo->prepare("SELECT * FROM team_task_updates WHERE id = ?"); $s->execute([$uid]);
        $u = $s->fetch();
        if (!$u) return Http::error($res, 'Update not found', 404);
        $isAuthor = $u['member_id'] !== null && (int)$u['member_id'] === (int)$actor['id'];
        if (!$isAuthor && !self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM team_task_updates WHERE id = ?")->execute([$uid]);
        Audit::write($pdo, (int)$actor['id'], 'team_task_updates', $uid, 'progress.delete', null, ['task_id' => (int)$u['task_id']]);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, (int)$u['task_id']), $actor));
    }

    /** #112 — a whole team picks up (or is assigned) a task. Pass null to clear. */
    public static function assignTeamTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['task_id'];
        $t = self::loadTask($pdo, $id);
        if (!$t) return Http::error($res, 'Task not found', 404);
        if ($t['status'] === 'done') return Http::error($res, 'That task is already completed.', 400);
        $d = (array)$req->getParsedBody();
        $tsid = ($d['team_season_id'] ?? '') === '' ? null : (int)$d['team_season_id'];
        if ($tsid !== null && !self::teamOr404($pdo, $tsid)) return Http::error($res, 'Team season not found', 404);
        self::applyTaskConfig($pdo, $id, ['assigned_team_season_id' => $tsid]);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id)));
    }

    private static function validateTeamMember(PDO $pdo, array $task, int $memberId, Response $res): ?Response
    {
        // Validate against the task's own team, else the team that picked it up.
        $teamTsid = $task['team_season_id'] !== null ? (int)$task['team_season_id']
            : (isset($task['assigned_team_season_id']) && $task['assigned_team_season_id'] !== null ? (int)$task['assigned_team_season_id'] : null);
        if ($teamTsid === null) {
            $ids = array_map(fn($r) => (int)$r['id'], self::trcMembers($pdo));
            if (!in_array($memberId, $ids, true)) return Http::error($res, "That member isn't an active TRC member.", 400);
            return null;
        }
        if (!in_array($memberId, self::activeMemberIds($pdo, $teamTsid), true)) {
            return Http::error($res, "That member isn't an active member of this team.", 400);
        }
        return null;
    }

    public static function claimTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['task_id'];
        $t = self::loadTask($pdo, $id);
        if (!$t) return Http::error($res, 'Task not found', 404);
        if ($t['status'] === 'done') return Http::error($res, 'That task is already completed.', 400);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        if ($err = self::validateTeamMember($pdo, $t, $mid, $res)) return $err;
        $pdo->prepare("UPDATE team_tasks SET claimed_by_member_id = ?, status = 'claimed', claimed_at = NOW() WHERE id = ?")->execute([$mid, $id]);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id)));
    }

    public static function completeTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['task_id'];
        $t = self::loadTask($pdo, $id);
        if (!$t) return Http::error($res, 'Task not found', 404);
        // A private task's own assignee can complete it; otherwise task-write is required.
        $isPrivateAssignee = !empty($t['is_private']) && $t['assigned_member_id'] !== null && (int)$t['assigned_member_id'] === (int)$actor['id'];
        if (!$isPrivateAssignee && !self::perm($pdo, $actor, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        // A task can be completed by a whole team or by an individual. A team
        // wins if given; otherwise fall back to the assignee (private) or claimer.
        $teamId = ($d['team_season_id'] ?? '') === '' ? null : (int)$d['team_season_id'];
        if ($teamId !== null && !self::teamOr404($pdo, $teamId)) return Http::error($res, 'Team season not found', 404);
        if (!empty($t['is_private'])) {
            $completer = $t['assigned_member_id'] !== null ? (int)$t['assigned_member_id'] : null;
            $teamId = null;
        } else {
            $completer = ($teamId !== null)
                ? null
                : (isset($d['member_id']) && $d['member_id'] !== '' ? (int)$d['member_id'] : ($t['claimed_by_member_id'] !== null ? (int)$t['claimed_by_member_id'] : null));
            if ($completer) { if ($err = self::validateTeamMember($pdo, $t, $completer, $res)) return $err; }
        }

        Audit::write($pdo, (int)$actor['id'], 'team_tasks', $id, 'complete', null, ['team_season_id' => $teamId, 'member_id' => $completer]);
        $recurrence = $t['recurrence'] ?? 'none';
        if ($recurrence !== 'none') {
            // #114 — a recurring chore rolls forward instead of finishing:
            // advance the due date, hand off to the next team in the rotation,
            // and reopen it (unclaimed) for that team. Record who last did it.
            $rotation = array_map(fn($r) => $r['team_season_id'], self::rotationTeams($pdo, $id));
            $count = count($rotation);
            $nextAssigned = $t['assigned_team_season_id'] !== null ? (int)$t['assigned_team_season_id'] : null;
            $nextIndex = (int)($t['rotation_index'] ?? 0);
            if ($count > 0) {
                $nextIndex = ($nextIndex + 1) % $count;
                $nextAssigned = $rotation[$nextIndex];
            }
            $nextDue = self::nextDue($t['due_date'] ?? null, $recurrence);
            $status = $nextAssigned !== null ? 'claimed' : 'open';
            $pdo->prepare("UPDATE team_tasks SET status = ?, assigned_team_season_id = ?, rotation_index = ?, due_date = ?,
                           claimed_by_member_id = NULL, claimed_at = NULL, completed_by_member_id = NULL, completed_at = NULL WHERE id = ?")
                ->execute([$status, $nextAssigned, $nextIndex, $nextDue, $id]);
            return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id)));
        }

        $pdo->prepare("UPDATE team_tasks SET status = 'done', completed_by_member_id = ?, completed_by_team_season_id = ?, completed_at = NOW() WHERE id = ?")
            ->execute([$completer, $teamId, $id]);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id)));
    }

    public static function reopenTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['task_id'];
        $t = self::loadTask($pdo, $id);
        if (!$t) return Http::error($res, 'Task not found', 404);
        $isPrivateAssignee = !empty($t['is_private']) && $t['assigned_member_id'] !== null && (int)$t['assigned_member_id'] === (int)$actor['id'];
        if (!$isPrivateAssignee && !self::perm($pdo, $actor, 'planning.tasks', 'write')) return Http::error($res, 'Access denied', 403);
        // A private task reopens to its assignee, not the shared 'open' pool.
        $pdo->prepare("UPDATE team_tasks SET status = 'open', claimed_by_member_id = NULL, claimed_at = NULL, completed_by_member_id = NULL, completed_by_team_season_id = NULL, completed_at = NULL WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$actor['id'], 'team_tasks', $id, 'reopen', null, null);
        return Http::json($res, self::serializeTask($pdo, self::loadTask($pdo, $id)));
    }

    public static function deleteTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'planning.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['task_id'];
        if (!self::loadTask($pdo, $id)) return Http::error($res, 'Task not found', 404);
        $pdo->prepare("DELETE FROM team_tasks WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$actor['id'], 'team_tasks', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Member assignments ───────────────────────────────────────────────
    public static function memberAssignments(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        // F5: this returns another member's task/activity list and their meeting action
        // items, so it must be self, a family guardian, or staff who may see others' tasks
        // — not any authenticated member. (Private-group action items are ALSO filtered by
        // the viewer's own group access below, so a parent can't see board-only items.)
        $isSelf = (int)$cur['id'] === $mid;
        if (!$isSelf
            && !Permissions::memberCan($pdo, $cur, 'planning.tasks_others', 'read')
            && !MembersController::isFamilyParentOf($pdo, $cur, $mid)) {
            return Http::error($res, 'Access denied', 403);
        }
        $asg = $pdo->prepare("SELECT activity_id FROM season_activity_assignees WHERE member_id = ?"); $asg->execute([$mid]);
        $assignedIds = array_map('intval', array_column($asg->fetchAll(), 'activity_id'));
        $cond = "lead_member_id = ?"; $args = [$mid];
        if ($assignedIds) { $cond = "(lead_member_id = ? OR id IN (" . implode(',', array_fill(0, count($assignedIds), '?')) . "))"; $args = array_merge([$mid], $assignedIds); }
        $aq = $pdo->prepare("SELECT * FROM season_activities WHERE $cond AND status != 'done' ORDER BY target_date IS NULL, target_date");
        $aq->execute($args);
        $acts = $aq->fetchAll();
        $tq = $pdo->prepare("SELECT * FROM team_tasks WHERE claimed_by_member_id = ? AND status != 'done' ORDER BY claimed_at DESC");
        $tq->execute([$mid]);
        $tasks = $tq->fetchAll();
        $tsIds = array_unique(array_merge(
            array_map(fn($a) => (int)$a['team_season_id'], $acts),
            array_filter(array_map(fn($t) => $t['team_season_id'] !== null ? (int)$t['team_season_id'] : null, $tasks), fn($v) => $v !== null)
        ));
        $labels = [];
        if ($tsIds) {
            $ph = implode(',', array_fill(0, count($tsIds), '?'));
            $ls = $pdo->prepare("SELECT ts.id, ts.team_name, t.team_number FROM team_seasons ts LEFT JOIN teams t ON t.id = ts.team_id WHERE ts.id IN ($ph)");
            $ls->execute(array_values($tsIds));
            foreach ($ls->fetchAll() as $r) $labels[(int)$r['id']] = $r['team_name'] ?: ($r['team_number'] !== null ? 'Team ' . $r['team_number'] : 'Team');
        }
        $actsOut = array_map(function ($a) use ($pdo, $labels, $mid) {
            $d = self::serializeActivity($pdo, $a);
            $d['team_name'] = $labels[(int)$a['team_season_id']] ?? null;
            $d['role'] = ((int)$a['lead_member_id'] === $mid) ? 'lead' : 'owner';
            return $d;
        }, $acts);
        $tasksOut = array_map(function ($t) use ($pdo, $labels) {
            $d = self::serializeTask($pdo, $t);
            $d['team_name'] = $t['team_season_id'] !== null ? ($labels[(int)$t['team_season_id']] ?? null) : null;
            return $d;
        }, $tasks);
        // Open meeting action items assigned to this member (from YLC/committee minutes).
        // Match any of an item's assignees (multi-assignee), falling back to the legacy
        // single column for any rows not yet in the join table.
        $ai = $pdo->prepare(
            "SELECT a.id, a.description, a.due_date, a.status, a.meeting_id,
                    m.title AS meeting_title, m.group_label
             FROM meeting_action_items a JOIN meetings m ON m.id = a.meeting_id
             WHERE a.status <> 'done'
               AND (a.assignee_member_id = ?
                    OR EXISTS (SELECT 1 FROM meeting_action_item_assignees x
                                WHERE x.action_item_id = a.id AND x.member_id = ?))
             ORDER BY a.due_date IS NULL, a.due_date");
        $ai->execute([$mid, $mid]);
        // F5: only surface action items from meeting groups the VIEWER may see — a private
        // board's items must not leak through this endpoint (mirrors MinutesController's
        // own access model). Public/unknown groups pass for everyone.
        $actionItems = [];
        foreach ($ai->fetchAll() as $a) {
            if (!MinutesController::canViewGroup($pdo, $cur, $a['group_label'])) continue;
            $actionItems[] = [
                'id' => (int)$a['id'], 'meeting_id' => (int)$a['meeting_id'],
                'meeting_title' => $a['meeting_title'], 'group_label' => $a['group_label'],
                'description' => $a['description'], 'due_date' => $a['due_date'], 'status' => $a['status'],
            ];
        }
        return Http::json($res, ['activities' => $actsOut, 'tasks' => $tasksOut, 'action_items' => $actionItems]);
    }
}
