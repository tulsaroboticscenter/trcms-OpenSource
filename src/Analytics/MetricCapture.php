<?php
declare(strict_types=1);

namespace App\Analytics;

use PDO;

/**
 * MetricCapture — computes trend metrics for a period bucket and upserts them
 * into metric_snapshots. Run on a schedule (nightly/weekly) so point-in-time
 * state (inventory value, active headcount, waitlist) builds permanent history.
 *
 * Event-derived metrics are also captured for the CURRENT bucket so the Trends
 * UI can read every metric uniformly from metric_snapshots; past event buckets
 * can be recomputed live or backfilled via backfill().
 *
 * Each metric compute returns rows of [scope_type, scope_id, value]. A failure
 * in one metric (missing column, etc.) is logged and skipped so it can't abort
 * the whole run.
 */
final class MetricCapture
{
    public function __construct(private PDO $pdo) {}

    /**
     * Capture every registered metric for the bucket containing $onDate.
     * @return array{captured:int,skipped:array<string,string>}
     */
    public function run(string $periodType = 'month', ?string $onDate = null): array
    {
        $onDate ??= date('Y-m-d');
        [$start, $end, $key] = self::bucket($periodType, $onDate);
        $capturedAt = date('Y-m-d H:i:s');
        $captured = 0;
        $skipped = [];

        foreach (array_keys(MetricsRegistry::all()) as $metricKey) {
            $method = 'compute_' . $metricKey;
            if (!method_exists($this, $method)) {
                continue; // not yet implemented — declared in registry only
            }
            try {
                /** @var array<int,array{0:string,1:string,2:float|int}> $rows */
                $rows = $this->$method($start, $end);
                foreach ($rows as $r) {
                    $this->upsert($metricKey, $periodType, $key, $start, (string)$r[0], (string)$r[1], (float)$r[2], $capturedAt);
                    $captured++;
                }
            } catch (\Throwable $e) {
                $skipped[$metricKey] = $e->getMessage();
            }
        }
        return ['captured' => $captured, 'skipped' => $skipped];
    }

    /**
     * Compute a metric live across every bucket in a range WITHOUT writing.
     * Used by the Trends API to render event-derived series accurately even
     * before the capture job has frozen them.
     * @return array<int,array{period_key:string,period_start:string,scope_type:string,scope_id:string,value:float}>
     */
    public function computeLive(string $metricKey, string $periodType, string $fromDate, string $toDate): array
    {
        $method = 'compute_' . $metricKey;
        if (!method_exists($this, $method)) {
            return [];
        }
        $out = [];
        $cursor = $fromDate;
        $guard = 0;
        while ($cursor <= $toDate && $guard++ < 5000) {
            [$start, $end, $key] = self::bucket($periodType, $cursor);
            try {
                foreach ($this->$method($start, $end) as $r) {
                    $out[] = [
                        'period_key' => $key,
                        'period_start' => $start,
                        'scope_type' => (string)$r[0],
                        'scope_id' => (string)$r[1],
                        'value' => (float)$r[2],
                    ];
                }
            } catch (\Throwable $e) {
                // A metric with a schema mismatch degrades to no data, never a 500.
            }
            $cursor = date('Y-m-d', strtotime($end . ' +1 day'));
        }
        return $out;
    }

    /** Recompute an event-derived metric across a run of past buckets. */
    public function backfill(string $metricKey, string $periodType, string $fromDate, string $toDate): int
    {
        $method = 'compute_' . $metricKey;
        if (!method_exists($this, $method)) {
            throw new \InvalidArgumentException("No compute for metric '$metricKey'.");
        }
        $capturedAt = date('Y-m-d H:i:s');
        $cursor = $fromDate;
        $n = 0;
        $guard = 0;
        while ($cursor <= $toDate && $guard++ < 5000) {
            [$start, $end, $key] = self::bucket($periodType, $cursor);
            foreach ($this->$method($start, $end) as $r) {
                $this->upsert($metricKey, $periodType, $key, $start, (string)$r[0], (string)$r[1], (float)$r[2], $capturedAt);
                $n++;
            }
            $cursor = date('Y-m-d', strtotime($end . ' +1 day'));
        }
        return $n;
    }

    // ---- period bucketing -------------------------------------------------

    /** @return array{0:string,1:string,2:string} [startDate, endDate, periodKey] */
    public static function bucket(string $type, string $onDate): array
    {
        $t = strtotime($onDate);
        switch ($type) {
            case 'day':
                return [date('Y-m-d', $t), date('Y-m-d', $t), date('Y-m-d', $t)];
            case 'week': // week starts Sunday (matches app convention)
                $dow = (int)date('w', $t);
                $start = strtotime("-$dow day", $t);
                return [date('Y-m-d', $start), date('Y-m-d', strtotime('+6 day', $start)), date('Y-\WW', $start)];
            case 'quarter':
                $m = (int)date('n', $t);
                $q = (int)floor(($m - 1) / 3);
                $sm = $q * 3 + 1;
                $y = (int)date('Y', $t);
                $start = sprintf('%04d-%02d-01', $y, $sm);
                $end = date('Y-m-t', strtotime(sprintf('%04d-%02d-01', $y, $sm + 2)));
                return [$start, $end, sprintf('%04d-Q%d', $y, $q + 1)];
            case 'year':
                $y = date('Y', $t);
                return ["$y-01-01", "$y-12-31", $y];
            case 'month':
            default:
                return [date('Y-m-01', $t), date('Y-m-t', $t), date('Y-m', $t)];
        }
    }

    private function upsert(string $metricKey, string $periodType, string $periodKey, string $periodStart, string $scopeType, string $scopeId, float $value, string $capturedAt): void
    {
        $sql = "INSERT INTO metric_snapshots
                  (metric_key, period_type, period_key, period_start, scope_type, scope_id, value, captured_at)
                VALUES (?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE value = VALUES(value), captured_at = VALUES(captured_at)";
        $this->pdo->prepare($sql)->execute(
            [$metricKey, $periodType, $periodKey, $periodStart, $scopeType, $scopeId, $value, $capturedAt]
        );
    }

    private function scalar(string $sql, array $params = []): float
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false || $v === null ? 0.0 : (float)$v;
    }

    /** @return array<int,array{0:string,1:string,2:float}> */
    private function grouped(string $sql, array $params, string $scopeType): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        $out = [];
        foreach ($st->fetchAll() as $row) {
            $out[] = [$scopeType, (string)($row['scope_id'] ?? ''), (float)($row['value'] ?? 0)];
        }
        return $out;
    }

    private function g(float $v): array { return [['global', '', $v]]; }

    // ---- Membership (snapshot = as-of now; event = within bucket) ---------

    private function compute_active_youth(string $s, string $e): array
    {
        return $this->g($this->scalar("SELECT COUNT(*) FROM members WHERE member_type='youth' AND is_archived=0"));
    }
    private function compute_active_mentors(string $s, string $e): array
    {
        return $this->g($this->scalar("SELECT COUNT(*) FROM members WHERE member_type='mentor' AND is_archived=0"));
    }
    private function compute_total_members(string $s, string $e): array
    {
        return $this->g($this->scalar("SELECT COUNT(*) FROM members WHERE is_archived=0"));
    }
    private function compute_alumni_total(string $s, string $e): array
    {
        return $this->g($this->scalar("SELECT COUNT(*) FROM members WHERE is_alumni=1"));
    }
    private function compute_new_joins(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM members WHERE date_joined BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_departures(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM members WHERE archived_at IS NOT NULL AND DATE(archived_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Certifications ---------------------------------------------------

    private function compute_certs_added(string $s, string $e): array
    {
        // Certifications recorded FOR MEMBERS in the period (by entry date). Previously this
        // counted rows added to the certification *catalog* (cert types), which is an admin
        // action almost nobody means by "certifications added" — so it read as 0 even while
        // members were being awarded certs. See also certs_completed (by completion date).
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM member_certifications WHERE DATE(created_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_certs_completed(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM member_certifications WHERE completed_date BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Engagement -------------------------------------------------------

    private function compute_member_hours(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(minutes),0)/60 FROM time_entries WHERE entry_date BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_mentor_hours(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(t.minutes),0)/60 FROM time_entries t
               JOIN members m ON m.id=t.member_id
              WHERE m.member_type='mentor' AND t.entry_date BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Events -----------------------------------------------------------

    private function compute_events_held(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM events WHERE event_date BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_event_attendance(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM checkins WHERE event_id IS NOT NULL AND DATE(time_in) BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Recruitment ------------------------------------------------------

    private function compute_visitors(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM visitors WHERE DATE(inquiry_date) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_waitlist_size(string $s, string $e): array
    {
        return $this->g($this->scalar("SELECT COUNT(*) FROM waitlist_entries WHERE status='waiting'"));
    }

    // ---- Inventory & assets (snapshot) ------------------------------------

    private function compute_inventory_value(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(current_quantity * COALESCE(cost,0)),0) FROM inv_items"
        ));
    }
    private function compute_asset_value(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(current_quantity * COALESCE(cost,0)),0)
               FROM inv_items WHERE item_type IN ('asset_tagged','asset_nontagged')"
        ));
    }
    private function compute_repair_volume(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM repair_tickets WHERE DATE(created_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_repair_cost(string $s, string $e): array
    {
        $labor = $this->scalar(
            "SELECT COALESCE(SUM(repair_cost),0) FROM repair_tickets WHERE DATE(created_at) BETWEEN ? AND ?", [$s, $e]
        );
        $parts = $this->scalar(
            "SELECT COALESCE(SUM(p.quantity * COALESCE(p.unit_cost,0)),0)
               FROM repair_parts p JOIN repair_tickets t ON t.id=p.ticket_id
              WHERE DATE(t.created_at) BETWEEN ? AND ?", [$s, $e]
        );
        return $this->g($labor + $parts);
    }

    // ---- Money in ---------------------------------------------------------

    private function compute_donations_total(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(received_amount),0) FROM inv_fundraising_donations WHERE received_date BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_donation_count(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM inv_fundraising_donations WHERE received_date BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_grants_awarded(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(amount_received),0) FROM grant_teams
              WHERE outcome='awarded' AND received_date BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_payments_collected(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid' AND DATE(paid_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_funding_total(string $s, string $e): array
    {
        $don = $this->scalar("SELECT COALESCE(SUM(received_amount),0) FROM inv_fundraising_donations WHERE received_date BETWEEN ? AND ?", [$s, $e]);
        $grant = $this->scalar("SELECT COALESCE(SUM(amount_received),0) FROM grant_teams WHERE outcome='awarded' AND received_date BETWEEN ? AND ?", [$s, $e]);
        $pay = $this->scalar("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid' AND DATE(paid_at) BETWEEN ? AND ?", [$s, $e]);
        return $this->g($don + $grant + $pay);
    }
    private function compute_funding_per_team(string $s, string $e): array
    {
        return $this->grouped(
            "SELECT team_season_id AS scope_id, COALESCE(SUM(amount_received),0) AS value
               FROM grant_teams
              WHERE outcome='awarded' AND received_date BETWEEN ? AND ? AND team_season_id IS NOT NULL
              GROUP BY team_season_id", [$s, $e], 'team'
        );
    }
    private function compute_team_expenses(string $s, string $e): array
    {
        return $this->grouped(
            "SELECT team_season_id AS scope_id, COALESCE(SUM(amount),0) AS value
               FROM team_adhoc_expenses
              WHERE expense_date BETWEEN ? AND ? AND team_season_id IS NOT NULL
              GROUP BY team_season_id", [$s, $e], 'team'
        );
    }

    // ---- Operations -------------------------------------------------------

    private function compute_reservations_volume(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM reservations WHERE DATE(created_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_feedback_opened(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM feedback WHERE DATE(created_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_repair_backlog(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM repair_tickets WHERE status NOT IN ('resolved','closed','cancelled','done')"
        ));
    }

    // ---- Certifications (rates + badges) ----------------------------------

    private function compute_badges_earned(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM cert_member_badges WHERE earned_date BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_cert_completion_rate(string $s, string $e): array
    {
        $total = $this->scalar("SELECT COUNT(*) FROM member_certifications");
        if ($total <= 0) return $this->g(0.0);
        $done = $this->scalar("SELECT COUNT(*) FROM member_certifications WHERE completed_date IS NOT NULL");
        return $this->g(round($done * 100 / $total, 1));
    }

    // ---- Engagement (attendance + outreach) -------------------------------

    private function compute_attendance_rate(string $s, string $e): array
    {
        $active = $this->scalar("SELECT COUNT(*) FROM members WHERE member_type='youth' AND is_archived=0");
        if ($active <= 0) return $this->g(0.0);
        $present = $this->scalar(
            "SELECT COUNT(DISTINCT member_id) FROM checkins WHERE DATE(time_in) BETWEEN ? AND ?", [$s, $e]
        );
        return $this->g(round($present * 100 / $active, 1));
    }
    private function compute_outreach_hours(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(minutes),0)/60 FROM time_entries
              WHERE entry_date BETWEEN ? AND ?
                AND (area LIKE '%outreach%' OR area LIKE '%community%' OR area LIKE '%service%' OR area LIKE '%volunteer%')",
            [$s, $e]
        ));
    }

    // ---- Recruitment (funnel + pipeline) ----------------------------------

    private function compute_funnel_conversion(string $s, string $e): array
    {
        $vis = $this->scalar("SELECT COUNT(*) FROM visitors WHERE DATE(inquiry_date) BETWEEN ? AND ?", [$s, $e]);
        if ($vis <= 0) return $this->g(0.0);
        $enr = $this->scalar("SELECT COUNT(*) FROM enrollments WHERE date_enrolled BETWEEN ? AND ?", [$s, $e]);
        return $this->g(round($enr * 100 / $vis, 1));
    }
    private function compute_mentor_pipeline(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM mentor_prospects WHERE stage IN ('interested','contacted','onboarding')"
        ));
    }

    // ---- Inventory (assets + checkouts) -----------------------------------

    private function compute_assets_acquired(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM inv_items
              WHERE item_type IN ('asset_tagged','asset_nontagged')
                AND COALESCE(purchase_date, DATE(created_at)) BETWEEN ? AND ?", [$s, $e]
        ));
    }
    private function compute_checkout_volume(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM inv_checkouts WHERE DATE(checkout_date) BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Money in (sponsors + scholarships) -------------------------------

    private function compute_sponsors_active(string $s, string $e): array
    {
        return $this->g($this->scalar("SELECT COUNT(*) FROM sponsors WHERE lifecycle_state='active'"));
    }
    private function compute_scholarships_awarded(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(amount_awarded),0) FROM college_scholarship_applications
              WHERE status IN ('granted','partial') AND decision_date BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Money out --------------------------------------------------------

    private function compute_total_spend(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COALESCE(SUM(amount),0) FROM team_adhoc_expenses WHERE expense_date BETWEEN ? AND ?", [$s, $e]
        ));
    }

    // ---- Alumni -----------------------------------------------------------

    private function compute_hof_inductions(string $s, string $e): array
    {
        return $this->g($this->scalar(
            "SELECT COUNT(*) FROM hof_members WHERE DATE(created_at) BETWEEN ? AND ?", [$s, $e]
        ));
    }
}
