<?php
declare(strict_types=1);

/**
 * On-demand admin digest of compliance renewals currently due (within 60 days or overdue).
 * Emails the admin team ONLY — no mentor emails, no changes to the reminder dedup log — so it's
 * safe to run any time (e.g. to catch admins up after a failed run, or for a "who's due now" snapshot).
 *
 * A separate, argument-free script so it works with Plesk's "PHP script" task type (which can't
 * pass CLI arguments). The daily reminder cron is still bin/run_compliance_reminders.php.
 *
 *   php bin/run_compliance_admin_digest.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Core\ComplianceReminders;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();
$r = ComplianceReminders::adminDigestNow($pdo);
fwrite(STDOUT, sprintf("[compliance-admin-digest] due=%d admin_digest=%d %s\n",
    $r['due'], $r['admin_digest'], gmdate('c')));
