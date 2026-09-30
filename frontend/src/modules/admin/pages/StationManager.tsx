import { useState, useEffect } from "react";
import { adminApi } from "../api";
import { Monitor, Plus, Key, Power, Trash2, ShieldCheck } from "lucide-react";

type Station = { id: number; name: string; username: string; is_active: boolean; station_role: string | null };

export default function StationManager() {
  const [roleTypes, setRoleTypes] = useState<Record<string, Record<string, string>>>({});
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState("");

  // new-station form
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await adminApi.listStations();
      setRoleTypes(d.role_types);
      setStations(d.stations);
      if (!role) setRole(Object.keys(d.role_types)[0] ?? "");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setErr("");
    if (!name.trim() || !username.trim() || !password.trim() || !role) {
      setErr("All fields are required."); return;
    }
    setSaving(true);
    try {
      await adminApi.createStation({ name: name.trim(), username: username.trim(), password, station_role: role });
      setShowNew(false); setName(""); setUsername(""); setPassword("");
      await load();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create station.");
    } finally {
      setSaving(false);
    }
  }

  async function resetPw(s: Station) {
    const pw = window.prompt(`New password for station "${s.name}" (${s.username}):`);
    if (!pw) return;
    await adminApi.setStationPassword(s.id, pw);
    alert("Password updated.");
  }

  async function toggleActive(s: Station) {
    await adminApi.setStationActive(s.id, !s.is_active);
    await load();
  }

  async function remove(s: Station) {
    if (!window.confirm(`Permanently delete station "${s.name}" (${s.username})? This cannot be undone.`)) return;
    await adminApi.deleteStation(s.id);
    await load();
  }

  return (
    <div>
      <div style={st.header}>
        <div>
          <h1 style={st.h1}><Monitor size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />Station Accounts</h1>
          <p style={st.sub}>
            Always-on, locked-down logins for unattended stations (parts room, event check-in, visitor registration).
            They never appear in the directory, reports, or member counts, and bypass enrollment and Terms &amp; Conditions.
          </p>
        </div>
        <button style={st.newBtn} onClick={() => setShowNew((v) => !v)}>
          <Plus size={15} /> New Station
        </button>
      </div>

      {showNew && (
        <div style={st.form}>
          <div style={st.formGrid}>
            <label style={st.field}>
              <span style={st.label}>Station Name</span>
              <input style={st.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Parts Room Desk" />
            </label>
            <label style={st.field}>
              <span style={st.label}>Login Username</span>
              <input style={st.input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. parts_station" />
            </label>
            <label style={st.field}>
              <span style={st.label}>Password</span>
              <input style={st.input} type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password" />
            </label>
            <label style={st.field}>
              <span style={st.label}>Station Type</span>
              <select style={st.input} value={role} onChange={(e) => setRole(e.target.value)}>
                {Object.keys(roleTypes).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          {role && (
            <div style={st.permsBox}>
              <ShieldCheck size={13} style={{ verticalAlign: "-2px", marginRight: 4, color: "#2e7d32" }} />
              <strong>{role}</strong> can:{" "}
              {Object.keys(roleTypes[role] ?? {}).length === 0
                ? <em>nothing yet — grant permissions in Role Management.</em>
                : Object.entries(roleTypes[role]).map(([k, v]) => `${k} (${v})`).join(", ")}
            </div>
          )}
          {err && <div style={st.err}>{err}</div>}
          <div style={st.formActions}>
            <button style={st.cancelBtn} onClick={() => { setShowNew(false); setErr(""); }}>Cancel</button>
            <button style={st.saveBtn} onClick={create} disabled={saving}>{saving ? "Creating…" : "Create Station"}</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: "#888" }}>Loading…</p> : (
        <table style={st.table}>
          <thead>
            <tr>
              <th style={st.th}>Name</th>
              <th style={st.th}>Username</th>
              <th style={st.th}>Type</th>
              <th style={st.th}>Status</th>
              <th style={st.th}></th>
            </tr>
          </thead>
          <tbody>
            {stations.length === 0 && (
              <tr><td colSpan={5} style={{ ...st.td, color: "#888", textAlign: "center", padding: 24 }}>No station accounts yet.</td></tr>
            )}
            {stations.map((s) => (
              <tr key={s.id}>
                <td style={st.td}>{s.name}</td>
                <td style={st.td}><code>{s.username}</code></td>
                <td style={st.td}>{s.station_role ?? <em style={{ color: "#aaa" }}>none</em>}</td>
                <td style={st.td}>
                  <span style={{ ...st.badge, background: s.is_active ? "#e8f5e9" : "#ffebee", color: s.is_active ? "#2e7d32" : "#c62828" }}>
                    {s.is_active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td style={{ ...st.td, textAlign: "right", whiteSpace: "nowrap" }}>
                  <button style={st.iconBtn} title="Reset password" onClick={() => resetPw(s)}><Key size={15} /></button>
                  <button style={st.iconBtn} title={s.is_active ? "Disable" : "Enable"} onClick={() => toggleActive(s)}><Power size={15} /></button>
                  <button style={{ ...st.iconBtn, color: "#c62828" }} title="Delete" onClick={() => remove(s)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 },
  h1: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#777", maxWidth: 680, lineHeight: 1.6 },
  newBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  form: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", marginBottom: 18 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  input: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  permsBox: { marginTop: 12, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, color: "#555", lineHeight: 1.5 },
  err: { marginTop: 12, background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "8px 12px", color: "#c62828", fontSize: 13 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 },
  cancelBtn: { padding: "9px 16px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  saveBtn: { padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  th: { textAlign: "left", padding: "11px 14px", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid #e2e8f0", background: "#f8fafc" },
  td: { padding: "11px 14px", fontSize: 14, color: "#333", borderBottom: "1px solid #f0f3f7" },
  badge: { padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#1a3a5c", padding: 6, borderRadius: 6 },
};
