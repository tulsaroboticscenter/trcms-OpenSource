import { useEffect, useMemo, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, ShieldCheck, RotateCcw } from "lucide-react";
import { reportAccessApi, type ReportMatrix, type ReportPermRow } from "../api";

const CAPS = ["run", "build_scoped", "build_full", "publish", "manage"];
const SCOPES = ["none", "self", "own_teams", "all"];
const TIERS = ["public", "internal", "pii", "financial"];

export default function ReportAccessMatrix() {
  const goBack = useGoBack("/reports");
  const [matrix, setMatrix] = useState<ReportMatrix | null>(null);
  const [role, setRole] = useState("");
  const [err, setErr] = useState("");
  const [savingKey, setSavingKey] = useState("");

  const load = () => reportAccessApi.matrix()
    .then((m) => { setMatrix(m); if (!role && m.roles.length) setRole(m.roles[0]); })
    .catch((e) => setErr(e?.response?.status === 403 ? "Admins only." : "Could not load the report access matrix."));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const rowByDataset = useMemo(() => {
    const map = new Map<string, ReportPermRow>();
    for (const r of matrix?.rows ?? []) if (r.role_name === role) map.set(r.dataset, r);
    return map;
  }, [matrix, role]);

  async function saveRule(dataset: string, patch: Partial<ReportPermRow>) {
    const existing = rowByDataset.get(dataset);
    const payload = {
      role_name: role, dataset,
      capability: patch.capability ?? existing?.capability ?? "run",
      row_scope: patch.row_scope ?? existing?.row_scope ?? "own_teams",
      max_field_tier: patch.max_field_tier ?? existing?.max_field_tier ?? "internal",
    };
    setSavingKey(dataset); setErr("");
    try { await reportAccessApi.save(payload); await load(); }
    catch { setErr("Could not save that change."); }
    finally { setSavingKey(""); }
  }

  async function reset(row: ReportPermRow) {
    setSavingKey(row.dataset);
    try { await reportAccessApi.remove(row.id); await load(); }
    catch { setErr("Could not reset that rule."); }
    finally { setSavingKey(""); }
  }

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Reports</button>
      <h1 style={st.heading}><ShieldCheck size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />Report Access</h1>
      <p style={st.sub}>Control what each role can do in the Report Builder, per dataset. Anything left as “default” uses the built-in preset for that role. Overrides here take precedence. Reports always run as whoever runs them, so these limits are always enforced.</p>

      {err && <p style={st.err}>{err}</p>}

      {matrix && (
        <>
          <div style={st.controls}>
            <label style={st.field}><span style={st.lbl}>Role</span>
              <select style={st.select} value={role} onChange={(e) => setRole(e.target.value)}>
                {matrix.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <span style={st.hint}>Capability = what they may do · Rows = which records · Fields = most sensitive column tier</span>
          </div>

          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead><tr>
                <th style={st.thL}>Dataset</th>
                <th style={st.th}>Capability</th>
                <th style={st.th}>Row scope</th>
                <th style={st.th}>Max field tier</th>
                <th style={st.th}>Source</th>
              </tr></thead>
              <tbody>
                {matrix.datasets.map((d) => {
                  const row = rowByDataset.get(d.key);
                  const busy = savingKey === d.key;
                  return (
                    <tr key={d.key} style={busy ? { opacity: 0.5 } : undefined}>
                      <td style={st.tdL}>{d.label}</td>
                      <td style={st.td}>
                        <select style={st.cell} value={row?.capability ?? ""} onChange={(e) => saveRule(d.key, { capability: e.target.value })}>
                          {!row && <option value="">— default —</option>}
                          {CAPS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={st.cell} value={row?.row_scope ?? ""} onChange={(e) => saveRule(d.key, { row_scope: e.target.value })}>
                          {!row && <option value="">— default —</option>}
                          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        <select style={st.cell} value={row?.max_field_tier ?? ""} onChange={(e) => saveRule(d.key, { max_field_tier: e.target.value })}>
                          {!row && <option value="">— default —</option>}
                          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td style={st.td}>
                        {row
                          ? <button style={st.resetBtn} onClick={() => reset(row)} title="Reset to preset default"><RotateCcw size={12} /> custom</button>
                          : <span style={st.default}>preset</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 16px", fontSize: 13, color: "#888", maxWidth: 700, lineHeight: 1.5 },
  controls: { display: "flex", gap: 16, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 },
  select: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, background: "#fff", minWidth: 200 },
  hint: { fontSize: 11, color: "#aaa", paddingBottom: 8 },
  tableWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 560 },
  thL: { textAlign: "left", padding: "10px 14px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc" },
  th: { textAlign: "left", padding: "10px 12px", fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #eef2f6", background: "#fafbfc" },
  tdL: { padding: "8px 14px", fontSize: 14, fontWeight: 600, color: "#1a3a5c", borderBottom: "1px solid #f2f5f8", whiteSpace: "nowrap" },
  td: { padding: "6px 12px", fontSize: 13, color: "#444", borderBottom: "1px solid #f2f5f8" },
  cell: { padding: "5px 8px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, background: "#fff" },
  resetBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "#eef4ff", border: "1px solid #cfe0ff", borderRadius: 5, color: "#1565c0", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" },
  default: { fontSize: 11, color: "#bbb" },
  err: { color: "#c62828", fontSize: 14 },
};
