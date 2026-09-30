import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { campApi, type CampSeason, type CampProgram, type CampSession } from "../api";
import { eventsApi, type TRCEvent } from "../../events/api";
import CampTabs from "../components/CampTabs";
import { Tent, Plus, Trash2, Save, Power, Pencil, X, Search, Calendar } from "lucide-react";

export default function CampAdmin() {
  const { canWrite } = useAuth();
  const canManage = canWrite("camp.manage");
  const [season, setSeason] = useState<CampSeason | null>(null);
  const [programs, setPrograms] = useState<CampProgram[]>([]);
  const [sessions, setSessions] = useState<CampSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const s = await campApi.currentSeason().catch(() => null);
    setSeason(s);
    const [p] = await Promise.all([campApi.listPrograms().catch(() => [])]);
    setPrograms(p);
    if (s) setSessions(await campApi.listSessions(s.id).catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }

  async function createSeason() {
    const s = await campApi.saveSeason({ year: new Date().getFullYear(), name: `Summer ${new Date().getFullYear()} Robotics Camp` });
    setSeason(s); setSessions([]); flash("Season created.");
  }

  if (loading) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;

  return (
    <div style={st.page}>
      <div style={st.head}>
        <h1 style={st.h1}><Tent size={22} style={{ verticalAlign: -4 }} /> Summer Camp</h1>
        <p style={st.sub}>Set up the season, camps, and the public registration switch. Campers and parents are tracked here, separate from members.</p>
      </div>
      <CampTabs />
      {msg && <div style={st.flash}>{msg}</div>}

      {!season ? (
        <div style={st.card}>
          <p style={st.muted}>No camp season set up yet.</p>
          {canManage && <button style={st.primaryBtn} onClick={createSeason}><Plus size={14} /> Create this year's camp season</button>}
        </div>
      ) : (
        <>
          <SeasonCard season={season} canManage={canManage} onSaved={(s) => { setSeason(s); flash("Season saved."); }} onFlash={flash} />
          <ProgramsCard programs={programs} canManage={canManage} onChanged={(p) => setPrograms(p)} />
          <SessionsCard season={season} programs={programs} sessions={sessions} canManage={canManage} onChanged={(s) => setSessions(s)} onFlash={flash} />
        </>
      )}
    </div>
  );
}

function SeasonCard({ season, canManage, onSaved, onFlash }: {
  season: CampSeason; canManage: boolean; onSaved: (s: CampSeason) => void; onFlash: (m: string) => void;
}) {
  const [f, setF] = useState(season);
  const [saving, setSaving] = useState(false);
  const [showWaivers, setShowWaivers] = useState(false);
  useEffect(() => setF(season), [season]);
  function set<K extends keyof CampSeason>(k: K, v: CampSeason[K]) { setF((p) => ({ ...p, [k]: v })); }

  async function toggle() {
    const r = await campApi.toggleRegistration(season.id, !f.registration_open);
    set("registration_open", r.registration_open);
    onFlash(r.registration_open ? "Public registration is now OPEN." : "Public registration is now CLOSED.");
  }
  async function save() {
    setSaving(true);
    try { onSaved(await campApi.saveSeason(f)); } finally { setSaving(false); }
  }

  return (
    <div style={st.card}>
      <div style={st.cardHead}>
        <span style={st.cardTitle}>Season</span>
        <div style={{ ...st.regPill, background: f.registration_open ? "#e8f5e9" : "#fdecea", color: f.registration_open ? "#2e7d32" : "#c62828" }}>
          Registration {f.registration_open ? "OPEN" : "CLOSED"}
        </div>
      </div>
      <div style={st.grid}>
        <L label="Year"><input type="number" style={st.input} value={f.year} disabled={!canManage} onChange={(e) => set("year", parseInt(e.target.value) || f.year)} /></L>
        <L label="Name"><input style={st.input} value={f.name} disabled={!canManage} onChange={(e) => set("name", e.target.value)} /></L>
      </div>
      <L label="Public intro (shown atop the registration form)">
        <textarea style={st.textarea} value={f.intro_text ?? ""} disabled={!canManage} onChange={(e) => set("intro_text", e.target.value)} />
      </L>
      <button style={st.linkBtn} onClick={() => setShowWaivers((v) => !v)}>{showWaivers ? "Hide" : "Edit"} waiver text (liability / media / first-aid)</button>
      {showWaivers && (
        <>
          <L label="Liability waiver"><textarea style={st.textarea} value={f.waiver_liability ?? ""} disabled={!canManage} onChange={(e) => set("waiver_liability", e.target.value)} /></L>
          <L label="Media release"><textarea style={st.textarea} value={f.waiver_media ?? ""} disabled={!canManage} onChange={(e) => set("waiver_media", e.target.value)} /></L>
          <L label="First-aid / emergency consent"><textarea style={st.textarea} value={f.waiver_firstaid ?? ""} disabled={!canManage} onChange={(e) => set("waiver_firstaid", e.target.value)} /></L>
        </>
      )}
      {canManage && (
        <div style={st.actions}>
          <button style={{ ...st.toggleBtn, background: f.registration_open ? "#c62828" : "#2e7d32" }} onClick={toggle}>
            <Power size={14} /> {f.registration_open ? "Close registration" : "Open registration"}
          </button>
          <button style={st.primaryBtn} disabled={saving} onClick={save}><Save size={14} /> {saving ? "Saving…" : "Save season"}</button>
        </div>
      )}
    </div>
  );
}

function ProgramsCard({ programs, canManage, onChanged }: {
  programs: CampProgram[]; canManage: boolean; onChanged: (p: CampProgram[]) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await campApi.saveProgram({ name: name.trim(), display_order: programs.length });
      onChanged([...programs, p]); setName("");
    } finally { setBusy(false); }
  }
  async function toggleActive(p: CampProgram) {
    const upd = await campApi.saveProgram({ id: p.id, is_active: !p.is_active });
    onChanged(programs.map((x) => x.id === p.id ? upd : x));
  }
  return (
    <div style={st.card}>
      <div style={st.cardHead}><span style={st.cardTitle}>Camp Programs</span></div>
      <p style={st.hint}>Reusable camp types (FLL, FTC, 3D Printing, Battle Bots, Drone…). Used when defining each session.</p>
      {programs.length === 0 && <p style={st.muted}>No programs yet.</p>}
      {programs.map((p) => (
        <div key={p.id} style={st.progRow}>
          <span style={{ flex: 1, fontWeight: 600, color: p.is_active ? "#1a3a5c" : "#aaa" }}>{p.name}{!p.is_active && " (inactive)"}</span>
          {canManage && <button style={st.smallBtn} onClick={() => toggleActive(p)}>{p.is_active ? "Deactivate" : "Activate"}</button>}
        </div>
      ))}
      {canManage && (
        <div style={st.addRow}>
          <input style={st.input} placeholder="New program name…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button style={st.primaryBtn} disabled={busy} onClick={add}><Plus size={14} /> Add</button>
        </div>
      )}
    </div>
  );
}

const BLANK: Partial<CampSession> = { title: "", is_open: false };

function SessionsCard({ season, programs, sessions, canManage, onChanged, onFlash }: {
  season: CampSeason; programs: CampProgram[]; sessions: CampSession[]; canManage: boolean;
  onChanged: (s: CampSession[]) => void; onFlash: (m: string) => void;
}) {
  const [editing, setEditing] = useState<Partial<CampSession> | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!editing?.title?.trim()) { onFlash("Title is required."); return; }
    setSaving(true);
    try {
      const saved = await campApi.saveSession({ ...editing, season_id: season.id });
      onChanged(editing.id ? sessions.map((s) => s.id === saved.id ? saved : s) : [...sessions, saved]);
      setEditing(null); onFlash("Camp saved.");
    } finally { setSaving(false); }
  }
  async function remove(s: CampSession) {
    if (!confirm(`Delete "${s.title}"? This can't be undone.`)) return;
    try { await campApi.deleteSession(s.id); onChanged(sessions.filter((x) => x.id !== s.id)); onFlash("Camp deleted."); }
    catch (e: unknown) { onFlash((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not delete."); }
  }
  async function toggleOpen(s: CampSession) {
    const upd = await campApi.saveSession({ id: s.id, season_id: season.id, is_open: !s.is_open });
    onChanged(sessions.map((x) => x.id === s.id ? upd : x));
  }
  function set<K extends keyof CampSession>(k: K, v: CampSession[K]) { setEditing((p) => ({ ...(p ?? {}), [k]: v })); }

  return (
    <div style={st.card}>
      <div style={st.cardHead}>
        <span style={st.cardTitle}>Camps / Sessions</span>
        {canManage && !editing && <button style={st.primaryBtn} onClick={() => setEditing({ ...BLANK, display_order: sessions.length })}><Plus size={14} /> Add camp</button>}
      </div>

      {sessions.length === 0 && !editing && <p style={st.muted}>No camps defined for this season yet.</p>}

      {sessions.map((s) => (
        <div key={s.id} style={st.sessRow}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: "#1a3a5c" }}>{s.title} {s.is_open ? <span style={st.openTag}>OPEN</span> : <span style={st.closedTag}>closed</span>}</div>
            <div style={st.sessMeta}>
              {[s.program_name, s.week_label, s.age_band,
                s.start_date && `${s.start_date}${s.end_date ? "–" + s.end_date : ""}`,
                s.price != null && `$${s.price.toFixed(2)}`,
                s.capacity != null && `cap ${s.capacity}`,
                `${s.registered_count} registered`].filter(Boolean).join(" · ")}
            </div>
          </div>
          {canManage && (
            <div style={st.rowBtns}>
              <button style={st.smallBtn} onClick={() => toggleOpen(s)}>{s.is_open ? "Close" : "Open"}</button>
              <button style={st.iconBtn} title="Edit" onClick={() => setEditing(s)}><Pencil size={14} /></button>
              <button style={{ ...st.iconBtn, color: "#c62828" }} title="Delete" onClick={() => remove(s)}><Trash2 size={14} /></button>
            </div>
          )}
        </div>
      ))}

      {editing && (
        <div style={st.editor}>
          <div style={st.editorHead}><strong>{editing.id ? "Edit camp" : "New camp"}</strong><button style={st.iconBtn} onClick={() => setEditing(null)}><X size={16} /></button></div>
          <div style={st.grid}>
            <L label="Title *"><input style={st.input} value={editing.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="Week 1 — FLL Robots" /></L>
            <L label="Program">
              <select style={st.input} value={editing.program_id ?? ""} onChange={(e) => set("program_id", e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">—</option>
                {programs.filter((p) => p.is_active || p.id === editing.program_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </L>
            <L label="Week label"><input style={st.input} value={editing.week_label ?? ""} onChange={(e) => set("week_label", e.target.value)} placeholder="Week 1" /></L>
            <L label="Age band"><input style={st.input} value={editing.age_band ?? ""} onChange={(e) => set("age_band", e.target.value)} placeholder="4th–8th grade" /></L>
            <L label="Start date"><input type="date" style={st.input} value={editing.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} /></L>
            <L label="End date"><input type="date" style={st.input} value={editing.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} /></L>
            <L label="Start time"><input style={st.input} value={editing.start_time ?? ""} onChange={(e) => set("start_time", e.target.value)} placeholder="9:00 AM" /></L>
            <L label="End time"><input style={st.input} value={editing.end_time ?? ""} onChange={(e) => set("end_time", e.target.value)} placeholder="12:00 PM" /></L>
            <L label="Price ($)"><input type="text" inputMode="decimal" style={st.input} value={editing.price ?? ""} onChange={(e) => set("price", e.target.value === "" ? null : parseFloat(e.target.value))} /></L>
            <L label="Capacity"><input type="number" style={st.input} value={editing.capacity ?? ""} onChange={(e) => set("capacity", e.target.value === "" ? null : parseInt(e.target.value))} /></L>
            <L label="Linked Event (optional)"><EventPicker value={editing.event_id ?? null} onChange={(id) => set("event_id", id)} /></L>
          </div>
          <L label="Public description (shown on the registration form)">
            <textarea style={st.textarea} value={editing.public_blurb ?? ""} onChange={(e) => set("public_blurb", e.target.value)} />
          </L>
          <label style={st.checkRow}><input type="checkbox" checked={!!editing.is_open} onChange={(e) => set("is_open", e.target.checked)} /> Open for registration</label>
          <div style={st.actions}>
            <button style={st.ghostBtn} onClick={() => setEditing(null)}>Cancel</button>
            <button style={st.primaryBtn} disabled={saving} onClick={save}><Save size={14} /> {saving ? "Saving…" : "Save camp"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.label}>{label}</label>{children}</div>;
}

/** Searchable picker for linking a camp to a calendar event (replaces the raw event-ID field). */
function EventPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [events, setEvents] = useState<TRCEvent[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { eventsApi.list().then((r) => setEvents(r.events)).catch(() => setEvents([])); }, []);

  const selected = value != null ? events.find((e) => e.id === value) ?? null : null;
  const q = query.trim().toLowerCase();
  const matches = (q
    ? events.filter((e) => `${e.name} ${e.event_date} ${e.location ?? ""} ${e.event_type ?? ""}`.toLowerCase().includes(q))
    : events
  ).slice(0, 8);

  // When an event is linked, show it as a removable chip rather than the search box.
  if (value != null) {
    return (
      <div style={ep.chip}>
        <Calendar size={13} style={{ flexShrink: 0, color: "#1565c0" }} />
        <span style={ep.chipText}>{selected ? `${selected.name} · ${selected.event_date}` : `Event #${value}`}</span>
        <button type="button" style={ep.chipX} title="Unlink event" onClick={() => { onChange(null); setQuery(""); }}><X size={14} /></button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={ep.searchWrap}>
        <Search size={14} style={{ color: "#94a3b8", flexShrink: 0 }} />
        <input
          style={ep.searchInput}
          value={query}
          placeholder="Search events by name, date, or location…"
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && (
        <div style={ep.dropdown}>
          {matches.length === 0 ? (
            <div style={ep.empty}>{events.length === 0 ? "No events found." : "No matches."}</div>
          ) : matches.map((e) => (
            <button
              key={e.id}
              type="button"
              style={ep.option}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => { onChange(e.id); setOpen(false); }}
            >
              <span style={ep.optName}>{e.name}</span>
              <span style={ep.optMeta}>{[e.event_date, e.location].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  head: { marginBottom: 14 },
  h1: { margin: 0, fontSize: 23, fontWeight: 800, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, marginTop: 4 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  muted: { color: "#888", fontSize: 14 },
  hint: { color: "#888", fontSize: 12, margin: "0 0 10px" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 14 },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 },
  cardTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  regPill: { fontSize: 11, fontWeight: 800, borderRadius: 12, padding: "3px 10px", letterSpacing: 0.4 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: 8 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "6px 0 3px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  textarea: { width: "100%", minHeight: 64, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, resize: "vertical", boxSizing: "border-box" },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: "6px 0" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  primaryBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  toggleBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  ghostBtn: { padding: "8px 14px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  progRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f4f6fa" },
  addRow: { display: "flex", gap: 8, marginTop: 10 },
  smallBtn: { padding: "4px 10px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12 },
  sessRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f0f4f8" },
  sessMeta: { fontSize: 12, color: "#778", marginTop: 2 },
  rowBtns: { display: "flex", alignItems: "center", gap: 6 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#1565c0", padding: 4, display: "flex" },
  openTag: { fontSize: 10, fontWeight: 800, color: "#2e7d32", background: "#e8f5e9", borderRadius: 8, padding: "1px 7px", marginLeft: 6 },
  closedTag: { fontSize: 10, fontWeight: 700, color: "#999", background: "#f1f1f1", borderRadius: 8, padding: "1px 7px", marginLeft: 6 },
  editor: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem", marginTop: 12 },
  editorHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  checkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#445", margin: "8px 0" },
};

const ep: Record<string, React.CSSProperties> = {
  chip: { display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 6, background: "#f1f6fb", fontSize: 13, boxSizing: "border-box" },
  chipText: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1a3a5c", fontWeight: 600 },
  chipX: { background: "none", border: "none", cursor: "pointer", color: "#778", padding: 2, display: "flex", flexShrink: 0 },
  searchWrap: { display: "flex", alignItems: "center", gap: 7, padding: "0 10px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", boxSizing: "border-box" },
  searchInput: { flex: 1, border: "none", outline: "none", padding: "8px 0", fontSize: 14, background: "transparent" },
  dropdown: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 260, overflowY: "auto", padding: 4 },
  option: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "7px 9px", borderRadius: 6, fontSize: 13 },
  optName: { fontWeight: 600, color: "#1a3a5c" },
  optMeta: { fontSize: 11, color: "#94a3b8" },
  empty: { padding: "10px 9px", fontSize: 13, color: "#94a3b8" },
};
