/**
 * InventoryCatalog — the inventory landing page.
 * Drill-down browse: Categories → Subcategories → Vendors → Items.
 * State lives in the URL (?cat, ?vendor, ?q) so back/forward and refresh work.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import {
  inventoryApi, ITEM_TYPE_LABELS,
  type InvItem, type CatalogCategory, type CatalogVendor,
} from "../api";
import QrScanner from "../components/QrScanner";
import * as Icons from "lucide-react";
import {
  Package, Search, PlusCircle, ScanLine, MapPin, Truck, AlertTriangle,
  FileText, PiggyBank, PackageCheck, BarChart2, ChevronRight, Boxes, Cpu,
  Settings2, Edit2, Trash2, Check, X, ArrowLeft, Upload, ChevronUp, ChevronDown,
} from "lucide-react";

const TYPE_COLORS: Record<string, string> = {
  asset_tagged: "#1565c0", asset_nontagged: "#3949ab", part: "#2e7d32",
  consumable: "#e65100", battery: "#6a1b9a",
};

// Resolve a lucide icon by name, falling back to Package.
function CatIcon({ name, size = 26, color }: { name?: string; size?: number; color?: string }) {
  const Cmp = (name && (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[name]) || Package;
  return <Cmp size={size} color={color} />;
}

const ICON_SUGGESTIONS = [
  "Cog", "Boxes", "Wrench", "CircuitBoard", "BatteryCharging", "Wind", "Package",
  "Hammer", "Flag", "Cpu", "Zap", "Wifi", "Camera", "Lightbulb", "Settings",
  "Gauge", "Ruler", "Cable", "Bolt", "Disc", "Microchip", "HardDrive",
];

export default function InventoryCatalog() {
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  const canEdit = canWrite("inventory.items");

  const [params, setParams] = useSearchParams();
  const catId = params.get("cat") ? parseInt(params.get("cat")!) : null;
  const vendorParam = params.get("vendor");
  const search = params.get("q") ?? "";
  const locParam = params.get("location");

  const [tree, setTree] = useState<CatalogCategory[]>([]);
  const [vendors, setVendors] = useState<CatalogVendor[]>([]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [manage, setManage] = useState(false);
  // "Needs your action" counts (same source as the left-nav badge) so it's clear
  // where inside Inventory to act.
  const [actions, setActions] = useState({ checkout_requests: 0, checkout_overdue: 0, boms_to_process: 0 });
  const checkoutActions = actions.checkout_requests + actions.checkout_overdue;
  useEffect(() => {
    api.get("/api/v1/action-items")
      .then((r) => { const d = r.data?.detail ?? {}; setActions({
        checkout_requests: d.checkout_requests ?? 0, checkout_overdue: d.checkout_overdue ?? 0, boms_to_process: d.boms_to_process ?? 0 }); })
      .catch(() => {});
  }, []);

  const loadTree = useCallback(() => {
    inventoryApi.listCategories().then(setTree).catch(() => {});
  }, []);
  useEffect(() => { loadTree(); }, [loadTree]);

  // Flatten the tree for lookups.
  const flat = useMemo(() => {
    const out: CatalogCategory[] = [];
    for (const t of tree) { out.push(t); t.children.forEach((c) => out.push(c)); }
    return out;
  }, [tree]);

  const current = catId ? flat.find((c) => c.id === catId) ?? null : null;
  const parentCat = current?.parent_id ? flat.find((c) => c.id === current.parent_id) ?? null : null;
  const children = current ? (flat.find((c) => c.id === current.id)?.children ?? []) : [];
  // Vendor level when we're on a leaf category (no children) or a subcategory.
  const atVendorLevel = !!current && children.length === 0;
  const atItemLevel = !!vendorParam || !!search || !!locParam;
  // When browsing a bin/location, resolve its name + full path for the header.
  const [locInfo, setLocInfo] = useState<{ name: string; path?: string | null } | null>(null);
  useEffect(() => {
    if (!locParam) { setLocInfo(null); return; }
    inventoryApi.listLocations().then((ls) => {
      const l = ls.find((x) => String(x.id) === locParam);
      setLocInfo(l ? { name: l.name, path: l.path } : null);
    }).catch(() => setLocInfo(null));
  }, [locParam]);

  // Load vendors when at the vendor level.
  useEffect(() => {
    if (current && atVendorLevel && !atItemLevel) {
      inventoryApi.categoryVendors(current.id).then(setVendors).catch(() => setVendors([]));
    }
  }, [current, atVendorLevel, atItemLevel]);

  // Load items at the item level (vendor chosen, or search active).
  useEffect(() => {
    if (!atItemLevel) return;
    setLoading(true);
    const p: Record<string, string | number | boolean> = {};
    if (search) p.search = search;
    if (catId) p.category_id = catId;
    if (vendorParam) p.vendor_id = vendorParam === "none" ? "" : vendorParam;
    if (locParam) p.location_id = locParam;
    inventoryApi.listItems(p)
      .then((d) => setItems(vendorParam === "none" ? d.items.filter((i) => !i.vendor_id) : d.items))
      .finally(() => setLoading(false));
  }, [atItemLevel, search, catId, vendorParam, locParam]);

  function go(next: { cat?: number | null; vendor?: string | null; q?: string | null; location?: number | string | null }) {
    const p = new URLSearchParams(params);
    const set = (k: string, v: number | string | null | undefined) => {
      if (v === null || v === undefined || v === "") p.delete(k);
      else p.set(k, String(v));
    };
    if ("cat" in next) { set("cat", next.cat); }
    if ("vendor" in next) { set("vendor", next.vendor); }
    if ("q" in next) { set("q", next.q); }
    if ("location" in next) { set("location", next.location); set("cat", null); set("vendor", null); set("q", null); }
    setParams(p);
  }

  async function handleScan(text: string) {
    setScanning(false); setScanError("");
    // A bin/location QR encodes "LOC:<id>" — open that bin's item list.
    const locMatch = text.match(/^LOC:(\d+)$/i);
    if (locMatch) { go({ location: locMatch[1] }); return; }
    try {
      const item = await inventoryApi.getByTag(text);
      navigate(`/inventory/items/${item.id}`);
    } catch {
      setScanError(`No item found for scanned code "${text}".`);
      setTimeout(() => setScanError(""), 5000);
    }
  }

  // ── Breadcrumb ──
  const crumbs: { label: string; onClick: () => void }[] = [
    { label: "Inventory", onClick: () => { setParams(new URLSearchParams()); } },
  ];
  if (parentCat) crumbs.push({ label: parentCat.name, onClick: () => go({ cat: parentCat.id, vendor: null }) });
  if (current) crumbs.push({ label: current.name, onClick: () => go({ cat: current.id, vendor: null }) });
  if (vendorParam) {
    const vn = vendors.find((v) => String(v.vendor_id ?? "none") === vendorParam)?.vendor_name ?? "Vendor";
    crumbs.push({ label: vn, onClick: () => {} });
  }
  if (search) crumbs.push({ label: `Search: "${search}"`, onClick: () => {} });
  if (locParam) crumbs.push({ label: `📍 ${locInfo?.path || locInfo?.name || "Location"}`, onClick: () => {} });

  return (
    <div>
      {/* Header */}
      <div style={st.header}>
        <div>
          <h1 style={st.heading}><Package size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Inventory Catalog</h1>
          <p style={st.sub}>Browse by category, then vendor — or search across everything</p>
        </div>
        <div style={st.headerBtns}>
          <button style={st.scanBtn} onClick={() => setScanning(true)}><ScanLine size={15} /> Scan</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/all")}><Boxes size={14} /> All Items</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/all?type=assets")}><Cpu size={14} /> Assets</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/boms")}><FileText size={14} /> BOMs{actions.boms_to_process > 0 && <span style={st.navCount}>{actions.boms_to_process}</span>}</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/pos")}><Truck size={14} /> POs</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/checkouts")}><PackageCheck size={14} /> Checkout{checkoutActions > 0 && <span style={st.navCount}>{checkoutActions}</span>}</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/budgets")}><PiggyBank size={14} /> Budgets</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/reports")}><BarChart2 size={14} /> Reports</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/locations")}><MapPin size={14} /> Locations</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/where")}><MapPin size={14} /> Where Is It</button>
          <button style={st.linkBtn} onClick={() => navigate("/inventory/vendors")}><Truck size={14} /> Vendors</button>
          {canEdit && <button style={st.linkBtn} onClick={() => navigate("/inventory/import")}><Upload size={14} /> Import CSV</button>}
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
              <>{checkoutActions > 0 && " · "}<button style={st.actionLink} onClick={() => navigate("/inventory/boms?status=ready_to_order")}>{actions.boms_to_process} BOM{actions.boms_to_process !== 1 ? "s" : ""} ready to order</button></>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div style={st.searchWrap}>
        <Search size={16} color="#888" />
        <input style={st.search} placeholder="Search name, tag, part #, category…"
          value={search} onChange={(e) => go({ q: e.target.value || null })} />
        {search && <button style={st.clearBtn} onClick={() => go({ q: null })}><X size={14} /></button>}
      </div>

      {/* Breadcrumb */}
      {(current || search || locParam) && (
        <div style={st.crumbs}>
          <button style={st.crumbBack} onClick={() => {
            if (vendorParam) go({ vendor: null });
            else if (current?.parent_id) go({ cat: current.parent_id });
            else { setParams(new URLSearchParams()); }
          }}><ArrowLeft size={14} /></button>
          {crumbs.map((c, i) => (
            <span key={i} style={st.crumbItem}>
              {i > 0 && <ChevronRight size={13} color="#bbb" />}
              <button style={{ ...st.crumbLink, ...(i === crumbs.length - 1 ? st.crumbActive : {}) }}
                onClick={c.onClick}>{c.label}</button>
            </span>
          ))}
        </div>
      )}

      {/* ── LEVEL: search or vendor → item list ── */}
      {atItemLevel ? (
        <ItemList items={items} loading={loading} onOpen={(id) => navigate(`/inventory/items/${id}`)} />
      ) : atVendorLevel ? (
        /* ── LEVEL: vendors ── */
        vendors.length === 0 ? (
          <EmptyLevel label="No items in this category yet." canEdit={canEdit} onAdd={() => navigate("/inventory/items/new")} />
        ) : (
          <div style={st.tileGrid}>
            {vendors.map((v) => (
              <button key={v.vendor_id ?? "none"} style={st.vendorCard}
                onClick={() => go({ vendor: String(v.vendor_id ?? "none") })}>
                <div style={st.vendorIcon}><Truck size={22} color="#1565c0" /></div>
                <div style={st.vendorName}>{v.vendor_name}</div>
                <div style={st.vendorCount}>{v.item_count} item{v.item_count !== 1 ? "s" : ""}</div>
              </button>
            ))}
          </div>
        )
      ) : (
        /* ── LEVEL: categories or subcategories ── */
        <CategoryGrid
          nodes={current ? children : tree}
          parentForAdd={current ? current.id : null}
          manage={manage && canEdit}
          canEdit={canEdit}
          onOpen={(id) => go({ cat: id, vendor: null })}
          onChanged={loadTree}
          header={
            <div style={st.levelHead}>
              <span style={st.levelTitle}>{current ? `${current.name} — subcategories` : "Categories"}</span>
              {canEdit && (
                <button style={st.manageBtn} onClick={() => setManage((m) => !m)}>
                  <Settings2 size={13} /> {manage ? "Done" : "Manage"}
                </button>
              )}
            </div>
          }
        />
      )}

      {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}
    </div>
  );
}

// ── Category tile grid with inline manage (add/edit/delete) ──
function CategoryGrid({ nodes, parentForAdd, manage, canEdit, onOpen, onChanged, header }: {
  nodes: CatalogCategory[]; parentForAdd: number | null; manage: boolean; canEdit: boolean;
  onOpen: (id: number) => void; onChanged: () => void; header: React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  // Move a category earlier/later among its siblings; normalize all siblings to
  // a clean 0..n display_order so the new arrangement persists for everyone.
  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return;
    const arr = nodes.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setReordering(true);
    try {
      await Promise.all(arr.map((n, idx) => n.display_order !== idx
        ? inventoryApi.updateCategory(n.id, { display_order: idx }) : null).filter(Boolean) as Promise<unknown>[]);
      onChanged();
    } finally { setReordering(false); }
  }

  return (
    <div>
      {header}
      <div style={st.tileGrid}>
        {nodes.map((n, i) => editId === n.id ? (
          <CategoryEditCard key={n.id} node={n}
            onClose={() => setEditId(null)} onSaved={() => { setEditId(null); onChanged(); }} />
        ) : (
          <div key={n.id} style={st.tile} onClick={() => !manage && onOpen(n.id)}>
            <div style={{ ...st.tileIcon, background: `${n.color}15`, color: n.color }}>
              <CatIcon name={n.icon_name} color={n.color} />
            </div>
            <div style={st.tileName}>{n.name}</div>
            <div style={st.tileCount}>{n.item_count} item{n.item_count !== 1 ? "s" : ""}</div>
            {manage && (
              <div style={st.tileActions} onClick={(e) => e.stopPropagation()}>
                <button style={st.iconBtn} disabled={i === 0 || reordering} title="Move earlier" onClick={() => move(i, -1)}><ChevronUp size={13} color={i === 0 ? "#ccc" : "#555"} /></button>
                <button style={st.iconBtn} disabled={i === nodes.length - 1 || reordering} title="Move later" onClick={() => move(i, 1)}><ChevronDown size={13} color={i === nodes.length - 1 ? "#ccc" : "#555"} /></button>
                <button style={st.iconBtn} onClick={() => setEditId(n.id)}><Edit2 size={13} /></button>
                <button style={st.iconBtn} onClick={() => {
                  if (confirm(`Delete category "${n.name}"? Items stay but become uncategorized.`))
                    inventoryApi.deleteCategory(n.id).then(onChanged);
                }}><Trash2 size={13} color="#c62828" /></button>
              </div>
            )}
          </div>
        ))}

        {manage && (adding ? (
          <CategoryEditCard node={null} parentId={parentForAdd}
            onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />
        ) : (
          <button style={st.addTile} onClick={() => setAdding(true)}>
            <PlusCircle size={22} /> <span style={{ marginTop: 6 }}>Add {parentForAdd ? "subcategory" : "category"}</span>
          </button>
        ))}
      </div>
      {!manage && nodes.length === 0 && (
        <EmptyLevel label="No categories defined yet." canEdit={canEdit} onAdd={() => { /* manage toggle */ }} />
      )}
    </div>
  );
}

function CategoryEditCard({ node, parentId, onClose, onSaved }: {
  node: CatalogCategory | null; parentId?: number | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(node?.name ?? "");
  const [icon, setIcon] = useState(node?.icon_name ?? (parentId ? "ChevronRight" : "Package"));
  const [color, setColor] = useState(node?.color ?? "#1565c0");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: name.trim(), icon_name: icon, color };
      if (node) await inventoryApi.updateCategory(node.id, payload);
      else await inventoryApi.createCategory({ ...payload, parent_id: parentId ?? null });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={st.editCard}>
      <div style={{ ...st.tileIcon, background: `${color}15`, color }}><CatIcon name={icon} color={color} /></div>
      <input style={st.editInput} placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input style={st.editInput} placeholder="Icon (lucide name)" value={icon} onChange={(e) => setIcon(e.target.value)} list="cat-icons" />
      <datalist id="cat-icons">{ICON_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
      <input style={{ ...st.editInput, height: 30, padding: 2 }} type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      <div style={st.editActions}>
        <button style={st.iconBtn} onClick={save} disabled={saving || !name.trim()}><Check size={16} color="#2e7d32" /></button>
        <button style={st.iconBtn} onClick={onClose}><X size={16} color="#888" /></button>
      </div>
    </div>
  );
}

function ItemList({ items, loading, onOpen }: { items: InvItem[]; loading: boolean; onOpen: (id: number) => void }) {
  if (loading) return <p style={st.muted}>Loading…</p>;
  if (items.length === 0) return <p style={st.muted}>No items found.</p>;
  return (
    <>
      <p style={st.count}>{items.length} item{items.length !== 1 ? "s" : ""}</p>
      <div style={st.list}>
        {items.map((i) => (
          <div key={i.id} style={st.row} onClick={() => onOpen(i.id)}>
            <span style={{ ...st.typeBadge, background: TYPE_COLORS[i.item_type] ?? "#777" }}>
              {ITEM_TYPE_LABELS[i.item_type] ?? i.item_type}
            </span>
            <div style={st.rowMain}>
              <div style={st.rowName}>
                {i.name}
                {i.low_stock && <span style={st.lowTag}>LOW</span>}
                {(i.open_repairs ?? 0) > 0 && <span style={st.repairTag} title="Open repair ticket">🔧 REPAIR</span>}
              </div>
              <div style={st.rowMeta}>
                {i.asset_tag && <span style={st.tagChip}>{i.asset_tag}</span>}
                {i.part_number && <span>#{i.part_number}</span>}
                {i.category_name && <span>{i.category_name}</span>}
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
  );
}

function EmptyLevel({ label, canEdit, onAdd }: { label: string; canEdit: boolean; onAdd: () => void }) {
  return (
    <div style={st.empty}>
      <Package size={28} color="#cbd5e1" />
      <p style={st.muted}>{label}</p>
      {canEdit && <button style={st.linkBtn} onClick={onAdd}><PlusCircle size={14} /> Add an item</button>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 },
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
  searchWrap: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #ccc", borderRadius: 8, padding: "0 12px", background: "#fff", marginBottom: 14 },
  search: { flex: 1, border: "none", outline: "none", padding: "11px 0", fontSize: 14 },
  clearBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  crumbs: { display: "flex", alignItems: "center", gap: 4, marginBottom: 16, flexWrap: "wrap" },
  crumbBack: { display: "flex", alignItems: "center", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", padding: "5px 8px", marginRight: 4, color: "#1565c0" },
  crumbItem: { display: "flex", alignItems: "center", gap: 4 },
  crumbLink: { background: "none", border: "none", cursor: "pointer", color: "#1565c0", fontSize: 13, padding: "2px 4px" },
  crumbActive: { color: "#1a3a5c", fontWeight: 700, cursor: "default" },
  levelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  levelTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  manageBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  tileGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 },
  tile: { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "20px 12px 16px", cursor: "pointer", textAlign: "center" },
  tileIcon: { width: 56, height: 56, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  tileName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  tileCount: { fontSize: 11, color: "#999" },
  tileActions: { position: "absolute", top: 6, right: 6, display: "flex", gap: 2 },
  iconBtn: { background: "rgba(255,255,255,0.9)", border: "1px solid #e2e8f0", borderRadius: 5, cursor: "pointer", padding: 4, display: "flex" },
  addTile: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, background: "#f8fafc", border: "2px dashed #cbd5e1", borderRadius: 12, padding: "20px 12px", cursor: "pointer", color: "#1565c0", fontSize: 13, fontWeight: 600, minHeight: 130 },
  editCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "#fff", border: "2px solid #1565c0", borderRadius: 12, padding: "14px 12px" },
  editInput: { width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  editActions: { display: "flex", gap: 6, marginTop: 2 },
  vendorCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 12px", cursor: "pointer", textAlign: "center" },
  vendorIcon: { width: 50, height: 50, borderRadius: 12, background: "#e3f2fd", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  vendorName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  vendorCount: { fontSize: 11, color: "#999" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "2.5rem", color: "#aaa" },
  muted: { color: "#aaa", fontSize: 14, padding: "0.5rem 0" },
  count: { fontSize: 13, color: "#888", marginBottom: 8 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, cursor: "pointer" },
  typeBadge: { fontSize: 10, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0, width: 96, textAlign: "center" },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  rowMeta: { display: "flex", gap: 12, fontSize: 11, color: "#888", marginTop: 2, flexWrap: "wrap" },
  tagChip: { fontFamily: "monospace", background: "#eef2f7", padding: "1px 6px", borderRadius: 4, color: "#1565c0" },
  lowTag: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#e65100", borderRadius: 4, padding: "1px 6px" },
  repairTag: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#c62828", borderRadius: 4, padding: "1px 6px" },
  qty: { textAlign: "right", flexShrink: 0 },
  qtyNum: { fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  qtyUnit: { fontSize: 10, color: "#aaa", display: "block" },
};
