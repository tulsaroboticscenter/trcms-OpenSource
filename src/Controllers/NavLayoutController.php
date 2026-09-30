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
 * Sidebar organisation — which section each nav item lives in, the section order, and
 * which sections start collapsed. Admin-editable so the layout can change without a code
 * release.
 *
 * Stored as JSON in system_config category 'nav_layout'. Items are identified by their
 * route (the `to` of a nav item), so this is stable across releases. Any nav item NOT
 * mentioned in the stored config falls into the "More" section at render time, so adding
 * a new module never makes it disappear — it just shows up under More until an admin
 * files it.
 */
final class NavLayoutController
{
    private const CATEGORY = 'nav_layout';

    /**
     * The out-of-the-box grouping. `collapsed` is the default open/closed state (a
     * per-user override is remembered in the browser). Routes match nav-item `to` values.
     */
    private const DEFAULT_SECTIONS = [
        ['id' => 'my_trc',    'label' => 'My TRC',              'collapsed' => false,
            'items' => ['/my-time', '/resume', '/my-equipment', '/volunteering']],
        ['id' => 'people',    'label' => 'People',              'collapsed' => false,
            'items' => ['/members', '/visitors', '/certifications']],
        ['id' => 'teams',     'label' => 'Teams & Program',     'collapsed' => false,
            'items' => ['/teams', '/fdp', '/team-tasks', '/goals', '/roles/ylc']],
        ['id' => 'events',    'label' => 'Events',              'collapsed' => true,
            'items' => ['/events', '/checkin', '/reservations', '/camp']],
        ['id' => 'money',     'label' => 'Money & Fundraising', 'collapsed' => true,
            'items' => ['/finance', '/grants', '/sponsors', '/scholarships', '/shopping', '/wishlist']],
        ['id' => 'inventory', 'label' => 'Inventory & Assets',  'collapsed' => true,
            'items' => ['/inventory', '/repairs', '/resources']],
        ['id' => 'admin',     'label' => 'Admin',               'collapsed' => true,
            'items' => ['/reports', '/communications', '/announcements', '/roles/compliance',
                        '/hall-of-fame', '/minutes?group=TRCF%20Board', '/admin']],
    ];

    private static function raw(PDO $pdo): ?array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode((string)$r['values'], true) : null;
        return (is_array($v) && !empty($v['sections'])) ? $v : null;
    }

    /** The effective layout: the stored one, or the built-in default. */
    public static function layout(PDO $pdo): array
    {
        $stored = self::raw($pdo);
        return $stored ?: ['sections' => self::DEFAULT_SECTIONS];
    }

    /** GET /nav-layout — the current sidebar organisation (any signed-in member). */
    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::layout($pdo) + [
            'can_edit' => Permissions::memberCan($pdo, $m, 'admin.config', 'write'),   // Admin / SysAdmin
            'is_default' => self::raw($pdo) === null,
        ]);
    }

    /**
     * PUT /nav-layout — save the sidebar organisation (Admin / System Administrator).
     * Body: { sections: [{ id, label, collapsed, items: [route,...] }, ...] }.
     */
    public static function save(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $sectionsIn = $d['sections'] ?? null;
        if (!is_array($sectionsIn) || !$sectionsIn) return Http::error($res, 'A sections list is required.', 422);

        $seenId = []; $clean = [];
        foreach ($sectionsIn as $i => $s) {
            if (!is_array($s)) continue;
            $label = trim((string)($s['label'] ?? ''));
            if ($label === '') return Http::error($res, 'Every section needs a name.', 422);
            // Stable id: keep a given one (deduped), else derive from the label.
            $id = preg_replace('/[^a-z0-9_]+/', '_', strtolower((string)($s['id'] ?? $label)));
            $id = trim($id, '_') ?: ('section_' . $i);
            while (isset($seenId[$id])) $id .= '_' . $i;
            $seenId[$id] = true;
            $items = [];
            foreach ((array)($s['items'] ?? []) as $it) {
                $it = trim((string)$it);
                if ($it !== '' && !in_array($it, $items, true)) $items[] = $it;
            }
            $clean[] = ['id' => $id, 'label' => mb_substr($label, 0, 40),
                        'collapsed' => (bool)($s['collapsed'] ?? false), 'items' => $items];
        }
        if (!$clean) return Http::error($res, 'A sections list is required.', 422);

        $json = json_encode(['sections' => $clean]);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = ?"); $ex->execute([self::CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, 'Sidebar Layout', ?)")->execute([self::CATEGORY, $json]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'update', null, ['category' => self::CATEGORY, 'sections' => count($clean)]);
        return self::get($req, $res);
    }

    /** POST /nav-layout/reset — drop the override and return to the built-in default. */
    public static function reset(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM system_config WHERE category = ?")->execute([self::CATEGORY]);
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'delete', null, ['category' => self::CATEGORY]);
        return self::get($req, $res);
    }
}
