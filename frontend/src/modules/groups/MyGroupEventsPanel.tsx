import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { groupsApi, type MyGroupEvent } from "./api";

/**
 * Dashboard widget: upcoming events from the groups the member belongs to (YLC,
 * committees, …). Renders nothing when they have none, so it's invisible to
 * members who aren't in any group.
 */
export default function MyGroupEventsPanel() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<MyGroupEvent[]>([]);

  useEffect(() => { groupsApi.myEvents().then(setEvents).catch(() => setEvents([])); }, []);
  if (events.length === 0) return null;

  return (
    <div style={s.card}>
      <div style={s.head}><CalendarDays size={15} /> Your group events</div>
      {events.map((e) => (
        <button key={`${e.group_id}-${e.id}`} style={s.row} onClick={() => navigate(`/events/${e.id}`)}>
          <span style={s.date}>{e.event_date}</span>
          <span style={s.name}>{e.name}</span>
          <span style={s.group}>{e.group_name}</span>
          {e.location && <span style={s.loc}>{e.location}</span>}
        </button>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 16, borderTop: "3px solid #5e35b1" },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  row: { display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid #f4f6fa", padding: "8px 2px", cursor: "pointer" },
  date: { fontSize: 12.5, color: "#5e35b1", fontWeight: 600, minWidth: 92 },
  name: { fontSize: 13.5, color: "#243", flex: 1 },
  group: { fontSize: 11.5, background: "#ede7f6", color: "#5e35b1", padding: "1px 8px", borderRadius: 9 },
  loc: { fontSize: 12, color: "#889" },
};
