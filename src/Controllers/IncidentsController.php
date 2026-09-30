<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\IncidentTypes;
use App\Core\IncidentVault;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Incident Reports (Phase 1). Report intake → triage → notify → corrective action → close, plus a
 * lightweight First Aid Log. See docs/INCIDENT_REPORTS_SPEC.md.
 *
 * Anonymity (§7): an anonymous submit stores reporter_id = NULL and seals the real identity via
 * IncidentVault::seal (recoverable only out-of-band). The three §7.4 leaks are plugged here:
 *   - audit rows for anonymous submits use actor_id = NULL and suppress the IP,
 *   - usage telemetry is dropped for the report route (UsageController::track),
 *   - anonymous incidents render date-only (no clock time) everywhere.
 *
 * All authorization is on permission KEYS (§10). Relationship access (self / a youth's guardian /
 * a mentor on the involved team) is separate from, and additive to, the permission check.
 */
final class IncidentsController
{
    private const SEV = ['minor' => 1, 'moderate' => 2, 'serious' => 3, 'critical' => 4];
    private const MAX_UPLOAD = 10 * 1024 * 1024;
    private const ALLOWED_UP = [
        'image/jpeg' => '.jpg', 'image/png' => '.png', 'image/gif' => '.gif', 'image/webp' => '.webp',
        'application/pdf' => '.pdf',
    ];

    // ── permission helpers ──────────────────────────────────────────────────
    private static function can(PDO $pdo, ?array $m, string $key, string $level = 'write'): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    // ── POST /incidents ─────────────────────────────────────────────────────
    public static function submit(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.report', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();

        $type = strtolower(trim((string)($d['type'] ?? '')));
        if (!IncidentTypes::isValid($type)) return Http::error($res, 'Unknown incident type.', 422);
        if (!IncidentTypes::isPhase1($type)) return Http::error($res, 'That incident type is not available yet.', 422);

        $reporterSeverity = strtolower(trim((string)($d['reporter_severity'] ?? '')));
        if (!isset(self::SEV[$reporterSeverity])) return Http::error($res, 'Choose a severity.', 422);
        $description = trim((string)($d['description'] ?? ''));
        if ($description === '') return Http::error($res, 'Describe what happened.', 422);

        $locationKind = strtolower(trim((string)($d['location_kind'] ?? '')));
        if (!in_array($locationKind, ['trc', 'offsite', 'other'], true)) $locationKind = 'trc';

        $isAnon = !empty($d['is_anonymous']);
        $occurredAt = trim((string)($d['occurred_at'] ?? '')) ?: date('Y-m-d H:i:s');
        // Normalize an ISO 'T' to a space so MySQL DATETIME accepts it.
        $occurredAt = str_replace('T', ' ', $occurredAt);

        // Auto-escalation (§6.8), computed server-side. Any trigger raises the floor to 'serious'.
        $injury = is_array($d['injury'] ?? null) ? $d['injury'] : [];
        $emsCalled = !empty($d['ems_called']);
        $ongoingRisk = !empty($d['ongoing_risk']);
        $escalated =
            !empty($injury['rescue_med']) ||
            !empty($injury['loss_of_consciousness']) ||
            (($injury['treatment_level'] ?? '') === 'ems_transport') ||
            $emsCalled || $ongoingRisk;
        $floor = $escalated ? 'serious' : null;
        // Pre-triage severity: reflect the escalation floor immediately if it exceeds the reporter's.
        $severity = null;
        if ($floor !== null && self::SEV[$floor] > self::SEV[$reporterSeverity]) $severity = $floor;

        // Behavior based on a protected characteristic → sensitive + separate route (§6.4).
        $isSensitive = IncidentTypes::isSensitive($type) || !empty(($d['detail']['protected_basis'] ?? null));
        $isRestricted = IncidentTypes::isRestricted($type);   // always false for Phase 1

        $row = [
            'type' => $type,
            'severity' => $severity,
            'reporter_severity' => $reporterSeverity,
            'status' => 'submitted',
            'is_anonymous' => $isAnon ? 1 : 0,
            'reporter_id' => $isAnon ? null : (int)$m['id'],
            'filed_for_member_id' => !empty($d['filed_for_member_id']) ? (int)$d['filed_for_member_id'] : null,
            'filed_for_name' => trim((string)($d['filed_for_name'] ?? '')) ?: null,
            'filed_for_relationship' => trim((string)($d['filed_for_relationship'] ?? '')) ?: null,
            'occurred_at' => $occurredAt,
            'occurred_approx' => !empty($d['occurred_approx']) ? 1 : 0,
            'location_kind' => $locationKind,
            'location_area' => trim((string)($d['location_area'] ?? '')) ?: null,
            'location_other' => trim((string)($d['location_other'] ?? '')) ?: null,
            'event_id' => !empty($d['event_id']) ? (int)$d['event_id'] : null,
            'team_id' => !empty($d['team_id']) ? (int)$d['team_id'] : null,
            'description' => $description,
            'immediate_actions' => trim((string)($d['immediate_actions'] ?? '')) ?: null,
            'notified_at_time' => isset($d['notified_at_time']) ? json_encode($d['notified_at_time']) : null,
            'ems_called' => $emsCalled ? 1 : 0,
            'police_called' => !empty($d['police_called']) ? 1 : 0,
            'parent_notified' => !empty($d['parent_notified']) ? 1 : 0,
            'parent_notified_at' => !empty($d['parent_notified_at']) ? str_replace('T', ' ', (string)$d['parent_notified_at']) : null,
            'parent_notified_by_id' => !empty($d['parent_notified_by_id']) ? (int)$d['parent_notified_by_id'] : null,
            'parent_notify_method' => trim((string)($d['parent_notify_method'] ?? '')) ?: null,
            'parent_notify_result' => trim((string)($d['parent_notify_result'] ?? '')) ?: null,
            'ongoing_risk' => $ongoingRisk ? 1 : 0,
            'is_sensitive' => $isSensitive ? 1 : 0,
            'is_restricted' => $isRestricted ? 1 : 0,
            'detail' => isset($d['detail']) && $d['detail'] !== null ? json_encode($d['detail']) : null,
            'board_reportable' => 0,
            'retention_hold' => 1,
        ];
        $cols = array_keys($row);
        $ins = $pdo->prepare("INSERT INTO incident_reports (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")");
        $ins->execute(array_values($row));
        $id = (int)$pdo->lastInsertId();

        // Readable, per-year reference number.
        $pdo->prepare("UPDATE incident_reports SET ref_no = CONCAT('INC-', YEAR(created_at), '-', LPAD(id, 4, '0')) WHERE id = ?")->execute([$id]);

        // People involved.
        foreach ((array)($d['people'] ?? []) as $p) {
            if (!is_array($p)) continue;
            $pname = trim((string)($p['name'] ?? ''));
            $pmid = !empty($p['member_id']) ? (int)$p['member_id'] : null;
            if ($pmid === null && $pname === '') continue;
            $prole = in_array(($p['person_role'] ?? ''), ['affected', 'witness', 'involved', 'responder'], true) ? $p['person_role'] : 'affected';
            $pdo->prepare("INSERT INTO incident_people (incident_id, member_id, name, person_role, is_youth, notes) VALUES (?,?,?,?,?,?)")
                ->execute([$id, $pmid, $pname ?: null, $prole, isset($p['is_youth']) ? (int)!empty($p['is_youth']) : null, trim((string)($p['notes'] ?? '')) ?: null]);
        }

        // Flat injury/medical facts (1:1) when supplied.
        if ($injury) self::saveInjury($pdo, $id, $injury);

        // Anonymity: seal the real identity and audit WITHOUT naming the submitter or their IP.
        if ($isAnon) {
            $sealed = IncidentVault::seal($pdo, $id, [
                'member_id' => (int)$m['id'],
                'name' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')),
                'email' => $m['email'] ?? null,
                'ip' => self::clientIp($req),
                'user_agent' => $req->getHeaderLine('User-Agent') ?: null,
                'submitted_at' => date('Y-m-d H:i:s'),
            ]);
            // actor_id NULL + empty IP so the audit row cannot name or locate the reporter (§7.4).
            Audit::write($pdo, null, 'incident_reports', $id, 'incident.submit_anonymous', null, ['type' => $type, 'sealed' => $sealed], null, '');
        } else {
            Audit::write($pdo, (int)$m['id'], 'incident_reports', $id, 'incident.submit', null, ['type' => $type, 'ref' => $id]);
        }

        // Fire the routing rules immediately (§8). Failures are logged, never fatal to the submit.
        $fresh = self::loadIncident($pdo, $id);
        try { self::route($pdo, $fresh); } catch (\Throwable $e) { error_log('[TRCMS] incident routing failed: ' . $e->getMessage()); }

        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, $id), true, $m), 201);
    }

    // ── GET /incidents (queue) ──────────────────────────────────────────────
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.queue', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['status'])) { $where[] = 'status = ?'; $args[] = $q['status']; }
        if (!empty($q['type'])) { $where[] = 'type = ?'; $args[] = $q['type']; }
        if (!empty($q['severity'])) { $where[] = 'severity = ?'; $args[] = $q['severity']; }
        if (!empty($q['assigned'])) { $where[] = 'assigned_to_id = ?'; $args[] = (int)$q['assigned']; }
        if (!empty($q['from'])) { $where[] = 'occurred_at >= ?'; $args[] = $q['from'] . ' 00:00:00'; }
        if (!empty($q['to'])) { $where[] = 'occurred_at <= ?'; $args[] = $q['to'] . ' 23:59:59'; }
        // Phase 1: restricted incidents never surface in the standard queue.
        $where[] = 'is_restricted = 0';
        $sql = "SELECT * FROM incident_reports" . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY (status <> 'closed') DESC, occurred_at DESC LIMIT 500";
        $st = $pdo->prepare($sql); $st->execute($args);
        $out = array_map(fn($r) => self::serialize($pdo, $r, true, $m, true), $st->fetchAll());
        return Http::json($res, $out);
    }

    // ── GET /incidents/mine ─────────────────────────────────────────────────
    public static function mine(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.view_own', 'read')) return Http::error($res, 'Access denied', 403);
        // Keyed strictly on reporter_id — anonymous rows are NULL and can never match (§7.4).
        $st = $pdo->prepare("SELECT * FROM incident_reports WHERE reporter_id = ? ORDER BY occurred_at DESC");
        $st->execute([(int)$m['id']]);
        $out = array_map(fn($r) => self::serialize($pdo, $r, false, $m, true), $st->fetchAll());
        return Http::json($res, $out);
    }

    // ── GET /incidents/{id} ─────────────────────────────────────────────────
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $handler = self::can($pdo, $m, 'incidents.queue', 'read');
        if (!$handler && !self::canViewOwn($pdo, $m, $inc)) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::serialize($pdo, $inc, $handler, $m));
    }

    // ── POST /incidents/{id}/notes ──────────────────────────────────────────
    public static function addNote(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        // Notes are a handler surface (addenda, witness statements, triage/closure notes).
        if (!self::can($pdo, $m, 'incidents.queue', 'read')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();
        $body = trim((string)($d['body'] ?? ''));
        if ($body === '') return Http::error($res, 'Note is empty.', 422);
        $kind = in_array(($d['note_kind'] ?? ''), ['addendum', 'witness_statement', 'triage', 'closure'], true) ? $d['note_kind'] : 'addendum';
        // Triage/closure notes require the triage permission.
        if (in_array($kind, ['triage', 'closure'], true) && !self::can($pdo, $m, 'incidents.triage', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $visibility = ($d['visibility'] ?? '') === 'restricted' ? 'restricted' : 'standard';
        $pdo->prepare("INSERT INTO incident_notes (incident_id, author_id, body, note_kind, visibility) VALUES (?,?,?,?,?)")
            ->execute([(int)$inc['id'], (int)$m['id'], $body, $kind, $visibility]);
        Audit::write($pdo, (int)$m['id'], 'incident_notes', (int)$inc['id'], 'incident.note', null, ['kind' => $kind]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m), 201);
    }

    // ── POST /incidents/{id}/triage ─────────────────────────────────────────
    public static function triage(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.triage', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();

        $set = []; $args = [];
        if (!empty($d['type']) && IncidentTypes::isValid((string)$d['type']) && IncidentTypes::isPhase1((string)$d['type'])) {
            $set[] = 'type = ?'; $args[] = $d['type'];
            $set[] = 'is_sensitive = ?'; $args[] = IncidentTypes::isSensitive((string)$d['type']) ? 1 : 0;
        }
        if (!empty($d['severity']) && isset(self::SEV[strtolower((string)$d['severity'])])) { $set[] = 'severity = ?'; $args[] = strtolower((string)$d['severity']); }
        if (array_key_exists('assigned_to_id', $d)) { $set[] = 'assigned_to_id = ?'; $args[] = !empty($d['assigned_to_id']) ? (int)$d['assigned_to_id'] : null; }
        if (array_key_exists('board_reportable', $d)) { $set[] = 'board_reportable = ?'; $args[] = !empty($d['board_reportable']) ? 1 : 0; }
        if (array_key_exists('external_notified', $d)) { $set[] = 'external_notified = ?'; $args[] = json_encode($d['external_notified']); }
        if (array_key_exists('retention_hold', $d)) { $set[] = 'retention_hold = ?'; $args[] = !empty($d['retention_hold']) ? 1 : 0; }
        if (array_key_exists('retention_review_on', $d)) { $set[] = 'retention_review_on = ?'; $args[] = $d['retention_review_on'] ?: null; }
        if (array_key_exists('follow_up_due', $d)) { $set[] = 'follow_up_due = ?'; $args[] = $d['follow_up_due'] ?: null; }
        // Advance status to at least 'triaged'.
        $newStatus = in_array(($d['status'] ?? ''), ['triaged', 'in_review', 'awaiting_action'], true) ? $d['status'] : 'triaged';
        $set[] = 'status = ?'; $args[] = $newStatus;
        $set[] = 'triaged_at = COALESCE(triaged_at, NOW())';
        $set[] = 'triaged_by_id = ?'; $args[] = (int)$m['id'];

        $args[] = (int)$inc['id'];
        $pdo->prepare("UPDATE incident_reports SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'incident_reports', (int)$inc['id'], 'incident.triage', null, $d);

        // Re-run routing on the confirmed severity/type (§8).
        $fresh = self::loadIncident($pdo, (int)$inc['id']);
        try { self::route($pdo, $fresh); } catch (\Throwable $e) { error_log('[TRCMS] incident routing (triage) failed: ' . $e->getMessage()); }
        return Http::json($res, self::serialize($pdo, $fresh, true, $m));
    }

    // ── POST /incidents/{id}/assign ─────────────────────────────────────────
    public static function assign(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.triage', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();
        $to = !empty($d['assigned_to_id']) ? (int)$d['assigned_to_id'] : null;
        $pdo->prepare("UPDATE incident_reports SET assigned_to_id = ? WHERE id = ?")->execute([$to, (int)$inc['id']]);
        Audit::write($pdo, (int)$m['id'], 'incident_reports', (int)$inc['id'], 'incident.assign', null, ['assigned_to_id' => $to]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m));
    }

    // ── POST /incidents/{id}/notify-parent ──────────────────────────────────
    public static function notifyParent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.triage', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();
        $when = !empty($d['at']) ? str_replace('T', ' ', (string)$d['at']) : date('Y-m-d H:i:s');
        $method = trim((string)($d['method'] ?? '')) ?: null;
        $result = trim((string)($d['result'] ?? '')) ?: null;
        $pdo->prepare("UPDATE incident_reports SET parent_notified = 1, parent_notified_at = ?, parent_notified_by_id = ?, parent_notify_method = ?, parent_notify_result = ? WHERE id = ?")
            ->execute([$when, (int)$m['id'], $method, $result, (int)$inc['id']]);
        // The timestamp that matters later is this notification record.
        $pdo->prepare("INSERT INTO incident_notifications (incident_id, channel, recipient, reason, sent_at, ok) VALUES (?, 'guardian', ?, 'Guardian notified of incident', ?, 1)")
            ->execute([(int)$inc['id'], trim((string)($d['recipient'] ?? 'guardian')), $when]);
        Audit::write($pdo, (int)$m['id'], 'incident_reports', (int)$inc['id'], 'incident.notify_parent', null, ['at' => $when, 'method' => $method, 'result' => $result]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m));
    }

    // ── POST /incidents/{id}/share-parent — email a parent-facing summary to guardians ──
    public static function shareParent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.triage', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $d = (array)$req->getParsedBody();
        $summary = trim((string)($d['summary'] ?? ''));
        if ($summary === '') return Http::error($res, 'Write a summary to send to the parents.', 422);

        // Explicit recipient override, else resolve the affected youth's guardians on file.
        $recipients = [];
        foreach ((array)($d['recipients'] ?? []) as $r) { $r = trim((string)$r); if ($r !== '' && filter_var($r, FILTER_VALIDATE_EMAIL)) $recipients[strtolower($r)] = $r; }
        if (!$recipients) foreach (self::guardianEmailsFor($pdo, (int)$inc['id']) as $e) $recipients[strtolower($e)] = $e;
        $recipients = array_values($recipients);
        if (!$recipients) return Http::error($res, "No guardian email is on file for the affected youth. Add a recipient, or update the member's guardian contact.", 422);

        $subject = 'A note from Tulsa Robotics Center about your youth';
        $html = Mailer::wrap('Incident Notice',
            '<p>' . nl2br(htmlspecialchars($summary)) . '</p>' .
            '<p style="color:#888;font-size:12px;">This note was sent by the TRC safety team about an incident involving your youth. Please reply or contact us with any questions.</p>');

        $sent = 0; $fails = [];
        foreach ($recipients as $addr) {
            $ok = false; $err = null;
            try { $ok = Mailer::send($addr, $subject, $html, null, null, null); if (!$ok) $err = Mailer::lastError(); }
            catch (\Throwable $e) { $err = $e->getMessage(); }
            $pdo->prepare("INSERT INTO incident_notifications (incident_id, channel, recipient, reason, ok, error) VALUES (?, 'guardian', ?, 'Parent summary shared', ?, ?)")
                ->execute([(int)$inc['id'], $addr, $ok ? 1 : 0, $err ? substr($err, 0, 300) : null]);
            if ($ok) $sent++; else $fails[] = $addr;
        }
        // Sharing the summary also records that guardians were notified (the timestamp that matters).
        $pdo->prepare("UPDATE incident_reports SET parent_notified = 1, parent_notified_at = COALESCE(parent_notified_at, NOW()), parent_notified_by_id = ?, parent_notify_method = 'email', parent_notify_result = 'reached' WHERE id = ?")
            ->execute([(int)$m['id'], (int)$inc['id']]);
        Audit::write($pdo, (int)$m['id'], 'incident_reports', (int)$inc['id'], 'incident.share_parent', null, ['recipients' => $recipients, 'sent' => $sent]);
        return Http::json($res, ['ok' => true, 'sent' => $sent, 'failed' => $fails, 'recipients' => $recipients,
            'incident' => self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m)]);
    }

    // ── POST/DELETE /incidents/{id}/tasks ───────────────────────────────────
    public static function linkTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.triage', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $taskId = (int)(($req->getParsedBody()['task_id'] ?? 0));
        $tk = $pdo->prepare("SELECT id FROM team_tasks WHERE id = ?"); $tk->execute([$taskId]);
        if (!$tk->fetch()) return Http::error($res, 'Task not found.', 404);
        $pdo->prepare("INSERT IGNORE INTO incident_tasks (incident_id, task_id, created_by_id) VALUES (?,?,?)")
            ->execute([(int)$inc['id'], $taskId, (int)$m['id']]);
        // Corrective action means the incident is awaiting that work.
        if ($inc['status'] === 'triaged' || $inc['status'] === 'in_review') {
            $pdo->prepare("UPDATE incident_reports SET status = 'awaiting_action' WHERE id = ?")->execute([(int)$inc['id']]);
        }
        Audit::write($pdo, (int)$m['id'], 'incident_tasks', (int)$inc['id'], 'incident.link_task', null, ['task_id' => $taskId]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m));
    }

    public static function unlinkTask(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.triage', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $taskId = (int)($route['task_id'] ?? 0);
        $pdo->prepare("DELETE FROM incident_tasks WHERE incident_id = ? AND task_id = ?")->execute([(int)$inc['id'], $taskId]);
        Audit::write($pdo, (int)$m['id'], 'incident_tasks', (int)$inc['id'], 'incident.unlink_task', null, ['task_id' => $taskId]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m));
    }

    // ── POST /incidents/{id}/close ──────────────────────────────────────────
    public static function close(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.close', 'write')) return Http::error($res, 'Access denied', 403);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        // Closer must not be the reporter (§11).
        if ($inc['reporter_id'] !== null && (int)$inc['reporter_id'] === (int)$m['id']) {
            return Http::error($res, 'An incident must be closed by someone other than the reporter.', 409);
        }
        // No open linked corrective-action tasks (§11).
        $open = $pdo->prepare("SELECT COUNT(*) FROM incident_tasks it JOIN team_tasks t ON t.id = it.task_id WHERE it.incident_id = ? AND t.status NOT IN ('done','cancelled')");
        $open->execute([(int)$inc['id']]);
        if ((int)$open->fetchColumn() > 0) return Http::error($res, 'Close blocked: this incident has open corrective-action tasks.', 409);

        $summary = trim((string)(($req->getParsedBody()['closure_summary'] ?? '')));
        if ($summary === '') return Http::error($res, 'Add a closure summary.', 422);
        $pdo->prepare("UPDATE incident_reports SET status = 'closed', closed_at = NOW(), closed_by_id = ?, closure_summary = ? WHERE id = ?")
            ->execute([(int)$m['id'], $summary, (int)$inc['id']]);
        Audit::write($pdo, (int)$m['id'], 'incident_reports', (int)$inc['id'], 'incident.close', null, ['summary' => $summary]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), true, $m));
    }

    // ── POST /incidents/{id}/attachments ────────────────────────────────────
    public static function upload(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        // Same access as viewing the incident: a handler, or the reporter attaching to their own.
        $handler = self::can($pdo, $m, 'incidents.queue', 'read');
        if (!$handler && !self::canViewOwn($pdo, $m, $inc)) return Http::error($res, 'Access denied', 403);
        $file = $req->getUploadedFiles()['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded.', 400);
        if ($file->getSize() > self::MAX_UPLOAD) return Http::error($res, 'File too large (max 10 MB).', 400);
        $mime = strtolower((string)$file->getClientMediaType());
        $ext = self::ALLOWED_UP[$mime] ?? null;
        if ($ext === null) return Http::error($res, 'Unsupported file type.', 400);
        $dir = self::attachDir();
        $stored = 'inc' . (int)$inc['id'] . '_' . bin2hex(random_bytes(16)) . $ext;
        $file->moveTo($dir . DIRECTORY_SEPARATOR . $stored);
        $pdo->prepare("INSERT INTO incident_attachments (incident_id, stored_name, original_name, mime, size_bytes, uploaded_by_id, is_restricted) VALUES (?,?,?,?,?,?,?)")
            ->execute([(int)$inc['id'], $stored, $file->getClientFilename(), $mime, $file->getSize(), $m ? (int)$m['id'] : null, (int)!empty($inc['is_restricted'])]);
        Audit::write($pdo, $m ? (int)$m['id'] : null, 'incident_attachments', (int)$inc['id'], 'incident.attach', null, ['name' => $file->getClientFilename()]);
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, (int)$inc['id']), $handler, $m), 201);
    }

    // ── GET /incidents/{id}/attachments/{attachment_id} — authenticated stream
    public static function serveAttachment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $inc = self::loadIncident($pdo, (int)$route['id']);
        if (!$inc) return Http::error($res, 'Not found', 404);
        $handler = self::can($pdo, $m, 'incidents.queue', 'read');
        if (!$handler && !self::canViewOwn($pdo, $m, $inc)) return Http::error($res, 'Access denied', 403);
        $a = $pdo->prepare("SELECT * FROM incident_attachments WHERE id = ? AND incident_id = ?");
        $a->execute([(int)$route['attachment_id'], (int)$inc['id']]);
        $att = $a->fetch();
        if (!$att) return Http::error($res, 'Not found', 404);
        $path = self::attachDir() . DIRECTORY_SEPARATOR . basename((string)$att['stored_name']);
        if (!is_file($path)) return Http::error($res, 'Not found', 404);
        $res->getBody()->write((string)file_get_contents($path));
        return $res
            ->withHeader('Content-Type', (string)($att['mime'] ?: 'application/octet-stream'))
            ->withHeader('Content-Disposition', 'inline; filename="' . str_replace('"', '', (string)($att['original_name'] ?: $att['stored_name'])) . '"')
            ->withHeader('Cache-Control', 'private, no-store');
    }

    // ── GET /incidents/stats ────────────────────────────────────────────────
    public static function stats(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.queue', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $from = ($q['from'] ?? date('Y-m-d', strtotime('-90 days'))) . ' 00:00:00';
        $to = ($q['to'] ?? date('Y-m-d')) . ' 23:59:59';
        $byType = $pdo->prepare("SELECT type, COUNT(*) c FROM incident_reports WHERE occurred_at BETWEEN ? AND ? AND is_restricted = 0 GROUP BY type");
        $byType->execute([$from, $to]);
        $bySev = $pdo->prepare("SELECT COALESCE(severity, reporter_severity) sev, COUNT(*) c FROM incident_reports WHERE occurred_at BETWEEN ? AND ? AND is_restricted = 0 GROUP BY sev");
        $bySev->execute([$from, $to]);
        $total = (int)$pdo->query("SELECT COUNT(*) FROM incident_reports WHERE is_restricted = 0")->fetchColumn();
        $inRange = 0; foreach ($byType->fetchAll() as $r) $inRange += (int)$r['c'];
        // Incidents per 1,000 member-hours: denominator from the existing time-entry data.
        $minStmt = $pdo->prepare("SELECT COALESCE(SUM(minutes),0) FROM time_entries WHERE entry_date BETWEEN ? AND ?");
        $minStmt->execute([substr($from, 0, 10), substr($to, 0, 10)]);
        $hours = ((int)$minStmt->fetchColumn()) / 60.0;
        $rate = $hours > 0 ? round(($inRange / $hours) * 1000, 2) : null;
        $byType->execute([$from, $to]);
        return Http::json($res, [
            'from' => substr($from, 0, 10), 'to' => substr($to, 0, 10),
            'total_all_time' => $total,
            'in_range' => $inRange,
            'by_type' => array_map(fn($r) => ['type' => $r['type'], 'label' => IncidentTypes::label($r['type']), 'count' => (int)$r['c']], $byType->fetchAll()),
            'by_severity' => array_map(fn($r) => ['severity' => $r['sev'], 'count' => (int)$r['c']], $bySev->fetchAll()),
            'member_hours' => round($hours, 1),
            'per_1000_member_hours' => $rate,
        ]);
    }

    // ── First Aid Log ───────────────────────────────────────────────────────
    public static function firstAidList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.first_aid_log', 'write')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM first_aid_log ORDER BY occurred_at DESC, id DESC LIMIT 300")->fetchAll();
        return Http::json($res, array_map([self::class, 'serializeFirstAid'], $rows));
    }

    public static function firstAidSave(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.first_aid_log', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $treatment = trim((string)($d['treatment'] ?? ''));
        if ($treatment === '') return Http::error($res, 'What was done?', 422);
        $occurred = !empty($d['occurred_at']) ? str_replace('T', ' ', (string)$d['occurred_at']) : date('Y-m-d H:i:s');
        $pdo->prepare("INSERT INTO first_aid_log (member_id, person_name, occurred_at, treatment, provided_by_id, supplies_used, notes) VALUES (?,?,?,?,?,?,?)")
            ->execute([
                !empty($d['member_id']) ? (int)$d['member_id'] : null,
                trim((string)($d['person_name'] ?? '')) ?: null,
                $occurred, $treatment,
                !empty($d['provided_by_id']) ? (int)$d['provided_by_id'] : (int)$m['id'],
                trim((string)($d['supplies_used'] ?? '')) ?: null,
                trim((string)($d['notes'] ?? '')) ?: null,
            ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'first_aid_log', $id, 'first_aid.create', null, ['treatment' => $treatment]);
        $r = $pdo->prepare("SELECT * FROM first_aid_log WHERE id = ?"); $r->execute([$id]);
        return Http::json($res, self::serializeFirstAid($r->fetch()), 201);
    }

    /** Promote a first-aid entry to a Medical incident (e.g. medication turned out to be involved). */
    public static function firstAidPromote(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::can($pdo, $m, 'incidents.report', 'write')) return Http::error($res, 'Access denied', 403);
        $fa = $pdo->prepare("SELECT * FROM first_aid_log WHERE id = ?"); $fa->execute([(int)$route['id']]);
        $log = $fa->fetch();
        if (!$log) return Http::error($res, 'Not found', 404);
        if (!empty($log['promoted_incident_id'])) return Http::error($res, 'Already promoted.', 409);
        $row = [
            'type' => 'medical', 'reporter_severity' => 'minor', 'status' => 'submitted',
            'is_anonymous' => 0, 'reporter_id' => (int)$m['id'],
            'filed_for_member_id' => $log['member_id'] !== null ? (int)$log['member_id'] : null,
            'filed_for_name' => $log['person_name'],
            'occurred_at' => $log['occurred_at'] ?: date('Y-m-d H:i:s'),
            'location_kind' => 'trc',
            'description' => 'Promoted from First Aid Log: ' . (string)$log['treatment'] . ($log['supplies_used'] ? ' (supplies: ' . $log['supplies_used'] . ')' : ''),
            'retention_hold' => 1,
        ];
        $cols = array_keys($row);
        $pdo->prepare("INSERT INTO incident_reports (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")")->execute(array_values($row));
        $id = (int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE incident_reports SET ref_no = CONCAT('INC-', YEAR(created_at), '-', LPAD(id, 4, '0')) WHERE id = ?")->execute([$id]);
        $pdo->prepare("UPDATE first_aid_log SET promoted_incident_id = ? WHERE id = ?")->execute([$id, (int)$log['id']]);
        Audit::write($pdo, (int)$m['id'], 'incident_reports', $id, 'incident.promote_first_aid', null, ['first_aid_id' => (int)$log['id']]);
        try { self::route($pdo, self::loadIncident($pdo, $id)); } catch (\Throwable $e) { /* logged elsewhere */ }
        return Http::json($res, self::serialize($pdo, self::loadIncident($pdo, $id), true, $m), 201);
    }

    // ── helpers ─────────────────────────────────────────────────────────────
    private static function loadIncident(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM incident_reports WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function saveInjury(PDO $pdo, int $incidentId, array $inj): void
    {
        $fields = [
            'body_parts' => isset($inj['body_parts']) ? json_encode($inj['body_parts']) : null,
            'injury_nature' => $inj['injury_nature'] ?? null,
            'mechanism' => $inj['mechanism'] ?? null,
            'inv_item_id' => !empty($inj['inv_item_id']) ? (int)$inj['inv_item_id'] : null,
            'ppe_required' => $inj['ppe_required'] ?? null,
            'ppe_worn' => $inj['ppe_worn'] ?? null,
            'trained_certified' => isset($inj['trained_certified']) ? (int)!empty($inj['trained_certified']) : null,
            'certification_id' => !empty($inj['certification_id']) ? (int)$inj['certification_id'] : null,
            'supervised_by_id' => !empty($inj['supervised_by_id']) ? (int)$inj['supervised_by_id'] : null,
            'treatment_level' => $inj['treatment_level'] ?? null,
            'loss_of_consciousness' => isset($inj['loss_of_consciousness']) ? (int)!empty($inj['loss_of_consciousness']) : null,
            'concussion_protocol' => isset($inj['concussion_protocol']) ? (int)!empty($inj['concussion_protocol']) : null,
            'returned_to_activity' => isset($inj['returned_to_activity']) ? (int)!empty($inj['returned_to_activity']) : null,
            'restriction' => $inj['restriction'] ?? null,
            'medication_given' => isset($inj['medication_given']) ? (int)!empty($inj['medication_given']) : null,
            'rescue_med' => $inj['rescue_med'] ?? null,
            'outcome' => $inj['outcome'] ?? null,
            'claim_likely' => isset($inj['claim_likely']) ? (int)!empty($inj['claim_likely']) : null,
        ];
        $cols = array_merge(['incident_id'], array_keys($fields));
        $vals = array_merge([$incidentId], array_values($fields));
        $pdo->prepare("INSERT INTO incident_injury (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")")->execute($vals);
    }

    private static function clientIp(Request $req): ?string
    {
        $sp = $req->getServerParams();
        return $sp['REMOTE_ADDR'] ?? null;
    }

    private static function attachDir(): string
    {
        // Stored under public/uploads (known-writable) but shielded from static access by a
        // deny-all .htaccess — the only way in is the authenticated stream above. Injury photos
        // are therefore never URL-guessable, even though they are images (§4).
        $dir = dirname(__DIR__, 2) . '/public/uploads/incidents';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $ht = $dir . '/.htaccess';
        if (!is_file($ht)) {
            @file_put_contents($ht, "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
        }
        return $dir;
    }

    /** Relationship-based view of one's own incident: reporter, guardian of the subject, mentor on the team. */
    private static function canViewOwn(PDO $pdo, ?array $m, array $inc): bool
    {
        if (!$m) return false;
        if ($inc['reporter_id'] !== null && (int)$inc['reporter_id'] === (int)$m['id']) return true;
        if (!empty($inc['filed_for_member_id']) && MembersController::isFamilyParentOf($pdo, $m, (int)$inc['filed_for_member_id'])) return true;
        if (!empty($inc['team_id']) && ($m['member_type'] ?? '') === 'mentor') {
            $q = $pdo->prepare("SELECT 1 FROM team_member_assignments tma JOIN team_seasons ts ON ts.id = tma.team_season_id WHERE ts.team_id = ? AND tma.member_id = ? LIMIT 1");
            $q->execute([(int)$inc['team_id'], (int)$m['id']]);
            if ($q->fetch()) return true;
        }
        return false;
    }

    private static function effSeverity(array $inc): string
    {
        return (string)($inc['severity'] ?: $inc['reporter_severity'] ?: 'minor');
    }

    private static function routingConfig(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'incident_routing'");
        $s->execute();
        $raw = $s->fetchColumn();
        $arr = $raw ? json_decode((string)$raw, true) : null;
        $obj = (is_array($arr) && isset($arr[0]) && is_array($arr[0])) ? $arr[0] : null;
        return is_array($obj) ? $obj : ['default_to' => [], 'reply_to' => '', 'rules' => []];
    }

    private static function roleEmails(PDO $pdo, array $roleNames): array
    {
        $roleNames = array_values(array_filter(array_map('strval', $roleNames)));
        if (!$roleNames) return [];
        $in = implode(',', array_fill(0, count($roleNames), '?'));
        $q = $pdo->prepare(
            "SELECT DISTINCT m.email FROM members m
             JOIN member_system_roles msr ON msr.member_id = m.id
             JOIN system_roles sr ON sr.id = msr.role_id
             WHERE sr.name IN ($in) AND sr.is_active = true
               AND m.email IS NOT NULL AND m.email <> ''
               AND (m.is_archived = 0 OR m.is_archived IS NULL)"
        );
        $q->execute($roleNames);
        return array_column($q->fetchAll(), 'email');
    }

    /**
     * Evaluate the routing rules and LOG one pending incident_notifications row per unique recipient
     * (§8). This is synchronous and network-free, so filing a report is never delayed or failed by
     * email — the reason the report form is the priority "file fast" surface. Actual delivery of the
     * pending rows is done out of band by bin/send_incident_notifications.php (sendPendingNotifications).
     */
    private static function route(PDO $pdo, array $inc): void
    {
        $cfg = self::routingConfig($pdo);
        $eff = self::effSeverity($inc);
        $type = (string)$inc['type'];
        $recipients = [];   // email => reason
        $ruleForEmail = []; // email => rule id
        foreach ((array)($cfg['default_to'] ?? []) as $addr) {
            $addr = trim((string)$addr); if ($addr === '') continue;
            $recipients[$addr] = 'Incident inbox'; $ruleForEmail[$addr] = 0;
        }
        $board = false;
        foreach ((array)($cfg['rules'] ?? []) as $rule) {
            $types = (array)($rule['types'] ?? []);
            $typeMatch = in_array('*', $types, true) || in_array($type, $types, true);
            $minSev = strtolower((string)($rule['min_severity'] ?? 'minor'));
            $sevMatch = (self::SEV[$eff] ?? 1) >= (self::SEV[$minSev] ?? 1);
            if (!$typeMatch || !$sevMatch) continue;
            if (!empty($rule['board_notify'])) $board = true;
            $addrs = array_merge((array)($rule['to'] ?? []), (array)($rule['cc'] ?? []), self::roleEmails($pdo, (array)($rule['notify_roles'] ?? [])));
            foreach ($addrs as $addr) {
                $addr = trim((string)$addr);
                if ($addr === '') continue;
                if (!isset($recipients[$addr])) { $recipients[$addr] = (string)($rule['label'] ?? 'Routing rule'); $ruleForEmail[$addr] = (int)($rule['id'] ?? 0); }
            }
        }
        if ($board && empty($inc['board_reportable'])) {
            $pdo->prepare("UPDATE incident_reports SET board_reportable = 1 WHERE id = ?")->execute([(int)$inc['id']]);
        }
        $ins = $pdo->prepare("INSERT INTO incident_notifications (incident_id, channel, recipient, reason, rule_id, ok, error) VALUES (?, 'email', ?, ?, ?, 0, NULL)");
        foreach ($recipients as $addr => $reason) {
            $ins->execute([(int)$inc['id'], $addr, $reason, $ruleForEmail[$addr] ?? null]);
        }
    }

    /** Subject + branded HTML body for an incident notification email. Date-only when anonymous. */
    private static function notificationEmail(array $inc): array
    {
        $type = (string)$inc['type'];
        $eff = self::effSeverity($inc);
        $anon = !empty($inc['is_anonymous']);
        $when = $anon ? substr((string)$inc['occurred_at'], 0, 10) : (string)$inc['occurred_at'];
        $subject = 'Incident ' . (string)$inc['ref_no'] . ' — ' . IncidentTypes::label($type) . ' (' . ucfirst($eff) . ')';
        $html = Mailer::wrap('Incident Report',
            "<p>A new incident report has been filed.</p>" .
            "<p><strong>Reference:</strong> " . htmlspecialchars((string)($inc['ref_no'] ?? '')) . "<br>" .
            "<strong>Type:</strong> " . htmlspecialchars(IncidentTypes::label($type)) . "<br>" .
            "<strong>Severity:</strong> " . htmlspecialchars(ucfirst($eff)) . "<br>" .
            "<strong>When:</strong> " . htmlspecialchars((string)$when) . "<br>" .
            "<strong>Filed:</strong> " . ($anon ? 'Anonymously' : 'Named reporter') . "</p>" .
            "<p>Open it in TRCMS &rarr; Incident Queue for the details. Do not reply to this message.</p>"
        );
        return [$subject, $html];
    }

    /**
     * Deliver pending incident notifications (channel=email, ok=0, not yet errored). Run from
     * bin/send_incident_notifications.php on a frequent cron. A CLI script has no execution-time
     * limit, so a slow relay delays delivery — never a member's report submit. Returns count sent.
     */
    public static function sendPendingNotifications(PDO $pdo, int $limit = 200): int
    {
        $rows = $pdo->query("SELECT * FROM incident_notifications WHERE channel = 'email' AND ok = 0 AND error IS NULL ORDER BY id LIMIT " . max(1, $limit))->fetchAll();
        if (!$rows) return 0;
        $cfg = self::routingConfig($pdo);
        $replyTo = ($cfg['reply_to'] ?? '') ?: null;
        $sent = 0;
        foreach ($rows as $n) {
            $inc = self::loadIncident($pdo, (int)$n['incident_id']);
            if (!$inc) { $pdo->prepare("UPDATE incident_notifications SET error = 'incident missing' WHERE id = ?")->execute([(int)$n['id']]); continue; }
            [$subject, $html] = self::notificationEmail($inc);
            $ok = false; $err = null;
            try { $ok = Mailer::send((string)$n['recipient'], $subject, $html, null, null, $replyTo); if (!$ok) $err = Mailer::lastError(); }
            catch (\Throwable $e) { $err = $e->getMessage(); }
            $pdo->prepare("UPDATE incident_notifications SET ok = ?, error = ? WHERE id = ?")
                ->execute([$ok ? 1 : 0, $err ? substr($err, 0, 300) : null, (int)$n['id']]);
            if ($ok) $sent++;
        }
        return $sent;
    }

    private static function memberName(PDO $pdo, ?int $id): ?string
    {
        if (!$id) return null;
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $r = $s->fetch();
        return $r ? trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? '')) : null;
    }

    private static function eventName(PDO $pdo, int $id): ?string
    {
        $s = $pdo->prepare("SELECT name FROM events WHERE id = ?"); $s->execute([$id]);
        $v = $s->fetchColumn();
        return $v === false ? null : (string)$v;
    }

    /** Guardian emails on file for the affected members (+ the filed-for member) of an incident. */
    private static function guardianEmailsFor(PDO $pdo, int $incidentId): array
    {
        $ids = [];
        $ps = $pdo->prepare("SELECT DISTINCT member_id FROM incident_people WHERE incident_id = ? AND person_role = 'affected' AND member_id IS NOT NULL");
        $ps->execute([$incidentId]);
        foreach ($ps->fetchAll() as $r) $ids[(int)$r['member_id']] = true;
        $inc = self::loadIncident($pdo, $incidentId);
        if ($inc && !empty($inc['filed_for_member_id'])) $ids[(int)$inc['filed_for_member_id']] = true;
        if (!$ids) return [];
        $in = implode(',', array_fill(0, count($ids), '?'));
        $q = $pdo->prepare("SELECT guardian1_email, guardian2_email FROM members WHERE id IN ($in)");
        $q->execute(array_keys($ids));
        $emails = [];
        foreach ($q->fetchAll() as $mm) {
            foreach (['guardian1_email', 'guardian2_email'] as $g) {
                $e = trim((string)($mm[$g] ?? ''));
                if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) $emails[strtolower($e)] = $e;
            }
        }
        return array_values($emails);
    }

    /** Date-only for anonymous incidents (§7.4), full ISO otherwise. */
    private static function fmt(?string $ts, bool $anon): ?string
    {
        if (!$ts) return null;
        return $anon ? substr($ts, 0, 10) : Time::naiveIso($ts);
    }

    private static function serialize(PDO $pdo, array $r, bool $handler, ?array $viewer, bool $summary = false): array
    {
        $anon = !empty($r['is_anonymous']);
        $id = (int)$r['id'];
        $out = [
            'id' => $id,
            'ref_no' => $r['ref_no'],
            'type' => $r['type'],
            'type_label' => IncidentTypes::label((string)$r['type']),
            'tier' => IncidentTypes::tier((string)$r['type']),
            'severity' => $r['severity'],
            'reporter_severity' => $r['reporter_severity'],
            'effective_severity' => self::effSeverity($r),
            'status' => $r['status'],
            'is_anonymous' => $anon,
            'occurred_at' => self::fmt($r['occurred_at'], $anon),
            'occurred_approx' => (bool)$r['occurred_approx'],
            'location_kind' => $r['location_kind'],
            'location_area' => $r['location_area'],
            'location_other' => $r['location_other'],
            'event_id' => $r['event_id'] !== null ? (int)$r['event_id'] : null,
            'event_name' => $r['event_id'] !== null ? self::eventName($pdo, (int)$r['event_id']) : null,
            'team_id' => $r['team_id'] !== null ? (int)$r['team_id'] : null,
            'ongoing_risk' => (bool)$r['ongoing_risk'],
            'is_sensitive' => (bool)$r['is_sensitive'],
            'board_reportable' => (bool)$r['board_reportable'],
            'created_at' => self::fmt($r['created_at'], $anon),
            'filed_for_name' => $r['filed_for_name'],
            'filed_for_member_id' => $r['filed_for_member_id'] !== null ? (int)$r['filed_for_member_id'] : null,
            'filed_for_relationship' => $r['filed_for_relationship'],
        ];
        // Reporter identity: only for handlers, and NEVER for anonymous reports.
        $out['reporter_id'] = ($handler && !$anon && $r['reporter_id'] !== null) ? (int)$r['reporter_id'] : null;
        $out['reporter_name'] = ($handler && !$anon) ? self::memberName($pdo, $r['reporter_id'] !== null ? (int)$r['reporter_id'] : null) : null;

        if ($summary) {
            // Queue/list rows: add age (days) and assignment, skip the heavy joins.
            $out['assigned_to_id'] = $r['assigned_to_id'] !== null ? (int)$r['assigned_to_id'] : null;
            $out['assigned_to_name'] = self::memberName($pdo, $r['assigned_to_id'] !== null ? (int)$r['assigned_to_id'] : null);
            $out['age_days'] = $r['occurred_at'] ? (int)floor((time() - strtotime((string)$r['occurred_at'])) / 86400) : null;
            return $out;
        }

        $out['description'] = $r['description'];
        $out['immediate_actions'] = $r['immediate_actions'];
        $out['notified_at_time'] = $r['notified_at_time'] ? json_decode((string)$r['notified_at_time'], true) : null;
        $out['ems_called'] = (bool)$r['ems_called'];
        $out['police_called'] = (bool)$r['police_called'];
        $out['parent_notified'] = (bool)$r['parent_notified'];
        $out['parent_notified_at'] = self::fmt($r['parent_notified_at'], $anon);
        $out['parent_notify_method'] = $r['parent_notify_method'];
        $out['parent_notify_result'] = $r['parent_notify_result'];
        $out['detail'] = $r['detail'] ? json_decode((string)$r['detail'], true) : null;
        $out['assigned_to_id'] = $r['assigned_to_id'] !== null ? (int)$r['assigned_to_id'] : null;
        $out['assigned_to_name'] = self::memberName($pdo, $r['assigned_to_id'] !== null ? (int)$r['assigned_to_id'] : null);
        $out['triaged_at'] = self::fmt($r['triaged_at'], $anon);
        $out['closed_at'] = self::fmt($r['closed_at'], $anon);
        $out['closure_summary'] = $r['closure_summary'];
        $out['external_notified'] = $r['external_notified'] ? json_decode((string)$r['external_notified'], true) : null;
        $out['retention_hold'] = (bool)$r['retention_hold'];
        $out['retention_review_on'] = $r['retention_review_on'];
        $out['follow_up_due'] = $r['follow_up_due'];

        // People (part of the report — visible to handler and reporter-self).
        $pp = $pdo->prepare("SELECT * FROM incident_people WHERE incident_id = ? ORDER BY id"); $pp->execute([$id]);
        $out['people'] = array_map(fn($p) => [
            'id' => (int)$p['id'], 'member_id' => $p['member_id'] !== null ? (int)$p['member_id'] : null,
            'name' => $p['name'] ?: self::memberName($pdo, $p['member_id'] !== null ? (int)$p['member_id'] : null),
            'person_role' => $p['person_role'], 'is_youth' => $p['is_youth'] !== null ? (bool)$p['is_youth'] : null, 'notes' => $p['notes'],
        ], $pp->fetchAll());

        // Injury facts.
        $ij = $pdo->prepare("SELECT * FROM incident_injury WHERE incident_id = ?"); $ij->execute([$id]);
        $inj = $ij->fetch();
        $out['injury'] = $inj ? array_diff_key($inj, ['id' => 1, 'incident_id' => 1]) : null;
        if ($out['injury'] && isset($out['injury']['body_parts'])) $out['injury']['body_parts'] = json_decode((string)$out['injury']['body_parts'], true);

        // Attachments (metadata only — bytes come from the authenticated stream).
        $at = $pdo->prepare("SELECT id, original_name, mime, size_bytes, created_at FROM incident_attachments WHERE incident_id = ? ORDER BY id"); $at->execute([$id]);
        $out['attachments'] = array_map(fn($a) => [
            'id' => (int)$a['id'], 'name' => $a['original_name'], 'mime' => $a['mime'], 'size_bytes' => (int)$a['size_bytes'],
            'url' => "/api/v1/incidents/$id/attachments/" . (int)$a['id'],
        ], $at->fetchAll());

        // Linked tasks.
        $tk = $pdo->prepare("SELECT it.task_id, t.title, t.status FROM incident_tasks it LEFT JOIN team_tasks t ON t.id = it.task_id WHERE it.incident_id = ? ORDER BY it.id"); $tk->execute([$id]);
        $out['tasks'] = array_map(fn($t) => ['task_id' => (int)$t['task_id'], 'title' => $t['title'], 'status' => $t['status'], 'open' => !in_array($t['status'], ['done', 'cancelled'], true)], $tk->fetchAll());

        // Notes: handler-only (protects witness statements from being cross-visible).
        if ($handler) {
            $nt = $pdo->prepare("SELECT * FROM incident_notes WHERE incident_id = ? ORDER BY id"); $nt->execute([$id]);
            $out['notes'] = array_map(fn($n) => [
                'id' => (int)$n['id'], 'author_id' => $n['author_id'] !== null ? (int)$n['author_id'] : null,
                'author_name' => self::memberName($pdo, $n['author_id'] !== null ? (int)$n['author_id'] : null),
                'body' => $n['body'], 'note_kind' => $n['note_kind'], 'visibility' => $n['visibility'],
                'created_at' => self::fmt($n['created_at'], $anon),
            ], $nt->fetchAll());
            $out['notifications'] = array_map(fn($x) => [
                'recipient' => $x['recipient'], 'reason' => $x['reason'], 'channel' => $x['channel'],
                'ok' => (bool)$x['ok'], 'error' => $x['error'], 'sent_at' => self::fmt($x['sent_at'], $anon),
            ], ($pdo->query("SELECT * FROM incident_notifications WHERE incident_id = $id ORDER BY id")->fetchAll()));
            $out['guardian_emails'] = self::guardianEmailsFor($pdo, $id);
        } else {
            $out['notes'] = [];
        }
        return $out;
    }

    private static function serializeFirstAid(array $r): array
    {
        return [
            'id' => (int)$r['id'],
            'member_id' => $r['member_id'] !== null ? (int)$r['member_id'] : null,
            'person_name' => $r['person_name'],
            'occurred_at' => Time::naiveIso($r['occurred_at']),
            'treatment' => $r['treatment'],
            'provided_by_id' => $r['provided_by_id'] !== null ? (int)$r['provided_by_id'] : null,
            'supplies_used' => $r['supplies_used'],
            'notes' => $r['notes'],
            'promoted_incident_id' => $r['promoted_incident_id'] !== null ? (int)$r['promoted_incident_id'] : null,
            'created_at' => Time::naiveIso($r['created_at']),
        ];
    }
}
