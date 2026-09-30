import { api } from "../../core/api";

/**
 * Member onboarding checklist. Completion for YPT / background check / first aid is
 * DERIVED server-side from the compliance record (`derived: true`) — those items are
 * never ticked here; recording the date on the compliance screens updates them.
 */
export interface OnboardingItem {
  category: "onboarding" | "fdp_work";
  id: number;
  member_id: number;
  item_key: string;
  label: string;
  description: string | null;
  source: string;
  derived: boolean;
  help_slug: string | null;
  action_url: string | null;
  action_label: string | null;
  assigned_at: string;
  assigned_by_id: number | null;
  due_date: string | null;
  notes: string | null;
  is_complete: boolean;
  exempt: boolean;
  completed_date: string | null;
  expired: boolean;
  expiring_soon: boolean;
  expires_date: string | null;
}

export interface OnboardingChecklist {
  member_id: number;
  items: OnboardingItem[];
  /** The fixed joining checklist (YPT, handbook, …). */
  checklist: OnboardingItem[];
  /** Free-form work a mentor assigned to an FDP youth. */
  work: OnboardingItem[];
  open_count: number;
  can_manage: boolean;
  can_assign_work: boolean;
}

export interface CatalogItem {
  item_key: string;
  label: string;
  description: string | null;
  source: string;
  derived: boolean;
  help_slug: string | null;
}

export interface OutstandingMember {
  member_id: number;
  name: string;
  member_type: string;
  open: OnboardingItem[];
  open_count: number;
  overdue_count: number;
  complete_count: number;
  oldest_assigned: string;
}

export const onboardingApi = {
  catalog: () =>
    api.get("/api/v1/onboarding/catalog").then((r) => (r.data as { items: CatalogItem[] }).items),

  mine: () =>
    api.get("/api/v1/onboarding/me").then((r) => r.data as OnboardingChecklist),

  forMember: (memberId: number) =>
    api.get(`/api/v1/onboarding/members/${memberId}`).then((r) => r.data as OnboardingChecklist),

  assign: (memberId: number, items: string[], dueDate?: string) =>
    api.post(`/api/v1/onboarding/members/${memberId}/assign`, { items, due_date: dueDate || undefined })
      .then((r) => r.data as OnboardingChecklist),

  complete: (taskId: number, complete = true) =>
    api.post(`/api/v1/onboarding/tasks/${taskId}/complete`, { complete })
      .then((r) => r.data as OnboardingChecklist),

  unassign: (taskId: number) =>
    api.delete(`/api/v1/onboarding/tasks/${taskId}`).then((r) => r.data as { ok: boolean }),

  /** Assign a piece of FDP work to a youth (fdp.manage). */
  assignWork: (memberId: number, d: { title: string; description?: string; due_date?: string }) =>
    api.post(`/api/v1/onboarding/members/${memberId}/work`, d).then((r) => r.data as OnboardingChecklist),

  /** Assign the same work to several youth at once (fdp.manage). */
  assignWorkBulk: (memberIds: number[], d: { title: string; description?: string; due_date?: string }) =>
    api.post("/api/v1/onboarding/work/bulk", { member_ids: memberIds, ...d })
      .then((r) => r.data as { ok: boolean; assigned: number; member_ids: number[]; skipped_not_youth: number[] }),

  /** Assign the "Build your resume" task to several youth at once (fdp.manage). */
  assignResumeTaskBulk: (memberIds: number[], dueDate?: string) =>
    api.post("/api/v1/onboarding/resume-task/bulk", { member_ids: memberIds, due_date: dueDate || undefined })
      .then((r) => r.data as { ok: boolean; assigned: number; member_ids: number[]; skipped_not_youth: number[] }),

  outstanding: () =>
    api.get("/api/v1/onboarding/outstanding")
      .then((r) => r.data as { total: number; members: OutstandingMember[] }),
};
