/**
 * CampSpecialNotes — a roster of campers' medical / allergy / accommodation
 * notes, with their media-release consent, filterable by week or by a specific
 * camp (session). Helps staff see special needs at a glance and know who can be
 * photographed.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { campApi, type CampSeason, type CampSession, type CampRegistration } from "../api";
import CampTabs from "../components/CampTabs";
import { Camera, CameraOff, AlertTriangle } from "lucide-react";

export default function CampSpecialNotes() {
  const [season, setSeason] = useState<CampSeason | null>(null);
  const [sessions, setSessions] = useState<CampSession[]>([]);
  const [regs, setRegs] = useState<CampRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("all");        // "all" | "week:<label>" | "session:<id>"
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(true);

  const load = useCallback(async () => {
    const s = await campApi.currentSeason().catch(() => null);
    setSeason(s);
    if (s) {
      const [ses, rg] = await Promise.all([
        campApi.listSessions(s.id).catch(() => []),
        campApi.listRegistrations({ season_id: s.id }).catch(() => []),
      ]);
      setSessions(ses);
      setRegs(rg);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // session_id → { title, week_label }
  const sessionMap = useMemo(() => {
    const m: Record<number, CampSession> = {};
    sessions.forEach((s) => { m[s.id] = s; });
    return m;
  }, [sessions]);

  const weeks = useMemo(
    () => [...new Set(sessions.map((s) => s.week_label).filter(Boolean))] as string[],
    [sessions]
  );

  // Treat filler answers ("No", "None", "N/A", "-", etc.) as no real note, so
  // campers who simply answered "none" don't show up as having a medical issue.
  const meaningful = (v?: string | null): string => {
    const t = (v ?? "").trim();
    if (!t) return "";
    return /^(no|none|n\/a|na|n\.a\.|nope|nil|-|--|0|n)$/i.test(t) ? "" : t;
  };

  const hasNotes = (r: CampRegistration) =>
    !!(meaningful(r.camper.medical_notes) || meaningful(r.camper.food_allergies) || meaningful(r.camper.accommodations));

  // A camper needs attention if they have a real note OR have not consented to photos.
  const needsAttention = (r: CampRegistration) => hasNotes(r) || !r.waiver_media_agreed;

  const rows = useMemo(() => {
    let list = regs.filter((r) => r.status !== "cancelled");
    if (scope.startsWith("week:")) {
      const wk = scope.slice(5);
      list = list.filter((r) => sessionMap[r.session_id]?.week_label === wk);
    } else if (scope.startsWith("session:")) {
      const sid = parseInt(scope.slice(8));
      list = list.filter((r) => r.session_id === sid);
    }
    if (needsAttentionOnly) list = list.filter(needsAttention);
    return list.sort((a, b) =>
      (a.camper.last_name || "").localeCompare(b.camper.last_name || "") ||
      (a.camper.first_name || "").localeCompare(b.camper.first_name || ""));
  }, [regs, scope, needsAttentionOnly, sessionMap]);

  const withNotes = rows.filter(hasNotes).length;
  const noMedia = rows.filter((r) => !r.waiver_media_agreed).length;

  return (
    <div>
      <CampTabs />
      <h1 style={st.heading}>Special Notes</h1>
      <p style={st.sub}>Medical, allergy, and accommodation notes for campers — and whether they've consented to the media release (photos).</p>

      {loading ? <p style={st.muted}>Loading…</p> : !season ? (
        <p style={st.muted}>No active camp season.</p>
      ) : (
        <>
          <div style={st.toolbar}>
            <select style={st.select} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All camps</option>
              {weeks.length > 0 && (
                <optgroup label="By Week">
                  {weeks.map((w) => <option key={w} value={`week:${w}`}>{w}</option>)}
                </optgroup>
              )}
              <optgroup label="By Camp">
                {sessions.map((s) => (
                  <option key={s.id} value={`session:${s.id}`}>
                    {s.week_label ? `${s.week_label} — ` : ""}{s.title}
                  </option>
                ))}
              </optgroup>
            </select>
            <label style={st.toggle}>
              <input type="checkbox" checked={needsAttentionOnly} onChange={(e) => setNeedsAttentionOnly(e.target.checked)} />
              Only campers needing attention
            </label>
            <div style={st.counts}>
              <span>{rows.length} camper{rows.length !== 1 ? "s" : ""}</span>
              {withNotes > 0 && <span style={st.countWarn}><AlertTriangle size={12} /> {withNotes} with notes</span>}
              {noMedia > 0 && <span style={st.countNoMedia}><CameraOff size={12} /> {noMedia} no-photo</span>}
            </div>
          </div>

          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Camper</th>
                  <th style={st.th}>Camp</th>
                  <th style={st.th}>Medical</th>
                  <th style={st.th}>Allergies</th>
                  <th style={st.th}>Accommodations</th>
                  <th style={{ ...st.th, textAlign: "center" }}>Photos?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ses = sessionMap[r.session_id];
                  const flagged = hasNotes(r);
                  return (
                    <tr key={r.id} style={{ ...st.tr, background: flagged ? "#fffdf5" : "#fff" }}>
                      <td style={st.td}>
                        <strong>{r.camper.last_name}, {r.camper.first_name}</strong>
                        {r.camper.grade && <div style={st.subCell}>Grade {r.camper.grade}</div>}
                      </td>
                      <td style={st.td}>{ses ? `${ses.week_label ? ses.week_label + " · " : ""}${ses.title}` : (r.session_title ?? "—")}</td>
                      <td style={{ ...st.td, ...(meaningful(r.camper.medical_notes) ? st.noteCell : {}) }}>{meaningful(r.camper.medical_notes) || "—"}</td>
                      <td style={{ ...st.td, ...(meaningful(r.camper.food_allergies) ? st.noteCell : {}) }}>{meaningful(r.camper.food_allergies) || "—"}</td>
                      <td style={{ ...st.td, ...(meaningful(r.camper.accommodations) ? st.noteCell : {}) }}>{meaningful(r.camper.accommodations) || "—"}</td>
                      <td style={{ ...st.td, textAlign: "center" }}>
                        {r.waiver_media_agreed
                          ? <span style={st.mediaOk}><Camera size={12} /> OK</span>
                          : <span style={st.mediaNo}><CameraOff size={12} /> No</span>}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td style={st.empty} colSpan={6}>No campers match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  heading: { margin: "0 0 2px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "0 0 16px", fontSize: 13, color: "#888", maxWidth: 640, lineHeight: 1.5 },
  muted: { color: "#888", fontSize: 14 },
  toolbar: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, minWidth: 220 },
  toggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444", cursor: "pointer" },
  counts: { display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: "#888", marginLeft: "auto" },
  countWarn: { display: "flex", alignItems: "center", gap: 4, color: "#b45309", fontWeight: 600 },
  countNoMedia: { display: "flex", alignItems: "center", gap: 4, color: "#c62828", fontWeight: 600 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "10px 14px", background: "#f0f4f8", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "9px 14px", color: "#333", verticalAlign: "top" },
  noteCell: { color: "#7c2d12", fontWeight: 500 },
  subCell: { fontSize: 11, color: "#aaa", marginTop: 2 },
  mediaOk: { display: "inline-flex", alignItems: "center", gap: 4, color: "#2e7d32", fontWeight: 700, fontSize: 12 },
  mediaNo: { display: "inline-flex", alignItems: "center", gap: 4, color: "#c62828", fontWeight: 700, fontSize: 12 },
  empty: { textAlign: "center", color: "#aaa", padding: "2rem", fontSize: 14 },
};
