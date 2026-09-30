/**
 * BulkRecipientBuilder — assemble a large recipient list from groups + individuals.
 *  • Teams: pick a team, then include any of members / parents / mentors.
 *  • Programs: same, scoped to a program's enrollment.
 *  • Org-wide: all mentors / youth / parents / volunteers.
 *  • Individuals: search by name and add.
 * "Preview recipients" resolves everything server-side (deduped by email) and
 * reports the final list + how many were skipped for having no email.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "../../../core/api";
import { useAuth } from "../../../core/AuthContext";
import { commsApi, type RecipientSelectors, type ResolvedRecipient } from "../api";
import { Search, X, Plus, Users, RefreshCw, AlertTriangle } from "lucide-react";

// #179 — target families by this season's enrollment compliance status.
const COMPLIANCE_OPTS = [
  { key: "not_registered", label: "Not re-registered (registration still pending)" },
  { key: "tc_incomplete", label: "Terms & Conditions not signed" },
  { key: "unpaid", label: "Unpaid / partial balance" },
  { key: "payment_plan", label: "On a payment plan / fee override" },
];

type TeamSel = { team_season_id: number; label: string; members: boolean; parents: boolean; mentors: boolean };
type ProgSel = { program_id: number; label: string; members: boolean; parents: boolean; mentors: boolean };
type Indiv = { id: number; name: string; email?: string };

const ORG_OPTS = [
  { key: "mentors", label: "All mentors" },
  { key: "youth", label: "All youth" },
  { key: "parents", label: "All parents/guardians" },
  { key: "volunteers", label: "All volunteers" },
];

export default function BulkRecipientBuilder({ onResolved, category, onCategoryChange }: {
  onResolved: (r: ResolvedRecipient[]) => void;
  category: string;
  onCategoryChange: (c: string) => void;
}) {
  const [teamOpts, setTeamOpts] = useState<{ id: number; label: string }[]>([]);
  const [progOpts, setProgOpts] = useState<{ id: number; name: string }[]>([]);

  const { isAdmin } = useAuth();
  const canCompliance = isAdmin; // Admin / System Administrator only — exposes who owes / hasn't re-registered

  const [teams, setTeams] = useState<TeamSel[]>([]);
  const [progs, setProgs] = useState<ProgSel[]>([]);
  const [org, setOrg] = useState<string[]>([]);
  const [compliance, setCompliance] = useState<string[]>([]);
  const [individuals, setIndividuals] = useState<Indiv[]>([]);
  // Visitors (prospective inquiries): all not-yet-converted, optionally filtered by status/program.
  const [visStatuses, setVisStatuses] = useState<{ code: string; label: string }[]>([]);
  const [visSel, setVisSel] = useState<string[]>([]);
  const [visAll, setVisAll] = useState(false);
  const [visProgram, setVisProgram] = useState("");
  const [visFrom, setVisFrom] = useState("");
  const [visTo, setVisTo] = useState("");
  // Mailing-list subscribers (volunteers/newsletter contacts with no account).
  const [mailingList, setMailingList] = useState(false);
  // Off by default: inactive member accounts are dropped from every audience.
  const [includeInactive, setIncludeInactive] = useState(false);
  // Optional comm category — members who opted out of it are dropped from the send.
  const [catTypes, setCatTypes] = useState<string[]>([]);
  const [skippedOptout, setSkippedOptout] = useState(0);

  // pickers
  const [teamPick, setTeamPick] = useState("");
  const [progPick, setProgPick] = useState("");
  const [search, setSearch] = useState("");
  const [searchRes, setSearchRes] = useState<Indiv[]>([]);

  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedRecipient[] | null>(null);
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    api.get("/api/v1/comms/team-seasons").then(({ data }) => {
      setTeamOpts((data as { team_season_id: number; team_number: string; season: string; team_name?: string }[])
        .map(t => ({ id: t.team_season_id, label: `${t.team_number}${t.team_name ? " · " + t.team_name : ""}${t.season ? " (" + t.season + ")" : ""}` })));
    }).catch(() => {});
    api.get("/api/v1/programs/").then(({ data }) => setProgOpts((data as { id: number; name: string }[]).map(p => ({ id: p.id, name: p.name })))).catch(() => {});
    api.get("/api/v1/visitors/statuses").then(({ data }) => setVisStatuses(data as { code: string; label: string }[])).catch(() => {});
    commsApi.preferenceTypes().then(setCatTypes).catch(() => {});
  }, []);

  function addTeam() {
    const opt = teamOpts.find(t => String(t.id) === teamPick);
    if (!opt || teams.some(t => t.team_season_id === opt.id)) return;
    setTeams(ts => [...ts, { team_season_id: opt.id, label: opt.label, members: true, parents: true, mentors: true }]);
    setTeamPick(""); setResolved(null);
  }
  function addProg() {
    const opt = progOpts.find(p => String(p.id) === progPick);
    if (!opt || progs.some(p => p.program_id === opt.id)) return;
    setProgs(ps => [...ps, { program_id: opt.id, label: opt.name, members: true, parents: true, mentors: true }]);
    setProgPick(""); setResolved(null);
  }
  async function doSearch() {
    if (!search.trim()) return;
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search)}&is_active=true&limit=12`);
    setSearchRes((data.members as { id: number; first_name: string; last_name: string; email?: string }[])
      .map(m => ({ id: m.id, name: `${m.first_name} ${m.last_name}`, email: m.email })));
  }
  function addIndiv(i: Indiv) {
    if (!individuals.some(x => x.id === i.id)) setIndividuals(xs => [...xs, i]);
    setSearch(""); setSearchRes([]); setResolved(null);
  }

  const visitorSel = visAll || visSel.length > 0 || visProgram || visFrom || visTo
    ? {
        all: visAll,
        statuses: visAll ? [] : visSel,
        ...(visProgram ? { program_id: parseInt(visProgram) } : {}),
        ...(visFrom ? { from_date: visFrom } : {}),
        ...(visTo ? { to_date: visTo } : {}),
      }
    : undefined;
  const selectors: RecipientSelectors = {
    teams: teams.map(t => ({ team_season_id: t.team_season_id, members: t.members, parents: t.parents, mentors: t.mentors })),
    programs: progs.map(p => ({ program_id: p.program_id, members: p.members, parents: p.parents, mentors: p.mentors })),
    org,
    individuals: individuals.map(i => i.id),
    ...(canCompliance && compliance.length ? { compliance } : {}),
    ...(visitorSel ? { visitors: visitorSel } : {}),
    ...(mailingList ? { mailing_list: true } : {}),
    ...(includeInactive ? { include_inactive: true } : {}),
    ...(category ? { category } : {}),
  };
  const hasAny = teams.length || progs.length || org.length || individuals.length
    || (canCompliance && compliance.length) || !!visitorSel || mailingList;

  const resolve = useCallback(async () => {
    if (!hasAny) { setResolved([]); setSkipped(0); onResolved([]); return; }
    setResolving(true);
    try {
      const r = await commsApi.resolveRecipients(selectors);
      setResolved(r.recipients); setSkipped(r.skipped_no_email); setSkippedOptout(r.skipped_optout ?? 0); onResolved(r.recipients);
    } finally { setResolving(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(selectors), hasAny]);

  // Any change invalidates the resolved preview.
  useEffect(() => { setResolved(null); onResolved([]); /* eslint-disable-next-line */ }, [JSON.stringify(selectors)]);

  const kindCounts = resolved ? resolved.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a; }, {} as Record<string, number>) : {};

  return (
    <div style={st.wrap}>
      {/* Teams */}
      <Section title="Teams">
        <div style={st.row}>
          <select style={st.input} value={teamPick} onChange={e => setTeamPick(e.target.value)}>
            <option value="">— pick a team —</option>
            {teamOpts.filter(o => !teams.some(t => t.team_season_id === o.id)).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" style={st.addBtn} disabled={!teamPick} onClick={addTeam}><Plus size={13} /></button>
        </div>
        {teams.map((t, i) => (
          <div key={t.team_season_id} style={st.chip}>
            <div style={st.chipHead}><strong>{t.label}</strong><button type="button" style={st.x} onClick={() => { setTeams(xs => xs.filter((_, j) => j !== i)); }}><X size={13} /></button></div>
            <div style={st.toggles}>
              {(["members", "parents", "mentors"] as const).map(k => (
                <label key={k} style={st.tog}><input type="checkbox" checked={t[k]} onChange={e => setTeams(xs => xs.map((x, j) => j === i ? { ...x, [k]: e.target.checked } : x))} /> {k}</label>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* Programs */}
      <Section title="By program">
        <div style={st.row}>
          <select style={st.input} value={progPick} onChange={e => setProgPick(e.target.value)}>
            <option value="">— pick a program —</option>
            {progOpts.filter(o => !progs.some(p => p.program_id === o.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="button" style={st.addBtn} disabled={!progPick} onClick={addProg}><Plus size={13} /></button>
        </div>
        {progs.map((p, i) => (
          <div key={p.program_id} style={st.chip}>
            <div style={st.chipHead}><strong>{p.label}</strong><button type="button" style={st.x} onClick={() => setProgs(xs => xs.filter((_, j) => j !== i))}><X size={13} /></button></div>
            <div style={st.toggles}>
              {(["members", "parents", "mentors"] as const).map(k => (
                <label key={k} style={st.tog}><input type="checkbox" checked={p[k]} onChange={e => setProgs(xs => xs.map((x, j) => j === i ? { ...x, [k]: e.target.checked } : x))} /> {k}</label>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* Org-wide */}
      <Section title="Everyone (org-wide)">
        <div style={st.orgGrid}>
          {ORG_OPTS.map(o => (
            <label key={o.key} style={st.tog}>
              <input type="checkbox" checked={org.includes(o.key)} onChange={e => setOrg(xs => e.target.checked ? [...xs, o.key] : xs.filter(x => x !== o.key))} /> {o.label}
            </label>
          ))}
        </div>
      </Section>

      {/* Compliance groups (#179) — finance.view only */}
      {canCompliance && (
        <Section title="Compliance status (this season)">
          <div style={st.orgGrid}>
            {COMPLIANCE_OPTS.map(o => (
              <label key={o.key} style={st.tog}>
                <input type="checkbox" checked={compliance.includes(o.key)}
                  onChange={e => { setCompliance(xs => e.target.checked ? [...xs, o.key] : xs.filter(x => x !== o.key)); setResolved(null); }} /> {o.label}
              </label>
            ))}
          </div>
          <div style={st.compHint}>Reaches enrolled youth's guardians (and any adult enrollees) whose registration matches. Guardians of youth are emailed.</div>
        </Section>
      )}

      {/* Visitors (prospective inquiries) */}
      <Section title="Visitors (prospective)">
        <label style={st.tog}>
          <input type="checkbox" checked={visAll} onChange={e => { setVisAll(e.target.checked); setResolved(null); }} />
          All current visitors (not yet converted)
        </label>
        {!visAll && (
          <div style={st.orgGrid}>
            {visStatuses.map(s => (
              <label key={s.code} style={st.tog}>
                <input type="checkbox" checked={visSel.includes(s.code)}
                  onChange={e => { setVisSel(xs => e.target.checked ? [...xs, s.code] : xs.filter(x => x !== s.code)); setResolved(null); }} /> {s.label}
              </label>
            ))}
          </div>
        )}
        <div style={st.row}>
          <select style={st.input} value={visProgram} onChange={e => { setVisProgram(e.target.value); setResolved(null); }}>
            <option value="">Any program interest</option>
            {progOpts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        {/* Visited between — first contact or any logged interaction in the window. */}
        <div style={st.row}>
          <span style={st.fLabel}>Visited</span>
          <input type="date" style={st.input} value={visFrom} aria-label="Visited on or after"
            onChange={e => { setVisFrom(e.target.value); setResolved(null); }} />
          <span style={st.fLabel}>to</span>
          <input type="date" style={st.input} value={visTo} aria-label="Visited on or before"
            onChange={e => { setVisTo(e.target.value); setResolved(null); }} />
        </div>
      </Section>

      {/* Mailing list (volunteers / newsletter contacts with no account) */}
      <Section title="Mailing list">
        <label style={st.tog}>
          <input type="checkbox" checked={mailingList} onChange={e => { setMailingList(e.target.checked); setResolved(null); }} />
          Volunteer &amp; newsletter subscribers (no account)
        </label>
      </Section>

      {/* Individuals */}
      <Section title="Individuals">
        <div style={st.row}>
          <input style={st.input} placeholder="Search a name…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), doSearch())} />
          <button type="button" style={st.addBtn} onClick={doSearch}><Search size={13} /></button>
        </div>
        {searchRes.length > 0 && (
          <div style={st.results}>
            {searchRes.map(r => (
              <div key={r.id} style={st.resRow} onClick={() => addIndiv(r)}>
                <span>{r.name}</span><span style={st.resEmail}>{r.email || "no email"}</span>
              </div>
            ))}
          </div>
        )}
        <div style={st.indivChips}>
          {individuals.map(i => (
            <span key={i.id} style={st.iChip}>{i.name}<button type="button" style={st.x} onClick={() => setIndividuals(xs => xs.filter(x => x.id !== i.id))}><X size={11} /></button></span>
          ))}
        </div>
      </Section>

      {/* Send options */}
      {catTypes.length > 0 && (
        <div style={st.catRow}>
          <span style={st.catLabel}>Email category</span>
          <select style={st.catSelect} value={category} onChange={e => onCategoryChange(e.target.value)}>
            <option value="">None — send to everyone selected</option>
            {catTypes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={st.catHint}>
            {category
              ? <>Members who opted out of “{category}” in their preferences are skipped.</>
              : <>Pick a category to honor members' email preferences (e.g. send an Open House notice but skip newsletter opt-outs).</>}
          </span>
        </div>
      )}
      <label style={st.optRow}>
        <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
        <span><strong>Include inactive accounts</strong> — by default, members set to Inactive are removed from every blast. Check this to reach them too (e.g. an all-alumni announcement).</span>
      </label>

      {/* Resolve + summary */}
      <div style={st.resolveBar}>
        <button type="button" style={st.resolveBtn} disabled={!hasAny || resolving} onClick={resolve}>
          <RefreshCw size={13} /> {resolving ? "Resolving…" : "Preview recipients"}
        </button>
        {resolved && (
          <span style={st.count}><Users size={13} /> <strong>{resolved.length}</strong> recipient{resolved.length === 1 ? "" : "s"}
            {Object.keys(kindCounts).length > 0 && <span style={st.kinds}> ({Object.entries(kindCounts).map(([k, n]) => `${n} ${k}`).join(", ")})</span>}
          </span>
        )}
      </div>
      {resolved && skipped > 0 && (
        <div style={st.skip}><AlertTriangle size={12} /> {skipped} skipped (no email on file)</div>
      )}
      {resolved && skippedOptout > 0 && (
        <div style={st.skip}><AlertTriangle size={12} /> {skippedOptout} skipped (opted out of “{category}”)</div>
      )}
      {resolved && resolved.length > 0 && (
        <div style={st.preview}>
          {resolved.slice(0, 60).map((r, i) => <span key={i} style={st.pchip} title={`${r.email} · ${r.kind}`}>{r.name}</span>)}
          {resolved.length > 60 && <span style={st.more}>+{resolved.length - 60} more</span>}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={st.section}><div style={st.sTitle}>{title}</div>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  sTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4 },
  row: { display: "flex", gap: 6 },
  input: { flex: 1, padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, boxSizing: "border-box", minWidth: 0 },
  addBtn: { padding: "7px 10px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", display: "flex" },
  chip: { border: "1px solid #e2e8f0", borderRadius: 7, padding: "7px 9px", background: "#fafafa" },
  chipHead: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "#1a3a5c" },
  toggles: { display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" },
  tog: { display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#445", textTransform: "capitalize", cursor: "pointer" },
  orgGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" },
  compHint: { fontSize: 11.5, color: "#889", marginTop: 4, lineHeight: 1.4 },
  fLabel: { fontSize: 11, color: "#778", whiteSpace: "nowrap", alignSelf: "center" },
  results: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflowY: "auto", border: "1px solid #eef2f7", borderRadius: 6 },
  resRow: { display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12.5, borderBottom: "1px solid #f4f6fa" },
  resEmail: { color: "#94a3b8", fontSize: 11 },
  indivChips: { display: "flex", flexWrap: "wrap", gap: 4 },
  iChip: { display: "inline-flex", alignItems: "center", gap: 4, background: "#eef2f7", border: "1px solid #cdd7e3", borderRadius: 12, padding: "2px 4px 2px 9px", fontSize: 12, color: "#1a3a5c" },
  x: { background: "none", border: "none", cursor: "pointer", color: "#778", display: "flex", padding: 1 },
  optRow: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "#445", lineHeight: 1.45, background: "#f8fafc", border: "1px solid #e6edf4", borderRadius: 8, padding: "9px 12px" },
  catRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#f8fafc", border: "1px solid #e6edf4", borderRadius: 8, padding: "9px 12px", marginBottom: 8 },
  catLabel: { fontSize: 12.5, fontWeight: 700, color: "#334" },
  catSelect: { padding: "7px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, minWidth: 220 },
  catHint: { fontSize: 12, color: "#889", flex: 1, minWidth: 200 },
  resolveBar: { display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #f0f4f8", paddingTop: 10 },
  resolveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#0277bd", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  count: { display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#1a3a5c" },
  kinds: { color: "#778", fontWeight: 400 },
  skip: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#e65100", marginTop: 4 },
  preview: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, maxHeight: 120, overflowY: "auto" },
  pchip: { fontSize: 11, background: "#f1f5f9", borderRadius: 10, padding: "1px 8px", color: "#334155" },
  more: { fontSize: 11, color: "#94a3b8", padding: "1px 4px" },
};
