import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { incidentsApi, type IncidentSummary } from "../api";
import { Plus, ArrowLeft } from "lucide-react";

const SEV_COLOR: Record<string, string> = { minor: "#6b7280", moderate: "#b7791f", serious: "#c2410c", critical: "#b91c1c" };

export default function MyReports() {
  const nav = useNavigate();
  const [rows, setRows] = useState<IncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { incidentsApi.mine().then((r) => { setRows(r); setLoading(false); }).catch(() => setLoading(false)); }, []);
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 14px 40px" }}>
      <button onClick={() => nav("/")} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}><ArrowLeft size={15} /> Dashboard</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: "6px 0" }}>My Reports</h1>
        <Link to="/incidents/new" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "#b23b3b", color: "#fff", borderRadius: 9, textDecoration: "none", fontWeight: 700 }}><Plus size={16} /> Report an Incident</Link>
      </div>
      <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>Reports you filed under your name. Anonymous reports are never listed here.</p>
      {loading ? <p style={{ color: "#888" }}>Loading…</p> : rows.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 24, textAlign: "center", color: "#888" }}>You haven't filed any reports.</div>
      ) : rows.map((r) => (
        <Link key={r.id} to={`/incidents/${r.id}`} style={{ display: "block", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 8, textDecoration: "none", color: "inherit" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, color: "#1a3a5c" }}>{r.type_label}</div>
              <div style={{ fontSize: 12.5, color: "#888" }}>{r.ref_no} · {r.occurred_at}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: SEV_COLOR[r.effective_severity] ?? "#666" }}>{r.effective_severity}</span>
              <div style={{ fontSize: 12, color: "#999", textTransform: "capitalize" }}>{r.status.replace(/_/g, " ")}</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
