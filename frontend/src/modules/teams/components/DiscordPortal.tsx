/**
 * DiscordPortal — shows Discord channel links for the current user's teams.
 * Embedded on the Dashboard for parents and youth members.
 * Shows only the channels relevant to the user's active team assignments.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../../../core/AuthContext";
import { teamsApi, type MemberTeamAssignment, type TeamSeasonDetail } from "../api";
import { ExternalLink } from "lucide-react";

interface DiscordLink { name: string; url: string; }

interface TeamWithDiscord {
  teamNumber: string;
  teamName?: string;
  links: DiscordLink[];
}

export default function DiscordPortal() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<TeamWithDiscord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    teamsApi.getMemberTeams(user.id).then(async (assignments: MemberTeamAssignment[]) => {
      const active = assignments.filter((a) => a.status === "active" && a.team_season_id);
      // Rosters roll forward, so a member is usually rostered on the SAME team in
      // more than one season — listing that team's channels once per season. Keep
      // only each team's newest season ("YYYY-YYYY" sorts correctly as a string).
      const newestByTeam = new Map<number, MemberTeamAssignment>();
      for (const a of active) {
        const prev = newestByTeam.get(a.team_id);
        if (!prev || (a.season ?? "") > (prev.season ?? "")) newestByTeam.set(a.team_id, a);
      }
      const results: TeamWithDiscord[] = [];
      for (const a of newestByTeam.values()) {
        if (!a.team_season_id) continue;
        try {
          const season: TeamSeasonDetail = await teamsApi.getSeason(a.team_season_id);
          let links: DiscordLink[] = [];
          try { links = season.discord_links ? JSON.parse(season.discord_links) : []; } catch { /* ignore */ }
          if (links.length > 0) {
            results.push({
              teamNumber: a.team_number,
              teamName: a.team_name,
              links,
            });
          }
        } catch { /* skip teams that fail to load */ }
      }
      setTeams(results);
    }).finally(() => setLoading(false));
  }, [user]);

  if (loading || teams.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.discordLogo}>💬</span>
        <span style={styles.title}>Your Team Discord Channels</span>
      </div>
      {teams.map((t) => (
        <div key={t.teamNumber} style={styles.teamSection}>
          <div style={styles.teamLabel}>#{t.teamNumber} {t.teamName}</div>
          {t.links.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" style={styles.link}>
              <span style={styles.channelIcon}>#</span>
              <span style={styles.channelName}>{link.name}</span>
              <ExternalLink size={11} style={{ marginLeft: "auto", opacity: 0.4 }} />
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { background: "#36393f", borderRadius: 10, padding: "1rem 1.25rem", marginTop: 20 },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  discordLogo: { fontSize: 18 },
  title: { fontSize: 13, fontWeight: 700, color: "#fff" },
  teamSection: { marginBottom: 10 },
  teamLabel: { fontSize: 11, fontWeight: 700, color: "#96989d", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 },
  link: { display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, color: "#dcddde", textDecoration: "none", fontSize: 13, background: "rgba(255,255,255,0.05)", marginBottom: 3 },
  channelIcon: { color: "#96989d", fontWeight: 900, fontSize: 15 },
  channelName: { flex: 1 },
};
