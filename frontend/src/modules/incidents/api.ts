import { api } from "../../core/api";

// ── Phase-1 type catalog (mirror of Core\IncidentTypes; server is the source of truth) ──
export type IncidentTier = "standard" | "sensitive" | "restricted";
export interface IncidentTypeDef { slug: string; label: string; tier: IncidentTier; blurb: string; }
export const PHASE1_TYPES: IncidentTypeDef[] = [
  { slug: "medical",   label: "Medical / Health Event",        tier: "standard",  blurb: "Allergic reaction, asthma, seizure, fainting, heat illness, a flare-up of a known condition." },
  { slug: "injury",    label: "Injury / Accident",             tier: "standard",  blurb: "Someone got hurt — a cut, burn, sprain, a tool or robot injury, a fall." },
  { slug: "behavior",  label: "Behavior / Conduct (youth)",    tier: "sensitive", blurb: "A youth conduct concern — disruption, unsafe behavior, conflict, bullying." },
  { slug: "near_miss", label: "Near Miss / Unsafe Condition",  tier: "standard",  blurb: "Nobody was hurt, but something nearly happened, or a hazard needs fixing." },
];

export const SEVERITIES = [
  { value: "minor",    label: "Minor",    anchor: "No treatment beyond basic first aid." },
  { value: "moderate", label: "Moderate", anchor: "First aid given; parent informed; watched for a while." },
  { value: "serious",  label: "Serious",  anchor: "Sent for outside care, or a real risk of harm." },
  { value: "critical", label: "Critical", anchor: "EMS/ER, or life-safety." },
];

export interface IncidentPerson { id?: number; member_id?: number | null; name?: string | null; person_role: "affected" | "witness" | "involved" | "responder"; is_youth?: boolean | null; notes?: string | null; }
export interface IncidentTaskLink { task_id: number; title?: string | null; status?: string | null; open: boolean; }
export interface IncidentAttachment { id: number; name: string; mime: string; size_bytes: number; url: string; }
export interface IncidentNote { id: number; author_id: number | null; author_name: string | null; body: string; note_kind: string; visibility: string; created_at: string | null; }
export interface IncidentNotification { recipient: string; reason: string; channel: string; ok: boolean; error: string | null; sent_at: string | null; }

export interface IncidentSummary {
  id: number; ref_no: string | null; type: string; type_label: string; tier: IncidentTier;
  severity: string | null; reporter_severity: string | null; effective_severity: string; status: string;
  is_anonymous: boolean; occurred_at: string | null; location_kind: string | null; ongoing_risk: boolean;
  is_sensitive: boolean; board_reportable: boolean; created_at: string | null;
  event_id?: number | null; event_name?: string | null;
  assigned_to_id?: number | null; assigned_to_name?: string | null; age_days?: number | null;
}
export interface Incident extends IncidentSummary {
  reporter_id: number | null; reporter_name: string | null;
  filed_for_name: string | null; filed_for_member_id: number | null; filed_for_relationship: string | null;
  occurred_approx: boolean; location_area: string | null; location_other: string | null;
  event_id: number | null; team_id: number | null;
  description: string; immediate_actions: string | null;
  ems_called: boolean; police_called: boolean;
  parent_notified: boolean; parent_notified_at: string | null; parent_notify_method: string | null; parent_notify_result: string | null;
  detail: Record<string, unknown> | null; injury: Record<string, unknown> | null;
  triaged_at: string | null; closed_at: string | null; closure_summary: string | null;
  external_notified: Record<string, unknown> | null; retention_hold: boolean; retention_review_on: string | null; follow_up_due: string | null;
  people: IncidentPerson[]; attachments: IncidentAttachment[]; tasks: IncidentTaskLink[]; notes: IncidentNote[];
  notifications?: IncidentNotification[]; guardian_emails?: string[];
}

export interface RoutingRule { id: number; label: string; types: string[]; min_severity: string; to: string[]; cc: string[]; notify_roles: string[]; board_notify: boolean; }
export interface RoutingConfig { default_to: string[]; reply_to: string; digest_enabled: boolean; rules: RoutingRule[]; }

export const incidentsApi = {
  submit: (body: Record<string, unknown>) => api.post("/api/v1/incidents", body).then((r) => r.data as Incident),
  list: (params?: Record<string, string>) => api.get("/api/v1/incidents", { params }).then((r) => r.data as IncidentSummary[]),
  mine: () => api.get("/api/v1/incidents/mine").then((r) => r.data as IncidentSummary[]),
  get: (id: number) => api.get(`/api/v1/incidents/${id}`).then((r) => r.data as Incident),
  addNote: (id: number, body: { body: string; note_kind?: string; visibility?: string }) => api.post(`/api/v1/incidents/${id}/notes`, body).then((r) => r.data as Incident),
  triage: (id: number, body: Record<string, unknown>) => api.post(`/api/v1/incidents/${id}/triage`, body).then((r) => r.data as Incident),
  assign: (id: number, assigned_to_id: number | null) => api.post(`/api/v1/incidents/${id}/assign`, { assigned_to_id }).then((r) => r.data as Incident),
  notifyParent: (id: number, body: Record<string, unknown>) => api.post(`/api/v1/incidents/${id}/notify-parent`, body).then((r) => r.data as Incident),
  shareParent: (id: number, summary: string, recipients?: string[]) => api.post(`/api/v1/incidents/${id}/share-parent`, { summary, recipients }).then((r) => r.data as { ok: boolean; sent: number; failed: string[]; recipients: string[]; incident: Incident }),
  linkTask: (id: number, task_id: number) => api.post(`/api/v1/incidents/${id}/tasks`, { task_id }).then((r) => r.data as Incident),
  unlinkTask: (id: number, task_id: number) => api.delete(`/api/v1/incidents/${id}/tasks/${task_id}`).then((r) => r.data as Incident),
  close: (id: number, closure_summary: string) => api.post(`/api/v1/incidents/${id}/close`, { closure_summary }).then((r) => r.data as Incident),
  upload: (id: number, file: File) => { const fd = new FormData(); fd.append("file", file); return api.post(`/api/v1/incidents/${id}/attachments`, fd).then((r) => r.data as Incident); },
  stats: (params?: Record<string, string>) => api.get("/api/v1/incidents/stats", { params }).then((r) => r.data),
  firstAidList: () => api.get("/api/v1/first-aid").then((r) => r.data),
  firstAidSave: (body: Record<string, unknown>) => api.post("/api/v1/first-aid", body).then((r) => r.data),
  firstAidPromote: (id: number) => api.post(`/api/v1/first-aid/${id}/promote`).then((r) => r.data as Incident),
  settingsGet: () => api.get("/api/v1/admin/incident-settings").then((r) => r.data as RoutingConfig),
  settingsSave: (cfg: RoutingConfig) => api.post("/api/v1/admin/incident-settings", cfg).then((r) => r.data as RoutingConfig),
  settingsTest: (to: string) => api.post("/api/v1/admin/incident-settings/test", { to }).then((r) => r.data as { ok: boolean; error: string | null }),
};
