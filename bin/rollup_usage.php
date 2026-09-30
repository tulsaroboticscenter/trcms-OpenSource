<?php
declare(strict_types=1);

/**
 * Roll up the raw usage_events stream into per-member monthly summaries
 * (usage_monthly) for long-term adoption trending. Safe to re-run — it upserts.
 *
 * Usage:
 *   php bin/rollup_usage.php                 # roll up last month + current month
 *   php bin/rollup_usage.php --month=2026-06 # roll up a specific month
 *   php bin/rollup_usage.php --all           # roll up every month present
 */

use App\Analytics\UsageRollup;
use App\Core\Config;
use App\Core\Database;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$opts = getopt('', ['month::', 'all']);
$rollup = new UsageRollup(Database::pdo());

if (array_key_exists('all', $opts)) {
    $n = $rollup->rollupThrough(date('Y-m-d H:i:s', strtotime('+1 day')));
    fwrite(STDOUT, "Rolled up all months → $n member-month row(s).\n");
    exit(0);
}

if (!empty($opts['month'])) {
    $n = $rollup->rollupMonth((string)$opts['month']);
    fwrite(STDOUT, "Rolled up {$opts['month']} → $n member row(s).\n");
    exit(0);
}

// Default: current + previous month (covers a mid-month cron and the month boundary).
$cur = date('Y-m');
$prev = date('Y-m', strtotime('first day of last month'));
$a = $rollup->rollupMonth($prev);
$b = $rollup->rollupMonth($cur);
fwrite(STDOUT, "Rolled up $prev ($a rows) and $cur ($b rows).\n");
exit(0);
