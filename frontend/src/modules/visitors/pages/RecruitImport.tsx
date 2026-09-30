/**
 * RecruitImport — bulk-import a CSV of prospects, an FLL waitlist, or adult
 * contacts into the recruitment pipeline. Always preview (dry run) first; de-dupes
 * by email, and waitlist rows attach to an existing prospect where one is on file.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { visitorsApi, type ImportResult } from "../api";
import { ArrowLeft, Upload, CheckCircle2, AlertTriangle } from "lucide-react";

const TYPES = [
  { key: "prospects", label: "Prospects (mailing list → Visitors)", cols: "first_name, last_name, email, guardian1_name, guardian1_email, program_interest, referral_source, referral_detail, status, notes" },
  { key: "waitlist", label: "FLL waitlist (→ Visitors + waitlist)", cols: "first_name, last_name, email, program_interest, visitor_status, waitlist_status, notes" },
  { key: "mentor_prospects", label: "Adult contacts (→ Mentor pipeline)", cols: "name, email, phone, source, stage, notes" },
];

export default function RecruitImport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/visitors");
  const [type, setType] = useState("prospects");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const active = TYPES.find((t) => t.key === type)!;

  function pick(f: File | null) { setFile(f); setPreview(null); setDone(null); setError(""); }
  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const r = await visitorsApi.importCsv(type, file, dryRun);
      if (dryRun) { setPreview(r); setDone(null); } else { setDone(r); setPreview(null); }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Import failed. Check the file is a .csv with a header row.");
    } finally { setBusy(false); }
  }

  const Result = ({ r, committed }: { r: ImportResult; committed: boolean }) => (
    <div style={{ ...s.result, borderColor: committed ? "#a5d6a7" : "#cfe0f3", background: committed ? "#f4fbf5" : "#f5f9ff" }}>
      <div style={s.resultHead}>
        {committed ? <CheckCircle2 size={16} color="#2e7d32" /> : <AlertTriangle size={16} color="#1565c0" />}
        <strong>{committed ? "Import complete" : "Preview — nothing saved yet"}</strong>
      </div>
      <div style={s.stats}>
        <Stat n={r.created} label={committed ? "created" : "would create"} color="#2e7d32" />
        {r.linked_to_existing > 0 && <Stat n={r.linked_to_existing} label="linked to existing" color="#1565c0" />}
        <Stat n={r.skipped_duplicates} label="duplicates skipped" color="#889" />
        <Stat n={r.skipped_blank} label="blank rows" color="#889" />
      </div>
      {r.errors.length > 0 && (
        <div style={s.errors}><strong>Row errors ({r.errors.length}):</strong>
          {r.errors.map((e, i) => <div key={i} style={s.errLine}>{e}</div>)}
        </div>
      )}
      {!committed && r.created + r.linked_to_existing > 0 && (
        <button style={s.commitBtn} onClick={() => run(false)} disabled={busy}>
          {busy ? "Importing…" : `Import ${r.created + r.linked_to_existing} record${r.created + r.linked_to_existing === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Visitors</button>
      <h1 style={s.h1}><Upload size={22} /> Import Contacts</h1>
      <p style={s.sub}>Bring a spreadsheet of prospects, an FLL waitlist, or adult contacts into the pipeline. Save it as CSV (UTF-8) with a header row. Always preview first — de-duplication is by email, so it's safe to re-run.</p>

      <div style={s.card}>
        <label style={s.label}>What are you importing?</label>
        <select style={s.sel} value={type} onChange={(e) => { setType(e.target.value); pick(file); }}>
          {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <div style={s.cols}><strong>Expected columns:</strong> {active.cols}</div>

        <label style={s.label}>CSV file</label>
        <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0] ?? null)} style={s.fileIn} />

        {error && <p style={s.error}>{error}</p>}
        {!done && (
          <button style={s.previewBtn} onClick={() => run(true)} disabled={!file || busy}>
            {busy ? "Reading…" : "Preview (dry run)"}
          </button>
        )}
      </div>

      {preview && <Result r={preview} committed={false} />}
      {done && <>
        <Result r={done} committed={true} />
        <div style={s.next}>
          <button style={s.linkBtn} onClick={() => navigate(type === "mentor_prospects" ? "/visitors/mentors" : type === "waitlist" ? "/visitors/waitlist" : "/visitors")}>View imported records →</button>
        </div>
      </>}
    </div>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return <div style={s.stat}><div style={{ ...s.statN, color }}>{n}</div><div style={s.statL}>{label}</div></div>;
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  h1: { margin: "0 0 6px", fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  sub: { color: "#667", fontSize: 13.5, margin: "0 0 16px", lineHeight: 1.5 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#556", margin: "8px 0 6px" },
  sel: { width: "100%", padding: "9px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box", background: "#fff" },
  cols: { fontSize: 12, color: "#778", margin: "8px 0 6px", lineHeight: 1.5, background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 6, padding: "8px 10px" },
  fileIn: { display: "block", fontSize: 13, margin: "4px 0 0" },
  previewBtn: { marginTop: 16, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  error: { color: "#c0392b", fontSize: 13, margin: "10px 0 0" },
  result: { border: "1px solid", borderRadius: 10, padding: 16, marginTop: 16 },
  resultHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: "#1a3a5c", marginBottom: 12 },
  stats: { display: "flex", gap: 24, flexWrap: "wrap" },
  stat: { textAlign: "center", minWidth: 64 },
  statN: { fontSize: 24, fontWeight: 800 },
  statL: { fontSize: 11, fontWeight: 600, color: "#889", textTransform: "uppercase", letterSpacing: 0.3 },
  errors: { marginTop: 12, background: "#fff5f5", border: "1px solid #f3cfcf", borderRadius: 7, padding: "8px 10px", fontSize: 12.5, color: "#8a1c1c", maxHeight: 160, overflowY: "auto" },
  errLine: { marginTop: 3 },
  commitBtn: { marginTop: 14, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, padding: "10px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  next: { marginTop: 12 },
  linkBtn: { background: "none", border: "none", color: "#1565c0", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: 0 },
};
