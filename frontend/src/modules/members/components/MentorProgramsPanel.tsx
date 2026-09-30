/**
 * MentorProgramsPanel — the program(s) a mentor supports (many-to-many).
 * Drives "program mentors" in group email. Read-only chips, with an inline
 * checklist editor for those who can edit other members.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "../../../core/api";
import { Pencil, Check, X } from "lucide-react";

interface Program { id: number; name: string; }

export default function MentorProgramsPanel({ memberId, canEdit }: { memberId: number; canEdit: boolean }) {
  const [supported, setSupported] = useState<Program[]>([]);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const s = await api.get(`/api/v1/members/${memberId}/programs-supported`).then(r => r.data as Program[]).catch(() => []);
    setSupported(s);
    setLoading(false);
  }, [memberId]);
  useEffect(() => { load(); }, [load]);

  async function startEdit() {
    if (allPrograms.length === 0) {
      const p = await api.get("/api/v1/programs/").then(r => r.data as Program[]).catch(() => []);
      setAllPrograms(p);
    }
    setDraft(new Set(supported.map(p => p.id)));
    setEditing(true);
  }
  function toggle(id: number) {
    setDraft(d => { const n = new Set(d); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  async function save() {
    setSaving(true);
    try {
      const s = await api.put(`/api/v1/members/${memberId}/programs-supported`, { program_ids: [...draft] }).then(r => r.data as Program[]);
      setSupported(s); setEditing(false);
    } finally { setSaving(false); }
  }

  if (loading) return <p style={st.muted}>Loading…</p>;

  if (editing) {
    return (
      <div>
        <p style={st.hint}>Select every program this mentor supports. Used to target program mentors in group emails.</p>
        <div style={st.grid}>
          {allPrograms.map(p => (
            <label key={p.id} style={st.check}><input type="checkbox" checked={draft.has(p.id)} onChange={() => toggle(p.id)} /> {p.name}</label>
          ))}
        </div>
        <div style={st.actions}>
          <button style={st.ghost} onClick={() => setEditing(false)}><X size={13} /> Cancel</button>
          <button style={st.primary} disabled={saving} onClick={save}><Check size={13} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {supported.length === 0
        ? <p style={st.muted}>No programs tagged yet.{canEdit ? " Click Edit to add." : ""}</p>
        : <div style={st.chips}>{supported.map(p => <span key={p.id} style={st.chip}>{p.name}</span>)}</div>}
      {canEdit && <button style={st.editBtn} onClick={startEdit}><Pencil size={12} /> Edit</button>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { color: "#888", fontSize: 13, margin: 0 },
  hint: { fontSize: 12, color: "#778", margin: "0 0 8px" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { fontSize: 12, fontWeight: 600, color: "#1565c0", background: "#e3f2fd", borderRadius: 12, padding: "2px 10px" },
  editBtn: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, padding: "5px 12px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", marginBottom: 10 },
  check: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334155", cursor: "pointer" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  ghost: { display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  primary: { display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
