/**
 * EventSignups (#152) — SignupGenius-style coverage sign-ups on an event.
 * Members sign themselves up for the slots (area + time window) they can cover;
 * organizers (Mentor+) add slots one at a time or generate a grid across a time
 * range, and can remove anyone. Slots group by area for a big multi-station event.
 */
import { useState, useEffect, useCallback } from "react";
import { signupsApi, type SignupData, type SignupSlot } from "../api";
import { CalendarCheck, Plus, Trash2, X, Grid3x3, Loader2, UserPlus } from "lucide-react";

const fmt = (t: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
};
const slotTime = (s: SignupSlot) =>
  s.start_time ? `${fmt(s.start_time)}${s.end_time ? `–${fmt(s.end_time)}` : ""}` : "";

export default function EventSignups({ eventId }: { eventId: number }) {
  const [data, setData] = useState<SignupData | null>(null);
  const [busy, setBusy] = useState<number | "add" | "bulk" | null>(null);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const load = useCallback(() => { signupsApi.list(eventId).then(setData).catch(() => setData(null)); }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const run = async (key: typeof busy, fn: () => Promise<SignupData>) => {
    setErr(""); setBusy(key);
    try { setData(await fn()); }
    catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong."); }
    finally { setBusy(null); }
  };

  if (!data) return null;
  const canManage = data.can_manage;
  // Nothing to show to a regular member if no slots exist yet.
  if (!canManage && data.slots.length === 0) return null;

  // Group slots by area (null area → "General").
  const groups = new Map<string, SignupSlot[]>();
  for (const s of data.slots) {
    const k = s.area || "General";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }

  return (
    <div style={st.card}>
      <div style={st.head}>
        <div style={st.title}><CalendarCheck size={16} /> Coverage Sign-Ups</div>
        {canManage && (
          <div style={st.headBtns}>
            <button style={st.miniBtn} onClick={() => { setShowBulk((v) => !v); setShowAdd(false); }}><Grid3x3 size={13} /> Bulk add</button>
            <button style={st.miniBtn} onClick={() => { setShowAdd((v) => !v); setShowBulk(false); }}><Plus size={13} /> Add slot</button>
          </div>
        )}
      </div>
      <p style={st.sub}>Sign up for the times and areas you can cover.</p>
      {err && <div style={st.err}>{err}</div>}

      {showAdd && canManage && <AddSlotForm onCancel={() => setShowAdd(false)} onSave={(slot) => run("add", () => signupsApi.addSlot(eventId, slot)).then(() => setShowAdd(false))} busy={busy === "add"} />}
      {showBulk && canManage && <BulkForm onCancel={() => setShowBulk(false)} onSave={(b) => run("bulk", () => signupsApi.bulk(eventId, b)).then(() => setShowBulk(false))} busy={busy === "bulk"} />}

      {data.slots.length === 0 && <p style={st.empty}>No slots yet. Use “Add slot” or “Bulk add” to create coverage slots.</p>}

      {[...groups.entries()].map(([area, slots]) => (
        <div key={area} style={st.group}>
          {(area !== "General" || groups.size > 1) && <div style={st.areaHead}>{area}</div>}
          {slots.map((s) => (
            <div key={s.id} style={{ ...st.slot, ...(s.me_signed_up ? st.slotMine : {}), ...(s.is_full && !s.me_signed_up ? st.slotFull : {}) }}>
              <div style={st.slotMain}>
                <div style={st.slotTop}>
                  <span style={st.slotTime}>{slotTime(s) || s.title || "Slot"}</span>
                  {s.title && slotTime(s) && <span style={st.slotTitle}>· {s.title}</span>}
                  <span style={st.cap}>{s.capacity > 0 ? `${s.filled}/${s.capacity}` : `${s.filled}`}{s.is_full ? " · full" : ""}</span>
                </div>
                {s.responses.length > 0 && (
                  <div style={st.names}>
                    {s.responses.map((r) => (
                      <span key={r.id} style={{ ...st.chip, ...(r.is_me ? st.chipMe : {}) }}>
                        {r.name}
                        {(r.is_me || canManage) && (
                          <button style={st.chipX} title="Remove" onClick={() => run(s.id, () => signupsApi.cancel(r.id))}><X size={11} /></button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {s.notes && <div style={st.slotNotes}>{s.notes}</div>}
              </div>
              <div style={st.slotActions}>
                {s.me_signed_up ? (
                  <span style={st.signedTag}>✓ You're in</span>
                ) : (
                  <button style={st.signBtn} disabled={s.is_full || busy === s.id} onClick={() => run(s.id, () => signupsApi.signUp(s.id))}>
                    {busy === s.id ? <Loader2 size={13} className="spin" /> : s.is_full ? "Full" : "Sign up"}
                  </button>
                )}
                {canManage && <button style={st.delBtn} title="Delete slot" onClick={() => run(s.id, () => signupsApi.deleteSlot(s.id))}><Trash2 size={13} /></button>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AddSlotForm({ onSave, onCancel, busy }: { onSave: (s: Partial<SignupSlot>) => void; onCancel: () => void; busy: boolean }) {
  const [area, setArea] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const [cap, setCap] = useState("1"); const [notes, setNotes] = useState("");
  return (
    <div style={st.form}>
      <div style={st.formRow}>
        <input style={st.in} placeholder="Area (e.g. Front Desk)" value={area} onChange={(e) => setArea(e.target.value)} />
        <input style={st.inTime} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <span style={st.dash}>–</span>
        <input style={st.inTime} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        <input style={st.inCap} type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} title="Capacity (0 = unlimited)" />
      </div>
      <input style={st.in} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div style={st.formBtns}>
        <button style={st.cancel} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={st.save} disabled={busy} onClick={() => onSave({ area, start_time: start, end_time: end, capacity: parseInt(cap) || 0, notes })}>
          {busy ? <Loader2 size={13} className="spin" /> : "Add slot"}
        </button>
      </div>
    </div>
  );
}

function BulkForm({ onSave, onCancel, busy }: { onSave: (b: { areas: string[]; start_time?: string; end_time?: string; block_minutes?: number; capacity?: number }) => void; onCancel: () => void; busy: boolean }) {
  const [areas, setAreas] = useState(""); const [start, setStart] = useState("10:00"); const [end, setEnd] = useState("14:00");
  const [block, setBlock] = useState("60"); const [cap, setCap] = useState("1");
  return (
    <div style={st.form}>
      <input style={st.in} placeholder="Areas, comma-separated (blank = time-only)" value={areas} onChange={(e) => setAreas(e.target.value)} />
      <div style={st.formRow}>
        <span style={st.lbl}>From</span>
        <input style={st.inTime} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <span style={st.dash}>to</span>
        <input style={st.inTime} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        <span style={st.lbl}>every</span>
        <input style={st.inCap} type="number" min={5} step={5} value={block} onChange={(e) => setBlock(e.target.value)} /><span style={st.lbl}>min</span>
        <span style={st.lbl}>cap</span>
        <input style={st.inCap} type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} />
      </div>
      <div style={st.formBtns}>
        <button style={st.cancel} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={st.save} disabled={busy} onClick={() => onSave({ areas: areas.split(",").map((a) => a.trim()).filter(Boolean), start_time: start, end_time: end, block_minutes: parseInt(block) || 0, capacity: parseInt(cap) || 0 })}>
          {busy ? <Loader2 size={13} className="spin" /> : <><UserPlus size={13} /> Generate slots</>}
        </button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 16 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  headBtns: { display: "flex", gap: 6 },
  miniBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  sub: { fontSize: 12.5, color: "#667", margin: "4px 0 10px" },
  err: { padding: "7px 10px", background: "#fdecea", color: "#c62828", borderRadius: 7, fontSize: 12.5, marginBottom: 8 },
  empty: { fontSize: 13, color: "#889", fontStyle: "italic" },
  group: { marginBottom: 10 },
  areaHead: { fontSize: 12.5, fontWeight: 800, color: "#4527a0", textTransform: "uppercase", letterSpacing: 0.3, margin: "8px 0 5px" },
  slot: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "9px 11px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 8, marginBottom: 6 },
  slotMine: { background: "#f1f8f2", borderColor: "#cfe9d3" },
  slotFull: { opacity: 0.75 },
  slotMain: { flex: 1, minWidth: 0 },
  slotTop: { display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  slotTime: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  slotTitle: { fontSize: 12.5, color: "#556" },
  cap: { fontSize: 11.5, fontWeight: 700, color: "#667", background: "#eef1f4", borderRadius: 6, padding: "1px 7px", marginLeft: 4 },
  names: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 },
  chip: { display: "inline-flex", alignItems: "center", gap: 3, background: "#e8eef5", color: "#2a3f55", borderRadius: 20, padding: "2px 4px 2px 9px", fontSize: 12 },
  chipMe: { background: "#c8e6c9", color: "#1b5e20", fontWeight: 700 },
  chipX: { display: "inline-flex", background: "none", border: "none", cursor: "pointer", color: "#889", padding: 1 },
  slotNotes: { fontSize: 12, color: "#778", marginTop: 4 },
  slotActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  signBtn: { padding: "6px 13px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12.5 },
  signedTag: { fontSize: 12, fontWeight: 700, color: "#2e7d32" },
  delBtn: { display: "inline-flex", background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 3 },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, marginBottom: 10, display: "flex", flexDirection: "column", gap: 7 },
  formRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  in: { flex: 1, minWidth: 140, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  inTime: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  inCap: { width: 60, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  dash: { color: "#99a" }, lbl: { fontSize: 12, color: "#667" },
  formBtns: { display: "flex", justifyContent: "flex-end", gap: 7 },
  cancel: { padding: "7px 13px", background: "#eef1f4", color: "#445", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  save: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 15px", background: "#8e24aa", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12.5 },
};
