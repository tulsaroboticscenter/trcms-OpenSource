<?php
declare(strict_types=1);

/**
 * Enrollment payment-plan reminder runner. Emails families when an installment is
 * due within 7 days or overdue and hasn't been reminded in ~20 days, then stamps
 * reminded_at so it isn't re-sent. Safe to run daily.
 *
 * Usage (Plesk cron, once a day):
 *   php bin/run_payment_reminders.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Controllers\PaymentPlanController;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();
$r = PaymentPlanController::sendDueReminders($pdo);
fwrite(STDOUT, sprintf("[payment-reminders] sent=%d skipped=%d %s\n", $r['sent'], $r['skipped'], gmdate('c')));
