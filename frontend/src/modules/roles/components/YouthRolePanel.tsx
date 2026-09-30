/**
 * YouthRolePanel — embedded in MemberProfile for youth members.
 * Shows the member's full YLC service history (one record per term) and lets
 * admins/mentors add records — including backfilling past seasons — or remove
 * records to correct historical data.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../../../core/AuthContext";
import { rolesApi, type YouthRoleRecord } from "../api";
import { Star, Plus, Trash2 } from "lucide-react";

// Offer a generous range of terms (past + near future) for backfilling.
const TERM_OPTIONS = (() => {
  const y = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => {
    const start = y + 1 - i;   // current+1 down to ~10 years back
    return `${start}-${start + 1}`;
  });
})();

interface Props { memberId: number; }

export default function YouthRolePanel({ memberId }: Props) {
  const { isAdmin, hasRole } = useAuth();
  const canEdit = isAdmin || hasRole("Admin", "System Administrator", "Mentor");
  const canDelete = isAdmin || hasRole("Admin", "System Administrator");

  const [role, setRole] = useState<YouthRoleRecord | null>(null);
  const [ylcRoles, setYlcRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Add-record form
  const [newTerm, setNewTerm] = useState("");
  const [newRole, setNewRole] = useState("");

  function load() {
    Promise.all([rolesApi.getYouthRole(memberId), rolesApi.getYLCRoles()])
      .then(([r, roles]) => { setRole(r); setYlcRoles(roles); })
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [memberId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addRecord() {
    setSaving(true); setError("");
    try {
      const updated = await rolesApi.addYLCTerm(memberId, {
        term: newTerm || undefined,
        role: newRole || "At Large",
      });
      setRole(updated);
      setAdding(false); setNewTerm(""); setNewRole("");
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRecord(id: number) {
    if (!confirm("Remove this YLC service record?")) return;
    await rolesApi.deleteYLCTerm(id);
    load();
  }

  if (loading) return <p style={st.muted}>Loading…</p>;

  const history = role?.ylc_history ?? [];

  return (
    <div>
      {history.length === 0 ? (
        <p style={st.muted}>Not a YLC member.</p>
      ) : (
        <>
          <div style={st.badge}><Star size={14} color="#f57c00" /> YLC Member</div>
          <div style={st.list}>
            {history.map((h) => (
              <div key={h.id} style={st.row}>
                <span style={st.roleName}>{h.role}</span>
                <span style={st.term}>{h.term ?? "Unspecified term"}</span>
                {canDelete && (
                  <button style={st.del} title="Remove record" onClick={() => removeRecord(h.id)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {canEdit && (adding ? (
        <div style={st.form}>
          <div style={st.grid2}>
            <div>
              <label style={st.label}>Term / Season</label>
              <select style={st.input} value={newTerm} onChange={(e) => setNewTerm(e.target.value)} autoFocus>
                <option value="">Select term…</option>
                {TERM_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={st.label}>YLC Role</label>
              <select style={st.input} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                <option value="">At Large (no specific role)</option>
                {ylcRoles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {error && <p style={st.error}>{error}</p>}
          <div style={st.actions}>
            <button style={st.cancelBtn} onClick={() => { setAdding(false); setError(""); }}>Cancel</button>
            <button style={st.saveBtn} onClick={addRecord} disabled={saving}>{saving ? "Saving…" : "Add Record"}</button>
          </div>
        </div>
      ) : (
        <button style={st.addBtn} onClick={() => setAdding(true)}>
          <Plus size={13} /> {history.length ? "Add Season Record" : "Add to YLC"}
        </button>
      ))}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  badge: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#f57c00", marginBottom: 8 },
  list: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 8 },
  roleName: { fontWeight: 700, fontSize: 14, color: "#1a3a5c", flex: 1 },
  term: { fontSize: 12, color: "#666", background: "#fff", padding: "2px 8px", borderRadius: 6, border: "1px solid #ffe0a3" },
  del: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 2 },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginTop: 6 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" },
  label: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "7px 9px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, boxSizing: "border-box" },
  error: { fontSize: 12, color: "#c62828", margin: "8px 0 0" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  cancelBtn: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "6px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, padding: "6px 14px", fontSize: 12, border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer" },
};
