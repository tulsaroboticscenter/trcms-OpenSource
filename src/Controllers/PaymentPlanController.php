<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Enrollment payment plans (Release 3.13). An admin splits an enrollment's amount
 * due — minus any scholarship credit — into monthly installments the family pays by
 * CC, check, or cash. The scholarship reduces the total; the REMAINING balance is
 * divided into equal monthly installments (first due the 1st of next month).
 */
final class PaymentPlanController
{
    private const INSTALLMENTS = 4;

    /** Staff (Admin / System Administrator / Mentor) or an enrollment-payments manager. */
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && (Permissions::hasAnyRole($pdo, $m, ['Admin', 'System Administrator', 'Mentor'])
            || Permissions::memberCan($pdo, $m, 'enrollment.payments', 'write'));
    }

    /** The viewer can see a plan if they're staff, the member, or the member's parent. */
    private static function canView(PDO $pdo, array $cur, int $enrollmentId): bool
    {
        if (self::canManage($pdo, $cur)) return true;
        $s = $pdo->prepare("SELECT member_id FROM enrollments WHERE id = ?");
        $s->execute([$enrollmentId]);
        $mid = (int)($s->fetchColumn() ?: 0);
        if ($mid === (int)$cur['id']) return true;
        $f = $pdo->prepare(
            "SELECT 1 FROM family_members a JOIN family_members b ON a.family_id = b.family_id
              WHERE a.member_id = ? AND b.member_id = ? LIMIT 1");
        $f->execute([(int)$cur['id'], $mid]);
        return (bool)$f->fetchColumn();
    }

    /** Recompute the enrollment's paid total = scholarship + paid installments, and status. */
    public static function reconcileEnrollment(PDO $pdo, int $enrollmentId): void
    {
        $e = $pdo->prepare("SELECT amount_due, scholarship_amount, status FROM enrollments WHERE id = ?");
        $e->execute([$enrollmentId]);
        $enr = $e->fetch();
        if (!$enr) return;
        $sch = (float)($enr['scholarship_amount'] ?? 0);
        $paid = (float)$pdo->query("SELECT COALESCE(SUM(paid_amount),0) FROM enrollment_installments WHERE enrollment_id = " . $enrollmentId . " AND status = 'paid'")->fetchColumn();
        $total = round($sch + $paid, 2);
        $due = (float)($enr['amount_due'] ?? 0);
        $fullyPaid = $due > 0 && $total + 0.005 >= $due;
        $status = $enr['status'];
        if ($fullyPaid) { $status = 'paid'; }
        elseif ($status === 'paid') { $status = 'active'; }   // no longer fully covered
        $pdo->prepare("UPDATE enrollments SET payment_amount = ?, date_payment = ?, status = ?, updated_at = NOW() WHERE id = ?")
            ->execute([$total, $fullyPaid ? date('Y-m-d') : null, $status, $enrollmentId]);
    }

    private static function serializePlan(PDO $pdo, int $enrollmentId): array
    {
        $e = $pdo->prepare("SELECT id, member_id, amount_due, scholarship_amount, payment_amount FROM enrollments WHERE id = ?");
        $e->execute([$enrollmentId]);
        $enr = $e->fetch();
        $ins = $pdo->prepare("SELECT * FROM enrollment_installments WHERE enrollment_id = ? ORDER BY seq");
        $ins->execute([$enrollmentId]);
        $rows = $ins->fetchAll();
        $installments = array_map(fn($r) => [
            'id' => (int)$r['id'], 'seq' => (int)$r['seq'], 'due_date' => $r['due_date'],
            'amount' => (float)$r['amount'], 'status' => $r['status'],
            'paid_date' => $r['paid_date'], 'paid_amount' => $r['paid_amount'] !== null ? (float)$r['paid_amount'] : null,
            'method' => $r['method'], 'reference' => $r['reference'], 'notes' => $r['notes'],
            'reminders_suppressed' => (bool)($r['reminders_suppressed'] ?? false),
        ], $rows);
        $due = (float)($enr['amount_due'] ?? 0);
        $sch = (float)($enr['scholarship_amount'] ?? 0);
        $familyTotal = round($due - $sch, 2);
        $familyPaid = round(array_sum(array_map(fn($r) => $r['status'] === 'paid' ? (float)($r['paid_amount'] ?? 0) : 0, $rows)), 2);
        $scheduled = round(array_sum(array_map(fn($r) => (float)$r['amount'], $rows)), 2);
        $next = null;
        foreach ($rows as $r) { if ($r['status'] !== 'paid') { $next = ['due_date' => $r['due_date'], 'amount' => (float)$r['amount']]; break; } }
        $meta = self::planMeta($pdo, $enrollmentId);
        return [
            'enrollment_id' => $enrollmentId,
            'has_plan' => $installments !== [],
            'amount_due' => $due,
            'scholarship_amount' => $sch,
            'family_total' => $familyTotal,          // what the family owes (after scholarship)
            'family_paid' => $familyPaid,
            'family_remaining' => round($familyTotal - $familyPaid, 2),
            'scheduled_total' => $scheduled,         // sum of installment amounts (may differ from family_total)
            'schedule_matches' => abs($scheduled - $familyTotal) < 0.005,
            'next_due' => $next,
            'installments' => $installments,
            'reminders_suppressed' => (bool)$meta['reminders_suppressed'],
            'note' => $meta['note'],
            'confirmation_sent_at' => $meta['confirmation_sent_at'],
        ];
    }

    /** Plan-level meta row (reminder suppression, note, confirmation timestamp); defaults if none. */
    private static function planMeta(PDO $pdo, int $enrollmentId): array
    {
        $s = $pdo->prepare("SELECT reminders_suppressed, note, confirmation_sent_at FROM enrollment_payment_plans WHERE enrollment_id = ?");
        $s->execute([$enrollmentId]);
        $r = $s->fetch();
        return $r ?: ['reminders_suppressed' => 0, 'note' => null, 'confirmation_sent_at' => null];
    }

    /** GET /enrollment/{enrollment_id}/payment-plan */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['enrollment_id'];
        if (!self::canView($pdo, $cur, $eid)) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::serializePlan($pdo, $eid));
    }

    /**
     * POST /enrollment/{enrollment_id}/payment-plan  { scholarship_amount? }
     * Creates (or replaces an unpaid) 4-installment monthly plan. Scholarship is
     * subtracted from amount due; the remainder is split into equal monthly payments,
     * first due the 1st of next month. Rejects if any installment is already paid.
     */
    public static function create(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['enrollment_id'];
        $e = $pdo->prepare("SELECT amount_due FROM enrollments WHERE id = ?"); $e->execute([$eid]);
        $enr = $e->fetch();
        if (!$enr) return Http::error($res, 'Enrollment not found', 404);
        $due = (float)($enr['amount_due'] ?? 0);
        if ($due <= 0) return Http::error($res, 'Set an amount due on the enrollment before creating a payment plan.', 422);

        $d = (array)$req->getParsedBody();
        $sch = max(0, round((float)($d['scholarship_amount'] ?? 0), 2));
        if ($sch > $due) $sch = $due;
        $remaining = round($due - $sch, 2);

        // Don't wipe a plan that already has payments recorded.
        $paidCount = (int)$pdo->query("SELECT COUNT(*) FROM enrollment_installments WHERE enrollment_id = " . $eid . " AND status = 'paid'")->fetchColumn();
        if ($paidCount > 0) return Http::error($res, 'This plan already has recorded payments. Remove them first to rebuild the plan.', 409);

        // A custom schedule (admin sets each payment's date + amount) OR — when none is given — the
        // legacy equal-monthly split. Custom amounts need NOT sum to the balance (the admin is warned
        // client-side); we record what they enter and let the enrollment carry any residual.
        $rawItems = is_array($d['installments'] ?? null) ? $d['installments'] : null;
        $schedule = [];
        if ($rawItems !== null) {
            $seq = 0;
            foreach ($rawItems as $it) {
                $date = trim((string)($it['due_date'] ?? ''));
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) return Http::error($res, 'Each installment needs a valid due date (YYYY-MM-DD).', 422);
                $amt = round((float)($it['amount'] ?? 0), 2);
                if ($amt <= 0) return Http::error($res, 'Each installment amount must be greater than zero.', 422);
                $schedule[] = ['seq' => ++$seq, 'due_date' => $date, 'amount' => $amt,
                               'suppressed' => (int)(bool)($it['reminders_suppressed'] ?? false)];
            }
            if (!$schedule) return Http::error($res, 'Add at least one installment, or remove the plan.', 422);
        } elseif ($remaining > 0) {
            $count = self::INSTALLMENTS;
            $base = floor(($remaining / $count) * 100) / 100;   // round DOWN to cents
            $first = new \DateTime('first day of next month');
            for ($i = 1; $i <= $count; $i++) {
                $amt = $i < $count ? $base : round($remaining - $base * ($count - 1), 2);  // last absorbs remainder
                $schedule[] = ['seq' => $i, 'due_date' => (clone $first)->modify('+' . ($i - 1) . ' month')->format('Y-m-d'),
                               'amount' => $amt, 'suppressed' => 0];
            }
        }

        $suppress = (int)filter_var($d['reminders_suppressed'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $note = ($d['note'] ?? '') !== '' ? substr(trim((string)$d['note']), 0, 500) : null;

        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM enrollment_installments WHERE enrollment_id = ?")->execute([$eid]);
            $pdo->prepare("UPDATE enrollments SET scholarship_amount = ?, updated_at = NOW() WHERE id = ?")->execute([$sch, $eid]);
            $ins = $pdo->prepare(
                "INSERT INTO enrollment_installments (enrollment_id, seq, due_date, amount, status, reminders_suppressed, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'pending', ?, NOW(), NOW())");
            foreach ($schedule as $row) $ins->execute([$eid, $row['seq'], $row['due_date'], $row['amount'], $row['suppressed']]);

            // Plan-level meta: suppression + note (keep an existing confirmation_sent_at on rebuild).
            $pdo->prepare(
                "INSERT INTO enrollment_payment_plans (enrollment_id, reminders_suppressed, note, created_by_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE reminders_suppressed = VALUES(reminders_suppressed), note = VALUES(note), updated_at = NOW()")
                ->execute([$eid, $suppress, $note, (int)$cur['id']]);

            self::reconcileEnrollment($pdo, $eid);
            Audit::write($pdo, (int)$cur['id'], 'enrollments', $eid, 'payment_plan.create', null,
                ['scholarship' => $sch, 'remaining' => $remaining, 'installments' => count($schedule), 'custom' => $rawItems !== null, 'suppressed' => $suppress]);
            $pdo->commit();
        } catch (\Throwable $ex) {
            $pdo->rollBack();
            return Http::error($res, 'Could not create the plan: ' . $ex->getMessage(), 500);
        }

        // Optionally email the family the full schedule (sets clear expectations up front).
        if (filter_var($d['send_confirmation'] ?? false, FILTER_VALIDATE_BOOLEAN)) self::emailConfirmation($pdo, $eid);
        return Http::json($res, self::serializePlan($pdo, $eid), 201);
    }

    /** DELETE /enrollment/{enrollment_id}/payment-plan — remove the plan (and clear scholarship). */
    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['enrollment_id'];
        $pdo->prepare("DELETE FROM enrollment_installments WHERE enrollment_id = ?")->execute([$eid]);
        $pdo->prepare("DELETE FROM enrollment_payment_plans WHERE enrollment_id = ?")->execute([$eid]);
        $pdo->prepare("UPDATE enrollments SET scholarship_amount = NULL, updated_at = NOW() WHERE id = ?")->execute([$eid]);
        self::reconcileEnrollment($pdo, $eid);
        Audit::write($pdo, (int)$cur['id'], 'enrollments', $eid, 'payment_plan.delete', null, null);
        return Http::json($res, self::serializePlan($pdo, $eid));
    }

    /** POST /enrollment/{enrollment_id}/payment-plan/send-confirmation — (re)email the family the schedule. */
    public static function sendConfirmation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['enrollment_id'];
        $ok = self::emailConfirmation($pdo, $eid);
        if ($ok) Audit::write($pdo, (int)$cur['id'], 'enrollments', $eid, 'payment_plan.confirmation_sent', null, null);
        return Http::json($res, ['ok' => $ok] + self::serializePlan($pdo, $eid));
    }

    /** PATCH /enrollment/{enrollment_id}/payment-plan — update plan-level reminder suppression / note. */
    public static function updatePlan(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['enrollment_id'];
        $d = (array)$req->getParsedBody();
        $fields = []; $args = [];
        if (array_key_exists('reminders_suppressed', $d)) { $fields[] = 'reminders_suppressed = ?'; $args[] = (int)filter_var($d['reminders_suppressed'], FILTER_VALIDATE_BOOLEAN); }
        if (array_key_exists('note', $d)) { $fields[] = 'note = ?'; $args[] = ($d['note'] ?? '') !== '' ? substr(trim((string)$d['note']), 0, 500) : null; }
        if ($fields) {
            $pdo->prepare("INSERT IGNORE INTO enrollment_payment_plans (enrollment_id, created_by_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())")->execute([$eid, (int)$cur['id']]);
            $args[] = $eid;
            $pdo->prepare("UPDATE enrollment_payment_plans SET " . implode(', ', $fields) . ", updated_at = NOW() WHERE enrollment_id = ?")->execute($args);
            Audit::write($pdo, (int)$cur['id'], 'enrollments', $eid, 'payment_plan.update', null, $d);
        }
        return Http::json($res, self::serializePlan($pdo, $eid));
    }

    /** PATCH /enrollment/installments/{installment_id}/reminder — suppress/enable one installment's reminder. */
    public static function toggleInstallmentReminder(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $iid = (int)$route['installment_id'];
        $s = $pdo->prepare("SELECT enrollment_id FROM enrollment_installments WHERE id = ?"); $s->execute([$iid]);
        $eid = (int)($s->fetchColumn() ?: 0);
        if (!$eid) return Http::error($res, 'Installment not found', 404);
        $sup = (int)filter_var(((array)$req->getParsedBody())['reminders_suppressed'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $pdo->prepare("UPDATE enrollment_installments SET reminders_suppressed = ?, updated_at = NOW() WHERE id = ?")->execute([$sup, $iid]);
        Audit::write($pdo, (int)$cur['id'], 'enrollment_installments', $iid, 'installment.reminder', null, ['suppressed' => $sup]);
        return Http::json($res, self::serializePlan($pdo, $eid));
    }

    /**
     * Email the family the full plan schedule (each due date + amount + total), so expectations are
     * set up front. Sent on demand (create checkbox / resend button). Records confirmation_sent_at.
     */
    private static function emailConfirmation(PDO $pdo, int $eid): bool
    {
        if (!\App\Core\Mailer::enabled()) return false;
        $q = $pdo->prepare(
            "SELECT e.member_id, m.first_name, m.email AS member_email, m.guardian1_email, m.guardian2_email, p.name AS program_name
               FROM enrollments e JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id WHERE e.id = ?");
        $q->execute([$eid]);
        $e = $q->fetch();
        if (!$e) return false;
        $ins = $pdo->prepare("SELECT seq, due_date, amount, status FROM enrollment_installments WHERE enrollment_id = ? ORDER BY seq");
        $ins->execute([$eid]);
        $rows = $ins->fetchAll();
        if (!$rows) return false;
        $to = [];
        foreach ([$e['guardian1_email'], $e['guardian2_email'], $e['member_email']] as $addr) {
            $addr = trim((string)$addr);
            if ($addr !== '' && filter_var($addr, FILTER_VALIDATE_EMAIL)) $to[$addr] = true;
        }
        if (!$to) return false;
        $esc = fn ($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $name = trim((string)$e['first_name']);
        $prog = $e['program_name'] ? $esc($e['program_name']) . ' ' : '';
        $total = 0.0; $lines = '';
        foreach ($rows as $r) {
            $amt = (float)$r['amount']; $total += $amt; $paid = $r['status'] === 'paid';
            $lines .= '<tr><td style="padding:4px 14px 4px 0">#' . (int)$r['seq'] . '</td>'
                    . '<td style="padding:4px 14px 4px 0">' . date('M j, Y', strtotime((string)$r['due_date'])) . '</td>'
                    . '<td style="padding:4px 0;text-align:right">$' . number_format($amt, 2) . ($paid ? ' <span style="color:#2e7d32">paid</span>' : '') . '</td></tr>';
        }
        $note = self::planMeta($pdo, $eid)['note'];
        $body = '<p>Hi,</p><p>Here is the payment plan for <strong>' . $esc($name) . "</strong>'s {$prog}enrollment. "
              . 'Please make note of each due date and amount:</p>'
              . '<table style="border-collapse:collapse;font-size:14px;margin:6px 0">'
              . '<thead><tr><th style="text-align:left;padding:4px 14px 4px 0;border-bottom:1px solid #ccc">#</th>'
              . '<th style="text-align:left;padding:4px 14px 4px 0;border-bottom:1px solid #ccc">Due</th>'
              . '<th style="text-align:right;padding:4px 0;border-bottom:1px solid #ccc">Amount</th></tr></thead>'
              . '<tbody>' . $lines . '</tbody></table>'
              . '<p><strong>Total: $' . number_format($total, 2) . '</strong></p>'
              . ($note ? '<p>' . nl2br($esc($note)) . '</p>' : '')
              . '<p>You can pay each installment by card online, or by check or cash at the center.</p>';
        $appUrl = rtrim((string)\App\Core\Config::get('APP_URL', ''), '/');
        if ($appUrl) $body .= "<p><a href='{$appUrl}/' style='color:#1565c0'>Log in to view or pay &rarr;</a></p>";
        $html = \App\Core\Mailer::wrap('Your Enrollment Payment Plan', $body);
        $subject = "Your payment plan for {$name}'s enrollment";
        $ok = false;
        foreach (array_keys($to) as $addr) { if (\App\Core\Mailer::send($addr, $subject, $html)) $ok = true; }
        if ($ok) {
            $pdo->prepare(
                "INSERT INTO enrollment_payment_plans (enrollment_id, confirmation_sent_at, created_at, updated_at)
                 VALUES (?, NOW(), NOW(), NOW())
                 ON DUPLICATE KEY UPDATE confirmation_sent_at = NOW(), updated_at = NOW()")->execute([$eid]);
        }
        return $ok;
    }

    /**
     * POST /enrollment/installments/{installment_id}/pay  { method, paid_amount?, paid_date?, reference?, notes? }
     * Admin records a check/cash (or other manual) payment against one installment.
     */
    public static function recordPayment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $iid = (int)$route['installment_id'];
        $s = $pdo->prepare("SELECT * FROM enrollment_installments WHERE id = ?"); $s->execute([$iid]);
        $inst = $s->fetch();
        if (!$inst) return Http::error($res, 'Installment not found', 404);
        $d = (array)$req->getParsedBody();
        $method = mb_substr(trim((string)($d['method'] ?? 'cash')), 0, 50) ?: 'cash';
        $amt = array_key_exists('paid_amount', $d) && $d['paid_amount'] !== '' ? round((float)$d['paid_amount'], 2) : (float)$inst['amount'];
        $paidDate = ($d['paid_date'] ?? '') !== '' ? $d['paid_date'] : date('Y-m-d');
        $pdo->prepare(
            "UPDATE enrollment_installments SET status='paid', paid_amount=?, paid_date=?, method=?, reference=?, notes=?, recorded_by_id=?, updated_at=NOW() WHERE id=?"
        )->execute([$amt, $paidDate, $method, ($d['reference'] ?? '') ?: null, ($d['notes'] ?? '') ?: null, (int)$cur['id'], $iid]);
        self::reconcileEnrollment($pdo, (int)$inst['enrollment_id']);
        Audit::write($pdo, (int)$cur['id'], 'enrollment_installments', $iid, 'installment.pay', null,
            ['method' => $method, 'amount' => $amt, 'enrollment_id' => (int)$inst['enrollment_id']]);

        // Receipt for the family — an installment paid in cash or by check produced
        // no confirmation at all before this.
        $er = $pdo->prepare("SELECT e.member_id, e.amount_due, e.payment_amount, p.name AS program_name
                               FROM enrollments e LEFT JOIN programs p ON p.id = e.program_id
                              WHERE e.id = ?");
        $er->execute([(int)$inst['enrollment_id']]);
        $receipt = null;
        if ($en = $er->fetch()) {
            [$sent, $to] = \App\Core\PaymentReceipt::send($pdo, [
                'member_id' => (int)$en['member_id'],
                'amount' => $amt,
                'method' => $method,
                'paid_on' => $paidDate,
                'reference' => ($d['reference'] ?? '') ?: null,
                'what' => trim((string)($en['program_name'] ?? '') . ' registration — payment plan instalment'),
                'balance' => round((float)($en['amount_due'] ?? 0) - (float)($en['payment_amount'] ?? 0), 2),
                'recorded_by' => trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? '')),
            ]);
            $receipt = ['sent' => $sent, 'to' => $to];
        }
        return Http::json($res, self::serializePlan($pdo, (int)$inst['enrollment_id']) + ($receipt ? ['receipt' => $receipt] : []));
    }

    /** DELETE /enrollment/installments/{installment_id}/pay — undo a recorded payment. */
    public static function unrecordPayment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $iid = (int)$route['installment_id'];
        $s = $pdo->prepare("SELECT enrollment_id FROM enrollment_installments WHERE id = ?"); $s->execute([$iid]);
        $eid = $s->fetchColumn();
        if ($eid === false) return Http::error($res, 'Installment not found', 404);
        $pdo->prepare("UPDATE enrollment_installments SET status='pending', paid_amount=NULL, paid_date=NULL, method=NULL, reference=NULL, recorded_by_id=NULL, updated_at=NOW() WHERE id=?")->execute([$iid]);
        self::reconcileEnrollment($pdo, (int)$eid);
        Audit::write($pdo, (int)$cur['id'], 'enrollment_installments', $iid, 'installment.unpay', null, ['enrollment_id' => (int)$eid]);
        return Http::json($res, self::serializePlan($pdo, (int)$eid));
    }

    /**
     * GET /members/me/payment-plans — the current parent's family youth with a payment
     * plan: each pending installment (due date, amount, overdue) so the dashboard can
     * show what's owed and offer a card payment.
     */
    public static function myPlans(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        // Family youth (self included) — reuse the family-membership query.
        $ids = [(int)$cur['id']];
        $fam = $pdo->prepare("SELECT DISTINCT fm2.member_id FROM family_members fm1
                              JOIN family_members fm2 ON fm2.family_id = fm1.family_id WHERE fm1.member_id = ?");
        $fam->execute([(int)$cur['id']]);
        foreach ($fam->fetchAll() as $r) $ids[] = (int)$r['member_id'];
        $ids = array_values(array_unique($ids));
        $in = implode(',', array_fill(0, count($ids), '?'));
        $rows = $pdo->prepare(
            "SELECT i.id, i.enrollment_id, i.seq, i.due_date, i.amount, i.status,
                    e.member_id, m.first_name, m.last_name, p.name AS program_name, e.enrollment_year
               FROM enrollment_installments i
               JOIN enrollments e ON e.id = i.enrollment_id
               JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
              WHERE e.member_id IN ($in) AND i.status = 'pending'
              ORDER BY i.due_date, m.first_name");
        $rows->execute($ids);
        $today = date('Y-m-d');
        $out = array_map(fn($r) => [
            'installment_id' => (int)$r['id'], 'enrollment_id' => (int)$r['enrollment_id'], 'seq' => (int)$r['seq'],
            'youth_name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'program' => $r['program_name'], 'due_date' => $r['due_date'], 'amount' => (float)$r['amount'],
            'overdue' => $r['due_date'] < $today,
        ], $rows->fetchAll());
        $providers = [];
        if (\App\Controllers\PaymentsController::paymentsPublicEnabled($pdo)) $providers = ['enabled' => true];
        return Http::json($res, ['installments' => $out, 'payments_enabled' => $providers !== []]);
    }

    /**
     * Send monthly reminder emails for installments due within the next 7 days or
     * overdue, that haven't been reminded in the last ~20 days. Called by the cron
     * script (deploy/run_payment_reminders.php) and the admin "send now" endpoint.
     * @return array{sent:int, skipped:int}
     */
    public static function sendDueReminders(PDO $pdo): array
    {
        if (!\App\Core\Mailer::enabled()) return ['sent' => 0, 'skipped' => 0];
        $rows = $pdo->query(
            "SELECT i.*, e.member_id, m.first_name, m.last_name, m.email AS member_email,
                    m.guardian1_email, m.guardian2_email, p.name AS program_name, e.enrollment_year
               FROM enrollment_installments i
               JOIN enrollments e ON e.id = i.enrollment_id
               JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
               LEFT JOIN enrollment_payment_plans pp ON pp.enrollment_id = i.enrollment_id
              WHERE i.status = 'pending'
                AND COALESCE(i.reminders_suppressed, 0) = 0
                AND COALESCE(pp.reminders_suppressed, 0) = 0
                AND i.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                AND (i.reminded_at IS NULL OR i.reminded_at <= DATE_SUB(CURDATE(), INTERVAL 20 DAY))"
        )->fetchAll();
        $appUrl = rtrim((string)\App\Core\Config::get('APP_URL', ''), '/');
        $sent = 0; $skipped = 0;
        $mark = $pdo->prepare("UPDATE enrollment_installments SET reminded_at = CURDATE() WHERE id = ?");
        foreach ($rows as $r) {
            $to = [];
            foreach ([$r['guardian1_email'], $r['guardian2_email'], $r['member_email']] as $e) {
                $e = trim((string)$e);
                if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) $to[$e] = true;
            }
            if (!$to) { $skipped++; continue; }
            $name = trim((string)$r['first_name']);
            $amt = '$' . number_format((float)$r['amount'], 2);
            $due = date('M j, Y', strtotime((string)$r['due_date']));
            $overdue = $r['due_date'] < date('Y-m-d');
            $prog = $r['program_name'] ? htmlspecialchars((string)$r['program_name']) . ' ' : '';
            $link = $appUrl ? "<p><a href='{$appUrl}/' style='color:#1565c0'>Log in to pay →</a></p>" : '';
            $body = "<p>Hi,</p><p>This is a reminder that <strong>{$name}</strong>'s {$prog}enrollment payment "
                  . "of <strong>{$amt}</strong> " . ($overdue ? "was due on <strong>{$due}</strong> and is now overdue" : "is due on <strong>{$due}</strong>")
                  . ".</p><p>You can pay by card online, or by check or cash at the center.</p>{$link}";
            $html = \App\Core\Mailer::wrap('Enrollment Payment Reminder', $body);
            $subject = ($overdue ? 'Overdue: ' : 'Reminder: ') . $name . "'s enrollment payment ({$amt})";
            $ok = false;
            foreach (array_keys($to) as $addr) { if (\App\Core\Mailer::send($addr, $subject, $html)) $ok = true; }
            if ($ok) { $mark->execute([(int)$r['id']]); $sent++; } else { $skipped++; }
        }
        return ['sent' => $sent, 'skipped' => $skipped];
    }

    /** POST /enrollment/payment-plans/send-reminders — admin triggers the reminder run now. */
    public static function sendRemindersNow(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $r = self::sendDueReminders($pdo);
        Audit::write($pdo, (int)$cur['id'], 'enrollment_installments', null, 'payment_plan.reminders', null, $r);
        return Http::json($res, ['ok' => true] + $r);
    }

    /**
     * Weekly "past-due membership" reminder: emails the parents/guardians of members who still owe a
     * membership balance and have NOT set up a payment plan. One email per family (all their owing
     * youth listed). Skips anyone paid in full, on a payment plan, with a $0 balance, or a payment
     * override. Uses the admin-editable "past_due" email template when present. Throttled by
     * enrollments.pastdue_reminded_at so a weekly cron won't double-send. Safe to run weekly.
     */
    public static function sendPastDueReminders(PDO $pdo): array
    {
        if (!\App\Core\Mailer::enabled()) return ['sent' => 0, 'skipped' => 0, 'families' => 0];

        $tpl = $pdo->query("SELECT subject_template, body_html_template FROM email_templates
                             WHERE category = 'past_due' AND is_active = 1 ORDER BY id LIMIT 1")->fetch();
        $year = \App\Core\EnrollmentService::currentEnrollmentYear();
        $appUrl = rtrim((string)\App\Core\Config::get('APP_URL', ''), '/');
        $centerName = 'Tulsa Robotics Center';

        // Owing youth enrollments: real balance (amount_due − paid), no payment plan, not overridden,
        // membership not cancelled/expired, active member, and not reminded in the last 6 days.
        $stmt = $pdo->prepare(
            "SELECT e.id AS enrollment_id,
                    m.id AS member_id, m.first_name, m.last_name, m.guardian1_email, m.guardian2_email,
                    p.name AS program_name,
                    (SELECT fm.family_id FROM family_members fm WHERE fm.member_id = m.id
                       ORDER BY fm.is_primary_contact DESC, fm.id LIMIT 1) AS family_id,
                    ROUND(e.amount_due - COALESCE(e.payment_amount, 0), 2) AS balance
               FROM enrollments e
               JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
              WHERE e.enrollment_year = ?
                AND e.status NOT IN ('cancelled', 'expired')
                AND (e.payment_override = 0 OR e.payment_override IS NULL)
                AND m.member_type = 'youth'
                AND m.is_active = 1
                AND (m.is_archived = 0 OR m.is_archived IS NULL)
                AND (m.is_kiosk = 0 OR m.is_kiosk IS NULL)
                AND (m.is_system = 0 OR m.is_system IS NULL)
                AND e.amount_due IS NOT NULL
                AND ROUND(e.amount_due - COALESCE(e.payment_amount, 0), 2) > 0.005
                AND NOT EXISTS (SELECT 1 FROM enrollment_installments i WHERE i.enrollment_id = e.id)
                AND (e.pastdue_reminded_at IS NULL OR e.pastdue_reminded_at <= DATE_SUB(CURDATE(), INTERVAL 6 DAY))
              ORDER BY m.last_name, m.first_name"
        );
        $stmt->execute([$year]);

        // Group by family so a family with several youth gets ONE email, not one per youth.
        $groups = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $key = $r['family_id'] !== null ? 'fam:' . (int)$r['family_id'] : 'solo:' . (int)$r['member_id'];
            $groups[$key][] = $r;
        }

        $render = fn (string $s, array $ctx): string => preg_replace_callback(
            '/\{\{(\w+)\}\}/', fn ($m) => array_key_exists($m[1], $ctx) ? (string)$ctx[$m[1]] : $m[0], $s);
        $defaultBody = '<p>Hello,</p><p>Our records show an outstanding membership balance for your family at '
            . '{{center_name}}:</p>{{members}}<p><strong>Total due: {{total_due}}</strong></p>'
            . '<p>You can pay online, or by check or cash at the center.</p>{{pay_link}}<p>Thank you,<br>{{center_name}}</p>';

        $mark = $pdo->prepare("UPDATE enrollments SET pastdue_reminded_at = CURDATE() WHERE id = ?");
        $sent = 0; $skipped = 0; $families = 0;
        foreach ($groups as $grp) {
            $families++;
            $to = [];
            foreach ($grp as $r) {
                foreach ([$r['guardian1_email'], $r['guardian2_email']] as $g) {
                    $g = trim((string)$g);
                    if ($g !== '' && filter_var($g, FILTER_VALIDATE_EMAIL)) $to[strtolower($g)] = $g;
                }
            }
            if (!$to) { $skipped++; continue; }   // no parent/guardian email on file

            $items = ''; $total = 0.0; $familyName = '';
            foreach ($grp as $r) {
                $bal = (float)$r['balance']; $total += $bal;
                $familyName = $familyName ?: (string)$r['last_name'];
                $prog = $r['program_name'] ? htmlspecialchars((string)$r['program_name']) . ' — ' : '';
                $items .= '<li>' . htmlspecialchars(trim($r['first_name'] . ' ' . $r['last_name'])) . ' — '
                        . $prog . '<strong>$' . number_format($bal, 2) . '</strong> due</li>';
            }
            $ctx = [
                'center_name' => $centerName, 'family_name' => $familyName,
                'members' => '<ul>' . $items . '</ul>', 'total_due' => '$' . number_format($total, 2),
                'pay_link' => $appUrl ? "<p><a href='{$appUrl}/' style='color:#1565c0'>Log in to pay →</a></p>" : '',
            ];
            $subject = ($tpl && trim((string)$tpl['subject_template']) !== '')
                ? $render((string)$tpl['subject_template'], $ctx)
                : "Membership payment reminder — {$ctx['total_due']} due";
            $bodyTpl = ($tpl && trim((string)$tpl['body_html_template']) !== '') ? (string)$tpl['body_html_template'] : $defaultBody;
            $html = \App\Core\Mailer::wrap('Membership Payment Reminder', $render($bodyTpl, $ctx));

            $addrs = array_values($to);
            $primary = array_shift($addrs);
            $cc = $addrs ? implode(',', $addrs) : null;
            if (\App\Core\Mailer::send($primary, $subject, $html, null, $cc)) {
                foreach ($grp as $r) $mark->execute([(int)$r['enrollment_id']]);
                $sent++;
            } else {
                $skipped++;
            }
        }
        return ['sent' => $sent, 'skipped' => $skipped, 'families' => $families];
    }
}
