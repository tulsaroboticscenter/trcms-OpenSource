<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Calendar feeds (#43) — iCal / Google Calendar integration.
 *
 * Two feeds, both returning standard RFC-5545 .ics:
 *   • Public feed  — events flagged post_to_public_calendar; no token (for the
 *                    TulsaRoboticsCenter.org embed and the general public).
 *   • Personal feed — the full event calendar, addressed by an opaque per-member
 *                    token in the URL (calendar apps can't send an auth header).
 *
 * Times are stored as local Tulsa (America/Chicago) and emitted as UTC instants
 * (…Z), which every calendar client understands without a VTIMEZONE block.
 * Events with no start time are emitted as all-day (VALUE=DATE).
 */
final class CalendarController
{
    private const TZ = 'America/Chicago';
    private const PRODID = '-//Tulsa Robotics Center//TRCMS//EN';

    // ── Public, no-auth feeds ────────────────────────────────────────────
    // Feeds include a rolling window: everything in the future plus recently-past
    // events, so subscriptions stay useful but don't grow without bound over years.
    private const PAST_WINDOW_DAYS = 90;

    /** GET /calendar/public.ics — events marked for the public calendar. */
    public static function publicFeed(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            "SELECT * FROM events
             WHERE post_to_public_calendar = 1
               AND COALESCE(end_date, event_date) >= ?
             ORDER BY event_date, start_time"
        );
        $stmt->execute([self::windowFloor()]);
        return self::emit($res, $stmt->fetchAll(), 'Tulsa Robotics Center', 'trc-public');
    }

    /** GET /calendar/feed/{token}.ics — the full calendar for a token holder. */
    public static function personalFeed(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $token = (string)($route['token'] ?? '');
        // .ics suffix is part of the route literal, but be forgiving if it arrives attached.
        $token = preg_replace('/\.ics$/i', '', $token);
        if ($token === '' || strlen($token) < 16) return self::notFound($res);
        $m = $pdo->prepare("SELECT id, first_name, last_name FROM members WHERE calendar_token = ? LIMIT 1");
        $m->execute([$token]);
        $member = $m->fetch();
        if (!$member) return self::notFound($res);
        $stmt = $pdo->prepare(
            "SELECT * FROM events WHERE COALESCE(end_date, event_date) >= ? ORDER BY event_date, start_time"
        );
        $stmt->execute([self::windowFloor()]);
        return self::emit($res, $stmt->fetchAll(), 'TRC — Full Calendar', 'trc-calendar');
    }

    // ── Authenticated: manage my subscription ────────────────────────────
    /** GET /calendar/my-subscription — reveal (and lazily mint) my feed token + URLs. */
    public static function mySubscription(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $token = self::ensureToken($pdo, (int)$cur['id']);
        return Http::json($res, self::subscriptionPayload($req, $token));
    }

    /** POST /calendar/my-subscription/rotate — invalidate the old URL, issue a new one. */
    public static function rotateToken(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $token = self::newToken($pdo);
        $pdo->prepare("UPDATE members SET calendar_token = ? WHERE id = ?")->execute([$token, (int)$cur['id']]);
        return Http::json($res, self::subscriptionPayload($req, $token));
    }

    // ── Helpers ──────────────────────────────────────────────────────────
    private static function ensureToken(PDO $pdo, int $memberId): string
    {
        $s = $pdo->prepare("SELECT calendar_token FROM members WHERE id = ?");
        $s->execute([$memberId]);
        $tok = $s->fetchColumn();
        if ($tok) return (string)$tok;
        $tok = self::newToken($pdo);
        $pdo->prepare("UPDATE members SET calendar_token = ? WHERE id = ?")->execute([$tok, $memberId]);
        return $tok;
    }

    private static function newToken(PDO $pdo): string
    {
        // Vanishingly unlikely to collide, but loop to honor the UNIQUE constraint.
        do {
            $tok = bin2hex(random_bytes(24)); // 48 hex chars
            $c = $pdo->prepare("SELECT 1 FROM members WHERE calendar_token = ?");
            $c->execute([$tok]);
        } while ($c->fetch());
        return $tok;
    }

    private static function subscriptionPayload(Request $req, string $token): array
    {
        $base = self::baseUrl($req);
        $personal = "$base/api/v1/calendar/feed/$token.ics";
        $public = "$base/api/v1/calendar/public.ics";
        $webcal = preg_replace('#^https?://#', 'webcal://', $personal);
        return [
            'token' => $token,
            'personal_ics_url' => $personal,
            'personal_webcal_url' => $webcal,
            'google_add_url' => 'https://calendar.google.com/calendar/r?cid=' . rawurlencode($webcal),
            'public_ics_url' => $public,
        ];
    }

    /** The earliest event end-date to include — today minus the past window. */
    private static function windowFloor(): string
    {
        return (new \DateTime('now', new \DateTimeZone(self::TZ)))
            ->modify('-' . self::PAST_WINDOW_DAYS . ' days')->format('Y-m-d');
    }

    private static function baseUrl(Request $req): string
    {
        $uri = $req->getUri();
        $scheme = $uri->getScheme() ?: 'https';
        $host = $uri->getHost();
        $port = $uri->getPort();
        $authority = $host . ($port && !in_array($port, [80, 443], true) ? ":$port" : '');
        return "$scheme://$authority";
    }

    private static function notFound(Response $res): Response
    {
        $res->getBody()->write("Calendar not found.");
        return $res->withHeader('Content-Type', 'text/plain')->withStatus(404);
    }

    /** Build the VCALENDAR text and return it as a text/calendar response. */
    private static function emit(Response $res, array $events, string $calName, string $fileSlug): Response
    {
        $tz = new \DateTimeZone(self::TZ);
        $utc = new \DateTimeZone('UTC');
        $now = (new \DateTime('now', $utc))->format('Ymd\THis\Z');

        $lines = [];
        $lines[] = 'BEGIN:VCALENDAR';
        $lines[] = 'VERSION:2.0';
        $lines[] = 'PRODID:' . self::PRODID;
        $lines[] = 'CALSCALE:GREGORIAN';
        $lines[] = 'METHOD:PUBLISH';
        $lines[] = 'X-WR-CALNAME:' . self::esc($calName);
        $lines[] = 'X-WR-TIMEZONE:' . self::TZ;
        // Refresh hints — Outlook/Apple use these to decide how often to re-fetch.
        $lines[] = 'REFRESH-INTERVAL;VALUE=DURATION:PT12H';
        $lines[] = 'X-PUBLISHED-TTL:PT12H';

        foreach ($events as $e) {
            $date = $e['event_date'] ?? null;
            if (!$date) continue;
            $endDate = $e['end_date'] ?: $date;
            $start = $e['start_time'] ?? null;
            $end = $e['end_time'] ?? null;

            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:trc-event-' . (int)$e['id'] . '@trcms.tulsaroboticscenter.org';
            $lines[] = 'DTSTAMP:' . $now;

            if ($start) {
                $dtStart = self::toUtc("$date $start", $tz, $utc);
                // End: explicit end time, else +1 hour from start.
                if ($end) {
                    $dtEnd = self::toUtc("$endDate $end", $tz, $utc);
                } else {
                    $dtEnd = (clone $dtStart)->modify('+1 hour');
                }
                $lines[] = 'DTSTART:' . $dtStart->format('Ymd\THis\Z');
                $lines[] = 'DTEND:' . $dtEnd->format('Ymd\THis\Z');
            } else {
                // All-day: DTEND is exclusive, so add a day to the (inclusive) end date.
                $d0 = new \DateTime($date, $tz);
                $d1 = (new \DateTime($endDate, $tz))->modify('+1 day');
                $lines[] = 'DTSTART;VALUE=DATE:' . $d0->format('Ymd');
                $lines[] = 'DTEND;VALUE=DATE:' . $d1->format('Ymd');
            }

            $lines[] = 'SUMMARY:' . self::esc($e['name'] ?? 'Event');
            if (!empty($e['location'])) $lines[] = 'LOCATION:' . self::esc($e['location']);
            $desc = trim((string)($e['details'] ?? ''));
            if (!empty($e['event_type'])) $desc = $desc === '' ? ('Type: ' . $e['event_type']) : ($desc . "\n\nType: " . $e['event_type']);
            if ($desc !== '') $lines[] = 'DESCRIPTION:' . self::esc($desc);
            if (!empty($e['event_url'])) $lines[] = 'URL:' . self::esc($e['event_url']);
            $lines[] = 'END:VEVENT';
        }
        $lines[] = 'END:VCALENDAR';

        // RFC-5545 uses CRLF line endings, folded at 75 octets.
        $body = implode("\r\n", array_map([self::class, 'fold'], $lines)) . "\r\n";
        $res->getBody()->write($body);
        // Microsoft's subscription fetcher is picky: give it a Content-Length (not
        // chunked), a short cacheable window (it dislikes no-cache), and no
        // attachment-style disposition that could read as a one-time download.
        return $res
            ->withHeader('Content-Type', 'text/calendar; charset=utf-8')
            ->withHeader('Content-Length', (string)strlen($body))
            ->withHeader('Cache-Control', 'public, max-age=3600');
    }

    private static function toUtc(string $localDateTime, \DateTimeZone $tz, \DateTimeZone $utc): \DateTime
    {
        $dt = new \DateTime($localDateTime, $tz);
        $dt->setTimezone($utc);
        return $dt;
    }

    /** Escape a value per RFC-5545 (backslash, semicolon, comma, newline). */
    private static function esc(string $v): string
    {
        $v = str_replace('\\', '\\\\', $v);
        $v = str_replace(["\r\n", "\r", "\n"], '\\n', $v);
        $v = str_replace([';', ','], ['\\;', '\\,'], $v);
        return $v;
    }

    /**
     * Fold a content line to <=75 octets with CRLF + single-space continuation.
     * Splits on whole UTF-8 characters (never mid-multibyte), so an emoji or
     * accented character near a boundary can't corrupt the feed — strict parsers
     * like Outlook reject a calendar outright over one broken character.
     */
    private static function fold(string $line): string
    {
        if (strlen($line) <= 75) return $line;
        $chars = preg_split('//u', $line, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $out = '';
        $cur = '';
        $limit = 75; // first line 75 octets; continuation lines lose 1 to the leading space
        foreach ($chars as $ch) {
            if (strlen($cur) + strlen($ch) > $limit) {
                $out .= ($out === '' ? '' : "\r\n ") . $cur;
                $cur = $ch;
                $limit = 74;
            } else {
                $cur .= $ch;
            }
        }
        return $out . ($out === '' ? '' : "\r\n ") . $cur;
    }
}
