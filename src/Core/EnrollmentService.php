<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Port of app/modules/enrollment/service.py + app/core/exemptions.py.
 * Participation rules by member type (used by /me and the check-in toggle).
 */
final class EnrollmentService
{
    // Only the single System Administrator account (a technical/system login, not a real person) is
    // role-exempt from compliance. Admin members are real people — often mentors — and are tracked.
    private const EXEMPT_ROLES = ['System Administrator'];

    /**
     * The calendar month (1–12) on which the FIRST season rolls over. On/after this
     * month the "current season" is (thisYear → thisYear+1); before it, it's the
     * prior pair. This is the SINGLE source of truth for the season boundary — every
     * controller derives the current season from here, so changing it is one edit.
     * (July = 7; historically August = 8.)
     */
    public const SEASON_START_MONTH = 7;

    /**
     * Season cutover for TIME TRACKING (My Time / activity hours), separate from enrollment.
     * The competition season ends at Worlds (April), so hours logged AFTER that — the May/June
     * off-season and summer — should count toward the NEW season, not the one that just ended.
     * Enrollment keeps its July boundary (SEASON_START_MONTH); this only buckets time entries.
     * (#193) May = 5. Team-linked entries still follow their team's season and ignore this.
     */
    public const TIME_SEASON_START_MONTH = 5;

    /**
     * The T&C / enrollment grace deadline. Members who signed last year keep
     * participating into the new season until this date, giving families a long
     * window to renew. Currently 8/31 of the season-start year (July 1 → Aug 31,
     * well over 30 days). SINGLE source of truth — see graceWindow().
     */
    public const GRACE_END_MONTH = 8;
    public const GRACE_END_DAY   = 31;

    public static function currentEnrollmentYear(): int
    {
        return ((int)date('n') >= self::SEASON_START_MONTH) ? (int)date('Y') : (int)date('Y') - 1;
    }

    public static function yearLabel(int $y): string { return $y . '-' . ($y + 1); }

    /**
     * Grace window for a given season-start year: opens on the season start
     * (SEASON_START_MONTH/01) and closes on GRACE_END_MONTH/GRACE_END_DAY, both
     * in that same calendar year. Returns ['start' => 'Y-m-d', 'end' => 'Y-m-d'].
     */
    public static function graceWindow(int $seasonYear): array
    {
        return [
            'start' => sprintf('%04d-%02d-01', $seasonYear, self::SEASON_START_MONTH),
            'end'   => sprintf('%04d-%02d-%02d', $seasonYear, self::GRACE_END_MONTH, self::GRACE_END_DAY),
        ];
    }

    /** Current season as a "YYYY-YYYY" label (e.g. "2026-2027"). */
    public static function currentSeason(): string { return self::yearLabel(self::currentEnrollmentYear()); }

    private static function activeRoleNames(PDO $pdo, int $memberId): array
    {
        $stmt = $pdo->prepare(
            "SELECT sr.name FROM member_system_roles msr JOIN system_roles sr ON sr.id = msr.role_id
             WHERE msr.member_id = ? AND sr.is_active = true"
        );
        $stmt->execute([$memberId]);
        return array_column($stmt->fetchAll(), 'name');
    }

    public static function isMemberExempt(PDO $pdo, array $member): bool
    {
        if (!empty($member['is_compliance_exempt'])) return true;
        return (bool)array_intersect(self::activeRoleNames($pdo, (int)$member['id']), self::EXEMPT_ROLES);
    }

    public static function exemptStatus(PDO $pdo, array $member): array
    {
        $explicit = !empty($member['is_compliance_exempt']);
        $roleBased = (bool)array_intersect(self::activeRoleNames($pdo, (int)$member['id']), self::EXEMPT_ROLES);
        return [
            'exempt' => $explicit || $roleBased,
            'explicit_flag' => $explicit,
            'role_based' => $roleBased,
            'reason' => ($roleBased && !$explicit) ? 'System Administrator account'
                : ($explicit ? 'Manually exempted' : null),
        ];
    }

    private static function noAccess(int $year, bool $requiresEnrollment = false): array
    {
        return [
            'can_participate' => false, 'enrolled' => false, 'enrollment_year' => $year,
            'in_grace_period' => false, 'requires_enrollment' => $requiresEnrollment,
            'requires_tc' => false, 'tc_ok' => false,
        ];
    }

    private static function annualTc(PDO $pdo, int $memberId, int $year): ?array
    {
        $stmt = $pdo->prepare("SELECT * FROM member_annual_tc WHERE member_id = ? AND enrollment_year = ?");
        $stmt->execute([$memberId, $year]);
        return $stmt->fetch() ?: null;
    }

    /**
     * Whether a member's annual TRC T&C for a season is fully signed. Season-level source of
     * truth (member_annual_tc — one signature per member per season), falling back to a given
     * enrollment row's legacy per-enrollment flags only when no unified row exists yet. Use this
     * everywhere a "needs to sign T&C" decision is made, so the dashboard nag, the check-in gate,
     * and the account card all agree — a signed season shouldn't nag just because one enrollment
     * (e.g. one added after signing) still has blank per-enrollment flags.
     */
    public static function seasonTcSigned(PDO $pdo, int $memberId, int $year, ?array $enrollment = null): bool
    {
        $tc = self::annualTc($pdo, $memberId, $year);
        if ($tc) return !empty($tc['signed_at']) && !empty($tc['parent_signed_at']);
        return $enrollment ? (!empty($enrollment['tc_youth_agreed']) && !empty($enrollment['tc_parent_agreed'])) : false;
    }

    public static function status(PDO $pdo, int $memberId): array
    {
        $today = date('Y-m-d');
        $currentYear = self::currentEnrollmentYear();
        $prevYear = $currentYear - 1;
        $grace = self::graceWindow($currentYear);
        $graceStart = $grace['start'];
        $graceEnd = $grace['end'];
        $inGrace = ($today >= $graceStart && $today <= $graceEnd);
        $graceDays = (int)floor((strtotime($graceEnd) - strtotime($today)) / 86400);

        $mstmt = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $mstmt->execute([$memberId]);
        $member = $mstmt->fetch();
        if (!$member) return self::noAccess($currentYear);

        if (!empty($member['is_kiosk'])) {
            return ['can_participate' => true, 'enrolled' => true, 'enrollment_year' => $currentYear,
                'in_grace_period' => false, 'requires_enrollment' => false, 'requires_tc' => false,
                'tc_ok' => true, 'kiosk' => true];
        }
        if (self::isMemberExempt($pdo, $member)) {
            $info = self::exemptStatus($pdo, $member);
            return ['can_participate' => true, 'enrolled' => true, 'enrollment_year' => $currentYear,
                'in_grace_period' => false, 'requires_enrollment' => false, 'requires_tc' => false,
                'tc_ok' => true, 'exempt' => true, 'exempt_reason' => $info['reason']];
        }

        $mtype = $member['member_type'];
        if ($mtype === 'parent' || $mtype === 'volunteer') {
            return ['can_participate' => true, 'enrolled' => true, 'enrollment_year' => $currentYear,
                'in_grace_period' => false, 'requires_enrollment' => false, 'requires_tc' => false, 'tc_ok' => true];
        }

        if ($mtype === 'mentor') {
            $tc = self::annualTc($pdo, $memberId, $currentYear);
            if ($tc) {
                return ['can_participate' => true, 'enrolled' => true, 'enrollment_year' => $currentYear,
                    'in_grace_period' => false, 'requires_enrollment' => false, 'requires_tc' => true, 'tc_ok' => true,
                    'tc_signed_at' => Time::naiveIso($tc['signed_at'] ?? null)];
            }
            if ($inGrace && self::annualTc($pdo, $memberId, $prevYear)) {
                return ['can_participate' => true, 'enrolled' => false, 'enrollment_year' => $currentYear,
                    'in_grace_period' => true, 'grace_days_remaining' => $graceDays, 'grace_ends' => $graceEnd,
                    'requires_enrollment' => false, 'requires_tc' => true, 'tc_ok' => true];
            }
            return ['can_participate' => false, 'enrolled' => false, 'enrollment_year' => $currentYear,
                'in_grace_period' => false, 'requires_enrollment' => false, 'requires_tc' => true, 'tc_ok' => false];
        }

        // Youth: enrollment + T&C
        // A completed enrollment is 'paid' when money changed hands and 'active' when it
        // was comped/zero-fee — both mean "enrolled". Matching only 'active' here is what
        // made paid youth show as "not enrolled" on login and the compliance page.
        // 'pending' is deliberately excluded: those youth fall through to the grace
        // branch below, which is what keeps them participating while they finish paying.
        $estmt = $pdo->prepare("SELECT * FROM enrollments WHERE member_id = ? AND enrollment_year = ?
                                  AND status IN ('active', 'paid') ORDER BY FIELD(status, 'paid', 'active') LIMIT 1");
        $estmt->execute([$memberId, $currentYear]);
        $en = $estmt->fetch();
        if ($en) {
            // Fee is settled when money changed hands, an admin overrode it, OR a scholarship
            // (or other credit) covers the balance. A scholarship lowers what's owed without a
            // cash payment, so date_payment stays empty — matching only date_payment/override
            // wrongly blocked scholarship youth at check-in with "fee not paid".
            $amountDue = $en['amount_due'] !== null ? (float)$en['amount_due'] : null;
            $paid = $en['payment_amount'] !== null ? (float)$en['payment_amount'] : 0.0;
            $cs = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM scholarship_awards WHERE enrollment_id = ? AND status = 'applied'");
            $cs->execute([(int)$en['id']]);
            $credit = (float)$cs->fetchColumn();
            $coveredByCredit = $amountDue !== null && ($amountDue - $paid - $credit) <= 0.005;
            $paymentOk = !empty($en['date_payment']) || !empty($en['payment_override']) || $coveredByCredit;
            // Unified annual T&C: a youth is covered when both their own and a
            // guardian's signature are on file in member_annual_tc. Fall back to the
            // legacy enrollment flags if no unified row exists yet (pre-migration).
            $tc = self::annualTc($pdo, $memberId, $currentYear);
            $tcOk = $tc
                ? (!empty($tc['signed_at']) && !empty($tc['parent_signed_at']))
                : (!empty($en['tc_youth_agreed']) && !empty($en['tc_parent_agreed']));
            return ['can_participate' => $paymentOk && $tcOk, 'enrolled' => true, 'enrollment_year' => $currentYear,
                'in_grace_period' => false, 'requires_enrollment' => true, 'requires_tc' => true,
                'payment_ok' => $paymentOk, 'tc_ok' => $tcOk];
        }
        if ($inGrace) {
            $px = $pdo->prepare("SELECT * FROM enrollments WHERE member_id = ? AND enrollment_year = ? LIMIT 1");
            $px->execute([$memberId, $prevYear]);
            $prevEn = $px->fetch();
            if ($prevEn) {
                // Grace covers a returning member — but only if last season's T&C was
                // actually on file. If it was reset/unsigned, the reset must take
                // effect here too, so tc_ok reflects the real signatures.
                $prevTc = self::annualTc($pdo, $memberId, $prevYear);
                $tcOk = $prevTc
                    ? (!empty($prevTc['signed_at']) && !empty($prevTc['parent_signed_at']))
                    : (!empty($prevEn['tc_youth_agreed']) && !empty($prevEn['tc_parent_agreed']));
                return ['can_participate' => $tcOk, 'enrolled' => false, 'enrollment_year' => $currentYear,
                    'in_grace_period' => true, 'grace_days_remaining' => $graceDays, 'grace_ends' => $graceEnd,
                    'requires_enrollment' => true, 'requires_tc' => true, 'payment_ok' => true, 'tc_ok' => $tcOk];
            }
        }
        // No active/paid enrollment and no grace coverage — e.g. a NEW self-signup whose
        // enrollment is still 'pending'. They may still have SIGNED their T&C, so read it
        // from the source of truth (member_annual_tc, falling back to a pending
        // enrollment's flags) rather than reporting a blanket "not completed" on the
        // compliance screen. They remain not-enrolled until they finish enrolling/paying.
        $tc = self::annualTc($pdo, $memberId, $currentYear);
        $pendEn = null;
        if (!$tc) {
            $pe = $pdo->prepare("SELECT tc_youth_agreed, tc_parent_agreed FROM enrollments
                                  WHERE member_id = ? AND enrollment_year = ? ORDER BY id DESC LIMIT 1");
            $pe->execute([$memberId, $currentYear]);
            $pendEn = $pe->fetch() ?: null;
        }
        $tcOk = $tc
            ? (!empty($tc['signed_at']) && !empty($tc['parent_signed_at']))
            : (!empty($pendEn['tc_youth_agreed']) && !empty($pendEn['tc_parent_agreed']));
        // Only assert a T&C requirement when they're actually in the enrollment process
        // (a current-year enrollment exists) or they've partially signed.
        $requiresTc = $tcOk || $tc !== null || $pendEn !== null;
        return [
            'can_participate' => false, 'enrolled' => false, 'enrollment_year' => $currentYear,
            'in_grace_period' => false, 'requires_enrollment' => true, 'requires_tc' => $requiresTc,
            'tc_ok' => $tcOk,
        ];
    }

    public static function mentorTcStatus(PDO $pdo, int $memberId): array
    {
        $today = date('Y-m-d');
        $currentYear = self::currentEnrollmentYear();
        $prevYear = $currentYear - 1;
        $grace = self::graceWindow($currentYear);
        $graceStart = $grace['start'];
        $graceEnd = $grace['end'];
        $inGrace = ($today >= $graceStart && $today <= $graceEnd);
        $graceDays = (int)floor((strtotime($graceEnd) - strtotime($today)) / 86400);
        $tc = self::annualTc($pdo, $memberId, $currentYear);
        $prevTc = self::annualTc($pdo, $memberId, $prevYear);
        return [
            'current_year' => $currentYear,
            'current_year_label' => self::yearLabel($currentYear),
            'signed_current_year' => $tc !== null,
            'signed_at' => ($tc && !empty($tc['signed_at'])) ? Time::naiveIso($tc['signed_at']) : null,
            'in_grace_period' => $inGrace && $prevTc !== null && $tc === null,
            'grace_ends' => $inGrace ? $graceEnd : null,
            'grace_days_remaining' => $inGrace ? $graceDays : null,
            'prev_year' => $prevYear,
            'signed_prev_year' => $prevTc !== null,
        ];
    }
}
