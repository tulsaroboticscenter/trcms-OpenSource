/**
 * CertificationCatalog — browse the certification program by section.
 * Shows level, status (active/pending), tool-gate flag, Classroom link, and how
 * many members have earned each. Managers can add/edit certifications.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { certApi, type CatalogResponse, type Certification, type ImportResult } from "../api";
import CertClassroomLink from "../components/CertClassroomLink";
import { Award, Wrench, PlusCircle, Edit2, X, Trophy, Medal, Upload, AlertTriangle, CheckCircle, BookOpen } from "lucide-react";

const LEVEL_COLORS: Record<number, string> = { 1: "#2e7d32", 2: "#1565c0", 3: "#6a1b9a" };

/** "2026-05-14" → "May 14, 2026" for the Earned pill's hover tooltip. */
const fmtEarned = (d: string) => {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function CertificationCatalog() {
  const navigate = useNavigate();
  const { user, canWrite, isAdmin } = useAuth();
  const canManage = canWrite("certifications.manage");
  // Certification Quiz Engine is hidden until enabled: any admin can build quizzes for QA,
  // plus anyone explicitly granted cert_lms.manage. Mirrors the server's canManageLms gate.
  const canManageLms = isAdmin || canWrite("cert_lms.manage");
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState("active");
  const [editing, setEditing] = useState<Certification | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [earned, setEarned] = useState<Map<number, string | null>>(new Map());  // cert id → completed date
  const [canTakeLms, setCanTakeLms] = useState(false);  // may take quizzes (flag on + permission, or admin)

  useEffect(() => { certApi.getSettings().then((s) => setCanTakeLms(!!s.can_take_lms)).catch(() => {}); }, []);

  const load = useCallback(() => {
    certApi.catalog(statusFilter ? { status: statusFilter } : undefined).then(setData).catch(() => {});
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  // The current user's own completed certifications → green "Earned" pill on those rows.
  useEffect(() => {
    if (!user?.id) return;
    certApi.memberCerts(user.id)
      .then((r) => setEarned(new Map(r.completed.map((c) => [c.certification_id, c.completed_date ?? null]))))
      .catch(() => setEarned(new Map()));
  }, [user?.id]);

  if (!data) return <p style={st.muted}>Loading…</p>;

  return (
    <div>
      <div style={st.header}>
        <div>
          <h1 style={st.heading}><Award size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Certifications</h1>
          <p style={st.sub}>{data.total} certifications · {data.active} active · {data.pending} planned</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={st.rankBtn} onClick={() => navigate("/certifications/leaderboard")}><Trophy size={15} /> Rankings</button>
          <button style={st.rankBtn} onClick={() => navigate("/certifications/badges")}><Medal size={15} /> Badges</button>
          <button style={st.rankBtn} onClick={() => navigate("/certifications/clearances")}><Wrench size={15} /> Tool Clearances</button>
          {canManage && <button style={st.rankBtn} onClick={() => { setImporting(true); }}><Upload size={15} /> Import Progress Chart</button>}
          {canManage && <button style={st.addBtn} onClick={() => { setAdding(true); setEditing(null); }}><PlusCircle size={15} /> Add Certification</button>}
        </div>
      </div>

      <CertClassroomLink />

      {importing && canManage && (
        <ImportPanel onClose={() => setImporting(false)} onApplied={() => load()} />
      )}

      <div style={st.tabs}>
        {[["", "All"], ["active", "Active"], ["pending", "Planned"]].map(([v, l]) => (
          <button key={v} style={{ ...st.tab, ...(statusFilter === v ? st.tabActive : {}) }} onClick={() => setStatusFilter(v)}>{l}</button>
        ))}
      </div>

      {(adding || editing) && canManage && (
        <CertForm cert={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => { setAdding(false); setEditing(null); load(); }} />
      )}

      {data.sections.map((sec) => (
        <div key={sec.section} style={st.sectionCard}>
          <div style={st.sectionHead}>{sec.section}</div>
          <div style={st.list}>
            {sec.certifications.map((c) => (
              <div key={c.id} style={{ ...st.row, opacity: c.status === "pending" ? 0.6 : 1 }}>
                <span style={st.code}>{c.code}</span>
                <div style={st.rowMain}>
                  <div style={st.rowName}>
                    {c.name}
                    {earned.has(c.id) && (
                      <span style={st.earnedTag} title={earned.get(c.id) ? `Earned ${fmtEarned(earned.get(c.id)!)}` : "Earned"}>
                        <CheckCircle size={10} /> Earned
                      </span>
                    )}
                    {c.is_tool_gate && <span style={st.toolTag} title={c.tool_name ?? "Tool clearance"}><Wrench size={10} /> tool</span>}
                  </div>
                  <div style={st.rowMeta}>
                    {c.level && <span style={{ ...st.levelTag, background: LEVEL_COLORS[c.level] ?? "#888" }}>Level {c.level}</span>}
                    {c.status === "pending" && <span style={st.pendingTag}>Planned</span>}
                    <span>{c.earned_count ?? 0} earned</span>
                  </div>
                </div>
                {c.classroom_url && (
                  <a style={st.courseBtn} href={c.classroom_url} target="_blank" rel="noreferrer"
                    title="Open the course material for this certification">
                    <BookOpen size={13} /> Course material
                  </a>
                )}
                {canTakeLms && c.has_quiz && (
                  <button style={st.takeBtn} title="Take this certification's quiz"
                    onClick={() => navigate(`/certifications/${c.id}/quiz/take`, { state: { code: c.code, name: c.name } })}>
                    {earned.has(c.id) ? "Retake" : "Take quiz"}
                  </button>
                )}
                {canManageLms && <button style={st.quizBtn} title="Build the quiz for this certification (hidden until enabled)"
                  onClick={() => navigate(`/certifications/${c.id}/quiz`, { state: { code: c.code, name: c.name } })}>Quiz</button>}
                {canManage && <button style={st.editBtn} onClick={() => { setEditing(c); setAdding(false); }}><Edit2 size={13} /></button>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CertForm({ cert, onClose, onSaved }: { cert: Certification | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: cert?.code ?? "", name: cert?.name ?? "", section: cert?.section ?? "",
    level: cert?.level ? String(cert.level) : "", status: cert?.status ?? "active",
    is_tool_gate: cert?.is_tool_gate ?? false, tool_name: cert?.tool_name ?? "",
    classroom_url: cert?.classroom_url ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    if (!f.code.trim() || !f.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: f.code.trim(), name: f.name.trim(), section: f.section || null,
        level: f.level ? parseInt(f.level) : null, status: f.status,
        is_tool_gate: f.is_tool_gate, tool_name: f.tool_name || null, classroom_url: f.classroom_url || null,
      };
      if (cert) await certApi.updateCert(cert.id, payload);
      else await certApi.createCert(payload);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div style={st.form}>
      <div style={st.formHead}><span style={st.formTitle}>{cert ? `Edit Certification — ${cert.name}` : "New Certification"}</span><button style={st.closeBtn} onClick={onClose}><X size={16} /></button></div>
      <div style={st.formGrid}>
        <div><label style={st.l}>Code *</label><input style={st.input} value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. 205" /></div>
        <div style={{ gridColumn: "span 2" }}><label style={st.l}>Name *</label><input style={st.input} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label style={st.l}>Section</label><input style={st.input} value={f.section} onChange={(e) => set("section", e.target.value)} placeholder="200 - Tools" /></div>
        <div><label style={st.l}>Level</label>
          <select style={st.input} value={f.level} onChange={(e) => set("level", e.target.value)}>
            <option value="">—</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option>
          </select>
        </div>
        <div><label style={st.l}>Status</label>
          <select style={st.input} value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="active">Active</option><option value="pending">Planned</option><option value="retired">Retired</option>
          </select>
        </div>
        <div style={{ gridColumn: "span 2" }}><label style={st.l}>Course material link <span style={{ fontWeight: 400, color: "#8b98a6" }}>(Google Doc, Classroom, slides — shown as a “Course material” button)</span></label><input style={st.input} value={f.classroom_url} onChange={(e) => set("classroom_url", e.target.value)} placeholder="https://docs.google.com/…" /></div>
        <div><label style={st.l}>Tool clearance?</label>
          <label style={st.checkRow}><input type="checkbox" checked={f.is_tool_gate} onChange={(e) => set("is_tool_gate", e.target.checked)} /> Gates a tool</label>
        </div>
        {f.is_tool_gate && <div><label style={st.l}>Tool name</label><input style={st.input} value={f.tool_name} onChange={(e) => set("tool_name", e.target.value)} placeholder="Band Saw" /></div>}
      </div>
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !f.code.trim() || !f.name.trim()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

function ImportPanel({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [applied, setApplied] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pick(f: File | null) {
    setFile(f); setPreview(null); setApplied(null); setErr(null);
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const res = await certApi.importProgressChart(file, dryRun);
      if (dryRun) setPreview(res);
      else { setApplied(res); onApplied(); }
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErr(msg ?? "Import failed. Check the file format and try again.");
    } finally { setBusy(false); }
  }

  const result = applied ?? preview;

  return (
    <div style={st.form}>
      <div style={st.formHead}>
        <span style={st.formTitle}><Upload size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Import Certification Progress Chart</span>
        <button style={st.closeBtn} onClick={onClose}><X size={16} /></button>
      </div>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 10px" }}>
        Upload the wide “Certification Progress Charts” CSV. Members are matched by name, and any dated
        certification is awarded. This is idempotent — members who already have a cert are skipped, so
        it’s safe to re-run after adding new members.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
          onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <button style={st.cancelBtn} onClick={() => fileRef.current?.click()}>{file ? "Choose different file…" : "Choose CSV…"}</button>
        {file && <span style={{ fontSize: 13, color: "#333" }}>{file.name}</span>}
        {file && !applied && (
          <button style={st.saveBtn} disabled={busy} onClick={() => run(true)}>{busy && !preview ? "Checking…" : "Preview"}</button>
        )}
      </div>

      {err && (
        <div style={{ ...st.resultBox, background: "#fdecea", borderColor: "#f5c6cb", color: "#9b1c1c" }}>
          <AlertTriangle size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />{err}
        </div>
      )}

      {result && (
        <div style={st.resultBox}>
          <div style={{ fontWeight: 700, color: applied ? "#1b5e20" : "#1a3a5c", marginBottom: 6 }}>
            {applied
              ? <><CheckCircle size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Import complete</>
              : "Preview (nothing saved yet)"}
          </div>
          <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 13, color: "#333", lineHeight: 1.7 }}>
            <li><b>{result.members_matched}</b> members matched · <b>{result.cert_columns}</b> certification columns</li>
            <li><b>{result.certs_awarded}</b> certifications {applied ? "awarded" : "to be awarded"} · <b>{result.certs_already_had}</b> already on file</li>
            {result.members_not_found.length > 0 && <li><b>{result.members_not_found.length}</b> rows not matched to a member</li>}
            {result.members_ambiguous.length > 0 && <li><b>{result.members_ambiguous.length}</b> ambiguous names (multiple members)</li>}
            {result.unknown_codes.length > 0 && <li><b>{result.unknown_codes.length}</b> unknown cert codes (not in catalog)</li>}
          </ul>
          {result.members_not_found.length > 0 && (
            <details style={{ fontSize: 12, color: "#777" }}>
              <summary style={{ cursor: "pointer" }}>Unmatched rows</summary>
              <div style={{ marginTop: 4 }}>{result.members_not_found.join(", ")}</div>
            </details>
          )}
          {result.members_ambiguous.length > 0 && (
            <details style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
              <summary style={{ cursor: "pointer" }}>Ambiguous names</summary>
              <div style={{ marginTop: 4 }}>{result.members_ambiguous.join(", ")}</div>
            </details>
          )}
          {result.unknown_codes.length > 0 && (
            <details style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
              <summary style={{ cursor: "pointer" }}>Unknown cert codes</summary>
              <div style={{ marginTop: 4 }}>{result.unknown_codes.join(", ")}</div>
            </details>
          )}
        </div>
      )}

      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>{applied ? "Close" : "Cancel"}</button>
        {preview && !applied && (
          <button style={st.saveBtn} disabled={busy} onClick={() => run(false)}>
            {busy ? "Importing…" : `Apply import (${preview.certs_awarded} to award)`}
          </button>
        )}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  rankBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#fff", color: "#6a1b9a", border: "1px solid #d9c2ec", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  tabs: { display: "flex", gap: 6, marginBottom: 14 },
  tab: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 20, cursor: "pointer", fontSize: 13, color: "#555" },
  tabActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  sectionCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  sectionHead: { padding: "10px 16px", background: "#f0f4f8", fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  list: { display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderTop: "1px solid #f4f6fa" },
  code: { fontFamily: "monospace", fontSize: 12, color: "#888", width: 44, flexShrink: 0 },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  rowMeta: { display: "flex", gap: 10, fontSize: 11, color: "#888", marginTop: 2, alignItems: "center", flexWrap: "wrap" },
  levelTag: { color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "1px 6px" },
  pendingTag: { color: "#e65100", background: "#fff3e0", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "1px 6px" },
  toolTag: { display: "inline-flex", alignItems: "center", gap: 3, color: "#c62828", background: "#ffebee", fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 6px" },
  earnedTag: { display: "inline-flex", alignItems: "center", gap: 3, color: "#fff", background: "#2e7d32", fontSize: 9.5, fontWeight: 700, borderRadius: 10, padding: "2px 8px" },
  link: { display: "inline-flex", alignItems: "center", gap: 3, color: "#1565c0", textDecoration: "none" },
  editBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: 5, display: "flex", color: "#888" },
  quizBtn: { background: "#f3eef8", border: "1px solid #d9c9ec", borderRadius: 6, cursor: "pointer", padding: "4px 9px", fontSize: 12, fontWeight: 600, color: "#6a1b9a" },
  takeBtn: { background: "#6a1b9a", border: "none", borderRadius: 6, cursor: "pointer", padding: "5px 11px", fontSize: 12, fontWeight: 700, color: "#fff" },
  courseBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#eef4fd", border: "1px solid #cfe0fb", borderRadius: 6, cursor: "pointer", padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#1a56c4", textDecoration: "none", whiteSpace: "nowrap" },
  muted: { color: "#aaa", fontSize: 14, padding: "1rem 0" },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 14 },
  formHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  formTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 12px" },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  checkRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#333", paddingTop: 6 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 18px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  resultBox: { marginTop: 12, padding: "10px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 },
};
