import { api } from "../../core/api";

export interface AvailMember {
  member_id: number;
  name: string;
  member_type: string;
  is_guardian: boolean;
  availability: {
    mentor_willing: "lead" | "assist" | "admin" | "no" | null;
    flexible: boolean;
    night_prefs: Record<string, "preferred" | "ok" | "no">;
    siblings_together: boolean | null;
    notes: string | null;
    submitted_by_name: string | null;
    submitted_at: string | null;
  } | null;
}
export interface AvailForm {
  season: string;
  program_id: number | null;
  program_name: string | null;
  family_id: number;
  family_name: string;
  nights: { id: number; name: string }[];
  members: AvailMember[];
}
export interface AvailResponse {
  member_id: number;
  mentor_willing?: "lead" | "assist" | "admin" | "no" | null;
  flexible?: boolean;
  night_prefs?: Record<string, "preferred" | "ok" | "no">;
  siblings_together?: boolean | null;
  notes?: string | null;
}

export const seasonPlanningApi = {
  // Public (tokenized, no login)
  resolveInvite: (token: string) =>
    api.get(`/api/v1/public/season-availability/${token}`).then((r) => r.data as AvailForm),
  submitInvite: (token: string, responses: AvailResponse[]) =>
    api.post(`/api/v1/public/season-availability/${token}`, { responses }).then((r) => r.data),

  // Logged-in family
  myForm: (season: string, programId?: number) =>
    api.get("/api/v1/season-planning/my-form", { params: { season, ...(programId ? { program_id: programId } : {}) } }).then((r) => r.data as AvailForm),
  saveMyForm: (season: string, programId: number | undefined, responses: AvailResponse[]) =>
    api.post("/api/v1/season-planning/my-form", { season, program_id: programId, responses }).then((r) => r.data),

  // Admin
  dashboard: (season: string, programId?: number, showAll = false) =>
    api.get("/api/v1/season-planning/dashboard", { params: { season, ...(programId ? { program_id: programId } : {}), ...(showAll ? { show_all: 1 } : {}) } }).then((r) => r.data as DashboardData),
  preferences: (season: string, programId: number) =>
    api.get("/api/v1/season-planning/preferences", { params: { season, program_id: programId } }).then((r) => r.data as PrefsData),
  eligibility: () =>
    api.get("/api/v1/season-planning/eligibility").then((r) => r.data as { bands: Record<string, { min: number; max: number }> }),
  saveEligibility: (bands: Record<string, { min: number; max: number }>) =>
    api.post("/api/v1/season-planning/eligibility", { bands }).then((r) => r.data as { bands: Record<string, { min: number; max: number }> }),
  adminSave: (familyId: number, season: string, programId: number | undefined, responses: AvailResponse[]) =>
    api.post("/api/v1/season-planning/admin-save", { family_id: familyId, season, program_id: programId, responses }).then((r) => r.data),
  sendInvites: (season: string, programId: number | undefined, familyIds: number[]) =>
    api.post("/api/v1/season-planning/invites", { season, program_id: programId, family_ids: familyIds }).then((r) => r.data as { sent: number; skipped_no_email: number[]; email_enabled: boolean }),
  excludeFamily: (season: string, programId: number | undefined, key: number, familyName?: string) =>
    api.post("/api/v1/season-planning/exclude-family", { season, program_id: programId, key, family_name: familyName }).then((r) => r.data as { ok: boolean }),
  restoreFamily: (season: string, programId: number | undefined, key: number) =>
    api.post("/api/v1/season-planning/restore-family", { season, program_id: programId, key }).then((r) => r.data as { ok: boolean }),

  // Board (Phase 2)
  board: (season: string, programId: number) =>
    api.get("/api/v1/season-planning/board", { params: { season, program_id: programId } }).then((r) => r.data as BoardData),
  seedBoard: (season: string, programId: number) =>
    api.post("/api/v1/season-planning/board/seed", { season, program_id: programId }).then((r) => r.data as { teams_created: number; members_placed: number; from_season: string; source: "current" | "prior" }),
  addTeam: (season: string, programId: number, nightId: number, label: string, basedOnTeamId?: number | null) =>
    api.post("/api/v1/season-planning/board/team", { season, program_id: programId, night_id: nightId, label, based_on_team_id: basedOnTeamId ?? null }).then((r) => r.data),
  availableTeams: (season: string, programId: number) =>
    api.get("/api/v1/season-planning/board/available-teams", { params: { season, program_id: programId } }).then((r) => r.data as AvailableTeam[]),
  updateTeam: (teamId: number, patch: { label?: string; night_id?: number }) =>
    api.patch(`/api/v1/season-planning/board/team/${teamId}`, patch).then((r) => r.data),
  deleteTeam: (teamId: number) =>
    api.delete(`/api/v1/season-planning/board/team/${teamId}`).then((r) => r.data),
  place: (teamId: number, memberId: number, role: "lead" | "assist" | "youth") =>
    api.post("/api/v1/season-planning/board/place", { plan_night_team_id: teamId, member_id: memberId, role }).then((r) => r.data),
  unplace: (teamId: number, memberId: number) =>
    api.post("/api/v1/season-planning/board/unplace", { plan_night_team_id: teamId, member_id: memberId }).then((r) => r.data),
  // Night-first
  assignNight: (season: string, programId: number, memberId: number, nightId: number, role?: "lead" | "assist" | "youth") =>
    api.post("/api/v1/season-planning/board/assign-night", { season, program_id: programId, member_id: memberId, night_id: nightId, ...(role ? { role } : {}) }).then((r) => r.data),
  setAvailability: (season: string, programId: number, memberId: number, patch: { mentor_willing?: string | null; flexible?: boolean; night_prefs?: Record<string, "preferred" | "ok" | "no"> }) =>
    api.post("/api/v1/season-planning/board/availability", { season, program_id: programId, member_id: memberId, ...patch }).then((r) => r.data),
  hideMentor: (memberId: number) =>
    api.post("/api/v1/season-planning/board/hide-mentor", { member_id: memberId }).then((r) => r.data as { ok: boolean }),
  unhideMentor: (memberId: number) =>
    api.post("/api/v1/season-planning/board/unhide-mentor", { member_id: memberId }).then((r) => r.data as { ok: boolean }),
  // Phase 3
  suggest: (season: string, programId: number) =>
    api.post("/api/v1/season-planning/board/suggest", { season, program_id: programId }).then((r) => r.data as { youth_placed: number; adults_placed: number }),
  publish: (season: string, programId: number) =>
    api.post("/api/v1/season-planning/board/publish", { season, program_id: programId }).then((r) => r.data as { teams_written: number; members_written: number; unmapped: string[] }),
};

export interface PrefRow {
  id: number;
  kind?: "member" | "visitor";
  name: string;
  preferred: string[];
  ok: string[];
  no: string[];
  flexible: boolean;
  notes: string | null;
  responded?: boolean;
  status?: string;                // youth: Enrolled / Waitlisted / New visitor …
  mentor_willing?: string | null; // mentors only
}
export interface PrefsTally { night_id: number; name: string; preferred: number; ok: number; }
export interface PrefsData {
  season: string;
  program_id: number;
  program_name: string;
  nights: { id: number; name: string }[];
  tally: PrefsTally[];
  youth: PrefRow[];
  mentors: PrefRow[];
  counts: { youth: number; mentors: number };
}

export interface AvailableTeam { team_id: number; team_number: string; team_name: string | null; label: string; on_board: boolean; }
export interface BoardNight { id: number; name: string; capacity: number; max_teams: number | null; }
export interface BoardPlacement { member_id: number; name: string; member_type: string; role: "lead" | "assist" | "youth"; is_guardian: boolean; grade: string | null; age: number | null; }
export interface BoardTeam { id: number; night_id: number; label: string; based_on_team_id: number | null; is_holding: boolean; placements: BoardPlacement[]; }
export interface BoardPoolMember {
  member_id: number; name: string; member_type: string; is_guardian: boolean;
  grade: string | null; age: number | null;
  ypt_ok: boolean | null; placed: boolean; is_waitlist: boolean;
  availability: { mentor_willing: string | null; flexible: boolean; night_prefs: Record<string, "preferred" | "ok" | "no"> } | null;
}
export interface BoardHiddenMentor { member_id: number; name: string; member_type: string; }
export interface BoardData { season: string; program_id: number; nights: BoardNight[]; teams: BoardTeam[]; pool: BoardPoolMember[]; hidden: BoardHiddenMentor[]; }

export interface DashboardCandidate {
  member_id: number;
  name: string;
  age: number | null;
  reasons: string[];
  is_candidate: boolean;
}
export interface DashboardFamily {
  key: number;             // stable id for removal (>0 real family, <0 lone youth)
  family_id: number;
  family_name: string;
  candidates: DashboardCandidate[];
  guardian_count: number;
  responded_count: number;
  member_count: number;
  complete: boolean;
  invite_sent: boolean;
  invite_used: boolean;
  emailable: boolean;
}
export interface RemovedFamily { key: number; family_name: string; }
export interface DashboardData {
  season: string;
  program_id: number | null;
  families: DashboardFamily[];
  total: number;
  complete: number;
  removed: RemovedFamily[];
  show_all: boolean;
  age_band: { min: number; max: number };
  ref_year: number;
  program_name: string;
}
