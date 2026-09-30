import { api } from "../../core/api";

/** Module accent color — reservations render in this unique color on the calendar. */
export const RESERVATION_COLOR = "#7b1fa2";

export const PURPOSES = [
  { value: "personal", label: "Personal" },
  { value: "trc", label: "General TRC" },
  { value: "team", label: "Team" },
];

export const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pending",   color: "#e65100" },
  approved:  { label: "Approved",  color: "#2e7d32" },
  denied:    { label: "Denied",    color: "#c62828" },
  cancelled: { label: "Cancelled", color: "#757575" },
};

export interface ReservationResource {
  id: number;
  name: string;
  kind: "room" | "equipment";
  is_active: boolean;
  is_hidden: boolean;
  display_order: number;
  notes: string | null;
}

export interface Reservation {
  id: number;
  resource_id: number;
  resource_name: string | null;
  resource_kind: "room" | "equipment" | null;
  member_id: number;
  member_name: string | null;
  purpose: "personal" | "trc" | "team";
  team_season_id: number | null;
  team_label: string | null;
  event_id: number | null;
  event_name: string | null;
  event_date: string | null;
  usage_details: string | null;
  special_considerations: string | null;
  start_at: string;
  end_at: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  reviewed_by_id: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  conflicts?: number;
}

export const reservationsApi = {
  resources: (all = false) =>
    api.get("/api/v1/reservations/resources", { params: all ? { all: "1" } : {} }).then((r) => r.data as ReservationResource[]),
  createResource: (data: Record<string, unknown>) =>
    api.post("/api/v1/reservations/resources", data).then((r) => r.data as ReservationResource),
  updateResource: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/reservations/resources/${id}`, data).then((r) => r.data as ReservationResource),
  removeResource: (id: number) =>
    api.delete(`/api/v1/reservations/resources/${id}`).then((r) => r.data),

  list: (params?: Record<string, string>) =>
    api.get("/api/v1/reservations/", { params }).then((r) => r.data as Reservation[]),
  get: (id: number) => api.get(`/api/v1/reservations/${id}`).then((r) => r.data as Reservation),
  create: (data: Record<string, unknown>) => api.post("/api/v1/reservations/", data).then((r) => r.data as Reservation),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/reservations/${id}`, data).then((r) => r.data as Reservation),
  decision: (id: number, action: "approve" | "deny", review_note?: string) =>
    api.post(`/api/v1/reservations/${id}/decision`, { action, review_note }).then((r) => r.data as Reservation),
  cancel: (id: number) => api.post(`/api/v1/reservations/${id}/cancel`, {}).then((r) => r.data as Reservation),
  remove: (id: number) => api.delete(`/api/v1/reservations/${id}`).then((r) => r.data),
  pendingCount: () => api.get("/api/v1/reservations/pending-count").then((r) => r.data.count as number),
  forEvent: (eventId: number) =>
    api.get(`/api/v1/reservations/for-event/${eventId}`).then((r) => r.data as Reservation[]),
};

/** A stable, distinct color per resource so each room/equipment reads at a glance. */
const RESOURCE_PALETTE = [
  "#1565c0", "#2e7d32", "#e65100", "#6a1b9a", "#c62828", "#00838f",
  "#5d4037", "#ad1457", "#558b2f", "#4527a0", "#00695c", "#f9a825",
];
export function resourceColor(resourceId: number | null | undefined): string {
  if (resourceId == null) return RESERVATION_COLOR;
  return RESOURCE_PALETTE[resourceId % RESOURCE_PALETTE.length];
}

/** Format "YYYY-MM-DD HH:MM:SS" → friendly local label. */
export function fmtRange(start: string, end: string): string {
  const s = new Date(start.replace(" ", "T"));
  const e = new Date(end.replace(" ", "T"));
  const day = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay ? `${day}, ${t(s)} – ${t(e)}` : `${day} ${t(s)} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${t(e)}`;
}
