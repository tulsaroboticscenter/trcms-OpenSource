import { api } from "../../core/api";

export interface HelpArticle {
  id: number;
  slug: string;
  title: string;
  category: string;
  summary: string | null;
  tags: string | null;
  help_key: string | null;
  roles: string | null;
  is_published: boolean;
  sort_order: number;
  updated_at: string | null;
  body?: string;
}

export const helpApi = {
  // Reader
  list: (params?: { search?: string; category?: string; help_key?: string }) =>
    api.get("/api/v1/help/articles", { params }).then((r) => r.data as HelpArticle[]),
  get: (slug: string) =>
    api.get(`/api/v1/help/articles/${slug}`).then((r) => r.data as HelpArticle),

  // Author (admin.config)
  adminList: () => api.get("/api/v1/admin/help/articles").then((r) => r.data as HelpArticle[]),
  adminGet: (id: number) => api.get(`/api/v1/admin/help/articles/${id}`).then((r) => r.data as HelpArticle),
  create: (data: Partial<HelpArticle>) => api.post("/api/v1/admin/help/articles", data).then((r) => r.data as HelpArticle),
  update: (id: number, data: Partial<HelpArticle>) => api.put(`/api/v1/admin/help/articles/${id}`, data).then((r) => r.data as HelpArticle),
  remove: (id: number) => api.delete(`/api/v1/admin/help/articles/${id}`).then((r) => r.data),
};
