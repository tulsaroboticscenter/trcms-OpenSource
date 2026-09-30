<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Permissions;
use App\Core\Audit;
use App\Core\Http;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;

/**
 * Medical Consent & Emergency Information form (member_medical), one per member per
 * season. Collected during registration — a youth's is completed/signed by a parent
 * or guardian; an adult volunteer signs their own. Tracked, not gating check-in.
 *
 * Read/write access: the member (if adult), a family guardian of the member, or a
 * staff member with members.view_medical. Medical data is never returned in general
 * member endpoints — only here, behind these checks.
 */
final class MedicalController
{
    private const FIELDS = [
        'contact_address', 'contact_city_state', 'contact_zip',
        'guardian1_name', 'guardian1_phone', 'guardian2_name', 'guardian2_phone',
        'alt_contact_name', 'alt_contact_relationship', 'alt_contact_phone',
        'ins_company', 'ins_member_phone', 'ins_policy', 'ins_group',
        'otc_permission', 'health_problems', 'food_allergies', 'environmental_allergies', 'accommodations',
        'medication_allergies', 'medications_current', 'notes',
    ];

    private static function canRead(PDO $pdo, array $cur, int $memberId): bool
    {
        if ((int)$cur['id'] === $memberId) return true;
        if (MembersController::isFamilyParentOf($pdo, $cur, $memberId)) return true;
        return Permissions::memberCan($pdo, $cur, 'members.view_medical', 'read');
    }
    private static function canWrite(PDO $pdo, array $cur, int $memberId): bool
    {
        // A youth may not sign their own medical form (needs a guardian); adults may.
        $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?"); $mt->execute([$memberId]);
        $isYouth = ($mt->fetchColumn() ?: '') === 'youth';
        if (!$isYouth && (int)$cur['id'] === $memberId) return true;
        if (MembersController::isFamilyParentOf($pdo, $cur, $memberId)) return true;
        return Permissions::memberCan($pdo, $cur, 'members.edit_others', 'write');
    }

    /** Treatment-authorization coverage window for a season: Oct 1 → Jul 31 next year. */
    private static function coverage(int $year): array
    {
        return ['start' => sprintf('%04d-10-01', $year), 'end' => sprintf('%04d-07-31', $year + 1)];
    }

    /** GET /medical/{member_id}?year= — the form, prefilled from the member + last year. */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if (!self::canRead($pdo, $cur, $mid)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $year = (int)($q['year'] ?? gmdate('Y'));

        $mem = $pdo->prepare("SELECT first_name, last_name, member_type, birthday, address_line1, city, state, zip_code,
                                     guardian1_name, guardian1_phone, guardian2_name, guardian2_phone,
                                     emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
                              FROM members WHERE id = ?");
        $mem->execute([$mid]);
        $m = $mem->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);

        $cur1 = $pdo->prepare("SELECT * FROM member_medical WHERE member_id = ? AND enrollment_year = ?");
        $cur1->execute([$mid, $year]); $existing = $cur1->fetch() ?: null;
        $prev = null;
        if (!$existing) { $p = $pdo->prepare("SELECT * FROM member_medical WHERE member_id = ? AND enrollment_year < ? ORDER BY enrollment_year DESC LIMIT 1"); $p->execute([$mid, $year]); $prev = $p->fetch() ?: null; }

        // Prefill order: this year's saved row → last year's → the member record.
        $base = $existing ?: $prev ?: [];
        $val = fn(string $k, $fallback = null) => ($base[$k] ?? null) !== null && ($base[$k] ?? '') !== '' ? $base[$k] : $fallback;
        $cov = self::coverage($year);

        $form = [
            'member_id' => $mid,
            'member_name' => trim($m['first_name'] . ' ' . $m['last_name']),
            'member_type' => $m['member_type'],
            'is_youth' => $m['member_type'] === 'youth',
            'birthday' => $m['birthday'],
            'enrollment_year' => $year,
            'on_file' => (bool)($existing && $existing['signed_at']),
            'signed_at' => Time::naiveIso($existing['signed_at'] ?? null),
            'signed_name' => $existing['signed_name'] ?? null,
            'coverage_start' => $existing['coverage_start'] ?? $cov['start'],
            'coverage_end' => $existing['coverage_end'] ?? $cov['end'],
            'contact_address' => $val('contact_address', $m['address_line1']),
            'contact_city_state' => $val('contact_city_state', trim(trim((string)$m['city']) . (($m['city'] && $m['state']) ? ', ' : '') . (string)$m['state'])),
            'contact_zip' => $val('contact_zip', $m['zip_code']),
            'guardian1_name' => $val('guardian1_name', $m['guardian1_name']),
            'guardian1_phone' => $val('guardian1_phone', $m['guardian1_phone']),
            'guardian2_name' => $val('guardian2_name', $m['guardian2_name']),
            'guardian2_phone' => $val('guardian2_phone', $m['guardian2_phone']),
            'alt_contact_name' => $val('alt_contact_name', $m['emergency_contact_name']),
            'alt_contact_relationship' => $val('alt_contact_relationship', $m['emergency_contact_relationship']),
            'alt_contact_phone' => $val('alt_contact_phone', $m['emergency_contact_phone']),
            'self_administer' => $existing['self_administer'] ?? $prev['self_administer'] ?? null,
        ];
        foreach (['ins_company', 'ins_member_phone', 'ins_policy', 'ins_group', 'otc_permission',
                  'health_problems', 'food_allergies', 'environmental_allergies', 'medication_allergies',
                  'medications_current', 'notes', 'accommodations'] as $k) $form[$k] = $base[$k] ?? null;
        if ($form['self_administer'] !== null) $form['self_administer'] = (bool)$form['self_administer'];

        return Http::json($res, $form);
    }

    /** POST /medical/{member_id} — save + (optionally) sign the form. */
    public static function save(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if (!self::canWrite($pdo, $cur, $mid)) return Http::error($res, 'You are not permitted to complete this medical form.', 403);
        $d = (array)$req->getParsedBody();
        $year = (int)($d['year'] ?? gmdate('Y'));
        if (!empty($d['treatment_authorized']) && (!isset($d['signed_name']) || trim((string)$d['signed_name']) === '')) {
            return Http::error($res, 'Please type the parent/guardian name to authorize treatment.', 422);
        }
        $signed = self::persist($pdo, $mid, $year, $d, (int)$cur['id']);
        return Http::json($res, ['ok' => true, 'signed' => $signed]);
    }

    /**
     * Write a medical form for a member/year from a raw field array. Shared by the
     * authenticated save() endpoint above and the public visitor self-signup flow so the
     * two never drift. NO permission checks — the caller owns those. $savedById is the
     * acting member, or null for an unauthenticated signup. Returns whether it was signed.
     */
    public static function persist(PDO $pdo, int $mid, int $year, array $d, ?int $savedById): bool
    {
        $data = [];
        foreach (self::FIELDS as $f) $data[$f] = isset($d[$f]) && $d[$f] !== '' ? trim((string)$d[$f]) : null;
        if (!in_array($data['otc_permission'], ['give', 'decline', null], true)) $data['otc_permission'] = null;
        $selfAdmin = array_key_exists('self_administer', $d) && $d['self_administer'] !== null && $d['self_administer'] !== '' ? (int)!empty($d['self_administer']) : null;
        $authorized = !empty($d['treatment_authorized']) ? 1 : 0;
        $signedName = isset($d['signed_name']) ? trim((string)$d['signed_name']) : '';
        $cov = self::coverage($year);
        $covStart = !empty($d['coverage_start']) ? (string)$d['coverage_start'] : $cov['start'];
        $covEnd = !empty($d['coverage_end']) ? (string)$d['coverage_end'] : $cov['end'];
        $now = gmdate('Y-m-d H:i:s');

        $ex = $pdo->prepare("SELECT id, signed_at FROM member_medical WHERE member_id = ? AND enrollment_year = ?");
        $ex->execute([$mid, $year]); $row = $ex->fetch();

        $cols = array_merge(self::FIELDS, ['self_administer', 'treatment_authorized', 'coverage_start', 'coverage_end', 'updated_by_id']);
        $vals = array_merge(array_map(fn($f) => $data[$f], self::FIELDS), [$selfAdmin, $authorized, $covStart, $covEnd, $savedById]);
        // Set the signature only when authorizing (keep an earlier signature otherwise).
        $signAt = $authorized ? $now : ($row['signed_at'] ?? null);
        $signBy = $authorized ? $savedById : null;

        if ($row) {
            $set = implode(', ', array_map(fn($c) => "$c = ?", $cols));
            $args = array_merge($vals, [$signedName ?: null, $signAt, $signBy, (int)$row['id']]);
            $pdo->prepare("UPDATE member_medical SET $set, signed_name = ?, signed_at = ?, signed_by_id = COALESCE(?, signed_by_id) WHERE id = ?")->execute($args);
        } else {
            $colList = implode(', ', array_merge(['member_id', 'enrollment_year'], $cols, ['signed_name', 'signed_at', 'signed_by_id']));
            $ph = implode(', ', array_fill(0, count($cols) + 5, '?'));
            $args = array_merge([$mid, $year], $vals, [$signedName ?: null, $signAt, $signBy]);
            $pdo->prepare("INSERT INTO member_medical ($colList) VALUES ($ph)")->execute($args);
        }
        Audit::write($pdo, $savedById, 'member_medical', $mid, 'medical.save', null, ['year' => $year, 'authorized' => (bool)$authorized, 'via' => $savedById === null ? 'self_signup' : 'form']);
        return (bool)$authorized;
    }
}
