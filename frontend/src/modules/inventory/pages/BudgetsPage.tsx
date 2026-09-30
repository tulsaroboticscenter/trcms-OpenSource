import { useState, useEffect } from "react";
import { teamsApi, type TeamSummary } from "../../teams/api";
import { ArrowLeft, PiggyBank } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import TeamBudgetPanel from "../components/TeamBudgetPanel";

/**
 * Standalone Team Budgets page: pick a team, then manage its budget with the
 * shared TeamBudgetPanel — the same component embedded on the team profile, so
 * sub-system categories, ad-hoc expenses, fundraising and carryover all behave
 * identically here.
 */
export default function BudgetsPage() {
  const goBack = useGoBack("/inventory");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [seasonId, setSeasonId] = useState("");

  useEffect(() => { teamsApi.list().then(setTeams).catch(() => {}); }, []);
  const teamsWithSeason = teams.filter((t) => t.current_season?.id);

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Inventory</button>
      <h1 style={st.heading}><PiggyBank size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Team Budgets</h1>

      <select style={st.teamSelect} value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
        <option value="">Select a team…</option>
        {teamsWithSeason.map((t) => (
          <option key={t.current_season!.id} value={t.current_season!.id}>
            #{t.team_number}{t.current_season?.team_name ? ` — ${t.current_season.team_name}` : ""} ({t.current_season!.season})
          </option>
        ))}
      </select>

      {seasonId ? <TeamBudgetPanel teamSeasonId={parseInt(seasonId)} /> : <p style={st.muted}>Choose a team to view and manage its budget.</p>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: "0 0 14px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  teamSelect: { width: "100%", maxWidth: 420, padding: "9px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, marginBottom: 18 },
  muted: { color: "#aaa", fontSize: 14, padding: "0.5rem 0" },
};
