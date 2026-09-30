/**
 * WaitlistPage — Recruitment Phase 1. Per-night capacity (Program Director-defined)
 * and a weighted, night-aware waitlist for over-subscribed programs (FLL). Weight:
 * siblings of current members + youth whose parent will mentor. Extends Visitors.
 */
import { useState, useEffect, useCallback } from "react";
import { currentSeasonLabel } from "../../../core/dateUtils";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { programsApi, type Program } from "../../enrollment/api";
import { waitlistApi, type ProgramNight, type WaitlistEntry } from "../waitlistApi";
import { ArrowLeft, Plus, Trash2, Check, X, Users } from "lucide-react";
import InlineHelp from "../../help/InlineHelp";

const seasonNow = () => currentSeasonLabel();
const STATUS_COLORS: Record<string, string> = { waiting: "#1565c0", offered: "#e65100", accepted: "#2e7d32", declined: "#889", expired: "#b0bcc9", withdrawn: "#b0bcc9" };

export default function WaitlistPage() {
  const navigate = useNavigate();
  const goBack = useGoBack("/visitors");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<number | null>(null);
  const [season, setSeason] = useState(seasonNow());
  const [nights, setNights] = useState<ProgramNight[]>([]);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [newNight, setNewNight] = useState({ name: "", capacity: "" });

  useEffect(() => {
    programsApi.list().then((ps) => {
      setPrograms(ps);
      // Default to the first FLL program (over-subscribed); else first program.
      const fll = ps.find((p) => p.name.toUpperCase().startsWith("FLL")) ?? ps[0];
      if (fll) setProgramId(fll.id);
    });
  }, []);

  const load = useCallback(() => {
    if (!programId) return;
    waitlistApi.nights(programId, season).then(setNights);
    waitlistApi.list(programId, season).then(setEntries);
  }, [programId, season]);
  useEffect(() => { load(); }, [load]);

  async function addNight() {
    if (!programId || !newNight.name.trim()) return;
    await waitlistApi.addNight({ program_id: programId, season, name: newNight.name, capacity: Number(newNight.capacity) || 0 });
    setNewNight({ name: "", capacity: "" }); load();
  }
  async function setCapacity(n: ProgramNight, capacity: number) { await waitlistApi.updateNight(n.id, { capacity }); load(); }
  async function delNight(n: ProgramNight) { if (confirm(`Delete "${n.name}"?`)) { await waitlistApi.deleteNight(n.id); load(); } }

  async function offer(e: WaitlistEntry, nightId: number) { setEntries(await waitlistApi.offer(e.id, { night_id: nightId, expires_days: 7 })); load(); }
  async function respond(e: WaitlistEntry, accept: boolean) { setEntries(await waitlistApi.respond(e.id, accept)); load(); }
  async function remove(e: WaitlistEntry) { if (confirm(`Remove ${e.person.name} from the waitlist?`)) { setEntries(await waitlistApi.remove(e.id)); load(); } }

  const openNights = nights.filter((n) => n.is_active && n.spots_open > 0);

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Visitors</button>
      <div style={s.head}>
        <h1 style={s.h1}><Users size={22} /> Waitlist <InlineHelp helpKey="waitlist" /></h1>
        <div style={s.pick}>
          <select style={s.sel} value={programId ?? ""} onChange={(e) => setProgramId(Number(e.target.value))}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input style={s.seasonIn} value={season} onChange={(e) => setSeason(e.target.value)} />
        </div>
      </div>
      <p style={s.sub}>Weighted by siblings of current members and youth whose parent will mentor. Waitlisted interest carries forward between seasons.</p>

      {/* Nights / capacity */}
      <div style={s.card}>
        <div style={s.cardTitle}>Meeting nights & capacity <span style={s.hint}>(set by the Program Director)</span></div>
        <div style={s.nightGrid}>
          {nights.map((n) => (
            <div key={n.id} style={s.night}>
              <div style={s.nightTop}>
                <span style={s.nightName}>{n.name}</span>
                <button style={s.iconX} onClick={() => delNight(n)}><Trash2 size={12} /></button>
              </div>
              <label style={s.capRow}>Capacity <input style={s.capIn} type="number" defaultValue={n.capacity} onBlur={(e) => setCapacity(n, Number(e.target.value))} /></label>
              <div style={s.nightStats}>
                <span style={{ color: n.spots_open > 0 ? "#2e7d32" : "#c62828" }}>{n.spots_open} open</span>
                <span> · {n.accepted}/{n.capacity} filled</span>
                <span> · {n.waiting} waiting</span>
              </div>
            </div>
          ))}
        </div>
        <div style={s.addNight}>
          <input style={s.fin} placeholder="Night (e.g. Monday)" value={newNight.name} onChange={(e) => setNewNight({ ...newNight, name: e.target.value })} />
          <input style={{ ...s.fin, maxWidth: 100 }} type="number" placeholder="Capacity" value={newNight.capacity} onChange={(e) => setNewNight({ ...newNight, capacity: e.target.value })} />
          <button style={s.addBtn} onClick={addNight}><Plus size={13} /> Add night</button>
        </div>
      </div>

      {/* Queue */}
      <div style={s.cardTitle2}>Waitlist queue</div>
      {entries.length === 0 ? <p style={s.muted}>No one on the waitlist for this program/season. Add youth from a visitor's page.</p> : (
        entries.map((e) => (
          <div key={e.id} style={{ ...s.entry, ...(e.status !== "waiting" && e.status !== "offered" ? s.entryDim : {}) }}>
            <span style={s.pos}>{e.position ? `#${e.position}` : "—"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.entryTop}>
                {e.person.type === "visitor" && e.person.id
                  ? <button style={s.entryLink} onClick={() => navigate(`/visitors/${e.person.id}`)} title="Open record — set program, log contact, convert">{e.person.name} ↗</button>
                  : <span style={s.entryName}>{e.person.name}</span>}
                <span style={{ ...s.statusChip, background: STATUS_COLORS[e.status] }}>{e.status}</span>
                {e.sibling_of_member && <span style={s.wchip}>sibling</span>}
                {e.parent_mentor_interest && <span style={{ ...s.wchip, background: "#ede7f6", color: "#5e35b1" }}>parent-mentor</span>}
              </div>
              <div style={s.entryMeta}>
                waiting since {e.requested_date}{e.carried_from_season ? ` (carried from ${e.carried_from_season})` : ""}
                {e.available_nights.length > 0 && ` · nights: ${e.available_nights.map((n) => n.name).join(", ")}`}
                {e.preferred_night && ` · prefers ${e.preferred_night.name}`}
                {e.offered_night && ` · offered ${e.offered_night.name}${e.offer_expires ? ` (expires ${e.offer_expires})` : ""}`}
              </div>
            </div>
            <div style={s.actions}>
              {e.status === "offered" ? (
                <>
                  <button style={s.acceptBtn} onClick={() => respond(e, true)}><Check size={12} /> Accept</button>
                  <button style={s.declineBtn} onClick={() => respond(e, false)}><X size={12} /> Decline</button>
                </>
              ) : e.status === "waiting" && openNights.length > 0 ? (
                <select style={s.offerSel} defaultValue="" onChange={(ev) => ev.target.value && offer(e, Number(ev.target.value))}>
                  <option value="">Offer night…</option>
                  {openNights
                    .filter((n) => e.available_nights.length === 0 || e.available_nights.some((an) => an.id === n.id))
                    .map((n) => <option key={n.id} value={n.id}>{n.name} ({n.spots_open} open)</option>)}
                </select>
              ) : null}
              <button style={s.iconX} onClick={() => remove(e)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  pick: { display: "flex", gap: 8 },
  sel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, background: "#fff" },
  seasonIn: { width: 96, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, textAlign: "center" },
  sub: { color: "#667", fontSize: 13, margin: "6px 0 16px" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 16 },
  cardTitle: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  cardTitle2: { fontSize: 13, fontWeight: 800, color: "#1a3a5c", margin: "4px 0 10px", textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontWeight: 400, color: "#99a", textTransform: "none", fontSize: 11 },
  nightGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 10 },
  night: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, background: "#f8fafc" },
  nightTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  nightName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  capRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#556", margin: "6px 0" },
  capIn: { width: 60, padding: "4px 6px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 13 },
  nightStats: { fontSize: 11.5, color: "#667", fontWeight: 600 },
  addNight: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  fin: { flex: 1, minWidth: 130, padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, background: "#fff" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  muted: { color: "#889", fontSize: 14 },
  entry: { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 7 },
  entryDim: { opacity: 0.6 },
  pos: { fontSize: 14, fontWeight: 800, color: "#99a", minWidth: 30 },
  entryTop: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  entryName: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  entryLink: { fontSize: 14, fontWeight: 700, color: "#1565c0", background: "none", border: "none", padding: 0, cursor: "pointer" },
  statusChip: { color: "#fff", fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: "1px 7px", textTransform: "capitalize" },
  wchip: { fontSize: 10.5, fontWeight: 700, background: "#e3f2fd", color: "#1565c0", borderRadius: 5, padding: "1px 7px" },
  entryMeta: { fontSize: 12, color: "#778", marginTop: 3 },
  actions: { display: "flex", alignItems: "center", gap: 6 },
  offerSel: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, background: "#fff" },
  acceptBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7", borderRadius: 6, padding: "5px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  declineBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "#fff", color: "#889", border: "1px solid #ccc", borderRadius: 6, padding: "5px 9px", fontSize: 12, cursor: "pointer" },
  iconX: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 3 },
};
