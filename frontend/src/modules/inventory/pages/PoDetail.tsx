import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import {
  inventoryApi, PO_STATUS_LABELS, PO_STATUS_COLORS, formatShipTo,
  type PurchaseOrder, type POLine, type POBom, type BudgetCategoryRec, type InvLocation, type ShippingAddress, type POFees,
} from "../api";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { ArrowLeft, ShoppingCart, Download, X, PackageCheck, Ban, Trash2, ExternalLink, Clock } from "lucide-react";

function neededByLabel(b: POBom): string | null {
  if (b.needed_by === "asap") return "ASAP";
  if (b.needed_by === "no_rush") return "No rush";
  if (b.needed_by === "date" && b.needed_by_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(b.needed_by_date);
    return m ? `Need by ${new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString()}` : `Need by ${b.needed_by_date}`;
  }
  return null;
}
import { useGoBack } from "../../../core/useGoBack";

export default function PoDetail() {
  const goBack = useGoBack("/inventory/pos");
  const { id } = useParams<{ id: string }>();
  const poId = parseInt(id!);
  const navigate = useNavigate();
  const { canWrite, user } = useAuth();
  const isSysAdmin = !!user?.roles?.includes("System Administrator");
  const canPo = canWrite("inventory.po");
  const canReceive = canWrite("inventory.receive");
  const canPrice = canWrite("inventory.bom_approve");   // matches the backend gate on actual price

  async function saveActualPrice(bomId: number, lineId: number, raw: string) {
    const t = raw.trim();
    const v = t === "" ? null : parseFloat(t);
    if (v !== null && (isNaN(v) || v < 0)) return;
    await act(() => inventoryApi.updateBomLine(bomId, lineId, { actual_purchase_price: v }), "Actual price saved.");
  }

  async function saveOrderedQty(bomId: number, lineId: number, raw: string) {
    const t = raw.trim();
    const v = t === "" ? null : parseInt(t, 10);
    if (v !== null && (isNaN(v) || v < 0)) return;
    await act(() => inventoryApi.updateBomLine(bomId, lineId, { ordered_quantity: v }), "Ordered qty saved.");
  }

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [receiving, setReceiving] = useState<{ line: POLine; bom: POBom } | null>(null);

  const load = useCallback(async () => {
    setPo(await inventoryApi.getPo(poId));
    setLoading(false);
  }, [poId]);
  useEffect(() => { load(); }, [load]);

  if (loading || !po) return <div style={st.muted}>Loading…</div>;

  async function act(fn: () => Promise<unknown>, note: string) {
    setBusy(true); setMsg("");
    try { await fn(); await load(); setMsg(note); setTimeout(() => setMsg(""), 4000); }
    catch (e: unknown) { setMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Action failed."); }
    finally { setBusy(false); }
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Purchase Orders</button>

      <div style={st.headRow}>
        <div>
          <span style={{ ...st.badge, background: PO_STATUS_COLORS[po.status] ?? "#888" }}>{PO_STATUS_LABELS[po.status] ?? po.status}</span>
          <h1 style={st.heading}>{po.po_number}</h1>
          <div style={st.metaRow}>
            <span>{po.vendor_name ?? "Vendor TBD"}</span>
            {po.payment_method && <span>· {po.payment_method}</span>}
            {po.order_date && <span>· ordered {po.order_date}</span>}
            <span>· {po.received_lines}/{po.line_count} lines received</span>
          </div>
        </div>
        <div style={st.actions}>
          {po.status === "pending" && canPo && (
            <button style={st.submitBtn} disabled={busy} onClick={() => act(() => inventoryApi.submitPo(poId), "PO submitted as ordered.")}>
              <ShoppingCart size={14} /> Submit Order
            </button>
          )}
          {canReceive && po.status !== "pending" && po.status !== "cancelled" && po.received_lines < po.line_count && (
            <button style={st.receiveAllBtn} disabled={busy}
              onClick={() => {
                const remaining = po.line_count - po.received_lines;
                if (confirm(`Receive all ${remaining} remaining line item${remaining !== 1 ? "s" : ""} in full?\n\nThey'll be received into general inventory and charged to each BOM's budget category.`)) {
                  act(() => inventoryApi.receiveAll(poId), "All remaining items received.");
                }
              }}>
              <PackageCheck size={14} /> Receive All
            </button>
          )}
          <a style={st.qbBtn} href={inventoryApi.quickbooksUrl(poId)} target="_blank" rel="noreferrer"><Download size={14} /> QuickBooks CSV</a>
          {po.status !== "cancelled" && po.status !== "complete" && canPo && (
            <button style={st.cancelBtn} disabled={busy} onClick={() => { if (confirm("Cancel this PO?")) act(() => inventoryApi.cancelPo(poId), "PO cancelled."); }}>
              <Ban size={14} /> Cancel
            </button>
          )}
          {/* Permanent delete — System Administrator only. Detaches its BOMs. */}
          {isSysAdmin && (
            <button style={st.deleteBtn} disabled={busy} onClick={async () => {
              const n = po.boms?.length ?? 0;
              if (!confirm(`Permanently delete this purchase order? This cannot be undone.${n ? `\n\nIts ${n} BOM${n !== 1 ? "s" : ""} will be detached and revert to standalone BOMs (not deleted).` : ""}`)) return;
              try {
                await inventoryApi.deletePoPermanent(poId);
                navigate("/inventory/pos");
              } catch (e: unknown) {
                alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to delete the purchase order.");
              }
            }}>
              <Trash2 size={14} /> Delete PO
            </button>
          )}
        </div>
      </div>

      {msg && <div style={st.msg}>{msg}</div>}

      {/* Header detail */}
      <div style={st.summaryCard}>
        <Summary label="BOMs" value={String(po.bom_count)} />
        <Summary label="Line Items" value={String(po.line_count)} />
        <Summary label="Estimated Total" value={`$${(po.estimated_total ?? 0).toFixed(2)}`} />
      </div>

      {/* Vendor ordering details (carried over from the BOM) */}
      <OrderDetails po={po} canEdit={canPo} onSaved={load} />

      {/* Shipping & tax → team budgets (split across teams by what each ordered) */}
      {po.fees && ((po.shipping ?? 0) > 0 || (po.tax ?? 0) > 0 || po.fees.categories.length > 0) &&
        <FeesCard po={po} canReceive={canReceive} onSaved={setPo} />}

      {/* BOMs + lines */}
      {(po.boms ?? []).map((b) => (
        <div key={b.id} style={st.card}>
          <div style={st.bomHead}>
            <span style={st.bomTitle}>
              {b.name || `BOM #${b.id}`} {b.team && <span style={st.team}>{b.team}</span>}
              {neededByLabel(b) && <span style={{ ...st.neededBy, ...(b.needed_by === "asap" ? st.neededAsap : {}) }}><Clock size={11} /> {neededByLabel(b)}</span>}
            </span>
            {canPo && po.status === "pending" && (
              <button style={st.removeBtn} onClick={() => act(() => inventoryApi.removeBomFromPo(poId, b.id), "BOM removed from PO.")}>Remove</button>
            )}
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead><tr>
                <th style={st.th}>Item</th>
                <th style={st.th}>Part #</th>
                <th style={st.th}>Link</th>
                <th style={st.thNum}>Req.</th>
                <th style={st.thNum}>Ordered</th>
                <th style={st.thNum}>Est.</th>
                <th style={st.thNum}>Actual $</th>
                <th style={st.thNum}>Received</th>
                <th style={st.th}>Status</th>
                {canReceive && <th style={st.th}></th>}
              </tr></thead>
              <tbody>
                {b.lines.map((l) => {
                  const orderedDefault = l.ordered_quantity ?? l.quantity_required ?? 0;
                  return (
                    <tr key={l.id}>
                      <td style={st.td}>{l.description || l.part_number || "—"}</td>
                      <td style={st.td}>{l.part_number || "—"}</td>
                      <td style={st.td}>
                        {l.url
                          ? <a href={l.url} target="_blank" rel="noopener noreferrer" style={st.link}><ExternalLink size={12} /> View</a>
                          : "—"}
                      </td>
                      <td style={st.tdNum}>{l.quantity_required ?? 0}</td>
                      <td style={st.tdNum}>
                        {canPrice
                          ? <input type="number" step="1" min="0" style={st.qtyInput}
                              defaultValue={orderedDefault}
                              onBlur={(e) => saveOrderedQty(b.id, l.id, e.target.value)} />
                          : orderedDefault}
                      </td>
                      <td style={st.tdNum}>{l.expected_price != null ? `$${l.expected_price.toFixed(2)}` : "—"}</td>
                      <td style={st.tdNum}>
                        {canPrice
                          ? <span style={st.priceWrap}>$<input type="number" step="0.01" min="0" style={st.priceInput}
                              defaultValue={l.actual_purchase_price ?? ""}
                              placeholder={l.expected_price != null ? l.expected_price.toFixed(2) : "0.00"}
                              onBlur={(e) => saveActualPrice(b.id, l.id, e.target.value)} /></span>
                          : (l.actual_purchase_price != null ? `$${l.actual_purchase_price.toFixed(2)}` : "—")}
                      </td>
                      <td style={st.tdNum}>{l.received_quantity ?? 0}</td>
                      <td style={st.td}>
                        {l.is_received
                          ? <span style={st.recvDone}><PackageCheck size={12} /> Received</span>
                          : (l.received_quantity ?? 0) > 0
                            ? <span style={st.recvPartial}>Partial</span>
                            : <span style={st.recvPending}>Awaiting</span>}
                      </td>
                      {canReceive && (
                        <td style={st.td}>
                          {po.status !== "pending" && po.status !== "cancelled" && (
                            <button style={st.receiveBtn} onClick={() => setReceiving({ line: l, bom: b })}>Receive</button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {receiving && (
        <ReceiveModal line={receiving.line} bom={receiving.bom}
          onClose={() => setReceiving(null)}
          onDone={() => { setReceiving(null); load(); }} />
      )}
    </div>
  );
}

interface Alloc {
  key: number;
  quantity: string;
  destType: "inventory" | "team";
  teamSeasonId: string;
  catId: string;
  locationId: string;
}

function ReceiveModal({ line, bom, onClose, onDone }: {
  line: POLine; bom: POBom; onClose: () => void; onDone: () => void;
}) {
  const ordered = line.ordered_quantity ?? line.quantity_required ?? 0;
  const [damaged, setDamaged] = useState("");
  const [missing, setMissing] = useState("");
  const [slip, setSlip] = useState("");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  // Budget categories cached per team-season id
  const [catsByTeam, setCatsByTeam] = useState<Record<number, BudgetCategoryRec[]>>({});
  const [allocs, setAllocs] = useState<Alloc[]>([
    { key: 1, quantity: String(ordered), destType: "team", teamSeasonId: String(bom.team_season_id),
      catId: line.budget_category_id ? String(line.budget_category_id) : "", locationId: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    teamsApi.list().then(setTeams).catch(() => {});
    inventoryApi.listLocations().then(setLocations).catch(() => {});
  }, []);

  // Whenever an allocation references a team we haven't loaded budget for, fetch it.
  const ensureCats = useCallback((teamSeasonId: number) => {
    if (!teamSeasonId) return;
    setCatsByTeam((prev) => {
      if (prev[teamSeasonId]) return prev;
      inventoryApi.getTeamBudget(teamSeasonId)
        .then((b) => setCatsByTeam((p) => ({ ...p, [teamSeasonId]: b.categories })))
        .catch(() => {});
      return prev;
    });
  }, []);

  useEffect(() => {
    allocs.forEach((a) => { if (a.destType === "team" && a.teamSeasonId) ensureCats(parseInt(a.teamSeasonId)); });
  }, [allocs, ensureCats]);

  function setAlloc(key: number, patch: Partial<Alloc>) {
    setAllocs((rows) => rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  }
  function addAlloc() {
    setAllocs((rows) => [...rows, { key: Date.now(), quantity: "", destType: "inventory", teamSeasonId: "", catId: "", locationId: "" }]);
  }
  function removeAlloc(key: number) {
    setAllocs((rows) => rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);
  }

  const teamsWithSeason = teams.filter((t) => t.current_season?.id);
  const allocTotal = allocs.reduce((s, a) => s + (parseFloat(a.quantity) || 0), 0);

  async function submit() {
    setSaving(true); setErr("");
    try {
      const payloadAllocs = allocs
        .filter((a) => parseFloat(a.quantity) > 0)
        .map((a) => ({
          quantity: parseFloat(a.quantity),
          destination_type: a.destType,
          destination_team_season_id: a.destType === "team" && a.teamSeasonId ? parseInt(a.teamSeasonId) : null,
          receiving_budget_category_id: a.catId ? parseInt(a.catId) : null,
          location_id: a.destType === "inventory" && a.locationId ? parseInt(a.locationId) : null,
        }));
      if (payloadAllocs.length === 0) { setErr("Enter at least one quantity."); setSaving(false); return; }
      const total = payloadAllocs.reduce((s, a) => s + a.quantity, 0);
      if (ordered > 0 && total > ordered + 0.001) {
        setErr(`Allocated total (${total}) exceeds the ordered quantity (${ordered}). Reduce the allocations.`);
        setSaving(false); return;
      }
      await inventoryApi.receiveSplit(line.id, {
        allocations: payloadAllocs,
        damaged_quantity: damaged === "" ? null : parseFloat(damaged),
        missing_quantity: missing === "" ? null : parseFloat(missing),
        packing_slip_url: slip || null,
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed.");
    } finally { setSaving(false); }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={{ ...st.modal, width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}>
          <span style={st.modalTitle}>Receive — {line.description || line.part_number || `Line #${line.id}`}</span>
          <button style={st.closeBtn} onClick={onClose}><X size={17} /></button>
        </div>
        <div style={st.modalBody}>
          <p style={st.allocIntro}>
            Ordered <strong>{ordered}</strong>. Split the received units across teams and/or general inventory —
            each row charges its own team's budget.
          </p>

          {/* Allocation rows */}
          {allocs.map((a) => {
            const cats = a.destType === "team" && a.teamSeasonId ? (catsByTeam[parseInt(a.teamSeasonId)] ?? []) : [];
            return (
              <div key={a.key} style={st.allocRow}>
                <div style={st.allocQty}>
                  <label style={st.l}>Qty</label>
                  <input type="number" step="0.01" min="0" style={st.input} value={a.quantity}
                    onChange={(e) => setAlloc(a.key, { quantity: e.target.value })} />
                </div>
                <div style={st.allocDest}>
                  <label style={st.l}>Destination</label>
                  <select style={st.input} value={a.destType}
                    onChange={(e) => setAlloc(a.key, { destType: e.target.value as "inventory" | "team", catId: "" })}>
                    <option value="team">Team-owned</option>
                    <option value="inventory">General Inventory</option>
                  </select>
                </div>
                {a.destType === "team" ? (
                  <>
                    <div style={st.allocTeam}>
                      <label style={st.l}>Team</label>
                      <select style={st.input} value={a.teamSeasonId}
                        onChange={(e) => setAlloc(a.key, { teamSeasonId: e.target.value, catId: "" })}>
                        <option value="">Select…</option>
                        {teamsWithSeason.map((t) => <option key={t.current_season!.id} value={t.current_season!.id}>#{t.team_number}</option>)}
                      </select>
                    </div>
                    <div style={st.allocCat}>
                      <label style={st.l}>Budget Category</label>
                      <select style={st.input} value={a.catId} disabled={!a.teamSeasonId}
                        onChange={(e) => setAlloc(a.key, { catId: e.target.value })}>
                        <option value="">{a.teamSeasonId ? "— none —" : "pick team first"}</option>
                        {cats.filter((c) => !c.is_fundraising && c.parent_id == null).map((p) => [
                          <option key={p.id} value={p.id}>{p.name}</option>,
                          ...cats.filter((c) => c.parent_id === p.id).map((ch) => (
                            <option key={ch.id} value={ch.id}>&nbsp;&nbsp;— {ch.name}</option>
                          )),
                        ])}
                      </select>
                    </div>
                  </>
                ) : (
                  <div style={{ ...st.allocCat, flex: 2 }}>
                    <label style={st.l}>Location</label>
                    <select style={st.input} value={a.locationId}
                      onChange={(e) => setAlloc(a.key, { locationId: e.target.value })}>
                      <option value="">— unassigned —</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
                    </select>
                  </div>
                )}
                <button style={st.allocDel} onClick={() => removeAlloc(a.key)} title="Remove" disabled={allocs.length === 1}>
                  <X size={14} />
                </button>
              </div>
            );
          })}

          <button style={st.addAllocBtn} onClick={addAlloc}>+ Add destination</button>

          <div style={st.allocSummary}>
            Allocated total: <strong>{allocTotal}</strong> of {ordered} ordered
            {allocTotal > ordered && <span style={{ color: "#e65100" }}> (over ordered)</span>}
          </div>

          <div style={st.recGrid}>
            <L label="Damaged"><input type="number" step="0.01" style={st.input} value={damaged} onChange={(e) => setDamaged(e.target.value)} /></L>
            <L label="Missing"><input type="number" step="0.01" style={st.input} value={missing} onChange={(e) => setMissing(e.target.value)} /></L>
            <L label="Packing Slip URL"><input style={st.input} value={slip} onChange={(e) => setSlip(e.target.value)} placeholder="optional" /></L>
          </div>
          {err && <p style={st.err}>{err}</p>}
        </div>
        <div style={st.modalFoot}>
          <button style={st.cancelBtn2} onClick={onClose}>Cancel</button>
          <button style={{ ...st.confirmBtn, ...(saving || (ordered > 0 && allocTotal > ordered + 0.001) ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
            onClick={submit} disabled={saving || (ordered > 0 && allocTotal > ordered + 0.001)}>
            {saving ? "Saving…" : "Confirm Receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderDetails({ po, canEdit, onSaved }: { po: PurchaseOrder; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [f, setF] = useState({
    order_number: "", confirmation_number: "", tracking_number: "",
    order_date: "", expected_delivery_date: "", shipping: "", tax: "",
    payment_method: "", invoice_url: "", shipment_address: "",
  });

  useEffect(() => { inventoryApi.listShippingAddresses().then(setAddresses).catch(() => {}); }, []);

  function start() {
    setF({
      order_number: po.order_number ?? "", confirmation_number: po.confirmation_number ?? "",
      tracking_number: po.tracking_number ?? "", order_date: po.order_date ?? "",
      expected_delivery_date: po.expected_delivery_date ?? "",
      shipping: po.shipping != null ? String(po.shipping) : "", tax: po.tax != null ? String(po.tax) : "",
      payment_method: po.payment_method ?? "", invoice_url: po.invoice_url ?? "",
      shipment_address: po.shipment_address ?? "",
    });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      await inventoryApi.updatePo(po.id, {
        order_number: f.order_number || null, confirmation_number: f.confirmation_number || null,
        tracking_number: f.tracking_number || null, order_date: f.order_date || null,
        expected_delivery_date: f.expected_delivery_date || null,
        shipping: f.shipping === "" ? null : parseFloat(f.shipping),
        tax: f.tax === "" ? null : parseFloat(f.tax),
        payment_method: f.payment_method || null, invoice_url: f.invoice_url || null,
        shipment_address: f.shipment_address || null,
      });
      setEditing(false);
      onSaved();
    } finally { setSaving(false); }
  }

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const has = po.order_number || po.confirmation_number || po.tracking_number || po.shipment_address
    || po.expected_delivery_date || po.invoice_url || po.shipping != null || po.tax != null;

  if (!editing) {
    return (
      <div style={st.card}>
        <div style={st.bomHead}>
          <span style={st.bomTitle}>Order Details</span>
          {canEdit && <button style={st.odEditBtn} onClick={start}>Edit</button>}
        </div>
        {!has ? (
          <p style={st.invNote}>No vendor ordering details yet.{canEdit && " Click Edit to add them."}</p>
        ) : (
          <div style={st.odGrid}>
            <OD label="Order #" value={po.order_number} />
            <OD label="Confirmation #" value={po.confirmation_number} />
            <OD label="Tracking #" value={po.tracking_number} />
            <OD label="Order Date" value={po.order_date} />
            <OD label="Expected Delivery" value={po.expected_delivery_date} />
            <OD label="Payment" value={po.payment_method} />
            <OD label="Shipping" value={po.shipping != null ? `$${po.shipping.toFixed(2)}` : undefined} />
            <OD label="Tax" value={po.tax != null ? `$${po.tax.toFixed(2)}` : undefined} />
            {po.invoice_url && <OD label="Invoice" value="Open ↗" href={po.invoice_url} />}
            {po.shipment_address && <OD label="Ship To" value={po.shipment_address} wide />}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={st.card}>
      <div style={st.bomHead}><span style={st.bomTitle}>Edit Order Details</span></div>
      <div style={st.odEditGrid}>
        <L label="Order #"><input style={st.input} value={f.order_number} onChange={(e) => set("order_number", e.target.value)} /></L>
        <L label="Confirmation #"><input style={st.input} value={f.confirmation_number} onChange={(e) => set("confirmation_number", e.target.value)} /></L>
        <L label="Tracking #"><input style={st.input} value={f.tracking_number} onChange={(e) => set("tracking_number", e.target.value)} /></L>
        <L label="Order Date"><input type="date" style={st.input} value={f.order_date} onChange={(e) => set("order_date", e.target.value)} /></L>
        <L label="Expected Delivery"><input type="date" style={st.input} value={f.expected_delivery_date} onChange={(e) => set("expected_delivery_date", e.target.value)} /></L>
        <L label="Payment Method"><input style={st.input} value={f.payment_method} onChange={(e) => set("payment_method", e.target.value)} /></L>
        <L label="Shipping $"><input type="number" step="0.01" style={st.input} value={f.shipping} onChange={(e) => set("shipping", e.target.value)} /></L>
        <L label="Tax $"><input type="number" step="0.01" style={st.input} value={f.tax} onChange={(e) => set("tax", e.target.value)} /></L>
        <L label="Invoice URL"><input style={st.input} value={f.invoice_url} onChange={(e) => set("invoice_url", e.target.value)} placeholder="https://…" /></L>
      </div>
      <L label="Ship To Address">
        <select
          style={st.input}
          value={addresses.findIndex((a) => formatShipTo(a) === f.shipment_address)}
          onChange={(e) => {
            const i = parseInt(e.target.value);
            if (i >= 0 && addresses[i]) set("shipment_address", formatShipTo(addresses[i]));
            else set("shipment_address", ""); // Custom — type below
          }}
        >
          {addresses.map((a, i) => (
            <option key={i} value={i}>{a.name ? `${a.name} — ${a.address}` : a.address}</option>
          ))}
          <option value={-1}>Custom address…</option>
        </select>
        <textarea
          style={{ ...st.input, minHeight: 56, resize: "vertical", marginTop: 6 }}
          value={f.shipment_address}
          placeholder="Choose a saved address above, or type a custom one here"
          onChange={(e) => set("shipment_address", e.target.value)}
        />
      </L>
      <div style={st.odActions}>
        <button style={st.cancelBtn2} onClick={() => setEditing(false)}>Cancel</button>
        <button style={st.confirmBtn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

function OD({ label, value, href, wide }: { label: string; value?: string; href?: string; wide?: boolean }) {
  if (!value) return null;
  return (
    <div style={{ ...st.odItem, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      <div style={st.odLabel}>{label}</div>
      {href
        ? <a style={st.odLink} href={href} target="_blank" rel="noreferrer">{value}</a>
        : <div style={st.odValue}>{value}</div>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div style={st.sumBox}><div style={st.sumVal}>{value}</div><div style={st.sumLabel}>{label}</div></div>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.l}>{label}</label>{children}</div>;
}

/** Split a PO's shipping & tax across its teams' budgets (proportional to what each ordered). */
function FeesCard({ po, canReceive, onSaved }: { po: PurchaseOrder; canReceive: boolean; onSaved: (po: PurchaseOrder) => void }) {
  const fees = po.fees as POFees | undefined;
  const [amt, setAmt] = useState<Record<number, { shipping: string; tax: string }>>({});
  const [ship, setShip] = useState("");
  const [tax, setTax] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const num = (s: string) => { const v = parseFloat(s); return isNaN(v) ? 0 : v; };

  // Proportional per-category amounts for the given PO totals.
  const propose = useCallback((f: POFees, shipTotal: number, taxTotal: number) => {
    const g = f.grand_subtotal;
    const next: Record<number, { shipping: string; tax: string }> = {};
    f.categories.forEach(c => {
      const frac = g > 0 ? c.subtotal / g : 0;
      next[c.budget_category_id] = { shipping: (shipTotal * frac).toFixed(2), tax: (taxTotal * frac).toFixed(2) };
    });
    return next;
  }, []);

  const initFrom = useCallback((f: POFees) => {
    setShip(f.shipping ? f.shipping.toFixed(2) : "");
    setTax(f.tax ? f.tax.toFixed(2) : "");
    // Keep what's already charged; otherwise seed with the proportional proposal.
    const next: Record<number, { shipping: string; tax: string }> = {};
    f.categories.forEach(c => {
      next[c.budget_category_id] = {
        shipping: (c.charged_shipping ?? c.proposed_shipping).toFixed(2),
        tax: (c.charged_tax ?? c.proposed_tax).toFixed(2),
      };
    });
    setAmt(next);
  }, []);
  useEffect(() => { if (fees) initFrom(fees); }, [fees, initFrom]);

  if (!fees) return null;
  const money = (n: number) => `$${n.toFixed(2)}`;
  // When the PO totals are edited, re-split proportionally.
  const editTotal = (which: "ship" | "tax", v: string) => {
    (which === "ship" ? setShip : setTax)(v);
    if (fees) setAmt(propose(fees, which === "ship" ? num(v) : num(ship), which === "tax" ? num(v) : num(tax)));
  };
  const sumShip = fees.categories.reduce((s, c) => s + num(amt[c.budget_category_id]?.shipping ?? "0"), 0);
  const sumTax = fees.categories.reduce((s, c) => s + num(amt[c.budget_category_id]?.tax ?? "0"), 0);
  const shipOff = Math.abs(sumShip - num(ship)) > 0.005;
  const taxOff = Math.abs(sumTax - num(tax)) > 0.005;

  async function run(fn: () => Promise<PurchaseOrder>) {
    setErr(""); setBusy(true);
    try { onSaved(await fn()); } catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong."); }
    finally { setBusy(false); }
  }
  const charge = () => run(() => inventoryApi.chargePoFees(po.id, {
    shipping: ship === "" ? null : num(ship),
    tax: tax === "" ? null : num(tax),
    allocations: fees.categories.map(c => ({
      budget_category_id: c.budget_category_id,
      shipping_amount: num(amt[c.budget_category_id]?.shipping ?? "0"),
      tax_amount: num(amt[c.budget_category_id]?.tax ?? "0"),
    })),
  }));
  const resetSplit = () => { if (fees) setAmt(propose(fees, num(ship), num(tax))); };
  const clear = () => run(() => inventoryApi.clearPoFees(po.id));

  return (
    <div style={st.card}>
      <div style={st.bomHead}>
        <span style={st.bomTitle}>Shipping &amp; Tax → Team Budgets</span>
        {fees.charged && <span style={st.chargedBadge}>Charged{fees.charged_at ? ` · ${new Date(fees.charged_at).toLocaleDateString()}` : ""}</span>}
      </div>
      <p style={st.feeIntro}>
        Enter the PO's total shipping &amp; tax, then split them across teams by what each ordered
        (total ordered {money(fees.grand_subtotal)}). Amounts are added to each team's budget.
      </p>
      {err && <div style={st.msg}>{err}</div>}

      {/* PO totals — editable here even when the BOMs are locked */}
      <div style={st.feeTotals}>
        <label style={st.feeTotalL}>Shipping (PO total) $
          <input type="number" step="0.01" min={0} style={st.feeInput} disabled={busy || !canReceive}
            value={ship} onChange={e => editTotal("ship", e.target.value)} />
        </label>
        <label style={st.feeTotalL}>Tax (PO total) $
          <input type="number" step="0.01" min={0} style={st.feeInput} disabled={busy || !canReceive}
            value={tax} onChange={e => editTotal("tax", e.target.value)} />
        </label>
      </div>

      {fees.categories.length === 0 ? (
        <p style={st.muted}>No team budgets found on this PO's items — the items weren't charged to a team budget, so there's nothing to split shipping/tax onto. Receive the items to a team budget category first.</p>
      ) : (
        <>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead><tr>
                <th style={st.th}>Team / Budget</th>
                <th style={st.thNum}>Ordered</th>
                <th style={st.thNum}>Shipping $</th>
                <th style={st.thNum}>Tax $</th>
              </tr></thead>
              <tbody>
                {fees.categories.map(c => (
                  <tr key={c.budget_category_id}>
                    <td style={st.td}>{c.team ? <strong>{c.team}</strong> : null} {c.category_name}</td>
                    <td style={st.tdNum}>{money(c.subtotal)}</td>
                    <td style={st.tdNum}>
                      {canReceive ? (
                        <input type="number" step="0.01" min={0} style={st.feeInput} disabled={busy}
                          value={amt[c.budget_category_id]?.shipping ?? ""}
                          onChange={e => setAmt(p => ({ ...p, [c.budget_category_id]: { ...p[c.budget_category_id], shipping: e.target.value } }))} />
                      ) : money(c.charged_shipping ?? c.proposed_shipping)}
                    </td>
                    <td style={st.tdNum}>
                      {canReceive ? (
                        <input type="number" step="0.01" min={0} style={st.feeInput} disabled={busy}
                          value={amt[c.budget_category_id]?.tax ?? ""}
                          onChange={e => setAmt(p => ({ ...p, [c.budget_category_id]: { ...p[c.budget_category_id], tax: e.target.value } }))} />
                      ) : money(c.charged_tax ?? c.proposed_tax)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...st.td, fontWeight: 700 }}>Total</td>
                  <td style={st.tdNum}></td>
                  <td style={{ ...st.tdNum, color: shipOff ? "#c62828" : "#2e7d32", fontWeight: 700 }}>{money(sumShip)}</td>
                  <td style={{ ...st.tdNum, color: taxOff ? "#c62828" : "#2e7d32", fontWeight: 700 }}>{money(sumTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {fees.unassigned_subtotal > 0 && (
            <p style={st.feeWarn}>⚠ {money(fees.unassigned_subtotal)} of items are on BOMs with no team budget — that share of shipping/tax can't be charged. Assign those BOMs a budget category to include them.</p>
          )}
          {(shipOff || taxOff) && <p style={st.feeWarn}>Amounts don't add up to the PO's {shipOff ? `shipping (${money(num(ship))})` : ""}{shipOff && taxOff ? " and " : ""}{taxOff ? `tax (${money(num(tax))})` : ""}. You can still charge these amounts.</p>}
          {canReceive && (
            <div style={st.feeBtns}>
              <button style={st.primaryBtn} disabled={busy} onClick={charge}>{fees.charged ? "Update budget charges" : "Charge to budgets"}</button>
              <button style={st.ghostBtn} disabled={busy} onClick={resetSplit}>Reset to proportional split</button>
              {fees.charged && <button style={st.ghostDanger} disabled={busy} onClick={clear}>Remove from budgets</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  badge: { display: "inline-block", fontSize: 11, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 10px", marginBottom: 6 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  metaRow: { display: "flex", gap: 8, marginTop: 6, fontSize: 13, color: "#555", flexWrap: "wrap" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  submitBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  receiveAllBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  qbBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#2e7d32", border: "1px solid #a5d6a7", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, textDecoration: "none" },
  cancelBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  deleteBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  msg: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "8px 14px", color: "#2e7d32", marginBottom: 12, fontSize: 13 },
  summaryCard: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 },
  sumBox: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px", textAlign: "center" },
  sumVal: { fontSize: 20, fontWeight: 800, color: "#1a3a5c" },
  sumLabel: { fontSize: 12, color: "#888", marginTop: 3 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 12 },
  bomHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  bomTitle: { fontWeight: 700, fontSize: 14, color: "#1a3a5c" },
  team: { fontSize: 11, color: "#1565c0", background: "#eef2f7", borderRadius: 4, padding: "1px 6px", marginLeft: 6 },
  neededBy: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "#7a5b12", background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 10, padding: "1px 8px", marginLeft: 8, fontWeight: 600 },
  neededAsap: { color: "#b3261e", background: "#fdecea", borderColor: "#f5c2c0" },
  link: { display: "inline-flex", alignItems: "center", gap: 3, color: "#1565c0", fontSize: 12, textDecoration: "none", fontWeight: 600 },
  priceWrap: { display: "inline-flex", alignItems: "center", gap: 2, color: "#333", fontSize: 12 },
  priceInput: { width: 62, padding: "3px 5px", border: "1px solid #ccc", borderRadius: 5, fontSize: 12, textAlign: "right" },
  qtyInput: { width: 48, padding: "3px 5px", border: "1px solid #ccc", borderRadius: 5, fontSize: 12, textAlign: "right" },
  removeBtn: { background: "none", border: "1px solid #ef9a9a", color: "#c62828", borderRadius: 5, cursor: "pointer", fontSize: 11, padding: "3px 10px" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "4px 6px", borderBottom: "1px solid #e2e8f0" },
  thNum: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "4px 6px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "7px 6px", borderBottom: "1px solid #f4f6fa" },
  tdNum: { padding: "7px 6px", textAlign: "right", borderBottom: "1px solid #f4f6fa" },
  recvDone: { display: "inline-flex", alignItems: "center", gap: 4, color: "#2e7d32", fontWeight: 600, fontSize: 12 },
  recvPartial: { color: "#6a1b9a", fontWeight: 600, fontSize: 12 },
  recvPending: { color: "#aaa", fontSize: 12 },
  receiveBtn: { background: "#2e7d32", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "4px 12px", fontWeight: 600 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, width: 460, maxWidth: "95vw" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #e2e8f0" },
  modalTitle: { fontWeight: 700, color: "#1a3a5c", fontSize: 15 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  modalBody: { padding: "14px 18px" },
  recGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },
  l: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "10px 0 4px" },
  allocIntro: { fontSize: 12, color: "#666", margin: "0 0 12px", lineHeight: 1.5 },
  allocRow: { display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 },
  allocQty: { width: 70, flexShrink: 0 },
  allocDest: { width: 130, flexShrink: 0 },
  allocTeam: { flex: 1, minWidth: 0 },
  allocCat: { flex: 1.4, minWidth: 0 },
  allocDel: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 6, marginBottom: 2 },
  invNote: { fontSize: 12, color: "#888", padding: "9px 0", fontStyle: "italic" },
  addAllocBtn: { background: "#eef2f7", color: "#1565c0", border: "1px dashed #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "6px 12px", marginTop: 2 },
  allocSummary: { fontSize: 13, color: "#1a3a5c", marginTop: 10, paddingTop: 8, borderTop: "1px solid #f0f4f8" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  err: { color: "#c62828", fontSize: 12, marginTop: 8 },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 18px", borderTop: "1px solid #e2e8f0" },
  cancelBtn2: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  confirmBtn: { padding: "8px 20px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#aaa", fontSize: 14, padding: "0.5rem 0" },
  odEditBtn: { background: "#fff", border: "1px solid #cdd7e3", color: "#1565c0", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "3px 12px", fontWeight: 600 },
  odGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px 16px" },
  odItem: { minWidth: 0 },
  odLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  odValue: { fontSize: 13, color: "#1a3a5c", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  odLink: { fontSize: 13, color: "#1565c0", marginTop: 2, display: "inline-block", textDecoration: "none" },
  odEditGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0 14px" },
  odActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  chargedBadge: { fontSize: 11, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "2px 9px" },
  feeIntro: { fontSize: 12.5, color: "#556", margin: "0 0 10px", lineHeight: 1.5 },
  feeTotals: { display: "flex", gap: 16, flexWrap: "wrap", margin: "0 0 12px" },
  feeTotalL: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#556" },
  feeInput: { width: 84, padding: "5px 7px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, textAlign: "right" },
  feeWarn: { fontSize: 12, color: "#b26a00", background: "#fff8ec", border: "1px solid #ffe0b2", borderRadius: 7, padding: "7px 10px", margin: "10px 0 0" },
  feeBtns: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 },
  primaryBtn: { padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ghostBtn: { padding: "9px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  ghostDanger: { padding: "9px 14px", background: "#fff", color: "#c62828", border: "1px solid #f0c4c4", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
};
