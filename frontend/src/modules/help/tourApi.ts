import { api } from "../../core/api";

/** One step of a guided tour. selector spotlights an element; omit for a centered card. */
export interface TourStep {
  selector?: string;
  title: string;
  body: string;      // Markdown (rendered with the shared help renderer)
  route?: string;    // navigate here before showing this step
  placement?: "auto" | "top" | "bottom" | "left" | "right";
}

export interface GuidedTour {
  id: number;
  tour_key: string;
  title: string;
  description: string | null;
  roles: string | null;
  auto_key: string | null;
  sort_order: number;
  is_published: boolean;
  updated_at: string | null;
  step_count?: number;
  steps?: TourStep[];
}

export const tourApi = {
  // Reader
  list: () => api.get("/api/v1/tours").then((r) => r.data as GuidedTour[]),
  get: (key: string) => api.get(`/api/v1/tours/${key}`).then((r) => r.data as GuidedTour),

  // Author (admin.config)
  adminList: () => api.get("/api/v1/admin/tours").then((r) => r.data as GuidedTour[]),
  create: (data: Partial<GuidedTour>) => api.post("/api/v1/admin/tours", data).then((r) => r.data as GuidedTour),
  update: (id: number, data: Partial<GuidedTour>) => api.put(`/api/v1/admin/tours/${id}`, data).then((r) => r.data as GuidedTour),
  remove: (id: number) => api.delete(`/api/v1/admin/tours/${id}`).then((r) => r.data),
};
