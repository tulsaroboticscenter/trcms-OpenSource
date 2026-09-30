import { api } from "../../core/api";

export interface FdpMember {
  id: number; member_id: number; name: string;
  member_number: string | null; photo_url: string | null;
  grade_label: string | null;
  status: "active" | "graduated";
  joined_date: string | null; joined_source: string;
  graduated_date: string | null; graduated_note: string | null; graduated_by: string | null;
  notes: string | null;
  certifications_completed: number;
  interviews: number;
  interview_teams: FdpInterviewBrief[];
  progress: FdpProgress;
}
export interface FdpProgress {
  resume_url: string | null;
  has_resume: boolean;
  /** The youth finished the in-app resume builder (or uploaded their own file). */
  resume_builder_complete: boolean;
  resume_updated_at: string | null;
  resume_updated_by: string | null;
  board_review_date: string | null;
  board_review_outcome: "passed" | "not_yet" | "deferred" | null;
  board_review_panel: string | null;
  board_review_notes: string | null;
  /** Rubric scores from the board of review: criterion → 1–4. */
  board_review_scores: Record<string, number>;
  board_review_by: string | null;
  board_review_scheduled_at: string | null;
  board_review_location: string | null;
  /** Booked but no result recorded yet. */
  board_review_pending: boolean;
  /** Passing the board of review is a one-time milestone — it never expires. */
  eligible_for_interview: boolean;
  notes: string | null;
}
export interface FdpInterviewBrief { team: string; status: string; scheduled_at: string | null }

export type InterviewStatus = "requested" | "scheduled" | "completed" | "declined" | "cancelled";
export interface FdpInterview {
  id: number;
  member_id: number; member_name: string | null;
  team_season_id: number; team: string | null;
  enrollment_year: number;
  direction: "team" | "youth";
  status: InterviewStatus;
  scheduled_at: string | null;
  location: string | null;
  outcome: "offered" | "not_selected" | "undecided" | null;
  notes: string | null;
  /** The youth is now on this team's roster (placement done). */
  placed: boolean;
  requested_by: string | null;
  created_at: string | null;
}

export interface FdpRoster {
  year: number; year_label: string;
  members: FdpMember[];
  active_count: number; graduated_count: number;
  eligible_missing: { member_id: number; name: string }[];
}
export interface FdpHistoryRow {
  id: number; enrollment_year: number; year_label: string;
  status: "active" | "graduated";
  joined_date: string | null; joined_source: string;
  graduated_date: string | null; graduated_note: string | null; graduated_by: string | null;
  notes: string | null;
}
export interface FdpHistory {
  member_id: number; can_manage: boolean; current_year: number;
  has_graduated: boolean; history: FdpHistoryRow[];
  certifications_completed: number;
  interviews: number;
  interview_teams: FdpInterviewBrief[];
  progress: FdpProgress;
}

export const fdpApi = {
  roster: (year?: number) =>
    api.get(`/api/v1/fdp${year ? `?year=${year}` : ""}`).then((r) => r.data as FdpRoster),
  forMember: (memberId: number) =>
    api.get(`/api/v1/fdp/member/${memberId}`).then((r) => r.data as FdpHistory),
  assign: (memberId: number, year?: number) =>
    api.post("/api/v1/fdp/assign", { member_id: memberId, year }).then((r) => r.data),
  assignEligible: (year?: number) =>
    api.post("/api/v1/fdp/assign-eligible", { year }).then((r) => r.data as { ok: boolean; added: number }),
  graduate: (id: number, d: { note?: string; graduated_date?: string; undo?: boolean }) =>
    api.post(`/api/v1/fdp/${id}/graduate`, d).then((r) => r.data),
  remove: (id: number) => api.delete(`/api/v1/fdp/${id}`).then((r) => r.data),
  /** Record a youth's resume and/or board of review (managers only). */
  setProgress: (memberId: number, d: Partial<{
    resume_url: string; board_review_outcome: string; board_review_date: string;
    board_review_panel: string; board_review_notes: string; notes: string;
    board_review_scheduled_at: string; board_review_location: string;
    board_review_scores: Record<string, number>;
  }>) => api.put(`/api/v1/fdp/member/${memberId}/progress`, d).then((r) => r.data as FdpProgress),
  /** Board-of-review rubric criteria (admin-configurable). */
  reviewRubric: () => api.get("/api/v1/fdp/review-rubric").then((r) => r.data as string[]),
  /** Book a board of review for one or more youth (fdp.manage). */
  scheduleBoardReview: (memberIds: number[], d: { scheduled_at: string; panel?: string; location?: string }) =>
    api.post("/api/v1/fdp/board-review/schedule", { member_ids: memberIds, ...d })
      .then((r) => r.data as { ok: boolean; scheduled: number; member_ids: number[]; skipped_not_youth: number[] }),
  /** Interviews for a team (team_season_id) or a youth (member_id). */
  interviews: (q: { team_season_id?: number; member_id?: number }) =>
    api.get("/api/v1/fdp/interviews", { params: q }).then((r) => r.data as FdpInterview[]),
  requestInterview: (d: { member_id: number; team_season_id: number; direction?: "team" | "youth"; notes?: string }) =>
    api.post("/api/v1/fdp/interviews", d).then((r) => r.data as FdpInterview),
  updateInterview: (id: number, d: Partial<{
    status: InterviewStatus; scheduled_at: string; location: string; outcome: string; notes: string;
  }>) => api.patch(`/api/v1/fdp/interviews/${id}`, d).then((r) => r.data as FdpInterview),
  /** Place the offered youth on the interview's team roster (closes the loop). */
  placeInterview: (id: number) =>
    api.post(`/api/v1/fdp/interviews/${id}/place`, {}).then((r) => r.data as FdpInterview),

  /** Youth who have passed their board of review — who teams may interview. Pass a team
   *  to get cert-matching (which of that team's wanted certs each youth already holds). */
  eligible: (year?: number, teamSeasonId?: number) =>
    api.get("/api/v1/fdp/eligible", { params: { ...(year ? { year } : {}), ...(teamSeasonId ? { team_season_id: teamSeasonId } : {}) } })
      .then((r) => r.data as EligibleResult),

  /** The placement funnel: youth bucketed by the furthest stage they've reached. */
  pipeline: (year?: number) =>
    api.get("/api/v1/fdp/pipeline", { params: year ? { year } : {} }).then((r) => r.data as FdpPipeline),
  /** Manager: send FDP interview / board-review reminders now. */
  sendReminders: () =>
    api.post("/api/v1/fdp/send-reminders", {}).then((r) => r.data as { ok: boolean; sent: number }),
  /** The certifications a team wants, plus the catalog to pick from. */
  teamCertNeeds: (teamSeasonId: number) =>
    api.get("/api/v1/fdp/team-cert-needs", { params: { team_season_id: teamSeasonId } }).then((r) => r.data as TeamCertNeeds),
  setTeamCertNeeds: (teamSeasonId: number, certificationIds: number[]) =>
    api.put("/api/v1/fdp/team-cert-needs", { team_season_id: teamSeasonId, certification_ids: certificationIds })
      .then((r) => r.data as { ok: boolean; selected: number[] }),
};

export interface EligibleMember {
  member_id: number; name: string; photo_url: string | null; grade_label: string | null;
  board_review_date: string | null; has_resume: boolean;
  resume_url: string | null; resume_builder_complete: boolean;
  certifications_completed: number; interviews: number;
  matched_certs: string[]; missing_certs: string[]; cert_match: string | null;
}
export interface EligibleResult {
  year: number;
  cert_needs: { id: number; name: string }[];
  members: EligibleMember[];
}
export interface PipelineMember {
  member_id: number; name: string; photo_url: string | null;
  has_resume: boolean; eligible: boolean; interviews: number; teams: FdpInterviewBrief[];
}
export interface PipelineStage { key: string; label: string; count: number; members: PipelineMember[] }
export interface FdpPipeline { year: number; year_label: string; total: number; stages: PipelineStage[] }
export interface TeamCertNeeds {
  team_season_id: number; selected: number[]; can_edit: boolean;
  catalog: { id: number; name: string; section: string | null }[];
}
