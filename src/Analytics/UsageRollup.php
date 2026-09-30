<?php
declare(strict_types=1);

namespace App\Analytics;

use PDO;

/**
 * Rolls the raw usage_events stream up into per-member, per-month summaries
 * (usage_monthly) so long-term adoption trends survive pruning of the raw
 * events. Uses the same session model as the User Activity report: events are
 * grouped into sessions (a gap over SESSION_GAP starts a new one) and a
 * session's duration is last-minus-first (single-event sessions get a floor).
 */
final class UsageRollup
{
    private const SESSION_GAP = 1800;   // 30 min → new session
    private const LONE_FLOOR  = 60;     // seconds credited to a single-event session

    public function __construct(private PDO $pdo) {}

    /** Roll up one month ('YYYY-MM'). Returns the number of member rows written. */
    public function rollupMonth(string $period): int
    {
        if (!preg_match('/^\d{4}-\d{2}$/', $period)) return 0;
        $start = $period . '-01 00:00:00';
        $end = date('Y-m-t 23:59:59', strtotime($period . '-01'));

        $st = $this->pdo->prepare(
            "SELECT member_id, event_type, created_at
               FROM usage_events
              WHERE created_at BETWEEN ? AND ?
              ORDER BY member_id, created_at"
        );
        $st->execute([$start, $end]);

        // member_id => aggregate
        $agg = [];
        foreach ($st->fetchAll() as $r) {
            $mid = (int)$r['member_id'];
            $ts = strtotime((string)$r['created_at']);
            if (!isset($agg[$mid])) {
                $agg[$mid] = ['pv' => 0, 'sessions' => 0, 'active_s' => 0, 'days' => [],
                              'last' => $r['created_at'], 'prev' => null, 'start' => null, 'end' => null];
            }
            $a =& $agg[$mid];
            if ($r['event_type'] === 'pageview') $a['pv']++;
            $a['days'][substr((string)$r['created_at'], 0, 10)] = true;
            $a['last'] = $r['created_at'];
            if ($a['prev'] === null || ($ts - $a['prev']) > self::SESSION_GAP) {
                if ($a['start'] !== null) $a['active_s'] += self::sessionSeconds($a['start'], $a['end']);
                $a['sessions']++;
                $a['start'] = $ts;
            }
            $a['end'] = $ts;
            $a['prev'] = $ts;
            unset($a);
        }
        foreach ($agg as &$a) {
            if ($a['start'] !== null) $a['active_s'] += self::sessionSeconds($a['start'], $a['end']);
        }
        unset($a);

        $now = date('Y-m-d H:i:s');
        $up = $this->pdo->prepare(
            "INSERT INTO usage_monthly (member_id, period_month, pageviews, sessions, active_minutes, active_days, last_seen, captured_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE pageviews=VALUES(pageviews), sessions=VALUES(sessions),
               active_minutes=VALUES(active_minutes), active_days=VALUES(active_days),
               last_seen=VALUES(last_seen), captured_at=VALUES(captured_at)"
        );
        $n = 0;
        foreach ($agg as $mid => $a) {
            $up->execute([
                $mid, $period, $a['pv'], $a['sessions'],
                (int)round($a['active_s'] / 60), count($a['days']), $a['last'], $now,
            ]);
            $n++;
        }
        return $n;
    }

    /** Distinct 'YYYY-MM' months that have raw events strictly before $cutoff. */
    public function monthsBefore(string $cutoff): array
    {
        $st = $this->pdo->prepare(
            "SELECT DISTINCT DATE_FORMAT(created_at, '%Y-%m') AS m FROM usage_events WHERE created_at < ? ORDER BY m"
        );
        $st->execute([$cutoff]);
        return array_map('strval', $st->fetchAll(PDO::FETCH_COLUMN));
    }

    /** Ensure every month with events before $cutoff is rolled up (safety before prune). */
    public function rollupThrough(string $cutoff): int
    {
        $total = 0;
        foreach ($this->monthsBefore($cutoff) as $period) {
            $total += $this->rollupMonth($period);
        }
        return $total;
    }

    private static function sessionSeconds(int $start, int $end): int
    {
        $d = $end - $start;
        return $d > 0 ? $d : self::LONE_FLOOR;
    }
}
