<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Timestamp helpers for JSON parity with FastAPI.
 * PostgreSQL returns 'YYYY-MM-DD HH:MM:SS[.ffffff]'; FastAPI emits ISO 'T'.
 * Check-in times are stored as naive UTC and the Python app tags them +00:00.
 */
final class Time
{
    /** 'YYYY-MM-DD HH:MM:SS...' → 'YYYY-MM-DDT...' (matches a naive FastAPI datetime). */
    public static function naiveIso(?string $ts): ?string
    {
        if ($ts === null || $ts === '') return null;
        $iso = preg_replace('/^(\d{4}-\d{2}-\d{2}) /', '$1T', $ts, 1);
        // Python datetime.isoformat() zero-pads fractional seconds to 6 digits;
        // Postgres trims trailing zeros. Re-pad so timestamps match byte-for-byte.
        return preg_replace_callback('/\.(\d{1,6})/', fn($m) => '.' . str_pad($m[1], 6, '0'), $iso, 1);
    }

    /** Same, tagged as UTC (+00:00) — matches the Python _iso_utc() helper. */
    public static function utcIso(?string $ts): ?string
    {
        $iso = self::naiveIso($ts);
        if ($iso === null) return null;
        if (preg_match('/[+\-]\d{2}:?\d{2}$|Z$/', $iso)) return $iso;
        return $iso . '+00:00';
    }
}
