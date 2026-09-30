<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Incident routing settings (§8) — the incident_routing system_config category, stored as a single
 * object wrapped in an array. Gated on incidents.settings.
 */
final class IncidentSettingsController
{
    private const CATEGORY = 'incident_routing';

    private static function defaults(): array
    {
        return [
            'default_to' => ['incidentreport@tulsaroboticscenter.org'],
            'reply_to' => '',
            'digest_enabled' => true,
            'rules' => [[
                'id' => 1, 'label' => 'All reports to the inbox', 'types' => ['*'], 'min_severity' => 'minor',
                'to' => ['incidentreport@tulsaroboticscenter.org'], 'cc' => [], 'notify_roles' => [], 'board_notify' => false,
            ]],
        ];
    }

    private static function read(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $raw = $s->fetchColumn();
        $arr = $raw ? json_decode((string)$raw, true) : null;
        $obj = (is_array($arr) && isset($arr[0]) && is_array($arr[0])) ? $arr[0] : null;
        return is_array($obj) ? $obj : self::defaults();
    }

    private static function write(PDO $pdo, array $obj): void
    {
        $valsJson = json_encode([$obj]);   // single object wrapped in an array
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = ?"); $ex->execute([self::CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$valsJson, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, 'Incident Routing', ?)")->execute([self::CATEGORY, $valsJson]);
        }
    }

    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'incidents.settings', 'read')) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::read($pdo));
    }

    public static function save(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'incidents.settings', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $obj = [
            'default_to' => array_values(array_filter(array_map('trim', (array)($d['default_to'] ?? [])))),
            'reply_to' => trim((string)($d['reply_to'] ?? '')),
            'digest_enabled' => !empty($d['digest_enabled']),
            'rules' => [],
        ];
        $i = 0;
        foreach ((array)($d['rules'] ?? []) as $rule) {
            if (!is_array($rule)) continue;
            $obj['rules'][] = [
                'id' => !empty($rule['id']) ? (int)$rule['id'] : (++$i),
                'label' => trim((string)($rule['label'] ?? 'Rule')),
                'types' => array_values(array_filter(array_map('strval', (array)($rule['types'] ?? ['*'])))) ?: ['*'],
                'min_severity' => in_array(($rule['min_severity'] ?? ''), ['minor', 'moderate', 'serious', 'critical'], true) ? $rule['min_severity'] : 'minor',
                'to' => array_values(array_filter(array_map('trim', (array)($rule['to'] ?? [])))),
                'cc' => array_values(array_filter(array_map('trim', (array)($rule['cc'] ?? [])))),
                'notify_roles' => array_values(array_filter(array_map('strval', (array)($rule['notify_roles'] ?? [])))),
                'board_notify' => !empty($rule['board_notify']),
            ];
        }
        self::write($pdo, $obj);
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'incident_routing.save', null, ['rules' => count($obj['rules'])]);
        return Http::json($res, self::read($pdo));
    }

    public static function test(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'incidents.settings', 'write')) return Http::error($res, 'Access denied', 403);
        $to = trim((string)(($req->getParsedBody()['to'] ?? '')));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'Enter a valid test address.', 422);
        $ok = Mailer::send($to, 'TRCMS incident routing — test message',
            Mailer::wrap('Incident Routing Test', '<p>This is a test of the incident report routing configuration. If you received it, delivery to this address works.</p>'));
        return Http::json($res, ['ok' => $ok, 'error' => $ok ? null : Mailer::lastError()]);
    }
}
