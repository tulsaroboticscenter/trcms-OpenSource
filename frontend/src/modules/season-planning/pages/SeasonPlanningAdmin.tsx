/**
 * SeasonPlanningAdmin (Phase 1) — configure per-night capacity, email families
 * the availability form, and track responses. The drag-and-drop planning board
 * (Phase 2) and auto-suggest/publish (Phase 3) attach here later.
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { useSeasons, seasonOptions } from "../../../core/useSeasons";
import { currentSeasonLabel } from "../../../core/dateUtils";
import { seasonPlanningApi, type DashboardData } from "../api";
import { ArrowLeft, CalendarClock, Mail, Plus, CheckCircle, Clock, Send, RefreshCw, X, Undo2 } from "lucide-react";

const PROGRAMS = [{ id: 2, label: "FLL Challenge" }, { id: 1, label: "FLL Explore" }];

interface Night { id: number; name: string; capacity: number; max_teams: number | null; display_order: number; }

export default function SeasonPlanningAdmin() {
  const navigate = useNavigate();
  const seasons = useSeasons();
  const [season, setSeason] = useState(currentSeasonLabel());
  const [programId, setProgramId] = useState(2);

  const [nights, setNights] = useState<Night[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [band, setBand] = useState<{ min: number; max: number } | null>(null);
  const [editBand, setEditBand] = useState(false);

  const loadNights = useCallback(() => {
    api.get("/api/v1/waitlist/nights", { params: { program_id: programId, season } })
      .then((r) => setNights(r.data)).catch(() => setNights([]));
  }, [programId, season]);
  const loadDash = useCallback(() => {
    setLoading(true);
    seasonPlanningApi.dashboard(season, programId, showAll)
      .then((d) => { setData(d); setBand(d.age_band); })
      .catch(() => setData(null)).finally(() => setLoading(false));
  }, [season, programId, showAll]);
  useEffect(() => { loadNights(); loadDash(); setSelected(new Set()); }, [loadNights, loadDash]);

  async function saveBand() {
    if (!band) return;
    await seasonPlanningApi.saveEligibility({ [String(programId)]: band });
    setEditBand(false); loadDash();
  }

  async function addNight() {
    const name = window.prompt("Night name (e.g. Tuesday)?");
    if (!name) return;
    await api.post("/api/v1/waitlist/nights", { program_id: programId, season, name, display_order: nights.length + 1 });
    loadNights();
  }
  async function saveNight(n: Night, patch: Partial<Night>) {
    setNights((ns) => ns.map((x) => (x.id === n.id ? { ...x, ...patch } : x)));
    await api.patch(`/api/v1/waitlist/nights/${n.id}`, patch);
  }

  async function sendInvites() {
    if (selected.size === 0) return;
    setMsg("");
    const r = await seasonPlanningApi.sendInvites(season, programId, [...selected]);
    setMsg(r.email_enabled
      ? `Sent to ${r.sent} family${r.sent === 1 ? "" : "ies"}${r.skipped_no_email.length ? `; ${r.skipped_no_email.length} skipped (no email on file)` : ""}.`
      : `Created ${r.sent} invite link${r.sent === 1 ? "" : "s"}, but email (SMTP) is off, so nothing was sent. Turn on Email Settings to deliver them.`);
    setSelected(new Set());
    loadDash();
  }

  async function removeFamily(key: number, name: string) {
    if (!window.confirm(`Remove ${name} from the planning list? They'll stay off it until you restore them.`)) return;
    await seasonPlanningApi.excludeFamily(season, programId, key, name);
    loadDash();
  }
  async function restoreFamily(key: number) {
    await seasonPlanningApi.restoreFamily(season, programId, key);
    loadDash();
  }

  const families = data?.families ?? [];
  const removed = data?.removed ?? [];
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const emailableNotDone = families.filter((f) => !f.complete && f.emailable && f.family_id).map((f) => f.family_id);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <button style={s.back} onClick={() => navigate("/admin")}><ArrowLeft size={14} /> Admin Console</button>
      <div style={s.head}>
        <h1 style={s.heading}><CalendarClock size={22} style={{ verticalAlign: -4 }} /> Season Planning</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.ghost} onClick={loadDash}><RefreshCw size={14} /> Refresh</button>
          <button style={s.ghost} onClick={() => navigate("/season-planning/preferences")}>Night preferences →</button>
          <button style={s.sendBtn} onClick={() => navigate("/season-planning/board")}>Planning board →</button>
        </div>
      </div>
      <p style={s.sub}>Collect each family's night availability and mentor willingness before the season. Phase 1: capacity + availability collection.</p>

      <div style={s.pickers}>
        <label style={s.pick}>Season
          <select style={s.select} value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasonOptions(seasons, season).map((sea) => <option key={sea} value={sea}>{sea}</option>)}
          </select>
        </label>
        <label style={s.pick}>Program
          <select style={s.select} value={programId} onChange={(e) => setProgramId(Number(e.target.value))}>
            {PROGRAMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {/* Nights & capacity */}
      <div style={s.card}>
        <div style={s.cardHead}><span>Nights &amp; capacity</span><button style={s.addBtn} onClick={addNight}><Plus size={13} /> Add night</button></div>
        {nights.length === 0 ? <p style={s.muted}>No nights yet — add Tuesday, Thursday, etc.</p> : (
          <div style={s.nightGrid}>
            <div style={{ ...s.nightRow, ...s.nightHeadRow }}><span style={{ flex: 1 }}>Night</span><span style={s.ncol}>Max youth</span><span style={s.ncol}>Max teams</span></div>
            {nights.map((n) => (
              <div key={n.id} style={s.nightRow}>
                <span style={{ flex: 1, fontWeight: 600, color: "#1a3a5c" }}>{n.name}</span>
                <input style={s.numIn} type="number" min={0} value={n.capacity} onChange={(e) => saveNight(n, { capacity: Number(e.target.value) })} />
                <input style={s.numIn} type="number" min={0} value={n.max_teams ?? ""} placeholder="—" onChange={(e) => saveNight(n, { max_teams: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
            ))}
          </div>
        )}
        <p style={s.hint}>“Max teams” is capped by how many mentors can lead that night — you'll confirm it against responses on the planning board (Phase 2).</p>
      </div>

      {/* Response tracking */}
      <div style={s.card}>
        <div style={s.cardHead}>
          <span>Families {data && <span style={s.progress}>({data.complete}/{data.total} complete)</span>}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.ghostSm} onClick={() => setSelected(new Set(emailableNotDone))}>Select all not-done</button>
            <button style={s.sendBtn} disabled={selected.size === 0} onClick={sendInvites}><Send size={13} /> Email availability form ({selected.size})</button>
          </div>
        </div>

        {data && (
          <div style={s.eligBar}>
            <span>
              {data.show_all
                ? <>Showing <b>all</b> families with a youth.</>
                : <>Showing families with a youth <b>eligible for {data.program_name}</b> (ages {band?.min}–{band?.max} as of Jan 1 {data.ref_year}) <b>or</b> who've shown interest.</>}
            </span>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {!editBand && !data.show_all && <button style={s.linkBtn} onClick={() => setEditBand(true)}>Edit age range</button>}
              <label style={s.toggle}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all families</label>
            </div>
          </div>
        )}
        {editBand && band && (
          <div style={s.bandEdit}>
            <span>{PROGRAMS.find((p) => p.id === programId)?.label} age range:</span>
            <input style={s.numIn} type="number" min={0} value={band.min} onChange={(e) => setBand({ ...band, min: Number(e.target.value) })} /> to
            <input style={s.numIn} type="number" min={0} value={band.max} onChange={(e) => setBand({ ...band, max: Number(e.target.value) })} />
            <button style={s.sendBtn} onClick={saveBand}>Save</button>
            <button style={s.ghostSm} onClick={() => { setEditBand(false); loadDash(); }}>Cancel</button>
          </div>
        )}

        {msg && <div style={s.msg}><Mail size={13} /> {msg}</div>}
        {loading ? <p style={s.muted}>Loading…</p> : families.length === 0 ? (
          <p style={s.muted}>No {data?.program_name ?? "FLL"}-eligible families found. Add birthdates to youth, or tick “Show all families”.</p>
        ) : (
          <div style={s.table}>
            <div style={s.tHead}><span style={{ width: 28 }} /><span style={{ flex: 1 }}>Family &amp; eligible youth</span><span style={s.tcol}>Responded</span><span style={s.tcol}>Invite</span><span style={s.tcol}>Status</span><span style={{ width: 32 }} /></div>
            {families.map((f) => (
              <div key={f.family_id || f.family_name} style={s.tRow}>
                <input type="checkbox" checked={selected.has(f.family_id)} disabled={!f.emailable || !f.family_id} onChange={() => toggle(f.family_id)} />
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, color: "#1a3a5c" }}>{f.family_name}</span>
                  {!f.emailable && <span style={s.noEmail} title="No guardian email on file — can't send">no email</span>}
                  <div style={s.chipRow}>
                    {f.candidates.map((c) => (
                      <span key={c.member_id} style={s.youthChip}>
                        {c.name}{c.age != null ? ` (${c.age})` : ""}
                        {c.reasons.map((r) => <span key={r} style={s.reasonChip}>{r}</span>)}
                      </span>
                    ))}
                  </div>
                </span>
                <span style={s.tcol}>{f.responded_count}/{f.member_count}</span>
                <span style={s.tcol}>{f.invite_used ? "Used" : f.invite_sent ? "Sent" : "—"}</span>
                <span style={s.tcol}>{f.complete
                  ? <span style={s.ok}><CheckCircle size={13} /> Complete</span>
                  : <span style={s.pending}><Clock size={13} /> {f.responded_count > 0 ? "Partial" : "Waiting"}</span>}</span>
                <button style={s.removeBtn} title="Remove this family from the list"
                  onClick={() => removeFamily(f.key, f.family_name)}><X size={15} /></button>
              </div>
            ))}
          </div>
        )}

        {removed.length > 0 && (
          <div style={s.removedBox}>
            <div style={s.removedHead}>Removed from this list ({removed.length})</div>
            {removed.map((r) => (
              <div key={r.key} style={s.removedRow}>
                <span style={{ color: "#64748b" }}>{r.family_name}</span>
                <button style={s.restoreBtn} onClick={() => restoreFamily(r.key)}><Undo2 size={12} /> Restore</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 8, padding: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, margin: "6px 0 16px" },
  ghost: { display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  removeBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, marginLeft: 6, border: "1px solid #f0d0d0", background: "#fff", color: "#c0392b", borderRadius: 6, cursor: "pointer", flexShrink: 0 },
  removedBox: { marginTop: 14, padding: "10px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 },
  removedHead: { fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 8 },
  removedRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0", fontSize: 13.5 },
  restoreBtn: { display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", border: "1px solid #cdd7e3", background: "#fff", color: "#1565c0", borderRadius: 6, cursor: "pointer", fontSize: 12.5 },
  pickers: { display: "flex", gap: 14, marginBottom: 14, flexWrap: "wrap" },
  pick: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 700, color: "#455" },
  select: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, fontWeight: 400 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px", marginBottom: 16 },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontWeight: 800, color: "#1a3a5c", fontSize: 15, marginBottom: 10, flexWrap: "wrap" },
  progress: { fontSize: 13, fontWeight: 600, color: "#2e7d32" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12.5 },
  nightGrid: { display: "flex", flexDirection: "column", gap: 2 },
  nightRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f4f7fa" },
  nightHeadRow: { fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0" },
  ncol: { width: 100, textAlign: "center" },
  numIn: { width: 90, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, textAlign: "center" },
  hint: { fontSize: 11.5, color: "#8894a5", marginTop: 8 },
  sendBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  ghostSm: { padding: "8px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "#455" },
  msg: { display: "flex", alignItems: "center", gap: 8, background: "#e8f4fd", border: "1px solid #b3d8f0", borderRadius: 8, padding: "9px 12px", color: "#1565c0", fontSize: 13, marginBottom: 10 },
  table: { display: "flex", flexDirection: "column" },
  tHead: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0" },
  tRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f4f7fa", fontSize: 13.5 },
  tcol: { width: 110, fontSize: 13, color: "#445" },
  ok: { display: "flex", alignItems: "center", gap: 4, color: "#2e7d32", fontWeight: 600, fontSize: 12.5 },
  pending: { display: "flex", alignItems: "center", gap: 4, color: "#b26a00", fontWeight: 600, fontSize: 12.5 },
  muted: { color: "#889", fontSize: 13.5, padding: "1rem 0" },
  eligBar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#f2f7fc", border: "1px solid #d6e4f0", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "#33506b", marginBottom: 10 },
  toggle: { display: "flex", alignItems: "center", gap: 5, fontWeight: 600, color: "#455", whiteSpace: "nowrap" },
  linkBtn: { background: "none", border: "none", color: "#1565c0", textDecoration: "underline", cursor: "pointer", fontSize: 12.5, padding: 0 },
  bandEdit: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "#455", marginBottom: 10, fontWeight: 600 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 },
  youthChip: { display: "inline-flex", alignItems: "center", gap: 4, background: "#eef4fb", borderRadius: 6, padding: "2px 7px", fontSize: 11.5, color: "#1a3a5c", fontWeight: 600 },
  reasonChip: { fontSize: 9.5, fontWeight: 700, color: "#1565c0", background: "#dcebfb", borderRadius: 4, padding: "0 5px", textTransform: "none" },
  noEmail: { fontSize: 9.5, fontWeight: 700, color: "#fff", background: "#b26a00", borderRadius: 4, padding: "1px 5px", marginLeft: 8 },
};
