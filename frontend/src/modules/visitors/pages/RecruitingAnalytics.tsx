/**
 * RecruitingAnalytics — the recruiting funnel and conversion. Which sources and
 * schools actually produce inquiries and (more importantly) enrollments.
 */
import { useState, useEffect } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { visitorsApi, type RecruitingAnalytics as Data } from "../api";
import { ArrowLeft, TrendingUp } from "lucide-react";

const FUNNEL = [
  { key: "new", label: "New Inquiry", color: "#1565c0" },
  { key: "visit_scheduled", label: "Visit Scheduled", color: "#00838f" },
  { key: "visited", label: "Visited", color: "#00897b" },
  { key: "follow_up", label: "Follow-Up", color: "#f57c00" },
  { key: "waitlisted", label: "Waitlisted", color: "#8e24aa" },
  { key: "enrolled", label: "Enrolled", color: "#2e7d32" },
  { key: "not_interested", label: "Not Interested", color: "#9aa5b1" },
];
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function RecruitingAnalytics() {
  const goBack = useGoBack("/visitors");
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => { visitorsApi.analytics().then(setD).catch(() => setD(null)); }, []);
  if (!d) return <div style={s.page}><p style={s.muted}>Loading…</p></div>;

  const maxFunnel = Math.max(1, ...FUNNEL.map((f) => d.funnel[f.key] ?? 0));
  const maxMonth = Math.max(1, ...d.by_month.map((m) => m.count));

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Visitors</button>
      <h1 style={s.h1}><TrendingUp size={22} /> Recruiting Analytics</h1>

      <div style={s.totals}>
        <Stat label="Total inquiries" value={String(d.total_inquiries)} />
        <Stat label="Enrolled" value={String(d.enrolled)} color="#2e7d32" />
        <Stat label="Conversion rate" value={`${d.conversion_rate}%`} color="#1565c0" />
      </div>

      <Card title="Funnel">
        {FUNNEL.map((f) => {
          const n = d.funnel[f.key] ?? 0;
          return (
            <div key={f.key} style={s.fRow}>
              <span style={s.fLabel}>{f.label}</span>
              <div style={s.fTrack}><div style={{ ...s.fFill, width: `${(n / maxFunnel) * 100}%`, background: f.color }} /></div>
              <span style={s.fVal}>{n}</span>
            </div>
          );
        })}
      </Card>

      <div style={s.cols}>
        <Card title="By referral source">
          <Table rows={d.by_source.map((r) => ({ name: r.label, count: r.count, enrolled: r.enrolled }))} />
        </Card>
        <Card title="By program interest">
          <Table rows={d.by_program.map((r) => ({ name: r.program, count: r.count, enrolled: r.enrolled }))} />
        </Card>
      </div>

      <Card title="By school">
        {d.by_school.length === 0 ? <p style={s.muted}>No prospects attributed to a school yet — set “Referred by school” on a prospect.</p>
          : <Table rows={d.by_school.map((r) => ({ name: r.school, count: r.count, enrolled: r.enrolled }))} showRate />}
      </Card>

      <Card title="Inquiries by month">
        {d.by_month.length === 0 ? <p style={s.muted}>No dated inquiries yet.</p> : d.by_month.map((m) => (
          <div key={m.month} style={s.fRow}>
            <span style={s.fLabel}>{m.month}</span>
            <div style={s.fTrack}><div style={{ ...s.fFill, width: `${(m.count / maxMonth) * 100}%`, background: "#1565c0" }} /></div>
            <span style={s.fVal}>{m.count}</span>
          </div>
        ))}
      </Card>
    </div>
  );

  function Table({ rows, showRate }: { rows: { name: string; count: number; enrolled: number }[]; showRate?: boolean }) {
    if (rows.length === 0) return <p style={s.muted}>No data.</p>;
    return (
      <>
        <div style={s.thead}><span style={{ flex: 1 }} /><span style={s.th}>Inq.</span><span style={s.th}>Enr.</span>{showRate && <span style={s.th}>Rate</span>}</div>
        {rows.map((r, i) => (
          <div key={i} style={s.tr}>
            <span style={s.tName}>{r.name}</span>
            <span style={s.td}>{r.count}</span>
            <span style={{ ...s.td, color: "#2e7d32", fontWeight: 700 }}>{r.enrolled}</span>
            {showRate && <span style={s.td}>{pct(r.enrolled, r.count)}%</span>}
          </div>
        ))}
      </>
    );
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={s.card}><div style={s.cardTitle}>{title}</div>{children}</div>;
}
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div style={s.totCard}><div style={{ ...s.totVal, ...(color ? { color } : {}) }}>{value}</div><div style={s.totLabel}>{label}</div></div>;
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  h1: { margin: "0 0 14px", fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  totals: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 },
  totCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", textAlign: "center" },
  totVal: { fontSize: 26, fontWeight: 800, color: "#1a3a5c" },
  totLabel: { fontSize: 11.5, fontWeight: 700, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  muted: { color: "#889", fontSize: 13.5 },
  fRow: { display: "flex", alignItems: "center", gap: 10, padding: "4px 0" },
  fLabel: { fontSize: 12.5, color: "#556", width: 100, flexShrink: 0 },
  fTrack: { flex: 1, height: 15, background: "#eef2f7", borderRadius: 8, overflow: "hidden" },
  fFill: { height: "100%", borderRadius: 8 },
  fVal: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", width: 36, textAlign: "right" },
  thead: { display: "flex", alignItems: "center", gap: 8, padding: "0 0 6px", borderBottom: "1px solid #f0f4f8" },
  th: { fontSize: 10.5, fontWeight: 700, color: "#99a", textTransform: "uppercase", width: 44, textAlign: "right" },
  tr: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #f6f8fb" },
  tName: { flex: 1, fontSize: 13.5, color: "#1a3a5c", fontWeight: 600 },
  td: { fontSize: 13.5, color: "#556", width: 44, textAlign: "right" },
};
