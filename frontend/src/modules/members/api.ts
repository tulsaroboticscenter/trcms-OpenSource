import { api } from "../../core/api";

export interface ChildSummary {
  id: number;
  first_name: string;
  last_name: string;
  member_number: string;
  photo_url?: string | null;
  member_type: string;
}

export const membersApi = {
  list: (params?: Record<string, string>) =>
    api.get("/api/v1/members/", { params }).then((r) => r.data),

  get: (id: number) =>
    api.get(`/api/v1/members/${id}`).then((r) => r.data),

  myChildren: () =>
    api.get("/api/v1/members/me/children").then((r) => r.data as ChildSummary[]),

  create: (data: Record<string, unknown>) =>
    api.post("/api/v1/members/", data).then((r) => r.data),

  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/members/${id}`, data).then((r) => r.data),

  deactivate: (id: number) =>
    api.patch(`/api/v1/members/${id}/deactivate`).then((r) => r.data),

  mergePreview: (duplicateId: number, targetId: number) =>
    api.get("/api/v1/admin/members/merge-preview", { params: { duplicate_id: duplicateId, target_id: targetId } }).then((r) => r.data as MergePreview),
  mergeExecute: (duplicateId: number, targetId: number, contact: Record<string, "duplicate" | "target">) =>
    api.post("/api/v1/admin/members/merge", { duplicate_id: duplicateId, target_id: targetId, contact }).then((r) => r.data),

  convertType: (id: number, memberType: string) =>
    api.patch(`/api/v1/members/${id}/convert-type`, { member_type: memberType }).then((r) => r.data),

  promoteToMentor: (id: number) =>
    api.patch(`/api/v1/members/${id}/promote-to-mentor`).then((r) => r.data),

  archive: (id: number) =>
    api.patch(`/api/v1/members/${id}/archive`).then((r) => r.data),

  unarchive: (id: number) =>
    api.patch(`/api/v1/members/${id}/unarchive`).then((r) => r.data),

  setActive: (id: number, isActive: boolean) =>
    api.patch(`/api/v1/members/${id}/active`, { is_active: isActive }).then((r) => r.data as { is_active: boolean }),

  import: (csv: string, mode: "preview" | "commit", onDuplicate: "skip" | "overwrite") =>
    api.post("/api/v1/members/import", { csv, mode, on_duplicate: onDuplicate }).then((r) => r.data as ImportReport),
};

export type ImportAction =
  | "would_create" | "would_update" | "would_skip"
  | "created" | "updated" | "skipped" | "error";

export interface ImportRowResult {
  row: number;
  name: string;
  member_type: string | null;
  action: ImportAction;
  matched_id: number | null;
  member_number: string | null;
  username: string | null;
  temp_password: string | null;
  messages: string[];
}

export interface ImportReport {
  mode: "preview" | "commit";
  on_duplicate: "skip" | "overwrite";
  total_rows: number;
  counts: { created: number; updated: number; skipped: number; errors: number; duplicates: number; blank?: number };
  mapped_columns: Record<string, string>;
  unmapped_columns: string[];
  results: ImportRowResult[];
}

export interface MergeBrief {
  id: number; name: string; member_number: string | null; member_type: string | null;
  username: string | null; email: string | null; is_active: boolean;
}
export interface MergePreview {
  duplicate: MergeBrief;
  target: MergeBrief;
  record_counts: { table: string; column: string; count: number }[];
  total_records: number;
  contact_fields: { field: string; duplicate: string | null; target: string | null }[];
}
