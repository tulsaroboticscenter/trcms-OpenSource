import { useState, useEffect } from "react";
import { currentSeasonYear } from "../../../core/dateUtils";
import { useNavigate } from "react-router-dom";
import { reportsApi, type ActivityImpact } from "../api";
import { membersApi } from "../../members/api";
import { ArrowLeft, Download, Clock, Heart, TrendingUp } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";

interface MemberOpt { id: number; first_name: string; last_name: string; }

function currentSeason(): string {
  const now = new Date();
  const y = currentSeasonYear(now);
  return `${y}-${y + 1}`;
}

export default function ActivityImpactReport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [season, setSeason] = useState<string>(currentSeason());   // "" = custom date range
  const [seasons, setSeasons] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [memberId, setMemberId] = useState("");   // "" = all members
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [data, setData] = useState<ActivityImpact | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    reportsApi.getActivitySeasons().then((s) => {
      setSeasons(Array.from(new Set([currentSeason(), ...s])).sort().reverse());
    }).catch(() => setSeasons([currentSeason()]));
    membersApi.list({ limit: "1000", is_active: "true" })
      .then((r) => setMembers(((r.members ?? []) as MemberOpt[]).slice().sort((a, b) =>
        (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name))))
      .catch(() => setMembers([]));
  }, []);

  const opts = { ...(season ? { season } : { fromDate, toDate }), memberId: memberId ? Number(memberId) : undefined };

  async function run() {
    setLoading(true);
    try { setData(await reportsApi.getActivityImpact(opts)); }
    finally { setLoading(false); }
  }

  const maxArea = data ? Math.max(1, ...data.by_area.map((a) => a.hours)) : 1;

  return (
    <div>
      <button onClick={goBack} style={s.back}><ArrowLeft size={14} /> Reports</button>
      <h1 style={s.h1}>Activity Impact</h1>
      <p style={s.sub}>Total participation and community/volunteer hours, by area and member type.</p>

      <div style={s.toolbar}>
        <label style={s.field}>
          <span style={s.lbl}>Season</span>
          <select style={s.input} value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((sn) => <option key={sn} value={sn}>{sn}</option>)}
            <option value="">Custom date range…</option>
          </select>
        </label>
        {!season && <>
          <label style={s.field}><span style={s.lbl}>From</span><input style={s.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label style={s.field}><span style={s.lbl}>To</span><input style={s.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        </>}
        <label style={s.field}>
          <span style={s.lbl}>Member</span>
          <select style={s.input} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">All members</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>)}
          </select>
        </label>
        <button style={s.run} onClick={run} disabled={loading}>{loading ? "Running…" : "Run Report"}</button>
        {data && canRead("reports.export") && (
          <a style={s.csv} href={reportsApi.csvActivityImpact(opts)}><Download size={14} /> CSV</a>
        )}
      </div>

      {data && (
        <>
          <div style={s.stats}>
            <Stat icon={<Clock size={18} />} color="#1565c0" label="Total Hours" value={data.total_hours} />
            <Stat icon={<Heart size={18} />} color="#2e7d32" label="Community / Volunteer Hours" value={data.volunteer_hours} />
            <Stat icon={<TrendingUp size={18} />} color="#6a1b9a" label="Members Logging" value={data.members.length} />
          </div>

          <div style={s.cols}>
            <div style={s.card}>
              <div style={s.cardTitle}>Hours by Area</div>
              {data.by_area.length === 0 ? <p style={s.muted}>No data.</p> : data.by_area.map((a) => (
                <div key={a.area} style={s.barRow}>
                  <span style={s.barLabel}>{a.area}</span>
                  <div style={s.barTrack}><div style={{ ...s.barFill, width: `${(a.hours / maxArea) * 100}%` }} /></div>
                  <span style={s.barVal}>{a.hours}h</span>
                </div>
              ))}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Hours by Member Type</div>
              {data.by_member_type.length === 0 ? <p style={s.muted}>No data.</p> : data.by_member_type.map((t) => (
                <div key={t.member_type} style={s.typeRow}>
                  <span style={s.typeLabel}>{t.member_type}</span>
                  <span style={s.typeVal}>{t.hours}h</span>
                </div>
              ))}
            </div>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>By Member</div>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Member</th><th style={s.th}>Type</th>
                <th style={{ ...s.th, textAlign: "right" }}>Total Hours</th>
                <th style={{ ...s.th, textAlign: "right" }}>Volunteer Hours</th>
              </tr></thead>
              <tbody>
                {data.members.length === 0 && <tr><td colSpan={4} style={{ ...s.td, color: "#888", textAlign: "center" }}>No time logged in this range.</td></tr>}
                {data.members.map((m) => (
                  <tr key={m.member_id} style={{ cursor: "pointer" }} onClick={() => navigate(`/members/${m.member_id}`)}>
                    <td style={s.td}>{m.first_name} {m.last_name}</td>
                    <td style={s.td}>{m.member_type}</td>
                    <td style={{ ...s.td, textAlign: "right", fontWeight: 700 }}>{m.total_hours}</td>
                    <td style={{ ...s.td, textAlign: "right", color: "#2e7d32" }}>{m.volunteer_hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: number }) {
  return (
    <div style={s.stat}>
      <div style={{ color }}>{icon}</div>
      <div><div style={{ ...s.statVal, color }}>{value}</div><div style={s.statLabel}>{label}</div></div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 4, padding: 0, marginBottom: 8 },
  h1: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 16px", fontSize: 13, color: "#888" },
  toolbar: { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 18 },
  field: { display: "flex", flexDirection: "column", gap: 3 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#555" },
  input: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  run: { padding: "9px 18px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  csv: { display: "inline-flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 },
  stats: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  stat: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 18px", minWidth: 170 },
  statVal: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 12, color: "#888", marginTop: 3 },
  cols: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px", marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 12 },
  muted: { fontSize: 13, color: "#aaa" },
  barRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  barLabel: { width: 130, fontSize: 13, color: "#1a3a5c", fontWeight: 600 },
  barTrack: { flex: 1, height: 10, background: "#eef2f6", borderRadius: 5, overflow: "hidden" },
  barFill: { height: "100%", background: "#1565c0" },
  barVal: { width: 56, textAlign: "right", fontSize: 13, color: "#666" },
  typeRow: { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f3f7" },
  typeLabel: { fontSize: 14, color: "#1a3a5c", textTransform: "capitalize" },
  typeVal: { fontSize: 14, fontWeight: 700, color: "#1565c0" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "8px 10px", fontSize: 14, color: "#333", borderBottom: "1px solid #f0f3f7" },
};
