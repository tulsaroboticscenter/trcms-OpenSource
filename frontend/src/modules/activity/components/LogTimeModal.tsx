import { useState, useEffect } from "react";
import { activityApi, localToday } from "../api";
import { asOverAllocation, hoursLabel, type OverAllocation } from "../overAllocation";
import { Clock, X, AlertTriangle } from "lucide-react";

export interface LogTimeContext {
  team_season_id?: number | null;
  item_type?: "activity" | "task";
  item_id?: number;
  event_id?: number;
  checkin_id?: number;
}

/**
 * Reusable quick "log time" modal. Pre-links to a planning item / event / check-in
 * via `context`, and pre-fills area/minutes/date when provided.
 */
export default function LogTimeModal({
  memberId, title = "Log Time", defaultArea = "", defaultMinutes = 0, defaultDate,
  context = {}, onClose, onSaved,
}: {
  memberId: number;
  title?: string;
  defaultArea?: string;
  defaultMinutes?: number;
  defaultDate?: string;
  context?: LogTimeContext;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [areas, setAreas] = useState<string[]>([]);
  const [area, setArea] = useState(defaultArea);
  const [hours, setHours] = useState(defaultMinutes ? String(Math.round((defaultMinutes / 60) * 100) / 100) : "");
  const [entryDate, setEntryDate] = useState(defaultDate || localToday());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Set when the server rejects the duration as bigger than the check-in allows.
  const [overAlloc, setOverAlloc] = useState<OverAllocation | null>(null);
  // Set when the entry would double-count a check-in the member already has that day.
  const [overlap, setOverlap] = useState<string | null>(null);

  useEffect(() => {
    activityApi.areas(memberId).then((a) => {
      setAreas(a.areas);
      if (!defaultArea && a.areas.length === 0) setArea("");
    }).catch(() => {});
  }, [memberId, defaultArea]);

  async function save(ack = false) {
    const h = parseFloat(hours);
    if (!h || h <= 0 || !area) return;
    setBusy(true);
    setOverAlloc(null);
    if (!ack) setOverlap(null);
    try {
      await activityApi.createEntry({
        member_id: memberId, entry_date: entryDate, hours: h, area,
        notes: notes || undefined,
        team_season_id: context.team_season_id ?? undefined,
        item_type: context.item_type, item_id: context.item_id,
        event_id: context.event_id, checkin_id: context.checkin_id,
        acknowledge_overlap: ack || undefined,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      // Would double-count a check-in that day: warn and let them confirm ("Log anyway").
      const resp = (e as { response?: { status?: number; data?: { error?: string; detail?: string } } })?.response;
      if (resp?.status === 409 && resp?.data?.error === "checkin_overlap") {
        setOverlap(resp.data.detail ?? "This may overlap a check-in you already have that day.");
        return;
      }
      // Over the check-in's remaining time: say so, reset the field to what fits,
      // and leave the modal open so they can adjust rather than losing the entry.
      const over = asOverAllocation(e);
      if (!over) throw e;
      setOverAlloc(over);
      setHours(over.availableHours > 0 ? String(over.availableHours) : "");
    } finally { setBusy(false); }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.head}>
          <span style={st.title}><Clock size={17} style={{ verticalAlign: "-3px", marginRight: 6 }} />{title}</span>
          <button style={st.close} onClick={onClose}><X size={18} /></button>
        </div>
        {overAlloc && (
          <div style={st.warn} role="alert">
            <div style={st.warnHead}><AlertTriangle size={15} /> More time than the check-in covers</div>
            <div>{overAlloc.message}</div>
            <div style={st.warnFix}>
              {overAlloc.availableMinutes > 0
                ? `We've set it to ${hoursLabel(overAlloc.availableHours)} — the most that will fit. Adjust it if that's not right, then save.`
                : "This check-in is already fully accounted for. Shorten or remove another activity first."}
            </div>
          </div>
        )}
        {overlap && (
          <div style={st.warn} role="alert">
            <div style={st.warnHead}><AlertTriangle size={15} /> This may overlap a check-in</div>
            <div>{overlap}</div>
            <div style={st.warnFix}>If it's separate from your check-in, choose "Log anyway".</div>
          </div>
        )}
        <label style={st.l}>Area</label>
        <select style={st.input} value={area} onChange={(e) => setArea(e.target.value)} autoFocus>
          <option value="">Select…</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div style={st.grid2}>
          <div>
            <label style={st.l}>Date</label>
            <input style={st.input} type="date" value={entryDate} onChange={(e) => { setEntryDate(e.target.value); setOverlap(null); }} />
          </div>
          <div>
            <label style={st.l}>Hours</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input style={st.minInput} type="number" min={0} step={0.25} placeholder="0"
                value={hours} onChange={(e) => setHours(e.target.value)} /><span style={st.minLbl}>hrs</span>
            </div>
          </div>
        </div>
        <label style={st.l}>Notes (optional)</label>
        <input style={st.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div style={st.actions}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          {overlap
            ? <button style={st.saveBtn} onClick={() => save(true)} disabled={busy}>Log anyway</button>
            : <button style={st.saveBtn} onClick={() => save(false)} disabled={busy || !area || !(parseFloat(hours) > 0)}>Save</button>}
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  warn: { background: "#fff6e5", border: "1px solid #f0d9a8", borderRadius: 8, padding: "9px 11px", marginBottom: 10, fontSize: 12.5, color: "#7a5200", lineHeight: 1.45 },
  warnHead: { display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 3, color: "#a86a00" },
  warnFix: { marginTop: 5, fontWeight: 600 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: "20px 22px", width: "100%", maxWidth: 460, boxShadow: "0 8px 40px rgba(0,0,0,0.2)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: 800, color: "#1a3a5c" },
  close: { background: "none", border: "none", cursor: "pointer", color: "#888" },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", margin: "10px 0 3px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box", background: "#fff" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  minInput: { width: 60, padding: "8px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  minLbl: { fontSize: 12, color: "#888" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 },
  cancelBtn: { padding: "8px 14px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer" },
  saveBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 },
};
