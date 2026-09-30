/**
 * ImportWizard (#89)
 * ==================
 * Two steps: (1) pick a QuickBooks CSV export → we preview its columns and guess
 * the mapping; (2) confirm which column is the team/class label, income, and
 * expense, add a description, and import. Segment→team mapping happens after, on
 * the Financials page.
 */
import { useState } from "react";
import { financeApi, type FinancePreview, type ColumnMap } from "../api";
import { Upload, X, FileSpreadsheet, ArrowRight } from "lucide-react";

interface Props {
  onClose: () => void;
  onImported: (importId: number) => void;
}

export default function ImportWizard({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FinancePreview | null>(null);
  const [map, setMap] = useState<ColumnMap>({ segment: "" });
  const [label, setLabel] = useState("");
  const [asOf, setAsOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onPick(f: File) {
    setFile(f); setError(""); setBusy(true);
    try {
      const p = await financeApi.preview(f);
      setPreview(p);
      setMap({
        segment: p.guessed.segment ?? "",
        account: p.guessed.account ?? "",
        income: p.guessed.income ?? "",
        expense: p.guessed.expense ?? "",
        amount: p.guessed.income || p.guessed.expense ? "" : (p.guessed.amount ?? ""),
      });
      if (!label) setLabel(f.name.replace(/\.[^.]+$/, ""));
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not read that file.");
      setPreview(null);
    } finally { setBusy(false); }
  }

  async function doImport() {
    if (!file) return;
    if (!map.segment) { setError("Choose which column holds the team/class label."); return; }
    if (!map.income && !map.expense && !map.amount) { setError("Choose an income/expense column, or a single amount column."); return; }
    setBusy(true); setError("");
    try {
      const r = await financeApi.createImport(file, { label, as_of_date: asOf }, map);
      onImported(r.import_id);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Import failed.");
      setBusy(false);
    }
  }

  const colSelect = (key: keyof ColumnMap, label: string, required = false) => (
    <label style={s.field}>
      <span style={s.lbl}>{label}{required && <span style={s.req}> *</span>}</span>
      <select style={s.input} value={(map[key] as string) ?? ""} onChange={(e) => setMap((m) => ({ ...m, [key]: e.target.value }))}>
        <option value="">— none —</option>
        {preview!.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div style={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <div style={s.title}><FileSpreadsheet size={18} color="#1a3a5c" /> Import from QuickBooks</div>
          <button style={s.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        <div style={s.body}>
          {!preview ? (
            <>
              <p style={s.help}>
                Export a report from QuickBooks (e.g. <strong>Profit &amp; Loss by Class</strong>) as CSV, then choose it here.
                We'll show you the columns and let you confirm which is the team and which holds the dollars.
              </p>
              <label style={s.dropzone}>
                <Upload size={26} color="#94a3b8" />
                <span>{file ? file.name : "Choose a CSV file…"}</span>
                <input type="file" accept=".csv,text/csv" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
              </label>
              {busy && <p style={s.muted}>Reading file…</p>}
            </>
          ) : (
            <>
              <div style={s.grid2}>
                <label style={s.field}><span style={s.lbl}>Description</span>
                  <input style={s.input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. P&L by Class — 2026 YTD" />
                </label>
                <label style={s.field}><span style={s.lbl}>As-of date</span>
                  <input type="date" style={s.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                </label>
              </div>

              <div style={s.mapBox}>
                <div style={s.mapHint}>Map the columns ({preview.row_count} rows found):</div>
                <div style={s.grid2}>
                  {colSelect("segment", "Team / Class label", true)}
                  {colSelect("account", "Account / category")}
                  {colSelect("income", "Income column")}
                  {colSelect("expense", "Expense column")}
                </div>
                {colSelect("amount", "…or a single Amount column (+income / −expense)")}
              </div>

              <div style={s.previewWrap}>
                <table style={s.table}>
                  <thead><tr>{preview.headers.map((h) => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {preview.sample_rows.slice(0, 6).map((row, i) => (
                      <tr key={i}>{preview.headers.map((h) => <td key={h} style={s.td}>{row[h]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {error && <div style={s.errorBox}>{error}</div>}
        </div>

        <div style={s.foot}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          {preview && (
            <button style={s.primaryBtn} onClick={doImport} disabled={busy}>
              {busy ? "Importing…" : <>Import <ArrowRight size={14} /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", zIndex: 1000, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 720, boxShadow: "0 12px 48px rgba(0,0,0,0.25)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #eef0f4" },
  title: { display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  body: { padding: "18px", display: "flex", flexDirection: "column", gap: 14 },
  help: { fontSize: 13, color: "#556", lineHeight: 1.6, margin: 0 },
  dropzone: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "28px", border: "2px dashed #cbd5e1", borderRadius: 10, cursor: "pointer", color: "#667", fontSize: 14, background: "#f8fafc" },
  muted: { color: "#888", fontSize: 13, margin: 0 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  lbl: { fontSize: 12, fontWeight: 600, color: "#556" },
  req: { color: "#c62828" },
  input: { padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box", width: "100%", background: "#fff" },
  mapBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 },
  mapHint: { fontSize: 12, fontWeight: 700, color: "#1a3a5c" },
  previewWrap: { overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#888", fontWeight: 700, whiteSpace: "nowrap", background: "#f8fafc" },
  td: { padding: "5px 8px", borderBottom: "1px solid #f4f6fa", whiteSpace: "nowrap", color: "#445" },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", fontSize: 13 },
  foot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 18px", borderTop: "1px solid #eef0f4" },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  primaryBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
