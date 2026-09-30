import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UsersRound, Plus } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";
import { groupsApi, type GroupSummary } from "../api";

export default function GroupsList() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canManage = canWrite("groups.manage");
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  async function load() { setLoading(true); setGroups(await groupsApi.list()); setLoading(false); }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!name.trim()) return;
    const g = await groupsApi.create({ name, description: desc || undefined });
    setAdding(false); setName(""); setDesc("");
    navigate(`/groups/${g.id}`);
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={s.head}>
        <h1 style={s.h1}><UsersRound size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Groups</h1>
        {canManage && <button style={s.new} onClick={() => setAdding(true)}><Plus size={15} /> New group</button>}
      </div>
      <p style={s.sub}>Member groups like the YLC, committees, or crews. A group's upcoming events show on its page and on each member's dashboard.</p>

      {adding && (
        <div style={s.createCard}>
          <input style={s.in} placeholder="Group name (e.g. YLC)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <input style={s.in} placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button style={s.save} onClick={create}>Create</button>
          <button style={s.cancel} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      {loading ? <p style={s.muted}>Loading…</p> : groups.length === 0 ? <p style={s.muted}>No groups yet.</p> : (
        <div style={s.list}>
          {groups.map((g) => (
            <button key={g.id} style={s.row} onClick={() => navigate(`/groups/${g.id}`)}>
              <div>
                <div style={s.name}>{g.name}{!g.is_active && <span style={s.inactive}>inactive</span>}</div>
                {g.description && <div style={s.desc}>{g.description}</div>}
              </div>
              <span style={s.count}>{g.member_count} member{g.member_count !== 1 ? "s" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  new: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13.5, margin: "0 0 16px" },
  createCard: { display: "flex", gap: 8, alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: 12, marginBottom: 14, flexWrap: "wrap" },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5 },
  save: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  cancel: { padding: "8px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, cursor: "pointer" },
  muted: { color: "#889", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "13px 16px", cursor: "pointer", textAlign: "left", width: "100%" },
  name: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  inactive: { marginLeft: 8, fontSize: 11, color: "#889", background: "#f1f3f5", padding: "1px 8px", borderRadius: 9 },
  desc: { fontSize: 12.5, color: "#667", marginTop: 3 },
  count: { fontSize: 12.5, color: "#667", whiteSpace: "nowrap" },
};
