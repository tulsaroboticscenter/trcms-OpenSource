import { api } from "../../core/api";

export interface ResourceAttr {
  key: string;
  label: string;
  type: "url" | "text" | "longtext" | "file" | "select";
  required?: boolean;
  options?: string[] | null;
}

export interface ResourceType {
  id: number;
  name: string;
  icon?: string | null;
  attributes: ResourceAttr[];
  sort_order: number;
  is_active: boolean;
}

export interface ResourceAccessRow {
  member_id: number;
  member_name: string;
  status: "requested" | "granted" | "revoked";
  requested_at?: string | null;
  granted_at?: string | null;
}

export interface Resource {
  id: number;
  name: string;
  scope: "team" | "trc";
  team_season_id?: number | null;
  resource_type?: ResourceType | null;
  values: Record<string, string>;
  notes?: string | null;
  resets_each_season: boolean;
  needs_update: boolean;
  sort_order: number;
  granted_count: number;
  pending_count: number;
  my_status?: "requested" | "granted" | "revoked" | null;
  access?: ResourceAccessRow[];
}

export const resourcesApi = {
  // types
  listTypes: () => api.get("/api/v1/resources/types").then((r) => r.data as ResourceType[]),
  createType: (data: Partial<ResourceType>) => api.post("/api/v1/resources/types", data).then((r) => r.data as ResourceType),
  updateType: (id: number, data: Partial<ResourceType>) => api.patch(`/api/v1/resources/types/${id}`, data).then((r) => r.data),
  deleteType: (id: number) => api.delete(`/api/v1/resources/types/${id}`).then((r) => r.data),

  // resources
  listTeam: (teamSeasonId: number) =>
    api.get(`/api/v1/resources/team/${teamSeasonId}`).then((r) => r.data as Resource[]),
  listTrc: () => api.get("/api/v1/resources/trc").then((r) => r.data as Resource[]),
  create: (data: Record<string, unknown>) => api.post("/api/v1/resources/", data).then((r) => r.data as Resource),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/resources/${id}`, data).then((r) => r.data as Resource),
  remove: (id: number) => api.delete(`/api/v1/resources/${id}`).then((r) => r.data),

  // access
  request: (id: number) => api.post(`/api/v1/resources/${id}/request`).then((r) => r.data),
  grant: (id: number, memberId: number) => api.post(`/api/v1/resources/${id}/grant`, { member_id: memberId }).then((r) => r.data),
  revoke: (id: number, memberId: number) => api.post(`/api/v1/resources/${id}/revoke`, { member_id: memberId }).then((r) => r.data),

  accessLog: (scope: string) =>
    api.get("/api/v1/resources/access-log", { params: { scope } })
      .then((r) => r.data as { pending: AccessRow[]; history: AccessRow[] }),
};

export interface AccessRow {
  resource_id: number;
  resource_name: string;
  member_id: number;
  member_name: string;
  status: "requested" | "granted" | "revoked";
  requested_at?: string | null;
  granted_at?: string | null;
  acted_by?: string | null;
}
