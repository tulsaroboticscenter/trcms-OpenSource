import { api } from "../../core/api";

export interface ProgramNight {
  id: number; program_id: number; season: string; name: string;
  capacity: number; display_order: number; is_active: boolean;
  accepted: number; spots_open: number; waiting: number;
}
export type WaitStatus = "waiting" | "offered" | "accepted" | "declined" | "expired" | "withdrawn";
export interface NightRef { id: number; name: string | null }
export interface WaitlistEntry {
  id: number;
  person: { type: "visitor" | "member" | null; id: number | null; name: string };
  program_id: number; season: string; status: WaitStatus;
  sibling_of_member: boolean; parent_mentor_interest: boolean; weight: number;
  available_nights: NightRef[]; preferred_night: NightRef | null;
  requested_date: string; carried_from_season: string | null;
  offered_night: NightRef | null; offered_at: string | null; offer_expires: string | null; responded_at: string | null;
  priority_reason: string | null; notes: string | null; position: number | null;
}
export interface WaitlistSummaryRow {
  program_id: number; program: string; season: string;
  waiting: number; accepted: number; total_capacity: number;
}

const q = (p: Record<string, string | number>) => ({ params: p });
export const waitlistApi = {
  list: (programId: number, season?: string) => api.get("/api/v1/waitlist/", q({ program_id: programId, ...(season ? { season } : {}) })).then((r) => r.data as WaitlistEntry[]),
  add: (d: Record<string, unknown>) => api.post("/api/v1/waitlist/", d).then((r) => r.data as WaitlistEntry[]),
  update: (id: number, d: Record<string, unknown>) => api.patch(`/api/v1/waitlist/${id}`, d).then((r) => r.data as WaitlistEntry[]),
  remove: (id: number) => api.delete(`/api/v1/waitlist/${id}`).then((r) => r.data as WaitlistEntry[]),
  offer: (id: number, d: Record<string, unknown>) => api.post(`/api/v1/waitlist/${id}/offer`, d).then((r) => r.data as WaitlistEntry[]),
  respond: (id: number, accept: boolean) => api.post(`/api/v1/waitlist/${id}/respond`, { accept }).then((r) => r.data as WaitlistEntry[]),
  summary: (season?: string) => api.get("/api/v1/waitlist/summary", q(season ? { season } : {})).then((r) => r.data as WaitlistSummaryRow[]),
  nights: (programId: number, season?: string) => api.get("/api/v1/waitlist/nights", q({ program_id: programId, ...(season ? { season } : {}) })).then((r) => r.data as ProgramNight[]),
  addNight: (d: Record<string, unknown>) => api.post("/api/v1/waitlist/nights", d).then((r) => r.data),
  updateNight: (id: number, d: Record<string, unknown>) => api.patch(`/api/v1/waitlist/nights/${id}`, d).then((r) => r.data),
  deleteNight: (id: number) => api.delete(`/api/v1/waitlist/nights/${id}`).then((r) => r.data),
};
