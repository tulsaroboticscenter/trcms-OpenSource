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
 * Merge two member accounts: move every record from a duplicate onto a target,
 * optionally copy contact fields, then delete the duplicate. Admin-gated by the
 * members.merge permission. The whole thing runs in one transaction.
 */
final class MergeController
{
    /**
     * Columns that represent the member's PARTICIPATION (named member_id). Several
     * carry a UNIQUE that includes member_id, so we repoint with UPDATE IGNORE and
     * then delete whatever the target already had (keep target's row on collision).
     */
    private const MEMBER_COLS = [
        ['adult_roles', 'member_id'], ['cert_member_badges', 'member_id'], ['checkins', 'member_id'],
        ['enrollments', 'member_id'], ['event_participants', 'member_id'], ['family_members', 'member_id'],
        ['hotel_room_assignments', 'member_id'], ['member_annual_tc', 'member_id'],
        ['member_certifications', 'member_id'], ['member_comm_preferences', 'member_id'],
        ['member_season_participation', 'member_id'], ['member_system_roles', 'member_id'],
        ['mentor_compliance_records', 'member_id'], ['resource_access', 'member_id'],
        ['season_activity_assignees', 'member_id'], ['team_member_assignments', 'member_id'],
        ['time_entries', 'member_id'], ['ylc_memberships', 'member_id'], ['youth_roles', 'member_id'],
    ];

    /** "Actor / author / responsible" columns — always a plain repoint (no member-uniqueness). */
    private const REF_COLS = [
        ['audit_logs', 'actor_id'], ['communication_messages', 'sender_id'], ['communication_threads', 'created_by_id'],
        ['email_templates', 'created_by_id'], ['enrollment_season_closings', 'closed_by_id'],
        ['event_logistics', 'logistics_lead_id'], ['event_logistics', 'travel_lead_id'], ['event_logistics', 'housing_arranger_id'],
        ['event_logistics', 'equipment_lead_id'], ['event_logistics', 'meal_coordinator_id'],
        ['events', 'coordinator_id'], ['events', 'mentor1_id'], ['events', 'mentor2_id'],
        ['hotel_rooms', 'reimbursement_by_id'], ['inv_battery_tests', 'tested_by_id'],
        ['inv_boms', 'created_by_id'], ['inv_boms', 'submitted_by_id'],
        ['inv_checkouts', 'member_id'], ['inv_checkouts', 'requested_by_id'], ['inv_checkouts', 'approved_by_id'],
        ['inv_movements', 'actor_id'], ['inv_purchase_orders', 'created_by_id'],
        ['member_annual_tc', 'signed_by_id'], ['member_certifications', 'awarded_by_id'],
        ['mentor_compliance_records', 'created_by_id'], ['members', 'archived_by_id'],
        ['resource_access', 'granted_by_member_id'], ['season_activities', 'lead_member_id'],
        ['shopping_items', 'requested_by_id'], ['shopping_items', 'claimed_by_id'],
        ['shopping_items', 'purchased_by_id'], ['shopping_items', 'reimbursed_by_id'],
        ['team_tasks', 'created_by_member_id'], ['team_tasks', 'claimed_by_member_id'], ['team_tasks', 'completed_by_member_id'],
        ['time_entries', 'verified_by_member_id'], ['time_entries', 'created_by_member_id'],
        ['visitors', 'converted_member_id'],
    ];

    /** Contact fields the admin may copy from the duplicate onto the target. */
    private const CONTACT_FIELDS = [
        'email', 'phone', 'alt_email1', 'alt_email2', 'address_line1', 'address_line2', 'city', 'state', 'zip_code',
        'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
        'guardian1_name', 'guardian1_phone', 'guardian1_email', 'guardian2_name', 'guardian2_phone', 'guardian2_email',
        'school', 'birthday', 'shirt_size', 'special_notes',
    ];

    private static function gate(PDO $pdo, Request $req): ?array
    {
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return ['err' => 401, 'detail' => 'Invalid token', 'cur' => null];
        if (!Permissions::memberCan($pdo, $cur, 'members.merge', 'write')) {
            return ['err' => 403, 'detail' => 'You do not have permission to merge members.', 'cur' => null];
        }
        return ['cur' => $cur];
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $s->execute([$id]);
        return $s->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /** Existing table names (lower-cased) — guards against schema drift across environments. */
    private static function existingTables(PDO $pdo): array
    {
        $names = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_NUM);
        return array_map('strtolower', array_column($names, 0));
    }

    /** GET /admin/members/merge-preview?duplicate_id=&target_id= */
    public static function preview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $g = self::gate($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $dupId = (int)($q['duplicate_id'] ?? 0);
        $tgtId = (int)($q['target_id'] ?? 0);
        if (!$dupId || !$tgtId) return Http::error($res, 'duplicate_id and target_id are required.', 422);
        if ($dupId === $tgtId) return Http::error($res, 'Pick two different members.', 422);
        $dup = self::load($pdo, $dupId); $tgt = self::load($pdo, $tgtId);
        if (!$dup || !$tgt) return Http::error($res, 'Member not found.', 404);

        // Per-table record counts that will move off the duplicate.
        $exists = self::existingTables($pdo);
        $counts = [];
        foreach ([...self::MEMBER_COLS, ...self::REF_COLS] as [$table, $col]) {
            if (!in_array(strtolower($table), $exists, true)) continue;
            $s = $pdo->prepare("SELECT COUNT(*) FROM `$table` WHERE `$col` = ?");
            $s->execute([$dupId]);
            $n = (int)$s->fetchColumn();
            if ($n > 0) $counts[] = ['table' => $table, 'column' => $col, 'count' => $n];
        }

        // Contact field comparison (duplicate vs target) for choose-per-field.
        $fields = [];
        foreach (self::CONTACT_FIELDS as $f) {
            $fields[] = ['field' => $f, 'duplicate' => $dup[$f] ?? null, 'target' => $tgt[$f] ?? null];
        }

        $brief = fn($m) => [
            'id' => (int)$m['id'], 'name' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')),
            'member_number' => $m['member_number'] ?? null, 'member_type' => $m['member_type'] ?? null,
            'username' => $m['username'] ?? null, 'email' => $m['email'] ?? null, 'is_active' => (bool)$m['is_active'],
        ];
        return Http::json($res, [
            'duplicate' => $brief($dup), 'target' => $brief($tgt),
            'record_counts' => $counts, 'total_records' => array_sum(array_column($counts, 'count')),
            'contact_fields' => $fields,
        ]);
    }

    /**
     * POST /admin/members/merge
     * Body: { duplicate_id, target_id, contact: { field: "duplicate"|"target", ... } }
     * contact maps each field to which account's value to keep on the merged record.
     */
    public static function execute(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $g = self::gate($pdo, $req); if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['cur'];
        $d = (array)$req->getParsedBody();
        $dupId = (int)($d['duplicate_id'] ?? 0);
        $tgtId = (int)($d['target_id'] ?? 0);
        if (!$dupId || !$tgtId) return Http::error($res, 'duplicate_id and target_id are required.', 422);
        if ($dupId === $tgtId) return Http::error($res, 'Pick two different members.', 422);
        $dup = self::load($pdo, $dupId); $tgt = self::load($pdo, $tgtId);
        if (!$dup || !$tgt) return Http::error($res, 'Member not found.', 404);
        if (!empty($dup['is_system']) || !empty($tgt['is_system'])) return Http::error($res, 'System accounts cannot be merged.', 400);

        $contact = (array)($d['contact'] ?? []);
        $exists = self::existingTables($pdo);
        $moved = [];

        $pdo->beginTransaction();
        try {
            // 1. Participation columns: repoint non-colliding rows, drop the duplicate's leftovers.
            foreach (self::MEMBER_COLS as [$table, $col]) {
                if (!in_array(strtolower($table), $exists, true)) continue;
                $u = $pdo->prepare("UPDATE IGNORE `$table` SET `$col` = ? WHERE `$col` = ?");
                $u->execute([$tgtId, $dupId]);
                $moved[$table] = ($moved[$table] ?? 0) + $u->rowCount();
                $pdo->prepare("DELETE FROM `$table` WHERE `$col` = ?")->execute([$dupId]);
            }
            // 2. Actor/author columns: straight repoint.
            foreach (self::REF_COLS as [$table, $col]) {
                if (!in_array(strtolower($table), $exists, true)) continue;
                $u = $pdo->prepare("UPDATE `$table` SET `$col` = ? WHERE `$col` = ?");
                $u->execute([$tgtId, $dupId]);
                if ($u->rowCount() > 0) $moved[$table] = ($moved[$table] ?? 0) + $u->rowCount();
            }
            // 2b. Collapse logical duplicates the merge may have created in tables
            // that lack a DB unique (a member shouldn't hold the same role twice,
            // or sit on the same team-season twice). Keep the lowest id.
            foreach ([['member_system_roles', 'role_id'], ['team_member_assignments', 'team_season_id']] as [$table, $other]) {
                if (!in_array(strtolower($table), $exists, true)) continue;
                $pdo->prepare(
                    "DELETE a FROM `$table` a JOIN `$table` b
                     ON a.member_id = b.member_id AND a.`$other` = b.`$other` AND a.id > b.id
                     WHERE a.member_id = ?"
                )->execute([$tgtId]);
            }

            // 3. Copy chosen contact fields from the duplicate onto the target.
            $set = []; $args = [];
            foreach (self::CONTACT_FIELDS as $f) {
                if (($contact[$f] ?? 'target') === 'duplicate') { $set[] = "`$f` = ?"; $args[] = $dup[$f] ?? null; }
            }
            if ($set) { $args[] = $tgtId; $pdo->prepare("UPDATE members SET " . implode(', ', $set) . " WHERE id = ?")->execute($args); }

            // 4. Delete the duplicate member.
            $pdo->prepare("DELETE FROM members WHERE id = ?")->execute([$dupId]);

            Audit::write($pdo, (int)$cur['id'], 'members', $tgtId, 'merge', [
                'duplicate_id' => $dupId, 'duplicate_name' => trim(($dup['first_name'] ?? '') . ' ' . ($dup['last_name'] ?? '')),
                'duplicate_member_number' => $dup['member_number'] ?? null,
            ], ['moved' => array_filter($moved), 'contact_overrides' => array_keys(array_filter($contact, fn($v) => $v === 'duplicate'))]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Merge failed and was rolled back: ' . $e->getMessage(), 500);
        }

        return Http::json($res, ['ok' => true, 'target_id' => $tgtId, 'deleted_id' => $dupId, 'moved' => array_filter($moved)]);
    }
}
