<?php
declare(strict_types=1);

namespace App\Core;

/**
 * GeoIP country lookup for geo-restriction (Admin → Security). Everything here FAILS OPEN:
 * every failure mode — no GEOIP_DB_PATH set, the .mmdb file missing, the geoip2 library not
 * installed, a private/reserved IP, or any lookup error — returns null ("unknown location"),
 * which callers treat as allowed. A missing database therefore never locks anyone out.
 *
 * Server setup to make it live: `composer require geoip2/geoip2`, download MaxMind's
 * GeoLite2-Country.mmdb, and set GEOIP_DB_PATH to its path (then clear OPcache).
 */
final class GeoIp
{
    /** null = not yet attempted, false = unavailable, object = an open reader. */
    private static $reader = null;

    private static function reader(): ?object
    {
        if (self::$reader !== null) return self::$reader ?: null;
        self::$reader = false;
        $path = trim((string)Config::get('GEOIP_DB_PATH', ''));
        if ($path === '' || !is_file($path) || !class_exists('\GeoIp2\Database\Reader')) return null;
        try {
            self::$reader = new \GeoIp2\Database\Reader($path);
        } catch (\Throwable $e) {
            error_log('[TRCMS GeoIp] could not open database: ' . $e->getMessage());
            self::$reader = false;
        }
        return self::$reader ?: null;
    }

    /**
     * ISO country code (e.g. "US") for an IP, or null when it can't be determined — an
     * empty/invalid address, a private/reserved range, no database, or a lookup error.
     */
    public static function country(?string $ip): ?string
    {
        $ip = trim((string)$ip);
        if ($ip === '' || !filter_var($ip, FILTER_VALIDATE_IP)) return null;
        // Private / reserved addresses (localhost, LAN, etc.) never map to a country.
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return null;
        $reader = self::reader();
        if ($reader === null) return null;
        try {
            $rec = $reader->country($ip);
            $code = $rec->country->isoCode ?? null;
            return $code ? strtoupper((string)$code) : null;
        } catch (\Throwable $e) {
            return null;   // e.g. AddressNotFoundException — fail open
        }
    }

    /**
     * True only when geo-blocking is ON and the location is KNOWN and NOT on the allow-list.
     * An unknown country (null) is always allowed — this is the fail-open guarantee.
     */
    public static function isBlocked(?string $country, bool $enabled, array $allowed): bool
    {
        if (!$enabled) return false;
        if ($country === null || $country === '') return false;
        $allowed = array_map(fn ($c) => strtoupper(trim((string)$c)), $allowed);
        return !in_array(strtoupper($country), $allowed, true);
    }

    /** Whether a working GeoIP database is actually available (for an admin status check). */
    public static function available(): bool
    {
        return self::reader() !== null;
    }
}
