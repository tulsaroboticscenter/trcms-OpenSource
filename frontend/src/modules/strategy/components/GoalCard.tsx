/** A single goal card: progress bar, at-risk/status badge, owner, metric, quick actions. */
import type { SeasonGoal } from "../api";
import { CATEGORY_LABELS } from "../api";
import { AlertTriangle, CheckCircle2, Target } from "lucide-react";

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: "#eceff1", fg: "#607d8b" },
  active: { label: "Active", bg: "#e3f2fd", fg: "#1565c0" },
  achieved: { label: "Achieved", bg: "#e8f5e9", fg: "#2e7d32" },
  missed: { label: "Missed", bg: "#ffebee", fg: "#c62828" },
  archived: { label: "Archived", bg: "#eceff1", fg: "#90a4ae" },
};

function metricText(g: SeasonGoal): string {
  if (g.metric_type === "milestone") return g.status === "achieved" ? "Done" : "Not done";
  const cur = g.metric_type === "currency" ? `$${g.current_value}` : `${g.current_value}`;
  const tgt = g.target_value != null ? (g.metric_type === "currency" ? `$${g.target_value}` : `${g.target_value}`) : "—";
  const unit = g.unit && g.metric_type !== "currency" && g.metric_type !== "percent" ? ` ${g.unit}` : g.metric_type === "percent" ? "%" : "";
  return `${cur} / ${tgt}${unit}`;
}

export default function GoalCard({ goal, children }: { goal: SeasonGoal; children?: React.ReactNode }) {
  const st = STATUS_STYLE[goal.status] ?? STATUS_STYLE.active;
  const barColor = goal.at_risk ? "#e65100" : goal.status === "achieved" ? "#2e7d32" : "#1565c0";
  return (
    <div style={s.card}>
      <div style={s.head}>
        <span style={s.cat}>{CATEGORY_LABELS[goal.category]}</span>
        <span style={{ ...s.badge, background: st.bg, color: st.fg }}>{st.label}</span>
        {goal.at_risk && <span style={{ ...s.badge, ...s.risk }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> At risk</span>}
        {goal.status === "achieved" && <CheckCircle2 size={16} color="#2e7d32" />}
        {goal.priority === "high" && <span style={s.prio}>High</span>}
      </div>
      <div style={s.title}><Target size={14} style={{ verticalAlign: -2, marginRight: 5, color: "#546e7a" }} />{goal.title}</div>
      {goal.description && <div style={s.desc}>{goal.description}</div>}

      <div style={s.meterRow}>
        <div style={s.meterTrack}><div style={{ ...s.meterFill, width: `${goal.progress_pct}%`, background: barColor }} /></div>
        <span style={s.pct}>{goal.progress_pct}%</span>
      </div>
      <div style={s.metaRow}>
        <span>{metricText(goal)}</span>
        {goal.owner && <span style={s.owner}>{goal.owner.name}</span>}
        {goal.due_date && <span style={{ color: goal.at_risk ? "#e65100" : "#889" }}>due {new Date(goal.due_date + "T00:00:00").toLocaleDateString()}</span>}
        {goal.elapsed_pct != null && <span style={s.dim}>{goal.elapsed_pct}% time elapsed</span>}
      </div>
      {children && <div style={s.actions}>{children}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: "#fff" },
  head: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  cat: { fontSize: 10.5, fontWeight: 700, color: "#546e7a", background: "#eceff1", borderRadius: 5, padding: "2px 7px", textTransform: "uppercase", letterSpacing: 0.3 },
  badge: { fontSize: 10.5, fontWeight: 700, borderRadius: 5, padding: "2px 7px" },
  risk: { background: "#fff3e0", color: "#e65100" },
  prio: { fontSize: 10, fontWeight: 700, color: "#c62828", marginLeft: "auto" },
  title: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  desc: { fontSize: 12.5, color: "#667", marginTop: 3, lineHeight: 1.5 },
  meterRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  meterTrack: { flex: 1, height: 8, background: "#eef2f7", borderRadius: 5, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 5 },
  pct: { fontSize: 12, fontWeight: 700, color: "#455", width: 38, textAlign: "right" },
  metaRow: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 7, fontSize: 12, color: "#556" },
  owner: { fontWeight: 600, color: "#1a3a5c" },
  dim: { color: "#98a3b0" },
  actions: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" },
};
