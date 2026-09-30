/**
 * SecuritySettings — admin control of account lockout + geo-restriction,
 * and a viewer for recent login attempts (with IP / country / reason).
 */
import { useState, useEffect } from "react";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Shield, Save, RefreshCw, CheckCircle, XCircle, Search, X } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface Settings {
  lockout_enabled: boolean;
  lockout_threshold: number;
  lockout_window_minutes: number;
  lockout_duration_minutes: number;
  geo_block_enabled: boolean;
  allowed_countries: string[];
  two_factor_enabled?: boolean;
}
interface Attempt {
  id: number; username: string; member_id?: number; ip_address?: string;
  country?: string; success: boolean; reason?: string; created_at?: string;
}

export default function SecuritySettings() {
  const goBack = useGoBack("/admin");
  const { hasRole } = useAuth();
  const canEdit = hasRole("System Administrator");
  const [s, setS] = useState<Settings | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [failedOnly, setFailedOnly] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Filter the login log to a single member's whole history.
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: number; first_name: string; last_name: string; username?: string }[]>([]);
  const [selectedMember, setSelectedMember] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => { load(); loadAttempts(); }, []);
  useEffect(() => { loadAttempts(); /* eslint-disable-next-line */ }, [failedOnly, selectedMember]);

  // Member search (debounced) for the login-log filter.
  useEffect(() => {
    if (selectedMember || memberSearch.trim().length < 2) { setMemberResults([]); return; }
    const t = setTimeout(() => {
      api.get(`/api/v1/members/?search=${encodeURIComponent(memberSearch.trim())}&limit=8`)
        .then((r) => setMemberResults(r.data.members ?? []))
        .catch(() => setMemberResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [memberSearch, selectedMember]);

  function load() { api.get("/api/v1/admin/security-settings").then((r) => setS(r.data)); }
  function loadAttempts() {
    // With a member selected, pull their entire history (success + failure); otherwise the
    // recent list honoring the "Failed only" toggle.
    const qs = selectedMember
      ? `member_id=${selectedMember.id}&failed_only=false&limit=5000`
      : `failed_only=${failedOnly}&limit=100`;
    api.get(`/api/v1/admin/login-attempts?${qs}`).then((r) => setAttempts(r.data));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await api.put("/api/v1/admin/security-settings", s);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  function set<K extends keyof Settings>(k: K, v: Settings[K]) { setS((p) => p ? { ...p, [k]: v } : p); }

  if (!s) return <p style={st.muted}>Loading…</p>;

  return (
    <div>
      <div style={st.header}>
        <button onClick={goBack} style={st.back}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={st.heading}><Shield size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Security</h1>
        <p style={st.sub}>Account lockout, geo-restriction, and login monitoring.</p>
      </div>

      {/* Lockout */}
      <div style={st.card}>
        <div style={st.cardTitle}>Account Lockout</div>
        <label style={st.checkRow}>
          <input type="checkbox" checked={s.lockout_enabled} disabled={!canEdit}
            onChange={(e) => set("lockout_enabled", e.target.checked)} />
          Lock accounts after repeated failed login attempts
        </label>
        <div style={st.grid}>
          <Field label="Failed attempts before lockout">
            <input type="number" min={1} style={st.input} value={s.lockout_threshold} disabled={!canEdit}
              onChange={(e) => set("lockout_threshold", parseInt(e.target.value) || 1)} />
          </Field>
          <Field label="Count window (minutes)">
            <input type="number" min={1} style={st.input} value={s.lockout_window_minutes} disabled={!canEdit}
              onChange={(e) => set("lockout_window_minutes", parseInt(e.target.value) || 1)} />
          </Field>
          <Field label="Lockout duration (minutes)">
            <input type="number" min={1} style={st.input} value={s.lockout_duration_minutes} disabled={!canEdit}
              onChange={(e) => set("lockout_duration_minutes", parseInt(e.target.value) || 1)} />
          </Field>
        </div>
      </div>

      {/* Two-factor */}
      <div style={st.card}>
        <div style={st.cardTitle}>Two-Factor Authentication</div>
        <label style={st.checkRow}>
          <input type="checkbox" checked={!!s.two_factor_enabled} disabled={!canEdit}
            onChange={(e) => set("two_factor_enabled", e.target.checked)} />
          Allow members to protect their account with an authenticator app (TOTP)
        </label>
        <p style={st.note}>When on, members can turn on two-factor from their own profile, and anyone who has enabled it is prompted for a 6-digit code at sign-in. Turning this off org-wide stops 2FA prompts at login. To clear a locked-out member's 2FA, use “Reset 2FA” on their profile.</p>
      </div>

      {/* Geo */}
      <div style={st.card}>
        <div style={st.cardTitle}>Geo-Restriction</div>
        <label style={st.checkRow}>
          <input type="checkbox" checked={s.geo_block_enabled} disabled={!canEdit}
            onChange={(e) => set("geo_block_enabled", e.target.checked)} />
          Block logins from outside the allowed countries
        </label>
        <Field label="Allowed countries (ISO codes, comma-separated)">
          <input style={st.input} value={s.allowed_countries.join(", ")} disabled={!canEdit}
            onChange={(e) => set("allowed_countries", e.target.value.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean))} />
        </Field>
        <p style={st.note}>
          Requires a GeoIP database (MaxMind GeoLite2). Set <code>GEOIP_DB_PATH</code> on the server and install
          <code> geoip2</code>. Until then, geo-blocking fails open (no one is blocked on unknown location).
        </p>
      </div>

      {canEdit && (
        <div style={st.actions}>
          {saved && <span style={st.savedMsg}><CheckCircle size={14} /> Saved</span>}
          <button style={st.saveBtn} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save Settings"}</button>
        </div>
      )}
      {!canEdit && <p style={st.note}>Only a System Administrator can change these settings.</p>}

      {/* Login attempts */}
      <div style={st.card}>
        <div style={st.logHead}>
          <span style={st.cardTitle}>{selectedMember ? `Login History — ${selectedMember.name}` : "Recent Login Attempts"}</span>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {!selectedMember && <label style={st.checkInline}><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed only</label>}
            <button style={st.refreshBtn} onClick={loadAttempts}><RefreshCw size={13} /></button>
          </div>
        </div>

        {/* Filter by member — pull one user's whole login history (success + failure). */}
        <div style={st.memberFilter}>
          {selectedMember ? (
            <span style={st.memberChip}>
              Showing all attempts for <strong>{selectedMember.name}</strong>
              <button style={st.chipX} onClick={() => { setSelectedMember(null); setMemberSearch(""); }} title="Clear filter"><X size={13} /></button>
            </span>
          ) : (
            <div style={{ position: "relative", maxWidth: 340 }}>
              <div style={st.searchBox}>
                <Search size={14} color="#889" />
                <input style={st.searchIn} placeholder="Filter by member…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
              </div>
              {memberResults.length > 0 && (
                <div style={st.searchDrop}>
                  {memberResults.map((m) => (
                    <button key={m.id} style={st.searchOpt}
                      onClick={() => { setSelectedMember({ id: m.id, name: `${m.first_name} ${m.last_name}`.trim() }); setMemberResults([]); setMemberSearch(""); }}>
                      {m.first_name} {m.last_name}{m.username ? <span style={st.searchOptSub}> · {m.username}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead><tr>
              <th style={st.th}>When</th><th style={st.th}>Username</th><th style={st.th}>IP</th>
              <th style={st.th}>Country</th><th style={st.th}>Result</th><th style={st.th}>Reason</th>
            </tr></thead>
            <tbody>
              {attempts.length === 0 ? (
                <tr><td style={st.td} colSpan={6}><span style={st.muted}>No attempts recorded.</span></td></tr>
              ) : attempts.map((a) => (
                <tr key={a.id}>
                  <td style={st.td}>{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</td>
                  <td style={st.td}>{a.username || "—"}</td>
                  <td style={st.tdMono}>{a.ip_address || "—"}</td>
                  <td style={st.td}>{a.country || "—"}</td>
                  <td style={st.td}>{a.success
                    ? <span style={st.ok}><CheckCircle size={12} /> Success</span>
                    : <span style={st.fail}><XCircle size={12} /> Failed</span>}</td>
                  <td style={st.td}>{a.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.label}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  header: { marginBottom: 18 },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", marginBottom: 14, maxWidth: 820 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 12 },
  checkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#333", marginBottom: 12 },
  checkInline: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  note: { fontSize: 12, color: "#888", marginTop: 10, lineHeight: 1.6 },
  actions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, maxWidth: 820, marginBottom: 18 },
  savedMsg: { display: "flex", alignItems: "center", gap: 5, color: "#2e7d32", fontSize: 13, fontWeight: 600 },
  saveBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  logHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  refreshBtn: { background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", padding: 6, display: "flex", color: "#1565c0" },
  memberFilter: { marginBottom: 12 },
  searchBox: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #cdd7e3", borderRadius: 8, padding: "7px 10px", background: "#fff" },
  searchIn: { border: "none", outline: "none", fontSize: 13.5, flex: 1, background: "transparent" },
  searchDrop: { position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 20, overflow: "hidden" },
  searchOpt: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #f4f6fa", padding: "9px 12px", fontSize: 13.5, color: "#243", cursor: "pointer" },
  searchOptSub: { color: "#8895a3", fontSize: 12.5 },
  memberChip: { display: "inline-flex", alignItems: "center", gap: 8, background: "#eef4fb", color: "#1a3a5c", border: "1px solid #cfe0f3", borderRadius: 16, padding: "6px 14px", fontSize: 13 },
  chipX: { display: "inline-flex", background: "none", border: "none", color: "#1565c0", cursor: "pointer", padding: 0 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "7px 8px", borderBottom: "1px solid #f4f6fa" },
  tdMono: { padding: "7px 8px", borderBottom: "1px solid #f4f6fa", fontFamily: "monospace" },
  ok: { display: "inline-flex", alignItems: "center", gap: 4, color: "#2e7d32", fontWeight: 600 },
  fail: { display: "inline-flex", alignItems: "center", gap: 4, color: "#c62828", fontWeight: 600 },
  muted: { color: "#aaa", fontSize: 13 },
};
