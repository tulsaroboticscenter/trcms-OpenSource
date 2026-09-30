/**
 * Shared "this week + next week" window for upcoming-event lists.
 *
 * Events starting before the cutoff (end of next week) are shown expanded; the
 * rest are collapsed behind a "show N more" toggle so a long tail of future
 * events doesn't dominate the team and member profiles.
 */

/** Local midnight of the start of the week (Sunday) that contains `d`. */
function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay());
  return s;
}

/** Cutoff = start of the week AFTER next (i.e. covers this week + next week). */
export function nearWindowCutoff(now: Date = new Date()): Date {
  const c = startOfWeek(now);
  c.setDate(c.getDate() + 14);
  return c;
}

/** True when an event (by its YYYY-MM-DD start date) falls in this/next week. */
export function isNearEvent(eventDate: string, cutoff: Date = nearWindowCutoff()): boolean {
  const start = new Date(eventDate + "T00:00:00");
  return start < cutoff;
}

/** Split a date-ordered event list into near (this/next week) and later. */
export function splitByWindow<T extends { event_date: string }>(events: T[]): { near: T[]; later: T[] } {
  const cutoff = nearWindowCutoff();
  const near: T[] = [], later: T[] = [];
  for (const e of events) (isNearEvent(e.event_date, cutoff) ? near : later).push(e);
  return { near, later };
}
