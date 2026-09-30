<?php
declare(strict_types=1);

namespace App\Core;

use App\Controllers\EmailSettingsController;
use PDO;

/**
 * Nightly auto-checkout (#157).
 *
 * Anyone left checked in when the day ends is closed out so they don't show as
 * perpetually present, and staff get ONE email listing who was closed and the details
 * of each check-in. No email is sent on a quiet night.
 *
 * Design choices worth knowing:
 *   - A stale check-in is closed at the END OF ITS OWN LOCAL DAY (23:59:59 local),
 *     not the moment the cron runs. A check-in started TODAY (someone who just
 *     arrived near midnight) is left alone.
 *   - We deliberately do NOT auto-log activity/volunteer hours for these. The system
 *     doesn't actually know how long the person stayed, and crediting a forgotten
 *     checkout's full span would inflate the compliance-sensitive time logs. The
 *     record is closed and flagged; an admin corrects the time if it matters.
 */
final class AutoCheckout
{
    private static function tz(): \DateTimeZone
    {
        return new \DateTimeZone(Config::get('APP_TIMEZONE', 'America/Chicago') ?: 'America/Chicago');
    }

    /** Start of "today" (local) as a UTC string, matching how check-ins are stored. */
    private static function localMidnightUtc(): string
    {
        $d = new \DateTime('now', self::tz());
        $d->setTime(0, 0, 0);
        $d->setTimezone(new \DateTimeZone('UTC'));
        return $d->format('Y-m-d H:i:s');
    }

    /** End of the local calendar day that a UTC datetime falls on, as a UTC string. */
    private static function endOfLocalDayUtc(string $utcDatetime): string
    {
        $d = new \DateTime($utcDatetime, new \DateTimeZone('UTC'));
        $d->setTimezone(self::tz());
        $d->setTime(23, 59, 59);
        $d->setTimezone(new \DateTimeZone('UTC'));
        return $d->format('Y-m-d H:i:s');
    }

    private static function localLabel(string $utcDatetime): string
    {
        $d = new \DateTime($utcDatetime, new \DateTimeZone('UTC'));
        $d->setTimezone(self::tz());
        return $d->format('D, M j Y g:i A');
    }

    private static function esc(?string $s): string
    {
        return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
    }

    /**
     * Close every check-in still open from a PRIOR local day, and return what was
     * done. Idempotent per run: a check-in only matches while time_out IS NULL.
     *
     * @return array{closed:list<array>,count:int}
     */
    public static function run(PDO $pdo): array
    {
        $cutoff = self::localMidnightUtc();
        $sel = $pdo->prepare(
            "SELECT c.*, m.first_name, m.last_name, m.member_type, e.name AS event_title
               FROM checkins c
               LEFT JOIN members m ON m.id = c.member_id
               LEFT JOIN events  e ON e.id = c.event_id
              WHERE c.time_out IS NULL AND c.time_in < ?
              ORDER BY c.time_in"
        );
        $sel->execute([$cutoff]);
        $open = $sel->fetchAll();

        $closed = [];
        foreach ($open as $ci) {
            $timeOut = self::endOfLocalDayUtc((string)$ci['time_in']);
            // Guard: never set a checkout before the check-in (only possible if the
            // clock/timezone is misconfigured). Fall back to the cutoff.
            if ($timeOut <= (string)$ci['time_in']) $timeOut = $cutoff;

            $pdo->prepare("UPDATE checkins SET time_out = ? WHERE id = ? AND time_out IS NULL")
                ->execute([$timeOut, (int)$ci['id']]);

            $mins = (int) round((strtotime($timeOut) - strtotime((string)$ci['time_in'])) / 60);
            $name = trim(($ci['first_name'] ?? '') . ' ' . ($ci['last_name'] ?? '')) ?: ('Member #' . (int)$ci['member_id']);
            if ($ci['member_id'] === null && !empty($ci['visitor_name'])) $name = (string)$ci['visitor_name'] . ' (visitor)';

            $closed[] = [
                'checkin_id' => (int)$ci['id'],
                'member_id' => $ci['member_id'] !== null ? (int)$ci['member_id'] : null,
                'name' => $name,
                'member_type' => $ci['member_type'] ?? null,
                'time_in' => (string)$ci['time_in'],
                'time_out' => $timeOut,
                'duration_min' => $mins,
                'kind' => $ci['event_id'] !== null ? 'event' : 'general',
                'event_title' => $ci['event_title'] ?? null,
                'activity_area' => $ci['activity_area'] ?? null,
            ];
            Audit::write($pdo, null, 'checkins', (int)$ci['id'], 'auto_checkout', null,
                ['time_out' => $timeOut, 'by' => 'nightly_cron']);
        }

        return ['closed' => $closed, 'count' => count($closed)];
    }

    /** Build [subject, html] for the report. Split out so it can be asserted on. */
    public static function composeEmail(array $result): array
    {
        $n = (int)($result['count'] ?? 0);
        $subject = 'TRC auto check-out — ' . $n . ' ' . ($n === 1 ? 'person' : 'people') . ' checked out overnight';

        $hoursMin = function (int $m): string {
            $h = intdiv($m, 60); $mm = $m % 60;
            return $h > 0 ? ($h . 'h ' . $mm . 'm') : ($mm . 'm');
        };

        $b = '<p>The nightly auto check-out closed ' . $n . ' check-in' . ($n === 1 ? '' : 's')
           . ' that '. ($n === 1 ? 'was' : 'were') . ' still open at the end of the day. '
           . 'Each was closed at the end of its own day — please review and correct any hours that look off.</p>'
           . '<table cellpadding="6" style="border-collapse:collapse;font-size:13px">'
           . '<tr style="text-align:left;color:#667">'
           . '<th>Who</th><th>Type</th><th>Checked in</th><th>Closed at</th><th>Duration</th></tr>';
        foreach ($result['closed'] ?? [] as $c) {
            $type = $c['kind'] === 'event'
                ? 'Event' . (!empty($c['event_title']) ? ' — ' . self::esc($c['event_title']) : '')
                : 'General TRC';
            $b .= '<tr>'
                . '<td>' . self::esc($c['name'])
                . (!empty($c['member_type']) ? ' <span style="color:#98a">(' . self::esc($c['member_type']) . ')</span>' : '')
                . '</td>'
                . '<td>' . $type . '</td>'
                . '<td>' . self::esc(self::localLabel($c['time_in'])) . '</td>'
                . '<td>' . self::esc(self::localLabel($c['time_out'])) . '</td>'
                . '<td>' . $hoursMin((int)$c['duration_min']) . '</td>'
                . '</tr>';
        }
        $b .= '</table>'
            . '<p style="color:#667;font-size:12px">No activity/volunteer time was logged for these — '
            . 'closing them just prevents a stuck "checked in" state. Adjust a record from its member\'s '
            . 'check-in history if the time needs correcting.</p>';

        return [$subject, $b];
    }

    /**
     * The whole nightly job: close stale check-ins, and email the report ONLY if any
     * were closed. Returns the result for logging. Never throws on a mail failure.
     *
     * @return array{count:int,emailed:bool,recipient:?string}
     */
    public static function runAndNotify(PDO $pdo): array
    {
        $result = self::run($pdo);
        if ($result['count'] === 0) {
            return ['count' => 0, 'emailed' => false, 'recipient' => null];
        }
        $to = EmailSettingsController::checkoutEmail($pdo);
        $emailed = false;
        if (Mailer::enabled() && $to !== '') {
            [$subject, $html] = self::composeEmail($result);
            try {
                $emailed = Mailer::send($to, $subject, Mailer::wrap('Auto Check-out', $html), strip_tags($html));
            } catch (\Throwable $e) {
                error_log('AutoCheckout email failed: ' . $e->getMessage());
            }
        }
        return ['count' => $result['count'], 'emailed' => $emailed, 'recipient' => $to];
    }
}
