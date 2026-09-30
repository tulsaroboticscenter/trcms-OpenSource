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

/**
 * In-app feedback: bug reports and feature requests. Any logged-in user can
 * submit and see their own; triagers (feedback.manage) see and manage all,
 * including the deployment-tracking fields (which release / date a fix shipped
 * and notes about the fix).
 */
final class FeedbackController
{
    private const TYPES = ['bug', 'feature', 'enhancement', 'other'];
    private const STATUSES = ['new', 'planned', 'in_progress', 'in_review', 'testing', 'done', 'declined'];
    private const PRIORITIES = ['low', 'normal', 'high', 'critical'];

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'feedback.manage', 'write');
    }

    private static function row(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM feedback WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function submitterName(PDO $pdo, ?int $id): ?string
    {
        if ($id === null) return null;
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $r = $s->fetch();
        return $r ? trim("{$r['first_name']} {$r['last_name']}") : null;
    }

    private static function serialize(PDO $pdo, array $f, bool $withComments = false): array
    {
        return [
            'id' => (int)$f['id'],
            'member_id' => $f['member_id'] !== null ? (int)$f['member_id'] : null,
            'submitter_name' => self::submitterName($pdo, $f['member_id'] !== null ? (int)$f['member_id'] : null),
            'type' => $f['type'], 'title' => $f['title'], 'description' => $f['description'], 'steps' => $f['steps'],
            'page' => $f['page'], 'app_version' => $f['app_version'], 'user_agent' => $f['user_agent'],
            'target_release' => $f['target_release'] ?? null,
            'entered_by_id' => isset($f['entered_by_id']) && $f['entered_by_id'] !== null ? (int)$f['entered_by_id'] : null,
            'entered_by_name' => self::submitterName($pdo, isset($f['entered_by_id']) && $f['entered_by_id'] !== null ? (int)$f['entered_by_id'] : null),
            'status' => $f['status'], 'priority' => $f['priority'],
            'admin_notes' => $f['admin_notes'],
            'resolution_release' => $f['resolution_release'],
            'deployed_on' => $f['deployed_on'],
            'resolution_notes' => $f['resolution_notes'],
            'github_issue_number' => isset($f['github_issue_number']) && $f['github_issue_number'] !== null ? (int)$f['github_issue_number'] : null,
            'github_issue_url' => $f['github_issue_url'] ?? null,
            'created_at' => Time::naiveIso($f['created_at']),
            'updated_at' => Time::naiveIso($f['updated_at']),
            'confirmed_at' => isset($f['confirmed_at']) ? Time::naiveIso($f['confirmed_at']) : null,
            'confirmed_by_id' => isset($f['confirmed_by_id']) && $f['confirmed_by_id'] !== null ? (int)$f['confirmed_by_id'] : null,
            'confirmed_by_name' => self::submitterName($pdo, isset($f['confirmed_by_id']) && $f['confirmed_by_id'] !== null ? (int)$f['confirmed_by_id'] : null),
            'comments' => $withComments ? self::comments($pdo, (int)$f['id']) : [],
        ];
    }

    /** The comment thread for a feedback item, oldest first. */
    private static function comments(PDO $pdo, int $feedbackId): array
    {
        $s = $pdo->prepare("SELECT * FROM feedback_comments WHERE feedback_id = ? ORDER BY created_at, id");
        $s->execute([$feedbackId]);
        return array_map(fn ($c) => [
            'id' => (int)$c['id'],
            'member_id' => $c['member_id'] !== null ? (int)$c['member_id'] : null,
            'author_name' => self::submitterName($pdo, $c['member_id'] !== null ? (int)$c['member_id'] : null),
            'body' => $c['body'],
            'kind' => $c['kind'],
            'created_at' => Time::naiveIso($c['created_at']),
        ], $s->fetchAll());
    }

    /**
     * POST /feedback/{id}/comments — add a comment, and optionally confirm.
     *
     * Open to the submitter (so they can say "tested, works" or "not quite") and to
     * triagers. `confirm: true` stamps the submitter's sign-off; a manager confirming
     * on the submitter's behalf is allowed too. `confirm: false` clears it.
     */
    public static function addComment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $f = self::row($pdo, (int)$route['feedback_id']);
        if (!$f) return Http::error($res, 'Feedback not found', 404);
        $manage = self::canManage($pdo, $cur);
        $isOwner = (int)$f['member_id'] === (int)$cur['id'];
        if (!$manage && !$isOwner) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $body = trim((string)($d['body'] ?? ''));
        $hasConfirm = array_key_exists('confirm', $d);
        $confirm = $hasConfirm ? (bool)$d['confirm'] : null;
        if ($body === '' && !$hasConfirm) return Http::error($res, 'Add a comment or confirm the fix.', 422);

        if ($body !== '') {
            $kind = $confirm === true ? 'confirmed' : 'comment';
            $pdo->prepare("INSERT INTO feedback_comments (feedback_id, member_id, body, kind, created_at)
                           VALUES (?, ?, ?, ?, NOW())")
                ->execute([(int)$f['id'], (int)$cur['id'], $body, $kind]);
        }

        // Confirmation stamp on the feedback itself. The confirming member is recorded
        // as the reporter when a manager does it on their behalf, else the actor.
        // A sign-off ("Confirm this works as requested") also CLOSES the ticket → Done;
        // reopening (confirm:false) clears the stamp and, if it had auto-closed, drops it
        // back to Testing for another look. $statusChange = [new, old] drives GitHub sync.
        $statusChange = null;
        if ($confirm === true && empty($f['confirmed_at'])) {
            $by = $isOwner ? (int)$cur['id'] : (int)$f['member_id'];
            $close = !in_array($f['status'], ['done', 'declined'], true);
            $pdo->prepare("UPDATE feedback SET confirmed_at = NOW(), confirmed_by_id = ?"
                    . ($close ? ", status = 'done'" : '') . ", updated_at = NOW() WHERE id = ?")
                ->execute([$by ?: null, (int)$f['id']]);
            if ($close) $statusChange = ['done', (string)$f['status']];
        } elseif ($confirm === false) {
            $reopen = $f['status'] === 'done';
            $pdo->prepare("UPDATE feedback SET confirmed_at = NULL, confirmed_by_id = NULL"
                    . ($reopen ? ", status = 'testing'" : '') . ", updated_at = NOW() WHERE id = ?")
                ->execute([(int)$f['id']]);
            if ($reopen) $statusChange = ['testing', 'done'];
        }

        // Keep a linked GitHub issue + its Project board column in step with the auto
        // status change (best-effort, mirrors update()).
        if ($statusChange !== null && !empty($f['github_issue_url']) && \App\Core\GitHub::isConfigured($pdo)) {
            self::syncGithubStatus($pdo, (string)$f['github_issue_url'], $statusChange[0], $statusChange[1]);
        }

        Audit::write($pdo, (int)$cur['id'], 'feedback', (int)$f['id'], 'comment', null,
            ['confirm' => $confirm, 'has_body' => $body !== '', 'auto_status' => $statusChange[0] ?? null]);
        return Http::json($res, self::serialize($pdo, self::row($pdo, (int)$f['id']), true), 201);
    }

    /** POST /feedback/{id}/github — create a GitHub Issue from this feedback and link it. */
    public static function pushToGithub(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $f = self::row($pdo, (int)$route['feedback_id']);
        if (!$f) return Http::error($res, 'Feedback not found', 404);
        if (!\App\Core\GitHub::isConfigured($pdo)) {
            return Http::error($res, 'GitHub integration is not configured. Set it up in Admin → GitHub Settings.', 400);
        }
        if (!empty($f['github_issue_url'])) {
            return Http::json($res, self::serialize($pdo, $f)); // already linked — no double-post
        }
        $f['submitter_name'] = self::submitterName($pdo, $f['member_id'] !== null ? (int)$f['member_id'] : null);
        try {
            $issue = \App\Core\GitHub::createIssueFromFeedback($pdo, $f);
        } catch (\Throwable $e) {
            return Http::error($res, 'GitHub: ' . $e->getMessage(), 502);
        }
        $pdo->prepare("UPDATE feedback SET github_issue_number = ?, github_issue_url = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$issue['number'], $issue['url'], (int)$f['id']]);
        Audit::write($pdo, (int)$cur['id'], 'feedback', (int)$f['id'], 'github_issue', null, ['issue' => $issue['number'], 'url' => $issue['url']]);
        $out = self::serialize($pdo, self::row($pdo, (int)$f['id']));
        $out['github_result'] = $issue; // includes added_to_project / project_error if any
        return Http::json($res, $out);
    }

    /** POST /feedback/{id}/github-comment — post a comment on the linked GitHub Issue. */
    public static function commentToGithub(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $f = self::row($pdo, (int)$route['feedback_id']);
        if (!$f) return Http::error($res, 'Feedback not found', 404);
        if (empty($f['github_issue_url'])) return Http::error($res, 'This feedback is not linked to a GitHub issue yet.', 400);
        if (!\App\Core\GitHub::isConfigured($pdo)) return Http::error($res, 'GitHub integration is not configured.', 400);
        $body = trim((string)((array)$req->getParsedBody())['body'] ?? '');
        if ($body === '') return Http::error($res, 'Enter a comment to post.', 422);
        try {
            $r = \App\Core\GitHub::addCommentByUrl($pdo, (string)$f['github_issue_url'], $body);
        } catch (\Throwable $e) {
            return Http::error($res, 'GitHub: ' . $e->getMessage(), 502);
        }
        Audit::write($pdo, (int)$cur['id'], 'feedback', (int)$f['id'], 'github_comment', null, ['url' => $r['url']]);
        return Http::json($res, ['ok' => true, 'comment_url' => $r['url']]);
    }

    /** GET /feedback — managers see all (filterable); others see their own. */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $manage = self::canManage($pdo, $cur);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!$manage) { $where[] = 'member_id = ?'; $args[] = (int)$cur['id']; }
        // "Mine" — feedback I submitted or that was submitted on my behalf
        // (member_id is the reporter even when a manager enters it for them).
        elseif (!empty($q['mine'])) { $where[] = 'member_id = ?'; $args[] = (int)$cur['id']; }
        if (!empty($q['status']) && in_array($q['status'], self::STATUSES, true)) { $where[] = 'status = ?'; $args[] = $q['status']; }
        if (!empty($q['type']) && in_array($q['type'], self::TYPES, true)) { $where[] = 'type = ?'; $args[] = $q['type']; }
        $sql = "SELECT * FROM feedback";
        if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
        // Numerical order by ticket number (ascending), so #1, #2, #3 … line up.
        $sql .= " ORDER BY id ASC";
        $s = $pdo->prepare($sql); $s->execute($args);
        return Http::json($res, ['can_manage' => $manage, 'items' => array_map(fn($f) => self::serialize($pdo, $f), $s->fetchAll())]);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $f = self::row($pdo, (int)$route['feedback_id']);
        if (!$f) return Http::error($res, 'Feedback not found', 404);
        if (!self::canManage($pdo, $cur) && (int)$f['member_id'] !== (int)$cur['id']) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::serialize($pdo, $f, true));
    }

    /** POST /feedback — submit a bug/feature/other. */
    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'feedback.submit', 'write')) return Http::error($res, "You don't have permission to submit feedback.", 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['title'])) return Http::error($res, 'Please give your feedback a short title.', 422);
        $type = in_array($d['type'] ?? '', self::TYPES, true) ? $d['type'] : 'bug';
        $ua = $req->getHeaderLine('User-Agent');
        // A manager may submit on behalf of another member: that member becomes the
        // reporter (member_id) and we record who actually entered it (entered_by_id).
        $reporterId = (int)$cur['id'];
        $enteredById = null;
        if (self::canManage($pdo, $cur) && !empty($d['member_id']) && (int)$d['member_id'] !== (int)$cur['id']) {
            $reporterId = (int)$d['member_id'];
            $enteredById = (int)$cur['id'];
        }
        $pdo->prepare("INSERT INTO feedback (member_id, entered_by_id, type, title, description, steps, page, app_version, user_agent, target_release, status, priority)
                       VALUES (?,?,?,?,?,?,?,?,?,?, 'new', 'normal')")
            ->execute([
                $reporterId, $enteredById, $type, $d['title'], $d['description'] ?? null, $d['steps'] ?? null,
                $d['page'] ?? null, $d['app_version'] ?? null, substr($ua, 0, 400), ($d['target_release'] ?? null) ?: null,
            ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'feedback', $id, 'create', null, ['type' => $type, 'title' => $d['title'], 'on_behalf_of' => $enteredById ? $reporterId : null]);
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true), 201);
    }

    /**
     * PATCH /feedback/{id}
     *  - The submitter may edit title/description/steps/type while status is 'new'.
     *  - Triagers (feedback.manage) may edit everything, including status, priority,
     *    notes, and the deployment fields (resolution_release, deployed_on, resolution_notes).
     */
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $f = self::row($pdo, (int)$route['feedback_id']);
        if (!$f) return Http::error($res, 'Feedback not found', 404);
        $manage = self::canManage($pdo, $cur);
        $isOwner = (int)$f['member_id'] === (int)$cur['id'];
        if (!$manage && !$isOwner) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];

        // Submitter-editable content (also editable by managers).
        if ($manage || $f['status'] === 'new') {
            if (array_key_exists('title', $d) && $d['title'] !== '') { $set[] = 'title = ?'; $args[] = $d['title']; }
            foreach (['description', 'steps'] as $field) if (array_key_exists($field, $d)) { $set[] = "$field = ?"; $args[] = $d[$field] ?: null; }
            if (array_key_exists('type', $d) && in_array($d['type'], self::TYPES, true)) { $set[] = 'type = ?'; $args[] = $d['type']; }
            if (array_key_exists('target_release', $d)) { $set[] = 'target_release = ?'; $args[] = $d['target_release'] ?: null; }
        }

        // Triage / resolution fields — managers only.
        if ($manage) {
            // Change the submitter (and record who entered it on their behalf).
            if (array_key_exists('member_id', $d) && !empty($d['member_id'])) {
                $newReporter = (int)$d['member_id'];
                $set[] = 'member_id = ?'; $args[] = $newReporter;
                $set[] = 'entered_by_id = ?'; $args[] = $newReporter !== (int)$cur['id'] ? (int)$cur['id'] : null;
            }
            if (array_key_exists('status', $d) && in_array($d['status'], self::STATUSES, true)) { $set[] = 'status = ?'; $args[] = $d['status']; }
            if (array_key_exists('priority', $d) && in_array($d['priority'], self::PRIORITIES, true)) { $set[] = 'priority = ?'; $args[] = $d['priority']; }
            if (array_key_exists('admin_notes', $d)) { $set[] = 'admin_notes = ?'; $args[] = $d['admin_notes'] ?: null; }
            if (array_key_exists('resolution_release', $d)) { $set[] = 'resolution_release = ?'; $args[] = $d['resolution_release'] ?: null; }
            if (array_key_exists('deployed_on', $d)) { $set[] = 'deployed_on = ?'; $args[] = ($d['deployed_on'] ?? '') !== '' ? substr((string)$d['deployed_on'], 0, 10) : null; }
            if (array_key_exists('resolution_notes', $d)) { $set[] = 'resolution_notes = ?'; $args[] = $d['resolution_notes'] ?: null; }
        }

        if ($set) {
            $set[] = 'updated_at = NOW()'; $args[] = (int)$f['id'];
            $pdo->prepare("UPDATE feedback SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
        }

        // Status sync: reflect the new status onto the linked GitHub issue + its
        // Project board column (Todo / In Progress / In Review / Done / Declined).
        if ($manage && array_key_exists('status', $d) && in_array($d['status'], self::STATUSES, true)
            && $d['status'] !== $f['status'] && !empty($f['github_issue_url']) && \App\Core\GitHub::isConfigured($pdo)) {
            self::syncGithubStatus($pdo, (string)$f['github_issue_url'], (string)$d['status'], (string)$f['status']);
        }

        Audit::write($pdo, (int)$cur['id'], 'feedback', (int)$f['id'], 'update', null, $d);
        return Http::json($res, self::serialize($pdo, self::row($pdo, (int)$f['id']), true));
    }

    /**
     * Best-effort: reflect a feedback status change onto its linked GitHub issue.
     * Steps the Project board column and closes/reopens the issue. Never throws —
     * a GitHub hiccup must not block the triage save.
     */
    private static function syncGithubStatus(PDO $pdo, string $issueUrl, string $newStatus, string $oldStatus): void
    {
        $col = \App\Core\GitHub::projectStatusFor($newStatus);
        if ($col !== null) {
            try { \App\Core\GitHub::setProjectStatusByUrl($pdo, $issueUrl, $col); }
            catch (\Throwable $e) { /* ignore */ }
        }
        // Closed once the work is finished or declined; reopened if it comes back.
        $nowClosed = in_array($newStatus, ['done', 'declined'], true);
        $wasClosed = in_array($oldStatus, ['done', 'declined'], true);
        if ($nowClosed !== $wasClosed) {
            try { \App\Core\GitHub::setIssueStateByUrl($pdo, $issueUrl, $nowClosed ? 'closed' : 'open'); }
            catch (\Throwable $e) { /* ignore */ }
        }
    }

    /**
     * POST /feedback/bulk — apply triage/resolution fields to many items at once
     * (managers only). Body: { ids: [int...], status?, priority?, target_release?,
     * resolution_release?, deployed_on?, resolution_notes? }.
     */
    public static function bulkUpdate(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['ids'] ?? [])))));
        if (!$ids) return Http::error($res, 'No feedback items selected.', 422);

        $set = []; $args = [];
        if (array_key_exists('status', $d) && in_array($d['status'], self::STATUSES, true)) { $set[] = 'status = ?'; $args[] = $d['status']; }
        if (array_key_exists('priority', $d) && in_array($d['priority'], self::PRIORITIES, true)) { $set[] = 'priority = ?'; $args[] = $d['priority']; }
        if (array_key_exists('target_release', $d)) { $set[] = 'target_release = ?'; $args[] = $d['target_release'] ?: null; }
        if (array_key_exists('resolution_release', $d)) { $set[] = 'resolution_release = ?'; $args[] = $d['resolution_release'] ?: null; }
        if (array_key_exists('deployed_on', $d)) { $set[] = 'deployed_on = ?'; $args[] = ($d['deployed_on'] ?? '') !== '' ? substr((string)$d['deployed_on'], 0, 10) : null; }
        if (array_key_exists('resolution_notes', $d)) { $set[] = 'resolution_notes = ?'; $args[] = $d['resolution_notes'] ?: null; }
        if (!$set) return Http::error($res, 'No changes specified.', 422);

        $ph = implode(',', array_fill(0, count($ids), '?'));
        // If a status change is part of this bulk edit, capture the GitHub-linked
        // items + their old status first, so we can step their board column after.
        $linked = [];
        $changingStatus = array_key_exists('status', $d) && in_array($d['status'], self::STATUSES, true);
        if ($changingStatus && \App\Core\GitHub::isConfigured($pdo)) {
            $ls = $pdo->prepare("SELECT github_issue_url, status FROM feedback WHERE id IN ($ph) AND github_issue_url IS NOT NULL AND github_issue_url <> ''");
            $ls->execute($ids);
            $linked = $ls->fetchAll();
        }

        $set[] = 'updated_at = NOW()';
        $pdo->prepare("UPDATE feedback SET " . implode(',', $set) . " WHERE id IN ($ph)")->execute([...$args, ...$ids]);

        foreach ($linked as $row) {
            if ($d['status'] !== $row['status']) {
                self::syncGithubStatus($pdo, (string)$row['github_issue_url'], (string)$d['status'], (string)$row['status']);
            }
        }
        Audit::write($pdo, (int)$cur['id'], 'feedback', null, 'bulk_update', null, ['ids' => $ids] + array_intersect_key($d, array_flip(['status', 'priority', 'target_release', 'resolution_release', 'deployed_on'])));
        return Http::json($res, ['ok' => true, 'updated' => count($ids)]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $f = self::row($pdo, (int)$route['feedback_id']);
        if (!$f) return Http::error($res, 'Feedback not found', 404);
        $manage = self::canManage($pdo, $cur);
        $isOwner = (int)$f['member_id'] === (int)$cur['id'];
        // Owners may withdraw their own while still 'new'; managers may delete any.
        if (!$manage && !($isOwner && $f['status'] === 'new')) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM feedback WHERE id = ?")->execute([(int)$f['id']]);
        Audit::write($pdo, (int)$cur['id'], 'feedback', (int)$f['id'], 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /feedback/open-count — count of un-resolved items (triagers only; 0 otherwise). */
    public static function openCount(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::json($res, ['count' => 0]);
        $n = (int)$pdo->query("SELECT COUNT(*) FROM feedback WHERE status IN ('new','planned','in_progress')")->fetchColumn();
        return Http::json($res, ['count' => $n]);
    }
}
