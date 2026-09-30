import { useState, useEffect } from "react";
import { currentSeasonYear } from "../../../core/dateUtils";
import { useNavigate } from "react-router-dom";
import { reportsApi, type AttendanceRow } from "../api";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { membersApi } from "../../members/api";
import { ArrowLeft } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const TYPE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#2e7d32", parent: "#e65100", volunteer: "#6a1b9a",
};

/** Local YYYY-MM-DD (never UTC, which can roll the day in the evening). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PRESETS = ["Today", "This Week", "This Month", "This Year", "This Season"] as const;
type Preset = typeof PRESETS[number];

/** Resolve a preset to a [from, to] local date range. */
function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  switch (p) {
    case "Today":
      return { from: today, to: today };
    case "This Week": {
      const sunday = new Date(now); sunday.setDate(now.getDate() - now.getDay()); // 0 = Sunday
      const saturday = new Date(sunday); saturday.setDate(sunday.getDate() + 6);
      return { from: ymd(sunday), to: ymd(saturday) };
    }
    case "This Month":
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    case "This Year":
      return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    case "This Season": {
      const y = currentSeasonYear(now);
      return { from: `${y}-08-01`, to: `${y + 1}-07-31` };
    }
  }
}

interface MemberLite { id: number; first_name: string; last_name: string; member_type: string; }

type SortKey = "member" | "type" | "checkins" | "hours" | "avg";
const TYPE_FILTERS = [
  { value: "youth", label: "Youth" }, { value: "mentor", label: "Mentors" },
  { value: "parent", label: "Parents" }, { value: "volunteer", label: "Volunteers" },
];

export default function AttendanceReport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reports");
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<string[]>([]); // empty = all types
  const [sortKey, setSortKey] = useState<SortKey>("checkins");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activePreset, setActivePreset] = useState<Preset | "">("This Season");
  const [searched, setSearched] = useState(false);

  // Scope: all members, one member, or one team's roster.
  const [scope, setScope] = useState<"all" | "member" | "team">("all");
  const [memberId, setMemberId] = useState("");
  const [teamSeasonId, setTeamSeasonId] = useState("");
  const [includeMentors, setIncludeMentors] = useState(true);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);

  // Default to current enrollment year ("This Season")
  useEffect(() => {
    const r = presetRange("This Season");
    setFromDate(r.from); setToDate(r.to);
  }, []);

  useEffect(() => {
    teamsApi.list().then(setTeams).catch(() => {});
    // /members/ returns { total, members } — pull the array out.
    membersApi.list().then((d: { members?: MemberLite[] } | MemberLite[]) =>
      setMembers(Array.isArray(d) ? d : (d.members ?? []))).catch(() => {});
  }, []);

  function applyPreset(p: Preset) {
    const r = presetRange(p);
    setFromDate(r.from); setToDate(r.to); setActivePreset(p);
    load(r.from, r.to);
  }

  async function load(from = fromDate, to = toDate) {
    setLoading(true);
    setSearched(true);
    reportsApi.getAttendanceSummary({
      fromDate: from || undefined,
      toDate: to || undefined,
      memberId: scope === "member" && memberId ? parseInt(memberId) : undefined,
      teamSeasonId: scope === "team" && teamSeasonId ? parseInt(teamSeasonId) : undefined,
      includeMentors: scope === "team" ? includeMentors : undefined,
    }).then((data) => {
      setRows(data);
    }).finally(() => setLoading(false));
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "member" || key === "type" ? "asc" : "desc"); }
  }
  function toggleType(t: string) {
    setTypeFilter((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }

  const teamsWithSeason = teams.filter((t) => t.current_season?.id);
  const sortedMembers = [...members].sort((a, b) =>
    (a.last_name || "").localeCompare(b.last_name || "") || (a.first_name || "").localeCompare(b.first_name || ""));

  // Filter by member type (client-side, any scope), then sort by the active column.
  const avg = (r: AttendanceRow) => (r.checkin_count > 0 ? r.total_hours / r.checkin_count : 0);
  const displayRows = [...rows]
    .filter((r) => typeFilter.length === 0 || typeFilter.includes(r.member_type))
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "member": return dir * ((a.last_name || "").localeCompare(b.last_name || "") || (a.first_name || "").localeCompare(b.first_name || ""));
        case "type": return dir * (a.member_type || "").localeCompare(b.member_type || "");
        case "hours": return dir * (a.total_hours - b.total_hours);
        case "avg": return dir * (avg(a) - avg(b));
        case "checkins": default: return dir * (a.checkin_count - b.checkin_count);
      }
    });

  const totalCheckins = displayRows.reduce((s, r) => s + r.checkin_count, 0);
  const totalHours = displayRows.reduce((s, r) => s + r.total_hours, 0);
  const maxCheckins = Math.max(1, ...displayRows.map((x) => x.checkin_count));

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Reports</button>
        <h1 style={styles.heading}>Attendance Summary</h1>
        <p style={styles.sub}>Check-in counts and hours by member for a date range</p>
      </div>

      <div style={styles.presetRow}>
        {PRESETS.map((p) => (
          <button key={p} style={{ ...styles.preset, ...(activePreset === p ? styles.presetActive : {}) }}
            onClick={() => applyPreset(p)}>{p}</button>
        ))}
      </div>

      <div style={styles.toolbar}>
        <div>
          <label style={styles.label}>From</label>
          <input type="date" style={styles.input} value={fromDate} onChange={(e) => { setFromDate(e.target.value); setActivePreset(""); }} />
        </div>
        <div>
          <label style={styles.label}>To</label>
          <input type="date" style={styles.input} value={toDate} onChange={(e) => { setToDate(e.target.value); setActivePreset(""); }} />
        </div>
        <div>
          <label style={styles.label}>Scope</label>
          <select style={styles.input} value={scope} onChange={(e) => setScope(e.target.value as "all" | "member" | "team")}>
            <option value="all">All members</option>
            <option value="member">A member</option>
            <option value="team">A team</option>
          </select>
        </div>
        {scope === "member" && (
          <div>
            <label style={styles.label}>Member</label>
            <select style={styles.input} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Select member…</option>
              {sortedMembers.map((m) => <option key={m.id} value={m.id}>{m.last_name}, {m.first_name}</option>)}
            </select>
          </div>
        )}
        {scope === "team" && (
          <>
            <div>
              <label style={styles.label}>Team</label>
              <select style={styles.input} value={teamSeasonId} onChange={(e) => setTeamSeasonId(e.target.value)}>
                <option value="">Select team…</option>
                {teamsWithSeason.map((t) => (
                  <option key={t.current_season!.id} value={t.current_season!.id}>
                    #{t.team_number}{t.current_season?.team_name ? ` — ${t.current_season.team_name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={includeMentors} onChange={(e) => setIncludeMentors(e.target.checked)} />
              Include mentors / adults
            </label>
          </>
        )}
        <button style={styles.runBtn} onClick={() => load()} disabled={loading}>
          {loading ? "Loading…" : "Run Report"}
        </button>
      </div>

      {searched && !loading && (
        <div style={styles.summaryStrip}>
          <Stat label="Members" value={rows.length} icon="👤" />
          <Stat label="Total Check-Ins" value={totalCheckins} icon="✓" />
          <Stat label="Total Hours" value={`${totalHours.toFixed(1)}h`} icon="⏱" />
        </div>
      )}

      {searched && !loading && rows.length > 0 && (
        <div style={styles.filterRow}>
          <span style={styles.filterLabel}>Show:</span>
          {TYPE_FILTERS.map((t) => {
            const on = typeFilter.includes(t.value);
            return (
              <button key={t.value} onClick={() => toggleType(t.value)}
                style={{ ...styles.filterChip, ...(on ? { background: TYPE_COLORS[t.value] ?? "#1a3a5c", color: "#fff", borderColor: TYPE_COLORS[t.value] ?? "#1a3a5c" } : {}) }}>
                {t.label}
              </button>
            );
          })}
          {typeFilter.length > 0 && <button onClick={() => setTypeFilter([])} style={styles.filterClear}>Clear</button>}
        </div>
      )}

      {loading ? <p style={styles.muted}>Loading…</p> : searched && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Rank</th>
                {([["Member","member"],["Type","type"],["Check-Ins","checkins"],["Total Hours","hours"],["Avg. Hours/Visit","avg"]] as [string, SortKey][]).map(([label, key]) => (
                  <th key={key} style={{ ...styles.th, ...styles.thSort }} onClick={() => toggleSort(key)}>
                    {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => (
                <tr key={r.member_id} style={styles.tr}
                  onClick={() => navigate(`/members/${r.member_id}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ ...styles.td, color: "#aaa", width: 40 }}>{i + 1}</td>
                  <td style={styles.td}><strong>{r.last_name}</strong>, {r.first_name}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: TYPE_COLORS[r.member_type] ?? "#888" }}>
                      {r.member_type}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.barWrap}>
                      <div style={{ ...styles.bar, width: `${Math.min(100, (r.checkin_count / maxCheckins) * 100)}%`, background: TYPE_COLORS[r.member_type] ?? "#1a3a5c" }} />
                      <span>{r.checkin_count}</span>
                    </div>
                  </td>
                  <td style={styles.td}>{r.total_hours.toFixed(1)}h</td>
                  <td style={styles.td}>{r.checkin_count > 0 ? (r.total_hours / r.checkin_count).toFixed(1) + "h" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayRows.length === 0 && <p style={styles.empty}>{rows.length === 0 ? "No check-in data for this date range." : "No members match the selected type filter."}</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return (
    <div style={styles.statChip}>
      <span style={styles.statIcon}>{icon}</span>
      <span style={styles.statNum}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  presetRow: { display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 12 },
  preset: { padding: "6px 14px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 16, fontSize: 13, color: "#445", cursor: "pointer", fontWeight: 600 },
  presetActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#445", cursor: "pointer", paddingBottom: 9 },
  toolbar: { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" as const, marginBottom: 16 },
  label: { display: "block", fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 3 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  runBtn: { padding: "9px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  summaryStrip: { display: "flex", gap: 12, marginBottom: 14 },
  statChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 20px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 },
  statIcon: { fontSize: 20, marginBottom: 4 },
  statNum: { fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  statLabel: { fontSize: 11, color: "#888", fontWeight: 600 },
  muted: { color: "#888", fontSize: 13 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "9px 14px", background: "#f0f4f8", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" as const },
  thSort: { cursor: "pointer", userSelect: "none" as const },
  filterRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const, marginBottom: 12 },
  filterLabel: { fontSize: 12, fontWeight: 700, color: "#888" },
  filterChip: { padding: "5px 13px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 14, fontSize: 12.5, color: "#445", cursor: "pointer", fontWeight: 600 },
  filterClear: { padding: "5px 10px", background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, fontWeight: 600 },
  tr: { cursor: "pointer", borderBottom: "1px solid #f0f4f8", transition: "background 0.1s" },
  td: { padding: "9px 14px" },
  badge: { padding: "2px 8px", borderRadius: 10, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  barWrap: { display: "flex", alignItems: "center", gap: 8 },
  bar: { height: 6, borderRadius: 3, minWidth: 4, maxWidth: 80 },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};
