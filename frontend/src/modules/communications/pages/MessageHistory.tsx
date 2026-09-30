/**
 * MessageHistory — admin-wide view of every email sent from Communications.
 * Lists all threads across all recipients (not just one profile), filterable by
 * team, program, and recipient type, with free-text search. Click a row to open
 * the full thread.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Search, ChevronLeft, ChevronRight, ChevronDown, RotateCcw, Users } from "lucide-react";
import {
  commsApi,
  type MessageGroup,
  type TeamSeasonOption,
  type ProgramOption,
} from "../api";

const PAGE = 50;

// Date-range presets. `range()` returns {from,to} as YYYY-MM-DD (local), or null for "all".
const DATE_PRESETS: { value: string; label: string; range: () => { from?: string; to?: string } }[] = [
  { value: "30", label: "Last 30 days", range: () => ({ from: daysAgo(30) }) },
  { value: "90", label: "Last 90 days", range: () => ({ from: daysAgo(90) }) },
  { value: "this_year", label: "This year", range: () => ({ from: `${thisYear()}-01-01` }) },
  { value: "last_year", label: "Last year", range: () => ({ from: `${thisYear() - 1}-01-01`, to: `${thisYear() - 1}-12-31` }) },
  { value: "all", label: "All time", range: () => ({}) },
  { value: "custom", label: "Custom range…", range: () => ({}) },
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); }
function thisYear(): number { return new Date().getFullYear(); }

const TYPE_OPTIONS = [
  { value: "", label: "All recipient types" },
  { value: "youth", label: "Youth" },
  { value: "mentor", label: "Mentors" },
  { value: "parent", label: "Parents / Guardians" },
  { value: "volunteer", label: "Volunteers" },
  { value: "sponsor", label: "Sponsors" },
  { value: "visitor", label: "Visitors" },
];

const AUDIENCE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#6a1b9a", parent: "#2e7d32",
  volunteer: "#e65100", sponsor: "#00838f", visitor: "#9e9e9e", member: "#607d8b",
};

export default function MessageHistory() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamSeasonOption[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);

  const [teamSeasonId, setTeamSeasonId] = useState(0);
  const [programId, setProgramId] = useState(0);
  const [memberType, setMemberType] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [datePreset, setDatePreset] = useState("30");  // default: last 30 days
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [offset, setOffset] = useState(0);

  // Resolve the active preset (or custom inputs) into from/to bounds.
  const dateRange: { from?: string; to?: string } = datePreset === "custom"
    ? { from: customFrom || undefined, to: customTo || undefined }
    : (DATE_PRESETS.find(p => p.value === datePreset)?.range() ?? {});

  const [rows, setRows] = useState<MessageGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  useEffect(() => {
    commsApi.teamSeasons().then(setTeams).catch(() => {});
    commsApi.listPrograms().then(setPrograms).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    commsApi.listMessages({
      team_season_id: teamSeasonId || undefined,
      program_id: programId || undefined,
      member_type: memberType || undefined,
      search: search || undefined,
      date_from: dateRange.from,
      date_to: dateRange.to,
      limit: PAGE,
      offset,
    })
      .then(r => { setRows(r.groups); setTotal(r.total); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [teamSeasonId, programId, memberType, search, dateRange.from, dateRange.to, offset]);

  useEffect(() => { load(); }, [load]);

  // Reset to first page whenever a filter changes.
  useEffect(() => { setOffset(0); }, [teamSeasonId, programId, memberType, search, dateRange.from, dateRange.to]);

  function resetFilters() {
    setTeamSeasonId(0); setProgramId(0); setMemberType("");
    setSearch(""); setSearchInput("");
    setDatePreset("30"); setCustomFrom(""); setCustomTo("");
  }

  // "Default" date filtering (last 30 days) doesn't count as an active filter for the
  // reset affordance / "(filtered)" label — only a non-default date selection does.
  const dateIsDefault = datePreset === "30";
  const hasFilters = teamSeasonId || programId || memberType || search || !dateIsDefault;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);

  return (
    <div>
      <div style={st.header}>
        <div>
          <h1 style={st.heading}><Mail size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Message History</h1>
          <p style={st.sub}>Every email sent from Communications, across all recipients. Click a row to open the full thread.</p>
        </div>
        <button style={st.composeBtn} onClick={() => navigate("/communications/compose")}>Compose New</button>
      </div>

      <div style={st.filters}>
        <select style={st.select} value={teamSeasonId} onChange={e => setTeamSeasonId(Number(e.target.value))}>
          <option value={0}>All teams</option>
          {teams.map(t => (
            <option key={t.team_season_id} value={t.team_season_id}>
              {t.team_number}{t.team_name ? ` — ${t.team_name}` : ""}
            </option>
          ))}
        </select>

        <select style={st.select} value={programId} onChange={e => setProgramId(Number(e.target.value))}>
          <option value={0}>All programs</option>
          {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select style={st.select} value={memberType} onChange={e => setMemberType(e.target.value)}>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select style={st.select} value={datePreset} onChange={e => setDatePreset(e.target.value)}>
          {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        {datePreset === "custom" && (
          <div style={st.customDates}>
            <input type="date" style={st.dateInput} value={customFrom} max={customTo || undefined}
              onChange={e => setCustomFrom(e.target.value)} aria-label="From date" />
            <span style={st.dateSep}>to</span>
            <input type="date" style={st.dateInput} value={customTo} min={customFrom || undefined}
              onChange={e => setCustomTo(e.target.value)} aria-label="To date" />
          </div>
        )}

        <form style={st.searchWrap} onSubmit={e => { e.preventDefault(); setSearch(searchInput.trim()); }}>
          <Search size={15} color="#888" style={{ flexShrink: 0 }} />
          <input style={st.searchInput} placeholder="Search subject, name, or email…"
            value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        </form>

        {hasFilters ? (
          <button style={st.resetBtn} onClick={resetFilters}><RotateCcw size={13} /> Reset</button>
        ) : null}
      </div>

      <div style={st.countRow}>
        {loading ? "Loading…" : `${total} message${total === 1 ? "" : "s"}${hasFilters ? " (filtered)" : ""}`}
      </div>

      <div style={st.tableCard}>
        <div style={{ ...st.tr, ...st.thead }}>
          <div style={st.thSubject}>Subject</div>
          <div style={st.thRecipient}>Recipient</div>
          <div style={st.thType}>Type</div>
          <div style={st.thSent}>Sent</div>
          <div style={st.thStatus}>Status</div>
        </div>

        {!loading && rows.length === 0 && (
          <div style={st.empty}>No messages match these filters.</div>
        )}

        {rows.map(g => {
          const isOpen = expanded.has(g.group_key);
          const single = !g.is_group;
          const onRowClick = () => single && g.thread_id != null
            ? navigate(`/communications/threads/${g.thread_id}`)
            : toggle(g.group_key);
          return (
            <div key={g.group_key}>
              <div style={st.tr} className="msg-row" onClick={onRowClick}>
                <div style={st.tdSubject}>
                  <div style={st.subjLine}>{g.subject || "(no subject)"}</div>
                  <div style={st.subBy}>
                    {g.sent_by ? `by ${g.sent_by}` : ""}
                    {g.is_group ? `${g.sent_by ? " · " : ""}${g.personalized ? "personalized" : "same content"}` : ""}
                    {g.failed_count > 0 ? ` · ${g.failed_count} failed` : ""}
                    {(g.opened_count ?? 0) > 0 ? ` · ${g.opened_count} opened` : ""}
                    {(g.clicked_count ?? 0) > 0 ? ` · ${g.clicked_count} clicked` : ""}
                  </div>
                </div>
                <div style={st.tdRecipient}>
                  {g.is_group ? (
                    <div style={st.groupRecip}>
                      <Users size={14} color="#1a3a5c" />
                      <span style={st.recipName}>{g.recipient_count} recipients</span>
                    </div>
                  ) : (
                    <>
                      <div style={st.recipName}>{g.recipients[0]?.recipient_name || "—"}</div>
                      <div style={st.recipEmail}>{g.recipients[0]?.recipient_email}</div>
                    </>
                  )}
                </div>
                <div style={st.tdType}>
                  {g.audiences.slice(0, 2).map(a => (
                    <span key={a} style={{ ...st.badge, background: AUDIENCE_COLORS[a] ?? "#607d8b", marginRight: 3 }}>{a}</span>
                  ))}
                  {g.audiences.length > 2 && <span style={st.moreTag}>+{g.audiences.length - 2}</span>}
                </div>
                <div style={st.tdSent}>{fmtDate(g.created_at)}</div>
                <div style={st.tdStatus}>
                  <span style={{ ...st.statusDot, ...groupStatusStyle(g) }}>{groupStatusLabel(g)}</span>
                </div>
                {g.is_group
                  ? <ChevronDown size={16} color="#888" style={{ alignSelf: "center", flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                  : <ChevronRight size={16} color="#ccc" style={{ alignSelf: "center", flexShrink: 0 }} />}
              </div>

              {g.is_group && isOpen && (
                <div style={st.expandWrap}>
                  {g.personalized && (
                    <div style={st.personalNote}>Each recipient received personalized content — open a row to see their exact email.</div>
                  )}
                  {g.recipients.map(r => (
                    <div key={r.thread_id} style={st.subRow} className="msg-subrow"
                      onClick={() => navigate(`/communications/threads/${r.thread_id}`)}>
                      <span style={{ ...st.badge, background: AUDIENCE_COLORS[r.audience] ?? "#607d8b", flexShrink: 0 }}>{r.audience}</span>
                      <span style={st.subRecipName}>{r.recipient_name || "—"}</span>
                      <span style={st.subRecipEmail}>{r.recipient_email}</span>
                      {r.opened && <span style={st.openChip} title="Opened (image loaded)">opened</span>}
                      {r.clicked && <span style={st.clickChip} title="Clicked a link">clicked</span>}
                      <span style={{ ...st.statusDot, ...statusStyle(r.last_status), flexShrink: 0 }}>{r.last_status || "—"}</span>
                      <ChevronRight size={14} color="#ccc" style={{ flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {total > PAGE && (
        <div style={st.pager}>
          <span style={st.pagerInfo}>{from}–{to} of {total}</span>
          <button style={st.pageBtn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            <ChevronLeft size={15} /> Prev
          </button>
          <button style={st.pageBtn} disabled={to >= total} onClick={() => setOffset(offset + PAGE)}>
            Next <ChevronRight size={15} />
          </button>
        </div>
      )}

      <style>{`.msg-row:hover { background:#f6f9fc; } .msg-subrow:hover { background:#eef4fa; }`}</style>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function statusStyle(status: string | null): React.CSSProperties {
  if (status === "sent") return { color: "#1b5e20", background: "#e8f5e9" };
  if (status === "failed") return { color: "#b71c1c", background: "#ffebee" };
  if (status === "draft") return { color: "#e65100", background: "#fff3e0" };
  return { color: "#777", background: "#f0f0f0" };
}

function groupStatusLabel(g: MessageGroup): string {
  if (!g.is_group) return g.recipients[0]?.last_status || "—";
  if (g.failed_count === 0) return "Sent";
  if (g.sent_count === 0) return "Failed";
  return `${g.sent_count}/${g.recipient_count}`;
}
function groupStatusStyle(g: MessageGroup): React.CSSProperties {
  if (!g.is_group) return statusStyle(g.recipients[0]?.last_status ?? null);
  if (g.failed_count === 0) return statusStyle("sent");
  if (g.sent_count === 0) return statusStyle("failed");
  return { color: "#e65100", background: "#fff3e0" };
}

const st: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888", maxWidth: 620, lineHeight: 1.5 },
  composeBtn: { padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  filters: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 },
  select: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, background: "#fff", minWidth: 150 },
  customDates: { display: "flex", alignItems: "center", gap: 6 },
  dateInput: { padding: "7px 8px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, background: "#fff" },
  dateSep: { fontSize: 12, color: "#888" },
  searchWrap: { display: "flex", alignItems: "center", gap: 6, border: "1px solid #ccc", borderRadius: 6, padding: "0 10px", background: "#fff", flex: 1, minWidth: 220 },
  searchInput: { border: "none", outline: "none", padding: "8px 0", fontSize: 13, flex: 1, background: "transparent" },
  resetBtn: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#555" },
  countRow: { fontSize: 12, color: "#888", marginBottom: 8 },
  tableCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  tr: { display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid #f4f6fa", cursor: "pointer" },
  thead: { background: "#f0f4f8", borderTop: "none", cursor: "default", fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4 },
  thSubject: { flex: 2, minWidth: 0 }, thRecipient: { flex: 2, minWidth: 0 },
  thType: { width: 90, flexShrink: 0 }, thSent: { width: 140, flexShrink: 0 }, thStatus: { width: 80, flexShrink: 0 },
  tdSubject: { flex: 2, minWidth: 0 },
  subjLine: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  subBy: { fontSize: 11, color: "#aaa", marginTop: 2 },
  tdRecipient: { flex: 2, minWidth: 0 },
  recipName: { fontSize: 13, color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  recipEmail: { fontSize: 11, color: "#999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  tdType: { width: 90, flexShrink: 0, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 },
  badge: { color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px", textTransform: "capitalize" },
  openChip: { fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px", background: "#e3f2fd", color: "#1565c0", flexShrink: 0 },
  clickChip: { fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px", background: "#e8f5e9", color: "#2e7d32", flexShrink: 0 },
  moreTag: { fontSize: 10, fontWeight: 700, color: "#888" },
  groupRecip: { display: "flex", alignItems: "center", gap: 6 },
  expandWrap: { background: "#f6f9fc", borderTop: "1px solid #e2e8f0", padding: "4px 16px 8px 28px" },
  personalNote: { fontSize: 11, color: "#888", fontStyle: "italic", padding: "6px 0 4px" },
  subRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderTop: "1px solid #eef2f7", cursor: "pointer" },
  subRecipName: { fontSize: 13, color: "#333", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  subRecipEmail: { fontSize: 12, color: "#999", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  tdSent: { width: 140, flexShrink: 0, fontSize: 12, color: "#666" },
  tdStatus: { width: 80, flexShrink: 0 },
  statusDot: { fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px", textTransform: "capitalize" },
  empty: { padding: "2rem", textAlign: "center", color: "#aaa", fontSize: 14 },
  pager: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  pagerInfo: { fontSize: 12, color: "#888" },
  pageBtn: { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#fff", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#333" },
};
