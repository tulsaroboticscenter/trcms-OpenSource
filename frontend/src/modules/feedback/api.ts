import { api } from "../../core/api";

export const TYPE_META: Record<string, { label: string; color: string }> = {
  bug: { label: "Bug", color: "#c62828" },
  feature: { label: "Feature Request", color: "#1565c0" },
  enhancement: { label: "Enhancement", color: "#00838f" },
  other: { label: "Other", color: "#6a1b9a" },
};

export const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "#e65100" },
  planned: { label: "Planned", color: "#6a1b9a" },
  in_progress: { label: "In Progress", color: "#1565c0" },
  in_review: { label: "In Review", color: "#00838f" },
  testing: { label: "Testing", color: "#00897b" },
  done: { label: "Done", color: "#2e7d32" },
  declined: { label: "Declined", color: "#757575" },
};

export const PRIORITY_META: Record<string, { label: string; color: string }> = {
  low: { label: "Low", color: "#757575" },
  normal: { label: "Normal", color: "#1565c0" },
  high: { label: "High", color: "#e65100" },
  critical: { label: "Critical", color: "#c62828" },
};

export interface Feedback {
  id: number;
  member_id: number | null;
  submitter_name: string | null;
  type: "bug" | "feature" | "enhancement" | "other";
  title: string;
  description: string | null;
  steps: string | null;
  page: string | null;
  app_version: string | null;
  user_agent: string | null;
  target_release: string | null;
  entered_by_id: number | null;
  entered_by_name: string | null;
  status: "new" | "planned" | "in_progress" | "in_review" | "testing" | "done" | "declined";
  priority: "low" | "normal" | "high" | "critical";
  admin_notes: string | null;
  resolution_release: string | null;
  deployed_on: string | null;
  resolution_notes: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  confirmed_by_id: number | null;
  confirmed_by_name: string | null;
  comments: FeedbackComment[];
}

export interface FeedbackComment {
  id: number;
  member_id: number | null;
  author_name: string | null;
  body: string;
  kind: "comment" | "confirmed";
  created_at: string;
}

export interface GithubPushResult extends Feedback {
  github_result?: { number: number; url: string; node_id: string; added_to_project?: boolean; project_error?: string };
}

export const feedbackApi = {
  list: (params?: Record<string, string>) =>
    api.get("/api/v1/feedback/", { params }).then((r) => r.data as { can_manage: boolean; items: Feedback[] }),
  get: (id: number) => api.get(`/api/v1/feedback/${id}`).then((r) => r.data as Feedback),
  create: (data: Record<string, unknown>) => api.post("/api/v1/feedback/", data).then((r) => r.data as Feedback),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/feedback/${id}`, data).then((r) => r.data as Feedback),
  remove: (id: number) => api.delete(`/api/v1/feedback/${id}`).then((r) => r.data),
  bulkUpdate: (ids: number[], fields: Record<string, unknown>) =>
    api.post("/api/v1/feedback/bulk", { ids, ...fields }).then((r) => r.data),
  openCount: () => api.get("/api/v1/feedback/open-count").then((r) => r.data.count as number),
  pushToGithub: (id: number) =>
    api.post(`/api/v1/feedback/${id}/github`).then((r) => r.data as GithubPushResult),
  commentToGithub: (id: number, body: string) =>
    api.post(`/api/v1/feedback/${id}/github-comment`, { body }).then((r) => r.data as { ok: boolean; comment_url: string }),
  /** Add a comment and/or (un)confirm the fix. Returns the refreshed feedback. */
  addComment: (id: number, body: string, confirm?: boolean) =>
    api.post(`/api/v1/feedback/${id}/comments`,
      { body, ...(confirm === undefined ? {} : { confirm }) }).then((r) => r.data as Feedback),
};
