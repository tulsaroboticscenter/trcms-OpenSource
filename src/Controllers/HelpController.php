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
 * Help Center (Release 3.3). DB-backed, admin-editable help articles that power
 * the in-app searchable ? panel and the generated user manual. Everyone can read
 * published articles their role is allowed to see; authoring needs admin.config.
 */
final class HelpController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'admin.config', 'write');
    }

    /** Roles the article is limited to (empty = everyone). */
    private static function articleRoles(?string $roles): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string)$roles))));
    }

    /** Can this member see the article, given its role restriction? */
    private static function visibleTo(PDO $pdo, array $m, array $row): bool
    {
        $need = self::articleRoles($row['roles'] ?? null);
        if (!$need) return true;
        if (Permissions::hasAnyRole($pdo, $m, ['Admin', 'System Administrator'])) return true;
        $have = Permissions::effectiveRolesFor($pdo, $m);
        return (bool)array_intersect($need, $have);
    }

    private static function summarize(array $r, bool $withBody = false): array
    {
        $out = [
            'id' => (int)$r['id'], 'slug' => $r['slug'], 'title' => $r['title'],
            'category' => $r['category'], 'summary' => $r['summary'], 'tags' => $r['tags'],
            'help_key' => $r['help_key'], 'roles' => $r['roles'],
            'is_published' => (bool)$r['is_published'], 'sort_order' => (int)$r['sort_order'],
            'updated_at' => $r['updated_at'],
        ];
        if ($withBody) $out['body'] = $r['body'];
        return $out;
    }

    // ── Reader (any signed-in member) ────────────────────────────────────────
    // GET /help/articles?search=&category=&help_key=
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $where = ['is_published = 1']; $args = [];
        if (!empty($q['category'])) { $where[] = 'category = ?'; $args[] = $q['category']; }
        if (!empty($q['help_key'])) { $where[] = 'help_key = ?'; $args[] = $q['help_key']; }
        if (!empty($q['search'])) {
            $where[] = '(title LIKE ? OR summary LIKE ? OR tags LIKE ? OR body LIKE ?)';
            $s = '%' . $q['search'] . '%'; array_push($args, $s, $s, $s, $s);
        }
        $sql = "SELECT * FROM help_articles WHERE " . implode(' AND ', $where) . " ORDER BY category, sort_order, title";
        $st = $pdo->prepare($sql); $st->execute($args);
        $out = [];
        foreach ($st->fetchAll() as $r) { if (self::visibleTo($pdo, $m, $r)) $out[] = self::summarize($r); }
        return Http::json($res, $out);
    }

    // GET /help/articles/{slug}
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $st = $pdo->prepare("SELECT * FROM help_articles WHERE slug = ?"); $st->execute([(string)$route['slug']]);
        $r = $st->fetch();
        if (!$r || (!$r['is_published'] && !self::canManage($pdo, $m))) return Http::error($res, 'Article not found', 404);
        if (!self::visibleTo($pdo, $m, $r) && !self::canManage($pdo, $m)) return Http::error($res, 'Article not found', 404);
        return Http::json($res, self::summarize($r, true));
    }

    // ── Author (admin.config) ────────────────────────────────────────────────
    public static function adminList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM help_articles ORDER BY category, sort_order, title")->fetchAll();
        return Http::json($res, array_map(fn($r) => self::summarize($r), $rows));
    }

    public static function adminGet(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $st = $pdo->prepare("SELECT * FROM help_articles WHERE id = ?"); $st->execute([(int)$route['id']]);
        $r = $st->fetch();
        if (!$r) return Http::error($res, 'Article not found', 404);
        return Http::json($res, self::summarize($r, true));
    }

    private static function slugify(string $s): string
    {
        $s = strtolower(trim($s));
        $s = preg_replace('/[^a-z0-9]+/', '-', $s);
        return trim((string)$s, '-') ?: 'article';
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? ''));
        if ($title === '') return Http::error($res, 'A title is required.', 422);
        $slug = self::slugify($d['slug'] ?? $title);
        // Ensure unique slug.
        $ex = $pdo->prepare("SELECT COUNT(*) FROM help_articles WHERE slug = ?");
        $base = $slug; $i = 2;
        while (true) { $ex->execute([$slug]); if (!$ex->fetchColumn()) break; $slug = $base . '-' . $i++; }
        $pdo->prepare(
            "INSERT INTO help_articles (slug, title, category, summary, body, tags, roles, help_key, sort_order, is_published, created_by_id, updated_by_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())"
        )->execute([
            $slug, $title, trim((string)($d['category'] ?? 'General')) ?: 'General',
            ($d['summary'] ?? null) ?: null, ($d['body'] ?? null) ?: null, ($d['tags'] ?? null) ?: null,
            ($d['roles'] ?? null) ?: null, ($d['help_key'] ?? null) ?: null, (int)($d['sort_order'] ?? 0),
            isset($d['is_published']) ? (int)(bool)$d['is_published'] : 1, (int)$m['id'], (int)$m['id'],
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'help_articles', $id, 'create', null, ['title' => $title]);
        return self::adminGet($req, $res, ['id' => $id]);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $cur = $pdo->prepare("SELECT * FROM help_articles WHERE id = ?"); $cur->execute([$id]);
        if (!$cur->fetch()) return Http::error($res, 'Article not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['title', 'category', 'summary', 'body', 'tags', 'roles', 'help_key'] as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($d[$f] === '' ? null : $d[$f]); }
        }
        if (array_key_exists('sort_order', $d)) { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if (array_key_exists('is_published', $d)) { $set[] = 'is_published = ?'; $args[] = (int)(bool)$d['is_published']; }
        if (array_key_exists('slug', $d) && trim((string)$d['slug']) !== '') { $set[] = 'slug = ?'; $args[] = self::slugify($d['slug']); }
        if ($set) {
            $set[] = 'updated_by_id = ?'; $args[] = (int)$m['id'];
            $set[] = 'updated_at = NOW()';
            $args[] = $id;
            $pdo->prepare("UPDATE help_articles SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
            Audit::write($pdo, (int)$m['id'], 'help_articles', $id, 'update', null, ['fields' => array_keys($d)]);
        }
        return self::adminGet($req, $res, ['id' => $id]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $pdo->prepare("DELETE FROM help_articles WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'help_articles', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }
}
