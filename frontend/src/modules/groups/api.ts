import { api } from "../../core/api";

export interface GroupSummary { id: number; name: string; description?: string | null; is_active: boolean; member_count: number; source?: string; auto_managed?: boolean; }
export interface GroupMember { id: number; name: string; member_type: string; role?: string | null; }
export interface GroupEvent { id: number; name: string; event_date?: string | null; start_time?: string | null; location?: string | null; }
export interface Group {
  id: number; name: string; description?: string | null; is_active: boolean;
  source?: string; auto_managed?: boolean;
  position_options?: string[] | null;   // per-group position titles; null = use defaults
  members: GroupMember[]; upcoming_events: GroupEvent[];
}
export interface MyGroupEvent extends GroupEvent { group_id: number; group_name: string; }

export const groupsApi = {
  list: () => api.get("/api/v1/groups").then((r) => r.data as GroupSummary[]),
  get: (id: number) => api.get(`/api/v1/groups/${id}`).then((r) => r.data as Group),
  create: (data: { name: string; description?: string }) => api.post("/api/v1/groups", data).then((r) => r.data as Group),
  update: (id: number, data: Partial<{ name: string; description: string; is_active: boolean; position_options: string[] }>) =>
    api.patch(`/api/v1/groups/${id}`, data).then((r) => r.data as Group),
  remove: (id: number) => api.delete(`/api/v1/groups/${id}`).then((r) => r.data),
  setMembers: (id: number, memberIds: number[], positions?: Record<number, string>) =>
    api.put(`/api/v1/groups/${id}/members`, { member_ids: memberIds, positions }).then((r) => r.data as Group),
  myEvents: () => api.get("/api/v1/groups/mine/events").then((r) => r.data as MyGroupEvent[]),
};
