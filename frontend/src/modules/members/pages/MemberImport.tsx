import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, FileText, ArrowLeft, Download, CheckCircle, AlertTriangle, SkipForward, UserPlus, RefreshCw } from "lucide-react";
import { membersApi, type ImportReport, type ImportRowResult, type ImportAction } from "../api";
import { useAuth } from "../../../core/AuthContext";
import { useGoBack } from "../../../core/useGoBack";

const ACTION_META: Record<ImportAction, { label: string; color: string; bg: string }> = {
  would_create: { label: "New",        color: "#1565c0", bg: "#e3f2fd" },
  created:      { label: "Created",    color: "#2e7d32", bg: "#e8f5e9" },
  would_update: { label: "Will update",color: "#e65100", bg: "#fff3e0" },
  updated:      { label: "Updated",    color: "#e65100", bg: "#fff3e0" },
  would_skip:   { label: "Will skip",  color: "#6b7280", bg: "#f1f3f5" },
  skipped:      { label: "Skipped",    color: "#6b7280", bg: "#f1f3f5" },
  error:        { label: "Error",      color: "#c62828", bg: "#ffebee" },
};

const REQUIRED_COLUMNS = "First Name, Last Name, Role";
const KNOWN_COLUMNS = [
  "First Name", "Middle Name", "Last Name", "Role", "Phone", "Email", "Birthday",
  "Shirt Size", "Graduation Year", "School", "Sex", "Address", "Address Line 2",
  "City", "State", "Zip", "Emergency Contact Name", "Emergency Contact Phone",
  "Relationship", "Guardian Name", "Guardian Phone", "Guardian Email",
];

export default function MemberImport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/members");
  const { isAdmin, hasRole } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "overwrite">("skip");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState(false);

  const canImport = isAdmin || hasRole("Admin", "System Administrator");
  if (!canImport) {
    return <div style={styles.deniedBox}>You need administrator access to import members.</div>;
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setReport(null);
    setCommitted(false);
    setError("");
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(f);
  }

  async function run(mode: "preview" | "commit") {
    if (!csv.trim()) { setError("Choose a CSV file first."); return; }
    setBusy(true);
    setError("");
    try {
      const r = await membersApi.import(csv, mode, onDuplicate);
      setReport(r);
      setCommitted(mode === "commit");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Import failed. Check the file format and try again.");
    } finally {
      setBusy(false);
    }
  }

  function downloadReport() {
    if (!report) return;
    const header = ["Row", "Name", "Type", "Result", "Member #", "Username", "Temp Password", "Notes"];
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    for (const r of report.results) {
      lines.push([
        r.row, r.name, r.member_type ?? "", ACTION_META[r.action]?.label ?? r.action,
        r.member_number ?? "", r.username ?? "", r.temp_password ?? "", r.messages.join(" "),
      ].map((v) => esc(String(v))).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `member-import-${committed ? "result" : "preview"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const c = report?.counts;
  const duplicates = report?.results.filter((r) => r.matched_id !== null) ?? [];
  const newTempPasswords = report?.results.filter((r) => r.action === "created" && r.temp_password) ?? [];

  return (
    <div>
      <button style={styles.back} onClick={goBack}>
        <ArrowLeft size={15} /> Back to Members
      </button>
      <h1 style={styles.heading}>Import Members from CSV</h1>
      <p style={styles.sub}>
        Upload a spreadsheet of members. Duplicates are detected by <strong>Last Name + First Name</strong>.
        Preview first to review what will happen — nothing is saved until you click Import.
      </p>

      {/* Step 1: file + options */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>1. Choose your file</div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={handleFile} />
        <div style={styles.fileRow}>
          <button style={styles.fileBtn} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {fileName ? "Choose a different file" : "Choose CSV file"}
          </button>
          {fileName && <span style={styles.fileName}><FileText size={14} /> {fileName}</span>}
        </div>

        <div style={styles.cardTitle}>2. When a member already exists</div>
        <div style={styles.radioRow}>
          <label style={styles.radio}>
            <input type="radio" checked={onDuplicate === "skip"} onChange={() => { setOnDuplicate("skip"); setReport(null); }} />
            <div>
              <div style={styles.radioLabel}>Skip duplicates</div>
              <div style={styles.radioHint}>Leave existing members untouched (safest).</div>
            </div>
          </label>
          <label style={styles.radio}>
            <input type="radio" checked={onDuplicate === "overwrite"} onChange={() => { setOnDuplicate("overwrite"); setReport(null); }} />
            <div>
              <div style={styles.radioLabel}>Overwrite duplicates</div>
              <div style={styles.radioHint}>Update existing members with values from the file. Blank cells are ignored (won't erase data).</div>
            </div>
          </label>
        </div>

        <div style={styles.actions}>
          <button style={styles.previewBtn} disabled={busy || !csv} onClick={() => run("preview")}>
            {busy && !committed ? <RefreshCw size={15} className="spin" /> : <FileText size={15} />} Preview
          </button>
        </div>
        {error && <div style={styles.errorBox}>{error}</div>}
      </div>

      {/* Column hint */}
      <details style={styles.details}>
        <summary style={styles.summary}>Which columns are recognized?</summary>
        <div style={styles.detailsBody}>
          <p><strong>Required:</strong> {REQUIRED_COLUMNS}.</p>
          <p><strong>Role</strong> must be one of: youth, mentor, parent, volunteer.</p>
          <p><strong>Also recognized</strong> (any order, header names are flexible): {KNOWN_COLUMNS.join(", ")}.</p>
          <p style={{ color: "#888" }}>Dates accept formats like 5/14/2010 or 2010-05-14. Unrecognized columns are ignored and listed in the report.</p>
        </div>
      </details>

      {/* Report */}
      {report && c && (
        <div style={styles.card}>
          <div style={styles.reportHead}>
            <div style={styles.cardTitle}>
              {committed ? "Import complete" : "Preview — nothing saved yet"}
            </div>
            <button style={styles.downloadBtn} onClick={downloadReport}>
              <Download size={14} /> Download report
            </button>
          </div>

          {/* Summary chips */}
          <div style={styles.chips}>
            <Chip icon={<UserPlus size={14} />} n={c.created} label={committed ? "created" : "new"} color="#1565c0" bg="#e3f2fd" />
            <Chip icon={<RefreshCw size={14} />} n={c.updated} label={committed ? "updated" : "to update"} color="#e65100" bg="#fff3e0" />
            <Chip icon={<SkipForward size={14} />} n={c.skipped} label="skipped" color="#6b7280" bg="#f1f3f5" />
            <Chip icon={<AlertTriangle size={14} />} n={c.errors} label="errors" color="#c62828" bg="#ffebee" />
            <Chip icon={<AlertTriangle size={14} />} n={c.duplicates} label="duplicates found" color="#8a6d00" bg="#fff8e1" />
          </div>

          {report.unmapped_columns.length > 0 && (
            <div style={styles.warnBox}>
              Ignored unrecognized columns: {report.unmapped_columns.join(", ")}
            </div>
          )}

          {!!c.blank && (
            <div style={styles.noteBox}>
              {c.blank} blank row{c.blank === 1 ? "" : "s"} skipped (not shown below).
            </div>
          )}

          {/* Duplicate review callout */}
          {duplicates.length > 0 && (
            <div style={styles.dupBox}>
              <strong>{duplicates.length} row{duplicates.length !== 1 ? "s" : ""} matched existing members.</strong>{" "}
              {onDuplicate === "skip"
                ? "They will be skipped. Switch to “Overwrite” above if you want to update them instead."
                : "They will be updated with the file's values."}
              {" "}Review the highlighted rows below and download the report to double-check.
            </div>
          )}

          {/* Results table */}
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Row</th>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Result</th>
                  <th style={styles.th}>Member #</th>
                  <th style={styles.th}>Username</th>
                  <th style={styles.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r) => <Row key={r.row} r={r} />)}
              </tbody>
            </table>
          </div>

          {/* Temp password notice */}
          {committed && newTempPasswords.length > 0 && (
            <div style={styles.pwBox}>
              <CheckCircle size={16} color="#2e7d32" />
              <div>
                <strong>{newTempPasswords.length} new member{newTempPasswords.length !== 1 ? "s" : ""} created with a temporary password.</strong>
                <div style={styles.pwHint}>
                  Each user must change their password at first login. Download the report above to keep the credentials, or send each a Welcome Email from their profile.
                </div>
              </div>
            </div>
          )}

          {/* Commit / done actions */}
          {!committed ? (
            <div style={styles.actions}>
              <button
                style={{ ...styles.commitBtn, ...(c.created + c.updated === 0 ? styles.disabledBtn : {}) }}
                disabled={busy || c.created + c.updated === 0}
                onClick={() => run("commit")}
              >
                {busy ? <RefreshCw size={15} className="spin" /> : <CheckCircle size={15} />}
                {" "}Import {c.created} new{c.updated > 0 ? ` & update ${c.updated}` : ""}
              </button>
              <span style={styles.commitHint}>This will write to the database.</span>
            </div>
          ) : (
            <div style={styles.actions}>
              <button style={styles.doneBtn} onClick={() => navigate("/members", { state: { success: `Import complete: ${c.created} created, ${c.updated} updated, ${c.skipped} skipped.` } })}>
                Done — view members
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ icon, n, label, color, bg }: { icon: React.ReactNode; n: number; label: string; color: string; bg: string }) {
  return (
    <div style={{ ...styles.chip, color, background: bg }}>
      {icon}<strong>{n}</strong> {label}
    </div>
  );
}

function Row({ r }: { r: ImportRowResult }) {
  const meta = ACTION_META[r.action];
  const highlight = r.matched_id !== null;
  return (
    <tr style={highlight ? { background: "#fffdf5" } : undefined}>
      <td style={styles.td}>{r.row}</td>
      <td style={{ ...styles.td, fontWeight: 600 }}>{r.name}</td>
      <td style={styles.td}>{r.member_type ?? "—"}</td>
      <td style={styles.td}><span style={{ ...styles.actionBadge, color: meta.color, background: meta.bg }}>{meta.label}</span></td>
      <td style={styles.td}>{r.member_number ?? "—"}</td>
      <td style={styles.td}>{r.username ?? "—"}</td>
      <td style={{ ...styles.td, color: "#666", fontSize: 12 }}>{r.messages.join(" ")}</td>
    </tr>
  );
}

const styles: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 12 },
  heading: { margin: "0 0 6px", fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { color: "#666", fontSize: 14, margin: "0 0 20px", maxWidth: 720, lineHeight: 1.5 },
  deniedBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: 20, color: "#c62828" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, marginBottom: 18 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, margin: "0 0 12px" },
  fileRow: { display: "flex", alignItems: "center", gap: 14, marginBottom: 22 },
  fileBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  fileName: { display: "flex", alignItems: "center", gap: 6, color: "#555", fontSize: 13 },
  radioRow: { display: "flex", gap: 14, flexWrap: "wrap" as const, marginBottom: 18 },
  radio: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", flex: "1 1 280px" },
  radioLabel: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  radioHint: { fontSize: 12, color: "#888", marginTop: 2 },
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 8 },
  previewBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 22px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  commitBtn: { display: "flex", alignItems: "center", gap: 7, padding: "11px 24px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 700 },
  disabledBtn: { background: "#bbb", cursor: "not-allowed" },
  doneBtn: { display: "flex", alignItems: "center", gap: 7, padding: "11px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 700 },
  commitHint: { fontSize: 12, color: "#888" },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginTop: 12, fontSize: 13 },
  details: { marginBottom: 18, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "0 16px" },
  summary: { cursor: "pointer", padding: "12px 0", fontSize: 13, fontWeight: 600, color: "#1565c0" },
  detailsBody: { fontSize: 13, color: "#555", lineHeight: 1.6, paddingBottom: 12 },
  reportHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  downloadBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#fff", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#555" },
  chips: { display: "flex", gap: 10, flexWrap: "wrap" as const, margin: "14px 0" },
  chip: { display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 16, fontSize: 13 },
  warnBox: { background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 6, padding: "8px 12px", color: "#8a6d00", fontSize: 13, marginBottom: 12 },
  noteBox: { background: "#f1f3f5", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 12px", color: "#6b7280", fontSize: 13, marginBottom: 12 },
  dupBox: { background: "#fffaf0", border: "1px solid #ffe0b2", borderRadius: 6, padding: "10px 14px", color: "#8a4b00", fontSize: 13, marginBottom: 14, lineHeight: 1.5 },
  tableWrap: { overflowX: "auto" as const, border: "1px solid #e2e8f0", borderRadius: 8 },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { textAlign: "left" as const, padding: "9px 12px", background: "#f0f4f8", color: "#555", fontWeight: 700, fontSize: 12, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" as const },
  td: { padding: "8px 12px", borderBottom: "1px solid #f1f3f5", color: "#333", verticalAlign: "top" as const },
  actionBadge: { padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" as const },
  pwBox: { display: "flex", gap: 10, alignItems: "flex-start", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, padding: "12px 14px", marginTop: 14 },
  pwHint: { fontSize: 12, color: "#33691e", marginTop: 3, lineHeight: 1.5 },
};
