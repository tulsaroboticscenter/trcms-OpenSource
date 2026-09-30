<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\EnrollmentService;
use App\Core\Grade;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\WelcomeEmail;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Foundation slice of the members module — directory list + detail.
 * Mirrors list_members(): excludes kiosk + system accounts (and archived) by
 * default. Full field parity with the Python MemberSummary/MemberDetail schemas
 * is refined as we compare against the running Python API.
 */
final class MembersController
{
    public static function list(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $current = Auth::currentMember($pdo, $request);
        if (!$current) {
            return Http::error($response, 'Invalid token', 401);
        }
        // member_number is only shown to Admin / System Administrator / Mentor.
        $roles = Permissions::effectiveRolesFor($pdo, $current);
        $showNumber = (bool)array_intersect($roles, ['Admin', 'System Administrator', 'Mentor']);
        // Contact info (email/phone) in the roster follows the members.view_contact
        // permission (Admin → Role Management) or member-edit rights — members without
        // it (incl. youth) don't see each other's contact info.
        $showContact = Permissions::memberCan($pdo, $current, 'members.view_contact', 'read')
            || Permissions::memberCan($pdo, $current, 'members.edit_others', 'write');
        $q = $request->getQueryParams();
        $where = [];
        $args = [];

        if (!empty($q['search'])) {
            $where[] = "(first_name LIKE ? OR last_name LIKE ? OR member_number LIKE ? OR email LIKE ?)";
            $s = '%' . $q['search'] . '%';
            array_push($args, $s, $s, $s, $s);
        }
        if (!empty($q['member_type'])) {
            $where[] = "member_type = ?";
            $args[] = $q['member_type'];
        }
        if (isset($q['is_active']) && $q['is_active'] !== '') {
            $where[] = "is_active = ?";
            $args[] = (int)filter_var($q['is_active'], FILTER_VALIDATE_BOOLEAN);
        }
        if (isset($q['is_alumni']) && $q['is_alumni'] !== '') {
            $where[] = "is_alumni = ?";
            $args[] = (int)filter_var($q['is_alumni'], FILTER_VALIDATE_BOOLEAN);
        }
        // archived_only: return ONLY archived members (so an admin can find one to un-archive).
        // Otherwise archived members are hidden unless include_archived is set.
        if (!empty($q['archived_only'])) {
            $where[] = "is_archived = 1";
        } elseif (empty($q['include_archived'])) {
            $where[] = "(is_archived = false OR is_archived IS NULL)";
        }
        if (empty($q['include_kiosk'])) {
            $where[] = "(is_kiosk = false OR is_kiosk IS NULL)";
        }
        if (empty($q['include_system'])) {
            $where[] = "(is_system = false OR is_system IS NULL)";
        }

        $clause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $skip = max(0, (int)($q['skip'] ?? 0));
        $limit = min(500, max(1, (int)($q['limit'] ?? 100)));

        $cstmt = $pdo->prepare("SELECT count(*) AS c FROM members $clause");
        $cstmt->execute($args);
        $total = (int)$cstmt->fetch()['c'];

        // Sort. Grade sorts by graduation_year (a LATER graduation year is a LOWER
        // grade), youngest first by default, with members who have no graduation year
        // last either way rather than clumped at one end.
        $order = match ((string)($q['sort'] ?? '')) {
            'grade'     => 'graduation_year IS NULL, graduation_year DESC, last_name, first_name',
            '-grade'    => 'graduation_year IS NULL, graduation_year ASC, last_name, first_name',
            'type'      => 'member_type, last_name, first_name',
            '-name'     => 'last_name DESC, first_name DESC',
            default     => 'last_name, first_name',
        };
        $stmt = $pdo->prepare(
            "SELECT id, member_number, first_name, last_name, member_type, email, phone,
                    is_active, is_archived, is_alumni, photo_url, graduation_year
             FROM members $clause ORDER BY $order LIMIT $limit OFFSET $skip"
        );
        $stmt->execute($args);
        // Mirror Python MemberSummary exactly (member_number gated by role).
        $members = array_map(fn($m) => [
            'id' => (int)$m['id'],
            'member_number' => $showNumber ? $m['member_number'] : null,
            'first_name' => $m['first_name'],
            'last_name' => $m['last_name'],
            'member_type' => $m['member_type'],
            'email' => $showContact ? $m['email'] : null,
            'phone' => $showContact ? $m['phone'] : null,
            'is_active' => (bool)$m['is_active'],
            'is_archived' => (bool)($m['is_archived'] ?? false),
            'is_alumni' => (bool)($m['is_alumni'] ?? false),
            'photo_url' => $m['photo_url'],
            // Grade only means something for youth; derived, never stored.
            'graduation_year' => $m['graduation_year'] !== null ? (int)$m['graduation_year'] : null,
            'grade' => $m['member_type'] === 'youth' ? Grade::fromGraduationYear($m['graduation_year'] !== null ? (int)$m['graduation_year'] : null) : null,
            'grade_label' => $m['member_type'] === 'youth' ? Grade::label(Grade::fromGraduationYear($m['graduation_year'] !== null ? (int)$m['graduation_year'] : null)) : null,
        ], $stmt->fetchAll());

        return Http::json($response, ['total' => $total, 'members' => $members]);
    }

    public static function get(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) {
            return Http::error($response, 'Invalid token', 401);
        }
        $id = (int)($route['id'] ?? 0);
        $stmt = $pdo->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$id]);
        $m = $stmt->fetch();
        if (!$m) {
            return Http::error($response, 'Member not found', 404);
        }
        unset($m['password_hash']);

        // Contact/address privacy: a member's home address AND contact info (email,
        // alternate emails, phone) are hidden from other members visiting their
        // profile, unless the viewer can view addresses (members.view_address) or
        // edit members. You always see your own, and a parent always sees their youth's.
        $isSelf = (int)$cur['id'] === $id;
        $isParent = self::isFamilyParentOf($pdo, $cur, $id);
        // Address stays on its own permission (members.view_address).
        if (!$isSelf && !$isParent
            && !Permissions::memberCan($pdo, $cur, 'members.view_address', 'read')
            && !Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) {
            foreach (['address_line1', 'address_line2', 'city', 'state', 'zip_code'] as $f) {
                $m[$f] = null;
            }
            $m['address_hidden'] = true;
        }
        // Contact info (email/phone) visibility is governed by the members.view_contact
        // permission (Admin → Role Management) — plus you always see your own and a
        // youth's parent sees theirs, and member editors keep access. Staff roles are
        // seeded with it; other roles (youth, etc.) don't have it, so they can't see
        // each other's email/phone — configurable per role.
        $canSeeContact = $isSelf || $isParent
            || Permissions::memberCan($pdo, $cur, 'members.view_contact', 'read')
            || Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write');
        if (!$canSeeContact) {
            // Email/phone plus the especially-sensitive PII (guardian & emergency
            // contacts, demographics, free/reduced-lunch status, special notes, exact
            // date of birth, school, and login username) are hidden from members who
            // can't view contact info. This matters most for minors — a youth viewing
            // a peer must not see any of this. Enforced HERE on the server, not just in
            // the UI: the response must never carry PII the viewer isn't cleared for.
            // (graduation_year/grade stays — it's coarse cohort info shown on rosters.)
            foreach ([
                'email', 'alt_email1', 'alt_email2', 'phone',
                'guardian1_name', 'guardian1_phone', 'guardian1_email',
                'guardian2_name', 'guardian2_phone', 'guardian2_email',
                'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
                'emergency_contact2_name', 'emergency_contact2_phone', 'emergency_contact2_relationship',
                'sex', 'race', 'free_reduced_lunch_eligible', 'special_notes',
                'birthday', 'school', 'username',
            ] as $f) {
                $m[$f] = null;
            }
            $m['contact_hidden'] = true;
        }
        // Employer & matching-gift info is fundraising/admin-only. The member always sees
        // their own; otherwise it's gated on members.view_employer (or member editors).
        $canSeeEmployer = $isSelf
            || Permissions::memberCan($pdo, $cur, 'members.view_employer', 'read')
            || Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write');
        if (!$canSeeEmployer) {
            foreach (self::EMPLOYER_FIELDS as $f) {
                $m[$f] = ($f === 'employer_matching_help') ? 0 : null;
            }
            $m['employer_hidden'] = true;
        }
        return Http::json($response, self::castMember($m));
    }

    private static function loadMember(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /** Comma-joined alternate emails the member has turned ON for delivery. */
    private static function altEmails(array $m): string
    {
        $out = [];
        if (!empty($m['alt_email1_enabled']) && !empty($m['alt_email1'])) $out[] = trim((string)$m['alt_email1']);
        if (!empty($m['alt_email2_enabled']) && !empty($m['alt_email2'])) $out[] = trim((string)$m['alt_email2']);
        return implode(', ', $out);
    }

    /** MemberCreate fields (password handled separately). */
    private const CREATE_FIELDS = ['username', 'member_type', 'first_name', 'middle_name', 'last_name', 'birthday',
        'graduation_year', 'school', 'shirt_size', 'robotics_experience_years', 'email', 'alt_email1', 'alt_email1_enabled',
        'alt_email2', 'alt_email2_enabled', 'phone', 'address_line1', 'address_line2',
        'city', 'state', 'zip_code', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
        'emergency_contact2_name', 'emergency_contact2_phone', 'emergency_contact2_relationship',
        'guardian1_name', 'guardian1_phone', 'guardian1_email', 'guardian2_name', 'guardian2_phone', 'guardian2_email',
        'sex', 'race', 'free_reduced_lunch_eligible', 'special_notes',
        'employer_name', 'employer_job_title', 'employer_matches_donations',
        'employer_volunteer_grants', 'employer_offers_grants', 'employer_program_info', 'employer_matching_help', 'employer_notes'];
    private const UPDATE_FIELDS = ['first_name', 'middle_name', 'last_name', 'birthday', 'graduation_year', 'school',
        'shirt_size', 'robotics_experience_years', 'email', 'alt_email1', 'alt_email1_enabled', 'alt_email2', 'alt_email2_enabled',
        'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip_code',
        'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
        'emergency_contact2_name', 'emergency_contact2_phone', 'emergency_contact2_relationship', 'guardian1_name',
        'guardian1_phone', 'guardian1_email', 'guardian2_name', 'guardian2_phone', 'guardian2_email', 'special_notes',
        'sex', 'race', 'free_reduced_lunch_eligible',
        'photo_url', 'is_junior_mentor', 'is_alumni', 'date_joined',
        'employer_name', 'employer_job_title', 'employer_matches_donations',
        'employer_volunteer_grants', 'employer_offers_grants', 'employer_program_info', 'employer_matching_help', 'employer_notes'];
    /** Employer & matching-gift fields (adults). A member may set these on their own record. */
    private const EMPLOYER_FIELDS = ['employer_name', 'employer_job_title', 'employer_matches_donations',
        'employer_volunteer_grants', 'employer_offers_grants', 'employer_program_info', 'employer_matching_help', 'employer_notes'];
    private const MEMBER_INT = ['graduation_year', 'robotics_experience_years'];
    private const MEMBER_BOOL = ['free_reduced_lunch_eligible', 'is_junior_mentor', 'alt_email1_enabled', 'alt_email2_enabled', 'is_alumni', 'employer_matching_help'];

    /** MemberSummary serialization (POST / response). */
    private static function serializeSummary(array $m): array
    {
        return [
            'id' => (int)$m['id'], 'member_number' => $m['member_number'], 'first_name' => $m['first_name'],
            'last_name' => $m['last_name'], 'member_type' => $m['member_type'], 'email' => $m['email'],
            'phone' => $m['phone'], 'is_active' => (bool)$m['is_active'], 'is_archived' => (bool)($m['is_archived'] ?? false),
            'is_alumni' => (bool)($m['is_alumni'] ?? false),
            'photo_url' => $m['photo_url'],
        ];
    }

    /** MemberDetail serialization (PATCH / response). */
    /** Profile panes a member can hide from other members (mirrors the frontend list). */
    private const HIDEABLE_PANES = ['contact', 'personal', 'emergency', 'guardian', 'teams', 'seasons', 'ylc', 'family', 'my_events'];

    /**
     * Which profile sections this member has hidden from other members. Privacy is
     * OPT-IN-TO-SHARE: if the member has never set a preference, everything hideable
     * is private by default. Once they save a choice, that explicit list is honored.
     */
    private static function privateSections(array $m): array
    {
        $prefs = ($m['ui_preferences'] ?? null) ? json_decode((string)$m['ui_preferences'], true) : null;
        if (is_array($prefs) && array_key_exists('private_sections', $prefs) && is_array($prefs['private_sections'])) {
            return array_values(array_filter($prefs['private_sections'], 'is_string'));
        }
        return self::HIDEABLE_PANES; // never set → private by default
    }

    private static function serializeDetail(array $m): array
    {
        $b = fn($k) => (bool)($m[$k] ?? false);
        return [
            'private_sections' => self::privateSections($m),
            'id' => (int)$m['id'], 'member_number' => $m['member_number'], 'username' => $m['username'],
            'member_type' => $m['member_type'], 'first_name' => $m['first_name'], 'middle_name' => $m['middle_name'],
            'last_name' => $m['last_name'], 'birthday' => $m['birthday'],
            'graduation_year' => $m['graduation_year'] !== null ? (int)$m['graduation_year'] : null, 'school' => $m['school'],
            'shirt_size' => $m['shirt_size'] ?? null,
            'robotics_experience_years' => (int)($m['robotics_experience_years'] ?? 0), 'email' => $m['email'], 'phone' => $m['phone'],
            'alt_email1' => $m['alt_email1'] ?? null, 'alt_email1_enabled' => (bool)($m['alt_email1_enabled'] ?? false),
            'alt_email2' => $m['alt_email2'] ?? null, 'alt_email2_enabled' => (bool)($m['alt_email2_enabled'] ?? false),
            'address_line1' => $m['address_line1'], 'address_line2' => $m['address_line2'], 'city' => $m['city'],
            'state' => $m['state'], 'zip_code' => $m['zip_code'], 'emergency_contact_name' => $m['emergency_contact_name'],
            'emergency_contact_phone' => $m['emergency_contact_phone'], 'emergency_contact_relationship' => $m['emergency_contact_relationship'],
            'emergency_contact2_name' => $m['emergency_contact2_name'] ?? null, 'emergency_contact2_phone' => $m['emergency_contact2_phone'] ?? null, 'emergency_contact2_relationship' => $m['emergency_contact2_relationship'] ?? null,
            'guardian1_name' => $m['guardian1_name'], 'guardian1_phone' => $m['guardian1_phone'], 'guardian1_email' => $m['guardian1_email'],
            'guardian2_name' => $m['guardian2_name'], 'guardian2_phone' => $m['guardian2_phone'], 'guardian2_email' => $m['guardian2_email'],
            'sex' => $m['sex'], 'race' => $m['race'],
            'free_reduced_lunch_eligible' => $m['free_reduced_lunch_eligible'] !== null ? (bool)$m['free_reduced_lunch_eligible'] : null,
            'special_notes' => $m['special_notes'], 'photo_url' => $m['photo_url'],
            'youth_tc_agreed' => $b('youth_tc_agreed'), 'youth_tc_date' => \App\Core\Time::naiveIso($m['youth_tc_date'] ?? null),
            'parent_tc_agreed' => $b('parent_tc_agreed'), 'parent_tc_date' => \App\Core\Time::naiveIso($m['parent_tc_date'] ?? null),
            'employer_name' => $m['employer_name'] ?? null, 'employer_job_title' => $m['employer_job_title'] ?? null,
            'employer_matches_donations' => $m['employer_matches_donations'] ?? null,
            'employer_volunteer_grants' => $m['employer_volunteer_grants'] ?? null,
            'employer_offers_grants' => $m['employer_offers_grants'] ?? null,
            'employer_program_info' => $m['employer_program_info'] ?? null,
            'employer_matching_help' => (bool)($m['employer_matching_help'] ?? false),
            'employer_notes' => $m['employer_notes'] ?? null,
            'date_joined' => $m['date_joined'] ?? null, 'is_active' => $b('is_active'),
            'is_junior_mentor' => $b('is_junior_mentor'), 'is_archived' => $b('is_archived'),
            'is_alumni' => $b('is_alumni'),
            'archived_at' => \App\Core\Time::naiveIso($m['archived_at'] ?? null),
        ];
    }

    private static function nextMemberNumber(PDO $pdo): string
    {
        $rows = $pdo->query("SELECT member_number FROM members WHERE member_number IS NOT NULL")->fetchAll();
        $used = [];
        foreach ($rows as $r) if (ctype_digit((string)$r['member_number'])) $used[(int)$r['member_number']] = true;
        for ($n = 10000; $n < 100000; $n++) if (!isset($used[$n])) return (string)$n;
        throw new \RuntimeException('No member numbers available');
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.create', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        // Username: auto-generate a unique one from the name when none is supplied.
        $username = trim((string)($d['username'] ?? ''));
        if ($username === '') {
            $taken = [];
            $username = self::generateUsername($pdo, (string)($d['first_name'] ?? ''), (string)($d['last_name'] ?? ''), $taken);
        }
        $d['username'] = $username;
        $ux = $pdo->prepare("SELECT 1 FROM members WHERE LOWER(username) = LOWER(?)"); $ux->execute([$username]);
        if ($ux->fetch()) return Http::error($res, 'Username already exists', 400);
        // Password: if none supplied, assign a strong random one (never surfaced) and force
        // a change at first login. A supplied password is still validated as before.
        $providedPw = (string)($d['password'] ?? '');
        if ($providedPw !== '') {
            if ($err = Auth::passwordError($providedPw)) return Http::error($res, $err, 400);
            $d['password'] = $providedPw;
        } else {
            $d['password'] = bin2hex(random_bytes(12)) . 'Aa1!';   // random, meets complexity, not exposed
        }
        $allowDup = filter_var($req->getQueryParams()['allow_duplicate'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if (!$allowDup) {
            $fn = strtolower(trim((string)($d['first_name'] ?? ''))); $ln = strtolower(trim((string)($d['last_name'] ?? '')));
            if ($fn !== '' && $ln !== '') {
                $conds = []; $args = [$fn, $ln];
                if (!empty($d['email']) && trim((string)$d['email']) !== '') { $conds[] = "LOWER(email) = ?"; $args[] = strtolower(trim((string)$d['email'])); }
                if (!empty($d['birthday'])) { $conds[] = "birthday = ?"; $args[] = $d['birthday']; }
                if ($conds) {
                    $dx = $pdo->prepare("SELECT * FROM members WHERE LOWER(first_name) = ? AND LOWER(last_name) = ? AND (" . implode(' OR ', $conds) . ") LIMIT 1");
                    $dx->execute($args);
                    $dup = $dx->fetch();
                    if ($dup) {
                        $matchedOn = (!empty($d['email']) && $dup['email'] && strtolower(trim((string)$d['email'])) === strtolower($dup['email'])) ? 'email' : 'birthday';
                        // Structured duplicate so the UI can offer "merge into this member"
                        // (e.g. converting a visitor who is already a member) instead of
                        // only "create anyway".
                        return Http::json($res, [
                            'detail' => "A member named {$dup['first_name']} {$dup['last_name']} (#{$dup['member_number']}) already exists with the same {$matchedOn}. This may be a duplicate.",
                            'duplicate' => [
                                'id' => (int)$dup['id'],
                                'first_name' => $dup['first_name'],
                                'last_name' => $dup['last_name'],
                                'member_number' => $dup['member_number'],
                                'matched_on' => $matchedOn,
                            ],
                        ], 409);
                    }
                }
            }
        }
        // Model-side ORM defaults that a raw INSERT must set explicitly.
        $cols = ['member_number', 'password_hash', 'is_active', 'force_password_change', 'is_compliance_exempt',
            'is_junior_mentor', 'is_kiosk', 'is_system', 'is_archived', 'youth_tc_agreed', 'parent_tc_agreed'];
        // New members must change their admin-set password on first login,
        // unless the caller explicitly opts out (force_password_change=false).
        $forceChange = array_key_exists('force_password_change', $d) ? (int)(bool)$d['force_password_change'] : 1;
        $vals = [self::nextMemberNumber($pdo), password_hash((string)($d['password'] ?? ''), PASSWORD_BCRYPT),
            1, $forceChange, 0, 0, 0, 0, 0, 0, 0];
        foreach (self::CREATE_FIELDS as $f) {
            if (!array_key_exists($f, $d)) {
                if ($f === 'robotics_experience_years') { $cols[] = $f; $vals[] = 0; }
                continue;
            }
            $v = $d[$f];
            if ($v !== null && in_array($f, self::MEMBER_INT, true)) $v = (int)$v;
            elseif ($v !== null && in_array($f, self::MEMBER_BOOL, true)) $v = (int)(bool)$v;
            $cols[] = $f; $vals[] = $v;
        }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO members (" . implode(',', $cols) . ") VALUES ($ph)");
        $ins->execute($vals);
        $newId = (int)$pdo->lastInsertId();
        self::setDefaultRole($pdo, $newId); // start every new member on Default until a role is assigned
        $m = self::loadMember($pdo, $newId);
        Audit::write($pdo, (int)$cur['id'], 'members', (int)$m['id'], 'create',
            null, ['username' => $m['username'], 'member_type' => $m['member_type'], 'first_name' => $m['first_name'], 'last_name' => $m['last_name'], 'email' => $m['email']]);
        return Http::json($res, self::serializeSummary($m), 201);
    }

    /**
     * Create a youth member from a summer-camp camper (+ optional guardian contact),
     * reusing the same invariants as create(): generated member_number, a throwaway
     * password (youth don't log in; no forced change), and the locked-down Default
     * role until an admin assigns one. Returns the new member id.
     */
    public static function createFromCamper(PDO $pdo, array $camper, ?array $contact, int $actorId): int
    {
        $mn = self::nextMemberNumber($pdo);
        $cols = ['member_number', 'username', 'password_hash', 'is_active', 'force_password_change', 'is_compliance_exempt',
            'is_junior_mentor', 'is_kiosk', 'is_system', 'is_archived', 'youth_tc_agreed', 'parent_tc_agreed',
            'member_type', 'first_name', 'last_name', 'school', 'shirt_size', 'robotics_experience_years'];
        // Youth converted from camp don't log in; give them a unique placeholder username
        // (the member number is unique) so an admin can set real credentials later.
        $vals = [$mn, 'camp' . $mn, password_hash(bin2hex(random_bytes(9)), PASSWORD_BCRYPT),
            1, 0, 0, 0, 0, 0, 0, 0, 0,
            'youth', (string)$camper['first_name'], (string)($camper['last_name'] ?? ''), $camper['school'] ?? null, $camper['shirt_size'] ?? null, 0];
        if ($contact) {
            if (!empty($contact['name']))  { $cols[] = 'guardian1_name';  $vals[] = $contact['name']; }
            if (!empty($contact['email'])) { $cols[] = 'guardian1_email'; $vals[] = $contact['email']; }
            if (!empty($contact['phone'])) { $cols[] = 'guardian1_phone'; $vals[] = $contact['phone']; }
        }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO members (" . implode(',', $cols) . ") VALUES ($ph)")->execute($vals);
        $id = (int)$pdo->lastInsertId();
        self::setDefaultRole($pdo, $id);
        Audit::write($pdo, $actorId, 'members', $id, 'create', null, ['from' => 'camper', 'first_name' => $camper['first_name']]);
        return $id;
    }

    /**
     * Create a member from a self-service signup (the visitor join link). Real, unique
     * username; a random password that is immediately replaced by the welcome email's
     * temporary one; force_password_change so they must set their own at first login.
     *
     * Deliberately narrow: it only writes contact/identity fields the family supplied
     * about themselves. No roles, flags, enrollment or team assignment — those stay with
     * staff and the enrollment flow.
     */
    public static function createSelfSignup(PDO $pdo, array $d, string $memberType): int
    {
        $taken = [];
        $username = self::generateUsername($pdo, (string)($d['first_name'] ?? ''), (string)($d['last_name'] ?? ''), $taken);
        $cols = ['member_number', 'username', 'password_hash', 'is_active', 'force_password_change', 'member_type'];
        $vals = [self::nextMemberNumber($pdo), $username,
            password_hash(bin2hex(random_bytes(12)) . 'Aa1!', PASSWORD_BCRYPT), 1, 1, $memberType];
        foreach (['first_name', 'middle_name', 'last_name', 'birthday', 'email', 'phone',
                  'address_line1', 'address_line2', 'city', 'state', 'zip_code',
                  'guardian1_name', 'guardian1_email', 'guardian1_phone'] as $f) {
            if (isset($d[$f]) && $d[$f] !== '' && $d[$f] !== null) { $cols[] = $f; $vals[] = $d[$f]; }
        }
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO members (" . implode(',', $cols) . ") VALUES ($ph)")->execute($vals);
        $id = (int)$pdo->lastInsertId();
        // Give a self-signed-up account its member-type role (Parent, Youth Member,
        // Mentor, Volunteer) as its SOLE role — the same role the staff Add Member and
        // member-type-change paths assign. The Default role grants nothing, and once a
        // real type role is present it only clutters the account and blocks per-role
        // control (the reason volunteers already hold only the Volunteer role). Fall back
        // to Default ONLY when the type has no mapped role, so a member is never left
        // with zero roles.
        $typeRole = self::addTypeRole($pdo, $id, $memberType);
        if ($typeRole === null) self::setDefaultRole($pdo, $id);
        Audit::write($pdo, null, 'members', $id, 'create', null,
            ['from' => 'visitor_self_signup', 'member_type' => $memberType,
             'username' => $username, 'role' => $typeRole ?? 'Default']);
        return $id;
    }

    /** Fields a parent may edit on their own youth's record (no credentials/admin flags). */
    private const PARENT_EDITABLE = ['first_name', 'middle_name', 'last_name', 'birthday', 'graduation_year', 'school',
        'shirt_size', 'email', 'alt_email1', 'alt_email1_enabled', 'alt_email2', 'alt_email2_enabled',
        'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip_code',
        'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
        'emergency_contact2_name', 'emergency_contact2_phone', 'emergency_contact2_relationship',
        'guardian1_name', 'guardian1_phone', 'guardian1_email', 'guardian2_name', 'guardian2_phone', 'guardian2_email',
        'sex', 'race', 'special_notes', 'photo_url'];

    /** IDs of youth in the same family as this member (their children). */
    private static function familyYouthIds(PDO $pdo, int $memberId): array
    {
        // Only parents/guardians see "their youth". A youth must never see — or reach —
        // a sibling's record just for sharing a family group, so if the viewer is a
        // youth, they get nobody.
        $who = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $who->execute([$memberId]);
        if (($who->fetchColumn() ?: '') === 'youth') return [];

        $fam = $pdo->prepare("SELECT family_id FROM family_members WHERE member_id = ?");
        $fam->execute([$memberId]);
        $fids = array_map('intval', array_column($fam->fetchAll(), 'family_id'));
        if (!$fids) return [];
        $in = implode(',', array_fill(0, count($fids), '?'));
        $s = $pdo->prepare("SELECT DISTINCT m.id FROM family_members fm JOIN members m ON m.id = fm.member_id
                            WHERE fm.family_id IN ($in) AND m.member_type = 'youth' AND m.id <> ?");
        $s->execute(array_merge($fids, [$memberId]));
        return array_map('intval', array_column($s->fetchAll(), 'id'));
    }

    /**
     * True if the current member is an adult guardian sharing a family with this
     * youth. Not limited to member_type 'parent' — many guardians are also
     * mentors/volunteers, and they already see their youth via /members/me/children,
     * so the edit check must match that (any non-youth in the youth's family).
     */
    public static function isFamilyParentOf(PDO $pdo, array $cur, int $youthId): bool
    {
        if (($cur['member_type'] ?? '') === 'youth') return false;
        return in_array($youthId, self::familyYouthIds($pdo, (int)$cur['id']), true);
    }

    /**
     * Adults in this member's family who have an email — the people to contact about
     * them. Ordered primary-contact first so a notification replies to the right adult.
     *
     * @return array<int,array{id:int,name:string,email:string,phone:?string}>
     */
    public static function familyAdultContacts(PDO $pdo, int $memberId): array
    {
        $s = $pdo->prepare(
            "SELECT DISTINCT m.id, m.first_name, m.last_name, m.email, m.phone, fm.is_primary_contact
               FROM family_members fy
               JOIN family_members fm ON fm.family_id = fy.family_id AND fm.member_id <> fy.member_id
               JOIN members m ON m.id = fm.member_id
              WHERE fy.member_id = ? AND m.member_type <> 'youth'
                AND m.email IS NOT NULL AND m.email <> ''
              ORDER BY fm.is_primary_contact DESC, m.last_name, m.first_name"
        );
        $s->execute([$memberId]);
        return array_map(fn($r) => [
            'id' => (int)$r['id'],
            'name' => trim($r['first_name'] . ' ' . $r['last_name']),
            'email' => (string)$r['email'],
            'phone' => $r['phone'] ?: null,
        ], $s->fetchAll());
    }

    /** GET /members/me/children — youth in the logged-in (parent's) family. */
    public static function myChildren(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $ids = self::familyYouthIds($pdo, (int)$cur['id']);
        if (!$ids) return Http::json($res, []);
        $in = implode(',', array_fill(0, count($ids), '?'));
        $s = $pdo->prepare("SELECT id, first_name, last_name, member_number, photo_url, member_type
                            FROM members WHERE id IN ($in) AND is_active = 1 ORDER BY first_name, last_name");
        $s->execute($ids);
        $out = array_map(fn($m) => [
            'id' => (int)$m['id'], 'first_name' => $m['first_name'], 'last_name' => $m['last_name'],
            'member_number' => $m['member_number'], 'photo_url' => $m['photo_url'], 'member_type' => $m['member_type'],
        ], $s->fetchAll());
        return Http::json($res, $out);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        $parentEdit = false;
        if ((int)$cur['id'] === $id) {
            if (!Permissions::memberCan($pdo, $cur, 'members.edit_own', 'write')) return Http::error($res, 'You do not have permission to edit your own profile.', 403);
        } elseif (self::isFamilyParentOf($pdo, $cur, $id)) {
            // A parent editing their own youth gets the restricted field set — UNLESS they
            // also hold full member-edit rights (admin/staff), in which case they keep the
            // full set. Without this, an admin who is also a parent was silently downgraded,
            // so edits to admin-only fields (e.g. photo_url) were dropped.
            $parentEdit = !Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write');
        } else {
            if (!Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) return Http::error($res, "You do not have permission to edit other members' profiles.", 403);
        }
        $d = (array)$req->getParsedBody();
        // Alumni standing is a staff designation — members can't flag themselves.
        if ((int)$cur['id'] === $id) unset($d['is_alumni']);
        // Grade is derived, not stored: a submitted grade is converted to the
        // graduation year that produces it, so the two can never disagree. An
        // explicit graduation_year in the same request wins — it's the real field.
        if (array_key_exists('grade', $d) && $d['grade'] !== null && $d['grade'] !== ''
            && !array_key_exists('graduation_year', $d)) {
            $d['graduation_year'] = Grade::toGraduationYear((int)$d['grade']);
        }
        unset($d['grade'], $d['grade_label']);
        $set = []; $args = []; $old = []; $new = [];
        $editable = $parentEdit ? self::PARENT_EDITABLE : self::UPDATE_FIELDS;
        foreach ($editable as $f) {
            if (!array_key_exists($f, $d) || $d[$f] === null) continue;   // exclude_none
            $v = $d[$f];
            if (in_array($f, self::MEMBER_INT, true)) $v = (int)$v;
            elseif (in_array($f, self::MEMBER_BOOL, true)) $v = (int)(bool)$v;
            $set[] = "$f = ?"; $args[] = $v; $old[$f] = $m[$f] ?? null; $new[$f] = $d[$f];
        }
        // Username is the login identity, so it's handled apart from the normal field
        // set: only admins (members.edit_others) may change it, and it must stay unique.
        if (array_key_exists('username', $d) && $d['username'] !== null) {
            $newUsername = trim((string)$d['username']);
            if ($newUsername !== '' && $newUsername !== $m['username']) {
                if (!Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) {
                    return Http::error($res, 'You do not have permission to change usernames.', 403);
                }
                if (strlen($newUsername) < 3) return Http::error($res, 'Username must be at least 3 characters.', 422);
                $clash = $pdo->prepare("SELECT 1 FROM members WHERE LOWER(username) = LOWER(?) AND id <> ?");
                $clash->execute([$newUsername, $id]);
                if ($clash->fetch()) return Http::error($res, 'That username is already taken.', 409);
                $set[] = 'username = ?'; $args[] = $newUsername; $old['username'] = $m['username']; $new['username'] = $newUsername;
            }
        }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE members SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'update', $old, $new);
        return Http::json($res, self::serializeDetail(self::loadMember($pdo, $id)));
    }

    // ---- CSV member import -------------------------------------------------

    /** Normalized CSV header → canonical members column. */
    private const HEADER_ALIASES = [
        'firstname' => 'first_name', 'first' => 'first_name', 'fname' => 'first_name', 'givenname' => 'first_name',
        'middlename' => 'middle_name', 'middle' => 'middle_name', 'mname' => 'middle_name', 'middleinitial' => 'middle_name',
        'lastname' => 'last_name', 'last' => 'last_name', 'lname' => 'last_name', 'surname' => 'last_name', 'familyname' => 'last_name',
        'role' => 'member_type', 'membertype' => 'member_type', 'type' => 'member_type', 'memberrole' => 'member_type',
        'phone' => 'phone', 'phonenumber' => 'phone', 'cell' => 'phone', 'cellphone' => 'phone', 'mobile' => 'phone', 'mobilephone' => 'phone', 'primaryphone' => 'phone',
        'email' => 'email', 'emailaddress' => 'email', 'e-mail' => 'email', 'mail' => 'email',
        'birthday' => 'birthday', 'birthdate' => 'birthday', 'dob' => 'birthday', 'dateofbirth' => 'birthday', 'bday' => 'birthday',
        'shirtsize' => 'shirt_size', 'shirt' => 'shirt_size', 'tshirt' => 'shirt_size', 'tshirtsize' => 'shirt_size', 'shirtsz' => 'shirt_size',
        'graduationyear' => 'graduation_year', 'gradyear' => 'graduation_year', 'classof' => 'graduation_year', 'graduation' => 'graduation_year', 'gradyr' => 'graduation_year',
        'school' => 'school', 'schoolname' => 'school',
        'sex' => 'sex', 'gender' => 'sex',
        'addressline1' => 'address_line1', 'address1' => 'address_line1', 'address' => 'address_line1', 'street' => 'address_line1', 'streetaddress' => 'address_line1', 'addressinfo' => 'address_line1',
        'addressline2' => 'address_line2', 'address2' => 'address_line2', 'apt' => 'address_line2', 'apartment' => 'address_line2', 'unit' => 'address_line2', 'suite' => 'address_line2',
        'city' => 'city', 'town' => 'city',
        'state' => 'state', 'st' => 'state', 'province' => 'state',
        'zip' => 'zip_code', 'zipcode' => 'zip_code', 'postalcode' => 'zip_code', 'postal' => 'zip_code', 'zipcode5' => 'zip_code',
        'emergencycontactname' => 'emergency_contact_name', 'emergencyname' => 'emergency_contact_name', 'emergencycontact' => 'emergency_contact_name', 'econtactname' => 'emergency_contact_name', 'emergencycontactfullname' => 'emergency_contact_name',
        'emergencycontactphone' => 'emergency_contact_phone', 'emergencyphone' => 'emergency_contact_phone', 'econtactphone' => 'emergency_contact_phone', 'emergencycontactnumber' => 'emergency_contact_phone',
        'emergencycontactrelationship' => 'emergency_contact_relationship', 'emergencyrelationship' => 'emergency_contact_relationship', 'emergencycontactrelation' => 'emergency_contact_relationship', 'relationship' => 'emergency_contact_relationship', 'econtactrelationship' => 'emergency_contact_relationship', 'relation' => 'emergency_contact_relationship',
        // Optional guardian columns (accepted if present, not required)
        'guardianname' => 'guardian1_name', 'guardian1name' => 'guardian1_name', 'parentname' => 'guardian1_name', 'parent1name' => 'guardian1_name',
        'guardianphone' => 'guardian1_phone', 'guardian1phone' => 'guardian1_phone', 'parentphone' => 'guardian1_phone',
        'guardianemail' => 'guardian1_email', 'guardian1email' => 'guardian1_email', 'parentemail' => 'guardian1_email',
        'guardian2name' => 'guardian2_name', 'parent2name' => 'guardian2_name',
        'guardian2phone' => 'guardian2_phone', 'parent2phone' => 'guardian2_phone',
        'guardian2email' => 'guardian2_email', 'parent2email' => 'guardian2_email',
    ];

    /** Columns the importer is allowed to write (besides identity/auth fields). */
    private const IMPORT_FIELDS = ['middle_name', 'birthday', 'graduation_year', 'school', 'shirt_size', 'sex',
        'email', 'phone', 'address_line1', 'address_line2', 'city', 'state', 'zip_code',
        'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
        'emergency_contact2_name', 'emergency_contact2_phone', 'emergency_contact2_relationship',
        'guardian1_name', 'guardian1_phone', 'guardian1_email', 'guardian2_name', 'guardian2_phone', 'guardian2_email'];

    private static function normalizeHeader(string $h): string
    {
        $h = strtolower(trim($h));
        $h = preg_replace('/[^a-z0-9]+/', '', $h) ?? '';
        return $h;
    }

    /** Map a free-text role to a member_type enum value, or null if unrecognized. */
    private static function normalizeRole(string $role): ?string
    {
        $r = strtolower(trim($role));
        $map = [
            'youth' => 'youth', 'student' => 'youth', 'kid' => 'youth', 'child' => 'youth', 'member' => 'youth', 'scout' => 'youth',
            'mentor' => 'mentor', 'coach' => 'mentor', 'adultmentor' => 'mentor', 'leadmentor' => 'mentor', 'teacher' => 'mentor',
            'parent' => 'parent', 'guardian' => 'parent', 'parentguardian' => 'parent', 'parent/guardian' => 'parent',
            'volunteer' => 'volunteer', 'vol' => 'volunteer', 'helper' => 'volunteer',
        ];
        $key = preg_replace('/[^a-z\/]+/', '', $r) ?? $r;
        return $map[$r] ?? $map[$key] ?? null;
    }

    /** Parse a date cell into Y-m-d, or null if blank, or false if unparseable. */
    private static function parseImportDate(string $raw): string|false|null
    {
        $raw = trim($raw);
        if ($raw === '') return null;
        $formats = ['Y-m-d', 'm/d/Y', 'n/j/Y', 'm-d-Y', 'm/d/y', 'n/j/y', 'd-M-Y', 'M j, Y', 'm.d.Y', 'Y/m/d'];
        foreach ($formats as $fmt) {
            $dt = \DateTime::createFromFormat($fmt, $raw);
            if ($dt !== false) {
                $e = \DateTime::getLastErrors();
                if (!$e || ($e['warning_count'] === 0 && $e['error_count'] === 0)) return $dt->format('Y-m-d');
            }
        }
        $ts = strtotime($raw);
        return $ts !== false ? date('Y-m-d', $ts) : false;
    }

    /** Parse raw CSV text into rows (handles BOM, quotes, embedded newlines). */
    private static function parseCsv(string $csv): array
    {
        $fh = fopen('php://temp', 'r+');
        fwrite($fh, $csv);
        rewind($fh);
        $rows = [];
        while (($r = fgetcsv($fh, 0, ',', '"', '\\')) !== false) {
            if (count($r) === 1 && ($r[0] === null || trim((string)$r[0]) === '')) continue; // blank line
            $rows[] = $r;
        }
        fclose($fh);
        if ($rows && isset($rows[0][0])) {
            $rows[0][0] = preg_replace('/^\xEF\xBB\xBF/', '', (string)$rows[0][0]); // strip UTF-8 BOM
        }
        return $rows;
    }

    /** GET /members/suggest-username?first=&last= — a unique username suggestion for the form. */
    public static function suggestUsername(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.create', 'write')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $taken = [];
        $username = self::generateUsername($pdo, (string)($q['first'] ?? ''), (string)($q['last'] ?? ''), $taken);
        return Http::json($res, ['username' => $username]);
    }

    /** Generate a unique username from a name; avoids DB and in-batch collisions. */
    private static function generateUsername(PDO $pdo, string $first, string $last, array &$taken): string
    {
        $base = strtolower(preg_replace('/[^a-z0-9]/i', '', $first . $last) ?? '');
        if ($base === '') $base = 'member';
        if (strlen($base) > 90) $base = substr($base, 0, 90);
        $chk = $pdo->prepare("SELECT 1 FROM members WHERE LOWER(username) = LOWER(?)");
        $candidate = $base; $n = 1;
        while (true) {
            if (!isset($taken[$candidate])) {
                $chk->execute([$candidate]);
                if (!$chk->fetch()) { $taken[$candidate] = true; return $candidate; }
            }
            $n++; $candidate = $base . $n;
        }
    }

    /**
     * POST /members/import — bulk member import from CSV.
     * Body: { csv: string, mode: "preview"|"commit", on_duplicate: "skip"|"overwrite" }
     * Duplicate key is (last_name, first_name) compared case-insensitively.
     * Preview writes nothing; commit creates new members (auto username + temp
     * password, force_password_change) and updates/skips matches per on_duplicate.
     */
    public static function import(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.create', 'write')) return Http::error($res, 'Access denied', 403);

        $body = (array)$req->getParsedBody();
        $csv = (string)($body['csv'] ?? '');
        $mode = ($body['mode'] ?? 'preview') === 'commit' ? 'commit' : 'preview';
        $onDup = ($body['on_duplicate'] ?? 'skip') === 'overwrite' ? 'overwrite' : 'skip';
        if (trim($csv) === '') return Http::error($res, 'No CSV content provided.', 400);

        $rows = self::parseCsv($csv);
        if (count($rows) < 2) return Http::error($res, 'CSV must have a header row and at least one data row.', 400);

        // Map headers → canonical columns.
        $rawHeaders = array_shift($rows);
        $colMap = [];                  // index => canonical field
        $mappedHeaders = [];           // canonical => original header label
        $unmapped = [];
        foreach ($rawHeaders as $i => $h) {
            $norm = self::normalizeHeader((string)$h);
            if ($norm === '') continue;
            $canon = self::HEADER_ALIASES[$norm] ?? null;
            if ($canon) { $colMap[$i] = $canon; $mappedHeaders[$canon] = (string)$h; }
            else $unmapped[] = (string)$h;
        }
        foreach (['first_name', 'last_name', 'member_type'] as $req_col) {
            if (!in_array($req_col, $colMap, true)) {
                $label = $req_col === 'member_type' ? 'role' : str_replace('_', ' ', $req_col);
                return Http::error($res, "CSV is missing a required column: \"{$label}\". Recognized columns: " . implode(', ', array_values($mappedHeaders)) . '.', 422);
            }
        }

        $taken = [];
        $results = [];
        $counts = ['created' => 0, 'updated' => 0, 'skipped' => 0, 'errors' => 0, 'duplicates' => 0, 'blank' => 0];

        $find = $pdo->prepare("SELECT id, member_number, first_name, last_name, member_type FROM members WHERE LOWER(last_name) = ? AND LOWER(first_name) = ?");

        foreach ($rows as $ri => $row) {
            $lineNo = $ri + 2; // +1 for header, +1 for 1-based
            $rec = [];
            foreach ($colMap as $i => $canon) {
                $val = isset($row[$i]) ? trim((string)$row[$i]) : '';
                if ($val !== '') $rec[$canon] = $val;
            }
            // Entirely empty row (every mapped cell blank) — usually a trailing
            // comma-only line from Excel/Sheets. Skip it silently so the review
            // isn't padded with hundreds of empty "name required" error rows.
            if (empty($rec)) { $counts['blank']++; continue; }
            $first = $rec['first_name'] ?? '';
            $last = $rec['last_name'] ?? '';
            $display = ($last !== '' || $first !== '') ? trim("{$last}, {$first}", ', ') : '(blank)';
            $errors = [];

            if ($first === '' || $last === '') $errors[] = 'First name and last name are required.';

            $memberType = null;
            if (($rec['member_type'] ?? '') === '') {
                $errors[] = 'Role is required.';
            } else {
                $memberType = self::normalizeRole($rec['member_type']);
                if ($memberType === null) $errors[] = "Unrecognized role \"{$rec['member_type']}\" (use youth, mentor, parent, or volunteer).";
            }

            if (isset($rec['birthday'])) {
                $d = self::parseImportDate($rec['birthday']);
                if ($d === false) $errors[] = "Could not parse birthday \"{$rec['birthday']}\".";
                else $rec['birthday'] = $d;
            }
            if (isset($rec['graduation_year'])) {
                $gy = preg_replace('/[^0-9]/', '', $rec['graduation_year']);
                if ($gy === '' || strlen($gy) !== 4) $errors[] = "Invalid graduation year \"{$rec['graduation_year']}\".";
                else $rec['graduation_year'] = (int)$gy;
            }
            if (isset($rec['state']) && strlen($rec['state']) > 2) {
                $errors[] = "State must be a 2-letter code (got \"{$rec['state']}\").";
            }

            if ($errors) {
                $counts['errors']++;
                $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'error',
                    'matched_id' => null, 'member_number' => null, 'username' => null, 'temp_password' => null, 'messages' => $errors];
                continue;
            }

            // Duplicate detection by (last, first) combination.
            $find->execute([strtolower($last), strtolower($first)]);
            $matches = $find->fetchAll();
            $dup = $matches[0] ?? null;

            if ($dup) {
                $counts['duplicates']++;
                $msgs = ["Matches existing member #{$dup['member_number']} ({$dup['first_name']} {$dup['last_name']}, {$dup['member_type']})."];
                if (count($matches) > 1) $msgs[] = count($matches) . ' existing members share this name — review carefully.';

                if ($onDup === 'skip') {
                    $counts['skipped']++;
                    $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => $mode === 'commit' ? 'skipped' : 'would_skip',
                        'matched_id' => (int)$dup['id'], 'member_number' => $dup['member_number'], 'username' => null, 'temp_password' => null, 'messages' => $msgs];
                    continue;
                }
                // overwrite
                if ($mode === 'commit') {
                    $set = ['member_type = ?']; $vals = [$memberType];
                    foreach (self::IMPORT_FIELDS as $f) {
                        if (array_key_exists($f, $rec)) { $set[] = "$f = ?"; $vals[] = $rec[$f]; }
                    }
                    $vals[] = (int)$dup['id'];
                    try {
                        $pdo->prepare("UPDATE members SET " . implode(', ', $set) . " WHERE id = ?")->execute($vals);
                        Audit::write($pdo, (int)$cur['id'], 'members', (int)$dup['id'], 'update', null, ['import_overwrite' => true, 'fields' => array_keys($rec)]);
                        $counts['updated']++;
                        $msgs[] = 'Updated with CSV values.';
                        $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'updated',
                            'matched_id' => (int)$dup['id'], 'member_number' => $dup['member_number'], 'username' => null, 'temp_password' => null, 'messages' => $msgs];
                    } catch (\Throwable $e) {
                        $counts['errors']++;
                        $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'error',
                            'matched_id' => (int)$dup['id'], 'member_number' => $dup['member_number'], 'username' => null, 'temp_password' => null, 'messages' => ['Update failed: ' . $e->getMessage()]];
                    }
                } else {
                    $counts['updated']++;
                    $msgs[] = 'Would be updated with CSV values.';
                    $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'would_update',
                        'matched_id' => (int)$dup['id'], 'member_number' => $dup['member_number'], 'username' => null, 'temp_password' => null, 'messages' => $msgs];
                }
                continue;
            }

            // New member.
            if ($mode !== 'commit') {
                $counts['created']++;
                $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'would_create',
                    'matched_id' => null, 'member_number' => null, 'username' => null, 'temp_password' => null, 'messages' => ['New member.']];
                continue;
            }
            try {
                $username = self::generateUsername($pdo, $first, $last, $taken);
                $temp = self::tempPassword();
                $cols = ['member_number', 'username', 'password_hash', 'member_type', 'first_name', 'last_name',
                    'is_active', 'force_password_change', 'is_compliance_exempt', 'is_junior_mentor', 'is_kiosk', 'is_system', 'is_archived', 'youth_tc_agreed', 'parent_tc_agreed', 'robotics_experience_years'];
                $vals = [self::nextMemberNumber($pdo), $username, password_hash($temp, PASSWORD_BCRYPT), $memberType, $first, $last,
                    1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
                foreach (self::IMPORT_FIELDS as $f) {
                    if (array_key_exists($f, $rec)) { $cols[] = $f; $vals[] = $rec[$f]; }
                }
                $ph = implode(',', array_fill(0, count($cols), '?'));
                $pdo->prepare("INSERT INTO members (" . implode(',', $cols) . ") VALUES ($ph)")->execute($vals);
                $newId = (int)$pdo->lastInsertId();
                self::setDefaultRole($pdo, $newId); // imported members start on Default
                $newNum = $vals[0];
                Audit::write($pdo, (int)$cur['id'], 'members', $newId, 'create', null, ['import' => true, 'username' => $username, 'member_type' => $memberType, 'first_name' => $first, 'last_name' => $last]);
                $counts['created']++;
                $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'created',
                    'matched_id' => null, 'member_number' => $newNum, 'username' => $username, 'temp_password' => $temp, 'messages' => ['Created. Temporary password issued; user must change it at first login.']];
            } catch (\Throwable $e) {
                $counts['errors']++;
                $results[] = ['row' => $lineNo, 'name' => $display, 'member_type' => $memberType, 'action' => 'error',
                    'matched_id' => null, 'member_number' => null, 'username' => null, 'temp_password' => null, 'messages' => ['Insert failed: ' . $e->getMessage()]];
            }
        }

        return Http::json($res, [
            'mode' => $mode,
            'on_duplicate' => $onDup,
            'total_rows' => count($rows) - $counts['blank'],
            'counts' => $counts,
            'mapped_columns' => $mappedHeaders,
            'unmapped_columns' => $unmapped,
            'results' => $results,
        ]);
    }

    /** Generate a strong temporary password (12+ chars, all four character classes). */
    /** One implementation, in Core\WelcomeEmail — the import path uses it too. */
    private static function tempPassword(): string { return WelcomeEmail::tempPassword(); }

    /** POST /{id}/send-welcome-email — reset to a temp password and email credentials. */
    public static function sendWelcomeEmail(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) return Http::error($res, 'Access denied', 403);
        $m = self::loadMember($pdo, (int)$route['member_id']);
        if (!$m) return Http::error($res, 'Member not found', 404);
        // This replaces the member's password with a temporary one, so it's a
        // credential reset — same guard as the admin reset path: you can't do it to an
        // account more privileged than your own.
        if (!Permissions::canManageCredentialsOf($pdo, $cur, (int)$m['id'])) {
            return Http::error($res, "You don't have permission to reset this account's password.", 403);
        }

        $out = WelcomeEmail::issue($pdo, $m, (int)$cur['id'], Http::clientIp($req));
        if (!($out['ok'] ?? false)) return Http::error($res, (string)$out['error'], 400);
        return Http::json($res, $out);
    }

    /** GET /{id}/programs-supported — the programs a mentor is tagged to support. */
    public static function getProgramsSupported(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $id = (int)$route['member_id'];
        // Security #13: your own, or a roster-viewer's (members.directory).
        if ((int)$me['id'] !== $id && !Permissions::memberCan($pdo, $me, 'members.directory', 'read')) {
            return Http::error($res, 'Access denied', 403);
        }
        $st = $pdo->prepare("SELECT p.id, p.name FROM member_program_support mps JOIN programs p ON p.id = mps.program_id WHERE mps.member_id = ? ORDER BY p.name");
        $st->execute([$id]);
        return Http::json($res, array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name']], $st->fetchAll()));
    }

    /** PUT /{id}/programs-supported — replace the set of supported programs (Admin/mentor). */
    public static function setProgramsSupported(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        if (!self::loadMember($pdo, $id)) return Http::error($res, 'Member not found', 404);
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)(($req->getParsedBody()['program_ids'] ?? []))))));
        $pdo->prepare("DELETE FROM member_program_support WHERE member_id = ?")->execute([$id]);
        if ($ids) {
            $ins = $pdo->prepare("INSERT IGNORE INTO member_program_support (member_id, program_id, created_at) VALUES (?, ?, NOW())");
            foreach ($ids as $pid) $ins->execute([$id, $pid]);
        }
        Audit::write($pdo, (int)$cur['id'], 'member_program_support', $id, 'update', null, ['program_ids' => $ids]);
        return self::getProgramsSupported($req, $res, $route);
    }

    /** PATCH /{id}/convert-type — non-youth type change (Admin/SysAdmin). */
    public static function convertType(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) return Http::error($res, 'Access denied', 403);
        $newType = strtolower(trim((string)(($req->getParsedBody()['member_type'] ?? ''))));
        if (!in_array($newType, ['mentor', 'parent', 'volunteer', 'youth'], true)) {
            return Http::error($res, 'member_type must be one of: mentor, parent, volunteer, youth', 400);
        }
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        $curType = strtolower((string)($m['member_type'] ?? ''));
        if ($curType === $newType) return Http::error($res, "Member is already a {$newType}.", 400);
        // A youth can only convert INTO an adult type — never youth→youth (blocked above).
        // Their history (time, enrollments, records) is preserved; only member_type + role change.
        if ($curType === 'youth' && !in_array($newType, ['mentor', 'parent', 'volunteer'], true)) {
            return Http::error($res, 'A youth can be converted to Mentor, Parent, or Volunteer.', 400);
        }

        $pdo->prepare("UPDATE members SET member_type = ? WHERE id = ?")->execute([$newType, $id]);

        // Swap the member-type system role so PERMISSIONS follow the type. The old tool
        // only flipped member_type and left the stale role behind — so a youth converted
        // from a parent kept parent-level access. Remove the previous type's role, add the
        // new one, and leave any other roles (Purchasing Manager, etc.) untouched.
        $map = Permissions::memberTypeRoleMap();
        $oldRole = $map[$curType] ?? null;
        $newRole = $map[$newType] ?? null;
        $roleChange = [];
        if ($oldRole && $oldRole !== $newRole) {
            $del = $pdo->prepare("DELETE mr FROM member_system_roles mr JOIN system_roles sr ON sr.id = mr.role_id
                                  WHERE mr.member_id = ? AND sr.name = ?");
            $del->execute([$id, $oldRole]);
            if ($del->rowCount() > 0) $roleChange['removed'] = $oldRole;
        }
        if ($newRole) {
            $rid = (int)($pdo->query("SELECT id FROM system_roles WHERE name = " . $pdo->quote($newRole))->fetchColumn() ?: 0);
            if ($rid) {
                $ex = $pdo->prepare("SELECT 1 FROM member_system_roles WHERE member_id = ? AND role_id = ?");
                $ex->execute([$id, $rid]);
                if (!$ex->fetch()) {
                    $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")->execute([$id, $rid]);
                    $roleChange['added'] = $newRole;
                }
            }
        }

        // Youth → adult: they're a full adult now. Clear the junior-mentor flag, and for a
        // new mentor make sure a compliance (adult_roles) record exists so FIRST-YPP tracking
        // (YPT / background check / etc.) starts — mirroring the "Promote to Mentor" path.
        if ($curType === 'youth') {
            $pdo->prepare("UPDATE members SET is_junior_mentor = false WHERE id = ?")->execute([$id]);
            if ($newType === 'mentor') {
                $ar = $pdo->prepare("SELECT id, role FROM adult_roles WHERE member_id = ?"); $ar->execute([$id]);
                $adult = $ar->fetch();
                if (!$adult) $pdo->prepare("INSERT INTO adult_roles (member_id, role) VALUES (?, 'Mentor')")->execute([$id]);
                elseif (empty($adult['role'])) $pdo->prepare("UPDATE adult_roles SET role = 'Mentor' WHERE id = ?")->execute([(int)$adult['id']]);
            }
        }

        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'convert_type',
            ['member_type' => $curType], ['member_type' => $newType, 'role_change' => $roleChange]);
        return Http::json($res, ['ok' => true, 'member_id' => $id, 'old_type' => $curType, 'new_type' => $newType,
            'role_change' => $roleChange]);
    }

    /** PATCH /{id}/promote-to-mentor — junior mentor → full mentor (Admin/SysAdmin). */
    public static function promoteToMentor(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.system_permissions', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        if (strtolower((string)($m['member_type'] ?? '')) !== 'youth') return Http::error($res, 'Only youth members can be promoted to mentor.', 400);
        if (empty($m['is_junior_mentor'])) return Http::error($res, 'This member is not a Junior Mentor. Mark them as a Junior Mentor first.', 400);
        $pdo->prepare("UPDATE members SET member_type = 'mentor', is_junior_mentor = false WHERE id = ?")->execute([$id]);
        $ar = $pdo->prepare("SELECT id, role FROM adult_roles WHERE member_id = ?"); $ar->execute([$id]);
        $adult = $ar->fetch();
        if (!$adult) $pdo->prepare("INSERT INTO adult_roles (member_id, role) VALUES (?, 'Mentor')")->execute([$id]);
        elseif (!$adult['role']) $pdo->prepare("UPDATE adult_roles SET role = 'Mentor' WHERE id = ?")->execute([(int)$adult['id']]);
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'promote_to_mentor',
            ['member_type' => 'youth', 'is_junior_mentor' => true], ['member_type' => 'mentor', 'is_junior_mentor' => false]);
        return Http::json($res, ['ok' => true, 'member_id' => $id, 'new_type' => 'mentor']);
    }

    /** PATCH /{id}/deactivate (Admin/SysAdmin). */
    /**
     * Put a member on the locked-down "Default" role. With $replaceAll, removes any
     * other roles first (used when archiving/deactivating); otherwise just ensures
     * Default is present (used for new members until an explicit role is set).
     */
    /**
     * Grant the system role that matches a member_type ('parent' -> Parent,
     * 'youth' -> Youth Member, …) from MEMBER_TYPE_ROLE_MAP. Idempotent, and leaves
     * every other role alone. Returns the role name granted, or null if the type has
     * no mapped role or the role doesn't exist in this environment.
     */
    public static function addTypeRole(PDO $pdo, int $memberId, string $memberType): ?string
    {
        $role = Permissions::memberTypeRoleMap()[$memberType] ?? null;
        if (!$role) return null;
        $rid = (int)($pdo->query("SELECT id FROM system_roles WHERE name = " . $pdo->quote($role))->fetchColumn() ?: 0);
        if (!$rid) return null;
        $ex = $pdo->prepare("SELECT 1 FROM member_system_roles WHERE member_id = ? AND role_id = ?");
        $ex->execute([$memberId, $rid]);
        if (!$ex->fetch()) {
            $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")->execute([$memberId, $rid]);
        }
        return $role;
    }

    public static function setDefaultRole(PDO $pdo, int $memberId, bool $replaceAll = false): void
    {
        $rid = (int)($pdo->query("SELECT id FROM system_roles WHERE name = 'Default'")->fetchColumn() ?: 0);
        if (!$rid) return;
        if ($replaceAll) {
            $pdo->prepare("DELETE FROM member_system_roles WHERE member_id = ?")->execute([$memberId]);
        }
        $ex = $pdo->prepare("SELECT 1 FROM member_system_roles WHERE member_id = ? AND role_id = ?");
        $ex->execute([$memberId, $rid]);
        if (!$ex->fetch()) {
            $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")->execute([$memberId, $rid]);
        }
    }

    public static function deactivate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.archive', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        if (!self::loadMember($pdo, $id)) return Http::error($res, 'Member not found', 404);
        $pdo->prepare("UPDATE members SET is_active = false WHERE id = ?")->execute([$id]);
        self::setDefaultRole($pdo, $id, true); // inactive members drop to Default
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'deactivate', null, ['is_active' => false, 'roles_reset_to_default' => true]);
        return Http::json($res, ['ok' => true]);
    }

    /**
     * PATCH /{id}/active — light Active/Inactive toggle (Admin, members.edit_others).
     * Unlike deactivate()/archive(), this does NOT touch roles and is freely
     * reversible. Inactive members stay visible/searchable but are excluded from
     * the active-member headcount used for the business plan.
     */
    public static function setActive(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        $body = (array)($req->getParsedBody() ?? []);
        $active = filter_var($body['is_active'] ?? true, FILTER_VALIDATE_BOOLEAN);
        $pdo->prepare("UPDATE members SET is_active = ? WHERE id = ?")->execute([$active ? 1 : 0, $id]);
        Audit::write($pdo, (int)$cur['id'], 'members', $id, $active ? 'reactivate' : 'set_inactive', ['is_active' => (bool)$m['is_active']], ['is_active' => $active]);
        return Http::json($res, ['ok' => true, 'member_id' => $id, 'is_active' => $active]);
    }

    /** PATCH /{id}/archive (Admin/SysAdmin). */
    public static function archive(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'members.archive', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        if (!empty($m['is_archived'])) return Http::error($res, 'Member is already archived.', 400);
        $pdo->prepare("UPDATE members SET is_archived = true, archived_at = NOW(), archived_by_id = ? WHERE id = ?")->execute([(int)$cur['id'], $id]);
        self::setDefaultRole($pdo, $id, true); // archived members drop to Default
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'archive', null, ['is_archived' => true, 'roles_reset_to_default' => true]);
        return Http::json($res, ['ok' => true, 'member_id' => $id, 'is_archived' => true]);
    }

    /** PATCH /{id}/unarchive — System Administrator only. */
    public static function unarchive(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $roles = Permissions::effectiveRolesFor($pdo, $cur);
        if (!in_array('System Administrator', $roles, true)) return Http::error($res, 'Only a System Administrator can un-archive a member.', 403);
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        if (empty($m['is_archived'])) return Http::error($res, 'Member is not archived.', 400);
        $pdo->prepare("UPDATE members SET is_archived = false, archived_at = NULL, archived_by_id = NULL WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'unarchive', null, ['is_archived' => false]);
        return Http::json($res, ['ok' => true, 'member_id' => $id, 'is_archived' => false]);
    }

    /** PATCH /{id}/compliance-exemption — toggle, System Administrator only. */
    public static function complianceExemption(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        // require_roles("System Administrator") — Admin/SysAdmin always pass.
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['System Administrator'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        $m = self::loadMember($pdo, $id);
        if (!$m) return Http::error($res, 'Member not found', 404);
        $newValue = empty($m['is_compliance_exempt']);
        $pdo->prepare("UPDATE members SET is_compliance_exempt = ? WHERE id = ?")->execute([(int)$newValue, $id]);
        Audit::write($pdo, (int)$cur['id'], 'members', $id, 'compliance.exemption', null, ['is_compliance_exempt' => (bool)$newValue]);
        $m['is_compliance_exempt'] = $newValue;
        return Http::json($res, array_merge(
            ['ok' => true, 'member_id' => $id, 'is_compliance_exempt' => $newValue],
            EnrollmentService::exemptStatus($pdo, $m)
        ));
    }

    /** Normalize PG string/bool/int types to JSON-friendly values. */
    private static function castMember(array $m): array
    {
        foreach (['id', 'graduation_year', 'robotics_experience_years'] as $k) {
            if (array_key_exists($k, $m) && $m[$k] !== null) {
                $m[$k] = (int)$m[$k];
            }
        }
        foreach (['is_active', 'is_archived', 'is_kiosk', 'is_system', 'is_junior_mentor',
                  'is_compliance_exempt', 'force_password_change',
                  'youth_tc_agreed', 'parent_tc_agreed'] as $k) {
            if (array_key_exists($k, $m) && $m[$k] !== null) {
                $m[$k] = (bool)$m[$k];
            }
        }
        // Which profile panes the member hides from others (private by default).
        if (array_key_exists('ui_preferences', $m)) $m['private_sections'] = self::privateSections($m);
        // School grade, derived from graduation_year against the current season — never
        // stored, so it advances on its own each season. See App\Core\Grade.
        if (array_key_exists('graduation_year', $m)) {
            $m['grade'] = Grade::fromGraduationYear($m['graduation_year'] ?? null);
            $m['grade_label'] = Grade::label($m['grade']);
        }
        return $m;
    }
}
