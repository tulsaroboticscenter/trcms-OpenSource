import { useState, useEffect } from "react";
import { planningApi, type MemberBrief, type PlanningTeam } from "../api";
import { X, Search, Users } from "lucide-react";

/**
 * Prompts for which team member is taking an action (claim/complete a task).
 * Lists active youth + mentors of the team. Designed to be touch-friendly for kiosks.
 * Optionally offers whole teams (used when completing a task a team did together).
 */
export default function MemberPickerModal({ teamSeasonId, fetchMembers, title, teams, onPickTeam, onPick, onClose }: {
  /** Provide either a team-season id (loads that roster) or a custom loader (e.g. TRC pool). */
  teamSeasonId?: number;
  fetchMembers?: () => Promise<MemberBrief[]>;
  title: string;
  /** When provided, teams are offered as an alternative "who did it". */
  teams?: PlanningTeam[];
  onPickTeam?: (team: PlanningTeam) => void;
  onPick: (member: MemberBrief) => void;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<MemberBrief[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const loader = fetchMembers ?? (() => planningApi.teamMembers(teamSeasonId as number));
    loader().then(setMembers).catch(() => setMembers([]));
  }, [teamSeasonId, fetchMembers]);

  const filtered = (members ?? []).filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  const teamMatches = (teams ?? []).filter((t) => t.team_name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.head}>
          <span style={st.title}>{title}</span>
          <button style={st.close} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={st.searchRow}>
          <Search size={15} color="#888" />
          <input style={st.search} placeholder="Search members or teams…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {teams && onPickTeam && teamMatches.length > 0 && (
          <div style={st.teamSection}>
            <div style={st.sectionLabel}>A team completed it</div>
            <div style={st.teamRow}>
              {teamMatches.map((t) => (
                <button key={t.team_season_id} style={st.teamChip} onClick={() => onPickTeam(t)}>
                  <Users size={14} /> {t.team_name}
                </button>
              ))}
            </div>
            <div style={st.sectionLabel}>…or a person</div>
          </div>
        )}
        {members === null ? <p style={st.muted}>Loading…</p> : (
          <div style={st.grid}>
            {filtered.length === 0 && <p style={st.muted}>No matching team members.</p>}
            {filtered.map((m) => (
              <button key={m.member_id} style={st.member} onClick={() => onPick(m)}>
                <div style={{ ...st.avatar, background: m.member_type === "mentor" ? "#2e7d32" : "#1565c0" }}>
                  {m.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </div>
                <div style={st.mInfo}>
                  <div style={st.mName}>{m.name}</div>
                  <div style={st.mType}>{m.member_type === "mentor" ? "Mentor" : "Youth"}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modal: { background: "#fff", borderRadius: 14, padding: "20px 22px", width: "100%", maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 800, color: "#1a3a5c" },
  close: { background: "none", border: "none", cursor: "pointer", color: "#888" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #cdd7e3", borderRadius: 8, padding: "8px 12px", marginBottom: 12 },
  search: { flex: 1, border: "none", outline: "none", fontSize: 15 },
  muted: { color: "#888", fontSize: 14, textAlign: "center", padding: 16 },
  teamSection: { marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: "#00838f", textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0" },
  teamRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  teamChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "#e0f2f1", color: "#00695c", border: "1px solid #b2dfdb", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, overflowY: "auto" },
  member: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, cursor: "pointer", textAlign: "left" },
  avatar: { width: 40, height: 40, borderRadius: "50%", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  mInfo: { minWidth: 0 },
  mName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  mType: { fontSize: 12, color: "#888" },
};
