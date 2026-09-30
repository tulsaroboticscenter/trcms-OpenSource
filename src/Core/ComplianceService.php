<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/** Port of app/modules/roles/compliance_service.py (mentor YPT/background-check). */
final class ComplianceService
{
    private static function configInt(PDO $pdo, string $category, int $default): int
    {
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $stmt->execute([$category]);
        $r = $stmt->fetch();
        if (!$r || !$r['values']) return $default;
        $v = json_decode($r['values'], true);
        return (is_array($v) && isset($v[0]) && is_numeric($v[0])) ? (int)$v[0] : $default;
    }

    public static function config(PDO $pdo): array
    {
        return [
            'ypt_valid_years' => self::configInt($pdo, 'ypt_valid_years', 2),
            'bgcheck_valid_years' => self::configInt($pdo, 'bgcheck_valid_years', 2),
            // FIRST registration renews every season → 1-year validity by default.
            'first_valid_years' => self::configInt($pdo, 'first_valid_years', 1),
            'consent_release_valid_years' => self::configInt($pdo, 'consent_release_valid_years', 1),
            'role_specific_valid_years' => self::configInt($pdo, 'role_specific_valid_years', 1),
            'warning_days' => self::configInt($pdo, 'compliance_warning_days', 60),
        ];
    }

    // ── Compliance item definitions (open-source Phase 4) ──────────────────────
    // The five item slots are fixed in the data model (adult_roles columns +
    // typed records), but their LABELS, whether each APPLIES, and whether each
    // GATES CHECK-IN are org-configurable in system_config 'compliance_items'.
    // Defaults preserve the original behaviour: all five apply; YPT + background
    // check gate check-in; the season items (FIRST/consent/role-specific) only nudge.
    private const ITEM_KEYS = ['ypt', 'background_check', 'first', 'consent_release', 'role_specific'];
    private const DEFAULT_ITEMS = [
        'ypt'              => ['label' => 'Youth Protection Training', 'short' => 'YPT',        'enabled' => true, 'gates_checkin' => true],
        'background_check' => ['label' => 'Background Check',          'short' => 'Background',  'enabled' => true, 'gates_checkin' => true],
        'first'            => ['label' => 'FIRST Registration',        'short' => 'FIRST',       'enabled' => true, 'gates_checkin' => false],
        'consent_release'  => ['label' => 'Consent & Release',         'short' => 'Consent',     'enabled' => true, 'gates_checkin' => false],
        'role_specific'    => ['label' => 'Role-Specific Training',    'short' => 'Role Training','enabled' => true, 'gates_checkin' => false],
    ];
    /** Fixed mapping of each item key to its adult_roles columns + validity config key. */
    private const COLMAP = [
        'ypt'              => ['complete' => 'ypt_complete',              'date' => 'ypt_date',              'vy' => 'ypt_valid_years'],
        'background_check' => ['complete' => 'background_check_complete', 'date' => 'background_check_date', 'vy' => 'bgcheck_valid_years'],
        'first'            => ['complete' => 'first_complete',            'date' => 'first_date',            'vy' => 'first_valid_years'],
        'consent_release'  => ['complete' => 'consent_release_complete',  'date' => 'consent_release_date',  'vy' => 'consent_release_valid_years'],
        'role_specific'    => ['complete' => 'role_specific_complete',    'date' => 'role_specific_date',    'vy' => 'role_specific_valid_years'],
    ];

    /**
     * The org's compliance item configuration (defaults overlaid with the stored
     * system_config 'compliance_items' label/short/enabled/gates_checkin overrides),
     * keyed by item key in display order.
     */
    public static function items(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'compliance_items'");
        $s->execute();
        $raw = $s->fetchColumn();
        $stored = $raw ? json_decode((string)$raw, true) : [];
        if (!is_array($stored)) $stored = [];
        $out = [];
        foreach (self::ITEM_KEYS as $key) {
            $def = self::DEFAULT_ITEMS[$key];
            $ov  = is_array($stored[$key] ?? null) ? $stored[$key] : [];
            $out[$key] = [
                'key'           => $key,
                'label'         => isset($ov['label']) && trim((string)$ov['label']) !== '' ? (string)$ov['label'] : $def['label'],
                'short'         => isset($ov['short']) && trim((string)$ov['short']) !== '' ? (string)$ov['short'] : $def['short'],
                'enabled'       => array_key_exists('enabled', $ov) ? (bool)$ov['enabled'] : $def['enabled'],
                'gates_checkin' => array_key_exists('gates_checkin', $ov) ? (bool)$ov['gates_checkin'] : $def['gates_checkin'],
            ];
        }
        return $out;
    }

    public static function saveItems(PDO $pdo, array $items): void
    {
        $clean = [];
        foreach (self::ITEM_KEYS as $key) {
            $in = is_array($items[$key] ?? null) ? $items[$key] : [];
            $clean[$key] = [
                'label'         => mb_substr(trim((string)($in['label'] ?? '')), 0, 60),
                'short'         => mb_substr(trim((string)($in['short'] ?? '')), 0, 24),
                'enabled'       => !empty($in['enabled']),
                'gates_checkin' => !empty($in['gates_checkin']),
            ];
        }
        $json = json_encode($clean);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'compliance_items'"); $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('compliance_items', 'Compliance Items', ?)")->execute([$json]);
        }
    }

    /** Complete + expired status of one item for a member (used by the gate). */
    private static function itemStatus(PDO $pdo, int $memberId, string $key, ?array $role, array $cfg): array
    {
        $map = self::COLMAP[$key];
        $rs = $pdo->prepare("SELECT * FROM mentor_compliance_records WHERE member_id = ? AND compliance_type = ? ORDER BY completed_date DESC LIMIT 1");
        $rs->execute([$memberId, $key]);
        $rec = $rs->fetch() ?: null;
        $expires = $rec ? $rec['expires_date']
            : (($role && ($role[$map['date']] ?? null)) ? self::computeExpires($role[$map['date']], $cfg[$map['vy']]) : null);
        $status = self::statusFor($expires, $cfg['warning_days']);
        return ['complete' => (bool)($role[$map['complete']] ?? false), 'expired' => $status['expired']];
    }

    public static function computeExpires(string $completedDate, int $validYears): string
    {
        return date('Y-m-d', strtotime($completedDate . " +" . ($validYears * 365) . " days"));
    }

    public static function statusFor(?string $expires, int $warningDays, ?string $today = null): array
    {
        $today = $today ?? date('Y-m-d');
        if (!$expires) {
            return ['status' => 'unknown', 'days_remaining' => null, 'expires_date' => null,
                'expiring_soon' => false, 'expired' => false];
        }
        $days = (int)floor((strtotime($expires) - strtotime($today)) / 86400);
        $status = $days < 0 ? 'expired' : ($days <= $warningDays ? 'expiring_soon' : 'valid');
        return ['status' => $status, 'days_remaining' => $days, 'expires_date' => $expires,
            'expiring_soon' => $status === 'expiring_soon', 'expired' => $status === 'expired'];
    }

    public static function memberComplianceStatus(PDO $pdo, int $memberId): array
    {
        $mstmt = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $mstmt->execute([$memberId]);
        $member = $mstmt->fetch();
        $cfg = self::config($pdo);
        if ($member && EnrollmentService::isMemberExempt($pdo, $member)) {
            $info = EnrollmentService::exemptStatus($pdo, $member);
            $unknown = ['status' => 'exempt', 'days_remaining' => null, 'expires_date' => null,
                'expiring_soon' => false, 'expired' => false, 'completed_date' => null];
            return ['is_compliant' => true, 'has_warning' => false, 'exempt' => true,
                'exempt_reason' => $info['reason'], 'ypt' => $unknown, 'background_check' => $unknown,
                'first' => $unknown, 'consent_release' => $unknown, 'role_specific' => $unknown,
                'config' => $cfg, 'item_config' => self::items($pdo)];
        }
        $rstmt = $pdo->prepare("SELECT * FROM adult_roles WHERE member_id = ?"); $rstmt->execute([$memberId]);
        $role = $rstmt->fetch() ?: null;
        $warningDays = $cfg['warning_days'];

        $latest = function (string $type) use ($pdo, $memberId) {
            $s = $pdo->prepare("SELECT * FROM mentor_compliance_records WHERE member_id = ? AND compliance_type = ? ORDER BY completed_date DESC LIMIT 1");
            $s->execute([$memberId, $type]);
            return $s->fetch() ?: null;
        };
        $yptRec = $latest('ypt');
        $bgRec = $latest('background_check');
        $firstRec = $latest('first');
        $crRec = $latest('consent_release');
        $rsRec = $latest('role_specific');

        $yptExpires = $yptRec ? $yptRec['expires_date']
            : (($role && $role['ypt_date']) ? self::computeExpires($role['ypt_date'], $cfg['ypt_valid_years']) : null);
        $bgExpires = $bgRec ? $bgRec['expires_date']
            : (($role && $role['background_check_date']) ? self::computeExpires($role['background_check_date'], $cfg['bgcheck_valid_years']) : null);
        $firstExpires = $firstRec ? $firstRec['expires_date']
            : (($role && ($role['first_date'] ?? null)) ? self::computeExpires($role['first_date'], $cfg['first_valid_years']) : null);
        $crExpires = $crRec ? $crRec['expires_date']
            : (($role && ($role['consent_release_date'] ?? null)) ? self::computeExpires($role['consent_release_date'], $cfg['consent_release_valid_years']) : null);
        $rsExpires = $rsRec ? $rsRec['expires_date']
            : (($role && ($role['role_specific_date'] ?? null)) ? self::computeExpires($role['role_specific_date'], $cfg['role_specific_valid_years']) : null);

        $yptStatus = self::statusFor($yptExpires, $warningDays);
        $bgStatus = self::statusFor($bgExpires, $warningDays);
        $firstStatus = self::statusFor($firstExpires, $warningDays);
        $crStatus = self::statusFor($crExpires, $warningDays);
        $rsStatus = self::statusFor($rsExpires, $warningDays);

        // The hard compliance gate is whichever items the org marks gates_checkin
        // (defaults: YPT + background check — the safety-critical pair). Other items
        // (FIRST registration, Consent & Release, Role-Specific Training) drive a
        // renewal nudge (has_warning) but don't, on their own, block access.
        $items = self::items($pdo);
        $statusByKey = [
            'ypt'              => [$yptStatus,   (bool)($role['ypt_complete'] ?? false)],
            'background_check' => [$bgStatus,    (bool)($role['background_check_complete'] ?? false)],
            'first'            => [$firstStatus, (bool)($role['first_complete'] ?? false)],
            'consent_release'  => [$crStatus,    (bool)($role['consent_release_complete'] ?? false)],
            'role_specific'    => [$rsStatus,    (bool)($role['role_specific_complete'] ?? false)],
        ];
        $isCompliant = true;
        foreach ($items as $key => $it) {
            if (!$it['enabled'] || !$it['gates_checkin']) continue;
            [$st, $complete] = $statusByKey[$key];
            if (!($complete && !$st['expired'])) { $isCompliant = false; break; }
        }
        $firstComplete = (bool)($role['first_complete'] ?? false);
        $crComplete = (bool)($role['consent_release_complete'] ?? false);
        $rsComplete = (bool)($role['role_specific_complete'] ?? false);
        $hasWarning = $yptStatus['expiring_soon'] || $bgStatus['expiring_soon']
            || $firstStatus['expiring_soon'] || ($firstComplete && $firstStatus['expired'])
            || $crStatus['expiring_soon'] || ($crComplete && $crStatus['expired'])
            || $rsStatus['expiring_soon'] || ($rsComplete && $rsStatus['expired']);

        return [
            'is_compliant' => (bool)$isCompliant, 'has_warning' => $hasWarning,
            'ypt' => array_merge($yptStatus, [
                'completed_date' => $yptRec ? $yptRec['completed_date'] : ($role['ypt_date'] ?? null),
                'enrollment_year' => $yptRec ? (int)$yptRec['enrollment_year'] : null,
            ]),
            'background_check' => array_merge($bgStatus, [
                'completed_date' => $bgRec ? $bgRec['completed_date'] : ($role['background_check_date'] ?? null),
                'enrollment_year' => $bgRec ? (int)$bgRec['enrollment_year'] : null,
            ]),
            'first' => array_merge($firstStatus, [
                'completed_date' => $firstRec ? $firstRec['completed_date'] : ($role['first_date'] ?? null),
                'enrollment_year' => $firstRec ? (int)$firstRec['enrollment_year'] : null,
            ]),
            'consent_release' => array_merge($crStatus, [
                'completed_date' => $crRec ? $crRec['completed_date'] : ($role['consent_release_date'] ?? null),
                'enrollment_year' => $crRec ? (int)$crRec['enrollment_year'] : null,
            ]),
            'role_specific' => array_merge($rsStatus, [
                'completed_date' => $rsRec ? $rsRec['completed_date'] : ($role['role_specific_date'] ?? null),
                'enrollment_year' => $rsRec ? (int)$rsRec['enrollment_year'] : null,
            ]),
            'config' => $cfg,
            'item_config' => $items,
        ];
    }

    /**
     * Per-item "compliant now" booleans for a member (complete AND not expired), for the roster
     * flags on team pages. Complete-but-expired reads as false so it greys out as a discrepancy.
     * Returns keys: first, consent_release, background_check, ypt, role_specific.
     */
    public static function memberFirstFlags(PDO $pdo, int $memberId): array
    {
        $s = self::memberComplianceStatus($pdo, $memberId);
        $rstmt = $pdo->prepare("SELECT * FROM adult_roles WHERE member_id = ?"); $rstmt->execute([$memberId]);
        $role = $rstmt->fetch() ?: [];
        $ok = fn(string $key, string $completeCol) => (bool)($role[$completeCol] ?? false) && empty($s[$key]['expired']);
        return [
            'first' => $ok('first', 'first_complete'),
            'consent_release' => $ok('consent_release', 'consent_release_complete'),
            'background_check' => $ok('background_check', 'background_check_complete'),
            'ypt' => $ok('ypt', 'ypt_complete'),
            'role_specific' => $ok('role_specific', 'role_specific_complete'),
        ];
    }

    /**
     * Check-in compliance gate: YPT + background check must both be complete
     * and unexpired. Unlike memberComplianceStatus(), this is NOT waived by the
     * Admin / System Administrator role — only by the explicit per-member
     * is_compliance_exempt override flag. Returns ['ok' => bool, 'reason' => ?string].
     */
    public static function checkinComplianceOk(PDO $pdo, array $member): array
    {
        if (!empty($member['is_compliance_exempt'])) return ['ok' => true, 'reason' => null];
        $memberId = (int)$member['id'];
        $cfg = self::config($pdo);
        $rstmt = $pdo->prepare("SELECT * FROM adult_roles WHERE member_id = ?"); $rstmt->execute([$memberId]);
        $role = $rstmt->fetch() ?: null;
        // Gate on whichever items the org marks gates_checkin (defaults: YPT + background).
        $missing = [];
        foreach (self::items($pdo) as $key => $it) {
            if (!$it['enabled'] || !$it['gates_checkin']) continue;
            $st = self::itemStatus($pdo, $memberId, $key, $role, $cfg);
            if ($st['complete'] && !$st['expired']) continue;
            $missing[] = $st['expired'] ? "{$it['label']} (expired)" : $it['label'];
        }
        if (!$missing) return ['ok' => true, 'reason' => null];
        return ['ok' => false, 'reason' => implode(' and ', $missing)];
    }

    public static function serializeRecord(array $rec): array
    {
        return [
            'id' => (int)$rec['id'], 'member_id' => (int)$rec['member_id'],
            'compliance_type' => $rec['compliance_type'], 'enrollment_year' => (int)$rec['enrollment_year'],
            'enrollment_year_label' => $rec['enrollment_year'] . '–' . ($rec['enrollment_year'] + 1),
            'completed_date' => $rec['completed_date'], 'expires_date' => $rec['expires_date'],
            'notes' => $rec['notes'], 'created_at' => Time::naiveIso($rec['created_at'] ?? null),
        ];
    }

    /**
     * Which adults must meet YPT + background-check compliance: mentors always, plus any
     * adult explicitly flagged requires_ypt (a "TRC Volunteer" who is around youth
     * regularly — #182). One source of truth so the check-in gate, dashboards and reports
     * agree. SQL form is COMPLIANCE_REQUIRED_SQL for use in WHERE clauses.
     */
    public const COMPLIANCE_REQUIRED_SQL = "(member_type = 'mentor' OR requires_ypt = 1)";
    public static function requiresCompliance(array $member): bool
    {
        return (($member['member_type'] ?? '') === 'mentor') || !empty($member['requires_ypt']);
    }

    public static function expiringMentors(PDO $pdo): array
    {
        $mentors = $pdo->query("SELECT id, first_name, last_name, member_number, photo_url FROM members WHERE " . self::COMPLIANCE_REQUIRED_SQL . " AND is_active = true")->fetchAll();
        $out = [];
        foreach ($mentors as $m) {
            $status = self::memberComplianceStatus($pdo, (int)$m['id']);
            if ($status['has_warning'] || !$status['is_compliant']) {
                $out[] = array_merge([
                    'member_id' => (int)$m['id'], 'first_name' => $m['first_name'], 'last_name' => $m['last_name'],
                    'member_number' => $m['member_number'], 'photo_url' => $m['photo_url'],
                ], $status);
            }
        }
        return $out;
    }
}
