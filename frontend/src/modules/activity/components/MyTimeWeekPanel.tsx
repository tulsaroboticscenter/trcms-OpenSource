import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { activityApi, fmtMinutes, type MemberSummary } from "../api";
import { Clock, ChevronRight } from "lucide-react";

/** Compact "My Time this week" pane for the dashboard. */
export default function MyTimeWeekPanel({ memberId }: { memberId: number }) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    // Sunday → Saturday of the current week. Build a LOCAL date string (not
    // toISOString, which is UTC and rolls evening times to the next day in
    // Central time — that shifted the whole week forward and dropped days).
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); // Sunday
    const end = new Date(start); end.setDate(start.getDate() + 6);                             // Saturday
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const from = fmt(start), to = fmt(end);
    setRange({ from, to });
    activityApi.memberSummary(memberId, from, to).then(setSummary).catch(() => setSummary(null));
  }, [memberId]);

  const top = summary ? Object.entries(summary.by_area).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];

  return (
    <div style={st.pane}>
      <div style={st.head}>
        <span style={st.title}><Clock size={15} /> My Time This Week</span>
        <button style={st.link} onClick={() => navigate("/my-time")}>Log / view <ChevronRight size={13} /></button>
      </div>
      {!summary || summary.total_minutes === 0 ? (
        <p style={st.muted}>No time logged yet this week. <button style={st.inlineLink} onClick={() => navigate("/my-time")}>Log some →</button></p>
      ) : (
        <>
          <div style={st.totals}>
            <span style={st.total}>{fmtMinutes(summary.total_minutes)}</span>
            <span style={st.sub}>total{summary.volunteer_minutes ? ` · ${fmtMinutes(summary.volunteer_minutes)} community` : ""}</span>
          </div>
          <div style={st.chips}>
            {top.map(([area, mins]) => (
              <span key={area} style={st.chip}>{area} <strong>{fmtMinutes(mins)}</strong></span>
            ))}
          </div>
        </>
      )}
      {range && <div style={st.range}>{new Date(range.from + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(range.to + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  pane: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 18 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  link: { display: "inline-flex", alignItems: "center", gap: 2, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  inlineLink: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 },
  muted: { fontSize: 13, color: "#888", margin: 0 },
  totals: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 },
  total: { fontSize: 24, fontWeight: 800, color: "#ff8f00" },
  sub: { fontSize: 13, color: "#888" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { fontSize: 12, color: "#1a3a5c", background: "#f0f4f8", borderRadius: 14, padding: "3px 10px" },
  range: { fontSize: 11, color: "#aaa", marginTop: 8 },
};
