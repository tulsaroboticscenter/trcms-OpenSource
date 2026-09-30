import { useState, useEffect } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { reservationsApi, type ReservationResource } from "../api";
import { Settings, ArrowLeft, PlusCircle, DoorOpen, Wrench, Trash2 } from "lucide-react";

const blank = { name: "", kind: "room" as "room" | "equipment", is_active: true, is_hidden: false, display_order: 0, notes: "" };

export default function ReservationsAdmin() {
  const goBack = useGoBack("/reservations");
  const [resources, setResources] = useState<ReservationResource[]>([]);
  const [editing, setEditing] = useState<Partial<ReservationResource> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() { reservationsApi.resources(true).then(setResources).catch(() => setResources([])); }
  useEffect(load, []);

  async function save() {
    if (!editing?.name?.trim()) { setErr("Name is required."); return; }
    setErr(null);
    const data = {
      name: editing.name, kind: editing.kind ?? "room",
      is_active: editing.is_active ?? true, is_hidden: editing.is_hidden ?? false,
      display_order: editing.display_order ?? 0, notes: editing.notes ?? null,
    };
    try {
      if (editing.id) await reservationsApi.updateResource(editing.id, data);
      else await reservationsApi.createResource(data);
      setEditing(null); load();
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } };
      setErr(ax.response?.data?.detail ?? "Could not save.");
    }
  }

  async function remove(r: ReservationResource) {
    if (!window.confirm(`Delete "${r.name}"? If it has past reservations it will be retired (hidden) instead of deleted.`)) return;
    await reservationsApi.removeResource(r.id);
    load();
  }

  return (
    <div style={st.wrap}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to calendar</button>
      <div style={st.head}>
        <h1 style={st.heading}><Settings size={20} style={{ verticalAlign: -3 }} /> Manage Rooms &amp; Resources</h1>
        <button style={st.addBtn} onClick={() => { setEditing({ ...blank }); setErr(null); }}><PlusCircle size={15} /> Add Resource</button>
      </div>

      <div style={st.list}>
        {resources.map((r) => (
          <div key={r.id} style={{ ...st.row, opacity: r.is_active ? 1 : 0.55 }}>
            <div style={st.kindIcon}>{r.kind === "equipment" ? <Wrench size={16} /> : <DoorOpen size={16} />}</div>
            <div style={{ flex: 1 }}>
              <div style={st.name}>{r.name} {!r.is_active && <span style={st.tagOff}>Inactive</span>} {r.is_hidden && <span style={st.tagOff}>Hidden</span>}</div>
              <div style={st.sub}>{r.kind === "equipment" ? "Equipment" : "Room"} · order {r.display_order}{r.notes ? ` · ${r.notes}` : ""}</div>
            </div>
            <button style={st.smallGhost} onClick={() => { setEditing({ ...r }); setErr(null); }}>Edit</button>
            <button style={st.iconDel} onClick={() => remove(r)} title="Delete"><Trash2 size={15} /></button>
          </div>
        ))}
        {resources.length === 0 && <p style={st.muted}>No resources defined yet.</p>}
      </div>

      {editing && (
        <div style={st.overlay} onClick={() => setEditing(null)}>
          <div style={st.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={st.modalTitle}>{editing.id ? "Edit Resource" : "Add Resource"}</h3>
            {err && <div style={st.err}>{err}</div>}
            <label style={st.label}>Name *
              <input style={st.input} value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </label>
            <label style={st.label}>Type
              <select style={st.input} value={editing.kind ?? "room"} onChange={(e) => setEditing({ ...editing, kind: e.target.value as "room" | "equipment" })}>
                <option value="room">Room</option>
                <option value="equipment">Equipment</option>
              </select>
            </label>
            <label style={st.label}>Display order
              <input type="number" style={st.input} value={editing.display_order ?? 0} onChange={(e) => setEditing({ ...editing, display_order: Number(e.target.value) })} />
            </label>
            <label style={st.label}>Notes
              <input style={st.input} value={editing.notes ?? ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </label>
            <div style={st.checks}>
              <label style={st.check}><input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active (available to reserve)</label>
              <label style={st.check}><input type="checkbox" checked={editing.is_hidden ?? false} onChange={(e) => setEditing({ ...editing, is_hidden: e.target.checked })} /> Hidden from the request list</label>
            </div>
            <div style={st.actions}>
              <button style={st.cancel} onClick={() => setEditing(null)}>Cancel</button>
              <button style={st.submit} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const RC = "#7b1fa2";
const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720 },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 10, padding: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: RC, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 },
  kindIcon: { width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: RC + "18", color: RC, flexShrink: 0 },
  name: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  sub: { fontSize: 12, color: "#888", marginTop: 2 },
  tagOff: { fontSize: 10, fontWeight: 700, color: "#888", background: "#eee", padding: "1px 6px", borderRadius: 8, marginLeft: 4 },
  smallGhost: { padding: "6px 14px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  iconDel: { width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer" },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 10, padding: 22, width: 420, maxWidth: "90vw", display: "flex", flexDirection: "column", gap: 12 },
  modalTitle: { margin: 0, fontSize: 18, color: "#1a3a5c" },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, padding: "8px 12px", fontSize: 13 },
  label: { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 600, color: "#445" },
  input: { padding: "8px 11px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, fontWeight: 400 },
  checks: { display: "flex", flexDirection: "column", gap: 8 },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#445", fontWeight: 500 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  cancel: { padding: "9px 16px", background: "#fff", color: "#445", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  submit: { padding: "9px 22px", background: RC, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 14 },
};
