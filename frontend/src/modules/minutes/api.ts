import { api } from "../../core/api";

export interface MeetingSummary {
  id: number; group_label: string; title: string; meeting_date?: string | null;
  location?: string | null; action_count: number; open_actions: number;
}
export interface Attendee { id: number; member_id: number | null; name: string | null; }
export interface GroupMember { member_id: number; name: string; }
export interface ActionItem {
  id: number; description: string;
  assignees: { member_id: number; name: string }[];
  assignee_member_id: number | null; assignee_name: string | null;   // first assignee (legacy)
  due_date: string | null; status: "open" | "done"; task_id: number | null;
}
export interface Meeting {
  id: number; group_label: string; title: string; meeting_date?: string | null;
  location?: string | null; agenda?: string | null; notes?: string | null;
  event_id?: number | null; event_name?: string | null; event_date?: string | null;
  created_by?: string | null; created_at?: string | null;
  updated_by?: string | null; updated_at?: string | null;
  attendees: Attendee[]; action_items: ActionItem[];
  group_members?: GroupMember[];
  can_manage?: boolean;
  locked?: boolean;
  locked_at?: string | null;
  locked_by?: string | null;
  can_lock?: boolean;
}
export interface EventHit { id: number; name: string; event_date?: string | null; }

export const minutesApi = {
  list: (group?: string) => api.get("/api/v1/meetings", { params: { group } }).then((r) => r.data as MeetingSummary[]),
  manageScope: (group?: string) =>
    api.get("/api/v1/meetings/manage-scope", { params: { group } }).then((r) => r.data as { can_view: boolean; can_manage: boolean }),
  get: (id: number) => api.get(`/api/v1/meetings/${id}`).then((r) => r.data as Meeting),
  create: (data: { group_label?: string; title: string; meeting_date?: string; location?: string; notes?: string; event_id?: number }) =>
    api.post("/api/v1/meetings", data).then((r) => r.data as Meeting),
  eventOptions: (group: string) =>
    api.get("/api/v1/meetings/event-options", { params: { group } }).then((r) => r.data as EventHit[]),
  update: (id: number, data: Partial<{ title: string; meeting_date: string; location: string; agenda: string; notes: string; group_label: string; event_id: number | null }>) =>
    api.patch(`/api/v1/meetings/${id}`, data).then((r) => r.data as Meeting),
  searchEvents: (search: string) =>
    api.get("/api/v1/events/", { params: { search, limit: 10 } }).then((r) => (r.data.events ?? []) as EventHit[]),
  remove: (id: number) => api.delete(`/api/v1/meetings/${id}`).then((r) => r.data),
  lock: (id: number) => api.post(`/api/v1/meetings/${id}/lock`).then((r) => r.data as Meeting),
  unlock: (id: number) => api.post(`/api/v1/meetings/${id}/unlock`).then((r) => r.data as Meeting),
  setAttendees: (id: number, memberIds: number[], guestNames: string[]) =>
    api.put(`/api/v1/meetings/${id}/attendees`, { member_ids: memberIds, guest_names: guestNames }).then((r) => r.data as Meeting),
  addAction: (id: number, data: { description: string; assignee_member_ids?: number[]; due_date?: string | null }) =>
    api.post(`/api/v1/meetings/${id}/actions`, data).then((r) => r.data as Meeting),
  updateAction: (actionId: number, data: Partial<{ description: string; assignee_member_ids: number[]; due_date: string | null; status: string }>) =>
    api.patch(`/api/v1/meetings/actions/${actionId}`, data).then((r) => r.data as Meeting),
  deleteAction: (actionId: number) => api.delete(`/api/v1/meetings/actions/${actionId}`).then((r) => r.data as Meeting),
};
