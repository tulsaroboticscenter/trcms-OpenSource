import { api } from "../../core/api";

export type GoalCategory = "robot" | "outreach" | "portfolio" | "team" | "fundraising" | "competition" | "skills" | "other";
export type MetricType = "count" | "currency" | "percent" | "hours" | "milestone";
export type MetricSource = "manual" | "impact_hours" | "budget" | "outreach_events" | "task_progress" | "certifications";
export type GoalPriority = "low" | "med" | "high";
export type GoalStatus = "draft" | "active" | "at_risk" | "achieved" | "missed" | "archived";

export interface GoalOwner { member_id: number; name: string; member_type: string; photo_url: string | null; }

export interface SeasonGoal {
  id: number;
  team_season_id: number;
  season: string | null;
  title: string;
  description: string | null;
  category: GoalCategory;
  owner: GoalOwner | null;
  owner_member_id: number | null;
  metric_type: MetricType;
  target_value: number | null;
  current_value: number;
  unit: string | null;
  metric_source: MetricSource;
  start_date: string | null;
  due_date: string | null;
  priority: GoalPriority;
  status: GoalStatus;
  linked_deadline_id: number | null;
  progress_pct: number;
  elapsed_pct: number | null;
  at_risk: boolean;
  update_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface GoalUpdate {
  id: number;
  goal_id: number;
  member: GoalOwner | null;
  value: number | null;
  note: string | null;
  logged_at: string | null;
}

export interface TeamGoalsResponse {
  team_season_id: number;
  mission: string | null;
  can_manage: boolean;
  goals: SeasonGoal[];
}

export interface GoalsOverview {
  teams: { team_season_id: number; team_label: string; season: string | null; goals: SeasonGoal[] }[];
}

export type GoalDraft = Partial<Omit<SeasonGoal, "id" | "owner" | "progress_pct" | "elapsed_pct" | "at_risk" | "update_count">>;

export const goalsApi = {
  listTeam: (teamSeasonId: number) =>
    api.get(`/api/v1/strategy/team/${teamSeasonId}/goals`).then((r) => r.data as TeamGoalsResponse),
  overview: (params?: { season?: string; category?: string; team_season_id?: number }) =>
    api.get(`/api/v1/strategy/goals`, { params }).then((r) => r.data as GoalsOverview),
  setMission: (teamSeasonId: number, mission: string) =>
    api.put(`/api/v1/strategy/team/${teamSeasonId}/mission`, { mission }).then((r) => r.data as { mission: string | null }),
  create: (teamSeasonId: number, goal: GoalDraft) =>
    api.post(`/api/v1/strategy/team/${teamSeasonId}/goals`, goal).then((r) => r.data as SeasonGoal),
  update: (goalId: number, patch: GoalDraft) =>
    api.patch(`/api/v1/strategy/goals/${goalId}`, patch).then((r) => r.data as SeasonGoal),
  remove: (goalId: number) =>
    api.delete(`/api/v1/strategy/goals/${goalId}`).then((r) => r.data),
  listUpdates: (goalId: number) =>
    api.get(`/api/v1/strategy/goals/${goalId}/updates`).then((r) => r.data as GoalUpdate[]),
  logProgress: (goalId: number, body: { value?: number | null; note?: string; status?: GoalStatus; evidence?: EvidenceInput }) =>
    api.post(`/api/v1/strategy/goals/${goalId}/updates`, body).then((r) => r.data as SeasonGoal),
  deleteUpdate: (updateId: number) =>
    api.delete(`/api/v1/strategy/goal-updates/${updateId}`).then((r) => r.data),
  evidenceTrail: (goalId: number) =>
    api.get(`/api/v1/strategy/goals/${goalId}/evidence`).then((r) => r.data as EvidenceItem[]),
  csvUrl: (tsid: number) => `/api/v1/strategy/team/${tsid}/goals.csv`,
  // roster for the owner dropdown (reuse the planning endpoint)
  teamMembers: (teamSeasonId: number) =>
    api.get(`/api/v1/planning/team/${teamSeasonId}/members`).then((r) => r.data as { member_id: number; name: string; member_type: string }[]),
};

// ── Evidence (Phase 3) ───────────────────────────────────────────────────────
export type EvidenceSourceType = "impact_log" | "outreach_event" | "task" | "budget_line" | "certification" | "resource" | "file" | "portfolio_capture" | "external_link";
export interface EvidenceInput { source_type?: EvidenceSourceType; label?: string; external_url?: string; source_id?: number }
export interface EvidenceItem { id: number; source_type: EvidenceSourceType; external_url: string | null; label: string; note?: string | null; logged_at?: string | null }

/** Download an authenticated CSV/file endpoint as a browser download. */
export function downloadFile(url: string, filename: string) {
  const token = localStorage.getItem("trc_token");
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); });
}

// ── Portfolio (Phase 2) ──────────────────────────────────────────────────────
export type SectionType = "team_background" | "sustainability" | "engineering_process" | "robot_design" | "outreach_impact" | "awards_narrative" | "custom";
export type PieceStatus = "not_started" | "in_progress" | "review" | "done";
export type PortfolioStatus = "planning" | "drafting" | "review" | "submission_ready";
export type CaptureType = "design_decision" | "test_result" | "outreach_event" | "photo" | "reflection" | "metric" | "quote";

export interface PieceResource { id: number; name: string; canva_url: string | null; }
export interface PortfolioPiece {
  id: number; portfolio_id: number; section_type: SectionType; title: string; description: string | null;
  owner: GoalOwner | null; owner_member_id: number | null; status: PieceStatus; due_date: string | null;
  sort_order: number; resource_id: number | null; resource: PieceResource | null;
}
export interface PortfolioCapture {
  id: number; piece_id: number | null; member: GoalOwner | null; capture_type: CaptureType;
  title: string | null; body: string | null; occurred_on: string | null; created_at: string | null;
}
export interface TeamPortfolio {
  team_season_id: number;
  portfolio: { id: number; program: "FTC" | "FRC" | "FLL"; award_target: "inspire" | "impact" | "other"; builder_tool: string; status: PortfolioStatus };
  pieces: PortfolioPiece[]; captures: PortfolioCapture[];
  progress_pct: number; done_count: number; piece_count: number;
  existing_assets: { id: number; name: string }[];
  can_contribute: boolean; can_manage: boolean; template_seeded: boolean;
}
export interface PortfolioOverview {
  teams: { team_season_id: number; team_label: string; season: string | null; program: string; award_target: string; status: PortfolioStatus; piece_count: number; done_count: number; progress_pct: number }[];
}

export const portfolioApi = {
  getTeam: (tsid: number) => api.get(`/api/v1/strategy/team/${tsid}/portfolio`).then((r) => r.data as TeamPortfolio),
  overview: () => api.get(`/api/v1/strategy/portfolios`).then((r) => r.data as PortfolioOverview),
  updatePortfolio: (pid: number, patch: { program?: string; award_target?: string; status?: string; builder_tool?: string }) =>
    api.patch(`/api/v1/strategy/portfolio/${pid}`, patch).then((r) => r.data),
  seedTemplate: (pid: number) => api.post(`/api/v1/strategy/portfolio/${pid}/seed-template`).then((r) => r.data as { created: number }),
  createPiece: (pid: number, body: { title: string; section_type?: string; owner_member_id?: number | null; due_date?: string | null }) =>
    api.post(`/api/v1/strategy/portfolio/${pid}/pieces`, body).then((r) => r.data as PortfolioPiece),
  updatePiece: (pieceId: number, patch: Partial<Pick<PortfolioPiece, "title" | "description" | "section_type" | "owner_member_id" | "status" | "due_date">>) =>
    api.patch(`/api/v1/strategy/portfolio-pieces/${pieceId}`, patch).then((r) => r.data as PortfolioPiece),
  deletePiece: (pieceId: number) => api.delete(`/api/v1/strategy/portfolio-pieces/${pieceId}`).then((r) => r.data),
  reorderPieces: (pid: number, pieceIds: number[]) =>
    api.post(`/api/v1/strategy/portfolio/${pid}/reorder`, { piece_ids: pieceIds }).then((r) => r.data),
  linkResource: (pieceId: number, body: { resource_id?: number; canva_url?: string; name?: string }) =>
    api.post(`/api/v1/strategy/portfolio-pieces/${pieceId}/link`, body).then((r) => r.data as PortfolioPiece),
  createCapture: (pid: number, body: { capture_type?: string; title?: string; body?: string; piece_id?: number | null; occurred_on?: string; evidence?: EvidenceInput }) =>
    api.post(`/api/v1/strategy/portfolio/${pid}/captures`, body).then((r) => r.data),
  deleteCapture: (captureId: number) => api.delete(`/api/v1/strategy/portfolio-captures/${captureId}`).then((r) => r.data),
  manifestCsvUrl: (tsid: number) => `/api/v1/strategy/team/${tsid}/portfolio/manifest.csv`,
  contentPack: (tsid: number) => api.get(`/api/v1/strategy/team/${tsid}/portfolio/content-pack`).then((r) => r.data as ContentPack),
};

// ── Readiness (Phase 4) ──────────────────────────────────────────────────────
export interface ReadinessCriterion { key: string; label: string; description: string | null; weight: number; score: number; guidance: string | null }
export interface Readiness {
  team_season_id: number; overall: number; band: "early" | "developing" | "strong";
  criteria: ReadinessCriterion[];
  context: { goals: number; pieces: number; captures: number; roster: number; youth_with_certs: number; mission_set: boolean };
}
export interface ReadinessCriteriaRow { id: number; key: string; label: string; description: string | null; weight: number; sort_order: number; is_active: boolean }

export const readinessApi = {
  get: (tsid: number) => api.get(`/api/v1/strategy/team/${tsid}/readiness`).then((r) => r.data as Readiness),
  criteria: () => api.get(`/api/v1/strategy/readiness/criteria`).then((r) => r.data as ReadinessCriteriaRow[]),
  saveCriteria: (criteria: { id: number; label?: string; weight?: number; is_active?: boolean }[]) =>
    api.put(`/api/v1/strategy/readiness/criteria`, { criteria }).then((r) => r.data as ReadinessCriteriaRow[]),
};

export interface ContentPack {
  team_season_id: number; award_target: string;
  sections: { piece_id: number; section_type: SectionType; title: string; captures: { type: string; title: string | null; body: string | null; occurred_on: string | null }[] }[];
  unfiled: { type: string; title: string | null; body: string | null; occurred_on: string | null }[];
}

export const SECTION_LABELS: Record<SectionType, string> = {
  team_background: "Team Background", sustainability: "Sustainability", engineering_process: "Engineering Process",
  robot_design: "Robot Design", outreach_impact: "Outreach & Impact", awards_narrative: "Awards Narrative", custom: "Custom",
};
export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  not_started: "Not started", in_progress: "In progress", review: "Review", done: "Done",
};
export const CAPTURE_LABELS: Record<CaptureType, string> = {
  design_decision: "Design decision", test_result: "Test result", outreach_event: "Outreach event",
  photo: "Photo", reflection: "Reflection", metric: "Metric", quote: "Quote",
};

export const CATEGORY_LABELS: Record<GoalCategory, string> = {
  robot: "Robot", outreach: "Outreach", portfolio: "Portfolio", team: "Team",
  fundraising: "Fundraising", competition: "Competition", skills: "Skills", other: "Other",
};
export const METRIC_LABELS: Record<MetricType, string> = {
  count: "Count", currency: "Dollars ($)", percent: "Percent (%)", hours: "Hours", milestone: "Milestone (done / not)",
};
