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
 * Announcements (feedback #94) — a lightweight in-app feed. Anyone with
 * announcements.view sees active (published, not-expired) items; managers
 * (announcements.manage) post and manage, and can see drafts/expired.
 */
final class AnnouncementsController
{
    private static function canView(PDO $pdo, ?array $m): bool
    { return $m !== null && Permissions::memberCan($pdo, $m, 'announcements.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool
    { return $m !== null && Permissions::memberCan($pdo, $m, 'announcements.manage', 'write'); }

    private static function serialize(array $a): array
    {
        return [
            'id' => (int)$a['id'], 'title' => $a['title'], 'body' => $a['body'],
            'pinned' => (bool)$a['pinned'],
            'published_at' => $a['published_at'], 'expires_at' => $a['expires_at'],
            'created_by_id' => $a['created_by_id'] !== null ? (int)$a['created_by_id'] : null,
            'created_by_name' => isset($a['first_name']) && $a['first_name'] !== null ? trim($a['first_name'] . ' ' . $a['last_name']) : null,
            'created_at' => $a['created_at'], 'updated_at' => $a['updated_at'],
        ];
    }

    private static function withCreator(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT a.*, m.first_name, m.last_name FROM announcements a LEFT JOIN members m ON m.id = a.created_by_id WHERE a.id = ?");
        $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    // GET /announcements — active items for everyone; managers can pass ?all=1 for drafts/expired.
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $manage = self::canManage($pdo, $m);
        $all = $manage && !empty($req->getQueryParams()['all']);
        $where = $all ? '' : "WHERE a.published_at IS NOT NULL AND a.published_at <= NOW() AND (a.expires_at IS NULL OR a.expires_at > NOW())";
        $rows = $pdo->query(
            "SELECT a.*, m.first_name, m.last_name FROM announcements a LEFT JOIN members m ON m.id = a.created_by_id
             $where ORDER BY a.pinned DESC, COALESCE(a.published_at, a.created_at) DESC"
        )->fetchAll();
        return Http::json($res, array_map([self::class, 'serialize'], $rows));
    }

    // POST /announcements
    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? ''));
        if ($title === '') return Http::error($res, 'A title is required.', 422);
        // Publish immediately by default unless explicitly saved as a draft.
        $publishedAt = array_key_exists('published_at', $d)
            ? (($d['published_at'] ?? '') ?: null)
            : date('Y-m-d H:i:s');
        $ins = $pdo->prepare("INSERT INTO announcements (title, body, pinned, published_at, expires_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?)");
        $ins->execute([$title, ($d['body'] ?? '') ?: null, !empty($d['pinned']) ? 1 : 0, $publishedAt, ($d['expires_at'] ?? '') ?: null, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'announcements', $id, 'create', null, ['title' => $title]);
        return Http::json($res, self::serialize(self::withCreator($pdo, $id)), 201);
    }

    // PATCH /announcements/{id}
    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['announcement_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('title', $d)) { $set[] = 'title = ?'; $args[] = trim((string)$d['title']); }
        if (array_key_exists('body', $d)) { $set[] = 'body = ?'; $args[] = ($d['body'] ?? '') ?: null; }
        if (array_key_exists('pinned', $d)) { $set[] = 'pinned = ?'; $args[] = !empty($d['pinned']) ? 1 : 0; }
        if (array_key_exists('published_at', $d)) { $set[] = 'published_at = ?'; $args[] = ($d['published_at'] ?? '') ?: null; }
        if (array_key_exists('expires_at', $d)) { $set[] = 'expires_at = ?'; $args[] = ($d['expires_at'] ?? '') ?: null; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE announcements SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        $a = self::withCreator($pdo, $id);
        if (!$a) return Http::error($res, 'Not found', 404);
        Audit::write($pdo, (int)$cur['id'], 'announcements', $id, 'update', null, $d);
        return Http::json($res, self::serialize($a));
    }

    // DELETE /announcements/{id}
    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['announcement_id'];
        $pdo->prepare("DELETE FROM announcements WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'announcements', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }
}
