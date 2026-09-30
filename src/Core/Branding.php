<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Organization branding resolver (open-source Phase 4).
 * =====================================================
 * One place that answers "what is this organization called and what does its
 * wordmark/logo look like", so the UI stops hardcoding "Tulsa Robotics Center".
 *
 * Resolution order (each field falls back independently):
 *   name       system_config 'org_identity'.name  →  .env ORG_NAME  →  "TRCMS"
 *   short_name org_identity.short_name             →  initials of name (e.g. TRC)
 *   tagline    org_identity.tagline                →  "Program Management System"
 *   logo_url   org_identity.logo_url               →  .env LOGO_URL  →  "" (text wordmark)
 *
 * This is non-regressing: an established install (no org_identity row, e.g. TRC)
 * keeps its ORG_NAME + LOGO_URL from .env exactly as before. A fresh install gets
 * whatever the setup wizard stored, and no TRC-specific value is ever a code default.
 */
final class Branding
{
    public static function resolve(PDO $pdo): array
    {
        $org = self::orgIdentity($pdo);
        $name = self::firstNonEmpty([
            $org['name'] ?? null,
            Config::get('ORG_NAME'),
            'TRCMS',
        ]);
        return [
            'name'       => $name,
            'short_name' => self::firstNonEmpty([$org['short_name'] ?? null, self::initials($name)]),
            'tagline'    => self::firstNonEmpty([$org['tagline'] ?? null, 'Program Management System']),
            'logo_url'   => self::firstNonEmpty([$org['logo_url'] ?? null, Config::get('LOGO_URL'), '']),
        ];
    }

    /** The org's display name only (for backend use, e.g. email templates). */
    public static function name(PDO $pdo): string
    {
        return self::resolve($pdo)['name'];
    }

    private static function orgIdentity(PDO $pdo): array
    {
        try {
            $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category='org_identity'");
            $s->execute();
            $v = $s->fetchColumn();
            $d = $v ? json_decode((string)$v, true) : [];
            return is_array($d) ? $d : [];
        } catch (\Throwable) {
            return [];
        }
    }

    /** Initials from the significant words of a name, uppercased, up to 4 chars. */
    public static function initials(string $name): string
    {
        $skip = ['of', 'the', 'and', 'for', 'inc', 'llc'];
        $out = '';
        foreach (preg_split('/[^A-Za-z0-9]+/', $name) ?: [] as $w) {
            if ($w === '' || in_array(strtolower($w), $skip, true)) continue;
            $out .= strtoupper($w[0]);
            if (strlen($out) >= 4) break;
        }
        return $out !== '' ? $out : 'TRCMS';
    }

    private static function firstNonEmpty(array $vals): string
    {
        foreach ($vals as $v) {
            $v = is_string($v) ? trim($v) : '';
            if ($v !== '') return $v;
        }
        return '';
    }
}
