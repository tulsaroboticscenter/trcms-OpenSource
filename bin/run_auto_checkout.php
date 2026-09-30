<?php
declare(strict_types=1);

/**
 * Nightly auto check-out (#157). Closes any check-in still open from a prior local
 * day, and emails a report ONLY if at least one person was checked out. Nothing is
 * sent on a quiet night.
 *
 * Usage (Plesk cron, once a day just after midnight, e.g. 00:05 org-local):
 *   php bin/run_auto_checkout.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Core\AutoCheckout;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();
$r = AutoCheckout::runAndNotify($pdo);
fwrite(STDOUT, sprintf(
    "[auto-checkout] closed=%d emailed=%s recipient=%s %s\n",
    $r['count'], $r['emailed'] ? 'yes' : 'no', $r['recipient'] ?? '-', gmdate('c')
));
