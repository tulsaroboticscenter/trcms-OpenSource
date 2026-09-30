<?php
declare(strict_types=1);

namespace App\Core;

use App\Controllers\EmailSettingsController;
use PDO;

/**
 * Staff notification for a self-service visitor signup.
 *
 * Nobody is watching when a family converts themselves from the join link, so this
 * sends ONE email to the info address with the full record of what the system did:
 * accounts created, people matched to an existing account instead, visitor records
 * linked, data carried across, and whether each welcome email actually went out.
 *
 * One notice per signup, never one per person. Mirrors YouthContact::notify().
 */
final class SignupNotice
{
    /**
     * Destination, in order: the Signup Notice address from Admin → Email Settings,
     * then the new-visitor address, then INFO_EMAIL from .env, then info@…
     */
    public static function noticeEmail(PDO $pdo): string
    {
        $v = trim(EmailSettingsController::signupEmail($pdo));
        return $v !== '' ? $v : YouthContact::infoEmail();
    }

    private static function esc(?string $s): string
    {
        return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
    }

    /**
     * @param array $ctx {
     *   guardian_name, guardian_email, ip, submitted_at,
     *   created:  [['member_id'=>int,'name'=>string,'type'=>string]],
     *   existing: [['name'=>string,'type'=>string]],
     *   visitors: [['visitor_id'=>int,'name'=>string,'member_id'=>int,'action'=>string,
     *               'program'=>?string,'night_pref'=>bool,'waitlist'=>bool]],
     *   emails:   [['name'=>string,'sent'=>bool,'to'=>?string]],
     *   onboarding_emails: [['template'=>string,'template_found'=>bool,'sent'=>bool,
     *                        'to'=>?string,'cc'=>?string,'about'=>string,'error'=>?string]],
     * }
     */
    public static function send(PDO $pdo, array $ctx): void
    {
        if (!Mailer::enabled()) return;
        [$subject, $html] = self::compose($pdo, $ctx);
        try {
            Mailer::send(self::noticeEmail($pdo), $subject, Mailer::wrap('Visitor signup', $html), strip_tags($html));
        } catch (\Throwable $e) {
            // A staff notification must never break the family's signup.
        }
    }

    /** Builds [subject, html]. Split out from send() so it can be asserted on directly. */
    public static function compose(PDO $pdo, array $ctx): array
    {

        $created = $ctx['created'] ?? [];
        $existing = $ctx['existing'] ?? [];
        $visitors = $ctx['visitors'] ?? [];
        $emails = $ctx['emails'] ?? [];
        $emailBy = [];
        foreach ($emails as $e) $emailBy[$e['name']] = $e;

        $who = trim((string)($ctx['guardian_name'] ?? '')) ?: 'Someone';
        $n = count($created);
        $subject = 'Visitor signup — ' . $who
            . ($n > 0 ? " ($n new account" . ($n === 1 ? '' : 's') . ')' : ' (no new accounts)');

        $b = '<p>A visitor completed the self-service join link. Here is everything the system changed.</p>';

        $b .= '<p><strong>Submitted by:</strong> ' . self::esc($who);
        if (!empty($ctx['guardian_email'])) $b .= ' &lt;' . self::esc($ctx['guardian_email']) . '&gt;';
        $b .= '<br><strong>When:</strong> ' . self::esc($ctx['submitted_at'] ?? date('Y-m-d H:i:s'));
        if (!empty($ctx['ip'])) $b .= '<br><strong>From IP:</strong> ' . self::esc($ctx['ip']);
        $b .= '</p>';

        // Accounts created — with the credentials destination, so staff can see where
        // the welcome email actually went (youth logins go to the guardian).
        if ($created) {
            $b .= '<p><strong>Accounts created</strong></p><ul>';
            foreach ($created as $c) {
                $m = $pdo->prepare("SELECT member_number, username, member_type FROM members WHERE id = ?");
                $m->execute([(int)$c['member_id']]);
                $row = $m->fetch() ?: [];
                $mail = $emailBy[$c['name']] ?? null;
                $b .= '<li>' . self::esc($c['name'])
                    . ' — ' . self::esc($row['member_type'] ?? $c['type'])
                    . ', member #' . self::esc($row['member_number'] ?? '?')
                    . ', username <code>' . self::esc($row['username'] ?? '?') . '</code>'
                    . ' (member id ' . (int)$c['member_id'] . ')';
                if ($mail) {
                    $b .= $mail['sent']
                        ? '<br>Welcome email sent to ' . self::esc($mail['to'])
                        : '<br><strong style="color:#b00">Welcome email FAILED</strong> — resend from their member page.';
                }
                $b .= '</li>';
            }
            $b .= '</ul>';
        } else {
            $b .= '<p><strong>No new accounts were created.</strong></p>';
        }

        // Matched instead of created — the duplicate guard doing its job.
        if ($existing) {
            $b .= '<p><strong>Already had an account (linked, not duplicated)</strong></p><ul>';
            foreach ($existing as $e) {
                $b .= '<li>' . self::esc($e['name']) . ' — ' . self::esc($e['type'])
                    . '. No account created and no welcome email sent; their existing login still works.</li>';
            }
            $b .= '</ul>';
        }

        // The visitor-record bookkeeping.
        if ($visitors) {
            $b .= '<p><strong>Visitor records updated</strong></p><ul>';
            foreach ($visitors as $v) {
                $b .= '<li>' . self::esc($v['name']) . ' (visitor id ' . (int)$v['visitor_id'] . ') — '
                    . 'status set to <code>enrolled</code>, linked to member id ' . (int)$v['member_id']
                    . ($v['action'] === 'matched' ? ' <em>(existing account)</em>' : '');
                $extra = [];
                if (!empty($v['program'])) $extra[] = 'program interest set to ' . self::esc((string)$v['program']);
                if (!empty($v['night_pref'])) $extra[] = 'night preference carried over';
                if (!empty($v['waitlist'])) $extra[] = 'waitlist entry moved to the member';
                if ($extra) $b .= '<br>' . implode('; ', $extra);
                $b .= '</li>';
            }
            $b .= '</ul>';
        }

        // The household -- what makes the parent able to act for their youth.
        if (!empty($ctx['family'])) {
            $f = $ctx['family'];
            $b .= '<p><strong>Family</strong><br>'
                . ($f['created'] ? 'Created ' : 'Added to the existing ')
                . '&ldquo;' . self::esc((string)$f['family_name']) . '&rdquo;'
                . ' (family id ' . (int)$f['family_id'] . ') &mdash; the parent is tagged Parent and each youth Child,'
                . ' so the parent can open their youth&rsquo;s record and pay the registration.</p>';
        }

        // Enrollments -- what the family now owes, and why.
        if (!empty($ctx['enrollments'])) {
            $b .= '<p><strong>Enrollments created</strong> (status <code>pending</code> until T&amp;C, shirt size and payment are done)</p><ul>';
            $total = 0.0;
            foreach ($ctx['enrollments'] as $en) {
                $total += (float)$en['amount_due'];
                $tier = ((int)$en['sibling_rank']) === 1 ? 'first youth'
                    : (((int)$en['sibling_rank']) === 2 ? '2nd-youth rate' : '3rd+-youth rate');
                $b .= '<li>' . self::esc($en['name']) . ' &mdash; ' . self::esc((string)$en['program'])
                    . ', $' . number_format((float)$en['amount_due'], 2) . ' (' . $tier . ')</li>';
            }
            $b .= '</ul><p><strong>Total due: $' . number_format($total, 2) . '</strong></p>';
        }

        // Onboarding template emails (FTC/FRC): the welcome-per-youth and the parent
        // introduction meeting. Shows where each went, or flags a misnamed/inactive
        // template so staff can fix the name in Communications.
        $onboarding = $ctx['onboarding_emails'] ?? [];
        if ($onboarding) {
            $b .= '<p><strong>Onboarding emails (FTC/FRC)</strong></p><ul>';
            foreach ($onboarding as $o) {
                $tpl = self::esc((string)($o['template'] ?? 'template'));
                $about = self::esc((string)($o['about'] ?? ''));
                if (empty($o['template_found'])) {
                    $b .= '<li style="color:#b00"><strong>&ldquo;' . $tpl . '&rdquo; not found or inactive</strong> — '
                        . 'nothing sent for ' . $about . '. Check the template name in Communications &rarr; Email Templates.</li>';
                    continue;
                }
                if (!empty($o['sent'])) {
                    $cc = !empty($o['cc']) ? ' (cc ' . self::esc((string)$o['cc']) . ')' : '';
                    $b .= '<li>&ldquo;' . $tpl . '&rdquo; for ' . $about . ' — sent to '
                        . self::esc((string)($o['to'] ?? '')) . $cc . '</li>';
                } else {
                    $b .= '<li style="color:#b00">&ldquo;' . $tpl . '&rdquo; for ' . $about . ' — '
                        . '<strong>NOT sent</strong>' . (!empty($o['error']) ? ' (' . self::esc((string)$o['error']) . ')' : '')
                        . (!empty($o['to']) ? ', intended for ' . self::esc((string)$o['to']) : '') . '</li>';
                }
            }
            $b .= '</ul>';
        }

        $failed = array_values(array_filter($emails, fn ($e) => empty($e['sent'])));
        if ($failed) {
            $b .= '<p style="color:#b00"><strong>Action needed:</strong> '
                . self::esc(implode(', ', array_column($failed, 'name')))
                . ' did not receive login details. Use <em>Send Welcome Email</em> on their member page.</p>';
        }

        $b .= '<p style="color:#667;font-size:12px">Every change above is also in the audit log '
            . '(table <code>visitors</code>, action <code>self_signup</code> / <code>self_signup_matched</code>).</p>';

        return [$subject, $b];
    }
}
