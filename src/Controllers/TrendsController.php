<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Analytics\MetricBreakdowns;
use App\Analytics\MetricCapture;
use App\Analytics\MetricsRegistry;
use App\Analytics\RetentionService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Trends / time-series API. Serves the metric registry (filtered to what the
 * viewer may see) and time-series values for a chosen metric.
 *
 * Sensitivity gating (until the full reports-engine field-tier system lands):
 *   public/internal → any authenticated member
 *   pii             → members.view (read)
 *   financial       → inventory.budgets OR grants.view (read)
 *
 * Snapshot metrics are read from metric_snapshots (their only history). Event
 * metrics are computed live across the range so they render accurately without
 * waiting for the capture job.
 */
final class TrendsController
{
    /** @return array<string,bool> which sensitivity tiers this member may view */
    private static function tiers(PDO $pdo, array $m): array
    {
        $can = fn(string $k) => Permissions::memberCan($pdo, $m, $k, 'read');
        return [
            'public' => true,
            'internal' => true,
            'pii' => $can('members.view'),
            'financial' => $can('inventory.budgets') || $can('grants.view'),
        ];
    }

    /** GET /api/v1/trends/metrics — registry the viewer is allowed to see. */
    public static function metrics(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $tiers = self::tiers($pdo, $cur);

        $out = [];
        foreach (MetricsRegistry::all() as $key => $m) {
            if (empty($tiers[$m['sensitivity'] ?? 'internal'])) continue;
            $out[] = [
                'key' => $key,
                'label' => $m['label'],
                'domain' => $m['domain'],
                'mechanism' => $m['mechanism'],
                'unit' => $m['unit'] ?? 'count',
                'scope' => $m['scope'] ?? 'global',
                'breakdowns' => $m['breakdowns'] ?? [],
                'available_breakdowns' => MetricBreakdowns::dimsFor($key),
                'sensitivity' => $m['sensitivity'] ?? 'internal',
                'phase' => $m['phase'] ?? 1,
            ];
        }
        return Http::json($res, ['metrics' => $out]);
    }

    /**
     * GET /api/v1/trends/series?metric=&period=&from=&to=&scope_type=&scope_id=
     * Returns an ordered time series for one metric.
     */
    public static function series(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);

        $q = $req->getQueryParams();
        $metricKey = (string)($q['metric'] ?? '');
        $def = MetricsRegistry::get($metricKey);
        if (!$def) return Http::error($res, 'Unknown metric', 404);

        $tiers = self::tiers($pdo, $cur);
        if (empty($tiers[$def['sensitivity'] ?? 'internal'])) {
            return Http::error($res, 'Not permitted to view this metric', 403);
        }

        $period = in_array(($q['period'] ?? 'month'), ['day', 'week', 'month', 'quarter', 'year'], true)
            ? (string)$q['period'] : 'month';
        // Default window: last 12 months (or 5 years for yearly).
        $to = self::validDate($q['to'] ?? null) ?? date('Y-m-d');
        $defaultFrom = $period === 'year'
            ? date('Y-m-d', strtotime('-5 years', strtotime($to)))
            : date('Y-m-d', strtotime('-12 months', strtotime($to)));
        $from = self::validDate($q['from'] ?? null) ?? $defaultFrom;
        $scopeType = isset($q['scope_type']) ? (string)$q['scope_type'] : null;
        $scopeId = isset($q['scope_id']) ? (string)$q['scope_id'] : null;

        $mechanism = $def['mechanism'] ?? 'event';

        // Breakdown drill-down: split the metric by a dimension into multiple series.
        $breakdown = isset($q['breakdown']) ? (string)$q['breakdown'] : null;
        if ($breakdown !== null && in_array($breakdown, MetricBreakdowns::dimsFor($metricKey), true)) {
            $points = (new MetricBreakdowns($pdo))->series($metricKey, $breakdown, $period, $from, $to);
            $seriesKeys = [];
            foreach ($points as $p) $seriesKeys[$p['scope_id']] = $p['label'];
            return Http::json($res, [
                'metric' => $metricKey,
                'label' => $def['label'],
                'unit' => $def['unit'] ?? 'count',
                'mechanism' => $mechanism,
                'period' => $period,
                'from' => $from,
                'to' => $to,
                'breakdown' => $breakdown,
                'series' => array_map(fn($id, $lbl) => ['scope_id' => (string)$id, 'label' => $lbl], array_keys($seriesKeys), array_values($seriesKeys)),
                'points' => $points,
            ]);
        }

        $points = $mechanism === 'snapshot'
            ? self::fromSnapshots($pdo, $metricKey, $period, $from, $to, $scopeType, $scopeId)
            : self::liveOrSnapshot($pdo, $metricKey, $period, $from, $to, $scopeType, $scopeId);

        return Http::json($res, [
            'metric' => $metricKey,
            'label' => $def['label'],
            'unit' => $def['unit'] ?? 'count',
            'mechanism' => $mechanism,
            'period' => $period,
            'from' => $from,
            'to' => $to,
            'breakdown' => null,
            'points' => $points,
        ]);
    }

    /** GET /api/v1/trends/retention?member_type=youth&max_years=5 */
    public static function retention(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);

        $q = $req->getQueryParams();
        $mt = in_array(($q['member_type'] ?? 'youth'), ['youth', 'mentor', 'all'], true)
            ? (string)$q['member_type'] : 'youth';
        $maxYears = max(1, min(10, (int)($q['max_years'] ?? 5)));

        $data = (new RetentionService($pdo))->triangle($mt, $maxYears);
        return Http::json($res, $data);
    }

    private static function validDate($v): ?string
    {
        if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return null;
        return $v;
    }

    /** Read a snapshot metric's frozen history. */
    private static function fromSnapshots(PDO $pdo, string $key, string $period, string $from, string $to, ?string $scopeType, ?string $scopeId): array
    {
        $sql = "SELECT period_key, period_start, scope_type, scope_id, value
                  FROM metric_snapshots
                 WHERE metric_key = ? AND period_type = ? AND period_start BETWEEN ? AND ?";
        $params = [$key, $period, $from, $to];
        if ($scopeType !== null) { $sql .= " AND scope_type = ?"; $params[] = $scopeType; }
        if ($scopeId !== null) { $sql .= " AND scope_id = ?"; $params[] = $scopeId; }
        $sql .= " ORDER BY period_start";
        $st = $pdo->prepare($sql);
        $st->execute($params);
        return array_map(static fn($r) => [
            'period_key' => $r['period_key'],
            'period_start' => $r['period_start'],
            'scope_type' => $r['scope_type'],
            'scope_id' => $r['scope_id'],
            'value' => (float)$r['value'],
        ], $st->fetchAll());
    }

    /** Event metric: compute live for accuracy; fall back to snapshots if no compute exists. */
    private static function liveOrSnapshot(PDO $pdo, string $key, string $period, string $from, string $to, ?string $scopeType, ?string $scopeId): array
    {
        $live = (new MetricCapture($pdo))->computeLive($key, $period, $from, $to);
        if (!$live) {
            return self::fromSnapshots($pdo, $key, $period, $from, $to, $scopeType, $scopeId);
        }
        if ($scopeType !== null) {
            $live = array_values(array_filter($live, fn($p) => $p['scope_type'] === $scopeType
                && ($scopeId === null || $p['scope_id'] === $scopeId)));
        }
        return $live;
    }
}
