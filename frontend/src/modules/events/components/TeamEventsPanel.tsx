/**
 * TeamEventsPanel — embedded on the team profile.
 *
 * Always scoped to events this team was tagged on. Two checkboxes:
 *   All Season Events  → include past events too (the whole season), not just upcoming
 *   Sort by Category   → group by category instead of a flat date-ordered list
 * They combine freely.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { eventsApi, type TeamEvent } from "../api";
import { Calendar, Clock, MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { splitByWindow } from "./eventWindow";

// Display order + color for known categories. Unknown categories fall through.
const CATEGORY_ORDER = ["Outreach Event", "League Meet", "League Tournament"];
const CATEGORY_COLORS: Record<string, string> = {
  "Outreach Event": "#2e7d32", "League Meet": "#1565c0", "League Tournament": "#6a1b9a",
};

export default function TeamEventsPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const navigate = useNavigate();
  const [events, setEvents] = useState<TeamEvent[] | null>(null);
  const [byCategory, setByCategory] = useState(false);
  const [allSeason, setAllSeason] = useState(false);
  const [showLater, setShowLater] = useState(false);

  useEffect(() => {
    // "All Season Events" includes past events; otherwise upcoming only.
    // "Sort by Category" only changes grouping, not which events are shown.
    setEvents(null);
    eventsApi.getTeamEvents(teamSeasonId, allSeason)
      .then(setEvents).catch(() => setEvents([]));
  }, [teamSeasonId, allSeason]);

  const controls = (
    <div style={st.controls}>
      <label style={st.check}>
        <input type="checkbox" checked={allSeason} onChange={(e) => setAllSeason(e.target.checked)} />
        All Season Events
      </label>
      <label style={st.check}>
        <input type="checkbox" checked={byCategory} onChange={(e) => setByCategory(e.target.checked)} />
        Sort by Category
      </label>
    </div>
  );

  let body: React.ReactNode;
  if (events === null) {
    body = <p style={st.muted}>Loading…</p>;
  } else if (events.length === 0) {
    body = <p style={st.muted}>{
      allSeason ? "No events assigned to this team this season."
        : "No upcoming events assigned to this team."
    }</p>;
  } else if (byCategory) {
    // Group by category, ordered by CATEGORY_ORDER then alphabetically.
    const cats = Array.from(new Set(events.map((e) => e.category))).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    body = (
      <div style={st.wrap}>
        {cats.map((cat) => {
          const color = CATEGORY_COLORS[cat] ?? "#546e7a";
          const list = events.filter((e) => e.category === cat);
          return (
            <div key={cat}>
              <div style={{ ...st.catHead, color }}>{cat}s<span style={st.catCount}>{list.length}</span></div>
              <div style={st.list}>
                {list.map((e) => <EventRow key={e.event_id} e={e} color={color} onClick={() => navigate(`/events/${e.event_id}`)} />)}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (allSeason) {
    // Whole season (past + future): flat, date-ordered, no collapsing.
    body = (
      <div style={st.list}>
        {events.map((e) => {
          const color = CATEGORY_COLORS[e.category] ?? "#546e7a";
          return <EventRow key={e.event_id} e={e} color={color} onClick={() => navigate(`/events/${e.event_id}`)} />;
        })}
      </div>
    );
  } else {
    // Upcoming: show this week + next week; collapse the rest behind a toggle.
    const { near, later } = splitByWindow(events);
    const renderRow = (e: TeamEvent) => {
      const color = CATEGORY_COLORS[e.category] ?? "#546e7a";
      return <EventRow key={e.event_id} e={e} color={color} onClick={() => navigate(`/events/${e.event_id}`)} />;
    };
    body = (
      <div style={st.list}>
        {near.length === 0 && later.length > 0 && (
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
      </div>
    );
  }

  return <div style={st.container}>{controls}{body}</div>;
}

function EventRow({ e, color, onClick }: { e: TeamEvent; color: string; onClick: () => void }) {
  const start = new Date(e.event_date + "T00:00:00");
  const end = e.end_date ? new Date(e.end_date + "T00:00:00") : null;
  return (
    <div style={st.row} onClick={onClick}>
      <div style={{ ...st.date, borderColor: color }}>
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
    </div>
  );
}

const va: React.CSSProperties = { verticalAlign: "-1px", marginRight: 2 };

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${ampm}`;
}

const st: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 12 },
  controls: { display: "flex", gap: 18, flexWrap: "wrap", paddingBottom: 10, borderBottom: "1px solid #eef1f5" },
  check: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#555", cursor: "pointer" },
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  wrap: { display: "flex", flexDirection: "column", gap: 16 },
  catHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  catCount: { background: "#f0f4f8", color: "#555", borderRadius: 10, padding: "0 7px", fontSize: 11 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8, cursor: "pointer" },
  date: { textAlign: "center", background: "#f8fafc", border: "1px solid", borderRadius: 8, padding: "6px 10px", minWidth: 46, flexShrink: 0 },
  dateMon: { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase" },
  dateDay: { fontSize: 18, fontWeight: 900, color: "#1a3a5c", lineHeight: 1 },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  meta: { display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 11, color: "#888", marginTop: 2 },
  laterToggle: { display: "flex", alignItems: "center", gap: 5, alignSelf: "flex-start", background: "#f4f6f9", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: "#556", cursor: "pointer", marginTop: 2 },
};
