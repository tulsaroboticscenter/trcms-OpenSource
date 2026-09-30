import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { repairsApi, KIND_META, STATUS_META, PRIORITY_META, STATUS_ORDER, CORR_DIRECTION_META, CORR_CHANNELS, type RepairTicket, type RepairCorrespondence } from "../api";
import { Wrench, ArrowLeft, Trash2, UserCheck, MessageSquarePlus, Mail, Pencil, X, Check } from "lucide-react";

interface MemberOpt { id: number; first_name: string; last_name: string; }

const fmtDate = (d?: string | null) =>
  d ? new Date((d.length > 10 ? d : d + "T00:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtDateTime = (d?: string | null) =>
  d ? new Date(d.length > 10 ? d : d + "T00:00:00").toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function RepairDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack("/repairs");
  const { canWrite, user } = useAuth();
  const canManage = canWrite("repairs.manage");

  const [t, setT] = useState<RepairTicket | null>(null);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [pName, setPName] = useState(""); const [pQty, setPQty] = useState("1"); const [pCost, setPCost] = useState("");

  const load = useCallback(() => {
    repairsApi.get(Number(id)).then(setT).catch(() => setT(null));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (canManage) api.get("/api/v1/members/?limit=400&is_active=true").then((r) => setMembers(r.data.members)).catch(() => {});
  }, [canManage]);

  if (t === null) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;

  const km = KIND_META[t.kind]; const sm = STATUS_META[t.status]; const pm = PRIORITY_META[t.priority];

  async function patch(data: Record<string, unknown>) {
    setBusy(true);
    try { setT(await repairsApi.update(Number(id), data)); } finally { setBusy(false); }
  }
  async function addPart() {
    if (!pName.trim()) return;
    setBusy(true);
    try {
      setT(await repairsApi.addPart(Number(id), { part_name: pName.trim(), quantity: parseFloat(pQty) || 1, unit_cost: pCost === "" ? null : parseFloat(pCost) }));
      setPName(""); setPQty("1"); setPCost("");
    } finally { setBusy(false); }
  }
  async function removePart(pid: number) {
    setBusy(true);
    try { setT(await repairsApi.deletePart(pid)); } finally { setBusy(false); }
  }
  async function claim() {
    setBusy(true);
    try { setT(await repairsApi.claim(Number(id))); } finally { setBusy(false); }
  }
  async function addNote() {
    if (!note.trim() && !noteStatus) return;
    setBusy(true);
    try {
      setT(await repairsApi.addUpdate(Number(id), { body: note.trim() || undefined, new_status: noteStatus || undefined }));
      setNote(""); setNoteStatus("");
    } finally { setBusy(false); }
  }
  async function del() {
    if (!confirm("Delete this ticket and its history? This cannot be undone.")) return;
    await repairsApi.remove(Number(id));
    navigate("/repairs");
  }

  const isAssignedToMe = t!.assigned_to_id === user?.id;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back to tickets</button>

      <div style={st.headCard}>
        <div style={st.headTop}>
          <span style={{ ...st.kindIcon, color: km.color, background: km.color + "18" }}>
            <Wrench size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={st.h1}><span style={st.idTag}>#{t.id}</span> {t.title}</h1>
            <div style={st.badgeRow}>
              <span style={{ ...st.badge, color: km.color, background: km.color + "1a" }}>{km.label}</span>
              <span style={{ ...st.badge, color: sm.color, background: sm.color + "1a" }}>{sm.label}</span>
              <span style={{ ...st.badge, color: pm.color, background: pm.color + "1a" }}>{pm.label} priority</span>
            </div>
          </div>
          {canManage && (
            <button style={st.delBtn} onClick={del} title="Delete ticket"><Trash2 size={16} /></button>
          )}
        </div>

        {t.description && <p style={st.desc}>{t.description}</p>}

        <div style={st.infoGrid}>
          <Info label="Equipment" value={t.inv_item_name || t.equipment_name || "—"} />
          <Info label="Location" value={t.location_name || "—"} />
          <Info label="Reported by" value={t.reported_by_name || "—"} />
          <Info label="Reported on" value={fmtDate(t.reported_date)} />
          <Info label="Assigned to" value={t.assigned_to_name || "Unassigned"} />
          <Info label="Completed on" value={t.completed_date ? fmtDate(t.completed_date) : "—"} />
        </div>
      </div>

      {/* Coordinator controls */}
      {canManage ? (
        <div style={st.card}>
          <h2 style={st.h2}>Manage</h2>
          <div style={st.manageGrid}>
            <label style={st.fLabel}>Status
              <select style={st.input} value={t.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })}>
                {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
              </select>
            </label>
            <label style={st.fLabel}>Assigned to
              <select style={st.input} value={t.assigned_to_id ?? ""} disabled={busy}
                onChange={(e) => patch({ assigned_to_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
              </select>
            </label>
            <label style={st.fLabel}>Priority
              <select style={st.input} value={t.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value })}>
                {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          </div>
          {!isAssignedToMe && (
            <button style={st.claimBtn} onClick={claim} disabled={busy}><UserCheck size={15} /> Assign to me</button>
          )}
          <label style={st.fLabel}>Resolution notes
            <textarea style={{ ...st.input, minHeight: 60, resize: "vertical" }} defaultValue={t.resolution ?? ""}
              placeholder="How it was fixed, parts used, etc."
              onBlur={(e) => { if (e.target.value !== (t.resolution ?? "")) patch({ resolution: e.target.value }); }} />
          </label>
        </div>
      ) : t.resolution ? (
        <div style={st.card}>
          <h2 style={st.h2}>Resolution</h2>
          <p style={st.desc}>{t.resolution}</p>
        </div>
      ) : null}

      {/* Cost of repair + replacement-parts BOM */}
      {(canManage || (t.parts && t.parts.length > 0) || t.repair_cost != null) && (
        <div style={st.card}>
          <h2 style={st.h2}>Cost & Replacement Parts</h2>

          {(t.parts && t.parts.length > 0) || canManage ? (
            <table style={st.partsTable}>
              <thead>
                <tr>
                  <th style={st.pth}>Part</th><th style={st.pthNum}>Qty</th><th style={st.pthNum}>Unit</th><th style={st.pthNum}>Total</th>{canManage && <th style={st.pthNum}></th>}
                </tr>
              </thead>
              <tbody>
                {(t.parts ?? []).map((p) => (
                  <tr key={p.id}>
                    <td style={st.ptd}>{p.part_name}{p.asset_tag ? <span style={st.pTag}>{p.asset_tag}</span> : ""}{p.notes ? <div style={st.pNote}>{p.notes}</div> : null}</td>
                    <td style={st.ptdNum}>{p.quantity}</td>
                    <td style={st.ptdNum}>{p.unit_cost != null ? `$${p.unit_cost.toFixed(2)}` : "—"}</td>
                    <td style={st.ptdNum}>{p.line_total != null ? `$${p.line_total.toFixed(2)}` : "—"}</td>
                    {canManage && <td style={st.ptdNum}><button style={st.pDel} disabled={busy} onClick={() => removePart(p.id)}><Trash2 size={13} /></button></td>}
                  </tr>
                ))}
                {(t.parts ?? []).length === 0 && <tr><td style={st.ptd} colSpan={canManage ? 5 : 4}><span style={st.muted}>No replacement parts added.</span></td></tr>}
              </tbody>
            </table>
          ) : null}

          {canManage && (
            <div style={st.addPartRow}>
              <input style={{ ...st.input, flex: 2 }} placeholder="Replacement part…" value={pName} onChange={(e) => setPName(e.target.value)} />
              <input style={{ ...st.input, width: 60 }} type="number" step="1" min="1" placeholder="Qty" value={pQty} onChange={(e) => setPQty(e.target.value)} />
              <input style={{ ...st.input, width: 90 }} type="number" step="0.01" min="0" placeholder="Unit $" value={pCost} onChange={(e) => setPCost(e.target.value)} />
              <button style={st.addPartBtn} disabled={busy || !pName.trim()} onClick={addPart}>Add</button>
            </div>
          )}

          <div style={st.costTotals}>
            <label style={st.costLabel}>
              Repair cost (labor / service)
              {canManage ? (
                <input style={{ ...st.input, width: 120 }} type="number" step="0.01" min="0" defaultValue={t.repair_cost ?? ""} placeholder="$0.00"
                  onBlur={(e) => { const v = e.target.value; if (v !== String(t.repair_cost ?? "")) patch({ repair_cost: v === "" ? null : parseFloat(v) }); }} />
              ) : <strong>{t.repair_cost != null ? `$${t.repair_cost.toFixed(2)}` : "—"}</strong>}
            </label>
            <div style={st.costSummary}>
              <div><span style={st.muted}>Parts</span> ${(t.parts_total ?? 0).toFixed(2)}</div>
              <div><span style={st.muted}>Repair</span> ${(t.repair_cost ?? 0).toFixed(2)}</div>
              <div style={st.grandTotal}>Total ${(t.total_cost ?? 0).toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Vendor / warranty correspondence */}
      {(canManage || (t.correspondence && t.correspondence.length > 0)) && (
        <CorrespondenceCard ticketId={t.id} items={t.correspondence ?? []} canManage={canManage} onSaved={setT} />
      )}

      {/* Progress log */}
      <div style={st.card}>
        <h2 style={st.h2}>Progress</h2>
        <div style={st.feed}>
          {(t.updates ?? []).length === 0 && <p style={st.muted}>No updates yet.</p>}
          {(t.updates ?? []).map((u) => (
            <div key={u.id} style={st.update}>
              <div style={st.updateHead}>
                <strong>{u.member_name || "Someone"}</strong>
                {u.new_status && (
                  <span style={st.statusChange}>
                    changed status {u.old_status ? `from ${STATUS_META[u.old_status]?.label ?? u.old_status} ` : ""}
                    to {STATUS_META[u.new_status]?.label ?? u.new_status}
                  </span>
                )}
                <span style={st.updateTime}>{fmtDateTime(u.created_at)}</span>
              </div>
              {u.body && <div style={st.updateBody}>{u.body}</div>}
            </div>
          ))}
        </div>

        <div style={st.noteBox}>
          <textarea style={{ ...st.input, minHeight: 56, resize: "vertical" }} value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="Add a progress note…" />
          <div style={st.noteActions}>
            {canManage && (
              <select style={st.input} value={noteStatus} onChange={(e) => setNoteStatus(e.target.value)}>
                <option value="">(no status change)</option>
                {STATUS_ORDER.filter((k) => k !== t.status).map((k) => <option key={k} value={k}>Set: {STATUS_META[k].label}</option>)}
              </select>
            )}
            <button style={st.noteBtn} onClick={addNote} disabled={busy || (!note.trim() && !noteStatus)}>
              <MessageSquarePlus size={15} /> Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={st.infoLabel}>{label}</div>
      <div style={st.infoValue}>{value}</div>
    </div>
  );
}

interface VendorOpt { id: number; name: string; }
const CHANNEL_LABEL: Record<string, string> = { email: "Email", phone: "Phone", portal: "Portal", mail: "Mail", chat: "Chat", other: "Other" };
const blankCorr = () => ({ direction: "outgoing", channel: "email", contact_name: "", vendor_id: "", reference: "", corresponded_on: new Date().toISOString().slice(0, 10), subject: "", body: "" });

function CorrespondenceCard({ ticketId, items, canManage, onSaved }: {
  ticketId: number; items: RepairCorrespondence[]; canManage: boolean; onSaved: (t: RepairTicket) => void;
}) {
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [form, setForm] = useState(blankCorr());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (canManage) api.get("/api/v1/inventory/vendors").then((r) => setVendors(r.data)).catch(() => setVendors([]));
  }, [canManage]);

  function startEdit(c: RepairCorrespondence) {
    setEditingId(c.id);
    setForm({
      direction: c.direction, channel: c.channel, contact_name: c.contact_name ?? "",
      vendor_id: c.vendor_id != null ? String(c.vendor_id) : "", reference: c.reference ?? "",
      corresponded_on: c.corresponded_on ?? "", subject: c.subject ?? "", body: c.body ?? "",
    });
    setOpen(true);
  }
  function cancel() { setEditingId(null); setForm(blankCorr()); setOpen(false); }

  async function save() {
    if (!form.subject.trim() && !form.body.trim()) return;
    setBusy(true);
    const payload = {
      direction: form.direction, channel: form.channel,
      contact_name: form.contact_name.trim() || null, vendor_id: form.vendor_id || null,
      reference: form.reference.trim() || null, corresponded_on: form.corresponded_on || null,
      subject: form.subject.trim() || null, body: form.body.trim() || null,
    };
    try {
      const t = editingId
        ? await repairsApi.updateCorrespondence(editingId, payload)
        : await repairsApi.addCorrespondence(ticketId, payload);
      onSaved(t); cancel();
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    if (!confirm("Delete this correspondence entry?")) return;
    setBusy(true);
    try { onSaved(await repairsApi.deleteCorrespondence(id)); } finally { setBusy(false); }
  }

  return (
    <div style={st.card}>
      <div style={st.corrHead}>
        <h2 style={{ ...st.h2, margin: 0 }}><Mail size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Vendor Correspondence</h2>
        {canManage && !open && (
          <button style={st.corrAddBtn} onClick={() => { setEditingId(null); setForm(blankCorr()); setOpen(true); }}>
            <MessageSquarePlus size={14} /> Log communication
          </button>
        )}
      </div>
      <p style={st.corrHint}>Track emails, calls, warranty claims, RMAs and returns with vendors about this repair.</p>

      {items.length === 0 && !open && <p style={st.muted}>No correspondence logged yet.</p>}

      <div style={st.corrList}>
        {items.map((c) => {
          const dm = CORR_DIRECTION_META[c.direction] ?? CORR_DIRECTION_META.note;
          return (
            <div key={c.id} style={st.corrItem}>
              <div style={st.corrTop}>
                <span style={{ ...st.corrBadge, color: dm.color, background: dm.color + "1a" }}>{dm.label}</span>
                <span style={st.corrChannel}>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                {c.reference && <span style={st.corrRef}>{c.reference}</span>}
                <span style={st.corrDate}>{fmtDate(c.corresponded_on) !== "—" ? fmtDate(c.corresponded_on) : fmtDateTime(c.created_at)}</span>
                {canManage && (
                  <span style={st.corrActions}>
                    <button style={st.corrIconBtn} onClick={() => startEdit(c)} title="Edit"><Pencil size={13} /></button>
                    <button style={st.corrIconBtn} onClick={() => del(c.id)} title="Delete"><Trash2 size={13} color="#c62828" /></button>
                  </span>
                )}
              </div>
              {(c.vendor_name || c.contact_name) && (
                <div style={st.corrWho}>{[c.vendor_name, c.contact_name].filter(Boolean).join(" · ")}</div>
              )}
              {c.subject && <div style={st.corrSubject}>{c.subject}</div>}
              {c.body && <div style={st.corrBody}>{c.body}</div>}
              {c.member_name && <div style={st.corrLogged}>Logged by {c.member_name}</div>}
            </div>
          );
        })}
      </div>

      {canManage && open && (
        <div style={st.corrForm}>
          <div style={st.corrFormGrid}>
            <label style={st.fLabel}>Direction
              <select style={st.input} value={form.direction} onChange={(e) => set("direction", e.target.value)}>
                {Object.entries(CORR_DIRECTION_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label style={st.fLabel}>Channel
              <select style={st.input} value={form.channel} onChange={(e) => set("channel", e.target.value)}>
                {CORR_CHANNELS.map((k) => <option key={k} value={k}>{CHANNEL_LABEL[k]}</option>)}
              </select>
            </label>
            <label style={st.fLabel}>Date
              <input style={st.input} type="date" value={form.corresponded_on} onChange={(e) => set("corresponded_on", e.target.value)} />
            </label>
            <label style={st.fLabel}>Vendor
              <select style={st.input} value={form.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}>
                <option value="">— none —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={st.fLabel}>Contact name
              <input style={st.input} value={form.contact_name} placeholder="Who you spoke with" onChange={(e) => set("contact_name", e.target.value)} />
            </label>
            <label style={st.fLabel}>Reference #
              <input style={st.input} value={form.reference} placeholder="RMA / case / warranty #" onChange={(e) => set("reference", e.target.value)} />
            </label>
          </div>
          <label style={{ ...st.fLabel, marginTop: 10 }}>Subject
            <input style={st.input} value={form.subject} placeholder="e.g. Warranty replacement for motor" onChange={(e) => set("subject", e.target.value)} />
          </label>
          <label style={{ ...st.fLabel, marginTop: 10 }}>Details
            <textarea style={{ ...st.input, minHeight: 70, resize: "vertical" }} value={form.body}
              placeholder="What was discussed, agreed, or next steps…" onChange={(e) => set("body", e.target.value)} />
          </label>
          <div style={st.corrFormActions}>
            <button style={st.corrCancelBtn} onClick={cancel} disabled={busy}><X size={14} /> Cancel</button>
            <button style={st.noteBtn} onClick={save} disabled={busy || (!form.subject.trim() && !form.body.trim())}>
              <Check size={15} /> {editingId ? "Save changes" : "Log it"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 12 },
  headCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 14 },
  headTop: { display: "flex", gap: 12, alignItems: "flex-start" },
  kindIcon: { width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  h1: { margin: 0, fontSize: 20, fontWeight: 800, color: "#1a3a5c" },
  idTag: { fontFamily: "ui-monospace, monospace", fontSize: 15, color: "#94a3b8", fontWeight: 700 },
  badgeRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 },
  badge: { padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 },
  delBtn: { background: "none", border: "1px solid #f1d4d4", color: "#c62828", borderRadius: 8, padding: 7, cursor: "pointer", flexShrink: 0 },
  desc: { color: "#445", fontSize: 14, lineHeight: 1.5, marginTop: 14, whiteSpace: "pre-wrap" },
  infoGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginTop: 18, paddingTop: 16, borderTop: "1px solid #eef2f6" },
  infoLabel: { fontSize: 11, color: "#9aa7b4", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  infoValue: { fontSize: 14, color: "#1a3a5c", fontWeight: 600, marginTop: 2 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 14 },
  h2: { margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  manageGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 },
  fLabel: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#33475b", marginTop: 12 },
  input: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, color: "#1a3a5c", background: "#fff" },
  claimBtn: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, padding: "8px 14px", background: "#eef4fb", color: "#1a3a5c", border: "1px solid #c9ddf3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  feed: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 },
  update: { borderLeft: "3px solid #e2e8f0", paddingLeft: 12 },
  updateHead: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", fontSize: 13, color: "#33475b" },
  statusChange: { color: "#1565c0", fontWeight: 600, fontSize: 12 },
  updateTime: { color: "#9aa7b4", fontSize: 12 },
  updateBody: { fontSize: 14, color: "#445", marginTop: 3, whiteSpace: "pre-wrap" },
  noteBox: { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #eef2f6", paddingTop: 14 },
  noteActions: { display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" },
  noteBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { color: "#888", fontSize: 14 },
  partsTable: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 10 },
  pth: { textAlign: "left", padding: "4px 8px", color: "#888", fontSize: 11, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #eef1f5" },
  pthNum: { textAlign: "right", padding: "4px 8px", color: "#888", fontSize: 11, fontWeight: 700, textTransform: "uppercase", borderBottom: "1px solid #eef1f5" },
  ptd: { padding: "6px 8px", borderBottom: "1px solid #f5f7f9", color: "#263238" },
  ptdNum: { padding: "6px 8px", borderBottom: "1px solid #f5f7f9", textAlign: "right", color: "#263238", whiteSpace: "nowrap" },
  pTag: { fontFamily: "monospace", fontSize: 11, background: "#eef2f7", borderRadius: 4, padding: "1px 5px", color: "#1565c0", marginLeft: 6 },
  pNote: { fontSize: 11, color: "#90a4ae", marginTop: 2 },
  pDel: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 2 },
  addPartRow: { display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" },
  addPartBtn: { padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  costTotals: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", borderTop: "1px solid #eef1f5", paddingTop: 10 },
  costLabel: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#556" },
  costSummary: { display: "flex", gap: 16, alignItems: "baseline", fontSize: 13, color: "#37474f" },
  grandTotal: { fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  corrHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  corrAddBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "#eef4fb", color: "#1a3a5c", border: "1px solid #c9ddf3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  corrHint: { color: "#8a97a4", fontSize: 12.5, margin: "6px 0 14px", lineHeight: 1.4 },
  corrList: { display: "flex", flexDirection: "column", gap: 10 },
  corrItem: { border: "1px solid #eef2f6", borderRadius: 10, padding: "10px 14px" },
  corrTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  corrBadge: { padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 700 },
  corrChannel: { fontSize: 11.5, color: "#5f6b76", fontWeight: 600, background: "#f1f5f9", borderRadius: 6, padding: "2px 8px" },
  corrRef: { fontSize: 11.5, color: "#1565c0", fontWeight: 700, fontFamily: "ui-monospace, monospace", background: "#eef4fb", borderRadius: 6, padding: "2px 8px" },
  corrDate: { fontSize: 12, color: "#9aa7b4", marginLeft: "auto" },
  corrActions: { display: "flex", gap: 2 },
  corrIconBtn: { background: "none", border: "none", cursor: "pointer", color: "#8a97a4", padding: 3, display: "flex" },
  corrWho: { fontSize: 13, color: "#33475b", fontWeight: 600, marginTop: 6 },
  corrSubject: { fontSize: 14, color: "#1a3a5c", fontWeight: 700, marginTop: 4 },
  corrBody: { fontSize: 13.5, color: "#445", marginTop: 3, whiteSpace: "pre-wrap", lineHeight: 1.5 },
  corrLogged: { fontSize: 11.5, color: "#9aa7b4", marginTop: 6 },
  corrForm: { border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 10, padding: 14, marginTop: 14 },
  corrFormGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 },
  corrFormActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  corrCancelBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
