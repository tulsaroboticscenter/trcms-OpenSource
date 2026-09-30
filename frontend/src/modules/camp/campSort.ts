/**
 * Shared camp sorting/grouping (#99) — gives every Camp tab the same "by week,
 * then by camp" ordering and a consistent Week / Camp scope picker.
 */
import type { CampSession } from "./api";

const WEEKLESS = "Other camps";

/** Natural compare so "Week 2" sorts before "Week 10". */
function natCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Order sessions by week label (natural), then by camp title. */
export function sortSessions<T extends CampSession>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) =>
    natCompare(a.week_label || "~", b.week_label || "~") ||
    natCompare(a.title || "", b.title || ""));
}

export interface CampWeekGroup { week: string; weekless: boolean; sessions: { id: number; title: string }[]; }

/** Group sessions under their week (sorted), each week's camps sorted by title. */
export function campWeekGroups(sessions: CampSession[]): CampWeekGroup[] {
  const byWeek = new Map<string, { id: number; title: string }[]>();
  for (const s of sortSessions(sessions)) {
    const wk = s.week_label?.trim() || WEEKLESS;
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push({ id: s.id, title: s.title });
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a === WEEKLESS ? 1 : b === WEEKLESS ? -1 : natCompare(a, b)))
    .map(([week, ss]) => ({ week, weekless: week === WEEKLESS, sessions: ss }));
}

/** Distinct week labels in natural order. */
export function campWeeks(sessions: CampSession[]): string[] {
  return [...new Set(sessions.map((s) => s.week_label?.trim()).filter(Boolean) as string[])].sort(natCompare);
}

/** Map session id → its week label (or null). */
export function sessionWeekMap(sessions: CampSession[]): Record<number, string | null> {
  const m: Record<number, string | null> = {};
  for (const s of sessions) m[s.id] = s.week_label?.trim() || null;
  return m;
}

/** Build the flat scope-select options ("all", "week:<label>", "session:<id>"). */
export interface CampScopeOption { value: string; label: string }
export function campScopeOptions(sessions: CampSession[]): CampWeekGroup[] {
  return campWeekGroups(sessions);
}
