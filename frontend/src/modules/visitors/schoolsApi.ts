import { api } from "../../core/api";

export interface SchoolContact { id: number; name: string; title?: string | null; email?: string | null; phone?: string | null; notes?: string | null; }
export interface SchoolEngagement { id: number; engaged_on?: string | null; type?: string | null; notes?: string | null; outcome?: string | null; member_name?: string | null; }
export interface School {
  id: number; name: string; type?: string | null; district?: string | null; address?: string | null;
  notes?: string | null; is_active: boolean;
  contact_count?: number; engagement_count?: number; prospects?: number; enrolled?: number;
}
export interface SchoolDetail extends School { contacts: SchoolContact[]; engagements: SchoolEngagement[]; }

export const schoolsApi = {
  list: (search?: string) => api.get("/api/v1/schools/", { params: search ? { search } : {} }).then((r) => r.data as School[]),
  get: (id: number) => api.get(`/api/v1/schools/${id}`).then((r) => r.data as SchoolDetail),
  create: (d: Record<string, unknown>) => api.post("/api/v1/schools/", d).then((r) => r.data as SchoolDetail),
  update: (id: number, d: Record<string, unknown>) => api.patch(`/api/v1/schools/${id}`, d).then((r) => r.data as SchoolDetail),
  remove: (id: number) => api.delete(`/api/v1/schools/${id}`).then((r) => r.data),
  addContact: (id: number, d: Record<string, unknown>) => api.post(`/api/v1/schools/${id}/contacts`, d).then((r) => r.data as SchoolDetail),
  updateContact: (cid: number, d: Record<string, unknown>) => api.patch(`/api/v1/schools/contacts/${cid}`, d).then((r) => r.data as SchoolDetail),
  deleteContact: (cid: number) => api.delete(`/api/v1/schools/contacts/${cid}`).then((r) => r.data as SchoolDetail),
  addEngagement: (id: number, d: Record<string, unknown>) => api.post(`/api/v1/schools/${id}/engagements`, d).then((r) => r.data as SchoolDetail),
  deleteEngagement: (eid: number) => api.delete(`/api/v1/schools/engagements/${eid}`).then((r) => r.data as SchoolDetail),
};
