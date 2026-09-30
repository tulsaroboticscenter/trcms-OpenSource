import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, BOM_STATUS_LABELS, BOM_STATUS_COLORS, type Bom } from "../api";
import { ArrowLeft, PlusCircle, FileText, ShoppingCart } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function BomQueue() {
  const navigate = useNavigate();
  const goBack = useGoBack("/inventory");
  const { canWrite } = useAuth();
  const canCreate = canWrite("inventory.bom");
  const canPo = canWrite("inventory.po");
  const [sp] = useSearchParams();
  const [boms, setBoms] = useState<Bom[]>([]);
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [creatingPo, setCreatingPo] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    else if (showArchived) params.include_archived = "1";
    inventoryApi.listBoms(params).then(setBoms).finally(() => setLoading(false));
  }, [status, showArchived]);
  useEffect(() => { load(); }, [load]);

  // Only ready/ordered BOMs not already on a PO are selectable for a new PO
  const selectable = (b: Bom) => canPo && (b.status === "ready_to_order" || b.status === "ordered");

  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function createPo() {
    if (selected.size === 0) return;
    setCreatingPo(true);
    try {
      const po = await inventoryApi.createPo({ bom_ids: [...selected] });
      navigate(`/inventory/pos/${po.id}`);
    } finally { setCreatingPo(false); }
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <div style={st.head}>
        <div>
          <h1 style={st.heading}><FileText size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Bills of Materials</h1>
          <p style={st.sub}>Purchasing queue across all teams</p>
        </div>
        {canCreate && <button style={st.addBtn} onClick={() => navigate("/inventory/boms/new")}><PlusCircle size={15} /> New BOM</button>}
      </div>

      <div style={st.tabs}>
        {["", "draft", "ready_to_order", "ordered", "received", "rejected"].map((s) => (
          <button key={s || "all"} style={{ ...st.tab, ...(status === s ? st.tabActive : {}) }} onClick={() => setStatus(s)}>
            {s ? BOM_STATUS_LABELS[s] : "All"}
          </button>
        ))}
        <label style={st.archiveToggle} title="Archived BOMs are hidden by default (they’re closed at season transition).">
          <input type="checkbox" checked={showArchived} disabled={!!status} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {canPo && selected.size > 0 && (
        <div style={st.poBar}>
          <span>{selected.size} BOM{selected.size !== 1 ? "s" : ""} selected</span>
          <button style={st.poBtn} disabled={creatingPo} onClick={createPo}>
            <ShoppingCart size={14} /> {creatingPo ? "Creating…" : "Create Purchase Order"}
          </button>
          <button style={st.clearBtn} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {loading ? <p style={st.muted}>Loading…</p> : boms.length === 0 ? (
        <p style={st.muted}>No BOMs found.</p>
      ) : (
        <div style={st.list}>
          {boms.map((b) => (
            <div key={b.id} style={st.row} onClick={() => navigate(`/inventory/boms/${b.id}`)}>
              {selectable(b) && (
                <input type="checkbox" checked={selected.has(b.id)} onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(b.id)} style={{ flexShrink: 0 }} />
              )}
              <span style={{ ...st.statusBadge, background: BOM_STATUS_COLORS[b.status] ?? "#888" }}>
                {BOM_STATUS_LABELS[b.status] ?? b.status}
              </span>
              <div style={st.rowMain}>
                <div style={st.rowName}>{b.display_name || b.name || `BOM #${b.id}`} {b.team && <span style={st.team}>{b.team}</span>}</div>
                <div style={st.rowMeta}>
                  {b.vendor_name ?? "Vendor TBD"} · by {b.created_by ?? "—"}
                  {b.created_at ? ` · ${new Date(b.created_at).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div style={st.total}>
                <span style={st.totalNum}>${(b.expected_total ?? 0).toFixed(2)}</span>
                <span style={st.totalLabel}>est.</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 860, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  tabs: { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" },
  archiveToggle: { display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 12.5, color: "#667", cursor: "pointer" },
  tab: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 20, cursor: "pointer", fontSize: 13, color: "#555" },
  tabActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  poBar: { display: "flex", alignItems: "center", gap: 12, background: "#eef2f7", border: "1px solid #cdd7e3", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#1a3a5c" },
  poBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  clearBtn: { background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 13 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer" },
  statusBadge: { fontSize: 10, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0, width: 110, textAlign: "center" },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", gap: 8, alignItems: "center" },
  team: { fontSize: 11, color: "#1565c0", background: "#eef2f7", borderRadius: 4, padding: "1px 6px" },
  rowMeta: { fontSize: 12, color: "#888", marginTop: 2 },
  total: { textAlign: "right", flexShrink: 0 },
  totalNum: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  totalLabel: { fontSize: 10, color: "#aaa", display: "block" },
  muted: { color: "#aaa", fontSize: 14, padding: "1rem 0" },
};
