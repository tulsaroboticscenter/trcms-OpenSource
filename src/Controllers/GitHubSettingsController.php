<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\GitHub;
use App\Core\Http;
use App\Core\Permissions;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use PDO;

/**
 * Admin settings for the GitHub integration (push feedback to Issues/Projects).
 * Stored in system_config category 'github'. The token is write-only — it is
 * never returned to the browser, only a "has_token" flag.
 */
final class GitHubSettingsController
{
    /** Non-secret fields shown in the UI. */
    private const FIELDS = ['owner', 'repo', 'project_number'];

    private static function dbValues(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'github'");
        $s->execute();
        $r = $s->fetch();
        $v = $r ? json_decode((string) $r['values'], true) : [];
        return is_array($v) ? $v : [];
    }

    /** GET /admin/github-settings */
    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'read')) return Http::error($res, 'Access denied', 403);
        $db = self::dbValues($pdo);
        $out = [];
        foreach (self::FIELDS as $k) $out[$k] = (string) ($db[$k] ?? '');
        $out['has_token'] = isset($db['token']) && (string) $db['token'] !== '';
        $out['configured'] = $out['has_token'] && $out['owner'] !== '' && $out['repo'] !== '';
        return Http::json($res, $out);
    }

    /** PUT /admin/github-settings */
    public static function update(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array) $req->getParsedBody();
        $existing = self::dbValues($pdo);

        $vals = [];
        foreach (self::FIELDS as $k) {
            if (array_key_exists($k, $d)) $vals[$k] = trim((string) $d[$k]);
            elseif (isset($existing[$k])) $vals[$k] = $existing[$k];
        }
        // Token is write-only: set on a non-empty value, cleared on clear_token, else kept.
        if (!empty($d['clear_token'])) $vals['token'] = '';
        elseif (array_key_exists('token', $d) && trim((string) $d['token']) !== '') $vals['token'] = trim((string) $d['token']);
        elseif (isset($existing['token'])) $vals['token'] = $existing['token'];

        $json = json_encode($vals);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'github'");
        $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int) $row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('github', 'GitHub Integration', ?)")->execute([$json]);
        }
        $audit = $vals; unset($audit['token']); $audit['has_token'] = ($vals['token'] ?? '') !== '';
        Audit::write($pdo, (int) $cur['id'], 'system_config', null, 'update', null, ['category' => 'github'] + $audit);
        return self::get($req, $res);
    }

    /** POST /admin/github-settings/test — verify the token reaches the repo/project. */
    public static function test(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);
        try {
            return Http::json($res, GitHub::test($pdo));
        } catch (\Throwable $e) {
            return Http::json($res, ['ok' => false, 'message' => $e->getMessage()]);
        }
    }
}
