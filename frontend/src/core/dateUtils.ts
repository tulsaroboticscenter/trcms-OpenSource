/**
 * Date utilities that avoid JavaScript's timezone-conversion trap.
 *
 * The problem:
 *   new Date("1974-08-27")            // parsed as UTC midnight
 *     .toLocaleDateString()           // converted to local time → shows 8/26 in UTC-6
 *
 * The fix:
 *   Parse "YYYY-MM-DD" by splitting the string directly — no Date constructor,
 *   no timezone shift.
 */

/**
 * The 1-indexed calendar month the FIRST season rolls over on (July = 7).
 * SINGLE source of truth on the client — mirror of EnrollmentService::SEASON_START_MONTH
 * on the server. Change here (and there) to move the boundary.
 */
export const SEASON_START_MONTH = 7;

/** The starting year of the current season (e.g. 2026 for the 2026-2027 season). */
export function currentSeasonYear(now: Date = new Date()): number {
  // getMonth() is 0-indexed, so compare against SEASON_START_MONTH - 1.
  return now.getMonth() >= SEASON_START_MONTH - 1 ? now.getFullYear() : now.getFullYear() - 1;
}

/** The current season as a "YYYY-YYYY" label (e.g. "2026-2027"). */
export function currentSeasonLabel(now: Date = new Date()): string {
  const y = currentSeasonYear(now);
  return `${y}-${y + 1}`;
}

/**
 * The month/day the post-season grace period ends (August 31). SINGLE source of
 * truth on the client — mirror of EnrollmentService::GRACE_END_MONTH / GRACE_END_DAY
 * on the server. Used only for generic copy; a specific season's exact grace_ends
 * date is provided by the API and should be preferred when available.
 */
export const GRACE_END_MONTH = 8;
export const GRACE_END_DAY = 31;

/** The grace-period end as a friendly "Month D" label (e.g. "August 31"). */
export function graceEndLabel(): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[GRACE_END_MONTH - 1]} ${GRACE_END_DAY}`;
}

/**
 * Format a date-only ISO string (YYYY-MM-DD or YYYY-MM-DDTHH:...) as
 * "M/D/YYYY" using local calendar values, never converting timezone.
 *
 * Returns "" if the input is falsy.
 */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  // Take only the date part before any "T"
  const datePart = dateStr.split("T")[0];
  const parts = datePart.split("-");
  if (parts.length !== 3) return dateStr; // fallback: return as-is
  const [year, month, day] = parts.map(Number);
  return `${month}/${day}/${year}`;
}

/**
 * Current age in whole years from a "YYYY-MM-DD" birthday, parsed without the
 * timezone trap. Returns null if the input is missing/unparseable.
 */
export function ageFromBirthday(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const parts = dateStr.split("T")[0].split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [by, bm, bd] = parts;
  const now = new Date();
  let age = now.getFullYear() - by;
  // Subtract a year if this year's birthday hasn't happened yet.
  if (now.getMonth() + 1 < bm || (now.getMonth() + 1 === bm && now.getDate() < bd)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Format as "Month D, YYYY" (e.g. "August 27, 1974").
 */
export function formatDateLong(dateStr?: string | null): string {
  if (!dateStr) return "";
  const datePart = dateStr.split("T")[0];
  const parts = datePart.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts.map(Number);
  const months = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  return `${months[month - 1]} ${day}, ${year}`;
}

/**
 * Format a datetime string as "M/D/YYYY h:mm AM/PM" in local time.
 * This one DOES use the Date constructor because datetimes have real
 * timezone semantics (stored as UTC in the DB, displayed in local time).
 */
export function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}
