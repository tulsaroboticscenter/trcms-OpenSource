import { useState, useEffect } from "react";
import { currentSeasonYear } from "../../../core/dateUtils";
import { useNavigate } from "react-router-dom";
import { reportsApi, type TeamListEntry } from "../api";
import { Download, ArrowLeft, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";

export default function TeamListReport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [teams, setTeams] = useState<TeamListEntry[]>([]);
  const [season, setSeason] = useState("");
  const [program, setProgram] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [youthOnly, setYouthOnly] = useState(false);

  // Build season options
  const activeYear = currentSeasonYear();
  const defaultSeason = `${activeYear}-${activeYear + 1}`;
  const seasonOptions = Array.from({ length: 5 }, (_, i) => {
    const y = activeYear - 2 + i;
    return `${y}-${y + 1}`;
  }).reverse();

  useEffect(() => {
    load(defaultSeason);
    setSeason(defaultSeason);
  }, []);

  async function load(s: string) {
    setLoading(true);
    reportsApi.getTeamList(s || undefined)
      .then((data) => { setTeams(data); setExpanded(data.map((t) => t.team_number)); })
      .finally(() => setLoading(false));
  }

  function toggle(num: string) {
    setExpanded((prev) => prev.includes(num) ? prev.filter((n) => n !== num) : [...prev, num]);
  }

  function downloadCSV() {
    const token = localStorage.getItem("trc_token");
    const url = reportsApi.csvTeamList(season);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob()).then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `team-list-${season}.csv`;
        a.click();
      });
  }

  // Program filter options come from the groups returned — competition programs plus FDP, which is
  // included as its own roster group (its members aren't on competition teams).
  const programOptions = [...new Set(teams.map((t) => t.program).filter(Boolean))].sort();
  const scoped = program ? teams.filter((t) => t.program === program) : teams;
  // "Youth only" hides mentors/adults (any non-youth member type) from the roster view.
  const displayTeams = youthOnly
    ? scoped.map((t) => ({ ...t, members: t.members.filter((m) => m.member_type === "youth") }))
    : scoped;
  const totalMembers = displayTeams.reduce((sum, t) => sum + t.members.length, 0);

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Reports</button>
        <h1 style={styles.heading}>Team Roster Lists</h1>
        <p style={styles.sub}>{displayTeams.length} team{displayTeams.length !== 1 ? "s" : ""} · {totalMembers} members</p>
      </div>

      <div style={styles.toolbar}>
        <select style={styles.select} value={season}
          onChange={(e) => { setSeason(e.target.value); load(e.target.value); }}>
          {seasonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={styles.select} value={program}
          onChange={(e) => setProgram(e.target.value)}>
          <option value="">All Programs</option>
          {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={styles.toggle}>
          <input type="checkbox" checked={youthOnly} onChange={(e) => setYouthOnly(e.target.checked)} />
          Youth only (hide mentors/adults)
        </label>
        {canRead("reports.export") && <button style={styles.csvBtn} onClick={downloadCSV}><Download size={14} /> Export CSV</button>}
      </div>

      {loading ? <p style={styles.muted}>Loading…</p> : (
        <div style={styles.list}>
          {displayTeams.map((team) => (
            <div key={team.team_number} style={styles.teamCard}>
              <div style={styles.teamHeader} onClick={() => toggle(team.team_number)}>
                <div style={styles.teamInfo}>
                  <span style={styles.teamNum}>#{team.team_number}</span>
                  <span style={styles.teamName}>{team.team_name ?? `Team ${team.team_number}`}</span>
                  {team.program && <span style={styles.programTag}>{team.program}</span>}
                  <span style={styles.memberCount}>{team.members.length} member{team.members.length !== 1 ? "s" : ""}</span>
                </div>
                {expanded.includes(team.team_number)
                  ? <ChevronUp size={16} color="#888" />
                  : <ChevronDown size={16} color="#888" />
                }
              </div>

              {expanded.includes(team.team_number) && (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {["Name","Type","Role","Shirt","Status","FIRST Reg","Consent & Release","Background","YPT","Role-Specific"].map((h) => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {team.members.map((m) => (
                      <tr key={m.member_id} style={{ ...styles.tr, opacity: m.status !== "active" ? 0.5 : 1 }}
                        onClick={() => navigate(`/members/${m.member_id}`)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={styles.td}><strong>{m.last_name}</strong>, {m.first_name}</td>
                        <td style={styles.td}><span style={styles.typeTag}>{m.member_type}</span></td>
                        <td style={styles.td}>{m.primary_role || "—"}</td>
                        <td style={styles.td}>{m.shirt_size || "—"}</td>
                        <td style={styles.td}>{m.status}</td>
                        <td style={styles.td}><FlagCell ok={m.registered_on_first} /></td>
                        <td style={styles.td}><FlagCell ok={m.first_consent_release} /></td>
                        <td style={styles.td}><FlagCell ok={m.background_check} /></td>
                        <td style={styles.td}><FlagCell ok={m.ypt} /></td>
                        <td style={styles.td}><FlagCell ok={m.role_specific} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {expanded.includes(team.team_number) && team.shirt_tally && team.shirt_tally.length > 0 && (
                <div style={styles.shirtTally}>
                  <strong>Shirt sizes:</strong>{" "}
                  {team.shirt_tally.map((t) => `${t.size}×${t.count}`).join("  ·  ")}
                  {"  ·  "}<span style={{ color: "#888" }}>{team.shirt_tally.reduce((a, t) => a + t.count, 0)} total</span>
                </div>
              )}
            </div>
          ))}
          {displayTeams.length === 0 && <p style={styles.empty}>No teams found for this season.</p>}
        </div>
      )}
    </div>
  );
}

function FlagCell({ ok }: { ok: boolean | null }) {
  if (ok == null) return <span style={{ color: "#cbd5e1" }}>—</span>;   // not applicable (youth)
  return ok
    ? <CheckCircle size={14} color="#2e7d32" />
    : <XCircle size={14} color="#e0e0e0" />;
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  toolbar: { display: "flex", gap: 10, marginBottom: 14, alignItems: "center" },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  toggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#445", cursor: "pointer", whiteSpace: "nowrap" as const },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" as const, marginLeft: "auto" },
  muted: { color: "#888", fontSize: 13 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  teamCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  teamHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", background: "#f8fafc" },
  teamInfo: { display: "flex", alignItems: "center", gap: 10 },
  teamNum: { fontWeight: 800, fontSize: 14, color: "#1a3a5c" },
  teamName: { fontWeight: 600, fontSize: 14, color: "#333" },
  programTag: { padding: "2px 8px", background: "#e3f2fd", color: "#1565c0", borderRadius: 8, fontSize: 11, fontWeight: 600 },
  memberCount: { fontSize: 12, color: "#888" },
  shirtTally: { padding: "8px 14px", background: "#f1f5f9", borderTop: "1px solid #e2e8f0", fontSize: 13, color: "#334" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "8px 14px", background: "#fafafa", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #f0f4f8" },
  tr: { cursor: "pointer", borderBottom: "1px solid #f8fafc", transition: "background 0.1s" },
  td: { padding: "8px 14px", color: "#333" },
  typeTag: { fontSize: 11, padding: "1px 7px", background: "#f0f4f8", borderRadius: 8, textTransform: "capitalize" as const, fontWeight: 600 },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};
