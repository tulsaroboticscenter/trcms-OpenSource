<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * In-app usage tracking + the User Activity report.
 *
 * track() ingests the page-view / heartbeat stream the frontend emits (any
 * authenticated member logs their own activity). report() aggregates it into
 * adoption metrics — page views, sessions, time-in-system, actions, last seen —
 * ranked to surface power users. The report is admin-only since it profiles
 * individual people's usage.
 *
 * Time-in-system is derived by grouping each member's events into sessions: a
 * gap over SESSION_GAP seconds starts a new session; a session's duration is
 * last-minus-first event (single-event sessions get a small floor).
 */
final class UsageController
{
    private const SESSION_GAP = 1800;   // 30 min → new session
    private const LONE_FLOOR  = 60;     // seconds credited to a single-event session

    /** POST /api/v1/usage/track — body {events:[{type,path}]} or {type,path}. */
    public static function track(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);

        $body = (array)($req->getParsedBody() ?? []);
        $events = $body['events'] ?? [$body];
        if (!is_array($events)) return Http::json($res, ['ok' => true]);
        $events = array_slice($events, 0, 50);   // cap a batch

        $now = date('Y-m-d H:i:s');
        $ins = $pdo->prepare(
            "INSERT INTO usage_events (member_id, event_type, path, created_at) VALUES (?,?,?,?)"
        );
        $n = 0;
        foreach ($events as $ev) {
            if (!is_array($ev)) continue;
            $type = ($ev['type'] ?? 'pageview') === 'heartbeat' ? 'heartbeat' : 'pageview';
            $path = self::cleanPath((string)($ev['path'] ?? ''));
            if ($path === '') continue;
            // Anonymity (Incident Reports §7.4): never record a page view for the incident report
            // route — a usage_events timestamp could correlate to an anonymous submission.
            if (strpos($path, '/incidents/new') === 0) continue;
            $ins->execute([(int)$cur['id'], $type, $path, $now]);
            $n++;
        }
        return Http::json($res, ['ok' => true, 'stored' => $n]);
    }

    /** Defense-in-depth: strip query, normalize ids, clamp length (client also does this). */
    private static function cleanPath(string $p): string
    {
        $p = explode('?', $p)[0];
        $p = explode('#', $p)[0];
        if ($p === '') return '';
        if ($p[0] !== '/') $p = '/' . $p;
        $p = preg_replace('#/\d+#', '/:id', $p) ?? $p;
        return mb_substr($p, 0, 200);
    }

    /** GET /api/v1/reports/usage?from=&to= — admin only. */
    public static function report(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) {
            return Http::error($res, 'You do not have permission to perform this action', 403);
        }

        $q = $req->getQueryParams();
        $to = self::validDate($q['to'] ?? null) ?? date('Y-m-d');
        $from = self::validDate($q['from'] ?? null) ?? date('Y-m-d', strtotime('-30 days', strtotime($to)));
        $fromDt = $from . ' 00:00:00';
        $toDt = $to . ' 23:59:59';

        // Pull the event stream ordered per member, derive sessions in PHP.
        $st = $pdo->prepare(
            "SELECT member_id, event_type, path, created_at
               FROM usage_events
              WHERE created_at BETWEEN ? AND ?
              ORDER BY member_id, created_at"
        );
        $st->execute([$fromDt, $toDt]);

        $agg = [];   // member_id => [pageviews, sessions, active_s, last_seen, prev_ts, sess_start, sess_last]
        foreach ($st->fetchAll() as $r) {
            $mid = (int)$r['member_id'];
            $ts = strtotime((string)$r['created_at']);
            if (!isset($agg[$mid])) {
                $agg[$mid] = ['pageviews' => 0, 'sessions' => 0, 'active_s' => 0, 'last_seen' => $r['created_at'],
                              'prev' => null, 'start' => null, 'end' => null];
            }
            $a =& $agg[$mid];
            if ($r['event_type'] === 'pageview') $a['pageviews']++;
            $a['last_seen'] = $r['created_at'];

            if ($a['prev'] === null || ($ts - $a['prev']) > self::SESSION_GAP) {
                // Close the previous session, open a new one.
                if ($a['start'] !== null) $a['active_s'] += self::sessionSeconds($a['start'], $a['end']);
                $a['sessions']++;
                $a['start'] = $ts;
            }
            $a['end'] = $ts;
            $a['prev'] = $ts;
            unset($a);
        }
        // Close final open sessions.
        foreach ($agg as &$a) {
            if ($a['start'] !== null) $a['active_s'] += self::sessionSeconds($a['start'], $a['end']);
        }
        unset($a);

        // Actions performed (from the audit log) in the same window.
        $actions = [];
        $as = $pdo->prepare("SELECT actor_id, COUNT(*) c FROM audit_logs WHERE created_at BETWEEN ? AND ? AND actor_id IS NOT NULL GROUP BY actor_id");
        $as->execute([$fromDt, $toDt]);
        foreach ($as->fetchAll() as $r) $actions[(int)$r['actor_id']] = (int)$r['c'];

        // Names / types for everyone who appears.
        $ids = array_unique(array_merge(array_keys($agg), array_keys($actions)));
        $names = [];
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $ms = $pdo->prepare("SELECT id, first_name, last_name, member_type FROM members WHERE id IN ($in)");
            $ms->execute(array_values($ids));
            foreach ($ms->fetchAll() as $r) $names[(int)$r['id']] = $r;
        }

        $users = [];
        foreach ($ids as $mid) {
            $a = $agg[$mid] ?? null;
            $nm = $names[$mid] ?? null;
            $users[] = [
                'member_id' => $mid,
                'name' => $nm ? trim(($nm['first_name'] ?? '') . ' ' . ($nm['last_name'] ?? '')) : ('Member #' . $mid),
                'member_type' => $nm['member_type'] ?? '',
                'pageviews' => $a['pageviews'] ?? 0,
                'sessions' => $a['sessions'] ?? 0,
                'active_minutes' => $a ? (int)round($a['active_s'] / 60) : 0,
                'actions' => $actions[$mid] ?? 0,
                'last_seen' => $a['last_seen'] ?? null,
            ];
        }
        // Power users first: by active time, then page views.
        usort($users, fn($x, $y) => ($y['active_minutes'] <=> $x['active_minutes']) ?: ($y['pageviews'] <=> $x['pageviews']));

        // Top pages system-wide.
        $tp = $pdo->prepare(
            "SELECT path, COUNT(*) views FROM usage_events
              WHERE event_type='pageview' AND created_at BETWEEN ? AND ?
              GROUP BY path ORDER BY views DESC LIMIT 15"
        );
        $tp->execute([$fromDt, $toDt]);
        $topPages = array_map(fn($r) => ['path' => $r['path'], 'views' => (int)$r['views']], $tp->fetchAll());

        return Http::json($res, [
            'from' => $from, 'to' => $to,
            'users' => $users,
            'top_pages' => $topPages,
            'tracking_active' => array_sum(array_map(fn($u) => $u['pageviews'], $users)) > 0,
        ]);
    }

    private static function sessionSeconds(int $start, int $end): int
    {
        $d = $end - $start;
        return $d > 0 ? $d : self::LONE_FLOOR;
    }

    private static function validDate($v): ?string
    {
        return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    }
}
