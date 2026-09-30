/** /goals — cross-team Season Goals overview, grouped by team, gated by goals.view. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { goalsApi, type GoalsOverview as OverviewData, CATEGORY_LABELS, type GoalCategory } from "../api";
import GoalCard from "../components/GoalCard";
import { Target, ChevronRight, AlertTriangle } from "lucide-react";

export default function GoalsOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    goalsApi.overview(cat ? { category: cat } : undefined)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [cat]);

  const teams = data?.teams ?? [];
  const totalGoals = teams.reduce((a, t) => a + t.goals.length, 0);
  const atRisk = teams.reduce((a, t) => a + t.goals.filter((g) => g.at_risk).length, 0);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={s.topRow}>
        <h1 style={s.h1}><Target size={22} style={{ verticalAlign: -4 }} /> Season Goals</h1>
        <button style={s.crossLink} onClick={() => navigate("/portfolio")}>Portfolio Tracker →</button>
      </div>
      <p style={s.sub}>Measurable goals across every team — owner, metric, progress, and at-risk status.</p>

      <div style={s.bar}>
        <div style={s.stats}>
          <span><b>{totalGoals}</b> goals</span>
          <span><b>{teams.length}</b> teams</span>
          {atRisk > 0 && <span style={s.riskStat}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {atRisk} at risk</span>}
        </div>
        <select style={s.select} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as GoalCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : teams.length === 0 ? (
        <p style={s.muted}>No goals yet. Open a team's page and add goals on the Goals tab.</p>
      ) : teams.map((t) => (
        <div key={t.team_season_id} style={s.teamBlock}>
          <button style={s.teamHead} onClick={() => navigate(`/teams/season/${t.team_season_id}`)}>
            <span style={s.teamName}>{t.team_label}</span>
            <span style={s.teamMeta}>{t.goals.length} goal{t.goals.length === 1 ? "" : "s"}</span>
            <ChevronRight size={16} style={{ marginLeft: "auto", color: "#889" }} />
          </button>
          {t.goals.map((g) => <GoalCard key={g.id} goal={g} />)}
        </div>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  crossLink: { padding: "8px 14px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#00695c" },
  sub: { color: "#667", fontSize: 14, margin: "6px 0 16px" },
  bar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  stats: { display: "flex", gap: 16, fontSize: 13.5, color: "#455" },
  riskStat: { color: "#e65100", fontWeight: 600 },
  select: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5 },
  muted: { color: "#889", fontSize: 14, padding: "1rem 0" },
  teamBlock: { marginBottom: 22 },
  teamHead: { display: "flex", alignItems: "center", gap: 10, width: "100%", background: "#f5f8fc", border: "1px solid #dde7f0", borderRadius: 8, padding: "9px 14px", cursor: "pointer", marginBottom: 10 },
  teamName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  teamMeta: { fontSize: 12.5, color: "#667" },
};
