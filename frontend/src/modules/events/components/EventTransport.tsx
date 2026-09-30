/**
 * EventTransport (0221–0223) — "How will you get to this event?" transportation planning.
 * Opt-in: an organizer (Mentor+) turns it on for an off-site event; each member answers two
 * legs — a ride TO the event and a ride BACK — as have a ride / need a ride / can drive others
 * (+ seats) / not sure. A coordinator seats the members who need a ride into drivers with open
 * seats, separately per leg. Parents/guardians can answer for a youth in their family.
 */
import { useState, useEffect, useCallback } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { transportApi, type TransportData, type TransportLeg, type TransportLegPlan, type TransportWhich } from "../api";
import { Car, Check, Loader2, FileDown } from "lucide-react";

const detail = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong.";

const OPTIONS: { value: TransportLeg; label: string; color: string }[] = [
  { value: "have", label: "Have a ride", color: "#2e7d32" },
  { value: "need", label: "Need a ride", color: "#c62828" },
  { value: "drive", label: "Can drive others", color: "#1565c0" },
  { value: "not_sure", label: "Not sure", color: "#e65100" },
];
const colorOf = (r: TransportLeg | null) => OPTIONS.find((o) => o.value === r)?.color ?? "#888";
const labelOf = (r: TransportLeg | null) => OPTIONS.find((o) => o.value === r)?.label ?? "—";

export default function EventTransport({ eventId, eventName = "Event", eventDate, refreshKey = 0 }: { eventId: number; eventName?: string; eventDate?: string; refreshKey?: number }) {
  const [data, setData] = useState<TransportData | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState("");

  const load = useCallback(() => { transportApi.list(eventId).then(setData).catch(() => setData(null)); }, [eventId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { if (data?.my_response?.seats_available != null) setSeats(String(data.my_response.seats_available)); }, [data?.my_response?.seats_available]);

  const run = async (fn: () => Promise<TransportData>) => {
    setErr(""); setBusy(true);
    try { setData(await fn()); } catch (e) { setErr(detail(e)); } finally { setBusy(false); }
  };

  if (!data) return null;
  const canManage = data.can_manage;
  if (!data.transport_enabled && !canManage) return null;

  const myTo = data.my_response?.ride_to ?? null;
  const myBack = data.my_response?.ride_back ?? null;
  const iDrive = myTo === "drive" || myBack === "drive";

  const chooseMine = (which: TransportWhich, value: TransportLeg) => {
    const ride_to = which === "to" ? value : myTo;
    const ride_back = which === "back" ? value : myBack;
    const driving = ride_to === "drive" || ride_back === "drive";
    return run(() => transportApi.respond(eventId, { ride_to, ride_back, seats_available: driving ? (seats ? parseInt(seats) : null) : null }));
  };
  const saveSeats = () => run(() => transportApi.respond(eventId, { ride_to: myTo, ride_back: myBack, seats_available: seats === "" ? null : Math.max(0, parseInt(seats) || 0) }));
  const clearMine = () => run(() => transportApi.respond(eventId, { ride_to: null, ride_back: null }));

  // Parent/guardian: set a youth's plan (attributed to the youth, not the parent).
  const chooseYouth = (member_id: number, curTo: TransportLeg | null, curBack: TransportLeg | null, curSeats: number | null, which: TransportWhich, value: TransportLeg) => {
    const ride_to = which === "to" ? value : curTo;
    const ride_back = which === "back" ? value : curBack;
    const driving = ride_to === "drive" || ride_back === "drive";
    return run(() => transportApi.respond(eventId, { ride_to, ride_back, seats_available: driving ? curSeats : null, member_id }));
  };
  const saveYouthSeats = (member_id: number, curTo: TransportLeg | null, curBack: TransportLeg | null, raw: string) =>
    run(() => transportApi.respond(eventId, { ride_to: curTo, ride_back: curBack, seats_available: raw === "" ? null : Math.max(0, parseInt(raw) || 0), member_id }));
  const clearYouth = (member_id: number) => run(() => transportApi.respond(eventId, { ride_to: null, ride_back: null, member_id }));

  const s = data.summary;
  const plan = data.plan;
  const assign = (riderId: number, driverId: number | null, leg: TransportWhich) => run(() => transportApi.assign(eventId, riderId, driverId, leg));

  // ── Leg picker (two rows: Ride there / Ride back) ──────────────────────────
  const legPicker = (to: TransportLeg | null, back: TransportLeg | null, onPick: (which: TransportWhich, v: TransportLeg) => void) => (
    <div style={st.legs}>
      {([["to", "Ride there", to], ["back", "Ride back", back]] as [TransportWhich, string, TransportLeg | null][]).map(([which, label, cur]) => (
        <div key={which} style={st.legRow}>
          <span style={st.legLabel}>{label}</span>
          <div style={st.pickRow}>
            {OPTIONS.map((o) => (
              <button key={o.value} disabled={busy}
                style={{ ...st.pick, ...(cur === o.value ? { ...st.pickOn, borderColor: o.color, color: o.color } : {}) }}
                onClick={() => onPick(which, o.value)}>
                {cur === o.value && <Check size={12} />} {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // ── PDF ────────────────────────────────────────────────────────────────────
  const rName = (r: { name: string; rsvp_status?: string | null }) => r.rsvp_status === "Maybe" ? `${r.name} (Maybe)` : r.name;
  const downloadPDF = () => {
    if (!plan) return;
    const doc = new jsPDF();
    const when = eventDate ? new Date(eventDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
    doc.setFontSize(15); doc.text("Transportation Plan", 14, 16);
    doc.setFontSize(11); doc.setTextColor(90); doc.text(eventName, 14, 23);
    if (when) doc.text(when, 14, 29);
    doc.setTextColor(0);
    let y = when ? 36 : 30;
    const advance = () => { y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6; };
    const table = (head: string[], body: string[][], fill: [number, number, number]) => {
      autoTable(doc, { startY: y, head: [head], body, theme: "grid", headStyles: { fillColor: fill, fontSize: 10 }, bodyStyles: { fontSize: 9.5 }, columnStyles: { 1: { cellWidth: 55 } }, margin: { left: 14, right: 14 } });
      advance();
    };
    const legToPDF = (lp: TransportLegPlan, title: string) => {
      doc.setFontSize(12.5); doc.setTextColor(26, 58, 92); doc.text(title, 14, y); doc.setTextColor(0); y += 4;
      lp.drivers.forEach((d) => {
        const seatTxt = d.seats != null ? `${d.filled}/${d.seats} seats used` : `${d.filled} riders`;
        table([`Driver: ${d.name}${d.note ? ` — ${d.note}` : ""}`, seatTxt], d.riders.length ? d.riders.map((r) => [rName(r), r.note || ""]) : [["(no riders assigned yet)", ""]], [21, 101, 192]);
      });
      if (lp.unassigned_riders.length) table([`Still needs a ride (${lp.unassigned_riders.length})`, ""], lp.unassigned_riders.map((r) => [rName(r), r.note || ""]), [198, 40, 40]);
      if (lp.have_ride.length) table([`Have their own ride (${lp.have_ride.length})`, ""], lp.have_ride.map((r) => [rName(r), r.note || ""]), [46, 125, 50]);
      y += 2;
    };
    legToPDF(plan.to, "Ride there");
    legToPDF(plan.back, "Ride back");
    doc.save(`transportation-${eventName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  };

  // ── Coordinator assignment for one leg ──────────────────────────────────────
  const renderAssignLeg = (lp: TransportLegPlan, leg: TransportWhich, title: string) => {
    if (lp.drivers.length === 0 && lp.unassigned_riders.length === 0) return null;
    const openDrivers = lp.drivers.filter((d) => d.open_seats == null || d.open_seats > 0);
    return (
      <div style={st.legPlan}>
        <div style={st.legPlanHead}>{title}</div>
        {lp.drivers.map((d) => (
          <div key={d.member_id} style={st.driverCard}>
            <div style={st.driverTop}>
              <span style={st.driverName}>{d.name}</span>
              <span style={st.seatsTag}>
                {d.seats != null ? `${d.filled}/${d.seats} seats` : `${d.filled} riders`}
                {d.open_seats != null && d.open_seats > 0 ? ` · ${d.open_seats} open` : d.open_seats === 0 ? " · full" : ""}
              </span>
              {d.note && <span style={st.note}>— {d.note}</span>}
            </div>
            {d.riders.map((r) => (
              <div key={r.member_id} style={st.assignedRow}>
                <span>{r.name}{r.rsvp_status === "Maybe" && <span style={st.maybeTag}>Maybe</span>}{r.note && <span style={st.note}> — {r.note}</span>}</span>
                <button style={st.unassign} disabled={busy} onClick={() => assign(r.member_id, null, leg)}>remove</button>
              </div>
            ))}
            {d.riders.length === 0 && <div style={st.emptyRiders}>No riders assigned yet.</div>}
          </div>
        ))}
        {lp.unassigned_riders.length > 0 && (
          <div style={st.unassignedBox}>
            <div style={st.listHead}>Needs a ride ({lp.unassigned_riders.length})</div>
            {lp.unassigned_riders.map((r) => (
              <div key={r.member_id} style={st.assignedRow}>
                <span>{r.name}{r.rsvp_status === "Maybe" && <span style={st.maybeTag}>Maybe</span>}{r.note && <span style={st.note}> — {r.note}</span>}</span>
                {openDrivers.length > 0 ? (
                  <select style={st.assignSel} disabled={busy} value=""
                    onChange={(e) => e.target.value && assign(r.member_id, parseInt(e.target.value), leg)}>
                    <option value="">Assign to…</option>
                    {openDrivers.map((d) => (
                      <option key={d.member_id} value={d.member_id}>{d.name}{d.open_seats != null ? ` (${d.open_seats} open)` : ""}</option>
                    ))}
                  </select>
                ) : <span style={st.note}>no open seats</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={st.card}>
      <div style={st.head}>
        <span style={st.title}><Car size={16} style={{ verticalAlign: -3 }} /> How will you get to this event?</span>
        {canManage && (
          <label style={st.enable}>
            <input type="checkbox" checked={data.transport_enabled} disabled={busy}
              onChange={(e) => run(() => transportApi.setEnabled(eventId, e.target.checked))} />
            Ask members about transportation
          </label>
        )}
      </div>
      {err && <div style={st.err}>{err}</div>}

      {!data.transport_enabled ? (
        canManage && <p style={st.muted}>Turn this on for off-site events to ask members how they'll get there and back and coordinate rides.</p>
      ) : (
        <>
          {/* Member's own answer */}
          {legPicker(myTo, myBack, chooseMine)}
          {busy && <Loader2 size={14} className="spin" style={{ color: "#888", marginTop: 6 }} />}
          {iDrive && (
            <div style={st.seatsRow}>
              <span style={st.seatsLabel}>Open seats you can offer:</span>
              <input type="number" min={0} style={st.seatsInput} value={seats} placeholder="e.g. 3"
                onChange={(e) => setSeats(e.target.value)} onBlur={saveSeats} />
            </div>
          )}
          {(myTo || myBack) && <button style={st.clear} disabled={busy} onClick={clearMine}>Clear my answer</button>}

          {/* Parent/guardian: set the plan for each youth in the family */}
          {data.my_youth.length > 0 && (
            <div style={st.youthWrap}>
              <div style={st.listHead}>Your youth's transportation</div>
              {data.my_youth.map((y) => {
                const yDrive = y.ride_to === "drive" || y.ride_back === "drive";
                return (
                  <div key={y.member_id} style={st.youthRow}>
                    <div style={st.youthName}>{y.name}</div>
                    {legPicker(y.ride_to, y.ride_back, (which, v) => chooseYouth(y.member_id, y.ride_to, y.ride_back, y.seats_available, which, v))}
                    {yDrive && (
                      <div style={st.seatsRow}>
                        <span style={st.seatsLabel}>Open seats:</span>
                        <input type="number" min={0} style={st.seatsInput} defaultValue={y.seats_available ?? ""} placeholder="e.g. 3"
                          onBlur={(e) => saveYouthSeats(y.member_id, y.ride_to, y.ride_back, e.target.value)} />
                      </div>
                    )}
                    {(y.ride_to || y.ride_back) && <button style={st.clear} disabled={busy} onClick={() => clearYouth(y.member_id)}>Clear</button>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary */}
          <div style={st.summary}>
            <span style={{ ...st.stat, color: "#c62828" }}>Need a ride — there {s.need_to} · back {s.need_back}</span>
            <span style={{ ...st.stat, color: "#1565c0" }}>Drivers — there {s.drive_to} ({s.seats_to} seats) · back {s.drive_back} ({s.seats_back} seats)</span>
          </div>

          {/* Coordinator: assign riders to vehicles, per leg */}
          {canManage && plan && (plan.to.drivers.length + plan.to.unassigned_riders.length + plan.back.drivers.length + plan.back.unassigned_riders.length) > 0 && (
            <div style={st.planBox}>
              <div style={st.planHeadRow}>
                <span style={st.planHead}>Assign riders to vehicles</span>
                <button style={st.pdfBtn} disabled={busy} onClick={downloadPDF}><FileDown size={13} /> PDF</button>
              </div>
              {renderAssignLeg(plan.to, "to", "Ride there")}
              {renderAssignLeg(plan.back, "back", "Ride back")}
            </div>
          )}

          {canManage && data.responses.length > 0 && (
            <details style={st.details}>
              <summary style={st.detailsSum}>All responses ({data.responses.length})</summary>
              {data.responses.map((r) => (
                <div key={r.member_id} style={st.person}>
                  {r.name} — <span style={{ color: colorOf(r.ride_to), fontWeight: 600 }}>there: {labelOf(r.ride_to)}</span>
                  {" · "}<span style={{ color: colorOf(r.ride_back), fontWeight: 600 }}>back: {labelOf(r.ride_back)}</span>
                  {r.seats_available != null && <span style={st.seatsTag}>{r.seats_available} seats</span>}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginTop: 14 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  title: { fontWeight: 700, fontSize: 15, color: "#1a3a5c" },
  enable: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#556", cursor: "pointer" },
  err: { background: "#fdecea", color: "#c62828", borderRadius: 6, padding: "7px 10px", fontSize: 13, margin: "8px 0" },
  muted: { color: "#889", fontSize: 13.5, margin: "8px 0 0" },
  legs: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  legRow: { display: "flex", flexDirection: "column", gap: 5 },
  legLabel: { fontSize: 12, fontWeight: 700, color: "#556" },
  pickRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  pick: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", border: "1.5px solid #d5dee8", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13, color: "#445", fontWeight: 500 },
  pickOn: { background: "#f7fafd", fontWeight: 700 },
  seatsRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  seatsLabel: { fontSize: 13, color: "#556" },
  seatsInput: { width: 70, padding: "5px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  clear: { background: "none", border: "none", color: "#c62828", fontSize: 12, cursor: "pointer", padding: 0, marginTop: 8 },
  summary: { display: "flex", flexWrap: "wrap", gap: 16, marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f7" },
  stat: { fontSize: 12.5, fontWeight: 700 },
  listHead: { fontSize: 11.5, fontWeight: 700, color: "#8b98a6", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 },
  person: { fontSize: 13, color: "#334", padding: "3px 0", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  seatsTag: { fontSize: 11, fontWeight: 700, color: "#1565c0", background: "#e7f0fb", borderRadius: 5, padding: "1px 7px" },
  note: { color: "#8b98a6", fontStyle: "italic" },
  details: { marginTop: 12 },
  detailsSum: { fontSize: 12.5, color: "#1565c0", cursor: "pointer", fontWeight: 600 },
  youthWrap: { marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f7" },
  youthRow: { padding: "8px 0", borderBottom: "1px solid #f4f7fa" },
  youthName: { fontSize: 13.5, fontWeight: 700, color: "#334", marginBottom: 2 },
  planBox: { marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f7" },
  planHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  planHead: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c" },
  pdfBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "1px solid #1565c0", borderRadius: 7, background: "#fff", color: "#1565c0", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  legPlan: { marginBottom: 14 },
  legPlanHead: { fontSize: 12.5, fontWeight: 800, color: "#1565c0", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  driverCard: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", marginBottom: 8, background: "#f9fbfd" },
  driverTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 },
  driverName: { fontWeight: 700, fontSize: 13.5, color: "#1565c0" },
  assignedRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, color: "#334", padding: "3px 0", flexWrap: "wrap" },
  unassign: { background: "none", border: "none", color: "#c62828", fontSize: 11.5, cursor: "pointer", padding: 0 },
  maybeTag: { fontSize: 10.5, fontWeight: 700, color: "#e65100", background: "#fff1e6", borderRadius: 5, padding: "1px 6px", marginLeft: 6 },
  emptyRiders: { fontSize: 12, color: "#98a4b2", fontStyle: "italic", padding: "2px 0" },
  unassignedBox: { border: "1px dashed #f0c4c4", borderRadius: 8, padding: "9px 12px", marginTop: 4, background: "#fffafa" },
  assignSel: { padding: "4px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 12.5 },
};
