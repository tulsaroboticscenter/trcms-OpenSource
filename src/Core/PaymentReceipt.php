<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * The family's payment receipt.
 *
 * Every recorded payment produces one, whatever the method: a card payment through
 * Square/PayPal, a check or cash handed to the admin team, or a payment-plan
 * installment. Before this, a card payer only ever got the processor's own email and
 * a cash/check payer got nothing at all — no confirmation their money had landed.
 *
 * Routing follows the same rule as credentials (WelcomeEmail::recipientFor): a
 * youth's receipt goes to their guardian, copying the youth's own address when they
 * have a different one.
 */
final class PaymentReceipt
{
    /**
     * Who a receipt for this member would go to, without sending anything. Used by
     * the admin confirmation dialog so the address is shown BEFORE the payment is
     * recorded.
     *
     * @return array{to:?string,cc:?string,name:string,member_name:string}
     */
    public static function recipientFor(PDO $pdo, int $memberId): array
    {
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ?");
        $s->execute([$memberId]);
        $m = $s->fetch() ?: [];
        if (!$m) return ['to' => null, 'cc' => null, 'name' => '', 'member_name' => ''];
        [$to, $cc, $guardianName] = WelcomeEmail::recipientFor($m);
        // A youth with no email of their own and no free-text guardian1_email still often
        // has a parent linked as a family member. Fall back to that family's PRIMARY
        // guardian so a cash/check receipt has somewhere to go (#175).
        if (!$to && ($m['member_type'] ?? '') === 'youth') {
            $g = $pdo->prepare(
                "SELECT m2.first_name, m2.last_name, m2.email
                   FROM family_members fy
                   JOIN family_members fm ON fm.family_id = fy.family_id AND fm.member_id <> fy.member_id
                   JOIN members m2 ON m2.id = fm.member_id
                  WHERE fy.member_id = ? AND m2.member_type <> 'youth'
                    AND m2.email IS NOT NULL AND m2.email <> ''
                  ORDER BY fm.is_primary_contact DESC, m2.last_name, m2.first_name LIMIT 1");
            $g->execute([$memberId]);
            if ($row = $g->fetch()) {
                $to = $row['email'];
                $guardianName = $guardianName ?: trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? ''));
            }
        }
        $memberName = trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? ''));
        return [
            'to' => $to ?: null,
            'cc' => $cc ?: null,
            'name' => $guardianName ?: $memberName,
            'member_name' => $memberName,
        ];
    }

    private static function esc(?string $s): string
    {
        return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
    }

    private static function money(float $n): string
    {
        return '$' . number_format($n, 2);
    }

    /** Human label for a stored payment method. */
    private static function methodLabel(?string $method): string
    {
        $m = strtolower(trim((string)$method));
        return [
            'cash' => 'Cash', 'check' => 'Check', 'cheque' => 'Check',
            'cc' => 'Credit card', 'card' => 'Credit card',
            'square' => 'Credit card (Square)', 'paypal' => 'PayPal',
            'scholarship' => 'Scholarship', 'other' => 'Other',
        ][$m] ?? ($m !== '' ? ucfirst($m) : 'Payment');
    }

    /**
     * Send one receipt. Returns [sent, recipientEmail]; never throws, because a mail
     * failure must not undo or block a payment that has already been recorded.
     *
     * @param array $ctx {
     *   member_id:int, amount:float, method:?string, paid_on:?string,
     *   reference:?string, what:?string, balance:?float, recorded_by:?string
     * }
     * @return array{0:bool,1:?string}
     */
    public static function send(PDO $pdo, array $ctx): array
    {
        $memberId = (int)($ctx['member_id'] ?? 0);
        if ($memberId <= 0) return [false, null];

        // Resolve the recipient BEFORE checking whether mail is available, so the
        // caller can always report who the receipt was meant for — an admin needs to
        // know that a receipt is owed to a particular address when the mail server is
        // down, not just that "something failed".
        $r = self::recipientFor($pdo, $memberId);
        if (!$r['to']) return [false, null];
        if (!Mailer::enabled()) return [false, $r['to']];

        $amount = (float)($ctx['amount'] ?? 0);
        $paidOn = (string)($ctx['paid_on'] ?? date('Y-m-d'));
        $what = trim((string)($ctx['what'] ?? 'Registration'));
        $org = Config::get('ORG_NAME', 'Tulsa Robotics Center');

        $rows = [
            ['Paid for', $what . ($r['member_name'] !== '' ? ' — ' . $r['member_name'] : '')],
            ['Amount', self::money($amount)],
            ['Method', self::methodLabel($ctx['method'] ?? null)],
            ['Date', $paidOn],
        ];
        if (!empty($ctx['reference'])) $rows[] = ['Reference', (string)$ctx['reference']];
        if (isset($ctx['balance']) && $ctx['balance'] !== null) {
            $bal = round((float)$ctx['balance'], 2);
            $rows[] = ['Remaining balance', $bal > 0 ? self::money($bal) : 'Paid in full — thank you!'];
        }
        if (!empty($ctx['recorded_by'])) $rows[] = ['Recorded by', (string)$ctx['recorded_by']];

        $greeting = $r['name'] !== '' ? 'Hello ' . self::esc($r['name']) . ',' : 'Hello,';
        $body = '<p>' . $greeting . '</p>'
              . '<p>Thank you — we\'ve received your payment. Here are the details for your records.</p>'
              . '<table cellpadding="5" style="border-collapse:collapse">';
        foreach ($rows as [$k, $v]) {
            $body .= '<tr><td style="color:#667;padding-right:14px"><strong>' . self::esc($k) . '</strong></td>'
                   . '<td>' . self::esc((string)$v) . '</td></tr>';
        }
        $body .= '</table>'
               . '<p style="margin-top:14px">You can see this and any remaining balance any time by signing in to '
               . self::esc($org) . '.</p>'
               . '<p>If anything here looks wrong, please reply to this email or speak to the admin team.</p>';

        $subject = 'Payment received — ' . self::money($amount)
            . ($r['member_name'] !== '' ? ' for ' . $r['member_name'] : '');

        try {
            $sent = Mailer::send($r['to'], $subject, Mailer::wrap('Payment Receipt', $body),
                strip_tags($body), $r['cc']);
        } catch (\Throwable $e) {
            error_log('PaymentReceipt failed: ' . $e->getMessage());
            $sent = false;
        }
        return [(bool)$sent, $r['to']];
    }
}
