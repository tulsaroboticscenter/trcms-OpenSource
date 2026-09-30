<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Open/click tracking injection for outbound email.
 *
 * apply() rewrites http(s) links to redirect through the /track/c/{token}
 * endpoint (so we can record clicks and safely redirect by stored token — never
 * an open-redirect) and appends a 1x1 tracking pixel pointing at /track/o/{token}.
 *
 * Tracking is applied only to the copy of the HTML that is SENT — the stored
 * body_html in the history stays clean, so viewing a message in the admin UI
 * doesn't fire the pixel or count as a click.
 */
final class EmailTracking
{
    public static function token(): string
    {
        return bin2hex(random_bytes(16));
    }

    /** Base URL for tracking links (APP_URL, no trailing slash). Empty = disabled. */
    public static function base(): string
    {
        return rtrim((string)Config::get('APP_URL', ''), '/');
    }

    /**
     * Rewrite links + append the open pixel.
     * @return array{0:string,1:array<string,string>} [trackedHtml, [linkToken => url]]
     */
    public static function apply(string $html, string $msgToken, string $base): array
    {
        $links = [];
        $base = rtrim($base, '/');

        // Rewrite absolute http(s) hrefs (single or double quoted). Leaves mailto:,
        // tel:, #anchors, and relative links untouched.
        $html = preg_replace_callback(
            '/href\s*=\s*(["\'])(https?:\/\/[^"\']+)\1/i',
            function ($m) use (&$links, $base) {
                $url = $m[2];
                $lt = self::token();
                $links[$lt] = $url;
                return 'href="' . htmlspecialchars($base . '/api/v1/track/c/' . $lt, ENT_QUOTES) . '"';
            },
            $html
        ) ?? $html;

        $pixel = '<img src="' . htmlspecialchars($base . '/api/v1/track/o/' . $msgToken . '.png', ENT_QUOTES)
               . '" alt="" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" />';
        if (stripos($html, '</body>') !== false) {
            $html = preg_replace('/<\/body>/i', $pixel . '</body>', $html, 1);
        } else {
            $html .= $pixel;
        }
        return [$html, $links];
    }

    /** The 1x1 transparent GIF returned by the open endpoint. */
    public static function pixelGif(): string
    {
        return base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    }
}
