import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Play, Download, ExternalLink } from "lucide-react";
import { reportEngineApi, type SavedReport, type ReportResult } from "../../reports/api";

/**
 * Team-page Reports tab. Lists saved reports and runs any of them scoped to
 * THIS team-season (the engine narrows rows to the team via team_season_id),
 * so a team sees its own numbers without building anything. Results still
 * respect the viewer's field-tier and row-scope entitlements.
 */
export default function TeamReportsPanel({ teamSeasonId }: { teamSeasonId: number }) {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [running, setRunning] = useState<number | null>(null);
  const [result, setResult] = useState<{ report: SavedReport; data: ReportResult } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    reportEngineApi.list().then(setReports).catch(() => setErr("Could not load reports."));
  }, []);

  async function run(rep: SavedReport) {
    setRunning(rep.id); setErr("");
    try {
      const data = await reportEngineApi.run(rep.id, undefined, teamSeasonId);
      setResult({ report: rep, data });
    } catch (e) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not run this report.");
      setResult(null);
    } finally { setRunning(null); }
  }

  function exportCsv() {
    if (!result) return;
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [result.data.columns.map((c) => esc(c.label)).join(",")];
    for (const row of result.data.rows) lines.push(row.map(esc).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${result.report.name.replace(/\s+/g, "_").toLowerCase()}_team.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div style={st.head}>
        <p style={st.sub}>Run any saved report scoped to this team. Build new ones in the <Link to="/reports/builder" style={st.link}>Report Builder</Link>.</p>
      </div>

      {err && <p style={st.err}>{err}</p>}

      {reports.length === 0 && !err && <p style={st.muted}>No saved reports yet.</p>}

      <div style={st.list}>
        {reports.map((r) => (
          <div key={r.id} style={st.row}>
            <FileText size={15} color="#6a1b9a" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={st.name}>{r.name}</div>
              {r.description && <div style={st.desc}>{r.description}</div>}
            </div>
            <span style={st.dsTag}>{r.dataset}</span>
            <button style={st.runBtn} onClick={() => run(r)} disabled={running === r.id}>
              <Play size={12} /> {running === r.id ? "…" : "Run"}
            </button>
          </div>
        ))}
      </div>

      {result && (
        <div style={st.resultBox}>
          <div style={st.resultHead}>
            <span style={st.resultTitle}>{result.report.name} — this team ({result.data.row_count} row{result.data.row_count !== 1 ? "s" : ""})</span>
            <button style={st.csvBtn} onClick={exportCsv} disabled={!result.data.rows.length}><Download size={12} /> CSV</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead><tr>{result.data.columns.map((c) => <th key={c.key} style={{ ...st.th, textAlign: c.type === "int" || c.type === "decimal" ? "right" : "left" }}>{c.label}</th>)}</tr></thead>
              <tbody>
                {result.data.rows.map((row, ri) => (
                  <tr key={ri}>{row.map((v, ci) => <td key={ci} style={{ ...st.td, textAlign: result.data.columns[ci].type === "int" || result.data.columns[ci].type === "decimal" ? "right" : "left" }}>{v === null ? "—" : String(v)}</td>)}</tr>
                ))}
                {result.data.rows.length === 0 && <tr><td colSpan={result.data.columns.length} style={st.empty}>No rows for this team.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Link to="/reports/builder" style={st.builderLink}><ExternalLink size={13} /> Open Report Builder</Link>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  head: { marginBottom: 10 },
  sub: { fontSize: 13, color: "#888", margin: 0 },
  link: { color: "#1565c0" },
  err: { color: "#c62828", fontSize: 13 },
  muted: { color: "#aaa", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  desc: { fontSize: 12, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dsTag: { fontSize: 11, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 5, padding: "2px 8px", fontWeight: 600 },
  runBtn: { display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  resultBox: { marginTop: 14, border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", overflow: "hidden" },
  resultHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#fafbfc", borderBottom: "1px solid #eef2f6" },
  resultTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  csvBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#fff", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#444" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 320 },
  th: { padding: "9px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", whiteSpace: "nowrap" },
  td: { padding: "8px 14px", fontSize: 14, color: "#333", borderBottom: "1px solid #f2f5f8", whiteSpace: "nowrap" },
  empty: { padding: 16, textAlign: "center", color: "#aaa", fontSize: 14 },
  builderLink: { display: "inline-flex", alignItems: "center", gap: 5, marginTop: 14, fontSize: 13, color: "#1565c0", textDecoration: "none" },
};
