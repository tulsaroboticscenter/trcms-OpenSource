import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { inventoryApi, PO_STATUS_LABELS, PO_STATUS_COLORS, type PurchaseOrder } from "../api";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function PoQueue() {
  const navigate = useNavigate();
  const goBack = useGoBack("/inventory");
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [status, setStatus] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    else {
      if (showArchived) params.include_archived = "1";
      if (showCancelled) params.include_cancelled = "1";
    }
    inventoryApi.listPos(params).then(setPos).finally(() => setLoading(false));
  }, [status, showArchived, showCancelled]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <h1 style={st.heading}><ShoppingCart size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Purchase Orders</h1>
      <p style={st.sub}>Create a PO from the BOMs queue. Receive items here once they arrive.</p>

      <div style={st.tabs}>
        {["", "pending", "ordered", "partially_received", "complete"].map((s) => (
          <button key={s || "all"} style={{ ...st.tab, ...(status === s ? st.tabActive : {}) }} onClick={() => setStatus(s)}>
            {s ? PO_STATUS_LABELS[s] : "All"}
          </button>
        ))}
        <label style={st.archiveToggle} title="Cancelled POs are hidden by default. Check to include them.">
          <input type="checkbox" checked={showCancelled} disabled={!!status} onChange={(e) => setShowCancelled(e.target.checked)} />
          Show cancelled
        </label>
        <label style={st.archiveToggleTight} title="Archived POs are hidden by default (they’re closed at season transition).">
          <input type="checkbox" checked={showArchived} disabled={!!status} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {loading ? <p style={st.muted}>Loading…</p> : pos.length === 0 ? (
        <p style={st.muted}>No purchase orders yet. Select BOMs in the BOMs queue and click "Create PO".</p>
      ) : (
        <div style={st.list}>
          {pos.map((p) => (
            <div key={p.id} style={st.row} onClick={() => navigate(`/inventory/pos/${p.id}`)}>
              <span style={{ ...st.badge, background: PO_STATUS_COLORS[p.status] ?? "#888" }}>
                {PO_STATUS_LABELS[p.status] ?? p.status}
              </span>
              <div style={st.main}>
                <div style={st.name}>{p.po_number} <span style={st.vendor}>{p.vendor_name ?? "Vendor TBD"}</span></div>
                <div style={st.meta}>
                  {p.bom_count} BOM{p.bom_count !== 1 ? "s" : ""} · {p.received_lines}/{p.line_count} lines received
                  {p.created_at ? ` · ${new Date(p.created_at).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div style={st.total}>
                <span style={st.totalNum}>${(p.estimated_total ?? 0).toFixed(2)}</span>
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
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 14px", fontSize: 13, color: "#888" },
  tabs: { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" },
  archiveToggle: { display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 12.5, color: "#667", cursor: "pointer" },
  archiveToggleTight: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#667", cursor: "pointer" },
  tab: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 20, cursor: "pointer", fontSize: 13, color: "#555" },
  tabActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer" },
  badge: { fontSize: 10, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0, width: 120, textAlign: "center" },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  vendor: { fontWeight: 400, color: "#888", fontSize: 13, marginLeft: 6 },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  total: { textAlign: "right", flexShrink: 0 },
  totalNum: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  totalLabel: { fontSize: 10, color: "#aaa", display: "block" },
  muted: { color: "#aaa", fontSize: 14, padding: "1rem 0" },
};
