import { api } from "../../core/api";

/** Module accent color (gold). */
export const HOF_COLOR = "#b8860b";

export interface TeamItem { label: string; season?: string }
export interface AwardItem { name: string; year?: number | null }
export interface PositionItem { role: string; team?: string; terms?: string }
export interface LinkItem { label: string; url: string }
export interface ReflectionItem { prompt: string; response: string }

/** Suggested reflection prompts offered in the editor (members can write their own too). */
export const REFLECTION_PROMPTS = [
  "My favorite experience at the TRC…",
  "How the TRC has impacted me…",
  "What advice I would give to younger members…",
  "What I'm most proud of…",
  "Who inspired me at the TRC…",
  "What I'll carry with me…",
];

export interface HofCard {
  id: number;
  member_id: number | null;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  graduation_year: number | null;
  is_published: boolean;
}

export interface HofMember extends HofCard {
  years_in_program: string | null;
  high_school: string | null;
  deans_list_semifinalist: boolean;
  deans_list_finalist: boolean;
  eagle_scout: boolean;
  eagle_scout_troop: string | null;
  college: string | null;
  field_of_study: string | null;
  degrees: string | null;
  college_grad_year: number | null;
  still_in_school: boolean;
  where_now: string | null;
  display_order: number;
  teams: TeamItem[];
  awards: AwardItem[];
  positions: PositionItem[];
  project_links: LinkItem[];
  article_links: LinkItem[];
  album_links: LinkItem[];
  documents: LinkItem[];
  reflections: ReflectionItem[];
  created_at?: string;
  updated_at?: string;
}

export interface HofClass { year: number | null; members: HofCard[] }
export interface HofListResponse { classes: HofClass[]; can_manage: boolean }

export interface EligibleYouth {
  id: number; first_name: string; last_name: string;
  photo_url: string | null; graduation_year: number | null; school: string | null;
}

export const hofApi = {
  list: (all = false) =>
    api.get("/api/v1/hof/", { params: all ? { all: "1" } : {} }).then((r) => r.data as HofListResponse),
  get: (id: number) => api.get(`/api/v1/hof/${id}`).then((r) => r.data as HofMember),
  create: (data: Record<string, unknown>) => api.post("/api/v1/hof/", data).then((r) => r.data as HofMember),
  createFromMember: (memberId: number) =>
    api.post(`/api/v1/hof/from-member/${memberId}`).then((r) => r.data as HofMember & { already_existed?: boolean }),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/hof/${id}`, data).then((r) => r.data as HofMember),
  setPublished: (id: number, published: boolean) =>
    api.post(`/api/v1/hof/${id}/publish`, { published }).then((r) => r.data as HofMember),
  remove: (id: number) => api.delete(`/api/v1/hof/${id}`).then((r) => r.data),
  eligible: () => api.get("/api/v1/hof/eligible").then((r) => r.data as EligibleYouth[]),
};

export function initials(first: string, last: string): string {
  return `${(first || "?")[0] ?? ""}${(last || "")[0] ?? ""}`.toUpperCase();
}
