import { useEffect, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Download, Activity, Eye, Clock, Zap } from "lucide-react";
import { usageApi, type UsageReport as UsageData } from "../api";

function fmtDur(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function UsageReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    setErr("");
    usageApi.getReport({ from: from || undefined, to: to || undefined })
      .then(setData)
      .catch((e) => setErr(e?.response?.status === 403 ? "This report is admin-only." : "Could not load usage data."))
      .finally(() => setLoading(false));
  }, [from, to]);

  function exportCsv() {
    if (!data) return;
    const head = ["Member", "Type", "Page views", "Sessions", "Active minutes", "Actions", "Last seen"];
    const lines = [head.join(",")];
    for (const u of data.users) {
      lines.push([`"${u.name}"`, u.member_type, u.pageviews, u.sessions, u.active_minutes, u.actions, u.last_seen ?? ""].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "user_activity.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const totals = data ? {
    users: data.users.filter((u) => u.pageviews > 0 || u.actions > 0).length,
    views: data.users.reduce((s, u) => s + u.pageviews, 0),
    minutes: data.users.reduce((s, u) => s + u.active_minutes, 0),
  } : null;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Reports</button>
      <div style={st.head}>
        <div>
          <h1 style={st.heading}><Activity size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />User Activity</h1>
          <p style={st.sub}>Who's using TRCMS, how much, and what they look at. Power users are ranked by time in the system. Time is estimated from page views and activity heartbeats.</p>
        </div>
        {data && data.users.length > 0 && canRead("reports.export") && <button style={st.csvBtn} onClick={exportCsv}><Download size={14} /> CSV</button>}
      </div>

      <div style={st.controls}>
        <label style={st.field}><span style={st.lbl}>From</span>
          <input type="date" style={st.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={st.field}><span style={st.lbl}>To</span>
          <input type="date" style={st.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {data && <span style={st.range}>{data.from} → {data.to}</span>}
      </div>

      {err && <p style={st.err}>{err}</p>}
      {loading && <p style={st.muted}>Loading…</p>}

      {!loading && data && !err && (
        <>
          {totals && (
            <div style={st.cards}>
              <Stat icon={<Zap size={18} />} color="#1565c0" label="Active users" value={String(totals.users)} />
              <Stat icon={<Eye size={18} />} color="#2e7d32" label="Page views" value={totals.views.toLocaleString()} />
              <Stat icon={<Clock size={18} />} color="#e65100" label="Total time" value={fmtDur(totals.minutes)} />
            </div>
          )}

          {!data.tracking_active && (
            <p style={st.notice}>No page-view data yet in this range. Usage tracking records activity going forward — the numbers below currently reflect logged actions only until members browse the app.</p>
          )}

          <h2 style={st.section}>Power users</h2>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead><tr>
                <th style={st.th}>#</th>
                <th style={st.thL}>Member</th>
                <th style={st.thR}>Time</th>
                <th style={st.thR}>Page views</th>
                <th style={st.thR}>Sessions</th>
                <th style={st.thR}>Actions</th>
                <th style={st.thR}>Last seen</th>
              </tr></thead>
              <tbody>
                {data.users.map((u, i) => (
                  <tr key={u.member_id}>
                    <td style={st.tdRank}>{i + 1}</td>
                    <td style={st.tdL}>{u.name}<span style={st.type}>{u.member_type}</span></td>
                    <td style={{ ...st.tdR, fontWeight: 700, color: "#1a3a5c" }}>{fmtDur(u.active_minutes)}</td>
                    <td style={st.tdR}>{u.pageviews.toLocaleString()}</td>
                    <td style={st.tdR}>{u.sessions}</td>
                    <td style={st.tdR}>{u.actions.toLocaleString()}</td>
                    <td style={{ ...st.tdR, color: "#888", fontSize: 12 }}>{fmtDate(u.last_seen)}</td>
                  </tr>
                ))}
                {data.users.length === 0 && <tr><td colSpan={7} style={st.empty}>No activity in this range.</td></tr>}
              </tbody>
            </table>
          </div>

          {data.top_pages.length > 0 && (
            <>
              <h2 style={st.section}>Most-visited pages</h2>
              <div style={st.tableWrap}>
                <table style={st.table}>
                  <thead><tr><th style={st.thL}>Page</th><th style={st.thR}>Views</th></tr></thead>
                  <tbody>
                    {data.top_pages.map((p) => (
                      <tr key={p.path}><td style={{ ...st.tdL, fontFamily: "monospace", fontSize: 13 }}>{p.path}</td><td style={st.tdR}>{p.views.toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div style={st.card}>
      <div style={{ ...st.cardIcon, color }}>{icon}</div>
      <div><div style={st.cardValue}>{value}</div><div style={st.cardLabel}>{label}</div></div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 16 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#888", maxWidth: 640, lineHeight: 1.5 },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  controls: { display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  range: { fontSize: 12, color: "#aaa", paddingBottom: 8 },
  cards: { display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  card: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px", minWidth: 150, flex: 1 },
  cardIcon: { display: "flex" },
  cardValue: { fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  cardLabel: { fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  notice: { background: "#fff8e1", border: "1px solid #ffe082", color: "#8a6d00", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 },
  section: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, margin: "8px 0 10px" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 20 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 560 },
  th: { textAlign: "center", padding: "10px 8px", fontSize: 12, color: "#888", borderBottom: "1px solid #eef2f6", background: "#fafbfc", width: 32 },
  thL: { textAlign: "left", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc" },
  thR: { textAlign: "right", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc", whiteSpace: "nowrap" },
  tdRank: { textAlign: "center", padding: "9px 8px", fontSize: 13, color: "#bbb", fontWeight: 700, borderBottom: "1px solid #f2f5f8" },
  tdL: { padding: "9px 14px", fontSize: 14, color: "#1a3a5c", fontWeight: 600, borderBottom: "1px solid #f2f5f8" },
  tdR: { padding: "9px 14px", fontSize: 14, color: "#444", textAlign: "right", borderBottom: "1px solid #f2f5f8", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  type: { fontSize: 11, color: "#999", fontWeight: 400, marginLeft: 8, textTransform: "capitalize" },
  empty: { padding: 20, textAlign: "center", color: "#aaa", fontSize: 14 },
  err: { color: "#c62828", fontSize: 14 },
  muted: { color: "#aaa", fontSize: 14 },
};
