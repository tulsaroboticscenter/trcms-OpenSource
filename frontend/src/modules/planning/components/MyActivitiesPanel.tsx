import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { planningApi, type PlanActivity, type TeamTask, type MeetingActionItem, STATUS_META } from "../api";
import { CalendarClock, ClipboardList, ListChecks, NotebookPen } from "lucide-react";

/**
 * "My Activities" — the logged-in member's open season activities (lead/owner)
 * plus team tasks they've claimed. Shown on the dashboard and the profile.
 */
export default function MyActivitiesPanel({ memberId }: { memberId: number }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{ activities: PlanActivity[]; tasks: TeamTask[]; action_items: MeetingActionItem[] } | null>(null);

  useEffect(() => {
    planningApi.myAssignments(memberId).then(setData).catch(() => setData({ activities: [], tasks: [], action_items: [] }));
  }, [memberId]);

  if (data === null) return <p style={st.muted}>Loading…</p>;
  const { activities, tasks } = data;
  const actionItems = data.action_items ?? [];
  if (activities.length === 0 && tasks.length === 0 && actionItems.length === 0) {
    return <p style={st.muted}>You have no assigned activities, tasks, or action items right now.</p>;
  }

  const fmtDate = (d?: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const overdue = (d?: string | null) => !!d && new Date(d + "T00:00:00") < new Date(new Date().toDateString());

  return (
    <div style={st.wrap}>
      {activities.length > 0 && (
        <div>
          <div style={st.sectionHead}><ListChecks size={13} /> Season Activities</div>
          <div style={st.list}>
            {activities.map((a) => {
              const meta = STATUS_META[a.status];
              return (
                <div key={`a${a.id}`} style={st.row}
                  onClick={() => navigate(`/teams/season/${a.team_season_id}?activity=${a.id}`)}>
                  <span style={{ ...st.dot, background: meta.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={st.name}>{a.name}{a.role === "lead" && <span style={st.leadTag}>lead</span>}</div>
                    <div style={st.sub}>
                      {a.team_name && <span>{a.team_name}</span>}
                      <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                      {a.is_blocked && <span style={st.blocked}>blocked</span>}
                    </div>
                  </div>
                  {a.target_date && (
                    <span style={{ ...st.due, color: overdue(a.target_date) ? "#c62828" : "#888" }}>
                      <CalendarClock size={11} /> {fmtDate(a.target_date)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tasks.length > 0 && (
        <div>
          <div style={st.sectionHead}><ClipboardList size={13} /> Tasks I've Claimed</div>
          <div style={st.list}>
            {tasks.map((t) => (
              <div key={`t${t.id}`} style={st.row}
                onClick={() => navigate(`/team-tasks/${t.team_season_id ?? "trc"}?task=${t.id}`)}>
                <span style={{ ...st.dot, background: "#1565c0" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={st.name}>{t.title}</div>
                  {t.team_name && <div style={st.sub}><span>{t.team_name}</span></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {actionItems.length > 0 && (
        <div>
          <div style={st.sectionHead}><NotebookPen size={13} /> Meeting Action Items</div>
          <div style={st.list}>
            {actionItems.map((a) => (
              <div key={`ai${a.id}`} style={st.row} onClick={() => navigate(`/minutes/${a.meeting_id}`)}>
                <span style={{ ...st.dot, background: "#00838f" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={st.name}>{a.description}</div>
                  <div style={st.sub}><span>{a.group_label} · {a.meeting_title}</span></div>
                </div>
                {a.due_date && (
                  <span style={{ ...st.due, color: overdue(a.due_date) ? "#c62828" : "#888" }}>
                    <CalendarClock size={11} /> {fmtDate(a.due_date)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 },
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  sectionHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8, cursor: "pointer" },
  dot: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  leadTag: { marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 8, padding: "1px 6px", textTransform: "uppercase" },
  sub: { display: "flex", gap: 10, fontSize: 12, color: "#888", marginTop: 2, flexWrap: "wrap" },
  blocked: { color: "#e65100", fontWeight: 600 },
  due: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, flexShrink: 0 },
};
