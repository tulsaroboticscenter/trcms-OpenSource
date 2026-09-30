import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, Users, Pencil, Trash2, NotebookPen } from "lucide-react";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { groupsApi, type Group } from "../api";
import { useGoBack } from "../../../core/useGoBack";

interface MemberOpt { id: number; first_name: string; last_name: string; }

// Fallback position titles when a group hasn't defined its own. Each group can carry
// its own list (e.g. the Program Team uses Executive Director / Program Director / …),
// edited on this page. Officers can, for example, lock the group's meeting minutes.
const DEFAULT_POSITIONS = ["President", "Vice President", "Secretary", "Treasurer", "Member"];

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack("/groups");
  const { canWrite } = useAuth();
  const canManage = canWrite("groups.manage");
  const [g, setG] = useState<Group | null>(null);
  const [editingMembers, setEditingMembers] = useState(false);
  const [allMembers, setAllMembers] = useState<MemberOpt[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [editingPositions, setEditingPositions] = useState(false);
  const [positionsText, setPositionsText] = useState("");

  const load = useCallback(async () => { setG(await groupsApi.get(Number(id))); }, [id]);
  useEffect(() => { load(); }, [load]);

  async function openMemberEditor() {
    if (allMembers.length === 0) {
      const r = await api.get("/api/v1/members/?is_active=true&limit=1000");
      setAllMembers(r.data.members ?? []);
    }
    setPicked(new Set((g?.members ?? []).map((m) => m.id)));
    setEditingMembers(true);
  }
  async function saveMembers() { setG(await groupsApi.setMembers(Number(id), [...picked], currentPositions())); setEditingMembers(false); }
  // Positions are kept alongside the member list; preserve them across a member-list save.
  function currentPositions(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const m of g?.members ?? []) if (m.role) out[m.id] = m.role;
    return out;
  }
  async function setPosition(memberId: number, role: string) {
    const ids = (g?.members ?? []).map((m) => m.id);
    const positions = currentPositions();
    if (role) positions[memberId] = role; else delete positions[memberId];
    setG(await groupsApi.setMembers(Number(id), ids, positions));
  }
  async function remove() {
    if (!confirm(`Delete the group "${g!.name}"?`)) return;
    await groupsApi.remove(Number(id)); navigate("/groups");
  }
  function openPositionEditor() {
    setPositionsText((g?.position_options?.length ? g.position_options : DEFAULT_POSITIONS).join("\n"));
    setEditingPositions(true);
  }
  async function savePositions() {
    const opts = positionsText.split("\n").map((t) => t.trim()).filter(Boolean);
    setG(await groupsApi.update(Number(id), { position_options: opts }));
    setEditingPositions(false);
  }

  if (!g) return <p style={{ padding: 20, color: "#889" }}>Loading…</p>;
  const positionOptions = g.position_options?.length ? g.position_options : DEFAULT_POSITIONS;
  const filtered = allMembers.filter((m) => `${m.first_name} ${m.last_name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <button style={s.back} onClick={goBack}><ArrowLeft size={15} /> Groups</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.minutesBtn} onClick={() => navigate(`/minutes?group=${encodeURIComponent(g.name)}`)}>
            <NotebookPen size={14} /> Meeting Minutes
          </button>
          {canManage && <button style={s.del} onClick={remove}><Trash2 size={13} /> Delete</button>}
        </div>
      </div>

      <div style={s.card}>
        <h1 style={s.h1}>{g.name}</h1>
        {g.description && <div style={s.sub}>{g.description}</div>}
      </div>

      {/* Upcoming events */}
      <div style={s.card}>
        <div style={s.sectionH}><CalendarDays size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Upcoming events</div>
        {g.upcoming_events.length === 0 ? <p style={s.muted}>No upcoming events tied to this group. Tag an event to this group from the event's form.</p> : (
          <div>
            {g.upcoming_events.map((e) => (
              <button key={e.id} style={s.evRow} onClick={() => navigate(`/events/${e.id}`)}>
                <span style={s.evDate}>{e.event_date}</span>
                <span style={s.evName}>{e.name}</span>
                {e.location && <span style={s.evLoc}>{e.location}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Members */}
      <div style={s.card}>
        <div style={s.rowBetween}>
          <div style={s.sectionH}><Users size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Members ({g.members.length})</div>
          {canManage && !g.auto_managed && (
            <div style={{ display: "flex", gap: 8 }}>
              <button style={s.editBtn} onClick={openPositionEditor}><Pencil size={13} /> Edit position titles</button>
              <button style={s.editBtn} onClick={openMemberEditor}><Pencil size={13} /> Edit members</button>
            </div>
          )}
        </div>
        {g.auto_managed && (
          <p style={s.autoNote}>Membership is managed automatically from YLC roles — tag a youth as a YLC member (Roles page) and they appear here.</p>
        )}
        {g.members.length === 0 ? <p style={s.muted}>{g.auto_managed ? "No YLC members tagged yet." : "No members yet."}</p> :
          canManage && !g.auto_managed ? (
            <div style={s.memberRows}>
              {g.members.map((m) => (
                <div key={m.id} style={s.posRow}>
                  <span style={s.posName}>{m.name}</span>
                  <select style={s.posSelect} value={m.role ?? ""} onChange={(e) => setPosition(m.id, e.target.value)}>
                    <option value="">— position —</option>
                    {/* keep a member's existing title visible even if it's no longer in the list */}
                    {(m.role && !positionOptions.includes(m.role) ? [m.role, ...positionOptions] : positionOptions)
                      .map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              ))}
              <p style={s.posHint}>Set a member's position (used to identify officers — e.g. who can lock the board's minutes).</p>
            </div>
          ) : (
            <div style={s.chips}>
              {g.members.map((m) => <span key={m.id} style={s.chip}>{m.name}{m.role ? ` · ${m.role}` : ""}</span>)}
            </div>
          )}
      </div>

      {editingMembers && (
        <div style={s.overlay} onClick={() => setEditingMembers(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>Edit {g.name} members</h3>
            <input style={s.searchIn} placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div style={s.memberList}>
              {filtered.map((m) => {
                const on = picked.has(m.id);
                return (
                  <label key={m.id} style={{ ...s.memberRow, ...(on ? s.memberOn : {}) }}>
                    <input type="checkbox" checked={on} onChange={() => setPicked((p) => { const n = new Set(p); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} />
                    {m.first_name} {m.last_name}
                  </label>
                );
              })}
            </div>
            <div style={s.modalActions}>
              <span style={s.muted}>{picked.size} selected</span>
              <button style={s.cancel} onClick={() => setEditingMembers(false)}>Cancel</button>
              <button style={s.save} onClick={saveMembers}>Save</button>
            </div>
          </div>
        </div>
      )}

      {editingPositions && (
        <div style={s.overlay} onClick={() => setEditingPositions(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>{g.name} position titles</h3>
            <p style={s.muted}>One title per line — these are the options offered when assigning a member's position. Leave empty to use the defaults ({DEFAULT_POSITIONS.join(", ")}).</p>
            <textarea style={s.posTextarea} value={positionsText} onChange={(e) => setPositionsText(e.target.value)}
              placeholder={"Executive Director\nProgram Director\nAdmin Lead\nMentor\nTreasurer"} />
            <div style={s.modalActions}>
              <button style={s.cancel} onClick={() => setEditingPositions(false)}>Cancel</button>
              <button style={s.save} onClick={savePositions}>Save titles</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, padding: 0 },
  minutesBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  del: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #f0c2c2", color: "#c62828", borderRadius: 6, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginBottom: 14 },
  h1: { fontSize: 21, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { fontSize: 13.5, color: "#667", marginTop: 4 },
  sectionH: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  editBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, cursor: "pointer" },
  muted: { color: "#889", fontSize: 13.5, margin: "4px 0 0" },
  autoNote: { color: "#00695c", fontSize: 12.5, background: "#e0f2f1", border: "1px solid #b2dfdb", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px" },
  evRow: { display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", background: "none", border: "none", borderTop: "1px solid #f4f6fa", padding: "9px 2px", cursor: "pointer" },
  evDate: { fontSize: 12.5, color: "#1565c0", fontWeight: 600, minWidth: 92 },
  evName: { fontSize: 13.5, color: "#243", flex: 1 },
  evLoc: { fontSize: 12, color: "#889" },
  chips: { display: "flex", flexWrap: "wrap", gap: 7, marginTop: 4 },
  chip: { background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 14, padding: "4px 12px", fontSize: 12.5 },
  memberRows: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  posRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "#f7fafc", border: "1px solid #eef2f6", borderRadius: 8 },
  posName: { flex: 1, fontSize: 13.5, color: "#33475b" },
  posSelect: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, background: "#fff" },
  posHint: { fontSize: 11.5, color: "#9aa7b4", marginTop: 4 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: 24, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: 20, width: 460, maxWidth: "95vw", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" },
  modalH: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  searchIn: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box", marginBottom: 10 },
  posTextarea: { width: "100%", minHeight: 150, padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box", margin: "8px 0", fontFamily: "inherit", resize: "vertical" },
  memberList: { maxHeight: 320, overflowY: "auto", border: "1px solid #eef2f6", borderRadius: 8 },
  memberRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", fontSize: 13.5, color: "#243", borderBottom: "1px solid #f4f6fa", cursor: "pointer" },
  memberOn: { background: "#f5faf6" },
  modalActions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 },
  cancel: { padding: "8px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, cursor: "pointer" },
  save: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
};
