import { api } from "../../core/api";

export const SCOPES = [
  { value: "trc", label: "TRC (organization)" },
  { value: "team", label: "Single team" },
  { value: "multi_team", label: "Multiple teams" },
];
export const RECURRENCES = [
  { value: "one_time", label: "One-time" },
  { value: "annual", label: "Annual" },
  { value: "other", label: "Other" },
];
export const STATUSES = [
  { value: "researching", label: "Researching", color: "#6b7280" },
  { value: "open", label: "Open / available", color: "#1565c0" },
  { value: "submitted", label: "Submitted", color: "#e65100" },
  { value: "awarded", label: "Awarded", color: "#2e7d32" },
  { value: "partially_awarded", label: "Partially awarded", color: "#2e7d32" },
  { value: "declined", label: "Declined", color: "#c62828" },
  { value: "closed", label: "Closed", color: "#455a64" },
];
export const DISTRIBUTION_METHODS = [
  { value: "check_trc", label: "Check to TRC" },
  { value: "electronic_trc", label: "Electronic to TRC" },
  { value: "first_account", label: "FIRST Inspires account" },
  { value: "other", label: "Other" },
];
export const OUTCOMES = [
  { value: "pending", label: "Pending", color: "#6b7280" },
  { value: "awarded", label: "Awarded", color: "#2e7d32" },
  { value: "declined", label: "Declined", color: "#c62828" },
];

export interface GrantLink { label: string; url: string; }
export interface GrantTeamRow {
  id: number; grant_id: number; team_season_id: number | null; is_trc: boolean; team_label: string;
  eligible: boolean; submitted: boolean; submitted_date: string | null; amount_requested: number | null;
  outcome: "pending" | "awarded" | "declined"; amount_received: number | null;
  restricted_amount: number | null; unrestricted_amount: number | null;
  distribution_method: string | null; distribution_note: string | null; received_date: string | null; notes: string | null;
}
export interface GrantCorrespondence {
  id: number; subject: string | null; sender: string | null; correspondence_date: string | null;
  body: string | null; attachment_url: string | null; created_at: string;
}
export interface GrantCustomField { id: number; label: string; response: string | null; }
export interface Grant {
  id: number; name: string; funder_name: string | null; scope: string; recurrence: string; status: string;
  season: string | null;
  submitted_by_id: number | null; submitted_by_name?: string | null; submitted_date: string | null;
  expected_response_date: string | null; num_rounds: number | null; current_round: number | null;
  restricted_funds: boolean; restriction_note: string | null;
  available_date: string | null; remind_date: string | null; remind_note: string | null;
  links: GrantLink[]; description: string | null;
  team_count?: number; awarded_count?: number; total_requested?: number; total_received?: number;
  teams?: GrantTeamRow[]; correspondence?: GrantCorrespondence[]; custom_fields?: GrantCustomField[];
}
export interface GrantReminder { id: number; name: string; funder_name: string | null; available_date: string | null; remind_date: string | null; remind_note: string | null; }
export interface GrantReports {
  by_team: { team_season_id: number | null; label: string; received: number }[];
  by_funder: { funder_name: string; received: number; grants: number }[];
  by_year: { year: number; received: number }[];
  life_total: number;
}

export const grantsApi = {
  list: (params?: Record<string, string>) => api.get("/api/v1/grants/", { params }).then((r) => r.data as Grant[]),
  get: (id: number) => api.get(`/api/v1/grants/${id}`).then((r) => r.data as Grant),
  create: (data: Record<string, unknown>) => api.post("/api/v1/grants/", data).then((r) => r.data as Grant),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/grants/${id}`, data).then((r) => r.data as Grant),
  remove: (id: number) => api.delete(`/api/v1/grants/${id}`).then((r) => r.data),
  setTeams: (id: number, team_season_ids: number[], include_trc: boolean) =>
    api.put(`/api/v1/grants/${id}/teams`, { team_season_ids, include_trc }).then((r) => r.data as Grant),
  updateTeam: (grantTeamId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/grants/teams/${grantTeamId}`, data).then((r) => r.data as Grant),
  addCorrespondence: (id: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/grants/${id}/correspondence`, data).then((r) => r.data as Grant),
  deleteCorrespondence: (cid: number) => api.delete(`/api/v1/grants/correspondence/${cid}`).then((r) => r.data as Grant),
  addField: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/grants/${id}/fields`, data).then((r) => r.data as Grant),
  updateField: (fid: number, data: Record<string, unknown>) => api.patch(`/api/v1/grants/fields/${fid}`, data).then((r) => r.data as Grant),
  deleteField: (fid: number) => api.delete(`/api/v1/grants/fields/${fid}`).then((r) => r.data as Grant),
  reminders: () => api.get("/api/v1/grants/reminders").then((r) => r.data as GrantReminder[]),
  markSubmitted: (id: number) => api.post(`/api/v1/grants/${id}/mark-submitted`, {}).then((r) => r.data as { ok: boolean }),
  reports: () => api.get("/api/v1/grants/reports").then((r) => r.data as GrantReports),
};
