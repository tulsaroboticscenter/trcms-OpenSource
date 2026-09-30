import { api } from "../../core/api";

export type ActivityStatus = "not_started" | "in_progress" | "blocked" | "done";
export type TaskStatus = "open" | "claimed" | "done";
export type Recurrence = "none" | "daily" | "weekly" | "biweekly" | "monthly";

export interface TeamBrief {
  team_season_id: number;
  team_name: string;
  team_number?: number | null;
}

export interface MemberBrief {
  member_id: number;
  name: string;
  member_type: string;
  photo_url?: string;
}

export interface PlanActivity {
  id: number;
  category_id: number;
  team_season_id: number;
  name: string;
  description?: string;
  target_date?: string | null;
  start_date?: string | null;
  duration_days?: number | null;
  percent_complete: number;
  status: ActivityStatus;
  lead?: MemberBrief | null;
  assigned_role_id?: number | null;
  assigned_role_name?: string | null;
  assignees: MemberBrief[];
  blocked_by: { id: number; name: string; status: ActivityStatus }[];
  is_blocked: boolean;
  estimated_minutes?: number | null;
  actual_minutes: number;
  completed_at?: string | null;
  sort_order: number;
  // present on the My Activities feed
  team_name?: string;
  role?: "lead" | "owner";
}

export interface RescheduleChange {
  id: number;
  name: string;
  from_start: string | null;
  to_start: string | null;
  from_target: string | null;
  to_target: string | null;
}
export interface RescheduleResult { changes: RescheduleChange[]; applied: boolean; }

export interface SeasonDeadline {
  id: number;
  name: string;
  deadline_date: string;
  event_id: number | null;
  event_name: string | null;
  notes: string | null;
}

export interface PlanCategory {
  id: number;
  name: string;
  color?: string;
  sort_order: number;
  percent_complete?: number;
  activities: PlanActivity[];
}

export interface TeamRole { id: number; name: string; sort_order: number; members: MemberBrief[]; }

export type IssueStatus = "open" | "in_progress" | "on_hold" | "closed";
export interface IssueComment { id: number; body: string; created_at: string | null; author: MemberBrief | null; }
export interface TeamIssue {
  id: number;
  team_season_id: number;
  title: string;
  description: string | null;
  status: IssueStatus;
  resolution_notes: string | null;
  reporter: MemberBrief | null;
  linked_activity_id: number | null;
  linked_activity_name: string | null;
  linked_bom_id: number | null;
  linked_bom_name: string | null;
  stakeholders: MemberBrief[];
  comment_count?: number;
  comments?: IssueComment[];
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
}
export const ISSUE_STATUS_META: Record<IssueStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "#c62828" },
  in_progress: { label: "In Progress", color: "#1565c0" },
  on_hold: { label: "On Hold", color: "#8a6d3b" },
  closed: { label: "Closed", color: "#2e7d32" },
};

export interface TeamTask {
  id: number;
  team_season_id: number;
  title: string;
  description?: string;
  category?: string | null;
  status: TaskStatus;
  linked_activity_id?: number | null;
  linked_activity_name?: string | null;
  created_by?: MemberBrief | null;
  claimed_by?: MemberBrief | null;
  completed_by?: MemberBrief | null;
  completed_by_team?: TeamBrief | null;
  created_at?: string;
  claimed_at?: string | null;
  completed_at?: string | null;
  team_name?: string;
  // #112 team assignment / #114 recurrence
  assigned_team?: TeamBrief | null;
  // Private, per-member task: assigned to one member, hidden from shared boards.
  is_private?: boolean;
  assigned_member?: MemberBrief | null;
  recurrence?: Recurrence;
  due_date?: string | null;
  rotation?: TeamBrief[];
  rotation_index?: number;
  progress_pct?: number | null;
  progress_updates?: TaskUpdate[];
  can_post_progress?: boolean | null;
}

export interface TaskUpdate {
  id: number;
  body: string | null;
  progress_pct: number | null;
  member_id: number | null;
  member?: MemberBrief | null;
  created_at?: string | null;
}

export interface TaskCreatePayload {
  title: string;
  description?: string;
  category?: string;
  linked_activity_id?: number;
  created_by_member_id?: number;
  // #112 assign the whole task to a team up front
  assigned_team_season_id?: number | null;
  // #114 make it recurring; rotation_team_ids rotates the responsible team
  recurrence?: Recurrence;
  due_date?: string;
  rotation_team_ids?: number[];
  // Private, per-member task: only the assigned member (and managers) see it.
  is_private?: boolean;
  assigned_member_id?: number | null;
}

export interface PlanningTeam {
  team_season_id: number;
  team_number?: number;
  team_name: string;
  program?: string | null;
}

export const planningApi = {
  // pickers
  teams: () => api.get("/api/v1/planning/teams").then((r) => r.data as PlanningTeam[]),
  teamMembers: (tsid: number) =>
    api.get(`/api/v1/planning/team/${tsid}/members`).then((r) => r.data as MemberBrief[]),

  // season plan
  getPlan: (tsid: number) =>
    api.get(`/api/v1/planning/team/${tsid}/plan`).then((r) => r.data as PlanCategory[]),
  createCategory: (tsid: number, data: { name: string; color?: string; sort_order?: number }) =>
    api.post(`/api/v1/planning/team/${tsid}/categories`, data).then((r) => r.data as PlanCategory),
  updateCategory: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/planning/categories/${id}`, data).then((r) => r.data),
  deleteCategory: (id: number) => api.delete(`/api/v1/planning/categories/${id}`).then((r) => r.data),

  createActivity: (categoryId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/planning/categories/${categoryId}/activities`, data).then((r) => r.data as PlanActivity),
  updateActivity: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/planning/activities/${id}`, data).then((r) => r.data as PlanActivity),
  deleteActivity: (id: number) => api.delete(`/api/v1/planning/activities/${id}`).then((r) => r.data),

  reschedule: (tsid: number, preview: boolean) =>
    api.post(`/api/v1/planning/team/${tsid}/reschedule${preview ? "?preview=1" : ""}`, {}).then((r) => r.data as RescheduleResult),

  deadlines: (tsid: number) =>
    api.get(`/api/v1/planning/team/${tsid}/deadlines`).then((r) => r.data as SeasonDeadline[]),

  issues: (tsid: number, status?: string) =>
    api.get(`/api/v1/planning/team/${tsid}/issues`, { params: status ? { status } : {} }).then((r) => r.data as TeamIssue[]),
  getIssue: (id: number) => api.get(`/api/v1/planning/issues/${id}`).then((r) => r.data as TeamIssue),
  createIssue: (tsid: number, data: Record<string, unknown>) => api.post(`/api/v1/planning/team/${tsid}/issues`, data).then((r) => r.data as TeamIssue),
  updateIssue: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/planning/issues/${id}`, data).then((r) => r.data as TeamIssue),
  deleteIssue: (id: number) => api.delete(`/api/v1/planning/issues/${id}`).then((r) => r.data),
  addIssueComment: (id: number, body: string) => api.post(`/api/v1/planning/issues/${id}/comments`, { body }).then((r) => r.data as TeamIssue),

  teamRoles: (tsid: number) => api.get(`/api/v1/planning/team/${tsid}/roles`).then((r) => r.data as TeamRole[]),
  createTeamRole: (tsid: number, data: { name: string; member_ids?: number[] }) => api.post(`/api/v1/planning/team/${tsid}/roles`, data).then((r) => r.data as TeamRole[]),
  updateTeamRole: (id: number, data: { name?: string; member_ids?: number[]; sort_order?: number }) => api.patch(`/api/v1/planning/roles/${id}`, data).then((r) => r.data as TeamRole[]),
  deleteTeamRole: (id: number) => api.delete(`/api/v1/planning/roles/${id}`).then((r) => r.data),
  reorderTeamRoles: (tsid: number, orderedIds: number[]) =>
    api.post(`/api/v1/planning/team/${tsid}/roles/reorder`, { ordered_ids: orderedIds }).then((r) => r.data as TeamRole[]),
  createDeadline: (tsid: number, data: { name?: string; deadline_date?: string; event_id?: number | null; notes?: string }) =>
    api.post(`/api/v1/planning/team/${tsid}/deadlines`, data).then((r) => r.data as SeasonDeadline[]),
  deleteDeadline: (id: number) =>
    api.delete(`/api/v1/planning/deadlines/${id}`).then((r) => r.data),

  // team tasks
  listTasks: (tsid: number, includeDone = false) =>
    api.get(`/api/v1/planning/team/${tsid}/tasks`, { params: { include_done: includeDone } })
      .then((r) => r.data as TeamTask[]),
  createTask: (tsid: number, data: TaskCreatePayload) =>
    api.post(`/api/v1/planning/team/${tsid}/tasks`, data).then((r) => r.data as TeamTask),

  // Global task categories (managed in Admin → Configurable Options).
  // key = "task_categories" (team) or "trc_task_categories" (TRC general).
  categories: (key = "task_categories") =>
    api.get(`/api/v1/config/${key}`).then((r) => (r.data?.values ?? []) as string[]),

  // General TRC (non-team) tasks
  trcMembers: () =>
    api.get("/api/v1/planning/trc/members").then((r) => r.data as MemberBrief[]),
  listTrcTasks: (includeDone = false) =>
    api.get("/api/v1/planning/trc/tasks", { params: { include_done: includeDone } })
      .then((r) => r.data as TeamTask[]),
  createTrcTask: (data: TaskCreatePayload) =>
    api.post("/api/v1/planning/trc/tasks", data).then((r) => r.data as TeamTask),
  // Private, per-member tasks
  myTasks: (includeDone = false) =>
    api.get("/api/v1/planning/my-tasks", { params: { include_done: includeDone } }).then((r) => r.data as TeamTask[]),
  privateTasks: (includeDone = false) =>
    api.get("/api/v1/planning/private-tasks", { params: { include_done: includeDone } }).then((r) => r.data as TeamTask[]),
  editTask: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/planning/tasks/${id}`, data).then((r) => r.data as TeamTask),
  // #112 — a whole team picks up a task (pass null to clear).
  assignTeamTask: (id: number, teamSeasonId: number | null) =>
    api.post(`/api/v1/planning/tasks/${id}/assign-team`, { team_season_id: teamSeasonId }).then((r) => r.data as TeamTask),
  claimTask: (id: number, memberId: number) =>
    api.post(`/api/v1/planning/tasks/${id}/claim`, { member_id: memberId }).then((r) => r.data as TeamTask),
  completeTask: (id: number, by?: { memberId?: number; teamSeasonId?: number }) =>
    api.post(`/api/v1/planning/tasks/${id}/complete`,
      by?.teamSeasonId ? { team_season_id: by.teamSeasonId } : by?.memberId ? { member_id: by.memberId } : {},
    ).then((r) => r.data as TeamTask),
  reopenTask: (id: number) => api.post(`/api/v1/planning/tasks/${id}/reopen`).then((r) => r.data as TeamTask),
  addProgress: (id: number, data: { body?: string; progress_pct?: number | null }) =>
    api.post(`/api/v1/planning/tasks/${id}/progress`, data).then((r) => r.data as TeamTask),
  deleteProgress: (updateId: number) =>
    api.delete(`/api/v1/planning/tasks/progress/${updateId}`).then((r) => r.data as TeamTask),
  deleteTask: (id: number) => api.delete(`/api/v1/planning/tasks/${id}`).then((r) => r.data),

  // home/profile pane
  myAssignments: (memberId: number) =>
    api.get(`/api/v1/planning/member/${memberId}/assignments`)
      .then((r) => r.data as { activities: PlanActivity[]; tasks: TeamTask[]; action_items: MeetingActionItem[] }),
};

export interface MeetingActionItem {
  id: number;
  meeting_id: number;
  meeting_title: string;
  group_label: string;
  description: string;
  due_date: string | null;
  status: string;
}

export const STATUS_META: Record<ActivityStatus, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#90a4ae" },
  in_progress: { label: "In Progress", color: "#1565c0" },
  blocked: { label: "Blocked", color: "#e65100" },
  done: { label: "Done", color: "#2e7d32" },
};
