<?php
declare(strict_types=1);

namespace App\Core;

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s period) — the standard used by Google
 * Authenticator, Authy, 1Password, etc. No external dependency.
 */
final class Totp
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    public const DIGITS = 6;
    public const PERIOD = 30;

    /** A fresh base32 secret (default 20 random bytes = 160 bits). */
    public static function generateSecret(int $bytes = 20): string
    {
        return self::base32encode(random_bytes($bytes));
    }

    /** The one-time code for a given counter (used internally + testable). */
    public static function hotp(string $base32Secret, int $counter, int $digits = self::DIGITS): string
    {
        $key = self::base32decode($base32Secret);
        $binCounter = pack('J', $counter); // 64-bit big-endian
        $hash = hash_hmac('sha1', $binCounter, $key, true);
        $offset = ord($hash[strlen($hash) - 1]) & 0xf;
        $code = ((ord($hash[$offset]) & 0x7f) << 24)
              | ((ord($hash[$offset + 1]) & 0xff) << 16)
              | ((ord($hash[$offset + 2]) & 0xff) << 8)
              | (ord($hash[$offset + 3]) & 0xff);
        $code %= 10 ** $digits;
        return str_pad((string)$code, $digits, '0', STR_PAD_LEFT);
    }

    /** Verify a user-entered code against the secret, tolerating ±$window steps for clock drift. */
    public static function verify(string $base32Secret, string $code, int $window = 1, ?int $now = null): bool
    {
        return self::verifyGetStep($base32Secret, $code, $window, $now) !== null;
    }

    /**
     * Like verify(), but returns the matched time-step (counter) so the caller can
     * store it and reject replays of the same or an earlier code. Null = no match.
     */
    public static function verifyGetStep(string $base32Secret, string $code, int $window = 1, ?int $now = null): ?int
    {
        $code = preg_replace('/\D/', '', $code);
        if ($code === '' || strlen($code) !== self::DIGITS) return null;
        $t = intdiv($now ?? time(), self::PERIOD);
        for ($i = -$window; $i <= $window; $i++) {
            if (hash_equals(self::hotp($base32Secret, $t + $i), $code)) return $t + $i;
        }
        return null;
    }

    /** otpauth:// URI for QR enrollment. */
    public static function otpauthUri(string $base32Secret, string $accountLabel, string $issuer): string
    {
        $label = rawurlencode($issuer . ':' . $accountLabel);
        return "otpauth://totp/{$label}?secret={$base32Secret}&issuer=" . rawurlencode($issuer)
             . '&algorithm=SHA1&digits=' . self::DIGITS . '&period=' . self::PERIOD;
    }

    public static function base32encode(string $data): string
    {
        if ($data === '') return '';
        $bits = '';
        foreach (str_split($data) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
        }
        return $out;
    }

    public static function base32decode(string $b32): string
    {
        $b32 = strtoupper(preg_replace('/[^A-Z2-7]/', '', $b32));
        if ($b32 === '') return '';
        $bits = '';
        foreach (str_split($b32) as $c) $bits .= str_pad(decbin(strpos(self::ALPHABET, $c)), 5, '0', STR_PAD_LEFT);
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) $out .= chr(bindec($byte));
        }
        return $out;
    }
}
