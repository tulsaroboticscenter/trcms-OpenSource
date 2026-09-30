/**
 * FllAttendance — FLL attendance quick-tracking kiosk (0228).
 *
 * A one-screen roster of every current-season FLL (Explore + Challenge) team, each member with
 * two big checkboxes: In and Out. Ticking In checks the member in (real timestamp); ticking Out
 * checks them out. Attendance is tied to a quick-tracking event so presence credits their time.
 * "Close attendance" credits the full event duration to anyone still checked in.
 *
 * State per member: none / in / out.
 *   In  checkbox → checked when state is in OR out (they arrived). Unchecking removes the check-in.
 *   Out checkbox → checked when state is out. Enabled once checked in. Unchecking reopens it.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fllAttendanceApi, type FllAttRoster, type FllAttEvent, type FllAttMember, type FllAttState } from "../../events/api";
import { useAuth } from "../../../core/AuthContext";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, Users, LogOut } from "lucide-react";

export default function FllAttendance() {
  const { user } = useAuth();
  const isKiosk = !!user?.is_kiosk;
  const goBack = useGoBack("/");

  const [events, setEvents] = useState<FllAttEvent[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [roster, setRoster] = useState<FllAttRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ msg: string; kind: "warn" | "ok" } | null>(null);
  const [showAdults, setShowAdults] = useState<boolean>(() => {
    try { return localStorage.getItem("trc_fll_show_adults") !== "0"; } catch { return true; }
  });
  const [closing, setClosing] = useState(false);
  const pending = useRef(0);

  useEffect(() => { try { localStorage.setItem("trc_fll_show_adults", showAdults ? "1" : "0"); } catch { /* ignore */ } }, [showAdults]);

  // Load today's quick-tracking events. Restore the event chosen before a refresh (localStorage)
  // so the kiosk doesn't lose everyone's checked-in state on reload; otherwise auto-select when
  // there's exactly one.
  useEffect(() => {
    fllAttendanceApi.today().then((d) => {
      setEvents(d.events);
      let saved: number | null = null;
      try { const v = localStorage.getItem("trc_fll_event_id"); saved = v ? Number(v) : null; } catch { /* ignore */ }
      if (saved && d.events.some((e) => e.id === saved)) setEventId(saved);
      else if (d.events.length === 1) setEventId(d.events[0].id);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Remember the chosen event across refreshes.
  useEffect(() => {
    try { if (eventId) localStorage.setItem("trc_fll_event_id", String(eventId)); } catch { /* ignore */ }
  }, [eventId]);

  const loadRoster = useCallback(async (id: number) => {
    try { setRoster(await fllAttendanceApi.roster(id)); } catch { /* keep prior */ }
  }, []);

  useEffect(() => { if (eventId) loadRoster(eventId); }, [eventId, loadRoster]);

  // Gentle poll so several people at the kiosk stay roughly in sync — skipped while a tap is in flight.
  useEffect(() => {
    if (!eventId) return;
    const t = setInterval(() => { if (pending.current === 0) loadRoster(eventId); }, 25000);
    return () => clearInterval(t);
  }, [eventId, loadRoster]);

  function flash(msg: string, kind: "warn" | "ok") {
    setNotice({ msg, kind });
    window.setTimeout(() => setNotice((n) => (n && n.msg === msg ? null : n)), 4000);
  }

  // Update every occurrence of a member (they may be on more than one team) to a new state.
  function setMemberState(memberId: number, state: FllAttState, timeIn?: string | null, timeOut?: string | null) {
    setRoster((r) => r && ({
      ...r,
      teams: r.teams.map((t) => ({
        ...t,
        members: t.members.map((m) => m.member_id === memberId
          ? { ...m, state, time_in: timeIn ?? m.time_in, time_out: timeOut ?? m.time_out }
          : m),
      })),
    }));
  }

  async function mark(m: FllAttMember, field: "in" | "out", value: boolean) {
    if (!eventId) return;
    const prev = m.state;
    // optimistic
    const optimistic: FllAttState = field === "in" ? (value ? "in" : "none") : (value ? "out" : "in");
    setMemberState(m.member_id, optimistic);
    pending.current += 1;
    try {
      const r = await fllAttendanceApi.mark(eventId, m.member_id, field, value);
      if (!r.ok) { setMemberState(m.member_id, prev); flash(r.message || "Couldn't update.", "warn"); }
      else setMemberState(m.member_id, r.state, r.time_in ?? null, r.time_out ?? null);
    } catch {
      setMemberState(m.member_id, prev);
      flash("Network error — try again.", "warn");
    } finally { pending.current -= 1; }
  }

  function toggleIn(m: FllAttMember) { mark(m, "in", m.state === "none"); }
  function toggleOut(m: FllAttMember) { if (m.state !== "none") mark(m, "out", m.state === "in"); }

  async function closeAttendance() {
    if (!eventId) return;
    if (!window.confirm("Close attendance for this event? Anyone still checked in will be credited the full event time.")) return;
    setClosing(true);
    try {
      const r = await fllAttendanceApi.close(eventId);
      flash(`Closed attendance — ${r.closed} still-present ${r.closed === 1 ? "member" : "members"} credited.`, "ok");
      await loadRoster(eventId);
    } catch { flash("Couldn't close attendance.", "warn"); }
    finally { setClosing(false); }
  }

  if (loading) return <div style={s.wrap}><p style={s.muted}>Loading…</p></div>;

  // Event picker (0 or >1 events today).
  if (!eventId) {
    return (
      <div style={s.wrap}>
        {!isKiosk && <button onClick={goBack} style={s.back}><ArrowLeft size={16} /> Back</button>}
        <h1 style={s.h1}>FLL Attendance</h1>
        {events.length === 0 ? (
          <div style={s.card}>
            <p style={s.muted}>No FLL quick-tracking events are scheduled for today.</p>
            <p style={s.hint}>Turn on “Enable Quick Tracking for FLL” when creating or editing the meeting event, then come back here.</p>
          </div>
        ) : (
          <div style={s.card}>
            <div style={s.cardTitle}>Pick tonight's event</div>
            {events.map((e) => (
              <button key={e.id} style={s.eventBtn} onClick={() => setEventId(e.id)}>
                <span style={{ fontWeight: 700 }}>{e.name}</span>
                <span style={s.muted}>
                  {e.checked_in ? `${e.checked_in} checked in` : ""}{e.checked_in && e.start_time ? " · " : ""}{e.start_time ? e.start_time.slice(0, 5) : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const teams = roster?.teams ?? [];
  // FLLe on the left, FLLc on the right (program ids 1 = Explore, 2 = Challenge).
  const explore = teams.filter((t) => t.program_id === 1);
  const challenge = teams.filter((t) => t.program_id === 2);

  // One member row — shared by the team cards (youth) and the single Mentors group.
  const renderMemberRow = (m: FllAttMember) => (
    <div key={m.member_id} style={{ ...s.memberRow, ...(m.state === "in" ? s.rowIn : m.state === "out" ? s.rowOut : {}) }}>
      <span style={s.memberName}>
        {m.name}
        {m.member_type !== "youth" && <span style={s.adultTag}>{m.member_type}</span>}
      </span>
      <div style={s.boxes}>
        <label style={{ ...s.box, ...(m.state !== "none" ? s.boxOnIn : {}) }}>
          <input type="checkbox" style={s.checkbox} checked={m.state !== "none"} onChange={() => toggleIn(m)} />
          In
        </label>
        <label style={{ ...s.box, ...(m.state === "out" ? s.boxOnOut : {}), ...(m.state === "none" ? s.boxDisabled : {}) }}>
          <input type="checkbox" style={s.checkbox} checked={m.state === "out"} disabled={m.state === "none"} onChange={() => toggleOut(m)} />
          Out
        </label>
      </div>
    </div>
  );

  // Team cards show YOUTH only; adults are grouped once below (an adult can be on several teams).
  const renderTeam = (t: typeof teams[number]) => {
    const youth = t.members.filter((m) => m.member_type === "youth");
    if (youth.length === 0) return null;
    const here = youth.filter((m) => m.state === "in").length;
    return (
      <div key={t.team_season_id} style={s.card}>
        <div style={s.teamHead}>
          <span style={s.teamName}>{t.team_name}</span>
          <span style={s.muted}><Users size={12} style={{ verticalAlign: "-2px" }} /> {here}</span>
        </div>
        {youth.map(renderMemberRow)}
      </div>
    );
  };

  // All adults across every FLL team, deduped by member — so an adult on multiple teams
  // appears (and can be checked in) exactly once.
  const adultMap = new Map<number, FllAttMember>();
  teams.forEach((t) => t.members.forEach((m) => {
    if (m.member_type !== "youth" && !adultMap.has(m.member_id)) adultMap.set(m.member_id, m);
  }));
  const adults = [...adultMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const adultsHere = adults.filter((a) => a.state === "in").length;

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <div>
          {!isKiosk && <button onClick={goBack} style={s.back}><ArrowLeft size={16} /> Back</button>}
          <h1 style={s.h1}>FLL Attendance</h1>
          {roster && <p style={s.sub}>{roster.event.name}{events.length > 1 && (
            <button style={s.changeBtn} onClick={() => { setEventId(null); setRoster(null); }}>change event</button>
          )}</p>}
        </div>
        <div style={s.headerActions}>
          <label style={s.adultsToggle}>
            <input type="checkbox" checked={showAdults} onChange={(e) => setShowAdults(e.target.checked)} />
            Show adults
          </label>
          <button style={s.closeBtn} onClick={closeAttendance} disabled={closing}>
            <LogOut size={16} /> {closing ? "Closing…" : "Close attendance"}
          </button>
        </div>
      </div>

      {notice && (
        <div style={{ ...s.notice, ...(notice.kind === "warn" ? s.noticeWarn : s.noticeOk) }}>{notice.msg}</div>
      )}

      {teams.length === 0 && <div style={s.card}><p style={s.muted}>No FLL teams found for this season.</p></div>}

      {teams.length > 0 && (
        <div style={s.columns}>
          <div style={s.column}>
            <div style={s.colTitle}>FLL Explore</div>
            {explore.length ? explore.map(renderTeam) : <p style={s.colEmpty}>No Explore teams.</p>}
          </div>
          <div style={s.column}>
            <div style={s.colTitle}>FLL Challenge</div>
            {challenge.length ? challenge.map(renderTeam) : <p style={s.colEmpty}>No Challenge teams.</p>}
          </div>
        </div>
      )}

      {showAdults && adults.length > 0 && (
        <div style={{ ...s.card, marginTop: 4 }}>
          <div style={s.teamHead}>
            <span style={s.teamName}>Mentors</span>
            <span style={s.muted}><Users size={12} style={{ verticalAlign: "-2px" }} /> {adultsHere}</span>
          </div>
          <div style={s.mentorGrid}>
            {adults.map(renderMemberRow)}
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1120, margin: "0 auto", padding: "8px 4px 40px" },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" },
  column: { minWidth: 0 },
  colTitle: { fontSize: 13, fontWeight: 800, color: "#1565c0", textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 8px 2px" },
  colEmpty: { fontSize: 13, color: "#aaa", margin: "0 0 12px 2px" },
  mentorGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", columnGap: 16 },
  back: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4, padding: 0, marginBottom: 6 },
  h1: { margin: 0, fontSize: 28, fontWeight: 800, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 15, color: "#555", fontWeight: 600 },
  hint: { fontSize: 13, color: "#888" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  headerActions: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  adultsToggle: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600, color: "#1a3a5c", cursor: "pointer" },
  closeBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "#fff", color: "#b23b00", border: "1px solid #f0c9a8", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 },
  changeBtn: { marginLeft: 10, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, textDecoration: "underline" },
  notice: { padding: "10px 14px", borderRadius: 10, fontSize: 14, fontWeight: 600, marginBottom: 12 },
  noticeWarn: { background: "#fff4e5", color: "#8a4b00", border: "1px solid #f0d6a8" },
  noticeOk: { background: "#eaf6ea", color: "#256029", border: "1px solid #bfe0bf" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", marginBottom: 10 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 },
  eventBtn: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "14px 16px", marginBottom: 8, background: "#f6f9fc", border: "1px solid #d7e3f0", borderRadius: 10, cursor: "pointer", fontSize: 16 },
  teamHead: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 4, marginBottom: 2, borderBottom: "2px solid #eef2f6" },
  teamName: { fontSize: 15, fontWeight: 800, color: "#1a3a5c" },
  muted: { fontSize: 12, color: "#8a97a6" },
  memberRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, padding: "2px 6px", borderRadius: 6, borderBottom: "1px solid #f2f5f8" },
  rowIn: { background: "#f0f8ff" },
  rowOut: { background: "#f4f8f2" },
  memberName: { fontSize: 14, color: "#243b52", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  adultTag: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#7a6", background: "#eef4ea", borderRadius: 5, padding: "1px 5px", flexShrink: 0 },
  boxes: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  box: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 9px", minWidth: 52, justifyContent: "center", border: "1.5px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#5a6b7b", userSelect: "none" },
  boxOnIn: { background: "#e3f0ff", borderColor: "#7fb0e6", color: "#1565c0" },
  boxOnOut: { background: "#e6f4e6", borderColor: "#8ec48e", color: "#2e7d32" },
  boxDisabled: { opacity: 0.5, cursor: "not-allowed" },
  checkbox: { width: 17, height: 17, cursor: "inherit", flexShrink: 0 },
};
