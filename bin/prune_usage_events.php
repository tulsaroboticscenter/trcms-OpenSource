<?php
declare(strict_types=1);

/**
 * Prune old usage_events rows. The in-app activity stream (page views +
 * heartbeats behind the User Activity report) grows continuously; this trims
 * anything older than the retention window so the table stays bounded. The
 * User Activity report defaults to the last 30 days, so a 12-month window keeps
 * plenty of history for longer look-backs.
 *
 * DRY RUN BY DEFAULT — reports how many rows would be removed. Pass --apply to
 * delete. Deletes in batches to avoid a single huge statement.
 *
 * Usage:
 *   php bin/prune_usage_events.php                 # preview (12-month default)
 *   php bin/prune_usage_events.php --apply         # delete
 *   php bin/prune_usage_events.php --months=6 --apply
 */

use App\Analytics\UsageRollup;
use App\Core\Config;
use App\Core\Database;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$opts = getopt('', ['apply', 'months::']);
$apply = array_key_exists('apply', $opts);
$months = max(1, (int)($opts['months'] ?? 12));

$pdo = Database::pdo();
$cutoff = date('Y-m-d H:i:s', strtotime("-$months months"));

$count = $pdo->prepare("SELECT COUNT(*) FROM usage_events WHERE created_at < ?");
$count->execute([$cutoff]);
$n = (int)$count->fetchColumn();

if ($n === 0) {
    fwrite(STDOUT, "No usage_events older than $months month(s) ($cutoff). Nothing to prune.\n");
    exit(0);
}

if (!$apply) {
    $months = (new UsageRollup($pdo))->monthsBefore($cutoff);
    fwrite(STDOUT, "Would delete $n usage_events row(s) older than $cutoff.\n");
    fwrite(STDOUT, "First they'd be summarized into usage_monthly for " . count($months) . " month(s): " . implode(', ', $months) . "\n");
    fwrite(STDOUT, "Re-run with --apply.\n");
    exit(0);
}

// Preserve long-term trends: roll each old month up into usage_monthly BEFORE
// deleting its raw events, so nothing is lost.
$rolled = (new UsageRollup($pdo))->rollupThrough($cutoff);
fwrite(STDOUT, "Summarized $rolled member-month row(s) into usage_monthly before pruning.\n");

$del = $pdo->prepare("DELETE FROM usage_events WHERE created_at < ? LIMIT 5000");
$removed = 0;
do {
    $del->execute([$cutoff]);
    $removed += $del->rowCount();
} while ($del->rowCount() > 0);

fwrite(STDOUT, "Pruned $removed usage_events row(s) older than $cutoff.\n");
exit(0);
