import { api } from "../../core/api";

export interface EmailSettings {
  host: string;
  port: string;
  user: string;
  encryption: string;
  from: string;
  purchasing_email: string;
  visitor_email: string;
  /** Where the self-service join-link signup record goes; blank falls back to visitor_email. */
  signup_email: string;
  reservation_email: string;
  resource_email: string;
  payment_email: string;
  /** Where the nightly auto-checkout report goes; blank falls back to info@. */
  checkout_email: string;
  /** Where "new volunteer sign-up" notices go; blank falls back to info@. */
  volunteer_email: string;
  /** Where "new scholarship application" notices go; blank falls back to the org info box. */
  scholarship_email: string;
  /** Always-CC address for Communications sends (#172) + whether it's enabled ("1"/""). */
  cc_address?: string;
  cc_enabled?: string;
  has_password: boolean;
  password_source: string;
  source: Record<string, string>;
  configured: boolean;
}

export interface GithubSettings {
  owner: string;
  repo: string;
  project_number: string;
  has_token: boolean;
  configured: boolean;
}

export const adminApi = {
  getStats: () =>
    api.get("/api/v1/admin/stats").then(r => r.data as SystemStats),

  // Email (SMTP) settings
  getEmailSettings: () =>
    api.get("/api/v1/admin/email-settings").then(r => r.data as EmailSettings),
  saveEmailSettings: (data: Record<string, unknown>) =>
    api.put("/api/v1/admin/email-settings", data).then(r => r.data as EmailSettings),
  testEmail: (to: string) =>
    api.post("/api/v1/admin/email-settings/test", { to }).then(r => r.data as { ok: boolean; to: string; error: string | null }),

  // GitHub integration settings
  getGithubSettings: () =>
    api.get("/api/v1/admin/github-settings").then(r => r.data as GithubSettings),
  saveGithubSettings: (data: Record<string, unknown>) =>
    api.put("/api/v1/admin/github-settings", data).then(r => r.data as GithubSettings),
  testGithub: () =>
    api.post("/api/v1/admin/github-settings/test").then(r => r.data as { ok: boolean; message: string }),

  // Roles
  listRoles: () =>
    api.get("/api/v1/admin/roles").then(r => r.data as SystemRole[]),
  createRole: (data: { name: string; description?: string }) =>
    api.post("/api/v1/admin/roles", data).then(r => r.data as SystemRole),
  updateRole: (id: number, data: { name: string; display_name?: string; description?: string }) =>
    api.patch(`/api/v1/admin/roles/${id}`, data).then(r => r.data),
  toggleRole: (id: number) =>
    api.patch(`/api/v1/admin/roles/${id}/toggle`).then(r => r.data),
  deleteRole: (id: number) =>
    api.delete(`/api/v1/admin/roles/${id}`).then(r => r.data as { ok: boolean; members_unassigned: number }),

  // Role permissions
  getPermissionCatalog: () =>
    api.get("/api/v1/admin/permission-catalog").then(r => r.data as PermissionCatalog),
  getRolePermissions: (roleId: number) =>
    api.get(`/api/v1/admin/roles/${roleId}/permissions`).then(r => r.data as { role_id: number; role_name: string; permissions: Record<string, PermLevel> }),
  setRolePermissions: (roleId: number, permissions: Record<string, PermLevel>) =>
    api.put(`/api/v1/admin/roles/${roleId}/permissions`, { permissions }).then(r => r.data),

  // Member roles
  getMemberRoles: (memberId: number) =>
    api.get(`/api/v1/admin/members/${memberId}/roles`).then(r => r.data as MemberRolesDetail),
  getRoleMembers: (roleId: number) =>
    api.get(`/api/v1/admin/roles/${roleId}/members`).then(r => r.data as RoleMembersDetail),
  assignRole: (memberId: number, roleId: number) =>
    api.post("/api/v1/admin/members/assign-role", { member_id: memberId, role_id: roleId }).then(r => r.data),
  removeRole: (memberId: number, roleId: number) =>
    api.delete(`/api/v1/admin/members/${memberId}/roles/${roleId}`).then(r => r.data),

  // Password reset
  resetPassword: (memberId: number, newPassword: string) =>
    api.post(`/api/v1/admin/members/${memberId}/reset-password`, { new_password: newPassword }).then(r => r.data),

  // Member profile layout (pane placement)
  getProfileLayout: () =>
    api.get("/api/v1/admin/profile-layout").then(r => r.data as {
      panes: { key: string; label: string }[];
      zones: { key: string; label: string }[];
      placement: Record<string, string>;
    }),
  setProfileLayout: (placement: Record<string, string>) =>
    api.put("/api/v1/admin/profile-layout", { placement }).then(r => r.data as { ok: boolean; placement: Record<string, string> }),

  // Team profile pane tabs (which tab each team pane appears in)
  getTeamPaneLayout: () =>
    api.get("/api/v1/admin/team-pane-layout").then(r => r.data as {
      panes: { key: string; label: string }[];
      tabs: { key: string; label: string }[];
      placement: Record<string, string>;
    }),
  setTeamPaneLayout: (placement: Record<string, string>) =>
    api.put("/api/v1/admin/team-pane-layout", { placement }).then(r => r.data as { ok: boolean; placement: Record<string, string> }),

  // Station / kiosk accounts
  listStations: () =>
    api.get("/api/v1/admin/stations").then(r => r.data as {
      role_types: Record<string, Record<string, string>>;
      stations: { id: number; name: string; username: string; is_active: boolean; station_role: string | null }[];
    }),
  createStation: (data: { name: string; username: string; password: string; station_role: string }) =>
    api.post("/api/v1/admin/stations", data).then(r => r.data),
  setStationPassword: (id: number, password: string) =>
    api.post(`/api/v1/admin/stations/${id}/password`, { password }).then(r => r.data),
  setStationActive: (id: number, isActive: boolean) =>
    api.patch(`/api/v1/admin/stations/${id}?is_active=${isActive}`).then(r => r.data),
  deleteStation: (id: number) =>
    api.delete(`/api/v1/admin/stations/${id}`).then(r => r.data),

  // Impersonation
  impersonate: (roleName: string) =>
    api.post("/api/v1/admin/impersonate", { role_name: roleName }).then(r => r.data as { access_token: string; impersonating: string }),

  // Programs
  listPrograms: () =>
    api.get("/api/v1/admin/programs").then(r => r.data as ProgramAdmin[]),
  createProgram: (data: Record<string, unknown>) =>
    api.post("/api/v1/admin/programs", data).then(r => r.data),
  updateProgram: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/admin/programs/${id}`, data).then(r => r.data),

  // Audit log
  getAuditLog: (params?: { table_name?: string; actor_id?: number; action?: string; from_date?: string; to_date?: string; skip?: number; limit?: number }) =>
    api.get("/api/v1/admin/audit-log", { params }).then(r => r.data as { total: number; logs: AuditEntry[]; actions: string[] }),
};

export interface SystemStats {
  enrollment_year: number;
  members: { youth: number; mentor: number; parent: number; volunteer: number; total: number };
  enrollments: { active: number; unpaid: number; unsigned_tc: number };
  visitors: { new: number };
  checkins_today: number;
  active_teams: number;
}

export interface SystemRole {
  id: number;
  name: string;
  display_name?: string;
  is_protected?: boolean;
  description?: string;
  is_active: boolean;
  member_count: number;
}

export interface MemberRolesDetail {
  member_id: number;
  member_number: string;
  first_name: string;
  last_name: string;
  member_type: string;
  roles: { id: number; name: string; display_name?: string; is_active: boolean }[];
}

export interface RoleMemberRecord {
  id: number;
  first_name: string;
  last_name: string;
  member_number: string;
  member_type: string;
  photo_url?: string;
  is_active: boolean;
}

export interface RoleMembersDetail {
  role_id: number;
  role_name: string;
  members: RoleMemberRecord[];
}

export interface ProgramAdmin {
  id: number;
  name: string;
  full_name?: string;
  affiliation?: string;
  age_range?: string;
  status: string;
  description?: string;
  display_order: number;
  quick_attendance?: boolean;
  team_count: number;
  active_enrollment_count: number;
}

export type PermLevel = "write" | "read" | "none";

export interface PermissionItem { key: string; label: string; }
export interface PermissionModule { id: string; label: string; items: PermissionItem[]; }
export interface PermissionCatalog { levels: PermLevel[]; modules: PermissionModule[]; }

export interface AuditEntry {
  id: number;
  actor_id?: number;
  actor_name?: string;
  impersonating_role?: string;
  table_name: string;
  record_id?: number;
  action: string;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}
