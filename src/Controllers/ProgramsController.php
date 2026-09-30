<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/enrollment/programs_router.py */
final class ProgramsController
{
    private static function serialize(array $p): array
    {
        return [
            'id' => (int)$p['id'],
            'name' => $p['name'],
            'full_name' => $p['full_name'],
            'affiliation' => $p['affiliation'],
            'age_range' => $p['age_range'],
            'status' => $p['status'],
            'description' => $p['description'],
            'display_order' => $p['display_order'] !== null ? (int)$p['display_order'] : 0,
            'quick_attendance' => (bool)($p['quick_attendance'] ?? false),
        ];
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $rows = $pdo->query("SELECT * FROM programs ORDER BY display_order, name")->fetchAll();
        return Http::json($res, array_map([self::class, 'serialize'], $rows));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'name is required', 422);
        $chk = $pdo->prepare("SELECT 1 FROM programs WHERE name = ?"); $chk->execute([$d['name']]);
        if ($chk->fetch()) return Http::error($res, 'Program name already exists', 400);
        if (array_key_exists('quick_attendance', $d)) $d['quick_attendance'] = (int)!empty($d['quick_attendance']);
        $cols = ['name', 'full_name', 'affiliation', 'age_range', 'status', 'description', 'display_order', 'quick_attendance'];
        $f = []; $args = [];
        foreach ($cols as $c) if (array_key_exists($c, $d)) { $f[] = $c; $args[] = $d[$c]; }
        $stmt = $pdo->prepare("INSERT INTO programs (" . implode(',', $f) . ") VALUES (" . implode(',', array_fill(0, count($f), '?')) . ")");
        $stmt->execute($args);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'programs', $newId, 'create', null, $d);
        $rs = $pdo->prepare("SELECT * FROM programs WHERE id = ?"); $rs->execute([$newId]);
        return Http::json($res, self::serialize($rs->fetch()), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $id = (int)$route['program_id'];
        $cur = $pdo->prepare("SELECT 1 FROM programs WHERE id = ?"); $cur->execute([$id]);
        if (!$cur->fetch()) return Http::error($res, 'Program not found', 404);
        $d = (array)$req->getParsedBody();
        if (array_key_exists('quick_attendance', $d)) $d['quick_attendance'] = (int)!empty($d['quick_attendance']);
        $cols = ['name', 'full_name', 'affiliation', 'age_range', 'status', 'description', 'display_order', 'quick_attendance'];
        $set = []; $args = [];
        foreach ($cols as $c) if (array_key_exists($c, $d) && $d[$c] !== null) { $set[] = "$c = ?"; $args[] = $d[$c]; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE programs SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'programs', $id, 'update', null, $d);
        $stmt = $pdo->prepare("SELECT * FROM programs WHERE id = ?"); $stmt->execute([$id]);
        return Http::json($res, self::serialize($stmt->fetch()));
    }
}
