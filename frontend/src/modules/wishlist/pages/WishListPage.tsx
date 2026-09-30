import { useEffect, useMemo, useState } from "react";
import { PlusCircle, ExternalLink, Gift, Pencil, Trash2, Archive } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";
import { wishlistApi, PRIORITIES, STATUSES, type WishItem, type WishDonation } from "../api";

type TeamOpt = { id: number; label: string };
type Scope = "trc" | "team";

export default function WishListPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole("Mentor", "Admin", "System Administrator", "Executive Director", "Team Leader");

  const [scope, setScope] = useState<Scope>("trc");
  const [teamOpts, setTeamOpts] = useState<TeamOpt[]>([]);
  const [teamSeasonId, setTeamSeasonId] = useState<number | "">("");
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [items, setItems] = useState<WishItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<WishItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fulfilling, setFulfilling] = useState<WishItem | null>(null);

  useEffect(() => { wishlistApi.teams().then(setTeamOpts); }, []);

  async function reload() {
    setLoading(true);
    const params: Record<string, string> = { scope };
    if (scope === "team" && teamSeasonId) params.team_season_id = String(teamSeasonId);
    if (statusFilter) params.status = statusFilter;
    try {
      if (scope === "team" && !teamSeasonId) { setItems([]); return; }
      setItems(await wishlistApi.list(params));
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [scope, teamSeasonId, statusFilter]);

  function openNew() {
    setEditing(null); setShowForm(true);
  }
  function openEdit(w: WishItem) { setEditing(w); setShowForm(true); }

  async function remove(w: WishItem) {
    if (!confirm(`Delete “${w.name}” from the wish list?`)) return;
    await wishlistApi.remove(w.id); reload();
  }
  async function archive(w: WishItem) {
    await wishlistApi.update(w.id, { status: "archived" }); reload();
  }

  const grouped = useMemo(() => {
    return PRIORITIES.map((p) => ({ p, rows: items.filter((i) => i.priority === p.value) }))
      .filter((g) => g.rows.length > 0);
  }, [items]);

  const totalOpen = items.filter((i) => i.status === "open").reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);

  return (
    <div style={st.wrap}>
      <div style={st.head}>
        <h1 style={st.h1}><Gift size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />Wish List</h1>
        {canManage && (
          <button style={st.addBtn} onClick={openNew}><PlusCircle size={15} /> Add Wish</button>
        )}
      </div>
      <p style={st.sub}>Things we'd like for the TRC and for teams — link a vendor page, set a price and priority, and record the donation when one arrives.</p>

      <div style={st.tabs}>
        <button style={{ ...st.tab, ...(scope === "trc" ? st.tabOn : {}) }} onClick={() => setScope("trc")}>TRC Wish List</button>
        <button style={{ ...st.tab, ...(scope === "team" ? st.tabOn : {}) }} onClick={() => setScope("team")}>Team Wish Lists</button>
      </div>

      <div style={st.filters}>
        {scope === "team" && (
          <select style={st.sel} value={teamSeasonId} onChange={(e) => setTeamSeasonId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— Pick a team —</option>
            {teamOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        <select style={st.sel} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {totalOpen > 0 && <span style={st.total}>Open total: ${totalOpen.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>}
      </div>

      {loading ? <p style={st.muted}>Loading…</p>
        : scope === "team" && !teamSeasonId ? <p style={st.muted}>Pick a team to see its wish list.</p>
        : items.length === 0 ? <p style={st.muted}>No wishes here yet.{canManage && " Click “Add Wish”."}</p>
        : grouped.map((g) => (
          <div key={g.p.value} style={{ marginBottom: 18 }}>
            <div style={{ ...st.prioHead, color: g.p.color }}>{g.p.label} priority</div>
            {g.rows.map((w) => <WishRow key={w.id} w={w} canManage={canManage}
              onEdit={() => openEdit(w)} onDelete={() => remove(w)} onArchive={() => archive(w)}
              onFulfill={() => setFulfilling(w)} onChanged={reload} />)}
          </div>
        ))}

      {showForm && (
        <WishForm item={editing} scope={scope} teamSeasonId={scope === "team" ? (teamSeasonId || null) : null}
          teamOpts={teamOpts} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload(); }} />
      )}
      {fulfilling && (
        <FulfillModal item={fulfilling} onClose={() => setFulfilling(null)}
          onDone={() => { setFulfilling(null); reload(); }} />
      )}
    </div>
  );
}

function WishRow({ w, canManage, onEdit, onDelete, onArchive, onFulfill, onChanged }: {
  w: WishItem; canManage: boolean; onEdit: () => void; onDelete: () => void; onArchive: () => void; onFulfill: () => void; onChanged: () => void;
}) {
  const sColor = STATUSES.find((s) => s.value === w.status)?.color ?? "#6b7280";
  const [open, setOpen] = useState(false);
  const [donations, setDonations] = useState<WishDonation[] | null>(null);
  const partial = w.fulfilled_qty > 0 && w.fulfilled_qty < w.quantity;

  function toggleDonations() {
    const next = !open; setOpen(next);
    if (next && donations === null) wishlistApi.donations(w.id).then(setDonations).catch(() => setDonations([]));
  }
  async function thank(d: WishDonation) { await wishlistApi.updateDonation(d.id, { thanked: !d.thanked }); wishlistApi.donations(w.id).then(setDonations); onChanged(); }
  async function del(d: WishDonation) { if (!confirm("Remove this donation?")) return; await wishlistApi.deleteDonation(d.id); wishlistApi.donations(w.id).then(setDonations); onChanged(); }

  return (
    <div style={{ ...st.row, flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.rowTop}>
            <span style={st.name}>{w.name}</span>
            {w.url && <a href={w.url} target="_blank" rel="noreferrer" style={st.link}><ExternalLink size={13} /> vendor</a>}
            <span style={{ ...st.badge, background: sColor }}>{STATUSES.find((s) => s.value === w.status)?.label}</span>
            {w.is_asset && <span style={st.assetTag}>asset</span>}
            {w.needs_thanks && <span style={{ ...st.badge, background: "#e65100" }}>needs thanks</span>}
          </div>
          {w.description && <div style={st.desc}>{w.description}</div>}
          <div style={st.meta}>
            {w.price != null && <span>${w.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}{w.quantity > 1 ? ` × ${w.quantity}` : ""}</span>}
            {w.team_label && <span>· {w.team_label}</span>}
            {w.requested_by_name && <span>· req. {w.requested_by_name}</span>}
            {partial && <span style={st.donor}>· {w.fulfilled_qty} of {w.quantity} fulfilled</span>}
            {w.status === "fulfilled" && w.donation_count <= 1 && w.donor_display && <span style={st.donor}>🎁 {w.donor_display}{w.fulfilled_amount != null ? ` — $${w.fulfilled_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}</span>}
            {w.linked_asset_tag && <span style={st.donor}>· {w.linked_asset_tag}</span>}
            {w.donation_count > 0 && <button style={st.donationsToggle} onClick={toggleDonations}>{open ? "▾" : "▸"} {w.donation_count} donation{w.donation_count !== 1 ? "s" : ""}</button>}
          </div>
          {partial && (
            <div style={st.progWrap}><div style={st.progBar}><div style={{ ...st.progFill, width: `${Math.min(100, Math.round((w.fulfilled_qty / w.quantity) * 100))}%` }} /></div></div>
          )}
        </div>
        {canManage && (
          <div style={st.actions}>
            {w.status === "open" && <button style={st.fulfillBtn} onClick={onFulfill}><Gift size={13} /> {partial ? "Add donation" : "Fulfill"}</button>}
            <button style={st.iconBtn} title="Edit" onClick={onEdit}><Pencil size={14} /></button>
            {w.status !== "archived" && <button style={st.iconBtn} title="Archive" onClick={onArchive}><Archive size={14} /></button>}
            <button style={{ ...st.iconBtn, color: "#c62828" }} title="Delete" onClick={onDelete}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      {open && donations && (
        <div style={st.donationsBox}>
          {donations.length === 0 ? <div style={st.muted}>No donations recorded.</div> : donations.map((d) => (
            <div key={d.id} style={st.donationRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{d.donor_display ?? "Anonymous"}</span>
                <span style={st.donationMeta}> · {d.quantity} unit{d.quantity !== 1 ? "s" : ""}{d.amount != null ? ` · $${d.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}{d.fulfilled_date ? ` · ${d.fulfilled_date}` : ""}</span>
                {d.thanked ? <span style={st.thankedTag}>✓ thanked{d.thanked_by_name ? ` by ${d.thanked_by_name}` : ""}</span> : <span style={st.needsThankTag}>not thanked</span>}
              </div>
              {canManage && (
                <>
                  <button style={st.thankBtn} onClick={() => thank(d)}>{d.thanked ? "Unmark" : "Mark thanked"}</button>
                  <button style={{ ...st.iconBtn, color: "#c62828" }} title="Remove donation" onClick={() => del(d)}><Trash2 size={13} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WishForm({ item, scope, teamSeasonId, teamOpts, onClose, onSaved }: {
  item: WishItem | null; scope: Scope; teamSeasonId: number | null; teamOpts: TeamOpt[];
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [priority, setPriority] = useState(item?.priority ?? "normal");
  const [isAsset, setIsAsset] = useState(item?.is_asset ?? true);
  const [wScope, setWScope] = useState<Scope>(item?.scope ?? scope);
  const [tsId, setTsId] = useState<number | "">(item?.team_season_id ?? teamSeasonId ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) { setErr("A name is required."); return; }
    if (wScope === "team" && !tsId) { setErr("Pick a team for a team wish."); return; }
    setSaving(true); setErr("");
    const payload: Record<string, unknown> = {
      name: name.trim(), description, url, price: price === "" ? null : Number(price),
      quantity: Number(quantity) || 1, priority, is_asset: isAsset, scope: wScope,
      team_season_id: wScope === "team" ? tsId : null,
    };
    try {
      if (item) await wishlistApi.update(item.id, payload);
      else await wishlistApi.create(payload);
      onSaved();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErr(msg ?? "Save failed."); setSaving(false);
    }
  }

  return (
    <Modal title={item ? "Edit Wish" : "Add Wish"} onClose={onClose}>
      {err && <div style={st.err}>{err}</div>}
      <label style={st.lbl}>Item name *</label>
      <input style={st.inp} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <label style={st.lbl}>Description</label>
      <textarea style={{ ...st.inp, minHeight: 54 }} value={description} onChange={(e) => setDescription(e.target.value)} />
      <label style={st.lbl}>Vendor link (Amazon, etc.)</label>
      <input style={st.inp} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      <div style={st.grid2}>
        <div><label style={st.lbl}>Price (each)</label>
          <input style={st.inp} type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label style={st.lbl}>Quantity</label>
          <input style={st.inp} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
      </div>
      <div style={st.grid2}>
        <div><label style={st.lbl}>Priority</label>
          <select style={st.inp} value={priority} onChange={(e) => setPriority(e.target.value as WishItem["priority"])}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select></div>
        <div><label style={st.lbl}>Wish list</label>
          <select style={st.inp} value={wScope} onChange={(e) => setWScope(e.target.value as Scope)}>
            <option value="trc">TRC</option><option value="team">A team</option>
          </select></div>
      </div>
      {wScope === "team" && (
        <><label style={st.lbl}>Team *</label>
          <select style={st.inp} value={tsId} onChange={(e) => setTsId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— Pick a team —</option>
            {teamOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select></>
      )}
      <label style={st.check}>
        <input type="checkbox" checked={isAsset} onChange={(e) => setIsAsset(e.target.checked)} />
        This is an asset (fulfilling it can create a tracked inventory asset). Uncheck for parts/consumables.
      </label>
      <div style={st.modalBtns}>
        <button style={st.cancel} onClick={onClose}>Cancel</button>
        <button style={st.save} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function FulfillModal({ item, onClose, onDone }: { item: WishItem; onClose: () => void; onDone: () => void }) {
  const [donorMode, setDonorMode] = useState<"member" | "sponsor" | "name">("name");
  const [memberQ, setMemberQ] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [memberId, setMemberId] = useState<number | null>(null);
  const [memberLabel, setMemberLabel] = useState("");
  const [sponsors, setSponsors] = useState<{ id: number; name: string }[]>([]);
  const [sponsorId, setSponsorId] = useState<number | "">("");
  const [donorName, setDonorName] = useState("");
  const [amount, setAmount] = useState(item.price != null ? String(item.price) : "");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const remaining = item.remaining_qty ?? item.quantity;
  const [qty, setQty] = useState(String(remaining));
  const [thanked, setThanked] = useState(false);
  const [createAsset, setCreateAsset] = useState(item.is_asset);
  const [assetType, setAssetType] = useState<"asset_tagged" | "asset_nontagged">("asset_tagged");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (donorMode === "sponsor" && sponsors.length === 0) wishlistApi.sponsors().then(setSponsors); }, [donorMode, sponsors.length]);
  useEffect(() => {
    if (donorMode !== "member" || memberQ.trim().length < 2) { setMemberResults([]); return; }
    const t = setTimeout(() => wishlistApi.searchMembers(memberQ.trim()).then(setMemberResults), 250);
    return () => clearTimeout(t);
  }, [memberQ, donorMode]);

  async function submit() {
    setSaving(true); setErr("");
    const payload = {
      donor_member_id: donorMode === "member" ? memberId : null,
      donor_sponsor_id: donorMode === "sponsor" ? (sponsorId || null) : null,
      donor_name: donorMode === "name" ? donorName.trim() : null,
      quantity: qty === "" ? null : Number(qty),
      amount: amount === "" ? null : Number(amount),
      date: date || null, notes: notes || null,
      thanked,
      create_asset: createAsset, asset_type: assetType,
    };
    try { await wishlistApi.fulfill(item.id, payload); onDone(); }
    catch { setErr("Could not record the donation."); setSaving(false); }
  }

  return (
    <Modal title={`Record a donation — ${item.name}`} onClose={onClose}>
      {err && <div style={st.err}>{err}</div>}
      {item.quantity > 1 && (
        <div style={{ marginBottom: 8 }}>
          <label style={st.lbl}>How many did they donate? <span style={{ color: "#94a3b8", fontWeight: 400 }}>({remaining} of {item.quantity} still needed)</span></label>
          <input style={st.inp} type="number" min={1} max={remaining} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
      )}
      <label style={st.lbl}>Who donated?</label>
      <div style={st.tabs}>
        {(["member", "sponsor", "name"] as const).map((m) => (
          <button key={m} style={{ ...st.tab, ...(donorMode === m ? st.tabOn : {}) }} onClick={() => setDonorMode(m)}>
            {m === "member" ? "Member" : m === "sponsor" ? "Sponsor" : "Free-form"}
          </button>
        ))}
      </div>
      {donorMode === "member" && (
        <div style={{ position: "relative" }}>
          <input style={st.inp} placeholder="Search members…" value={memberId ? memberLabel : memberQ}
            onChange={(e) => { setMemberId(null); setMemberQ(e.target.value); }} />
          {!memberId && memberResults.length > 0 && (
            <div style={st.dropdown}>
              {memberResults.map((m) => (
                <div key={m.id} style={st.ddRow} onClick={() => { setMemberId(m.id); setMemberLabel(`${m.first_name} ${m.last_name}`); setMemberResults([]); }}>
                  {m.first_name} {m.last_name}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {donorMode === "sponsor" && (
        <select style={st.inp} value={sponsorId} onChange={(e) => setSponsorId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">— Pick a sponsor —</option>
          {sponsors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {donorMode === "name" && (
        <input style={st.inp} placeholder="Donor name (person or company)" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
      )}
      <div style={st.grid2}>
        <div><label style={st.lbl}>Amount / value</label>
          <input style={st.inp} type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label style={st.lbl}>Date</label>
          <input style={st.inp} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <label style={st.lbl}>Notes</label>
      <textarea style={{ ...st.inp, minHeight: 44 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <label style={st.check}>
        <input type="checkbox" checked={thanked} onChange={(e) => setThanked(e.target.checked)} />
        We've already thanked this donor
      </label>
      {item.is_asset && (
        <>
          <label style={st.check}>
            <input type="checkbox" checked={createAsset} onChange={(e) => setCreateAsset(e.target.checked)} />
            Create a tracked inventory asset carrying this donation
          </label>
          {createAsset && (
            <select style={st.inp} value={assetType} onChange={(e) => setAssetType(e.target.value as "asset_tagged" | "asset_nontagged")}>
              <option value="asset_tagged">Tagged asset (auto TRC-##### tag)</option>
              <option value="asset_nontagged">Non-tagged asset</option>
            </select>
          )}
        </>
      )}
      <div style={st.modalBtns}>
        <button style={st.cancel} onClick={onClose}>Cancel</button>
        <button style={st.save} onClick={submit} disabled={saving}>{saving ? "Saving…" : "Record donation"}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={st.modalTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { padding: "20px 24px", maxWidth: 900, margin: "0 auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 24, margin: 0, color: "#1a237e" },
  sub: { color: "#546e7a", fontSize: 13, marginTop: 6 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#1a237e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  tabs: { display: "flex", gap: 6, marginTop: 14 },
  tab: { border: "1px solid #cfd8dc", background: "#fff", padding: "7px 14px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#37474f" },
  tabOn: { background: "#1a237e", color: "#fff", borderColor: "#1a237e" },
  filters: { display: "flex", gap: 10, alignItems: "center", margin: "14px 0" },
  sel: { padding: "7px 10px", borderRadius: 6, border: "1px solid #cfd8dc", fontSize: 13 },
  total: { marginLeft: "auto", fontSize: 13, color: "#2e7d32", fontWeight: 600 },
  prioHead: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  row: { display: "flex", gap: 12, alignItems: "flex-start", background: "#fff", border: "1px solid #eceff1", borderRadius: 8, padding: "12px 14px", marginBottom: 8 },
  rowTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontWeight: 600, color: "#263238" },
  link: { display: "inline-flex", alignItems: "center", gap: 3, color: "#1565c0", fontSize: 12, textDecoration: "none" },
  badge: { color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, textTransform: "uppercase" },
  assetTag: { fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: "#e8eaf6", color: "#3949ab", textTransform: "uppercase" },
  desc: { fontSize: 13, color: "#546e7a", marginTop: 3 },
  meta: { display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#78909c", marginTop: 5 },
  donor: { color: "#2e7d32", fontWeight: 600 },
  actions: { display: "flex", gap: 4, alignItems: "center" },
  fulfillBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer" },
  donationsToggle: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 },
  progWrap: { marginTop: 6 },
  progBar: { height: 6, background: "#eef2f7", borderRadius: 4, overflow: "hidden" },
  progFill: { height: "100%", background: "#2e7d32" },
  donationsBox: { marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0", display: "flex", flexDirection: "column", gap: 6 },
  donationRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", flexWrap: "wrap" },
  donationMeta: { color: "#64748b", fontSize: 12.5 },
  thankedTag: { marginLeft: 8, color: "#2e7d32", fontWeight: 700, fontSize: 11.5 },
  needsThankTag: { marginLeft: 8, color: "#e65100", fontWeight: 700, fontSize: 11.5 },
  thankBtn: { background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 6, padding: "4px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  iconBtn: { background: "transparent", border: "1px solid #eceff1", borderRadius: 6, padding: 6, cursor: "pointer", color: "#607d8b", lineHeight: 0 },
  muted: { color: "#90a4ae", fontSize: 14, marginTop: 20 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px", zIndex: 1000, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 10, padding: 22, width: "100%", maxWidth: 440 },
  modalTitle: { margin: "0 0 12px", fontSize: 18, color: "#1a237e" },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#455a64", margin: "10px 0 4px" },
  inp: { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: "1px solid #cfd8dc", fontSize: 13 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  check: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#455a64", margin: "12px 0 4px", lineHeight: 1.4 },
  modalBtns: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  cancel: { background: "#eceff1", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer", color: "#455a64" },
  save: { background: "#1a237e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" },
  err: { background: "#ffebee", color: "#c62828", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 4 },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #cfd8dc", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,.12)", zIndex: 10, maxHeight: 180, overflowY: "auto" },
  ddRow: { padding: "8px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f5f5f5" },
};
