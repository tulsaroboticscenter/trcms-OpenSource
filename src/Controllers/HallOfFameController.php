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
 * Hall of Fame — a curated, published profile for each graduating member, so
 * today's youth can see those who came before them and the legacy they left.
 *
 * Each entry is a SNAPSHOT created from the member record (pre-filled, then
 * freely edited), so it stands alone even after the member is archived. Entries
 * are hidden (draft) until a manager publishes them. Viewing is open to all
 * members (hof.view = read); creating/editing/publishing needs hof.manage.
 */
final class HallOfFameController
{
    /** Scalar text/flag columns that map straight to request fields. */
    private const TEXT_FIELDS = ['first_name', 'last_name', 'photo_url', 'years_in_program', 'high_school',
        'eagle_scout_troop', 'college', 'field_of_study', 'degrees', 'where_now'];
    private const INT_FIELDS  = ['graduation_year', 'college_grad_year', 'display_order'];
    private const BOOL_FIELDS = ['deans_list_semifinalist', 'deans_list_finalist', 'eagle_scout', 'still_in_school', 'is_published'];
    private const JSON_FIELDS = ['teams', 'awards', 'positions', 'project_links', 'article_links', 'album_links', 'documents', 'reflections'];

    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'hof.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'hof.manage', 'write'); }

    private static function row(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM hof_members WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function jsonCol($v): array
    {
        if (is_array($v)) return array_values($v);
        $d = $v ? json_decode((string)$v, true) : [];
        return is_array($d) ? array_values($d) : [];
    }

    /** Compact card for the gallery (no heavy JSON detail). */
    private static function serializeCard(array $r): array
    {
        return [
            'id' => (int)$r['id'],
            'member_id' => $r['member_id'] !== null ? (int)$r['member_id'] : null,
            'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
            'photo_url' => $r['photo_url'],
            'graduation_year' => $r['graduation_year'] !== null ? (int)$r['graduation_year'] : null,
            'is_published' => (bool)$r['is_published'],
        ];
    }

    private static function serialize(array $r): array
    {
        $out = self::serializeCard($r) + [
            'years_in_program' => $r['years_in_program'], 'high_school' => $r['high_school'],
            'deans_list_semifinalist' => (bool)$r['deans_list_semifinalist'],
            'deans_list_finalist' => (bool)$r['deans_list_finalist'],
            'eagle_scout' => (bool)$r['eagle_scout'], 'eagle_scout_troop' => $r['eagle_scout_troop'],
            'college' => $r['college'], 'field_of_study' => $r['field_of_study'],
            'degrees' => $r['degrees'], 'where_now' => $r['where_now'],
            'college_grad_year' => $r['college_grad_year'] !== null ? (int)$r['college_grad_year'] : null,
            'still_in_school' => (bool)$r['still_in_school'],
            'display_order' => (int)$r['display_order'],
            'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'],
        ];
        foreach (self::JSON_FIELDS as $f) $out[$f] = self::jsonCol($r[$f] ?? null);
        return $out;
    }

    // ── Gallery + detail ─────────────────────────────────────────────────────

    /**
     * GET /hof/ — gallery, grouped by graduation year ("Class of 20xx").
     * Members see only published entries; managers see all when ?all=1, with a
     * draft flag. Returns { classes: [{ year, members: [card...] }], can_manage }.
     */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $manage = self::canManage($pdo, $cur);
        $includeHidden = $manage && !empty($req->getQueryParams()['all']);

        $where = $includeHidden ? '1=1' : 'is_published = 1';
        $rows = $pdo->query("SELECT * FROM hof_members WHERE $where
                             ORDER BY graduation_year DESC, display_order, last_name, first_name")->fetchAll();

        $classes = [];
        foreach ($rows as $r) {
            $yr = $r['graduation_year'] !== null ? (int)$r['graduation_year'] : 0;
            $classes[$yr] ??= ['year' => $yr ?: null, 'members' => []];
            $classes[$yr]['members'][] = self::serializeCard($r);
        }
        // Already ordered by year DESC from SQL; preserve that order.
        $ordered = [];
        $seen = [];
        foreach ($rows as $r) {
            $yr = $r['graduation_year'] !== null ? (int)$r['graduation_year'] : 0;
            if (!isset($seen[$yr])) { $seen[$yr] = true; $ordered[] = $classes[$yr]; }
        }
        return Http::json($res, ['classes' => $ordered, 'can_manage' => $manage]);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $r = self::row($pdo, (int)$route['hof_id']);
        if (!$r) return Http::error($res, 'Hall of Fame entry not found', 404);
        if (!$r['is_published'] && !self::canManage($pdo, $cur)) return Http::error($res, 'Hall of Fame entry not found', 404);
        return Http::json($res, self::serialize($r));
    }

    // ── Create / prefill / edit ──────────────────────────────────────────────

    /** Build a snapshot payload from a member's existing record + history. */
    private static function snapshotFromMember(PDO $pdo, array $m): array
    {
        $mid = (int)$m['id'];

        // Teams the member was ever on, as readable labels.
        $teams = [];
        try {
            $ts = $pdo->prepare(
                "SELECT DISTINCT t.team_number, COALESCE(ts.team_name, CONCAT('Team ', t.team_number)) AS team_name, ts.season
                 FROM team_member_assignments tma
                 JOIN team_seasons ts ON ts.id = tma.team_season_id
                 JOIN teams t ON t.id = ts.team_id
                 WHERE tma.member_id = ? ORDER BY ts.season");
            $ts->execute([$mid]);
            foreach ($ts->fetchAll() as $t) {
                $teams[] = ['label' => "#{$t['team_number']} {$t['team_name']}", 'season' => $t['season']];
            }
        } catch (\Throwable $e) { /* table shape differs — leave empty */ }

        // YLC leadership positions, grouped by role with the terms held.
        $positions = [];
        try {
            $ys = $pdo->prepare("SELECT role, term FROM ylc_memberships WHERE member_id = ? AND role IS NOT NULL AND role <> '' ORDER BY term");
            $ys->execute([$mid]);
            $byRole = [];
            foreach ($ys->fetchAll() as $y) { $byRole[$y['role']][] = $y['term']; }
            foreach ($byRole as $role => $terms) {
                $terms = array_values(array_filter(array_unique($terms)));
                $positions[] = ['role' => 'YLC ' . $role, 'team' => '', 'terms' => implode(', ', $terms)];
            }
        } catch (\Throwable $e) { /* leave empty */ }

        // Awards/recognitions — seed from completed certifications (editable starting point).
        $awards = [];
        try {
            $as = $pdo->prepare(
                "SELECT c.name, mc.completed_date FROM member_certifications mc
                 JOIN certifications c ON c.id = mc.certification_id
                 WHERE mc.member_id = ? AND mc.status = 'completed' ORDER BY mc.completed_date");
            $as->execute([$mid]);
            foreach ($as->fetchAll() as $a) {
                $awards[] = ['name' => $a['name'], 'year' => $a['completed_date'] ? (int)substr($a['completed_date'], 0, 4) : null];
            }
        } catch (\Throwable $e) { /* leave empty */ }

        // Years in program: from join year to graduation year, when both are known.
        $yearsInProgram = '';
        $startYear = !empty($m['date_joined']) ? (int)substr((string)$m['date_joined'], 0, 4) : null;
        $gradYear = $m['graduation_year'] !== null ? (int)$m['graduation_year'] : null;
        if ($startYear && $gradYear && $gradYear >= $startYear) {
            $n = $gradYear - $startYear;
            $yearsInProgram = "$startYear\u{2013}$gradYear" . ($n > 0 ? " ($n year" . ($n === 1 ? '' : 's') . ")" : '');
        }

        return [
            'member_id' => $mid,
            'first_name' => $m['first_name'], 'last_name' => $m['last_name'],
            'photo_url' => $m['photo_url'] ?? null,
            'graduation_year' => $gradYear,
            'years_in_program' => $yearsInProgram,
            'high_school' => $m['school'] ?? null,
            'teams' => $teams, 'positions' => $positions, 'awards' => $awards,
        ];
    }

    /** POST /hof/from-member/{member_id} — create a draft HoF entry pre-filled from a member. */
    public static function createFromMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id'];
        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$mid]);
        $m = $ms->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);

        // One HoF entry per member (avoid accidental duplicates).
        $ex = $pdo->prepare("SELECT id FROM hof_members WHERE member_id = ?"); $ex->execute([$mid]);
        if ($row = $ex->fetch()) {
            return Http::json($res, ['id' => (int)$row['id'], 'already_existed' => true] + self::serialize(self::row($pdo, (int)$row['id'])));
        }
        $snap = self::snapshotFromMember($pdo, $m);
        $id = self::insert($pdo, $snap, (int)$cur['id']);
        // Graduating into the Hall of Fame makes the member an alum (permanently).
        $pdo->prepare("UPDATE members SET is_alumni = 1 WHERE id = ?")->execute([$mid]);
        Audit::write($pdo, (int)$cur['id'], 'hof_members', $id, 'create', null, ['from_member_id' => $mid, 'name' => "{$m['first_name']} {$m['last_name']}", 'marked_alumni' => true]);
        return Http::json($res, ['id' => $id, 'already_existed' => false] + self::serialize(self::row($pdo, $id)), 201);
    }

    /** POST /hof/ — create a blank/manual entry. */
    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['first_name']) || empty($d['last_name'])) return Http::error($res, 'First and last name are required.', 422);
        $id = self::insert($pdo, $d, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'hof_members', $id, 'create', null, ['name' => "{$d['first_name']} {$d['last_name']}"]);
        return Http::json($res, self::serialize(self::row($pdo, $id)), 201);
    }

    /** Insert with a normalized payload; returns new id. */
    private static function insert(PDO $pdo, array $d, int $actorId): int
    {
        $cols = ['member_id', 'created_by_id'];
        $vals = [isset($d['member_id']) ? (int)$d['member_id'] : null, $actorId];
        foreach (self::TEXT_FIELDS as $f) { $cols[] = $f; $vals[] = ($d[$f] ?? '') !== '' ? $d[$f] : null; }
        foreach (self::INT_FIELDS as $f)  {
            $cols[] = $f;
            // display_order is NOT NULL (defaults 0); graduation_year is nullable.
            $vals[] = isset($d[$f]) && $d[$f] !== '' ? (int)$d[$f] : ($f === 'display_order' ? 0 : null);
        }
        foreach (self::BOOL_FIELDS as $f) { $cols[] = $f; $vals[] = (int)!empty($d[$f]); }
        foreach (self::JSON_FIELDS as $f) { $cols[] = $f; $vals[] = json_encode(self::jsonCol($d[$f] ?? null)); }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO hof_members (" . implode(',', $cols) . ") VALUES ($ph)")->execute($vals);
        return (int)$pdo->lastInsertId();
    }

    /** PATCH /hof/{id} — update any provided fields. */
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['hof_id'];
        if (!self::row($pdo, $id)) return Http::error($res, 'Hall of Fame entry not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::TEXT_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f] !== '' ? $d[$f] : null; }
        foreach (self::INT_FIELDS as $f)  if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f] !== '' && $d[$f] !== null ? (int)$d[$f] : null; }
        foreach (self::BOOL_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = (int)!empty($d[$f]); }
        foreach (self::JSON_FIELDS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = json_encode(self::jsonCol($d[$f])); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id;
            $pdo->prepare("UPDATE hof_members SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'hof_members', $id, 'update', null, array_intersect_key($d, array_flip(array_merge(self::TEXT_FIELDS, self::INT_FIELDS, self::BOOL_FIELDS))));
        return Http::json($res, self::serialize(self::row($pdo, $id)));
    }

    /** POST /hof/{id}/publish — body { published: bool }. Toggles visibility. */
    public static function setPublished(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['hof_id'];
        if (!self::row($pdo, $id)) return Http::error($res, 'Hall of Fame entry not found', 404);
        $published = (int)!empty(((array)$req->getParsedBody())['published']);
        $pdo->prepare("UPDATE hof_members SET is_published = ?, updated_at = NOW() WHERE id = ?")->execute([$published, $id]);
        Audit::write($pdo, (int)$cur['id'], 'hof_members', $id, $published ? 'publish' : 'unpublish', null, null);
        return Http::json($res, self::serialize(self::row($pdo, $id)));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['hof_id'];
        if (!self::row($pdo, $id)) return Http::error($res, 'Hall of Fame entry not found', 404);
        $pdo->prepare("DELETE FROM hof_members WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'hof_members', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * GET /hof/eligible — current youth who can be graduated into the Hall
     * (active youth not already in the HoF), for the summer-migration batch tool.
     */
    public static function eligible(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query(
            "SELECT m.id, m.first_name, m.last_name, m.photo_url, m.graduation_year, m.school
             FROM members m
             WHERE m.member_type = 'youth' AND (m.is_active = 1 OR m.is_active IS NULL)
               AND (m.is_system = 0 OR m.is_system IS NULL)
               AND NOT EXISTS (SELECT 1 FROM hof_members h WHERE h.member_id = m.id)
             ORDER BY m.graduation_year DESC, m.last_name, m.first_name")->fetchAll();
        return Http::json($res, array_map(fn($m) => [
            'id' => (int)$m['id'], 'first_name' => $m['first_name'], 'last_name' => $m['last_name'],
            'photo_url' => $m['photo_url'], 'graduation_year' => $m['graduation_year'] !== null ? (int)$m['graduation_year'] : null,
            'school' => $m['school'],
        ], $rows));
    }
}
