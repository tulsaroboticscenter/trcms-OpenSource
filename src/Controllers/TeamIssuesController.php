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
 * Team Issue Log (#126). A team-scoped log of problems hit while working, with a
 * discussion thread, tagged stakeholders, and an optional link to a Season Plan
 * activity. Any team member can raise an issue or comment; managers set status,
 * resolution, stakeholders, and can delete.
 */
final class TeamIssuesController
{
    private const STATUSES = ['open', 'in_progress', 'on_hold', 'closed'];

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'planning.manage', 'write');
    }

    private static function name(PDO $pdo, ?int $id): ?array
    {
        if (!$id) return null;
        $s = $pdo->prepare("SELECT id, first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $r = $s->fetch();
        return $r ? ['member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name'])] : null;
    }

    private static function stakeholders(PDO $pdo, int $issueId): array
    {
        $s = $pdo->prepare("SELECT member_id FROM team_issue_stakeholders WHERE issue_id = ?"); $s->execute([$issueId]);
        $out = [];
        foreach ($s->fetchAll(PDO::FETCH_COLUMN) as $mid) { if ($b = self::name($pdo, (int)$mid)) $out[] = $b; }
        return $out;
    }

    private static function serialize(PDO $pdo, array $r, bool $withThread = false): array
    {
        $out = [
            'id' => (int)$r['id'], 'team_season_id' => (int)$r['team_season_id'],
            'title' => $r['title'], 'description' => $r['description'], 'status' => $r['status'],
            'resolution_notes' => $r['resolution_notes'],
            'reporter' => self::name($pdo, $r['reporter_id'] !== null ? (int)$r['reporter_id'] : null),
            'linked_activity_id' => $r['linked_activity_id'] !== null ? (int)$r['linked_activity_id'] : null,
            'linked_activity_name' => $r['activity_name'] ?? null,
            'linked_bom_id' => $r['linked_bom_id'] !== null ? (int)$r['linked_bom_id'] : null,
            'linked_bom_name' => $r['bom_name'] ?? null,
            'stakeholders' => self::stakeholders($pdo, (int)$r['id']),
            'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'], 'closed_at' => $r['closed_at'],
        ];
        if ($withThread) {
            $c = $pdo->prepare("SELECT * FROM team_issue_comments WHERE issue_id = ? ORDER BY created_at, id");
            $c->execute([(int)$r['id']]);
            $out['comments'] = array_map(fn($x) => [
                'id' => (int)$x['id'], 'body' => $x['body'], 'created_at' => $x['created_at'],
                'author' => self::name($pdo, $x['author_id'] !== null ? (int)$x['author_id'] : null),
            ], $c->fetchAll());
        } else {
            $cc = $pdo->prepare("SELECT COUNT(*) FROM team_issue_comments WHERE issue_id = ?"); $cc->execute([(int)$r['id']]);
            $out['comment_count'] = (int)$cc->fetchColumn();
        }
        return $out;
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT ti.*, sa.name AS activity_name, b.name AS bom_name FROM team_issues ti
                            LEFT JOIN season_activities sa ON sa.id = ti.linked_activity_id LEFT JOIN inv_boms b ON b.id = ti.linked_bom_id WHERE ti.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /** GET /planning/team/{team_season_id}/issues?status= */
    /** True if the member is on that team season, or may view any team's roster. */
    private static function canViewTeam(PDO $pdo, int $memberId, int $teamSeasonId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE team_season_id = ? AND member_id = ? LIMIT 1");
        $s->execute([$teamSeasonId, $memberId]);
        if ($s->fetchColumn()) return true;
        $m = Auth::loadMember($pdo, $memberId);
        return $m !== null && Permissions::memberCan($pdo, $m, 'teams.roster_others', 'read');
    }

    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $tsid = (int)$route['team_season_id'];
        // Security #13: a team's issue log is team-internal — visible to members of that team
        // season, or to a roster-viewer (teams.roster_others). Was readable by any member.
        if (!self::canViewTeam($pdo, (int)$me['id'], $tsid)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ['ti.team_season_id = ?']; $args = [$tsid];
        if (!empty($q['status']) && in_array($q['status'], self::STATUSES, true)) { $where[] = 'ti.status = ?'; $args[] = $q['status']; }
        $st = $pdo->prepare("SELECT ti.*, sa.name AS activity_name, b.name AS bom_name FROM team_issues ti
                             LEFT JOIN season_activities sa ON sa.id = ti.linked_activity_id LEFT JOIN inv_boms b ON b.id = ti.linked_bom_id
                             WHERE " . implode(' AND ', $where) . "
                             ORDER BY FIELD(ti.status,'open','in_progress','on_hold','closed'), ti.updated_at DESC");
        $st->execute($args);
        return Http::json($res, array_map(fn($r) => self::serialize($pdo, $r), $st->fetchAll()));
    }

    /** GET /planning/issues/{issue_id} — full issue with its comment thread. */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $r = self::load($pdo, (int)$route['issue_id']);
        if (!$r) return Http::error($res, 'Issue not found', 404);
        return Http::json($res, self::serialize($pdo, $r, true));
    }

    /** POST /planning/team/{team_season_id}/issues — any team member may raise an issue. */
    public static function create(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $tsid = (int)$route['team_season_id'];
        $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? ''));
        if ($title === '') return Http::error($res, 'A title is required.', 422);
        $reporter = !empty($d['reporter_id']) ? (int)$d['reporter_id'] : (int)$m['id'];
        $status = in_array($d['status'] ?? 'open', self::STATUSES, true) ? ($d['status'] ?? 'open') : 'open';
        $pdo->prepare("INSERT INTO team_issues (team_season_id, title, description, reporter_id, status, linked_activity_id, linked_bom_id, created_by_id, updated_by_id, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW())")
            ->execute([$tsid, $title, $d['description'] ?? null, $reporter, $status,
                !empty($d['linked_activity_id']) ? (int)$d['linked_activity_id'] : null,
                !empty($d['linked_bom_id']) ? (int)$d['linked_bom_id'] : null, (int)$m['id'], (int)$m['id']]);
        $id = (int)$pdo->lastInsertId();
        if (!empty($d['stakeholder_ids'])) self::syncStakeholders($pdo, $id, (array)$d['stakeholder_ids']);
        Audit::write($pdo, (int)$m['id'], 'team_issues', $id, 'create', null, ['title' => $title]);
        return Http::json($res, self::serialize($pdo, self::load($pdo, $id), true), 201);
    }

    /** PATCH /planning/issues/{issue_id} — managers set status/resolution/fields/stakeholders. */
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['issue_id'];
        if (!self::load($pdo, $id)) return Http::error($res, 'Issue not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['title', 'description', 'resolution_notes'] as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        }
        if (array_key_exists('reporter_id', $d)) { $set[] = 'reporter_id = ?'; $args[] = $d['reporter_id'] ? (int)$d['reporter_id'] : null; }
        if (array_key_exists('linked_activity_id', $d)) { $set[] = 'linked_activity_id = ?'; $args[] = $d['linked_activity_id'] ? (int)$d['linked_activity_id'] : null; }
        if (array_key_exists('linked_bom_id', $d)) { $set[] = 'linked_bom_id = ?'; $args[] = $d['linked_bom_id'] ? (int)$d['linked_bom_id'] : null; }
        if (array_key_exists('status', $d)) {
            if (!in_array($d['status'], self::STATUSES, true)) return Http::error($res, 'Invalid status.', 422);
            $set[] = 'status = ?'; $args[] = $d['status'];
            $set[] = $d['status'] === 'closed' ? 'closed_at = NOW()' : 'closed_at = NULL';
        }
        if ($set) {
            $set[] = 'updated_by_id = ?'; $args[] = (int)$m['id'];
            $set[] = 'updated_at = NOW()';
            $args[] = $id;
            $pdo->prepare("UPDATE team_issues SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        }
        if (array_key_exists('stakeholder_ids', $d)) self::syncStakeholders($pdo, $id, (array)$d['stakeholder_ids']);
        Audit::write($pdo, (int)$m['id'], 'team_issues', $id, 'update', null, null);
        return Http::json($res, self::serialize($pdo, self::load($pdo, $id), true));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM team_issues WHERE id = ?")->execute([(int)$route['issue_id']]);
        Audit::write($pdo, (int)$m['id'], 'team_issues', (int)$route['issue_id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /** POST /planning/issues/{issue_id}/comments — any member may weigh in. */
    public static function addComment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['issue_id'];
        if (!self::load($pdo, $id)) return Http::error($res, 'Issue not found', 404);
        $body = trim((string)((array)$req->getParsedBody())['body'] ?? '');
        if ($body === '') return Http::error($res, 'Comment cannot be empty.', 422);
        $pdo->prepare("INSERT INTO team_issue_comments (issue_id, author_id, body, created_at) VALUES (?,?,?,NOW())")
            ->execute([$id, (int)$m['id'], $body]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'team_issue_comments', $newId, 'create', null, ['issue_id' => $id]);
        // Bump the issue's updated_at so it surfaces as recently active.
        $pdo->prepare("UPDATE team_issues SET updated_at = NOW() WHERE id = ?")->execute([$id]);
        return Http::json($res, self::serialize($pdo, self::load($pdo, $id), true), 201);
    }

    private static function syncStakeholders(PDO $pdo, int $issueId, array $ids): void
    {
        $pdo->prepare("DELETE FROM team_issue_stakeholders WHERE issue_id = ?")->execute([$issueId]);
        foreach (array_unique(array_map('intval', $ids)) as $mid) {
            if ($mid) $pdo->prepare("INSERT IGNORE INTO team_issue_stakeholders (issue_id, member_id) VALUES (?, ?)")->execute([$issueId, $mid]);
        }
    }
}
