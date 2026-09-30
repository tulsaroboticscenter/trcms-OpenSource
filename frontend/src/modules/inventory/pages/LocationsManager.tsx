import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, type InvLocation } from "../api";
import { ArrowLeft, PlusCircle, Edit2, Trash2, MapPin, QrCode as QrCodeIcon, Boxes, X, Printer } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import QrCode from "../components/QrCode";

const KINDS = ["building", "room", "rack", "shelf", "bin"];

export default function LocationsManager() {
  const goBack = useGoBack("/inventory");
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canEdit = canWrite("inventory.locations");
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [editing, setEditing] = useState<InvLocation | null>(null);
  const [adding, setAdding] = useState(false);
  const [qrLoc, setQrLoc] = useState<InvLocation | null>(null);

  const load = useCallback(() => { inventoryApi.listLocations().then(setLocations).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function del(l: InvLocation) {
    if (!confirm(`Remove location "${l.path}"?`)) return;
    try { await inventoryApi.deleteLocation(l.id); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed."); }
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <div style={st.head}>
        <h1 style={st.heading}>Locations</h1>
        {canEdit && <button style={st.addBtn} onClick={() => { setAdding(true); setEditing(null); }}><PlusCircle size={14} /> Add Location</button>}
      </div>
      <p style={st.sub}>Hierarchical: Building › Room › Shelf › Bin. Pick a parent to nest a location.</p>

      {(adding || editing) && canEdit && (
        <LocationForm location={editing} all={locations} onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }} />
      )}

      <div style={st.list}>
        {locations.map((l) => (
          <div key={l.id} style={st.row}>
            <MapPin size={14} color="#1565c0" />
            <div style={{ flex: 1 }}>
              <div style={st.path}>{l.path}</div>
              <div style={st.kind}>{l.kind}{l.notes ? ` · ${l.notes}` : ""}</div>
            </div>
            <div style={st.rowActions}>
              <button style={st.iconBtn} title="View items here" onClick={() => navigate(`/inventory?location=${l.id}`)}><Boxes size={13} color="#1565c0" /></button>
              <button style={st.iconBtn} title="Print QR for this location" onClick={() => setQrLoc(l)}><QrCodeIcon size={13} color="#1565c0" /></button>
              {canEdit && <>
                <button style={st.iconBtn} onClick={() => { setEditing(l); setAdding(false); }}><Edit2 size={13} /></button>
                <button style={st.iconBtn} onClick={() => del(l)}><Trash2 size={13} color="#c62828" /></button>
              </>}
            </div>
          </div>
        ))}
        {locations.length === 0 && <p style={st.muted}>No locations yet.</p>}
      </div>

      {qrLoc && <LocationQrModal location={qrLoc} onClose={() => setQrLoc(null)} />}
    </div>
  );
}

// Printable QR for a bin/location. Encodes "LOC:<id>" — the inventory scanner
// recognizes that and opens the bin's item list.
function LocationQrModal({ location, onClose }: { location: InvLocation; onClose: () => void }) {
  function print() {
    const img = document.querySelector("#loc-qr-img-wrap img") as HTMLImageElement | null;
    const w = window.open("", "_blank", "width=420,height=520");
    if (!w) return;
    w.document.write(`<html><head><title>QR — ${location.path}</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:24px">
      <h2 style="margin:0 0 4px">${location.path ?? location.name}</h2>
      <p style="color:#666;margin:0 0 16px;text-transform:capitalize">${location.kind ?? ""}</p>
      ${img?.src ? `<img src="${img.src}" style="width:300px;height:300px" />` : ""}
      <p style="color:#888;font-size:12px;margin-top:12px">Scan in the TRC app → Inventory → Scan</p>
      </body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  }
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <button style={st.modalClose} onClick={onClose}><X size={18} /></button>
        <div style={st.modalPath}>{location.path ?? location.name}</div>
        <div style={st.modalKind}>{location.kind}</div>
        <div style={st.qrWrap}><span id="loc-qr-img-wrap"><QrCode value={`LOC:${location.id}`} size={220} /></span></div>
        <p style={st.qrHint}>Print and stick on the bin. Scanning it in the app opens what's stored here.</p>
        <button style={st.printBtn} onClick={print}><Printer size={14} /> Print</button>
      </div>
    </div>
  );
}

function LocationForm({ location, all, onClose, onSaved }: {
  location: InvLocation | null; all: InvLocation[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(location?.name ?? "");
  const [kind, setKind] = useState(location?.kind ?? "bin");
  const [parentId, setParentId] = useState(location?.parent_id ? String(location.parent_id) : "");
  const [notes, setNotes] = useState(location?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim(), kind, notes: notes.trim() || null };
      payload.parent_id = parentId ? parseInt(parentId) : null;
      if (location) await inventoryApi.updateLocation(location.id, payload);
      else await inventoryApi.createLocation(payload);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={st.form}>
      <div style={st.formGrid}>
        <input style={st.input} placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
        <select style={st.input} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select style={st.input} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">No parent (top level)</option>
          {all.filter((l) => l.id !== location?.id).map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
        </select>
        <input style={st.input} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { fontSize: 13, color: "#888", margin: "0 0 14px" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 14 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" },
  path: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  kind: { fontSize: 12, color: "#888", marginTop: 2, textTransform: "capitalize" },
  rowActions: { display: "flex", gap: 6 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex", padding: 4 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  cancelBtn: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "7px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#aaa", fontSize: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: "26px 30px", width: "100%", maxWidth: 360, textAlign: "center", position: "relative", boxShadow: "0 12px 48px rgba(0,0,0,0.25)" },
  modalClose: { position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "#888" },
  modalPath: { fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  modalKind: { fontSize: 12, color: "#888", textTransform: "capitalize", marginBottom: 14 },
  qrWrap: { display: "flex", justifyContent: "center", padding: 8 },
  qrHint: { fontSize: 12, color: "#778", margin: "10px 0 14px", lineHeight: 1.5 },
  printBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
