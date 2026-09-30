/**
 * EventBring (0207) — "What are you bringing" / potluck sign-up on an event.
 * Opt-in: an organizer (Mentor+) turns it on and lists the items they need with a
 * quantity (Side Dishes ×5, Desserts ×4, …); attending members sign up for what — and
 * how many — they'll bring, or add an "Other" item. Everyone sees how much of each is
 * still needed. Mirrors EventSignups.
 */
import { useState, useEffect, useCallback } from "react";
import { bringApi, eventsApi, type BringData } from "../api";
import { UtensilsCrossed, Plus, Trash2, X, Loader2, Pencil } from "lucide-react";

type EditRow = { id?: number; name: string; qty_needed: number; notes: string };
const detail = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong.";

export default function EventBring({ eventId }: { eventId: number }) {
  const [data, setData] = useState<BringData | null>(null);
  const [attending, setAttending] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [qtyById, setQtyById] = useState<Record<number, number>>({});
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [otherName, setOtherName] = useState("");
  const [otherQty, setOtherQty] = useState(1);

  const load = useCallback(() => { bringApi.list(eventId).then(setData).catch(() => setData(null)); }, [eventId]);
  useEffect(() => { load(); }, [load]);
  // The current user's RSVP drives the "you're attending — bring something" nudge.
  useEffect(() => { eventsApi.getMyRsvp(eventId).then((r) => setAttending(r.status === "Attending")).catch(() => {}); }, [eventId]);

  const run = async (fn: () => Promise<BringData>) => {
    setErr(""); setBusy(true);
    try { setData(await fn()); } catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };

  if (!data) return null;
  const canManage = data.can_manage;
  if (!data.bring_enabled && !canManage) return null;

  const startEdit = () => {
    setRows(data.items.map((i) => ({ id: i.id, name: i.name, qty_needed: i.qty_needed, notes: i.notes ?? "" })));
    setEnabled(data.bring_enabled); setEditing(true);
  };
  const saveEdit = async () => {
    await run(() => bringApi.saveConfig(eventId, {
      enabled,
      items: rows.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name.trim(), qty_needed: Math.max(1, r.qty_needed || 1), notes: r.notes.trim() || null })),
    }));
    setEditing(false);
  };
  const signUp = (itemId: number) =>
    run(() => bringApi.signUp(eventId, { bring_item_id: itemId, qty: Math.max(1, qtyById[itemId] || 1), note: noteById[itemId] || undefined }));
  const signOther = () =>
    run(() => bringApi.signUp(eventId, { other_name: otherName.trim(), qty: Math.max(1, otherQty || 1) })).then(() => { setOtherName(""); setOtherQty(1); });

  return (
    <div style={s.card}>
      <div style={s.head}>
        <span style={s.title}><UtensilsCrossed size={16} style={{ verticalAlign: -3 }} /> What are you bringing?</span>
        {canManage && !editing && <button style={s.editBtn} onClick={startEdit}><Pencil size={12} /> {data.items.length ? "Edit list" : "Set up"}</button>}
      </div>
      {err && <div style={s.err}>{err}</div>}

      {/* Organizer editor */}
      {editing ? (
        <div style={s.editor}>
          <label style={s.enable}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Ask attendees what they're bringing (turn on for this event)
          </label>
          {rows.map((r, i) => (
            <div key={i} style={s.editRow}>
              <input style={{ ...s.in, flex: 1 }} placeholder="Item (e.g. Desserts)" value={r.name}
                onChange={(e) => setRows((xs) => xs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <span style={s.times}>× need</span>
              <input type="number" min={1} style={{ ...s.in, width: 60 }} value={r.qty_needed}
                onChange={(e) => setRows((xs) => xs.map((x, j) => j === i ? { ...x, qty_needed: parseInt(e.target.value) || 1 } : x))} />
              <input style={{ ...s.in, flex: 1 }} placeholder="note (optional)" value={r.notes}
                onChange={(e) => setRows((xs) => xs.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} />
              <button style={s.iconBtn} title="Remove" onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
            </div>
          ))}
          <button style={s.addRow} onClick={() => setRows((xs) => [...xs, { name: "", qty_needed: 1, notes: "" }])}><Plus size={13} /> Add item</button>
          <div style={s.editActions}>
            <button style={s.save} disabled={busy} onClick={saveEdit}>{busy ? <Loader2 size={13} className="spin" /> : "Save"}</button>
            <button style={s.cancel} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {attending && data.bring_enabled && data.items.length > 0 && (
            <div style={s.nudge}>You're attending — please pick something to bring below. 🎉</div>
          )}
          {data.items.length === 0 ? (
            <p style={s.empty}>{canManage ? "No items yet — click “Set up” to list what you need." : "No items requested yet."}</p>
          ) : (
            <div style={s.items}>
              {data.items.map((it) => {
                const mine = it.signups.find((x) => x.is_me);
                return (
                  <div key={it.id} style={s.item}>
                    <div style={s.itemTop}>
                      <span style={s.itemName}>{it.name}</span>
                      <span style={it.remaining > 0 ? s.need : s.filled}>{it.claimed_qty}/{it.qty_needed}{it.remaining > 0 ? ` · need ${it.remaining} more` : " · covered ✓"}</span>
                    </div>
                    {it.notes && <div style={s.itemNote}>{it.notes}</div>}
                    {it.signups.length > 0 && (
                      <div style={s.who}>
                        {it.signups.map((sg) => (
                          <span key={sg.id} style={sg.is_me ? s.chipMe : s.chip}>
                            {sg.name}{sg.qty > 1 ? ` ×${sg.qty}` : ""}{sg.note ? ` (${sg.note})` : ""}
                            {(sg.is_me || canManage) && <button style={s.chipX} title="Remove" onClick={() => run(() => bringApi.cancel(sg.id))}><X size={11} /></button>}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={s.signRow}>
                      <input type="number" min={1} style={{ ...s.in, width: 54 }} value={qtyById[it.id] ?? (mine?.qty ?? 1)}
                        onChange={(e) => setQtyById((q) => ({ ...q, [it.id]: parseInt(e.target.value) || 1 }))} />
                      <input style={{ ...s.in, flex: 1 }} placeholder="note (e.g. veggie tray)" value={noteById[it.id] ?? (mine?.note ?? "")}
                        onChange={(e) => setNoteById((n) => ({ ...n, [it.id]: e.target.value }))} />
                      <button style={s.bring} disabled={busy} onClick={() => signUp(it.id)}>{mine ? "Update" : "I'll bring this"}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Other items (not on the list) */}
          {(data.other_signups.length > 0 || data.bring_enabled) && (
            <div style={s.otherWrap}>
              {data.other_signups.length > 0 && (
                <div style={s.who}>
                  <span style={s.otherLbl}>Also bringing:</span>
                  {data.other_signups.map((sg) => (
                    <span key={sg.id} style={sg.is_me ? s.chipMe : s.chip}>
                      {sg.other_name} — {sg.name}{sg.qty > 1 ? ` ×${sg.qty}` : ""}
                      {(sg.is_me || canManage) && <button style={s.chipX} onClick={() => run(() => bringApi.cancel(sg.id))}><X size={11} /></button>}
                    </span>
                  ))}
                </div>
              )}
              {data.bring_enabled && (
                <div style={s.signRow}>
                  <input style={{ ...s.in, flex: 1 }} placeholder="Bringing something else? Name it…" value={otherName} onChange={(e) => setOtherName(e.target.value)} />
                  <input type="number" min={1} style={{ ...s.in, width: 54 }} value={otherQty} onChange={(e) => setOtherQty(parseInt(e.target.value) || 1)} />
                  <button style={s.bring} disabled={busy || !otherName.trim()} onClick={signOther}>Add</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, background: "#fff", marginTop: 14 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 14.5, fontWeight: 700, color: "#7b341e" },
  editBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#fff", color: "#00695c", border: "1px solid #b2dfdb", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  err: { background: "#fdecea", color: "#c62828", fontSize: 12.5, padding: "6px 10px", borderRadius: 6, marginBottom: 8 },
  nudge: { background: "#fff3e0", border: "1px solid #ffe0b2", color: "#e65100", fontSize: 12.5, fontWeight: 600, padding: "8px 10px", borderRadius: 7, marginBottom: 10 },
  empty: { fontSize: 13, color: "#889", margin: "4px 0" },
  items: { display: "flex", flexDirection: "column", gap: 10 },
  item: { border: "1px solid #eef2f7", borderRadius: 8, padding: "9px 11px", background: "#fafbfc" },
  itemTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  itemName: { fontSize: 13.5, fontWeight: 700, color: "#334" },
  need: { fontSize: 12, fontWeight: 700, color: "#e65100" },
  filled: { fontSize: 12, fontWeight: 700, color: "#2e7d32" },
  itemNote: { fontSize: 11.5, color: "#889", marginTop: 2 },
  who: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, alignItems: "center" },
  chip: { display: "inline-flex", alignItems: "center", gap: 3, background: "#eef2f7", border: "1px solid #dbe4ee", borderRadius: 12, padding: "2px 4px 2px 9px", fontSize: 11.5, color: "#334" },
  chipMe: { display: "inline-flex", alignItems: "center", gap: 3, background: "#e0f2f1", border: "1px solid #b2dfdb", borderRadius: 12, padding: "2px 4px 2px 9px", fontSize: 11.5, color: "#00695c", fontWeight: 600 },
  chipX: { background: "none", border: "none", cursor: "pointer", color: "#889", display: "flex", padding: 1 },
  signRow: { display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" },
  in: { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12.5, boxSizing: "border-box", minWidth: 0 },
  bring: { padding: "6px 12px", background: "#00695c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  otherWrap: { marginTop: 12, borderTop: "1px dashed #e2e8f0", paddingTop: 10 },
  otherLbl: { fontSize: 12, fontWeight: 700, color: "#556", marginRight: 2 },
  editor: { display: "flex", flexDirection: "column", gap: 8 },
  enable: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#445", fontWeight: 600 },
  editRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  times: { fontSize: 11.5, color: "#889", whiteSpace: "nowrap" },
  iconBtn: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", color: "#c62828", display: "flex", padding: 6 },
  addRow: { display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", padding: "5px 10px", background: "#fff", border: "1px dashed #cdd7e3", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#556", fontWeight: 600 },
  editActions: { display: "flex", gap: 8, marginTop: 4 },
  save: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  cancel: { padding: "7px 14px", background: "#fff", color: "#556", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 13 },
};
