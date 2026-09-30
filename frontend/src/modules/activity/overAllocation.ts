/**
 * Shared handling for "that's more time than the check-in covers" (HTTP 422 from the
 * activity endpoints).
 *
 * The server is the authority on the cap — several screens can log time against a
 * check-in, so the rule lives there and each screen just reports what it says and
 * resets the field to what actually fits.
 */

export interface OverAllocation {
  message: string;
  /** What's left after everything already logged to that check-in — the value to reset to. */
  availableHours: number;
  availableMinutes: number;
  sessionMinutes: number;
  allocatedMinutes: number;
}

interface ApiError {
  response?: {
    status?: number;
    data?: {
      detail?: string;
      error?: string;
      available_minutes?: number;
      session_minutes?: number;
      allocated_minutes?: number;
    };
  };
}

/** Returns the over-allocation details, or null if this error is something else. */
export function asOverAllocation(e: unknown): OverAllocation | null {
  const ax = e as ApiError;
  const d = ax?.response?.data;
  if (ax?.response?.status !== 422 || d?.error !== "checkin_time_exceeded") return null;
  const availableMinutes = d.available_minutes ?? 0;
  return {
    message: d.detail ?? "That is more time than the check-in covers.",
    availableHours: Math.round((availableMinutes / 60) * 100) / 100,
    availableMinutes,
    sessionMinutes: d.session_minutes ?? 0,
    allocatedMinutes: d.allocated_minutes ?? 0,
  };
}

/** "0.5 hours" / "1 hour" — for the "we reset it to…" line. */
export function hoursLabel(hours: number): string {
  const n = Math.round(hours * 100) / 100;
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}
