/**
 * EventTransportPrompt (0221–0223) — the transportation question shown as a modal right after a
 * member RSVPs "Attending"/"Maybe" to a transport-enabled event (if they haven't answered yet).
 * Asks two legs — ride there and ride back. When `memberId` is set (a parent answering for a
 * youth) the answer is attributed to that youth, not the person clicking.
 */
import { useState } from "react";
import { transportApi, type TransportLeg } from "../api";
import { Car, X, Check } from "lucide-react";

const OPTIONS: { value: TransportLeg; label: string; color: string }[] = [
  { value: "have", label: "Have a ride", color: "#2e7d32" },
  { value: "need", label: "Need a ride", color: "#c62828" },
  { value: "drive", label: "Can drive others", color: "#1565c0" },
  { value: "not_sure", label: "Not sure", color: "#e65100" },
];

export default function EventTransportPrompt({ eventId, eventName, memberId, forName, onClose, onSaved }: {
  eventId: number; eventName: string; memberId?: number; forName?: string; onClose: () => void; onSaved: () => void;
}) {
  const [rideTo, setRideTo] = useState<TransportLeg | null>(null);
  const [rideBack, setRideBack] = useState<TransportLeg | null>(null);
  const [seats, setSeats] = useState("");
  const [saving, setSaving] = useState(false);

  const driving = rideTo === "drive" || rideBack === "drive";
  const who = forName ? `${forName}'s` : "your";

  async function save() {
    if (!rideTo && !rideBack) return;
    setSaving(true);
    try {
      await transportApi.respond(eventId, {
        ride_to: rideTo, ride_back: rideBack,
        seats_available: driving ? (seats === "" ? null : Math.max(0, parseInt(seats) || 0)) : null,
        ...(memberId ? { member_id: memberId } : {}),
      });
      onSaved(); onClose();
    } finally { setSaving(false); }
  }

  const legRow = (label: string, cur: TransportLeg | null, set: (v: TransportLeg) => void) => (
    <div style={st.legRow}>
      <span style={st.legLabel}>{label}</span>
      <div style={st.opts}>
        {OPTIONS.map((o) => (
          <button key={o.value} disabled={saving}
            style={{ ...st.opt, ...(cur === o.value ? { borderColor: o.color, color: o.color, background: "#f7fafd", fontWeight: 700 } : {}) }}
            onClick={() => set(o.value)}>
            {cur === o.value && <Check size={12} style={{ verticalAlign: -2 }} />} {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <button style={st.close} onClick={onClose}><X size={16} /></button>
        <div style={st.title}><Car size={18} style={{ verticalAlign: -3 }} /> {forName ? `${forName}'s ride to this event?` : "How will you get to this event?"}</div>
        <p style={st.sub}>Planning to go to <strong>{eventName}</strong>? This is an off-site event — let us know {who} ride there and back so we can help coordinate rides (even if it's still a maybe).</p>
        {legRow("Ride there", rideTo, setRideTo)}
        {legRow("Ride back", rideBack, setRideBack)}
        {driving && (
          <div style={st.seatsRow}>
            <span style={st.seatsLabel}>Open seats to offer:</span>
            <input type="number" min={0} autoFocus style={st.seatsInput} value={seats} placeholder="e.g. 3"
              onChange={(e) => setSeats(e.target.value)} />
          </div>
        )}
        <div style={st.actions}>
          <button style={st.skip} onClick={onClose}>Skip for now</button>
          <button style={{ ...st.saveBtn, ...((!rideTo && !rideBack) || saving ? { opacity: 0.5, cursor: "default" } : {}) }}
            disabled={(!rideTo && !rideBack) || saving} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { position: "relative", background: "#fff", borderRadius: 12, padding: "22px 24px", width: "min(480px, 100%)", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" },
  close: { position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "#889" },
  title: { fontSize: 17, fontWeight: 800, color: "#1a3a5c" },
  sub: { fontSize: 13.5, color: "#556", margin: "8px 0 14px", lineHeight: 1.5 },
  legRow: { marginBottom: 12 },
  legLabel: { fontSize: 12, fontWeight: 700, color: "#556", display: "block", marginBottom: 5 },
  opts: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  opt: { padding: "10px 12px", border: "1.5px solid #d5dee8", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 13.5, color: "#445", fontWeight: 500 },
  seatsRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 4 },
  seatsLabel: { fontSize: 13, color: "#556" },
  seatsInput: { width: 70, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  actions: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  saveBtn: { padding: "8px 20px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13.5, fontWeight: 700 },
  skip: { background: "none", border: "none", color: "#889", fontSize: 12.5, cursor: "pointer" },
};
