/**
 * ToolClearances — which tool-gate certifications exist and who is cleared.
 * A cert becomes a "tool clearance" when flagged as a tool gate on the catalog.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { certApi, type ToolClearance } from "../api";
import { ArrowLeft, Wrench, ShieldCheck } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function ToolClearances() {
  const navigate = useNavigate();
  const goBack = useGoBack("/certifications");
  const [data, setData] = useState<ToolClearance[] | null>(null);

  useEffect(() => { certApi.toolClearances().then(setData).catch(() => setData([])); }, []);

  if (!data) return <p style={st.muted}>Loading…</p>;

  return (
    <div>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Certifications</button>
      <h1 style={st.heading}><Wrench size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Tool Clearances</h1>
      <p style={st.sub}>Who is cleared to use each tool. Flag a certification as a "tool clearance" on the catalog to add it here.</p>

      {data.length === 0 ? (
        <div style={st.empty}>
          <Wrench size={28} color="#cbd5e1" />
          <p style={st.muted}>No tool-gate certifications yet. Edit a certification and check "Gates a tool."</p>
        </div>
      ) : (
        <div style={st.grid}>
          {data.map((t) => (
            <div key={t.code} style={st.card}>
              <div style={st.toolHead}>
                <ShieldCheck size={16} color="#c62828" />
                <span style={st.toolName}>{t.tool_name}</span>
                <span style={st.count}>{t.cleared_count} cleared</span>
              </div>
              <div style={st.certName}>{t.code} — {t.name}</div>
              {t.members.length === 0 ? (
                <p style={st.none}>No one cleared yet.</p>
              ) : (
                <div style={st.members}>
                  {t.members.map((m) => (
                    <span key={m.member_id} style={st.chip} onClick={() => navigate(`/members/${m.member_id}`)}>{m.name}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 16px", fontSize: 13, color: "#888" },
  muted: { color: "#aaa", fontSize: 14, padding: "0.5rem 0" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "2.5rem" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  toolHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  toolName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c", flex: 1 },
  count: { fontSize: 11, fontWeight: 700, color: "#c62828", background: "#ffebee", borderRadius: 10, padding: "2px 8px" },
  certName: { fontSize: 12, color: "#888", marginBottom: 8 },
  none: { fontSize: 12, color: "#aaa", fontStyle: "italic", margin: 0 },
  members: { display: "flex", flexWrap: "wrap", gap: 5 },
  chip: { fontSize: 12, color: "#1a3a5c", background: "#f0f4f8", borderRadius: 12, padding: "3px 10px", cursor: "pointer" },
};
