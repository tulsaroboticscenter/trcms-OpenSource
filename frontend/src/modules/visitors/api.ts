import { api } from "../../core/api";

export const visitorsApi = {
  list: (params?: { search?: string; status?: string; program_interest_id?: number; school_id?: number; age_min?: number; age_max?: number; scheduled?: number; scheduled_from?: string; scheduled_to?: string; archived_only?: number; skip?: number; limit?: number }) =>
    api.get("/api/v1/visitors/", { params }).then((r) => r.data as { total: number; visitors: Visitor[] }),

  archive: (id: number) =>
    api.post(`/api/v1/visitors/${id}/archive`).then((r) => r.data as Visitor),
  unarchive: (id: number) =>
    api.post(`/api/v1/visitors/${id}/unarchive`).then((r) => r.data as Visitor),

  get: (id: number) =>
    api.get(`/api/v1/visitors/${id}`).then((r) => r.data as Visitor),

  /** Staff quick-add (e.g. a phone inquiry). Returns the new visitor's id. */
  create: (data: Record<string, unknown>) =>
    api.post("/api/v1/visitors/", data).then((r) => r.data as { id: number; visitor_number: string; name: string }),

  getStats: () =>
    api.get("/api/v1/visitors/stats").then((r) => r.data as Record<string, number>),

  searchCampers: (q: string) =>
    api.get("/api/v1/visitors/campers/search", { params: { q } }).then((r) => (r.data as { campers: CamperMatch[] }).campers),

  getStatuses: () =>
    api.get("/api/v1/visitors/statuses").then((r) => r.data as { code: string; label: string }[]),

  update: (id: number, data: Partial<Visitor>) =>
    api.patch(`/api/v1/visitors/${id}`, data).then((r) => r.data as Visitor),

  getPrefill: (id: number) =>
    api.get(`/api/v1/visitors/${id}/prefill`).then((r) => r.data),

  /** Unconverted visitors that appear to already be a member (import duplicates). */
  duplicateMembers: () =>
    api.get("/api/v1/visitors/duplicate-members").then((r) => r.data as { total: number; matches: VisitorMemberMatch[] }),

  /** Pairs of unconverted visitors that look like the same person. */
  duplicateVisitors: () =>
    api.get("/api/v1/visitors/duplicate-visitors").then((r) => r.data as { total: number; pairs: VisitorPair[] }),

  /** Merge the duplicate visitor (dupId) into the survivor (keepId). */
  mergeVisitor: (dupId: number, keepId: number) =>
    api.post(`/api/v1/visitors/${dupId}/merge-visitor`, { into: keepId }).then((r) => r.data as { ok: boolean; survivor_id: number }),

  markConverted: (id: number, memberId: number) =>
    api.post(`/api/v1/visitors/${id}/convert`, { member_id: memberId }).then((r) => r.data),

  deleteVisitor: (id: number) => api.delete(`/api/v1/visitors/${id}`).then((r) => r.data),

  addInteraction: (id: number, data: { method?: string; notes?: string; occurred_at?: string }) =>
    api.post(`/api/v1/visitors/${id}/interactions`, data).then((r) => r.data as Visitor),
  sendEmail: (id: number, data: { subject: string; body: string; cc?: string[] }) =>
    api.post(`/api/v1/visitors/${id}/email`, data).then((r) => r.data as Visitor),
  // Mark the assigned follow-up complete: logs a "Follow-up completed" note and clears
  // the next-follow-up date (drops it off the pending list, stops reminders).
  completeFollowup: (id: number, notes?: string) =>
    api.post(`/api/v1/visitors/${id}/followup-done`, { notes }).then((r) => r.data as Visitor),
  markVisitedToday: (id: number, notes?: string) =>
    api.post(`/api/v1/visitors/${id}/visited`, { notes }).then((r) => r.data as Visitor),
  deleteInteraction: (interactionId: number) =>
    api.delete(`/api/v1/visitors/interactions/${interactionId}`).then((r) => r.data as Visitor),
  followups: () => api.get("/api/v1/visitors/followups").then((r) => r.data as VisitorFollowup[]),
  analytics: () => api.get("/api/v1/visitors/analytics").then((r) => r.data as RecruitingAnalytics),
  importCsv: (type: string, file: File, dryRun: boolean) => {
    const fd = new FormData(); fd.append("file", file); fd.append("type", type);
    return api.post(`/api/v1/recruitment/import?dry_run=${dryRun ? 1 : 0}`, fd).then((r) => r.data as ImportResult);
  },
};

export interface ImportResult {
  dry_run: boolean; type: string;
  created: number; linked_to_existing: number; skipped_duplicates: number; skipped_blank: number;
  errors: string[];
}

export interface RecruitingAnalytics {
  total_inquiries: number; enrolled: number; conversion_rate: number;
  funnel: Record<string, number>;
  by_source: { source: string; label: string; count: number; enrolled: number }[];
  by_school: { school_id: number; school: string; count: number; enrolled: number }[];
  by_program: { program: string; count: number; enrolled: number }[];
  by_month: { month: string; count: number }[];
}

export interface CamperMatch {
  camper_id: number;
  first_name: string;
  last_name: string;
  grade?: string | null;
  school?: string | null;
  age_band?: string | null;
  guardian_name?: string | null;
  guardian_email?: string | null;
  guardian_phone?: string | null;
  last_camp_year?: string | null;
  existing_visitor_id?: number | null;
  existing_visitor_number?: string | null;
}

export interface VisitorMemberMatch {
  visitor_id: number; visitor_number: string; visitor_name: string; visitor_email?: string;
  member_id: number; member_number: string; member_name: string; member_type: string;
  matched_on: string;
}
export interface VisitorPair {
  keep_id: number; keep_number: string; keep_name: string; keep_email?: string;
  dup_id: number; dup_number: string; dup_name: string; dup_email?: string;
  matched_on: string;
}
export interface VisitorInteraction {
  id: number; method?: string | null; notes?: string | null; occurred_at?: string | null; member_name?: string | null;
}
export interface VisitorFollowup {
  id: number; name: string; status: string; next_follow_up_date: string; owner_name?: string | null;
}

export interface Visitor {
  id: number;
  visitor_number: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  full_name: string;
  birthday?: string;
  grade?: number | null;
  grade_label?: string | null;
  phone?: string;
  email?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  guardian1_name?: string;
  guardian1_phone?: string;
  guardian1_email?: string;
  referral_source?: string;
  referral_source_label?: string;
  referral_detail?: string;
  program_interest_id?: number;
  program_interest_name?: string;
  additional_info?: string;
  status: string;
  status_label: string;
  converted_member_id?: number;
  is_archived?: boolean;
  inquiry_date: string;
  owner_id?: number | null;
  owner_name?: string | null;
  next_follow_up_date?: string | null;
  scheduled_visit_date?: string | null;
  school_id?: number | null;
  school_name?: string | null;
  parent_mentor_interest?: boolean;
  interactions?: VisitorInteraction[];
}
