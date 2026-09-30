import { useEffect, useMemo, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Download, TrendingUp } from "lucide-react";
import { trendsApi, type TrendMetric, type TrendSeries } from "../api";

const PERIODS = [
  { id: "month", label: "Monthly" },
  { id: "quarter", label: "Quarterly" },
  { id: "year", label: "Yearly" },
  { id: "week", label: "Weekly" },
];

const DIM_LABELS: Record<string, string> = {
  team: "Team", program: "Program", event_type: "Event type", source: "Source",
  source_type: "Source", member_type: "Member type", certification: "Certification",
  status: "Status", category: "Category", stage: "Stage",
};

const COLORS = ["#1565c0", "#2e7d32", "#e65100", "#6a1b9a", "#00838f", "#c62828", "#f9a825", "#5d4037", "#455a64", "#ad1457"];

function fmt(unit: TrendMetric["unit"], v: number): string {
  switch (unit) {
    case "currency": return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "percent": return v.toFixed(1) + "%";
    case "hours": return v.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " h";
    case "years": return v.toFixed(1) + " yr";
    case "ratio": return v.toFixed(2);
    default: return v.toLocaleString();
  }
}

type Line = { key: string; label: string; color: string; values: Map<string, number> };

export default function TrendsReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [metrics, setMetrics] = useState<TrendMetric[]>([]);
  const [metricKey, setMetricKey] = useState<string>("");
  const [period, setPeriod] = useState("month");
  const [breakdown, setBreakdown] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [series, setSeries] = useState<TrendSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    trendsApi.listMetrics().then((m) => {
      setMetrics(m);
      if (m.length && !metricKey) setMetricKey(m[0].key);
    }).catch(() => setErr("Could not load metrics."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = metrics.find((m) => m.key === metricKey);

  // Reset breakdown if the new metric doesn't support the current one.
  useEffect(() => {
    if (breakdown && current && !current.available_breakdowns.includes(breakdown)) setBreakdown("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricKey]);

  useEffect(() => {
    if (!metricKey) return;
    setLoading(true);
    setErr("");
    trendsApi.getSeries({ metric: metricKey, period, from: from || undefined, to: to || undefined, breakdown: breakdown || undefined })
      .then(setSeries)
      .catch((e) => setErr(e?.response?.data?.detail ?? "Could not load this trend."))
      .finally(() => setLoading(false));
  }, [metricKey, period, from, to, breakdown]);

  // Ordered period keys along the x-axis.
  const periodKeys = useMemo(() => {
    if (!series) return [];
    const seen = new Map<string, string>();
    for (const p of series.points) seen.set(p.period_key, p.period_start);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k]) => k);
  }, [series]);

  // Build one Line per series (or a single total line when no breakdown).
  const lines = useMemo<Line[]>(() => {
    if (!series) return [];
    if (series.breakdown && series.series?.length) {
      // Rank series by total so the biggest get stable colors; cap legend at 10.
      const totals = new Map<string, number>();
      for (const p of series.points) totals.set(p.scope_id, (totals.get(p.scope_id) ?? 0) + p.value);
      const ranked = (series.series ?? []).slice().sort((a, b) => (totals.get(b.scope_id) ?? 0) - (totals.get(a.scope_id) ?? 0)).slice(0, 10);
      return ranked.map((s, i) => {
        const values = new Map<string, number>();
        for (const p of series.points) if (p.scope_id === s.scope_id) values.set(p.period_key, (values.get(p.period_key) ?? 0) + p.value);
        return { key: s.scope_id, label: s.label, color: COLORS[i % COLORS.length], values };
      });
    }
    const values = new Map<string, number>();
    for (const p of series.points) values.set(p.period_key, (values.get(p.period_key) ?? 0) + p.value);
    return [{ key: "total", label: series.label, color: COLORS[0], values }];
  }, [series]);

  const grouped = useMemo(() => {
    const g: Record<string, TrendMetric[]> = {};
    for (const m of metrics) (g[m.domain] ??= []).push(m);
    return g;
  }, [metrics]);

  const hasData = lines.some((l) => [...l.values.values()].some((v) => v !== 0)) || periodKeys.length > 0;

  function exportCsv() {
    if (!series || !periodKeys.length) return;
    const head = ["Period", ...lines.map((l) => l.label)];
    const rows = periodKeys.map((pk) => [pk, ...lines.map((l) => l.values.get(pk) ?? 0)].join(","));
    const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trend_${series.metric}${series.breakdown ? "_by_" + series.breakdown : ""}_${series.period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Reports</button>
      <div style={st.head}>
        <div>
          <h1 style={st.heading}><TrendingUp size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Trends &amp; Analytics</h1>
          <p style={st.sub}>Track any program metric over time. Event-based metrics reach back through your history; snapshot metrics build from when nightly capture started. Drill into a metric by team, program, or type.</p>
        </div>
        {hasData && canRead("reports.export") && <button style={st.csvBtn} onClick={exportCsv}><Download size={14} /> CSV</button>}
      </div>

      <div style={st.controls}>
        <label style={st.field}>
          <span style={st.lbl}>Metric</span>
          <select style={st.select} value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
            {Object.entries(grouped).map(([domain, ms]) => (
              <optgroup key={domain} label={domain}>
                {ms.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {current && current.available_breakdowns.length > 0 && (
          <label style={st.field}>
            <span style={st.lbl}>Break down by</span>
            <select style={st.select} value={breakdown} onChange={(e) => setBreakdown(e.target.value)}>
              <option value="">— None (total) —</option>
              {current.available_breakdowns.map((d) => <option key={d} value={d}>{DIM_LABELS[d] ?? d}</option>)}
            </select>
          </label>
        )}
        <label style={st.field}>
          <span style={st.lbl}>Grain</span>
          <select style={st.select} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label style={st.field}>
          <span style={st.lbl}>From</span>
          <input type="date" style={st.input} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={st.field}>
          <span style={st.lbl}>To</span>
          <input type="date" style={st.input} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {current && (
        <div style={st.metaRow}>
          <span style={{ ...st.badge, background: current.mechanism === "snapshot" ? "#e8f0fe" : "#e6f4ea", color: current.mechanism === "snapshot" ? "#1565c0" : "#2e7d32" }}>
            {current.mechanism === "snapshot" ? "Snapshot metric" : "Event-based metric"}
          </span>
          {current.sensitivity === "financial" && <span style={{ ...st.badge, background: "#fdecea", color: "#c62828" }}>Financial</span>}
          <span style={st.domainTag}>{current.domain}</span>
        </div>
      )}

      {err && <p style={st.err}>{err}</p>}
      {loading && <p style={st.muted}>Loading…</p>}

      {!loading && series && current && (
        periodKeys.length === 0
          ? <p style={st.muted}>No data in this range yet.{current.mechanism === "snapshot" ? " Snapshot metrics start accumulating once the nightly capture job runs." : ""}</p>
          : <>
              <Chart periodKeys={periodKeys} lines={lines} unit={current.unit} />
              {lines.length > 1 && (
                <div style={st.legend}>
                  {lines.map((l) => (
                    <span key={l.key} style={st.legendItem}>
                      <span style={{ ...st.legendDot, background: l.color }} />{l.label}
                    </span>
                  ))}
                </div>
              )}
              <div style={st.tableWrap}>
                <table style={st.table}>
                  <thead>
                    <tr>
                      <th style={st.th}>Period</th>
                      {lines.map((l) => <th key={l.key} style={{ ...st.th, textAlign: "right" }}>{l.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {periodKeys.map((pk) => (
                      <tr key={pk}>
                        <td style={st.td}>{pk}</td>
                        {lines.map((l) => (
                          <td key={l.key} style={{ ...st.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {fmt(current.unit, l.values.get(pk) ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
      )}
    </div>
  );
}

function Chart({ periodKeys, lines, unit }: { periodKeys: string[]; lines: Line[]; unit: TrendMetric["unit"] }) {
  const W = 720, H = 240, padL = 56, padB = 34, padT = 12, padR = 12;
  const allVals = lines.flatMap((l) => periodKeys.map((k) => l.values.get(k) ?? 0));
  const max = Math.max(1, ...allVals);
  const min = Math.min(0, ...allVals);
  const span = max - min || 1;
  const n = periodKeys.length;
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - min) / span);
  const ticks = 4;

  return (
    <div style={st.chartWrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} preserveAspectRatio="xMidYMid meet">
        {Array.from({ length: ticks + 1 }, (_, t) => {
          const v = min + (span * t) / ticks;
          const yy = y(v);
          return (
            <g key={t}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#eef2f6" />
              <text x={padL - 8} y={yy + 3} textAnchor="end" fontSize="10" fill="#999">{fmt(unit, v)}</text>
            </g>
          );
        })}
        {lines.map((l) => {
          const path = periodKeys.map((k, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(l.values.get(k) ?? 0).toFixed(1)}`).join(" ");
          return (
            <g key={l.key}>
              <path d={path} fill="none" stroke={l.color} strokeWidth={2} />
              {periodKeys.map((k, i) => <circle key={k} cx={x(i)} cy={y(l.values.get(k) ?? 0)} r={2.5} fill={l.color} />)}
            </g>
          );
        })}
        {periodKeys.map((k, i) => (
          (n <= 14 || i % Math.ceil(n / 12) === 0) &&
            <text key={k} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize="9" fill="#888">{k}</text>
        ))}
      </svg>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 16 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#888", maxWidth: 640, lineHeight: 1.5 },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  controls: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  select: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, background: "#fff", minWidth: 180 },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  metaRow: { display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" },
  badge: { padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 },
  domainTag: { fontSize: 12, color: "#999" },
  chartWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 10 },
  legend: { display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: "0 4px" },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" },
  legendDot: { width: 10, height: 10, borderRadius: 3, display: "inline-block" },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 480 },
  th: { textAlign: "left", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc", whiteSpace: "nowrap" },
  td: { padding: "9px 14px", fontSize: 14, color: "#333", borderBottom: "1px solid #f2f5f8", whiteSpace: "nowrap" },
  err: { color: "#c62828", fontSize: 14 },
  muted: { color: "#aaa", fontSize: 14 },
};
