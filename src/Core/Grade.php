<?php
declare(strict_types=1);

namespace App\Core;

/**
 * School grade <-> graduation year.
 *
 * Grade is DERIVED, never stored. `members.graduation_year` stays the single source
 * of truth and grade is computed from it against the current season. That has one
 * property worth stating plainly: **the grade advances by itself every season**, with
 * no rollover step to run and nothing that can double-increment if a rollover is run
 * twice, or drift if a member is edited mid-season. A stored grade column would need
 * all of that machinery and would still be wrong for anyone edited out of band.
 *
 * The mapping assumes the US convention where a student graduates in the spring of
 * their 12th-grade academic year. TRCMS seasons already start in July, so the season
 * year and the academic year that starts that autumn are the same number.
 *
 *   grade = 12 - graduation_year + season_year + 1
 *
 * e.g. in the 2026 season (academic year 2026-27) a 2027 graduate is in grade 12,
 * and a 9th-grader graduates in 2030.
 */
final class Grade
{
    public const KINDERGARTEN = 0;
    public const SENIOR = 12;

    /** Grade for a graduation year in the given season (defaults to the current one). */
    public static function fromGraduationYear(?int $graduationYear, ?int $seasonYear = null): ?int
    {
        if (!$graduationYear) return null;
        $season = $seasonYear ?? EnrollmentService::currentEnrollmentYear();
        return self::SENIOR - $graduationYear + $season + 1;
    }

    /** Graduation year for a grade in the given season — the inverse of the above. */
    public static function toGraduationYear(?int $grade, ?int $seasonYear = null): ?int
    {
        if ($grade === null) return null;
        $season = $seasonYear ?? EnrollmentService::currentEnrollmentYear();
        return self::SENIOR - $grade + $season + 1;
    }

    /**
     * Human label. Grades outside K-12 are still returned rather than clamped — a
     * member whose graduation year is stale should read "Graduated", not silently
     * show as a senior forever.
     */
    public static function label(?int $grade): ?string
    {
        if ($grade === null) return null;
        if ($grade > self::SENIOR) return 'Graduated';
        if ($grade === self::KINDERGARTEN) return 'Kindergarten';
        if ($grade < self::KINDERGARTEN) return 'Pre-K';
        $suffix = match (true) {
            $grade % 100 >= 11 && $grade % 100 <= 13 => 'th',
            $grade % 10 === 1 => 'st',
            $grade % 10 === 2 => 'nd',
            $grade % 10 === 3 => 'rd',
            default => 'th',
        };
        return $grade . $suffix . ' grade';
    }

    /** Options for a grade picker: Pre-K and K through 12. */
    public static function options(): array
    {
        $out = [['value' => -1, 'label' => 'Pre-K'], ['value' => 0, 'label' => 'Kindergarten']];
        for ($g = 1; $g <= self::SENIOR; $g++) $out[] = ['value' => $g, 'label' => self::label($g)];
        return $out;
    }
}
