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
 * Repair / Maintenance tickets (feedback #90).
 *
 * Any member with repairs.submit can report a broken item; anyone with
 * repairs.view can read tickets. Fixers (repairs.manage) assign, walk the
 * status workflow, and close. Tickets may link to a tracked inventory asset so
 * the repair/maintenance history follows the item.
 */
final class RepairsController
{
    private const KINDS = ['repair', 'maintenance'];
    private const STATUSES = ['pending', 'maintenance', 'in_progress', 'waiting_parts', 'testing', 'complete', 'closed'];
    private const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
    // Reaching one of these means the work is finished; stamp completed_date.
    private const DONE = ['complete', 'closed'];
    private const CORR_DIRECTIONS = ['outgoing', 'incoming', 'note'];
    private const CORR_CHANNELS = ['email', 'phone', 'portal', 'mail', 'chat', 'other'];

    private static function canView(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'repairs.view', 'read');
    }
    private static function canSubmit(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'repairs.submit', 'write');
    }
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'repairs.manage', 'write');
    }

    private static function name(PDO $pdo, ?int $id): ?string
    {
        if ($id === null) return null;
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?");
        $s->execute([$id]);
        $r = $s->fetch();
        return $r ? trim("{$r['first_name']} {$r['last_name']}") : null;
    }

    private static function row(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM repair_tickets WHERE id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function serialize(PDO $pdo, array $t, bool $withUpdates = false): array
    {
        $itemName = null; $locName = null;
        if ($t['inv_item_id'] !== null) {
            $s = $pdo->prepare("SELECT name, asset_tag FROM inv_items WHERE id = ?");
            $s->execute([(int)$t['inv_item_id']]);
            if ($r = $s->fetch()) {
                $itemName = $r['asset_tag'] ? "{$r['name']} ({$r['asset_tag']})" : $r['name'];
            }
        }
        if ($t['location_id'] !== null) {
            $s = $pdo->prepare("SELECT name FROM inv_locations WHERE id = ?");
            $s->execute([(int)$t['location_id']]);
            if ($r = $s->fetch()) $locName = $r['name'];
        }
        $out = [
            'id' => (int)$t['id'],
            'title' => $t['title'],
            'description' => $t['description'],
            'equipment_name' => $t['equipment_name'],
            'inv_item_id' => $t['inv_item_id'] !== null ? (int)$t['inv_item_id'] : null,
            'inv_item_name' => $itemName,
            'kind' => $t['kind'],
            'status' => $t['status'],
            'priority' => $t['priority'],
            'location_id' => $t['location_id'] !== null ? (int)$t['location_id'] : null,
            'location_name' => $locName,
            'reported_by_id' => $t['reported_by_id'] !== null ? (int)$t['reported_by_id'] : null,
            'reported_by_name' => self::name($pdo, $t['reported_by_id'] !== null ? (int)$t['reported_by_id'] : null),
            'reported_date' => $t['reported_date'],
            'assigned_to_id' => $t['assigned_to_id'] !== null ? (int)$t['assigned_to_id'] : null,
            'assigned_to_name' => self::name($pdo, $t['assigned_to_id'] !== null ? (int)$t['assigned_to_id'] : null),
            'completed_date' => $t['completed_date'],
            'resolution' => $t['resolution'],
            'repair_cost' => $t['repair_cost'] !== null ? (float)$t['repair_cost'] : null,
            'created_at' => $t['created_at'],
            'updated_at' => $t['updated_at'],
        ];
        // Replacement-parts BOM + cost roll-up.
        $ps = $pdo->prepare("SELECT p.*, i.asset_tag FROM repair_parts p LEFT JOIN inv_items i ON i.id = p.inv_item_id WHERE p.ticket_id = ? ORDER BY p.id");
        $ps->execute([(int)$t['id']]);
        $partsTotal = 0.0;
        $parts = array_map(function ($p) use (&$partsTotal) {
            $qty = (float)$p['quantity']; $unit = $p['unit_cost'] !== null ? (float)$p['unit_cost'] : null;
            $line = $unit !== null ? round($qty * $unit, 2) : null;
            if ($line !== null) $partsTotal += $line;
            return [
                'id' => (int)$p['id'], 'inv_item_id' => $p['inv_item_id'] !== null ? (int)$p['inv_item_id'] : null,
                'part_name' => $p['part_name'], 'asset_tag' => $p['asset_tag'] ?? null,
                'quantity' => $qty, 'unit_cost' => $unit, 'line_total' => $line, 'notes' => $p['notes'],
            ];
        }, $ps->fetchAll());
        $out['parts'] = $parts;
        $out['parts_total'] = round($partsTotal, 2);
        $out['total_cost'] = round($partsTotal + ($t['repair_cost'] !== null ? (float)$t['repair_cost'] : 0.0), 2);
        if ($withUpdates) {
            $s = $pdo->prepare("SELECT * FROM repair_updates WHERE ticket_id = ? ORDER BY id ASC");
            $s->execute([(int)$t['id']]);
            $out['updates'] = array_map(function ($u) use ($pdo) {
                return [
                    'id' => (int)$u['id'],
                    'member_id' => $u['member_id'] !== null ? (int)$u['member_id'] : null,
                    'member_name' => self::name($pdo, $u['member_id'] !== null ? (int)$u['member_id'] : null),
                    'body' => $u['body'],
                    'old_status' => $u['old_status'],
                    'new_status' => $u['new_status'],
                    'created_at' => $u['created_at'],
                ];
            }, $s->fetchAll());

            // Vendor / warranty correspondence thread.
            $cs = $pdo->prepare("SELECT c.*, v.name AS vendor_name FROM repair_correspondence c
                                 LEFT JOIN inv_vendors v ON v.id = c.vendor_id
                                 WHERE c.ticket_id = ? ORDER BY COALESCE(c.corresponded_on, DATE(c.created_at)) DESC, c.id DESC");
            $cs->execute([(int)$t['id']]);
            $out['correspondence'] = array_map(function ($c) use ($pdo) {
                return [
                    'id' => (int)$c['id'],
                    'direction' => $c['direction'],
                    'channel' => $c['channel'],
                    'contact_name' => $c['contact_name'],
                    'vendor_id' => $c['vendor_id'] !== null ? (int)$c['vendor_id'] : null,
                    'vendor_name' => $c['vendor_name'] ?? null,
                    'subject' => $c['subject'],
                    'body' => $c['body'],
                    'reference' => $c['reference'],
                    'corresponded_on' => $c['corresponded_on'],
                    'member_id' => $c['member_id'] !== null ? (int)$c['member_id'] : null,
                    'member_name' => self::name($pdo, $c['member_id'] !== null ? (int)$c['member_id'] : null),
                    'created_at' => $c['created_at'],
                ];
            }, $cs->fetchAll());
        }
        return $out;
    }

    // GET /api/v1/repairs/
    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $m)) return Http::error($res, 'Not allowed.', 403);

        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['status'])) {
            if ($q['status'] === 'open') {
                $where[] = "status NOT IN ('complete','closed')";
            } elseif (in_array($q['status'], self::STATUSES, true)) {
                $where[] = "status = ?"; $args[] = $q['status'];
            }
        }
        if (!empty($q['assigned_to_id'])) { $where[] = "assigned_to_id = ?"; $args[] = (int)$q['assigned_to_id']; }
        if (!empty($q['inv_item_id'])) { $where[] = "inv_item_id = ?"; $args[] = (int)$q['inv_item_id']; }
        $sql = "SELECT * FROM repair_tickets";
        if ($where) $sql .= " WHERE " . implode(' AND ', $where);
        // Open tickets first, then most-recently updated.
        $sql .= " ORDER BY (status IN ('complete','closed')) ASC, FIELD(priority,'urgent','high','normal','low'), updated_at DESC";
        $s = $pdo->prepare($sql); $s->execute($args);
        $rows = array_map(fn($t) => self::serialize($pdo, $t), $s->fetchAll());
        return Http::json($res, $rows);
    }

    // GET /api/v1/repairs/open-count
    public static function openCount(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $m)) return Http::json($res, ['count' => 0]);
        $n = (int)$pdo->query("SELECT COUNT(*) FROM repair_tickets WHERE status NOT IN ('complete','closed')")->fetchColumn();
        return Http::json($res, ['count' => $n]);
    }

    // GET /api/v1/repairs/{id}
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $t = self::row($pdo, (int)$route['repair_id']);
        if (!$t) return Http::error($res, 'Not found.', 404);
        return Http::json($res, self::serialize($pdo, $t, true));
    }

    // POST /api/v1/repairs/
    public static function create(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canSubmit($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $b = (array)$req->getParsedBody();

        $title = trim((string)($b['title'] ?? ''));
        if ($title === '') return Http::error($res, 'A short title is required.', 422);

        $kind = in_array($b['kind'] ?? '', self::KINDS, true) ? $b['kind'] : 'repair';
        $priority = in_array($b['priority'] ?? '', self::PRIORITIES, true) ? $b['priority'] : 'normal';
        $invItemId = isset($b['inv_item_id']) && $b['inv_item_id'] !== '' && $b['inv_item_id'] !== null ? (int)$b['inv_item_id'] : null;
        $locationId = isset($b['location_id']) && $b['location_id'] !== '' && $b['location_id'] !== null ? (int)$b['location_id'] : null;
        $reportedDate = !empty($b['reported_date']) ? $b['reported_date'] : date('Y-m-d');

        $s = $pdo->prepare(
            "INSERT INTO repair_tickets
              (title, description, equipment_name, inv_item_id, kind, status, priority, location_id,
               reported_by_id, reported_date)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)"
        );
        $s->execute([
            $title,
            trim((string)($b['description'] ?? '')) ?: null,
            trim((string)($b['equipment_name'] ?? '')) ?: null,
            $invItemId,
            $kind,
            $priority,
            $locationId,
            $m['id'],
            $reportedDate,
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.create', null, ['title' => $title]);
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true), 201);
    }

    // PATCH /api/v1/repairs/{id}
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $id = (int)$route['repair_id'];
        $t = self::row($pdo, $id);
        if (!$t) return Http::error($res, 'Not found.', 404);

        $b = (array)$req->getParsedBody();
        $isManager = self::canManage($pdo, $m);
        $isReporter = $m !== null && (int)$t['reported_by_id'] === (int)$m['id'];
        // The reporter may correct the details of their own open ticket; only a
        // manager may assign, change status, or set the resolution.
        if (!$isManager && !$isReporter) return Http::error($res, 'Not allowed.', 403);

        $sets = []; $args = [];
        $reporterFields = ['title', 'description', 'equipment_name', 'kind', 'priority'];
        foreach ($reporterFields as $f) {
            if (!array_key_exists($f, $b)) continue;
            if ($f === 'kind' && !in_array($b[$f], self::KINDS, true)) continue;
            if ($f === 'priority' && !in_array($b[$f], self::PRIORITIES, true)) continue;
            $sets[] = "$f = ?";
            $args[] = is_string($b[$f]) ? (trim($b[$f]) === '' ? null : trim($b[$f])) : $b[$f];
        }
        foreach (['inv_item_id', 'location_id'] as $f) {
            if (!array_key_exists($f, $b)) continue;
            $sets[] = "$f = ?";
            $args[] = ($b[$f] === '' || $b[$f] === null) ? null : (int)$b[$f];
        }
        if (array_key_exists('reported_date', $b)) {
            $sets[] = "reported_date = ?"; $args[] = $b['reported_date'] ?: null;
        }

        $statusChanged = null;
        if ($isManager) {
            if (array_key_exists('assigned_to_id', $b)) {
                $sets[] = "assigned_to_id = ?";
                $args[] = ($b['assigned_to_id'] === '' || $b['assigned_to_id'] === null) ? null : (int)$b['assigned_to_id'];
            }
            if (array_key_exists('resolution', $b)) {
                $sets[] = "resolution = ?"; $args[] = trim((string)$b['resolution']) ?: null;
            }
            if (array_key_exists('repair_cost', $b)) {
                $sets[] = "repair_cost = ?"; $args[] = ($b['repair_cost'] === '' || $b['repair_cost'] === null) ? null : (float)$b['repair_cost'];
            }
            if (array_key_exists('completed_date', $b)) {
                $sets[] = "completed_date = ?"; $args[] = $b['completed_date'] ?: null;
            }
            if (array_key_exists('status', $b) && in_array($b['status'], self::STATUSES, true) && $b['status'] !== $t['status']) {
                $statusChanged = $b['status'];
                $sets[] = "status = ?"; $args[] = $b['status'];
                // Auto-stamp / clear completed_date as the ticket crosses the done boundary.
                if (in_array($b['status'], self::DONE, true) && empty($t['completed_date']) && !array_key_exists('completed_date', $b)) {
                    $sets[] = "completed_date = ?"; $args[] = date('Y-m-d');
                } elseif (!in_array($b['status'], self::DONE, true) && !empty($t['completed_date']) && !array_key_exists('completed_date', $b)) {
                    $sets[] = "completed_date = NULL";
                }
            }
        }

        if ($sets) {
            $args[] = $id;
            $pdo->prepare("UPDATE repair_tickets SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
        }
        if ($statusChanged !== null) {
            $u = $pdo->prepare("INSERT INTO repair_updates (ticket_id, member_id, body, old_status, new_status) VALUES (?, ?, ?, ?, ?)");
            $u->execute([$id, $m['id'], null, $t['status'], $statusChanged]);
        }
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.update', null, $statusChanged ? ['status' => $statusChanged] : null);
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true));
    }

    // POST /api/v1/repairs/{id}/updates  — add a progress note (optionally with status change)
    public static function addUpdate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        $id = (int)$route['repair_id'];
        $t = self::row($pdo, $id);
        if (!$t) return Http::error($res, 'Not found.', 404);
        // Anyone who can view may add a note; only managers may change status via the note.
        if (!self::canView($pdo, $m)) return Http::error($res, 'Not allowed.', 403);

        $b = (array)$req->getParsedBody();
        $body = trim((string)($b['body'] ?? ''));
        $newStatus = null;
        if (self::canManage($pdo, $m) && !empty($b['new_status'])
            && in_array($b['new_status'], self::STATUSES, true) && $b['new_status'] !== $t['status']) {
            $newStatus = $b['new_status'];
        }
        if ($body === '' && $newStatus === null) return Http::error($res, 'Add a note or a status change.', 422);

        $u = $pdo->prepare("INSERT INTO repair_updates (ticket_id, member_id, body, old_status, new_status) VALUES (?, ?, ?, ?, ?)");
        $u->execute([$id, $m['id'], $body ?: null, $newStatus ? $t['status'] : null, $newStatus]);

        if ($newStatus !== null) {
            $sets = ["status = ?"]; $args = [$newStatus];
            if (in_array($newStatus, self::DONE, true) && empty($t['completed_date'])) { $sets[] = "completed_date = ?"; $args[] = date('Y-m-d'); }
            elseif (!in_array($newStatus, self::DONE, true) && !empty($t['completed_date'])) { $sets[] = "completed_date = NULL"; }
            $args[] = $id;
            $pdo->prepare("UPDATE repair_tickets SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.update_note', null, $newStatus ? ['status' => $newStatus] : null);
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true), 201);
    }

    // ── Replacement-parts BOM ──────────────────────────────────────────────
    /** POST /api/v1/repairs/{id}/parts — add a replacement part to the repair BOM. */
    public static function addPart(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $id = (int)$route['repair_id'];
        if (!self::row($pdo, $id)) return Http::error($res, 'Not found.', 404);
        $b = (array)$req->getParsedBody();
        $invItemId = !empty($b['inv_item_id']) ? (int)$b['inv_item_id'] : null;
        $name = trim((string)($b['part_name'] ?? ''));
        if ($name === '' && $invItemId) {
            $s = $pdo->prepare("SELECT name FROM inv_items WHERE id = ?"); $s->execute([$invItemId]);
            $name = (string)($s->fetchColumn() ?: 'Part');
        }
        if ($name === '') return Http::error($res, 'A part name (or inventory item) is required.', 422);
        $pdo->prepare("INSERT INTO repair_parts (ticket_id, inv_item_id, part_name, quantity, unit_cost, notes, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, NOW())")
            ->execute([$id, $invItemId, mb_substr($name, 0, 200),
                isset($b['quantity']) && $b['quantity'] !== '' ? (float)$b['quantity'] : 1,
                isset($b['unit_cost']) && $b['unit_cost'] !== '' ? (float)$b['unit_cost'] : null,
                ($b['notes'] ?? null) ?: null]);
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.part_add', null, ['part' => $name]);
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true), 201);
    }

    /** PATCH /api/v1/repairs/parts/{part_id} — edit a part line. */
    public static function updatePart(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $pid = (int)$route['part_id'];
        $s = $pdo->prepare("SELECT ticket_id FROM repair_parts WHERE id = ?"); $s->execute([$pid]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Part not found.', 404);
        $b = (array)$req->getParsedBody();
        $sets = []; $args = [];
        if (array_key_exists('part_name', $b) && trim((string)$b['part_name']) !== '') { $sets[] = 'part_name = ?'; $args[] = mb_substr(trim((string)$b['part_name']), 0, 200); }
        if (array_key_exists('quantity', $b)) { $sets[] = 'quantity = ?'; $args[] = $b['quantity'] === '' ? 1 : (float)$b['quantity']; }
        if (array_key_exists('unit_cost', $b)) { $sets[] = 'unit_cost = ?'; $args[] = ($b['unit_cost'] === '' || $b['unit_cost'] === null) ? null : (float)$b['unit_cost']; }
        if (array_key_exists('notes', $b)) { $sets[] = 'notes = ?'; $args[] = ($b['notes'] ?? null) ?: null; }
        if ($sets) { $args[] = $pid; $pdo->prepare("UPDATE repair_parts SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'repair_parts', $pid, 'update', null, $b);
        return Http::json($res, self::serialize($pdo, self::row($pdo, (int)$row['ticket_id']), true));
    }

    /** DELETE /api/v1/repairs/parts/{part_id} */
    public static function deletePart(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $pid = (int)$route['part_id'];
        $s = $pdo->prepare("SELECT ticket_id FROM repair_parts WHERE id = ?"); $s->execute([$pid]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Part not found.', 404);
        $pdo->prepare("DELETE FROM repair_parts WHERE id = ?")->execute([$pid]);
        Audit::write($pdo, (int)$m['id'], 'repair_parts', $pid, 'delete', null, null);
        return Http::json($res, self::serialize($pdo, self::row($pdo, (int)$row['ticket_id']), true));
    }

    // ── Vendor / warranty correspondence ───────────────────────────────────
    /** Normalize a correspondence payload into [column => value] pairs. */
    private static function corrFields(array $b): array
    {
        $out = [];
        if (array_key_exists('direction', $b)) $out['direction'] = in_array($b['direction'], self::CORR_DIRECTIONS, true) ? $b['direction'] : 'outgoing';
        if (array_key_exists('channel', $b)) $out['channel'] = in_array($b['channel'], self::CORR_CHANNELS, true) ? $b['channel'] : 'email';
        if (array_key_exists('contact_name', $b)) $out['contact_name'] = trim((string)$b['contact_name']) !== '' ? mb_substr(trim((string)$b['contact_name']), 0, 200) : null;
        if (array_key_exists('vendor_id', $b)) $out['vendor_id'] = ($b['vendor_id'] === '' || $b['vendor_id'] === null) ? null : (int)$b['vendor_id'];
        if (array_key_exists('subject', $b)) $out['subject'] = trim((string)$b['subject']) !== '' ? mb_substr(trim((string)$b['subject']), 0, 300) : null;
        if (array_key_exists('body', $b)) $out['body'] = trim((string)$b['body']) !== '' ? trim((string)$b['body']) : null;
        if (array_key_exists('reference', $b)) $out['reference'] = trim((string)$b['reference']) !== '' ? mb_substr(trim((string)$b['reference']), 0, 150) : null;
        if (array_key_exists('corresponded_on', $b)) $out['corresponded_on'] = !empty($b['corresponded_on']) ? $b['corresponded_on'] : null;
        return $out;
    }

    /** POST /api/v1/repairs/{id}/correspondence — log a vendor/warranty communication. */
    public static function addCorrespondence(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $id = (int)$route['repair_id'];
        if (!self::row($pdo, $id)) return Http::error($res, 'Not found.', 404);
        $f = self::corrFields((array)$req->getParsedBody());
        if (($f['body'] ?? null) === null && ($f['subject'] ?? null) === null) {
            return Http::error($res, 'Add a subject or message.', 422);
        }
        $f['direction'] = $f['direction'] ?? 'outgoing';
        $f['channel'] = $f['channel'] ?? 'email';
        $cols = array_keys($f); $cols[] = 'ticket_id'; $cols[] = 'member_id';
        $vals = array_values($f); $vals[] = $id; $vals[] = (int)$m['id'];
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO repair_correspondence (" . implode(', ', $cols) . ", created_at) VALUES ($ph, NOW())")->execute($vals);
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.correspondence_add', null, ['direction' => $f['direction']]);
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true), 201);
    }

    /** PATCH /api/v1/repairs/correspondence/{corr_id} — edit a logged communication. */
    public static function updateCorrespondence(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $cid = (int)$route['corr_id'];
        $s = $pdo->prepare("SELECT ticket_id FROM repair_correspondence WHERE id = ?"); $s->execute([$cid]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Correspondence not found.', 404);
        $f = self::corrFields((array)$req->getParsedBody());
        if ($f) {
            $sets = implode(', ', array_map(fn($k) => "$k = ?", array_keys($f)));
            $args = array_values($f); $args[] = $cid;
            $pdo->prepare("UPDATE repair_correspondence SET $sets WHERE id = ?")->execute($args);
        }
        Audit::write($pdo, (int)$m['id'], 'repair_correspondence', $cid, 'update', null, $f);
        return Http::json($res, self::serialize($pdo, self::row($pdo, (int)$row['ticket_id']), true));
    }

    /** DELETE /api/v1/repairs/correspondence/{corr_id} */
    public static function deleteCorrespondence(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $cid = (int)$route['corr_id'];
        $s = $pdo->prepare("SELECT ticket_id FROM repair_correspondence WHERE id = ?"); $s->execute([$cid]);
        $row = $s->fetch();
        if (!$row) return Http::error($res, 'Correspondence not found.', 404);
        $pdo->prepare("DELETE FROM repair_correspondence WHERE id = ?")->execute([$cid]);
        Audit::write($pdo, (int)$m['id'], 'repair_correspondence', $cid, 'delete', null, null);
        return Http::json($res, self::serialize($pdo, self::row($pdo, (int)$row['ticket_id']), true));
    }

    // POST /api/v1/repairs/{id}/claim — fixer takes the ticket
    public static function claim(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Only fixers can take a ticket.', 403);
        $id = (int)$route['repair_id'];
        $t = self::row($pdo, $id);
        if (!$t) return Http::error($res, 'Not found.', 404);
        $sets = ["assigned_to_id = ?"]; $args = [$m['id']];
        $statusChange = null;
        if ($t['status'] === 'pending') { $sets[] = "status = 'in_progress'"; $statusChange = 'in_progress'; }
        $args[] = $id;
        $pdo->prepare("UPDATE repair_tickets SET " . implode(', ', $sets) . " WHERE id = ?")->execute($args);
        $u = $pdo->prepare("INSERT INTO repair_updates (ticket_id, member_id, body, old_status, new_status) VALUES (?, ?, ?, ?, ?)");
        $u->execute([$id, $m['id'], 'Claimed this ticket.', $statusChange ? $t['status'] : null, $statusChange]);
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.claim');
        return Http::json($res, self::serialize($pdo, self::row($pdo, $id), true));
    }

    // DELETE /api/v1/repairs/{id}
    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $id = (int)$route['repair_id'];
        $t = self::row($pdo, $id);
        if (!$t) return Http::error($res, 'Not found.', 404);
        $pdo->prepare("DELETE FROM repair_tickets WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'repair_tickets', $id, 'repair.delete', ['title' => $t['title']], null);
        return Http::json($res, ['ok' => true]);
    }

    // GET /api/v1/repairs/assets — tracked inventory assets for the picker
    public static function assets(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $m)) return Http::error($res, 'Not allowed.', 403);
        $rows = $pdo->query(
            "SELECT id, name, asset_tag FROM inv_items WHERE item_type = 'asset' ORDER BY name ASC"
        )->fetchAll();
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'],
            'label' => $r['asset_tag'] ? "{$r['name']} ({$r['asset_tag']})" : $r['name'],
        ], $rows));
    }
}
