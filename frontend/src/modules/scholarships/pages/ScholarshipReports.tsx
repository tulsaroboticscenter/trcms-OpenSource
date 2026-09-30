import { useEffect, useState, useCallback } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { scholarshipsApi, type ScholarshipApplication, type AppStatus, STATUS_LABEL, STATUS_COLOR } from "../api";

const STATUSES: AppStatus[] = ["interested", "applied", "granted", "partial", "declined", "no_decision"];

/** Manager report: who applied to what, with status + award, and inline outcome editing. */
export default function ScholarshipReports() {
  const goBack = useGoBack("/scholarships");
  const [rows, setRows] = useState<ScholarshipApplication[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    scholarshipsApi.report({ season: season || undefined, status: status || undefined })
      .then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [season, status]);

  useEffect(() => { scholarshipsApi.seasons().then(setSeasons).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function setOutcome(a: ScholarshipApplication, next: Partial<{ status: AppStatus; amount_awarded: number | null; decision_date: string | null }>) {
    await scholarshipsApi.setOutcome(a.id, next); load();
  }

  const awarded = rows.filter((r) => r.status === "granted" || r.status === "partial")
    .reduce((t, r) => t + (r.amount_awarded ?? 0), 0);
  const counts = STATUSES.map((st) => ({ st, n: rows.filter((r) => r.status === st).length }));

  return (
    <div style={{ maxWidth: 1050, margin: "0 auto" }}>
      <button style={s.back} onClick={goBack}>← Scholarship board</button>
      <h1 style={s.h1}>Scholarship Applications</h1>
      <p style={s.sub}>Track who has applied and record outcomes. Filter by season or status.</p>

      <div style={s.summary}>
        {counts.map(({ st, n }) => (
          <span key={st} style={{ ...s.pill, background: STATUS_COLOR[st] }}>{STATUS_LABEL[st]}: {n}</span>
        ))}
        <span style={{ ...s.pill, background: "#00695c" }}>Awarded: ${awarded.toLocaleString()}</span>
      </div>

      <div style={s.filters}>
        <select style={s.sel} value={season} onChange={(e) => setSeason(e.target.value)}>
          <option value="">All seasons</option>
          {seasons.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select style={s.sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
        </select>
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : rows.length === 0 ? (
        <div style={s.empty}>No applications match these filters.</div>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Youth</th><th style={s.th}>Scholarship</th><th style={s.th}>Season</th>
                <th style={s.th}>Status</th><th style={s.th}>Award ($)</th><th style={s.th}>Decision date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} style={s.tr}>
                  <td style={s.td}>{a.member_name}</td>
                  <td style={s.td}><div style={s.schName}>{a.scholarship_name}</div>{a.provider && <div style={s.prov}>{a.provider}</div>}</td>
                  <td style={s.td}>{a.season ?? "—"}</td>
                  <td style={s.td}>
                    <select style={{ ...s.statusSel, color: STATUS_COLOR[a.status] }} value={a.status}
                      onChange={(e) => setOutcome(a, { status: e.target.value as AppStatus })}>
                      {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
                    </select>
                  </td>
                  <td style={s.td}>
                    <input style={s.amtIn} type="number" defaultValue={a.amount_awarded ?? ""}
                      onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== (a.amount_awarded ?? null)) setOutcome(a, { amount_awarded: v }); }} />
                  </td>
                  <td style={s.td}>
                    <input style={s.dateIn} type="date" defaultValue={a.decision_date ?? ""}
                      onChange={(e) => setOutcome(a, { decision_date: e.target.value || null })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { color: "#667", fontSize: 13, margin: "6px 0 12px" },
  summary: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: { color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 14, padding: "3px 11px" },
  filters: { display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  sel: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5 },
  tableWrap: { overflowX: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "10px 12px", background: "#f7f9fc", color: "#556", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "9px 12px", color: "#243", verticalAlign: "top" },
  schName: { fontWeight: 600, color: "#1a3a5c" },
  prov: { fontSize: 11.5, color: "#889" },
  statusSel: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, fontWeight: 700 },
  amtIn: { width: 90, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5 },
  dateIn: { padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5 },
  muted: { color: "#889", fontSize: 13.5 },
  empty: { color: "#889", fontSize: 14, textAlign: "center", padding: "40px 0", background: "#fff", border: "1px dashed #d8e0ea", borderRadius: 12 },
};
