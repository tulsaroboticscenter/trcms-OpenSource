<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\NightPrefs;
use App\Core\SignupNotice;
use App\Core\SignupOnboardingEmails;
use App\Core\Permissions;
use App\Core\WelcomeEmail;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Self-service signup for visitors — the "would you like to join?" page reached from
 * the link in a follow-up email.
 *
 * The token IS the authorization: these are unauthenticated endpoints, so a token is
 * single-use, expiring, revocable, and scoped to one visitor. Resolving it returns only
 * what that family already told us (their own details), never anyone else's.
 *
 * A family joins together: the guardian gets an adult account and each youth gets their
 * own member record. Siblings are offered when they share the guardian's email, so a
 * parent with three visiting youth signs up once.
 *
 * This creates ACCOUNTS, not enrollments. T&C, waivers, medical and payment stay in the
 * existing enrollment flow, which the welcome email points them at.
 */
final class VisitorSignupController
{
    private const TOKEN_DAYS = 30;

    private static function appUrl(): string { return rtrim((string)Config::get('APP_URL', ''), '/'); }

    /**
     * Mint (or reuse) a live invite for a visitor. Used by the Communications merge
     * variable so a bulk follow-up email can carry a per-recipient link.
     */
    public static function tokenFor(PDO $pdo, int $visitorId, ?string $sentTo = null, ?int $actorId = null): ?string
    {
        // Never hand out a link for someone who already became a member.
        $v = $pdo->prepare("SELECT id, converted_member_id FROM visitors WHERE id = ?");
        $v->execute([$visitorId]);
        $row = $v->fetch();
        if (!$row || $row['converted_member_id'] !== null) return null;

        $s = $pdo->prepare(
            "SELECT token FROM visitor_signup_invites
              WHERE visitor_id = ? AND used_at IS NULL AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())
              ORDER BY id DESC LIMIT 1");
        $s->execute([$visitorId]);
        if ($tok = $s->fetchColumn()) return (string)$tok;

        $token = bin2hex(random_bytes(20));
        $pdo->prepare(
            "INSERT INTO visitor_signup_invites (token, visitor_id, sent_to, expires_at, created_by_id, created_at)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, NOW())")
            ->execute([$token, $visitorId, $sentTo, self::TOKEN_DAYS, $actorId]);
        return $token;
    }

    /** Full join URL for a visitor, or null when they shouldn't get one. */
    public static function signupUrlFor(PDO $pdo, int $visitorId, ?string $sentTo = null, ?int $actorId = null): ?string
    {
        $t = self::tokenFor($pdo, $visitorId, $sentTo, $actorId);
        return $t ? self::appUrl() . '/join/' . $t : null;
    }

    /** Resolve a token to its live invite row, or null. */
    private static function liveInvite(PDO $pdo, string $token): ?array
    {
        $s = $pdo->prepare(
            "SELECT * FROM visitor_signup_invites
              WHERE token = ? AND used_at IS NULL AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())");
        $s->execute([$token]);
        return $s->fetch() ?: null;
    }

    private static function publicVisitor(array $v): array
    {
        return [
            'visitor_id' => (int)$v['id'],
            'first_name' => $v['first_name'], 'middle_name' => $v['middle_name'], 'last_name' => $v['last_name'],
            'birthday' => $v['birthday'], 'email' => $v['email'], 'phone' => $v['phone'],
            'address_line1' => $v['address_line1'], 'address_line2' => $v['address_line2'],
            'city' => $v['city'], 'state' => $v['state'], 'zip_code' => $v['zip_code'],
            'program_interest_id' => $v['program_interest_id'] !== null ? (int)$v['program_interest_id'] : null,
        ];
    }

    /**
     * GET /public/visitor-signup/{token} — what the join page shows.
     * Returns the visitor, any siblings sharing the guardian email, the guardian's
     * details, and the program list to confirm against.
     */
    public static function resolve(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $inv = self::liveInvite($pdo, (string)$route['token']);
        if (!$inv) return Http::error($res, 'This link has expired or has already been used. Please ask us for a new one.', 404);

        $s = $pdo->prepare("SELECT * FROM visitors WHERE id = ?"); $s->execute([(int)$inv['visitor_id']]);
        $v = $s->fetch();
        if (!$v) return Http::error($res, 'This link is no longer valid.', 404);
        if ($v['converted_member_id'] !== null) {
            return Http::error($res, 'You already have an account with us — try signing in, or use "Forgot password".', 409);
        }

        // Siblings: other unconverted visitors with the same guardian email. That is the
        // only link we have between visitor records, and it is what the parent expects.
        $sibs = [];
        $gEmail = trim((string)($v['guardian1_email'] ?? ''));
        if ($gEmail !== '') {
            $sq = $pdo->prepare(
                "SELECT * FROM visitors
                  WHERE id <> ? AND converted_member_id IS NULL
                    AND guardian1_email IS NOT NULL AND LOWER(guardian1_email) = LOWER(?)
                  ORDER BY first_name");
            $sq->execute([(int)$v['id'], $gEmail]);
            $sibs = array_map([self::class, 'publicVisitor'], $sq->fetchAll());
        }

        $programs = array_map(
            fn ($p) => ['id' => (int)$p['id'], 'name' => $p['name']],
            $pdo->query("SELECT id, name FROM programs ORDER BY id")->fetchAll());

        return Http::json($res, [
            'org_name' => Config::get('ORG_NAME', 'Tulsa Robotics Center'),
            'visitor' => self::publicVisitor($v),
            'siblings' => $sibs,
            'guardian' => [
                'name' => $v['guardian1_name'], 'email' => $v['guardian1_email'], 'phone' => $v['guardian1_phone'],
            ],
            'programs' => $programs,
            'expires_at' => $inv['expires_at'],
        ]);
    }

    /**
     * POST /public/visitor-signup/{token} — they said yes.
     * Body: { guardian: {name,email,phone}, youth: [{visitor_id, first_name, last_name,
     *         birthday, email, program_id}], create_guardian_account: bool }
     */
    /**
     * Demographics captured on the join form for a newly-created youth. Grade is a
     * derived field, so it's stored as the graduation year that produces it. Only
     * writes the fields the family actually filled in — never blanks existing data.
     */
    private static function applyYouthDetails(PDO $pdo, int $memberId, array $y): void
    {
        $set = []; $args = [];
        if (isset($y['grade']) && $y['grade'] !== '' && $y['grade'] !== null) {
            $gy = \App\Core\Grade::toGraduationYear((int)$y['grade']);
            if ($gy !== null) { $set[] = 'graduation_year = ?'; $args[] = $gy; }
        }
        foreach (['sex', 'race', 'shirt_size', 'school'] as $f) {
            if (isset($y[$f]) && trim((string)$y[$f]) !== '') { $set[] = "$f = ?"; $args[] = trim((string)$y[$f]); }
        }
        if ($set) {
            $args[] = $memberId;
            $pdo->prepare("UPDATE members SET " . implode(', ', $set) . " WHERE id = ?")->execute($args);
        }
    }

    public static function submit(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $inv = self::liveInvite($pdo, (string)$route['token']);
        if (!$inv) return Http::error($res, 'This link has expired or has already been used. Please ask us for a new one.', 404);

        $s = $pdo->prepare("SELECT * FROM visitors WHERE id = ?"); $s->execute([(int)$inv['visitor_id']]);
        $root = $s->fetch();
        if (!$root) return Http::error($res, 'This link is no longer valid.', 404);
        if ($root['converted_member_id'] !== null) {
            return Http::error($res, 'You already have an account with us.', 409);
        }

        $d = (array)$req->getParsedBody();
        $youthIn = (array)($d['youth'] ?? []);
        if (!$youthIn) return Http::error($res, 'Nobody was selected to join.', 400);

        // Only visitor rows this token legitimately covers: the invited visitor and the
        // siblings we offered. Anything else is ignored — the token must not become a
        // way to convert arbitrary visitor records.
        $allowed = [(int)$root['id']];
        $gEmail = trim((string)($root['guardian1_email'] ?? ''));
        if ($gEmail !== '') {
            $sq = $pdo->prepare("SELECT id FROM visitors WHERE converted_member_id IS NULL
                                  AND guardian1_email IS NOT NULL AND LOWER(guardian1_email) = LOWER(?)");
            $sq->execute([$gEmail]);
            foreach ($sq->fetchAll() as $r) $allowed[] = (int)$r['id'];
        }

        $guardian = (array)($d['guardian'] ?? []);
        $guardianEmail = trim((string)($guardian['email'] ?? $root['guardian1_email'] ?? ''));
        $guardianName = trim((string)($guardian['name'] ?? $root['guardian1_name'] ?? ''));

        // Claim the token BEFORE doing any work. Two submits racing each other (a
        // double-click, or a re-post) both see a live invite otherwise, and both create
        // accounts. Only the request that flips used_at from NULL proceeds; it is
        // released again if the work fails, so a genuine error doesn't burn the link.
        $claim = $pdo->prepare("UPDATE visitor_signup_invites SET used_at = NOW() WHERE id = ? AND used_at IS NULL");
        $claim->execute([(int)$inv['id']]);
        if ($claim->rowCount() !== 1) {
            return Http::error($res, 'This link has already been used. If you didn\'t finish signing up, please contact us.', 409);
        }

        $created = []; $existingAccounts = []; $emails = []; $errors = [];
        // Everything the system changes, for the staff notice sent after the commit.
        $changeLog = []; $enrollments = [];
        $youthMemberIds = [];   // created or matched — both belong in the family
        $youthPrograms = [];    // member_id => program_id, for the enrollment records
        $pdo->beginTransaction();
        try {
            // 1. The guardian's own account, if they asked for one and aren't already a member.
            $guardianMemberId = null;
            if (!empty($d['create_guardian_account']) && $guardianEmail !== '') {
                [$gFirstChk, $gLastChk] = self::splitName($guardianName);
                $existingId = self::findExistingMember($pdo, $guardianEmail, $gFirstChk, $gLastChk, null);
                if ($existingId !== null) {
                    // Already with us — never a second account.
                    $guardianMemberId = $existingId;
                    $existingAccounts[] = ['name' => $guardianName ?: $guardianEmail, 'type' => 'parent'];
                } else {
                    [$gFirst, $gLast] = self::splitName($guardianName);
                    $guardianMemberId = MembersController::createSelfSignup($pdo, [
                        'first_name' => $gFirst, 'last_name' => $gLast,
                        'email' => $guardianEmail, 'phone' => $guardian['phone'] ?? $root['guardian1_phone'] ?? null,
                        'address_line1' => $root['address_line1'] ?? null, 'city' => $root['city'] ?? null,
                        'state' => $root['state'] ?? null, 'zip_code' => $root['zip_code'] ?? null,
                    ], 'parent');
                    $created[] = ['member_id' => $guardianMemberId, 'name' => trim("$gFirst $gLast"), 'type' => 'parent'];
                }
            }

            // 2. Each youth.
            foreach ($youthIn as $y) {
                $vid = (int)($y['visitor_id'] ?? 0);
                if (!in_array($vid, $allowed, true)) continue;
                $vq = $pdo->prepare("SELECT * FROM visitors WHERE id = ? AND converted_member_id IS NULL");
                $vq->execute([$vid]);
                $vrow = $vq->fetch();
                if (!$vrow) continue;

                $programId = (int)($y['program_id'] ?? $vrow['program_interest_id'] ?? 0) ?: null;
                $yFirst = trim((string)($y['first_name'] ?? $vrow['first_name']));
                $yLast = trim((string)($y['last_name'] ?? $vrow['last_name']));
                $yBirthday = $y['birthday'] ?? $vrow['birthday'] ?? null;
                $yEmail = trim((string)($y['email'] ?? $vrow['email'] ?? '')) ?: null;

                // Already a member? Link this visitor row to that account instead of
                // opening a second one. Common in practice: they were converted before
                // the visitor link was recorded, or the family visited twice and got two
                // visitor rows.
                // BUT a youth very often carries the family/guardian email — that address
                // identifies the PARENT, not the youth. Matching on it would resolve to the
                // guardian account (created just above, or an existing parent) and the youth
                // would be linked to the parent instead of getting their own record. So
                // ignore the email when it's the guardian's, and never resolve a youth to
                // the guardian we just handled — fall back to name + birthday.
                $matchEmail = ($yEmail !== null && $guardianEmail !== '' && strcasecmp($yEmail, $guardianEmail) === 0) ? null : $yEmail;
                $existingId = self::findExistingMember($pdo, $matchEmail, $yFirst, $yLast, $yBirthday);
                if ($existingId !== null && $guardianMemberId !== null && $existingId === $guardianMemberId) $existingId = null;
                if ($existingId !== null) {
                    $pdo->prepare("UPDATE visitors SET status = 'enrolled', converted_member_id = ?, program_interest_id = COALESCE(?, program_interest_id) WHERE id = ?")
                        ->execute([$existingId, $programId, $vid]);
                    NightPrefs::carryVisitorToMember($pdo, $vid, $existingId);
                    $pdo->prepare("UPDATE waitlist_entries SET member_id = ?, status = 'accepted', responded_at = NOW() WHERE visitor_id = ? AND (member_id IS NULL OR member_id = 0)")
                        ->execute([$existingId, $vid]);
                    Audit::write($pdo, null, 'visitors', $vid, 'self_signup_matched', null,
                        ['matched_member_id' => $existingId, 'program_id' => $programId, 'via' => 'join_link']);
                    $existingAccounts[] = ['name' => trim("$yFirst $yLast"), 'type' => 'youth'];
                    $youthMemberIds[] = $existingId;
                    if ($programId) $youthPrograms[$existingId] = $programId;
                    $changeLog[] = ['visitor_id' => $vid, 'name' => trim("$yFirst $yLast"),
                        'member_id' => $existingId, 'action' => 'matched',
                        'program' => self::programName($pdo, $programId),
                        'night_pref' => true, 'waitlist' => true];
                    continue;
                }

                $memberId = MembersController::createSelfSignup($pdo, [
                    'first_name' => $yFirst,
                    'middle_name' => $vrow['middle_name'] ?? null,
                    'last_name' => $yLast,
                    'birthday' => $yBirthday,
                    'email' => $yEmail,
                    'phone' => $vrow['phone'] ?? null,
                    'address_line1' => $vrow['address_line1'] ?? null, 'address_line2' => $vrow['address_line2'] ?? null,
                    'city' => $vrow['city'] ?? null, 'state' => $vrow['state'] ?? null, 'zip_code' => $vrow['zip_code'] ?? null,
                    'guardian1_name' => $guardianName ?: ($vrow['guardian1_name'] ?? null),
                    'guardian1_email' => $guardianEmail ?: ($vrow['guardian1_email'] ?? null),
                    'guardian1_phone' => $guardian['phone'] ?? $vrow['guardian1_phone'] ?? null,
                ], 'youth');

                // Demographics + optional medical the parent filled in on the join form,
                // so a complete record exists from day one instead of being chased later.
                self::applyYouthDetails($pdo, $memberId, $y);
                if (!empty($y['medical']) && is_array($y['medical'])) {
                    MedicalController::persist($pdo, $memberId, (int)gmdate('Y'), $y['medical'], $guardianMemberId);
                }

                // Link the visitor record — same bookkeeping the staff convert path does,
                // so conversion tracking, night preference and waitlist all follow.
                $pdo->prepare("UPDATE visitors SET status = 'enrolled', converted_member_id = ?, program_interest_id = COALESCE(?, program_interest_id) WHERE id = ?")
                    ->execute([$memberId, $programId, $vid]);
                NightPrefs::carryVisitorToMember($pdo, $vid, $memberId);
                $pdo->prepare("UPDATE waitlist_entries SET member_id = ?, status = 'accepted', responded_at = NOW() WHERE visitor_id = ? AND (member_id IS NULL OR member_id = 0)")
                    ->execute([$memberId, $vid]);

                Audit::write($pdo, null, 'visitors', $vid, 'self_signup', null,
                    ['converted_member_id' => $memberId, 'program_id' => $programId, 'via' => 'join_link']);

                $created[] = ['member_id' => $memberId, 'name' => trim("$yFirst $yLast"), 'type' => 'youth'];
                $youthMemberIds[] = $memberId;
                if ($programId) $youthPrograms[$memberId] = $programId;
                $changeLog[] = ['visitor_id' => $vid, 'name' => trim("$yFirst $yLast"),
                    'member_id' => $memberId, 'action' => 'created',
                    'program' => self::programName($pdo, $programId),
                    'night_pref' => true, 'waitlist' => true];
            }

            // Matching everyone to existing accounts is a success, not a failure — it
            // means they were already with us and we just linked the records up.
            if (!$created && !$existingAccounts) throw new \RuntimeException('Nobody could be signed up from this link.');

            // 3. The household. Without this the parent has an account but no route to
            //    their youth's registration or payment.
            $family = self::ensureFamily($pdo, $guardianMemberId, $youthMemberIds);

            // 4. A pending enrollment per youth, for the program the parent picked.
            //    AFTER the family, so the sibling discount can see the household: the
            //    2nd youth gets the 2nd-youth rate, the 3rd and beyond the 3rd+ rate.
            //    Enrollments belong to the YOUTH — a parent account never carries one.
            foreach ($youthMemberIds as $yid) {
                $pid = $youthPrograms[$yid] ?? null;
                if (!$pid) continue;
                if ($enr = EnrollmentController::createSelfSignupEnrollment($pdo, (int)$yid, (int)$pid)) {
                    $ns = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?");
                    $ns->execute([(int)$yid]);
                    $who = $ns->fetch() ?: [];
                    $ps = $pdo->prepare("SELECT name FROM programs WHERE id = ?");
                    $ps->execute([(int)$pid]);
                    $enrollments[] = [
                        'member_id' => (int)$yid,
                        'name' => trim(($who['first_name'] ?? '') . ' ' . ($who['last_name'] ?? '')),
                        'program' => (string)($ps->fetchColumn() ?: ''),
                        'amount_due' => $enr['amount_due'],
                        'sibling_rank' => $enr['rank'],
                    ];
                }
            }

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            // Hand the link back so they can retry rather than being locked out by a
            // transient failure.
            $pdo->prepare("UPDATE visitor_signup_invites SET used_at = NULL WHERE id = ?")->execute([(int)$inv['id']]);
            return Http::error($res, 'We could not complete your signup. Please contact us and we will finish it for you.', 500);
        }

        // 3. Welcome emails — after the commit, so a mail failure never costs them the
        // account. Each send is isolated: an unreachable or slow mail server must not
        // take down the response for a family that is already signed up, and must not
        // stop the remaining accounts from being emailed. Anyone who didn't get their
        // credentials is named in `email_problems` so staff can resend from the member
        // page (Send Welcome Email) without redoing the signup.
        foreach ($created as $c) {
            $m = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $m->execute([$c['member_id']]);
            $row = $m->fetch();
            if (!$row) continue;
            try {
                $out = WelcomeEmail::issue($pdo, $row, null, Http::clientIp($req));
                $emails[] = ['name' => $c['name'], 'sent' => (bool)($out['email_sent'] ?? false),
                    'to' => $out['recipient_email'] ?? null];
                if (!($out['ok'] ?? false) || !($out['email_sent'] ?? false)) $errors[] = $c['name'];
            } catch (\Throwable $e) {
                $emails[] = ['name' => $c['name'], 'sent' => false, 'to' => null];
                $errors[] = $c['name'];
            }
        }

        // 4. Onboarding template emails (FTC/FRC + FDP): the "Welcome / Getting Started"
        // per qualifying youth and the parent "Introduction Meeting" once. Isolated — a
        // template lookup or mail failure must never affect the family's result; each
        // send's outcome is reported in the staff notice below.
        $onboardingEmails = [];
        try {
            $onboardingIds = self::onboardingProgramIds($pdo);
            $qualYouth = [];
            foreach (array_unique($youthMemberIds) as $yid) {
                $pid = $youthPrograms[$yid] ?? null;
                if (!$pid || !in_array((int)$pid, $onboardingIds, true)) continue;   // FTC/FRC + FDP
                $mq = $pdo->prepare("SELECT first_name, last_name, email FROM members WHERE id = ?");
                $mq->execute([(int)$yid]);
                $mr = $mq->fetch() ?: [];
                $qualYouth[] = [
                    'member_id' => (int)$yid,
                    'name' => trim(($mr['first_name'] ?? '') . ' ' . ($mr['last_name'] ?? '')),
                    'own_email' => $mr['email'] ?? null,
                ];
            }
            if ($qualYouth) {
                $onboardingEmails = SignupOnboardingEmails::send($pdo, [
                    'parent_member_id' => $guardianMemberId,
                    'parent_name' => $guardianName,
                    'parent_email' => $guardianEmail,
                    'youth' => $qualYouth,
                ]);
            }
        } catch (\Throwable $e) { /* never block the signup on onboarding emails */ }

        // 5. Staff notice — one email with the full record of what changed. Isolated:
        // it must never affect the family's result.
        try {
            SignupNotice::send($pdo, [
                'guardian_name' => $guardianName, 'guardian_email' => $guardianEmail,
                'ip' => Http::clientIp($req), 'submitted_at' => date('Y-m-d H:i:s'),
                'created' => $created, 'existing' => $existingAccounts,
                'visitors' => $changeLog, 'emails' => $emails, 'family' => $family ?? null,
                'enrollments' => $enrollments, 'onboarding_emails' => $onboardingEmails,
            ]);
        } catch (\Throwable $e) { /* never block the signup on a staff notification */ }

        return Http::json($res, [
            'ok' => true,
            'created' => $created,
            // People who already had an account — linked, not duplicated. They keep their
            // existing credentials, so no welcome email (it would reset their password).
            'existing' => $existingAccounts,
            'family' => $family ?? null,
            'enrollments' => $enrollments,
            'emails' => $emails,
            'onboarding_emails' => $onboardingEmails,
            'email_problems' => $errors,
            'login_url' => self::appUrl(),
        ]);
    }

    /**
     * An existing member for this person, or null. Same rule the staff Add Member screen
     * uses for duplicates: a matching email, or the same first + last name AND birthday.
     *
     * This is the backstop against a second account. Plenty of visitors are already
     * members without their visitor row being linked — every conversion done before the
     * convert-to-member link was fixed left `converted_member_id` NULL — so "this visitor
     * isn't marked converted" is NOT sufficient evidence that they're new.
     */
    private static function findExistingMember(PDO $pdo, ?string $email, ?string $first, ?string $last, ?string $birthday): ?int
    {
        $email = trim((string)$email);
        if ($email !== '') {
            $s = $pdo->prepare("SELECT id FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1");
            $s->execute([$email]);
            if ($id = $s->fetchColumn()) return (int)$id;
        }
        $first = trim((string)$first); $last = trim((string)$last); $birthday = trim((string)$birthday);
        if ($first !== '' && $last !== '' && $birthday !== '') {
            $s = $pdo->prepare("SELECT id FROM members
                                 WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
                                   AND birthday = ? LIMIT 1");
            $s->execute([$first, $last, $birthday]);
            if ($id = $s->fetchColumn()) return (int)$id;
        }
        return null;
    }

    /**
     * Put the family on the books so the parent can actually act for their youth —
     * open the youth's record, complete registration, pay.
     *
     * Naming follows what staff do by hand: "Smith Family". If that name is already
     * taken by a different family, it becomes "Timmy Smith Family" so the two are
     * tellable apart; a numeric suffix is the last resort if even that collides.
     *
     * If the parent already belongs to a family, that one is reused rather than making
     * a second household for the same people.
     *
     * @param array $youthIds member ids of the youth in this signup
     * @return array{family_id:int,family_name:string,created:bool}|null
     */
    private static function ensureFamily(PDO $pdo, ?int $parentMemberId, array $youthIds): ?array
    {
        $youthIds = array_values(array_unique(array_filter($youthIds)));
        if (!$youthIds && !$parentMemberId) return null;

        // Reuse the parent's existing household when there is one.
        $familyId = null; $created = false; $familyName = '';
        if ($parentMemberId) {
            $fs = $pdo->prepare("SELECT f.id, f.family_name FROM family_members fm
                                  JOIN families f ON f.id = fm.family_id
                                 WHERE fm.member_id = ? ORDER BY fm.id LIMIT 1");
            $fs->execute([$parentMemberId]);
            if ($row = $fs->fetch()) { $familyId = (int)$row['id']; $familyName = (string)$row['family_name']; }
        }

        if ($familyId === null) {
            // Name from the youth (that's whose surname the household is known by),
            // falling back to the parent when nobody else is available.
            $nameSrc = $youthIds[0] ?? $parentMemberId;
            $ns = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?");
            $ns->execute([$nameSrc]);
            $who = $ns->fetch() ?: ['first_name' => '', 'last_name' => ''];
            $last = trim((string)$who['last_name']);
            $first = trim((string)$who['first_name']);

            $exists = function (string $name) use ($pdo): bool {
                $s = $pdo->prepare("SELECT 1 FROM families WHERE LOWER(family_name) = LOWER(?) LIMIT 1");
                $s->execute([$name]);
                return (bool)$s->fetch();
            };
            $familyName = ($last !== '' ? $last : 'New') . ' Family';
            if ($exists($familyName) && $first !== '' && $last !== '') {
                $familyName = "$first $last Family";
                for ($n = 2; $exists($familyName) && $n < 50; $n++) {
                    $familyName = "$first $last Family ($n)";
                }
            } elseif ($exists($familyName)) {
                for ($n = 2; $exists($familyName) && $n < 50; $n++) {
                    $familyName = ($last !== '' ? $last : 'New') . " Family ($n)";
                }
            }
            $pdo->prepare("INSERT INTO families (family_name, created_at, updated_at) VALUES (?, NOW(), NOW())")
                ->execute([$familyName]);
            $familyId = (int)$pdo->lastInsertId();
            $created = true;
        }

        // Attach everyone with the right tag, without duplicating an existing link.
        $link = function (int $memberId, string $label, bool $primary) use ($pdo, $familyId): void {
            $ex = $pdo->prepare("SELECT id FROM family_members WHERE family_id = ? AND member_id = ?");
            $ex->execute([$familyId, $memberId]);
            if ($row = $ex->fetch()) {
                // Fill in a blank tag on an existing link, but never overwrite one staff set.
                $pdo->prepare("UPDATE family_members SET relationship_label = COALESCE(NULLIF(relationship_label, ''), ?)
                                WHERE id = ?")->execute([$label, (int)$row['id']]);
                return;
            }
            $pdo->prepare("INSERT INTO family_members (family_id, member_id, relationship_label, is_primary_contact, added_at)
                           VALUES (?, ?, ?, ?, NOW())")
                ->execute([$familyId, $memberId, $label, (int)$primary]);
        };
        if ($parentMemberId) $link($parentMemberId, 'Parent', true);
        foreach ($youthIds as $yid) $link((int)$yid, 'Child', false);

        return ['family_id' => $familyId, 'family_name' => $familyName, 'created' => $created];
    }

    /**
     * Programs whose self-signup triggers the onboarding emails: the FTC/FRC feeder
     * programs plus the FDP (youth who enrol straight into the development program get
     * the same welcome + parent introduction treatment).
     */
    private const ONBOARDING_PROGRAMS = ['FTC', 'FRC', 'FDP'];

    private static function onboardingProgramIds(PDO $pdo): array
    {
        $names = self::ONBOARDING_PROGRAMS;
        $in = implode(',', array_fill(0, count($names), '?'));
        $s = $pdo->prepare("SELECT id FROM programs WHERE name IN ($in)");
        $s->execute($names);
        return array_map('intval', array_column($s->fetchAll(), 'id'));
    }

    /** Program name for the staff notice, so it reads "FLLc" rather than a bare id. */
    private static function programName(PDO $pdo, ?int $programId): ?string
    {
        if (!$programId) return null;
        $s = $pdo->prepare("SELECT name FROM programs WHERE id = ?");
        $s->execute([$programId]);
        return ($n = $s->fetchColumn()) !== false ? (string)$n : null;
    }

    /** "Bonnie Griffin" -> ["Bonnie", "Griffin"]; single word becomes the first name. */
    private static function splitName(string $name): array
    {
        $parts = preg_split('/\s+/', trim($name)) ?: [];
        if (count($parts) <= 1) return [trim($name), ''];
        $last = array_pop($parts);
        return [implode(' ', $parts), $last];
    }

    /**
     * POST /visitors/{visitor_id}/signup-link — staff-facing: mint the link so it can be
     * pasted into a one-off email. Bulk sends get it via the {{signup_url}} variable.
     */
    public static function mintLink(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'visitors.records', 'write')) {
            return Http::error($res, 'Not permitted', 403);
        }
        $url = self::signupUrlFor($pdo, (int)$route['visitor_id'], null, (int)$cur['id']);
        if (!$url) return Http::error($res, 'That visitor already has a member account.', 400);
        return Http::json($res, ['url' => $url]);
    }
}
