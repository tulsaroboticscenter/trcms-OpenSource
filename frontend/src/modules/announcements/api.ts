import { api } from "../../core/api";

export interface Announcement {
  id: number;
  title: string;
  body?: string | null;
  pinned: boolean;
  published_at?: string | null;
  expires_at?: string | null;
  created_by_id?: number | null;
  created_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const announcementsApi = {
  list: (all = false) => api.get("/api/v1/announcements", { params: all ? { all: 1 } : {} }).then((r) => r.data as Announcement[]),
  create: (data: Partial<Announcement>) => api.post("/api/v1/announcements", data).then((r) => r.data as Announcement),
  update: (id: number, data: Partial<Announcement>) => api.patch(`/api/v1/announcements/${id}`, data).then((r) => r.data as Announcement),
  remove: (id: number) => api.delete(`/api/v1/announcements/${id}`).then((r) => r.data),
};
