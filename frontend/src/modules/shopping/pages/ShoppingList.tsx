/**
 * ShoppingList — Phase 1.
 * A shared list of things to buy on a store run. Anyone adds/claims items;
 * shoppers filter by store and check items off ("Got it").
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import {
  shoppingApi, type ShoppingItem, type ShoppingStore, type ShoppingCategory, type ShoppingStaple,
} from "../api";
import {
  ShoppingCart, PlusCircle, Check, Undo2, Trash2, Hand, Store, Zap, X, History, ChevronDown, ChevronRight,
} from "lucide-react";

const PRIORITY = [{ value: "normal", label: "Normal" }, { value: "high", label: "Urgent" }];

/** Compact date like "Jul 6" from an ISO/naive timestamp. */
function shortDate(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s.length > 10 ? s.replace(" ", "T") : s + "T00:00:00");
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Longer date like "Jul 6, 2026" for the history detail entries. */
function longDate(s?: string | null): string {
  if (!s) return "";
  const d = new Date(s.length > 10 ? s.replace(" ", "T") : s + "T00:00:00");
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ShoppingList() {
  const { canWrite } = useAuth();
  const canAdd = canWrite("shopping.add");

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [stores, setStores] = useState<ShoppingStore[]>([]);
  const [cats, setCats] = useState<ShoppingCategory[]>([]);
  const [staples, setStaples] = useState<ShoppingStaple[]>([]);
  const [storeFilter, setStoreFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ShoppingItem[]>([]);
  const [expandedHist, setExpandedHist] = useState<number | null>(null);
  const [addedNames, setAddedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (showHistory) shoppingApi.history().then(setHistory).catch(() => setHistory([]));
  }, [showHistory]);

  async function addAgain(h: ShoppingItem) {
    await shoppingApi.addItem({
      name: h.name, quantity: h.quantity ?? 1, unit: h.unit ?? null,
      category_id: h.category_id ?? null, store_id: h.store_id ?? null,
      notes: h.notes ?? null, url: h.url ?? null, est_price: h.est_price ?? null,
    });
    setAddedNames((prev) => new Set(prev).add(h.name));
    load();
  }

  const load = useCallback(() => {
    const params: Record<string, string | boolean> = {};
    if (storeFilter) params.store_id = storeFilter;
    if (showDone) params.include_done = true;
    shoppingApi.listItems(params).then(setItems).finally(() => setLoading(false));
  }, [storeFilter, showDone]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    shoppingApi.listStores().then(setStores).catch(() => {});
    shoppingApi.listCategories().then(setCats).catch(() => {});
    shoppingApi.listStaples().then(setStaples).catch(() => {});
  }, []);

  async function quickAdd(s: ShoppingStaple) {
    await shoppingApi.addItem({
      name: s.name, quantity: s.default_quantity ?? 1, unit: s.default_unit ?? null,
      category_id: s.default_category_id ?? null, store_id: s.default_store_id ?? null,
    });
    load();
  }

  // Group items by store for the shopper view
  const grouped: Record<string, ShoppingItem[]> = {};
  for (const i of items) {
    const key = i.store_name ?? "Any store";
    (grouped[key] = grouped[key] ?? []).push(i);
  }
  const storeKeys = Object.keys(grouped).sort();
  const activeCount = items.filter((i) => i.status === "needed" || i.status === "claimed").length;

  return (
    <div>
      <div style={st.header}>
        <div>
          <h1 style={st.heading}><ShoppingCart size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Shopping List</h1>
          <p style={st.sub}>{activeCount} item{activeCount !== 1 ? "s" : ""} to buy. Add what we need; check off what you grab.</p>
        </div>
        {canAdd && <button style={st.addBtn} onClick={() => setAdding(true)}><PlusCircle size={15} /> Add Item</button>}
      </div>

      {/* Quick add staples */}
      {canAdd && staples.length > 0 && (
        <div style={st.quickRow}>
          <span style={st.quickLabel}><Zap size={12} /> Quick add:</span>
          {staples.map((s) => (
            <button key={s.id} style={st.quickChip} onClick={() => quickAdd(s)}>+ {s.name}</button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={st.toolbar}>
        <div style={st.shopWrap}>
          <Store size={15} color="#888" />
          <select style={st.select} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>Shopping at {s.name}</option>)}
          </select>
        </div>
        <label style={st.check}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show purchased</label>
        <button style={{ ...st.histBtn, ...(showHistory ? st.histBtnOn : {}) }} onClick={() => setShowHistory((v) => !v)}>
          <History size={14} /> {showHistory ? "Hide History" : "Show History"}
        </button>
      </div>

      {showHistory && (
        <div style={st.histPanel}>
          <div style={st.histHead}>Purchase History <span style={st.histHint}>— re-add past items with one tap</span></div>
          {history.length === 0 ? <p style={st.muted}>Nothing purchased yet.</p> : (
            <div style={st.histList}>
              {history.map((h) => {
                const open = expandedHist === h.id;
                const entries = h.entries ?? [];
                return (
                <div key={h.id} style={{ ...st.histRow, ...(open ? st.histRowOpen : {}), flexWrap: "wrap" }}>
                  <span style={{ ...st.histDot, background: h.category_color ?? "#cbd5e1" }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                    onClick={() => setExpandedHist(open ? null : h.id)}
                    title="Show purchase history for this item">
                    <div style={st.histName}>
                      {entries.length > 0 && (open
                        ? <ChevronDown size={13} style={{ verticalAlign: -2, marginRight: 2, color: "#64748b" }} />
                        : <ChevronRight size={13} style={{ verticalAlign: -2, marginRight: 2, color: "#64748b" }} />)}
                      {h.name} <span style={st.histQty}>×{h.quantity ?? 1}{h.unit ? ` ${h.unit}` : ""}</span>
                    </div>
                    <div style={st.histMeta}>
                      {h.store_name && <span>{h.store_name}</span>}
                      {h.purchased_at && <span>· last {shortDate(h.purchased_at)}</span>}
                      {(h.times_bought ?? 0) > 1 && <span>· bought {h.times_bought}×</span>}
                    </div>
                  </div>
                  {canAdd && (
                    addedNames.has(h.name)
                      ? <span style={st.histAdded}><Check size={13} /> Added</span>
                      : <button style={st.histAdd} onClick={() => addAgain(h)}><PlusCircle size={13} /> Add Again</button>
                  )}
                  {open && (
                    <div style={st.histDetail}>
                      {entries.length === 0 ? (
                        <div style={st.muted}>No detailed history.</div>
                      ) : (
                        <table style={st.histTable}>
                          <thead>
                            <tr>
                              <th style={st.histTh}>Purchased</th>
                              <th style={st.histTh}>By</th>
                              <th style={{ ...st.histTh, textAlign: "right" }}>Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((e) => (
                              <tr key={e.id}>
                                <td style={st.histTd}>{longDate(e.purchased_at) || "—"}</td>
                                <td style={st.histTd}>{e.purchased_by ?? "—"}{e.store_name ? ` · ${e.store_name}` : ""}</td>
                                <td style={{ ...st.histTd, textAlign: "right" }}>×{e.quantity ?? 1}{e.unit ? ` ${e.unit}` : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {adding && canAdd && (
        <AddForm stores={stores} cats={cats} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      )}

      {loading ? <p style={st.muted}>Loading…</p> : items.length === 0 ? (
        <div style={st.empty}><ShoppingCart size={28} color="#cbd5e1" /><p style={st.muted}>Nothing on the list. Add something we need!</p></div>
      ) : (
        storeKeys.map((sk) => (
          <div key={sk} style={st.storeGroup}>
            <div style={st.storeHead}><Store size={14} /> {sk} <span style={st.storeCount}>{grouped[sk].length}</span></div>
            <div style={st.list}>
              {grouped[sk].map((i) => (
                <ItemRow key={i.id} item={i} canAdd={canAdd} onChange={load} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ItemRow({ item: i, canAdd, onChange }: { item: ShoppingItem; canAdd: boolean; onChange: () => void }) {
  const done = i.status === "purchased";
  const act = (fn: () => Promise<unknown>) => fn().then(onChange);
  return (
    <div style={{ ...st.row, opacity: done ? 0.6 : 1, borderLeft: `4px solid ${i.category_color ?? "#e2e8f0"}` }}>
      <div style={st.rowMain}>
        <div style={st.rowName}>
          {i.priority === "high" && <span style={st.urgent}>URGENT</span>}
          <span style={done ? st.strike : undefined}>{i.name}</span>
          <span style={st.qty}>×{i.quantity ?? 1}{i.unit ? ` ${i.unit}` : ""}</span>
        </div>
        <div style={st.rowMeta}>
          {i.category_name && <span style={{ color: i.category_color }}>{i.category_name}</span>}
          {i.requested_by && <span>· asked by {i.requested_by}</span>}
          {i.created_at && <span>· added {shortDate(i.created_at)}</span>}
          {i.needed_by && <span>· need by {i.needed_by}</span>}
          {i.status === "claimed" && i.claimed_by && <span style={st.claimedTag}>🛒 {i.claimed_by} is getting it{i.claimed_at ? ` · ${shortDate(i.claimed_at)}` : ""}</span>}
          {done && i.purchased_by && <span style={st.doneTag}>✓ got by {i.purchased_by}{i.purchased_at ? ` · ${shortDate(i.purchased_at)}` : ""}</span>}
        </div>
        {(i.notes || i.url) && (
          <div style={st.rowExtra}>
            {i.notes && <span>{i.notes}</span>}
            {i.url && <a href={i.url} target="_blank" rel="noreferrer" style={st.link}>link ↗</a>}
          </div>
        )}
      </div>
      {canAdd && (
        <div style={st.rowActions}>
          {!done ? (
            <>
              {i.status === "needed"
                ? <button style={st.claimBtn} onClick={() => act(() => shoppingApi.claim(i.id))} title="I'll get this"><Hand size={13} /> Claim</button>
                : <button style={st.unclaimBtn} onClick={() => act(() => shoppingApi.unclaim(i.id))} title="Release"><Undo2 size={13} /></button>}
              <button style={st.gotBtn} onClick={() => act(() => shoppingApi.gotIt(i.id))} title="Got it"><Check size={14} /> Got it</button>
            </>
          ) : (
            <button style={st.reopenBtn} onClick={() => act(() => shoppingApi.reopen(i.id))} title="Reopen"><Undo2 size={13} /> Reopen</button>
          )}
          <button style={st.delBtn} onClick={() => { if (confirm(`Remove "${i.name}"?`)) act(() => shoppingApi.deleteItem(i.id)); }}><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}

function AddForm({ stores, cats, onClose, onSaved }: {
  stores: ShoppingStore[]; cats: ShoppingCategory[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({ name: "", quantity: "1", unit: "", category_id: "", store_id: "", priority: "normal", needed_by: "", notes: "", url: "", est_price: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      await shoppingApi.addItem({
        name: f.name.trim(), quantity: f.quantity === "" ? 1 : parseFloat(f.quantity),
        unit: f.unit || null, category_id: f.category_id ? parseInt(f.category_id) : null,
        store_id: f.store_id ? parseInt(f.store_id) : null, priority: f.priority,
        needed_by: f.needed_by || null, notes: f.notes || null, url: f.url || null,
        est_price: f.est_price === "" ? null : parseFloat(f.est_price),
      });
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={st.form}>
      <div style={st.formHead}><span style={st.formTitle}>Add to Shopping List</span><button style={st.closeBtn} onClick={onClose}><X size={16} /></button></div>
      <div style={st.formGrid}>
        <div style={{ gridColumn: "1 / -1" }}><label style={st.l}>Item *</label><input style={st.input} autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Coffee creamer, Polycarb 1/4in, FIRST cords" /></div>
        <div><label style={st.l}>Quantity</label><input type="number" step="0.5" min="0" style={st.input} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></div>
        <div><label style={st.l}>Unit</label><input style={st.input} value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="case, box, ft…" /></div>
        <div><label style={st.l}>Category</label>
          <select style={st.input} value={f.category_id} onChange={(e) => set("category_id", e.target.value)}>
            <option value="">—</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label style={st.l}>Store</label>
          <select style={st.input} value={f.store_id} onChange={(e) => set("store_id", e.target.value)}>
            <option value="">Any store</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label style={st.l}>Priority</label>
          <select style={st.input} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div><label style={st.l}>Needed by</label><input type="date" style={st.input} value={f.needed_by} onChange={(e) => set("needed_by", e.target.value)} /></div>
        <div><label style={st.l}>Est. price</label><input type="number" step="0.01" style={st.input} value={f.est_price} onChange={(e) => set("est_price", e.target.value)} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label style={st.l}>Notes / link</label><input style={st.input} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="brand, specifics…" /></div>
        <div style={{ gridColumn: "1 / -1" }}><input style={st.input} value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://… (product link, optional)" /></div>
      </div>
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !f.name.trim()}>{saving ? "Adding…" : "Add Item"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  quickRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12, padding: "8px 10px", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 8 },
  quickLabel: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#e65100" },
  quickChip: { background: "#fff", border: "1px solid #cdd7e3", borderRadius: 16, padding: "4px 12px", cursor: "pointer", fontSize: 12, color: "#1a3a5c", fontWeight: 600 },
  toolbar: { display: "flex", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" },
  shopWrap: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #ccc", borderRadius: 6, padding: "0 10px", background: "#fff" },
  select: { border: "none", outline: "none", padding: "9px 0", fontSize: 14, background: "transparent" },
  check: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555" },
  muted: { color: "#aaa", fontSize: 14, padding: "0.5rem 0" },
  histBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  histBtnOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  histPanel: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 14 },
  histHead: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", marginBottom: 8 },
  histHint: { fontWeight: 400, color: "#98a3b0", fontSize: 12 },
  histList: { display: "flex", flexDirection: "column", gap: 4 },
  histRow: { display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #eef1f5", borderRadius: 8, padding: "7px 10px" },
  histDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  histName: { fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  histQty: { fontWeight: 400, color: "#889", fontSize: 12.5 },
  histMeta: { display: "flex", gap: 7, flexWrap: "wrap", fontSize: 11.5, color: "#98a3b0", marginTop: 1 },
  histAdd: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  histAdded: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: "#2e7d32", flexShrink: 0 },
  histRowOpen: { borderColor: "#cdd7e3", background: "#fbfcfe" },
  histDetail: { flexBasis: "100%", marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0", overflowX: "auto" },
  histTable: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  histTh: { textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, padding: "3px 8px", borderBottom: "1px solid #eef1f5", whiteSpace: "nowrap" },
  histTd: { padding: "4px 8px", color: "#334155", borderBottom: "1px solid #f4f6f9", whiteSpace: "nowrap" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "2.5rem" },
  storeGroup: { marginBottom: 16 },
  storeHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  storeCount: { background: "#eef2f7", color: "#555", borderRadius: 10, padding: "0 8px", fontSize: 11 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  strike: { textDecoration: "line-through" },
  qty: { fontSize: 12, color: "#888", fontWeight: 500 },
  urgent: { fontSize: 9, fontWeight: 800, color: "#fff", background: "#c62828", borderRadius: 4, padding: "1px 6px" },
  rowMeta: { display: "flex", gap: 8, fontSize: 11, color: "#888", marginTop: 2, flexWrap: "wrap" },
  rowExtra: { display: "flex", gap: 10, fontSize: 12, color: "#666", marginTop: 3, flexWrap: "wrap" },
  link: { color: "#1565c0", textDecoration: "none" },
  claimedTag: { color: "#1565c0", fontWeight: 600 },
  doneTag: { color: "#2e7d32", fontWeight: 600 },
  rowActions: { display: "flex", gap: 6, flexShrink: 0, alignItems: "center" },
  claimBtn: { display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fff", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  unclaimBtn: { background: "#fff", color: "#888", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", padding: "5px 8px", display: "flex" },
  gotBtn: { display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  reopenBtn: { display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fff", color: "#e65100", border: "1px solid #ffcc80", borderRadius: 6, cursor: "pointer", fontSize: 12 },
  delBtn: { background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 4, display: "flex" },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 14 },
  formHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  formTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px 12px" },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
