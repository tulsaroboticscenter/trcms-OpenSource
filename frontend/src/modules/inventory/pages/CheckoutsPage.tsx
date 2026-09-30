import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { inventoryApi, CHECKOUT_TYPE_LABELS, type Checkout, type InvItem } from "../api";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { ArrowLeft, PlusCircle, X, PackageCheck, Clock, AlertTriangle } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function CheckoutsPage() {
  const goBack = useGoBack("/inventory");
  const { canWrite } = useAuth();
  const canCheckout = canWrite("inventory.checkout");
  const canApprove = canWrite("inventory.checkout_approve");

  const [rows, setRows] = useState<Checkout[]>([]);
  const [filter, setFilter] = useState("out");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [returning, setReturning] = useState<Checkout | null>(null);
  const [editing, setEditing] = useState<Checkout | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string | boolean> = {};
    if (filter === "overdue") params.overdue = true;
    else if (filter === "extensions") params.extension_pending = true;
    else if (filter) params.status = filter;
    inventoryApi.listCheckouts(params).then(setRows).finally(() => setLoading(false));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <div style={st.head}>
        <div>
          <h1 style={st.heading}><PackageCheck size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Equipment Checkout</h1>
          <p style={st.sub}>Track who has what, expected returns, and condition on return.</p>
        </div>
        {canCheckout && <button style={st.addBtn} onClick={() => setCreating(true)}><PlusCircle size={15} /> New Checkout</button>}
      </div>

      <div style={st.tabs}>
        {[["out", "Out"], ["overdue", "Overdue"], ["requested", "Requested"], ["extensions", "Extensions"], ["returned", "Returned"], ["", "All"]].map(([v, l]) => (
          <button key={v || "all"} style={{ ...st.tab, ...(filter === v ? st.tabActive : {}) }} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      {loading ? <p style={st.muted}>Loading…</p> : rows.length === 0 ? (
        <p style={st.muted}>Nothing here.</p>
      ) : (
        <div style={st.list}>
          {rows.map((c) => (
            <div key={c.id} style={{ ...st.row, ...(c.overdue ? st.rowOverdue : {}) }}>
              <div style={st.main}>
                <div style={st.name}>
                  {c.item_name}{c.asset_tag && <span style={st.tag}>{c.asset_tag}</span>}
                  {c.overdue && <span style={st.overdue}><AlertTriangle size={11} /> Overdue</span>}
                </div>
                <div style={st.meta}>
                  {CHECKOUT_TYPE_LABELS[c.checkout_type] ?? c.checkout_type} · {c.holder ?? <span style={{ color: "#c62828" }}>no holder set</span>}
                  {c.requested_by ? <span style={{ marginLeft: 6 }}>· requested by {c.requested_by}</span> : ""}
                  {c.quantity && c.quantity !== 1 ? ` · qty ${c.quantity}` : ""}
                  {c.checkout_date ? <span style={{ marginLeft: 6 }}>out {c.checkout_date.slice(0, 10)}</span> : ""}
                  {c.expected_return_date ? <span style={{ marginLeft: 6 }}><Clock size={11} style={{ verticalAlign: "-1px" }} /> due {c.expected_return_date}</span> : ""}
                  {c.returned_date ? <span style={{ marginLeft: 6, color: "#2e7d32" }}>returned {c.returned_date.slice(0, 10)}</span> : ""}
                </div>
                {c.extension_pending && (
                  <div style={st.extBox}>
                    <Clock size={12} style={{ verticalAlign: "-1px" }} /> Extension requested to <strong>{c.extension_requested_date}</strong>
                    {c.extension_requested_by ? ` by ${c.extension_requested_by}` : ""}
                    {c.extension_note ? <span style={st.extNote}>“{c.extension_note}”</span> : null}
                    {canApprove && (
                      <span style={st.extActions}>
                        <button style={st.approveBtn} onClick={() => inventoryApi.decideExtension(c.id, "approve").then(load)}>Approve</button>
                        <button style={st.denyBtn} onClick={() => inventoryApi.decideExtension(c.id, "deny").then(load)}>Deny</button>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span style={{ ...st.statusBadge, background: STATUS_COLOR[c.status] ?? "#888" }}>{c.status}</span>
              <div style={st.actions}>
                {c.status === "requested" && canApprove && (
                  <button style={st.approveBtn} onClick={() => inventoryApi.approveCheckout(c.id).then(load)}>Approve</button>
                )}
                {c.status === "out" && canApprove && (
                  <button style={st.returnBtn} onClick={() => setReturning(c)}>Return</button>
                )}
                {canApprove && (
                  <button style={st.editBtn} onClick={() => setEditing(c)}>Edit</button>
                )}
                {(c.status === "requested") && canCheckout && (
                  <button style={st.cancelBtn} onClick={() => inventoryApi.cancelCheckout(c.id).then(load)}>Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {returning && <ReturnModal checkout={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); load(); }} />}
      {editing && <EditModal checkout={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { requested: "#e65100", out: "#1565c0", returned: "#2e7d32", cancelled: "#999" };

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [itemMode, setItemMode] = useState<"inventory" | "custom">("inventory");
  const [customName, setCustomName] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [items, setItems] = useState<InvItem[]>([]);
  const [item, setItem] = useState<InvItem | null>(null);
  const [type, setType] = useState("individual");
  const [qty, setQty] = useState("1");
  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [memberId, setMemberId] = useState("");
  const [pickedMember, setPickedMember] = useState<{ id: number; first_name: string; last_name: string } | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamSeasonId, setTeamSeasonId] = useState("");
  const [due, setDue] = useState("");
  const [cond, setCond] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { teamsApi.list().then(setTeams).catch(() => {}); }, []);

  async function searchItems() {
    const d = await inventoryApi.listItems({ search: itemSearch, limit: 15 });
    setItems(d.items);
  }
  async function searchMembers() {
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(memberSearch)}&is_active=true&limit=10`);
    setMembers(data.members);
  }

  async function submit() {
    if (itemMode === "inventory" && !item) { setErr("Select an item."); return; }
    if (itemMode === "custom" && !customName.trim()) { setErr("Enter an item name."); return; }
    if (type === "team" ? !teamSeasonId : !memberId) { setErr("Choose who this equipment is checked out to."); return; }
    setSaving(true); setErr("");
    try {
      await inventoryApi.createCheckout({
        item_id: itemMode === "inventory" && item ? item.id : null,
        custom_item_name: itemMode === "custom" ? customName.trim() : null,
        checkout_type: type,
        quantity: qty === "" ? 1 : parseFloat(qty),
        member_id: type !== "team" && memberId ? parseInt(memberId) : null,
        team_season_id: type === "team" && teamSeasonId ? parseInt(teamSeasonId) : null,
        expected_return_date: due || null,
        condition_out: cond || null,
      });
      onDone();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed.");
    } finally { setSaving(false); }
  }

  const teamsWithSeason = teams.filter((t) => t.current_season?.id);

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}><span style={st.modalTitle}>New Checkout</span><button style={st.closeBtn} onClick={onClose}><X size={17} /></button></div>
        <div style={st.modalBody}>
          <label style={st.l}>Item</label>
          <div style={st.modeRow}>
            <button type="button" style={{ ...st.modeBtn, ...(itemMode === "inventory" ? st.modeOn : {}) }}
              onClick={() => { setItemMode("inventory"); setCustomName(""); }}>Inventory item</button>
            <button type="button" style={{ ...st.modeBtn, ...(itemMode === "custom" ? st.modeOn : {}) }}
              onClick={() => { setItemMode("custom"); setItem(null); }}>Other (free text)</button>
          </div>
          {itemMode === "custom" ? (
            <input style={st.input} placeholder="e.g. Competition Robot #4, assembled drivetrain…"
              value={customName} onChange={(e) => setCustomName(e.target.value)} />
          ) : item ? (
            <div style={st.picked}>{item.name}{item.asset_tag ? ` (${item.asset_tag})` : ""} <button style={st.changeBtn} onClick={() => setItem(null)}>change</button></div>
          ) : (
            <>
              <div style={st.searchRow}>
                <input style={st.input} placeholder="Search items…" value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchItems()} />
                <button style={st.searchBtn} onClick={searchItems}>Search</button>
              </div>
              {items.map((i) => (
                <div key={i.id} style={st.itemOpt} onClick={() => { setItem(i); setItems([]); }}>
                  {i.name}{i.asset_tag ? ` · ${i.asset_tag}` : ""}{i.current_quantity != null ? ` · qty ${i.current_quantity}` : ""}
                </div>
              ))}
            </>
          )}

          <label style={st.l}>Type</label>
          <select style={st.input} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(CHECKOUT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          {type === "team" ? (
            <>
              <label style={st.l}>Team *</label>
              <select style={st.input} value={teamSeasonId} onChange={(e) => setTeamSeasonId(e.target.value)}>
                <option value="">Select team…</option>
                {teamsWithSeason.map((t) => <option key={t.current_season!.id} value={t.current_season!.id}>#{t.team_number} ({t.current_season!.season})</option>)}
              </select>
            </>
          ) : (
            <>
              <label style={st.l}>Checked out to (member) *</label>
              {memberId ? (
                <div style={st.picked}>{pickedMember ? `${pickedMember.first_name} ${pickedMember.last_name}` : `Member #${memberId}`} <button style={st.changeBtn} onClick={() => { setMemberId(""); setPickedMember(null); }}>change</button></div>
              ) : (
                <>
                  <div style={st.searchRow}>
                    <input style={st.input} placeholder="Search members…" value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchMembers()} />
                    <button style={st.searchBtn} onClick={searchMembers}>Search</button>
                  </div>
                  {members.map((m) => (
                    <div key={m.id} style={st.itemOpt} onClick={() => { setMemberId(String(m.id)); setPickedMember(m); setMembers([]); }}>{m.first_name} {m.last_name}</div>
                  ))}
                </>
              )}
            </>
          )}

          <div style={st.grid2}>
            <div><label style={st.l}>Quantity</label><input type="number" step="0.01" style={st.input} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            <div><label style={st.l}>Expected Return</label><input type="date" style={st.input} value={due} onChange={(e) => setDue(e.target.value)} /></div>
          </div>
          <label style={st.l}>Condition / Notes</label>
          <input style={st.input} value={cond} onChange={(e) => setCond(e.target.value)} />
          {err && <p style={st.err}>{err}</p>}
        </div>
        <div style={st.modalFoot}>
          <button style={st.cancelBtn2} onClick={onClose}>Cancel</button>
          <button style={st.confirmBtn} onClick={submit} disabled={saving}>{saving ? "Saving…" : "Check Out"}</button>
        </div>
      </div>
    </div>
  );
}

function ReturnModal({ checkout, onClose, onDone }: { checkout: Checkout; onClose: () => void; onDone: () => void }) {
  const [cond, setCond] = useState("");
  const [damage, setDamage] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try { await inventoryApi.returnCheckout(checkout.id, { condition_in: cond || null, damage_report: damage || null }); onDone(); }
    finally { setSaving(false); }
  }
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}><span style={st.modalTitle}>Return — {checkout.item_name}</span><button style={st.closeBtn} onClick={onClose}><X size={17} /></button></div>
        <div style={st.modalBody}>
          <label style={st.l}>Condition on Return</label>
          <input style={st.input} value={cond} onChange={(e) => setCond(e.target.value)} placeholder="e.g. good, scuffed…" />
          <label style={st.l}>Damage Report (if any)</label>
          <textarea style={{ ...st.input, minHeight: 70 }} value={damage} onChange={(e) => setDamage(e.target.value)} />
        </div>
        <div style={st.modalFoot}>
          <button style={st.cancelBtn2} onClick={onClose}>Cancel</button>
          <button style={st.confirmBtn} onClick={submit} disabled={saving}>{saving ? "Saving…" : "Confirm Return"}</button>
        </div>
      </div>
    </div>
  );
}

/** Edit an existing checkout — holder, dates (out / due / returned), condition, notes. */
function EditModal({ checkout, onClose, onDone }: { checkout: Checkout; onClose: () => void; onDone: () => void }) {
  const d = (v?: string | null) => (v ? v.slice(0, 10) : "");
  const [type, setType] = useState(checkout.checkout_type);
  const [name, setName] = useState(checkout.item_name ?? "");
  const [checkoutDate, setCheckoutDate] = useState(d(checkout.checkout_date));
  const [due, setDue] = useState(d(checkout.expected_return_date));
  const [returnedDate, setReturnedDate] = useState(d(checkout.returned_date));
  const [condOut, setCondOut] = useState(checkout.condition_out ?? "");
  const [condIn, setCondIn] = useState(checkout.condition_in ?? "");
  const [notes, setNotes] = useState(checkout.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Holder — who has the item. Individual/event checkouts go to a member; team checkouts
  // to a team. Prefilled from the current record so it can be corrected or set.
  const [memberId, setMemberId] = useState(checkout.member_id ? String(checkout.member_id) : "");
  const [memberLabel, setMemberLabel] = useState(checkout.member_id ? (checkout.holder ?? `Member #${checkout.member_id}`) : "");
  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamSeasonId, setTeamSeasonId] = useState(checkout.team_season_id ? String(checkout.team_season_id) : "");

  useEffect(() => { teamsApi.list().then(setTeams).catch(() => {}); }, []);
  async function searchMembers() {
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(memberSearch)}&is_active=true&limit=10`);
    setMembers(data.members);
  }
  const teamsWithSeason = teams.filter((t) => t.current_season?.id);

  async function submit() {
    if (checkout.is_custom_item && !name.trim()) { setErr("Enter an item name."); return; }
    if (type === "team" ? !teamSeasonId : !memberId) { setErr("Choose who this equipment is checked out to."); return; }
    setSaving(true); setErr("");
    try {
      await inventoryApi.updateCheckout(checkout.id, {
        checkout_type: type,
        custom_item_name: checkout.is_custom_item ? name.trim() : undefined,
        // Assign the holder: a member for individual/event, a team for team checkouts.
        // The other side is cleared so the record stays consistent with its type.
        member_id: type !== "team" ? (memberId ? parseInt(memberId) : null) : null,
        team_season_id: type === "team" ? (teamSeasonId ? parseInt(teamSeasonId) : null) : null,
        checkout_date: checkoutDate || null,
        expected_return_date: due || null,
        returned_date: returnedDate || null,
        condition_out: condOut || null,
        condition_in: condIn || null,
        notes: notes || null,
      });
      onDone();
    } catch (e) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save.");
    } finally { setSaving(false); }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHead}><span style={st.modalTitle}>Edit Checkout</span><button style={st.closeBtn} onClick={onClose}><X size={17} /></button></div>
        <div style={st.modalBody}>
          {err && <div style={{ color: "#c62828", fontSize: 13, marginBottom: 8 }}>{err}</div>}
          {checkout.is_custom_item ? (
            <><label style={st.l}>Item name</label>
              <input style={st.input} value={name} onChange={(e) => setName(e.target.value)} /></>
          ) : (
            <><label style={st.l}>Item</label><div style={st.picked}>{checkout.item_name}{checkout.asset_tag ? ` (${checkout.asset_tag})` : ""}</div></>
          )}
          <label style={st.l}>Type</label>
          <select style={st.input} value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(CHECKOUT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          {type === "team" ? (
            <>
              <label style={st.l}>Team *</label>
              <select style={st.input} value={teamSeasonId} onChange={(e) => setTeamSeasonId(e.target.value)}>
                <option value="">Select team…</option>
                {teamsWithSeason.map((t) => <option key={t.current_season!.id} value={t.current_season!.id}>#{t.team_number} ({t.current_season!.season})</option>)}
              </select>
            </>
          ) : (
            <>
              <label style={st.l}>Checked out to (member) *</label>
              {memberId ? (
                <div style={st.picked}>{memberLabel} <button style={st.changeBtn} onClick={() => { setMemberId(""); setMemberLabel(""); }}>change</button></div>
              ) : (
                <>
                  <div style={st.searchRow}>
                    <input style={st.input} placeholder="Search members…" value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchMembers()} />
                    <button style={st.searchBtn} onClick={searchMembers}>Search</button>
                  </div>
                  {members.map((m) => (
                    <div key={m.id} style={st.itemOpt} onClick={() => { setMemberId(String(m.id)); setMemberLabel(`${m.first_name} ${m.last_name}`); setMembers([]); }}>{m.first_name} {m.last_name}</div>
                  ))}
                </>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label style={st.l}>Checkout date</label>
              <input type="date" style={st.input} value={checkoutDate} onChange={(e) => setCheckoutDate(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={st.l}>Due date</label>
              <input type="date" style={st.input} value={due} onChange={(e) => setDue(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={st.l}>Returned date</label>
              <input type="date" style={st.input} value={returnedDate} onChange={(e) => setReturnedDate(e.target.value)} /></div>
          </div>
          <label style={st.l}>Condition out</label>
          <input style={st.input} value={condOut} onChange={(e) => setCondOut(e.target.value)} />
          <label style={st.l}>Condition in</label>
          <input style={st.input} value={condIn} onChange={(e) => setCondIn(e.target.value)} />
          <label style={st.l}>Notes</label>
          <textarea style={{ ...st.input, minHeight: 56 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div style={st.modalFoot}>
          <button style={st.cancelBtn2} onClick={onClose}>Cancel</button>
          <button style={st.confirmBtn} onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  tabs: { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" },
  tab: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 20, cursor: "pointer", fontSize: 13, color: "#555" },
  tabActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 },
  rowOverdue: { borderColor: "#ffb74d", background: "#fff8f0" },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  tag: { fontFamily: "monospace", fontSize: 11, background: "#eef2f7", borderRadius: 4, padding: "1px 6px", color: "#1565c0" },
  overdue: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "#e65100" },
  meta: { fontSize: 12, color: "#888", marginTop: 2 },
  statusBadge: { fontSize: 10, fontWeight: 700, color: "#fff", borderRadius: 6, padding: "3px 9px", textTransform: "uppercase", flexShrink: 0 },
  actions: { display: "flex", gap: 6, flexShrink: 0 },
  approveBtn: { background: "#1565c0", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "5px 12px", fontWeight: 600 },
  returnBtn: { background: "#2e7d32", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "5px 12px", fontWeight: 600 },
  denyBtn: { background: "#fff", color: "#c62828", border: "1px solid #f0c8c8", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "5px 12px", fontWeight: 600 },
  extBox: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8, padding: "7px 10px", background: "#eef4fc", border: "1px solid #c5d9f2", borderRadius: 8, fontSize: 12.5, color: "#1565c0" },
  extNote: { fontStyle: "italic", color: "#33475b" },
  extActions: { display: "inline-flex", gap: 6, marginLeft: "auto" },
  cancelBtn: { background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "5px 10px" },
  editBtn: { background: "#fff", color: "#455a64", border: "1px solid #cdd7e3", borderRadius: 5, cursor: "pointer", fontSize: 12, padding: "5px 10px", fontWeight: 600 },
  muted: { color: "#aaa", fontSize: 14, padding: "1rem 0" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, width: 460, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid #e2e8f0" },
  modalTitle: { fontWeight: 700, color: "#1a3a5c", fontSize: 15 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  modalBody: { padding: "14px 18px", overflowY: "auto" },
  l: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "10px 0 4px" },
  searchRow: { display: "flex", gap: 6 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  searchBtn: { padding: "8px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" },
  itemOpt: { padding: "7px 10px", border: "1px solid #eef1f5", borderRadius: 6, marginTop: 4, cursor: "pointer", fontSize: 13, background: "#f8fafc" },
  modeRow: { display: "flex", gap: 6, marginBottom: 6 },
  modeBtn: { flex: 1, padding: "6px 10px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#556" },
  modeOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  picked: { padding: "8px 10px", background: "#eef2f7", borderRadius: 6, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" },
  changeBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  err: { color: "#c62828", fontSize: 12, marginTop: 8 },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 18px", borderTop: "1px solid #e2e8f0" },
  cancelBtn2: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  confirmBtn: { padding: "8px 20px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
