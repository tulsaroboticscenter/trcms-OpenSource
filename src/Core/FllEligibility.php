<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Who should be invited to plan an FLL season — age-appropriate youth plus anyone
 * who has shown interest in that specific program (FLLe=1 / FLLc=2).
 *
 * Age bands are admin-configurable (system_config category 'fll_eligibility') and
 * default to the US FLL ranges. FIRST checks age as of January 1 of the competition
 * year, so a "2026-2027" season is judged on the participant's age on 2027-01-01.
 * The Explore/Challenge bands overlap (9–10), so a child that age is a candidate for
 * both — the director picks.
 */
final class FllEligibility
{
    private const CATEGORY = 'fll_eligibility';

    /** US defaults: FLL Explore ages 6–10, FLL Challenge ages 9–14. */
    private const DEFAULT_BANDS = [
        1 => ['min' => 6, 'max' => 10],
        2 => ['min' => 9, 'max' => 14],
    ];

    /** @return array<int,array{min:int,max:int}> */
    public static function bands(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode((string)$r['values'], true) : null;
        $stored = is_array($v['bands'] ?? null) ? $v['bands'] : [];
        $out = self::DEFAULT_BANDS;
        foreach ($stored as $pid => $band) {
            $pid = (int)$pid;
            if (!isset($out[$pid])) $out[$pid] = ['min' => 0, 'max' => 99];
            if (isset($band['min']) && $band['min'] !== '') $out[$pid]['min'] = (int)$band['min'];
            if (isset($band['max']) && $band['max'] !== '') $out[$pid]['max'] = (int)$band['max'];
        }
        return $out;
    }

    public static function saveBands(PDO $pdo, array $bands): void
    {
        $clean = [];
        foreach ($bands as $pid => $band) {
            $clean[(int)$pid] = ['min' => (int)($band['min'] ?? 0), 'max' => (int)($band['max'] ?? 99)];
        }
        $json = json_encode(['bands' => $clean]);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = ?"); $ex->execute([self::CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, 'FLL Eligibility', ?)")->execute([self::CATEGORY, $json]);
        }
    }

    /** The competition year an FLL season is judged on: the later year of "YYYY-YYYY". */
    public static function refYear(string $season): int
    {
        if (preg_match('/^(\d{4})-(\d{4})$/', $season, $m)) return (int)$m[2];
        if (preg_match('/(\d{4})/', $season, $m)) return (int)$m[1] + 1;
        return (int)gmdate('Y');
    }

    /** Age (whole years) a person is/was on January 1 of $refYear, or null if no DOB. */
    public static function ageOnJan1(?string $birthday, int $refYear): ?int
    {
        if (!$birthday) return null;
        $ts = strtotime((string)$birthday);
        if ($ts === false) return null;
        $by = (int)date('Y', $ts); $bm = (int)date('n', $ts); $bd = (int)date('j', $ts);
        $age = $refYear - $by;
        // Jan 1 reference: anyone with a birthday after Jan 1 hasn't had it yet that year.
        if ($bm > 1 || ($bm === 1 && $bd > 1)) $age -= 1;
        return $age;
    }

    public static function ageEligible(?int $age, array $band): bool
    {
        return $age !== null && $age >= (int)$band['min'] && $age <= (int)$band['max'];
    }
}
