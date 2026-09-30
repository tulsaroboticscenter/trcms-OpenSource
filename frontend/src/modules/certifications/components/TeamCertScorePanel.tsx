/**
 * TeamCertScorePanel — embedded on the team profile.
 * Shows the team's certification score and each active youth member's count.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { certApi, type TeamCertScore } from "../api";
import CertClassroomLink from "./CertClassroomLink";
import * as Icons from "lucide-react";
import { Award, Trophy, Medal } from "lucide-react";

function BadgeIcon({ name, size = 16, color }: { name?: string; size?: number; color?: string }) {
  const Cmp = (name && (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[name]) || Medal;
  return <Cmp size={size} color={color} />;
}

export default function TeamCertScorePanel({ teamSeasonId }: { teamSeasonId: number }) {
  const navigate = useNavigate();
  const [data, setData] = useState<TeamCertScore | null>(null);

  useEffect(() => { certApi.teamCerts(teamSeasonId).then(setData).catch(() => setData(null)); }, [teamSeasonId]);

  if (!data) return <p style={st.muted}>Loading…</p>;
  const max = Math.max(1, ...data.members.map((m) => m.completed_count));

  return (
    <div>
      <CertClassroomLink />
      <div style={st.score}>
        <Trophy size={18} color="#6a1b9a" />
        <span style={st.scoreNum}>{data.score}</span>
        <span style={st.scoreLabel}>certification score</span>
        <span style={st.detail}>{data.certs_completed} certs · {data.member_count} youth</span>
        <button style={st.lbBtn} onClick={() => navigate("/certifications/leaderboard")}>Rankings →</button>
      </div>
      {data.badges && data.badges.length > 0 && (
        <div style={st.badgeWall}>
          <div style={st.wallLabel}>Team Badge Wall</div>
          <div style={st.wallRow}>
            {data.badges.map((b) => (
              <div key={b.id} style={st.wallBadge} title={`${b.name} — held by ${b.holder_count} member${b.holder_count !== 1 ? "s" : ""}`}>
                <div style={{ ...st.wallCoin, background: b.color }}><BadgeIcon name={b.icon_name} color="#fff" /></div>
                <span style={st.wallCount}>{b.holder_count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.members.length === 0 ? <p style={st.muted}>No active youth members yet.</p> : (
        <div style={st.list}>
          {data.members.map((m) => (
            <div key={m.member_id} style={st.row} onClick={() => navigate(`/members/${m.member_id}`)}>
              <span style={st.name}>{m.last_name}, {m.first_name}</span>
              <div style={st.bar}><div style={{ ...st.barFill, width: `${(m.completed_count / max) * 100}%` }} /></div>
              <span style={st.count}><Award size={11} style={{ verticalAlign: "-1px" }} /> {m.completed_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  score: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "10px 12px", background: "#f3e8fb", border: "1px solid #d9c2ec", borderRadius: 8, flexWrap: "wrap" },
  scoreNum: { fontSize: 24, fontWeight: 900, color: "#6a1b9a", lineHeight: 1 },
  scoreLabel: { fontSize: 13, fontWeight: 600, color: "#5d4070" },
  detail: { fontSize: 12, color: "#888" },
  lbBtn: { marginLeft: "auto", background: "#fff", border: "1px solid #d9c2ec", color: "#6a1b9a", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "5px 11px" },
  badgeWall: { marginBottom: 12 },
  wallLabel: { fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, marginBottom: 6 },
  wallRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  wallBadge: { position: "relative" as const },
  wallCoin: { width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" },
  wallCount: { position: "absolute" as const, bottom: -3, right: -3, background: "#1a3a5c", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 8, padding: "0 5px", border: "1px solid #fff" },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, cursor: "pointer" },
  name: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", width: 150, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bar: { flex: 1, height: 7, background: "#eef2f7", borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", background: "#6a1b9a" },
  count: { fontSize: 12, fontWeight: 700, color: "#6a1b9a", flexShrink: 0, width: 36, textAlign: "right" },
};
