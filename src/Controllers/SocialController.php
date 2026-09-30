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
 * TRC social-media links (#59). Org-wide list of {platform, label, url} stored in
 * system_config; shown on the dashboard and member profiles. Any signed-in member
 * can read them; editing is gated on admin.config (the Configurable Options key).
 */
final class SocialController
{
    private const CATEGORY = 'social_media_links';

    private static function links(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $r = $s->fetch();
        $vals = ($r && $r['values']) ? json_decode($r['values'], true) : [];
        $out = [];
        foreach (($vals ?: []) as $v) {
            if (is_array($v)) $out[] = ['platform' => $v['platform'] ?? '', 'label' => $v['label'] ?? '', 'url' => $v['url'] ?? ''];
        }
        return $out;
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::links($pdo));
    }

    private static function loadCfg(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT * FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $cfg = $s->fetch();
        if (!$cfg) return [null, []];
        $vals = $cfg['values'] ? json_decode($cfg['values'], true) : [];
        $norm = [];
        foreach (($vals ?: []) as $v) if (is_array($v)) $norm[] = $v;
        return [$cfg, $norm];
    }

    private static function canEdit(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'admin.config', 'write');
    }

    private static function clean(array $d): array
    {
        return [
            'platform' => trim((string)($d['platform'] ?? '')),
            'label' => trim((string)($d['label'] ?? '')),
            'url' => trim((string)($d['url'] ?? '')),
        ];
    }

    public static function add(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canEdit($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $entry = self::clean((array)$req->getParsedBody());
        if ($entry['platform'] === '' || $entry['url'] === '') return Http::error($res, 'Platform and URL are required.', 400);
        [$cfg, $values] = self::loadCfg($pdo);
        if (!$cfg) {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, ?, ?)")
                ->execute([self::CATEGORY, 'TRC Social Media Links', json_encode([])]);
            $cfgId = (int)$pdo->lastInsertId(); $values = [];
        } else { $cfgId = (int)$cfg['id']; }
        $values[] = $entry;
        $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($values), $cfgId]);
        Audit::write($pdo, (int)$cur['id'], 'system_config', $cfgId, 'update', null, ['added_social' => "{$entry['platform']} — {$entry['url']}"]);
        return Http::json($res, self::links($pdo), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canEdit($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        [$cfg, $values] = self::loadCfg($pdo);
        if (!$cfg) return Http::error($res, 'No social links configured yet.', 404);
        $index = (int)$route['index'];
        if ($index < 0 || $index >= count($values)) return Http::error($res, 'Link not found.', 404);
        $entry = self::clean((array)$req->getParsedBody());
        if ($entry['platform'] === '' || $entry['url'] === '') return Http::error($res, 'Platform and URL are required.', 400);
        $values[$index] = $entry;
        $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($values), (int)$cfg['id']]);
        Audit::write($pdo, (int)$cur['id'], 'system_config', (int)$cfg['id'], 'update', null, ['updated_social' => "{$entry['platform']} — {$entry['url']}"]);
        return Http::json($res, self::links($pdo));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canEdit($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        [$cfg, $values] = self::loadCfg($pdo);
        if (!$cfg) return Http::error($res, 'No social links configured yet.', 404);
        $index = (int)$route['index'];
        if ($index < 0 || $index >= count($values)) return Http::error($res, 'Link not found.', 404);
        $removed = array_splice($values, $index, 1)[0];
        $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([json_encode($values), (int)$cfg['id']]);
        Audit::write($pdo, (int)$cur['id'], 'system_config', (int)$cfg['id'], 'update', ['removed_social' => ($removed['platform'] ?? '') . ' — ' . ($removed['url'] ?? '')], null);
        return Http::json($res, self::links($pdo));
    }
}
