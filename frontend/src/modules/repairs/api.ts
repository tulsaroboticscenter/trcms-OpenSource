import { api } from "../../core/api";

export const KIND_META: Record<string, { label: string; color: string }> = {
  repair: { label: "Repair", color: "#c62828" },
  maintenance: { label: "Maintenance", color: "#00838f" },
};

// The repair workflow, in order. `color` drives the status badge.
export const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#e65100" },
  maintenance: { label: "Maintenance", color: "#00838f" },
  in_progress: { label: "In Progress", color: "#1565c0" },
  waiting_parts: { label: "Waiting for Parts", color: "#6a1b9a" },
  testing: { label: "Undergoing Testing", color: "#9e7700" },
  complete: { label: "Complete", color: "#2e7d32" },
  closed: { label: "Closed", color: "#757575" },
};
export const STATUS_ORDER = ["pending", "maintenance", "in_progress", "waiting_parts", "testing", "complete", "closed"];

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "#757575" },
  normal: { label: "Normal", color: "#1565c0" },
  high: { label: "High", color: "#e65100" },
  urgent: { label: "Urgent", color: "#c62828" },
};

export interface RepairUpdate {
  id: number;
  member_id: number | null;
  member_name: string | null;
  body: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
}

export interface RepairTicket {
  id: number;
  title: string;
  description: string | null;
  equipment_name: string | null;
  inv_item_id: number | null;
  inv_item_name: string | null;
  kind: "repair" | "maintenance";
  status: string;
  priority: "low" | "normal" | "high" | "urgent";
  location_id: number | null;
  location_name: string | null;
  reported_by_id: number | null;
  reported_by_name: string | null;
  reported_date: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  completed_date: string | null;
  resolution: string | null;
  repair_cost: number | null;
  parts?: RepairPart[];
  parts_total?: number;
  total_cost?: number;
  created_at: string;
  updated_at: string;
  updates?: RepairUpdate[];
  correspondence?: RepairCorrespondence[];
}

export const CORR_DIRECTION_META: Record<string, { label: string; color: string }> = {
  outgoing: { label: "We contacted vendor", color: "#1565c0" },
  incoming: { label: "Vendor contacted us", color: "#6a1b9a" },
  note: { label: "Note", color: "#757575" },
};
export const CORR_CHANNELS = ["email", "phone", "portal", "mail", "chat", "other"] as const;

export interface RepairCorrespondence {
  id: number;
  direction: "outgoing" | "incoming" | "note";
  channel: string;
  contact_name: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  subject: string | null;
  body: string | null;
  reference: string | null;
  corresponded_on: string | null;
  member_id: number | null;
  member_name: string | null;
  created_at: string;
}

export interface RepairPart {
  id: number;
  inv_item_id: number | null;
  part_name: string;
  asset_tag: string | null;
  quantity: number;
  unit_cost: number | null;
  line_total: number | null;
  notes: string | null;
}

export interface AssetOption { id: number; label: string; }

export const repairsApi = {
  list: (params?: Record<string, string>) =>
    api.get("/api/v1/repairs/", { params }).then((r) => r.data as RepairTicket[]),
  get: (id: number) => api.get(`/api/v1/repairs/${id}`).then((r) => r.data as RepairTicket),
  create: (data: Record<string, unknown>) => api.post("/api/v1/repairs/", data).then((r) => r.data as RepairTicket),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/repairs/${id}`, data).then((r) => r.data as RepairTicket),
  remove: (id: number) => api.delete(`/api/v1/repairs/${id}`).then((r) => r.data),
  addUpdate: (id: number, data: { body?: string; new_status?: string }) =>
    api.post(`/api/v1/repairs/${id}/updates`, data).then((r) => r.data as RepairTicket),
  claim: (id: number) => api.post(`/api/v1/repairs/${id}/claim`).then((r) => r.data as RepairTicket),
  openCount: () => api.get("/api/v1/repairs/open-count").then((r) => r.data.count as number),
  assets: () => api.get("/api/v1/repairs/assets").then((r) => r.data as AssetOption[]),
  addPart: (id: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/repairs/${id}/parts`, data).then((r) => r.data as RepairTicket),
  updatePart: (partId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/repairs/parts/${partId}`, data).then((r) => r.data as RepairTicket),
  deletePart: (partId: number) =>
    api.delete(`/api/v1/repairs/parts/${partId}`).then((r) => r.data as RepairTicket),
  addCorrespondence: (id: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/repairs/${id}/correspondence`, data).then((r) => r.data as RepairTicket),
  updateCorrespondence: (corrId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/repairs/correspondence/${corrId}`, data).then((r) => r.data as RepairTicket),
  deleteCorrespondence: (corrId: number) =>
    api.delete(`/api/v1/repairs/correspondence/${corrId}`).then((r) => r.data as RepairTicket),
};
