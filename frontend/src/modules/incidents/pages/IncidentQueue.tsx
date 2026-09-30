import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { incidentsApi, PHASE1_TYPES, type IncidentSummary } from "../api";
import { ShieldAlert } from "lucide-react";

const SEV_COLOR: Record<string, string> = { minor: "#6b7280", moderate: "#b7791f", serious: "#c2410c", critical: "#b91c1c" };
const STATUSES = ["submitted", "triaged", "in_review", "awaiting_action", "closed"];

export default function IncidentQueue() {
  const [rows, setRows] = useState<IncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sev, setSev] = useState("");

  function load() {
    setLoading(true);
    const p: Record<string, string> = {};
    if (status) p.status = status; if (type) p.type = type; if (sev) p.severity = sev;
    incidentsApi.list(p).then((r) => { setRows(r); setLoading(false); }).catch(() => setLoading(false));
  }
  useEffect(load, [status, type, sev]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "8px 14px 40px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: "6px 0", display: "flex", alignItems: "center", gap: 8 }}><ShieldAlert size={22} color="#b23b3b" /> Incident Queue</h1>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "10px 0 14px" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={sel}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={sel}><option value="">All types</option>{PHASE1_TYPES.map((t) => <option key={t.slug} value={t.slug}>{t.label}</option>)}</select>
        <select value={sev} onChange={(e) => setSev(e.target.value)} style={sel}><option value="">All severities</option>{["minor", "moderate", "serious", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      {loading ? <p style={{ color: "#888" }}>Loading…</p> : (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f7f9fc" }}>
              {["Ref", "Type", "Severity", "Status", "Age", "Assigned", "When"].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "#999" }}>No incidents match.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => { window.location.href = `/incidents/${r.id}`; }}>
                  <td style={td}><Link to={`/incidents/${r.id}`} style={{ color: "#1565c0", fontWeight: 700 }}>{r.ref_no}</Link>{r.is_anonymous && <span style={badge}>anon</span>}</td>
                  <td style={td}>{r.type_label}{r.is_sensitive && <span style={{ ...badge, background: "#fdecea", color: "#a4291c" }}>sensitive</span>}</td>
                  <td style={{ ...td, fontWeight: 800, textTransform: "uppercase", color: SEV_COLOR[r.effective_severity] ?? "#666" }}>{r.effective_severity}</td>
                  <td style={{ ...td, textTransform: "capitalize" }}>{r.status.replace(/_/g, " ")}</td>
                  <td style={{ ...td, color: (r.age_days ?? 0) > 2 && r.status !== "closed" ? "#b91c1c" : "#666", fontWeight: (r.age_days ?? 0) > 2 ? 700 : 400 }}>{r.age_days ?? "—"}d</td>
                  <td style={td}>{r.assigned_to_name ?? <span style={{ color: "#bbb" }}>unassigned</span>}</td>
                  <td style={{ ...td, color: "#888" }}>{r.occurred_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const sel: React.CSSProperties = { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13 };
const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13.5, color: "#333", borderBottom: "1px solid #f0f3f7" };
const badge: React.CSSProperties = { marginLeft: 6, fontSize: 10, fontWeight: 700, background: "#eef2f6", color: "#667", borderRadius: 5, padding: "1px 5px", textTransform: "uppercase" };
