import { useState, useEffect, useCallback } from "react";
import { activityApi, fmtMinutes, type TeamImpact } from "../api";
import { useAuth } from "../../../core/AuthContext";
import LogTimeModal from "./LogTimeModal";
import { Clock, Heart, Users, Plus } from "lucide-react";

/** Team season time impact — total hours by area + community/outreach hours. */
export default function TeamTimeImpactPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const { user, canWrite } = useAuth();
  const canLog = canWrite("activity.log");
  const [data, setData] = useState<TeamImpact | null>(null);
  const [logging, setLogging] = useState(false);

  const load = useCallback(() => {
    activityApi.teamSummary(teamSeasonId).then(setData).catch(() => setData(null));
  }, [teamSeasonId]);
  useEffect(() => { load(); }, [load]);

  const empty = data === null || data.total_minutes === 0;

  return (
    <div>
      {canLog && (
        <div style={st.head}>
          <button style={st.logBtn} onClick={() => setLogging(true)}><Plus size={14} /> Log time for this team</button>
        </div>
      )}

      {empty ? (
        <div style={st.emptyBox}>
          <p style={st.emptyTitle}>No time credited to this team yet.</p>
          <p style={st.emptyHint}>
            Time shows here when someone credits it to the team — from the <strong>Credit to a team</strong> option on
            their <em>My Time</em> log, or the <strong>Log time</strong> button on the team's Season Plan activities and
            Team Task board{canLog ? ", or the button above" : ""}. Personal time that isn't credited to a team won't appear here.
          </p>
        </div>
      ) : (
        <>
          <div style={st.stats}>
            <span style={st.chip}><Clock size={14} color="#1565c0" /> {fmtMinutes(data!.total_minutes)} total</span>
            <span style={st.chip}><Heart size={14} color="#2e7d32" /> {fmtMinutes(data!.volunteer_minutes)} community</span>
            <span style={st.chip}><Users size={14} color="#6a1b9a" /> {data!.contributors} contributor{data!.contributors !== 1 ? "s" : ""}</span>
          </div>
          <div style={st.bars}>
            {Object.entries(data!.by_area).sort((a, b) => b[1] - a[1]).map(([area, mins]) => {
              const pct = data!.total_minutes ? Math.round((mins / data!.total_minutes) * 100) : 0;
              return (
                <div key={area} style={st.row}>
                  <span style={st.label}>{area}</span>
                  <div style={st.track}><div style={{ ...st.fill, width: `${pct}%` }} /></div>
                  <span style={st.val}>{fmtMinutes(mins)}</span>
                </div>
              );
            })}
          </div>
          {(data!.by_member?.length ?? 0) > 0 && (
            <div style={st.people}>
              <div style={st.peopleHead}><Users size={13} color="#6a1b9a" /> Who contributed</div>
              {data!.by_member.map((p) => {
                const pct = data!.total_minutes ? Math.round((p.minutes / data!.total_minutes) * 100) : 0;
                return (
                  <div key={p.member_id} style={st.row}>
                    <span style={st.pName} title={p.name}>{p.name}</span>
                    <div style={st.track}><div style={{ ...st.fill, width: `${pct}%`, background: "#6a1b9a" }} /></div>
                    <span style={st.val}>{fmtMinutes(p.minutes)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {logging && user && (
        <LogTimeModal
          memberId={user.id}
          title="Log time for this team"
          context={{ team_season_id: teamSeasonId }}
          onClose={() => setLogging(false)}
          onSaved={() => { setLogging(false); load(); }}
        />
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  head: { display: "flex", justifyContent: "flex-end", marginBottom: 10 },
  logBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#fff", color: "#00695c", border: "1px solid #b2dfdb", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12.5 },
  emptyBox: { background: "#f8fafc", border: "1px solid #e6ecf2", borderRadius: 8, padding: "12px 14px" },
  emptyTitle: { fontSize: 13.5, color: "#556", fontWeight: 700, margin: 0 },
  emptyHint: { fontSize: 12.5, color: "#889", margin: "6px 0 0", lineHeight: 1.5 },
  stats: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  chip: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "#1a3a5c", background: "#f0f4f8", borderRadius: 16, padding: "4px 12px" },
  bars: { display: "flex", flexDirection: "column", gap: 8 },
  people: { display: "flex", flexDirection: "column", gap: 8, marginTop: 18 },
  peopleHead: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#6a1b9a", marginBottom: 2 },
  pName: { width: 160, fontSize: 13, color: "#1a3a5c", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  row: { display: "flex", alignItems: "center", gap: 10 },
  label: { width: 120, fontSize: 13, color: "#1a3a5c", fontWeight: 600 },
  track: { flex: 1, height: 8, background: "#eef2f6", borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", background: "#1565c0" },
  val: { width: 64, textAlign: "right", fontSize: 12, color: "#666" },
};
