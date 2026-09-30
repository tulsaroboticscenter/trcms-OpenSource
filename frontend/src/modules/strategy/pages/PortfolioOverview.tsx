/** /portfolio — cross-team Inspire/Impact portfolio status, gated by portfolio.view. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portfolioApi, type PortfolioOverview as OverviewData } from "../api";
import { FileText, ChevronRight } from "lucide-react";

const AWARD_LABEL: Record<string, string> = { inspire: "FTC Inspire", impact: "FRC Impact", other: "Other" };
const STATUS_LABEL: Record<string, string> = { planning: "Planning", drafting: "Drafting", review: "Review", submission_ready: "Submission ready" };

export default function PortfolioOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { portfolioApi.overview().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); }, []);
  const teams = (data?.teams ?? []).filter((t) => t.piece_count > 0);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={s.topRow}>
        <h1 style={s.h1}><FileText size={22} style={{ verticalAlign: -4 }} /> Portfolio Tracker</h1>
        <button style={s.crossLink} onClick={() => navigate("/goals")}>← Season Goals</button>
      </div>
      <p style={s.sub}>FTC Inspire / FRC Impact portfolio progress across teams. Pieces are built in Canva; assets live in each team's Resources.</p>
      {loading ? <p style={s.muted}>Loading…</p> : teams.length === 0 ? (
        <p style={s.muted}>No portfolios started yet. Open a team's page → Portfolio tab to seed the award template.</p>
      ) : teams.map((t) => (
        <button key={t.team_season_id} style={s.row} onClick={() => navigate(`/teams/season/${t.team_season_id}`)}>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={s.team}>{t.team_label}</div>
            <div style={s.meta}>{AWARD_LABEL[t.award_target] ?? t.award_target} · {STATUS_LABEL[t.status] ?? t.status} · {t.done_count}/{t.piece_count} pieces done</div>
          </div>
          <div style={s.progWrap}>
            <div style={s.progTrack}><div style={{ ...s.progFill, width: `${t.progress_pct}%` }} /></div>
            <span style={s.pct}>{t.progress_pct}%</span>
          </div>
          <ChevronRight size={16} style={{ color: "#889" }} />
        </button>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  crossLink: { padding: "8px 14px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#00695c" },
  sub: { color: "#667", fontSize: 14, margin: "6px 0 16px" },
  muted: { color: "#889", fontSize: 14, padding: "1rem 0" },
  row: { display: "flex", alignItems: "center", gap: 14, width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px", marginBottom: 10, cursor: "pointer" },
  team: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  meta: { fontSize: 12.5, color: "#667", marginTop: 3 },
  progWrap: { width: 140, display: "flex", alignItems: "center", gap: 8 },
  progTrack: { flex: 1, height: 8, background: "#eef2f7", borderRadius: 5, overflow: "hidden" },
  progFill: { height: "100%", background: "#00695c", borderRadius: 5 },
  pct: { fontSize: 12, fontWeight: 700, color: "#455", width: 34, textAlign: "right" },
};
