/**
 * SeasonPlanningBoard — night-first FLL planning.
 *
 * Stage 1: assign youth and mentors to a NIGHT (Tue/Thu). Each night shows the
 * mentors on it and, from the lead-capable YPT-clear ones, how many teams it can
 * support — so you size capacity before making teams. Stage 2: split a night's
 * youth into named teams (10 Challenge / 6 Explore). Mentors' night preferences
 * are visible and editable inline; waitlist youth appear in the pool, flagged.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSeasons, seasonOptions } from "../../../core/useSeasons";
import { currentSeasonLabel } from "../../../core/dateUtils";
import { seasonPlanningApi, type BoardData, type BoardPoolMember, type BoardTeam, type AvailableTeam } from "../api";
import { ArrowLeft, LayoutGrid, Wand2, Plus, X, Trash2, AlertTriangle, ShieldCheck, RefreshCw, Sparkles, Rocket, Users, EyeOff, Undo2, Search, ChevronDown, ChevronRight, Printer } from "lucide-react";

const PROGRAMS = [{ id: 2, label: "FLL Challenge" }, { id: 1, label: "FLL Explore" }];
const WILLING = [{ v: "lead", l: "Can lead" }, { v: "assist", l: "Can assist" }, { v: "admin", l: "Admin only" }, { v: "no", l: "Not helping" }];
type Pref = "preferred" | "ok" | "no";
const PREF_CYCLE: (Pref | "")[] = ["", "preferred", "ok", "no"];
const PREF_LABEL: Record<string, string> = { preferred: "Pref", ok: "OK", no: "No" };

/** Compact grade/age label for a youth (null for adults / no data), e.g. "5th grade · 10y" (#169). */
const gradeAge = (m: { grade?: string | null; age?: number | null }): string | null => {
  const parts: string[] = [];
  if (m.grade) parts.push(m.grade);
  if (m.age != null) parts.push(`${m.age}y`);
  return parts.length ? parts.join(" · ") : null;
};

export default function SeasonPlanningBoard() {
  const navigate = useNavigate();
  const seasons = useSeasons();
  const [season, setSeason] = useState(currentSeasonLabel());
  const [programId, setProgramId] = useState(2);
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolQuery, setPoolQuery] = useState("");
  const [mentorsCollapsed, setMentorsCollapsed] = useState(false);
  const [youthCollapsed, setYouthCollapsed] = useState(false);
  // Hidden people are the ones you've deliberately parked, so it starts folded away.
  const [hiddenCollapsed, setHiddenCollapsed] = useState(true);
  const [msg, setMsg] = useState("");
  const [availTeams, setAvailTeams] = useState<AvailableTeam[]>([]);
  const [addingNight, setAddingNight] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    seasonPlanningApi.board(season, programId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    seasonPlanningApi.availableTeams(season, programId).then(setAvailTeams).catch(() => setAvailTeams([]));
  }, [season, programId]);
  useEffect(() => { load(); }, [load]);

  // YPT lookup covers placed members too (pool carries everyone with a `placed` flag).
  const yptById = useMemo(() => {
    const m = new Map<number, boolean>();
    data?.pool.forEach((p) => m.set(p.member_id, !!p.ypt_ok));
    return m;
  }, [data]);
  const availById = useMemo(() => {
    const m = new Map<number, BoardPoolMember["availability"]>();
    data?.pool.forEach((p) => m.set(p.member_id, p.availability));
    return m;
  }, [data]);

  const teamMax = programId === 2 ? 10 : 6;
  const errText = (e: unknown, f: string) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? f;

  async function assign(memberId: number, nightId: number, role?: "lead" | "assist" | "youth") {
    try { await seasonPlanningApi.assignNight(season, programId, memberId, nightId, role); load(); }
    catch (e) { setMsg(errText(e, "Could not assign.")); }
  }
  async function toTeam(teamId: number, memberId: number, role: "lead" | "assist" | "youth") { await seasonPlanningApi.place(teamId, memberId, role); load(); }
  async function setWilling(memberId: number, willing: string) {
    await seasonPlanningApi.setAvailability(season, programId, memberId, { mentor_willing: willing || null }); load();
  }
  async function cyclePref(memberId: number, nightId: number) {
    const cur = (availById.get(memberId)?.night_prefs || {}) as Record<string, string>;
    const now = cur[nightId] ?? "";
    const next = PREF_CYCLE[(PREF_CYCLE.indexOf(now as Pref | "") + 1) % PREF_CYCLE.length];
    const prefs = { ...cur }; if (next === "") delete prefs[nightId]; else prefs[nightId] = next;
    await seasonPlanningApi.setAvailability(season, programId, memberId, { night_prefs: prefs as Record<string, Pref> }); load();
  }
  // Add a team to a night. Prefer LINKING to an existing team page (so Publish can write
  // its roster); fall back to a free-form, unlinked bucket for a brand-new team.
  async function addExisting(nightId: number, t: AvailableTeam) {
    setAddingNight(null);
    await seasonPlanningApi.addTeam(season, programId, nightId, t.label || `#${t.team_number}`, t.team_id); load();
  }
  async function addNewUnlinked(nightId: number) {
    setAddingNight(null);
    const label = window.prompt("New team name (not linked to a team page — create the team page later to publish it):", "New Team");
    if (label == null) return;
    await seasonPlanningApi.addTeam(season, programId, nightId, label || "New Team", null); load();
  }
  async function renameTeam(t: BoardTeam) { const l = window.prompt("Team name?", t.label); if (l != null) { await seasonPlanningApi.updateTeam(t.id, { label: l }); load(); } }
  async function delTeam(t: BoardTeam) { if (window.confirm("Delete this team? Members return to the night's pool.")) { for (const p of t.placements) await seasonPlanningApi.assignNight(season, programId, p.member_id, t.night_id, p.role as "lead" | "assist" | "youth"); await seasonPlanningApi.deleteTeam(t.id); load(); } }
  async function seed() {
    setMsg("");
    try { const r = await seasonPlanningApi.seedBoard(season, programId); setMsg(r.source === "current" ? `Prepopulated ${r.teams_created} team(s) already rostered for ${r.from_season}.` : `Carried forward ${r.teams_created} team(s) from ${r.from_season}.`); load(); }
    catch (e) { setMsg(errText(e, "Could not seed.")); }
  }
  async function suggest() {
    setMsg("");
    try { const r = await seasonPlanningApi.suggest(season, programId); setMsg(`Auto-suggest placed ${r.youth_placed} student(s) and ${r.adults_placed} mentor(s) into existing teams.`); load(); }
    catch (e) { setMsg(errText(e, "Could not auto-suggest.")); }
  }
  async function publish() {
    if (!window.confirm("Publish to the team rosters? Writes each team's students and coaches onto its existing team page for this season.")) return;
    setMsg("");
    try { const r = await seasonPlanningApi.publish(season, programId); setMsg(`Published ${r.members_written} member(s) across ${r.teams_written} team(s).` + (r.unmapped.length ? ` Skipped (no linked team page): ${r.unmapped.join(", ")}.` : "")); load(); }
    catch (e) { setMsg(errText(e, "Could not publish.")); }
  }

  if (loading || !data) return <div style={{ padding: "2rem", color: "#888" }}>Loading…</div>;

  const nights = data.nights;
  const pool = data.pool.filter((p) => !p.placed);
  const q = poolQuery.trim().toLowerCase();
  const match = (p: BoardPoolMember) => !q || p.name.toLowerCase().includes(q);
  const poolMentors = pool.filter((p) => p.is_guardian && match(p));
  const poolYouth = pool.filter((p) => !p.is_guardian && match(p));
  const hidden = data.hidden ?? [];
  async function hideMentor(memberId: number, name: string) {
    if (!window.confirm(`Always hide ${name} from the planning board? They'll stay off it until you restore them.`)) return;
    await seasonPlanningApi.hideMentor(memberId); load();
  }
  async function unhideMentor(memberId: number) { await seasonPlanningApi.unhideMentor(memberId); load(); }

  // Printable rosters: night → team → coaches (lead/assist) + students. Opens a clean
  // print window built from the current board (no server round-trip).
  function printRosters() {
    if (!data) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    const progName = PROGRAMS.find((p) => p.id === programId)?.label ?? "FLL";
    let body = "";
    for (const n of data.nights) {
      const teams = data.teams.filter((t) => t.night_id === n.id && !t.is_holding);
      if (teams.length === 0) continue;
      body += `<h2>${esc(n.name)}</h2>`;
      for (const t of teams) {
        const coaches = t.placements.filter((p) => p.is_guardian);
        const students = t.placements.filter((p) => !p.is_guardian);
        body += `<div class="team"><h3>${esc(t.label)} <span class="cnt">(${students.length} student${students.length === 1 ? "" : "s"})</span></h3>`;
        body += `<p class="coaches"><strong>Coaches:</strong> ${coaches.length ? coaches.map((c) => `${esc(c.name)} <em>(${esc(c.role)})</em>`).join(", ") : "<em>none assigned</em>"}</p>`;
        body += "<ol>" + (students.length ? students.map((sx) => `<li>${esc(sx.name)}</li>`).join("") : "<li><em>no students yet</em></li>") + "</ol></div>";
      }
    }
    if (!body) body = "<p>No teams have been created yet.</p>";
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(progName)} Rosters — ${esc(season)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#1a3a5c;max-width:760px;margin:24px auto;padding:0 16px}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#667;font-size:13px;margin:0 0 18px}
        h2{font-size:16px;border-bottom:2px solid #1a3a5c;padding-bottom:4px;margin:22px 0 8px}
        .team{border:1px solid #cdd7e3;border-radius:8px;padding:8px 14px;margin:0 0 10px;break-inside:avoid}
        h3{font-size:14px;margin:2px 0} .cnt{color:#778;font-weight:400;font-size:12px}
        .coaches{font-size:13px;margin:2px 0 6px;color:#334} ol{margin:4px 0 4px 22px;font-size:13px} li{margin:1px 0}
        @media print{ .noprint{display:none} body{margin:0} }
      </style></head><body>
      <h1>${esc(progName)} — Team Rosters</h1><p class="sub">Season ${esc(season)} · planning draft</p>
      ${body}
      <p class="noprint" style="margin-top:20px"><button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">Print</button></p>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(doc); w.document.close(); }
  }
  const bucketsOn = (nid: number) => data.teams.filter((t) => t.night_id === nid);
  const holdingOf = (nid: number) => bucketsOn(nid).find((t) => t.is_holding);
  const realTeamsOn = (nid: number) => bucketsOn(nid).filter((t) => !t.is_holding);
  const placementsOn = (nid: number) => bucketsOn(nid).flatMap((t) => t.placements);

  function nightStats(nid: number, maxTeams: number | null) {
    const pl = placementsOn(nid);
    const youth = pl.filter((p) => !p.is_guardian).length;
    const mentors = pl.filter((p) => p.is_guardian);
    const leads = mentors.filter((p) => p.role === "lead" && yptById.get(p.member_id)).length;
    const supports = maxTeams != null ? Math.min(maxTeams, leads) : leads;
    return { youth, mentors: mentors.length, leads, supports };
  }
  function prefChip(m: BoardPoolMember, nid: number) {
    const p = (m.availability?.night_prefs || {})[nid] as string | undefined;
    return <button key={nid} style={{ ...s.prefBtn, ...(p === "preferred" ? s.prefPref : p === "ok" ? s.prefOk : p === "no" ? s.prefNo : {}) }}
      onClick={() => cyclePref(m.member_id, nid)} title="Click to set this mentor's preference for this night">
      {nights.find((n) => n.id === nid)?.name.slice(0, 3)}: {p ? PREF_LABEL[p] : "—"}</button>;
  }
  const youthPref = (m: BoardPoolMember, nid: number): Pref | undefined => (m.availability?.night_prefs || {})[nid] as Pref | undefined;
  // Colour a night button by the member's stated preference: green = good/preferred,
  // blue = works (no strong preference), red = can't. Neutral when no guidance given.
  const prefStyle = (p?: string): React.CSSProperties =>
    p === "preferred" ? s.assignPref : p === "ok" ? s.assignOk : p === "no" ? s.assignNo : {};

  return (
    <div>
      <button style={s.back} onClick={() => navigate("/season-planning")}><ArrowLeft size={14} /> Season Planning</button>
      <div style={s.head}>
        <h1 style={s.heading}><LayoutGrid size={22} style={{ verticalAlign: -4 }} /> Planning Board</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={s.ghost} onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button style={s.seedBtn} onClick={seed}><Wand2 size={14} /> Seed from last season</button>
          <button style={s.suggestBtn} onClick={suggest}><Sparkles size={14} /> Auto-suggest</button>
          <button style={s.ghost} onClick={printRosters}><Printer size={14} /> Print rosters</button>
          <button style={s.publishBtn} onClick={publish}><Rocket size={14} /> Publish to teams</button>
        </div>
      </div>
      <div style={s.pickers}>
        <select style={s.select} value={season} onChange={(e) => setSeason(e.target.value)}>{seasonOptions(seasons, season).map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select style={s.select} value={programId} onChange={(e) => setProgramId(Number(e.target.value))}>{PROGRAMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </div>
      {msg && <div style={s.msg}>{msg}</div>}

      {nights.length === 0 ? (
        <p style={s.muted}>No nights yet. Add nights on the <button style={s.link} onClick={() => navigate("/season-planning")}>Season Planning</button> page first.</p>
      ) : (
      <div style={s.layout}>
        {/* Pool */}
        <div style={s.pool}>
          <div style={s.legend}>
            <span><span style={{ ...s.legendDot, background: "#e6f4ea", borderColor: "#66bb6a" }} />Preferred</span>
            <span><span style={{ ...s.legendDot, background: "#e7f1fb", borderColor: "#64b5f6" }} />Works</span>
            <span><span style={{ ...s.legendDot, background: "#fdf1f1", borderColor: "#ef9a9a" }} />Can't</span>
            <span><span style={{ ...s.legendDot, background: "#fff", borderColor: "#cdd7e3" }} />No response</span>
          </div>
          <div style={s.searchWrap}>
            <Search size={14} style={{ position: "absolute", left: 8, top: 8, color: "#94a3b8" }} />
            <input style={s.search} placeholder="Search by name…" value={poolQuery}
              onChange={(e) => setPoolQuery(e.target.value)} />
            {poolQuery && <button style={s.searchClear} title="Clear" onClick={() => setPoolQuery("")}><X size={12} /></button>}
          </div>
          <button style={s.collapseHead} onClick={() => setMentorsCollapsed((v) => !v)}>
            {mentorsCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <Users size={13} /> Mentors ({poolMentors.length})
          </button>
          {!mentorsCollapsed && poolMentors.length === 0 && <p style={s.tiny}>{q ? "No mentors match." : "All mentors placed."}</p>}
          {!mentorsCollapsed && poolMentors.map((m) => (
            <div key={m.member_id} style={s.mCard}>
              <div style={s.chipName}>
                {m.name} {m.ypt_ok ? <ShieldCheck size={12} color="#2e7d32" style={{ verticalAlign: -2 }} /> : <span title="Not YPT/background compliant" style={s.noYpt}>no YPT</span>}
                <button style={s.hideBtn} title="Always hide this person from the board" onClick={() => hideMentor(m.member_id, m.name)}><EyeOff size={12} /></button>
              </div>
              <select style={s.willSel} value={m.availability?.mentor_willing ?? ""} onChange={(e) => setWilling(m.member_id, e.target.value)}>
                <option value="">Willing? —</option>
                {WILLING.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}
              </select>
              <div style={s.prefRow}>{nights.map((n) => prefChip(m, n.id))}</div>
              <div style={s.assignRow}>{nights.map((n) => {
                const pr = youthPref(m, n.id);
                return <button key={n.id} style={{ ...s.assignBtn, ...prefStyle(pr) }}
                  title={pr ? `Said "${PREF_LABEL[pr] ?? pr}" for ${n.name}` : `No preference given for ${n.name}`}
                  onClick={() => assign(m.member_id, n.id, m.availability?.mentor_willing === "lead" ? "lead" : "assist")}>→ {n.name}</button>;
              })}</div>
            </div>
          ))}
          <button style={{ ...s.collapseHead, marginTop: 14 }} onClick={() => setYouthCollapsed((v) => !v)}>
            {youthCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            Youth ({poolYouth.length})
          </button>
          {!youthCollapsed && poolYouth.length === 0 && <p style={s.tiny}>{q ? "No youth match." : "All youth placed 🎉"}</p>}
          {!youthCollapsed && poolYouth.map((m) => (
            <div key={m.member_id} style={s.yCard}>
              <div style={s.chipName}>{m.name}{gradeAge(m) && <span style={s.gradeTag} title="Grade / age (on Jan 1)">{gradeAge(m)}</span>} {m.is_waitlist && <span style={s.wl} title="On the waitlist">waitlist</span>}</div>
              <div style={s.assignRow}>{nights.map((n) => {
                const pr = youthPref(m, n.id);
                return <button key={n.id} style={{ ...s.assignBtn, ...prefStyle(pr) }}
                  title={pr ? `Said "${PREF_LABEL[pr] ?? pr}" for ${n.name}` : `No preference given for ${n.name}`} onClick={() => assign(m.member_id, n.id, "youth")}>→ {n.name}</button>;
              })}</div>
            </div>
          ))}
          {hidden.length > 0 && (
            <div style={s.hiddenBox}>
              <button style={s.hiddenToggle} onClick={() => setHiddenCollapsed((v) => !v)}>
                {hiddenCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <EyeOff size={12} /> Hidden ({hidden.length})
              </button>
              {!hiddenCollapsed && hidden.map((h) => (
                <div key={h.member_id} style={s.hiddenRow}>
                  <span style={{ color: "#64748b" }}>{h.name}</span>
                  <button style={s.unhideBtn} onClick={() => unhideMentor(h.member_id)}><Undo2 size={11} /> Show</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Night columns */}
        <div style={s.nights}>
          {nights.map((n) => {
            const st = nightStats(n.id, n.max_teams);
            const holding = holdingOf(n.id);
            const teams = realTeamsOn(n.id);
            const overCap = n.capacity > 0 && st.youth > n.capacity;
            return (
              <div key={n.id} style={s.col}>
                <div style={s.colHead}>
                  <span style={s.colTitle}>{n.name}</span>
                  <span style={{ ...s.meter, ...(overCap ? s.meterBad : {}) }}>{st.youth}/{n.capacity || "∞"} youth</span>
                  <span style={s.meter}>{st.mentors} mentor{st.mentors === 1 ? "" : "s"}</span>
                  <span style={{ ...s.meter, ...s.meterGood }} title="Teams this night can support = lead-capable, YPT-clear mentors on it">supports {st.supports}{n.max_teams != null ? `/${n.max_teams}` : ""} team{st.supports === 1 ? "" : "s"}</span>
                </div>

                {/* Mentors on night — holding (assignable to a team) shown here; those
                    already on a team appear under their team below. */}
                <div style={s.subHead}>Mentors</div>
                {(holding?.placements.filter((p) => p.is_guardian).length ?? 0) === 0 && teams.every((t) => t.placements.filter((p) => p.is_guardian).length === 0)
                  && <div style={s.emptyRow}>No mentors yet — assign from the left.</div>}
                {(holding?.placements.filter((p) => p.is_guardian) ?? []).map((p) => (
                  <div key={p.member_id} style={{ ...s.chip, ...s.chipAdult }}>
                    <span style={{ flex: 1 }}>{p.name} <span style={s.roleTag}>{p.role}</span> {yptById.get(p.member_id) ? <ShieldCheck size={11} color="#2e7d32" style={{ verticalAlign: -1 }} /> : <span style={s.noYptSm}>no YPT</span>}</span>
                    {teams.length > 0 && (
                      <select style={s.teamSel} defaultValue="" title="Assign to a team (as lead or assistant)"
                        onChange={(e) => { const v = e.target.value; if (v) { const [tid, role] = v.split(":"); toTeam(Number(tid), p.member_id, role as "lead" | "assist"); } }}>
                        <option value="">→ team…</option>
                        {teams.flatMap((t) => [
                          <option key={`${t.id}:lead`} value={`${t.id}:lead`}>→ {t.label} (lead)</option>,
                          <option key={`${t.id}:assist`} value={`${t.id}:assist`}>→ {t.label} (assist)</option>,
                        ])}
                      </select>
                    )}
                    <button style={s.rm} title="Back to pool" onClick={() => assign(p.member_id, 0)}><X size={12} /></button>
                  </div>
                ))}

                {/* Youth waiting to be teamed (holding) */}
                <div style={s.subHead}>On this night {holding && <span style={s.subCount}>({holding.placements.filter((p) => !p.is_guardian).length})</span>}</div>
                {(holding?.placements.filter((p) => !p.is_guardian).length ?? 0) === 0 && <div style={s.emptyRow}>Drop youth here to plan this night.</div>}
                {holding?.placements.filter((p) => !p.is_guardian).map((p) => (
                  <div key={p.member_id} style={s.chip}>
                    <span style={{ flex: 1 }}>{p.name}{gradeAge(p) && <span style={s.gradeTag}>{gradeAge(p)}</span>}</span>
                    {teams.length > 0 && (
                      <select style={s.teamSel} defaultValue="" onChange={(e) => { if (e.target.value) toTeam(Number(e.target.value), p.member_id, "youth"); }} title="Move into a team">
                        <option value="">→ team…</option>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    )}
                    <button style={s.rm} title="Back to pool" onClick={() => assign(p.member_id, 0)}><X size={12} /></button>
                  </div>
                ))}

                {/* Teams (stage 2) */}
                <div style={s.subHead}>Teams</div>
                {teams.map((t) => {
                  const ty = t.placements.filter((p) => !p.is_guardian).length;
                  const over = ty > teamMax;
                  const leadOk = t.placements.some((p) => p.role === "lead" && yptById.get(p.member_id));
                  return (
                    <div key={t.id} style={s.team}>
                      <div style={s.teamHead}>
                        <span style={s.teamName} onClick={() => renameTeam(t)} title="Rename">{t.label}</span>
                        <span style={{ ...s.teamCount, ...(over ? s.badText : {}) }}>{ty}/{teamMax}</span>
                        <button style={s.rm} onClick={() => delTeam(t)} title="Delete team"><Trash2 size={12} /></button>
                      </div>
                      {t.placements.map((p) => (
                        <div key={p.member_id} style={{ ...s.chip, ...(p.is_guardian ? s.chipAdult : {}), marginLeft: 4 }}>
                          <span style={{ flex: 1 }}>{p.name}{gradeAge(p) && <span style={s.gradeTag}>{gradeAge(p)}</span>}{p.is_guardian && <span style={s.roleTag}>{p.role}</span>}</span>
                          <button style={s.rm} title="Back to night pool" onClick={() => assign(p.member_id, n.id, p.role as "lead" | "assist" | "youth")}><X size={12} /></button>
                        </div>
                      ))}
                      {ty > 0 && !leadOk && <div style={s.flag}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> No YPT-compliant lead</div>}
                      {over && <div style={s.flag}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> Over team size ({ty}/{teamMax})</div>}
                    </div>
                  );
                })}
                {addingNight === n.id ? (
                  <div style={s.addPicker}>
                    <select style={s.addSelect} defaultValue="" autoFocus
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new__") addNewUnlinked(n.id);
                        else if (v) { const t = availTeams.find((a) => a.team_id === Number(v)); if (t) addExisting(n.id, t); }
                      }}>
                      <option value="" disabled>— Link an existing team —</option>
                      {availTeams.filter((a) => !a.on_board).map((a) => <option key={a.team_id} value={a.team_id}>{a.label}</option>)}
                      <option value="__new__">➕ New team (not linked)…</option>
                    </select>
                    <button style={s.addCancel} onClick={() => setAddingNight(null)}>Cancel</button>
                  </div>
                ) : (
                  <button style={s.addTeam} onClick={() => setAddingNight(n.id)}><Plus size={13} /> Add team to {n.name}</button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 8, padding: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  ghost: { display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  seedBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "none", background: "#6a1b9a", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  suggestBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "none", background: "#0277bd", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  publishBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", border: "none", background: "#2e7d32", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  pickers: { display: "flex", gap: 10, margin: "12px 0" },
  select: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14 },
  msg: { background: "#f3e5f5", border: "1px solid #ce93d8", color: "#6a1b9a", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 12 },
  muted: { color: "#889", fontSize: 14, padding: "1rem 0" },
  tiny: { color: "#98a3b0", fontSize: 11.5, margin: "2px 0 6px" },
  link: { background: "none", border: "none", color: "#1565c0", textDecoration: "underline", cursor: "pointer", fontSize: 14, padding: 0 },
  layout: { display: "flex", gap: 14, alignItems: "flex-start" },
  pool: { width: 288, flexShrink: 0, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, maxHeight: "80vh", overflowY: "auto" },
  poolHead: { fontSize: 12, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 },
  mCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 9px", marginBottom: 7 },
  yCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 9px", marginBottom: 6 },
  chipName: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 5 },
  noYpt: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#c62828", borderRadius: 4, padding: "0 4px" },
  hideBtn: { marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, border: "1px solid #e2e8f0", background: "#fff", color: "#94a3b8", borderRadius: 5, cursor: "pointer", flexShrink: 0 },
  searchWrap: { position: "relative", marginBottom: 10 },
  search: { width: "100%", padding: "6px 26px 6px 28px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, boxSizing: "border-box", background: "#fff" },
  searchClear: { position: "absolute", right: 6, top: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, border: "none", background: "none", color: "#94a3b8", cursor: "pointer" },
  hiddenToggle: { display: "flex", alignItems: "center", gap: 5, width: "100%", textAlign: "left" as const, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.3 },
  collapseHead: { display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 8 },
  hiddenBox: { marginTop: 14, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 },
  hiddenHead: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 6 },
  hiddenRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5 },
  unhideBtn: { display: "inline-flex", alignItems: "center", gap: 3, padding: "3px 8px", border: "1px solid #cdd7e3", background: "#fff", color: "#1565c0", borderRadius: 5, cursor: "pointer", fontSize: 11.5 },
  noYptSm: { fontSize: 8.5, fontWeight: 700, color: "#fff", background: "#c62828", borderRadius: 3, padding: "0 3px" },
  wl: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#b26a00", borderRadius: 4, padding: "0 4px", marginLeft: 4 },
  gradeTag: { fontSize: 10, fontWeight: 700, color: "#1565c0", background: "#e7f0fb", borderRadius: 4, padding: "0 5px", marginLeft: 6, whiteSpace: "nowrap" },
  willSel: { width: "100%", marginTop: 5, padding: "4px 6px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 11.5 },
  prefRow: { display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" },
  prefBtn: { fontSize: 10, fontWeight: 700, border: "1px solid #dbe3ec", background: "#fff", color: "#889", borderRadius: 5, padding: "2px 6px", cursor: "pointer" },
  prefPref: { background: "#e8f5e9", color: "#2e7d32", borderColor: "#a5d6a7" },
  prefOk: { background: "#eef4fb", color: "#1565c0", borderColor: "#b3d1ee" },
  prefNo: { background: "#ffebee", color: "#c62828", borderColor: "#ef9a9a" },
  assignRow: { display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" },
  assignBtn: { fontSize: 11, fontWeight: 700, border: "1px solid #cdd7e3", background: "#fff", color: "#1a3a5c", borderRadius: 5, padding: "3px 8px", cursor: "pointer" },
  assignPref: { borderColor: "#66bb6a", background: "#e6f4ea", color: "#1b5e20" },   // green — good/preferred night
  assignOk: { borderColor: "#64b5f6", background: "#e7f1fb", color: "#0d47a1" },     // blue — works, no strong preference
  assignNo: { borderColor: "#ef9a9a", background: "#fdf1f1", color: "#c62828" },     // red — can't do this night
  legend: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "#556", margin: "0 0 8px" },
  legendDot: { display: "inline-block", width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, border: "1px solid" },
  nights: { flex: 1, display: "flex", gap: 12, overflowX: "auto" },
  col: { minWidth: 250, flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 10 },
  colHead: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 },
  colTitle: { fontSize: 16, fontWeight: 800, color: "#1a3a5c", flex: 1 },
  meter: { fontSize: 10.5, fontWeight: 700, color: "#556", background: "#eef2f7", borderRadius: 8, padding: "2px 7px" },
  meterBad: { background: "#ffebee", color: "#c62828" },
  meterGood: { background: "#e8f5e9", color: "#2e7d32" },
  subHead: { fontSize: 10.5, fontWeight: 800, color: "#8494a6", textTransform: "uppercase", letterSpacing: 0.4, margin: "10px 0 5px", borderTop: "1px solid #f0f4f8", paddingTop: 7 },
  subCount: { color: "#556" },
  emptyRow: { fontSize: 11, color: "#aab", fontStyle: "italic", padding: "3px 0" },
  chip: { display: "flex", alignItems: "center", gap: 5, background: "#eef4fb", borderRadius: 6, padding: "5px 8px", marginBottom: 4, fontSize: 12.5, color: "#1a3a5c" },
  chipAdult: { background: "#e8f5e9" },
  roleTag: { fontSize: 9, fontWeight: 700, color: "#fff", background: "#2e7d32", borderRadius: 4, padding: "0 5px", marginLeft: 5, textTransform: "uppercase" },
  rm: { background: "none", border: "none", cursor: "pointer", color: "#889", display: "flex", padding: 0 },
  teamSel: { fontSize: 10.5, border: "1px solid #cdd7e3", borderRadius: 5, padding: "2px 4px" },
  team: { border: "1px solid #dbe3ec", borderRadius: 8, padding: 7, marginBottom: 7, background: "#fbfcfe" },
  teamHead: { display: "flex", alignItems: "center", gap: 6, marginBottom: 5 },
  teamName: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", flex: 1, cursor: "pointer" },
  teamCount: { fontSize: 10.5, fontWeight: 700, color: "#667" },
  badText: { color: "#c62828" },
  flag: { fontSize: 10.5, color: "#c62828", fontWeight: 600, marginTop: 3 },
  addTeam: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px", background: "#fff", border: "1px dashed #cdd7e3", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#556", fontWeight: 600, marginTop: 4 },
  addPicker: { display: "flex", gap: 5, marginTop: 4, alignItems: "center" },
  addSelect: { flex: 1, minWidth: 0, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 12, background: "#fff", cursor: "pointer" },
  addCancel: { padding: "6px 9px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", fontSize: 11.5, color: "#778" },
};
