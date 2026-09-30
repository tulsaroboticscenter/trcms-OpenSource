<?php
declare(strict_types=1);

/**
 * Compliance-renewal reminder runner. Emails mentors/adults (and an admin-team digest) when their
 * YPT or background check is coming due — at 60, 30, 14 and 1 day before expiry, and once when it
 * lapses. Each milestone fires exactly once per expiry cycle (deduped in compliance_reminder_log).
 *
 * Run DAILY (the 1-day and day-before milestones need a daily cadence):
 *   php bin/run_compliance_reminders.php
 */

use App\Core\Config;
use App\Core\Database;
use App\Core\ComplianceReminders;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$pdo = Database::pdo();

// `admin-digest` mode: email the admin team a snapshot of everyone currently due, WITHOUT
// emailing mentors or touching the dedup log (safe to run any time / to catch admins up).
if (($argv[1] ?? '') === 'admin-digest') {
    $r = ComplianceReminders::adminDigestNow($pdo);
    fwrite(STDOUT, sprintf("[compliance-reminders admin-digest] due=%d admin_digest=%d %s\n",
        $r['due'], $r['admin_digest'], gmdate('c')));
    exit(0);
}

$r = ComplianceReminders::run($pdo);
fwrite(STDOUT, sprintf(
    "[compliance-reminders] members=%d due=%d mentor_notices=%d admin_digest=%d %s\n",
    $r['members'], $r['due'], $r['mentor_notices'], $r['admin_digest'], gmdate('c')
));
