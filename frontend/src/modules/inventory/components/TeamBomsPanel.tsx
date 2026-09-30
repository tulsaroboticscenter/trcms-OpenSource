/**
 * TeamBomsPanel — embeddable BOM list scoped to a single team-season.
 * "New BOM" creates a BOM for this team directly (no team picker) and opens it.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, BOM_STATUS_LABELS, BOM_STATUS_COLORS, type Bom, type Vendor } from "../api";
import { PlusCircle } from "lucide-react";

export default function TeamBomsPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canCreate = canWrite("inventory.bom");
  const [boms, setBoms] = useState<Bom[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    inventoryApi.listBoms({ team_season_id: teamSeasonId }).then(setBoms).catch(() => {});
  }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { inventoryApi.listVendors().then(setVendors).catch(() => {}); }, []);

  async function newBom() {
    if (!vendorId) { setError("Select a vendor — each BOM is for a single vendor."); return; }
    setCreating(true); setError("");
    try {
      const bom = await inventoryApi.createBom({
        team_season_id: teamSeasonId,
        vendor_id: parseInt(vendorId),
        name: name.trim() || null,
      });
      navigate(`/inventory/boms/${bom.id}`);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to create BOM.");
    } finally { setCreating(false); }
  }

  // Active BOMs first; archived/cancelled drop to the bottom
  const visible = boms.filter((b) => b.status !== "archived");

  return (
    <div>
      <div style={st.head}>
        <span style={st.subTitle}>Bills of Materials</span>
        {canCreate && !showForm && (
          <button style={st.addBtn} onClick={() => { setShowForm(true); setError(""); }}>
            <PlusCircle size={13} /> New BOM
          </button>
        )}
      </div>

      {canCreate && showForm && (
        <div style={st.form}>
          <div style={st.formTitle}>New BOM — one vendor per BOM</div>
          <select style={st.input} value={vendorId} onChange={(e) => setVendorId(e.target.value)} autoFocus>
            <option value="">Select vendor *…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input style={st.input} placeholder="Name / label (optional — defaults to vendor)" value={name} onChange={(e) => setName(e.target.value)} />
          {error && <p style={st.formErr}>{error}</p>}
          <div style={st.formActions}>
            <button style={st.cancelBtn} onClick={() => { setShowForm(false); setVendorId(""); setName(""); setError(""); }}>Cancel</button>
            <button style={st.createBtn} disabled={creating} onClick={newBom}>{creating ? "Creating…" : "Create & Add Items"}</button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p style={st.muted}>No BOMs yet for this team.{canCreate && " Click “New BOM” to start one."}</p>
      ) : (
        <div style={st.list}>
          {visible.map((b) => (
            <div key={b.id} style={st.row} onClick={() => navigate(`/inventory/boms/${b.id}`)}>
              <span style={{ ...st.badge, background: BOM_STATUS_COLORS[b.status] ?? "#888" }}>
                {BOM_STATUS_LABELS[b.status] ?? b.status}
              </span>
              <div style={st.main}>
                <div style={st.name}>{b.display_name || b.name || `BOM #${b.id}`}</div>
                <div style={st.meta}>{b.vendor_name ?? "Vendor TBD"}{b.created_by ? ` · by ${b.created_by}` : ""}</div>
              </div>
              <span style={st.total}>${(b.expected_total ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  subTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  list: { display: "flex", flexDirection: "column" as const, gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 7, cursor: "pointer" },
  badge: { fontSize: 9, fontWeight: 700, color: "#fff", borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" as const, flexShrink: 0, width: 96, textAlign: "center" as const },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  meta: { fontSize: 11, color: "#888", marginTop: 1 },
  total: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", flexShrink: 0 },
  muted: { color: "#aaa", fontSize: 13, margin: "4px 0" },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 10, display: "flex", flexDirection: "column" as const, gap: 8 },
  formTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" as const },
  formErr: { color: "#c62828", fontSize: 12, margin: 0 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  createBtn: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
