<?php
declare(strict_types=1);

namespace App\Analytics;

use PDO;

/**
 * Breakdown (drill-down) series for event-derived metrics: the same metric
 * split by a dimension (team, program, event type, funding source, etc.), one
 * value per (period bucket x scope). Powers multi-line / stacked trend views.
 *
 * Only event metrics are broken down here — their per-bucket grouped SUM/COUNT
 * is meaningful over time. Snapshot metrics (current-state) are not time-series
 * by scope, so they're intentionally excluded.
 *
 * Each entry is [sql, pairs]: the SQL uses positional ? placeholders and is fed
 * the (start,end) date pair `pairs` times (for UNIONed source queries).
 */
final class MetricBreakdowns
{
    public function __construct(private PDO $pdo) {}

    /** @return array<string,array{0:string,1:int}> keyed by "metric:dim" */
    private static function queries(): array
    {
        return [
            'events_held:event_type' => [
                "SELECT COALESCE(event_type,'Other') scope_id, COALESCE(event_type,'Other') label, COUNT(*) value
                   FROM events WHERE event_date BETWEEN ? AND ? GROUP BY event_type", 1],
            'event_attendance:event_type' => [
                "SELECT COALESCE(e.event_type,'Other') scope_id, COALESCE(e.event_type,'Other') label, COUNT(*) value
                   FROM checkins c JOIN events e ON e.id=c.event_id
                  WHERE c.event_id IS NOT NULL AND DATE(c.time_in) BETWEEN ? AND ? GROUP BY e.event_type", 1],
            'new_joins:member_type' => [
                "SELECT member_type scope_id, member_type label, COUNT(*) value
                   FROM members WHERE date_joined BETWEEN ? AND ? GROUP BY member_type", 1],
            'visitors:source' => [
                "SELECT COALESCE(NULLIF(referral_source,''),'Unknown') scope_id,
                        COALESCE(NULLIF(referral_source,''),'Unknown') label, COUNT(*) value
                   FROM visitors WHERE DATE(inquiry_date) BETWEEN ? AND ? GROUP BY referral_source", 1],
            'certs_completed:certification' => [
                "SELECT c.id scope_id, c.name label, COUNT(*) value
                   FROM member_certifications mc JOIN certifications c ON c.id=mc.certification_id
                  WHERE mc.completed_date BETWEEN ? AND ? GROUP BY c.id, c.name", 1],
            'certs_added:certification' => [
                "SELECT c.id scope_id, c.name label, COUNT(*) value
                   FROM member_certifications mc JOIN certifications c ON c.id=mc.certification_id
                  WHERE DATE(mc.created_at) BETWEEN ? AND ? GROUP BY c.id, c.name", 1],
            'checkout_volume:team' => [
                "SELECT ts.id scope_id, ts.team_name label, COUNT(*) value
                   FROM inv_checkouts ic JOIN team_seasons ts ON ts.id=ic.team_season_id
                  WHERE DATE(ic.checkout_date) BETWEEN ? AND ? GROUP BY ts.id, ts.team_name", 1],
            'scholarships_awarded:status' => [
                "SELECT status scope_id, status label, COALESCE(SUM(amount_awarded),0) value
                   FROM college_scholarship_applications
                  WHERE decision_date BETWEEN ? AND ? GROUP BY status", 1],
            'funding_per_team:team' => [
                "SELECT ts.id scope_id, ts.team_name label, COALESCE(SUM(gt.amount_received),0) value
                   FROM grant_teams gt JOIN team_seasons ts ON ts.id=gt.team_season_id
                  WHERE gt.outcome='awarded' AND gt.received_date BETWEEN ? AND ?
                  GROUP BY ts.id, ts.team_name", 1],
            'funding_per_team:program' => [
                "SELECT p.id scope_id, p.name label, COALESCE(SUM(gt.amount_received),0) value
                   FROM grant_teams gt
                   JOIN team_seasons ts ON ts.id=gt.team_season_id
                   JOIN teams t ON t.id=ts.team_id
                   JOIN programs p ON p.id=t.program_id
                  WHERE gt.outcome='awarded' AND gt.received_date BETWEEN ? AND ?
                  GROUP BY p.id, p.name", 1],
            'team_expenses:team' => [
                "SELECT ts.id scope_id, ts.team_name label, COALESCE(SUM(te.amount),0) value
                   FROM team_adhoc_expenses te JOIN team_seasons ts ON ts.id=te.team_season_id
                  WHERE te.expense_date BETWEEN ? AND ? GROUP BY ts.id, ts.team_name", 1],
            'team_expenses:program' => [
                "SELECT p.id scope_id, p.name label, COALESCE(SUM(te.amount),0) value
                   FROM team_adhoc_expenses te
                   JOIN team_seasons ts ON ts.id=te.team_season_id
                   JOIN teams t ON t.id=ts.team_id
                   JOIN programs p ON p.id=t.program_id
                  WHERE te.expense_date BETWEEN ? AND ? GROUP BY p.id, p.name", 1],
            'funding_total:source_type' => [
                "SELECT src scope_id, src label, SUM(v) value FROM (
                    SELECT 'Grants' src, COALESCE(SUM(amount_received),0) v FROM grant_teams
                      WHERE outcome='awarded' AND received_date BETWEEN ? AND ?
                    UNION ALL SELECT 'Donations', COALESCE(SUM(received_amount),0) FROM inv_fundraising_donations
                      WHERE received_date BETWEEN ? AND ?
                    UNION ALL SELECT 'Payments', COALESCE(SUM(amount),0) FROM payments
                      WHERE status='paid' AND DATE(paid_at) BETWEEN ? AND ?
                 ) t GROUP BY src", 3],
        ];
    }

    /** Dimensions available for a metric, in display order. @return string[] */
    public static function dimsFor(string $metric): array
    {
        $dims = [];
        foreach (array_keys(self::queries()) as $k) {
            [$m, $dim] = explode(':', $k, 2);
            if ($m === $metric) $dims[] = $dim;
        }
        return $dims;
    }

    /**
     * @return array<int,array{period_key:string,period_start:string,scope_id:string,label:string,value:float}>
     */
    public function series(string $metric, string $dim, string $periodType, string $from, string $to): array
    {
        $entry = self::queries()["$metric:$dim"] ?? null;
        if (!$entry) return [];
        [$sql, $pairs] = $entry;

        $out = [];
        $cursor = $from;
        $guard = 0;
        while ($cursor <= $to && $guard++ < 5000) {
            [$start, $end, $pk] = MetricCapture::bucket($periodType, $cursor);
            $params = [];
            for ($i = 0; $i < $pairs; $i++) { $params[] = $start; $params[] = $end; }
            try {
                $st = $this->pdo->prepare($sql);
                $st->execute($params);
                foreach ($st->fetchAll() as $r) {
                    $out[] = [
                        'period_key' => $pk,
                        'period_start' => $start,
                        'scope_id' => (string)$r['scope_id'],
                        'label' => (string)($r['label'] ?? $r['scope_id']),
                        'value' => (float)$r['value'],
                    ];
                }
            } catch (\Throwable $e) { /* degrade to empty */ }
            $cursor = date('Y-m-d', strtotime($end . ' +1 day'));
        }
        return $out;
    }
}
