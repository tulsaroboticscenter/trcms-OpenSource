import { api } from "../../core/api";

export const teamsApi = {
  list: (programId?: number) =>
    api.get("/api/v1/teams/", { params: programId ? { program_id: programId } : {} }).then((r) => r.data as TeamSummary[]),

  get: (teamId: number) =>
    api.get(`/api/v1/teams/${teamId}`).then((r) => r.data as TeamSummary),

  create: (data: Record<string, unknown>) =>
    api.post("/api/v1/teams/", data).then((r) => r.data),

  getCurrentSeason: () =>
    api.get("/api/v1/teams/current-season").then((r) => r.data.season as string),

  getMemberTeams: (memberId: number) =>
    api.get(`/api/v1/teams/member/${memberId}`).then((r) => r.data as MemberTeamAssignment[]),

  // Seasons
  getSeasons: (teamId: number) =>
    api.get(`/api/v1/teams/${teamId}/seasons`).then((r) => r.data as TeamSeasonDetail[]),

  getSeason: (seasonId: number) =>
    api.get(`/api/v1/teams/seasons/${seasonId}`).then((r) => r.data as TeamSeasonDetail),

  createSeason: (data: Record<string, unknown>) =>
    api.post("/api/v1/teams/seasons", data).then((r) => r.data),

  updateSeason: (seasonId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/teams/seasons/${seasonId}`, data).then((r) => r.data),

  updateTheme: (seasonId: number, data: { theme_preset?: string | null; theme_font?: string | null; theme_accent?: string | null }) =>
    api.patch(`/api/v1/teams/seasons/${seasonId}/theme`, data).then((r) => r.data as TeamSeasonDetail),

  updateTeamPhoto: (seasonId: number, teamPhotoUrl: string | null) =>
    api.patch(`/api/v1/teams/seasons/${seasonId}/photo`, { team_photo_url: teamPhotoUrl }).then((r) => r.data as TeamSeasonDetail),

  // Roster
  getSeasonMembers: (seasonId: number) =>
    api.get(`/api/v1/teams/seasons/${seasonId}/members`).then((r) => r.data as RosterMember[]),
  seasonLeadership: (seasonId: number) =>
    api.get(`/api/v1/teams/seasons/${seasonId}/leadership`).then((r) => r.data as TeamLeadership),
  assignLeadership: (seasonId: number, memberId: number, role: string) =>
    api.post(`/api/v1/teams/seasons/${seasonId}/leadership`, { member_id: memberId, role })
      .then((r) => r.data as TeamLeadership),
  removeLeadership: (seasonId: number, memberId: number) =>
    api.delete(`/api/v1/teams/seasons/${seasonId}/leadership/${memberId}`).then((r) => r.data as TeamLeadership),

  addMember: (data: Record<string, unknown>) =>
    api.post("/api/v1/teams/members", data).then((r) => r.data),

  getAssignment: (assignmentId: number) =>
    api.get(`/api/v1/teams/members/${assignmentId}`).then((r) => r.data as RosterMember),

  updateMember: (assignmentId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/teams/members/${assignmentId}`, data).then((r) => r.data),

  removeMember: (assignmentId: number) =>
    api.delete(`/api/v1/teams/members/${assignmentId}`).then((r) => r.data),

  /** SysAdmin-only: permanently delete a roster assignment (no not_active row left). */
  purgeMember: (assignmentId: number) =>
    api.delete(`/api/v1/teams/members/${assignmentId}/purge`).then((r) => r.data),
};

export interface TeamSummary {
  id: number;
  team_number: string;
  program_id: number;
  program_name?: string;
  rookie_season?: string;
  seasons_competed: number;
  current_season?: TeamSeasonDetail;
}

export interface TeamSeasonDetail {
  id: number;
  team_id: number;
  team_number?: string;
  program_name?: string;
  rookie_season?: string;
  seasons_competed?: number;
  season: string;
  team_name?: string;
  status: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  x_account?: string;
  website?: string;
  discord_links?: string;
  robot_name?: string;
  robot_photo_url?: string;
  team_logo_url?: string;
  team_photo_url?: string;
  theme_preset?: string | null;
  theme_font?: string | null;
  theme_accent?: string | null;
}

export interface TeamLeader { ylc_id: number; member_id: number; name: string; photo_url: string | null; role: string; }
export interface LeadershipCandidate { member_id: number; name: string; photo_url: string | null; current_role: string | null; }
export interface TeamLeadership {
  leaders: TeamLeader[];
  can_manage: boolean;
  roles: string[];
  candidates: LeadershipCandidate[];
}

export interface RosterMember {
  id: number;
  team_season_id: number;
  member_id: number;
  member_number: string;
  first_name: string;
  last_name: string;
  photo_url?: string;
  member_type: string;
  robotics_experience_years: number;
  seasons_on_team: number;
  date_joined?: string;
  date_left?: string;
  status: string;
  primary_role?: string;
  secondary_role?: string;
  // FIRST-YPP compliance, pulled read-only from the mentor's profile (null for youth).
  registered_on_first: boolean | null;
  first_consent_release: boolean | null;
  background_check: boolean | null;
  ypt: boolean | null;
  role_specific: boolean | null;
}

export interface MemberTeamAssignment {
  assignment_id: number;
  team_season_id: number;
  team_id: number;
  team_number: string;
  team_name?: string;
  program_name?: string;
  season: string;
  status: string;
  primary_role?: string;
  secondary_role?: string;
  date_joined?: string;
  date_left?: string;
}
