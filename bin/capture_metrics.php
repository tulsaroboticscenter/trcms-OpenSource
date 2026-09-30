<?php
declare(strict_types=1);

/**
 * Metric capture CLI — freezes trend metrics into metric_snapshots.
 *
 * Usage:
 *   php bin/capture_metrics.php                      # capture current month
 *   php bin/capture_metrics.php --period=week        # current week (Sun-Sat)
 *   php bin/capture_metrics.php --period=year        # current year
 *   php bin/capture_metrics.php --date=2026-06-15    # bucket containing a date
 *   php bin/capture_metrics.php --backfill=member_hours --period=month \
 *        --from=2024-01-01 --to=2026-06-30           # recompute one metric over a range
 *
 * Schedule (Plesk cron), e.g. nightly at 02:15:
 *   php /var/www/vhosts/.../httpdocs/bin/capture_metrics.php --period=month
 *   php /var/www/vhosts/.../httpdocs/bin/capture_metrics.php --period=year
 */

use App\Analytics\MetricCapture;
use App\Core\Config;
use App\Core\Database;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$opts = getopt('', ['period::', 'date::', 'backfill::', 'from::', 'to::']);
$period = $opts['period'] ?? 'month';
$onDate = $opts['date'] ?? date('Y-m-d');

$cap = new MetricCapture(Database::pdo());

if (!empty($opts['backfill'])) {
    $from = $opts['from'] ?? null;
    $to = $opts['to'] ?? date('Y-m-d');
    if (!$from) {
        fwrite(STDERR, "--backfill requires --from=YYYY-MM-DD\n");
        exit(2);
    }
    $n = $cap->backfill((string)$opts['backfill'], $period, $from, $to);
    fwrite(STDOUT, sprintf("Backfilled %s (%s) %s..%s → %d rows\n", $opts['backfill'], $period, $from, $to, $n));
    exit(0);
}

$res = $cap->run($period, $onDate);
fwrite(STDOUT, sprintf("Captured %d metric rows for %s bucket of %s.\n", $res['captured'], $period, $onDate));
if (!empty($res['skipped'])) {
    fwrite(STDOUT, "Skipped:\n");
    foreach ($res['skipped'] as $k => $why) {
        fwrite(STDOUT, "  - $k: $why\n");
    }
}
exit(0);
