<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Database;
use App\Core\EmailTracking;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Public (unauthenticated) email open/click tracking endpoints. Hit by the
 * recipient's mail client (pixel) or browser (link redirect), so they carry no
 * auth and must never error in a way that breaks the email or the link.
 */
final class TrackingController
{
    /** GET /track/o/{token}.png — record an open, return a 1x1 GIF. */
    public static function open(Request $req, Response $res, array $route): Response
    {
        $token = preg_replace('/\.(png|gif)$/i', '', (string)($route['token'] ?? ''));
        if ($token !== '') {
            try {
                $pdo = Database::pdo();
                $pdo->prepare(
                    "UPDATE communication_messages
                        SET open_count = open_count + 1,
                            opened_at = COALESCE(opened_at, NOW())
                      WHERE track_token = ?"
                )->execute([$token]);
            } catch (\Throwable $e) { /* never break the pixel */ }
        }
        $gif = EmailTracking::pixelGif();
        $res->getBody()->write($gif);
        return $res
            ->withHeader('Content-Type', 'image/gif')
            ->withHeader('Content-Length', (string)strlen($gif))
            ->withHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
            ->withHeader('Pragma', 'no-cache')
            ->withStatus(200);
    }

    /** GET /track/c/{token} — record a click, then 302 to the original URL. */
    public static function click(Request $req, Response $res, array $route): Response
    {
        $token = (string)($route['token'] ?? '');
        $dest = null;
        if ($token !== '') {
            try {
                $pdo = Database::pdo();
                $s = $pdo->prepare("SELECT id, message_id, url FROM comm_email_links WHERE link_token = ?");
                $s->execute([$token]);
                if ($link = $s->fetch()) {
                    $dest = $link['url'];
                    $pdo->prepare("UPDATE comm_email_links SET click_count = click_count + 1, first_clicked_at = COALESCE(first_clicked_at, NOW()) WHERE id = ?")
                        ->execute([(int)$link['id']]);
                    // A click implies the message was opened.
                    $pdo->prepare(
                        "UPDATE communication_messages
                            SET click_count = click_count + 1,
                                clicked_at = COALESCE(clicked_at, NOW()),
                                opened_at = COALESCE(opened_at, NOW())
                          WHERE id = ?"
                    )->execute([(int)$link['message_id']]);
                }
            } catch (\Throwable $e) { /* fall through to a safe redirect */ }
        }
        // Only ever redirect to a stored (http/https) destination — never a
        // caller-supplied value — so this can't be used as an open redirect.
        if (!$dest || !preg_match('#^https?://#i', $dest)) {
            $dest = rtrim((string)\App\Core\Config::get('APP_URL', ''), '/') ?: '/';
        }
        return $res->withHeader('Location', $dest)->withStatus(302);
    }
}
