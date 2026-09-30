import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sponsorsApi, money, type SponsorReminder } from "../api";
import { Handshake } from "lucide-react";

/** Dashboard banner: sponsor contributions pledged but not yet received. */
export default function SponsorRemindersBanner() {
  const navigate = useNavigate();
  const [items, setItems] = useState<SponsorReminder[]>([]);
  useEffect(() => { sponsorsApi.reminders().then(setItems).catch(() => setItems([])); }, []);
  if (items.length === 0) return null;

  return (
    <div style={st.wrap}>
      <div style={st.head}><Handshake size={15} /> Sponsor pledges awaiting receipt</div>
      {items.slice(0, 5).map((r) => (
        <div key={r.contribution_id} style={st.row} onClick={() => navigate(`/sponsors/${r.sponsor_id}`)}>
          <span style={st.name}>{r.sponsor_name}</span>
          <span style={st.amt}>{r.in_kind ? "in-kind " : ""}{money(r.amount)}{r.pledge_date ? ` · pledged ${r.pledge_date}` : ""}</span>
        </div>
      ))}
      {items.length > 5 && <div style={st.more} onClick={() => navigate("/sponsors")}>+{items.length - 5} more…</div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { background: "#e7f3f0", border: "1px solid #a8d5c9", borderRadius: 8, padding: "10px 14px", marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: "#00695c", marginBottom: 6 },
  row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", cursor: "pointer", fontSize: 13, borderTop: "1px solid #c3e3da" },
  name: { color: "#1a3a5c", fontWeight: 600 },
  amt: { color: "#00695c", whiteSpace: "nowrap" },
  more: { fontSize: 12, color: "#00695c", cursor: "pointer", paddingTop: 6, borderTop: "1px solid #c3e3da" },
};
