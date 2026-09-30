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
 * Scholarships & Youth Support (2.2, phase A). Manages scholarship funds and their
 * balances (contributions in; awards will subtract in a later phase). Contribution
 * earmarking/deductibility lives on sponsor_contributions and is handled by
 * SponsorsController. Reuses sponsors.view / sponsors.manage.
 */
final class ScholarshipsController
{
    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'sponsors.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'sponsors.manage', 'write'); }

    /** Received dollars earmarked to a fund (monetary amount + in-kind value). */
    private static function fundBalance(PDO $pdo, int $fundId): array
    {
        // Phase 3 (D1): the fund's money is now a per-season General-Fund allocation, decoupled
        // from sponsor contributions. Report this season's allocation-based balance; the sponsor
        // total rides along as informational context ("sponsor_support"), not the balance.
        $year = \App\Core\EnrollmentService::currentEnrollmentYear();
        $b = ScholarshipApplicationsController::fundAvailable($pdo, $fundId, $year);
        $cnt = $pdo->prepare("SELECT COUNT(*) FROM sponsor_contributions WHERE scholarship_fund_id = ? AND status = 'received'");
        $cnt->execute([$fundId]);
        return [
            'season' => $year,
            'balance' => $b['allocated'], 'allocated' => $b['allocated'],
            'awarded' => $b['awarded'], 'available' => $b['available'],
            'sponsor_support' => $b['sponsor_support'], 'contribution_count' => (int)$cnt->fetchColumn(),
        ];
    }

    private static function serialize(PDO $pdo, array $f): array
    {
        return array_merge([
            'id' => (int)$f['id'], 'name' => $f['name'], 'description' => $f['description'],
            'is_active' => (bool)$f['is_active'],
        ], self::fundBalance($pdo, (int)$f['id']));
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM scholarship_funds ORDER BY is_active DESC, name")->fetchAll();
        return Http::json($res, array_map(fn($f) => self::serialize($pdo, $f), $rows));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Fund name is required.', 422);
        $pdo->prepare("INSERT INTO scholarship_funds (name, description, created_by_id) VALUES (?,?,?)")
            ->execute([$d['name'], $d['description'] ?? null, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'scholarship_funds', $id, 'create', null, ['name' => $d['name']]);
        $s = $pdo->prepare("SELECT * FROM scholarship_funds WHERE id = ?"); $s->execute([$id]);
        return Http::json($res, self::serialize($pdo, $s->fetch()), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['fund_id'];
        $s = $pdo->prepare("SELECT * FROM scholarship_funds WHERE id = ?"); $s->execute([$id]);
        if (!$s->fetch()) return Http::error($res, 'Fund not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('name', $d)) { $set[] = 'name = ?'; $args[] = $d['name']; }
        if (array_key_exists('description', $d)) { $set[] = 'description = ?'; $args[] = $d['description']; }
        if (array_key_exists('is_active', $d)) { $set[] = 'is_active = ?'; $args[] = (int)!empty($d['is_active']); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE scholarship_funds SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'scholarship_funds', $id, 'update', null, $d);
        $s2 = $pdo->prepare("SELECT * FROM scholarship_funds WHERE id = ?"); $s2->execute([$id]);
        return Http::json($res, self::serialize($pdo, $s2->fetch()));
    }
}
