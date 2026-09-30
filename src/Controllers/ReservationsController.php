<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Room & Resource Reservations.
 *
 * Members request a room (Computer Lab, Collab Labs) or a piece of equipment
 * (3D printers, CNC, Lathe) for a window of time, stating a purpose (personal,
 * general TRC, or a specific team) and usage details. A Lead Mentor or Admin
 * (reservations.approve) approves or denies; approved reservations render on the
 * shared calendar in the module's color. Overlapping bookings don't block —
 * the approver is warned but may still approve.
 */
final class ReservationsController
{
    private const PURPOSES = ['personal', 'trc', 'team'];
    private const STATUSES = ['pending', 'approved', 'denied', 'cancelled'];

    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'reservations.view', 'read'); }
    private static function canApprove(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'reservations.approve', 'write'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'reservations.manage', 'write'); }

    private static function intOrNull($v): ?int { return $v === null || $v === '' ? null : (int)$v; }

    /** Accept "YYYY-MM-DD HH:MM[:SS]" or ISO "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD HH:MM:SS". */
    private static function dt($v): ?string
    {
        if ($v === null || $v === '') return null;
        $s = str_replace('T', ' ', trim((string)$v));
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $s)) $s .= ':00';
        return $s;
    }

    private static function teamLabel(PDO $pdo, ?int $tsid): ?string
    {
        if ($tsid === null) return null;
        $s = $pdo->prepare("SELECT t.team_number, ts.team_name, ts.season FROM team_seasons ts
                            JOIN teams t ON t.id = ts.team_id WHERE ts.id = ?");
        $s->execute([$tsid]); $r = $s->fetch();
        if (!$r) return "Team season #$tsid";
        $name = $r['team_name'] ?: ('Team ' . $r['team_number']);
        return "#{$r['team_number']} {$name} · {$r['season']}";
    }

    // ── Resources (admin-configurable rooms & equipment) ─────────────────────

    private static function serializeResource(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'name' => $r['name'], 'kind' => $r['kind'],
            'is_active' => (bool)$r['is_active'], 'is_hidden' => (bool)$r['is_hidden'],
            'display_order' => (int)$r['display_order'], 'notes' => $r['notes'],
        ];
    }

    /** GET /reservations/resources — list resources (active only unless ?all=1 and can manage). */
    public static function resources(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $all = !empty($req->getQueryParams()['all']) && self::canManage($pdo, $cur);
        $where = $all ? '1=1' : 'is_active = 1 AND is_hidden = 0';
        $rows = $pdo->query("SELECT * FROM reservation_resources WHERE $where ORDER BY display_order, name")->fetchAll();
        return Http::json($res, array_map([self::class, 'serializeResource'], $rows));
    }

    public static function createResource(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Resource name is required.', 422);
        $kind = in_array($d['kind'] ?? '', ['room', 'equipment'], true) ? $d['kind'] : 'room';
        $pdo->prepare("INSERT INTO reservation_resources (name, kind, is_active, is_hidden, display_order, notes) VALUES (?,?,?,?,?,?)")
            ->execute([$d['name'], $kind, (int)($d['is_active'] ?? 1), (int)!empty($d['is_hidden']),
                (int)($d['display_order'] ?? 0), $d['notes'] ?? null]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'reservation_resources', $id, 'create', null, ['name' => $d['name']]);
        $r = $pdo->prepare("SELECT * FROM reservation_resources WHERE id = ?"); $r->execute([$id]);
        return Http::json($res, self::serializeResource($r->fetch()), 201);
    }

    public static function updateResource(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['resource_id'];
        $s = $pdo->prepare("SELECT * FROM reservation_resources WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Resource not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('name', $d)) { $set[] = 'name = ?'; $args[] = $d['name']; }
        if (array_key_exists('kind', $d) && in_array($d['kind'], ['room', 'equipment'], true)) { $set[] = 'kind = ?'; $args[] = $d['kind']; }
        foreach (['is_active', 'is_hidden'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = (int)!empty($d[$f]); }
        if (array_key_exists('display_order', $d)) { $set[] = 'display_order = ?'; $args[] = (int)$d['display_order']; }
        if (array_key_exists('notes', $d)) { $set[] = 'notes = ?'; $args[] = $d['notes']; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE reservation_resources SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'reservation_resources', $id, 'update', null, $d);
        $r = $pdo->prepare("SELECT * FROM reservation_resources WHERE id = ?"); $r->execute([$id]);
        return Http::json($res, self::serializeResource($r->fetch()));
    }

    public static function deleteResource(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['resource_id'];
        $cnt = $pdo->prepare("SELECT COUNT(*) FROM reservations WHERE resource_id = ?"); $cnt->execute([$id]);
        if ((int)$cnt->fetchColumn() > 0) {
            // Preserve history — deactivate & hide rather than cascade-delete bookings.
            $pdo->prepare("UPDATE reservation_resources SET is_active = 0, is_hidden = 1 WHERE id = ?")->execute([$id]);
            Audit::write($pdo, (int)$cur['id'], 'reservation_resources', $id, 'update', null, ['retired' => true]);
            return Http::json($res, ['ok' => true, 'retired' => true]);
        }
        $pdo->prepare("DELETE FROM reservation_resources WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'reservation_resources', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Reservations ─────────────────────────────────────────────────────────

    private static function row(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM reservations WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function memberName(PDO $pdo, ?int $id): ?string
    {
        if ($id === null) return null;
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $r = $s->fetch();
        return $r ? trim("{$r['first_name']} {$r['last_name']}") : null;
    }

    // ── Email notifications ───────────────────────────────────────────────────

    /** Build a small HTML summary of a reservation for notification emails. */
    private static function emailSummary(PDO $pdo, int $id): array
    {
        $s = $pdo->prepare("SELECT r.*, res.name AS resource_name, ev.name AS event_name
                            FROM reservations r JOIN reservation_resources res ON res.id = r.resource_id
                            LEFT JOIN events ev ON ev.id = r.event_id WHERE r.id = ?");
        $s->execute([$id]);
        $r = $s->fetch();
        if (!$r) return ['', null, ''];
        $requestor = self::memberName($pdo, (int)$r['member_id']);
        $fmt = fn($dt) => $dt ? date('D, M j, Y g:i A', strtotime($dt)) : '';
        $esc = fn($v) => htmlspecialchars((string)$v);
        $rowHtml = fn($k, $v) => $v !== null && $v !== '' ? "<tr><td style='padding:3px 12px 3px 0;color:#667'>{$k}</td><td style='padding:3px 0'><strong>" . $esc($v) . "</strong></td></tr>" : '';
        $html = "<table style='border-collapse:collapse;font-size:14px'>"
            . $rowHtml('Resource', $r['resource_name'])
            . $rowHtml('Requested by', $requestor)
            . $rowHtml('Start', $fmt($r['start_at']))
            . $rowHtml('End', $fmt($r['end_at']))
            . $rowHtml('Purpose', ucfirst((string)$r['purpose']))
            . $rowHtml('For event', $r['event_name'])
            . $rowHtml('Usage', $r['usage_details'])
            . $rowHtml('Special considerations', $r['special_considerations'])
            . "</table>";
        return [$html, $r['resource_name'], (string)$requestor];
    }

    /** Email address of the member who made the reservation (or null). */
    private static function requestorEmail(PDO $pdo, int $memberId): ?string
    {
        $s = $pdo->prepare("SELECT email FROM members WHERE id = ?"); $s->execute([$memberId]);
        $e = trim((string)($s->fetchColumn() ?: ''));
        return ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) ? $e : null;
    }

    /** Notify the reservations inbox that a new request came in (best-effort). */
    private static function notifyNewRequest(PDO $pdo, int $id): void
    {
        if (!Mailer::enabled()) return;
        [$summary, $resourceName] = self::emailSummary($pdo, $id);
        if ($summary === '') return;
        $to = EmailSettingsController::reservationEmail($pdo);
        $appUrl = rtrim((string)Config::get('APP_URL', ''), '/');
        $link = $appUrl ? "<p><a href='{$appUrl}/reservations' style='color:#1565c0'>Review it in TRCMS →</a></p>" : '';
        $body = "<p>A new room/resource reservation request has been submitted and is awaiting review.</p>{$summary}{$link}";
        Mailer::send($to, 'New reservation request: ' . $resourceName, Mailer::wrap('New Reservation Request', $body));
    }

    /** Notify the requestor of an approval/denial decision (best-effort). */
    private static function notifyDecision(PDO $pdo, int $id, string $status, ?string $note): void
    {
        if (!Mailer::enabled()) return;
        $r = self::row($pdo, $id);
        if (!$r) return;
        $to = self::requestorEmail($pdo, (int)$r['member_id']);
        if (!$to) return;
        [$summary, $resourceName] = self::emailSummary($pdo, $id);
        $approved = $status === 'approved';
        $headline = $approved
            ? "<p>Good news — your reservation has been <strong style='color:#2e7d32'>approved</strong>.</p>"
            : "<p>Your reservation request was <strong style='color:#c62828'>not approved</strong>.</p>";
        $noteHtml = trim((string)$note) !== '' ? "<p style='margin-top:12px'><em>Note from the reviewer:</em><br>" . htmlspecialchars((string)$note) . "</p>" : '';
        $body = $headline . $summary . $noteHtml;
        $subject = ($approved ? 'Reservation approved: ' : 'Reservation update: ') . $resourceName;
        Mailer::send($to, $subject, Mailer::wrap($approved ? 'Reservation Approved' : 'Reservation Update', $body));
    }

    /** Count overlapping APPROVED reservations on the same resource (excluding $exceptId). */
    private static function conflictCount(PDO $pdo, int $resourceId, string $start, string $end, ?int $exceptId = null): int
    {
        $sql = "SELECT COUNT(*) FROM reservations
                WHERE resource_id = ? AND status = 'approved' AND start_at < ? AND end_at > ?";
        $args = [$resourceId, $end, $start];
        if ($exceptId !== null) { $sql .= ' AND id <> ?'; $args[] = $exceptId; }
        $s = $pdo->prepare($sql); $s->execute($args);
        return (int)$s->fetchColumn();
    }

    private static function serialize(PDO $pdo, array $r): array
    {
        return [
            'id' => (int)$r['id'],
            'resource_id' => (int)$r['resource_id'],
            'resource_name' => $r['resource_name'] ?? null,
            'resource_kind' => $r['resource_kind'] ?? null,
            'member_id' => (int)$r['member_id'],
            'member_name' => self::memberName($pdo, (int)$r['member_id']),
            'purpose' => $r['purpose'],
            'team_season_id' => self::intOrNull($r['team_season_id']),
            'team_label' => self::teamLabel($pdo, self::intOrNull($r['team_season_id'])),
            'event_id' => self::intOrNull($r['event_id'] ?? null),
            'event_name' => $r['event_name'] ?? null,
            'event_date' => $r['event_date'] ?? null,
            'usage_details' => $r['usage_details'],
            'special_considerations' => $r['special_considerations'],
            'start_at' => $r['start_at'],
            'end_at' => $r['end_at'],
            'status' => $r['status'],
            'reviewed_by_id' => self::intOrNull($r['reviewed_by_id']),
            'reviewed_by_name' => self::memberName($pdo, self::intOrNull($r['reviewed_by_id'])),
            'reviewed_at' => $r['reviewed_at'],
            'review_note' => $r['review_note'],
            'created_at' => $r['created_at'],
        ];
    }

    /**
     * GET /reservations/ — calendar + lists.
     * Query: from, to (date range on start_at), status, resource_id, mine=1, pending=1.
     * Everyone with view sees approved bookings (for the shared calendar) plus their
     * own at any status. Approvers/managers see everything.
     */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $privileged = self::canApprove($pdo, $cur) || self::canManage($pdo, $cur);

        $where = '1=1'; $args = [];
        if (!$privileged) { $where .= " AND (r.status = 'approved' OR r.member_id = ?)"; $args[] = (int)$cur['id']; }
        if (!empty($q['mine'])) { $where .= ' AND r.member_id = ?'; $args[] = (int)$cur['id']; }
        if (!empty($q['pending'])) $where .= " AND r.status = 'pending'";
        if (!empty($q['status']) && in_array($q['status'], self::STATUSES, true)) { $where .= ' AND r.status = ?'; $args[] = $q['status']; }
        if (!empty($q['resource_id'])) { $where .= ' AND r.resource_id = ?'; $args[] = (int)$q['resource_id']; }
        if (!empty($q['event_id'])) { $where .= ' AND r.event_id = ?'; $args[] = (int)$q['event_id']; }
        if (!empty($q['from'])) { $where .= ' AND r.end_at >= ?'; $args[] = self::dt($q['from'] . ' 00:00'); }
        if (!empty($q['to'])) { $where .= ' AND r.start_at <= ?'; $args[] = self::dt($q['to'] . ' 23:59'); }

        $s = $pdo->prepare("SELECT r.*, res.name AS resource_name, res.kind AS resource_kind,
                                   ev.name AS event_name, ev.event_date AS event_date
                            FROM reservations r JOIN reservation_resources res ON res.id = r.resource_id
                            LEFT JOIN events ev ON ev.id = r.event_id
                            WHERE $where ORDER BY r.start_at");
        $s->execute($args);
        $out = [];
        foreach ($s->fetchAll() as $r) {
            $row = self::serialize($pdo, $r);
            if ($privileged && $r['status'] !== 'cancelled' && $r['status'] !== 'denied') {
                $row['conflicts'] = self::conflictCount($pdo, (int)$r['resource_id'], $r['start_at'], $r['end_at'], (int)$r['id']);
            }
            $out[] = $row;
        }
        return Http::json($res, $out);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $r = self::row($pdo, (int)$route['reservation_id']);
        if (!$r) return Http::error($res, 'Reservation not found', 404);
        if (!self::canApprove($pdo, $cur) && !self::canManage($pdo, $cur)
            && (int)$r['member_id'] !== (int)$cur['id'] && $r['status'] !== 'approved') {
            return Http::error($res, 'Access denied', 403);
        }
        $res2 = $pdo->prepare("SELECT name, kind FROM reservation_resources WHERE id = ?"); $res2->execute([(int)$r['resource_id']]);
        if ($rr = $res2->fetch()) { $r['resource_name'] = $rr['name']; $r['resource_kind'] = $rr['kind']; }
        if (!empty($r['event_id'])) {
            $ev = $pdo->prepare("SELECT name, event_date FROM events WHERE id = ?"); $ev->execute([(int)$r['event_id']]);
            if ($e = $ev->fetch()) { $r['event_name'] = $e['name']; $r['event_date'] = $e['event_date']; }
        }
        $out = self::serialize($pdo, $r);
        $out['conflicts'] = self::conflictCount($pdo, (int)$r['resource_id'], $r['start_at'], $r['end_at'], (int)$r['id']);
        return Http::json($res, $out);
    }

    /**
     * GET /reservations/for-event/{event_id} — the reservations tied to an event,
     * for the event page's "Reserved Rooms & Resources" pane. Cancelled/denied are
     * omitted; anyone who can view reservations can see them.
     */
    public static function forEvent(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eventId = (int)$route['event_id'];
        $s = $pdo->prepare("SELECT r.*, res.name AS resource_name, res.kind AS resource_kind,
                                   ev.name AS event_name, ev.event_date AS event_date
                            FROM reservations r JOIN reservation_resources res ON res.id = r.resource_id
                            LEFT JOIN events ev ON ev.id = r.event_id
                            WHERE r.event_id = ? AND r.status NOT IN ('cancelled','denied')
                            ORDER BY r.start_at");
        $s->execute([$eventId]);
        return Http::json($res, array_map(fn($r) => self::serialize($pdo, $r), $s->fetchAll()));
    }

    /** Validate + normalize a create/update payload. Returns [data, errorString|null]. */
    private static function validate(PDO $pdo, array $d, bool $isCreate): array
    {
        $err = null;
        $purpose = in_array($d['purpose'] ?? '', self::PURPOSES, true) ? $d['purpose'] : 'personal';
        $start = self::dt($d['start_at'] ?? null);
        $end = self::dt($d['end_at'] ?? null);
        $resourceId = self::intOrNull($d['resource_id'] ?? null);
        $teamSeasonId = $purpose === 'team' ? self::intOrNull($d['team_season_id'] ?? null) : null;
        $eventId = self::intOrNull($d['event_id'] ?? null);
        if ($eventId) {
            $es = $pdo->prepare("SELECT id FROM events WHERE id = ?"); $es->execute([$eventId]);
            if (!$es->fetch()) $eventId = null; // silently drop a stale event link
        }

        if ($isCreate && !$resourceId) $err = 'A room or resource must be selected.';
        elseif (!$start || !$end) $err = 'Start and end date/time are required.';
        elseif ($end <= $start) $err = 'The end time must be after the start time.';
        elseif ($purpose === 'team' && !$teamSeasonId) $err = 'Please identify the team for a team reservation.';

        if (!$err && $resourceId) {
            $rs = $pdo->prepare("SELECT id, is_active FROM reservation_resources WHERE id = ?"); $rs->execute([$resourceId]);
            $rr = $rs->fetch();
            if (!$rr) $err = 'The selected resource no longer exists.';
            elseif ($isCreate && !$rr['is_active']) $err = 'That resource is not available for reservation.';
        }
        return [[
            'resource_id' => $resourceId, 'purpose' => $purpose, 'team_season_id' => $teamSeasonId,
            'event_id' => $eventId,
            'usage_details' => $d['usage_details'] ?? null, 'special_considerations' => $d['special_considerations'] ?? null,
            'start_at' => $start, 'end_at' => $end,
        ], $err];
    }

    /** POST /reservations/ — a member requests a reservation (status = pending). */
    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        [$v, $err] = self::validate($pdo, (array)$req->getParsedBody(), true);
        if ($err) return Http::error($res, $err, 422);

        $pdo->prepare("INSERT INTO reservations
            (resource_id, member_id, purpose, team_season_id, event_id, usage_details, special_considerations, start_at, end_at, status)
            VALUES (?,?,?,?,?,?,?,?,?, 'pending')")
            ->execute([$v['resource_id'], (int)$cur['id'], $v['purpose'], $v['team_season_id'], $v['event_id'],
                $v['usage_details'], $v['special_considerations'], $v['start_at'], $v['end_at']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'reservations', $id, 'create', null,
            ['resource_id' => $v['resource_id'], 'start_at' => $v['start_at'], 'end_at' => $v['end_at']]);
        self::notifyNewRequest($pdo, $id);
        return self::get($req, $res, ['reservation_id' => $id]);
    }

    /** PATCH /reservations/{id} — owner edits own pending request; approver/manager may edit any. */
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['reservation_id'];
        $r = self::row($pdo, $id);
        if (!$r) return Http::error($res, 'Reservation not found', 404);
        $privileged = self::canApprove($pdo, $cur) || self::canManage($pdo, $cur);
        $isOwner = (int)$r['member_id'] === (int)$cur['id'];
        if (!$privileged && !$isOwner) return Http::error($res, 'Access denied', 403);
        if (!$privileged && $r['status'] !== 'pending') return Http::error($res, 'Only pending requests can be edited.', 409);

        $d = (array)$req->getParsedBody();
        // Merge with existing so a partial edit still validates as a whole.
        $merged = array_merge([
            'resource_id' => $r['resource_id'], 'purpose' => $r['purpose'], 'team_season_id' => $r['team_season_id'],
            'event_id' => $r['event_id'] ?? null,
            'usage_details' => $r['usage_details'], 'special_considerations' => $r['special_considerations'],
            'start_at' => $r['start_at'], 'end_at' => $r['end_at'],
        ], $d);
        [$v, $err] = self::validate($pdo, $merged, false);
        if ($err) return Http::error($res, $err, 422);
        $pdo->prepare("UPDATE reservations SET resource_id=?, purpose=?, team_season_id=?, event_id=?, usage_details=?,
            special_considerations=?, start_at=?, end_at=?, updated_at=NOW() WHERE id=?")
            ->execute([$v['resource_id'], $v['purpose'], $v['team_season_id'], $v['event_id'], $v['usage_details'],
                $v['special_considerations'], $v['start_at'], $v['end_at'], $id]);
        Audit::write($pdo, (int)$cur['id'], 'reservations', $id, 'update', null, $d);
        return self::get($req, $res, ['reservation_id' => $id]);
    }

    /** POST /reservations/{id}/decision — approve or deny (approver/manager only). */
    public static function decision(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canApprove($pdo, $cur) && !self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['reservation_id'];
        $r = self::row($pdo, $id);
        if (!$r) return Http::error($res, 'Reservation not found', 404);
        $d = (array)$req->getParsedBody();
        $action = $d['action'] ?? '';
        if (!in_array($action, ['approve', 'deny'], true)) return Http::error($res, 'action must be approve or deny.', 422);
        $status = $action === 'approve' ? 'approved' : 'denied';
        $pdo->prepare("UPDATE reservations SET status=?, reviewed_by_id=?, reviewed_at=NOW(), review_note=?, updated_at=NOW() WHERE id=?")
            ->execute([$status, (int)$cur['id'], $d['review_note'] ?? null, $id]);
        Audit::write($pdo, (int)$cur['id'], 'reservations', $id, $action, null, ['note' => $d['review_note'] ?? null]);
        self::notifyDecision($pdo, $id, $status, $d['review_note'] ?? null);
        return self::get($req, $res, ['reservation_id' => $id]);
    }

    /** POST /reservations/{id}/cancel — owner cancels own; approver/manager may cancel any. */
    public static function cancel(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['reservation_id'];
        $r = self::row($pdo, $id);
        if (!$r) return Http::error($res, 'Reservation not found', 404);
        $privileged = self::canApprove($pdo, $cur) || self::canManage($pdo, $cur);
        if (!$privileged && (int)$r['member_id'] !== (int)$cur['id']) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("UPDATE reservations SET status='cancelled', updated_at=NOW() WHERE id=?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'reservations', $id, 'cancel', null, null);
        return self::get($req, $res, ['reservation_id' => $id]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['reservation_id'];
        if (!self::row($pdo, $id)) return Http::error($res, 'Reservation not found', 404);
        $pdo->prepare("DELETE FROM reservations WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'reservations', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /reservations/pending-count — badge for approvers (dashboard). */
    public static function pendingCount(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canApprove($pdo, $cur) && !self::canManage($pdo, $cur)) return Http::json($res, ['count' => 0]);
        $n = (int)$pdo->query("SELECT COUNT(*) FROM reservations WHERE status = 'pending'")->fetchColumn();
        return Http::json($res, ['count' => $n]);
    }
}
