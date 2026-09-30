import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { teamsApi, type TeamSummary } from "../api";
import { programsApi, type Program } from "../../enrollment/api";
import { PlusCircle, Trophy, ChevronRight } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  active: "#2e7d32",
  inactive: "#757575",
  development_only: "#e65100",
};

export default function TeamList() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [filterProgram, setFilterProgram] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      teamsApi.list(),
      programsApi.list(),
    ]).then(([t, p]) => {
      setTeams(t);
      setPrograms(p);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = filterProgram
    ? teams.filter((t) => String(t.program_id) === filterProgram)
    : teams;

  // Group by program for display
  const byProgram: Record<string, TeamSummary[]> = {};
  for (const t of filtered) {
    const key = t.program_name ?? "Other";
    if (!byProgram[key]) byProgram[key] = [];
    byProgram[key].push(t);
  }

  // Order the program groups by the program display order (`programs` comes back from
  // the API sorted by display_order); any program with no teams is skipped, and any
  // leftover group not matching a known program (e.g. "Other") is appended at the end.
  const orderedGroups: [string, TeamSummary[]][] = [];
  const seen = new Set<string>();
  for (const p of programs) {
    if (byProgram[p.name]?.length) { orderedGroups.push([p.name, byProgram[p.name]]); seen.add(p.name); }
  }
  for (const [name, group] of Object.entries(byProgram)) {
    if (!seen.has(name)) orderedGroups.push([name, group]);
  }

  return (
    <div>
      <div style={styles.pageHeader}>
        <div>
          <h1 style={styles.heading}>Teams</h1>
          <p style={styles.sub}>All TRC robotics teams by program</p>
        </div>
        {isAdmin && (
          <button style={styles.addBtn} onClick={() => navigate("/teams/add")}>
            <PlusCircle size={15} /> Add Team
          </button>
        )}
      </div>

      <div style={styles.filters}>
        <select style={styles.select} value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)}>
          <option value="">All Programs</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={styles.loading}>Loading teams…</p>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>
          No teams found.{" "}
          {isAdmin && (
            <button style={styles.linkBtn} onClick={() => navigate("/teams/add")}>Add the first team.</button>
          )}
        </div>
      ) : (
        orderedGroups.map(([programName, programTeams]) => (
          <div key={programName} style={styles.programGroup}>
            <h2 style={styles.programLabel}>{programName}</h2>
            <div style={styles.teamGrid}>
              {programTeams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  onClick={() => {
                    const seasonId = team.current_season?.id;
                    if (seasonId) navigate(`/teams/season/${seasonId}`);
                    else navigate(`/teams/${team.id}`);
                  }}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TeamCard({ team, onClick }: { team: TeamSummary; onClick: () => void }) {
  const season = team.current_season;
  const status = season?.status ?? "inactive";

  return (
    <div style={styles.card} onClick={onClick}>
      <div style={styles.cardTop}>
        {season?.team_logo_url ? (
          <img src={season.team_logo_url} style={styles.logo} alt="Team logo" />
        ) : (
          <div style={styles.logoPlaceholder}>
            <Trophy size={28} color="#1a3a5c" />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={styles.teamNumber}>#{team.team_number}</div>
          <div style={styles.teamName}>{season?.team_name ?? `Team ${team.team_number}`}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ ...styles.badge, background: STATUS_COLORS[status] ?? "#999" }}>
              {status.replace("_", " ")}
            </span>
            {team.seasons_competed > 0 && (
              <span style={styles.seasonsBadge}>
                {team.seasons_competed} season{team.seasons_competed !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={16} color="#ccc" />
      </div>

      {season && (
        <div style={styles.cardBottom}>
          {season.robot_name && (
            <span style={styles.robotName}>🤖 {season.robot_name}</span>
          )}
          <div style={styles.socialRow}>
            {season.instagram && <SocialLink href={`https://instagram.com/${season.instagram.replace("@","")}`} label="IG" />}
            {season.tiktok && <SocialLink href={`https://tiktok.com/@${season.tiktok.replace("@","")}`} label="TT" />}
            {season.youtube && <SocialLink href={season.youtube} label="YT" />}
            {season.website && <SocialLink href={season.website} label="Web" />}
          </div>
        </div>
      )}
    </div>
  );
}

function SocialLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={styles.socialLink}
      onClick={(e) => e.stopPropagation()}>
      {label}
    </a>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  filters: { marginBottom: 20 },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  loading: { color: "#888", padding: "2rem 0" },
  empty: { color: "#888", fontSize: 14, padding: "2rem 0" },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 14, padding: 0, textDecoration: "underline" },
  programGroup: { marginBottom: 28 },
  programLabel: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12, borderBottom: "2px solid #e2e8f0", paddingBottom: 6 },
  teamGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", cursor: "pointer", transition: "box-shadow 0.15s" },
  cardTop: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" },
  logo: { width: 56, height: 56, objectFit: "contain", borderRadius: 6, border: "1px solid #e2e8f0" },
  logoPlaceholder: { width: 56, height: 56, background: "#f0f4f8", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e2e8f0", flexShrink: 0 },
  teamNumber: { fontSize: 12, color: "#888", fontWeight: 600 },
  teamName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  badge: { padding: "2px 8px", borderRadius: 10, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  seasonsBadge: { padding: "2px 8px", borderRadius: 10, background: "#e3f2fd", color: "#1565c0", fontSize: 11, fontWeight: 600 },
  cardBottom: { borderTop: "1px solid #f0f4f8", padding: "8px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  robotName: { fontSize: 12, color: "#555" },
  socialRow: { display: "flex", gap: 6 },
  socialLink: { padding: "2px 7px", background: "#f0f4f8", borderRadius: 4, fontSize: 11, fontWeight: 600, color: "#1a3a5c", textDecoration: "none" },
};
