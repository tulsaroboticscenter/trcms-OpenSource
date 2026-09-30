/**
 * School grade <-> graduation year, mirroring App\Core\Grade on the server.
 *
 * Only `graduation_year` is ever stored. Grade is derived from it against the current
 * season, which is what makes a member's grade advance on its own each season with no
 * rollover step to run and nothing that can double-increment.
 *
 * These helpers exist for the EDIT form, where the two fields have to track each other
 * live as the user changes either one. For read-only display prefer the server's
 * `grade_label` on the member payload, so there is one authority for the wording.
 *
 *   grade = 12 - graduation_year + season_year + 1
 */
export const SENIOR = 12;

export function gradeFromGradYear(graduationYear: number, seasonYear: number): number {
  return SENIOR - graduationYear + seasonYear + 1;
}

export function gradYearFromGrade(grade: number, seasonYear: number): number {
  return SENIOR - grade + seasonYear + 1;
}

/** Grades outside K-12 are reported honestly rather than clamped to a valid-looking one. */
export function gradeLabel(grade: number | null | undefined): string | null {
  if (grade === null || grade === undefined) return null;
  if (grade > SENIOR) return "Graduated";
  if (grade === 0) return "Kindergarten";
  if (grade < 0) return "Pre-K";
  const m100 = grade % 100, m10 = grade % 10;
  const suffix = m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th";
  return `${grade}${suffix} grade`;
}

/** Options for the grade picker: Pre-K, Kindergarten, then 1-12. */
export const GRADE_OPTIONS: { value: number; label: string }[] = [
  { value: -1, label: "Pre-K" },
  { value: 0, label: "Kindergarten" },
  ...Array.from({ length: SENIOR }, (_, i) => ({ value: i + 1, label: gradeLabel(i + 1) as string })),
];
