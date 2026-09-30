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
 * School & Partner relationship management (Recruitment Phase 2). Schools are the
 * primary channel for reaching students; this tracks each school, its contacts,
 * engagement history, and attribution (prospects/enrollments credited to it).
 * Access mirrors Visitors (Mentor+).
 */
final class SchoolsController
{
    private static function guard(PDO $pdo, Request $req): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, ['Mentor', 'Admin', 'System Administrator'])) return ['err' => 403, 'detail' => 'Access denied'];
        return ['member' => $m];
    }

    private static function attribution(PDO $pdo, int $schoolId): array
    {
        $s = $pdo->prepare("SELECT COUNT(*) AS prospects, SUM(status = 'enrolled') AS enrolled FROM visitors WHERE school_id = ?");
        $s->execute([$schoolId]); $r = $s->fetch();
        return ['prospects' => (int)$r['prospects'], 'enrolled' => (int)$r['enrolled']];
    }

    private static function serialize(PDO $pdo, array $s, bool $counts = true): array
    {
        $out = ['id' => (int)$s['id'], 'name' => $s['name'], 'type' => $s['type'], 'district' => $s['district'],
            'address' => $s['address'], 'notes' => $s['notes'], 'is_active' => (bool)$s['is_active']];
        if ($counts) {
            $c = $pdo->prepare("SELECT COUNT(*) FROM school_contacts WHERE school_id = ?"); $c->execute([(int)$s['id']]);
            $e = $pdo->prepare("SELECT COUNT(*) FROM school_engagements WHERE school_id = ?"); $e->execute([(int)$s['id']]);
            $out['contact_count'] = (int)$c->fetchColumn();
            $out['engagement_count'] = (int)$e->fetchColumn();
            $out += self::attribution($pdo, (int)$s['id']);
        }
        return $out;
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $where = '1=1'; $args = [];
        if (!empty($q['search'])) { $where .= ' AND name LIKE ?'; $args[] = '%' . $q['search'] . '%'; }
        $s = $pdo->prepare("SELECT * FROM schools WHERE $where ORDER BY is_active DESC, name");
        $s->execute($args);
        return Http::json($res, array_map(fn($r) => self::serialize($pdo, $r), $s->fetchAll()));
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $id = (int)$route['school_id'];
        $s = $pdo->prepare("SELECT * FROM schools WHERE id = ?"); $s->execute([$id]); $sch = $s->fetch();
        if (!$sch) return Http::error($res, 'School not found', 404);
        $cs = $pdo->prepare("SELECT * FROM school_contacts WHERE school_id = ? ORDER BY id"); $cs->execute([$id]);
        $contacts = array_map(fn($c) => ['id' => (int)$c['id'], 'name' => $c['name'], 'title' => $c['title'],
            'email' => $c['email'], 'phone' => $c['phone'], 'notes' => $c['notes']], $cs->fetchAll());
        $es = $pdo->prepare("SELECT se.*, TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS member_name
                             FROM school_engagements se LEFT JOIN members m ON m.id = se.member_id
                             WHERE se.school_id = ? ORDER BY COALESCE(se.engaged_on, se.created_at) DESC, se.id DESC");
        $es->execute([$id]);
        $engagements = array_map(fn($e) => ['id' => (int)$e['id'], 'engaged_on' => $e['engaged_on'], 'type' => $e['type'],
            'notes' => $e['notes'], 'outcome' => $e['outcome'], 'member_name' => !empty($e['member_name']) ? $e['member_name'] : null], $es->fetchAll());
        return Http::json($res, self::serialize($pdo, $sch) + ['contacts' => $contacts, 'engagements' => $engagements]);
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'School name is required.', 422);
        $pdo->prepare("INSERT INTO schools (name, type, district, address, notes, created_by_id) VALUES (?,?,?,?,?,?)")
            ->execute([$d['name'], $d['type'] ?? null, $d['district'] ?? null, $d['address'] ?? null, $d['notes'] ?? null, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'schools', $id, 'create', null, ['name' => $d['name']]);
        return self::get($req, $res, ['school_id' => $id]);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['school_id'];
        $s = $pdo->prepare("SELECT 1 FROM schools WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'School not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'type', 'district', 'address', 'notes'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if (array_key_exists('is_active', $d)) { $set[] = 'is_active = ?'; $args[] = (int)!empty($d['is_active']); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE schools SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'schools', $id, 'update', null, $d);
        return self::get($req, $res, ['school_id' => $id]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['school_id'];
        $pdo->prepare("DELETE FROM schools WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'schools', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Contacts ──────────────────────────────────────────────────────────
    public static function addContact(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $sid = (int)$route['school_id'];
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Contact name is required.', 422);
        $pdo->prepare("INSERT INTO school_contacts (school_id, name, title, email, phone, notes) VALUES (?,?,?,?,?,?)")
            ->execute([$sid, $d['name'], $d['title'] ?? null, $d['email'] ?? null, $d['phone'] ?? null, $d['notes'] ?? null]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$g['member']['id'], 'school_contacts', $newId, 'create', null, ['school_id' => $sid, 'name' => $d['name']]);
        return self::get($req, $res, ['school_id' => $sid]);
    }

    public static function updateContact(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cid = (int)$route['contact_id'];
        $s = $pdo->prepare("SELECT school_id FROM school_contacts WHERE id = ?"); $s->execute([$cid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Contact not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'title', 'email', 'phone', 'notes'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if ($set) { $args[] = $cid; $pdo->prepare("UPDATE school_contacts SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$g['member']['id'], 'school_contacts', $cid, 'update', null, $d);
        return self::get($req, $res, ['school_id' => (int)$r['school_id']]);
    }

    public static function deleteContact(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cid = (int)$route['contact_id'];
        $s = $pdo->prepare("SELECT school_id FROM school_contacts WHERE id = ?"); $s->execute([$cid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Contact not found', 404);
        $pdo->prepare("DELETE FROM school_contacts WHERE id = ?")->execute([$cid]);
        Audit::write($pdo, (int)$g['member']['id'], 'school_contacts', $cid, 'delete', null, null);
        return self::get($req, $res, ['school_id' => (int)$r['school_id']]);
    }

    // ── Engagements ───────────────────────────────────────────────────────
    public static function addEngagement(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $sid = (int)$route['school_id'];
        $d = (array)$req->getParsedBody();
        $pdo->prepare("INSERT INTO school_engagements (school_id, engaged_on, type, notes, outcome, member_id, created_by_id) VALUES (?,?,?,?,?,?,?)")
            ->execute([$sid, !empty($d['engaged_on']) ? substr((string)$d['engaged_on'], 0, 10) : date('Y-m-d'),
                $d['type'] ?? null, $d['notes'] ?? null, $d['outcome'] ?? null, (int)$cur['id'], (int)$cur['id']]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'school_engagements', $newId, 'create', null, ['school_id' => $sid]);
        return self::get($req, $res, ['school_id' => $sid]);
    }

    public static function deleteEngagement(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $eid = (int)$route['engagement_id'];
        $s = $pdo->prepare("SELECT school_id FROM school_engagements WHERE id = ?"); $s->execute([$eid]); $r = $s->fetch();
        if (!$r) return Http::error($res, 'Engagement not found', 404);
        $pdo->prepare("DELETE FROM school_engagements WHERE id = ?")->execute([$eid]);
        Audit::write($pdo, (int)$g['member']['id'], 'school_engagements', $eid, 'delete', null, null);
        return self::get($req, $res, ['school_id' => (int)$r['school_id']]);
    }
}
