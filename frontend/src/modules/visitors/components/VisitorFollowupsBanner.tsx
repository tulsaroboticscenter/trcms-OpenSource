import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { visitorsApi, type VisitorFollowup } from "../api";
import { Clock } from "lucide-react";

/** Dashboard banner: prospect follow-ups that are due or coming up. */
export default function VisitorFollowupsBanner() {
  const navigate = useNavigate();
  const [items, setItems] = useState<VisitorFollowup[]>([]);
  useEffect(() => { visitorsApi.followups().then(setItems).catch(() => setItems([])); }, []);
  const today = new Date().toISOString().slice(0, 10);
  const due = items.filter((i) => i.next_follow_up_date <= today);
  if (items.length === 0) return null;

  return (
    <div style={st.wrap}>
      <div style={st.head}><Clock size={15} /> Prospect follow-ups{due.length > 0 ? ` · ${due.length} due` : ""}</div>
      {items.slice(0, 5).map((i) => {
        const overdue = i.next_follow_up_date <= today;
        return (
          <div key={i.id} style={st.row} onClick={() => navigate(`/visitors/${i.id}`)}>
            <span style={st.name}>{i.name}</span>
            <span style={{ ...st.when, color: overdue ? "#c62828" : "#e65100" }}>
              {overdue ? "due " : "by "}{i.next_follow_up_date}{i.owner_name ? ` · ${i.owner_name}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { background: "#fff5e6", border: "1px solid #ffd699", borderRadius: 8, padding: "10px 14px", marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#b26a00", marginBottom: 6 },
  row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", cursor: "pointer", fontSize: 13, borderTop: "1px solid #ffe6bf" },
  name: { color: "#1a3a5c", fontWeight: 600 },
  when: { whiteSpace: "nowrap", fontWeight: 600 },
};
