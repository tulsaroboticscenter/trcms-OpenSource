import { api } from "../../core/api";

export interface EsPackage {
  id: number; name: string; price: number | null; quantity_available: number | null;
  benefits: string | null; display_order: number; is_active: boolean;
  committed_count: number; slots_remaining: number | null;
}
export type EsStage = "prospect" | "invited" | "interested" | "committed" | "fulfilled" | "declined";
export interface EsEntry {
  id: number; sponsor_id: number; sponsor_name: string; sponsor_scope: "program" | "team";
  package_id: number | null; package_name: string | null; stage: EsStage;
  pledged_amount: number | null; received_amount: number | null; in_kind_description: string | null;
  received_date: string | null; relationship_owner_id: number | null; relationship_owner_name: string | null; notes: string | null;
}
export interface EventSponsorship {
  settings: { is_sponsorable: boolean; sponsorship_deadline: string | null; sponsorship_goal: number | null; sponsorship_owning_team_id: number | null };
  packages: EsPackage[];
  pipeline: EsEntry[];
  totals: { interested_count: number; committed_count: number; pledged: number; received: number; goal: number | null };
}

const base = (id: number) => `/api/v1/events/${id}/sponsorship`;
export const eventSponsorshipApi = {
  get: (eventId: number) => api.get(base(eventId)).then((r) => r.data as EventSponsorship),
  updateSettings: (eventId: number, d: Record<string, unknown>) => api.patch(base(eventId), d).then((r) => r.data as EventSponsorship),
  addPackage: (eventId: number, d: Record<string, unknown>) => api.post(`${base(eventId)}/packages`, d).then((r) => r.data as EventSponsorship),
  updatePackage: (pid: number, d: Record<string, unknown>) => api.patch(`/api/v1/events/sponsorship/packages/${pid}`, d).then((r) => r.data as EventSponsorship),
  deletePackage: (pid: number) => api.delete(`/api/v1/events/sponsorship/packages/${pid}`).then((r) => r.data as EventSponsorship),
  addEntry: (eventId: number, d: Record<string, unknown>) => api.post(`${base(eventId)}/pipeline`, d).then((r) => r.data as EventSponsorship),
  updateEntry: (eid: number, d: Record<string, unknown>) => api.patch(`/api/v1/events/sponsorship/pipeline/${eid}`, d).then((r) => r.data as EventSponsorship),
  deleteEntry: (eid: number) => api.delete(`/api/v1/events/sponsorship/pipeline/${eid}`).then((r) => r.data as EventSponsorship),
};
