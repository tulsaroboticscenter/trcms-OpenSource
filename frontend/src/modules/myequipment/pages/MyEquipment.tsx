/**
 * My Equipment — the gear the signed-in member currently has checked out.
 *
 * Self-service: any member can see what they're holding, the due date, and ask to keep
 * an item longer. An extension request goes to the inventory checkout queue for an
 * approver to process; the due date doesn't change until it's approved.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { inventoryApi, type Checkout } from "../../inventory/api";
import { ArrowLeft, Package, CalendarClock, Clock, Loader2, CheckCircle2 } from "lucide-react";

export default function MyEquipment() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Checkout[] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // Extension request form, keyed by checkout id.
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [newDate, setNewDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    inventoryApi.myCheckouts().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  function openRequest(c: Checkout) {
    setOpenFor(c.id); setNewDate(""); setNote(""); setErr(""); setMsg("");
  }

  async function submitRequest(c: Checkout) {
    if (!newDate) return;
    setBusy(true); setErr("");
    try {
      await inventoryApi.requestExtension(c.id, { requested_date: newDate, note: note.trim() || undefined });
      setOpenFor(null); setMsg("Your extension request was sent for approval.");
      load();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not send the request.");
    } finally { setBusy(false); }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={s.wrap}>
      <button onClick={() => navigate("/")} style={s.back}><ArrowLeft size={14} /> Back</button>
      <h1 style={s.h1}><Package size={22} style={{ verticalAlign: -4 }} /> My Equipment</h1>
      <p style={s.sub}>Equipment you currently have checked out. Need to keep something longer? Ask for an extension and it goes to the team for approval.</p>

      {msg && <div style={s.ok}><CheckCircle2 size={15} /> {msg}</div>}
      {err && !openFor && <div style={s.err}>{err}</div>}

      {items === null ? (
        <p style={s.muted}><Loader2 size={15} className="spin" /> Loading…</p>
      ) : items.length === 0 ? (
        <div style={s.empty}><Package size={30} color="#cbd5e1" /><p>You don't have any equipment checked out right now.</p></div>
      ) : (
        <div style={s.list}>
          {items.map((c) => {
            const overdue = c.overdue;
            return (
              <div key={c.id} style={s.card}>
                <div style={s.cardMain}>
                  <div style={s.itemName}>{c.item_name}{c.asset_tag ? <span style={s.tag}>{c.asset_tag}</span> : null}</div>
                  <div style={s.due}>
                    <CalendarClock size={13} />
                    {c.expected_return_date
                      ? <>Due <strong style={overdue ? s.overdue : undefined}>{c.expected_return_date}</strong>{overdue ? " · overdue" : ""}</>
                      : "No due date set"}
                    {c.quantity && c.quantity > 1 ? <span style={s.qty}>×{c.quantity}</span> : null}
                  </div>

                  {c.extension_pending ? (
                    <div style={s.pending}>
                      <Clock size={13} /> Extension requested to <strong>{c.extension_requested_date}</strong> — waiting for approval.
                    </div>
                  ) : null}
                </div>

                {!c.extension_pending && (
                  openFor === c.id ? (
                    <div style={s.form}>
                      <label style={s.label}>Keep it until</label>
                      <input type="date" style={s.input} value={newDate} min={today}
                        onChange={(e) => setNewDate(e.target.value)} />
                      <label style={s.label}>Reason (optional)</label>
                      <textarea style={s.textarea} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. still using it for the build season" />
                      {err && <div style={s.err}>{err}</div>}
                      <div style={s.formActions}>
                        <button style={s.cancel} onClick={() => setOpenFor(null)}>Cancel</button>
                        <button style={s.primary} disabled={!newDate || busy} onClick={() => submitRequest(c)}>
                          {busy ? <Loader2 size={13} className="spin" /> : null} Send request
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button style={s.requestBtn} onClick={() => openRequest(c)}>Request extension</button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#5a6b7d", cursor: "pointer", fontSize: 13, padding: "8px 0" },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a2634", margin: "0 0 4px" },
  sub: { fontSize: 13, color: "#7a8899", margin: "0 0 16px", lineHeight: 1.5 },
  muted: { fontSize: 13, color: "#8b98a6", display: "inline-flex", alignItems: "center", gap: 6 },
  empty: { textAlign: "center", padding: "3rem", color: "#8b98a6", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: { border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", background: "#fff" },
  cardMain: {},
  itemName: { fontSize: 15, fontWeight: 700, color: "#1a2634", display: "flex", alignItems: "center", gap: 8 },
  tag: { fontSize: 11, fontWeight: 700, color: "#0b5c4f", background: "#e6f2ef", borderRadius: 4, padding: "1px 7px" },
  due: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#556", marginTop: 5 },
  overdue: { color: "#c62828" },
  qty: { fontSize: 12, color: "#8b98a6", marginLeft: 4 },
  pending: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#1565c0", background: "#eef4fc", border: "1px solid #c5d9f2", borderRadius: 8, padding: "7px 10px", marginTop: 10 },
  requestBtn: { marginTop: 12, padding: "7px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  form: { marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef2f6" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "6px 0 3px" },
  input: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  textarea: { width: "100%", padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  cancel: { padding: "7px 12px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, cursor: "pointer" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ok: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  err: { fontSize: 12.5, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6c2", borderRadius: 7, padding: "8px 11px", marginTop: 8 },
};
