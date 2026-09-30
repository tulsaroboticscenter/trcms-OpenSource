import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { planningApi, type TeamRole, type MemberBrief } from "../api";
import { Plus, Trash2, Pencil, Check, X, Users, GripVertical } from "lucide-react";

/**
 * Team Member Roles (#127). Team-leader-defined roles for a team/season (Design
 * Lead, Build Team…), with member assignment. Separate from admin system roles;
 * usable to assign Season Plan activities.
 */
export default function TeamRolesPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { canWrite } = useAuth();
  const canManage = canWrite("planning.manage");
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const [members, setMembers] = useState<MemberBrief[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const load = useCallback(() => { planningApi.teamRoles(teamSeasonId).then(setRoles).catch(() => setRoles([])); }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { planningApi.teamMembers(teamSeasonId).then(setMembers).catch(() => {}); }, [teamSeasonId]);

  async function addRole() {
    if (!newName.trim()) return;
    setRoles(await planningApi.createTeamRole(teamSeasonId, { name: newName.trim() }));
    setNewName(""); setAdding(false);
  }

  // Drag to reorder. Dropping reorders locally for an instant result, then persists;
  // a failed save reloads the server's order so the list never lies.
  async function drop(targetId: number) {
    const from = roles.findIndex((r) => r.id === dragId);
    const to = roles.findIndex((r) => r.id === targetId);
    setDragId(null); setOverId(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...roles];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRoles(next);
    try { setRoles(await planningApi.reorderTeamRoles(teamSeasonId, next.map((r) => r.id))); }
    catch { load(); }
  }

  const dragProps = (id: number) => canManage && editing === null ? {
    draggable: true,
    onDragStart: () => setDragId(id),
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (overId !== id) setOverId(id); },
    onDrop: () => drop(id),
    onDragEnd: () => { setDragId(null); setOverId(null); },
  } : {};

  return (
    <div>
      <p style={st.intro}>Team-specific roles (Design Lead, Build Team, Programmer…) that the team leader defines — separate from system roles. Assign members here, then assign Season Plan activities to a role.{canManage && roles.length > 1 && " Drag the handle to reorder."}</p>

      {roles.length === 0 && !adding && <p style={st.muted}>No team roles yet.{canManage && " Add the roles your team uses."}</p>}

      <div style={st.list}>
        {roles.map((r) => (
          <div key={r.id} {...dragProps(r.id)}
            style={{ ...(dragId === r.id ? st.dragging : {}), ...(overId === r.id && dragId !== r.id ? st.dropTarget : {}) }}>
            <RoleCard role={r} members={members} canManage={canManage}
              draggable={canManage && editing === null}
              editing={editing === r.id} onEdit={() => setEditing(r.id)} onDone={() => setEditing(null)}
              onChanged={(rows) => { setRoles(rows); setEditing(null); }}
              onDelete={async () => { if (confirm(`Delete role "${r.name}"?`)) { await planningApi.deleteTeamRole(r.id); load(); } }} />
          </div>
        ))}
      </div>

      {canManage && (adding ? (
        <div style={st.addRow}>
          <input style={st.input} autoFocus placeholder="Role name (e.g. Design Lead)" value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addRole(); }} />
          <button style={st.saveBtn} onClick={addRole}>Add</button>
          <button style={st.cancelBtn} onClick={() => { setAdding(false); setNewName(""); }}>Cancel</button>
        </div>
      ) : (
        <button style={st.addBtn} onClick={() => setAdding(true)}><Plus size={14} /> Add Role</button>
      ))}
    </div>
  );
}

function RoleCard({ role, members, canManage, draggable, editing, onEdit, onDone, onChanged, onDelete }: {
  role: TeamRole; members: MemberBrief[]; canManage: boolean; draggable: boolean; editing: boolean;
  onEdit: () => void; onDone: () => void; onChanged: (rows: TeamRole[]) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [sel, setSel] = useState<number[]>(role.members.map((m) => m.member_id));
  useEffect(() => { setName(role.name); setSel(role.members.map((m) => m.member_id)); }, [role, editing]);
  const toggle = (id: number) => setSel((l) => l.includes(id) ? l.filter((x) => x !== id) : [...l, id]);

  async function save() {
    onChanged(await planningApi.updateTeamRole(role.id, { name: name.trim() || role.name, member_ids: sel }));
  }

  if (!editing) {
    return (
      <div style={st.card}>
        <div style={st.cardHead}>
          {draggable && <span style={st.grip} title="Drag to reorder"><GripVertical size={14} /></span>}
          <span style={st.roleName}>{role.name}</span>
          <span style={st.count}><Users size={11} /> {role.members.length}</span>
          {canManage && (
            <div style={st.actions}>
              <button style={st.icon} onClick={onEdit}><Pencil size={13} /></button>
              <button style={{ ...st.icon, color: "#c62828" }} onClick={onDelete}><Trash2 size={13} /></button>
            </div>
          )}
        </div>
        <div style={st.memberChips}>
          {role.members.length === 0 ? <span style={st.muted}>No members assigned.</span>
            : role.members.map((m) => <span key={m.member_id} style={st.memChip}>{m.name}</span>)}
        </div>
      </div>
    );
  }

  return (
    <div style={st.card}>
      <div style={st.cardHead}>
        <input style={st.input} value={name} onChange={(e) => setName(e.target.value)} />
        <div style={st.actions}>
          <button style={{ ...st.icon, color: "#2e7d32" }} onClick={save}><Check size={15} /></button>
          <button style={st.icon} onClick={onDone}><X size={15} /></button>
        </div>
      </div>
      <div style={st.chips}>
        {members.map((m) => (
          <button key={m.member_id} type="button" style={{ ...st.chip, ...(sel.includes(m.member_id) ? st.chipOn : {}) }} onClick={() => toggle(m.member_id)}>{m.name}</button>
        ))}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  intro: { fontSize: 13, color: "#667", margin: "0 0 12px", lineHeight: 1.5 },
  muted: { fontSize: 13, color: "#aaa", margin: "4px 0" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  card: { border: "1px solid #eef1f5", borderRadius: 9, background: "#fff", padding: "10px 12px" },
  cardHead: { display: "flex", alignItems: "center", gap: 8 },
  grip: { display: "inline-flex", color: "#b0bcc9", cursor: "grab", marginLeft: -3 },
  dragging: { opacity: 0.45 },
  dropTarget: { outline: "2px dashed #1565c0", outlineOffset: 2, borderRadius: 10 },
  roleName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  count: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11.5, color: "#778", background: "#f0f4f8", borderRadius: 10, padding: "1px 8px" },
  actions: { marginLeft: "auto", display: "flex", gap: 4 },
  icon: { background: "none", border: "1px solid #e2e8f0", borderRadius: 7, padding: 5, cursor: "pointer", color: "#888", display: "inline-flex" },
  memberChips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  memChip: { fontSize: 12, color: "#37474f", background: "#eceff1", borderRadius: 12, padding: "2px 10px" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { padding: "5px 11px", border: "1px solid #cdd7e3", background: "#fff", color: "#556", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  chipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  addRow: { display: "flex", gap: 8, marginTop: 12 },
  input: { flex: 1, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, marginTop: 12, padding: "8px 14px", background: "#fff", color: "#1565c0", border: "1px dashed #90caf9", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  saveBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
  cancelBtn: { padding: "8px 14px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
};
