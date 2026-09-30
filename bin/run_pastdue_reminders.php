<?php
declare(strict_types=1);

/**
 * Weekly past-due membership payment reminder runner. Emails the parents/guardians of members who
 * still owe a membership balance and have NOT set up a payment plan — one email per family, listing
 * all of that family's owing youth. Skips anyone paid in full, on a payment plan, with a $0 balance,
 * or a payment override. Uses the admin-editable "past_due" email template. Throttled by
 * enrollments.pastdue_reminded_at so it won't double-send if run more than once in a week.
 *
 * Usage (Plesk cron, once a WEEK — e.g. Monday morning):
 *   php bin/run_pastdue_reminders.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Controllers\PaymentPlanController;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();
$r = PaymentPlanController::sendPastDueReminders($pdo);
fwrite(STDOUT, sprintf("[pastdue-reminders] families=%d sent=%d skipped=%d %s\n", $r['families'], $r['sent'], $r['skipped'], gmdate('c')));
