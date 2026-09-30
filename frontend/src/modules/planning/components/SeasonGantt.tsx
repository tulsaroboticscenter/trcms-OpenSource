import { useMemo } from "react";
import { type PlanCategory, type PlanActivity, type SeasonDeadline, STATUS_META } from "../api";

/**
 * Season Plan Gantt (#123). Renders each scheduled activity (those with a start
 * and target date) as a bar on a shared timeline, grouped by category, with a
 * "today" line and month gridlines. Bars fill by % complete; blocked activities
 * are flagged. Activities missing dates are listed as unscheduled.
 */
const LABEL_W = 190;

export default function SeasonGantt({ categories, deadlines = [], onOpen }: {
  categories: PlanCategory[];
  deadlines?: SeasonDeadline[];
  onOpen?: (a: PlanActivity) => void;
}) {
  const model = useMemo(() => build(categories, deadlines), [categories, deadlines]);
  if (!model) {
    return <p style={st.muted}>Add start and target dates to activities to see them on the timeline.</p>;
  }
  const { rows, months, todayFrac, unscheduled, deadlineMarks } = model;
  const pos = (frac: number) => `calc((100% - ${LABEL_W}px) * ${frac} + ${LABEL_W}px)`;

  return (
    <div>
      <div style={st.chart}>
        {/* Month gridlines + labels */}
        <div style={st.header}>
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div style={st.headerTrack}>
            {months.map((m) => (
              <div key={m.key} style={{ ...st.monthLabel, left: `${m.frac * 100}%` }}>{m.label}</div>
            ))}
          </div>
        </div>

        <div style={st.body}>
          {/* Vertical month lines across all rows */}
          {months.map((m) => (
            <div key={m.key} style={{ ...st.gridline, left: pos(m.frac) }} />
          ))}
          {/* Today line */}
          {todayFrac !== null && <div style={{ ...st.todayLine, left: pos(todayFrac) }} title="Today" />}
          {/* Deadline markers */}
          {deadlineMarks.map((d) => (
            <div key={d.id} style={{ ...st.dlLine, left: pos(d.frac) }} title={`${d.name} — ${d.date}`}>
              <span style={st.dlFlag}>⚑ {d.name}</span>
            </div>
          ))}

          {rows.map((row) => row.kind === "cat" ? (
            <div key={row.key} style={st.catRow}>
              <span style={{ ...st.catName, borderColor: row.color || "#cdd7e3" }}>{row.name}</span>
            </div>
          ) : (
            <div key={row.key} style={st.actRow}>
              <div style={st.actLabel} title={row.a.name}>{row.a.name}</div>
              <div style={st.track}>
                <div
                  onClick={() => onOpen?.(row.a)}
                  title={`${row.a.name} · ${row.a.start_date} → ${row.a.target_date} · ${row.a.percent_complete}%${row.a.is_blocked ? " · blocked" : ""}`}
                  style={{
                    ...st.bar,
                    left: `${row.left * 100}%`,
                    width: `${Math.max(row.width * 100, 1.5)}%`,
                    background: (STATUS_META[row.a.status]?.color ?? "#90a4ae") + "33",
                    borderColor: STATUS_META[row.a.status]?.color ?? "#90a4ae",
                    cursor: onOpen ? "pointer" : "default",
                  }}
                >
                  <div style={{ ...st.barFill, width: `${row.a.percent_complete}%`, background: STATUS_META[row.a.status]?.color ?? "#90a4ae" }} />
                  {row.a.is_blocked && <span style={st.blockDot} title="Blocked">⚠</span>}
                  <span style={st.barPct}>{row.a.percent_complete}%</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <p style={st.unsched}>
          <strong>Not on the timeline</strong> (missing a start or target date): {unscheduled.map((a) => a.name).join(", ")}
        </p>
      )}
    </div>
  );
}

type Row =
  | { kind: "cat"; key: string; name: string; color?: string }
  | { kind: "act"; key: string; a: PlanActivity; left: number; width: number };

function build(categories: PlanCategory[], deadlines: SeasonDeadline[]) {
  const parse = (s?: string | null) => (s ? new Date(s + "T00:00:00").getTime() : null);
  const scheduled: PlanActivity[] = [];
  const unscheduled: PlanActivity[] = [];
  for (const c of categories) for (const a of c.activities) {
    (a.start_date && a.target_date ? scheduled : unscheduled).push(a);
  }
  if (scheduled.length === 0) return null;

  let min = Infinity, max = -Infinity;
  for (const a of scheduled) {
    const s = parse(a.start_date)!, t = parse(a.target_date)!;
    min = Math.min(min, s, t); max = Math.max(max, s, t);
  }
  for (const d of deadlines) { const t = parse(d.deadline_date); if (t !== null) { min = Math.min(min, t); max = Math.max(max, t); } }
  // Pad the domain by ~5% so end bars aren't flush against the edge.
  const span = Math.max(max - min, 86400000);
  const pad = span * 0.04;
  min -= pad; max += pad;
  const total = max - min;
  const frac = (t: number) => (t - min) / total;

  const rows: Row[] = [];
  for (const c of categories) {
    const acts = c.activities.filter((a) => a.start_date && a.target_date);
    if (acts.length === 0) continue;
    rows.push({ kind: "cat", key: `c${c.id}`, name: c.name, color: c.color });
    for (const a of acts) {
      const s = parse(a.start_date)!, t = parse(a.target_date)!;
      rows.push({ kind: "act", key: `a${a.id}`, a, left: frac(s), width: Math.max(frac(t) - frac(s), 0) });
    }
  }

  // Month gridlines
  const months: { key: string; label: string; frac: number }[] = [];
  const d = new Date(min); d.setDate(1); d.setHours(0, 0, 0, 0);
  const end = new Date(max);
  while (d <= end) {
    const t = d.getTime();
    if (t >= min && t <= max) {
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), frac: frac(t) });
    }
    d.setMonth(d.getMonth() + 1);
  }

  const now = Date.now();
  const todayFrac = now >= min && now <= max ? frac(now) : null;

  const deadlineMarks = deadlines
    .map((d) => ({ id: d.id, name: d.name, date: d.deadline_date, t: parse(d.deadline_date) }))
    .filter((d): d is { id: number; name: string; date: string; t: number } => d.t !== null)
    .map((d) => ({ id: d.id, name: d.name, date: d.date, frac: frac(d.t) }));

  return { rows, months, todayFrac, unscheduled, deadlineMarks };
}

const st: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#889", margin: "8px 0" },
  chart: { border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", overflow: "hidden" },
  header: { display: "flex", height: 26, borderBottom: "1px solid #eef1f5", position: "relative" },
  headerTrack: { position: "relative", flex: 1 },
  monthLabel: { position: "absolute", top: 5, transform: "translateX(2px)", fontSize: 10.5, color: "#8a97a8", fontWeight: 600, whiteSpace: "nowrap" },
  body: { position: "relative", padding: "6px 0" },
  gridline: { position: "absolute", top: 0, bottom: 0, width: 1, background: "#f0f3f7", pointerEvents: "none" },
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 2, background: "#e53935", opacity: 0.6, pointerEvents: "none", zIndex: 2 },
  dlLine: { position: "absolute", top: 0, bottom: 0, width: 2, background: "#fb8c00", opacity: 0.75, zIndex: 3 },
  dlFlag: { position: "absolute", top: 0, left: 3, fontSize: 10, fontWeight: 700, color: "#e65100", background: "#fff3e0", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" },
  catRow: { display: "flex", alignItems: "center", height: 26, padding: "2px 0" },
  catName: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.3, borderLeft: "3px solid", paddingLeft: 8, marginLeft: 8 },
  actRow: { display: "flex", alignItems: "center", height: 30 },
  actLabel: { width: LABEL_W, flexShrink: 0, paddingLeft: 20, paddingRight: 8, fontSize: 12.5, color: "#37474f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box" },
  track: { position: "relative", flex: 1, height: 22 },
  bar: { position: "absolute", top: 0, height: 22, borderRadius: 5, border: "1px solid", display: "flex", alignItems: "center", overflow: "hidden", minWidth: 3 },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.55, borderRadius: 4 },
  barPct: { position: "relative", fontSize: 10, fontWeight: 700, color: "#33404d", marginLeft: 6, zIndex: 1, whiteSpace: "nowrap" },
  blockDot: { position: "relative", fontSize: 10, marginLeft: 4, zIndex: 1 },
  unsched: { fontSize: 12.5, color: "#778", marginTop: 10, lineHeight: 1.5 },
};
