<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Waitlist (Recruitment & Growth, Phase 1). Extends the Visitors module: manages
 * per-night program capacity and a weighted, night-aware waitlist that carries
 * forward across seasons. Weighting (decided): siblings of current members, and
 * youth whose parent is willing to mentor. Access mirrors Visitors (Mentor+).
 */
final class WaitlistController
{
    private const ACTIVE = ['waiting', 'offered'];

    private static function guard(PDO $pdo, Request $req): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, ['Mentor', 'Admin', 'System Administrator'])) return ['err' => 403, 'detail' => 'Access denied'];
        return ['member' => $m];
    }

    private static function num($v): ?float { return $v === null || $v === '' ? null : (float)$v; }
    private static function intOrNull($v): ?int { return $v === null || $v === '' ? null : (int)$v; }
    private static function dateOrNull($v): ?string { return $v === null || $v === '' ? null : substr((string)$v, 0, 10); }
    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return "$y-" . ($y + 1);
    }

    /** Weight: siblings + parent-mentor. Higher = higher priority; ties broken by request date. */
    private static function weight(array $e): int { return (int)$e['sibling_of_member'] + (int)$e['parent_mentor_interest']; }

    // ── Program nights (capacity) ─────────────────────────────────────────
    private static function nightMap(PDO $pdo, int $programId, string $season): array
    {
        $s = $pdo->prepare("SELECT * FROM program_nights WHERE program_id = ? AND season = ? ORDER BY display_order, id");
        $s->execute([$programId, $season]);
        $map = [];
        foreach ($s->fetchAll() as $n) $map[(int)$n['id']] = $n;
        return $map;
    }

    public static function nights(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $pid = (int)($q['program_id'] ?? 0);
        $season = trim((string)($q['season'] ?? '')) ?: self::currentSeason();
        if (!$pid) return Http::error($res, 'program_id is required', 422);
        $nights = array_values(self::nightMap($pdo, $pid, $season));
        // Per-night counts (waiting/offered eligible, and accepted).
        $entries = self::entriesFor($pdo, $pid, $season);
        $out = array_map(function ($n) use ($entries) {
            $nid = (int)$n['id'];
            $waiting = 0; $accepted = 0;
            foreach ($entries as $e) {
                $avail = $e['available_night_ids'] ? json_decode((string)$e['available_night_ids'], true) : [];
                if ($e['status'] === 'accepted' && (int)$e['offered_night_id'] === $nid) $accepted++;
                elseif (in_array($e['status'], self::ACTIVE, true) && (!$avail || in_array($nid, array_map('intval', $avail), true))) $waiting++;
            }
            $cap = (int)$n['capacity'];
            return ['id' => $nid, 'program_id' => (int)$n['program_id'], 'season' => $n['season'], 'name' => $n['name'],
                'capacity' => $cap, 'max_teams' => $n['max_teams'] !== null ? (int)$n['max_teams'] : null,
                'display_order' => (int)$n['display_order'], 'is_active' => (bool)$n['is_active'],
                'accepted' => $accepted, 'spots_open' => max(0, $cap - $accepted), 'waiting' => $waiting];
        }, $nights);
        return Http::json($res, $out);
    }

    public static function addNight(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $d = (array)$req->getParsedBody();
        $pid = (int)($d['program_id'] ?? 0);
        if (!$pid || empty($d['name'])) return Http::error($res, 'program_id and name are required.', 422);
        $season = trim((string)($d['season'] ?? '')) ?: self::currentSeason();
        $pdo->prepare("INSERT INTO program_nights (program_id, season, name, capacity, display_order) VALUES (?,?,?,?,?)")
            ->execute([$pid, $season, $d['name'], (int)($d['capacity'] ?? 0), (int)($d['display_order'] ?? 0)]);
        Audit::write($pdo, (int)$cur['id'], 'program_nights', (int)$pdo->lastInsertId(), 'create', null, $d);
        return Http::json($res, ['ok' => true], 201);
    }

    public static function updateNight(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $nid = (int)$route['night_id'];
        $s = $pdo->prepare("SELECT 1 FROM program_nights WHERE id = ?"); $s->execute([$nid]);
        if (!$s->fetch()) return Http::error($res, 'Night not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        foreach (['capacity', 'display_order', 'max_teams'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($d[$f] === null || $d[$f] === '') ? null : (int)$d[$f]; }
        if (array_key_exists('is_active', $d)) { $set[] = 'is_active = ?'; $args[] = (int)!empty($d['is_active']); }
        if ($set) { $args[] = $nid; $pdo->prepare("UPDATE program_nights SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'program_nights', $nid, 'update', null, $d);
        return Http::json($res, ['ok' => true]);
    }

    public static function deleteNight(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $nid = (int)$route['night_id'];
        $pdo->prepare("DELETE FROM program_nights WHERE id = ?")->execute([$nid]);
        Audit::write($pdo, (int)$cur['id'], 'program_nights', $nid, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Waitlist entries ──────────────────────────────────────────────────
    private static function entriesFor(PDO $pdo, int $programId, string $season): array
    {
        // A member is never on the waitlist unless they're a youth. Exclude entries that got
        // carried onto a parent/mentor/volunteer member (a parent entered as the waitlisted
        // "visitor" who later converted). Visitor-only rows (member_id NULL) and genuine
        // youth-member rows stay — this covers the list, the summary, and capacity counts.
        $s = $pdo->prepare(
            "SELECT we.* FROM waitlist_entries we
               LEFT JOIN members m ON m.id = we.member_id
               LEFT JOIN visitors v ON v.id = we.visitor_id
              WHERE we.program_id = ? AND we.season = ?
                AND (we.member_id IS NULL OR m.member_type = 'youth')
                AND (we.visitor_id IS NULL OR v.converted_member_id IS NULL)");
        $s->execute([$programId, $season]);
        return $s->fetchAll();
    }

    private static function personName(PDO $pdo, array $e): array
    {
        if ($e['visitor_id']) {
            $s = $pdo->prepare("SELECT first_name, last_name FROM visitors WHERE id = ?"); $s->execute([(int)$e['visitor_id']]);
            $r = $s->fetch();
            return ['type' => 'visitor', 'id' => (int)$e['visitor_id'], 'name' => $r ? trim("{$r['first_name']} {$r['last_name']}") : 'Visitor'];
        }
        if ($e['member_id']) {
            $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([(int)$e['member_id']]);
            $r = $s->fetch();
            return ['type' => 'member', 'id' => (int)$e['member_id'], 'name' => $r ? trim("{$r['first_name']} {$r['last_name']}") : 'Member'];
        }
        return ['type' => null, 'id' => null, 'name' => 'Unknown'];
    }

    private static function serialize(PDO $pdo, array $e, array $nightMap): array
    {
        $avail = $e['available_night_ids'] ? array_map('intval', json_decode((string)$e['available_night_ids'], true) ?: []) : [];
        $nightLabel = fn($id) => isset($nightMap[$id]) ? $nightMap[$id]['name'] : null;
        return [
            'id' => (int)$e['id'], 'person' => self::personName($pdo, $e),
            'program_id' => (int)$e['program_id'], 'season' => $e['season'], 'status' => $e['status'],
            'sibling_of_member' => (bool)$e['sibling_of_member'], 'parent_mentor_interest' => (bool)$e['parent_mentor_interest'],
            'weight' => self::weight($e),
            'available_nights' => array_values(array_filter(array_map(fn($id) => $nightLabel($id) ? ['id' => $id, 'name' => $nightLabel($id)] : null, $avail))),
            'preferred_night' => $e['preferred_night_id'] ? ['id' => (int)$e['preferred_night_id'], 'name' => $nightLabel((int)$e['preferred_night_id'])] : null,
            'requested_date' => $e['requested_date'], 'carried_from_season' => $e['carried_from_season'],
            'offered_night' => $e['offered_night_id'] ? ['id' => (int)$e['offered_night_id'], 'name' => $nightLabel((int)$e['offered_night_id'])] : null,
            'offered_at' => $e['offered_at'], 'offer_expires' => $e['offer_expires'], 'responded_at' => $e['responded_at'],
            'priority_reason' => $e['priority_reason'], 'notes' => $e['notes'],
        ];
    }

    /** Sort by weight desc, then earliest requested_date, then id. */
    private static function order(array $a, array $b): int
    {
        $wa = self::weight($a); $wb = self::weight($b);
        if ($wa !== $wb) return $wb <=> $wa;
        if ($a['requested_date'] !== $b['requested_date']) return strcmp((string)$a['requested_date'], (string)$b['requested_date']);
        return (int)$a['id'] <=> (int)$b['id'];
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $pid = (int)($q['program_id'] ?? 0);
        $season = trim((string)($q['season'] ?? '')) ?: self::currentSeason();
        if (!$pid) return Http::error($res, 'program_id is required', 422);
        $nightMap = self::nightMap($pdo, $pid, $season);
        $entries = self::entriesFor($pdo, $pid, $season);
        usort($entries, [self::class, 'order']);
        $out = []; $pos = 0;
        foreach ($entries as $e) {
            $row = self::serialize($pdo, $e, $nightMap);
            if (in_array($e['status'], self::ACTIVE, true)) { $pos++; $row['position'] = $pos; } else { $row['position'] = null; }
            $out[] = $row;
        }
        return Http::json($res, $out);
    }

    public static function add(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $d = (array)$req->getParsedBody();
        $pid = (int)($d['program_id'] ?? 0);
        $vid = self::intOrNull($d['visitor_id'] ?? null); $mid = self::intOrNull($d['member_id'] ?? null);
        if (!$pid || (!$vid && !$mid)) return Http::error($res, 'program_id and a visitor_id or member_id are required.', 422);
        $season = trim((string)($d['season'] ?? '')) ?: self::currentSeason();
        $avail = isset($d['available_night_ids']) ? json_encode(array_map('intval', (array)$d['available_night_ids'])) : null;
        $pdo->prepare("INSERT INTO waitlist_entries (visitor_id, member_id, program_id, season, sibling_of_member,
            parent_mentor_interest, available_night_ids, preferred_night_id, requested_date, carried_from_season, notes, created_by_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([$vid, $mid, $pid, $season, (int)!empty($d['sibling_of_member']), (int)!empty($d['parent_mentor_interest']),
                $avail, self::intOrNull($d['preferred_night_id'] ?? null), self::dateOrNull($d['requested_date'] ?? null) ?? date('Y-m-d'),
                $d['carried_from_season'] ?? null, $d['notes'] ?? null, (int)$cur['id']]);
        Audit::write($pdo, (int)$cur['id'], 'waitlist_entries', (int)$pdo->lastInsertId(), 'create', null, ['program_id' => $pid]);
        // Mirror the night answer into the canonical store so it's the one source of truth
        // (and survives even if this waitlist entry is later removed). See Core\NightPrefs.
        \App\Core\NightPrefs::save($pdo, $mid, $vid, $pid, $season,
            \App\Controllers\NightPrefsController::extractFields($d), 'waitlist', (int)$cur['id']);
        return self::listResponse($req, $res, $pid, $season);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['entry_id'];
        $s = $pdo->prepare("SELECT * FROM waitlist_entries WHERE id = ?"); $s->execute([$id]); $e = $s->fetch();
        if (!$e) return Http::error($res, 'Entry not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['sibling_of_member', 'parent_mentor_interest'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = (int)!empty($d[$f]); }
        if (array_key_exists('available_night_ids', $d)) { $set[] = 'available_night_ids = ?'; $args[] = $d['available_night_ids'] === null ? null : json_encode(array_map('intval', (array)$d['available_night_ids'])); }
        if (array_key_exists('preferred_night_id', $d)) { $set[] = 'preferred_night_id = ?'; $args[] = self::intOrNull($d['preferred_night_id']); }
        if (array_key_exists('status', $d) && in_array($d['status'], ['waiting', 'offered', 'accepted', 'declined', 'expired', 'withdrawn'], true)) { $set[] = 'status = ?'; $args[] = $d['status']; }
        if (array_key_exists('requested_date', $d)) { $set[] = 'requested_date = ?'; $args[] = self::dateOrNull($d['requested_date']); }
        if (array_key_exists('priority_reason', $d)) { $set[] = 'priority_reason = ?'; $args[] = $d['priority_reason']; }
        if (array_key_exists('notes', $d)) { $set[] = 'notes = ?'; $args[] = $d['notes']; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE waitlist_entries SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'waitlist_entries', $id, 'update', null, $d);
        // Keep the canonical night preference in step with any night edits made here.
        $npFields = \App\Controllers\NightPrefsController::extractFields($d);
        if ($npFields) {
            \App\Core\NightPrefs::save($pdo, self::intOrNull($e['member_id']), self::intOrNull($e['visitor_id']),
                (int)$e['program_id'], (string)$e['season'], $npFields, 'waitlist', (int)$cur['id']);
        }
        return self::listResponse($req, $res, (int)$e['program_id'], $e['season']);
    }

    public static function remove(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['entry_id'];
        $s = $pdo->prepare("SELECT program_id, season FROM waitlist_entries WHERE id = ?"); $s->execute([$id]); $e = $s->fetch();
        if (!$e) return Http::error($res, 'Entry not found', 404);
        $pdo->prepare("DELETE FROM waitlist_entries WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'waitlist_entries', $id, 'delete', null, null);
        return self::listResponse($req, $res, (int)$e['program_id'], $e['season']);
    }

    /** POST /waitlist/{id}/offer — offer a specific open night with a response deadline. */
    public static function offer(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['entry_id'];
        $s = $pdo->prepare("SELECT * FROM waitlist_entries WHERE id = ?"); $s->execute([$id]); $e = $s->fetch();
        if (!$e) return Http::error($res, 'Entry not found', 404);
        $d = (array)$req->getParsedBody();
        $nid = self::intOrNull($d['night_id'] ?? null);
        $days = (int)($d['expires_days'] ?? 7);
        $expires = date('Y-m-d', strtotime("+$days days"));
        $pdo->prepare("UPDATE waitlist_entries SET status = 'offered', offered_night_id = ?, offered_at = NOW(), offer_expires = ?, offered_by_id = ?, responded_at = NULL WHERE id = ?")
            ->execute([$nid, $expires, (int)$cur['id'], $id]);
        Audit::write($pdo, (int)$cur['id'], 'waitlist_entries', $id, 'offer', null, ['night_id' => $nid, 'expires' => $expires]);
        return self::listResponse($req, $res, (int)$e['program_id'], $e['season']);
    }

    /** POST /waitlist/{id}/respond — accept or decline an outstanding offer. */
    public static function respond(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['entry_id'];
        $s = $pdo->prepare("SELECT * FROM waitlist_entries WHERE id = ?"); $s->execute([$id]); $e = $s->fetch();
        if (!$e) return Http::error($res, 'Entry not found', 404);
        $d = (array)$req->getParsedBody();
        $status = !empty($d['accept']) ? 'accepted' : 'declined';
        $pdo->prepare("UPDATE waitlist_entries SET status = ?, responded_at = NOW() WHERE id = ?")->execute([$status, $id]);
        Audit::write($pdo, (int)$cur['id'], 'waitlist_entries', $id, 'respond', null, ['status' => $status]);
        return self::listResponse($req, $res, (int)$e['program_id'], $e['season']);
    }

    /** GET /waitlist/summary?season= — waitlist depth per program (growth signal). */
    public static function summary(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $season = trim((string)($req->getQueryParams()['season'] ?? '')) ?: self::currentSeason();
        $rows = $pdo->prepare("SELECT w.program_id, p.name AS program, SUM(w.status IN ('waiting','offered')) AS waiting,
                               SUM(w.status = 'accepted') AS accepted
                               FROM waitlist_entries w JOIN programs p ON p.id = w.program_id
                               WHERE w.season = ? GROUP BY w.program_id, p.name ORDER BY waiting DESC");
        $rows->execute([$season]);
        $capStmt = $pdo->prepare("SELECT COALESCE(SUM(capacity),0) FROM program_nights WHERE program_id = ? AND season = ? AND is_active = 1");
        $out = array_map(function ($r) use ($capStmt, $season) {
            $capStmt->execute([(int)$r['program_id'], $season]);
            return ['program_id' => (int)$r['program_id'], 'program' => $r['program'], 'season' => $season,
                'waiting' => (int)$r['waiting'], 'accepted' => (int)$r['accepted'], 'total_capacity' => (int)$capStmt->fetchColumn()];
        }, $rows->fetchAll());
        return Http::json($res, $out);
    }

    private static function listResponse(Request $req, Response $res, int $pid, string $season): Response
    {
        $pdo = Database::pdo();
        $nightMap = self::nightMap($pdo, $pid, $season);
        $entries = self::entriesFor($pdo, $pid, $season);
        usort($entries, [self::class, 'order']);
        $out = []; $pos = 0;
        foreach ($entries as $e) {
            $row = self::serialize($pdo, $e, $nightMap);
            if (in_array($e['status'], self::ACTIVE, true)) { $pos++; $row['position'] = $pos; } else { $row['position'] = null; }
            $out[] = $row;
        }
        return Http::json($res, $out);
    }
}
