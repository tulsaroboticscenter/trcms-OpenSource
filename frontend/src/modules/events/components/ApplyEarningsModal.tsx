import { useState, useEffect } from "react";
import { eventsApi, type MyDistribution } from "../api";
import { X, DollarSign } from "lucide-react";

/**
 * Modal where a youth on multiple eligible teams chooses which team(s) get the
 * funds they earn at an event. Used both from the Attend button and from the
 * "Apply Earnings" prompt on the home Events tab. Selecting multiple teams
 * splits the earnings evenly.
 */
export default function ApplyEarningsModal({ eventId, eventName, memberId, subjectName, onClose, onDone }: {
  eventId: number; eventName: string; memberId?: number; subjectName?: string; onClose: () => void; onDone?: (reFinalized: boolean) => void;
}) {
  const [dist, setDist] = useState<MyDistribution | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    eventsApi.getMyDistribution(eventId, memberId).then((d) => {
      setDist(d);
      setPicked(d.chosen_team_season_ids.length ? d.chosen_team_season_ids : []);
    }).catch(() => setErr("Could not load your teams."));
  }, [eventId, memberId]);

  function toggle(id: number) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function submit() {
    if (picked.length === 0) { setErr("Choose at least one team."); return; }
    setSaving(true); setErr("");
    try {
      const r = await eventsApi.setMyDistribution(eventId, picked, memberId);
      onDone?.(r.re_finalized);
      onClose();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
      setSaving(false);
    }
  }

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.head}>
          <div style={st.title}><DollarSign size={16} /> Apply Earnings</div>
          <button style={st.close} onClick={onClose}><X size={18} /></button>
        </div>
        <p style={st.sub}>
          {subjectName ? `${subjectName} is` : "You're"} on more than one team eligible for <strong>{eventName}</strong>.
          Which team(s) should receive the funds {subjectName ? "they earn" : "you earn"}? Pick multiple to split the
          earnings evenly. {subjectName ? "" : ""}
        </p>
        {!dist ? <p style={st.muted}>Loading…</p> : (
          <>
            <div style={st.teamList}>
              {dist.eligible_teams.map((t) => (
                <label key={t.team_season_id} style={{ ...st.teamRow, ...(picked.includes(t.team_season_id) ? st.teamRowOn : {}) }}>
                  <input type="checkbox" checked={picked.includes(t.team_season_id)} onChange={() => toggle(t.team_season_id)} />
                  <span>{t.label}</span>
                </label>
              ))}
              {dist.eligible_teams.length === 0 && <p style={st.muted}>You're not on any team eligible for this event.</p>}
            </div>
            {err && <div style={st.err}>{err}</div>}
            <div style={st.actions}>
              <button style={st.cancel} onClick={onClose}>Cancel</button>
              <button style={st.save} disabled={saving || dist.eligible_teams.length === 0} onClick={submit}>
                {saving ? "Saving…" : "Save choice"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, padding: "20px 22px", maxWidth: 460, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.25)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { display: "flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 700, color: "#1a3a5c" },
  close: { background: "none", border: "none", cursor: "pointer", color: "#888" },
  sub: { fontSize: 13.5, color: "#555", lineHeight: 1.5, margin: "0 0 14px" },
  teamList: { display: "flex", flexDirection: "column", gap: 7 },
  teamRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", fontSize: 14, color: "#333" },
  teamRowOn: { borderColor: "#2e7d32", background: "#f0fdf4" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "8px 12px", color: "#c62828", fontSize: 13, marginTop: 10 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancel: { padding: "9px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "9px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  muted: { fontSize: 13, color: "#aaa" },
};
