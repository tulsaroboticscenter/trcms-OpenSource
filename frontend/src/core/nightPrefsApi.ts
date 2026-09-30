import { api } from "./api";

/** A meeting night a program offers in a season. */
export interface NightOption {
  id: number;
  name: string;
  capacity: number;
  display_order: number;
}

/** A youth's canonical night preference (see PHP Core\NightPrefs). */
export interface NightPreference {
  available_night_ids: number[];
  preferred_night_id: number | null;
  flexible: boolean;
  siblings_together: boolean;
  source: string | null;
  notes: string | null;
}

/** The family default is the same shape minus provenance. */
export type FamilyNightDefault = Pick<
  NightPreference,
  "available_night_ids" | "preferred_night_id" | "flexible" | "siblings_together"
>;

export interface NightPrefsData {
  season: string;
  program_id: number;
  nights: NightOption[];
  preference: NightPreference | null;
  family_default: FamilyNightDefault | null;
  /** Whether night preference applies to this youth: FLL program + (known) age in band. */
  applies: boolean;
  is_fll: boolean;
  age: number | null;
  in_band: boolean | null;
}

/** A member's resolved FLL night preference for one program + season. */
export interface MemberNightPrefItem {
  program_id: number;
  program_name: string;
  season: string;
  preferred: string[];
  ok: string[];
  no: string[];
  flexible: boolean;
  siblings_together: boolean;
  mentor_willing: string | null;
  notes: string | null;
}
export interface MemberNightPrefs {
  member_id: number;
  is_fll: boolean;
  items: MemberNightPrefItem[];
}

/** Read/prefill + save the one canonical night preference for a youth. */
export const nightPrefsApi = {
  get: (p: { program_id: number; season?: string; member_id?: number; visitor_id?: number }) =>
    api.get("/api/v1/night-prefs", { params: p }).then((r) => r.data as NightPrefsData),
  save: (d: Record<string, unknown>) =>
    api.post("/api/v1/night-prefs", d).then((r) => r.data as { ok: boolean; preference: NightPreference | null }),
  forMember: (memberId: number) =>
    api.get(`/api/v1/night-prefs/member/${memberId}`).then((r) => r.data as MemberNightPrefs),
};
