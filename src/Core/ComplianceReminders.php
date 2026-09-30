<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Compliance-renewal reminders (YPT + background check). Run DAILY from cron. For each active
 * mentor/adult subject to compliance, it emails a reminder at 60, 30, 14 and 1 day before an item
 * expires, and once when it lapses (overdue) — each milestone exactly once per expiry cycle
 * (deduped via compliance_reminder_log, migration 0236). The mentor is emailed directly, and the
 * admin team gets a single digest of everyone due that run. A renewal (new expiry) starts fresh.
 */
final class ComplianceReminders
{
    private const ITEMS = [
        'ypt'              => 'Youth Protection Training (YPT)',
        'background_check' => 'Background Check',
    ];

    public static function run(PDO $pdo): array
    {
        $today = date('Y-m-d');
        $members = $pdo->query(
            "SELECT id, first_name, last_name, email FROM members
              WHERE (" . ComplianceService::COMPLIANCE_REQUIRED_SQL . ") AND is_active = 1
                AND (is_archived = 0 OR is_archived IS NULL)"
        )->fetchAll();

        $seen = $pdo->prepare("SELECT 1 FROM compliance_reminder_log WHERE member_id=? AND item=? AND expires_date=? AND milestone=? LIMIT 1");
        $mark = $pdo->prepare("INSERT IGNORE INTO compliance_reminder_log (member_id,item,expires_date,milestone,sent_at) VALUES (?,?,?,?,NOW())");

        $mentorNotices = 0; $digest = [];
        foreach ($members as $m) {
            $status = ComplianceService::memberComplianceStatus($pdo, (int)$m['id']);
            $due = [];
            foreach (self::ITEMS as $key => $label) {
                $st = $status[$key] ?? null;
                if (!$st || empty($st['expires_date']) || $st['days_remaining'] === null) continue;
                $milestone = self::milestoneFor((int)$st['days_remaining']);
                if ($milestone === null) continue;                       // more than 60 days out
                $seen->execute([(int)$m['id'], $key, $st['expires_date'], $milestone]);
                if ($seen->fetchColumn()) continue;                      // already sent this milestone
                $mark->execute([(int)$m['id'], $key, $st['expires_date'], $milestone]);
                $due[] = ['label' => $label, 'expires' => $st['expires_date'], 'days' => (int)$st['days_remaining']];
            }
            if (!$due) continue;
            if (self::emailMentor($m, $due)) $mentorNotices++;
            $digest[] = ['name' => trim($m['first_name'] . ' ' . $m['last_name']), 'items' => $due];
        }

        $adminDigest = ($digest && self::emailAdmins($pdo, $digest, $today)) ? 1 : 0;
        return ['members' => count($members), 'due' => count($digest),
                'mentor_notices' => $mentorNotices, 'admin_digest' => $adminDigest];
    }

    /**
     * Send the admin team a digest of everyone CURRENTLY due (within 60 days or overdue), on
     * demand — without emailing mentors or touching the dedup log. Use to catch admins up (e.g.
     * after a failed run) or any time you want a "who's due now" snapshot.
     */
    public static function adminDigestNow(PDO $pdo): array
    {
        $today = date('Y-m-d');
        $members = $pdo->query(
            "SELECT id, first_name, last_name FROM members
              WHERE (" . ComplianceService::COMPLIANCE_REQUIRED_SQL . ") AND is_active = 1
                AND (is_archived = 0 OR is_archived IS NULL)"
        )->fetchAll();
        $digest = [];
        foreach ($members as $m) {
            $status = ComplianceService::memberComplianceStatus($pdo, (int)$m['id']);
            $due = [];
            foreach (self::ITEMS as $key => $label) {
                $st = $status[$key] ?? null;
                if (!$st || empty($st['expires_date']) || $st['days_remaining'] === null) continue;
                if (self::milestoneFor((int)$st['days_remaining']) === null) continue;   // >60 days out
                $due[] = ['label' => $label, 'expires' => $st['expires_date'], 'days' => (int)$st['days_remaining']];
            }
            if ($due) $digest[] = ['name' => trim($m['first_name'] . ' ' . $m['last_name']), 'items' => $due];
        }
        $sent = ($digest && self::emailAdmins($pdo, $digest, $today)) ? 1 : 0;
        return ['due' => count($digest), 'admin_digest' => $sent];
    }

    /** The reminder milestone for a given days-remaining, or null when more than 60 days out. */
    private static function milestoneFor(int $days): ?string
    {
        if ($days <= 0)  return 'overdue';   // expired or expires today
        if ($days <= 1)  return '1d';        // the day before
        if ($days <= 14) return '14d';
        if ($days <= 30) return '30d';
        if ($days <= 60) return '60d';
        return null;
    }

    private static function phrase(array $d): string
    {
        $when = $d['days'] < 0 ? 'expired ' . abs($d['days']) . ' day(s) ago'
              : ($d['days'] === 0 ? 'expires today' : "expires in {$d['days']} day(s)");
        return "{$d['label']} — {$when} ({$d['expires']})";
    }

    private static function emailMentor(array $m, array $due): bool
    {
        $to = trim((string)($m['email'] ?? ''));
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
        $overdue = false; $lines = '';
        foreach ($due as $d) { if ($d['days'] < 0) $overdue = true; $lines .= '<li>' . htmlspecialchars(self::phrase($d)) . '</li>'; }
        $body = '<p>Hi ' . htmlspecialchars((string)$m['first_name']) . ',</p>'
            . '<p>' . ($overdue
                ? 'One or more of your TRC compliance items has <strong>expired</strong> — you may be blocked from checking in until it is renewed.'
                : 'This is a reminder that your TRC compliance is coming due for renewal.') . '</p>'
            . '<ul>' . $lines . '</ul>'
            . '<p>Please complete the renewal and let a TRC admin know so your record can be updated. Thank you for helping keep our youth safe!</p>';
        return Mailer::send($to, 'Action needed: TRC compliance renewal', Mailer::wrap('Compliance renewal', $body));
    }

    private static function emailAdmins(PDO $pdo, array $digest, string $today): bool
    {
        $emails = $pdo->query(
            "SELECT DISTINCT m.email FROM members m
               JOIN member_system_roles msr ON msr.member_id = m.id
               JOIN system_roles sr ON sr.id = msr.role_id
              WHERE sr.name IN ('Admin','System Administrator') AND m.is_active = 1
                AND m.email IS NOT NULL AND m.email <> ''"
        )->fetchAll(PDO::FETCH_COLUMN);
        $emails = array_values(array_filter($emails, fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL)));
        if (!$emails) return false;
        $rows = '';
        foreach ($digest as $g) {
            $items = implode('; ', array_map([self::class, 'phrase'], $g['items']));
            $rows .= '<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">' . htmlspecialchars($g['name'])
                   . '</td><td style="padding:4px 10px;border-bottom:1px solid #eee">' . htmlspecialchars($items) . '</td></tr>';
        }
        $body = '<p>These mentors/adults have YPT or background-check renewals coming due (each was also emailed directly):</p>'
            . '<table style="border-collapse:collapse"><tr><th style="text-align:left;padding:4px 10px">Member</th>'
            . '<th style="text-align:left;padding:4px 10px">Items</th></tr>' . $rows . '</table>'
            . '<p style="color:#667;font-size:12px">Compliance reminder digest · ' . $today . '</p>';
        $to = array_shift($emails);
        // Mailer::send()'s $cc is a comma-separated string, not an array.
        return Mailer::send($to, 'TRC compliance renewals coming due', Mailer::wrap('Compliance digest', $body), null, $emails ? implode(',', $emails) : null);
    }
}
