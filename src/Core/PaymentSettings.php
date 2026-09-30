<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Admin-managed payment settings, persisted in system_config (category 'payments').
 * Credentials stay in .env; this controls which online providers are ENABLED, the
 * fee % / fixed used for the "cover the processing fee" math, and the list of
 * manual (admin-recorded) payment methods (Cash, Check, Scholarship, eCheck, …).
 */
final class PaymentSettings
{
    private const CATEGORY = 'payments';

    /** Online providers default to Square on, PayPal off (turn on when ready). */
    private const DEFAULT_ENABLED = ['square' => true, 'paypal' => false];

    private const DEFAULT_MANUAL = [
        ['key' => 'cash',        'label' => 'Cash',        'enabled' => true],
        ['key' => 'check',       'label' => 'Check',       'enabled' => true],
        ['key' => 'scholarship', 'label' => 'Scholarship', 'enabled' => true],
        ['key' => 'echeck',      'label' => 'eCheck',      'enabled' => false],
    ];

    public static function raw(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        return is_array($v) ? $v : [];
    }

    public static function save(PDO $pdo, array $settings): void
    {
        $json = json_encode($settings);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = ?"); $ex->execute([self::CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, 'Payment Settings', ?)")->execute([self::CATEGORY, $json]);
        }
    }

    public static function providerEnabled(PDO $pdo, string $key): bool
    {
        $r = self::raw($pdo);
        if (isset($r['providers'][$key]['enabled'])) return (bool)$r['providers'][$key]['enabled'];
        return self::DEFAULT_ENABLED[$key] ?? false;
    }

    /** Admin fee override for a provider, or null to fall back to the provider default. */
    public static function providerFeeOverride(PDO $pdo, string $key): array
    {
        $r = self::raw($pdo);
        $p = $r['providers'][$key] ?? [];
        return [
            'fee_percent' => isset($p['fee_percent']) && $p['fee_percent'] !== '' ? (float)$p['fee_percent'] : null,
            'fee_fixed'   => isset($p['fee_fixed'])   && $p['fee_fixed'] !== ''   ? (float)$p['fee_fixed']   : null,
        ];
    }

    /** Manual (admin-recorded) methods; enabled-only by default. */
    public static function manualMethods(PDO $pdo, bool $onlyEnabled = true): array
    {
        $r = self::raw($pdo);
        $list = (isset($r['manual_methods']) && is_array($r['manual_methods'])) ? $r['manual_methods'] : self::DEFAULT_MANUAL;
        $out = [];
        foreach ($list as $m) {
            if (empty($m['key'])) continue;
            $enabled = !empty($m['enabled']);
            if ($onlyEnabled && !$enabled) continue;
            $out[] = ['key' => (string)$m['key'], 'label' => (string)($m['label'] ?? $m['key']), 'enabled' => $enabled];
        }
        return $out;
    }

    /**
     * Where "Request Payment Plan" notifications go. Configurable in Admin → Payment
     * Settings; falls back to the default below so the button works before anyone sets
     * it. Kept here rather than in .env so an admin can change it without a deploy.
     */
    public const DEFAULT_PLAN_REQUEST_EMAIL = 'anita@tulsaroboticscenter.org';

    public static function planRequestEmail(PDO $pdo): string
    {
        $r = self::raw($pdo);
        $e = trim((string)($r['plan_request_email'] ?? ''));
        return $e !== '' ? $e : self::DEFAULT_PLAN_REQUEST_EMAIL;
    }

    public static function defaultManual(): array { return self::DEFAULT_MANUAL; }
    public static function defaultEnabled(string $key): bool { return self::DEFAULT_ENABLED[$key] ?? false; }
}
