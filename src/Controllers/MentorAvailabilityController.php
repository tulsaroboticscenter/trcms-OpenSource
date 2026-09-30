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
 * Mentor unavailability — informational travel / out-of-office ranges shown on
 * the Events Calendar (hidden by default there).
 *
 * Visibility: Admin / System Administrator / "Mentor - Lead" see everyone's;
 * every mentor sees only their own; other member types see none. Enforced here.
 */
final class MentorAvailabilityController
{
    private const ADMIN_ROLES = ['Admin', 'System Administrator', 'Mentor - Lead'];

    private static function canSeeAll(PDO $pdo, array $m): bool
    {
        return Permissions::hasAnyRole($pdo, $m, self::ADMIN_ROLES);
    }

    private static function isMentor(array $m): bool
    {
        return ($m['member_type'] ?? '') === 'mentor';
    }

    /** GET /api/v1/mentor-unavailability?from=&to= — entries the viewer may see. */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);

        $q = $req->getQueryParams();
        $where = [];
        $args = [];
        // Overlap filter with the requested window.
        if (!empty($q['from'])) { $where[] = 'u.end_date >= ?'; $args[] = (string)$q['from']; }
        if (!empty($q['to']))   { $where[] = 'u.start_date <= ?'; $args[] = (string)$q['to']; }

        if (!self::canSeeAll($pdo, $cur)) {
            // Non-privileged: only your own entries (and only mentors have any).
            $where[] = 'u.member_id = ?';
            $args[] = (int)$cur['id'];
        }
        $sql = "SELECT u.id, u.member_id, u.start_date, u.end_date, u.note,
                       TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS member_name
                  FROM mentor_unavailability u
                  JOIN members m ON m.id = u.member_id"
             . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
             . ' ORDER BY u.start_date';
        $st = $pdo->prepare($sql);
        $st->execute($args);
        $rows = array_map(fn($r) => [
            'id' => (int)$r['id'],
            'member_id' => (int)$r['member_id'],
            'member_name' => $r['member_name'],
            'start_date' => $r['start_date'],
            'end_date' => $r['end_date'],
            'note' => $r['note'],
            'is_own' => (int)$r['member_id'] === (int)$cur['id'],
        ], $st->fetchAll());
        return Http::json($res, ['entries' => $rows, 'can_see_all' => self::canSeeAll($pdo, $cur)]);
    }

    /** POST /api/v1/mentor-unavailability — create (own, or admin for another mentor). */
    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);

        $b = (array)($req->getParsedBody() ?? []);
        $targetId = isset($b['member_id']) ? (int)$b['member_id'] : (int)$cur['id'];
        if ($targetId !== (int)$cur['id'] && !self::canSeeAll($pdo, $cur)) {
            return Http::error($res, 'You can only add unavailability for yourself.', 403);
        }
        if ($targetId === (int)$cur['id'] && !self::isMentor($cur) && !self::canSeeAll($pdo, $cur)) {
            return Http::error($res, 'Only mentors can log unavailability.', 403);
        }
        $start = self::validDate($b['start_date'] ?? null);
        $end = self::validDate($b['end_date'] ?? null) ?? $start;
        if (!$start) return Http::error($res, 'A start date is required.', 422);
        if ($end < $start) return Http::error($res, 'End date cannot be before the start date.', 422);

        $st = $pdo->prepare(
            "INSERT INTO mentor_unavailability (member_id, start_date, end_date, note, created_by_id, created_at)
             VALUES (?,?,?,?,?,NOW())"
        );
        $st->execute([$targetId, $start, $end, self::note($b['note'] ?? null), (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'mentor_unavailability', $id, 'create', null,
            ['member_id' => $targetId, 'start_date' => $start, 'end_date' => $end]);
        return Http::json($res, ['id' => $id], 201);
    }

    /** PUT /api/v1/mentor-unavailability/{id} — edit (owner or admin/lead). */
    public static function update(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $row = self::load($pdo, (int)$args['id']);
        if (!$row) return Http::error($res, 'Entry not found', 404);
        if (!self::canEdit($pdo, $cur, $row)) return Http::error($res, 'Not permitted', 403);

        $b = (array)($req->getParsedBody() ?? []);
        $start = self::validDate($b['start_date'] ?? null) ?? $row['start_date'];
        $end = self::validDate($b['end_date'] ?? null) ?? $row['end_date'];
        if ($end < $start) return Http::error($res, 'End date cannot be before the start date.', 422);
        $note = array_key_exists('note', $b) ? self::note($b['note']) : $row['note'];

        $pdo->prepare("UPDATE mentor_unavailability SET start_date=?, end_date=?, note=?, updated_at=NOW() WHERE id=?")
            ->execute([$start, $end, $note, (int)$args['id']]);
        Audit::write($pdo, (int)$cur['id'], 'mentor_unavailability', (int)$args['id'], 'update');
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /api/v1/mentor-unavailability/{id} — delete (owner or admin/lead). */
    public static function delete(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $row = self::load($pdo, (int)$args['id']);
        if (!$row) return Http::error($res, 'Entry not found', 404);
        if (!self::canEdit($pdo, $cur, $row)) return Http::error($res, 'Not permitted', 403);
        $pdo->prepare("DELETE FROM mentor_unavailability WHERE id=?")->execute([(int)$args['id']]);
        Audit::write($pdo, (int)$cur['id'], 'mentor_unavailability', (int)$args['id'], 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ---- helpers ----------------------------------------------------------

    private static function canEdit(PDO $pdo, array $cur, array $row): bool
    {
        return (int)$row['member_id'] === (int)$cur['id'] || self::canSeeAll($pdo, $cur);
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $st = $pdo->prepare("SELECT * FROM mentor_unavailability WHERE id = ?");
        $st->execute([$id]);
        return $st->fetch() ?: null;
    }

    private static function validDate($v): ?string
    {
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    }

    private static function note($v): ?string
    {
        $v = trim((string)($v ?? ''));
        return $v === '' ? null : mb_substr($v, 0, 300);
    }
}
