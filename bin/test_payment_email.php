<?php
declare(strict_types=1);

/**
 * Send a TEST "payment received" email to the configured payment-notification
 * address (Admin → Email Settings → Payment-received notifications; defaults to
 * info@tulsaroboticscenter.org).
 *
 * It runs the SAME code a real payment runs, so a delivered email proves the whole
 * chain — SMTP, the address, and the template. The email is clearly banner-marked
 * as a test so nobody mistakes it for real money.
 *
 * This does NOT touch Square/PayPal and creates no payment record.
 *
 * Usage (one-off; run it from Plesk's scheduled tasks with "Run Now", or a shell):
 *   php bin/test_payment_email.php
 */

use App\Controllers\PaymentsController;
use App\Core\Config;
use App\Core\Database;

require __DIR__ . '/../vendor/autoload.php';
Config::load(__DIR__ . '/..');

$r = PaymentsController::sendTestPaymentNotification(Database::pdo());

if ($r['sent']) {
    echo "Test payment notification sent to: {$r['to']}\n";
    echo "Check that inbox (and its spam folder the first time).\n";
    exit(0);
}
echo "NOT sent: {$r['reason']}\n";
exit(1);
