import { useState, useEffect } from "react";
import { campApi, type CampReport } from "../api";
import CampTabs from "../components/CampTabs";

export default function CampReports() {
  const [r, setR] = useState<CampReport | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { campApi.report().then(setR).catch(() => setR(null)).finally(() => setLoading(false)); }, []);

  if (loading) return <div style={st.page}><CampTabs /><p style={st.muted}>Loading…</p></div>;
  if (!r) return <div style={st.page}><CampTabs /><p style={st.muted}>No report available — set up a camp season first.</p></div>;

  const camperShirts = Object.entries(r.camper_shirts);
  const staffShirts = Object.entries(r.staff_shirts);
  const camperTotal = camperShirts.reduce((s, [, n]) => s + n, 0);
  const staffTotal = staffShirts.reduce((s, [, n]) => s + n, 0);

  return (
    <div style={st.page}>
      <CampTabs />
      <div style={st.row}>
        <ShirtCard title={`Camper shirts (${camperTotal})`} rows={camperShirts} />
        <ShirtCard title={`Staff shirts (${staffTotal})`} rows={staffShirts} />
      </div>
      <div style={st.card}>
        <div style={st.cardTitle}>Registrations by camp</div>
        {r.by_camp.length === 0 ? <p style={st.muted}>No camps defined.</p> : (
          <table style={st.table}>
            <thead><tr><th style={st.th}>Week</th><th style={st.th}>Camp</th><th style={st.thC}>Registered</th><th style={st.thC}>Confirmed</th><th style={st.thC}>Paid</th></tr></thead>
            <tbody>
              {r.by_camp.map((c, i) => (
                <tr key={i} style={st.tr}><td style={st.td}>{c.week_label || "—"}</td><td style={st.td}>{c.title}</td><td style={st.tdC}>{c.registered}</td><td style={st.tdC}>{c.confirmed}</td><td style={st.tdC}>{c.paid}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ShirtCard({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div style={st.card}>
      <div style={st.cardTitle}>{title}</div>
      {rows.length === 0 ? <p style={st.muted}>No data yet.</p> : (
        <table style={st.table}>
          <tbody>
            {rows.map(([size, n]) => (
              <tr key={size} style={st.tr}><td style={st.td}>{size}</td><td style={st.tdC}><strong>{n}</strong></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  muted: { color: "#888", fontSize: 14 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 14 },
  cardTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  thC: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #f4f6fa" },
  td: { padding: "7px 8px" },
  tdC: { padding: "7px 8px", textAlign: "center" },
};
