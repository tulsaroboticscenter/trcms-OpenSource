/**
 * CertificationLeaderboard — team rankings by certification score.
 * Score = certs completed by active youth members ÷ member count × 100.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { certApi, type Leaderboard } from "../api";
import { ArrowLeft, Trophy, Award, Users } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const MEDAL = ["#f5b301", "#9aa6b2", "#cd7f32"]; // gold, silver, bronze

export default function CertificationLeaderboard() {
  const navigate = useNavigate();
  const goBack = useGoBack("/certifications");
  const [data, setData] = useState<Leaderboard | null>(null);

  useEffect(() => { certApi.leaderboard().then(setData).catch(() => {}); }, []);

  if (!data) return <p style={st.muted}>Loading…</p>;
  const maxScore = Math.max(1, ...data.teams.map((t) => t.score));

  return (
    <div>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Certifications</button>
      <h1 style={st.heading}><Trophy size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Team Certification Rankings</h1>
      <p style={st.sub}>Season {data.season} · score = certifications ÷ active youth members × 100</p>

      <div style={st.list}>
        {data.teams.length === 0 ? <p style={st.muted}>No teams with active youth members yet.</p> :
          data.teams.map((t) => (
            <div key={t.team_season_id} style={st.row}
              onClick={() => navigate(`/teams/season/${t.team_season_id}`)}>
              <div style={{ ...st.rank, background: MEDAL[t.rank - 1] ?? "#e2e8f0", color: t.rank <= 3 ? "#fff" : "#888" }}>{t.rank}</div>
              <div style={st.teamMain}>
                <div style={st.teamName}>{t.team_name} <span style={st.teamNum}>#{t.team_number}</span></div>
                <div style={st.bar}><div style={{ ...st.barFill, width: `${(t.score / maxScore) * 100}%` }} /></div>
                <div style={st.teamMeta}>
                  <span><Award size={11} style={{ verticalAlign: "-1px" }} /> {t.certs_completed} certs</span>
                  <span><Users size={11} style={{ verticalAlign: "-1px" }} /> {t.member_count} youth</span>
                </div>
              </div>
              <div style={st.score}>{t.score}</div>
            </div>
          ))}
      </div>

      {data.groups.length > 0 && (
        <>
          <div style={st.groupHead}>Other Groups</div>
          <div style={st.list}>
            {data.groups.map((g) => (
              <div key={g.label} style={{ ...st.row, cursor: "default" }}>
                <div style={{ ...st.rank, background: "#eef2f7", color: "#888" }}>—</div>
                <div style={st.teamMain}>
                  <div style={st.teamName}>{g.label}</div>
                  <div style={st.teamMeta}><span>{g.certs_completed} certs</span><span>{g.member_count} members</span></div>
                </div>
                <div style={st.score}>{g.score}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 16px", fontSize: 13, color: "#888" },
  muted: { color: "#aaa", fontSize: 14, padding: "1rem 0" },
  list: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 },
  row: { display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, cursor: "pointer" },
  rank: { width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 },
  teamMain: { flex: 1, minWidth: 0 },
  teamName: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  teamNum: { fontSize: 12, color: "#888", fontWeight: 500 },
  bar: { height: 7, background: "#eef2f7", borderRadius: 4, overflow: "hidden", margin: "5px 0" },
  barFill: { height: "100%", background: "#6a1b9a" },
  teamMeta: { display: "flex", gap: 14, fontSize: 11, color: "#888" },
  score: { fontSize: 24, fontWeight: 900, color: "#6a1b9a", flexShrink: 0, minWidth: 56, textAlign: "right" },
  groupHead: { fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
};
