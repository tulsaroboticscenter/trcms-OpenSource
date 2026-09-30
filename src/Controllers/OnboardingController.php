<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\ComplianceService;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Per-member onboarding checklist — the jumping-off point for joining TRC.
 *
 * An admin assigns items to a person as they join; the member sees the open ones on
 * their own page, each linking to the Help Center article that explains what to do.
 *
 * Completion has ONE source of truth per item, never two:
 *   - source 'compliance:*' items (YPT, background check, first aid) are DERIVED at
 *     read time from the existing compliance records via ComplianceService. Nothing
 *     is written back to member_onboarding_tasks.completed_at for these — recording a
 *     YPT date stays the job of the compliance screens, and this checklist just
 *     reflects it.
 *   - source 'manual' items (handbook read, Code of Conduct signature page) have no
 *     canonical store elsewhere, so completed_at here IS the record.
 */
final class OnboardingController
{
    /**
     * The catalog. `source` decides where completion comes from; `help_slug` points at
     * the Help Center article with the instructions.
     */
    private const ITEMS = [
        'ypt' => [
            'label' => 'Youth Protection Training',
            'description' => 'Complete the VIRTUS online youth protection training modules (about 1–1.5 hours; you can stop and resume).',
            'source' => 'compliance:ypt',
            'help_slug' => 'youth-protection-training',
            'action_url' => 'http://www.ncsrisk.org/ncs/registration/reg_2.cfm?theme=0&org=37871',
            'action_label' => 'Register with VIRTUS',
        ],
        'background_check' => [
            'label' => 'Background Check',
            'description' => 'Authorize the Sterling Volunteers criminal background check. Do this first so it can be in process while you train.',
            'source' => 'compliance:background_check',
            'help_slug' => 'youth-protection-training',
            'action_url' => 'http://www.ncsrisk.org/ncs/registration/reg_2.cfm?theme=0&org=37871',
            'action_label' => 'Register with VIRTUS',
        ],
        'first_aid' => [
            'label' => 'First Aid / CPR',
            'description' => 'Current first aid and CPR certification. Not required of everyone — assign where the role calls for it.',
            'source' => 'compliance:first',
            'help_slug' => null,
            'action_url' => null,
            'action_label' => null,
        ],
        'handbook' => [
            'label' => 'Read the TRC Handbook',
            'description' => 'Read the handbook, which contains the Code of Conduct and the two-deep leadership rules.',
            'source' => 'manual',
            'help_slug' => 'youth-protection-training',
            'action_url' => null,
            'action_label' => null,
        ],
        'code_of_conduct' => [
            'label' => 'Code of Conduct Signature Page',
            'description' => 'Sign the Code of Conduct and hand the signature page to anyone on the admin team.',
            'source' => 'manual',
            'help_slug' => 'youth-protection-training',
            'action_url' => null,
            'action_label' => null,
        ],
        // Build your resume in the FDP resume builder. Completion is DERIVED from the
        // builder (resume_answers.completed_at) — the youth marks it finished there, and
        // this item reflects it. Assignable by the Dev Program manager to youth.
        'resume' => [
            'label' => 'Build your resume',
            'description' => 'Use the resume builder to put together a one-page resume you can print or download any time.',
            'source' => 'resume',
            'help_slug' => null,
            'action_url' => '/resume',
            'action_label' => 'Open the resume builder',
        ],
    ];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    /**
     * A member always sees their own list, and a parent/guardian sees their youth's —
     * FDP work is assigned to youth, and parents are meant to follow their child's
     * progress. Anyone else needs the key.
     */
    private static function canSee(PDO $pdo, ?array $actor, int $memberId): bool
    {
        if ($actor === null) return false;
        if ((int)$actor['id'] === $memberId) return true;
        if (MembersController::isFamilyParentOf($pdo, $actor, $memberId)) return true;
        return self::perm($pdo, $actor, 'onboarding.view', 'read');
    }

    /**
     * Derived completion for the compliance-backed items, keyed by item_key.
     * Returns ['completed_date' => ?string, 'expired' => bool] per key.
     */
    private static function complianceState(PDO $pdo, int $memberId): array
    {
        $c = ComplianceService::memberComplianceStatus($pdo, $memberId);
        $map = ['ypt' => 'ypt', 'background_check' => 'background_check', 'first' => 'first'];
        $out = [];
        foreach ($map as $src => $field) {
            $rec = $c[$field] ?? [];
            $out[$src] = [
                'completed_date' => $rec['completed_date'] ?? null,
                'expired' => (bool)($rec['expired'] ?? false),
                'expiring_soon' => (bool)($rec['expiring_soon'] ?? false),
                'expires_date' => $rec['expires_date'] ?? null,
                // Exempt members (per EnrollmentService) have no dates at all. Without
                // this they would read as permanently outstanding.
                'exempt' => ($rec['status'] ?? null) === 'exempt' || !empty($c['exempt']),
            ];
        }
        return $out;
    }

    /** Merge a stored assignment row with its catalog entry and derived completion. */
    private static function serialize(array $row, array $compliance, bool $resumeDone = false): array
    {
        $key = $row['item_key'];
        $isWork = ($row['category'] ?? 'onboarding') === 'fdp_work';
        // Work items are free-form, so their label lives on the row. Checklist items
        // come from the code catalog, keyed by item_key.
        $def = $isWork
            ? ['label' => (string)($row['title'] ?? 'Work item'), 'description' => $row['description'] ?? null,
               'source' => 'manual', 'help_slug' => null, 'action_url' => null, 'action_label' => null]
            : (self::ITEMS[$key] ?? ['label' => $key, 'description' => null, 'source' => 'manual',
               'help_slug' => null, 'action_url' => null, 'action_label' => null]);

        $completedDate = null; $expired = false; $expiringSoon = false; $expiresDate = null; $exempt = false;
        $derivedComplete = false;   // completion known but with no canonical date (resume)
        if (str_starts_with($def['source'], 'compliance:')) {
            $src = substr($def['source'], strlen('compliance:'));
            $st = $compliance[$src] ?? [];
            $completedDate = $st['completed_date'] ?? null;
            $expired = (bool)($st['expired'] ?? false);
            $expiringSoon = (bool)($st['expiring_soon'] ?? false);
            $expiresDate = $st['expires_date'] ?? null;
            $exempt = (bool)($st['exempt'] ?? false);
        } elseif ($def['source'] === 'resume') {
            // Derived from the resume builder — the youth finishes it there. We know
            // whether it's done, not a canonical date, so drive is_complete directly.
            $derivedComplete = $resumeDone;
        } else {
            $completedDate = $row['completed_at'] ? substr((string)$row['completed_at'], 0, 10) : null;
        }
        // An expired credential is not "done" — it needs redoing, so it stays open.
        // An exempt member has nothing to do, so the item is satisfied without a date.
        $isComplete = $exempt || $derivedComplete || ($completedDate !== null && !$expired);
        $isDerived = str_starts_with($def['source'], 'compliance:') || $def['source'] === 'resume';

        return [
            'id' => (int)$row['id'],
            'member_id' => (int)$row['member_id'],
            'category' => $row['category'] ?? 'onboarding',
            'item_key' => $key,
            'label' => $def['label'],
            'description' => $def['description'],
            'source' => $def['source'],
            'derived' => $isDerived,
            'help_slug' => $def['help_slug'],
            'action_url' => $def['action_url'],
            'action_label' => $def['action_label'],
            'assigned_at' => $row['assigned_at'],
            'assigned_by_id' => $row['assigned_by_id'] !== null ? (int)$row['assigned_by_id'] : null,
            'due_date' => $row['due_date'],
            'notes' => $row['notes'],
            'is_complete' => $isComplete,
            'exempt' => $exempt,
            'completed_date' => $completedDate,
            'expired' => $expired,
            'expiring_soon' => $expiringSoon,
            'expires_date' => $expiresDate,
        ];
    }

    /**
     * POST /onboarding/members/{member_id}/work — assign a piece of work to an FDP
     * youth. Body: { title, description?, due_date? }
     *
     * Free-form, unlike the joining checklist: a mentor types what the work is, so the
     * label lives on the row rather than in the code catalog. Stored in the same table
     * under category 'fdp_work', which means it inherits completion, due dates, the
     * member's own view of it, and the audit trail for free.
     *
     * Gated on fdp.manage — the same permission that runs the rest of the FDP.
     */
    /** Email each youth + family that development work was assigned (best-effort). */
    private static function notifyWorkAssigned(PDO $pdo, array $memberIds, string $title, string $desc, ?string $due): void
    {
        $body = '<p>New development work has been assigned: <strong>' . htmlspecialchars($title) . '</strong>'
              . ($due ? ' (due ' . htmlspecialchars($due) . ')' : '') . '.</p>'
              . ($desc !== '' ? '<p>' . nl2br(htmlspecialchars($desc)) . '</p>' : '');
        foreach ($memberIds as $mid) {
            \App\Controllers\FdpController::emailYouthFamily($pdo, (int)$mid, 'New development work assigned', $body);
        }
    }

    public static function assignWork(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Not authenticated', 401);
        if (!self::perm($pdo, $actor, 'fdp.manage', 'write')) return Http::error($res, 'Not permitted', 403);

        $memberId = (int)$route['member_id'];
        $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $mt->execute([$memberId]);
        $type = $mt->fetchColumn();
        if ($type === false) return Http::error($res, 'Member not found', 404);
        if ($type !== 'youth') return Http::error($res, 'The FDP is a youth program.', 422);

        $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? ''));
        if ($title === '') return Http::error($res, 'Give the work a short title.', 422);
        $due = trim((string)($d['due_date'] ?? ''));
        $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) ? $due : null;

        // A youth can hold many work items, so each gets its own key rather than
        // colliding on the catalog's UNIQUE(member_id, item_key).
        $key = 'work:' . bin2hex(random_bytes(8));
        $pdo->prepare(
            "INSERT INTO member_onboarding_tasks
                (member_id, category, title, description, item_key, assigned_by_id, assigned_at, due_date)
             VALUES (?, 'fdp_work', ?, ?, ?, ?, NOW(), ?)")
            ->execute([$memberId, $title, ($d['description'] ?? '') ?: null, $key, (int)$actor['id'], $due]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$actor['id'], 'member_onboarding_tasks', $id, 'assign_work', null,
            ['member_id' => $memberId, 'title' => $title, 'due_date' => $due]);
        self::notifyWorkAssigned($pdo, [$memberId], $title, (string)($d['description'] ?? ''), $due);

        return self::forMember($req, $res, ['member_id' => (string)$memberId]);
    }

    /**
     * POST /onboarding/work/bulk — assign the same piece of work to several youth.
     * Body: { member_ids: [int], title, description?, due_date? }
     *
     * Each youth gets their OWN row, so they complete it independently and one youth
     * finishing doesn't mark it done for the rest. Non-youth ids are skipped rather
     * than failing the whole batch, and reported back so the caller can say so.
     */
    public static function assignWorkBulk(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Not authenticated', 401);
        if (!self::perm($pdo, $actor, 'fdp.manage', 'write')) return Http::error($res, 'Not permitted', 403);

        $d = (array)$req->getParsedBody();
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['member_ids'] ?? [])))));
        $title = trim((string)($d['title'] ?? ''));
        if (!$ids) return Http::error($res, 'Pick at least one youth.', 422);
        if ($title === '') return Http::error($res, 'Give the work a short title.', 422);
        $due = trim((string)($d['due_date'] ?? ''));
        $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) ? $due : null;
        $desc = ($d['description'] ?? '') ?: null;

        $in = implode(',', array_fill(0, count($ids), '?'));
        $q = $pdo->prepare("SELECT id FROM members WHERE id IN ($in) AND member_type = 'youth'");
        $q->execute($ids);
        $youthIds = array_map('intval', array_column($q->fetchAll(), 'id'));
        $skipped = array_values(array_diff($ids, $youthIds));
        if (!$youthIds) return Http::error($res, 'None of those are youth members.', 422);

        $ins = $pdo->prepare(
            "INSERT INTO member_onboarding_tasks
                (member_id, category, title, description, item_key, assigned_by_id, assigned_at, due_date)
             VALUES (?, 'fdp_work', ?, ?, ?, ?, NOW(), ?)");
        foreach ($youthIds as $mid) {
            $ins->execute([$mid, $title, $desc, 'work:' . bin2hex(random_bytes(8)), (int)$actor['id'], $due]);
        }
        Audit::write($pdo, (int)$actor['id'], 'member_onboarding_tasks', null, 'assign_work_bulk', null,
            ['member_ids' => $youthIds, 'title' => $title, 'due_date' => $due, 'skipped' => $skipped]);
        self::notifyWorkAssigned($pdo, $youthIds, $title, (string)$desc, $due);

        return Http::json($res, [
            'ok' => true,
            'assigned' => count($youthIds),
            'member_ids' => $youthIds,
            'skipped_not_youth' => $skipped,
        ], 201);
    }

    /**
     * POST /onboarding/resume-task/bulk — assign the "Build your resume" checklist item
     * to several youth at once. Body: { member_ids: [int], due_date? }
     *
     * A convenience for the Dev Program manager (fdp.manage) so they can push the resume
     * task from the FDP roster without the general onboarding.manage permission. Uses the
     * catalog 'resume' item, so completion stays derived from the resume builder.
     */
    public static function assignResumeBulk(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Not authenticated', 401);
        if (!self::perm($pdo, $actor, 'fdp.manage', 'write')) return Http::error($res, 'Not permitted', 403);

        $d = (array)$req->getParsedBody();
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['member_ids'] ?? [])))));
        if (!$ids) return Http::error($res, 'Pick at least one youth.', 422);
        $due = trim((string)($d['due_date'] ?? ''));
        $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) ? $due : null;

        $in = implode(',', array_fill(0, count($ids), '?'));
        $q = $pdo->prepare("SELECT id FROM members WHERE id IN ($in) AND member_type = 'youth'");
        $q->execute($ids);
        $youthIds = array_map('intval', array_column($q->fetchAll(), 'id'));
        $skipped = array_values(array_diff($ids, $youthIds));
        if (!$youthIds) return Http::error($res, 'None of those are youth members.', 422);

        // Re-assigning just updates the due date (uq_member_item), never duplicates.
        $ins = $pdo->prepare(
            "INSERT INTO member_onboarding_tasks (member_id, item_key, assigned_by_id, assigned_at, due_date)
             VALUES (?, 'resume', ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE due_date = VALUES(due_date)");
        foreach ($youthIds as $mid) $ins->execute([$mid, (int)$actor['id'], $due]);
        Audit::write($pdo, (int)$actor['id'], 'member_onboarding_tasks', null, 'assign_resume_bulk', null,
            ['member_ids' => $youthIds, 'due_date' => $due, 'skipped' => $skipped]);

        return Http::json($res, [
            'ok' => true,
            'assigned' => count($youthIds),
            'member_ids' => $youthIds,
            'skipped_not_youth' => $skipped,
        ], 201);
    }

    /** GET /onboarding/catalog — the assignable items, for the assign dialog. */
    public static function catalog(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (Auth::currentMember($pdo, $req) === null) return Http::error($res, 'Not authenticated', 401);
        $out = [];
        foreach (self::ITEMS as $key => $def) {
            $out[] = ['item_key' => $key, 'label' => $def['label'], 'description' => $def['description'],
                'source' => $def['source'], 'derived' => str_starts_with($def['source'], 'compliance:'),
                'help_slug' => $def['help_slug']];
        }
        return Http::json($res, ['items' => $out]);
    }

    /** GET /onboarding/members/{member_id} — one person's checklist. */
    public static function forMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        $memberId = (int)$route['member_id'];
        if (!self::canSee($pdo, $actor, $memberId)) return Http::error($res, 'Not permitted', 403);

        $s = $pdo->prepare("SELECT * FROM member_onboarding_tasks WHERE member_id = ? ORDER BY assigned_at, id");
        $s->execute([$memberId]);
        $rows = $s->fetchAll();
        $compliance = self::complianceState($pdo, $memberId);
        $resumeDone = ResumeController::isComplete($pdo, $memberId);
        $items = array_map(fn ($r) => self::serialize($r, $compliance, $resumeDone), $rows);
        $open = array_values(array_filter($items, fn ($i) => !$i['is_complete']));

        return Http::json($res, [
            'member_id' => $memberId,
            'items' => $items,
            'checklist' => array_values(array_filter($items, fn ($i) => $i['category'] !== 'fdp_work')),
            'work' => array_values(array_filter($items, fn ($i) => $i['category'] === 'fdp_work')),
            'open_count' => count($open),
            'can_manage' => self::perm($pdo, $actor, 'onboarding.manage', 'write'),
            'can_assign_work' => self::perm($pdo, $actor, 'fdp.manage', 'write'),
        ]);
    }

    /** GET /onboarding/me — the signed-in member's own checklist (dashboard pane). */
    public static function mine(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if ($actor === null) return Http::error($res, 'Not authenticated', 401);
        return self::forMember($req, $res, ['member_id' => (string)(int)$actor['id']]);
    }

    /** POST /onboarding/members/{member_id}/assign — {items: [key], due_date?} */
    public static function assign(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'onboarding.manage', 'write')) return Http::error($res, 'Not permitted', 403);

        $memberId = (int)$route['member_id'];
        $ex = $pdo->prepare("SELECT 1 FROM members WHERE id = ?"); $ex->execute([$memberId]);
        if (!$ex->fetch()) return Http::error($res, 'Member not found', 404);

        $d = (array)$req->getParsedBody();
        $keys = array_values(array_filter((array)($d['items'] ?? []), fn ($k) => isset(self::ITEMS[$k])));
        if (!$keys) return Http::error($res, 'No valid items to assign', 400);
        $due = trim((string)($d['due_date'] ?? ''));
        $due = preg_match('/^\d{4}-\d{2}-\d{2}$/', $due) ? $due : null;

        // Re-assigning an item the person already has just updates its due date rather
        // than erroring or duplicating (uq_member_item).
        $ins = $pdo->prepare(
            "INSERT INTO member_onboarding_tasks (member_id, item_key, assigned_by_id, assigned_at, due_date)
             VALUES (?, ?, ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE due_date = VALUES(due_date)");
        foreach ($keys as $k) $ins->execute([$memberId, $k, $actor ? (int)$actor['id'] : null, $due]);

        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'member_onboarding_tasks', $memberId, 'assign',
            null, ['items' => $keys, 'due_date' => $due]);

        return self::forMember($req, $res, ['member_id' => (string)$memberId]);
    }

    /**
     * POST /onboarding/tasks/{id}/complete — manual items only.
     * Compliance-backed items are deliberately NOT completable here: their date belongs
     * to the compliance record, and writing it in two places is how they drift apart.
     */
    public static function complete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        $id = (int)$route['id'];
        $s = $pdo->prepare("SELECT * FROM member_onboarding_tasks WHERE id = ?"); $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Item not found', 404);

        $def = self::ITEMS[$row['item_key']] ?? null;
        if ($def && str_starts_with($def['source'], 'compliance:')) {
            return Http::error($res, 'This item is tracked by the compliance record — record the date there and it updates here.', 400);
        }
        if ($def && $def['source'] === 'resume') {
            return Http::error($res, 'Finish your resume in the resume builder and this marks itself done.', 400);
        }
        // The member can tick their own manual items; anyone else needs the key.
        $isSelf = $actor !== null && (int)$actor['id'] === (int)$row['member_id'];
        if (!$isSelf && !self::perm($pdo, $actor, 'onboarding.manage', 'write')) return Http::error($res, 'Not permitted', 403);

        $d = (array)$req->getParsedBody();
        $done = !array_key_exists('complete', $d) || (bool)$d['complete'];
        $pdo->prepare("UPDATE member_onboarding_tasks SET completed_at = ?, completed_by_id = ? WHERE id = ?")
            ->execute([$done ? date('Y-m-d H:i:s') : null, $done && $actor ? (int)$actor['id'] : null, $id]);

        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'member_onboarding_tasks', $id,
            $done ? 'complete' : 'reopen', ['completed_at' => $row['completed_at']], ['completed_at' => $done ? 'now' : null]);

        return self::forMember($req, $res, ['member_id' => (string)(int)$row['member_id']]);
    }

    /** DELETE /onboarding/tasks/{id} — unassign. */
    public static function unassign(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'onboarding.manage', 'write')) return Http::error($res, 'Not permitted', 403);
        $id = (int)$route['id'];
        $s = $pdo->prepare("SELECT * FROM member_onboarding_tasks WHERE id = ?"); $s->execute([$id]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Item not found', 404);
        $pdo->prepare("DELETE FROM member_onboarding_tasks WHERE id = ?")->execute([$id]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'member_onboarding_tasks', $id, 'unassign', $row, null);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * GET /onboarding/outstanding — everyone with an open item, for the admin view.
     * Sorted most-overdue first, then longest-waiting.
     */
    public static function outstanding(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $actor, 'onboarding.view', 'read')) return Http::error($res, 'Not permitted', 403);

        $rows = $pdo->query(
            "SELECT t.*, m.first_name, m.last_name, m.member_type
               FROM member_onboarding_tasks t
               JOIN members m ON m.id = t.member_id
              ORDER BY t.member_id, t.assigned_at")->fetchAll();

        $byMember = [];
        foreach ($rows as $r) {
            $mid = (int)$r['member_id'];
            if (!isset($byMember[$mid])) {
                $byMember[$mid] = ['member_id' => $mid,
                    'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                    'member_type' => $r['member_type'], 'open' => [], 'complete_count' => 0];
            }
            // complianceState hits ComplianceService once per member, not once per row.
            $byMember[$mid]['_rows'][] = $r;
        }
        $today = date('Y-m-d');
        $out = [];
        foreach ($byMember as $mid => $entry) {
            $compliance = self::complianceState($pdo, $mid);
            $resumeDone = ResumeController::isComplete($pdo, $mid);
            foreach ($entry['_rows'] as $r) {
                $item = self::serialize($r, $compliance, $resumeDone);
                if ($item['is_complete']) { $entry['complete_count']++; continue; }
                $entry['open'][] = $item;
            }
            unset($entry['_rows']);
            if (!$entry['open']) continue;
            $entry['open_count'] = count($entry['open']);
            $overdue = array_filter($entry['open'], fn ($i) => $i['due_date'] !== null && $i['due_date'] < $today);
            $entry['overdue_count'] = count($overdue);
            $entry['oldest_assigned'] = min(array_map(fn ($i) => $i['assigned_at'], $entry['open']));
            $out[] = $entry;
        }
        usort($out, function ($a, $b) {
            if ($a['overdue_count'] !== $b['overdue_count']) return $b['overdue_count'] <=> $a['overdue_count'];
            return strcmp((string)$a['oldest_assigned'], (string)$b['oldest_assigned']);
        });

        return Http::json($res, ['total' => count($out), 'members' => $out]);
    }
}
