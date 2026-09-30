import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { grantsApi, type GrantReminder } from "../api";
import { CalendarClock } from "lucide-react";

/** Dashboard banner: grants whose reminder date has arrived and still need action. */
export default function GrantRemindersBanner() {
  const navigate = useNavigate();
  const [items, setItems] = useState<GrantReminder[]>([]);
  useEffect(() => { grantsApi.reminders().then(setItems).catch(() => setItems([])); }, []);
  if (items.length === 0) return null;

  return (
    <div style={st.wrap}>
      <div style={st.head}><CalendarClock size={15} /> Grant reminders</div>
      {items.slice(0, 5).map((g) => {
        const when = g.remind_date ?? g.available_date;
        return (
          <div key={g.id} style={st.row} onClick={() => navigate(`/grants/${g.id}`)}>
            <span style={st.name}>{g.name}{g.funder_name ? ` · ${g.funder_name}` : ""}</span>
            <span style={st.when}>{g.available_date ? "available " : "remind "}{when}{g.remind_note ? ` — ${g.remind_note}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { background: "#e8f0fe", border: "1px solid #b3ccf5", borderRadius: 8, padding: "10px 14px", marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "5px 0", fontSize: 13, borderTop: "1px solid #d4e2fb" },
  name: { color: "#1a3a5c", fontWeight: 600, cursor: "pointer", flex: 1 },
  when: { color: "#1565c0", whiteSpace: "nowrap", cursor: "pointer" },
  done: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", border: "1px solid #a5d6a7", background: "#f1f9f1", color: "#1b5e20", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0 },
};
