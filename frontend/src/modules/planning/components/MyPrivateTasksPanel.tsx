import { useState, useEffect, useCallback } from "react";
import { planningApi, type TeamTask } from "../api";
import { ListChecks, CalendarClock, Check, Loader2 } from "lucide-react";

/**
 * MyPrivateTasksPanel — the logged-in member's private, personally-assigned tasks.
 *
 * These are tasks a manager directed at this one member from the TRC Task board;
 * they never appear on the shared board, only here. The member can mark each one
 * done. Renders nothing (so the dashboard pane collapses) when there are none —
 * which is why it isn't gated on planning-module visibility: any member can be
 * assigned a private task and must be able to see it.
 */
export default function MyPrivateTasksPanel() {
  const [tasks, setTasks] = useState<TeamTask[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    planningApi.myTasks(false).then(setTasks).catch(() => setTasks([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function markDone(id: number) {
    setBusy(id);
    try { await planningApi.completeTask(id); load(); }
    finally { setBusy(null); }
  }

  if (!tasks || tasks.length === 0) return null;

  const fmtDate = (d?: string | null) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const overdue = (d?: string | null) => !!d && new Date(d + "T00:00:00") < new Date(new Date().toDateString());

  return (
    <div style={st.pane}>
      <div style={st.head}><ListChecks size={15} /> My Tasks <span style={st.count}>{tasks.length}</span></div>
      <div style={st.list}>
        {tasks.map((t) => (
          <div key={t.id} style={st.row}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={st.title}>{t.title}</div>
              <div style={st.sub}>
                {t.due_date && (
                  <span style={{ ...st.due, color: overdue(t.due_date) ? "#c62828" : "#888" }}>
                    <CalendarClock size={11} /> Due {fmtDate(t.due_date)}
                  </span>
                )}
                {t.category && <span style={st.cat}>{t.category}</span>}
                {t.progress_pct != null && <span>{t.progress_pct}%</span>}
              </div>
            </div>
            <button style={st.doneBtn} disabled={busy === t.id} onClick={() => markDone(t.id)}>
              {busy === t.id ? <Loader2 size={13} /> : <Check size={13} />} Done
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  pane: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 18 },
  head: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 12 },
  count: { fontSize: 11, fontWeight: 700, background: "#e7edf5", color: "#1a3a5c", borderRadius: 10, padding: "1px 8px" },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: "1px solid #eef1f5", borderRadius: 8 },
  title: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  sub: { display: "flex", gap: 10, fontSize: 12, color: "#888", marginTop: 2, flexWrap: "wrap", alignItems: "center" },
  due: { display: "inline-flex", alignItems: "center", gap: 3 },
  cat: { fontSize: 11, fontWeight: 600, background: "#f1f5f9", color: "#5b6b7c", borderRadius: 8, padding: "1px 7px" },
  doneBtn: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, padding: "6px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", flexShrink: 0 },
};
