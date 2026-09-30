<?php
declare(strict_types=1);

namespace App\Reports;

/**
 * Scheduling helpers for emailed reports. Next-run is computed in the server's
 * local time (the cron runs in America/Chicago on the host).
 */
final class ReportSchedule
{
    /**
     * Next run strictly after $fromTs for the given cadence.
     * @param int|null $fromTs epoch seconds (defaults to now)
     */
    public static function nextRun(string $cadence, ?int $dayOfWeek, ?int $dayOfMonth, int $hour, ?int $fromTs = null): int
    {
        $from = $fromTs ?? time();
        $hour = max(0, min(23, $hour));

        switch ($cadence) {
            case 'daily':
                $t = self::atHour($from, $hour);
                return $t > $from ? $t : strtotime('+1 day', $t);

            case 'monthly':
                $dom = max(1, min(28, $dayOfMonth ?? 1));
                $t = self::atHourDay($from, $dom, $hour);
                if ($t <= $from) {
                    $t = self::atHourDay(strtotime('first day of next month', $from), $dom, $hour);
                }
                return $t;

            case 'weekly':
            default:
                $dow = max(0, min(6, $dayOfWeek ?? 1));
                $curDow = (int)date('w', $from);
                $delta = ($dow - $curDow + 7) % 7;
                $t = self::atHour(strtotime("+$delta day", $from), $hour);
                return $t > $from ? $t : strtotime('+7 day', $t);
        }
    }

    private static function atHour(int $ts, int $hour): int
    {
        return (int)mktime($hour, 0, 0, (int)date('n', $ts), (int)date('j', $ts), (int)date('Y', $ts));
    }

    private static function atHourDay(int $ts, int $day, int $hour): int
    {
        return (int)mktime($hour, 0, 0, (int)date('n', $ts), $day, (int)date('Y', $ts));
    }

    public static function describe(array $s): string
    {
        $h = (int)($s['send_hour'] ?? 6);
        $time = date('g A', mktime($h, 0, 0));
        switch ($s['cadence'] ?? 'weekly') {
            case 'daily': return "Daily at $time";
            case 'monthly': return "Monthly on day " . (int)($s['day_of_month'] ?? 1) . " at $time";
            default:
                $days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                return "Weekly on " . ($days[(int)($s['day_of_week'] ?? 1)] ?? 'Mon') . " at $time";
        }
    }
}
