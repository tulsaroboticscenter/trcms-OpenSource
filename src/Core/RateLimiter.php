<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use Psr\Http\Message\ServerRequestInterface as Request;
use Throwable;

/**
 * Per-IP rate limiting for unauthenticated endpoints (security finding #8).
 *
 * Backed by rate_limit_hits (migration 0235). Keyed by a salted hash of the trusted client IP
 * (Http::clientIp, which is #7-safe), never the raw X-Forwarded-For. Fails OPEN on any error so
 * a limiter problem can never lock people out of a public form.
 */
final class RateLimiter
{
    /** Salted per-bucket key for an IP, so buckets don't share counters and raw IPs aren't stored. */
    public static function key(Request $request, string $bucket): string
    {
        $ip = Http::clientIp($request) ?? '0.0.0.0';
        return hash('sha256', $bucket . '|' . $ip);
    }

    /** Record one hit for (bucket,key). */
    public static function record(PDO $pdo, string $bucket, string $key): void
    {
        try {
            $pdo->prepare("INSERT INTO rate_limit_hits (bucket, ip_hash, created_at) VALUES (?, ?, NOW())")
                ->execute([$bucket, $key]);
        } catch (Throwable $e) {
            error_log('[TRCMS ratelimit] ' . $e->getMessage());
        }
    }

    /** How many hits for (bucket,key) within the last $windowMinutes. */
    public static function count(PDO $pdo, string $bucket, string $key, int $windowMinutes): int
    {
        try {
            $w = max(1, $windowMinutes);
            $s = $pdo->prepare(
                "SELECT COUNT(*) FROM rate_limit_hits
                  WHERE bucket = ? AND ip_hash = ? AND created_at >= (NOW() - INTERVAL $w MINUTE)");
            $s->execute([$bucket, $key]);
            return (int)$s->fetchColumn();
        } catch (Throwable $e) {
            return 0;   // fail open
        }
    }

    /**
     * Record a hit, then report whether this IP is now over $max in the window.
     * Returns true when the request should be rejected (429).
     */
    public static function overLimit(PDO $pdo, Request $request, string $bucket, int $max, int $windowMinutes): bool
    {
        $key = self::key($request, $bucket);
        self::record($pdo, $bucket, $key);
        return self::count($pdo, $bucket, $key, $windowMinutes) > $max;
    }
}
