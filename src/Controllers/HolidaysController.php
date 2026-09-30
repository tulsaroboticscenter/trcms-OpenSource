<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Calendar holidays (#118): US federal holidays computed automatically, plus
 * admin-managed TRC closures/breaks. GET /holidays?from&to returns markers in a
 * date range; the calendar overlays them (they are NOT events — no RSVP/clutter).
 */
final class HolidaysController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'admin.config', 'write');
    }

    /** nth weekday (1=Mon..7=Sun ISO; here 0=Sun..6=Sat) of a month → Y-m-d. */
    private static function nthWeekday(int $y, int $month, int $weekday, int $n): string
    {
        $first = new \DateTime(sprintf('%04d-%02d-01', $y, $month));
        $offset = ($weekday - (int)$first->format('w') + 7) % 7;
        $day = 1 + $offset + ($n - 1) * 7;
        return sprintf('%04d-%02d-%02d', $y, $month, $day);
    }

    private static function lastWeekday(int $y, int $month, int $weekday): string
    {
        $t = (int)(new \DateTime(sprintf('%04d-%02d-01', $y, $month)))->format('t');
        $last = new \DateTime(sprintf('%04d-%02d-%02d', $y, $month, $t));
        $offset = ((int)$last->format('w') - $weekday + 7) % 7;
        return sprintf('%04d-%02d-%02d', $y, $month, $t - $offset);
    }

    /** The 11 US federal holidays for a calendar year. */
    private static function federal(int $y): array
    {
        return [
            [sprintf('%04d-01-01', $y), "New Year's Day"],
            [self::nthWeekday($y, 1, 1, 3), 'Martin Luther King Jr. Day'],
            [self::nthWeekday($y, 2, 1, 3), "Presidents' Day"],
            [self::lastWeekday($y, 5, 1), 'Memorial Day'],
            [sprintf('%04d-06-19', $y), 'Juneteenth'],
            [sprintf('%04d-07-04', $y), 'Independence Day'],
            [self::nthWeekday($y, 9, 1, 1), 'Labor Day'],
            [self::nthWeekday($y, 10, 1, 2), 'Columbus Day'],
            [sprintf('%04d-11-11', $y), 'Veterans Day'],
            [self::nthWeekday($y, 11, 4, 4), 'Thanksgiving Day'],
            [sprintf('%04d-12-25', $y), 'Christmas Day'],
        ];
    }

    // GET /holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
    public static function inRange(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $from = $q['from'] ?? date('Y-01-01');
        $to = $q['to'] ?? date('Y-12-31');
        $y1 = (int)substr($from, 0, 4); $y2 = (int)substr($to, 0, 4);
        $out = [];

        for ($y = $y1; $y <= $y2; $y++) {
            foreach (self::federal($y) as [$d, $name]) {
                if ($d >= $from && $d <= $to) $out[] = ['date' => $d, 'name' => $name, 'source' => 'federal'];
            }
        }

        foreach ($pdo->query("SELECT * FROM calendar_holidays")->fetchAll() as $h) {
            $end = $h['end_date'] ?: $h['holiday_date'];
            if (empty($h['recurring_annual'])) {
                // Any overlap of [holiday_date, end] with [from, to].
                if ($h['holiday_date'] <= $to && $end >= $from) {
                    $out[] = ['date' => $h['holiday_date'], 'end_date' => $h['end_date'] ?: null, 'name' => $h['name'], 'source' => 'trc'];
                }
            } else {
                $md = substr($h['holiday_date'], 5); // MM-DD
                for ($y = $y1; $y <= $y2; $y++) {
                    $d = sprintf('%04d-%s', $y, $md);
                    if ($d >= $from && $d <= $to) $out[] = ['date' => $d, 'name' => $h['name'], 'source' => 'trc'];
                }
            }
        }
        usort($out, fn($a, $b) => strcmp($a['date'], $b['date']));
        return Http::json($res, $out);
    }

    // ── Admin CRUD for TRC extras ────────────────────────────────────────────
    public static function adminList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM calendar_holidays ORDER BY holiday_date")->fetchAll();
        return Http::json($res, array_map(fn($h) => [
            'id' => (int)$h['id'], 'name' => $h['name'], 'holiday_date' => $h['holiday_date'],
            'end_date' => $h['end_date'], 'recurring_annual' => (bool)$h['recurring_annual'],
        ], $rows));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name']) || empty($d['holiday_date'])) return Http::error($res, 'Name and date are required.', 422);
        $pdo->prepare("INSERT INTO calendar_holidays (name, holiday_date, end_date, recurring_annual, created_by_id, created_at, updated_at) VALUES (?,?,?,?,?,NOW(),NOW())")
            ->execute([$d['name'], $d['holiday_date'], ($d['end_date'] ?? '') ?: null, !empty($d['recurring_annual']) ? 1 : 0, (int)$m['id']]);
        Audit::write($pdo, (int)$m['id'], 'calendar_holidays', (int)$pdo->lastInsertId(), 'create', null, ['name' => $d['name']]);
        return self::adminList($req, $res);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'holiday_date', 'end_date'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($d[$f] === '' ? null : $d[$f]); }
        if (array_key_exists('recurring_annual', $d)) { $set[] = 'recurring_annual = ?'; $args[] = !empty($d['recurring_annual']) ? 1 : 0; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE calendar_holidays SET " . implode(', ', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'calendar_holidays', $id, 'update');
        return self::adminList($req, $res);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $pdo->prepare("DELETE FROM calendar_holidays WHERE id = ?")->execute([(int)$route['id']]);
        Audit::write($pdo, (int)$m['id'], 'calendar_holidays', (int)$route['id'], 'delete');
        return self::adminList($req, $res);
    }
}
