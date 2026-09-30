<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\EnrollmentService;
use App\Core\Grade;
use App\Core\Http;
use App\Core\PaymentReceipt;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/enrollment/router.py */
final class EnrollmentController
{
    private static function year(): int { return EnrollmentService::currentEnrollmentYear(); }

    /** Configured fee schedule: ['base' => float, 'additional_program' => float]. */
    private static function fees(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'enrollment_fees'");
        $s->execute();
        $v = ($r = $s->fetch()) && $r['values'] ? json_decode($r['values'], true) : [];
        $base = (float)($v['base'] ?? 0);
        return [
            'base' => $base,
            'additional_program' => (float)($v['additional_program'] ?? 0),
            // Multi-sibling discounts on the FIRST-program fee (#66). Fall back to base when unset.
            'second_youth_base' => isset($v['second_youth_base']) ? (float)$v['second_youth_base'] : $base,
            'third_plus_youth_base' => isset($v['third_plus_youth_base']) ? (float)$v['third_plus_youth_base'] : $base,
        ];
    }

    /**
     * A youth's sibling rank within their family for the year (1-based), by enrollment
     * order: 1 + the number of OTHER youth in the same family already enrolled this year.
     * Members not in a family are always rank 1.
     */
    private static function siblingRank(PDO $pdo, int $memberId, int $year): int
    {
        $f = $pdo->prepare("SELECT family_id FROM family_members WHERE member_id = ?");
        $f->execute([$memberId]);
        $familyId = ($r = $f->fetch()) ? (int)$r['family_id'] : null;
        if (!$familyId) return 1;
        $s = $pdo->prepare(
            "SELECT COUNT(DISTINCT e.member_id) FROM enrollments e
             JOIN family_members fm ON fm.member_id = e.member_id
             JOIN members mm ON mm.id = e.member_id
             WHERE fm.family_id = ? AND e.member_id <> ? AND e.enrollment_year = ?
               AND e.status <> 'cancelled' AND mm.member_type = 'youth'"
        );
        $s->execute([$familyId, $memberId, $year]);
        return (int)$s->fetchColumn() + 1;
    }

    /**
     * Auto-calculated amount due. First program that year is charged the first-program
     * fee, tiered by the youth's sibling rank (base / 2nd-youth / 3rd+-youth, #66);
     * every program beyond the first is the additional-program fee.
     */
    private static function computeAmountDue(PDO $pdo, int $memberId, int $year, int $programId): float
    {
        $fees = self::fees($pdo);
        $s = $pdo->prepare("SELECT COUNT(*) FROM enrollments WHERE member_id = ? AND enrollment_year = ? AND program_id <> ? AND status <> 'cancelled'");
        $s->execute([$memberId, $year, $programId]);
        $others = (int)$s->fetchColumn();
        if ($others > 0) return $fees['additional_program'];
        $rank = self::siblingRank($pdo, $memberId, $year);
        if ($rank >= 3) return $fees['third_plus_youth_base'];
        if ($rank === 2) return $fees['second_youth_base'];
        return $fees['base'];
    }

    /**
     * Create the roster placeholder enrollment for a youth who signed themselves up
     * from a join link. Same shape the season rollover produces: status 'pending',
     * amount_due auto-tiered, awaiting T&C + shirt size + payment, at which point
     * promotePendingIfComplete() flips it to active/paid.
     *
     * amount_due comes from computeAmountDue, so the family discount applies as long
     * as the family link exists and siblings are enrolled in order — the second youth
     * gets the 2nd-youth rate, the third and beyond the 3rd+ rate, and a second program
     * for the same youth the additional-program rate.
     *
     * Idempotent: returns null if that member already has this program for the year.
     *
     * @return array{enrollment_id:int,amount_due:float,rank:int}|null
     */
    public static function createSelfSignupEnrollment(PDO $pdo, int $memberId, int $programId, ?int $year = null): ?array
    {
        $year = $year ?? self::year();
        if ($memberId <= 0 || $programId <= 0) return null;

        // Only youth are enrolled. A parent account never carries an enrollment.
        $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $mt->execute([$memberId]);
        if (($mt->fetchColumn() ?: '') !== 'youth') return null;

        $ex = $pdo->prepare("SELECT id FROM enrollments WHERE member_id = ? AND program_id = ? AND enrollment_year = ?");
        $ex->execute([$memberId, $programId, $year]);
        if ($ex->fetch()) return null;

        $rank = self::siblingRank($pdo, $memberId, $year);
        $amt = self::computeAmountDue($pdo, $memberId, $year, $programId);
        $now = date('Y-m-d H:i:s');
        $pdo->prepare(
            "INSERT INTO enrollments (member_id, program_id, enrollment_year, status, date_enrolled,
                amount_due, amount_due_overridden, notes, auto_created_at, auto_created_by_id, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?, NULL, ?, ?)")
            ->execute([$memberId, $programId, $year, date('Y-m-d'), $amt,
                'Created from the family self-signup link', $now, $now, $now]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, null, 'enrollments', $id, 'create', null,
            ['from' => 'visitor_self_signup', 'member_id' => $memberId, 'program_id' => $programId,
             'enrollment_year' => $year, 'amount_due' => $amt, 'sibling_rank' => $rank]);
        // A self-signup into FTC/FRC/FDP also puts the youth on the FDP roster.
        self::ensureFdpMembership($pdo, $memberId, $programId, $year, null);
        return ['enrollment_id' => $id, 'amount_due' => $amt, 'rank' => $rank];
    }

    private static function serialize(array $e): array
    {
        return [
            'id' => (int)$e['id'], 'member_id' => (int)$e['member_id'],
            'program_id' => $e['program_id'] !== null ? (int)$e['program_id'] : null,
            'program_name' => $e['program_name'] ?? null,
            'program_full_name' => $e['program_full_name'] ?? null,
            'enrollment_year' => (int)$e['enrollment_year'],
            'enrollment_year_label' => $e['enrollment_year'] . '–' . ($e['enrollment_year'] + 1),
            'status' => $e['status'],
            'date_enrolled' => $e['date_enrolled'], 'date_payment' => $e['date_payment'],
            'payment_amount' => $e['payment_amount'] !== null ? (float)$e['payment_amount'] : null,
            'amount_due' => isset($e['amount_due']) && $e['amount_due'] !== null ? (float)$e['amount_due'] : null,
            'amount_due_overridden' => (bool)($e['amount_due_overridden'] ?? false),
            'balance' => round((float)($e['amount_due'] ?? 0) - (float)($e['payment_amount'] ?? 0), 2),
            'payment_override' => isset($e['payment_override']) ? (bool)$e['payment_override'] : null,
            'payment_method' => $e['payment_method'], 'payment_reference' => $e['payment_reference'],
            'scholarship_fund' => $e['scholarship_fund'],
            // Fall back to the member's size so registration shows what we last had on
            // file rather than an empty box, while the enrollment keeps its own value.
            'shirt_size' => $e['member_shirt_size'] ?? null,   // single source: members.shirt_size
            'member_birthday' => $e['member_birthday'] ?? null,
            'member_type' => $e['member_type'] ?? null,
            'grade' => isset($e['graduation_year']) ? Grade::fromGraduationYear((int)$e['graduation_year']) : null,
            'grade_label' => isset($e['graduation_year']) ? Grade::label(Grade::fromGraduationYear((int)$e['graduation_year'])) : null,
            'tc_youth_agreed' => (bool)$e['tc_youth_agreed'], 'tc_youth_date' => Time::naiveIso($e['tc_youth_date']),
            'tc_parent_agreed' => (bool)$e['tc_parent_agreed'], 'tc_parent_date' => Time::naiveIso($e['tc_parent_date']),
            'fully_signed' => (bool)$e['tc_youth_agreed'] && (bool)$e['tc_parent_agreed'],
            'notes' => $e['notes'], 'created_at' => Time::naiveIso($e['created_at'] ?? null),
        ];
    }

    /**
     * A clear money breakdown for one enrollment, built from the real records rather than
     * the single denormalized fields: the registration fee, scholarship credits (from the
     * active award rows), the actual payments (card/online from the payments table plus any
     * separately recorded manual payment), and the outstanding balance. `amount_due` already
     * sits net of any active award (the award lowered it; a reversal restored it), so the
     * gross fee is amount_due + the active scholarship credit.
     */
    private static function financials(PDO $pdo, array $e): array
    {
        $eid = (int)$e['id'];
        $amountDue = round((float)($e['amount_due'] ?? 0), 2);
        $paidTotal = round((float)($e['payment_amount'] ?? 0), 2);

        // Active scholarship credits only (reversed / clawed-back awards are excluded).
        $aw = $pdo->prepare("SELECT a.amount, a.created_at, COALESCE(f.name, a.note) AS fund_name
                               FROM scholarship_awards a
                          LEFT JOIN scholarship_funds f ON f.id = a.fund_id
                              WHERE a.enrollment_id = ? AND a.status = 'applied'
                           ORDER BY a.created_at");
        $aw->execute([$eid]);
        $scholarshipLines = []; $credit = 0.0;
        foreach ($aw->fetchAll() as $r) {
            $amt = round((float)$r['amount'], 2); $credit += $amt;
            $scholarshipLines[] = ['amount' => $amt, 'fund_name' => $r['fund_name'] ?: 'Scholarship',
                                   'date' => substr((string)$r['created_at'], 0, 10)];
        }
        $credit = round($credit, 2);

        // Itemized payments: card/online from the payments table, then any manual payment
        // recorded straight on the enrollment (check/cash) as the remainder.
        $pm = $pdo->prepare("SELECT pe.base_amount, p.provider, p.paid_at, p.provider_ref
                               FROM payment_enrollments pe JOIN payments p ON p.id = pe.payment_id
                              WHERE pe.enrollment_id = ? AND p.status = 'paid'
                           ORDER BY p.paid_at");
        $pm->execute([$eid]);
        $paymentLines = []; $cardTotal = 0.0;
        foreach ($pm->fetchAll() as $r) {
            $amt = round((float)$r['base_amount'], 2); $cardTotal += $amt;
            $paymentLines[] = ['amount' => $amt, 'method' => ucfirst((string)($r['provider'] ?: 'card')),
                               'date' => substr((string)($r['paid_at'] ?? ''), 0, 10) ?: null, 'reference' => $r['provider_ref'] ?: null];
        }
        $manual = round($paidTotal - round($cardTotal, 2), 2);
        if ($manual > 0.005) {
            $paymentLines[] = ['amount' => $manual, 'method' => $e['payment_method'] ?: 'Recorded payment',
                               'date' => $e['date_payment'] ?? null, 'reference' => $e['payment_reference'] ?: null];
        }

        // School / activity-fund payments (#196): these reduce amount_due like a scholarship but
        // were invisible in the ledger — the family just saw the balance drop with no line for it.
        // Show them as credits and add them back into the gross fee (amount_due sits net of them).
        $sp = $pdo->prepare("SELECT sp.amount, sp.created_at, s.name AS school_name
                               FROM school_payments sp LEFT JOIN schools s ON s.id = sp.school_id
                              WHERE sp.enrollment_id = ? AND sp.status <> 'reversed'
                           ORDER BY sp.created_at");
        $sp->execute([$eid]);
        $schoolLines = []; $schoolCredit = 0.0;
        foreach ($sp->fetchAll() as $r) {
            $amt = round((float)$r['amount'], 2); $schoolCredit += $amt;
            $schoolLines[] = ['amount' => $amt, 'source' => $r['school_name'] ?: 'School / activity fund',
                              'date' => substr((string)$r['created_at'], 0, 10)];
        }
        $schoolCredit = round($schoolCredit, 2);

        return [
            'fee_gross' => round($amountDue + $credit + $schoolCredit, 2),
            'scholarship_credit' => $credit,
            'scholarship_lines' => $scholarshipLines,
            'school_credit' => $schoolCredit,
            'school_lines' => $schoolLines,
            'payment_lines' => $paymentLines,
            'paid_total' => $paidTotal,
            'balance' => round($amountDue - $paidTotal, 2),
        ];
    }

    /** Season-level T&C signatures — shared by every enrollment a member has that year. */
    private static function seasonTc(PDO $pdo, int $memberId, int $year): array
    {
        $s = $pdo->prepare("SELECT signed_at, parent_signed_at FROM member_annual_tc WHERE member_id = ? AND enrollment_year = ?");
        $s->execute([$memberId, $year]);
        $r = $s->fetch() ?: [];
        return ['youth_signed_at' => $r['signed_at'] ?? null, 'parent_signed_at' => $r['parent_signed_at'] ?? null];
    }

    /**
     * serialize() plus the money breakdown and season-consistent T&C. T&C is one signature
     * per member per season (member_annual_tc), so a completed signature there — or on ANY of
     * the member's enrollments that year — counts for every enrollment, fixing the case where
     * an enrollment added after signing kept stale per-enrollment flags.
     */
    private static function serializeFull(PDO $pdo, array $e): array
    {
        $out = self::serialize($e);
        $out['financials'] = self::financials($pdo, $e);
        $tc = self::seasonTc($pdo, (int)$e['member_id'], (int)$e['enrollment_year']);
        $youth  = $out['tc_youth_agreed']  || !empty($tc['youth_signed_at']);
        $parent = $out['tc_parent_agreed'] || !empty($tc['parent_signed_at']);
        $out['tc_youth_agreed']  = $youth;
        $out['tc_parent_agreed'] = $parent;
        $out['tc_youth_date']  = $out['tc_youth_date']  ?? Time::naiveIso($tc['youth_signed_at'] ?? null);
        $out['tc_parent_date'] = $out['tc_parent_date'] ?? Time::naiveIso($tc['parent_signed_at'] ?? null);
        $out['fully_signed'] = $youth && $parent;
        return $out;
    }

    /** Current waiver/consent state for a member's season (from member_annual_tc). */
    private static function waiverState(PDO $pdo, int $memberId, int $year): array
    {
        $s = $pdo->prepare("SELECT waiver_liability_agreed, waiver_firstaid_agreed, waiver_privacy_agreed,
                                   media_release_granted, waivers_agreed_at
                            FROM member_annual_tc WHERE member_id = ? AND enrollment_year = ?");
        $s->execute([$memberId, $year]);
        $r = $s->fetch() ?: [];
        $mr = $r['media_release_granted'] ?? null;
        return [
            'waiver_liability_agreed' => (bool)($r['waiver_liability_agreed'] ?? false),
            'waiver_firstaid_agreed' => (bool)($r['waiver_firstaid_agreed'] ?? false),
            'waiver_privacy_agreed' => (bool)($r['waiver_privacy_agreed'] ?? false),
            'media_release_granted' => $mr === null ? null : (bool)$mr,
            'waivers_agreed_at' => Time::naiveIso($r['waivers_agreed_at'] ?? null),
        ];
    }

    /**
     * The four registration consent texts. Defaults ship in code (TRCF's wording);
     * admins may override any of them in Admin → Enrollment (system_config
     * category 'enrollment_waivers'). Keys: liability, media, firstaid, privacy.
     */
    private const DEFAULT_WAIVERS = [
        'liability' => "I am aware that youth may have the opportunity to use tools and equipment as part of the robotics experience. These machines, tools, and equipment may present hazardous conditions while being used.\n\nYouth will be given proper instruction in the safe use of machinery, tools, and equipment before being allowed to use them. It will be the youth's responsibility to follow all safety guidelines and procedures.\n\nIn consideration of participating in activities sponsored by the charitable non-profit corporation Tulsa Robotics Center Foundation, Inc. (referred to as \"TRCF\"), I hereby understand and agree to this Youth Waiver and to the terms hereof as follows:\n\nRELEASE OF LIABILITY: I acknowledge that the activities sponsored by TRCF are subject to mishap and even severe injury to participants. I understand and acknowledge that the TRCF activities have inherent dangers that no amount of care, caution, instruction, or expertise can eliminate. As such, I release and hold harmless TRCF, its board of directors, officers, elected officials, agents and employees from any and all liability, claims, demands or causes of action that minor participant may hereafter have for injuries, damages or treatment of said injuries arising out of participation in any and all activities at TRCF, including, but not limited to, losses caused by the negligence of third parties and/or TRCF. I further agree that I will not sue or make a claim against TRCF for damages or other losses sustained because of any injury or treatment thereof sustained from participation in TRCF activities. I also agree to indemnify and hold harmless TRCF, its board of directors, officers, elected officials, agents and employees from all claims, judgments and costs including attorney's fees, incurred in connection with any action brought because of participation in activities.",
        'media' => "MEDIA RELEASE: I hereby certify that I freely and voluntarily grant permission to TRCF and/or its designated representative to use the image and likeness of the minor participant, including photo, video and/or audio, for TRCF approved promotions and media-related activities. Any photo, video or audio recordings produced because of this agreement becomes the sole property of TRCF and may be used by TRCF for any purpose, including reproduction and dissemination via various communication channels such as newspapers, sales collateral, website, and social media, without compensation. I hereby release TRCF from liabilities arising out of what I might deem misrepresentations by virtue of distortion, optical illusions, or faulty mechanical reproductions.\n\nDeclining this permission will not prevent your child from participating. Be aware, however, that some events are livestreamed by the hosts or their partners.",
        'firstaid' => "CONSENT TO RENDER FIRST AID / EMERGENCY CARE: In the event that my minor child is injured or ill while participating in TRCF activities, I hereby give permission to the TRCF (its employees, agents or representatives) to provide first aid for said minor child and to take the appropriate measures, including contacting the Emergency Medical Service (EMS) system and arranging for transportation to the nearest emergency medical facility.",
        'privacy' => "PRIVACY POLICY: TRCF is committed to protecting personal information and respecting the privacy of its patrons. The personal information TRCF collects is used to deliver, manage, maintain, and improve its public programs and services. To prevent unauthorized access or disclosure of personal information TRCF has put in place suitable physical, electronic, and managerial procedures to safeguard and secure the information it collects. TRCF does not share, sell, or store personal information.\n\nAs the parent or legal guardian of the above-named participant, I hereby give my consent to allow my child to participate in activities at TRCF as described within this Youth Waiver.",
    ];

    /** The valid signer audiences a consent section can target. */
    public const CONSENT_AUDIENCES = ['youth', 'parent', 'mentor', 'volunteer'];

    /**
     * The default consent-section catalog: title + body + which audiences must
     * see/agree + how they respond (acknowledge, or grant/decline). Admins edit
     * the whole catalog in Admin → Enrollment; the signing screens (youth, parent,
     * mentor, volunteer) render whichever sections target their audience.
     */
    private static function defaultSections(): array
    {
        return [
            ['key' => 'handbook', 'title' => 'TRC Handbook & Code of Conduct',
             'body' => "I acknowledge that I have received the TRC Handbook, which includes the TRC Code of Conduct, and I agree to abide by and uphold the expectations, policies, and standards of conduct set forth therein for the current program year.",
             'response_type' => 'acknowledge', 'required' => true, 'audiences' => ['youth', 'parent', 'mentor', 'volunteer']],
            ['key' => 'liability', 'title' => 'Liability Waiver',
             'body' => self::DEFAULT_WAIVERS['liability'],
             'response_type' => 'acknowledge', 'required' => true, 'audiences' => ['parent']],
            ['key' => 'media', 'title' => 'Media Release',
             'body' => self::DEFAULT_WAIVERS['media'],
             'response_type' => 'grant_decline', 'required' => true, 'audiences' => ['parent', 'mentor', 'volunteer']],
            ['key' => 'firstaid', 'title' => 'Consent to Render First Aid / Emergency Care',
             'body' => self::DEFAULT_WAIVERS['firstaid'],
             'response_type' => 'acknowledge', 'required' => true, 'audiences' => ['parent']],
            ['key' => 'privacy', 'title' => 'Privacy Policy & Consent to Participate',
             'body' => self::DEFAULT_WAIVERS['privacy'],
             'response_type' => 'acknowledge', 'required' => true, 'audiences' => ['parent', 'mentor', 'volunteer']],
        ];
    }

    /**
     * The live consent-section catalog. Prefers the admin-saved catalog
     * (system_config 'consent_sections'); otherwise falls back to defaults, with
     * any legacy per-text edits (old 'enrollment_waivers') folded into the bodies.
     */
    public static function consentSections(PDO $pdo): array
    {
        $row = $pdo->query("SELECT `values` FROM system_config WHERE category = 'consent_sections'")->fetch();
        if ($row && $row['values']) {
            $stored = json_decode((string)$row['values'], true);
            if (is_array($stored) && $stored) return array_values(array_map([self::class, 'normalizeSection'], $stored));
        }
        // No new-style catalog yet — start from defaults and overlay legacy text edits.
        $legacyRow = $pdo->query("SELECT `values` FROM system_config WHERE category = 'enrollment_waivers'")->fetch();
        $legacy = ($legacyRow && $legacyRow['values']) ? (json_decode((string)$legacyRow['values'], true) ?: []) : [];
        $out = [];
        foreach (self::defaultSections() as $s) {
            if (!empty($legacy[$s['key']]) && trim((string)$legacy[$s['key']]) !== '') $s['body'] = trim((string)$legacy[$s['key']]);
            $out[] = $s;
        }
        return $out;
    }

    private static function normalizeSection($s): array
    {
        $s = (array)$s;
        $aud = array_values(array_intersect(self::CONSENT_AUDIENCES, (array)($s['audiences'] ?? [])));
        return [
            'key' => preg_replace('/[^a-z0-9_]/', '', strtolower((string)($s['key'] ?? ''))) ?: 'section',
            'title' => trim((string)($s['title'] ?? 'Consent')),
            'body' => (string)($s['body'] ?? ''),
            'response_type' => ($s['response_type'] ?? 'acknowledge') === 'grant_decline' ? 'grant_decline' : 'acknowledge',
            'required' => !isset($s['required']) || (bool)$s['required'],
            'audiences' => $aud,
        ];
    }

    /** Sections that target a given signer audience, in catalog order. */
    public static function sectionsForAudience(PDO $pdo, string $audience): array
    {
        return array_values(array_filter(self::consentSections($pdo), fn($s) => in_array($audience, $s['audiences'], true)));
    }

    /**
     * Normalize a raw client response for a section into a stored value, or null
     * if not answered. Acknowledge → 'agreed'; grant/decline → 'granted'|'declined'.
     */
    private static function normalizeResponse(array $section, $raw): ?string
    {
        if ($section['response_type'] === 'grant_decline') {
            if ($raw === null || $raw === '') return null;
            if ($raw === 'grant' || $raw === 'granted') return 'granted';
            if ($raw === 'decline' || $raw === 'declined') return 'declined';
            return filter_var($raw, FILTER_VALIDATE_BOOLEAN) ? 'granted' : 'declined';
        }
        return filter_var($raw, FILTER_VALIDATE_BOOLEAN) ? 'agreed' : null;
    }

    /** Record one person's response to one section for a season (full-text snapshot). */
    private static function recordConsent(PDO $pdo, int $memberId, int $year, array $section, string $audience, string $response, ?int $byId): void
    {
        $pdo->prepare("INSERT INTO member_consent_agreements
                (member_id, enrollment_year, section_key, audience, response, section_title, section_text, agreed_at, agreed_by_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
            ON DUPLICATE KEY UPDATE response = VALUES(response), section_title = VALUES(section_title),
                section_text = VALUES(section_text), agreed_at = VALUES(agreed_at), agreed_by_id = VALUES(agreed_by_id)")
            ->execute([$memberId, $year, $section['key'], $audience, $response, $section['title'], $section['body'], $byId]);
    }

    /** GET /enrollment/consent-sections — the live catalog (any signed-in user). */
    public static function getConsentSections(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::consentSections($pdo));
    }

    /**
     * GET /enrollment/member/{id}/consents?year= — what this member was asked to
     * agree to and how they responded (or 'na' if a catalog section doesn't apply
     * to them / 'pending' if applicable but not yet answered), for the season.
     */
    public static function memberConsents(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        $self = ((int)$m['id'] === $mid);
        $isGuardian = \App\Controllers\MembersController::isFamilyParentOf($pdo, $m, $mid);
        if (!$self && !$isGuardian && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $year = !empty($req->getQueryParams()['year']) ? (int)$req->getQueryParams()['year'] : self::year();
        $mtype = (string)($pdo->query("SELECT member_type FROM members WHERE id = " . $mid)->fetchColumn() ?: '');
        // Which audiences apply to this member (youth participants also carry the
        // guardian-signed 'parent' consents).
        $applies = match ($mtype) {
            'youth' => ['youth', 'parent'],
            'volunteer' => ['volunteer'],
            'parent' => ['parent'],
            default => ['mentor'],
        };
        $recStmt = $pdo->prepare("SELECT section_key, audience, response, agreed_at, section_title FROM member_consent_agreements WHERE member_id = ? AND enrollment_year = ?");
        $recStmt->execute([$mid, $year]);
        $recs = [];
        foreach ($recStmt->fetchAll(PDO::FETCH_ASSOC) as $r) $recs[$r['section_key']] = $r;
        $out = [];
        foreach (self::consentSections($pdo) as $sec) {
            $applicable = (bool)array_intersect($applies, $sec['audiences']);
            $rec = $recs[$sec['key']] ?? null;
            $out[] = [
                'key' => $sec['key'], 'title' => $sec['title'], 'response_type' => $sec['response_type'],
                'applicable' => $applicable,
                'response' => $rec ? $rec['response'] : ($applicable ? 'pending' : 'na'),
                'agreed_at' => $rec ? Time::naiveIso($rec['agreed_at']) : null,
            ];
        }
        return Http::json($res, ['member_id' => $mid, 'enrollment_year' => $year, 'sections' => $out]);
    }

    /** PUT /enrollment/admin/consent-sections — replace the catalog (admin only). */
    public static function setConsentSections(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $d = (array)$req->getParsedBody();
        $list = $d['sections'] ?? $d;
        if (!is_array($list)) return Http::error($res, 'Expected a list of sections.', 422);
        $norm = array_values(array_map([self::class, 'normalizeSection'], $list));
        // Guard against duplicate keys quietly colliding.
        $seen = [];
        foreach ($norm as &$s) { $k = $s['key']; $i = 1; while (in_array($s['key'], $seen, true)) { $s['key'] = $k . '_' . (++$i); } $seen[] = $s['key']; }
        unset($s);
        $json = json_encode($norm);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'consent_sections'"); $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('consent_sections', 'Consent Sections', ?)")->execute([$json]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'enrollment.set_consent_sections', null, ['count' => count($norm)]);
        return Http::json($res, self::consentSections($pdo));
    }

    /** The TRC Handbook link + title (system_config 'handbook'). Blank until an admin sets it. */
    private static function handbookConfig(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'handbook'");
        $s->execute();
        $stored = ($r = $s->fetch()) && $r['values'] ? (json_decode((string)$r['values'], true) ?: []) : [];
        return [
            'url'   => trim((string)($stored['url'] ?? '')),
            'title' => trim((string)($stored['title'] ?? '')) ?: 'TRC Handbook',
        ];
    }

    /** GET /handbook — the Handbook link (any signed-in user; drives Resources + signing screens). */
    public static function getHandbook(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::handbookConfig($pdo));
    }

    /** PUT /admin/handbook — set the Handbook link + title (admin only). */
    public static function setHandbook(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $d = (array)$req->getParsedBody();
        $url = trim((string)($d['url'] ?? ''));
        // Allow a full http(s) link or a same-site path (e.g. an uploaded file at /uploads/handbook/…).
        if ($url !== '' && !preg_match('#^(https?://|/)#i', $url)) {
            return Http::error($res, 'Handbook link must start with http:// or https:// (or be an uploaded file).', 422);
        }
        $vals = ['url' => $url, 'title' => trim((string)($d['title'] ?? '')) ?: 'TRC Handbook'];
        $json = json_encode($vals);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'handbook'"); $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('handbook', 'TRC Handbook', ?)")->execute([$json]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'enrollment.set_handbook', null, $vals);
        return Http::json($res, self::handbookConfig($pdo));
    }

    /** POST /admin/handbook/upload — store an uploaded Handbook file and set the link (admin only). */
    public static function uploadHandbook(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $file = ($req->getUploadedFiles()['file'] ?? null);
        // When the POST exceeds PHP's post_max_size, PHP drops the whole body, so
        // no file arrives even though the browser sent one. Detect that and say so.
        if (!$file) {
            $sent = (int)($req->getServerParams()['CONTENT_LENGTH'] ?? 0);
            if ($sent > 0) {
                return Http::error($res, 'The file is larger than the server currently allows. An administrator can raise the PHP upload limit, or upload a smaller/compressed PDF.', 413);
            }
            return Http::error($res, 'No file uploaded.', 400);
        }
        $err = $file->getError();
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            return Http::error($res, 'The file is larger than the server currently allows. An administrator can raise the PHP upload limit, or upload a smaller/compressed PDF.', 413);
        }
        if ($err !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded.', 400);
        if ((int)$file->getSize() > 25 * 1024 * 1024) return Http::error($res, 'File too large (max 25 MB).', 422);
        $orig = (string)($file->getClientFilename() ?: 'handbook.pdf');
        $ext = strtolower(preg_replace('/[^a-zA-Z0-9]/', '', (string)pathinfo($orig, PATHINFO_EXTENSION)));
        if (!in_array($ext, ['pdf', 'doc', 'docx'], true)) {
            return Http::error($res, 'Please upload a PDF or Word document (.pdf, .doc, .docx).', 422);
        }
        $dir = dirname(__DIR__, 2) . '/public/uploads/handbook';
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        @chmod($dir, 0755);
        $stored = bin2hex(random_bytes(16)) . '.' . $ext;
        $path = $dir . '/' . $stored;
        try { $file->moveTo($path); }
        catch (\Throwable $e) { return Http::error($res, 'Could not store the file.', 500); }
        // PHP-FPM's umask can leave the file owner-only (0600), which makes the web
        // server return 403 when serving it statically. Make it world-readable.
        @chmod($path, 0644);

        // Point the Handbook link at the stored file (root-relative → same origin).
        $prev = self::handbookConfig($pdo);
        $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? '')) ?: $prev['title'];
        $url = '/uploads/handbook/' . $stored;
        $vals = ['url' => $url, 'title' => $title];
        $json = json_encode($vals);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'handbook'"); $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('handbook', 'TRC Handbook', ?)")->execute([$json]);
        }
        // Best-effort cleanup of a previously uploaded file we're replacing.
        if (preg_match('#^/uploads/handbook/([A-Za-z0-9.]+)$#', $prev['url'], $mm)) {
            $old = $dir . '/' . $mm[1];
            if (is_file($old) && $mm[1] !== $stored) @unlink($old);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'enrollment.upload_handbook', null, ['filename' => $orig]);
        return Http::json($res, self::handbookConfig($pdo), 201);
    }

    private static function loadJoined(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare("SELECT e.*, p.name AS program_name, p.full_name AS program_full_name,
                                      m.member_type, m.graduation_year, m.shirt_size AS member_shirt_size,
                                      m.birthday AS member_birthday
                               FROM enrollments e LEFT JOIN programs p ON p.id = e.program_id
                               JOIN members m ON m.id = e.member_id WHERE e.id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    public static function myTcGate(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $status = EnrollmentService::status($pdo, (int)$m['id']);
        $required = !empty($status['requires_tc']) && empty($status['tc_ok']);
        $year = self::year();
        $enrollmentId = null; $canSelfResolve = true;
        if ($required && $m['member_type'] === 'youth') {
            $ex = $pdo->prepare("SELECT id FROM enrollments WHERE member_id = ? AND enrollment_year = ? ORDER BY id DESC LIMIT 1");
            $ex->execute([(int)$m['id'], $year]);
            $r = $ex->fetch();
            $enrollmentId = $r ? (int)$r['id'] : null;
            $canSelfResolve = $enrollmentId !== null;
        }
        return Http::json($res, ['required' => $required, 'member_type' => $m['member_type'],
            'enrollment_id' => $enrollmentId, 'can_self_resolve' => $canSelfResolve,
            'year_label' => $year . '–' . ($year + 1)]);
    }

    public static function currentYear(Request $req, Response $res): Response
    {
        return Http::json($res, ['enrollment_year' => self::year()]);
    }

    public static function memberEnrollments(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $stmt = $pdo->prepare("SELECT e.*, p.name AS program_name, p.full_name AS program_full_name
                               FROM enrollments e LEFT JOIN programs p ON p.id = e.program_id
                               WHERE e.member_id = ? ORDER BY e.enrollment_year DESC, e.id DESC");
        $stmt->execute([$mid]);
        return Http::json($res, array_map(fn ($e) => self::serializeFull($pdo, $e), $stmt->fetchAll()));
    }

    public static function getEnrollment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $e = self::loadJoined($pdo, (int)$route['enrollment_id']);
        if (!$e) return Http::error($res, 'Enrollment not found', 404);
        $isParent = \App\Controllers\MembersController::isFamilyParentOf($pdo, $m, (int)$e['member_id']);
        if ($m['id'] != $e['member_id'] && !$isParent && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        return Http::json($res, self::serializeFull($pdo, $e) + self::waiverState($pdo, (int)$e['member_id'], (int)$e['enrollment_year']));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $d = (array)$req->getParsedBody();
        $ex = $pdo->prepare("SELECT 1 FROM enrollments WHERE member_id = ? AND program_id = ? AND enrollment_year = ?");
        $ex->execute([(int)($d['member_id'] ?? 0), (int)($d['program_id'] ?? 0), (int)($d['enrollment_year'] ?? 0)]);
        if ($ex->fetch()) return Http::error($res, 'Member is already enrolled in this program for this year', 400);
        $memberId = (int)($d['member_id'] ?? 0);
        $programId = (int)($d['program_id'] ?? 0);
        $year = (int)($d['enrollment_year'] ?? 0);
        // Admin may set amount_due explicitly (override); otherwise auto-calc (1st vs additional program).
        $adminSet = array_key_exists('amount_due', $d) && $d['amount_due'] !== null && $d['amount_due'] !== '';
        $amountDue = $adminSet ? (float)$d['amount_due'] : self::computeAmountDue($pdo, $memberId, $year, $programId);
        // T&C is one signature per member per season; if it's already signed, a newly added
        // enrollment inherits it so all of the member's enrollments stay consistent (a later
        // enrollment otherwise kept stale unsigned flags).
        $tc = self::seasonTc($pdo, $memberId, $year);
        $row = [
            'member_id' => $memberId, 'program_id' => $programId,
            'enrollment_year' => $year, 'status' => $d['status'] ?? 'active',
            'date_enrolled' => $d['date_enrolled'] ?? date('Y-m-d'), 'date_payment' => $d['date_payment'] ?? null,
            'payment_amount' => $d['payment_amount'] ?? null,
            'amount_due' => $amountDue, 'amount_due_overridden' => $adminSet ? 1 : 0,
            'payment_override' => (int)!empty($d['payment_override']),
            'payment_method' => $d['payment_method'] ?? null, 'payment_reference' => $d['payment_reference'] ?? null,
            'scholarship_fund' => $d['scholarship_fund'] ?? null,
            'notes' => $d['notes'] ?? null,
            'tc_youth_agreed' => !empty($tc['youth_signed_at']) ? 1 : 0, 'tc_youth_date' => $tc['youth_signed_at'] ?? null,
            'tc_parent_agreed' => !empty($tc['parent_signed_at']) ? 1 : 0, 'tc_parent_date' => $tc['parent_signed_at'] ?? null,
        ];
        $cols = array_keys($row);
        $stmt = $pdo->prepare("INSERT INTO enrollments (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")");
        $stmt->execute(array_values($row));
        $newId = (int)$pdo->lastInsertId();
        // Shirt size is a property of the MEMBER, not the enrollment (a member can have
        // several enrollments in a season). Store it there only.
        if (trim((string)($d['shirt_size'] ?? '')) !== '') {
            $pdo->prepare("UPDATE members SET shirt_size = ? WHERE id = ?")->execute([trim((string)$d['shirt_size']), $memberId]);
        }
        Audit::write($pdo, (int)$m['id'], 'enrollments', $newId, 'create', null, $d);
        // Meeting-night preference is captured against the member (the one canonical store,
        // Core\NightPrefs) for this program + season, when supplied on the enrollment form.
        if ($programId && $year) {
            $npFields = \App\Controllers\NightPrefsController::extractFields($d);
            if ($npFields) {
                \App\Core\NightPrefs::save($pdo, $memberId, null, $programId,
                    \App\Core\NightPrefs::seasonFor($year), $npFields, 'enrollment', (int)$m['id']);
            }
        }
        // Enrolling in FTC, FRC or the FDP puts a youth on the FDP roster. Idempotent,
        // youth-only, and skipped for anyone who has already graduated the FDP.
        self::ensureFdpMembership($pdo, (int)($row['member_id'] ?? 0), (int)($row['program_id'] ?? 0),
            (int)($row['enrollment_year'] ?? 0), (int)$m['id']);
        return Http::json($res, self::serialize(self::loadJoined($pdo, $newId)), 201);
    }

    /**
     * If this new enrollment is for a program that belongs on the FDP roster
     * (FdpController::ROSTER_PROGRAMS — FTC/FRC/FDP) and the member is a youth, make sure
     * they have an FDP membership for that season. Used by both the staff enrollment
     * endpoint and the family self-signup, so any FDP/feeder enrollee lands on the roster.
     *
     * Failure here must never block the enrollment itself — the enrollment is the
     * thing the user asked for; the FDP row is a convenience. Any problem is logged
     * and the eligible-but-missing list on the FDP page will still show them.
     */
    public static function ensureFdpMembership(PDO $pdo, int $mid, int $pid, int $yr, ?int $actorId): void
    {
        try {
            if ($pid <= 0 || $mid <= 0 || $yr <= 0) return;
            $ps = $pdo->prepare("SELECT name FROM programs WHERE id = ?");
            $ps->execute([$pid]);
            $name = (string)($ps->fetchColumn() ?: '');
            if (!in_array($name, FdpController::ROSTER_PROGRAMS, true)) return;
            // Only youth who are NEW to FTC/FRC are auto-added to the Dev Program. A returning
            // competition-team member — one with an FTC/FRC enrollment in an earlier year, or who
            // was ever in the Dev Program before — is left off; re-enrolling for a new season must
            // not pull them back onto the roster. New members and FLL youth moving up to FTC/FRC
            // have no earlier FTC/FRC history, so they still get added.
            if (self::hasPriorCompetitionHistory($pdo, $mid, $yr)) return;
            FdpController::ensureMembership($pdo, $mid, $yr, 'auto', $actorId);
        } catch (\Throwable $e) {
            error_log('[TRCMS] FDP auto-assign failed for enrollment: ' . $e->getMessage());
        }
    }

    /** Has this youth been in FTC/FRC (a prior year) or the Dev Program before? Then they're returning. */
    private static function hasPriorCompetitionHistory(PDO $pdo, int $mid, int $yr): bool
    {
        $e = $pdo->prepare(
            "SELECT 1 FROM enrollments en JOIN programs p ON p.id = en.program_id
              WHERE en.member_id = ? AND en.enrollment_year < ? AND en.status <> 'cancelled'
                AND p.name IN ('FTC', 'FRC') LIMIT 1");
        $e->execute([$mid, $yr]);
        if ($e->fetchColumn()) return true;
        $f = $pdo->prepare("SELECT 1 FROM fdp_memberships WHERE member_id = ? AND enrollment_year < ? LIMIT 1");
        $f->execute([$mid, $yr]);
        return (bool)$f->fetchColumn();
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $id = (int)$route['enrollment_id'];
        $cur = $pdo->prepare("SELECT * FROM enrollments WHERE id = ?"); $cur->execute([$id]);
        $before = $cur->fetch();
        if (!$before) return Http::error($res, 'Enrollment not found', 404);
        $d = (array)$req->getParsedBody();
        $allowed = ['status', 'date_enrolled', 'date_payment', 'payment_amount', 'payment_override',
            'payment_method', 'payment_reference', 'scholarship_fund', 'notes'];
        $set = []; $args = [];
        foreach ($allowed as $f) {
            if (array_key_exists($f, $d) && $d[$f] !== null) {
                $set[] = "$f = ?";
                $args[] = $f === 'payment_override' ? (int)(bool)$d[$f] : $d[$f];
            }
        }
        // Admin override of amount due — flagged so the fee schedule won't recompute over it.
        if (array_key_exists('amount_due', $d)) {
            $set[] = 'amount_due = ?'; $args[] = ($d['amount_due'] === '' || $d['amount_due'] === null) ? null : (float)$d['amount_due'];
            $set[] = 'amount_due_overridden = 1';
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE enrollments SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        // Shirt size edited here goes to the MEMBER (the single source of truth), not the
        // enrollment. Look up the enrollment's member to target it.
        if (array_key_exists('shirt_size', $d) && trim((string)$d['shirt_size']) !== '') {
            $mm = $pdo->prepare("SELECT member_id FROM enrollments WHERE id = ?"); $mm->execute([$id]);
            $emid = (int)$mm->fetchColumn();
            if ($emid) $pdo->prepare("UPDATE members SET shirt_size = ? WHERE id = ?")->execute([trim((string)$d['shirt_size']), $emid]);
        }
        // Entering payment/shirt on a pending (auto-created) row may complete it.
        self::promoteIfComplete($pdo, $id);
        Audit::write($pdo, (int)$m['id'], 'enrollments', $id, 'update', null, $d);

        // A payment recorded by staff sends the family a receipt. Only fires when the
        // amount actually went UP -- editing a note or a date on an already-paid row
        // must not re-send one. This endpoint is Admin/SysAdmin only, so a family can
        // never trigger a receipt for a payment nobody took.
        $receipt = null;
        $after = self::loadJoined($pdo, $id);
        $paidBefore = (float)($before['payment_amount'] ?? 0);
        $paidAfter  = (float)($after['payment_amount'] ?? 0);
        if ($paidAfter > $paidBefore) {
            [$sent, $to] = PaymentReceipt::send($pdo, [
                'member_id' => (int)$after['member_id'],
                'amount' => round($paidAfter - $paidBefore, 2),
                'method' => $after['payment_method'] ?? ($d['payment_method'] ?? null),
                'paid_on' => $after['date_payment'] ?? date('Y-m-d'),
                'reference' => $after['payment_reference'] ?? null,
                'what' => trim((string)($after['program_name'] ?? '') . ' registration') ?: 'Registration',
                'balance' => round((float)($after['amount_due'] ?? 0) - $paidAfter, 2),
                'recorded_by' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')),
            ]);
            $receipt = ['sent' => $sent, 'to' => $to];
        }

        return Http::json($res, self::serialize($after) + ($receipt ? ['receipt' => $receipt] : []));
    }

    /**
     * GET /enrollment/{enrollment_id}/receipt-recipient — who a receipt would go to.
     *
     * Lets the admin confirmation dialog show the exact address BEFORE the payment is
     * recorded, so nobody records one against a family with no address on file, or
     * discovers afterwards that it went somewhere unexpected. Sends nothing.
     */
    public static function receiptRecipient(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['enrollment_id'];
        $e = self::loadJoined($pdo, $id);
        if (!$e) return Http::error($res, 'Enrollment not found', 404);
        $r = PaymentReceipt::recipientFor($pdo, (int)$e['member_id']);
        return Http::json($res, [
            'to' => $r['to'], 'cc' => $r['cc'],
            'recipient_name' => $r['name'], 'member_name' => $r['member_name'],
            'program_name' => $e['program_name'] ?? null,
            'amount_due' => $e['amount_due'] !== null ? (float)$e['amount_due'] : null,
            'payment_amount' => $e['payment_amount'] !== null ? (float)$e['payment_amount'] : null,
        ]);
    }

    /**
     * DELETE /enrollment/{enrollment_id} — permanently remove an enrollment.
     * Gated on the `enrollment.delete` permission (seeded for Admin + System
     * Administrator; configurable in Role Management) — for cleaning up an
     * erroneously-entered record.
     */
    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'enrollment.delete', 'write')) {
            return Http::error($res, 'You do not have permission to delete enrollments.', 403);
        }
        $id = (int)$route['enrollment_id'];
        $cur = $pdo->prepare("SELECT * FROM enrollments WHERE id = ?"); $cur->execute([$id]);
        $en = $cur->fetch();
        if (!$en) return Http::error($res, 'Enrollment not found', 404);
        $pdo->prepare("DELETE FROM enrollments WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'enrollments', $id, 'delete', $en, null);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /enrollment/fees — the configured fee schedule. */
    public static function getFees(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::fees($pdo));
    }

    /** PUT /enrollment/fees — set base + additional-program fees (admin). */
    public static function setFees(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $val = json_encode([
            'base' => (float)($d['base'] ?? 0),
            'additional_program' => (float)($d['additional_program'] ?? 0),
            'second_youth_base' => (float)($d['second_youth_base'] ?? $d['base'] ?? 0),
            'third_plus_youth_base' => (float)($d['third_plus_youth_base'] ?? $d['base'] ?? 0),
        ]);
        $s = $pdo->prepare("SELECT id FROM system_config WHERE category = 'enrollment_fees'"); $s->execute();
        if ($row = $s->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ? WHERE id = ?")->execute([$val, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('enrollment_fees', 'Enrollment Fees', ?)")->execute([$val]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'enrollment.set_fees', null, ['fees' => json_decode($val, true)]);
        return Http::json($res, self::fees($pdo));
    }

    /** GET /enrollment/preview-fee — auto-calculated amount due for a prospective enrollment. */
    public static function previewFee(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $q = $req->getQueryParams();
        $amt = self::computeAmountDue($pdo, (int)($q['member_id'] ?? 0), (int)($q['enrollment_year'] ?? self::year()), (int)($q['program_id'] ?? 0));
        return Http::json($res, ['amount_due' => $amt]);
    }

    /**
     * GET /enrollment/my-alerts — for the logged-in user and their family youth,
     * this season's enrollments that still need action: an unpaid balance or
     * incomplete Terms & Conditions signatures. Drives the login banner.
     */
    public static function myEnrollmentAlerts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $year = self::year();
        $ids = [(int)$cur['id']];
        $fam = $pdo->prepare("SELECT DISTINCT fm2.member_id FROM family_members fm1
                              JOIN family_members fm2 ON fm2.family_id = fm1.family_id
                              WHERE fm1.member_id = ? AND fm2.member_id <> ?");
        $fam->execute([(int)$cur['id'], (int)$cur['id']]);
        foreach ($fam->fetchAll() as $r) $ids[] = (int)$r['member_id'];
        $ids = array_values(array_unique($ids));
        $in = implode(',', array_fill(0, count($ids), '?'));
        $s = $pdo->prepare(
            "SELECT e.id, e.member_id, e.enrollment_year, e.amount_due, e.payment_amount, e.date_payment, e.payment_override,
                    e.tc_youth_agreed, e.tc_parent_agreed, m.first_name, m.last_name,
                    p.name AS program_name, p.full_name AS program_full_name
             FROM enrollments e JOIN members m ON m.id = e.member_id
             LEFT JOIN programs p ON p.id = e.program_id
             WHERE e.member_id IN ($in) AND e.enrollment_year >= ?
               AND e.status <> 'cancelled'");
        // >= current year so the login banner also surfaces NEXT season's
        // registrations (created in the summer Season Transition) — families can
        // sign the T&C and pay before the season goes live on July 1.
        $s->execute(array_merge($ids, [$year]));
        $out = [];
        $creditStmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM scholarship_awards WHERE enrollment_id = ? AND status = 'applied'");
        foreach ($s->fetchAll() as $e) {
            // Subtract any applied scholarship credit — it lowers what's owed without a cash
            // payment, so a fully-covered enrollment isn't flagged "unpaid" on the dashboard.
            $creditStmt->execute([(int)$e['id']]);
            $credit = (float)$creditStmt->fetchColumn();
            $balance = round((float)($e['amount_due'] ?? 0) - (float)($e['payment_amount'] ?? 0) - $credit, 2);
            $paid = $e['date_payment'] !== null || (bool)$e['payment_override'] || $balance <= 0.005;
            $unpaid = !$paid && $balance > 0;
            // Season-level T&C (member_annual_tc) is the source of truth — the same check the
            // check-in gate uses — so a youth who signed the season isn't nagged just because an
            // individual enrollment still carries blank per-enrollment flags.
            $tcDone = EnrollmentService::seasonTcSigned($pdo, (int)$e['member_id'], (int)$e['enrollment_year'], $e);
            if (!$unpaid && $tcDone) continue;
            $out[] = [
                'enrollment_id' => (int)$e['id'], 'member_id' => (int)$e['member_id'],
                'member_name' => trim($e['first_name'] . ' ' . $e['last_name']),
                'program_label' => $e['program_full_name'] ?: ($e['program_name'] ?: 'Enrollment'),
                'needs_tc' => !$tcDone, 'unpaid' => $unpaid, 'balance' => $balance,
            ];
        }
        return Http::json($res, $out);
    }

    /**
     * POST /enrollment/{id}/details — the enrollee or their guardian confirms the two
     * things that go stale between seasons: shirt size and school grade.
     *
     * Shirt size is written to BOTH the enrollment (which promoteIfComplete requires,
     * and which is per-season) and the member record (what the profile shows). Grade is
     * stored as the graduation year it implies — see App\Core\Grade.
     *
     * Authorization mirrors signTc: the enrollee themselves, a family guardian, or an
     * admin. Without this, a family could complete T&C and payment and still sit at
     * 'pending' because only staff could fill in the shirt size.
     */
    public static function saveDetails(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['enrollment_id'];
        $ex = $pdo->prepare("SELECT * FROM enrollments WHERE id = ?"); $ex->execute([$id]);
        $e = $ex->fetch();
        if (!$e) return Http::error($res, 'Enrollment not found', 404);

        $mid = (int)$e['member_id'];
        $isAdmin = (bool)array_intersect(Permissions::effectiveRolesFor($pdo, $m), ['Admin', 'System Administrator']);
        $isSelf = ((int)$m['id'] === $mid);
        $isGuardian = \App\Controllers\MembersController::isFamilyParentOf($pdo, $m, $mid);
        if (!$isSelf && !$isGuardian && !$isAdmin) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $changed = [];

        $shirt = trim((string)($d['shirt_size'] ?? ''));
        if ($shirt !== '') {
            $pdo->prepare("UPDATE members SET shirt_size = ? WHERE id = ?")->execute([$shirt, $mid]);
            $changed['shirt_size'] = $shirt;
        }

        if (array_key_exists('grade', $d) && $d['grade'] !== null && $d['grade'] !== '') {
            $gy = \App\Core\Grade::toGraduationYear((int)$d['grade']);
            $pdo->prepare("UPDATE members SET graduation_year = ? WHERE id = ?")->execute([$gy, $mid]);
            $changed['graduation_year'] = $gy;
        }

        // Birthday: capture it here only when we don't already have it (registration is the
        // place we ask). Never overwrite an existing date — a family confirming details
        // shouldn't be able to blank or change a birthday already on file.
        $birthday = trim((string)($d['birthday'] ?? ''));
        if ($birthday !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthday)) {
            $cur = $pdo->prepare("SELECT birthday FROM members WHERE id = ?"); $cur->execute([$mid]);
            if (trim((string)($cur->fetchColumn() ?: '')) === '') {
                $pdo->prepare("UPDATE members SET birthday = ? WHERE id = ?")->execute([$birthday, $mid]);
                $changed['birthday'] = $birthday;
            }
        }

        if ($changed) {
            Audit::write($pdo, (int)$m['id'], 'enrollments', $id, 'update', null, $changed);
            // Filling in the shirt size may be the last thing this enrollment needed.
            self::promoteIfComplete($pdo, $id);
        }
        return Http::json($res, ['ok' => true, 'changed' => $changed]);
    }

    /**
     * POST /members/{member_id}/request-payment-plan
     *
     * A family (or staff on their behalf) asks to pay enrollment fees over time.
     * This does NOT create a plan — it emails the person who arranges them, with
     * everything they need to start the conversation, and sets Reply-To to the
     * family so they can simply hit reply.
     *
     * Recipient is configurable in Admin -> Payment Settings; see
     * PaymentSettings::planRequestEmail().
     */
    /**
     * Build the payment-plan request email. Public so its content can be inspected
     * and tested without sending anything.
     *
     * @return array{subject:string,html:string,reply_to:?string,balance:float}
     */
    public static function buildPlanRequestEmail(PDO $pdo, array $m, array $cur): array
    {
        $mid  = (int)$m['id'];
        $year = self::year();
        $youth = trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? ''));

        // Outstanding enrollments for this season, so the email says what it's about.
        $es = $pdo->prepare("SELECT e.*, p.name AS program_name FROM enrollments e
                             LEFT JOIN programs p ON p.id = e.program_id
                             WHERE e.member_id = ? AND e.enrollment_year = ? AND e.status <> 'cancelled'");
        $es->execute([$mid, $year]);
        $rows = $es->fetchAll();
        $lines = ''; $balance = 0.0;
        foreach ($rows as $e) {
            $due = (float)($e['amount_due'] ?? 0); $paid = (float)($e['payment_amount'] ?? 0);
            $bal = round($due - $paid, 2); $balance += $bal;
            $lines .= '<li>' . htmlspecialchars((string)($e['program_name'] ?? 'Program')) . ' — owed $'
                    . number_format($due, 2) . ', paid $' . number_format($paid, 2)
                    . ', <strong>balance $' . number_format($bal, 2) . '</strong></li>';
        }
        if ($lines === '') $lines = '<li>No enrollment recorded for this season yet.</li>';

        // Who to talk to. The guardian fields on the youth's own record name the
        // actual parents, so they lead and one of them is the Reply-To. Other adults in
        // the family group follow as secondary contacts — that group can include adult
        // siblings, so don't present them as guardians.
        $guardians = [];
        foreach ([['guardian1_name', 'guardian1_email', 'guardian1_phone'],
                  ['guardian2_name', 'guardian2_email', 'guardian2_phone']] as [$n, $em, $ph]) {
            if (!empty($m[$n])) {
                $guardians[] = ['name' => (string)$m[$n], 'email' => (string)($m[$em] ?? ''), 'phone' => $m[$ph] ?? null];
            }
        }
        $famAdults = \App\Controllers\MembersController::familyAdultContacts($pdo, $mid);
        // The guardian fields often carry a name but no email, while the same person
        // exists as a family member WITH one. Match on name and fill the gaps, so a
        // parent isn't listed twice — once without contact details and once with.
        $norm = fn(string $n) => strtolower(preg_replace('/\s+/', ' ', trim($n)));
        $usedFamily = [];
        foreach ($guardians as $i => $g) {
            foreach ($famAdults as $fa) {
                if ($norm($fa['name']) !== $norm($g['name'])) continue;
                if ($g['email'] === '') $guardians[$i]['email'] = $fa['email'];
                if (empty($g['phone'])) $guardians[$i]['phone'] = $fa['phone'];
                $usedFamily[] = $fa['email'];
                break;
            }
        }
        $guardianEmails = array_merge(array_filter(array_column($guardians, 'email')), $usedFamily);
        $others = array_values(array_filter($famAdults, fn($c) => !in_array($c['email'], $guardianEmails, true)));

        $replyTo = null;
        foreach ($guardians as $g) { if (!empty($g['email'])) { $replyTo = $g['email']; break; } }
        if (!$replyTo && $famAdults) $replyTo = $famAdults[0]['email'];
        if (!$replyTo) $replyTo = $m['email'] ?: null;

        $fmt = fn(array $c) => htmlspecialchars(trim($c['name']
            . ($c['email'] !== '' ? ' <' . $c['email'] . '>' : ' — no email on file')
            . (!empty($c['phone']) ? ' · ' . $c['phone'] : '')));
        $guardianHtml = $guardians
            ? '<li>' . implode('</li><li>', array_map($fmt, $guardians)) . '</li>'
            : '<li>No parent/guardian recorded on this youth&rsquo;s profile.</li>';
        $othersHtml = $others ? '<li>' . implode('</li><li>', array_map($fmt, $others)) . '</li>' : '';

        $requester = trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? ''));

        $body = '<p><strong>' . htmlspecialchars($youth) . '</strong> has requested a payment plan for the '
              . $year . '–' . ($year + 1) . ' season.</p>'
              . '<p><strong>Enrollment fees for this season</strong></p><ul>' . $lines . '</ul>'
              . '<p><strong>Total outstanding: $' . number_format($balance, 2) . '</strong></p>'
              . '<p><strong>Parent / guardian</strong> (reply to this email to reach them)</p><ul>' . $guardianHtml . '</ul>'
              . ($othersHtml !== '' ? '<p><strong>Other adults in the family</strong></p><ul>' . $othersHtml . '</ul>' : '')
              . '<p style="background:#fff8e1;border:1px solid #ffd54f;border-radius:6px;padding:10px 13px">'
              . '<strong>The family has been asked not to make any payments until they have been contacted.</strong></p>'
              . '<p><strong>To set the plan up, you will need from the family:</strong></p>'
              . '<ul>'
              . '<li>How much they can pay each month, or how many installments they would like</li>'
              . '<li>The date they would like the first payment to come out</li>'
              . '<li>How they intend to pay each installment (card, check, cash)</li>'
              . '<li>Whether they are also applying for a scholarship, so the balance can be set after any award</li>'
              . '</ul>'
              . '<p style="color:#667">Requested by ' . htmlspecialchars($requester)
              . ' on ' . date('n/j/Y') . '. Once agreed, the plan is recorded in TRCMS on the '
              . 'Enrollment pane of this member&rsquo;s profile.</p>';

        return [
            'subject' => 'Payment plan request — ' . $youth . ' (' . $year . '–' . ($year + 1) . ')',
            'html' => $body,
            'reply_to' => $replyTo,
            'balance' => $balance,
        ];
    }

    public static function requestPaymentPlan(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];

        $ms = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ms->execute([$mid]);
        $m = $ms->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);

        // Same rule as signing: the member themselves, a family guardian, or staff.
        $isSelf = ((int)$cur['id'] === $mid);
        $isGuardian = \App\Controllers\MembersController::isFamilyParentOf($pdo, $cur, $mid);
        // Deliberately NOT keyed on enrollment.records: that key has no entry in
        // RESOURCE_DEFAULTS, so it falls through to the permissive DEFAULT_LEVEL and
        // every member passes it. Use checks that are actually defaulted to 'none'.
        $isStaff = Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')
            || (bool)array_intersect(Permissions::effectiveRolesFor($pdo, $cur), ['Admin', 'System Administrator']);
        if (!$isSelf && !$isGuardian && !$isStaff) return Http::error($res, 'Access denied', 403);

        $mail = self::buildPlanRequestEmail($pdo, $m, $cur);
        $to = \App\Core\PaymentSettings::planRequestEmail($pdo);
        $sent = \App\Core\Mailer::send($to, $mail['subject'], \App\Core\Mailer::wrap('Payment Plan Request', $mail['html']), null, null, $mail['reply_to']);

        Audit::write($pdo, (int)$cur['id'], 'members', $mid, 'request_payment_plan', null,
            ['to' => $to, 'balance' => $mail['balance'], 'sent' => $sent]);

        if (!$sent) {
            return Http::error($res, 'Could not send the request right now. Please contact ' . $to . ' directly.', 502);
        }
        return Http::json($res, ['ok' => true, 'sent_to' => $to,
            'detail' => 'Your payment plan request has been sent. Someone will be in touch to set it up. '
                . 'Please do not make any payments until you have been contacted.']);
    }

    public static function signTc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['enrollment_id'];
        $ex = $pdo->prepare("SELECT * FROM enrollments WHERE id = ?"); $ex->execute([$id]);
        $e = $ex->fetch();
        if (!$e) return Http::error($res, 'Enrollment not found', 404);
        $isAdmin = (bool)array_intersect(Permissions::effectiveRolesFor($pdo, $m), ['Admin', 'System Administrator']);
        $mid = (int)$e['member_id']; $yr = (int)$e['enrollment_year'];
        // Who is signing, relative to the enrollee?
        //  - youth portion:  the youth themselves, a parent/guardian, or an admin.
        //  - parent portion: ONLY a parent/guardian or admin (never the youth signing
        //    their own guardian consent). An adult enrolling themselves is their own
        //    guardian, so a non-youth self-enrollee may sign the parent portion too.
        $isSelf = ((int)$m['id'] === $mid);
        $isGuardian = \App\Controllers\MembersController::isFamilyParentOf($pdo, $m, $mid);
        if (!$isSelf && !$isGuardian && !$isAdmin) return Http::error($res, 'Access denied', 403);
        $etypeStmt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $etypeStmt->execute([$mid]);
        $enrolleeIsYouth = (($etypeStmt->fetchColumn() ?: '') === 'youth');
        $d = (array)$req->getParsedBody();
        $signer = $d['signer'] ?? '';
        $now = gmdate('Y-m-d H:i:s');
        // The T&C signature covers all of this youth's enrollments for the season —
        // sign once and it applies to every enrollment that year (e.g. FTC + FRC).
        // Consent sections the signer answered, recorded per section as a snapshot.
        // 'youth' audience for the youth's own portion; 'parent' for the guardian's.
        $responses = (array)($d['responses'] ?? []);
        $agreed = [];   // section_key => 'agreed'|'granted'|'declined'
        if ($signer === 'youth') {
            if (!($isSelf || $isGuardian || $isAdmin)) return Http::error($res, 'You are not permitted to sign the youth portion.', 403);
            foreach (self::sectionsForAudience($pdo, 'youth') as $sec) {
                $resp = self::normalizeResponse($sec, $responses[$sec['key']] ?? null);
                if (!$isAdmin && $sec['required'] && $resp === null) {
                    return Http::error($res, "Please complete \"{$sec['title']}\" before signing.", 422);
                }
                if ($resp !== null) { self::recordConsent($pdo, $mid, $yr, $sec, 'youth', $resp, (int)$m['id']); $agreed[$sec['key']] = $resp; }
            }
            $pdo->prepare("UPDATE enrollments SET tc_youth_agreed = 1, tc_youth_date = ? WHERE member_id = ? AND enrollment_year = ?")->execute([$now, $mid, $yr]);
        } elseif ($signer === 'parent') {
            $selfAdult = $isSelf && !$enrolleeIsYouth;
            if (!($isGuardian || $isAdmin || $selfAdult)) {
                return Http::error($res, 'Only a parent or guardian can sign the parent/guardian portion.', 403);
            }
            foreach (self::sectionsForAudience($pdo, 'parent') as $sec) {
                $resp = self::normalizeResponse($sec, $responses[$sec['key']] ?? null);
                if ($enrolleeIsYouth && !$isAdmin && $sec['required'] && $resp === null) {
                    return Http::error($res, "Please complete \"{$sec['title']}\" before signing.", 422);
                }
                if ($resp !== null) { self::recordConsent($pdo, $mid, $yr, $sec, 'parent', $resp, (int)$m['id']); $agreed[$sec['key']] = $resp; }
            }
            $pdo->prepare("UPDATE enrollments SET tc_parent_agreed = 1, tc_parent_date = ? WHERE member_id = ? AND enrollment_year = ?")->execute([$now, $mid, $yr]);
        } else {
            return Http::error($res, "signer must be 'youth' or 'parent'", 400);
        }
        // Also record in the unified per-season table so ALL annual T&C (youth,
        // parent, mentor, volunteer) lives in member_annual_tc (#4).
        self::upsertAnnualTc($pdo, $mid, $yr, $signer, $now, (int)$m['id']);
        // Mirror the guardian's consents onto member_annual_tc's legacy columns for
        // back-compat (the per-section snapshots above are the source of truth).
        if ($signer === 'parent' && $agreed) {
            $mediaGrant = array_key_exists('media', $agreed) ? ($agreed['media'] === 'granted' ? 1 : 0) : null;
            $pdo->prepare("UPDATE member_annual_tc
                SET waiver_liability_agreed = ?, waiver_firstaid_agreed = ?, waiver_privacy_agreed = ?,
                    media_release_granted = ?, waivers_agreed_at = ?, waivers_agreed_by_id = ?
                WHERE member_id = ? AND enrollment_year = ?")
                ->execute([
                    isset($agreed['liability']) ? 1 : 0, isset($agreed['firstaid']) ? 1 : 0, isset($agreed['privacy']) ? 1 : 0,
                    $mediaGrant, $now, (int)$m['id'], $mid, $yr,
                ]);
        }
        // A pending (auto-created) enrollment confirms once payment + T&C + shirt are done.
        self::promoteMemberYear($pdo, $mid, $yr);
        $ex->execute([$id]); $e = $ex->fetch();
        Audit::write($pdo, (int)$m['id'], 'members', $mid, 'enrollment.sign_tc', null, ['enrollment_id' => $id, 'year' => $yr]);
        return Http::json($res, [
            'ok' => true,
            'youth_signed' => (bool)$e['tc_youth_agreed'], 'youth_date' => Time::naiveIso($e['tc_youth_date']),
            'parent_signed' => (bool)$e['tc_parent_agreed'], 'parent_date' => Time::naiveIso($e['tc_parent_date']),
            'fully_signed' => (bool)$e['tc_youth_agreed'] && (bool)$e['tc_parent_agreed'],
        ] + self::waiverState($pdo, $mid, $yr));
    }

    /**
     * Record a youth's or their guardian's annual T&C signature in the unified
     * member_annual_tc table (one row per member/year): the youth's own signature
     * goes in signed_at, the guardian's in parent_signed_at.
     */
    private static function upsertAnnualTc(PDO $pdo, int $memberId, int $year, string $signer, string $now, int $byId): void
    {
        $ex = $pdo->prepare("SELECT id FROM member_annual_tc WHERE member_id = ? AND enrollment_year = ?");
        $ex->execute([$memberId, $year]);
        $row = $ex->fetch();
        if ($signer === 'youth') {
            $row
                ? $pdo->prepare("UPDATE member_annual_tc SET signed_at = ?, signed_by_id = ? WHERE id = ?")->execute([$now, $byId, (int)$row['id']])
                : $pdo->prepare("INSERT INTO member_annual_tc (member_id, enrollment_year, signed_at, signed_by_id) VALUES (?,?,?,?)")->execute([$memberId, $year, $now, $byId]);
        } else { // parent/guardian signature
            $row
                ? $pdo->prepare("UPDATE member_annual_tc SET parent_signed_at = ?, parent_signed_by_id = ? WHERE id = ?")->execute([$now, $byId, (int)$row['id']])
                : $pdo->prepare("INSERT INTO member_annual_tc (member_id, enrollment_year, parent_signed_at, parent_signed_by_id) VALUES (?,?,?,?)")->execute([$memberId, $year, $now, $byId]);
        }
    }

    public static function resetTc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'You do not have permission to perform this action', 403);
        $mid = (int)$route['member_id']; $year = self::year(); $prev = $year - 1;
        $mx = $pdo->prepare("SELECT 1 FROM members WHERE id = ?"); $mx->execute([$mid]);
        if (!$mx->fetch()) return Http::error($res, 'Member not found', 404);
        // Clear EVERY representation of the T&C so the reset takes effect everywhere:
        // the unified annual table, the per-enrollment flags, and the legacy member
        // flags — across the current AND prior (grace-window) season, so a returning
        // member coasting on last season's signature is actually reset too.
        $a = $pdo->prepare("DELETE FROM member_annual_tc WHERE member_id = ? AND enrollment_year IN (?, ?)"); $a->execute([$mid, $year, $prev]);
        $e = $pdo->prepare("UPDATE enrollments SET tc_youth_agreed = 0, tc_youth_date = NULL, tc_parent_agreed = 0, tc_parent_date = NULL WHERE member_id = ? AND enrollment_year IN (?, ?)");
        $e->execute([$mid, $year, $prev]);
        $mf = $pdo->prepare("UPDATE members SET youth_tc_agreed = 0, youth_tc_date = NULL, parent_tc_agreed = 0, parent_tc_date = NULL WHERE id = ?");
        $mf->execute([$mid]);
        Audit::write($pdo, (int)$m['id'], 'members', $mid, 'enrollment.reset_tc', null, ['year' => $year, 'also_year' => $prev]);
        return Http::json($res, ['ok' => true, 'year' => $year, 'annual_tc_cleared' => $a->rowCount(), 'enrollments_cleared' => $e->rowCount(), 'member_flags_cleared' => (bool)$mf->rowCount()]);
    }

    public static function memberEnrollmentStatus(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        return Http::json($res, EnrollmentService::status($pdo, $mid));
    }

    public static function mentorTc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        return Http::json($res, EnrollmentService::mentorTcStatus($pdo, $mid));
    }

    public static function signMentorTc(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        // Security #4: you may only sign your OWN annual T&C/waiver, unless you are staff who
        // administer other members (members.edit_others — the same "isStaff" gate used elsewhere
        // in this controller; held by Admin / Mentor-Lead, NOT youth or parents). Previously any
        // authenticated member — including a youth — could forge a signed waiver/media-release for
        // anyone, and doing so was validated LESS than signing for yourself.
        if ((int)$m['id'] !== $mid && !Permissions::memberCan($pdo, $m, 'members.edit_others', 'write')) {
            return Http::error($res, 'Access denied', 403);
        }
        $d = (array)$req->getParsedBody();
        $year = !empty($d['enrollment_year']) ? (int)$d['enrollment_year'] : self::year();
        // Adult signer: audience is 'volunteer' if they're a volunteer, else 'mentor'.
        $mtq = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $mtq->execute([$mid]);
        $mtype = (string)($mtq->fetchColumn() ?: 'mentor');
        $audience = $mtype === 'volunteer' ? 'volunteer' : 'mentor';
        $sections = self::sectionsForAudience($pdo, $audience);
        $responses = (array)($d['responses'] ?? []);
        $resolved = []; $mediaGrant = null;
        foreach ($sections as $sec) {
            $resp = self::normalizeResponse($sec, $responses[$sec['key']] ?? null);
            // Security #4: required-field enforcement is unconditional — signing for someone else
            // must not be validated LESS than signing for yourself.
            if ($sec['required'] && $resp === null) {
                return Http::error($res, "Please complete \"{$sec['title']}\" before signing.", 422);
            }
            if ($resp !== null) $resolved[$sec['key']] = [$sec, $resp];
            if ($sec['key'] === 'media' && $resp !== null) $mediaGrant = $resp === 'granted' ? 1 : 0;
        }
        $ex = $pdo->prepare("SELECT signed_at FROM member_annual_tc WHERE member_id = ? AND enrollment_year = ?");
        $ex->execute([$mid, $year]);
        $exist = $ex->fetch();
        if ($exist) {
            return Http::json($res, ['ok' => true, 'already_signed' => true,
                'signed_at' => Time::naiveIso($exist['signed_at']), 'enrollment_year' => $year]);
        }
        $now = gmdate('Y-m-d H:i:s');
        $ins = $pdo->prepare("INSERT INTO member_annual_tc
            (member_id, enrollment_year, signed_by_id, media_release_granted, waivers_agreed_at, waivers_agreed_by_id)
            VALUES (?, ?, ?, ?, ?, ?)");
        $ins->execute([$mid, $year, (int)$m['id'], $mediaGrant, $mediaGrant === null ? null : $now, $mediaGrant === null ? null : (int)$m['id']]);
        foreach ($resolved as [$sec, $resp]) self::recordConsent($pdo, $mid, $year, $sec, $audience, $resp, (int)$m['id']);
        Audit::write($pdo, (int)$m['id'], 'members', $mid, 'enrollment.sign_mentor_tc', null,
            ['year' => $year, 'audience' => $audience, 'sections' => array_keys($resolved), 'media_release_granted' => $mediaGrant]);
        $sa = $pdo->prepare("SELECT signed_at FROM member_annual_tc WHERE id = ?"); $sa->execute([(int)$pdo->lastInsertId()]); $signedAt = $sa->fetch()['signed_at'] ?? null;
        return Http::json($res, array_merge(
            ['ok' => true, 'already_signed' => false, 'signed_at' => Time::naiveIso($signedAt), 'enrollment_year' => $year],
            EnrollmentService::mentorTcStatus($pdo, $mid)
        ));
    }

    public static function mentorTcHistory(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $stmt = $pdo->prepare("SELECT * FROM member_annual_tc WHERE member_id = ? ORDER BY enrollment_year DESC");
        $stmt->execute([$mid]);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['id' => (int)$r['id'], 'member_id' => (int)$r['member_id'],
                'enrollment_year' => (int)$r['enrollment_year'],
                'enrollment_year_label' => $r['enrollment_year'] . '–' . ($r['enrollment_year'] + 1),
                'signed_at' => Time::naiveIso($r['signed_at']), 'signed_by_id' => $r['signed_by_id'] !== null ? (int)$r['signed_by_id'] : null,
                'parent_signed_at' => Time::naiveIso($r['parent_signed_at'] ?? null),
                'parent_signed_by_id' => isset($r['parent_signed_by_id']) && $r['parent_signed_by_id'] !== null ? (int)$r['parent_signed_by_id'] : null];
        }
        return Http::json($res, $out);
    }

    public static function renewalReminderGet(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'renewal_reminder'"); $stmt->execute();
        $r = $stmt->fetch();
        $default = ['enabled' => false, 'message' => null, 'target_year' => null];
        if (!$r || !$r['values']) return Http::json($res, $default);
        $vals = json_decode($r['values'], true);
        $obj = (is_array($vals) && isset($vals[0])) ? json_decode((string)$vals[0], true) : null;
        return Http::json($res, is_array($obj) ? $obj : $default);
    }

    public static function renewalReminderSet(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $payload = json_encode([
            'enabled' => !empty($d['enabled']),
            'message' => $d['message'] ?? 'Enrollment for the new season is now open! Please re-enroll.',
            'target_year' => !empty($d['target_year']) ? (int)$d['target_year'] : self::year(),
        ]);
        $valsJson = json_encode([$payload]);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'renewal_reminder'"); $ex->execute();
        if ($ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ? WHERE category = 'renewal_reminder'")->execute([$valsJson]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('renewal_reminder', 'Enrollment Renewal Reminder', ?)")->execute([$valsJson]);
        }
        return Http::json($res, json_decode($payload, true));
    }

    public static function seasonSummary(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $today = date('Y-m-d'); $currentYear = self::year();
        $rows = $pdo->query("SELECT enrollment_year, status, count(*) AS cnt FROM enrollments GROUP BY enrollment_year, status")->fetchAll();
        $yearMap = [];
        foreach ($rows as $r) {
            $y = (int)$r['enrollment_year'];
            $yearMap[$y] ??= ['active' => 0, 'expired' => 0, 'suspended' => 0, 'other' => 0];
            $k = in_array($r['status'], ['active', 'expired', 'suspended'], true) ? $r['status'] : 'other';
            $yearMap[$y][$k] += (int)$r['cnt'];
        }
        foreach ([$currentYear - 1, $currentYear, $currentYear + 1] as $y) {
            $yearMap[$y] ??= ['active' => 0, 'expired' => 0, 'suspended' => 0, 'other' => 0];
        }
        $closings = [];
        foreach ($pdo->query("SELECT * FROM enrollment_season_closings")->fetchAll() as $c) $closings[(int)$c['enrollment_year']] = $c;
        $years = array_keys($yearMap); rsort($years);
        $out = [];
        foreach ($years as $year) {
            $c = $yearMap[$year]; $closing = $closings[$year] ?? null;
            // Grace window for the season that ends this enrollment year: the new
            // season opens in ($year + 1); use the single source of truth.
            $grace = EnrollmentService::graceWindow($year + 1);
            $gs = $grace['start']; $ge = $grace['end'];
            $seasonEnd = date('Y-m-d', strtotime($gs . " -1 day"));
            $out[] = [
                'enrollment_year' => $year, 'label' => $year . '-' . ($year + 1), 'season_end' => $seasonEnd,
                'is_current' => $year === $currentYear, 'is_future' => $year > $currentYear, 'is_past' => $year < $currentYear,
                'in_grace_period' => ($today >= $gs && $today <= $ge), 'grace_ends' => $ge,
                'active_count' => $c['active'], 'expired_count' => $c['expired'], 'suspended_count' => $c['suspended'],
                'total_count' => array_sum($c),
                'bulk_closed' => $closing !== null,
                'closed_at' => $closing ? Time::naiveIso($closing['closed_at']) : null,
                'closed_by_id' => $closing && $closing['closed_by_id'] !== null ? (int)$closing['closed_by_id'] : null,
                'enrollments_expired' => $closing && $closing['enrollments_expired'] !== null ? (int)$closing['enrollments_expired'] : null,
                'can_close' => ($year < $currentYear && $closing === null && $c['active'] > 0),
            ];
        }
        return Http::json($res, $out);
    }

    public static function closeSeason(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $year = (int)($d['enrollment_year'] ?? 0);
        if ($year > self::year()) return Http::error($res, 'You can only close the current or a past season. A future season cannot be closed.', 400);
        $ex = $pdo->prepare("SELECT 1 FROM enrollment_season_closings WHERE enrollment_year = ?"); $ex->execute([$year]);
        if ($ex->fetch()) return Http::error($res, "Season $year–" . ($year + 1) . " has already been closed.", 400);
        $up = $pdo->prepare("UPDATE enrollments SET status = 'expired' WHERE enrollment_year = ? AND status = 'active'");
        $up->execute([$year]); $count = $up->rowCount();
        $pdo->prepare("INSERT INTO enrollment_season_closings (enrollment_year, closed_by_id, enrollments_expired, notes) VALUES (?, ?, ?, ?)")
            ->execute([$year, (int)$m['id'], $count, $d['notes'] ?? null]);
        Audit::write($pdo, (int)$m['id'], 'enrollments', null, 'enrollment.close_season', null, ['enrollment_year' => $year, 'expired' => $count]);
        return Http::json($res, ['ok' => true, 'enrollment_year' => $year, 'label' => $year . '–' . ($year + 1),
            'enrollments_expired' => $count, 'message' => "Season closed. $count enrollment record(s) marked as expired."]);
    }

    /**
     * POST /enrollment/admin/reset-shirt-sizes — clear the member-level shirt size on
     * every active member so everyone re-enters it for the new season (#65).
     */
    public static function resetShirtSizes(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $up = $pdo->prepare("UPDATE members SET shirt_size = NULL WHERE (is_active = 1 OR is_active IS NULL) AND (is_archived = 0 OR is_archived IS NULL) AND shirt_size IS NOT NULL");
        $up->execute(); $count = $up->rowCount();
        Audit::write($pdo, (int)$m['id'], 'members', null, 'update', null, ['reset_shirt_sizes' => $count]);
        return Http::json($res, ['ok' => true, 'reset' => $count, 'message' => "Cleared shirt sizes for $count member(s)."]);
    }

    // ── Season rollover: bulk-create the new season's youth enrollments ──────────

    /**
     * An auto-created enrollment starts as 'pending' — a roster placeholder that is
     * NOT counted as a confirmed/active member. It promotes to a real enrollment only
     * once the family has completed it: payment satisfied + annual T&C fully signed
     * (youth + guardian) + shirt size entered. Called after any of those three events.
     * No-op unless the row is still 'pending' and all three signals are present.
     */
    public static function promoteIfComplete(PDO $pdo, int $enrollmentId): void
    {
        $s = $pdo->prepare("SELECT * FROM enrollments WHERE id = ?");
        $s->execute([$enrollmentId]);
        $e = $s->fetch();
        if (!$e || ($e['status'] ?? '') !== 'pending') return;
        $tcOk = !empty($e['tc_youth_agreed']) && !empty($e['tc_parent_agreed']);
        $sh = $pdo->prepare("SELECT shirt_size FROM members WHERE id = ?"); $sh->execute([(int)$e['member_id']]);
        $shirtOk = trim((string)($sh->fetchColumn() ?: '')) !== '';
        $due = (float)($e['amount_due'] ?? 0);
        $paid = (float)($e['payment_amount'] ?? 0);
        $payOk = !empty($e['payment_override']) || $due <= 0 || ($paid + 0.005) >= $due;
        if (!($tcOk && $shirtOk && $payOk)) return;
        // Money actually collected -> 'paid'; comped/zero-fee with no payment -> 'active'.
        $newStatus = $paid > 0 ? 'paid' : 'active';
        $pdo->prepare("UPDATE enrollments SET status = ? WHERE id = ? AND status = 'pending'")
            ->execute([$newStatus, $enrollmentId]);
    }

    /** Promote every one of a member's enrollments for a season (T&C signs cover them all). */
    private static function promoteMemberYear(PDO $pdo, int $memberId, int $year): void
    {
        $ids = $pdo->prepare("SELECT id FROM enrollments WHERE member_id = ? AND enrollment_year = ? AND status = 'pending'");
        $ids->execute([$memberId, $year]);
        foreach ($ids->fetchAll(PDO::FETCH_COLUMN) as $id) self::promoteIfComplete($pdo, (int)$id);
    }

    /**
     * POST /enrollment/rollover/preview  { to_year }
     * Returns the editable review roster for the season rollover: one row per
     * prospective new-season enrollment. Returning youth carry their prior program(s)
     * (pre-set, editable); active youth with no prior enrollment appear with an empty
     * program so they can be handled in the same pass. Nothing is written.
     */
    public static function rolloverPreview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'seasons.manage', 'read')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $toYear = (int)($d['to_year'] ?? 0) ?: self::year();
        $fromYear = $toYear - 1;
        $fees = self::fees($pdo);

        // Returning youth: one row per (youth, prior program) with a non-cancelled prior enrollment.
        $ret = $pdo->prepare(
            "SELECT e.member_id, e.program_id, mm.first_name, mm.last_name,
                    p.name AS program_name, fm.family_id,
                    (SELECT COUNT(*) FROM enrollments e2 WHERE e2.member_id = e.member_id
                       AND e2.program_id = e.program_id AND e2.enrollment_year = ?) AS already
               FROM enrollments e
               JOIN members mm ON mm.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
               LEFT JOIN family_members fm ON fm.member_id = e.member_id
              WHERE e.enrollment_year = ? AND e.status <> 'cancelled' AND mm.member_type = 'youth'
              GROUP BY e.member_id, e.program_id
              ORDER BY mm.last_name, mm.first_name, p.name"
        );
        $ret->execute([$toYear, $fromYear]);
        $rows = [];
        $familyCounts = [];   // family_id => running youth count for a base-fee tier preview
        $seenYouthFamily = [];
        foreach ($ret->fetchAll() as $r) {
            $mid = (int)$r['member_id'];
            $fam = $r['family_id'] !== null ? (int)$r['family_id'] : null;
            // Sibling rank preview: count DISTINCT youth per family in display order.
            $rank = 1;
            if ($fam !== null) {
                $key = $fam;
                if (!isset($seenYouthFamily[$key][$mid])) {
                    $seenYouthFamily[$key][$mid] = true;
                    $familyCounts[$key] = ($familyCounts[$key] ?? 0) + 1;
                }
                $rank = array_search($mid, array_keys($seenYouthFamily[$key]), true) + 1;
            }
            $rows[] = [
                'member_id' => $mid,
                'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                'family_id' => $fam,
                'prior_program_id' => $r['program_id'] !== null ? (int)$r['program_id'] : null,
                'prior_program_name' => $r['program_name'],
                'suggested_program_id' => $r['program_id'] !== null ? (int)$r['program_id'] : null,
                'sibling_rank' => $rank,
                'already_enrolled' => (int)$r['already'] > 0,
                'needs_program' => false,
            ];
        }

        // Active youth with NO prior-season enrollment and not already in the new year.
        $new = $pdo->prepare(
            "SELECT mm.id, mm.first_name, mm.last_name, fm.family_id
               FROM members mm
               LEFT JOIN family_members fm ON fm.member_id = mm.id
              WHERE mm.member_type = 'youth'
                AND (mm.is_active = 1 OR mm.is_active IS NULL)
                AND (mm.is_archived = 0 OR mm.is_archived IS NULL)
                AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.member_id = mm.id
                                  AND e.enrollment_year = ? AND e.status <> 'cancelled')
                AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.member_id = mm.id
                                  AND e.enrollment_year = ? AND e.status <> 'cancelled')
              ORDER BY mm.last_name, mm.first_name"
        );
        $new->execute([$fromYear, $toYear]);
        foreach ($new->fetchAll() as $r) {
            $rows[] = [
                'member_id' => (int)$r['id'],
                'name' => trim($r['first_name'] . ' ' . $r['last_name']),
                'family_id' => $r['family_id'] !== null ? (int)$r['family_id'] : null,
                'prior_program_id' => null, 'prior_program_name' => null,
                'suggested_program_id' => null, 'sibling_rank' => 1,
                'already_enrolled' => false, 'needs_program' => true,
            ];
        }

        $programs = $pdo->query("SELECT id, name, full_name FROM programs ORDER BY display_order, id")->fetchAll();
        return Http::json($res, [
            'to_year' => $toYear, 'from_year' => $fromYear,
            'to_label' => $toYear . '–' . ($toYear + 1), 'from_label' => $fromYear . '–' . ($fromYear + 1),
            'fees' => $fees,
            'programs' => array_map(fn($p) => ['id' => (int)$p['id'], 'name' => $p['name'], 'full_name' => $p['full_name']], $programs),
            'rows' => $rows,
        ]);
    }

    /**
     * POST /enrollment/rollover/commit  { to_year, rows: [{member_id, program_id}] }
     * Creates the reviewed new-season enrollments as status='pending' (auto-tiered
     * sibling fees), skipping any (member, program, year) that already exists. Runs in
     * a transaction and reports created/skipped counts.
     */
    public static function rolloverCommit(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'seasons.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $toYear = (int)($d['to_year'] ?? 0) ?: self::year();
        $rows = is_array($d['rows'] ?? null) ? $d['rows'] : [];
        // Process youngest-first within a family isn't required (family total is order-
        // independent); sort by member_id for deterministic sibling-tier assignment.
        usort($rows, fn($a, $b) => ((int)($a['member_id'] ?? 0)) <=> ((int)($b['member_id'] ?? 0)));

        $created = 0; $skipped = 0; $now = date('Y-m-d H:i:s');
        $pdo->beginTransaction();
        try {
            $existsStmt = $pdo->prepare("SELECT 1 FROM enrollments WHERE member_id = ? AND program_id = ? AND enrollment_year = ?");
            $ins = $pdo->prepare(
                "INSERT INTO enrollments (member_id, program_id, enrollment_year, status, date_enrolled,
                    amount_due, amount_due_overridden, notes, auto_created_at, auto_created_by_id, created_at, updated_at)
                 VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, ?)"
            );
            foreach ($rows as $r) {
                $mid = (int)($r['member_id'] ?? 0);
                $pid = (int)($r['program_id'] ?? 0);
                if ($mid <= 0 || $pid <= 0) { $skipped++; continue; }
                $existsStmt->execute([$mid, $pid, $toYear]);
                if ($existsStmt->fetch()) { $skipped++; continue; }
                // amount_due auto-tiers: computeAmountDue counts the pending rows we've
                // already inserted this year, so siblings/2nd-program price correctly.
                $amt = self::computeAmountDue($pdo, $mid, $toYear, $pid);
                $ins->execute([$mid, $pid, $toYear, date('Y-m-d'), $amt,
                    'Auto-created at ' . $toYear . '–' . ($toYear + 1) . ' season rollover',
                    $now, (int)$m['id'], $now, $now]);
                $created++;
            }
            Audit::write($pdo, (int)$m['id'], 'enrollments', null, 'enrollment.rollover_commit', null,
                ['to_year' => $toYear, 'created' => $created, 'skipped' => $skipped]);
            $pdo->commit();
        } catch (\Throwable $ex) {
            $pdo->rollBack();
            return Http::error($res, 'Rollover failed: ' . $ex->getMessage(), 500);
        }
        $label = $toYear . '–' . ($toYear + 1);
        return Http::json($res, ['ok' => true, 'to_year' => $toYear, 'created' => $created, 'skipped' => $skipped,
            'message' => "Created $created pending enrollment(s) for $label. Skipped $skipped already-enrolled."]);
    }
}
