/**
 * Resume builder — self-service for every youth in the program.
 *
 * Left: a guided questionnaire. Right: a live one-page preview that is also the print
 * target. A youth fills it in, saves, and marks it finished (which counts as their
 * "resume on file" for the FDP). They can also download the PDF, polish the format
 * elsewhere and re-upload that version — both the built resume and an uploaded file are
 * honoured.
 *
 * The same page renders read-only for a parent/guardian or the Dev Program manager when
 * reached at /resume/member/:memberId — the server sets can_edit.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../../core/api";
import { resumeApi, type ResumeData, type ResumeAnswers, type ResumeQuestion } from "../api";
import ResumeDocument from "../components/ResumeDocument";
import {
  ArrowLeft, Printer, Save, CheckCircle2, RotateCcw, Upload, FileText, Loader2, Eye,
} from "lucide-react";

export default function ResumeBuilder() {
  const navigate = useNavigate();
  const { memberId } = useParams();
  const viewingOther = !!memberId;

  const [data, setData] = useState<ResumeData | null>(null);
  const [answers, setAnswers] = useState<ResumeAnswers>({});
  const [showContact, setShowContact] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [staffUrl, setStaffUrl] = useState("");   // #187 staff-attached resume link
  // On phones the form and preview stack; this toggles which one is shown.
  const [mobileView, setMobileView] = useState<"form" | "preview">("form");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    const p = viewingOther ? resumeApi.forMember(Number(memberId)) : resumeApi.mine();
    p.then((d) => {
      setData(d);
      setAnswers(d.answers ?? {});
      setShowContact(d.show_contact);
      setDirty(false);
    })
      .catch((e) => setErr(e?.response?.data?.detail ?? "Could not load the resume."))
      .finally(() => setLoading(false));
  }, [memberId, viewingOther]);
  useEffect(() => { load(); }, [load]);

  const canEdit = !!data?.can_edit && !viewingOther;

  function setAnswer(key: string, value: string | string[]) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setDirty(true);
    setMsg("");
  }
  function toggleMulti(key: string, option: string) {
    setAnswers((a) => {
      const cur = Array.isArray(a[key]) ? (a[key] as string[]) : [];
      const next = cur.includes(option) ? cur.filter((x) => x !== option) : [...cur, option];
      return { ...a, [key]: next };
    });
    setDirty(true);
    setMsg("");
  }

  async function save(opts: { complete?: boolean; uploaded_url?: string } = {}) {
    if (!data) return;
    setSaving(true); setErr(""); setMsg("");
    try {
      const d = await resumeApi.save({ answers, show_contact: showContact, ...opts });
      setData(d);
      setAnswers(d.answers ?? {});
      setShowContact(d.show_contact);
      setDirty(false);
      setMsg(opts.complete === true ? "Resume marked finished — it's now on file."
        : opts.complete === false ? "Reopened for edits."
        : opts.uploaded_url !== undefined ? (opts.uploaded_url ? "Your uploaded resume was attached." : "Uploaded resume removed.")
        : "Saved.");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  // Staff (resume.mark_complete) marking someone else's resume finished, or reopening it.
  async function staffMarkComplete(complete: boolean) {
    if (!memberId) return;
    setSaving(true); setErr(""); setMsg("");
    try {
      const d = await resumeApi.markComplete(Number(memberId), complete);
      setData(d);
      setMsg(complete ? "Marked this resume complete." : "Reopened — no longer marked complete.");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  // Staff attach/replace/clear a youth's externally-built resume by link (#187).
  async function staffAttachUrl() {
    if (!memberId) return;
    setSaving(true); setErr(""); setMsg("");
    try {
      const d = await resumeApi.setMemberUpload(Number(memberId), staffUrl.trim());
      setData(d);
      setMsg(staffUrl.trim() ? "Resume link attached and marked on file." : "Resume link removed.");
      setStaffUrl("");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(file: File) {
    if (file.size > 20 * 1024 * 1024) { setErr("That file is over 20 MB."); return; }
    setUploading(true); setErr(""); setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/api/v1/uploads/document", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await save({ uploaded_url: r.data.url });
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "The upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (loading) return <div style={s.wrap}><p style={s.muted}><Loader2 size={15} className="spin" /> Loading…</p></div>;
  if (!data) return <div style={s.wrap}><p style={s.err}>{err || "No resume."}</p></div>;

  const preview = <ResumeDocument data={{ ...data, answers, show_contact: showContact }} />;

  return (
    <div style={s.wrap}>
      {/* Print isolation: only the resume document prints, never the app chrome. */}
      <style>{PRINT_CSS}</style>

      <div className="no-print">
        <button onClick={() => (viewingOther ? navigate(-1) : navigate("/"))} style={s.back}>
          <ArrowLeft size={14} /> Back
        </button>

        <div style={s.head}>
          <div>
            <h1 style={s.h1}><FileText size={22} style={{ verticalAlign: -4 }} /> {viewingOther ? `${data.pulled.name}'s resume` : "Resume builder"}</h1>
            <p style={s.sub}>
              {viewingOther
                ? "A read-only view of this youth's resume."
                : "Answer what you can — every section is optional, and it only appears on your resume once you fill it in. Save any time, then Print → Save as PDF."}
            </p>
          </div>
          <div style={s.headActions}>
            <button style={s.ghost} onClick={() => window.print()}><Printer size={14} /> Print / Save PDF</button>
          </div>
        </div>

        {data.completed && !viewingOther && (
          <div style={s.doneBanner}>
            <CheckCircle2 size={15} /> Your resume is marked finished and on file.
            <button style={s.linkBtn} onClick={() => save({ complete: false })} disabled={saving}>
              <RotateCcw size={12} /> Reopen to edit
            </button>
          </div>
        )}

        {/* Staff (resume.mark_complete) can mark this member's resume complete, e.g. when
            it was built outside the system. */}
        {viewingOther && data.can_mark_complete && (
          <div style={s.doneBanner}>
            {data.completed
              ? <><CheckCircle2 size={15} /> This resume is marked complete{data.completed_at ? ` (${new Date(data.completed_at).toLocaleDateString()})` : ""}.
                  <button style={s.linkBtn} onClick={() => staffMarkComplete(false)} disabled={saving}><RotateCcw size={12} /> Reopen</button></>
              : <><span>Resume not marked complete.</span>
                  <button style={s.linkBtn} onClick={() => staffMarkComplete(true)} disabled={saving}><CheckCircle2 size={12} /> Mark complete</button></>}
          </div>
        )}

        {/* #187 — staff attach a youth's externally-built resume by link (e.g. a shared Drive URL). */}
        {viewingOther && data.can_mark_complete && (
          <div style={s.doneBanner}>
            {data.uploaded_url
              ? <><a href={data.uploaded_url} target="_blank" rel="noopener noreferrer" style={s.link}><FileText size={13} /> Resume on file</a>
                  <button style={s.linkBtn} onClick={staffAttachUrl} disabled={saving}>Remove</button></>
              : <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%" }}>
                  <span style={{ fontSize: 13 }}>Attach a resume link:</span>
                  <input style={s.input} placeholder="https://… (shared Drive link)" value={staffUrl}
                    onChange={(e) => setStaffUrl(e.target.value)} />
                  <button style={s.linkBtn} onClick={staffAttachUrl} disabled={saving || !staffUrl.trim()}><Upload size={12} /> Attach</button>
                </div>}
          </div>
        )}

        {msg && <div style={s.ok}>{msg}</div>}
        {err && <div style={s.err}>{err}</div>}

        {/* Mobile-only switch between the form and the preview. */}
        <div className="resume-mobile-switch" style={s.mobileSwitch}>
          <button style={mobileView === "form" ? s.switchOn : s.switchOff} onClick={() => setMobileView("form")}>Edit</button>
          <button style={mobileView === "preview" ? s.switchOn : s.switchOff} onClick={() => setMobileView("preview")}><Eye size={13} /> Preview</button>
        </div>
      </div>

      <div style={s.cols}>
        {/* ── Questionnaire ── */}
        <div className={`no-print resume-form ${mobileView === "form" ? "" : "resume-hide-mobile"}`} style={s.formCol}>
          {canEdit ? (
            <>
              {data.questions.map((q) => (
                <Field key={q.key} q={q} answers={answers} data={data}
                  onText={setAnswer} onToggle={toggleMulti} />
              ))}

              <div style={s.contactRow}>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={showContact} onChange={(e) => { setShowContact(e.target.checked); setDirty(true); }} />
                  Show my TRC email on the printed resume
                </label>
                <p style={s.help}>Your name, grade and school always show. We never put a home address or personal phone on a youth resume.</p>
              </div>

              <div style={s.saveBar}>
                <button style={s.primary} onClick={() => save()} disabled={saving || !dirty}>
                  {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {dirty ? "Save" : "Saved"}
                </button>
                {!data.completed ? (
                  <button style={s.finish} onClick={() => save({ complete: true })} disabled={saving}>
                    <CheckCircle2 size={14} /> Mark finished
                  </button>
                ) : null}
              </div>

              {/* Upload-your-own-version */}
              <div style={s.uploadBox}>
                <div style={s.uploadH}>Prefer your own version?</div>
                <p style={s.help}>
                  Build it here, download the PDF, reformat it however you like, then upload that file. An uploaded resume also counts as your resume on file.
                </p>
                {data.uploaded_url && (
                  <div style={s.uploadedRow}>
                    <a href={data.uploaded_url} target="_blank" rel="noopener noreferrer" style={s.link}><FileText size={13} /> Your uploaded resume</a>
                    <button style={s.linkBtn} onClick={() => save({ uploaded_url: "" })} disabled={saving}>Remove</button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.rtf,.odt,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
                <button style={s.ghost} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {data.uploaded_url ? "Replace file" : "Upload a file"}
                </button>
              </div>
            </>
          ) : (
            <p style={s.muted}>This resume is read-only from here.</p>
          )}
        </div>

        {/* ── Live preview / print target ── */}
        <div className={`resume-preview ${mobileView === "preview" ? "" : "resume-hide-mobile"}`} style={s.previewCol}>
          {preview}
        </div>
      </div>
    </div>
  );
}

/** One question's input, chosen by its type. */
function Field({ q, answers, data, onText, onToggle }: {
  q: ResumeQuestion; answers: ResumeAnswers; data: ResumeData;
  onText: (k: string, v: string) => void; onToggle: (k: string, opt: string) => void;
}) {
  const val = answers[q.key];
  if (q.type === "skills" || q.type === "positions") {
    const options = q.type === "skills" ? data.skill_options : data.position_options;
    const chosen = Array.isArray(val) ? val : [];
    return (
      <div style={s.field}>
        <label style={s.label}>{q.label}</label>
        {q.help && <p style={s.help}>{q.help}</p>}
        <div style={s.checkGrid}>
          {options.map((opt) => (
            <label key={opt} style={{ ...s.optLabel, ...(chosen.includes(opt) ? s.optOn : {}) }}>
              <input type="checkbox" checked={chosen.includes(opt)} onChange={() => onToggle(q.key, opt)} />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }
  const str = typeof val === "string" ? val : "";
  return (
    <div style={s.field}>
      <label style={s.label}>{q.label}</label>
      {q.help && <p style={s.help}>{q.help}</p>}
      {q.type === "textarea" ? (
        <textarea style={s.textarea} rows={3} value={str} onChange={(e) => onText(q.key, e.target.value)}
          placeholder="One per line" />
      ) : (
        <input style={s.input} type={q.type === "number" ? "number" : "text"} value={str}
          onChange={(e) => onText(q.key, e.target.value)} />
      )}
    </div>
  );
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .resume-print-area, .resume-print-area * { visibility: visible !important; }
  .resume-print-area { position: absolute !important; left: 0; top: 0; width: 100%; max-width: none !important; box-shadow: none !important; padding: 0 !important; }
  /* The paper is narrower than the mobile breakpoint and the on-screen view may be
     toggled to the form, so force the resume preview visible when printing. */
  .resume-preview { display: block !important; }
}
/* Responsive toggles are SCREEN-only — otherwise the print paper width (~816px for
   Letter) trips the mobile breakpoint and hides the resume, printing blank pages. */
@media screen and (max-width: 860px) {
  .resume-hide-mobile { display: none !important; }
}
@media screen and (min-width: 861px) {
  .resume-mobile-switch { display: none !important; }
}
`;

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 1180, margin: "0 auto", padding: "0 4px" },
  back: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#5a6b7d", cursor: "pointer", fontSize: 13, padding: "8px 0" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  headActions: { display: "flex", gap: 8 },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a2634", margin: 0 },
  sub: { fontSize: 13, color: "#7a8899", margin: "4px 0 0", maxWidth: 620, lineHeight: 1.5 },
  cols: { display: "flex", gap: 20, alignItems: "flex-start", marginTop: 12 },
  formCol: { flex: "1 1 420px", minWidth: 0 },
  previewCol: { flex: "1 1 520px", minWidth: 0, background: "#f4f6f9", borderRadius: 10, padding: 16, position: "sticky", top: 12 },
  field: { marginBottom: 14 },
  label: { display: "block", fontSize: 13, fontWeight: 700, color: "#33475b", marginBottom: 4 },
  help: { fontSize: 12, color: "#8b98a6", margin: "0 0 6px", lineHeight: 1.4 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  textarea: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" },
  checkGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 },
  optLabel: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#33475b", background: "#f2f5f8", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 9px", cursor: "pointer" },
  optOn: { background: "#e6f2ef", borderColor: "#8fc9bb", color: "#0b5c4f" },
  contactRow: { marginTop: 6, marginBottom: 8, padding: "10px 12px", background: "#f7fafc", border: "1px solid #e2e8f0", borderRadius: 8 },
  checkLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#33475b", cursor: "pointer", fontWeight: 600 },
  saveBar: { display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" },
  primary: { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 7, fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  finish: { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", background: "#fff", color: "#0b5c4f", border: "1px solid #8fc9bb", borderRadius: 7, fontSize: 13.5, fontWeight: 700, cursor: "pointer" },
  ghost: { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, color: "#33475b", cursor: "pointer" },
  uploadBox: { marginTop: 18, padding: "14px 16px", border: "1px dashed #c3cedd", borderRadius: 10, background: "#fbfcfe" },
  uploadH: { fontSize: 13.5, fontWeight: 700, color: "#33475b", marginBottom: 2 },
  uploadedRow: { display: "flex", alignItems: "center", gap: 12, margin: "6px 0 10px" },
  link: { display: "inline-flex", alignItems: "center", gap: 5, color: "#1565c0", fontSize: 13, textDecoration: "none" },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 },
  doneBanner: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", background: "#eef7f0", border: "1px solid #b7dcc0", color: "#2e7d32", borderRadius: 8, padding: "9px 12px", fontSize: 13, margin: "8px 0" },
  mobileSwitch: { display: "flex", gap: 6, margin: "10px 0 0" },
  switchOn: { flex: 1, padding: "8px 0", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 },
  switchOff: { flex: 1, padding: "8px 0", background: "#fff", color: "#33475b", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 },
  ok: { fontSize: 13, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 7, padding: "8px 12px", margin: "8px 0" },
  err: { fontSize: 13, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6c2", borderRadius: 7, padding: "8px 12px", margin: "8px 0" },
  muted: { fontSize: 13, color: "#8b98a6" },
};
