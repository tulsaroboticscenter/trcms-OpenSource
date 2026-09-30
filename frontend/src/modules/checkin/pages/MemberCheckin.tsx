import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { activityApi } from "../../activity/api";
import { CalendarDays, ChevronRight, Users, LogIn, LogOut, Clock, X, UserCheck } from "lucide-react";

type FilterType = "all" | "youth" | "mentor" | "parent" | "volunteer";

interface TodayEvent {
  id: number;
  name: string;
  event_date: string;
  end_date?: string;
  start_time?: string;
  event_type?: string;
  location?: string;
  requires_logistics: boolean;
  attending_count: number;
  checkin_count: number;
}

interface ActiveCheckin {
  checkin_id: number;
  member_id: number;
  first_name: string;
  last_name: string;
  member_type: string;
  member_number?: string;
  photo_url?: string;
  event_id: number | null;
  event_name: string | null;
  time_in: string;
}

const TYPE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#6a1b9a", parent: "#2e7d32", volunteer: "#e65100",
};

function elapsedSince(iso: string): string {
  const start = new Date(iso).getTime();
  if (isNaN(start)) return "";
  const mins = Math.max(0, Math.round((Date.now() - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtTime(t?: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function MemberCheckin() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [message, setMessage] = useState<{ text: string; ok: boolean; warning?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [active, setActive] = useState<ActiveCheckin[]>([]);
  const [recentlyOut, setRecentlyOut] = useState<Set<number>>(new Set());
  const [confirmOut, setConfirmOut] = useState<{ memberId: number; name: string } | null>(null);
  const [eventPrompt, setEventPrompt] = useState<{ memberId: number; name: string } | null>(null);
  const [tagPrompt, setTagPrompt] = useState<{ checkinId: number; memberId: number; minutes: number } | null>(null);

  const loadActive = useCallback(() => {
    api.get("/api/v1/checkin/active")
      .then(({ data }) => setActive(data))
      .catch(() => {});
  }, []);

  const loadTodayEvents = useCallback(() => {
    api.get("/api/v1/checkin/today-events")
      .then(({ data }) => setTodayEvents(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTodayEvents();
    loadActive();
  }, [loadActive, loadTodayEvents]);

  // Kiosks stay open for days. Keep the "currently checked in" list fresh, and
  // when the local date rolls over, reload the day's events so a kiosk left
  // running overnight shows the new day's events (not yesterday's). (#108)
  useEffect(() => {
    let day = new Date().toDateString();
    const t = setInterval(() => {
      loadActive();
      const now = new Date().toDateString();
      if (now !== day) { day = now; loadTodayEvents(); }
    }, 60000);
    return () => clearInterval(t);
  }, [loadActive, loadTodayEvents]);

  async function searchMembers() {
    const params = new URLSearchParams({ limit: "200", is_active: "true" });
    if (search) params.set("search", search);
    if (filter !== "all") params.set("member_type", filter);
    const { data } = await api.get(`/api/v1/members/?${params}`);
    setMembers(data.members);
  }

  // Tapping a person currently checked in means a check-OUT — confirm first so
  // we don't inadvertently check people out. For a fresh check-IN, if there are
  // events running today, ask whether they're here for an event or general TRC.
  function tapMember(memberId: number, name: string) {
    if (activeIds.has(memberId)) { setConfirmOut({ memberId, name }); return; }
    if (todayEvents.length > 0) { setEventPrompt({ memberId, name }); return; }
    checkIn(memberId);
  }

  async function checkIn(memberId: number, eventId?: number | null) {
    setLoading(true);
    try {
      const { data } = await api.post("/api/v1/checkin/", { member_id: memberId, event_id: eventId ?? null });
      setMessage({ text: data.message, ok: data.ok, warning: data.grace_warning });
      setTimeout(() => setMessage(null), data.grace_warning ? 8000 : 4000);
      // Track status so the member card shows green (in) / red (just checked out).
      setRecentlyOut(prev => {
        const next = new Set(prev);
        if (data.action === "checked_out") next.add(memberId);
        else if (data.action === "checked_in") next.delete(memberId);
        return next;
      });
      loadActive();
      // After a checkout, optionally prompt for what they worked on.
      if (data.action === "checked_out" && data.tag_at_checkout && data.checkin_id) {
        setTagPrompt({ checkinId: data.checkin_id, memberId, minutes: data.minutes ?? 0 });
      }
    } finally {
      setLoading(false);
    }
  }

  const activeIds = new Set(active.map(a => a.member_id));

  // Group the currently-checked-in people by the event they're checked in to,
  // so it's clear who's here for (e.g.) Summer Camp vs. just a general check-in.
  const activeGroups = (() => {
    const byKey = new Map<string, { key: string; label: string; isEvent: boolean; items: ActiveCheckin[] }>();
    for (const a of active) {
      const key = a.event_id != null ? `e${a.event_id}` : "none";
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          label: a.event_id != null ? (a.event_name ?? "Event") : "Not associated with an event",
          isEvent: a.event_id != null,
          items: [],
        });
      }
      byKey.get(key)!.items.push(a);
    }
    // Event groups first (alphabetical), the no-event group always last.
    return [...byKey.values()].sort((x, y) => {
      if (x.isEvent !== y.isEvent) return x.isEvent ? -1 : 1;
      return x.label.localeCompare(y.label);
    });
  })();

  const FILTERS: { label: string; value: FilterType }[] = [
    { label: "All",        value: "all" },
    { label: "Youth",      value: "youth" },
    { label: "Mentors",    value: "mentor" },
    { label: "Parents",    value: "parent" },
    { label: "Volunteers", value: "volunteer" },
  ];

  return (
    <div>
      <h1 style={styles.heading}>Member Check-In</h1>

      {message && (
        <>
          <div style={{ ...styles.toast, background: message.ok ? "#2e7d32" : "#c62828" }}>
            {message.text}
          </div>
          {message.warning && (
            <div style={styles.graceToast}>⏳ {message.warning}</div>
          )}
        </>
      )}

      {/* ── Currently Checked In ───────────────────────────────── */}
      <div style={styles.activeSection}>
        <div style={styles.eventsSectionHeader}>
          <UserCheck size={16} color="#2e7d32" />
          <span style={styles.eventsSectionTitle}>Currently Checked In</span>
          <span style={styles.activeCount}>{active.length}</span>
        </div>
        {active.length === 0 ? (
          <p style={styles.activeEmpty}>No one is checked in right now.</p>
        ) : (
          <div style={styles.activeGroups}>
            {activeGroups.map(g => (
              <div key={g.key} style={styles.activeGroup}>
                <div style={styles.activeGroupHeader}>
                  {g.isEvent
                    ? <CalendarDays size={14} color="#1565c0" />
                    : <UserCheck size={14} color="#607d8b" />}
                  <span style={{ ...styles.activeGroupTitle, color: g.isEvent ? "#1a3a5c" : "#607d8b" }}>{g.label}</span>
                  <span style={styles.activeGroupCount}>{g.items.length}</span>
                </div>
                <div style={styles.activeList}>
                  {g.items.map(a => (
                    <button
                      key={a.checkin_id}
                      style={styles.activeCard}
                      title="Click to check out"
                      onClick={() => setConfirmOut({ memberId: a.member_id, name: `${a.first_name} ${a.last_name}` })}
                      disabled={loading}
                    >
                      <div style={styles.activeAvatar}>
                        {a.photo_url
                          ? <img src={a.photo_url} style={styles.avatarImg} alt="" />
                          : <span>{a.first_name[0]}{a.last_name[0]}</span>}
                      </div>
                      <div style={styles.activeInfo}>
                        <div style={styles.activeName}>{a.first_name} {a.last_name}</div>
                        <div style={styles.activeMeta}>
                          <span style={{ ...styles.typeDot, background: TYPE_COLORS[a.member_type] ?? "#607d8b" }}>{a.member_type}</span>
                          <span>#{a.member_number}</span>
                        </div>
                      </div>
                      <div style={styles.activeElapsed}>
                        <Clock size={12} color="#2e7d32" />
                        <span>{elapsedSince(a.time_in)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Today's Events ─────────────────────────────────────── */}
      {todayEvents.length > 0 && (
        <div style={styles.eventsSection}>
          <div style={styles.eventsSectionHeader}>
            <CalendarDays size={16} color="#1a3a5c" />
            <span style={styles.eventsSectionTitle}>Today's Events</span>
          </div>
          <div style={styles.eventsList}>
            {todayEvents.map(ev => (
              <button
                key={ev.id}
                style={styles.eventCard}
                onClick={() => navigate(`/checkin/event/${ev.id}`)}
              >
                <div style={styles.eventCardLeft}>
                  <span style={styles.eventTypeBadge}>{ev.event_type ?? "Event"}</span>
                  <span style={styles.eventCardName}>{ev.name}</span>
                  <span style={styles.eventCardMeta}>
                    {fmtTime(ev.start_time)}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </span>
                </div>
                <div style={styles.eventCardRight}>
                  <div style={styles.eventStat}>
                    <Users size={13} color="#555" />
                    <span>{ev.attending_count} attending</span>
                  </div>
                  <div style={styles.eventStat}>
                    <LogIn size={13} color="#2e7d32" />
                    <span style={{ color: "#2e7d32", fontWeight: 700 }}>{ev.checkin_count} checked in</span>
                  </div>
                  <ChevronRight size={18} color="#1a3a5c" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── General / Walk-In Check-In ─────────────────────────── */}
      <div style={styles.generalHeader}>
        <span style={styles.generalTitle}>General / Walk-In Check-In</span>
        <span style={styles.generalSub}>Search for a member and click their card to check in or out</span>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.filters}>
          {FILTERS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              style={{ ...styles.filterBtn, ...(filter === value ? styles.filterBtnActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={styles.searchRow}>
          <input
            style={styles.input}
            placeholder="Search by name or member ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchMembers()}
          />
          <button style={styles.searchBtn} onClick={searchMembers}>Search</button>
        </div>
      </div>

      <div style={styles.grid}>
        {members.map((m) => {
          const isIn = activeIds.has(m.id);
          const isOut = recentlyOut.has(m.id);
          const cardStyle = isIn ? styles.cardIn : isOut ? styles.cardOut : {};
          return (
            <button key={m.id} style={{ ...styles.memberCard, ...cardStyle }} onClick={() => tapMember(m.id, `${m.first_name} ${m.last_name}`)} disabled={loading}>
              <div style={{ ...styles.avatar, ...(isIn ? { background: "#2e7d32" } : isOut ? { background: "#c62828" } : {}) }}>
                {m.photo_url
                  ? <img src={m.photo_url} style={styles.avatarImg} alt="" />
                  : <span>{m.first_name[0]}{m.last_name[0]}</span>
                }
              </div>
              <div style={styles.memberName}>{m.first_name} {m.last_name}</div>
              <div style={styles.memberNum}>#{m.member_number}</div>
              {isIn && <div style={styles.statusIn}>● Checked in</div>}
              {isOut && <div style={styles.statusOut}>● Checked out</div>}
            </button>
          );
        })}
      </div>
      {members.length === 0 && (
        <p style={styles.hint}>Enter a name or member ID above and press Search, or choose a filter and Search to see all members in that group.</p>
      )}

      {eventPrompt && (
        <div style={cm.overlay} onClick={() => setEventPrompt(null)}>
          <div style={cm.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...cm.icon, background: "#e8f0fe" }}><CalendarDays size={26} color="#1565c0" /></div>
            <h2 style={cm.title}>Check in {eventPrompt.name}</h2>
            <p style={cm.sub}>What are they here for today?</p>
            <div style={cm.eventList}>
              {todayEvents.map(ev => (
                <button key={ev.id} style={cm.eventOpt}
                  onClick={() => { const id = eventPrompt.memberId; setEventPrompt(null); checkIn(id, ev.id); }}>
                  <CalendarDays size={15} color="#1565c0" style={{ flexShrink: 0 }} />
                  <span style={cm.eventOptName}>{ev.name}</span>
                  {ev.start_time && <span style={cm.eventOptTime}>{fmtTime(ev.start_time)}</span>}
                </button>
              ))}
              <button style={cm.generalOpt}
                onClick={() => { const id = eventPrompt.memberId; setEventPrompt(null); checkIn(id, null); }}>
                <Users size={15} color="#555" style={{ flexShrink: 0 }} />
                <span style={cm.eventOptName}>General TRC (no event)</span>
              </button>
            </div>
            <button style={cm.eventCancel} onClick={() => setEventPrompt(null)}>Cancel</button>
          </div>
        </div>
      )}

      {confirmOut && (
        <div style={cm.overlay} onClick={() => setConfirmOut(null)}>
          <div style={cm.modal} onClick={(e) => e.stopPropagation()}>
            <div style={cm.icon}><LogOut size={28} color="#c62828" /></div>
            <h2 style={cm.title}>Check out {confirmOut.name}?</h2>
            <p style={cm.sub}>This ends their current check-in.</p>
            <div style={cm.actions}>
              <button style={cm.cancel} onClick={() => setConfirmOut(null)} autoFocus>Cancel</button>
              <button style={cm.confirm} onClick={() => { const id = confirmOut.memberId; setConfirmOut(null); checkIn(id); }}>
                <LogOut size={15} /> Check Out
              </button>
            </div>
          </div>
        </div>
      )}

      {tagPrompt && (
        <CheckoutTagModal
          checkinId={tagPrompt.checkinId}
          memberId={tagPrompt.memberId}
          minutes={tagPrompt.minutes}
          onClose={() => setTagPrompt(null)}
        />
      )}
    </div>
  );
}

const cm: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 16, padding: "26px 28px", width: "100%", maxWidth: 420, textAlign: "center", boxShadow: "0 10px 50px rgba(0,0,0,0.25)" },
  icon: { width: 60, height: 60, borderRadius: "50%", background: "#ffebee", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" },
  title: { margin: "0 0 4px", fontSize: 20, fontWeight: 800, color: "#1a3a5c" },
  sub: { margin: "0 0 20px", fontSize: 14, color: "#888" },
  actions: { display: "flex", gap: 10, justifyContent: "center" },
  cancel: { flex: 1, padding: "12px 16px", background: "#f0f4f8", border: "1px solid #d6dde6", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#1a3a5c" },
  confirm: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 16px", background: "#c62828", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 700 },
  eventList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  eventOpt: { display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", background: "#fff", border: "2px solid #dbe9ff", borderRadius: 12, cursor: "pointer", textAlign: "left", fontSize: 15 },
  generalOpt: { display: "flex", alignItems: "center", gap: 10, padding: "13px 14px", background: "#f8fafc", border: "2px solid #e2e8f0", borderRadius: 12, cursor: "pointer", textAlign: "left", fontSize: 15 },
  eventOptName: { flex: 1, fontWeight: 600, color: "#1a3a5c" },
  eventOptTime: { fontSize: 12, color: "#888" },
  eventCancel: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, textDecoration: "underline" },
};

function CheckoutTagModal({ checkinId, memberId, minutes, onClose }: {
  checkinId: number; memberId: number; minutes: number; onClose: () => void;
}) {
  const [areas, setAreas] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { activityApi.areas(memberId).then((a) => setAreas(a.areas)).catch(() => {}); }, [memberId]);

  async function pick(area: string) {
    setBusy(true);
    try { await activityApi.tagCheckout(checkinId, area, minutes || undefined); onClose(); }
    finally { setBusy(false); }
  }

  return (
    <div style={tm.overlay} onClick={onClose}>
      <div style={tm.modal} onClick={(e) => e.stopPropagation()}>
        <button style={tm.close} onClick={onClose}><X size={20} /></button>
        <div style={tm.icon}><Clock size={30} color="#ff8f00" /></div>
        <h2 style={tm.title}>What did you work on?</h2>
        <p style={tm.sub}>{minutes ? `${minutes} min` : "Your time"} — tap an area to log it, or skip.</p>
        <div style={tm.grid}>
          {areas.map((a) => (
            <button key={a} style={tm.area} disabled={busy} onClick={() => pick(a)}>{a}</button>
          ))}
        </div>
        <button style={tm.skip} onClick={onClose}>Skip</button>
      </div>
    </div>
  );
}

const tm: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 16, padding: "28px 30px", width: "100%", maxWidth: 520, textAlign: "center", position: "relative", boxShadow: "0 10px 50px rgba(0,0,0,0.25)" },
  close: { position: "absolute", top: 14, right: 14, background: "none", border: "none", cursor: "pointer", color: "#aaa" },
  icon: { width: 64, height: 64, borderRadius: "50%", background: "#fff3e0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" },
  title: { margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  sub: { margin: "0 0 18px", fontSize: 14, color: "#888" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 16 },
  area: { padding: "16px 12px", fontSize: 15, fontWeight: 600, color: "#1a3a5c", background: "#f0f4f8", border: "2px solid #dbe9ff", borderRadius: 12, cursor: "pointer" },
  skip: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, textDecoration: "underline" },
};

const styles: Record<string, React.CSSProperties> = {
  heading:              { margin: "0 0 1.5rem", fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  toast:                { padding: "1rem 1.5rem", borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 16, marginBottom: 16, textAlign: "center" },
  graceToast:           { padding: "10px 16px", background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 8, color: "#e65100", fontSize: 13, marginBottom: 12, lineHeight: 1.6 },

  activeSection:        { marginBottom: 28 },
  activeCount:          { background: "#2e7d32", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 12, padding: "1px 9px", minWidth: 20, textAlign: "center" },
  activeEmpty:          { color: "#888", fontSize: 13, margin: "4px 0 0" },
  activeGroups:         { display: "flex", flexDirection: "column", gap: 14 },
  activeGroup:          { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" },
  activeGroupHeader:    { display: "flex", alignItems: "center", gap: 7, marginBottom: 8 },
  activeGroupTitle:     { fontSize: 13, fontWeight: 700 },
  activeGroupCount:     { background: "#eef2f7", color: "#555", fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "1px 8px" },
  activeList:           { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 },
  activeCard:           { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff", border: "1px solid #c8e6c9", borderLeft: "3px solid #2e7d32", borderRadius: 10, cursor: "pointer", textAlign: "left" },
  activeAvatar:         { width: 38, height: 38, borderRadius: "50%", background: "#2e7d32", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, overflow: "hidden" },
  activeInfo:           { flex: 1, minWidth: 0 },
  activeName:           { fontSize: 14, fontWeight: 600, color: "#1a3a5c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  activeMeta:           { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#888", marginTop: 2 },
  typeDot:              { color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 5px", textTransform: "capitalize" },
  activeElapsed:        { display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: "#2e7d32", flexShrink: 0 },

  eventsSection:        { marginBottom: 28 },
  eventsSectionHeader:  { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  eventsSectionTitle:   { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  eventsList:           { display: "flex", flexDirection: "column", gap: 8 },
  eventCard:            { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#fff", border: "2px solid #dbe9ff", borderRadius: 12, cursor: "pointer", textAlign: "left", transition: "border-color 0.15s, box-shadow 0.15s", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  eventCardLeft:        { display: "flex", flexDirection: "column", gap: 3 },
  eventTypeBadge:       { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#1565c0" },
  eventCardName:        { fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  eventCardMeta:        { fontSize: 12, color: "#888" },
  eventCardRight:       { display: "flex", alignItems: "center", gap: 16 },
  eventStat:            { display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#555" },

  generalHeader:        { marginBottom: 12 },
  generalTitle:         { display: "block", fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  generalSub:           { display: "block", fontSize: 12, color: "#888", marginTop: 2 },

  toolbar:              { display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 },
  filters:              { display: "flex", gap: 8, flexWrap: "wrap" },
  filterBtn:            { padding: "8px 16px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 },
  filterBtnActive:      { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  searchRow:            { display: "flex", gap: 8 },
  input:                { flex: 1, padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 14 },
  searchBtn:            { padding: "10px 20px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  grid:                 { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 },
  memberCard:           { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 0.75rem", textAlign: "center", cursor: "pointer" },
  cardIn:               { background: "#f0fdf4", border: "1px solid #2e7d32" },
  cardOut:              { background: "#fef2f2", border: "1px solid #c62828" },
  statusIn:             { fontSize: 11, fontWeight: 700, color: "#2e7d32", marginTop: 4 },
  statusOut:            { fontSize: 11, fontWeight: 700, color: "#c62828", marginTop: 4 },
  avatar:               { width: 56, height: 56, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, margin: "0 auto 8px", overflow: "hidden" },
  avatarImg:            { width: "100%", height: "100%", objectFit: "cover" },
  memberName:           { fontWeight: 600, fontSize: 13, color: "#1a3a5c" },
  memberNum:            { fontSize: 11, color: "#888", marginTop: 2 },
  hint:                 { color: "#888", textAlign: "center", marginTop: 40, fontSize: 14 },
};
