<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * The one place a youth's meeting-night preference is read and written.
 *
 * A preference belongs to a youth (as a visitor before they're a member, as a member
 * after) for a given program + season. Every intake surface -- the visitor kiosk, the
 * visitor->member convert, the waitlist, enrollment, the planning board -- goes through
 * here so the answer is captured once and never diverges. See migration 0156.
 *
 * The shape the FLL Director chose: available_night_ids (nights that work, a list of
 * program_nights.id) + preferred_night_id (the single preferred night), plus a
 * siblings_together flag for the family default.
 */
final class NightPrefs
{
    /**
     * A program is an "FLL program" (night-based structure) if it has an eligibility age
     * band configured — FllEligibility keys its bands by the FLL program ids (FLLe/FLLc,
     * admin-configurable). FTC/FRC/FDP have no band and so are excluded.
     */
    public static function isFllProgram(PDO $pdo, int $programId): bool
    {
        return array_key_exists($programId, FllEligibility::bands($pdo));
    }

    /**
     * Whether a night preference should be collected for this youth. The program must be
     * an FLL program AND — when the birthday is known — the youth's FIRST age (as of Jan 1
     * of the competition year) must fall in that program's band. An unknown birthday is
     * allowed through: we can't disqualify what we can't measure, and intake usually has no
     * DOB yet — hiding it there would recreate the very gap this feature closes.
     *
     * @return array{applies:bool,is_fll:bool,age:?int,in_band:?bool}
     */
    public static function applies(PDO $pdo, int $programId, ?string $birthday, string $season): array
    {
        if (!self::isFllProgram($pdo, $programId)) {
            return ['applies' => false, 'is_fll' => false, 'age' => null, 'in_band' => null];
        }
        $band = FllEligibility::bands($pdo)[$programId];
        $age = FllEligibility::ageOnJan1($birthday, FllEligibility::refYear($season));
        $inBand = $age === null ? null : FllEligibility::ageEligible($age, $band);
        return ['applies' => $age === null ? true : $inBand, 'is_fll' => true, 'age' => $age, 'in_band' => $inBand];
    }

    /** Season string for an enrollment year, e.g. 2026 -> "2026-2027". */
    public static function seasonFor(int $year): string
    {
        return "$year-" . ($year + 1);
    }

    /** The current planning season ("YYYY-YYYY"). */
    public static function currentSeason(): string
    {
        return self::seasonFor(EnrollmentService::currentEnrollmentYear());
    }

    /**
     * Read the canonical preference for a youth. Pass whichever id you have; if only a
     * visitor_id is known but the visitor has already converted, the member row is
     * preferred. Returns null when nothing has been captured yet.
     *
     * @return array{available_night_ids:int[],preferred_night_id:?int,flexible:bool,siblings_together:bool,source:?string,notes:?string}|null
     */
    public static function get(PDO $pdo, ?int $memberId, ?int $visitorId, int $programId, string $season): ?array
    {
        $row = null;
        if ($memberId) {
            $s = $pdo->prepare("SELECT * FROM night_preferences WHERE member_id = ? AND program_id = ? AND season = ?");
            $s->execute([$memberId, $programId, $season]);
            $row = $s->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        if (!$row && $visitorId) {
            $s = $pdo->prepare("SELECT * FROM night_preferences WHERE visitor_id = ? AND program_id = ? AND season = ?");
            $s->execute([$visitorId, $programId, $season]);
            $row = $s->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        return $row ? self::hydrate($row) : null;
    }

    /**
     * Upsert a youth's preference. `$fields` may carry any of available_night_ids (array),
     * preferred_night_id (int|null), flexible (bool), siblings_together (bool), notes.
     * Only the keys present are written, so a partial save (e.g. the waitlist tweaking the
     * preferred night) never wipes the rest. Idempotent per (youth, program, season).
     */
    public static function save(
        PDO $pdo,
        ?int $memberId,
        ?int $visitorId,
        int $programId,
        string $season,
        array $fields,
        string $source,
        ?int $actorId
    ): void {
        if (!$memberId && !$visitorId) return;              // nothing to key on
        if (!$programId || $season === '') return;
        if (!self::isFllProgram($pdo, $programId)) return;  // only FLL programs have meeting nights

        // Locate an existing row on whichever id we hold.
        $existing = null;
        if ($memberId) {
            $s = $pdo->prepare("SELECT id FROM night_preferences WHERE member_id = ? AND program_id = ? AND season = ?");
            $s->execute([$memberId, $programId, $season]);
            $existing = $s->fetchColumn() ?: null;
        }
        if (!$existing && $visitorId) {
            $s = $pdo->prepare("SELECT id FROM night_preferences WHERE visitor_id = ? AND program_id = ? AND season = ?");
            $s->execute([$visitorId, $programId, $season]);
            $existing = $s->fetchColumn() ?: null;
        }

        $set = [];
        $args = [];
        if (array_key_exists('available_night_ids', $fields)) {
            $set['available_night_ids'] = $fields['available_night_ids'] === null
                ? null : json_encode(array_values(array_map('intval', (array)$fields['available_night_ids'])));
        }
        if (array_key_exists('preferred_night_id', $fields)) {
            $set['preferred_night_id'] = $fields['preferred_night_id'] === null ? null : (int)$fields['preferred_night_id'];
        }
        if (array_key_exists('flexible', $fields))          $set['flexible'] = (int)!empty($fields['flexible']);
        if (array_key_exists('siblings_together', $fields)) $set['siblings_together'] = (int)!empty($fields['siblings_together']);
        if (array_key_exists('notes', $fields))             $set['notes'] = $fields['notes'] !== null ? (string)$fields['notes'] : null;

        // A save with no recognised fields still (re)stamps source/actor if the caller
        // is only linking a member id -- but with nothing to write and no row, skip.
        if ($existing) {
            $set['source'] = $source;
            $set['updated_by_id'] = $actorId;
            // If we found the row by visitor but now have a member id, backfill it.
            if ($memberId) $set['member_id'] = $memberId;
            $cols = [];
            foreach ($set as $k => $v) { $cols[] = "$k = ?"; $args[] = $v; }
            $args[] = $existing;
            $pdo->prepare("UPDATE night_preferences SET " . implode(', ', $cols) . " WHERE id = ?")->execute($args);
            return;
        }

        // Insert -- only worthwhile if at least one preference field was supplied.
        if (!$set) return;
        $set['member_id'] = $memberId;
        $set['visitor_id'] = $visitorId;
        $set['program_id'] = $programId;
        $set['season'] = $season;
        $set['source'] = $source;
        $set['updated_by_id'] = $actorId;
        $cols = array_keys($set);
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $pdo->prepare("INSERT INTO night_preferences (" . implode(',', $cols) . ") VALUES ($ph)")
            ->execute(array_values($set));
    }

    /**
     * When a visitor becomes a member, move their preference onto the member id so the
     * answer they gave at intake follows them. If the member already has a row (e.g. a
     * later season), the visitor row is left as-is for that season.
     */
    public static function carryVisitorToMember(PDO $pdo, int $visitorId, int $memberId): void
    {
        // For each visitor-keyed preference, attach the member id unless that member
        // already owns a row for the same program+season.
        $rows = $pdo->prepare("SELECT id, program_id, season FROM night_preferences WHERE visitor_id = ? AND member_id IS NULL");
        $rows->execute([$visitorId]);
        foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $dup = $pdo->prepare("SELECT 1 FROM night_preferences WHERE member_id = ? AND program_id = ? AND season = ?");
            $dup->execute([$memberId, $r['program_id'], $r['season']]);
            if ($dup->fetchColumn()) continue;              // member already has one; don't collide
            $pdo->prepare("UPDATE night_preferences SET member_id = ? WHERE id = ?")->execute([$memberId, (int)$r['id']]);
        }
    }

    /**
     * The family default: the most-recently-updated night answer among this member's
     * family, for a program + season, so a newly-added sibling can be pre-filled with
     * "the nights the family already picked". Returns null if the family has none yet.
     *
     * @return array{available_night_ids:int[],preferred_night_id:?int,flexible:bool,siblings_together:bool}|null
     */
    public static function familyDefault(PDO $pdo, int $memberId, int $programId, string $season): ?array
    {
        // Resolve the member's family (via the family_members join), then the newest
        // sibling preference for the same program + season.
        $s = $pdo->prepare(
            "SELECT np.* FROM night_preferences np
               JOIN family_members sib ON sib.member_id = np.member_id
              WHERE sib.family_id IN (SELECT family_id FROM family_members WHERE member_id = ?)
                AND np.program_id = ? AND np.season = ? AND np.member_id <> ?
              ORDER BY np.updated_at DESC LIMIT 1"
        );
        $s->execute([$memberId, $programId, $season, $memberId]);
        $row = $s->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;
        $h = self::hydrate($row);
        return [
            'available_night_ids' => $h['available_night_ids'],
            'preferred_night_id'  => $h['preferred_night_id'],
            'flexible'            => $h['flexible'],
            'siblings_together'   => $h['siblings_together'],
        ];
    }

    /** Shape a raw DB row into typed values. */
    private static function hydrate(array $row): array
    {
        $ids = [];
        if (!empty($row['available_night_ids'])) {
            $decoded = json_decode((string)$row['available_night_ids'], true);
            if (is_array($decoded)) $ids = array_values(array_map('intval', $decoded));
        }
        return [
            'available_night_ids' => $ids,
            'preferred_night_id'  => $row['preferred_night_id'] !== null ? (int)$row['preferred_night_id'] : null,
            'flexible'            => !empty($row['flexible']),
            'siblings_together'   => !empty($row['siblings_together']),
            'source'              => $row['source'] ?? null,
            'notes'               => $row['notes'] ?? null,
        ];
    }
}
