import { api } from "../../core/api";

export interface PermissionsReportData {
  modules: { id: string; label: string }[];
  members: {
    id: number; name: string; member_type: string; is_active: boolean;
    is_super: boolean; roles: string[]; modules: Record<string, string>;
  }[];
}

export interface ClassroomEmailMember { id: number; name: string; member_type: string; email: string; }
export interface ClassroomEmailReadiness {
  workspace_domain: string;
  total: number; with_email: number; missing_email_count: number;
  on_domain_count: number; off_domain_count: number; duplicate_count: number;
  missing_email: ClassroomEmailMember[];
  off_domain: ClassroomEmailMember[];
  duplicates: { email: string; members: ClassroomEmailMember[] }[];
  domains: { domain: string; count: number }[];
}

export const reportsApi = {
  getPermissionsReport: () =>
    api.get("/api/v1/reports/permissions").then(r => r.data as PermissionsReportData),

  getClassroomEmailReadiness: (domain?: string) =>
    api.get("/api/v1/reports/classroom-email-readiness", { params: domain ? { domain } : {} })
      .then(r => r.data as ClassroomEmailReadiness),

  getActiveMembers: () =>
    api.get("/api/v1/reports/active-members").then(r => r.data as ActiveMembersReport),

  getCertificationsByMember: () =>
    api.get("/api/v1/reports/certifications-by-member").then(r => r.data as CertsByMemberReport),

  getYouthByGrade: () =>
    api.get("/api/v1/reports/youth-by-grade").then(r => r.data as YouthByGradeReport),

  getCertificationOptions: () =>
    api.get("/api/v1/reports/certification-options").then(r => r.data as CertOption[]),

  getCertificationHolders: (certIds: number[], match: "any" | "all") =>
    api.get("/api/v1/reports/certification-holders", { params: { cert_ids: certIds.join(","), match } })
       .then(r => r.data as CertHoldersReport),

  getMemberDirectory: (params?: { member_type?: string; enrolled_only?: boolean }) =>
    api.get("/api/v1/reports/member-directory", { params }).then(r => r.data as MemberDirRow[]),

  getTeamList: (season?: string, programId?: number) =>
    api.get("/api/v1/reports/team-list", { params: { season, program_id: programId } }).then(r => r.data as TeamListEntry[]),

  getEnrollmentStatus: (enrollmentYear?: number) =>
    api.get("/api/v1/reports/enrollment-status", { params: { enrollment_year: enrollmentYear } })
       .then(r => r.data as { enrollment_year: number; enrollments: EnrollmentRow[] }),

  getYouthSpecialNotes: (opts: { enrollmentYear?: number; programId?: number } = {}) =>
    api.get("/api/v1/reports/youth-special-notes", { params: { enrollment_year: opts.enrollmentYear, program_id: opts.programId } })
       .then(r => r.data as { enrollment_year: number; program_id: number | null; youth: SpecialNotesRow[] }),

  getEmployerMatching: (onlyOffers = false) =>
    api.get("/api/v1/reports/employer-matching", { params: onlyOffers ? { only_offers: 1 } : {} })
       .then(r => r.data as { people: EmployerMatchingRow[] }),

  getAttendanceSummary: (opts: { fromDate?: string; toDate?: string; memberId?: number; teamSeasonId?: number; includeMentors?: boolean } = {}) =>
    api.get("/api/v1/reports/attendance-summary", { params: {
      from_date: opts.fromDate, to_date: opts.toDate,
      member_id: opts.memberId, team_season_id: opts.teamSeasonId,
      include_mentors: opts.includeMentors === false ? "0" : undefined,
    } }).then(r => r.data as AttendanceRow[]),

  getNotCheckedIn: (opts: { fromDate?: string; toDate?: string; teamSeasonId?: number; includeMentors?: boolean; memberType?: string } = {}) =>
    api.get("/api/v1/reports/not-checked-in", { params: {
      from_date: opts.fromDate, to_date: opts.toDate,
      team_season_id: opts.teamSeasonId, member_type: opts.memberType,
      include_mentors: opts.includeMentors === false ? "0" : undefined,
    } }).then(r => r.data as NotCheckedInResult),

  getActivitySeasons: () =>
    api.get("/api/v1/activity/seasons").then(r => r.data as string[]),
  getActivityImpact: (opts: { season?: string; fromDate?: string; toDate?: string; memberId?: number }) =>
    api.get("/api/v1/reports/activity-impact", { params: { season: opts.season, from_date: opts.fromDate, to_date: opts.toDate, member_id: opts.memberId } })
       .then(r => r.data as ActivityImpact),
  csvActivityImpact: (opts: { season?: string; fromDate?: string; toDate?: string; memberId?: number }) => {
    const p = new URLSearchParams();
    if (opts.season) p.set("season", opts.season);
    if (opts.fromDate) p.set("from_date", opts.fromDate);
    if (opts.toDate) p.set("to_date", opts.toDate);
    if (opts.memberId) p.set("member_id", String(opts.memberId));
    const qs = p.toString();
    return `${api.defaults.baseURL}/api/v1/reports/activity-impact/csv${qs ? `?${qs}` : ""}`;
  },

  // CSV download URLs (trigger browser download)
  csvMemberDirectory: (memberType?: string) =>
    `${api.defaults.baseURL}/api/v1/reports/member-directory/csv${memberType ? `?member_type=${memberType}` : ""}`,

  csvTeamList: (season?: string) =>
    `${api.defaults.baseURL}/api/v1/reports/team-list/csv${season ? `?season=${season}` : ""}`,

  csvEnrollmentStatus: (year?: number) =>
    `${api.defaults.baseURL}/api/v1/reports/enrollment-status/csv${year ? `?enrollment_year=${year}` : ""}`,

  csvCertificationsByMember: () =>
    `${api.defaults.baseURL}/api/v1/reports/certifications-by-member/csv`,

  csvYouthByGrade: () =>
    `${api.defaults.baseURL}/api/v1/reports/youth-by-grade/csv`,

};

export interface EmployerMatchingRow {
  member_id: number; first_name: string; last_name: string; member_type: string;
  employer_name: string; employer_job_title: string | null;
  matches_donations: string | null; volunteer_grants: string | null; offers_grants: string | null;
  program_info: string | null; matching_help: boolean; notes: string | null;
}

export interface MemberCertLine { code: string; name: string; section: string | null; completed_date: string | null; }
export interface CertsByMemberRow {
  member_id: number; member_number: string | null; name: string; first_name: string; last_name: string;
  member_type: string; cert_count: number; certifications: MemberCertLine[];
}
export interface CertsByMemberReport {
  generated_at: string; member_count: number; certified_count: number; members: CertsByMemberRow[];
}

export interface GradeMember { member_id: number; member_number: string | null; name: string; first_name: string; last_name: string; graduation_year: number | null; programs?: string[]; }
export interface GradeGroup { grade: number | null; label: string; count: number; members: GradeMember[]; }
export interface YouthByGradeReport { season_year: number; season_label: string; total: number; generated_at: string; groups: GradeGroup[]; }

export interface CertOption { id: number; code: string; name: string; section: string | null; status: string; }
export interface HolderCert { id: number; code: string; completed_date: string | null; }
export interface HolderTeam { team_number: string; team_name: string | null; }
export interface CertHolder {
  member_id: number; member_number: string | null; name: string; first_name: string; last_name: string;
  member_type: string; certs: HolderCert[]; teams: HolderTeam[]; fdp: string | null;
}
export interface CertHoldersReport {
  match: string; certifications: { id: number; code: string; name: string }[];
  team_season?: string; member_count: number; members: CertHolder[];
}

export interface Bucket { label: string; count: number; }
export interface MissingDemographicsMember {
  member_id: number; member_number: string | null; name: string; member_type: string;
  missing_sex: boolean; missing_race: boolean; missing_birthday: boolean;
}
export interface ActiveMembersReport {
  generated_at: string;
  total_active: number;
  inactive_count: number;
  archived_count: number;
  alumni_count?: number;
  missing_demographics?: MissingDemographicsMember[];
  by_member_type: Bucket[];
  supporting: Bucket[];
  by_program: Bucket[];
  by_sex: Bucket[];
  by_race: Bucket[];
  by_age_band: Bucket[];
  by_frl_youth: Bucket[];
}

export interface MemberDirRow {
  id: number;
  member_number: string;
  last_name: string;
  first_name: string;
  member_type: string;
  email?: string;
  phone?: string;
  school?: string;
  guardian1_name?: string;
  guardian1_phone?: string;
  guardian1_email?: string;
  family_name?: string | null;
  teams: string[];
}

export interface TeamMemberEntry {
  member_id: number;
  first_name: string;
  last_name: string;
  member_type: string;
  status: string;
  primary_role?: string;
  shirt_size?: string | null;
  registered_on_first: boolean | null;
  first_consent_release: boolean | null;
  background_check: boolean | null;
  ypt: boolean | null;
  role_specific: boolean | null;
}

export interface TeamListEntry {
  team_number: string;
  team_name?: string;
  program?: string;
  season: string;
  status: string;
  members: TeamMemberEntry[];
  shirt_tally?: { size: string; count: number }[];
}

export interface EnrollmentRow {
  member_id: number;
  member_number: string;
  first_name: string;
  last_name: string;
  program?: string;
  status: string;
  membership_status?: string;
  payment_status?: string;
  date_enrolled?: string;
  date_payment?: string;
  payment_amount?: number;
  payment_override: boolean;
  payment_method?: string;
  scholarship_fund?: string;
  amount_due?: number | null;
  balance?: number | null;
  scholarship_credit?: number;
  covered?: boolean;
  is_active?: boolean;
  shirt_size?: string;
  tc_youth_agreed: boolean;
  tc_parent_agreed: boolean;
  fully_signed: boolean;
}

export interface SpecialNotesRow {
  member_id: number;
  first_name: string;
  last_name: string;
  grade_label: string | null;
  program_id: number | null;
  program: string | null;
  health_problems: string | null;
  medical_notes: string | null;
  food_allergies: string | null;
  environmental_allergies: string | null;
  medication_allergies: string | null;
  medications_current: string | null;
  accommodations: string | null;
  special_notes: string | null;
  self_administer: boolean | null;
  otc_permission: string | null;
  has_medical_record: boolean;
  media_release: "granted" | "declined" | "unanswered";
}

export interface AttendanceRow {
  member_id: number;
  member_number: string;
  first_name: string;
  last_name: string;
  member_type: string;
  checkin_count: number;
  total_hours: number;
}

export interface ActivityImpact {
  total_hours: number;
  volunteer_hours: number;
  by_area: { area: string; hours: number }[];
  by_member_type: { member_type: string; hours: number }[];
  members: {
    member_id: number;
    member_number: string;
    first_name: string;
    last_name: string;
    member_type: string;
    total_hours: number;
    volunteer_hours: number;
  }[];
}

export interface NotCheckedInMember {
  member_id: number; member_number: string | null;
  first_name: string; last_name: string; member_type: string;
  email: string | null; phone: string | null;
  guardian1_name: string | null; guardian1_email: string | null; guardian1_phone: string | null;
  last_checkin: string | null; days_since: number | null;
}
export interface NotCheckedInResult { from: string; to: string; members: NotCheckedInMember[] }

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
  message: string;
}

// ── Trends / time-series ───────────────────────────────────────────────────
export interface TrendMetric {
  key: string;
  label: string;
  domain: string;
  mechanism: "event" | "snapshot";
  unit: "count" | "hours" | "currency" | "percent" | "years" | "ratio";
  scope: string;
  breakdowns: string[];
  available_breakdowns: string[];
  sensitivity: "public" | "internal" | "pii" | "financial";
  phase: number;
}

export interface TrendPoint {
  period_key: string;
  period_start: string;
  scope_type?: string;
  scope_id: string;
  label?: string;
  value: number;
}

export interface TrendSeries {
  metric: string;
  label: string;
  unit: TrendMetric["unit"];
  mechanism: "event" | "snapshot";
  period: string;
  from: string;
  to: string;
  breakdown: string | null;
  series?: { scope_id: string; label: string }[];
  points: TrendPoint[];
}

export const trendsApi = {
  listMetrics: () =>
    api.get("/api/v1/trends/metrics").then(r => (r.data as { metrics: TrendMetric[] }).metrics),
  getSeries: (opts: { metric: string; period?: string; from?: string; to?: string; scopeType?: string; scopeId?: string; breakdown?: string }) =>
    api.get("/api/v1/trends/series", { params: {
      metric: opts.metric, period: opts.period, from: opts.from, to: opts.to,
      scope_type: opts.scopeType, scope_id: opts.scopeId, breakdown: opts.breakdown,
    } }).then(r => r.data as TrendSeries),
  getRetention: (opts: { memberType?: string; maxYears?: number } = {}) =>
    api.get("/api/v1/trends/retention", { params: {
      member_type: opts.memberType, max_years: opts.maxYears,
    } }).then(r => r.data as RetentionTriangle),
};

// ── Reports Engine (custom builder) ─────────────────────────────────────────
export interface DatasetField { key: string; label: string; type: string; tier: string; aggregatable: boolean }
export interface DatasetMeta { key: string; label: string; fields: DatasetField[] }
export interface DatasetAccess { capability: string; row_scope: string; max_field_tier: string; can_build: boolean }
export interface EngineDataset { meta: DatasetMeta; access: DatasetAccess }

export interface ReportColumn { key: string; label: string; type: string }
export interface ReportResult { columns: ReportColumn[]; rows: (string | number | null)[][]; row_count: number }

export interface SavedReport {
  id: number; name: string; description: string | null; dataset: string;
  folder_id: number | null; owner_id: number | null; visibility: string;
  created_at: string; updated_at: string | null;
  definition?: ReportDefinition;
}

export interface FilterCondition { field: string; operator: string; value?: unknown; param?: string }
export interface FilterGroup { op: "and" | "or"; conditions: (FilterCondition | FilterGroup)[] }
export interface ReportParameter { key: string; label: string; type: string }
export interface ComputedField { key: string; label: string; expr: string; type?: string }
export interface ReportDefinition {
  fields: { field: string; agg?: string }[];
  filters?: FilterGroup;
  parameters?: ReportParameter[];
  computed?: ComputedField[];
  group_by?: string[];
  sort?: { field: string; dir: string }[];
  limit?: number;
}

export const reportEngineApi = {
  datasets: () =>
    api.get("/api/v1/reports/engine/datasets").then(r => (r.data as { datasets: EngineDataset[] }).datasets),
  preview: (dataset: string, definition: ReportDefinition, params?: Record<string, unknown>, teamSeasonId?: number) =>
    api.post("/api/v1/reports/engine/preview", { dataset, definition, params, team_season_id: teamSeasonId }).then(r => r.data as ReportResult),
  list: () =>
    api.get("/api/v1/reports/engine").then(r => (r.data as { reports: SavedReport[] }).reports),
  get: (id: number) =>
    api.get(`/api/v1/reports/engine/${id}`).then(r => r.data as SavedReport),
  create: (payload: { name: string; description?: string; dataset: string; visibility?: string; definition: ReportDefinition }) =>
    api.post("/api/v1/reports/engine", payload).then(r => r.data as { id: number }),
  update: (id: number, payload: Partial<{ name: string; description: string; visibility: string; definition: ReportDefinition }>) =>
    api.put(`/api/v1/reports/engine/${id}`, payload).then(r => r.data),
  remove: (id: number) =>
    api.delete(`/api/v1/reports/engine/${id}`).then(r => r.data),
  run: (id: number, params?: Record<string, unknown>, teamSeasonId?: number) =>
    api.post(`/api/v1/reports/engine/${id}/run`, { params, team_season_id: teamSeasonId }).then(r => r.data as ReportResult),

  listSchedules: (reportId: number) =>
    api.get(`/api/v1/reports/engine/${reportId}/schedules`).then(r => (r.data as { schedules: ReportScheduleItem[] }).schedules),
  createSchedule: (reportId: number, payload: ScheduleInput) =>
    api.post(`/api/v1/reports/engine/${reportId}/schedules`, payload).then(r => r.data as { id: number; next_run_at: string }),
  deleteSchedule: (sid: number) =>
    api.delete(`/api/v1/reports/engine/schedules/${sid}`).then(r => r.data),
};

export interface ReportScheduleItem {
  id: number;
  definition_id: number;
  cadence: "daily" | "weekly" | "monthly";
  day_of_week: number | null;
  day_of_month: number | null;
  send_hour: number;
  recipient_emails: string;
  team_season_id: number | null;
  is_active: boolean;
  next_run_at: string | null;
  summary: string;
  report_name?: string;
}
export interface ScheduleInput {
  cadence: string;
  day_of_week?: number;
  day_of_month?: number;
  send_hour: number;
  recipient_emails: string;
}

export interface ReportPermRow { id: number; role_name: string; dataset: string; capability: string; row_scope: string; max_field_tier: string }
export interface ReportMatrix { roles: string[]; datasets: { key: string; label: string }[]; rows: ReportPermRow[] }

export const reportAccessApi = {
  matrix: () => api.get("/api/v1/reports/engine/permissions").then(r => r.data as ReportMatrix),
  save: (payload: { role_name: string; dataset: string; capability: string; row_scope: string; max_field_tier: string }) =>
    api.put("/api/v1/reports/engine/permissions", payload).then(r => r.data),
  remove: (id: number) => api.delete(`/api/v1/reports/engine/permissions/${id}`).then(r => r.data),
};

export interface UsageUser {
  member_id: number;
  name: string;
  member_type: string;
  pageviews: number;
  sessions: number;
  active_minutes: number;
  actions: number;
  last_seen: string | null;
}
export interface UsageReport {
  from: string;
  to: string;
  users: UsageUser[];
  top_pages: { path: string; views: number }[];
  tracking_active: boolean;
}

export const usageApi = {
  getReport: (opts: { from?: string; to?: string } = {}) =>
    api.get("/api/v1/reports/usage", { params: { from: opts.from, to: opts.to } }).then(r => r.data as UsageReport),
};

export interface RetentionCell { year: number; retained: number | null; pct: number | null }
export interface RetentionCohort { cohort_season: string; size: number; cells: RetentionCell[] }
export interface RetentionTriangle {
  basis: string;
  max_years: number;
  member_type: string;
  cohorts: RetentionCohort[];
}
