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
 * Meeting engagement — the "Who's It?" spotlight.
 *
 * A meeting leader turns it on for an event and picks / shuffles / hand-picks
 * someone from the members CURRENTLY checked into that event. Members checked into
 * the same event can ask "am I it?" — and are told only about themselves, never who
 * the pick actually is. Running it needs spotlight.manage; checking your own status
 * needs nothing beyond being logged in.
 */
final class SpotlightController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'spotlight.manage', 'write');
    }

    /** Members currently checked in (not checked out) to an event. */
    private static function present(PDO $pdo, int $eventId): array
    {
        $s = $pdo->prepare(
            "SELECT DISTINCT m.id, m.first_name, m.last_name, m.member_type, m.photo_url
               FROM checkins c JOIN members m ON m.id = c.member_id
              WHERE c.event_id = ? AND c.time_out IS NULL
              ORDER BY m.first_name, m.last_name"
        );
        $s->execute([$eventId]);
        return array_map(fn($r) => [
            'member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'member_type' => $r['member_type'], 'photo_url' => $r['photo_url'],
        ], $s->fetchAll());
    }

    private static function row(PDO $pdo, int $eventId): ?array
    {
        $s = $pdo->prepare("SELECT * FROM event_spotlight WHERE event_id = ?"); $s->execute([$eventId]);
        return $s->fetch() ?: null;
    }

    /** GET /spotlight/events — events with people checked in right now (what you can run). */
    public static function events(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query(
            "SELECT e.id, e.name, e.event_date,
                    COUNT(DISTINCT c.member_id) AS present,
                    COALESCE(sp.is_active, 0) AS is_active
               FROM checkins c
               JOIN events e ON e.id = c.event_id
               LEFT JOIN event_spotlight sp ON sp.event_id = e.id
              WHERE c.time_out IS NULL
              GROUP BY e.id, e.name, e.event_date, sp.is_active
              ORDER BY e.event_date DESC, e.id DESC"
        )->fetchAll();
        return Http::json($res, array_map(fn($r) => [
            'event_id' => (int)$r['id'], 'name' => $r['name'], 'event_date' => $r['event_date'],
            'present' => (int)$r['present'], 'is_active' => (bool)$r['is_active'],
        ], $rows));
    }

    /** GET /spotlight/event/{event_id} — leader view: who's present + the current pick. */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $eventId = (int)$route['event_id'];
        $ev = $pdo->prepare("SELECT id, name, event_date FROM events WHERE id = ?"); $ev->execute([$eventId]);
        $event = $ev->fetch();
        if (!$event) return Http::error($res, 'Event not found', 404);
        $row = self::row($pdo, $eventId);
        $present = self::present($pdo, $eventId);
        $selected = null;
        if ($row && $row['selected_member_id'] !== null) {
            foreach ($present as $p) if ($p['member_id'] === (int)$row['selected_member_id']) { $selected = $p; break; }
            if (!$selected) { // picked, then they checked out — still show the name
                $s = $pdo->prepare("SELECT id, first_name, last_name FROM members WHERE id = ?");
                $s->execute([(int)$row['selected_member_id']]);
                if ($x = $s->fetch()) $selected = ['member_id' => (int)$x['id'], 'name' => trim($x['first_name'] . ' ' . $x['last_name']), 'gone' => true];
            }
        }
        return Http::json($res, [
            'event' => ['event_id' => (int)$event['id'], 'name' => $event['name'], 'event_date' => $event['event_date']],
            'is_active' => (bool)($row['is_active'] ?? false),
            'selected' => $selected, 'present' => $present, 'present_count' => count($present),
        ]);
    }

    /** POST /spotlight/event/{event_id}/activate — {is_active:bool} turn the pane on/off. */
    public static function activate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $eventId = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $active = !empty($d['is_active']) ? 1 : 0;
        $pdo->prepare("INSERT INTO event_spotlight (event_id, is_active, updated_by_id, created_at, updated_at)
                       VALUES (?,?,?,NOW(),NOW())
                       ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), updated_by_id = VALUES(updated_by_id), updated_at = NOW()")
            ->execute([$eventId, $active, (int)$m['id']]);
        // Turning it off clears the pick so nobody is left "it" between rounds.
        if (!$active) $pdo->prepare("UPDATE event_spotlight SET selected_member_id = NULL WHERE event_id = ?")->execute([$eventId]);
        Audit::write($pdo, (int)$m['id'], 'event_spotlight', $eventId, 'spotlight.activate', null, ['is_active' => (bool)$active]);
        return self::get($req, $res, $route);
    }

    /**
     * POST /spotlight/event/{event_id}/pick — pick someone. {member_id} to hand-pick,
     * otherwise a random person from those currently checked in (never the same
     * person twice in a row when there's more than one candidate).
     */
    public static function pick(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $eventId = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $present = self::present($pdo, $eventId);
        if (!$present) return Http::error($res, 'Nobody is checked into this event right now.', 422);

        $manual = !empty($d['member_id']) ? (int)$d['member_id'] : null;
        if ($manual !== null) {
            $ok = false; foreach ($present as $p) if ($p['member_id'] === $manual) { $ok = true; break; }
            if (!$ok) return Http::error($res, 'That member is not checked into this event.', 422);
            $chosen = $manual;
        } else {
            $row = self::row($pdo, $eventId);
            $prev = $row && $row['selected_member_id'] !== null ? (int)$row['selected_member_id'] : null;
            $pool = $present;
            if ($prev !== null && count($present) > 1) $pool = array_values(array_filter($present, fn($p) => $p['member_id'] !== $prev));
            $chosen = $pool[random_int(0, count($pool) - 1)]['member_id'];
        }

        $pdo->prepare("INSERT INTO event_spotlight (event_id, is_active, selected_member_id, updated_by_id, created_at, updated_at)
                       VALUES (?,1,?,?,NOW(),NOW())
                       ON DUPLICATE KEY UPDATE selected_member_id = VALUES(selected_member_id), updated_by_id = VALUES(updated_by_id), updated_at = NOW()")
            ->execute([$eventId, $chosen, (int)$m['id']]);
        Audit::write($pdo, (int)$m['id'], 'event_spotlight', $eventId, 'spotlight.pick', null, ['manual' => $manual !== null]);
        return self::get($req, $res, $route);
    }

    /**
     * GET /spotlight/me — a member asking "am I it?". Only reports on the caller and
     * only for an ACTIVE spotlight on an event they're currently checked into. Never
     * reveals who the pick is when it isn't them.
     */
    public static function me(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $s = $pdo->prepare(
            "SELECT sp.selected_member_id, e.name
               FROM checkins c
               JOIN event_spotlight sp ON sp.event_id = c.event_id AND sp.is_active = 1
               JOIN events e ON e.id = c.event_id
              WHERE c.member_id = ? AND c.time_out IS NULL
              ORDER BY sp.updated_at DESC LIMIT 1"
        );
        $s->execute([(int)$m['id']]);
        $row = $s->fetch();
        if (!$row) return Http::json($res, ['active' => false]);
        return Http::json($res, [
            'active' => true, 'event_name' => $row['name'],
            'picked' => $row['selected_member_id'] !== null,
            'am_i_it' => $row['selected_member_id'] !== null && (int)$row['selected_member_id'] === (int)$m['id'],
        ]);
    }
}
