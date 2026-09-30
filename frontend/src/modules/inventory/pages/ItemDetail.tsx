import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { inventoryApi, ITEM_TYPE_LABELS, type InvItem, type InvLocation, type InvHolding, type BatteryTest, type Vendor } from "../api";
import { api } from "../../../core/api";
import QrCode from "../components/QrCode";
import { ArrowLeft, Edit2, Printer, MoveRight, Archive, ArchiveRestore, X, BatteryCharging, Plus, Trash2, ShieldAlert, Copy, Check, Wrench, ImagePlus, ChevronLeft, ChevronRight } from "lucide-react";
import type { ItemPhoto } from "../api";
import { compressImage } from "../../../core/imageCompress";
import { useGoBack } from "../../../core/useGoBack";
import { repairsApi, STATUS_META as REPAIR_STATUS_META, type RepairTicket } from "../../repairs/api";

const QTY_TYPES = ["part", "consumable"];

export default function ItemDetail() {
  const navigate = useNavigate();
  const goBack = useGoBack("/inventory");
  const { id } = useParams<{ id: string }>();
  const itemId = parseInt(id!);
  const { canWrite, user } = useAuth();
  const canEdit = canWrite("inventory.items");
  // Un-retiring is a deliberately-restricted System Administrator action (not plain "Admin").
  const isSysAdmin = !!user?.roles.includes("System Administrator");
  const canMove = canWrite("inventory.move");
  const canRepair = canWrite("repairs.submit");

  const [item, setItem] = useState<InvItem | null>(null);
  const [repairs, setRepairs] = useState<RepairTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMove, setShowMove] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showReactivate, setShowReactivate] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reactivating, setReactivating] = useState(false);

  const load = useCallback(async () => {
    try { setItem(await inventoryApi.getItem(itemId)); }
    finally { setLoading(false); }
  }, [itemId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { repairsApi.list({ inv_item_id: String(itemId) }).then(setRepairs).catch(() => setRepairs([])); }, [itemId]);

  async function retire() {
    if (!confirm("Retire this item? It stays in history but is marked retired.")) return;
    await inventoryApi.retireItem(itemId);
    load();
  }

  // The exact text a sysadmin must type to confirm reactivation (friction on purpose).
  const reactivateToken = (item?.part_number?.trim() || "REACTIVATE");

  async function reactivate() {
    if (confirmText.trim() !== reactivateToken) return;
    setReactivating(true);
    try {
      await inventoryApi.reactivateItem(itemId);
      setShowReactivate(false);
      setConfirmText("");
      load();
    } catch {
      alert("Reactivation failed. A System Administrator role is required.");
    } finally { setReactivating(false); }
  }

  async function del() {
    if (!confirm(
      `Permanently DELETE "${item?.name}"?\n\n` +
      "This removes the item entirely (use this for items added by mistake). " +
      "Its movement history is removed and any BOM lines that referenced it are unlinked. " +
      "This cannot be undone."
    )) return;
    await inventoryApi.deleteItem(itemId);
    navigate("/inventory");
  }

  if (loading) return <div style={st.muted}>Loading…</div>;
  if (!item) return <div style={st.muted}>Item not found.</div>;

  const isQty = QTY_TYPES.includes(item.item_type);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>

      <div style={st.headRow}>
        <div>
          <span style={st.typeBadge}>{ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}</span>
          {item.asset_category_name && <span style={st.assetCatChip}>{item.asset_category_name}</span>}
          {item.is_donated && <span style={st.donatedChip} title={item.donor_display ? `Donated by ${item.donor_display}` : "Donated"}>🎁 Donated{item.donor_display ? ` · ${item.donor_display}` : ""}</span>}
          <h1 style={st.heading}>{item.name}</h1>
          <div style={st.metaRow}>
            {item.asset_tag && <span style={st.tagChip}>{item.asset_tag}</span>}
            {item.status && <span style={st.statusChip}>{item.status}</span>}
            {item.is_discontinued && <span style={st.discChip}>DISCONTINUED</span>}
            {item.low_stock && !item.is_discontinued && <span style={st.lowChip}>LOW STOCK</span>}
            {(item.open_repairs ?? 0) > 0 && <span style={st.repairChip} title="This asset has an open repair ticket">🔧 REPAIR{(item.open_repairs ?? 0) > 1 ? ` ×${item.open_repairs}` : ""}</span>}
          </div>
        </div>
        <div style={st.actions}>
          {canRepair && <button style={st.repairBtn} onClick={() => navigate(`/repairs/new?item=${itemId}`)}><Wrench size={14} /> Open Repair Ticket</button>}
          {canMove && <button style={st.moveBtn} onClick={() => setShowMove(true)}><MoveRight size={14} /> Move / Adjust</button>}
          {canEdit && <button style={st.editBtn} onClick={() => navigate(`/inventory/items/${itemId}/edit`)}><Edit2 size={13} /> Edit</button>}
          {canEdit && item.status !== "retired" && <button style={st.retireBtn} onClick={retire}><Archive size={13} /> Retire</button>}
          {canEdit && <button style={st.deleteBtn} onClick={del}><Trash2 size={13} /> Delete</button>}
        </div>
      </div>

      {/* Retired notice + gated reactivation (System Administrators only) */}
      {item.status === "retired" && (
        <div style={st.retiredBar}>
          <span style={st.retiredNote}><Archive size={13} /> This item is retired — hidden from the active catalog.</span>
          {isSysAdmin ? (
            !showReactivate ? (
              <button style={st.reactivateLink} onClick={() => setShowReactivate(true)}>
                <ArchiveRestore size={13} /> Reactivate…
              </button>
            ) : null
          ) : (
            <span style={st.retiredMuted}>A System Administrator can reactivate it.</span>
          )}
        </div>
      )}

      {item.status === "retired" && isSysAdmin && showReactivate && (
        <div style={st.reactivatePanel}>
          <div style={st.reactivateHead}><ShieldAlert size={15} color="#b26a00" /> Reactivate this item</div>
          <p style={st.reactivateBody}>
            Reactivating returns this item to the active catalog. This is a System Administrator action.
            To confirm, type <code style={st.token}>{reactivateToken}</code> below.
          </p>
          <div style={st.reactivateRow}>
            <input
              style={st.reactivateInput}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type ${reactivateToken}`}
              autoFocus
            />
            <button
              style={{ ...st.reactivateConfirm, ...(confirmText.trim() !== reactivateToken || reactivating ? st.reactivateDisabled : {}) }}
              disabled={confirmText.trim() !== reactivateToken || reactivating}
              onClick={reactivate}
            >
              {reactivating ? "Reactivating…" : "Reactivate"}
            </button>
            <button style={st.reactivateCancel} onClick={() => { setShowReactivate(false); setConfirmText(""); }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={st.grid}>
        <div>
          <Card title="Details">
            <Row label="Category" value={[item.category, item.subcategory].filter(Boolean).join(" / ")} />
            <CopyableRow label="Part Number" value={item.part_number} />
            <Row label="Serial Number" value={item.serial_number} />
            <Row label="Vendor" value={item.vendor_name} />
            <Row label="Location" value={item.location_path} />
            {item.location_id != null && (
              <SpotRow itemId={itemId} locationId={item.location_id} spot={item.location_spot} canEdit={canMove} onSaved={load} />
            )}
            <Row label="Assigned Team" value={item.assigned_team} />
            {item.battery_type && <Row label="Battery Type" value={item.battery_type} />}
            <Row label="Color" value={item.color} />
            <Row label="Length" value={item.length} />
            <Row label="Pitch" value={item.pitch} />
            <Row label="Pattern" value={item.pattern} />
            <Row label="Inner Diameter" value={item.inner_diameter} />
            <Row label="Outer Diameter" value={item.outer_diameter} />
            <Row label="Measurement" value={item.measurement_system && item.measurement_system !== "na" ? (item.measurement_system === "metric" ? "Metric" : "Imperial") : ""} />
            {item.url && (
              <div style={st.detRow}>
                <span style={st.detLabel}>Product Link</span>
                <a style={{ ...st.detVal, color: "#1565c0" }} href={item.url} target="_blank" rel="noreferrer">Open ↗</a>
              </div>
            )}
            {item.description && <Row label="Description" value={item.description} />}
          </Card>

          {isQty && (
            <Card title="Stock">
              <Row label="On Hand" value={`${item.current_quantity ?? 0} ${item.unit_of_measure ?? ""}`} />
              <Row label="Minimum Level" value={item.minimum_stock_level != null ? String(item.minimum_stock_level) : "—"} />
              <Row label="Package Qty" value={item.package_quantity != null ? String(item.package_quantity) : "—"} />
              {!!item.holdings?.length && (
                <div style={st.holdingsBox}>
                  <div style={st.holdingsHead}>Where it is</div>
                  {item.holdings.map((h) => (
                    <HoldingRow key={h.id} itemId={itemId} holding={h} canEdit={canMove} onSaved={load} />
                  ))}
                  {canMove && <button style={st.transferBtn} onClick={() => setShowTransfer(true)}><MoveRight size={12} /> Transfer between locations / teams</button>}
                </div>
              )}
            </Card>
          )}

          {(item.item_type === "asset_tagged" || item.item_type === "asset_nontagged") && (
            <PhotosCard item={item} canEdit={canEdit} onChanged={load} />
          )}

          <Card title="Acquisition">
            {item.item_type === "asset_nontagged" ? (
              <>
                <Row label="Cost (per item)" value={item.cost != null ? `$${item.cost.toFixed(2)}` : "—"} />
                <Row label="Quantity" value={String(item.current_quantity ?? 1)} />
                {item.cost != null && (
                  <Row label="Total Value" value={`$${(item.cost * Math.max(item.current_quantity ?? 1, 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                )}
              </>
            ) : (
              <Row label="Cost" value={item.cost != null ? `$${item.cost.toFixed(2)}` : "—"} />
            )}
            <Row label="Purchased" value={item.purchase_date} />
            <Row label="Warranty" value={item.warranty_info} />
            {item.is_donated && (
              <Row label="Donated by" value={
                `${item.donor_display ?? "—"}${item.donor_sponsor_name ? " (sponsor)" : ""}${item.donation_date ? ` · ${item.donation_date}` : ""}`
              } />
            )}
          </Card>

          {item.is_kit && <KitCard item={item} canEdit={canEdit} onChanged={load} />}

          <SourcesCard item={item} canEdit={canEdit} onChanged={load} />

          {item.notes && <Card title="Notes"><p style={st.notes}>{item.notes}</p></Card>}

          {item.item_type === "battery" && <BatteryTests itemId={itemId} onChange={load} />}

          <Card title="Repair History">
            {repairs.length === 0 ? (
              <p style={st.muted}>
                No repair tickets for this asset yet.{canRepair && " Use “Open Repair Ticket” above to log one."}
              </p>
            ) : (
              <div style={st.repairList}>
                {repairs.map((r) => (
                  <button key={r.id} style={st.repairRow} onClick={() => navigate(`/repairs/${r.id}`)}>
                    <span style={{ ...st.repairStatus, background: REPAIR_STATUS_META[r.status]?.color ?? "#78909c" }}>
                      {REPAIR_STATUS_META[r.status]?.label ?? r.status}
                    </span>
                    <span style={st.repairTitle}>{r.title}</span>
                    <span style={st.repairMeta}>
                      {r.kind}{r.reported_date ? ` · ${r.reported_date}` : ""}{r.assigned_to_name ? ` · ${r.assigned_to_name}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Movement History">
            {(!item.movements || item.movements.length === 0) ? (
              <p style={st.muted}>No movements recorded.</p>
            ) : (
              <div style={st.moveList}>
                {item.movements.map((m) => (
                  <div key={m.id} style={st.moveRow}>
                    <span style={st.moveType}>{m.movement_type.replace(/_/g, " ")}</span>
                    {m.quantity != null && <span style={st.moveQty}>{m.quantity > 0 ? `qty ${m.quantity}` : m.quantity}</span>}
                    <span style={st.moveMeta}>
                      {m.actor ?? "—"} · {m.created_at ? new Date(m.created_at).toLocaleString() : ""}
                      {m.reason ? ` · ${m.reason}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* QR sidebar for tagged assets */}
        {item.asset_tag && (
          <div>
            <Card title="Asset Tag">
              <div style={st.qrWrap}>
                {/* Scanning the QR opens this asset's page in TRCMS. */}
                <QrCode value={`${window.location.origin}/inventory/items/${item.id}`} size={170} />
                <div style={st.qrTag}>{item.asset_tag}</div>
                <div style={st.qrHint}>Scan to open this asset in TRCMS</div>
                <button style={st.printBtn} onClick={() => navigate(`/inventory/labels?ids=${item.id}`)}><Printer size={13} /> Print Label</button>
              </div>
            </Card>
          </div>
        )}
      </div>

      {showMove && (
        <MoveModal item={item} onClose={() => setShowMove(false)} onDone={() => { setShowMove(false); load(); }} />
      )}
      {showTransfer && (
        <TransferModal item={item} onClose={() => setShowTransfer(false)} onDone={() => { setShowTransfer(false); load(); }} />
      )}
    </div>
  );
}

function PhotosCard({ item, canEdit, onChanged }: { item: InvItem; canEdit: boolean; onChanged: () => void }) {
  const photos = item.photos ?? [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<number | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true); setError("");
    try {
      const uploaded: { url: string }[] = [];
      for (const f of Array.from(files)) {
        const shrunk = await compressImage(f);
        const r = await inventoryApi.uploadPhoto(shrunk);
        uploaded.push({ url: r.url });
      }
      await inventoryApi.addItemPhotos(item.id, uploaded);
      onChanged();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "Upload failed. Use JPG/PNG/GIF/WebP under 5 MB.");
    } finally { setUploading(false); }
  }

  async function removePhoto(p: ItemPhoto) {
    if (!confirm("Remove this photo?")) return;
    await inventoryApi.deleteItemPhoto(p.id);
    onChanged();
  }
  async function editCaption(p: ItemPhoto) {
    const c = prompt("Caption for this photo:", p.caption ?? "");
    if (c === null) return;
    await inventoryApi.updateItemPhoto(p.id, c.trim() || null);
    onChanged();
  }

  return (
    <Card title={`Photos${photos.length ? ` (${photos.length})` : ""}`}>
      {photos.length === 0 && <p style={st.muted}>No photos yet.{canEdit && " Upload photos of this asset below."}</p>}
      {photos.length > 0 && (
        <div style={ph.grid}>
          {photos.map((p, i) => (
            <div key={p.id} style={ph.thumbWrap}>
              <img src={p.url} alt={p.caption ?? item.name} style={ph.thumb} onClick={() => setLightbox(i)} />
              {p.caption && <div style={ph.caption}>{p.caption}</div>}
              {canEdit && (
                <div style={ph.thumbActions}>
                  <button style={ph.thumbBtn} title="Caption" onClick={() => editCaption(p)}><Edit2 size={12} /></button>
                  <button style={{ ...ph.thumbBtn, color: "#c62828" }} title="Remove" onClick={() => removePhoto(p)}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <label style={ph.uploadBtn}>
          <ImagePlus size={14} /> {uploading ? "Uploading…" : "Upload photos"}
          <input type="file" accept="image/*" multiple hidden disabled={uploading}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </label>
      )}
      {error && <p style={{ ...st.muted, color: "#c62828" }}>{error}</p>}

      {lightbox !== null && photos[lightbox] && (
        <div style={ph.overlay} onClick={() => setLightbox(null)}>
          <button style={{ ...ph.navBtn, left: 12 }} onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + photos.length) % photos.length); }}><ChevronLeft size={28} /></button>
          <img src={photos[lightbox].url} alt={photos[lightbox].caption ?? item.name} style={ph.full} onClick={(e) => e.stopPropagation()} />
          <button style={{ ...ph.navBtn, right: 12 }} onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % photos.length); }}><ChevronRight size={28} /></button>
          {photos[lightbox].caption && <div style={ph.fullCaption}>{photos[lightbox].caption}</div>}
        </div>
      )}
    </Card>
  );
}

const ph: Record<string, React.CSSProperties> = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, marginBottom: 12 },
  thumbWrap: { position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid #eceff1", background: "#fafafa" },
  thumb: { width: "100%", height: 110, objectFit: "cover", display: "block", cursor: "pointer" },
  caption: { fontSize: 11, color: "#546e7a", padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  thumbActions: { position: "absolute", top: 4, right: 4, display: "flex", gap: 4 },
  thumbBtn: { background: "rgba(255,255,255,.9)", border: "none", borderRadius: 5, padding: 4, cursor: "pointer", color: "#607d8b", lineHeight: 0 },
  uploadBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#1a237e", color: "#fff", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
  full: { maxWidth: "88vw", maxHeight: "84vh", objectFit: "contain", borderRadius: 6 },
  fullCaption: { position: "absolute", bottom: 24, color: "#fff", fontSize: 14, background: "rgba(0,0,0,.5)", padding: "6px 14px", borderRadius: 6 },
  navBtn: { position: "absolute", top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.15)", color: "#fff", border: "none", borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
};

function BatteryTests({ itemId, onChange }: { itemId: number; onChange: () => void }) {
  const { canWrite } = useAuth();
  const canTest = canWrite("inventory.battery");
  const [tests, setTests] = useState<BatteryTest[]>([]);
  const [adding, setAdding] = useState(false);
  const [beak, setBeak] = useState("");
  const [gobilda, setGobilda] = useState("");
  const [result, setResult] = useState("pass");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => { inventoryApi.listBatteryTests(itemId).then(setTests).catch(() => {}); }, [itemId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setSaving(true);
    try {
      await inventoryApi.addBatteryTest(itemId, {
        resistance_beak: beak === "" ? null : parseFloat(beak),
        resistance_gobilda: gobilda === "" ? null : parseFloat(gobilda),
        result, notes: notes || null,
      });
      setBeak(""); setGobilda(""); setNotes(""); setResult("pass"); setAdding(false);
      load(); onChange();
    } finally { setSaving(false); }
  }

  const RESULT_COLOR: Record<string, string> = { pass: "#2e7d32", marginal: "#e65100", fail: "#c62828" };

  return (
    <div style={bt.card}>
      <div style={bt.head}>
        <span style={bt.title}><BatteryCharging size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Battery Tests</span>
        {canTest && !adding && <button style={bt.addBtn} onClick={() => setAdding(true)}><Plus size={12} /> Log Test</button>}
      </div>

      {adding && (
        <div style={bt.form}>
          <div style={bt.formGrid}>
            <div><label style={bt.l}>Internal Resistance — Battery Beak (mΩ)</label><input type="number" step="0.01" style={bt.input} value={beak} onChange={(e) => setBeak(e.target.value)} /></div>
            <div><label style={bt.l}>Internal Resistance — goBilda (mΩ)</label><input type="number" step="0.01" style={bt.input} value={gobilda} onChange={(e) => setGobilda(e.target.value)} /></div>
            <div><label style={bt.l}>Result</label>
              <select style={bt.input} value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="pass">Pass</option><option value="marginal">Marginal</option><option value="fail">Fail</option>
              </select>
            </div>
            <div><label style={bt.l}>Notes</label><input style={bt.input} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button style={bt.cancel} onClick={() => setAdding(false)}>Cancel</button>
            <button style={bt.save} onClick={add} disabled={saving}>{saving ? "Saving…" : "Save Test"}</button>
          </div>
          <p style={bt.hint}>A "Fail" result automatically sets this battery's status to Failed.</p>
        </div>
      )}

      {tests.length === 0 ? <p style={bt.muted}>No tests logged yet.</p> : (
        <table style={bt.table}>
          <thead><tr><th style={bt.th}>Date</th><th style={bt.thn}>Beak</th><th style={bt.thn}>goBilda</th><th style={bt.th}>Result</th><th style={bt.th}>By</th></tr></thead>
          <tbody>
            {tests.map((t) => (
              <tr key={t.id}>
                <td style={bt.td}>{t.test_date}</td>
                <td style={bt.tdn}>{t.resistance_beak ?? "—"}</td>
                <td style={bt.tdn}>{t.resistance_gobilda ?? "—"}</td>
                <td style={bt.td}><span style={{ ...bt.resultBadge, background: RESULT_COLOR[t.result ?? ""] ?? "#888" }}>{t.result}</span></td>
                <td style={bt.td}>{t.tested_by ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const bt: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 14 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  form: { background: "#faf7fd", border: "1px solid #e6dcf2", borderRadius: 8, padding: 12, marginBottom: 12 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "7px 9px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, boxSizing: "border-box" },
  hint: { fontSize: 11, color: "#6a1b9a", margin: "8px 0 0" },
  cancel: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  save: { padding: "6px 16px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  muted: { color: "#aaa", fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "4px 6px", borderBottom: "1px solid #e2e8f0" },
  thn: { textAlign: "right", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", padding: "4px 6px", borderBottom: "1px solid #e2e8f0" },
  td: { padding: "6px", borderBottom: "1px solid #f4f6fa" },
  tdn: { padding: "6px", textAlign: "right", borderBottom: "1px solid #f4f6fa" },
  resultBadge: { fontSize: 10, fontWeight: 700, color: "#fff", borderRadius: 5, padding: "2px 8px", textTransform: "uppercase" },
};

function MoveModal({ item, onClose, onDone }: { item: InvItem; onClose: () => void; onDone: () => void }) {
  const isQty = QTY_TYPES.includes(item.item_type);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [type, setType] = useState(isQty ? "adjustment" : "location_to_location");
  const [qty, setQty] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [toTeam, setToTeam] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    inventoryApi.listLocations().then(setLocations).catch(() => {});
    api.get("/api/v1/teams/").then(({ data }) => setTeams(
      (data as { team_number: string; current_season?: { id: number; team_name?: string } }[])
        .filter((t) => t.current_season?.id)
        .map((t) => ({ id: t.current_season!.id, label: `Team ${t.team_number}${t.current_season!.team_name ? " — " + t.current_season!.team_name : ""}` }))
    )).catch(() => {});
  }, []);

  const QTY_MOVES = ["receive", "consume", "adjustment"];
  const showLoc = type === "location_to_location";
  const showTeam = type === "assign_team";
  // Quantity field shows for qty adjustments AND for relocating a quantity-tracked item
  const showQty = isQty && (QTY_MOVES.includes(type) || showLoc);
  const onHand = item.current_quantity ?? 0;

  async function submit() {
    setSaving(true); setErr("");
    try {
      const payload: Record<string, unknown> = {};
      // Assign/unassign translate to the backend's team movement types.
      if (type === "assign_team") {
        if (!toTeam) { setErr("Pick a team."); setSaving(false); return; }
        payload.movement_type = item.assigned_team_season_id ? "team_to_team" : "inventory_to_team";
        if (item.assigned_team_season_id) payload.from_team_season_id = item.assigned_team_season_id;
        payload.to_team_season_id = parseInt(toTeam);
      } else if (type === "unassign_team") {
        payload.movement_type = "team_to_inventory";
        if (item.assigned_team_season_id) payload.from_team_season_id = item.assigned_team_season_id;
      } else {
        payload.movement_type = type;
        if (showQty && qty) payload.quantity = parseFloat(qty);
        if (showLoc && toLoc) payload.to_location_id = parseInt(toLoc);
      }
      if (reason.trim()) payload.reason = reason.trim();
      await inventoryApi.moveItem(item.id, payload);
      onDone();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed.");
    } finally { setSaving(false); }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}>
          <span style={st.modalTitle}>Move / Adjust — {item.name}</span>
          <button style={st.closeBtn} onClick={onClose}><X size={17} /></button>
        </div>
        <div style={st.modalBody}>
          {item.assigned_team && <p style={st.moveHint}>Currently assigned to <strong>{item.assigned_team}</strong>.</p>}
          <label style={st.mLabel}>Type</label>
          <select style={st.input} value={type} onChange={(e) => setType(e.target.value)}>
            {isQty && <option value="receive">Receive (add quantity)</option>}
            {isQty && <option value="consume">Consume (subtract quantity)</option>}
            {isQty && <option value="adjustment">Adjustment (add quantity)</option>}
            <option value="location_to_location">Move to a different location</option>
            <option value="assign_team">{item.assigned_team_season_id ? "Reassign to a different team" : "Assign to a team"}</option>
            {item.assigned_team_season_id && <option value="unassign_team">Return to inventory (unassign team)</option>}
          </select>

          {showTeam && (
            <>
              <label style={st.mLabel}>Assign to Team</label>
              <select style={st.input} value={toTeam} onChange={(e) => setToTeam(e.target.value)}>
                <option value="">Select…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </>
          )}

          {showLoc && (
            <>
              <label style={st.mLabel}>Destination Location</label>
              <select style={st.input} value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
              </select>
            </>
          )}
          {showQty && (
            <>
              <label style={st.mLabel}>{showLoc ? `Quantity to move (on hand: ${onHand})` : "Quantity"}</label>
              <input type="number" step="0.01" min="0" max={showLoc ? onHand : undefined} style={st.input}
                value={qty} onChange={(e) => setQty(e.target.value)}
                placeholder={showLoc ? `${onHand} (all)` : ""} />
              {showLoc && (
                <p style={st.moveHint}>
                  Leave blank to move the whole item. Moving fewer than {onHand} splits the stock —
                  that quantity is placed at the destination and the rest stays here.
                </p>
              )}
            </>
          )}
          <label style={st.mLabel}>Reason / Notes</label>
          <input style={st.input} value={reason} onChange={(e) => setReason(e.target.value)} />
          {err && <p style={st.err}>{err}</p>}
        </div>
        <div style={st.modalFoot}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={submit} disabled={saving}>{saving ? "Saving…" : "Apply"}</button>
        </div>
      </div>
    </div>
  );
}

interface TeamOpt { id: number; label: string }
function TransferModal({ item, onClose, onDone }: { item: InvItem; onClose: () => void; onDone: () => void }) {
  const holdings = item.holdings ?? [];
  const [fromId, setFromId] = useState<number | null>(holdings[0]?.id ?? null);
  const [destKind, setDestKind] = useState<"location" | "team">("location");
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [toLoc, setToLoc] = useState("");
  const [toTeam, setToTeam] = useState("");
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    inventoryApi.listLocations().then(setLocations).catch(() => {});
    api.get("/api/v1/teams/").then(({ data }) => setTeams(
      (data as { team_number: string; current_season?: { id: number; team_name?: string } }[])
        .filter((t) => t.current_season?.id)
        .map((t) => ({ id: t.current_season!.id, label: `Team ${t.team_number}${t.current_season!.team_name ? " — " + t.current_season!.team_name : ""}` }))
    )).catch(() => {});
  }, []);

  const from = holdings.find((h) => h.id === fromId);

  async function submit() {
    if (!from) { setErr("Pick a source."); return; }
    const n = parseFloat(qty);
    if (!n || n <= 0) { setErr("Enter a quantity to move."); return; }
    if (n > from.quantity) { setErr(`Only ${from.quantity} available there.`); return; }
    if (destKind === "location" && !toLoc) { setErr("Pick a destination location."); return; }
    if (destKind === "team" && !toTeam) { setErr("Pick a destination team."); return; }
    setSaving(true); setErr("");
    try {
      await inventoryApi.transferStock(item.id, {
        quantity: n,
        from_location_id: from.location_id ?? undefined,
        from_team_season_id: from.team_season_id ?? undefined,
        to_location_id: destKind === "location" ? parseInt(toLoc) : undefined,
        to_team_season_id: destKind === "team" ? parseInt(toTeam) : undefined,
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Transfer failed.");
    } finally { setSaving(false); }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}>
          <span style={st.modalTitle}>Transfer stock — {item.name}</span>
          <button style={st.closeBtn} onClick={onClose}><X size={17} /></button>
        </div>
        <div style={st.modalBody}>
          <label style={st.mLabel}>From</label>
          <select style={st.input} value={fromId ?? ""} onChange={(e) => setFromId(parseInt(e.target.value))}>
            {holdings.map((h) => <option key={h.id} value={h.id}>{h.label} ({h.quantity})</option>)}
          </select>
          <label style={st.mLabel}>Quantity</label>
          <input style={st.input} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={from ? `up to ${from.quantity}` : ""} />
          <label style={st.mLabel}>To</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button style={{ ...st.editBtn, ...(destKind === "location" ? {} : { background: "#eef2f7", color: "#445" }) }} onClick={() => setDestKind("location")}>A location</button>
            <button style={{ ...st.editBtn, ...(destKind === "team" ? {} : { background: "#eef2f7", color: "#445" }) }} onClick={() => setDestKind("team")}>A team</button>
          </div>
          {destKind === "location" ? (
            <select style={st.input} value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
              <option value="">Select location…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
            </select>
          ) : (
            <select style={st.input} value={toTeam} onChange={(e) => setToTeam(e.target.value)}>
              <option value="">Select team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
          {err && <div style={{ color: "#c62828", fontSize: 13, marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
            <button style={st.saveBtn} disabled={saving} onClick={submit}>{saving ? "Transferring…" : "Transfer"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface KitRow { component_item_id: number; name: string; part_number?: string | null; quantity: number }
function KitCard({ item, canEdit, onChanged }: { item: InvItem; canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<KitRow[]>(
    (item.kit_components ?? []).map((c) => ({ component_item_id: c.component_item_id, name: c.name, part_number: c.part_number, quantity: c.quantity }))
  );
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<InvItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  async function search() {
    if (q.trim().length < 2) { setHits([]); return; }
    const r = await inventoryApi.listItems({ search: q.trim(), limit: 10 });
    setHits(r.items.filter((i) => i.id !== item.id && !rows.some((x) => x.component_item_id === i.id)));
  }
  function add(i: InvItem) {
    setRows((rs) => [...rs, { component_item_id: i.id, name: i.name, part_number: i.part_number, quantity: 1 }]);
    setQ(""); setHits([]);
  }
  async function save() {
    setSaving(true); setSavedMsg("");
    try {
      await inventoryApi.setKitComponents(item.id, rows.map((r) => ({ component_item_id: r.component_item_id, quantity: r.quantity })));
      setSavedMsg("Kit contents saved."); onChanged();
      setTimeout(() => setSavedMsg(""), 2500);
    } finally { setSaving(false); }
  }

  return (
    <Card title="Kit Contents">
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>Parts that make up this kit. When the kit is received, these are added to inventory individually.</p>
      {rows.length === 0 && <p style={st.muted}>No parts added yet.</p>}
      {rows.map((r, idx) => (
        <div key={r.component_item_id} style={st.kitRow}>
          <span style={{ flex: 1, fontSize: 13 }}>{r.name}{r.part_number ? ` · ${r.part_number}` : ""}</span>
          {canEdit ? (
            <>
              <input type="number" min="0" step="any" style={st.kitQty} value={r.quantity}
                onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x))} />
              <button style={st.kitRemove} onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}><X size={13} /></button>
            </>
          ) : <span style={st.holdingQty}>×{r.quantity}</span>}
        </div>
      ))}
      {canEdit && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input style={st.input} value={q} placeholder="Search a part to add…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
            <button style={st.editBtn} onClick={search}>Search</button>
          </div>
          {hits.length > 0 && (
            <div style={st.kitHits}>
              {hits.map((i) => <button key={i.id} style={st.kitHit} onClick={() => add(i)}>{i.name}{i.part_number ? ` · ${i.part_number}` : ""}</button>)}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <button style={st.saveBtn} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Kit Contents"}</button>
            {savedMsg && <span style={{ color: "#2e7d32", fontSize: 12 }}>{savedMsg}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

type SourceRow = {
  vendor_id: number; vendor_name: string; vendor_part_number: string;
  price: string; url: string; is_preferred: boolean; notes: string;
};

function SourcesCard({ item, canEdit, onChanged }: { item: InvItem; canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<SourceRow[]>(
    (item.sources ?? []).map((s) => ({
      vendor_id: s.vendor_id, vendor_name: s.vendor_name,
      vendor_part_number: s.vendor_part_number ?? "", price: s.price != null ? String(s.price) : "",
      url: s.url ?? "", is_preferred: s.is_preferred, notes: s.notes ?? "",
    }))
  );
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => { if (canEdit) inventoryApi.listVendors().then(setVendors).catch(() => {}); }, [canEdit]);

  function setRow(idx: number, patch: Partial<SourceRow>) {
    setRows((rs) => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows((rs) => [...rs, { vendor_id: 0, vendor_name: "", vendor_part_number: "", price: "", url: "", is_preferred: rs.length === 0, notes: "" }]);
  }
  function makePreferred(idx: number) {
    setRows((rs) => rs.map((r, i) => ({ ...r, is_preferred: i === idx })));
  }
  async function save() {
    setSaving(true); setSavedMsg("");
    try {
      const payload = rows.filter((r) => r.vendor_id > 0).map((r) => ({
        vendor_id: r.vendor_id, vendor_part_number: r.vendor_part_number || null,
        price: r.price !== "" ? Number(r.price) : null, url: r.url || null,
        is_preferred: r.is_preferred, notes: r.notes || null,
      }));
      const res = await inventoryApi.setItemSources(item.id, payload);
      setRows((res.sources ?? []).map((s) => ({
        vendor_id: s.vendor_id, vendor_name: s.vendor_name,
        vendor_part_number: s.vendor_part_number ?? "", price: s.price != null ? String(s.price) : "",
        url: s.url ?? "", is_preferred: s.is_preferred, notes: s.notes ?? "",
      })));
      setSavedMsg("Vendor sources saved."); onChanged();
      setTimeout(() => setSavedMsg(""), 2500);
    } finally { setSaving(false); }
  }

  if (!canEdit && rows.length === 0) return null;

  return (
    <Card title="Vendor Sources">
      <p style={{ fontSize: 12, color: "#888", margin: "0 0 10px" }}>
        Where this item can be purchased — compare price and part number across vendors. ★ marks the preferred source.
      </p>
      {rows.length === 0 && <p style={st.muted}>No vendor sources listed yet.</p>}

      {!canEdit ? (
        rows.map((r, idx) => (
          <div key={idx} style={st.srcViewRow}>
            <span style={st.srcStar}>{r.is_preferred ? "★" : ""}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
              {r.vendor_name}{r.vendor_part_number ? <span style={st.srcPn}> · {r.vendor_part_number}</span> : null}
            </span>
            {r.price !== "" && <span style={st.srcPrice}>${Number(r.price).toFixed(2)}</span>}
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={st.srcLink}>view</a>}
          </div>
        ))
      ) : (
        <>
          {rows.map((r, idx) => (
            <div key={idx} style={st.srcEditRow}>
              <button style={{ ...st.srcStarBtn, color: r.is_preferred ? "#f5a623" : "#cbd5e1" }}
                title={r.is_preferred ? "Preferred source" : "Make preferred"} onClick={() => makePreferred(idx)}>★</button>
              <select style={st.srcVendor} value={r.vendor_id} onChange={(e) => setRow(idx, { vendor_id: Number(e.target.value) })}>
                <option value={0}>Select vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <input style={st.srcPnInput} placeholder="Vendor part #" value={r.vendor_part_number}
                onChange={(e) => setRow(idx, { vendor_part_number: e.target.value })} />
              <input style={st.srcPriceInput} type="number" min="0" step="0.01" placeholder="$" value={r.price}
                onChange={(e) => setRow(idx, { price: e.target.value })} />
              <input style={st.srcUrlInput} placeholder="Product URL" value={r.url}
                onChange={(e) => setRow(idx, { url: e.target.value })} />
              <button style={st.kitRemove} title="Remove source" onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}><X size={13} /></button>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <button style={st.editBtn} onClick={addRow}><Plus size={13} /> Add Source</button>
            <button style={st.saveBtn} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Sources"}</button>
            {savedMsg && <span style={{ color: "#2e7d32", fontSize: 12 }}>{savedMsg}</span>}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * One "Where it is" line. For physical locations, shows Rack · Shelf · Bin and
 * (when allowed) an inline editor to set them. Team holdings have no spot.
 */
function HoldingRow({ itemId, holding, canEdit, onSaved }: {
  itemId: number; holding: InvHolding; canEdit: boolean; onSaved: () => void;
}) {
  const isLocation = holding.kind === "location" && holding.location_id != null;
  const [editing, setEditing] = useState(false);
  const [rack, setRack] = useState(holding.rack ?? "");
  const [shelf, setShelf] = useState(holding.shelf ?? "");
  const [bin, setBin] = useState(holding.bin ?? "");
  const [saving, setSaving] = useState(false);

  const spotParts = [
    holding.rack ? `Rack ${holding.rack}` : null,
    holding.shelf ? `Shelf ${holding.shelf}` : null,
    holding.bin ? `Bin ${holding.bin}` : null,
  ].filter(Boolean);

  async function save() {
    if (holding.location_id == null) return;
    setSaving(true);
    try {
      await inventoryApi.setLocationBin(itemId, {
        location_id: holding.location_id,
        rack: rack.trim() || null, shelf: shelf.trim() || null, bin: bin.trim() || null,
      });
      setEditing(false);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={st.holdingWrap}>
      <div style={st.holdingRow}>
        <span style={{ ...st.holdingDot, background: holding.kind === "team" ? "#6a1b9a" : "#1565c0" }} />
        <span style={st.holdingLabel}>
          {holding.label}
          {isLocation && (
            <span style={st.spot}>
              {spotParts.length ? spotParts.join(" · ") : <span style={st.spotEmpty}>no rack/shelf/bin set</span>}
              {canEdit && !editing && <button style={st.spotEdit} onClick={() => setEditing(true)}>{spotParts.length ? "Edit" : "Set spot"}</button>}
            </span>
          )}
        </span>
        <span style={st.holdingQty}>{holding.quantity}</span>
      </div>
      {editing && (
        <div style={st.binEditor}>
          <input style={st.binInput} placeholder="Rack" value={rack} onChange={(e) => setRack(e.target.value)} />
          <input style={st.binInput} placeholder="Shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} />
          <input style={st.binInput} placeholder="Bin" value={bin} onChange={(e) => setBin(e.target.value)} />
          <button style={st.binSave} onClick={save} disabled={saving}>{saving ? "…" : "Save"}</button>
          <button style={st.binCancel} onClick={() => { setEditing(false); setRack(holding.rack ?? ""); setShelf(holding.shelf ?? ""); setBin(holding.bin ?? ""); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Storage spot (rack/shelf/bin) for the item's PRIMARY location, shown right under the
// Location row so it's easy to find — and gives single assets (which have no holdings) a
// place to set it. Quantity items can also set per-location spots in "Where it is" below.
function SpotRow({ itemId, locationId, spot, canEdit, onSaved }: {
  itemId: number; locationId: number;
  spot?: { rack?: string | null; shelf?: string | null; bin?: string | null } | null;
  canEdit: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rack, setRack] = useState(spot?.rack ?? "");
  const [shelf, setShelf] = useState(spot?.shelf ?? "");
  const [bin, setBin] = useState(spot?.bin ?? "");
  useEffect(() => { setRack(spot?.rack ?? ""); setShelf(spot?.shelf ?? ""); setBin(spot?.bin ?? ""); }, [spot?.rack, spot?.shelf, spot?.bin]);
  const parts = [
    spot?.rack ? `Rack ${spot.rack}` : null,
    spot?.shelf ? `Shelf ${spot.shelf}` : null,
    spot?.bin ? `Bin ${spot.bin}` : null,
  ].filter(Boolean) as string[];
  async function save() {
    setSaving(true);
    try {
      await inventoryApi.setLocationBin(itemId, { location_id: locationId, rack: rack.trim() || null, shelf: shelf.trim() || null, bin: bin.trim() || null });
      setEditing(false); onSaved();
    } finally { setSaving(false); }
  }
  return (
    <div style={st.detRow}>
      <span style={st.detLabel}>Storage Spot</span>
      <span style={st.detVal}>
        {parts.length ? parts.join(" · ") : <span style={st.spotEmpty}>no rack/shelf/bin set</span>}
        {canEdit && !editing && <button style={st.spotEdit} onClick={() => setEditing(true)}>{parts.length ? "Edit" : "Set spot"}</button>}
        {editing && (
          <div style={st.binEditor}>
            <input style={st.binInput} placeholder="Rack" value={rack} onChange={(e) => setRack(e.target.value)} />
            <input style={st.binInput} placeholder="Shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} />
            <input style={st.binInput} placeholder="Bin" value={bin} onChange={(e) => setBin(e.target.value)} />
            <button style={st.binSave} onClick={save} disabled={saving}>{saving ? "…" : "Save"}</button>
            <button style={st.binCancel} onClick={() => { setEditing(false); setRack(spot?.rack ?? ""); setShelf(spot?.shelf ?? ""); setBin(spot?.bin ?? ""); }}>Cancel</button>
          </div>
        )}
      </span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={st.card}><div style={st.cardTitle}>{title}</div>{children}</div>;
}
function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div style={st.detRow}><span style={st.detLabel}>{label}</span><span style={st.detVal}>{value}</span></div>;
}
function CopyableRow({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div style={st.detRow}>
      <span style={st.detLabel}>{label}</span>
      <span style={{ ...st.detVal, display: "flex", alignItems: "center", gap: 8 }}>
        {value}
        <button style={st.copyBtn} title={copied ? "Copied!" : "Copy part number"}
          onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}>
          {copied ? <Check size={13} color="#2e7d32" /> : <Copy size={13} />}
        </button>
      </span>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  typeBadge: { display: "inline-block", fontSize: 11, fontWeight: 700, color: "#fff", background: "#1565c0", borderRadius: 6, padding: "2px 10px", marginBottom: 6 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  metaRow: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" },
  tagChip: { fontFamily: "monospace", background: "#eef2f7", padding: "2px 8px", borderRadius: 4, color: "#1565c0", fontSize: 13 },
  statusChip: { fontSize: 11, fontWeight: 700, background: "#eef2f7", color: "#555", borderRadius: 6, padding: "2px 8px", textTransform: "uppercase" },
  lowChip: { fontSize: 11, fontWeight: 700, background: "#fff3e0", color: "#e65100", borderRadius: 6, padding: "2px 8px" },
  repairChip: { fontSize: 11, fontWeight: 700, background: "#fdecea", color: "#c62828", borderRadius: 6, padding: "2px 8px" },
  discChip: { fontSize: 11, fontWeight: 700, background: "#ede7f6", color: "#5e35b1", borderRadius: 6, padding: "2px 8px" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  moveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  repairBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", color: "#e65100", border: "1px solid #ffcc99", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  repairList: { display: "flex", flexDirection: "column", gap: 6 },
  repairRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8, cursor: "pointer", textAlign: "left", flexWrap: "wrap" },
  repairStatus: { color: "#fff", fontSize: 10.5, fontWeight: 700, borderRadius: 8, padding: "1px 8px", textTransform: "uppercase", whiteSpace: "nowrap" },
  repairTitle: { fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  repairMeta: { fontSize: 11.5, color: "#889", marginLeft: "auto", textTransform: "capitalize" },
  editBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  retireBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  deleteBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  retiredBar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 14px", marginBottom: 12 },
  retiredNote: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666", fontWeight: 600 },
  retiredMuted: { fontSize: 12, color: "#999", fontStyle: "italic" },
  reactivateLink: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #cdd7e3", borderRadius: 6, padding: "5px 12px", color: "#555", cursor: "pointer", fontSize: 12 },
  reactivatePanel: { background: "#fffaf2", border: "1px solid #f0d8a8", borderRadius: 8, padding: "14px 16px", marginBottom: 14 },
  reactivateHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "#8a5a00", marginBottom: 6 },
  reactivateBody: { fontSize: 13, color: "#6b5630", lineHeight: 1.6, margin: "0 0 10px" },
  token: { fontFamily: "monospace", background: "#f0e6d2", padding: "1px 6px", borderRadius: 4, color: "#7a4f00", fontWeight: 700 },
  reactivateRow: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  reactivateInput: { flex: 1, minWidth: 200, padding: "8px 11px", border: "1px solid #d8c08a", borderRadius: 6, fontSize: 13 },
  reactivateConfirm: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#8a5a00", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  reactivateDisabled: { opacity: 0.45, cursor: "not-allowed" },
  reactivateCancel: { padding: "8px 14px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "1fr 220px", gap: 16, alignItems: "start" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 14 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  detRow: { display: "flex", gap: 10, marginBottom: 7, fontSize: 13 },
  detLabel: { color: "#888", minWidth: 110, fontSize: 12 },
  detVal: { color: "#222", flex: 1 },
  copyBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 3, background: "none", border: "none", color: "#888", cursor: "pointer", borderRadius: 4 },
  notes: { fontSize: 13, color: "#444", lineHeight: 1.6, margin: 0 },
  qrWrap: { textAlign: "center" },
  qrTag: { fontFamily: "monospace", fontSize: 14, color: "#1a3a5c", marginTop: 8, fontWeight: 700 },
  qrHint: { fontSize: 11, color: "#889", marginTop: 3 },
  assetCatChip: { display: "inline-block", marginLeft: 8, fontSize: 11, color: "#5e35b1", background: "#f3effa", borderRadius: 8, padding: "2px 9px", fontWeight: 700, verticalAlign: "middle" },
  donatedChip: { display: "inline-block", marginLeft: 8, fontSize: 11, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "2px 9px", fontWeight: 700, verticalAlign: "middle" },
  printBtn: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, padding: "6px 14px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#1565c0" },
  moveList: { display: "flex", flexDirection: "column", gap: 6 },
  moveRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #f4f6fa", fontSize: 12, flexWrap: "wrap" },
  moveType: { fontWeight: 700, color: "#1a3a5c", textTransform: "capitalize" },
  moveQty: { color: "#2e7d32", fontWeight: 600 },
  moveMeta: { color: "#999" },
  muted: { color: "#aaa", fontSize: 14, padding: "1rem 0" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, width: 440, maxWidth: "95vw" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #e2e8f0" },
  modalTitle: { fontWeight: 700, color: "#1a3a5c", fontSize: 15 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  modalBody: { padding: "16px 18px" },
  mLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "10px 0 4px" },
  moveHint: { fontSize: 11, color: "#888", margin: "6px 0 0", lineHeight: 1.5 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  err: { color: "#c62828", fontSize: 12, marginTop: 8 },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 18px", borderTop: "1px solid #e2e8f0" },
  holdingsBox: { marginTop: 10, borderTop: "1px solid #f0f4f8", paddingTop: 8 },
  holdingsHead: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  holdingWrap: { padding: "2px 0" },
  holdingRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" },
  holdingDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  holdingLabel: { flex: 1, color: "#333" },
  holdingQty: { fontWeight: 700, color: "#1a3a5c" },
  spot: { display: "block", fontSize: 12, color: "#1565c0", marginTop: 1 },
  spotEmpty: { color: "#aaa", fontStyle: "italic" },
  spotEdit: { marginLeft: 8, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0, textDecoration: "underline" },
  binEditor: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "4px 0 6px 16px" },
  binInput: { width: 70, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 12, boxSizing: "border-box" },
  binSave: { padding: "5px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  binCancel: { padding: "5px 10px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  transferBtn: { display: "flex", alignItems: "center", gap: 5, marginTop: 8, padding: "5px 10px", background: "#eef4fb", border: "1px solid #cfe0f3", borderRadius: 6, cursor: "pointer", fontSize: 12, color: "#1565c0" },
  kitRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f4f6f9" },
  kitQty: { width: 64, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  kitRemove: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 3 },
  kitHits: { display: "flex", flexDirection: "column", gap: 4, marginTop: 6, maxHeight: 180, overflowY: "auto" },
  kitHit: { textAlign: "left", padding: "7px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#1a3a5c" },
  srcViewRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #f4f6f9" },
  srcStar: { width: 14, color: "#f5a623", fontSize: 14, textAlign: "center" },
  srcPn: { color: "#888", fontWeight: 400, fontFamily: "monospace", fontSize: 12 },
  srcPrice: { fontWeight: 700, color: "#2e7d32", fontSize: 13 },
  srcLink: { fontSize: 12, color: "#1565c0", textDecoration: "none" },
  srcEditRow: { display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid #f4f6f9", flexWrap: "wrap" },
  srcStarBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 },
  srcVendor: { flex: "1 1 130px", minWidth: 120, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, background: "#fff" },
  srcPnInput: { flex: "1 1 100px", minWidth: 90, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12 },
  srcPriceInput: { width: 72, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12 },
  srcUrlInput: { flex: "2 1 140px", minWidth: 110, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
