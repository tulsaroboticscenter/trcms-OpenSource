import { api } from "../../core/api";

export type MentorStage = "interested" | "contacted" | "onboarding" | "active" | "declined";
export type MentorKind = "mentor" | "volunteer";
export interface MentorProspect {
  id: number; name: string; kind: MentorKind; email?: string | null; phone?: string | null; source?: string | null;
  stage: MentorStage;
  ypt_done: boolean; background_done: boolean; tc_done: boolean; orientation_done: boolean;
  owner_id?: number | null; owner_name?: string | null;
  from_visitor_id?: number | null; from_visitor_name?: string | null;
  sponsor_id?: number | null; sponsor_name?: string | null;
  converted_member_id?: number | null; onboarding_complete: boolean; notes?: string | null;
}

export const mentorProspectsApi = {
  list: (params?: { stage?: string; kind?: string }) => api.get("/api/v1/mentor-prospects/", { params: params ?? {} }).then((r) => r.data as MentorProspect[]),
  create: (d: Record<string, unknown>) => api.post("/api/v1/mentor-prospects/", d).then((r) => r.data as MentorProspect),
  update: (id: number, d: Record<string, unknown>) => api.patch(`/api/v1/mentor-prospects/${id}`, d).then((r) => r.data as MentorProspect),
  remove: (id: number) => api.delete(`/api/v1/mentor-prospects/${id}`).then((r) => r.data),
  convert: (id: number, memberId?: number) => api.post(`/api/v1/mentor-prospects/${id}/convert`, { member_id: memberId ?? null }).then((r) => r.data as MentorProspect),
  toSponsor: (id: number) => api.post(`/api/v1/mentor-prospects/${id}/to-sponsor`, {}).then((r) => r.data as MentorProspect),
};
