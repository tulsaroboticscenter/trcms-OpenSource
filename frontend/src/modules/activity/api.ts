import { api } from "../../core/api";

export interface TimeEntry {
  id: number;
  member_id: number;
  entry_date: string;
  season?: string;
  minutes: number;
  hours?: number;
  entry_method?: "hours" | "range" | null;
  start_time?: string | null;   // "HH:MM"
  end_time?: string | null;     // "HH:MM"
  area?: string | null;
  is_volunteer: boolean;
  team_season_id?: number | null;
  source: "manual" | "checkin" | "event";
  checkin_id?: number | null;
  event_id?: number | null;
  item_type?: string | null;
  item_id?: number | null;
  notes?: string | null;
  verified: boolean;
}

export interface Checkin {
  id: number;
  member_id: number;
  event_id: number | null;
  event_name: string | null;
  time_in: string;            // naive "YYYY-MM-DDTHH:MM:SS"
  time_out: string | null;
  minutes: number;
}

export interface DayCheckin {
  checkin_id: number;
  event_id: number | null;
  event_name: string | null;
  time_in: string;
  time_out: string | null;
  open: boolean;
}

/** One sub-entry of a daily log. */
export interface MemberTeamOption {
  team_season_id: number | null;
  team_name?: string | null;
  team_number?: number | null;
  season?: string | null;
  status?: string | null;
}
export interface SubEntry {
  area?: string;
  hours?: number;
  start_time?: string;
  end_time?: string;
  notes?: string;
  item_type?: string;
  item_id?: number;
}

export interface UncategorizedSession {
  checkin_id: number;
  date: string;
  time_in: string;
  time_out: string;
  session_minutes: number;
  allocated_minutes: number;
  remaining_minutes: number;
  event_id?: number | null;
  event_name?: string | null;
}

export interface MemberSummary {
  member_id: number;
  total_minutes: number;
  volunteer_minutes: number;
  by_area: Record<string, number>;
}

export interface TeamImpact {
  team_season_id: number;
  total_minutes: number;
  volunteer_minutes: number;
  by_area: Record<string, number>;
  contributors: number;
  by_member: { member_id: number; name: string; minutes: number; volunteer_minutes: number }[];
}

export interface OrgImpact {
  total_minutes: number;
  volunteer_minutes: number;
  by_area: Record<string, number>;
  by_member_type: Record<string, number>;
}

export const activityApi = {
  areas: (memberId?: number) =>
    api.get("/api/v1/activity/areas", { params: memberId ? { member_id: memberId } : {} })
      .then((r) => r.data as { areas: string[]; is_volunteer_member: boolean }),

  seasons: () => api.get("/api/v1/activity/seasons").then((r) => r.data as string[]),

  listEntries: (memberId: number, season?: string, from?: string, to?: string) =>
    api.get(`/api/v1/activity/member/${memberId}`, { params: { season, from_date: from, to_date: to } })
      .then((r) => r.data as TimeEntry[]),
  createEntry: (data: Record<string, unknown>) =>
    api.post("/api/v1/activity/entries", data).then((r) => r.data as TimeEntry),
  createEntries: (data: { member_id: number; entry_date: string; checkin_id?: number | null; event_id?: number | null; team_season_id?: number | null; entries: SubEntry[]; acknowledge_overlap?: boolean }) =>
    api.post("/api/v1/activity/entries/bulk", data).then((r) => r.data as TimeEntry[]),
  checkinsForDay: (memberId: number, date: string) =>
    api.get(`/api/v1/activity/member/${memberId}/checkins`, { params: { date } }).then((r) => r.data as DayCheckin[]),
  memberCheckins: (memberId: number, from?: string, to?: string) =>
    api.get(`/api/v1/checkin/member/${memberId}`, { params: { from_date: from, to_date: to, limit: 500 } }).then((r) => r.data as Checkin[]),
  adjustCheckin: (checkinId: number, data: { time_in?: string; time_out?: string | null }) =>
    api.patch(`/api/v1/checkin/${checkinId}`, data).then((r) => r.data),
  deleteCheckin: (checkinId: number) =>
    api.delete(`/api/v1/checkin/${checkinId}`).then((r) => r.data),
  addCheckin: (memberId: number, data: { time_in: string; time_out?: string | null; event_id?: number | null }) =>
    api.post(`/api/v1/checkin/member/${memberId}`, data).then((r) => r.data as Checkin),
  editEntry: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/activity/entries/${id}`, data).then((r) => r.data as TimeEntry),
  deleteEntry: (id: number) => api.delete(`/api/v1/activity/entries/${id}`).then((r) => r.data),
  tagCheckout: (checkinId: number, area: string, minutes?: number) =>
    api.post(`/api/v1/activity/checkin/${checkinId}/tag`, { area, minutes }).then((r) => r.data as TimeEntry),
  // Set the category for a WHOLE check-in in one step (cap-free). Empty area clears
  // it back to unclassified. Used to classify/re-classify a check-in's time.
  classifyCheckin: (checkinId: number, area: string) =>
    api.post(`/api/v1/activity/checkin/${checkinId}/classify`, { area }).then((r) => r.data),
  verifyEntry: (id: number, verified = true) =>
    api.post(`/api/v1/activity/entries/${id}/verify`, null, { params: { verified } }).then((r) => r.data),

  uncategorized: (memberId: number) =>
    api.get(`/api/v1/activity/member/${memberId}/uncategorized`).then((r) => r.data as UncategorizedSession[]),
  loggableEvents: (memberId: number) =>
    api.get(`/api/v1/activity/member/${memberId}/loggable-events`)
      .then((r) => r.data as { event_id: number; name: string; date: string; suggested_minutes: number }[]),

  // The member's own team-seasons — used to attribute logged time to a team.
  memberTeams: (memberId: number) =>
    api.get(`/api/v1/teams/member/${memberId}`).then((r) => r.data as MemberTeamOption[]),
  memberSummary: (memberId: number, from?: string, to?: string, season?: string) =>
    api.get(`/api/v1/activity/member/${memberId}/summary`, { params: { from_date: from, to_date: to, season } })
      .then((r) => r.data as MemberSummary),
  teamSummary: (tsid: number, from?: string, to?: string) =>
    api.get(`/api/v1/activity/team/${tsid}/summary`, { params: { from_date: from, to_date: to } })
      .then((r) => r.data as TeamImpact),
  orgImpact: (from?: string, to?: string) =>
    api.get("/api/v1/activity/impact", { params: { from_date: from, to_date: to } })
      .then((r) => r.data as OrgImpact),
};

/** Minutes → "2h 30m" / "45m" / "—" */
/**
 * Today's date as local "YYYY-MM-DD". Use this instead of
 * `new Date().toISOString().slice(0,10)`, which returns the *UTC* date and so
 * rolls over to tomorrow on Central evenings — picking the wrong day for time
 * logging and hiding that evening's check-ins.
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtMinutes(min?: number | null): string {
  const m = Math.max(0, Math.round(min ?? 0));
  if (!m) return "0m";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return h ? (rem ? `${h}h ${rem}m` : `${h}h`) : `${rem}m`;
}

/** Minutes → decimal hours label, e.g. "2.5 hrs" / "0.5 hr". */
export function fmtHours(min?: number | null): string {
  const h = Math.max(0, Math.round(((min ?? 0) / 60) * 100) / 100);
  return `${h} ${h === 1 ? "hr" : "hrs"}`;
}

/** "HH:MM" (24h) → "1:00 PM" */
export function fmtTime(hhmm?: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
