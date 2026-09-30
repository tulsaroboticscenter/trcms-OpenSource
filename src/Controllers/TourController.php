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
 * Guided Tours (Release 3.3). DB-backed, admin-editable step-by-step tours that
 * a spotlight/tooltip overlay walks the user through. Any signed-in member can
 * run published tours their role allows; authoring needs admin.config.
 * Sister to HelpController — help is reference, tours are "show me".
 */
final class TourController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'admin.config', 'write');
    }

    private static function roleList(?string $roles): array
    {
        return array_values(array_filter(array_map('trim', explode(',', (string)$roles))));
    }

    private static function visibleTo(PDO $pdo, array $m, array $row): bool
    {
        // Outside volunteers get NO guided tours. A tour navigates the app between routes
        // (each step can carry a `route`), which would walk a volunteer straight into parts
        // of the system outside their deliberately restricted interface. Hard exclusion,
        // regardless of the tour's own role allowlist.
        if (($m['member_type'] ?? '') === 'volunteer') return false;
        $need = self::roleList($row['roles'] ?? null);
        if (!$need) return true;
        if (Permissions::hasAnyRole($pdo, $m, ['Admin', 'System Administrator'])) return true;
        return (bool)array_intersect($need, Permissions::effectiveRolesFor($pdo, $m));
    }

    private static function summarize(array $r, bool $withSteps = false): array
    {
        $out = [
            'id' => (int)$r['id'], 'tour_key' => $r['tour_key'], 'title' => $r['title'],
            'description' => $r['description'], 'roles' => $r['roles'], 'auto_key' => $r['auto_key'],
            'sort_order' => (int)$r['sort_order'], 'is_published' => (bool)$r['is_published'],
            'updated_at' => $r['updated_at'],
        ];
        if ($withSteps) {
            $steps = json_decode((string)$r['steps'], true);
            $out['steps'] = is_array($steps) ? $steps : [];
        } else {
            $steps = json_decode((string)$r['steps'], true);
            $out['step_count'] = is_array($steps) ? count($steps) : 0;
        }
        return $out;
    }

    // ── Reader (any signed-in member) ────────────────────────────────────────

    /** GET /tours — published tours the member may run (summaries). */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $rows = $pdo->query("SELECT * FROM guided_tours WHERE is_published = 1 ORDER BY sort_order, title")->fetchAll();
        $out = [];
        foreach ($rows as $r) if (self::visibleTo($pdo, $m, $r)) $out[] = self::summarize($r);
        return Http::json($res, $out);
    }

    /** GET /tours/{tour_key} — full tour with steps. */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $st = $pdo->prepare("SELECT * FROM guided_tours WHERE tour_key = ?");
        $st->execute([$route['tour_key']]);
        $r = $st->fetch();
        if (!$r || (!$r['is_published'] && !self::canManage($pdo, $m))) return Http::error($res, 'Tour not found', 404);
        if (!self::visibleTo($pdo, $m, $r) && !self::canManage($pdo, $m)) return Http::error($res, 'Tour not found', 404);
        return Http::json($res, self::summarize($r, true));
    }

    // ── Admin authoring (admin.config) ───────────────────────────────────────

    public static function adminList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM guided_tours ORDER BY sort_order, title")->fetchAll();
        return Http::json($res, array_map(fn($r) => self::summarize($r, true), $rows));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $key = self::slugify($d['tour_key'] ?? $d['title'] ?? '');
        $title = trim((string)($d['title'] ?? ''));
        if ($key === '' || $title === '') return Http::error($res, 'A key and title are required.', 422);
        $ex = $pdo->prepare("SELECT id FROM guided_tours WHERE tour_key = ?"); $ex->execute([$key]);
        if ($ex->fetchColumn()) return Http::error($res, 'A tour with that key already exists.', 409);
        $pdo->prepare(
            "INSERT INTO guided_tours (tour_key, title, description, steps, roles, auto_key, sort_order, is_published, created_by_id, updated_by_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())"
        )->execute([
            $key, $title, $d['description'] ?? null, self::stepsJson($d['steps'] ?? []),
            self::rolesCsv($d['roles'] ?? null), ($d['auto_key'] ?? '') === '' ? null : $d['auto_key'],
            (int)($d['sort_order'] ?? 0), isset($d['is_published']) ? (int)(bool)$d['is_published'] : 1,
            (int)$m['id'], (int)$m['id'],
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'guided_tours', $id, 'create', null, ['tour_key' => $key]);
        $r = $pdo->query("SELECT * FROM guided_tours WHERE id = $id")->fetch();
        return Http::json($res, self::summarize($r, true), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['tour_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['title', 'description'] as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        }
        if (array_key_exists('steps', $d))       { $set[] = 'steps = ?'; $args[] = self::stepsJson($d['steps']); }
        if (array_key_exists('roles', $d))        { $set[] = 'roles = ?'; $args[] = self::rolesCsv($d['roles']); }
        if (array_key_exists('auto_key', $d))     { $set[] = 'auto_key = ?'; $args[] = ($d['auto_key'] ?? '') === '' ? null : $d['auto_key']; }
        if (array_key_exists('sort_order', $d))   { $set[] = 'sort_order = ?'; $args[] = (int)$d['sort_order']; }
        if (array_key_exists('is_published', $d)) { $set[] = 'is_published = ?'; $args[] = (int)(bool)$d['is_published']; }
        if (!$set) return Http::error($res, 'Nothing to update.', 422);
        $set[] = 'updated_by_id = ?'; $args[] = (int)$m['id'];
        $set[] = 'updated_at = NOW()';
        $args[] = $id;
        $pdo->prepare("UPDATE guided_tours SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$m['id'], 'guided_tours', $id, 'update', null, null);
        $r = $pdo->query("SELECT * FROM guided_tours WHERE id = $id")->fetch();
        if (!$r) return Http::error($res, 'Tour not found', 404);
        return Http::json($res, self::summarize($r, true));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['tour_id'];
        $pdo->prepare("DELETE FROM guided_tours WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'guided_tours', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static function slugify(string $s): string
    {
        $s = strtolower(trim($s));
        $s = preg_replace('/[^a-z0-9]+/', '-', $s) ?? '';
        return trim($s, '-');
    }

    private static function rolesCsv($roles): ?string
    {
        if (is_array($roles)) $roles = implode(',', $roles);
        $roles = trim((string)$roles);
        return $roles === '' ? null : $roles;
    }

    /** Accept steps as an array (from JSON body) or a JSON string; store normalized JSON. */
    private static function stepsJson($steps): string
    {
        if (is_string($steps)) {
            $decoded = json_decode($steps, true);
            $steps = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($steps)) $steps = [];
        return json_encode(array_values($steps), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
