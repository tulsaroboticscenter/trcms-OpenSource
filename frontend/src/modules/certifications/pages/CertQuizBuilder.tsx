/**
 * CertQuizBuilder — author a certification's quiz (Certification Quiz Engine, hidden
 * until enabled). Admins reach it from the Certifications catalog. Create/edit questions,
 * set the pass threshold, and publish. Passing the quiz later awards the certification.
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { certApi, type CertQuiz, type QuizQuestion, type QuizQuestionType, type QuizQuestionInput } from "../api";
import { ArrowLeft, PlusCircle, Trash2, Save, Eye, EyeOff, AlertTriangle, GripVertical, BarChart3 } from "lucide-react";

const TYPES: { v: QuizQuestionType; l: string }[] = [
  { v: "single", l: "Multiple choice (one answer)" },
  { v: "multi", l: "Multiple choice (several answers)" },
  { v: "truefalse", l: "True / False" },
  { v: "short", l: "Short answer" },
];

export default function CertQuizBuilder() {
  const { certId } = useParams();
  const cid = Number(certId);
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, canWrite } = useAuth();
  const canManageLms = isAdmin || canWrite("cert_lms.manage");
  const nav = (location.state ?? {}) as { code?: string; name?: string };

  const [quiz, setQuiz] = useState<CertQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [issues, setIssues] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    certApi.getQuiz(cid).then(setQuiz).catch(() => setErr("Couldn't load this quiz.")).finally(() => setLoading(false));
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  if (!canManageLms) return <p style={s.muted}>This area isn't available.</p>;
  if (loading) return <p style={s.muted}>Loading…</p>;

  const title = nav.name ? `${nav.code ? nav.code + " · " : ""}${nav.name}` : `Certification #${cid}`;

  async function publish(next: boolean) {
    setErr(""); setIssues([]);
    try { setQuiz(await certApi.publishQuiz(cid, next)); }
    catch (e: unknown) {
      const r = (e as { response?: { data?: { detail?: string; issues?: string[] } } })?.response?.data;
      if (r?.issues) setIssues(r.issues);
      setErr(r?.detail ?? "Couldn't update publish state.");
    }
  }

  return (
    <div style={s.wrap}>
      <button style={s.back} onClick={() => navigate("/certifications")}><ArrowLeft size={14} /> Certifications</button>

      <div style={s.head}>
        <div>
          <div style={s.eyebrow}>Quiz</div>
          <h1 style={s.h1}>{title}</h1>
        </div>
        {quiz && (
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.resultsBtn} onClick={() => navigate(`/certifications/${cid}/quiz/attempts`, { state: nav })}>
              <BarChart3 size={15} /> Results
            </button>
            <button style={quiz.is_published ? s.unpubBtn : s.pubBtn} onClick={() => publish(!quiz.is_published)}>
              {quiz.is_published ? <><EyeOff size={15} /> Unpublish</> : <><Eye size={15} /> Publish</>}
            </button>
          </div>
        )}
      </div>

      <div style={s.hiddenNote}>
        <AlertTriangle size={14} /> This whole feature is hidden from members until an admin turns it on in Certification settings. You can build and test it now.
      </div>

      {err && <div style={s.err}>{err}{issues.length > 0 && <ul style={s.issues}>{issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}</div>}

      <MetaEditor cid={cid} quiz={quiz} onSaved={setQuiz} />

      <div style={s.qHead}>
        <h2 style={s.h2}>Questions {quiz && <span style={s.count}>· {quiz.question_count}</span>}</h2>
      </div>

      <div style={s.qList}>
        {quiz?.questions.map((q, i) => (
          <QuestionEditor key={q.id} cid={cid} index={i} question={q} onChange={setQuiz} />
        ))}
        <NewQuestion cid={cid} onAdded={setQuiz} />
      </div>
    </div>
  );
}

/** Quiz-level settings: title, instructions, pass %, attempts, shuffle. */
function MetaEditor({ cid, quiz, onSaved }: { cid: number; quiz: CertQuiz | null; onSaved: (q: CertQuiz) => void }) {
  const [title, setTitle] = useState(quiz?.title ?? "");
  const [instructions, setInstructions] = useState(quiz?.instructions ?? "");
  const [passPct, setPassPct] = useState(String(quiz?.pass_pct ?? 80));
  const [maxAttempts, setMaxAttempts] = useState(quiz?.max_attempts != null ? String(quiz.max_attempts) : "");
  const [shuffle, setShuffle] = useState(quiz?.shuffle_questions ?? false);
  const [holdResults, setHoldResults] = useState(quiz?.hold_results ?? false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    setTitle(quiz?.title ?? ""); setInstructions(quiz?.instructions ?? "");
    setPassPct(String(quiz?.pass_pct ?? 80)); setMaxAttempts(quiz?.max_attempts != null ? String(quiz.max_attempts) : "");
    setShuffle(quiz?.shuffle_questions ?? false); setHoldResults(quiz?.hold_results ?? false);
  }, [quiz?.id]);

  async function save() {
    setSaving(true);
    try {
      const q = await certApi.saveQuizMeta(cid, {
        title: title.trim() || undefined, instructions: instructions.trim() || undefined,
        pass_pct: Math.min(100, Math.max(1, parseInt(passPct) || 80)),
        max_attempts: maxAttempts.trim() === "" ? null : Math.max(1, parseInt(maxAttempts) || 1),
        shuffle_questions: shuffle,
        hold_results: holdResults,
      });
      onSaved(q); setSavedMsg("Saved."); setTimeout(() => setSavedMsg(""), 2500);
    } finally { setSaving(false); }
  }

  return (
    <div style={s.card}>
      <div style={s.grid2}>
        <div style={{ gridColumn: "span 2" }}>
          <label style={s.l}>Quiz title <span style={s.hint}>(optional — defaults to the certification name)</span></label>
          <input style={s.in} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label style={s.l}>Instructions <span style={s.hint}>(shown before the first question)</span></label>
          <textarea style={s.ta} rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>
        <div><label style={s.l}>Passing score %</label><input style={s.in} type="number" min={1} max={100} value={passPct} onChange={(e) => setPassPct(e.target.value)} /></div>
        <div><label style={s.l}>Max attempts <span style={s.hint}>(blank = unlimited)</span></label><input style={s.in} type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} placeholder="Unlimited" /></div>
      </div>
      <label style={s.check}><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> Shuffle question order for each attempt</label>
      <label style={s.check}><input type="checkbox" checked={holdResults} onChange={(e) => setHoldResults(e.target.checked)} /> Hold results for my review <span style={s.hint}>(the score and pass/fail stay hidden from the student until you review the attempt in the gradebook and release it — otherwise results show as soon as they submit)</span></label>
      <div style={s.metaFoot}>
        {savedMsg && <span style={s.savedMsg}>{savedMsg}</span>}
        <button style={s.saveBtn} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}

const blankDraft = (): QuizQuestionInput & { tfCorrect: boolean; shortKey: string } => ({
  type: "single", prompt: "", points: 1, options: [{ label: "", is_correct: false }, { label: "", is_correct: false }],
  explanation: "", tfCorrect: true, shortKey: "",
});

/** Add a brand-new question. */
function NewQuestion({ cid, onAdded }: { cid: number; onAdded: (q: CertQuiz) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button style={s.addQ} onClick={() => setOpen(true)}><PlusCircle size={16} /> Add a question</button>;
  return <QuestionForm cid={cid} onDone={(q) => { onAdded(q); setOpen(false); }} onCancel={() => setOpen(false)} />;
}

/** Edit an existing question (expand to edit). */
function QuestionEditor({ cid, index, question, onChange }: { cid: number; index: number; question: QuizQuestion; onChange: (q: CertQuiz) => void }) {
  const [editing, setEditing] = useState(false);
  async function del() {
    if (!confirm("Delete this question?")) return;
    onChange(await certApi.deleteQuestion(question.id));
  }
  if (editing) {
    return <QuestionForm cid={cid} existing={question} onDone={(q) => { onChange(q); setEditing(false); }} onCancel={() => setEditing(false)} />;
  }
  return (
    <div style={s.qCard}>
      <div style={s.qCardHead}>
        <span style={s.qNum}><GripVertical size={13} color="#b0bcc9" /> {index + 1}</span>
        <span style={s.qType}>{TYPES.find((t) => t.v === question.type)?.l ?? question.type} · {question.points} pt{question.points === 1 ? "" : "s"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={s.smallBtn} onClick={() => setEditing(true)}>Edit</button>
          <button style={s.iconDanger} onClick={del} title="Delete question"><Trash2 size={13} /></button>
        </div>
      </div>
      <div style={s.qPrompt}>{question.prompt || <em style={{ color: "#a00" }}>No question text</em>}</div>
      {question.image_url && <img src={question.image_url} alt="" style={s.imgThumb} />}
      {question.type !== "short" && (
        <ul style={s.optList}>
          {question.options.map((o) => (
            <li key={o.id} style={{ ...s.optView, ...(o.is_correct ? s.optCorrect : {}) }}>
              {o.is_correct ? "●" : "○"} {o.label}
            </li>
          ))}
        </ul>
      )}
      {question.type === "short" && (
        <div style={s.shortView}>{(question.answer_key ?? []).length ? `Accepts: ${(question.answer_key ?? []).join(", ")}` : "Graded manually (no answer key)"}</div>
      )}
    </div>
  );
}

/** The add/edit form for a single question, handling every question type. */
function QuestionForm({ cid, existing, onDone, onCancel }: { cid: number; existing?: QuizQuestion; onDone: (q: CertQuiz) => void; onCancel: () => void }) {
  const init = existing
    ? {
        type: existing.type, prompt: existing.prompt, points: existing.points,
        options: existing.type === "short" || existing.type === "truefalse" ? blankDraft().options : existing.options.map((o) => ({ label: o.label, is_correct: !!o.is_correct })),
        explanation: existing.explanation ?? "",
        tfCorrect: existing.type === "truefalse" ? !!existing.options.find((o) => /true/i.test(o.label))?.is_correct : true,
        shortKey: (existing.answer_key ?? []).join("\n"),
        imageUrl: existing.image_url ?? "",
      }
    : { ...blankDraft(), imageUrl: "" };
  const [type, setType] = useState<QuizQuestionType>(init.type);
  const [prompt, setPrompt] = useState(init.prompt);
  const [points, setPoints] = useState(String(init.points));
  const [options, setOptions] = useState<{ label: string; is_correct: boolean }[]>(init.options ?? []);
  const [explanation, setExplanation] = useState(init.explanation ?? "");
  const [tfCorrect, setTfCorrect] = useState(init.tfCorrect);
  const [shortKey, setShortKey] = useState(init.shortKey);
  const [imageUrl, setImageUrl] = useState(init.imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  function setOpt(i: number, patch: Partial<{ label: string; is_correct: boolean }>) {
    setOptions((os) => os.map((o, n) => (n === i ? { ...o, ...patch } : o)));
  }
  function pickCorrect(i: number) { setOptions((os) => os.map((o, n) => ({ ...o, is_correct: n === i }))); }

  async function save() {
    if (prompt.trim() === "") { setMsg("Enter the question text."); return; }
    let payload: QuizQuestionInput;
    const img = imageUrl.trim() || null;
    if (type === "truefalse") {
      payload = { type, prompt: prompt.trim(), points: parseInt(points) || 1, options: [{ label: "True", is_correct: tfCorrect }, { label: "False", is_correct: !tfCorrect }], explanation: explanation.trim() || null, image_url: img };
    } else if (type === "short") {
      const key = shortKey.split("\n").map((x) => x.trim()).filter(Boolean);
      payload = { type, prompt: prompt.trim(), points: parseInt(points) || 1, answer_key: key, explanation: explanation.trim() || null, image_url: img };
    } else {
      const opts = options.filter((o) => o.label.trim() !== "").map((o) => ({ label: o.label.trim(), is_correct: !!o.is_correct }));
      payload = { type, prompt: prompt.trim(), points: parseInt(points) || 1, options: opts, explanation: explanation.trim() || null, image_url: img };
    }
    setSaving(true);
    try {
      const q = existing ? await certApi.updateQuestion(existing.id, payload) : await certApi.addQuestion(cid, payload);
      onDone(q);
    } finally { setSaving(false); }
  }

  return (
    <div style={s.qEdit}>
      <div style={s.grid2}>
        <div><label style={s.l}>Question type</label>
          <select style={s.in} value={type} onChange={(e) => setType(e.target.value as QuizQuestionType)}>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        <div><label style={s.l}>Points {type === "multi" && <span style={s.hint}>(per correct answer)</span>}</label><input style={s.in} type="number" min={1} value={points} onChange={(e) => setPoints(e.target.value)} /></div>
      </div>
      <label style={s.l}>Question</label>
      <textarea style={s.ta} rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What are you asking?" />

      <label style={s.l}>Image <span style={s.hint}>(optional — paste a link to a hosted image to ask about; uploads aren’t supported)</span></label>
      <input style={s.in} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/image.png" />
      {imageUrl.trim() !== "" && (
        <img src={imageUrl} alt="" style={s.imgPreview} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          onLoad={(e) => ((e.target as HTMLImageElement).style.display = "block")} />
      )}

      {(type === "single" || type === "multi") && (
        <div style={s.opts}>
          <label style={s.l}>Choices <span style={s.hint}>{type === "single" ? "— pick the one correct answer" : "— check every correct answer"}</span></label>
          {type === "multi" && <div style={s.hint}>Partial credit: the student earns the points above for each correct answer they select, and loses that many for each pick beyond the number of correct answers (never below zero).</div>}
          {options.map((o, i) => (
            <div key={i} style={s.optRow}>
              {type === "single"
                ? <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => pickCorrect(i)} />
                : <input type="checkbox" checked={!!o.is_correct} onChange={(e) => setOpt(i, { is_correct: e.target.checked })} />}
              <input style={s.optInput} value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} placeholder={`Choice ${i + 1}`} />
              <button style={s.iconDanger} onClick={() => setOptions((os) => os.filter((_, n) => n !== i))} title="Remove choice"><Trash2 size={12} /></button>
            </div>
          ))}
          <button style={s.addOpt} onClick={() => setOptions((os) => [...os, { label: "", is_correct: false }])}><PlusCircle size={13} /> Add choice</button>
        </div>
      )}
      {type === "truefalse" && (
        <div style={s.opts}>
          <label style={s.l}>Correct answer</label>
          <div style={{ display: "flex", gap: 16 }}>
            <label style={s.tf}><input type="radio" checked={tfCorrect} onChange={() => setTfCorrect(true)} /> True</label>
            <label style={s.tf}><input type="radio" checked={!tfCorrect} onChange={() => setTfCorrect(false)} /> False</label>
          </div>
        </div>
      )}
      {type === "short" && (
        <div style={s.opts}>
          <label style={s.l}>Accepted answers <span style={s.hint}>— one per line; leave blank to grade by hand</span></label>
          <textarea style={s.ta} rows={2} value={shortKey} onChange={(e) => setShortKey(e.target.value)} placeholder="e.g.&#10;safety glasses&#10;goggles" />
        </div>
      )}

      <label style={s.l}>Explanation <span style={s.hint}>(optional — shown after they answer)</span></label>
      <input style={s.in} value={explanation} onChange={(e) => setExplanation(e.target.value)} />

      <div style={s.editFoot}>
        {msg && <span style={s.errText}>{msg}</span>}
        <button style={s.ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={s.saveBtn} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save question"}</button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#4a5b6d", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" },
  eyebrow: { fontSize: 11, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#00695c" },
  h1: { fontSize: 22, margin: "2px 0 0", color: "#1a3a5c" },
  h2: { fontSize: 15, margin: 0, color: "#1a3a5c" },
  count: { color: "#889", fontWeight: 400 },
  hiddenNote: { display: "flex", alignItems: "center", gap: 8, background: "#fff8e1", border: "1px solid #ffe0a3", color: "#7a5b12", borderRadius: 8, padding: "9px 13px", fontSize: 12.5, margin: "14px 0" },
  err: { background: "#fdecea", border: "1px solid #f5c2c0", color: "#c62828", borderRadius: 8, padding: "10px 13px", fontSize: 13.5, margin: "12px 0" },
  issues: { margin: "6px 0 0", paddingLeft: 18 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px", marginTop: 6 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" },
  l: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "8px 0 3px" },
  hint: { fontWeight: 400, color: "#8b98a6" },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box" },
  ta: { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 13.5, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" },
  imgPreview: { display: "block", maxWidth: "100%", maxHeight: 200, borderRadius: 8, border: "1px solid #e2e8f0", marginTop: 8 },
  imgThumb: { display: "block", maxWidth: 260, maxHeight: 150, borderRadius: 7, border: "1px solid #e2e8f0", margin: "2px 0 8px" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334", marginTop: 12, cursor: "pointer" },
  metaFoot: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 12 },
  savedMsg: { fontSize: 12.5, color: "#2e7d32", fontWeight: 600 },
  qHead: { marginTop: 26, marginBottom: 10 },
  qList: { display: "flex", flexDirection: "column", gap: 10 },
  qCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "13px 15px" },
  qCardHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 7 },
  qNum: { display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 700, color: "#1a3a5c", fontSize: 13 },
  qType: { fontSize: 11.5, color: "#7a8899", background: "#f2f5f8", borderRadius: 10, padding: "2px 9px" },
  qPrompt: { fontSize: 14, color: "#22303f", marginBottom: 8 },
  optList: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 },
  optView: { fontSize: 13, color: "#556" },
  optCorrect: { color: "#2e7d32", fontWeight: 600 },
  shortView: { fontSize: 12.5, color: "#667", fontStyle: "italic" },
  qEdit: { background: "#fff", border: "1px solid #cfe0dc", borderRadius: 10, padding: "16px 18px", boxShadow: "0 2px 8px rgba(0,60,40,.06)" },
  opts: { marginTop: 10 },
  optRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 },
  optInput: { flex: 1, padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, boxSizing: "border-box" },
  addOpt: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#00695c", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "8px 0 0" },
  tf: { display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, color: "#334", cursor: "pointer" },
  editFoot: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 16 },
  addQ: { display: "inline-flex", alignItems: "center", gap: 7, background: "#f4f8f7", border: "1px dashed #a8c8bf", color: "#00695c", borderRadius: 9, padding: "11px 15px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", justifyContent: "center" },
  saveBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#00695c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ghostBtn: { background: "none", border: "1px solid #cdd7e3", borderRadius: 7, padding: "8px 14px", fontSize: 13, color: "#4a5b6d", cursor: "pointer" },
  smallBtn: { background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, padding: "5px 11px", fontSize: 12.5, color: "#1a3a5c", cursor: "pointer", fontWeight: 600 },
  iconDanger: { background: "#fff", border: "1px solid #f0c5c5", borderRadius: 6, padding: "5px 8px", color: "#c62828", cursor: "pointer", display: "inline-flex" },
  resultsBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#6a1b9a", border: "1px solid #d9c9ec", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  pubBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  unpubBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#c07a1a", border: "1px solid #e6c07a", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  errText: { fontSize: 12.5, color: "#c62828", marginRight: "auto" },
  muted: { color: "#889", fontSize: 14 },
};
