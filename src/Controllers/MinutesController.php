<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\HtmlSanitizer;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Meeting minutes (#107). Built for the YLC but group-agnostic. Action items can
 * be assigned to a member and are mirrored into the Tasks module (task_id) so
 * they show up in that person's task list; completing either side syncs the other.
 */
final class MinutesController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::hasAnyRole($pdo, $m, ['Mentor']); // Admin/SysAdmin pass as super
    }

    // ── Group privacy ─────────────────────────────────────────────────────────
    // Minutes are keyed by a group label. A PRIVATE group (member_groups.is_private,
    // e.g. the TRCF board) limits both reading and editing its minutes to that group's
    // members + admins; every other group keeps the old rules (any signed-in member can
    // read, Mentor+ can edit).

    /** ['id'=>int,'private'=>bool,'public_view'=>bool] for a group label, or null if there's no such group. */
    private static function groupFor(PDO $pdo, ?string $label): ?array
    {
        if ($label === null || trim($label) === '') return null;
        $s = $pdo->prepare("SELECT id, is_private, public_view, source FROM member_groups WHERE name = ? LIMIT 1");
        $s->execute([$label]);
        $r = $s->fetch();
        return $r ? ['id' => (int)$r['id'], 'private' => (bool)$r['is_private'],
            'public_view' => (bool)($r['public_view'] ?? false), 'source' => $r['source'] ?? 'manual'] : null;
    }

    /**
     * Is this member on the group's roster? The auto-managed YLC group (source='ylc')
     * draws its members from youth_roles.ylc_member — NOT the manual member_group_members
     * table — so it must be checked there, or every YLC youth is wrongly treated as a
     * non-member and locked out of a private YLC's page.
     */
    private static function inGroup(PDO $pdo, int $memberId, array $g): bool
    {
        if (($g['source'] ?? 'manual') === 'ylc') {
            $y = $pdo->prepare("SELECT 1 FROM youth_roles WHERE member_id = ? AND ylc_member = 1 LIMIT 1");
            $y->execute([$memberId]);
            return (bool)$y->fetchColumn();
        }
        $s = $pdo->prepare("SELECT 1 FROM member_group_members WHERE group_id = ? AND member_id = ? LIMIT 1");
        $s->execute([(int)$g['id'], $memberId]);
        return (bool)$s->fetchColumn();
    }

    /** This member's officer role within the group (from the YLC roster or the manual table). */
    private static function groupRoleLabel(PDO $pdo, int $memberId, array $g): string
    {
        if (($g['source'] ?? 'manual') === 'ylc') {
            $y = $pdo->prepare("SELECT ylc_role FROM youth_roles WHERE member_id = ? AND ylc_member = 1 LIMIT 1");
            $y->execute([$memberId]);
            return (string)($y->fetchColumn() ?: '');
        }
        $s = $pdo->prepare("SELECT role_label FROM member_group_members WHERE group_id = ? AND member_id = ? LIMIT 1");
        $s->execute([(int)$g['id'], $memberId]);
        return (string)($s->fetchColumn() ?: '');
    }

    private static function isAdmin(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::isSuperAdmin($pdo, $m); // super roles (Admin/SysAdmin) only
    }

    /**
     * May this member VIEW a group's minutes? Public / unknown groups → anyone. A
     * private group with public_view (e.g. the Program Team) is readable by everyone
     * too — only its management stays limited. A plain private group (TRCF Board) →
     * members + admins.
     */
    public static function canViewGroup(PDO $pdo, ?array $m, ?string $label): bool
    {
        if ($m === null) return false;
        $g = self::groupFor($pdo, $label);
        if (!$g || !$g['private'] || $g['public_view']) return true;
        return self::isAdmin($pdo, $m) || self::inGroup($pdo, (int)$m['id'], $g);
    }

    /** May this member CREATE/EDIT a group's minutes? Private → members + admins; else Mentor+. */
    private static function canManageGroup(PDO $pdo, ?array $m, ?string $label): bool
    {
        if ($m === null) return false;
        $g = self::groupFor($pdo, $label);
        if ($g && $g['private']) return self::isAdmin($pdo, $m) || self::inGroup($pdo, (int)$m['id'], $g);
        return self::canManage($pdo, $m);
    }

    /** The group label a meeting belongs to (null if the meeting is gone). */
    private static function meetingGroup(PDO $pdo, int $meetingId): ?string
    {
        $s = $pdo->prepare("SELECT group_label FROM meetings WHERE id = ?");
        $s->execute([$meetingId]);
        $v = $s->fetchColumn();
        return $v === false ? null : (string)$v;
    }

    // ── Locking ───────────────────────────────────────────────────────────────
    // A meeting is locked once the board reviews + approves it — freezing the agenda,
    // minutes, attendees and action items. Only an officer of the group (President /
    // Vice President / Secretary) or a System Administrator may lock or unlock.
    private const LOCK_POSITIONS = ['President', 'Vice President', 'Secretary'];

    private static function canLock(PDO $pdo, ?array $m, ?string $label): bool
    {
        if ($m === null) return false;
        if (self::isAdmin($pdo, $m)) return true;
        $g = self::groupFor($pdo, $label);
        if (!$g) return false;
        return in_array(self::groupRoleLabel($pdo, (int)$m['id'], $g), self::LOCK_POSITIONS, true);
    }

    private static function isLocked(PDO $pdo, int $meetingId): bool
    {
        $s = $pdo->prepare("SELECT locked_at FROM meetings WHERE id = ?");
        $s->execute([$meetingId]);
        return !empty($s->fetchColumn());
    }

    /** Guard for a mutating call: 409 when the meeting is locked. */
    private static function lockedError(PDO $pdo, Response $res, int $meetingId): ?Response
    {
        return self::isLocked($pdo, $meetingId)
            ? Http::error($res, 'This meeting is locked. An officer must unlock it before making changes.', 409)
            : null;
    }

    private static function memberName(PDO $pdo, ?int $id): ?string
    {
        if (!$id) return null;
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $r = $s->fetch(); return $r ? trim("{$r['first_name']} {$r['last_name']}") : null;
    }

    // ── Action-item assignees (multiple per item) ─────────────────────────────
    /** Everyone assigned to an action item: [['member_id'=>int,'name'=>string], …]. */
    private static function actionAssignees(PDO $pdo, int $actionId): array
    {
        $s = $pdo->prepare(
            "SELECT x.member_id, mem.first_name, mem.last_name
               FROM meeting_action_item_assignees x JOIN members mem ON mem.id = x.member_id
              WHERE x.action_item_id = ? ORDER BY mem.last_name, mem.first_name");
        $s->execute([$actionId]);
        return array_map(fn ($r) => ['member_id' => (int)$r['member_id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name'])], $s->fetchAll());
    }

    /** Assignee ids from a request body — the multi field, or the legacy single field. */
    private static function assigneeIds(array $d): array
    {
        if (array_key_exists('assignee_member_ids', $d) && is_array($d['assignee_member_ids'])) {
            return array_values(array_unique(array_filter(array_map('intval', $d['assignee_member_ids']))));
        }
        return !empty($d['assignee_member_id']) ? [(int)$d['assignee_member_id']] : [];
    }

    /** Replace an action item's assignees; the legacy single column tracks the first. */
    private static function setActionAssignees(PDO $pdo, int $actionId, array $memberIds): void
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $memberIds))));
        $pdo->prepare("DELETE FROM meeting_action_item_assignees WHERE action_item_id = ?")->execute([$actionId]);
        $ins = $pdo->prepare("INSERT IGNORE INTO meeting_action_item_assignees (action_item_id, member_id) VALUES (?, ?)");
        foreach ($ids as $mid) $ins->execute([$actionId, $mid]);
        $pdo->prepare("UPDATE meeting_action_items SET assignee_member_id = ? WHERE id = ?")->execute([$ids[0] ?? null, $actionId]);
    }

    /**
     * GET /minutes/manage-scope?group=X — what the caller may do with a group's minutes.
     * Lets the list page show "New meeting" by group membership (not just Mentor role),
     * so a group like the Program Team is run by its tagged members whatever their type.
     */
    public static function manageScope(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $group = (string)($req->getQueryParams()['group'] ?? '');
        return Http::json($res, [
            'can_view' => self::canViewGroup($pdo, $cur, $group),
            'can_manage' => self::canManageGroup($pdo, $cur, $group),
        ]);
    }

    // ── Meetings ─────────────────────────────────────────────────────────────
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        // A request for a specific private group is refused for non-members.
        if (!empty($q['group']) && !self::canViewGroup($pdo, $cur, (string)$q['group'])) {
            return Http::error($res, 'Access denied', 403);
        }
        $where = []; $args = [];
        if (!empty($q['group'])) { $where[] = 'group_label = ?'; $args[] = $q['group']; }
        $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $s = $pdo->prepare(
            "SELECT m.*,
                    (SELECT COUNT(*) FROM meeting_action_items a WHERE a.meeting_id = m.id) AS action_count,
                    (SELECT COUNT(*) FROM meeting_action_items a WHERE a.meeting_id = m.id AND a.status = 'open') AS open_actions
             FROM meetings m $clause ORDER BY (m.meeting_date IS NULL), m.meeting_date DESC, m.id DESC");
        $s->execute($args);
        $out = array_map(fn($m) => [
            'id' => (int)$m['id'], 'group_label' => $m['group_label'], 'title' => $m['title'],
            'meeting_date' => $m['meeting_date'], 'location' => $m['location'],
            'action_count' => (int)$m['action_count'], 'open_actions' => (int)$m['open_actions'],
        ], $s->fetchAll());
        // Never leak private-group meetings the viewer can't see (covers the no-group,
        // all-meetings case). Cheap: only private groups trigger a membership check.
        $out = array_values(array_filter($out, fn($m) => self::canViewGroup($pdo, $cur, $m['group_label'])));
        return Http::json($res, $out);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['meeting_id'];
        $s = $pdo->prepare(
            "SELECT m.*, e.name AS event_name, e.event_date AS event_date_of
             FROM meetings m LEFT JOIN events e ON e.id = m.event_id WHERE m.id = ?");
        $s->execute([$id]);
        $m = $s->fetch();
        if (!$m) return Http::error($res, 'Meeting not found', 404);
        if (!self::canViewGroup($pdo, $cur, $m['group_label'])) return Http::error($res, 'Access denied', 403);

        $at = $pdo->prepare("SELECT * FROM meeting_attendees WHERE meeting_id = ? ORDER BY id"); $at->execute([$id]);
        $attendees = array_map(fn($a) => [
            'id' => (int)$a['id'], 'member_id' => $a['member_id'] !== null ? (int)$a['member_id'] : null,
            'name' => $a['member_id'] !== null ? self::memberName($pdo, (int)$a['member_id']) : $a['name'],
        ], $at->fetchAll());

        $ai = $pdo->prepare("SELECT * FROM meeting_action_items WHERE meeting_id = ? ORDER BY id"); $ai->execute([$id]);
        $actions = array_map(function ($a) use ($pdo) {
            $assignees = self::actionAssignees($pdo, (int)$a['id']);
            return [
                'id' => (int)$a['id'], 'description' => $a['description'],
                // Multiple assignees; the singular fields remain as the first, for any
                // reader that still expects one.
                'assignees' => $assignees,
                'assignee_member_id' => $assignees[0]['member_id'] ?? null,
                'assignee_name' => $assignees[0]['name'] ?? null,
                'due_date' => $a['due_date'], 'status' => $a['status'], 'task_id' => $a['task_id'] !== null ? (int)$a['task_id'] : null,
            ];
        }, $ai->fetchAll());

        // Roster of the meeting's group (when the label maps to a member group) — the
        // "who's invited" list the attendance checklist ticks off. Empty otherwise. The
        // roster honours the group's source, the same way GroupsController does: an
        // auto-managed 'ylc' group draws its members from the current YLC roster
        // (youth_roles.ylc_member) rather than the manual member_group_members table.
        $groupMembers = [];
        $g = self::groupFor($pdo, $m['group_label']);
        if ($g) {
            if (($g['source'] ?? 'manual') === 'ylc') {
                $rm = $pdo->query(
                    "SELECT mem.id, mem.first_name, mem.last_name
                       FROM youth_roles y JOIN members mem ON mem.id = y.member_id
                      WHERE y.ylc_member = 1 AND mem.is_active = 1 AND (mem.is_archived = 0 OR mem.is_archived IS NULL)
                      ORDER BY mem.last_name, mem.first_name");
            } else {
                $rm = $pdo->prepare(
                    "SELECT mem.id, mem.first_name, mem.last_name FROM member_group_members gm
                       JOIN members mem ON mem.id = gm.member_id
                      WHERE gm.group_id = ? AND (mem.is_archived = 0 OR mem.is_archived IS NULL)
                      ORDER BY mem.last_name, mem.first_name");
                $rm->execute([$g['id']]);
            }
            $groupMembers = array_map(fn($r) => [
                'member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            ], $rm->fetchAll());
        }

        return Http::json($res, [
            'id' => (int)$m['id'], 'group_label' => $m['group_label'], 'title' => $m['title'],
            'meeting_date' => $m['meeting_date'], 'location' => $m['location'],
            'agenda' => $m['agenda'] ?? null, 'notes' => $m['notes'],
            'event_id' => $m['event_id'] !== null ? (int)$m['event_id'] : null,
            'event_name' => $m['event_name'] ?? null, 'event_date' => $m['event_date_of'] ?? null,
            'created_by' => self::memberName($pdo, $m['created_by_id'] !== null ? (int)$m['created_by_id'] : null),
            'created_at' => $m['created_at'],
            'updated_by' => self::memberName($pdo, isset($m['updated_by_id']) && $m['updated_by_id'] !== null ? (int)$m['updated_by_id'] : null),
            'updated_at' => $m['updated_at'],
            'attendees' => $attendees, 'action_items' => $actions,
            'group_members' => $groupMembers,
            'can_manage' => self::canManageGroup($pdo, $cur, $m['group_label']),
            // Locking: frozen after board approval; only officers/admins toggle it.
            'locked' => !empty($m['locked_at']),
            'locked_at' => $m['locked_at'] ?? null,
            'locked_by' => self::memberName($pdo, isset($m['locked_by_id']) && $m['locked_by_id'] !== null ? (int)$m['locked_by_id'] : null),
            'can_lock' => self::canLock($pdo, $cur, $m['group_label']),
        ]);
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $d = (array)$req->getParsedBody();
        if (!self::canManageGroup($pdo, $cur, $d['group_label'] ?? 'YLC')) return Http::error($res, 'Access denied', 403);
        if (empty($d['title'])) return Http::error($res, 'A title is required.', 422);
        // Security #2: sanitize rich-text on write (stored XSS in minutes).
        $agenda = isset($d['agenda']) && $d['agenda'] !== null ? HtmlSanitizer::clean((string)$d['agenda']) : null;
        $notes  = isset($d['notes']) && $d['notes'] !== null ? HtmlSanitizer::clean((string)$d['notes']) : null;
        $pdo->prepare("INSERT INTO meetings (group_label, event_id, title, agenda, meeting_date, location, notes, created_by_id, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())")
            ->execute([$d['group_label'] ?? 'YLC', ($d['event_id'] ?? '') === '' ? null : (int)$d['event_id'], $d['title'], $agenda, ($d['meeting_date'] ?? '') ?: null, $d['location'] ?? null, $notes, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'meetings', $id, 'create', null, ['title' => $d['title']]);
        return self::get($req, $res, ['meeting_id' => $id]);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $id = (int)$route['meeting_id'];
        if (!self::canManageGroup($pdo, $cur, self::meetingGroup($pdo, $id))) return Http::error($res, 'Access denied', 403);
        if ($e = self::lockedError($pdo, $res, $id)) return $e;
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['group_label', 'title', 'agenda', 'meeting_date', 'location', 'notes', 'event_id'] as $f) {
            if (array_key_exists($f, $d)) {
                $v = $d[$f];
                if (($f === 'meeting_date' || $f === 'event_id') && ($v === '' || $v === null)) $v = null;
                elseif ($f === 'event_id') $v = (int)$v;
                // Security #2: rich-text fields are sanitized on write (stored XSS in minutes).
                elseif (($f === 'agenda' || $f === 'notes') && $v !== null) $v = HtmlSanitizer::clean((string)$v);
                $set[] = "$f = ?"; $args[] = $v;
            }
        }
        if ($set) {
            $set[] = 'updated_at = NOW()';
            $set[] = 'updated_by_id = ?'; $args[] = (int)$cur['id'];
            $args[] = $id;
            $pdo->prepare("UPDATE meetings SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
            Audit::write($pdo, (int)$cur['id'], 'meetings', $id, 'update', null, ['fields' => array_keys($d)]);
        }
        return self::get($req, $res, ['meeting_id' => $id]);
    }

    /** Events tied to a group (by name) — for the "tie this meeting to an event"
     *  picker. Includes recent past (last 90 days) and all future events. */
    public static function eventOptions(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $group = $req->getQueryParams()['group'] ?? 'YLC';
        if (!self::canViewGroup($pdo, $cur, $group)) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare(
            "SELECT DISTINCT e.id, e.name, e.event_date FROM events e
             JOIN event_groups eg ON eg.event_id = e.id
             JOIN member_groups g ON g.id = eg.group_id
             WHERE g.name = ? AND (e.event_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) OR e.event_date IS NULL)
             ORDER BY e.event_date DESC LIMIT 60");
        $s->execute([$group]);
        return Http::json($res, array_map(fn($e) => [
            'id' => (int)$e['id'], 'name' => $e['name'], 'event_date' => $e['event_date'],
        ], $s->fetchAll()));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $id = (int)$route['meeting_id'];
        if (!self::canManageGroup($pdo, $cur, self::meetingGroup($pdo, $id))) return Http::error($res, 'Access denied', 403);
        if ($e = self::lockedError($pdo, $res, $id)) return $e;
        $pdo->prepare("DELETE FROM meeting_attendees WHERE meeting_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM meeting_action_items WHERE meeting_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM meetings WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'meetings', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Attendees ────────────────────────────────────────────────────────────
    public static function setAttendees(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $id = (int)$route['meeting_id'];
        if (!self::canManageGroup($pdo, $cur, self::meetingGroup($pdo, $id))) return Http::error($res, 'Access denied', 403);
        if ($e = self::lockedError($pdo, $res, $id)) return $e;
        $d = (array)$req->getParsedBody();
        $pdo->prepare("DELETE FROM meeting_attendees WHERE meeting_id = ?")->execute([$id]);
        $insM = $pdo->prepare("INSERT INTO meeting_attendees (meeting_id, member_id) VALUES (?, ?)");
        foreach (array_unique(array_map('intval', (array)($d['member_ids'] ?? []))) as $mid) { if ($mid > 0) $insM->execute([$id, $mid]); }
        $insN = $pdo->prepare("INSERT INTO meeting_attendees (meeting_id, name) VALUES (?, ?)");
        foreach ((array)($d['guest_names'] ?? []) as $nm) { $nm = trim((string)$nm); if ($nm !== '') $insN->execute([$id, $nm]); }
        Audit::write($pdo, (int)$cur['id'], 'meetings', $id, 'attendees.set', null, ['member_ids' => array_values(array_map('intval', (array)($d['member_ids'] ?? [])))]);
        return self::get($req, $res, ['meeting_id' => $id]);
    }

    // ── Action items ─────────────────────────────────────────────────────────
    // Action items live entirely on the meeting (assignee, due date, status).
    // They are shown to the assignee on the meeting page; there is no separate
    // task list to mirror into — TRC/Team Tasks is the single task feature.
    public static function addAction(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $meetingId = (int)$route['meeting_id'];
        if (!self::canManageGroup($pdo, $cur, self::meetingGroup($pdo, $meetingId))) return Http::error($res, 'Access denied', 403);
        if ($e = self::lockedError($pdo, $res, $meetingId)) return $e;
        $d = (array)$req->getParsedBody();
        if (empty($d['description'])) return Http::error($res, 'Describe the action item.', 422);
        $ids = self::assigneeIds($d);
        $due = ($d['due_date'] ?? '') ?: null;

        $pdo->prepare("INSERT INTO meeting_action_items (meeting_id, description, assignee_member_id, due_date, status, task_id, created_by_id, created_at) VALUES (?,?,?,?, 'open', NULL, ?, NOW())")
            ->execute([$meetingId, $d['description'], $ids[0] ?? null, $due, (int)$cur['id']]);
        $newId = (int)$pdo->lastInsertId();
        if ($ids) self::setActionAssignees($pdo, $newId, $ids);
        Audit::write($pdo, (int)$cur['id'], 'meeting_action_items', $newId, 'create', null, ['meeting_id' => $meetingId]);
        return self::get($req, $res, ['meeting_id' => $meetingId]);
    }

    public static function updateAction(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $aid = (int)$route['action_id'];
        $s = $pdo->prepare("SELECT * FROM meeting_action_items WHERE id = ?"); $s->execute([$aid]);
        $a = $s->fetch();
        if (!$a) return Http::error($res, 'Action item not found', 404);
        if (!self::canManageGroup($pdo, $cur, self::meetingGroup($pdo, (int)$a['meeting_id']))) return Http::error($res, 'Access denied', 403);
        if ($e = self::lockedError($pdo, $res, (int)$a['meeting_id'])) return $e;
        $d = (array)$req->getParsedBody();

        $desc = array_key_exists('description', $d) ? (string)$d['description'] : (string)$a['description'];
        $due = array_key_exists('due_date', $d) ? (($d['due_date'] ?: null)) : $a['due_date'];
        $status = array_key_exists('status', $d) ? (string)$d['status'] : (string)$a['status'];

        // Reassign only when the caller sent assignees; a plain status toggle leaves them.
        if (array_key_exists('assignee_member_ids', $d) || array_key_exists('assignee_member_id', $d)) {
            self::setActionAssignees($pdo, $aid, self::assigneeIds($d));
        }
        $pdo->prepare("UPDATE meeting_action_items SET description = ?, due_date = ?, status = ? WHERE id = ?")
            ->execute([$desc, $due, $status, $aid]);
        Audit::write($pdo, (int)$cur['id'], 'meeting_action_items', $aid, 'update', null, $d);
        return self::get($req, $res, ['meeting_id' => (int)$a['meeting_id']]);
    }

    public static function deleteAction(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $aid = (int)$route['action_id'];
        $s = $pdo->prepare("SELECT * FROM meeting_action_items WHERE id = ?"); $s->execute([$aid]);
        $a = $s->fetch();
        if (!$a) return Http::error($res, 'Not found', 404);
        if (!self::canManageGroup($pdo, $cur, self::meetingGroup($pdo, (int)$a['meeting_id']))) return Http::error($res, 'Access denied', 403);
        if ($e = self::lockedError($pdo, $res, (int)$a['meeting_id'])) return $e;
        $pdo->prepare("DELETE FROM meeting_action_items WHERE id = ?")->execute([$aid]);
        Audit::write($pdo, (int)$cur['id'], 'meeting_action_items', $aid, 'delete', null, null);
        return self::get($req, $res, ['meeting_id' => (int)$a['meeting_id']]);
    }

    // ── Lock / unlock ─────────────────────────────────────────────────────────
    /** POST /meetings/{id}/lock — freeze the meeting after board approval. */
    public static function lock(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $id = (int)$route['meeting_id'];
        $group = self::meetingGroup($pdo, $id);
        if ($group === null) return Http::error($res, 'Meeting not found', 404);
        if (!self::canLock($pdo, $cur, $group)) {
            return Http::error($res, 'Only a board officer (President, Vice President or Secretary) or an administrator can lock the minutes.', 403);
        }
        $pdo->prepare("UPDATE meetings SET locked_at = NOW(), locked_by_id = ? WHERE id = ?")->execute([(int)$cur['id'], $id]);
        Audit::write($pdo, (int)$cur['id'], 'meetings', $id, 'lock', null, null);
        return self::get($req, $res, ['meeting_id' => $id]);
    }

    /** POST /meetings/{id}/unlock — reopen a locked meeting to make a correction. */
    public static function unlock(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $id = (int)$route['meeting_id'];
        $group = self::meetingGroup($pdo, $id);
        if ($group === null) return Http::error($res, 'Meeting not found', 404);
        if (!self::canLock($pdo, $cur, $group)) {
            return Http::error($res, 'Only a board officer or an administrator can unlock the minutes.', 403);
        }
        $pdo->prepare("UPDATE meetings SET locked_at = NULL, locked_by_id = NULL WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'meetings', $id, 'unlock', null, null);
        return self::get($req, $res, ['meeting_id' => $id]);
    }
}
