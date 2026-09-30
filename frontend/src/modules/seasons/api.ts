import { api } from "../../core/api";

export const seasonsApi = {
  list: () =>
    api.get("/api/v1/seasons/").then(r => r.data as FIRSTSeason[]),

  create: (data: Partial<FIRSTSeason>) =>
    api.post("/api/v1/seasons/", data).then(r => r.data as FIRSTSeason),

  update: (id: number, data: Partial<FIRSTSeason>) =>
    api.patch(`/api/v1/seasons/${id}`, data).then(r => r.data as FIRSTSeason),

  delete: (id: number) =>
    api.delete(`/api/v1/seasons/${id}`).then(r => r.data),

  getMemberParticipation: (memberId: number) =>
    api.get(`/api/v1/seasons/member/${memberId}`).then(r => r.data as MemberParticipationResponse),

  saveParticipation: (memberId: number, seasonId: number, data: ParticipationUpdate) =>
    api.put(`/api/v1/seasons/member/${memberId}/season/${seasonId}`, data)
       .then(r => r.data as { participation: SeasonParticipation; experience_years: number }),
};

export interface FIRSTSeason {
  id: number;
  season: string;
  theme?: string;
  fll_explore_game?: string;
  fll_challenge_game?: string;
  ftc_game?: string;
  frc_game?: string;
  fdp_game?: string;
  notes?: string;
  display_order: number;
}

export interface SeasonParticipation {
  id: number | null;
  member_id: number;
  season_id: number;
  season: string;
  theme?: string;
  fll_explore_game?: string;
  fll_challenge_game?: string;
  ftc_game?: string;
  frc_game?: string;
  fdp_game?: string;
  participated_fll_explore: boolean;
  participated_fll_challenge: boolean;
  participated_ftc: boolean;
  participated_frc: boolean;
  participated_fdp: boolean;
  has_participation: boolean;
  notes?: string;
}

export interface MemberParticipationResponse {
  experience_years: number;
  seasons: SeasonParticipation[];
}

export interface ParticipationUpdate {
  participated_fll_explore: boolean;
  participated_fll_challenge: boolean;
  participated_ftc: boolean;
  participated_frc: boolean;
  participated_fdp: boolean;
  notes?: string;
}
