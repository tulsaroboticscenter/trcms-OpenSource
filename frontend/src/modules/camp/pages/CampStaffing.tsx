import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { campApi, type CampSeason, type CampStaffing, type CampStaffWorker } from "../api";
import CampTabs from "../components/CampTabs";
import { Users, Clock, AlertCircle } from "lucide-react";

export default function CampStaffingPage() {
  const { canWrite } = useAuth();
  const canManage = canWrite("camp.manage");
  const [season, setSeason] = useState<CampSeason | null>(null);
  const [data, setData] = useState<CampStaffing | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const s = await campApi.currentSeason().catch(() => null);
    setSeason(s);
    setData(await campApi.getStaffing(s?.id).catch(() => null));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2000); }

  async function toggle(sessionId: number, w: CampStaffWorker) {
    const assigned = !w.assigned_session_ids.includes(sessionId);
    // optimistic update
    setData((d) => d && ({ ...d, weeks: d.weeks.map((wk) => ({
      ...wk, workers: wk.workers.map((x) => x.member_id === w.member_id ? {
        ...x,
        assigned_session_ids: assigned ? [...x.assigned_session_ids, sessionId] : x.assigned_session_ids.filter((id) => id !== sessionId),
        is_floater: (assigned ? [...x.assigned_session_ids, sessionId] : x.assigned_session_ids.filter((id) => id !== sessionId)).filter((id) => wk.camps.some((c) => c.session_id === id)).length > 1,
      } : x),
    })) }));
    try { await campApi.assignWorker(sessionId, w.member_id, assigned); }
    catch { flash("Could not save — reloading."); load(); }
  }

  if (loading) return <div style={st.page}><CampTabs /><p style={st.muted}>Loading…</p></div>;
  if (!season) return <div style={st.page}><CampTabs /><p style={st.muted}>No camp season set up yet — create one on the Setup tab.</p></div>;

  const weeks = data?.weeks ?? [];

  // Season roll-up: one row per worker across all weeks.
  const byMember = new Map<number, { name: string; minutes: number; days: number; camps: Set<string> }>();
  for (const wk of weeks) for (const w of wk.workers) {
    const e = byMember.get(w.member_id) ?? { name: w.name, minutes: 0, days: 0, camps: new Set<string>() };
    e.minutes += w.minutes; e.days += w.days;
    for (const sid of w.assigned_session_ids) { const c = wk.camps.find((x) => x.session_id === sid); if (c) e.camps.add(c.title); }
    byMember.set(w.member_id, e);
  }
  const summary = [...byMember.values()].sort((a, b) => b.minutes - a.minutes);

  return (
    <div style={st.page}>
      <CampTabs />
      {msg && <div style={st.flash}>{msg}</div>}
      <p style={st.intro}>
        <Users size={14} style={{ verticalAlign: -2 }} /> Everyone who <strong>checked in</strong> to a camp's linked calendar event appears here with their hours.
        Tag each person to the camp(s) they worked — someone on both is a <strong>floater</strong>. Hours come from check-ins on the shared weekly event,
        so a floater's time covers both camps. (Camps must be linked to an event on the Setup tab to show up here.)
      </p>

      {weeks.length === 0 ? (
        <div style={st.card}><p style={st.muted}>No camps are linked to a calendar event yet. Link each camp to its event on the Setup tab, then check-ins will show up here.</p></div>
      ) : (
        <>
          {weeks.map((wk) => (
            <div key={wk.event_id} style={st.card}>
              <div style={st.weekHead}>
                <span style={st.weekName}>{wk.event_name}</span>
                <span style={st.weekDate}>{[wk.event_date, wk.end_date && wk.end_date !== wk.event_date ? `– ${wk.end_date}` : null].filter(Boolean).join(" ")}</span>
              </div>
              <div style={st.listWrap}>
                <table style={st.table}>
                  <thead>
                    <tr>
                      <th style={st.th}>Worker</th>
                      <th style={st.thC}>Hours</th>
                      <th style={st.thC}>Days</th>
                      {wk.camps.map((c) => <th key={c.session_id} style={st.thCamp}>{c.title}</th>)}
                      <th style={st.thC}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {wk.workers.length === 0 ? (
                      <tr><td style={st.td} colSpan={wk.camps.length + 4}><span style={st.muted}>No check-ins recorded on this event yet.</span></td></tr>
                    ) : wk.workers.map((w) => (
                      <tr key={w.member_id} style={st.tr}>
                        <td style={st.td}><strong>{w.name}</strong>{w.is_floater && <span style={st.floater}>floater</span>}</td>
                        <td style={st.tdC}><Clock size={11} style={{ verticalAlign: -1, color: "#94a3b8" }} /> {w.hours}{w.open_count > 0 && <span style={st.open} title={`${w.open_count} check-in(s) without a checkout — not counted in hours`}><AlertCircle size={11} /></span>}</td>
                        <td style={st.tdC}>{w.days}</td>
                        {wk.camps.map((c) => (
                          <td key={c.session_id} style={st.tdC}>
                            <input type="checkbox" disabled={!canManage} checked={w.assigned_session_ids.includes(c.session_id)} onChange={() => toggle(c.session_id, w)} />
                          </td>
                        ))}
                        <td style={st.tdC}></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div style={st.card}>
            <div style={st.weekHead}><span style={st.weekName}>Season summary — who worked camp</span></div>
            <div style={st.listWrap}>
              <table style={st.table}>
                <thead><tr><th style={st.th}>Worker</th><th style={st.thC}>Total hours</th><th style={st.thC}>Total days</th><th style={st.th}>Camps worked</th></tr></thead>
                <tbody>
                  {summary.length === 0 ? <tr><td style={st.td} colSpan={4}><span style={st.muted}>No check-ins yet.</span></td></tr> :
                    summary.map((s, i) => (
                      <tr key={i} style={st.tr}>
                        <td style={st.td}><strong>{s.name}</strong></td>
                        <td style={st.tdC}>{Math.round((s.minutes / 60) * 10) / 10}</td>
                        <td style={st.tdC}>{s.days}</td>
                        <td style={st.td}>{s.camps.size ? [...s.camps].join(", ") : <span style={st.muted}>— not tagged —</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1000, margin: "0 auto" },
  muted: { color: "#888", fontSize: 14 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  intro: { fontSize: 12.5, color: "#667", lineHeight: 1.6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 14 },
  weekHead: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 },
  weekName: { fontSize: 14, fontWeight: 800, color: "#1a3a5c" },
  weekDate: { fontSize: 12, color: "#94a3b8" },
  listWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  thC: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  thCamp: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#1a3a5c", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "8px", borderBottom: "1px solid #f4f6fa" },
  tdC: { padding: "8px", textAlign: "center", borderBottom: "1px solid #f4f6fa" },
  floater: { fontSize: 10, fontWeight: 800, color: "#7c3aed", background: "#f3e8ff", borderRadius: 8, padding: "1px 7px", marginLeft: 6, textTransform: "uppercase" },
  open: { color: "#e65100", marginLeft: 4, verticalAlign: -1 },
};
