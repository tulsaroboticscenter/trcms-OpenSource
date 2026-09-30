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

/** Port of app/modules/families/router.py */
final class FamiliesController
{
    private static function serializeMember(array $fm): array
    {
        return [
            'family_member_id' => (int)$fm['fm_id'],
            'member_id' => (int)$fm['member_id'],
            'member_number' => $fm['member_number'],
            'first_name' => $fm['first_name'],
            'last_name' => $fm['last_name'],
            'member_type' => $fm['member_type'],
            'photo_url' => $fm['photo_url'],
            'email' => $fm['email'],
            'phone' => $fm['phone'],
            'relationship_label' => $fm['relationship_label'],
            'is_primary_contact' => (bool)$fm['is_primary_contact'],
            'is_active' => (bool)$fm['is_active'],
        ];
    }

    private static function familyMembers(PDO $pdo, int $familyId): array
    {
        $stmt = $pdo->prepare(
            "SELECT fm.id AS fm_id, fm.relationship_label, fm.is_primary_contact,
                    m.id AS member_id, m.member_number, m.first_name, m.last_name,
                    m.member_type, m.photo_url, m.email, m.phone, m.is_active
             FROM family_members fm JOIN members m ON m.id = fm.member_id
             WHERE fm.family_id = ? ORDER BY fm.id"
        );
        $stmt->execute([$familyId]);
        return array_map([self::class, 'serializeMember'], $stmt->fetchAll());
    }

    private static function serializeFamily(PDO $pdo, array $f): array
    {
        return [
            'id' => (int)$f['id'],
            'family_name' => $f['family_name'],
            'created_at' => $f['created_at'],
            'members' => self::familyMembers($pdo, (int)$f['id']),
        ];
    }

    private static function loadFamily(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare("SELECT * FROM families WHERE id = ?"); $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    private static function memberFamilyId(PDO $pdo, int $memberId): ?int
    {
        $stmt = $pdo->prepare("SELECT family_id FROM family_members WHERE member_id = ?"); $stmt->execute([$memberId]);
        $r = $stmt->fetch();
        return $r ? (int)$r['family_id'] : null;
    }

    public static function getMemberFamily(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $memberId = (int)$route['member_id'];
        $isOwn = $m['id'] == $memberId;
        $myFamilyId = self::memberFamilyId($pdo, (int)$m['id']);
        $targetFamilyId = self::memberFamilyId($pdo, $memberId);
        $sameFamily = $myFamilyId !== null && $myFamilyId === $targetFamilyId;
        if (!$isOwn && !$sameFamily && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) {
            return Http::error($res, 'Access denied', 403);
        }
        if ($targetFamilyId === null) return Http::json($res, null);
        return Http::json($res, self::serializeFamily($pdo, self::loadFamily($pdo, $targetFamilyId)));
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $m, 'families.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM families ORDER BY family_name")->fetchAll();
        return Http::json($res, array_map(fn($f) => self::serializeFamily($pdo, $f), $rows));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needAdmin($pdo, $req)) return $e($res);
        $cur = Auth::currentMember($pdo, $req);
        $d = (array)$req->getParsedBody();
        $memberIds = array_map('intval', $d['member_ids'] ?? []);
        foreach ($memberIds as $mid) {
            $mx = $pdo->prepare("SELECT 1 FROM members WHERE id = ?"); $mx->execute([$mid]);
            if (!$mx->fetch()) return Http::error($res, "Member $mid not found", 404);
            if (self::memberFamilyId($pdo, $mid) !== null) return Http::error($res, "Member $mid already belongs to a family. Remove them first.", 400);
        }
        $ins = $pdo->prepare("INSERT INTO families (family_name) VALUES (?)");
        $ins->execute([$d['family_name'] ?? null]);
        $fid = (int)$pdo->lastInsertId();
        Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'families', $fid, 'create', null, $d);
        foreach ($memberIds as $mid) {
            $pdo->prepare("INSERT INTO family_members (family_id, member_id) VALUES (?, ?)")->execute([$fid, $mid]);
            $fmid = (int)$pdo->lastInsertId();
            Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'family_members', $fmid, 'create', null, ['family_id' => $fid, 'member_id' => $mid]);
        }
        return Http::json($res, self::serializeFamily($pdo, self::loadFamily($pdo, $fid)), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needAdmin($pdo, $req)) return $e($res);
        $cur = Auth::currentMember($pdo, $req);
        $fid = (int)$route['family_id'];
        $f = self::loadFamily($pdo, $fid);
        if (!$f) return Http::error($res, 'Family not found', 404);
        $d = (array)$req->getParsedBody();
        if (array_key_exists('family_name', $d) && $d['family_name'] !== null) {
            $pdo->prepare("UPDATE families SET family_name = ? WHERE id = ?")->execute([$d['family_name'], $fid]);
            Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'families', $fid, 'update', null, $d);
        }
        return Http::json($res, self::serializeFamily($pdo, self::loadFamily($pdo, $fid)));
    }

    public static function addMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needAdmin($pdo, $req)) return $e($res);
        $cur = Auth::currentMember($pdo, $req);
        $fid = (int)$route['family_id'];
        if (!self::loadFamily($pdo, $fid)) return Http::error($res, 'Family not found', 404);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0);
        $mx = $pdo->prepare("SELECT 1 FROM members WHERE id = ?"); $mx->execute([$mid]);
        if (!$mx->fetch()) return Http::error($res, 'Member not found', 404);
        $existing = self::memberFamilyId($pdo, $mid);
        if ($existing !== null) {
            return Http::error($res, $existing === $fid ? 'Member is already in this family' : 'Member already belongs to another family. Remove them from it first.', 400);
        }
        $pdo->prepare("INSERT INTO family_members (family_id, member_id, relationship_label, is_primary_contact) VALUES (?, ?, ?, ?)")
            ->execute([$fid, $mid, $d['relationship_label'] ?? null, (int)!empty($d['is_primary_contact'])]);
        $fmid = (int)$pdo->lastInsertId();
        Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'family_members', $fmid, 'create', null, $d);
        return Http::json($res, self::serializeFamily($pdo, self::loadFamily($pdo, $fid)), 201);
    }

    public static function updateMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needAdmin($pdo, $req)) return $e($res);
        $cur = Auth::currentMember($pdo, $req);
        $fid = (int)$route['family_id']; $mid = (int)$route['member_id'];
        $fx = $pdo->prepare("SELECT id FROM family_members WHERE family_id = ? AND member_id = ?"); $fx->execute([$fid, $mid]);
        $fmRow = $fx->fetch();
        if (!$fmRow) return Http::error($res, 'Family member record not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('relationship_label', $d) && $d['relationship_label'] !== null) { $set[] = "relationship_label = ?"; $args[] = $d['relationship_label']; }
        if (array_key_exists('is_primary_contact', $d) && $d['is_primary_contact'] !== null) { $set[] = "is_primary_contact = ?"; $args[] = (int)(bool)$d['is_primary_contact']; }
        if ($set) { array_push($args, $fid, $mid); $pdo->prepare("UPDATE family_members SET " . implode(',', $set) . " WHERE family_id = ? AND member_id = ?")->execute($args);
            Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'family_members', (int)$fmRow['id'], 'update', null, $d); }
        return Http::json($res, self::serializeFamily($pdo, self::loadFamily($pdo, $fid)));
    }

    public static function removeMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needAdmin($pdo, $req)) return $e($res);
        $cur = Auth::currentMember($pdo, $req);
        $fid = (int)$route['family_id']; $mid = (int)$route['member_id'];
        $fx = $pdo->prepare("SELECT id FROM family_members WHERE family_id = ? AND member_id = ?"); $fx->execute([$fid, $mid]);
        $fmRow = $fx->fetch();
        if (!$fmRow) return Http::error($res, 'Family member record not found', 404);
        $pdo->prepare("DELETE FROM family_members WHERE family_id = ? AND member_id = ?")->execute([$fid, $mid]);
        Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'family_members', (int)$fmRow['id'], 'delete', null, null);
        $cnt = $pdo->prepare("SELECT count(*) AS c FROM family_members WHERE family_id = ?"); $cnt->execute([$fid]);
        if ((int)$cnt->fetch()['c'] === 0) {
            $pdo->prepare("DELETE FROM families WHERE id = ?")->execute([$fid]);
            Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'families', $fid, 'delete', null, null);
        }
        return Http::json($res, ['ok' => true]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needAdmin($pdo, $req)) return $e($res);
        $cur = Auth::currentMember($pdo, $req);
        $fid = (int)$route['family_id'];
        if (!self::loadFamily($pdo, $fid)) return Http::error($res, 'Family not found', 404);
        $pdo->prepare("DELETE FROM family_members WHERE family_id = ?")->execute([$fid]);
        Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'family_members', null, 'delete', null, ['family_id' => $fid]);
        $pdo->prepare("DELETE FROM families WHERE id = ?")->execute([$fid]);
        Audit::write($pdo, $cur ? (int)$cur['id'] : null, 'families', $fid, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    private static function needAdmin(PDO $pdo, Request $req): ?callable
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return fn(Response $r) => Http::error($r, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return fn(Response $r) => Http::error($r, 'You do not have permission to perform this action', 403);
        return null;
    }
}
