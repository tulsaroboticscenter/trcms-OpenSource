/**
 * MyUpcomingEventsPanel — embedded on a member's profile.
 * Lists upcoming events the member RSVP'd to as Attending or Maybe.
 * Events marked Not Attending (or with no response) are hidden.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { eventsApi, type MemberUpcomingEvent, type EarningsTodo } from "../api";
import { Calendar, Clock, MapPin, UserCheck, HelpCircle, DollarSign, ChevronDown, ChevronUp } from "lucide-react";
import ApplyEarningsModal from "./ApplyEarningsModal";
import { splitByWindow } from "./eventWindow";

export default function MyUpcomingEventsPanel({ memberId }: { memberId: number }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<MemberUpcomingEvent[] | null>(null);
  const [todo, setTodo] = useState<EarningsTodo[]>([]);
  const [applyFor, setApplyFor] = useState<EarningsTodo | null>(null);
  const [showLater, setShowLater] = useState(false);

  const loadTodo = useCallback(() => {
    eventsApi.earningsTodo(memberId).then(setTodo).catch(() => setTodo([]));
  }, [memberId]);
  useEffect(() => {
    eventsApi.getMemberUpcomingEvents(memberId).then(setEvents).catch(() => setEvents([]));
    loadTodo();
  }, [memberId, loadTodo]);

  if (events === null) return <p style={st.muted}>Loading…</p>;

  return (
    <div style={st.list}>
      {/* Earnings that need a team choice */}
      {todo.map((t) => (
        <div key={`todo-${t.event_id}`} style={st.applyBox}>
          <div style={st.applyText}>
            <DollarSign size={14} /> You earned funds at <strong>{t.event_name}</strong>. Choose which team(s) should receive them.
          </div>
          <button style={st.applyBtn} onClick={() => setApplyFor(t)}>Apply Earnings</button>
        </div>
      ))}

      {events.length === 0 && todo.length === 0 && <p style={st.muted}>No upcoming events marked as attending or maybe.</p>}

      {applyFor && (
        <ApplyEarningsModal
          eventId={applyFor.event_id}
          eventName={applyFor.event_name}
          memberId={memberId}
          onClose={() => setApplyFor(null)}
          onDone={() => loadTodo()}
        />
      )}
      {(() => {
        const { near, later } = splitByWindow(events);
        return (
          <>
            {events.length > 0 && near.length === 0 && later.length > 0 && (
              <p style={st.muted}>No events this week or next week.</p>
            )}
            {near.map(renderRow)}
            {later.length > 0 && (
              <>
                <button style={st.laterToggle} onClick={() => setShowLater((v) => !v)}>
                  {showLater ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {showLater ? "Hide" : "Show"} {later.length} later event{later.length === 1 ? "" : "s"}
                </button>
                {showLater && later.map(renderRow)}
              </>
            )}
          </>
        );
      })()}
    </div>
  );

  function renderRow(e: MemberUpcomingEvent) {
    const start = new Date(e.event_date + "T00:00:00");
    const end = e.end_date ? new Date(e.end_date + "T00:00:00") : null;
    const attending = e.rsvp_status === "Attending";
    return (
      <div key={e.event_id} style={st.row} onClick={() => navigate(`/events/${e.event_id}`)}>
        <div style={st.date}>
          <div style={st.dateMon}>{start.toLocaleDateString("en-US", { month: "short" })}</div>
          <div style={st.dateDay}>{start.getDate()}</div>
        </div>
        <div style={st.main}>
          <div style={st.name}>{e.name}</div>
          <div style={st.meta}>
            {end
              ? <span><Calendar size={11} style={va} /> through {end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              : <span><Calendar size={11} style={va} /> {start.toLocaleDateString("en-US", { weekday: "short" })}</span>}
            {e.start_time && <span><Clock size={11} style={va} /> {fmtTime(e.start_time)}</span>}
            {e.location && <span><MapPin size={11} style={va} /> {e.location}</span>}
          </div>
        </div>
        <span style={{ ...st.badge, ...(attending ? st.attending : st.maybe) }}>
          {attending ? <UserCheck size={11} /> : <HelpCircle size={11} />} {e.rsvp_status}
        </span>
      </div>
    );
  }
}

const va: React.CSSProperties = { verticalAlign: "-1px", marginRight: 2 };

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ampm}`;
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  applyBox: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8 },
  applyText: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#c62828", lineHeight: 1.4 },
  applyBtn: { flexShrink: 0, padding: "7px 14px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8, cursor: "pointer" },
  date: { textAlign: "center", background: "#f0f4f8", borderRadius: 8, padding: "6px 10px", minWidth: 46, flexShrink: 0 },
  dateMon: { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase" },
  dateDay: { fontSize: 18, fontWeight: 900, color: "#1a3a5c", lineHeight: 1 },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  meta: { display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 11, color: "#888", marginTop: 2 },
  badge: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, borderRadius: 12, padding: "3px 10px", flexShrink: 0 },
  attending: { color: "#2e7d32", background: "#e8f5e9" },
  maybe: { color: "#f57c00", background: "#fff8e1" },
  laterToggle: { display: "flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: "#f4f6f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: "#556", cursor: "pointer", marginTop: 2 },
};
