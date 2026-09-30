import { useState, useEffect } from "react";
import { resourcesApi, type ResourceType, type ResourceAttr } from "../api";
import { ArrowLeft, Plus, Pencil, Trash2, X, GripVertical } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const ATTR_TYPES = ["url", "text", "longtext", "file", "select"];

export default function ResourceTypesManager() {
  const goBack = useGoBack("/admin");
  const [types, setTypes] = useState<ResourceType[]>([]);
  const [editing, setEditing] = useState<ResourceType | "new" | null>(null);

  const load = () => resourcesApi.listTypes().then(setTypes).catch(() => setTypes([]));
  useEffect(() => { load(); }, []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <button onClick={goBack} style={s.back}><ArrowLeft size={14} /> Admin Console</button>
      <div style={s.headRow}>
        <div>
          <h1 style={s.h1}>Resource Types</h1>
          <p style={s.sub}>Define the kinds of resources teams can track, each with its own attributes.</p>
        </div>
        <button style={s.addBtn} onClick={() => setEditing("new")}><Plus size={15} /> New Type</button>
      </div>

      <div style={s.list}>
        {types.map((t) => (
          <div key={t.id} style={s.row}>
            <div style={{ flex: 1 }}>
              <div style={s.name}>{t.name}</div>
              <div style={s.attrs}>{t.attributes.length === 0 ? <span style={{ color: "#bbb" }}>No attributes</span>
                : t.attributes.map((a) => `${a.label} (${a.type})`).join(" · ")}</div>
            </div>
            <button style={s.iconBtn} onClick={() => setEditing(t)}><Pencil size={14} /></button>
            <button style={{ ...s.iconBtn, color: "#c62828" }} onClick={async () => {
              if (confirm(`Deactivate type "${t.name}"? Existing resources keep their type label.`)) { await resourcesApi.deleteType(t.id); load(); }
            }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {editing && (
        <TypeEditor type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function TypeEditor({ type, onClose, onSaved }: { type: ResourceType | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!type;
  const [name, setName] = useState(type?.name ?? "");
  const [icon, setIcon] = useState(type?.icon ?? "");
  const [attrs, setAttrs] = useState<ResourceAttr[]>(type?.attributes ?? []);
  const [busy, setBusy] = useState(false);

  function addAttr() { setAttrs([...attrs, { key: "", label: "", type: "text", required: false }]); }
  function updateAttr(i: number, patch: Partial<ResourceAttr>) {
    setAttrs(attrs.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  }
  function removeAttr(i: number) { setAttrs(attrs.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    // Auto-key from label when key is blank.
    const clean = attrs.map((a) => ({ ...a, key: (a.key || a.label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") }))
      .filter((a) => a.key && a.label.trim());
    const payload = { name: name.trim(), icon: icon || undefined, attributes: clean };
    try {
      if (editing) await resourcesApi.updateType(type!.id, payload);
      else await resourcesApi.createType(payload);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <span style={s.modalTitle}>{editing ? "Edit Resource Type" : "New Resource Type"}</span>
          <button style={s.iconBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <label style={s.l}>Name</label>
        <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub Repository" autoFocus />
        <label style={s.l}>Icon (optional lucide name, e.g. Github, Globe)</label>
        <input style={s.input} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="FileText" />

        <div style={s.attrHead}>
          <span style={s.l}>Attributes</span>
          <button style={s.addAttr} onClick={addAttr}><Plus size={12} /> Add Field</button>
        </div>
        {attrs.length === 0 && <p style={s.muted}>No fields yet — add the pieces of info this type captures (URL, purpose, etc.).</p>}
        {attrs.map((a, i) => (
          <div key={i} style={s.attrRow}>
            <GripVertical size={14} color="#ccc" />
            <input style={{ ...s.input, flex: 1 }} placeholder="Label (e.g. Repository URL)" value={a.label} onChange={(e) => updateAttr(i, { label: e.target.value })} />
            <select style={{ ...s.input, width: 110 }} value={a.type} onChange={(e) => updateAttr(i, { type: e.target.value as ResourceAttr["type"] })}>
              {ATTR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label style={s.reqLbl}><input type="checkbox" checked={!!a.required} onChange={(e) => updateAttr(i, { required: e.target.checked })} /> req</label>
            <button style={s.iconBtn} onClick={() => removeAttr(i)}><X size={14} /></button>
          </div>
        ))}

        <div style={s.modalActions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.saveBtn} onClick={save} disabled={busy || !name.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 4, padding: 0, marginBottom: 8 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 },
  h1: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, flexShrink: 0 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  name: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  attrs: { fontSize: 12, color: "#888", marginTop: 2 },
  iconBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 7, padding: 6, cursor: "pointer", color: "#888" },
  muted: { fontSize: 13, color: "#aaa", margin: "6px 0" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: "20px 22px", width: "100%", maxWidth: 600, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: 800, color: "#1a3a5c" },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", margin: "10px 0 3px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: "#fff" },
  attrHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  addAttr: { display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  attrRow: { display: "flex", alignItems: "center", gap: 6, marginTop: 6 },
  reqLbl: { display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#888" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  cancelBtn: { padding: "8px 14px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
  saveBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
};
