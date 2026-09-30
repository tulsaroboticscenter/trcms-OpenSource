import { api } from "../../core/api";

export type AppStatus = "interested" | "applied" | "granted" | "partial" | "declined" | "no_decision";

export interface Scholarship {
  id: number;
  name: string;
  provider: string | null;
  info_url: string | null;
  description: string | null;
  amount_min: number | null;
  amount_max: number | null;
  renewable: boolean;
  season: string | null;
  open_date: string | null;
  close_date: string | null;
  is_active: boolean;
  elig_grad_year_min: number | null;
  elig_grad_year_max: number | null;
  elig_sex: string | null;
  elig_races: string | null;
  elig_states: string | null;
  elig_min_gpa: number | null;
  elig_tags: string | null;
  elig_notes: string | null;
  // Board annotations (current member)
  following?: boolean;
  my_status?: AppStatus | null;
  eligible?: boolean;
  is_open?: boolean;
  dismissed?: boolean;
  dismiss_reason?: "not_eligible" | "not_applying" | null;
  // Watchlist annotations (when a mentor tagged the youth onto it)
  suggested_note?: string | null;
  suggested_by?: string | null;
  // Manager annotations
  followers?: number;
  applicants?: number;
}

export interface ScholarshipApplication {
  id: number;
  scholarship_id: number;
  scholarship_name: string;
  provider: string | null;
  member_id: number;
  member_name: string;
  season: string | null;
  status: AppStatus;
  amount_awarded: number | null;
  applied_date: string | null;
  decision_date: string | null;
  notes: string | null;
}

export interface AppRequirement {
  id: number;
  label: string;
  is_complete: boolean;
  due_date: string | null;
  sort_order: number;
}

export interface TrackerApplication extends ScholarshipApplication {
  info_url?: string | null;
  renewable?: boolean | null;
  renewable_years?: number | null;
  renewable_annual_amount?: number | null;
  youth_award_response?: "accepted" | "declined" | null;
  target_college?: string | null;
  thank_you_sent?: boolean;
  thank_you_date?: string | null;
  requirements?: AppRequirement[];
}

export interface CollegeTracker {
  member_id: number;
  is_self: boolean;
  can_manage: boolean;
  summary: { applied: number; won: number; total_awarded: number };
  applications: TrackerApplication[];
  watchlist: Scholarship[];
  eligible_open: Scholarship[];
}

const base = "/api/v1/college-scholarships";

export const scholarshipsApi = {
  // Youth / reader
  board: (params?: { season?: string; search?: string; only?: "eligible" | "following" | "open" | "dismissed" }) =>
    api.get(base, { params: params ?? {} }).then((r) => r.data as Scholarship[]),
  alerts: () => api.get(`${base}/alerts`).then((r) => r.data as Scholarship[]),
  stats: () => api.get(`${base}/stats`).then((r) => r.data as { count: number; total_value: number; renewable_count: number }),
  seasons: () => api.get(`${base}/seasons`).then((r) => r.data as string[]),
  follow: (id: number) => api.post(`${base}/${id}/follow`, {}).then((r) => r.data),
  unfollow: (id: number) => api.delete(`${base}/${id}/follow`).then((r) => r.data),
  apply: (id: number, status: "interested" | "applied" = "applied") => api.post(`${base}/${id}/apply`, { status }).then((r) => r.data),
  withdraw: (id: number) => api.delete(`${base}/${id}/apply`).then((r) => r.data),
  dismiss: (id: number, reason: "not_eligible" | "not_applying" = "not_eligible") => api.post(`${base}/${id}/dismiss`, { reason }).then((r) => r.data),
  undismiss: (id: number) => api.delete(`${base}/${id}/dismiss`).then((r) => r.data),

  // Per-youth tracker (College/Vo-Tech Prep tab) — self, guardian, or manager.
  tracker: (memberId: number) => api.get(`${base}/members/${memberId}/tracker`).then((r) => r.data as CollegeTracker),
  memberFollow: (memberId: number, sid: number) => api.post(`${base}/members/${memberId}/follow/${sid}`, {}).then((r) => r.data),
  memberUnfollow: (memberId: number, sid: number) => api.delete(`${base}/members/${memberId}/follow/${sid}`).then((r) => r.data),
  memberApply: (memberId: number, sid: number, status: "interested" | "applied" = "applied") =>
    api.post(`${base}/members/${memberId}/apply/${sid}`, { status }).then((r) => r.data),
  memberWithdraw: (memberId: number, sid: number) => api.delete(`${base}/members/${memberId}/apply/${sid}`).then((r) => r.data),
  // Requirement checklist (owner youth, guardian, or manager).
  addRequirement: (appId: number, d: { label: string; due_date?: string | null }) =>
    api.post(`${base}/applications/${appId}/requirements`, d).then((r) => r.data as AppRequirement),
  updateRequirement: (reqId: number, d: { label?: string; is_complete?: boolean; due_date?: string | null }) =>
    api.put(`${base}/requirements/${reqId}`, d).then((r) => r.data as AppRequirement),
  deleteRequirement: (reqId: number) => api.delete(`${base}/requirements/${reqId}`).then((r) => r.data),

  // Manager: tag one or more youth onto a scholarship (adds to their Watchlist,
  // optional email with a personal note).
  tagYouth: (sid: number, d: { member_ids: number[]; note?: string; notify?: boolean }) =>
    api.post(`${base}/${sid}/tag`, d).then((r) => r.data as { tagged: number; emailed: number; skipped: number }),

  // Manager
  manageList: () => api.get(`${base}/manage`).then((r) => r.data as Scholarship[]),
  create: (d: Partial<Scholarship>) => api.post(base, d).then((r) => r.data as Scholarship),
  update: (id: number, d: Partial<Scholarship>) => api.put(`${base}/${id}`, d).then((r) => r.data as Scholarship),
  remove: (id: number) => api.delete(`${base}/${id}`).then((r) => r.data),
  report: (params?: { season?: string; status?: string; scholarship_id?: number }) =>
    api.get(`${base}/applications`, { params: params ?? {} }).then((r) => r.data as ScholarshipApplication[]),
  setOutcome: (appId: number, d: { status?: AppStatus; amount_awarded?: number | null; decision_date?: string | null; notes?: string }) =>
    api.put(`${base}/applications/${appId}`, d).then((r) => r.data),
  rollover: (from_season: string, to_season: string) =>
    api.post(`${base}/rollover`, { from_season, to_season }).then((r) => r.data as { cloned: number; to_season: string }),
};

export const STATUS_LABEL: Record<AppStatus, string> = {
  interested: "Interested",
  applied: "Applied",
  granted: "Granted",
  partial: "Partial grant",
  declined: "Declined",
  no_decision: "No decision",
};
export const STATUS_COLOR: Record<AppStatus, string> = {
  interested: "#7e57c2",
  applied: "#1565c0",
  granted: "#2e7d32",
  partial: "#00838f",
  declined: "#c62828",
  no_decision: "#8a6d3b",
};
