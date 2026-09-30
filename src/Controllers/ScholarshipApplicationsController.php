<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\YouthContact;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Scholarships Phase B — confidential applications (from registration), review,
 * and awards that draw from a scholarship fund and reduce a youth's enrollment
 * amount due. Sensitive family/minor data: review is gated on the dedicated
 * scholarships.applications permission (read=view queue, write=review/award/resend;
 * Admins pass as super); applicants may see only their own.
 */
final class ScholarshipApplicationsController
{
    private const DEFAULT_COST = 240.0;

    // P4/D4: an award expires this many days after it is granted if the youth hasn't
    // enrolled. "Expiring soon" warns the staff before the deadline.
    private const EXPIRE_DAYS = 30;
    private const EXPIRE_WARN_DAYS = 7;

    // Confidential family/minor aid — gated on its OWN permission (not the shared Sponsors
    // one), so admins can restrict who sees applicants without hiding the sponsors list.
    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'scholarships.applications', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'scholarships.applications', 'write'); }
    /** Deleting an application is a separate, more-restricted capability from reviewing it. */
    private static function canDelete(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'scholarships.applications.delete', 'write'); }

    private static function currentYear(): int
    {
        return EnrollmentService::currentEnrollmentYear();
    }

    private static function app(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM scholarship_applications WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /**
     * @param bool $staff  When false (the applicant/owner view), the review board's INTERNAL
     *   fields — its private notes, the reviewer's identity, and per-award notes — are omitted so
     *   they can never reach the family. Only staff with scholarships.applications access see them.
     */
    private static function serialize(PDO $pdo, array $a, bool $withAwards = false, bool $staff = false): array
    {
        $out = [
            'id' => (int)$a['id'], 'status' => $a['status'], 'enrollment_year' => $a['enrollment_year'] !== null ? (int)$a['enrollment_year'] : null,
            'submitted_by_id' => $a['submitted_by_id'] !== null ? (int)$a['submitted_by_id'] : null,
            'member_id' => $a['member_id'] !== null ? (int)$a['member_id'] : null,
            'contact_email' => $a['contact_email'], 'contact_name' => $a['contact_name'], 'contact_phone' => $a['contact_phone'],
            'program' => $a['program'], 'program_other' => $a['program_other'],
            'youth_name' => $a['youth_name'], 'youth_grade_school' => $a['youth_grade_school'], 'choose_one' => $a['choose_one'],
            'household_size' => $a['household_size'] !== null ? (int)$a['household_size'] : null,
            'youth_count' => $a['youth_count'] !== null ? (int)$a['youth_count'] : null,
            'frl_eligible' => $a['frl_eligible'], 'need_explanation' => $a['need_explanation'],
            'certified' => (bool)($a['certified'] ?? false),
            'registration_cost' => $a['registration_cost'] !== null ? (float)$a['registration_cost'] : null,
            'contribution_amount' => $a['contribution_amount'] !== null ? (float)$a['contribution_amount'] : null,
            'amount_requested' => $a['amount_requested'] !== null ? (float)$a['amount_requested'] : null,
            'received_before' => $a['received_before'] !== null ? (bool)$a['received_before'] : null,
            'narrative' => $a['narrative'], 'referral' => $a['referral'], 'optional_info' => $a['optional_info'],
            'answers' => $a['answers'] ? json_decode($a['answers'], true) : null,
            'decision_amount' => $a['decision_amount'] !== null ? (float)$a['decision_amount'] : null,
            'reviewed_at' => $a['reviewed_at'], 'created_at' => $a['created_at'],
        ];
        // Review board's internal commentary + reviewer identity — staff only, never the family.
        if ($staff) {
            $out['reviewer_id'] = $a['reviewer_id'] !== null ? (int)$a['reviewer_id'] : null;
            $out['review_notes'] = $a['review_notes'];
        }
        if ($withAwards) {
            $s = $pdo->prepare(
                "SELECT aw.*, f.name AS fund_name FROM scholarship_awards aw
                 LEFT JOIN scholarship_funds f ON f.id = aw.fund_id
                 WHERE aw.application_id = ? ORDER BY aw.id DESC");
            $s->execute([(int)$a['id']]);
            $out['awards'] = array_map(fn($w) => [
                'id' => (int)$w['id'], 'fund_id' => $w['fund_id'] !== null ? (int)$w['fund_id'] : null, 'fund_name' => $w['fund_name'],
                'member_id' => $w['member_id'] !== null ? (int)$w['member_id'] : null,
                'enrollment_id' => $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null,
                'enrollment_year' => $w['enrollment_year'] !== null ? (int)$w['enrollment_year'] : null,
                'outcome' => ($oc = self::enrollmentOutcome($pdo, $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null)),
                'expiry' => self::awardExpiry($w['created_at'], (string)$w['status'], $oc),
                'amount' => (float)$w['amount'], 'note' => $staff ? $w['note'] : null, 'status' => $w['status'], 'created_at' => $w['created_at'],
            ], $s->fetchAll());
            $out['awarded_total'] = round(array_sum(array_map(fn($w) => $w['status'] === 'applied' ? $w['amount'] : 0, $out['awards'])), 2);
        }
        return $out;
    }

    // ── Phase 3: fund ledger ────────────────────────────────────────────────

    /**
     * A fund's money for a season: available = General-Fund allocations minus applied
     * awards, DECOUPLED from sponsor money (D1). Sponsor contributions are reported
     * separately as informational support — they inform the limit, they are NOT the balance.
     */
    public static function fundAvailable(PDO $pdo, int $fundId, int $year): array
    {
        $al = $pdo->prepare("SELECT COALESCE(SUM(amount),0) FROM scholarship_fund_allocations WHERE fund_id = ? AND enrollment_year = ?");
        $al->execute([$fundId, $year]);
        $allocated = round((float)$al->fetchColumn(), 2);
        $aw = $pdo->prepare("SELECT COALESCE(SUM(amount),0) FROM scholarship_awards WHERE fund_id = ? AND enrollment_year = ? AND status = 'applied'");
        $aw->execute([$fundId, $year]);
        $awarded = round((float)$aw->fetchColumn(), 2);
        $sp = $pdo->prepare("SELECT COALESCE(SUM(CASE WHEN contribution_type='monetary' THEN amount ELSE COALESCE(in_kind_value,0) END),0)
                             FROM sponsor_contributions WHERE scholarship_fund_id = ? AND status = 'received'");
        $sp->execute([$fundId]);
        return ['year' => $year, 'allocated' => $allocated, 'awarded' => $awarded,
                'available' => round($allocated - $awarded, 2), 'sponsor_support' => round((float)$sp->fetchColumn(), 2)];
    }

    /** Did the awarded youth actually enroll? Derived from the linked enrollment's status. */
    private static function enrollmentOutcome(PDO $pdo, ?int $enrollmentId): string
    {
        if (!$enrollmentId) return 'none';
        $s = $pdo->prepare("SELECT status, date_payment, payment_override, tc_youth_agreed, tc_parent_agreed FROM enrollments WHERE id = ?");
        $s->execute([$enrollmentId]);
        $e = $s->fetch();
        if (!$e) return 'none';
        if (in_array((string)$e['status'], ['cancelled', 'not_active', 'expired', 'withdrawn'], true)) return 'not_enrolled';
        $paid = !empty($e['date_payment']) || !empty($e['payment_override']);
        $signed = !empty($e['tc_youth_agreed']) && !empty($e['tc_parent_agreed']);
        return ($paid && $signed) ? 'enrolled' : 'pending';
    }

    /**
     * P4/D4: expiration state of an award, derived from its age (no stored flag, no cron
     * needed to detect it). Only 'applied' awards expire; an award whose youth has enrolled
     * is 'secured' and never expires; reversed/clawed-back awards are 'closed'. Returns
     * state + days_left (negative once past the deadline) + the deadline date, so both the
     * ledger UI and the clawback guard can reason about it consistently.
     */
    private static function awardExpiry(?string $createdAt, string $status, string $outcome): array
    {
        if ($status !== 'applied') return ['state' => 'closed', 'days_left' => null, 'expires_on' => null];
        if ($outcome === 'enrolled') return ['state' => 'secured', 'days_left' => null, 'expires_on' => null];
        $deadline = null; $daysLeft = null; $state = 'active';
        if ($createdAt) {
            try {
                // Work at date granularity: the deadline is a calendar day (grant date + 30
                // days), so days_left must be a whole-day count from *today*. Comparing a
                // datetime deadline against midnight-today would round a sub-24h gap to 0 and
                // never reach a negative (expired) value.
                $due = (new \DateTimeImmutable($createdAt))->modify('+' . self::EXPIRE_DAYS . ' days');
                $deadline = $due->format('Y-m-d');
                $dueDate = new \DateTimeImmutable($deadline);
                $today = new \DateTimeImmutable('today');
                $daysLeft = (int)$today->diff($dueDate)->format('%r%a');
                if ($daysLeft < 0)                           $state = 'expired';
                elseif ($daysLeft <= self::EXPIRE_WARN_DAYS)  $state = 'expiring_soon';
            } catch (\Throwable $e) { /* leave as active */ }
        }
        return ['state' => $state, 'days_left' => $daysLeft, 'expires_on' => $deadline];
    }

    /** GET /scholarships/fund-ledger?year=&fund_id= — per-season allocations, awards, balances. */
    public static function fundLedger(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $year = !empty($q['year']) ? (int)$q['year'] : self::currentYear();
        $fundId = !empty($q['fund_id']) ? (int)$q['fund_id'] : null;

        $funds = $pdo->query("SELECT id, name, is_active FROM scholarship_funds ORDER BY is_active DESC, name")->fetchAll();
        $fundRows = []; $tAlloc = 0; $tAward = 0;
        foreach ($funds as $f) {
            $b = self::fundAvailable($pdo, (int)$f['id'], $year);
            $tAlloc += $b['allocated']; $tAward += $b['awarded'];
            $fundRows[] = ['id' => (int)$f['id'], 'name' => $f['name'], 'is_active' => (bool)$f['is_active']] + $b;
        }

        $detail = null;
        if ($fundId) {
            $al = $pdo->prepare("SELECT a.*, TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS by_name
                                 FROM scholarship_fund_allocations a LEFT JOIN members m ON m.id = a.allocated_by_id
                                 WHERE a.fund_id = ? AND a.enrollment_year = ? ORDER BY a.allocated_at DESC, a.id DESC");
            $al->execute([$fundId, $year]);
            $allocations = array_map(fn($a) => ['id' => (int)$a['id'], 'amount' => (float)$a['amount'], 'source' => $a['source'],
                'note' => $a['note'], 'by_name' => trim((string)$a['by_name']) ?: null, 'allocated_at' => $a['allocated_at']], $al->fetchAll());

            $aw = $pdo->prepare("SELECT aw.*, TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS recipient
                                 FROM scholarship_awards aw LEFT JOIN members m ON m.id = aw.member_id
                                 WHERE aw.fund_id = ? AND aw.enrollment_year = ? ORDER BY aw.created_at DESC, aw.id DESC");
            $aw->execute([$fundId, $year]);
            $awards = array_map(function ($w) use ($pdo) {
                $oc = self::enrollmentOutcome($pdo, $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null);
                return ['id' => (int)$w['id'], 'recipient' => trim((string)$w['recipient']) ?: null,
                    'amount' => (float)$w['amount'], 'status' => $w['status'], 'created_at' => $w['created_at'],
                    'enrollment_id' => $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null,
                    'outcome' => $oc, 'expiry' => self::awardExpiry($w['created_at'], (string)$w['status'], $oc)];
            }, $aw->fetchAll());

            // Per-year history: allocated in, paid out — for grant-writing.
            $hy = $pdo->prepare(
                "SELECT yrs.y AS year,
                        COALESCE((SELECT SUM(amount) FROM scholarship_fund_allocations WHERE fund_id = ? AND enrollment_year = yrs.y), 0) AS allocated,
                        COALESCE((SELECT SUM(amount) FROM scholarship_awards WHERE fund_id = ? AND enrollment_year = yrs.y AND status = 'applied'), 0) AS paid_out
                 FROM (SELECT DISTINCT enrollment_year y FROM scholarship_fund_allocations WHERE fund_id = ?
                       UNION SELECT DISTINCT enrollment_year FROM scholarship_awards WHERE fund_id = ? AND enrollment_year IS NOT NULL) yrs
                 ORDER BY yrs.y DESC");
            $hy->execute([$fundId, $fundId, $fundId, $fundId]);
            $history = array_map(fn($h) => ['year' => (int)$h['year'], 'allocated' => round((float)$h['allocated'], 2), 'paid_out' => round((float)$h['paid_out'], 2)], $hy->fetchAll());

            $detail = ['fund_id' => $fundId, 'allocations' => $allocations, 'awards' => $awards, 'history' => $history];
        }
        return Http::json($res, [
            'year' => $year, 'funds' => $fundRows,
            'totals' => ['allocated' => round($tAlloc, 2), 'awarded' => round($tAward, 2), 'available' => round($tAlloc - $tAward, 2)],
            'detail' => $detail,
        ]);
    }

    /** POST /scholarships/funds/{fund_id}/allocations — log a General-Fund deposit (who/when/amount). */
    public static function addAllocation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $fundId = (int)$route['fund_id'];
        $f = $pdo->prepare("SELECT id FROM scholarship_funds WHERE id = ?"); $f->execute([$fundId]);
        if (!$f->fetch()) return Http::error($res, 'Fund not found', 404);
        $d = (array)$req->getParsedBody();
        $year = !empty($d['year']) ? (int)$d['year'] : self::currentYear();
        $amount = round((float)($d['amount'] ?? 0), 2);
        if ($amount === 0.0) return Http::error($res, 'Enter an amount (positive to add, negative to correct).', 422);
        $source = ($d['source'] ?? '') !== '' ? substr((string)$d['source'], 0, 40) : 'general_fund';
        $note = ($d['note'] ?? '') !== '' ? substr((string)$d['note'], 0, 300) : null;
        $pdo->prepare("INSERT INTO scholarship_fund_allocations (fund_id, enrollment_year, amount, source, note, allocated_by_id, allocated_at, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())")
            ->execute([$fundId, $year, $amount, $source, $note, (int)$cur['id']]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'scholarship_fund_allocations', $id, 'create', null, ['fund_id' => $fundId, 'year' => $year, 'amount' => $amount]);
        return Http::json($res, ['ok' => true, 'allocation_id' => $id] + self::fundAvailable($pdo, $fundId, $year), 201);
    }

    // ── Phase 4: award expiration + staff-confirmed clawback ─────────────────

    /**
     * GET /scholarships/expiring-awards?year=&state= — the "needs attention" list: applied
     * awards whose youth has not enrolled, with their derived expiry state (active /
     * expiring_soon / expired). This is what a staff member scans to decide which awards to
     * reclaim; the reclaimable money is the sum of the expired rows. `state=expired` filters
     * to just those. Enrolled awards ('secured') are excluded — they're not at risk.
     */
    public static function expiringAwards(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $year = !empty($q['year']) ? (int)$q['year'] : self::currentYear();
        $wantState = $q['state'] ?? null;

        $s = $pdo->prepare(
            "SELECT aw.id, aw.application_id, aw.fund_id, aw.enrollment_id, aw.amount, aw.status, aw.created_at,
                    f.name AS fund_name,
                    TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS recipient
               FROM scholarship_awards aw
               LEFT JOIN scholarship_funds f ON f.id = aw.fund_id
               LEFT JOIN members m ON m.id = aw.member_id
              WHERE aw.status = 'applied' AND aw.enrollment_year = ?
              ORDER BY aw.created_at ASC, aw.id ASC");
        $s->execute([$year]);

        $rows = []; $reclaimable = 0.0; $counts = ['active' => 0, 'expiring_soon' => 0, 'expired' => 0];
        foreach ($s->fetchAll() as $w) {
            $outcome = self::enrollmentOutcome($pdo, $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null);
            $exp = self::awardExpiry($w['created_at'], 'applied', $outcome);
            if ($exp['state'] === 'secured' || $exp['state'] === 'closed') continue; // enrolled/closed: not at risk
            if (isset($counts[$exp['state']])) $counts[$exp['state']]++;
            if ($exp['state'] === 'expired') $reclaimable += (float)$w['amount'];
            if ($wantState && $wantState !== $exp['state']) continue;
            $rows[] = [
                'id' => (int)$w['id'], 'application_id' => (int)$w['application_id'],
                'fund_id' => $w['fund_id'] !== null ? (int)$w['fund_id'] : null, 'fund_name' => $w['fund_name'],
                'recipient' => trim((string)$w['recipient']) ?: null,
                'enrollment_id' => $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null,
                'amount' => (float)$w['amount'], 'created_at' => $w['created_at'],
                'outcome' => $outcome, 'expiry' => $exp,
            ];
        }
        return Http::json($res, ['year' => $year, 'awards' => $rows, 'counts' => $counts, 'reclaimable' => round($reclaimable, 2)]);
    }

    /**
     * POST /scholarships/awards/{award_id}/claw-back — staff-confirmed reclaim (D5). Reverses
     * an expired award: restores the enrollment's amount_due (the family owes it again since
     * the youth didn't enroll) and frees the money back to the fund (fundAvailable() only
     * counts 'applied', so a clawed-back award drops out of the balance and can be re-granted).
     * Guarded: only an 'applied' award may be clawed back, and never one whose youth actually
     * enrolled — that award was earned. Use reverseAward() for a discretionary reversal.
     */
    public static function clawBack(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT * FROM scholarship_awards WHERE id = ?"); $s->execute([(int)$route['award_id']]);
        $w = $s->fetch();
        if (!$w) return Http::error($res, 'Award not found', 404);
        if ($w['status'] !== 'applied') return Http::error($res, 'This award is already reversed or clawed back.', 400);

        $outcome = self::enrollmentOutcome($pdo, $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null);
        if ($outcome === 'enrolled') return Http::error($res, 'This youth enrolled — the award was used and cannot be clawed back.', 400);
        $exp = self::awardExpiry($w['created_at'], 'applied', $outcome);
        // Only reclaim once it has actually expired, or the enrollment is already gone.
        if ($exp['state'] !== 'expired' && $outcome !== 'not_enrolled') {
            return Http::error($res, "This award hasn't expired yet (" . ($exp['days_left'] ?? '?') . " day(s) left). Reverse it manually if you must reclaim early.", 400);
        }
        $note = (($d = (array)$req->getParsedBody())['note'] ?? '') !== '' ? substr((string)$d['note'], 0, 300) : null;

        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE scholarship_awards SET status='clawed_back', clawed_back_at=NOW(), clawed_back_by_id=?, clawback_note=? WHERE id = ?")
                ->execute([(int)$cur['id'], $note, (int)$w['id']]);
            if ($w['enrollment_id']) {
                $pdo->prepare("UPDATE enrollments SET amount_due = COALESCE(amount_due,0) + ? WHERE id = ?")
                    ->execute([(float)$w['amount'], (int)$w['enrollment_id']]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not claw back the award.', 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'scholarship_awards', (int)$w['id'], 'clawback',
            null, ['amount' => (float)$w['amount'], 'fund_id' => $w['fund_id'] !== null ? (int)$w['fund_id'] : null, 'note' => $note]);
        $year = $w['enrollment_year'] !== null ? (int)$w['enrollment_year'] : self::currentYear();
        return Http::json($res, ['ok' => true, 'reclaimed' => (float)$w['amount']]
            + ($w['fund_id'] !== null ? self::fundAvailable($pdo, (int)$w['fund_id'], $year) : []));
    }

    // ── Phase 6: season close-out ────────────────────────────────────────────

    /**
     * GET /scholarships/season-closeout?year= — the end-of-season readiness summary used by the
     * Season Transition step: what the closing season allocated vs paid out, the UNSPENT balance
     * (which does NOT carry forward — D2), how many awards are still reclaimable (expired / youth
     * never enrolled) and should be clawed back before close, and how many applications are still
     * undecided. Read-only; the reclaim/decide actions stay staff-driven. Requires scholarships.applications.
     */
    public static function seasonCloseout(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $year = !empty($q['year']) ? (int)$q['year'] : self::currentYear();

        $funds = $pdo->query("SELECT id, name FROM scholarship_funds ORDER BY is_active DESC, name")->fetchAll();
        $tAlloc = 0; $tAward = 0;
        foreach ($funds as $f) {
            $b = self::fundAvailable($pdo, (int)$f['id'], $year);
            $tAlloc += $b['allocated']; $tAward += $b['awarded'];
        }

        // Still-reclaimable: applied awards whose youth hasn't enrolled and are past (or at) the
        // expiration window — money that should be returned to the fund before the season closes.
        $aw = $pdo->prepare("SELECT id, enrollment_id, amount, created_at FROM scholarship_awards WHERE enrollment_year = ? AND status = 'applied'");
        $aw->execute([$year]);
        $reclaimCount = 0; $reclaimAmt = 0.0;
        foreach ($aw->fetchAll() as $w) {
            $outcome = self::enrollmentOutcome($pdo, $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null);
            if ($outcome === 'enrolled') continue;
            $exp = self::awardExpiry($w['created_at'], 'applied', $outcome);
            if ($exp['state'] === 'expired' || $outcome === 'not_enrolled') { $reclaimCount++; $reclaimAmt += (float)$w['amount']; }
        }

        $openApps = (int)($pdo->query("SELECT COUNT(*) FROM scholarship_applications WHERE enrollment_year = " . (int)$year . " AND status IN ('pending','under_review')")->fetchColumn());

        $tAlloc = round($tAlloc, 2); $tAward = round($tAward, 2);
        return Http::json($res, [
            'year' => $year, 'year_label' => $year . '–' . ($year + 1),
            'allocated' => $tAlloc, 'awarded' => $tAward,
            'unspent' => round($tAlloc - $tAward, 2),   // forfeited — does NOT carry forward
            'reclaimable' => ['count' => $reclaimCount, 'amount' => round($reclaimAmt, 2)],
            'open_applications' => $openApps,
            'ready' => $reclaimCount === 0 && $openApps === 0,
        ]);
    }

    // ── Phase 5: TRCF Board report ───────────────────────────────────────────

    /**
     * GET /scholarships/board-report?year= — a printable season summary for the TRCF Board:
     * per-fund allocated/awarded/available (+ sponsor support), season totals with the
     * enrollment-outcome breakdown and reclaimed dollars, an itemized award list (recipient /
     * program / amount / outcome), and multi-year history (allocated vs paid out vs youth
     * helped) for grant writing. Confidential family aid — gated the same as the rest of the
     * module (`scholarships.applications`); an admin prints/shares the result with the Board.
     */
    public static function boardReport(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $year = !empty($q['year']) ? (int)$q['year'] : self::currentYear();

        // Per-fund figures for the season (skip funds with no money in or out that aren't active).
        $funds = $pdo->query("SELECT id, name, is_active FROM scholarship_funds ORDER BY is_active DESC, name")->fetchAll();
        $fundRows = []; $tAlloc = 0; $tAward = 0; $tAvail = 0; $tSponsor = 0;
        foreach ($funds as $f) {
            $b = self::fundAvailable($pdo, (int)$f['id'], $year);
            $c = $pdo->prepare("SELECT COUNT(*) FROM scholarship_awards WHERE fund_id = ? AND enrollment_year = ? AND status = 'applied'");
            $c->execute([(int)$f['id'], $year]);
            $awCount = (int)$c->fetchColumn();
            if (!$f['is_active'] && $b['allocated'] == 0 && $b['awarded'] == 0) continue;
            $fundRows[] = ['id' => (int)$f['id'], 'name' => $f['name'], 'is_active' => (bool)$f['is_active'], 'award_count' => $awCount] + $b;
            $tAlloc += $b['allocated']; $tAward += $b['awarded']; $tAvail += $b['available']; $tSponsor += $b['sponsor_support'];
        }

        // Itemized applied awards for the season, with recipient + program + enrollment outcome.
        $aw = $pdo->prepare(
            "SELECT aw.id, aw.amount, aw.created_at, aw.fund_id, aw.member_id, aw.enrollment_id, f.name AS fund_name,
                    TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS recipient, p.name AS program
               FROM scholarship_awards aw
               LEFT JOIN scholarship_funds f ON f.id = aw.fund_id
               LEFT JOIN members m ON m.id = aw.member_id
               LEFT JOIN enrollments e ON e.id = aw.enrollment_id
               LEFT JOIN programs p ON p.id = e.program_id
              WHERE aw.enrollment_year = ? AND aw.status = 'applied'
              ORDER BY aw.created_at, aw.id");
        $aw->execute([$year]);
        $awards = []; $outcomeCounts = ['enrolled' => 0, 'pending' => 0, 'not_enrolled' => 0, 'none' => 0];
        foreach ($aw->fetchAll() as $w) {
            $outcome = self::enrollmentOutcome($pdo, $w['enrollment_id'] !== null ? (int)$w['enrollment_id'] : null);
            if (isset($outcomeCounts[$outcome])) $outcomeCounts[$outcome]++;
            $awards[] = [
                'id' => (int)$w['id'], 'recipient' => trim((string)$w['recipient']) ?: null,
                'program' => $w['program'], 'fund_name' => $w['fund_name'],
                'amount' => (float)$w['amount'], 'date' => $w['created_at'] ? substr((string)$w['created_at'], 0, 10) : null,
                'outcome' => $outcome,
            ];
        }
        $youthHelped = (int)($pdo->query("SELECT COUNT(DISTINCT member_id) FROM scholarship_awards WHERE enrollment_year = " . (int)$year . " AND status = 'applied' AND member_id IS NOT NULL")->fetchColumn());
        $awardCount = count($awards);

        // Reclaimed (clawed back) this season.
        $rc = $pdo->prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM scholarship_awards WHERE enrollment_year = ? AND status = 'clawed_back'");
        $rc->execute([$year]);
        $rcRow = $rc->fetch() ?: ['c' => 0, 's' => 0];

        // Multi-year history across ALL funds: allocated in, paid out, youth helped.
        $hist = $pdo->query(
            "SELECT y AS year,
                    COALESCE((SELECT SUM(amount) FROM scholarship_fund_allocations WHERE enrollment_year = yrs.y), 0) AS allocated,
                    COALESCE((SELECT SUM(amount) FROM scholarship_awards WHERE enrollment_year = yrs.y AND status = 'applied'), 0) AS paid_out,
                    COALESCE((SELECT COUNT(DISTINCT member_id) FROM scholarship_awards WHERE enrollment_year = yrs.y AND status = 'applied' AND member_id IS NOT NULL), 0) AS youth_helped
               FROM (SELECT DISTINCT enrollment_year y FROM scholarship_fund_allocations
                     UNION SELECT DISTINCT enrollment_year FROM scholarship_awards WHERE enrollment_year IS NOT NULL) yrs
              ORDER BY y DESC")->fetchAll();
        $history = array_map(fn($h) => [
            'year' => (int)$h['year'], 'allocated' => round((float)$h['allocated'], 2),
            'paid_out' => round((float)$h['paid_out'], 2), 'youth_helped' => (int)$h['youth_helped'],
        ], $hist);

        return Http::json($res, [
            'year' => $year, 'year_label' => $year . '–' . ($year + 1),
            'generated_at' => date('c'),
            'summary' => [
                'funds_count' => count($fundRows),
                'total_allocated' => round($tAlloc, 2), 'total_awarded' => round($tAward, 2),
                'total_available' => round($tAvail, 2), 'total_sponsor_support' => round($tSponsor, 2),
                'youth_helped' => $youthHelped, 'award_count' => $awardCount,
                'avg_award' => $awardCount > 0 ? round($tAward / $awardCount, 2) : 0.0,
                'reclaimed_count' => (int)$rcRow['c'], 'reclaimed_total' => round((float)$rcRow['s'], 2),
                'outcomes' => $outcomeCounts,
            ],
            'funds' => $fundRows, 'awards' => $awards, 'history' => $history,
        ]);
    }

    /**
     * GET /scholarships/applications/{application_id}/enrollments — the enrollments an award can be
     * applied against: the applicant youth plus any family siblings, for the application's season,
     * each with youth name, program, and remaining balance. Lets the reviewer pick the enrollment(s)
     * by name instead of typing a meaningless numeric id, and award several siblings in a family.
     */
    public static function applicationEnrollments(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $a = self::app($pdo, (int)$route['application_id']);
        if (!$a) return Http::error($res, 'Application not found', 404);
        $year = (int)($a['enrollment_year'] ?? self::currentYear());
        $applicantId = $a['member_id'] !== null ? (int)$a['member_id'] : 0;

        // Scope: the applicant youth + any youth sharing a family with them.
        $youthIds = [];
        if ($applicantId) {
            $youthIds[$applicantId] = true;
            $fam = $pdo->prepare(
                "SELECT DISTINCT fm2.member_id
                   FROM family_members fm1
                   JOIN family_members fm2 ON fm2.family_id = fm1.family_id
                   JOIN members m ON m.id = fm2.member_id
                  WHERE fm1.member_id = ? AND m.member_type = 'youth'");
            $fam->execute([$applicantId]);
            foreach ($fam->fetchAll(\PDO::FETCH_COLUMN) as $yid) $youthIds[(int)$yid] = true;
        }
        if (!$youthIds) return Http::json($res, ['year' => $year, 'applicant_member_id' => $applicantId, 'enrollments' => []]);

        $in = implode(',', array_fill(0, count($youthIds), '?'));
        $st = $pdo->prepare(
            "SELECT e.id, e.member_id, e.amount_due, e.payment_amount, e.status,
                    TRIM(CONCAT(COALESCE(m.first_name,''),' ',COALESCE(m.last_name,''))) AS youth_name,
                    p.name AS program, p.full_name AS program_full
               FROM enrollments e
               JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
              WHERE e.member_id IN ($in) AND e.enrollment_year = ? AND e.status <> 'cancelled'
              ORDER BY (e.member_id = ?) DESC, m.first_name, m.last_name, p.name");
        $st->execute([...array_keys($youthIds), $year, $applicantId]);
        $rows = array_map(function ($e) {
            $balance = round((float)($e['amount_due'] ?? 0) - (float)($e['payment_amount'] ?? 0), 2);
            return [
                'enrollment_id' => (int)$e['id'], 'member_id' => (int)$e['member_id'],
                'youth_name' => trim((string)$e['youth_name']) ?: ('Youth #' . (int)$e['member_id']),
                'program' => $e['program_full'] ?: $e['program'] ?: 'Enrollment',
                'amount_due' => round((float)($e['amount_due'] ?? 0), 2),
                'paid' => round((float)($e['payment_amount'] ?? 0), 2),
                'balance' => $balance, 'status' => $e['status'],
            ];
        }, $st->fetchAll());
        return Http::json($res, ['year' => $year, 'applicant_member_id' => $applicantId, 'enrollments' => $rows]);
    }

    // ── Applicant: submit (during registration) ─────────────────────────────
    public static function submit(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();

        foreach (['contact_email', 'contact_name', 'contact_phone', 'program', 'youth_name'] as $req_f) {
            if (empty($d[$req_f])) return Http::error($res, 'Please complete all required fields.', 422);
        }

        // One scholarship application per youth per season. Block a resubmission while an
        // earlier application for the same youth is still in play; a declined/withdrawn one
        // may be re-applied. Match on the linked member when we have it, else on youth name.
        $year = self::currentYear();
        $mid  = ($d['member_id'] ?? '') === '' ? null : (int)$d['member_id'];
        if ($mid !== null) {
            $dupe = $pdo->prepare("SELECT id FROM scholarship_applications
                                    WHERE enrollment_year = ? AND member_id = ? AND status NOT IN ('declined','withdrawn') LIMIT 1");
            $dupe->execute([$year, $mid]);
        } else {
            $dupe = $pdo->prepare("SELECT id FROM scholarship_applications
                                    WHERE enrollment_year = ? AND member_id IS NULL
                                      AND LOWER(TRIM(youth_name)) = LOWER(TRIM(?)) AND status NOT IN ('declined','withdrawn') LIMIT 1");
            $dupe->execute([$year, (string)$d['youth_name']]);
        }
        if ($dupe->fetch()) {
            return Http::error($res, 'A scholarship application for this youth has already been submitted for this season. Please contact us if you need to update it.', 409);
        }
        $cost = isset($d['registration_cost']) && $d['registration_cost'] !== '' ? (float)$d['registration_cost'] : self::DEFAULT_COST;
        $contrib = ($d['contribution_amount'] ?? '') === '' ? null : (float)$d['contribution_amount'];
        $requested = $contrib !== null ? round(max(0, $cost - $contrib), 2) : null;
        // Extra questions we don't have typed columns for.
        $known = ['contact_email','contact_name','contact_phone','program','program_other','youth_name','youth_grade_school',
                  'choose_one','registration_cost','contribution_amount','received_before','narrative','referral','optional_info','member_id',
                  'household_size','youth_count','frl_eligible','need_explanation','certified'];
        $extra = array_diff_key($d, array_flip($known));

        $pdo->prepare(
            "INSERT INTO scholarship_applications
               (enrollment_year, status, submitted_by_id, member_id, contact_email, contact_name, contact_phone,
                program, program_other, youth_name, youth_grade_school, choose_one, household_size, youth_count,
                frl_eligible, certified, registration_cost, contribution_amount, amount_requested, received_before,
                narrative, need_explanation, referral, optional_info, answers, created_at)
             VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())"
        )->execute([
            self::currentYear(), (int)$cur['id'], ($d['member_id'] ?? '') === '' ? null : (int)$d['member_id'],
            $d['contact_email'], $d['contact_name'], $d['contact_phone'], $d['program'], $d['program_other'] ?? null,
            $d['youth_name'], $d['youth_grade_school'] ?? null, $d['choose_one'] ?? null,
            ($d['household_size'] ?? '') === '' ? null : (int)$d['household_size'],
            ($d['youth_count'] ?? '') === '' ? null : (int)$d['youth_count'],
            $d['frl_eligible'] ?? null, isset($d['certified']) ? (int)(bool)$d['certified'] : 0,
            $cost, $contrib, $requested, isset($d['received_before']) ? (int)(bool)$d['received_before'] : null,
            $d['narrative'] ?? null, $d['need_explanation'] ?? null, $d['referral'] ?? null, $d['optional_info'] ?? null,
            $extra ? json_encode($extra) : null,
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'scholarship_applications', $id, 'create', null, ['youth_name' => $d['youth_name'], 'program' => $d['program']]);
        $app = self::app($pdo, $id);
        if ($app) self::sendSubmissionEmails($pdo, $app);
        return Http::json($res, self::serialize($pdo, $app ?? []), 201);
    }

    /**
     * Fire both submission emails for an application: the staff notice and the applicant
     * confirmation. Independent and best-effort — one failing never blocks the other or
     * the caller. Takes the stored application row (not the raw request) so it can be
     * reused by submit() and the admin resend action.
     */
    private static function sendSubmissionEmails(PDO $pdo, array $a): void
    {
        self::notifyStaff($pdo, $a);
        self::confirmApplicant($pdo, $a);
    }

    /**
     * Tell the scholarship team a new application arrived, so it doesn't sit unseen in
     * the review queue. Recipient is the configurable "Scholarship applications" address
     * (Admin → Email Settings), defaulting to the org info box; Reply-To is the applicant
     * so staff can respond directly. Deliberately light on the confidential need details —
     * reviewers open the queue to see the full application.
     */
    private static function notifyStaff(PDO $pdo, array $a): void
    {
        if (!Mailer::enabled()) return;
        $to = trim(EmailSettingsController::scholarshipEmail($pdo));
        if ($to === '') $to = YouthContact::infoEmail();
        if ($to === '') return;

        $esc   = fn (?string $s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $money = fn ($n) => ($n === null || $n === '') ? '&mdash;' : '$' . number_format((float)$n, 2);
        $appUrl = rtrim((string)Config::get('APP_URL', ''), '/');
        $id = (int)$a['id'];

        $program = (string)($a['program'] ?? '');
        if ($program === 'Other' && !empty($a['program_other'])) $program .= ' (' . (string)$a['program_other'] . ')';
        $contact = (string)($a['contact_email'] ?? '');
        if (!empty($a['contact_phone'])) $contact .= ' &middot; ' . (string)$a['contact_phone'];

        $rows = '<p><strong>' . $esc($a['contact_name'] ?? '') . '</strong> submitted a scholarship application'
            . ' for <strong>' . $esc($a['youth_name'] ?? '') . '</strong>.</p>'
            . '<ul>'
            . '<li>Program: ' . $esc($program) . '</li>'
            . '<li>Registration cost: ' . $money($a['registration_cost'] ?? null) . '</li>'
            . '<li>Family contribution: ' . $money($a['contribution_amount'] ?? null) . '</li>'
            . '<li>Amount requested: ' . $money($a['amount_requested'] ?? null) . '</li>'
            . '<li>Contact: ' . $esc($contact) . '</li>'
            . '</ul>'
            . ($appUrl
                ? '<p><a href="' . $esc($appUrl . '/admin/scholarship-applications') . '">Review application #' . $id . ' in the scholarship queue</a></p>'
                : '<p>Review it in Admin &rarr; Scholarships (application #' . $id . ').</p>')
            . '<p style="color:#667;font-size:12px">Confidential family/minor application &mdash; please handle accordingly.</p>';
        $subject = 'New scholarship application: ' . (string)($a['youth_name'] ?? 'Applicant')
            . (($a['program'] ?? '') !== '' ? ' (' . (string)$a['program'] . ')' : '');
        $replyTo = filter_var((string)($a['contact_email'] ?? ''), FILTER_VALIDATE_EMAIL) ?: null;
        try {
            Mailer::send($to, $subject, Mailer::wrap('Scholarship application', $rows), strip_tags($rows), null, $replyTo);
        } catch (\Throwable $e) { /* best effort */ }
    }

    /**
     * Confirm to the family that we received their application and are reviewing it.
     * Sent to the contact email on the application; Reply-To is the scholarship team so
     * a reply reaches a human. No decision or dollar figures — just an acknowledgement.
     */
    private static function confirmApplicant(PDO $pdo, array $a): void
    {
        if (!Mailer::enabled()) return;
        $to = filter_var((string)($a['contact_email'] ?? ''), FILTER_VALIDATE_EMAIL);
        if (!$to) return;
        $team = trim(EmailSettingsController::scholarshipEmail($pdo)) ?: YouthContact::infoEmail();

        $esc  = fn (?string $s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $name = trim((string)($a['contact_name'] ?? ''));
        $youth = trim((string)($a['youth_name'] ?? ''));
        $rows = '<p>' . ($name !== '' ? 'Hi ' . $esc($name) . ',' : 'Hello,') . '</p>'
            . '<p>Thank you &mdash; we\'ve received your scholarship application'
            . ($youth !== '' ? ' for <strong>' . $esc($youth) . '</strong>' : '')
            . ' at Tulsa Robotics Center. Our team is reviewing it and will follow up with you about next steps.</p>'
            . '<p>You don\'t need to do anything further right now. If you have questions or need to update your application, just reply to this email'
            . ($team ? ' or contact us at ' . $esc($team) : '') . '.</p>'
            . '<p>Thank you,<br>Tulsa Robotics Center</p>';
        $replyTo = $team ?: null;
        try {
            Mailer::send($to, 'We received your scholarship application',
                Mailer::wrap('Scholarship application received', $rows), strip_tags($rows), null, $replyTo);
        } catch (\Throwable $e) { /* best effort */ }
    }

    /**
     * Admin: (re)send the submission emails for an application — the staff notice and
     * the applicant confirmation. Lets staff trigger notifications for an application
     * that predates the auto-send (e.g. Karen's #3) or resend if a family says the
     * confirmation never arrived. Gated on sponsors.manage; audited as 'notify'.
     */
    public static function resendNotifications(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $a = self::app($pdo, (int)$route['application_id']);
        if (!$a) return Http::error($res, 'Application not found', 404);
        if (!Mailer::enabled()) return Http::error($res, 'Email is not configured on the server, so nothing was sent.', 400);
        self::sendSubmissionEmails($pdo, $a);
        $staff = trim(EmailSettingsController::scholarshipEmail($pdo));
        Audit::write($pdo, (int)$cur['id'], 'scholarship_applications', (int)$a['id'], 'notify', null,
            ['to_staff' => $staff, 'to_applicant' => $a['contact_email']]);
        return Http::json($res, ['ok' => true, 'staff' => $staff, 'applicant' => $a['contact_email']]);
    }

    /**
     * GET /scholarship-applications/prefill — everything we already know, so the
     * family retypes as little as possible.
     *
     * Returns the signed-in adult's contact details and one entry per youth in their
     * household, each carrying the facts the form asks for: name, grade/school, the
     * program they're enrolled in, and — importantly — the ACTUAL registration cost
     * from their enrollment rather than a hardcoded figure, so a second or third
     * youth shows their discounted amount.
     *
     * Read-only and self-scoped: it never reveals anyone outside the caller's family.
     */
    public static function prefill(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $year = self::currentYear();

        // The caller's household. A youth applicant gets only themselves.
        $familyIds = [];
        $fs = $pdo->prepare("SELECT family_id FROM family_members WHERE member_id = ?");
        $fs->execute([(int)$cur['id']]);
        foreach ($fs->fetchAll() as $r) $familyIds[] = (int)$r['family_id'];

        $youth = [];
        if (($cur['member_type'] ?? '') === 'youth') {
            $ys = $pdo->prepare("SELECT * FROM members WHERE id = ?");
            $ys->execute([(int)$cur['id']]);
            $youth = $ys->fetchAll();
        } elseif ($familyIds) {
            $in = implode(',', array_fill(0, count($familyIds), '?'));
            $ys = $pdo->prepare(
                "SELECT DISTINCT m.* FROM family_members fm
                   JOIN members m ON m.id = fm.member_id
                  WHERE fm.family_id IN ($in) AND m.member_type = 'youth'
                    AND (m.is_archived = 0 OR m.is_archived IS NULL)
                  ORDER BY m.birthday IS NULL, m.birthday, m.first_name");
            $ys->execute($familyIds);
            $youth = $ys->fetchAll();
        }

        $enr = $pdo->prepare(
            "SELECT e.program_id, e.amount_due, p.name AS program_name
               FROM enrollments e LEFT JOIN programs p ON p.id = e.program_id
              WHERE e.member_id = ? AND e.enrollment_year = ? AND e.status <> 'cancelled'
              ORDER BY e.id DESC LIMIT 1");
        $prior = $pdo->prepare(
            "SELECT COUNT(*) FROM scholarship_awards WHERE member_id = ?");

        $out = [];
        foreach ($youth as $y) {
            $enr->execute([(int)$y['id'], $year]);
            $e = $enr->fetch() ?: [];
            $prior->execute([(int)$y['id']]);
            $out[] = [
                'member_id' => (int)$y['id'],
                'name' => trim($y['first_name'] . ' ' . $y['last_name']),
                'graduation_year' => $y['graduation_year'] !== null ? (int)$y['graduation_year'] : null,
                'school' => $y['school'] ?? null,
                'program_name' => $e['program_name'] ?? null,
                // Null when they have no enrollment yet — the form falls back to its
                // own default rather than showing a made-up number.
                'registration_cost' => isset($e['amount_due']) && $e['amount_due'] !== null ? (float)$e['amount_due'] : null,
                'received_before' => ((int)$prior->fetchColumn()) > 0,
            ];
        }

        // Household size is a starting point the family can correct — we only know
        // who is in the TRC family record, not who else lives at home.
        $householdSize = null;
        if ($familyIds) {
            $in = implode(',', array_fill(0, count($familyIds), '?'));
            $hs = $pdo->prepare("SELECT COUNT(DISTINCT member_id) FROM family_members WHERE family_id IN ($in)");
            $hs->execute($familyIds);
            $householdSize = (int)$hs->fetchColumn() ?: null;
        }

        return Http::json($res, [
            'contact_name' => trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? '')),
            'contact_email' => $cur['email'] ?: ($cur['guardian1_email'] ?? ''),
            'contact_phone' => $cur['phone'] ?? '',
            'youth' => $out,
            'youth_count' => count($out) ?: null,
            'household_size' => $householdSize,
            'enrollment_year' => $year,
        ]);
    }

    // ── Applicant: my own applications ──────────────────────────────────────
    public static function mine(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $s = $pdo->prepare("SELECT * FROM scholarship_applications WHERE submitted_by_id = ? ORDER BY created_at DESC");
        $s->execute([(int)$cur['id']]);
        return Http::json($res, array_map(fn($a) => self::serialize($pdo, $a), $s->fetchAll()));
    }

    // ── Admin: review queue ─────────────────────────────────────────────────
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['status'])) { $where[] = 'status = ?'; $args[] = $q['status']; }
        if (!empty($q['enrollment_year'])) { $where[] = 'enrollment_year = ?'; $args[] = (int)$q['enrollment_year']; }
        $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $s = $pdo->prepare("SELECT * FROM scholarship_applications $clause ORDER BY FIELD(status,'pending','under_review','approved','declined','withdrawn'), created_at DESC");
        $s->execute($args);
        return Http::json($res, array_map(fn($a) => self::serialize($pdo, $a, true, true), $s->fetchAll()));
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $a = self::app($pdo, (int)$route['application_id']);
        if (!$a) return Http::error($res, 'Application not found', 404);
        $owner = (int)($a['submitted_by_id'] ?? 0) === (int)$cur['id'];
        $staff = self::canView($pdo, $cur);   // reviewer-only fields only for staff, not the owner
        if (!$owner && !$staff) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::serialize($pdo, $a, true, $staff));
    }

    // ── Admin: record a review decision ─────────────────────────────────────
    public static function review(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $a = self::app($pdo, (int)$route['application_id']);
        if (!$a) return Http::error($res, 'Application not found', 404);
        $d = (array)$req->getParsedBody();
        $allowed = ['pending', 'under_review', 'approved', 'declined', 'withdrawn'];
        $set = ['reviewer_id = ?', 'reviewed_at = NOW()', 'updated_at = NOW()']; $args = [(int)$cur['id']];
        $statusChanged = false;
        if (!empty($d['status'])) {
            if (!in_array($d['status'], $allowed, true)) return Http::error($res, 'Invalid status.', 422);
            $set[] = 'status = ?'; $args[] = $d['status'];
            $statusChanged = ((string)$d['status'] !== (string)$a['status']);
        }
        if (array_key_exists('review_notes', $d)) { $set[] = 'review_notes = ?'; $args[] = $d['review_notes']; }
        if (array_key_exists('decision_amount', $d)) { $set[] = 'decision_amount = ?'; $args[] = ($d['decision_amount'] === '' || $d['decision_amount'] === null) ? null : (float)$d['decision_amount']; }
        $args[] = (int)$a['id'];
        $pdo->prepare("UPDATE scholarship_applications SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$cur['id'], 'scholarship_applications', (int)$a['id'], 'review', null, $d);
        // Keep the family in the loop on every status change (D6).
        if ($statusChanged) self::notifyApplicantStatus($pdo, self::app($pdo, (int)$a['id']), (string)$a['status'], (string)$d['status']);
        return Http::json($res, self::serialize($pdo, self::app($pdo, (int)$a['id']), true, true));
    }

    /**
     * Email the family when their application's status changes (D6 — all changes are
     * communicated). Best-effort; sent to the contact email, Reply-To the scholarship
     * team. Declined is worded gently and invites a reply.
     */
    private static function notifyApplicantStatus(PDO $pdo, ?array $a, string $from, string $to): void
    {
        if (!$a || !Mailer::enabled()) return;
        $email = filter_var((string)($a['contact_email'] ?? ''), FILTER_VALIDATE_EMAIL);
        if (!$email) return;
        $team = trim(EmailSettingsController::scholarshipEmail($pdo)) ?: YouthContact::infoEmail();

        $esc = fn (?string $s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
        $name = trim((string)($a['contact_name'] ?? ''));
        $youth = trim((string)($a['youth_name'] ?? ''));
        $forYouth = $youth !== '' ? ' for <strong>' . $esc($youth) . '</strong>' : '';

        $lines = [
            'pending'      => 'has been received and is <strong>pending review</strong>.',
            'under_review' => 'is now <strong>under review</strong> by our team &mdash; we\'ll follow up with a decision soon.',
            'approved'     => 'has been <strong>approved</strong>. Any scholarship applied toward enrollment fees will show on your family\'s balance, and we\'ll be in touch with next steps.',
            'declined'     => 'was <strong>not approved</strong> at this time. We\'d be glad to talk through other options &mdash; just reply to this email.',
            'withdrawn'    => 'has been <strong>withdrawn</strong>. If that isn\'t right, reply to this email and we\'ll sort it out.',
        ];
        $subjects = ['pending'=>'received','under_review'=>'under review','approved'=>'approved',
                     'declined'=>'reviewed','withdrawn'=>'withdrawn'];
        $body = $lines[$to] ?? ('status is now <strong>' . $esc(ucfirst(str_replace('_', ' ', $to))) . '</strong>.');
        $rows = '<p>' . ($name !== '' ? 'Hi ' . $esc($name) . ',' : 'Hello,') . '</p>'
            . '<p>Your scholarship application' . $forYouth . ' ' . $body . '</p>'
            . '<p>Thank you,<br>Tulsa Robotics Center</p>';
        $subject = 'Your scholarship application: ' . ($subjects[$to] ?? str_replace('_', ' ', $to));
        try {
            Mailer::send($email, $subject, Mailer::wrap('Scholarship application update', $rows),
                strip_tags($rows), null, ($team ?: null));
        } catch (\Throwable $e) { /* best effort */ }
    }

    // ── Admin: apply an award (fund → youth enrollment) ─────────────────────
    public static function award(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $a = self::app($pdo, (int)$route['application_id']);
        if (!$a) return Http::error($res, 'Application not found', 404);
        $d = (array)$req->getParsedBody();
        $fundId = (int)($d['fund_id'] ?? 0);
        $amount = round((float)($d['amount'] ?? 0), 2);
        $memberId = ($d['member_id'] ?? '') === '' ? ($a['member_id'] !== null ? (int)$a['member_id'] : null) : (int)$d['member_id'];
        $enrollmentId = ($d['enrollment_id'] ?? '') === '' ? null : (int)$d['enrollment_id'];
        if (!$fundId || $amount <= 0) return Http::error($res, 'Choose a fund and a positive amount.', 422);

        // Guard against over-drawing the fund — Phase 3: General-Fund allocations for this
        // application's season minus applied awards (decoupled from sponsor money).
        $year = (int)($a['enrollment_year'] ?? self::currentYear());
        $available = self::fundAvailable($pdo, $fundId, $year)['available'];
        if ($amount > $available + 0.001) return Http::error($res, "That exceeds the fund's available balance for {$year} (\${$available}).", 400);

        // Cap the award to the enrollment's remaining balance so the amount we
        // record == the amount we deduct == the amount a reversal restores. (No
        // GREATEST(0,…) floor, which would otherwise lose dollars and let a
        // reversal over-restore into a phantom balance.)
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
            $pdo->prepare(
                "INSERT INTO scholarship_awards (application_id, fund_id, member_id, enrollment_id, enrollment_year, amount, note, status, awarded_by_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?, NOW())"
            )->execute([(int)$a['id'], $fundId, $memberId, $enrollmentId, $year, $applied, $d['note'] ?? null, (int)$cur['id']]);
            $awardId = (int)$pdo->lastInsertId();

            if ($enrollmentId) {
                $fn = $pdo->prepare("SELECT name FROM scholarship_funds WHERE id = ?"); $fn->execute([$fundId]);
                $fundName = (string)($fn->fetchColumn() ?: 'Scholarship');
                $pdo->prepare(
                    "UPDATE enrollments
                        SET amount_due = COALESCE(amount_due,0) - ?, amount_due_overridden = 1, scholarship_fund = ?
                      WHERE id = ?"
                )->execute([$applied, $fundName, $enrollmentId]);
            }
            // Reflect the award on the application.
            $pdo->prepare("UPDATE scholarship_applications SET status = IF(status IN ('declined','withdrawn'), status, 'approved'), updated_at = NOW() WHERE id = ?")
                ->execute([(int)$a['id']]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not apply the award.', 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'scholarship_awards', $awardId, 'create',
            null, ['application_id' => (int)$a['id'], 'fund_id' => $fundId, 'amount' => $applied, 'enrollment_id' => $enrollmentId]);
        return Http::json($res, self::serialize($pdo, self::app($pdo, (int)$a['id']), true, true));
    }

    // ── Admin: reverse an award ─────────────────────────────────────────────
    public static function reverseAward(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT * FROM scholarship_awards WHERE id = ?"); $s->execute([(int)$route['award_id']]);
        $w = $s->fetch();
        if (!$w) return Http::error($res, 'Award not found', 404);
        if ($w['status'] !== 'applied') return Http::error($res, 'Award is already reversed.', 400);
        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE scholarship_awards SET status='reversed', reversed_at=NOW() WHERE id = ?")->execute([(int)$w['id']]);
            if ($w['enrollment_id']) {
                $pdo->prepare("UPDATE enrollments SET amount_due = COALESCE(amount_due,0) + ? WHERE id = ?")
                    ->execute([(float)$w['amount'], (int)$w['enrollment_id']]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not reverse the award.', 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'scholarship_awards', (int)$w['id'], 'reverse', null, ['amount' => (float)$w['amount']]);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * DELETE /scholarships/applications/{id} — remove an application (e.g. a duplicate).
     * Refuses when a live (applied) award is attached so fund/enrollment accounting is
     * never orphaned — reverse the award first. Historical (reversed/clawed-back) award
     * rows are kept for the ledger with their application_id unlinked.
     */
    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canDelete($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $a = self::app($pdo, (int)$route['application_id']);
        if (!$a) return Http::error($res, 'Application not found', 404);

        $live = $pdo->prepare("SELECT COUNT(*) FROM scholarship_awards WHERE application_id = ? AND status = 'applied'");
        $live->execute([(int)$a['id']]);
        if ((int)$live->fetchColumn() > 0) {
            return Http::error($res, 'This application has an active award. Reverse the award before deleting the application.', 409);
        }

        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE scholarship_awards SET application_id = NULL WHERE application_id = ?")->execute([(int)$a['id']]);
            $pdo->prepare("DELETE FROM scholarship_applications WHERE id = ?")->execute([(int)$a['id']]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not delete the application.', 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'scholarship_applications', (int)$a['id'], 'delete',
            ['youth_name' => $a['youth_name'] ?? null, 'status' => $a['status'] ?? null], null);
        return Http::json($res, ['ok' => true]);
    }
}
