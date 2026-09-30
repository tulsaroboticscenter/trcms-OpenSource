<?php
declare(strict_types=1);

namespace App\Core;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Small JSON response + request helpers. */
final class Http
{
    /**
     * Caller IP for audit and security logging (and rate-limit keys).
     *
     * Security #7: X-Forwarded-For is client-controlled and must NOT be trusted blindly —
     * doing so let an attacker forge audit IPs and defeat every XFF-keyed rate limiter.
     * We honour XFF only when the direct peer (REMOTE_ADDR) is a trusted reverse proxy
     * (Plesk runs nginx→apache on the same host, so the peer is loopback/private, or an
     * IP listed in TRUSTED_PROXIES). nginx appends the real client to the RIGHT of XFF
     * (`$proxy_add_x_forwarded_for`), so we walk from the right and take the first hop
     * that isn't itself a trusted proxy — ignoring any values the client pre-spoofed on
     * the left. A direct/untrusted peer means we ignore XFF entirely and use REMOTE_ADDR.
     *
     * Returns null rather than '' so "not captured" is distinguishable from "captured empty".
     */
    public static function clientIp(Request $request): ?string
    {
        $server = $request->getServerParams();
        $remote = trim((string)($server['REMOTE_ADDR'] ?? ''));
        $xff = $request->getHeaderLine('X-Forwarded-For');

        $ip = $remote;
        if ($xff !== '' && self::isTrustedProxy($remote)) {
            foreach (array_reverse(array_map('trim', explode(',', $xff))) as $hop) {
                // skip blanks, chained proxies, and anything that isn't a real IP
                if ($hop === '' || filter_var($hop, FILTER_VALIDATE_IP) === false || self::isTrustedProxy($hop)) continue;
                $ip = $hop;
                break;
            }
        }
        $ip = substr($ip, 0, 64);
        return $ip !== '' ? $ip : null;
    }

    /** True if $ip is a loopback/private address or is listed in the TRUSTED_PROXIES env. */
    private static function isTrustedProxy(string $ip): bool
    {
        $ip = trim($ip);
        if (filter_var($ip, FILTER_VALIDATE_IP) === false) return false;   // not an IP at all
        // A valid IP that is NOT public (fails these flags) is private/reserved/loopback =
        // the local Plesk reverse proxy.
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return true;
        }
        // Otherwise it's a public IP — trusted only if explicitly listed.
        $configured = array_filter(array_map('trim', explode(',', (string)Config::get('TRUSTED_PROXIES', ''))));
        return in_array($ip, $configured, true);
    }

    public static function json(Response $response, mixed $data, int $status = 200): Response
    {
        $response->getBody()->write(json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
    }

    public static function error(Response $response, string $detail, int $status = 400): Response
    {
        return self::json($response, ['detail' => $detail], $status);
    }
}
