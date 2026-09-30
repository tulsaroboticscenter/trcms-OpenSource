import { api } from "../../core/api";

export interface FeatureName {
  nickname: string;
  description: string;
  release: string;
  date: string;
  member: { name: string; photo_url: string | null } | null;
}

export const featureNamesApi = {
  list: () => api.get("/api/v1/feature-names").then((r) => r.data as FeatureName[]),
};
