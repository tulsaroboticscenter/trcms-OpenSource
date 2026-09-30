<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * JWT auth (HS256) — interoperable with the Python app (same SECRET_KEY, sub=member id).
 * Implemented directly (no external JWT lib needed for HS256), so tokens issued by
 * either app validate against the other.
 */
final class Auth
{
    private static function secret(): string
    {
        $s = Config::get('SECRET_KEY');
        if (!$s) {
            throw new \RuntimeException('SECRET_KEY is not set.');
        }
        return $s;
    }

    private static function b64url(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $s): string
    {
        $pad = strlen($s) % 4;
        if ($pad) {
            $s .= str_repeat('=', 4 - $pad);
        }
        return base64_decode(strtr($s, '-_', '+/')) ?: '';
    }

    /** Issue an HS256 token. $expiresSeconds null → default expiry from config. */
    public static function encode(array $claims, ?int $expiresSeconds = null): string
    {
        $ttl = $expiresSeconds ?? (Config::int('ACCESS_TOKEN_EXPIRE_MINUTES', 1440) * 60);
        $now = time();
        $claims['iat'] = $now;                    // issued-at, so a sliding session can tell the token's age
        $claims['exp'] = $now + $ttl;
        $header  = self::b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = self::b64url(json_encode($claims, JSON_UNESCAPED_SLASHES));
        $signing = $header . '.' . $payload;
        $sig = self::b64url(hash_hmac('sha256', $signing, self::secret(), true));
        return $signing . '.' . $sig;
    }

    /** How often (seconds) a sliding session re-issues its token — at most once per interval. */
    private const REFRESH_INTERVAL = 300;

    /**
     * Sliding-session renewal. Given the caller's current token, return a FRESH token whose
     * expiry is pushed to now + the session's idle window (the `idle` claim), or null when no
     * refresh is warranted. This keeps an ACTIVE user signed in indefinitely while still
     * logging out someone who's been idle longer than their window.
     *
     * Only sessions that carry an `idle` claim slide (set at login from "keep me logged in").
     * Kiosk/station tokens (long fixed expiry, no `idle`) are left alone.
     */
    public static function refreshed(string $token, ?PDO $pdo = null): ?string
    {
        $claims = self::decode($token);              // null if invalid/expired — don't renew
        if (!is_array($claims)) return null;
        // Security #3: never renew a token whose version has been revoked (password change/
        // reset, 2FA change). Without this the sliding-session refresh would keep a stolen
        // token alive indefinitely even after the credential that issued it changed.
        if ($pdo !== null && isset($claims['sub']) && !self::versionMatches($pdo, (int)$claims['sub'], $claims)) {
            return null;
        }
        $idle = isset($claims['idle']) ? (int)$claims['idle'] : 0;
        if ($idle <= 0) return null;                 // not a sliding session (e.g. kiosk)
        // Only re-issue occasionally, so we don't mint a new token on every single request.
        if (isset($claims['iat']) && (time() - (int)$claims['iat']) < self::REFRESH_INTERVAL) return null;
        unset($claims['iat'], $claims['exp']);       // encode() stamps fresh ones
        return self::encode($claims, $idle);
    }

    /**
     * Session-revocation check. A token carries the member's token_version at mint (claim `tv`);
     * a token with no `tv` is treated as version 0. It is valid only while that still matches the
     * member's current token_version. Bumping the column (bumpTokenVersion) invalidates every
     * previously issued token for that member.
     */
    private static function versionMatches(PDO $pdo, int $memberId, array $claims): bool
    {
        $stmt = $pdo->prepare("SELECT token_version FROM members WHERE id = ?");
        $stmt->execute([$memberId]);
        $cur = $stmt->fetchColumn();
        if ($cur === false) return false;            // member gone
        return (int)($claims['tv'] ?? 0) === (int)$cur;
    }

    /** Invalidate every token issued so far for this member (call on any credential change). */
    public static function bumpTokenVersion(PDO $pdo, int $memberId): void
    {
        $pdo->prepare("UPDATE members SET token_version = token_version + 1 WHERE id = ?")->execute([$memberId]);
    }

    public static function decode(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }
        [$h, $p, $sig] = $parts;
        $expected = self::b64url(hash_hmac('sha256', $h . '.' . $p, self::secret(), true));
        if (!hash_equals($expected, $sig)) {
            return null;
        }
        $claims = json_decode(self::b64urlDecode($p), true);
        if (!is_array($claims)) {
            return null;
        }
        if (isset($claims['exp']) && time() >= (int)$claims['exp']) {
            return null;   // expired
        }
        return $claims;
    }

    public static function loadMember(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$id]);
        $m = $stmt->fetch();
        return $m ?: null;
    }

    /** Resolve the current authenticated member from the Bearer token, or null. */
    public static function currentMember(PDO $pdo, Request $request): ?array
    {
        $header = $request->getHeaderLine('Authorization');
        if (!preg_match('/Bearer\s+(.+)/i', $header, $m)) {
            return null;
        }
        $payload = self::decode(trim($m[1]));
        if (!$payload || !isset($payload['sub'])) {
            return null;
        }
        // A `purpose` claim marks a single-purpose capability token (e.g. the employer form link).
        // Those must NEVER authenticate a session — they are consumed only by their own handler via
        // Auth::decode(). Reject them here so an emailed link can't be replayed as a Bearer session.
        if (isset($payload['purpose'])) {
            return null;
        }
        $member = self::loadMember($pdo, (int)$payload['sub']);
        if (!$member || !$member['is_active']) {
            return null;
        }
        // Security #3: session revocation. A token minted before the member's last credential
        // change (password change/reset, 2FA change) carries a stale `tv` and is rejected here.
        if ((int)($payload['tv'] ?? 0) !== (int)($member['token_version'] ?? 0)) {
            return null;
        }
        return $member;
    }

    /**
     * Password complexity policy: at least 12 characters, with an uppercase
     * letter, a lowercase letter, a number, and a symbol.
     * Returns null when the password is acceptable, or a human-readable error.
     */
    public static function passwordError(?string $pw): ?string
    {
        $pw = (string)$pw;
        $missing = [];
        if (strlen($pw) < 12)               $missing[] = 'at least 12 characters';
        if (!preg_match('/[A-Z]/', $pw))     $missing[] = 'an uppercase letter';
        if (!preg_match('/[a-z]/', $pw))     $missing[] = 'a lowercase letter';
        if (!preg_match('/[0-9]/', $pw))     $missing[] = 'a number';
        if (!preg_match('/[^A-Za-z0-9]/', $pw)) $missing[] = 'a symbol';
        return $missing ? ('Password must contain ' . implode(', ', $missing) . '.') : null;
    }
}
