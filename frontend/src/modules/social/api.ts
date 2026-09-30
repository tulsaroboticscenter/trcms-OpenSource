import { api } from "../../core/api";

export interface SocialLink {
  platform: string;
  label: string;
  url: string;
}

export const socialApi = {
  list: () => api.get("/api/v1/social/links").then((r) => r.data as SocialLink[]),
  add: (link: SocialLink) => api.post("/api/v1/social/links", link).then((r) => r.data as SocialLink[]),
  update: (index: number, link: SocialLink) =>
    api.put(`/api/v1/social/links/${index}`, link).then((r) => r.data as SocialLink[]),
  remove: (index: number) => api.delete(`/api/v1/social/links/${index}`).then((r) => r.data as SocialLink[]),
};
