<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\PaymentSettings;
use App\Core\Payments\PayPalProvider;
use App\Core\Payments\SquareProvider;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Admin → Payment Settings. Enable/disable online providers, set their fee % and
 * fixed fee (for the "cover the processing fee" math), and manage the list of
 * manual (admin-recorded) payment methods. Credentials remain in .env.
 */
final class PaymentSettingsController
{
    private static function providers(): array
    {
        return ['square' => new SquareProvider(), 'paypal' => new PayPalProvider()];
    }

    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'admin.config', 'write');
    }

    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);

        $providers = [];
        foreach (self::providers() as $key => $p) {
            $ov = PaymentSettings::providerFeeOverride($pdo, $key);
            $providers[] = [
                'key' => $key, 'label' => $p->label(),
                'enabled' => PaymentSettings::providerEnabled($pdo, $key),
                'configured' => $p->isConfigured(),
                'fee_percent' => $ov['fee_percent'] !== null ? $ov['fee_percent'] : $p->feePercent(),
                'fee_fixed' => $ov['fee_fixed'] !== null ? $ov['fee_fixed'] : $p->feeFixed(),
            ];
        }
        return Http::json($res, [
            'providers' => $providers,
            'manual_methods' => PaymentSettings::manualMethods($pdo, false),
        ]);
    }

    public static function update(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();

        $out = ['providers' => [], 'manual_methods' => []];
        foreach (array_keys(self::providers()) as $key) {
            $p = (array)($d['providers'][$key] ?? []);
            $pct = isset($p['fee_percent']) ? max(0, min(100, (float)$p['fee_percent'])) : null;
            $fixed = isset($p['fee_fixed']) ? max(0, (float)$p['fee_fixed']) : null;
            $out['providers'][$key] = [
                'enabled' => filter_var($p['enabled'] ?? PaymentSettings::defaultEnabled($key), FILTER_VALIDATE_BOOLEAN),
                'fee_percent' => $pct, 'fee_fixed' => $fixed,
            ];
        }
        $seen = [];
        foreach ((array)($d['manual_methods'] ?? PaymentSettings::defaultManual()) as $m) {
            $m = (array)$m;
            $key = preg_replace('/[^a-z0-9_]/', '', strtolower(trim((string)($m['key'] ?? ''))));
            $label = trim((string)($m['label'] ?? ''));
            if ($key === '' || $label === '' || isset($seen[$key])) continue;
            $seen[$key] = true;
            $out['manual_methods'][] = ['key' => $key, 'label' => $label, 'enabled' => filter_var($m['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN)];
        }
        PaymentSettings::save($pdo, $out);
        Audit::write($pdo, (int)$cur['id'], 'system_config', null, 'update', null, ['category' => 'payments']);
        return self::get($req, $res);
    }
}
