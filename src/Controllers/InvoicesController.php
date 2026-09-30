<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Invoicing & third-party payers (v1). Produces a consolidated family invoice
 * that reflects multi-child discounts (already baked into amount_due),
 * scholarships, and school payments; lets an admin record that a school covers
 * part/all of a youth's registration (reducing the family balance); and emails
 * a school its invoice.
 */
final class InvoicesController
{
    private static function canManage(PDO $pdo, ?array $m): bool
    {
        return $m !== null && (Permissions::hasAnyRole($pdo, $m, ['Admin', 'System Administrator'])
            || Permissions::memberCan($pdo, $m, 'enrollment.payments', 'write'));
    }

    /** Applied credits against one enrollment: scholarships + school payments. */
    private static function creditsFor(PDO $pdo, int $enrollmentId): array
    {
        $sch = $pdo->prepare("SELECT aw.amount, f.name AS fund_name FROM scholarship_awards aw LEFT JOIN scholarship_funds f ON f.id = aw.fund_id WHERE aw.enrollment_id = ? AND aw.status='applied'");
        $sch->execute([$enrollmentId]);
        $scholarships = array_map(fn($r) => ['amount' => (float)$r['amount'], 'source' => $r['fund_name'] ?: 'Scholarship'], $sch->fetchAll());
        $scp = $pdo->prepare("SELECT sp.amount, s.name AS school_name FROM school_payments sp LEFT JOIN schools s ON s.id = sp.school_id WHERE sp.enrollment_id = ? AND sp.status <> 'reversed'");
        $scp->execute([$enrollmentId]);
        $schools = array_map(fn($r) => ['amount' => (float)$r['amount'], 'source' => $r['school_name'] ?: 'School'], $scp->fetchAll());
        $sTot = array_sum(array_column($scholarships, 'amount'));
        $cTot = array_sum(array_column($schools, 'amount'));
        return ['scholarships' => $scholarships, 'schools' => $schools, 'credit_total' => round($sTot + $cTot, 2)];
    }

    /** GET /invoices/family/{family_id} — consolidated invoice for a family. */
    public static function familyInvoice(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $familyId = (int)$route['family_id'];
        // Access: admins, or a member of this family.
        $inFamily = $pdo->prepare("SELECT 1 FROM family_members WHERE family_id = ? AND member_id = ? LIMIT 1");
        $inFamily->execute([$familyId, (int)$cur['id']]);
        if (!self::canManage($pdo, $cur) && !$inFamily->fetchColumn()) return Http::error($res, 'Access denied', 403);

        $fam = $pdo->prepare("SELECT family_name FROM families WHERE id = ?"); $fam->execute([$familyId]);
        $familyName = (string)($fam->fetchColumn() ?: 'Family');
        $q = $req->getQueryParams();
        $year = !empty($q['enrollment_year']) ? (int)$q['enrollment_year'] : (EnrollmentService::currentEnrollmentYear());

        $rows = $pdo->prepare(
            "SELECT e.id AS enrollment_id, e.amount_due, e.payment_amount, e.status,
                    m.id AS member_id, m.first_name, m.last_name, p.name AS program
             FROM family_members fm
             JOIN members m ON m.id = fm.member_id
             JOIN enrollments e ON e.member_id = m.id AND e.enrollment_year = ?
             LEFT JOIN programs p ON p.id = e.program_id
             ORDER BY m.first_name, p.name");
        $rows->execute([$year]);
        $lines = []; $familyDue = 0.0; $creditsTotal = 0.0; $paidTotal = 0.0;
        foreach ($rows->fetchAll() as $r) {
            $net = (float)($r['amount_due'] ?? 0);
            $credits = self::creditsFor($pdo, (int)$r['enrollment_id']);
            $gross = round($net + $credits['credit_total'], 2);
            $paid = (float)($r['payment_amount'] ?? 0);
            $lines[] = [
                'enrollment_id' => (int)$r['enrollment_id'],
                'youth' => trim("{$r['first_name']} {$r['last_name']}"),
                'program' => $r['program'] ?? 'Program',
                'fee' => $gross, 'credits' => array_merge($credits['scholarships'], $credits['schools']),
                'credit_total' => $credits['credit_total'], 'balance' => round($net, 2),
                'paid' => $paid, 'status' => $r['status'],
            ];
            $familyDue += $net; $creditsTotal += $credits['credit_total']; $paidTotal += $paid;
        }
        return Http::json($res, [
            'family_id' => $familyId, 'family_name' => $familyName, 'enrollment_year' => $year,
            'lines' => $lines,
            'gross_total' => round($familyDue + $creditsTotal, 2),
            'credits_total' => round($creditsTotal, 2),
            'balance_total' => round($familyDue, 2),
            'paid_total' => round($paidTotal, 2),
            'remaining_total' => round($familyDue - $paidTotal, 2),
        ]);
    }

    /** GET /invoices/school/{school_id} — what a school owes (its payments). */
    public static function schoolInvoice(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $schoolId = (int)$route['school_id'];
        $sc = $pdo->prepare("SELECT name FROM schools WHERE id = ?"); $sc->execute([$schoolId]);
        $schoolName = $sc->fetchColumn();
        if ($schoolName === false) return Http::error($res, 'School not found', 404);

        $rows = $pdo->prepare(
            "SELECT sp.id, sp.amount, sp.status, sp.note, sp.enrollment_id,
                    m.first_name, m.last_name, p.name AS program, e.enrollment_year
             FROM school_payments sp
             LEFT JOIN members m ON m.id = sp.member_id
             LEFT JOIN enrollments e ON e.id = sp.enrollment_id
             LEFT JOIN programs p ON p.id = e.program_id
             WHERE sp.school_id = ? AND sp.status <> 'reversed'
             ORDER BY sp.created_at");
        $rows->execute([$schoolId]);
        $lines = []; $total = 0.0;
        foreach ($rows->fetchAll() as $r) {
            $lines[] = [
                'id' => (int)$r['id'], 'youth' => trim("{$r['first_name']} {$r['last_name']}") ?: 'Youth',
                'program' => $r['program'] ?? 'Registration', 'year' => $r['enrollment_year'],
                'amount' => (float)$r['amount'], 'status' => $r['status'], 'note' => $r['note'],
            ];
            $total += (float)$r['amount'];
        }
        // A contact email if one is on file.
        $ce = $pdo->prepare("SELECT email FROM school_contacts WHERE school_id = ? AND email IS NOT NULL AND email <> '' ORDER BY id LIMIT 1");
        $ce->execute([$schoolId]);
        return Http::json($res, [
            'school_id' => $schoolId, 'school_name' => (string)$schoolName,
            'lines' => $lines, 'total' => round($total, 2),
            'suggested_email' => $ce->fetchColumn() ?: null,
        ]);
    }

    /** POST /school-payments — record that a school covers part/all of a youth's registration. */
    public static function recordSchoolPayment(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $schoolId = (int)($d['school_id'] ?? 0);
        $amount = round((float)($d['amount'] ?? 0), 2);
        $enrollmentId = ($d['enrollment_id'] ?? '') === '' ? null : (int)$d['enrollment_id'];
        $memberId = ($d['member_id'] ?? '') === '' ? null : (int)$d['member_id'];
        if (!$schoolId || $amount <= 0) return Http::error($res, 'Choose a school and a positive amount.', 422);

        // Cap to the enrollment's remaining balance so recorded == deducted ==
        // restored-on-reverse (no GREATEST(0,…) floor that would over-restore).
        $applied = $amount;
        if ($enrollmentId) {
            $es = $pdo->prepare("SELECT amount_due FROM enrollments WHERE id = ?"); $es->execute([$enrollmentId]);
            $due = $es->fetchColumn();
            if ($due === false) return Http::error($res, 'That enrollment was not found.', 404);
            $due = round((float)$due, 2);
            if ($due <= 0) return Http::error($res, 'That enrollment already has no remaining balance.', 400);
            $applied = min($amount, $due);
        }

        $pdo->beginTransaction();
        try {
            $pdo->prepare("INSERT INTO school_payments (school_id, member_id, enrollment_id, amount, status, note, created_by_id, created_at) VALUES (?,?,?,?,'pledged',?,?,NOW())")
                ->execute([$schoolId, $memberId, $enrollmentId, $applied, $d['note'] ?? null, (int)$cur['id']]);
            $id = (int)$pdo->lastInsertId();
            if ($enrollmentId) {
                $pdo->prepare("UPDATE enrollments SET amount_due = COALESCE(amount_due,0) - ?, amount_due_overridden = 1 WHERE id = ?")
                    ->execute([$applied, $enrollmentId]);
            }
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); return Http::error($res, 'Could not record the school payment.', 500); }
        Audit::write($pdo, (int)$cur['id'], 'school_payments', $id, 'create', null, ['school_id' => $schoolId, 'amount' => $applied, 'enrollment_id' => $enrollmentId]);
        return Http::json($res, ['ok' => true, 'id' => $id], 201);
    }

    /** POST /school-payments/{id}/reverse — undo (restores the youth's amount due). */
    public static function reverseSchoolPayment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT * FROM school_payments WHERE id = ?"); $s->execute([(int)$route['id']]);
        $p = $s->fetch();
        if (!$p) return Http::error($res, 'Not found', 404);
        if ($p['status'] === 'reversed') return Http::error($res, 'Already reversed.', 400);
        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE school_payments SET status='reversed', reversed_at=NOW() WHERE id = ?")->execute([(int)$p['id']]);
            if ($p['enrollment_id']) $pdo->prepare("UPDATE enrollments SET amount_due = COALESCE(amount_due,0) + ? WHERE id = ?")->execute([(float)$p['amount'], (int)$p['enrollment_id']]);
            $pdo->commit();
        } catch (\Throwable $e) { $pdo->rollBack(); return Http::error($res, 'Could not reverse.', 500); }
        Audit::write($pdo, (int)$cur['id'], 'school_payments', (int)$p['id'], 'reverse', null, ['amount' => (float)$p['amount']]);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /invoices/school/{school_id}/send — email the school its invoice. */
    public static function sendSchoolInvoice(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        if (!Mailer::enabled()) return Http::error($res, 'Email is not configured on the server.', 400);
        $schoolId = (int)$route['school_id'];
        $d = (array)$req->getParsedBody();
        $to = trim((string)($d['to_email'] ?? ''));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'A valid recipient email is required.', 422);

        // Build the invoice from unreversed, not-yet-paid payments.
        $sc = $pdo->prepare("SELECT name FROM schools WHERE id = ?"); $sc->execute([$schoolId]);
        $schoolName = $sc->fetchColumn();
        if ($schoolName === false) return Http::error($res, 'School not found', 404);
        $rows = $pdo->prepare(
            "SELECT sp.id, sp.amount, m.first_name, m.last_name, p.name AS program, e.enrollment_year
             FROM school_payments sp LEFT JOIN members m ON m.id = sp.member_id
             LEFT JOIN enrollments e ON e.id = sp.enrollment_id LEFT JOIN programs p ON p.id = e.program_id
             WHERE sp.school_id = ? AND sp.status IN ('pledged','invoiced')");
        $rows->execute([$schoolId]);
        $items = $rows->fetchAll();
        if (!$items) return Http::error($res, 'This school has no outstanding items to invoice.', 400);

        $total = 0.0; $tr = '';
        foreach ($items as $r) {
            $total += (float)$r['amount'];
            $youth = htmlspecialchars(trim("{$r['first_name']} {$r['last_name']}") ?: 'Youth');
            $prog = htmlspecialchars(($r['program'] ?? 'Registration') . ($r['enrollment_year'] ? " ({$r['enrollment_year']}–" . ((int)$r['enrollment_year'] + 1) . ")" : ''));
            $tr .= "<tr><td style='padding:6px 10px;border-bottom:1px solid #eee'>$youth</td><td style='padding:6px 10px;border-bottom:1px solid #eee'>$prog</td><td style='padding:6px 10px;border-bottom:1px solid #eee;text-align:right'>\$" . number_format((float)$r['amount'], 2) . "</td></tr>";
        }
        $sn = htmlspecialchars((string)$schoolName);
        $intro = htmlspecialchars((string)($d['message'] ?? ''));
        $html = "<div style='font-family:Arial,sans-serif;color:#243'>"
            . "<h2 style='color:#1a3a5c'>Tulsa Robotics Center — Invoice</h2>"
            . "<p>Billed to: <strong>$sn</strong></p>"
            . ($intro ? "<p>$intro</p>" : '')
            . "<table style='border-collapse:collapse;width:100%;max-width:520px'><thead><tr>"
            . "<th style='text-align:left;padding:6px 10px;border-bottom:2px solid #1a3a5c'>Youth</th>"
            . "<th style='text-align:left;padding:6px 10px;border-bottom:2px solid #1a3a5c'>Program</th>"
            . "<th style='text-align:right;padding:6px 10px;border-bottom:2px solid #1a3a5c'>Amount</th></tr></thead><tbody>$tr</tbody>"
            . "<tfoot><tr><td colspan='2' style='padding:8px 10px;text-align:right;font-weight:bold'>Total due</td>"
            . "<td style='padding:8px 10px;text-align:right;font-weight:bold'>\$" . number_format($total, 2) . "</td></tr></tfoot></table>"
            . "<p style='margin-top:16px;color:#667'>Thank you for supporting our youth. Please contact us with any questions.</p></div>";
        $plain = "Tulsa Robotics Center Invoice for $schoolName — Total due: $" . number_format($total, 2);

        $ok = Mailer::send($to, "Tulsa Robotics Center — Invoice for $schoolName", $html, $plain);
        if (!$ok) return Http::error($res, Mailer::lastError() ?? 'Email failed to send.', 502);

        // Mark included items invoiced.
        $ids = array_map(fn($r) => (int)$r['id'], $items);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $pdo->prepare("UPDATE school_payments SET status='invoiced', invoiced_at=NOW() WHERE id IN ($in) AND status='pledged'")->execute($ids);
        Audit::write($pdo, (int)$cur['id'], 'schools', $schoolId, 'invoice_sent', null, ['to' => $to, 'total' => $total, 'count' => count($ids)]);
        return Http::json($res, ['ok' => true, 'sent_to' => $to, 'total' => round($total, 2)]);
    }
}
