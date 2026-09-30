/**
 * SystemRolesPanel — admin-only panel on the member profile to view, add, and
 * remove a member's system (RBAC) roles directly from their profile.
 */
import { useState, useEffect, useCallback } from "react";
import { adminApi, type SystemRole } from "../../admin/api";
import { useAuth } from "../../../core/AuthContext";
import { Shield, Plus, X } from "lucide-react";

export default function SystemRolesPanel({ memberId }: { memberId: number }) {
  const { canWrite, user } = useAuth();
  const canEdit = canWrite("members.system_permissions");
  // Only a System Administrator may hand out (or take away) the System Administrator
  // role — so a non-sysadmin never even sees it as an option, and can't remove it.
  const isSysAdmin = user?.roles?.includes("System Administrator") ?? false;
  const protectedRole = (name?: string) => name === "System Administrator" && !isSysAdmin;
  const [roles, setRoles] = useState<{ id: number; name: string; display_name?: string; is_active: boolean }[]>([]);
  const [allRoles, setAllRoles] = useState<SystemRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await adminApi.getMemberRoles(memberId);
      setRoles(data.roles);
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    load();
    adminApi.listRoles().then((r) => setAllRoles(r.filter((x) => x.is_active))).catch(() => {});
  }, [load]);

  async function add() {
    if (!selectedRole) return;
    setBusy(true); setError("");
    try {
      await adminApi.assignRole(memberId, parseInt(selectedRole));
      setSelectedRole(""); setAdding(false);
      load();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to add role.");
    } finally { setBusy(false); }
  }

  async function remove(roleId: number) {
    if (!confirm("Remove this role from the member?")) return;
    setBusy(true);
    try {
      await adminApi.removeRole(memberId, roleId);
      load();
    } finally { setBusy(false); }
  }

  // Roles the member doesn't already have
  const assignedIds = new Set(roles.map((r) => r.id));
  const available = allRoles.filter((r) => !assignedIds.has(r.id) && !protectedRole(r.name));

  if (loading) return <p style={st.muted}>Loading roles…</p>;

  return (
    <div>
      {roles.length === 0 ? (
        <p style={st.muted}>No system roles assigned.</p>
      ) : (
        <div style={st.list}>
          {roles.map((r) => (
            <div key={r.id} style={st.row}>
              <Shield size={14} color={r.is_active ? "#1a3a5c" : "#ccc"} />
              <span style={{ flex: 1, fontSize: 13, color: r.is_active ? "#1a3a5c" : "#aaa", fontWeight: 600 }}>
                {r.display_name || r.name}{!r.is_active && <span style={st.inactive}>inactive</span>}
              </span>
              {canEdit && !protectedRole(r.name) && (
                <button style={st.removeBtn} onClick={() => remove(r.id)} disabled={busy} title="Remove role">
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (adding ? (
        <div style={st.addRow}>
          <select style={st.select} value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} autoFocus>
            <option value="">Select a role…</option>
            {available.map((r) => <option key={r.id} value={r.id}>{r.display_name || r.name}</option>)}
          </select>
          <button style={st.addBtn} onClick={add} disabled={!selectedRole || busy}>{busy ? "…" : "Add"}</button>
          <button style={st.cancelBtn} onClick={() => { setAdding(false); setSelectedRole(""); setError(""); }}>Cancel</button>
        </div>
      ) : (
        available.length > 0 && (
          <button style={st.addTrigger} onClick={() => setAdding(true)}>
            <Plus size={13} /> Assign Role
          </button>
        )
      ))}
      {error && <p style={st.error}>{error}</p>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: "0 0 10px" },
  list: { display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 7 },
  inactive: { fontSize: 9, color: "#aaa", background: "#f0f0f0", padding: "1px 6px", borderRadius: 5, marginLeft: 8, textTransform: "uppercase" as const },
  removeBtn: { background: "none", border: "none", cursor: "pointer", color: "#c62828", display: "flex", padding: 2 },
  addRow: { display: "flex", gap: 6, alignItems: "center" },
  select: { flex: 1, padding: "7px 9px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  addBtn: { padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancelBtn: { padding: "7px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  addTrigger: { display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  error: { fontSize: 12, color: "#c62828", margin: "8px 0 0" },
};
