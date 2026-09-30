<?php
declare(strict_types=1);

/**
 * FDP reminder runner. Emails a youth + their family when they have an interview or a
 * board of review coming up within ~2 days that hasn't been reminded recently, then
 * stamps reminded_at so it isn't re-sent. Safe to run daily.
 *
 * Usage (Plesk cron, once a day):
 *   php bin/run_fdp_reminders.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Controllers\FdpController;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();
$r = FdpController::sendReminders($pdo);
fwrite(STDOUT, sprintf("[fdp-reminders] sent=%d %s\n", $r['sent'], gmdate('c')));
