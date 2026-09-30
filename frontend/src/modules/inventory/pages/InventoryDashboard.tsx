import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { inventoryApi, ITEM_TYPE_LABELS, type InvItem, type InventorySummary, type AssetCategory } from "../api";
import QrScanner from "../components/QrScanner";
import {
  Package, Search, PlusCircle, ScanLine, MapPin, Truck, AlertTriangle, Boxes,
  FileText, PiggyBank, PackageCheck, BarChart2, Printer,
} from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  asset_tagged: "#1565c0", asset_nontagged: "#3949ab", part: "#2e7d32",
  consumable: "#e65100", battery: "#6a1b9a",
};

export default function InventoryDashboard() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { canWrite } = useAuth();
  const canEdit = canWrite("inventory.items");

  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [items, setItems] = useState<InvItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(params.get("type") ?? "");
  const [assetCatFilter, setAssetCatFilter] = useState("");
  const [assetCats, setAssetCats] = useState<AssetCategory[]>([]);
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  // "Needs your action" counts that drive the left-nav badge — surfaced here too
  // so it's clear WHERE to act.
  const [actions, setActions] = useState<{ checkout_requests: number; checkout_overdue: number; boms_to_process: number }>(
    { checkout_requests: 0, checkout_overdue: 0, boms_to_process: 0 });
  const checkoutActions = actions.checkout_requests + actions.checkout_overdue;

  useEffect(() => {
    api.get("/api/v1/action-items")
      .then((r) => { const d = r.data?.detail ?? {}; setActions({
        checkout_requests: d.checkout_requests ?? 0, checkout_overdue: d.checkout_overdue ?? 0, boms_to_process: d.boms_to_process ?? 0 }); })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | boolean> = {};
      if (search) params.search = search;
      // "assets" = both asset item types; otherwise a single specific type.
      if (typeFilter === "assets") params.item_types = "asset_tagged,asset_nontagged";
      else if (typeFilter) params.item_type = typeFilter;
      if (assetCatFilter) params.asset_category_id = assetCatFilter;
      if (lowOnly) params.low_stock = true;
      const data = await inventoryApi.listItems(params);
      setItems(data.items);
      setTotal(data.total);
    } finally { setLoading(false); }
  }, [search, typeFilter, assetCatFilter, lowOnly]);

  useEffect(() => { inventoryApi.summary().then(setSummary).catch(() => {}); inventoryApi.listAssetCategories().then(setAssetCats).catch(() => {}); }, []);
  useEffect(() => { setSelected(new Set()); }, [typeFilter, assetCatFilter, search]);

  const viewingAssets = typeFilter === "assets" || typeFilter === "asset_tagged" || typeFilter === "asset_nontagged";
  const taggedIds = items.filter((i) => i.asset_tag).map((i) => i.id);
  const toggleSel = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  function printLabels() {
    const ids = selected.size > 0 ? [...selected] : taggedIds;
    if (ids.length) navigate(`/inventory/labels?ids=${ids.join(",")}`);
  }
  useEffect(() => { load(); }, [load]);

  async function handleScan(text: string) {
    setScanning(false);
    setScanError("");
    // The QR encodes the asset tag; look it up and jump to the item.
    try {
      const item = await inventoryApi.getByTag(text);
      navigate(`/inventory/items/${item.id}`);
    } catch {
      setScanError(`No item found for scanned tag "${text}".`);
      setTimeout(() => setScanError(""), 5000);
    }
  }

  return (
    <div>
      <div style={st.header}>
        <div>
          <h1 style={st.heading}><Package size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Inventory</h1>
          <p style={st.sub}>Assets, parts, consumables, and batteries</p>
        </div>
        <div style={st.headerBtns}>
          <button style={st.scanBtn} onClick={() => setScanning(true)}><ScanLine size={15} /> Scan</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/boms")}><FileText size={14} /> BOMs{actions.boms_to_process > 0 && <NavCount n={actions.boms_to_process} />}</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/pos")}><Truck size={14} /> Purchase Orders</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/checkouts")}><PackageCheck size={14} /> Checkout{checkoutActions > 0 && <NavCount n={checkoutActions} />}</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/budgets")}><PiggyBank size={14} /> Budgets</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/reports")}><BarChart2 size={14} /> Reports</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/locations")}><MapPin size={14} /> Locations</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/vendors")}><Truck size={14} /> Vendors</button>
          {canEdit && <button style={st.addBtn} onClick={() => navigate("/inventory/items/new")}><PlusCircle size={15} /> Add Item</button>}
        </div>
      </div>

      {scanError && <div style={st.scanErr}><AlertTriangle size={14} /> {scanError}</div>}

      {/* Needs-your-action callout — mirrors the left-nav badge so it's clear where to go */}
      {(checkoutActions > 0 || actions.boms_to_process > 0) && (
        <div style={st.actionBanner}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <strong>Items need your attention:</strong>{" "}
            {actions.checkout_requests > 0 && (
              <button style={st.actionLink} onClick={() => navigate("/inventory/checkouts")}>{actions.checkout_requests} checkout request{actions.checkout_requests !== 1 ? "s" : ""} to approve</button>
            )}
            {actions.checkout_overdue > 0 && (
              <>{actions.checkout_requests > 0 && " · "}<button style={st.actionLink} onClick={() => navigate("/inventory/checkouts")}>{actions.checkout_overdue} overdue checkout{actions.checkout_overdue !== 1 ? "s" : ""}</button></>
            )}
            {actions.boms_to_process > 0 && (
              <>{(checkoutActions > 0) && " · "}<button style={st.actionLink} onClick={() => navigate("/inventory/boms?status=ready_to_order")}>{actions.boms_to_process} BOM{actions.boms_to_process !== 1 ? "s" : ""} ready to order</button></>
            )}
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={st.cards}>
          <SummaryCard icon={<Boxes size={18} />} label="Total Items" value={summary.total_items} color="#1a3a5c" />
          <SummaryCard icon={<Package size={18} />} label="Tagged Assets" value={summary.tagged_assets} color="#1565c0" />
          <SummaryCard icon={<AlertTriangle size={18} />} label="Low Stock" value={summary.low_stock} color={summary.low_stock ? "#e65100" : "#999"} onClick={() => { setLowOnly(true); }} />
          <SummaryCard icon={<span style={{ fontWeight: 800 }}>$</span>} label="Est. Valuation" value={`$${(summary.estimated_valuation ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#2e7d32" />
        </div>
      )}

      {/* Toolbar */}
      <div style={st.toolbar}>
        <div style={st.searchWrap}>
          <Search size={15} color="#888" />
          <input style={st.search} placeholder="Search name, tag, part #, category…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select style={st.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="assets">Assets (tagged &amp; non-tagged)</option>
          {Object.entries(ITEM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {(typeFilter === "assets" || typeFilter === "asset_tagged" || typeFilter === "asset_nontagged") && assetCats.length > 0 && (
          <select style={st.select} value={assetCatFilter} onChange={(e) => setAssetCatFilter(e.target.value)}>
            <option value="">All asset categories</option>
            {assetCats.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.item_count})</option>)}
          </select>
        )}
        <label style={st.checkLabel}>
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
        </label>
      </div>

      {/* Item list */}
      {loading ? <p style={st.muted}>Loading…</p> : items.length === 0 ? (
        <p style={st.muted}>No items found.</p>
      ) : (
        <>
          <div style={st.listBar}>
            <p style={st.count}>{total} item{total !== 1 ? "s" : ""}</p>
            {viewingAssets && taggedIds.length > 0 && (
              <div style={st.printRow}>
                <button style={st.selectAll} onClick={() => setSelected((s) => s.size === taggedIds.length ? new Set() : new Set(taggedIds))}>
                  {selected.size === taggedIds.length ? "Clear" : "Select all"}
                </button>
                <button style={st.printLabelsBtn} onClick={printLabels}>
                  <Printer size={14} /> Print Labels{selected.size > 0 ? ` (${selected.size})` : " (all shown)"}
                </button>
              </div>
            )}
          </div>
          <div style={st.list}>
            {items.map((i) => (
              <div key={i.id} style={st.row} onClick={() => navigate(`/inventory/items/${i.id}`)}>
                {viewingAssets && i.asset_tag && (
                  <input type="checkbox" checked={selected.has(i.id)} onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSel(i.id)} style={{ width: 16, height: 16, flexShrink: 0, cursor: "pointer" }} />
                )}
                <span style={{ ...st.typeBadge, background: TYPE_COLORS[i.item_type] ?? "#777" }}>
                  {ITEM_TYPE_LABELS[i.item_type] ?? i.item_type}
                </span>
                <div style={st.rowMain}>
                  <div style={st.rowName}>
                    {i.name}
                    {(i.open_repairs ?? 0) > 0 && <span style={st.repairTag} title="Open repair ticket">🔧 REPAIR</span>}
                    {i.low_stock && <span style={st.lowTag}>LOW</span>}
                    {i.status && i.status !== "active" && <span style={st.statusTag}>{i.status}</span>}
                  </div>
                  <div style={st.rowMeta}>
                    {i.asset_tag && <span style={st.tagChip}>{i.asset_tag}</span>}
                    {i.asset_category_name && <span style={st.assetCatChip}>{i.asset_category_name}</span>}
                    {i.part_number && <span>#{i.part_number}</span>}
                    {i.location_path && <span><MapPin size={11} style={{ verticalAlign: "-1px" }} /> {i.location_path}</span>}
                    {i.vendor_name && <span>{i.vendor_name}</span>}
                  </div>
                </div>
                {(i.current_quantity != null) && (
                  <div style={st.qty}>
                    <span style={st.qtyNum}>{i.current_quantity}</span>
                    <span style={st.qtyUnit}>{i.unit_of_measure ?? "qty"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

/** Small red count badge shown on a nav button, matching the left-menu badge. */
function NavCount({ n }: { n: number }) {
  return <span style={st.navCount}>{n}</span>;
}

function SummaryCard({ icon, label, value, color, onClick }: {
  icon: React.ReactNode; label: string; value: number | string; color: string; onClick?: () => void;
}) {
  return (
    <div style={{ ...st.card, cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      <span style={{ ...st.cardIcon, color }}>{icon}</span>
      <div>
        <div style={{ ...st.cardValue, color }}>{value}</div>
        <div style={st.cardLabel}>{label}</div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 18 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  headerBtns: { display: "flex", gap: 8, flexWrap: "wrap" },
  scanBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  linkBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  scanErr: { display: "flex", alignItems: "center", gap: 8, background: "#fff3e0", border: "1px solid #ffcc80", color: "#e65100", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 },
  navCount: { marginLeft: 6, minWidth: 17, height: 17, padding: "0 5px", borderRadius: 9, background: "#e53935", color: "#fff", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 },
  actionBanner: { display: "flex", gap: 10, background: "#fff3e0", border: "1px solid #ffcc80", color: "#e65100", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.6 },
  actionLink: { background: "none", border: "none", padding: 0, color: "#c65100", fontWeight: 700, textDecoration: "underline", cursor: "pointer", fontSize: 13 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 },
  card: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px" },
  cardIcon: { display: "flex" },
  cardValue: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  cardLabel: { fontSize: 12, color: "#888", marginTop: 3 },
  toolbar: { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 220, border: "1px solid #ccc", borderRadius: 6, padding: "0 10px", background: "#fff" },
  search: { flex: 1, border: "none", outline: "none", padding: "9px 0", fontSize: 14 },
  select: { padding: "9px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" },
  muted: { color: "#aaa", fontSize: 14, padding: "1.5rem 0" },
  count: { fontSize: 13, color: "#888", marginBottom: 8 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer" },
  typeBadge: { fontSize: 10, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0, width: 96, textAlign: "center" },
  assetCatChip: { fontSize: 11, color: "#5e35b1", background: "#f3effa", borderRadius: 8, padding: "1px 8px", fontWeight: 600 },
  listBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  printRow: { display: "flex", alignItems: "center", gap: 10 },
  selectAll: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  printLabelsBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  rowMeta: { display: "flex", gap: 12, fontSize: 11, color: "#888", marginTop: 2, flexWrap: "wrap" },
  tagChip: { fontFamily: "monospace", background: "#eef2f7", padding: "1px 6px", borderRadius: 4, color: "#1565c0" },
  lowTag: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#e65100", borderRadius: 4, padding: "1px 6px" },
  repairTag: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#c62828", borderRadius: 4, padding: "1px 6px" },
  statusTag: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#888", borderRadius: 4, padding: "1px 6px", textTransform: "uppercase" },
  qty: { textAlign: "right", flexShrink: 0 },
  qtyNum: { fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  qtyUnit: { fontSize: 10, color: "#aaa", display: "block" },
};
