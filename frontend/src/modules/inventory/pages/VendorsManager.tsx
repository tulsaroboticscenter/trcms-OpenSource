import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, type Vendor } from "../api";
import { ArrowLeft, PlusCircle, Edit2, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function VendorsManager() {
  const goBack = useGoBack("/inventory");
  const { canWrite } = useAuth();
  const canEdit = canWrite("inventory.vendors");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => { inventoryApi.listVendors(true).then(setVendors).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <div style={st.head}>
        <h1 style={st.heading}>Vendors</h1>
        {canEdit && <button style={st.addBtn} onClick={() => { setAdding(true); setEditing(null); }}><PlusCircle size={14} /> Add Vendor</button>}
      </div>

      {(adding || editing) && canEdit && (
        <VendorForm vendor={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { setAdding(false); setEditing(null); load(); }} />
      )}

      <div style={st.list}>
        {vendors.map((v) => (
          <div key={v.id} style={{ ...st.row, opacity: v.is_active ? 1 : 0.55 }}>
            <div style={{ flex: 1 }}>
              <div style={st.name}>{v.name}{!v.is_active && <span style={st.inactive}>inactive</span>}</div>
              <div style={st.meta}>
                {[v.contact_name, v.contact_email, v.contact_phone].filter(Boolean).join(" · ")}
                {v.url && <> · <a href={v.url} target="_blank" rel="noreferrer" style={st.link}>website</a></>}
              </div>
            </div>
            {canEdit && (
              <div style={st.rowActions}>
                <button style={st.iconBtn} onClick={() => { setEditing(v); setAdding(false); }}><Edit2 size={13} /></button>
                <button style={st.iconBtn} title={v.is_active ? "Deactivate" : "Activate"} onClick={() => inventoryApi.toggleVendor(v.id).then(load)}>
                  {v.is_active ? <ToggleRight size={18} color="#2e7d32" /> : <ToggleLeft size={18} color="#ccc" />}
                </button>
                <button style={st.iconBtn} title="Delete vendor" onClick={async () => {
                  if (!confirm(`Delete vendor "${v.name}"? This can't be undone.`)) return;
                  try { await inventoryApi.deleteVendor(v.id); load(); }
                  catch (e) { alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not delete this vendor."); }
                }}><Trash2 size={15} color="#c62828" /></button>
              </div>
            )}
          </div>
        ))}
        {vendors.length === 0 && <p style={st.muted}>No vendors yet.</p>}
      </div>
    </div>
  );
}

function VendorForm({ vendor, onClose, onSaved }: { vendor: Vendor | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: vendor?.name ?? "", contact_name: vendor?.contact_name ?? "", contact_email: vendor?.contact_email ?? "",
    contact_phone: vendor?.contact_phone ?? "", url: vendor?.url ?? "", account_number: vendor?.account_number ?? "", notes: vendor?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  function set(k: string, v: string) { setF((p) => ({ ...p, [k]: v })); }
  async function save() {
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      if (vendor) await inventoryApi.updateVendor(vendor.id, f);
      else await inventoryApi.createVendor(f);
      onSaved();
    } finally { setSaving(false); }
  }
  return (
    <div style={st.form}>
      <div style={st.formGrid}>
        <input style={st.input} placeholder="Vendor name *" value={f.name} onChange={(e) => set("name", e.target.value)} />
        <input style={st.input} placeholder="Contact name" value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
        <input style={st.input} placeholder="Contact email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
        <input style={st.input} placeholder="Contact phone" value={f.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
        <input style={st.input} placeholder="Website URL" value={f.url} onChange={(e) => set("url", e.target.value)} />
        <input style={st.input} placeholder="Account #" value={f.account_number} onChange={(e) => set("account_number", e.target.value)} />
      </div>
      <input style={{ ...st.input, width: "100%", marginTop: 8 }} placeholder="Notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 14 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" },
  name: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  inactive: { fontSize: 10, color: "#aaa", background: "#f0f0f0", padding: "1px 6px", borderRadius: 5, marginLeft: 8, textTransform: "uppercase" },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  link: { color: "#1565c0" },
  rowActions: { display: "flex", gap: 6 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex", padding: 4 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  cancelBtn: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "7px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#aaa", fontSize: 14 },
};
