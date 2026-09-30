/**
 * ShippingAddresses — admin management of the purchase-order "ship to" list.
 * Add, edit, or remove the shipping addresses offered when ordering a BOM.
 */
import { useState, useEffect } from "react";
import { inventoryApi, type ShippingAddress } from "../../inventory/api";
import { ArrowLeft, PlusCircle, Edit2, Trash2, Check, X, MapPin } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function ShippingAddresses() {
  const goBack = useGoBack("/admin");
  const [addrs, setAddrs] = useState<ShippingAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);
  function load() {
    inventoryApi.listShippingAddresses().then(setAddrs).catch(() => {}).finally(() => setLoading(false));
  }

  function startAdd() {
    setAdding(true); setEditIndex(null); setName(""); setAddress(""); setError("");
  }
  function startEdit(i: number) {
    setEditIndex(i); setAdding(false); setName(addrs[i].name ?? ""); setAddress(addrs[i].address ?? ""); setError("");
  }
  function cancel() { setAdding(false); setEditIndex(null); setError(""); }

  async function save() {
    if (!address.trim()) { setError("Address is required."); return; }
    setSaving(true); setError("");
    try {
      const updated = adding
        ? await inventoryApi.addShippingAddress(name.trim(), address.trim())
        : await inventoryApi.updateShippingAddress(editIndex!, name.trim(), address.trim());
      setAddrs(updated);
      cancel();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save.");
    } finally { setSaving(false); }
  }

  async function remove(i: number) {
    if (!confirm(`Remove this shipping address?\n\n${addrs[i].name ? addrs[i].name + " — " : ""}${addrs[i].address}`)) return;
    try {
      setAddrs(await inventoryApi.deleteShippingAddress(i));
    } catch {
      alert("Failed to remove. Please try again.");
    }
  }

  return (
    <div>
      <div style={st.header}>
        <button onClick={goBack} style={st.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={st.heading}>Shipping Addresses</h1>
        <p style={st.sub}>Manage the "ship to" options offered when a mentor places a purchase order.</p>
      </div>

      <div style={st.card}>
        <div style={st.cardHead}>
          <span style={st.cardTitle}><MapPin size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Saved Addresses</span>
          {!adding && editIndex === null && (
            <button style={st.addBtn} onClick={startAdd}><PlusCircle size={14} /> Add Address</button>
          )}
        </div>

        {error && <div style={st.error}>{error}</div>}

        {adding && <AddrForm {...{ name, address, setName, setAddress, save, cancel, saving }} isNew />}

        {loading ? <p style={st.muted}>Loading…</p> : addrs.length === 0 && !adding ? (
          <p style={st.muted}>No shipping addresses yet. Click "Add Address" to create one.</p>
        ) : (
          <div style={st.list}>
            {addrs.map((a, i) => editIndex === i ? (
              <AddrForm key={i} {...{ name, address, setName, setAddress, save, cancel, saving }} />
            ) : (
              <div key={i} style={st.row}>
                <div style={st.rowMain}>
                  {a.name && <div style={st.rowName}>{a.name}</div>}
                  <div style={st.rowAddr}>{a.address}</div>
                </div>
                <div style={st.rowActions}>
                  <button style={st.iconBtn} onClick={() => startEdit(i)} title="Edit"><Edit2 size={14} /></button>
                  <button style={st.iconBtn} onClick={() => remove(i)} title="Remove"><Trash2 size={14} color="#c62828" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddrForm({ name, address, setName, setAddress, save, cancel, saving, isNew }: {
  name: string; address: string; setName: (v: string) => void; setAddress: (v: string) => void;
  save: () => void; cancel: () => void; saving: boolean; isNew?: boolean;
}) {
  return (
    <div style={st.form}>
      <div style={st.formTitle}>{isNew ? "New Shipping Address" : "Edit Shipping Address"}</div>
      <input style={st.input} placeholder="Label (e.g. Christopher's House)" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea style={{ ...st.input, minHeight: 64, resize: "vertical" }} placeholder="Full mailing address *" value={address} onChange={(e) => setAddress(e.target.value)} />
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={cancel}><X size={13} /> Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !address.trim()}><Check size={13} /> {saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  header: { marginBottom: 20 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", maxWidth: 640 },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  error: { fontSize: 12, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6cb", borderRadius: 6, padding: "6px 10px", marginBottom: 10 },
  muted: { color: "#aaa", fontSize: 13 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  rowAddr: { fontSize: 13, color: "#555", whiteSpace: "pre-wrap" },
  rowActions: { display: "flex", gap: 4 },
  iconBtn: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: 6, display: "flex" },
  form: { background: "#f8fafc", border: "1px solid #cdd7e3", borderRadius: 8, padding: 12, marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 },
  formTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c" },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, boxSizing: "border-box", width: "100%", fontFamily: "inherit" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
};
