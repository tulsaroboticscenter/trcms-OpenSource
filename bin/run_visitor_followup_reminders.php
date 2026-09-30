<?php
declare(strict_types=1);

/**
 * Visitor follow-up reminder runner. Emails each follow-up owner about prospects that are due
 * today or overdue and haven't been reminded in the last few days, then stamps
 * follow_up_reminded_at so it isn't re-sent daily. Safe to run daily.
 *
 * Usage (Plesk cron, once a day — run on PHP 8.2+, not the system php):
 *   /opt/plesk/php/8.2/bin/php bin/run_visitor_followup_reminders.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Controllers\VisitorsController;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();
$r = VisitorsController::sendFollowupReminders($pdo);
fwrite(STDOUT, sprintf("[visitor-followup-reminders] sent=%d %s\n", $r['sent'], gmdate('c')));
