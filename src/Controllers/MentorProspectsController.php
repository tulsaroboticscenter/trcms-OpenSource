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
 * Mentor / volunteer prospect pipeline (Recruitment Phase 3). Tracks interested
 * adults from first contact through onboarding (YPT, background check, T&C,
 * orientation) to becoming an active mentor member. Access mirrors Visitors.
 */
final class MentorProspectsController
{
    private const STAGES = ['interested', 'contacted', 'onboarding', 'active', 'declined'];
    private const CHECKS = ['ypt_done', 'background_done', 'tc_done', 'orientation_done'];
    private const KINDS = ['mentor', 'volunteer'];

    private static function guard(PDO $pdo, Request $req): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, ['Mentor', 'Admin', 'System Administrator'])) return ['err' => 403, 'detail' => 'Access denied'];
        return ['member' => $m];
    }

    private static function intOrNull($v): ?int { return $v === null || $v === '' ? null : (int)$v; }

    private static function serialize(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'name' => $r['name'], 'kind' => $r['kind'] ?? 'mentor',
            'email' => $r['email'], 'phone' => $r['phone'],
            'source' => $r['source'], 'stage' => $r['stage'],
            'sponsor_id' => self::intOrNull($r['sponsor_id'] ?? null),
            'sponsor_name' => !empty($r['sponsor_name']) ? $r['sponsor_name'] : null,
            'ypt_done' => (bool)$r['ypt_done'], 'background_done' => (bool)$r['background_done'],
            'tc_done' => (bool)$r['tc_done'], 'orientation_done' => (bool)$r['orientation_done'],
            'owner_id' => self::intOrNull($r['owner_id']), 'owner_name' => !empty($r['owner_name']) ? $r['owner_name'] : null,
            'from_visitor_id' => self::intOrNull($r['from_visitor_id']),
            'from_visitor_name' => !empty($r['from_visitor_name']) ? $r['from_visitor_name'] : null,
            'converted_member_id' => self::intOrNull($r['converted_member_id']),
            'onboarding_complete' => (bool)$r['ypt_done'] && (bool)$r['background_done'] && (bool)$r['tc_done'] && (bool)$r['orientation_done'],
            'notes' => $r['notes'],
        ];
    }

    private static function loadJoined(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT mp.*, TRIM(CONCAT(COALESCE(o.first_name,''),' ',COALESCE(o.last_name,''))) AS owner_name,
                                   TRIM(CONCAT(COALESCE(v.first_name,''),' ',COALESCE(v.last_name,''))) AS from_visitor_name,
                                   sp.name AS sponsor_name
                            FROM mentor_prospects mp
                            LEFT JOIN members o ON o.id = mp.owner_id
                            LEFT JOIN visitors v ON v.id = mp.from_visitor_id
                            LEFT JOIN sponsors sp ON sp.id = mp.sponsor_id
                            WHERE mp.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $where = '1=1'; $args = [];
        if (!empty($q['stage']) && in_array($q['stage'], self::STAGES, true)) { $where .= ' AND mp.stage = ?'; $args[] = $q['stage']; }
        if (!empty($q['kind']) && in_array($q['kind'], self::KINDS, true)) { $where .= ' AND mp.kind = ?'; $args[] = $q['kind']; }
        $s = $pdo->prepare("SELECT mp.*, TRIM(CONCAT(COALESCE(o.first_name,''),' ',COALESCE(o.last_name,''))) AS owner_name,
                                   TRIM(CONCAT(COALESCE(v.first_name,''),' ',COALESCE(v.last_name,''))) AS from_visitor_name,
                                   sp.name AS sponsor_name
                            FROM mentor_prospects mp
                            LEFT JOIN members o ON o.id = mp.owner_id
                            LEFT JOIN visitors v ON v.id = mp.from_visitor_id
                            LEFT JOIN sponsors sp ON sp.id = mp.sponsor_id
                            WHERE $where ORDER BY FIELD(mp.stage,'active','onboarding','contacted','interested','declined'), mp.name");
        $s->execute($args);
        return Http::json($res, array_map([self::class, 'serialize'], $s->fetchAll()));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Name is required.', 422);
        // If this parent is already in the pipeline for the same youth visitor,
        // return the existing prospect instead of creating a duplicate (the
        // "Add to mentor pipeline" button is easy to click more than once).
        $fromVisitor = self::intOrNull($d['from_visitor_id'] ?? null);
        if ($fromVisitor !== null) {
            $ex = $pdo->prepare("SELECT id FROM mentor_prospects WHERE from_visitor_id = ? ORDER BY id LIMIT 1");
            $ex->execute([$fromVisitor]);
            if ($eid = $ex->fetchColumn()) return Http::json($res, self::serialize(self::loadJoined($pdo, (int)$eid)), 200);
        }
        // NB: compute the value first, then validate — the old inline ternary
        // returned $d['stage']/$d['kind'] (undefined → null) when the field was
        // omitted, which broke the visitor "Add to Pipeline" flow (kind = NULL).
        $stage = $d['stage'] ?? 'interested';
        if (!in_array($stage, self::STAGES, true)) $stage = 'interested';
        $kind = $d['kind'] ?? 'mentor';
        if (!in_array($kind, self::KINDS, true)) $kind = 'mentor';
        $pdo->prepare("INSERT INTO mentor_prospects (name, kind, email, phone, source, stage, from_visitor_id, owner_id, notes, created_by_id)
                       VALUES (?,?,?,?,?,?,?,?,?,?)")
            ->execute([$d['name'], $kind, $d['email'] ?? null, $d['phone'] ?? null, $d['source'] ?? null, $stage,
                self::intOrNull($d['from_visitor_id'] ?? null), self::intOrNull($d['owner_id'] ?? null), $d['notes'] ?? null, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'mentor_prospects', $id, 'create', null, ['name' => $d['name']]);
        return Http::json($res, self::serialize(self::loadJoined($pdo, $id)), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['prospect_id'];
        if (!self::loadJoined($pdo, $id)) return Http::error($res, 'Prospect not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'email', 'phone', 'source', 'notes'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if (array_key_exists('stage', $d) && in_array($d['stage'], self::STAGES, true)) { $set[] = 'stage = ?'; $args[] = $d['stage']; }
        if (array_key_exists('kind', $d) && in_array($d['kind'], self::KINDS, true)) { $set[] = 'kind = ?'; $args[] = $d['kind']; }
        foreach (self::CHECKS as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = (int)!empty($d[$f]); }
        if (array_key_exists('owner_id', $d)) { $set[] = 'owner_id = ?'; $args[] = self::intOrNull($d['owner_id']); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE mentor_prospects SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'mentor_prospects', $id, 'update', null, $d);
        return Http::json($res, self::serialize(self::loadJoined($pdo, $id)));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['prospect_id'];
        $pdo->prepare("DELETE FROM mentor_prospects WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'mentor_prospects', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /mentor-prospects/{id}/to-sponsor — also track this person as a Sponsor
     * (a program-scoped supporter), keeping them in the mentor/volunteer pipeline.
     * Idempotent: if already linked, returns the existing link.
     */
    public static function toSponsor(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['prospect_id'];
        $mp = self::loadJoined($pdo, $id);
        if (!$mp) return Http::error($res, 'Prospect not found', 404);
        if (!$mp['sponsor_id']) {
            $y = EnrollmentService::currentEnrollmentYear();
            $season = "$y-" . ($y + 1);
            $pdo->prepare("INSERT INTO sponsors (name, scope, lifecycle_state, primary_contact_name, primary_contact_email,
                           primary_contact_phone, season, source, notes, created_by_id)
                           VALUES (?, 'program', 'prospective', ?, ?, ?, ?, 'event', ?, ?)")
                ->execute([$mp['name'], $mp['name'], $mp['email'], $mp['phone'], $season,
                    'From recruiting pipeline: ' . ($mp['notes'] ?? ''), (int)$cur['id']]);
            $sponsorId = (int)$pdo->lastInsertId();
            $pdo->prepare("UPDATE mentor_prospects SET sponsor_id = ?, updated_at = NOW() WHERE id = ?")->execute([$sponsorId, $id]);
            Audit::write($pdo, (int)$cur['id'], 'mentor_prospects', $id, 'to_sponsor', null, ['sponsor_id' => $sponsorId]);
        }
        return Http::json($res, self::serialize(self::loadJoined($pdo, $id)));
    }

    /** POST /mentor-prospects/{id}/convert — mark converted to a mentor member. */
    public static function convert(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $id = (int)$route['prospect_id'];
        if (!self::loadJoined($pdo, $id)) return Http::error($res, 'Prospect not found', 404);
        $memberId = self::intOrNull(((array)$req->getParsedBody())['member_id'] ?? null);
        $pdo->prepare("UPDATE mentor_prospects SET stage = 'active', converted_member_id = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$memberId, $id]);
        Audit::write($pdo, (int)$cur['id'], 'mentor_prospects', $id, 'convert', null, ['member_id' => $memberId]);
        return Http::json($res, self::serialize(self::loadJoined($pdo, $id)));
    }
}
