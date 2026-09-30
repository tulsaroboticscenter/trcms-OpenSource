<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Modules;
use App\Core\Permissions;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Org-wide module enable/disable (open-source Phase 2).
 * Reads/writes the effective disabled set via App\Core\Modules; stores a
 * { disabled: [...] } blob in system_config category 'enabled_modules'.
 *
 * Admin UI: GET returns the full catalog annotated with enabled state and
 * dependency info so toggles can cascade in the UI. Save is Admin-only.
 */
final class ModulesController
{
    private const CATEGORY = 'enabled_modules';

    /**
     * GET /public/modules — the effective disabled set only, NO auth required.
     * Lets the SPA hide disabled modules' PUBLIC routes (e.g. the embedded
     * volunteer sign-up form) before anyone signs in. Reveals nothing sensitive —
     * just which optional features this install has turned off.
     */
    public static function publicState(Request $req, Response $res): Response
    {
        return Http::json($res, ['disabled' => Modules::disabledSet(Database::pdo())]);
    }

    /** GET /modules — catalog + effective state (any signed-in member can read). */
    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);

        $disabled = Modules::disabledSet($pdo);
        $disSet = array_flip($disabled);
        $modules = array_map(function ($mod) use ($disSet) {
            return [
                'key'      => $mod['key'],
                'label'    => $mod['label'],
                'group'    => $mod['group'],
                'core'     => $mod['core'],
                'deps'     => $mod['deps'],
                'enabled'  => !isset($disSet[$mod['key']]),
            ];
        }, Modules::catalog());

        return Http::json($res, [
            'modules'  => $modules,
            'disabled' => $disabled,
            'can_edit' => Permissions::memberCan($pdo, $m, 'admin.config', 'write'),
        ]);
    }

    /**
     * PUT /modules — save the enabled/disabled configuration (Admin / admin.config write).
     * Body accepts either { disabled: [keys] } or { enabled: [keys] } (disabled wins if both).
     * The set is resolved server-side: core keys can't be disabled and disabling a
     * module cascades to its dependents.
     */
    public static function save(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'admin.config', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $d = (array)$req->getParsedBody();

        if (isset($d['disabled']) && is_array($d['disabled'])) {
            $requested = $d['disabled'];
        } elseif (isset($d['enabled']) && is_array($d['enabled'])) {
            // Invert: anything in the catalog not listed as enabled is disabled.
            $enabled = array_flip(array_map('strval', $d['enabled']));
            $requested = array_values(array_filter(Modules::allKeys(), fn($k) => !isset($enabled[$k])));
        } else {
            return Http::error($res, 'Provide a "disabled" or "enabled" array.', 422);
        }

        $effective = Modules::resolveDisabled($requested);
        sort($effective);
        $json = json_encode(['disabled' => $effective]);

        $old = Modules::disabledSet($pdo);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = ?");
        $ex->execute([self::CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")
                ->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, 'Enabled Modules', ?)")
                ->execute([self::CATEGORY, $json]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'update',
            ['category' => self::CATEGORY, 'disabled' => $old],
            ['category' => self::CATEGORY, 'disabled' => $effective]);

        return self::get($req, $res);
    }

    /** POST /modules/reset — enable everything (drop the override). Admin-only. */
    public static function reset(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'admin.config', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $pdo->prepare("DELETE FROM system_config WHERE category = ?")->execute([self::CATEGORY]);
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'delete', null, ['category' => self::CATEGORY]);
        return self::get($req, $res);
    }
}
