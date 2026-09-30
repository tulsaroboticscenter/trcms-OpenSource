import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, BOM_STATUS_LABELS, BOM_STATUS_COLORS, type Bom, type BomLine, type BudgetCategoryRec, type Vendor } from "../api";
import { ArrowLeft, Plus, Trash2, Send, Undo2, ExternalLink, Ban } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

/** Human label for a BOM's "needed by" (read-only display). */
function neededByText(b: Bom): string | null {
  if (b.needed_by === "asap") return "Needed ASAP";
  if (b.needed_by === "no_rush") return "No rush";
  if (b.needed_by === "date" && b.needed_by_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(b.needed_by_date);
    return m ? `Need by ${new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString()}` : `Need by ${b.needed_by_date}`;
  }
  return null;
}

/** Round the needed quantity up to a whole number of packages. */
// Total UNITS received (rounded up to whole packages).
function effQty(l: BomLine): number {
  const q = l.quantity_required ?? 0;
  const pk = l.package_quantity ?? 0;
  return pk > 0 && q > 0 ? Math.ceil(q / pk) * pk : q;
}
// Number of PACKAGES to buy — the price is per package, so cost = packages × price.
function packagesNeeded(l: BomLine): number {
  const q = l.quantity_required ?? 0;
  const pk = l.package_quantity ?? 0;
  return pk > 0 && q > 0 ? Math.ceil(q / pk) : q;
}

export default function BomDetail() {
  const { id } = useParams<{ id: string }>();
  const bomId = parseInt(id!);
  const { canWrite, user } = useAuth();
  const isSysAdmin = !!user?.roles?.includes("System Administrator");
  const canApprove = canWrite("inventory.bom_approve");
  const canBom = canWrite("inventory.bom");
  const canPo = canWrite("inventory.po");

  const [bom, setBom] = useState<Bom | null>(null);
  const [lines, setLines] = useState<BomLine[]>([]);
  const [cats, setCats] = useState<BudgetCategoryRec[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Spreadsheet-style fast entry: tabbing out of the last field of the last row
  // adds a new line and focuses it. (Hooks must run unconditionally — before any
  // early return below.)
  const partRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const addingRef = useRef(false);

  useEffect(() => {
    if (pendingFocus != null) {
      const el = partRefs.current[pendingFocus];
      if (el) { el.focus(); setPendingFocus(null); }
    }
  }, [lines, pendingFocus]);

  const load = useCallback(async () => {
    const b = await inventoryApi.getBom(bomId);
    setBom(b);
    setLines(b.lines ?? []);
    setLoading(false);
    // Budget categories for this BOM's team (for the per-line "charge against" picker)
    if (b.team_season_id) {
      inventoryApi.getTeamBudget(b.team_season_id)
        .then((tb) => setCats(tb.categories.filter((c) => !c.is_fundraising)))
        .catch(() => {});
    }
  }, [bomId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { inventoryApi.listVendors().then(setVendors).catch(() => {}); }, []);

  const navigate = useNavigate();
  const goBack = useGoBack(bom?.team_season_id ? `/teams/season/${bom.team_season_id}` : "/inventory/boms");

  async function changeVendor(vendorId: string) {
    await inventoryApi.updateBom(bomId, { vendor_id: vendorId ? parseInt(vendorId) : null });
    load();
  }

  if (loading || !bom) return <div style={st.muted}>Loading…</div>;

  // Once a BOM is ordered (or beyond), its youth request fields are frozen.
  const ordered = ["ordered", "partially_received", "received", "archived", "cancelled"].includes(bom.status);
  // Fully received / archived / cancelled → permanently locked: NOTHING is editable (incl. mentor fields).
  const frozen = ["received", "archived", "cancelled"].includes(bom.status);
  // Youth request fields editable while draft (or by a mentor) — but never after ordering.
  const youthEditable = ((canBom && !bom.is_locked) || canApprove) && !ordered;
  // Items can only be ADDED while the BOM is still a draft. Once submitted
  // (ready_to_order) the Add Item button disappears until the BOM is recalled.
  const canAddItems = youthEditable && bom.status === "draft";

  async function patchLine(lineId: number, field: string, value: unknown) {
    await inventoryApi.updateBomLine(bomId, lineId, { [field]: value });
  }
  function setLineLocal(lineId: number, field: string, value: unknown) {
    setLines((ls) => ls.map((l) => l.id === lineId ? { ...l, [field]: value } : l));
  }
  // Dollar fields: format to 2 decimals on blur and save the numeric value (or null when blank).
  function onPriceBlur(lineId: number, field: string, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") { setLineLocal(lineId, field, ""); patchLine(lineId, field, null); return; }
    const num = parseFloat(trimmed);
    if (isNaN(num)) { setLineLocal(lineId, field, ""); patchLine(lineId, field, null); return; }
    setLineLocal(lineId, field, num.toFixed(2));
    patchLine(lineId, field, num);
  }

  // When a part number is entered, save it and — if it matches an inventory
  // item — auto-fill the remaining line fields (only ones still empty).
  async function onPartNumberBlur(l: BomLine, value: string) {
    await patchLine(l.id, "part_number", value);
    const pn = value.trim();
    if (!pn) return;
    try {
      const item = await inventoryApi.getByPartNumber(pn);
      const fill: Record<string, unknown> = { item_id: item.id };
      if (!l.description) fill.description = item.name;
      if (!l.url) fill.url = item.url ?? "";
      if (l.package_quantity == null) fill.package_quantity = item.package_quantity ?? null;
      if (l.expected_price == null) fill.expected_price = item.cost ?? null;
      await inventoryApi.updateBomLine(bomId, l.id, fill);
      setLines((ls) => ls.map((x) => x.id === l.id ? { ...x, ...fill, part_number: pn } : x));
      setMsg(`Auto-filled "${item.name}" from inventory.`);
      setTimeout(() => setMsg(""), 3000);
    } catch {
      /* not in inventory — leave the rest for manual entry */
    }
  }
  async function addLine() {
    const l = await inventoryApi.addBomLine(bomId, { description: "", quantity_required: 1 });
    setLines((ls) => [...ls, l]);
    return l;
  }

  async function onLastFieldTab(e: React.KeyboardEvent, lineId: number) {
    if (e.key !== "Tab" || e.shiftKey || !canAddItems) return;
    if (lines.length === 0 || lineId !== lines[lines.length - 1].id) return; // only the last row
    if (addingRef.current) return;
    e.preventDefault();
    addingRef.current = true;
    try {
      const created = await addLine();
      setPendingFocus(created.id);
    } finally {
      addingRef.current = false;
    }
  }
  async function removeLine(lineId: number) {
    await inventoryApi.deleteBomLine(bomId, lineId);
    setLines((ls) => ls.filter((l) => l.id !== lineId));
    load();
  }

  async function doAction(fn: () => Promise<Bom>, note: string) {
    setBusy(true); setMsg("");
    try { await fn(); await load(); setMsg(note); setTimeout(() => setMsg(""), 4000); }
    catch (e: unknown) { setMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Action failed."); }
    finally { setBusy(false); }
  }


  const expTotal = lines.reduce((s, l) => s + (packagesNeeded(l) * Number(l.expected_price ?? 0)), 0);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}>
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header */}
      <div style={st.headRow}>
        <div>
          <span style={{ ...st.statusBadge, background: BOM_STATUS_COLORS[bom.status] ?? "#888" }}>
            {BOM_STATUS_LABELS[bom.status] ?? bom.status}
          </span>
          {youthEditable ? (
            <input style={st.headingInput} defaultValue={bom.name ?? ""} placeholder="BOM description (e.g. Parts for the drivetrain)"
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (bom.name ?? "")) inventoryApi.updateBom(bomId, { name: v || null }).then(load); }} />
          ) : (
            <h1 style={st.heading}>{bom.display_name || bom.name || `BOM #${bom.id}`}</h1>
          )}
          <div style={st.metaRow}>
            {bom.team && <span style={st.chip}>{bom.team}</span>}
            {youthEditable ? (
              <span style={st.vendorPick}>
                <span style={st.vendorLabel}>Vendor:</span>
                <select style={st.vendorSelect} value={bom.vendor_id ?? ""} onChange={(e) => changeVendor(e.target.value)}>
                  <option value="">Select vendor…</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </span>
            ) : (
              <span>{bom.vendor_name ?? "Vendor TBD"}</span>
            )}
            {youthEditable ? (
              <span style={st.vendorPick}>
                <span style={st.vendorLabel}>Need by:</span>
                <select style={st.vendorSelect} value={bom.needed_by ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    inventoryApi.updateBom(bomId, { needed_by: v, ...(v === "date" ? {} : { needed_by_date: null }) }).then(load);
                  }}>
                  <option value="">No preference</option>
                  <option value="asap">ASAP</option>
                  <option value="no_rush">No rush</option>
                  <option value="date">By a date…</option>
                </select>
                {bom.needed_by === "date" && (
                  <input type="date" style={st.neededDate} defaultValue={bom.needed_by_date ?? ""}
                    onBlur={(e) => inventoryApi.updateBom(bomId, { needed_by_date: e.target.value || null }).then(load)} />
                )}
              </span>
            ) : (
              neededByText(bom) && <span style={st.chip}>🕒 {neededByText(bom)}</span>
            )}
            {bom.created_by && <span>· by {bom.created_by}</span>}
            {bom.is_locked && <span style={st.lockChip}>🔒 Locked</span>}
          </div>
        </div>
        <div style={st.actions}>
          {bom.status === "draft" && canBom && (
            <button style={st.readyBtn} disabled={busy} onClick={() => doAction(() => inventoryApi.bomReady(bomId), "Submitted — purchasing notified.")}>
              <Send size={14} /> Ready to Order
            </button>
          )}
          {bom.status === "ready_to_order" && canBom && (
            <button style={st.recallBtn} disabled={busy} onClick={() => doAction(() => inventoryApi.bomRecall(bomId), "Recalled to draft.")}>
              <Undo2 size={14} /> Recall
            </button>
          )}
          {/* Purchasing manager: reject a submitted BOM (team can revise) or cancel it (kills it). */}
          {bom.status === "ready_to_order" && canApprove && (
            <button style={st.rejectBtn} disabled={busy} onClick={() => {
              const reason = prompt("Reject this order request? Optionally add a note for the team explaining what to fix:");
              if (reason === null) return;
              doAction(() => inventoryApi.bomReject(bomId, reason.trim() || undefined), "BOM rejected — sent back to the team to revise.");
            }}>
              <Ban size={14} /> Reject
            </button>
          )}
          {/* Team revises a rejected BOM back to draft to resubmit. */}
          {bom.status === "rejected" && canBom && (
            <button style={st.recallBtn} disabled={busy} onClick={() => doAction(() => inventoryApi.bomRecall(bomId), "Reopened for revisions.")}>
              <Undo2 size={14} /> Revise
            </button>
          )}
          {/* Cancel kills the BOM for good (must be recreated). */}
          {canApprove && !["received", "archived", "cancelled"].includes(bom.status) && (
            <button style={st.cancelBomBtn} disabled={busy} onClick={() => {
              if (!confirm("Cancel this BOM? This kills it for good — the team would have to create a new one. (To send it back for edits instead, use Reject.)")) return;
              doAction(() => inventoryApi.cancelBom(bomId), "BOM cancelled.");
            }}>
              <Ban size={14} /> Cancel BOM
            </button>
          )}
          {/* Once a PO exists for this BOM, offer a link to view it (no PO
              creation/ordering from the team BOM screen — that's done in the
              purchasing area). */}
          {canPo && bom.po_id && (
            <button style={st.viewPoBtn} onClick={() => navigate(`/inventory/pos/${bom.po_id}`)}>
              <ExternalLink size={14} /> View Purchase Order
            </button>
          )}
          {((canApprove && !bom.po_id) || isSysAdmin) && (
            <button style={st.deleteBtn} disabled={busy} onClick={async () => {
              const label = bom.display_name || bom.name || `BOM #${bom.id}`;
              const onPo = bom.po_id
                ? "\n\nThis BOM is on a purchase order; deleting it will remove it from that PO."
                : "";
              if (!confirm(`Permanently delete "${label}" and all its line items? This cannot be undone.${onPo}`)) return;
              try {
                await inventoryApi.deleteBomPermanent(bomId);
                navigate("/inventory/boms");
              } catch (e: unknown) {
                alert((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to delete BOM.");
              }
            }}>
              <Trash2 size={14} /> Delete BOM
            </button>
          )}
        </div>
      </div>

      {msg && <div style={st.msg}>{msg}</div>}

      {/* Line items */}
      <div style={st.card}>
        <div style={st.cardHead}>
          <span style={st.cardTitle}>Line Items</span>
          {canAddItems && <button style={st.addLineBtn} onClick={addLine}><Plus size={13} /> Add Item</button>}
        </div>

        {lines.length === 0 ? <p style={st.muted}>No items yet.</p> : (
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={{ ...st.th, width: "24%" }}>Part #</th>
                  <th style={{ ...st.th, width: "34%" }}>Description</th>
                  <th style={{ ...st.thNum, width: 52 }}>Pkg Qty</th>
                  <th style={{ ...st.thNum, width: 56 }}>Qty Needed</th>
                  <th style={{ ...st.thNum, width: 74 }}>Est. Price</th>
                  <th style={st.th}>Charged To</th>
                  <th style={st.thNum}>Est. Total</th>
                  {youthEditable && <th style={st.th}></th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const cols = 7 + (youthEditable ? 1 : 0);
                  return (
                  <Fragment key={l.id}>
                    <tr>
                      <td style={st.td}>
                        <input style={st.cell} disabled={!youthEditable} value={l.part_number ?? ""}
                          ref={(el) => { partRefs.current[l.id] = el; }}
                          placeholder="auto-fills if in inventory"
                          onChange={(e) => setLineLocal(l.id, "part_number", e.target.value)}
                          onBlur={(e) => onPartNumberBlur(l, e.target.value)} />
                      </td>
                      <td style={st.td}>
                        <input style={st.cell} disabled={!youthEditable} value={l.description ?? ""}
                          onChange={(e) => setLineLocal(l.id, "description", e.target.value)}
                          onBlur={(e) => patchLine(l.id, "description", e.target.value)} />
                      </td>
                      <td style={st.tdNum}>
                        <input type="number" step="1" min="0" style={{ ...st.cellNum, width: 48 }} disabled={!youthEditable} value={l.package_quantity ?? ""}
                          onChange={(e) => setLineLocal(l.id, "package_quantity", e.target.value)}
                          onBlur={(e) => patchLine(l.id, "package_quantity", e.target.value === "" ? null : parseInt(e.target.value))} />
                      </td>
                      <td style={st.tdNum}>
                        <input type="number" step="1" min="0" style={{ ...st.cellNum, width: 52 }} disabled={!youthEditable} value={l.quantity_required ?? ""}
                          onChange={(e) => setLineLocal(l.id, "quantity_required", e.target.value)}
                          onBlur={(e) => patchLine(l.id, "quantity_required", parseFloat(e.target.value) || 0)} />
                      </td>
                      <td style={st.tdNum}>
                        <input type="text" inputMode="decimal" style={st.cellNum} disabled={!youthEditable} value={l.expected_price ?? ""}
                          onChange={(e) => setLineLocal(l.id, "expected_price", e.target.value)}
                          onBlur={(e) => onPriceBlur(l.id, "expected_price", e.target.value)} />
                      </td>
                      <td style={st.td}>
                        <select style={st.cellSel} disabled={!youthEditable}
                          value={l.budget_category_id ?? ""}
                          onChange={(e) => {
                            const v = e.target.value === "" ? null : parseInt(e.target.value);
                            setLineLocal(l.id, "budget_category_id", v);
                            patchLine(l.id, "budget_category_id", v);
                          }}>
                          <option value="">—</option>
                          {cats.filter((c) => c.parent_id == null).map((p) => [
                            <option key={p.id} value={p.id}>{p.name}</option>,
                            ...cats.filter((c) => c.parent_id === p.id).map((ch) => (
                              <option key={ch.id} value={ch.id}>&nbsp;&nbsp;— {ch.name}</option>
                            )),
                          ])}
                        </select>
                      </td>
                      <td style={st.tdNum} title={packagesNeeded(l) > 1 ? `${packagesNeeded(l)} packages × $${Number(l.expected_price ?? 0).toFixed(2)}` : undefined}>
                        ${(packagesNeeded(l) * Number(l.expected_price ?? 0)).toFixed(2)}
                        {effQty(l) !== (l.quantity_required ?? 0) && <div style={st.roundNote}>{packagesNeeded(l)} pkg · {effQty(l)} units</div>}
                      </td>
                      {youthEditable && (
                        <td style={st.td}>
                          <button tabIndex={-1} style={st.delBtn} onClick={() => removeLine(l.id)}><Trash2 size={13} /></button>
                        </td>
                      )}
                    </tr>
                    {/* Secondary row — URL (reduced) plus the mentor pricing/ordering fields to its right. */}
                    {(youthEditable || l.url || canApprove) && (
                      <tr>
                        <td style={st.urlCell} colSpan={cols}>
                          <div style={st.urlRow}>
                            <div style={st.urlField}>
                              <span style={st.urlLabel}>URL</span>
                              <input style={st.urlInput} disabled={!youthEditable} value={l.url ?? ""}
                                placeholder="https://… (product / reorder link)"
                                onKeyDown={(e) => onLastFieldTab(e, l.id)}
                                onChange={(e) => setLineLocal(l.id, "url", e.target.value)}
                                onBlur={(e) => patchLine(l.id, "url", e.target.value)} />
                            </div>
                            {canApprove && (
                              <>
                                <label style={st.inlineField}>
                                  <span style={st.urlLabel}>Actual $</span>
                                  <input type="text" inputMode="decimal" tabIndex={-1} style={{ ...st.cellNum, width: 84 }} disabled={frozen} value={l.actual_purchase_price ?? ""}
                                    onChange={(e) => setLineLocal(l.id, "actual_purchase_price", e.target.value)}
                                    onBlur={(e) => onPriceBlur(l.id, "actual_purchase_price", e.target.value)} />
                                </label>
                                <label style={st.inlineField}>
                                  <span style={st.urlLabel}>Ord. Qty</span>
                                  <input type="number" step="1" min="0" tabIndex={-1} style={{ ...st.cellNum, width: 64 }} disabled={frozen} value={l.ordered_quantity ?? ""}
                                    onChange={(e) => setLineLocal(l.id, "ordered_quantity", e.target.value)}
                                    onBlur={(e) => patchLine(l.id, "ordered_quantity", e.target.value === "" ? null : parseFloat(e.target.value))} />
                                </label>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={st.totalsRow}>
          <span>Estimated total: <strong>${expTotal.toFixed(2)}</strong></span>
          {bom.actual_total ? <span>Actual total: <strong>${bom.actual_total.toFixed(2)}</strong></span> : null}
        </div>
      </div>

      {/* Order/fulfillment lives on the Purchase Order, not the BOM. */}

      {!youthEditable && !canApprove && (
        <p style={st.note}>This BOM is locked. {canBom ? "Recall it to make changes." : ""}</p>
      )}
    </div>
  );
}


const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  statusBadge: { display: "inline-block", fontSize: 11, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 10px", marginBottom: 6 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  headingInput: { fontSize: 22, fontWeight: 700, color: "#1a3a5c", border: "1px solid transparent", borderRadius: 6, padding: "2px 6px", margin: "-2px -6px", width: "min(520px, 70vw)", background: "transparent" },
  metaRow: { display: "flex", gap: 8, marginTop: 6, fontSize: 13, color: "#555", alignItems: "center", flexWrap: "wrap" },
  chip: { fontSize: 11, color: "#1565c0", background: "#eef2f7", borderRadius: 4, padding: "1px 7px" },
  vendorPick: { display: "inline-flex", alignItems: "center", gap: 6 },
  vendorLabel: { fontSize: 12, color: "#888", fontWeight: 600 },
  vendorSelect: { padding: "3px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, color: "#1a3a5c", background: "#fff", cursor: "pointer" },
  neededDate: { padding: "2px 6px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, marginLeft: 4 },
  lockChip: { fontSize: 11, color: "#e65100" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  readyBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#e65100", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  recallBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#e65100", border: "1px solid #ffb74d", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  orderBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  poBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  viewPoBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#6a1b9a", border: "1px solid #ce93d8", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  deleteBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  rejectBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#b45309", border: "1px solid #f0c084", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancelBomBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  msg: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "8px 14px", color: "#2e7d32", marginBottom: 12, fontSize: 13 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 14 },
  cardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  addLineBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "4px 6px", borderBottom: "1px solid #e2e8f0" },
  thNum: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "4px 6px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "4px 6px", verticalAlign: "top", borderBottom: "1px solid #f4f6fa" },
  tdNum: { padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f4f6fa", whiteSpace: "nowrap" },
  cell: { width: "100%", padding: "5px 7px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13, boxSizing: "border-box", marginBottom: 3 },
  cellNum: { width: 80, padding: "5px 7px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 13, textAlign: "right", boxSizing: "border-box" },
  cellSel: { width: 130, padding: "5px 7px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 12, boxSizing: "border-box", background: "#fff" },
  urlCell: { padding: "0 6px 10px 6px", borderBottom: "1px solid #e2e8f0" },
  urlRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" as const },
  urlField: { display: "flex", alignItems: "center", flex: "1 1 260px", minWidth: 180 },
  inlineField: { display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" as const },
  urlLabel: { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 8 },
  urlInput: { flex: 1, padding: "5px 7px", border: "1px solid #e2e8f0", borderRadius: 5, fontSize: 12, color: "#1565c0", boxSizing: "border-box" },
  delBtn: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 4 },
  roundNote: { fontSize: 10, color: "#e65100", fontWeight: 600 },
  totalsRow: { display: "flex", justifyContent: "flex-end", gap: 20, marginTop: 12, paddingTop: 10, borderTop: "1px solid #f0f4f8", fontSize: 14, color: "#1a3a5c" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: 8 },
  flabel: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "8px 0 4px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  saveBtn: { padding: "9px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  addAddrBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" },
  cancelAddrBtn: { padding: "8px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  note: { fontSize: 13, color: "#888", fontStyle: "italic" },
  muted: { color: "#aaa", fontSize: 14, padding: "0.5rem 0" },
  fieldset: { border: "none", padding: 0, margin: 0, minWidth: 0 },
  frozenNote: { background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#475569", marginBottom: 12 },
};
