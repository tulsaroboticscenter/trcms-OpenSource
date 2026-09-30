import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { membersApi, type ChildSummary } from "../api";
import { Users, Pencil, ChevronRight } from "lucide-react";

/**
 * "My Youth" — shown on a parent's dashboard. Lists the youth in the parent's
 * family, linking to each one's PROFILE.
 *
 * It used to jump straight to the youth-edit form, which meant a parent never saw
 * the profile at all — so the Medical tab (and every other pane) was unreachable
 * unless they happened to find the youth through the Members module. The profile
 * already carries an "Edit these details" button for a parent, so view-first with
 * edit one click away is both more discoverable and the safer default.
 */
export default function MyYouthPanel() {
  const navigate = useNavigate();
  const [kids, setKids] = useState<ChildSummary[] | null>(null);

  useEffect(() => {
    membersApi.myChildren().then(setKids).catch(() => setKids([]));
  }, []);

  if (!kids || kids.length === 0) return null;

  return (
    <div style={st.pane}>
      <div style={st.head}><Users size={15} /> My Youth</div>
      <div style={st.grid}>
        {kids.map((k) => (
          <button key={k.id} style={st.card} onClick={() => navigate(`/members/${k.id}`)}>
            <div style={st.avatar}>
              {k.photo_url ? <img src={k.photo_url} style={st.avatarImg} alt="" />
                : <span>{(k.first_name[0] ?? "")}{(k.last_name[0] ?? "")}</span>}
            </div>
            <div style={st.info}>
              <div style={st.name}>{k.first_name} {k.last_name}</div>
              <div style={st.edit}><Pencil size={11} /> View record</div>
            </div>
            <ChevronRight size={16} color="#bbb" />
          </button>
        ))}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  pane: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 },
  card: { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 9, cursor: "pointer", textAlign: "left" },
  avatar: { width: 42, height: 42, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, overflow: "hidden", flexShrink: 0 },
  avatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  edit: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#1565c0", marginTop: 2 },
};
