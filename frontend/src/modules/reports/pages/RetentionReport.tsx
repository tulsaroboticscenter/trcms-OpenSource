import { useEffect, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Download, LayoutGrid } from "lucide-react";
import { trendsApi, type RetentionTriangle } from "../api";

const TYPES = [
  { id: "youth", label: "Youth" },
  { id: "mentor", label: "Mentors" },
  { id: "all", label: "Everyone" },
];

// Green heatmap: 0% → pale, 100% → strong.
function cellColor(pct: number | null): string {
  if (pct === null) return "transparent";
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const r = Math.round(232 - t * (232 - 27));
  const g = Math.round(245 - t * (245 - 94));
  const b = Math.round(233 - t * (233 - 32));
  return `rgb(${r},${g},${b})`;
}
function textColor(pct: number | null): string {
  return pct !== null && pct >= 55 ? "#fff" : "#1a3a5c";
}

export default function RetentionReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [memberType, setMemberType] = useState("youth");
  const [maxYears, setMaxYears] = useState(5);
  const [data, setData] = useState<RetentionTriangle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    setErr("");
    trendsApi.getRetention({ memberType, maxYears })
      .then(setData)
      .catch(() => setErr("Could not load retention data."))
      .finally(() => setLoading(false));
  }, [memberType, maxYears]);

  function exportCsv() {
    if (!data) return;
    const head = ["Cohort", "Size", ...Array.from({ length: maxYears + 1 }, (_, k) => `Year ${k}`)];
    const lines = [head.join(",")];
    for (const c of data.cohorts) {
      const cells = c.cells.map((cell) => (cell.pct === null ? "" : cell.pct));
      lines.push([c.cohort_season, c.size, ...cells].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `retention_${memberType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Reports</button>
      <div style={st.head}>
        <div>
          <h1 style={st.heading}><LayoutGrid size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Retention</h1>
          <p style={st.sub}>Each row is a cohort — everyone whose first season was that year. Each column shows the share still participating that many seasons later. Members who skip a season and return still count as retained.</p>
        </div>
        {data && data.cohorts.length > 0 && canRead("reports.export") && <button style={st.csvBtn} onClick={exportCsv}><Download size={14} /> CSV</button>}
      </div>

      <div style={st.controls}>
        <div style={st.toggle}>
          {TYPES.map((t) => (
            <button key={t.id} onClick={() => setMemberType(t.id)}
              style={{ ...st.toggleBtn, ...(memberType === t.id ? st.toggleOn : {}) }}>{t.label}</button>
          ))}
        </div>
        <label style={st.field}>
          <span style={st.lbl}>Years</span>
          <select style={st.select} value={maxYears} onChange={(e) => setMaxYears(Number(e.target.value))}>
            {[3, 4, 5, 6, 7, 8].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {err && <p style={st.err}>{err}</p>}
      {loading && <p style={st.muted}>Loading…</p>}

      {!loading && data && (
        data.cohorts.length === 0
          ? <p style={st.muted}>No participation history yet for this group.</p>
          : <div style={st.tableWrap}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.thL}>Cohort (first season)</th>
                    <th style={st.thC}>Size</th>
                    {Array.from({ length: maxYears + 1 }, (_, k) => (
                      <th key={k} style={st.thC}>{k === 0 ? "Start" : `+${k}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((c) => (
                    <tr key={c.cohort_season}>
                      <td style={st.tdL}>{c.cohort_season}</td>
                      <td style={st.tdC}>{c.size}</td>
                      {c.cells.map((cell) => (
                        <td key={cell.year} style={{ ...st.tdCell, background: cellColor(cell.pct), color: textColor(cell.pct) }}
                          title={cell.pct === null ? "Season hasn't happened yet" : `${cell.retained} of ${c.size}`}>
                          {cell.pct === null ? "" : `${cell.pct}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 860, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 16 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#888", maxWidth: 640, lineHeight: 1.5 },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 },
  controls: { display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 16, flexWrap: "wrap" },
  toggle: { display: "flex", border: "1px solid #ccc", borderRadius: 8, overflow: "hidden" },
  toggleBtn: { padding: "8px 16px", background: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#666" },
  toggleOn: { background: "#1565c0", color: "#fff" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  select: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, background: "#fff" },
  tableWrap: { overflowX: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 },
  table: { borderCollapse: "collapse", width: "100%", minWidth: 560 },
  thL: { textAlign: "left", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc", position: "sticky", left: 0 },
  thC: { textAlign: "center", padding: "10px 10px", fontSize: 12, color: "#888", borderBottom: "1px solid #eef2f6", background: "#fafbfc" },
  tdL: { padding: "8px 14px", fontSize: 14, fontWeight: 600, color: "#1a3a5c", borderBottom: "1px solid #f2f5f8", whiteSpace: "nowrap" },
  tdC: { padding: "8px 10px", fontSize: 13, color: "#666", textAlign: "center", borderBottom: "1px solid #f2f5f8" },
  tdCell: { padding: "8px 10px", fontSize: 13, fontWeight: 600, textAlign: "center", borderBottom: "1px solid #fff", fontVariantNumeric: "tabular-nums" },
  err: { color: "#c62828", fontSize: 14 },
  muted: { color: "#aaa", fontSize: 14 },
};
