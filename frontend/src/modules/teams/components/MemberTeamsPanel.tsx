/**
 * MemberTeamsPanel
 * Embedded in MemberProfile to show all team assignments for that member.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { teamsApi, type MemberTeamAssignment } from "../api";
import { ExternalLink } from "lucide-react";

export default function MemberTeamsPanel({ memberId }: { memberId: number }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<MemberTeamAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    teamsApi.getMemberTeams(memberId).then(setTeams).finally(() => setLoading(false));
  }, [memberId]);

  if (loading) return <p style={styles.sub}>Loading teams…</p>;
  if (teams.length === 0) return <p style={styles.sub}>Not assigned to any teams.</p>;

  const active = teams.filter((t) => t.status === "active");
  const inactive = teams.filter((t) => t.status !== "active");

  return (
    <div>
      {active.length > 0 && (
        <div style={styles.group}>
          {active.map((t) => <TeamRow key={t.assignment_id} team={t} navigate={navigate} />)}
        </div>
      )}
      {inactive.length > 0 && (
        <>
          <div style={styles.groupLabel}>Previous Seasons</div>
          <div style={styles.group}>
            {inactive.map((t) => <TeamRow key={t.assignment_id} team={t} navigate={navigate} dimmed />)}
          </div>
        </>
      )}
    </div>
  );
}

function TeamRow({ team: t, navigate, dimmed = false }: {
  team: MemberTeamAssignment;
  navigate: ReturnType<typeof useNavigate>;
  dimmed?: boolean;
}) {
  return (
    <div
      style={{ ...styles.row, opacity: dimmed ? 0.6 : 1, cursor: t.team_season_id ? "pointer" : "default" }}
      onClick={() => t.team_season_id && navigate(`/teams/season/${t.team_season_id}`)}
    >
      <div style={styles.teamNum}>#{t.team_number}</div>
      <div style={styles.teamInfo}>
        <div style={styles.teamName}>{t.team_name ?? `Team ${t.team_number}`}</div>
        <div style={styles.teamMeta}>
          {t.program_name} · {t.season}
          {t.primary_role && <span style={styles.roleTag}>{t.primary_role}</span>}
        </div>
      </div>
      <StatusDot status={t.status} />
      {t.team_season_id && <ExternalLink size={12} color="#ccc" />}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const c: Record<string, string> = { active: "#2e7d32", not_active: "#bbb", graduated: "#1565c0", transferred: "#e65100" };
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: c[status] ?? "#bbb", margin: "0 auto 2px" }} />
      <div style={{ fontSize: 10, color: "#aaa" }}>{status.replace("_", " ")}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sub: { color: "#888", fontSize: 13, margin: 0 },
  group: { display: "flex", flexDirection: "column", gap: 4 },
  groupLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "12px 0 6px" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f8fafc", borderRadius: 7, border: "1px solid #e2e8f0" },
  teamNum: { fontWeight: 800, fontSize: 14, color: "#1a3a5c", minWidth: 50 },
  teamInfo: { flex: 1 },
  teamName: { fontWeight: 600, fontSize: 13, color: "#222" },
  teamMeta: { fontSize: 12, color: "#888", display: "flex", alignItems: "center", gap: 6, marginTop: 2 },
  roleTag: { padding: "1px 7px", background: "#1a3a5c", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 600 },
};
