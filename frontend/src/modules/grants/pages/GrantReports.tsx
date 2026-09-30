import { useState, useEffect } from "react";
import { grantsApi, type GrantReports as Reports } from "../api";
import { useGoBack } from "../../../core/useGoBack";
import { BarChart2 } from "lucide-react";

export default function GrantReports() {
  const goBack = useGoBack("/grants");
  const [r, setR] = useState<Reports | null>(null);
  useEffect(() => { grantsApi.reports().then(setR).catch(() => setR(null)); }, []);
  if (!r) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}>← Back to Grants</button>
      <h1 style={st.heading}><BarChart2 size={22} style={{ verticalAlign: -3 }} /> Grant Reports</h1>

      <div style={st.lifeCard}>
        <div style={st.lifeLabel}>Life-of-program grant funds received</div>
        <div style={st.lifeValue}>${r.life_total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
      </div>

      <div style={st.cols}>
        <Block title="By Team">
          {r.by_team.length === 0 ? <Empty /> : r.by_team.map((t) => (
            <Row key={`${t.team_season_id}-${t.label}`} label={t.label} value={t.received} />
          ))}
        </Block>
        <Block title="By Funder">
          {r.by_funder.length === 0 ? <Empty /> : r.by_funder.map((f) => (
            <Row key={f.funder_name} label={`${f.funder_name} (${f.grants})`} value={f.received} />
          ))}
        </Block>
        <Block title="By Year">
          {r.by_year.length === 0 ? <Empty /> : r.by_year.map((y) => (
            <Row key={y.year} label={String(y.year)} value={y.received} />
          ))}
        </Block>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={st.block}><div style={st.blockTitle}>{title}</div>{children}</div>;
}
function Row({ label, value }: { label: string; value: number }) {
  return <div style={st.row}><span style={st.rLabel}>{label}</span><span style={st.rVal}>${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>;
}
function Empty() { return <p style={st.muted}>No awards recorded yet.</p>; }

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: "0 0 16px", fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  lifeCard: { background: "#1a3a5c", color: "#fff", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: 18 },
  lifeLabel: { fontSize: 13, opacity: 0.8, textTransform: "uppercase", letterSpacing: 0.5 },
  lifeValue: { fontSize: 34, fontWeight: 800, marginTop: 4 },
  cols: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 },
  block: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem" },
  blockTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, borderBottom: "2px solid #e2e8f0", paddingBottom: 8 },
  row: { display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid #f4f6fa", fontSize: 13 },
  rLabel: { color: "#444" },
  rVal: { fontWeight: 700, color: "#2e7d32", whiteSpace: "nowrap" },
  muted: { color: "#aaa", fontSize: 13, padding: "6px 0" },
};
