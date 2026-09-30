/**
 * CertQuizTake — a learner takes a certification's quiz (Certification Quiz Engine).
 * Intro → questions → auto-graded result. Passing awards the certification automatically.
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { certApi, type MyQuiz, type QuizAttemptStart, type QuizResult, type SubmitAnswer } from "../api";
import { ArrowLeft, Award, CheckCircle2, XCircle, Clock } from "lucide-react";

type View = "intro" | "taking" | "result";

export default function CertQuizTake() {
  const { certId } = useParams();
  const cid = Number(certId);
  const navigate = useNavigate();
  const nav = (useLocation().state ?? {}) as { code?: string; name?: string };
  const heading = nav.name ? `${nav.code ? nav.code + " · " : ""}${nav.name}` : `Certification #${cid}`;

  const [view, setView] = useState<View>("intro");
  const [mine, setMine] = useState<MyQuiz | null>(null);
  const [attempt, setAttempt] = useState<QuizAttemptStart | null>(null);
  const [answers, setAnswers] = useState<Record<number, { opts: number[]; text: string }>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadMine = useCallback(() => {
    certApi.myQuiz(cid).then(setMine).catch(() => setErr("Couldn't load this quiz."));
  }, [cid]);
  useEffect(() => { loadMine(); }, [loadMine]);

  async function start() {
    setErr(""); setBusy(true);
    try {
      const a = await certApi.startQuiz(cid);
      setAttempt(a); setAnswers({}); setView("taking");
    } catch (e: unknown) {
      const r = (e as { response?: { data?: { detail?: string; missing?: string[] } } })?.response?.data;
      setErr(r?.missing ? `${r.detail} Missing: ${r.missing.join(", ")}` : (r?.detail ?? "Couldn't start the quiz."));
    } finally { setBusy(false); }
  }

  function setOne(qid: number, optId: number) { setAnswers((a) => ({ ...a, [qid]: { opts: [optId], text: "" } })); }
  function toggleMany(qid: number, optId: number) {
    setAnswers((a) => {
      const cur = a[qid]?.opts ?? [];
      const opts = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId];
      return { ...a, [qid]: { opts, text: "" } };
    });
  }
  function setText(qid: number, text: string) { setAnswers((a) => ({ ...a, [qid]: { opts: [], text } })); }

  async function submit() {
    if (!attempt) return;
    const payload: SubmitAnswer[] = attempt.questions.map((q) => {
      const a = answers[q.id];
      return q.type === "short"
        ? { question_id: q.id, response_text: a?.text ?? "" }
        : { question_id: q.id, selected_option_ids: a?.opts ?? [] };
    });
    setBusy(true); setErr("");
    try { setResult(await certApi.submitAttempt(attempt.attempt_id, payload)); setView("result"); }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't submit."); }
    finally { setBusy(false); }
  }

  const answeredCount = attempt ? attempt.questions.filter((q) => {
    const a = answers[q.id];
    return q.type === "short" ? (a?.text ?? "").trim() !== "" : (a?.opts?.length ?? 0) > 0;
  }).length : 0;

  return (
    <div style={s.wrap}>
      <button style={s.back} onClick={() => navigate("/certifications")}><ArrowLeft size={14} /> Certifications</button>
      <div style={s.eyebrow}>Quiz</div>
      <h1 style={s.h1}>{heading}</h1>
      {err && <div style={s.err}>{err}</div>}

      {/* INTRO */}
      {view === "intro" && (
        mine === null ? <p style={s.muted}>Loading…</p> :
        !mine.available ? <p style={s.muted}>There's no quiz available for this certification yet.</p> : (
          <div style={s.card}>
            {mine.ever_passed && (
              <div style={s.passBanner}><Award size={16} /> You've passed this quiz — the certification is on your record.</div>
            )}
            <p style={s.lead}>
              Answer the questions and submit. You need {mine.pass_pct}% to pass{mine.hold_results ? "" : ", and passing awards this certification automatically"}.
              {mine.hold_results && " Your instructor reviews each submission and releases your results afterward."}
              {mine.max_attempts == null && " You can retake it as many times as you need."}
            </p>
            <div style={s.metaRow}>
              <span>Passing score: <strong>{mine.pass_pct}%</strong></span>
              <span>Attempts: <strong>{mine.max_attempts == null ? "unlimited" : `${mine.attempts_used ?? 0} of ${mine.max_attempts}`}</strong></span>
            </div>
            {mine.attempts.length > 0 && (
              <div style={s.history}>
                <div style={s.histHead}>Your attempts</div>
                {mine.attempts.map((a) => (
                  <button key={a.id} style={s.histRow} onClick={() => certApi.getAttempt(a.id).then((r) => { setResult(r); setView("result"); })}>
                    <span>{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "In progress"}</span>
                    <span>{a.status === "submitted" ? <em style={{ color: "#c07a1a" }}>Awaiting review</em> : a.score_pct != null ? `${Math.round(a.score_pct)}%` : "—"}</span>
                    <span>{a.passed === true ? <span style={s.passTag}>Passed</span> : a.passed === false ? <span style={s.failTag}>Not yet</span> : ""}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={s.introFoot}>
              {mine.can_take
                ? <button style={s.primary} onClick={start} disabled={busy}>{busy ? "Starting…" : mine.attempts.length ? "Retake quiz" : "Start quiz"}</button>
                : <span style={s.muted}>You've used all your attempts.</span>}
            </div>
          </div>
        )
      )}

      {/* TAKING */}
      {view === "taking" && attempt && (
        <div>
          {attempt.instructions && <div style={s.instructions}>{attempt.instructions}</div>}
          <div style={s.qList}>
            {attempt.questions.map((q, i) => (
              <div key={q.id} style={s.qCard}>
                <div style={s.qPrompt}><span style={s.qNum}>{i + 1}.</span> {q.prompt} <span style={s.pts}>({q.points} pt{q.points === 1 ? "" : "s"})</span></div>
                {q.image_url && <img src={q.image_url} alt="" style={s.qImg} />}
                {q.type === "short" ? (
                  <input style={s.textIn} value={answers[q.id]?.text ?? ""} onChange={(e) => setText(q.id, e.target.value)} placeholder="Your answer" />
                ) : (
                  <div style={s.opts}>
                    {q.options.map((o) => {
                      const picked = (answers[q.id]?.opts ?? []).includes(o.id);
                      const multi = q.type === "multi";
                      return (
                        <label key={o.id} style={{ ...s.opt, ...(picked ? s.optPicked : {}) }}>
                          <input type={multi ? "checkbox" : "radio"} name={`q${q.id}`} checked={picked}
                            onChange={() => (multi ? toggleMany(q.id, o.id) : setOne(q.id, o.id))} />
                          <span>{o.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={s.submitBar}>
            <span style={s.muted}>{answeredCount} of {attempt.questions.length} answered</span>
            <button style={s.primary} onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit quiz"}</button>
          </div>
        </div>
      )}

      {/* RESULT */}
      {view === "result" && result && (
        <div>
          <div style={{ ...s.resultBanner, ...(result.pending_review ? s.bPending : result.passed ? s.bPass : s.bFail) }}>
            {result.pending_review ? <><Clock size={20} /> <div><strong>Submitted — awaiting review.</strong> Your instructor will review this and release your results. Check back later to see your score.</div></>
              : result.passed ? <><CheckCircle2 size={20} /> <div><strong>Passed — {Math.round(result.score_pct ?? 0)}%.</strong> {result.awarded ? "Certification awarded!" : "You already hold this certification."}</div></>
              : <><XCircle size={20} /> <div><strong>Not yet — {Math.round(result.score_pct ?? 0)}%.</strong> You need {result.pass_pct}% to pass. Review below and try again.</div></>}
          </div>
          {result.awarded && <div style={s.awardChip}><Award size={14} /> Added to your certifications</div>}

          <div style={s.qList}>
            {result.questions.map((q, i) => {
              const pend = result.pending_review;
              return (
                <div key={q.id} style={s.qCard}>
                  <div style={s.qPrompt}>
                    <span style={s.qNum}>{i + 1}.</span> {q.prompt}
                    {!pend && q.is_correct === true ? <CheckCircle2 size={15} color="#2e7d32" style={{ marginLeft: 6, verticalAlign: -2 }} />
                      : !pend && q.is_correct === false ? <XCircle size={15} color="#c62828" style={{ marginLeft: 6, verticalAlign: -2 }} />
                      : <span style={s.pendTag}>awaiting review</span>}
                    {!pend && q.type === "multi" && q.points_earned != null && (
                      <span style={s.ptsBadge}>{q.points_earned} / {q.points_possible} pts</span>
                    )}
                  </div>
                  {q.image_url && <img src={q.image_url} alt="" style={s.qImg} />}
                  {q.type === "short" ? (
                    <div style={s.shortReview}>
                      <div>Your answer: <strong>{q.your_text || <em>(blank)</em>}</strong></div>
                      {!pend && q.answer_key.length > 0 && <div style={s.muted}>Accepted: {q.answer_key.join(", ")}</div>}
                    </div>
                  ) : (
                    <div style={s.opts}>
                      {q.options.map((o) => {
                        const chosen = q.your_option_ids.includes(o.id);
                        const style = pend
                          ? (chosen ? s.optChosen : {})
                          : (o.is_correct ? s.optRight : chosen ? s.optWrong : {});
                        return (
                          <div key={o.id} style={{ ...s.optReview, ...style }}>
                            {pend ? (chosen ? "◉" : "○") : o.is_correct ? "✓" : chosen ? "✗" : "○"} {o.label}
                            {chosen && (pend || !o.is_correct) && <span style={s.youPicked}> — your answer</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {!pend && q.explanation && <div style={s.explain}>{q.explanation}</div>}
                </div>
              );
            })}
          </div>
          <div style={s.submitBar}>
            <button style={s.ghost} onClick={() => { setResult(null); setView("intro"); loadMine(); }}>Back to overview</button>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 720, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#4a5b6d", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 8 },
  eyebrow: { fontSize: 11, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#6a1b9a" },
  h1: { fontSize: 22, margin: "2px 0 14px", color: "#1a3a5c" },
  err: { background: "#fdecea", border: "1px solid #f5c2c0", color: "#c62828", borderRadius: 8, padding: "10px 13px", fontSize: 13.5, margin: "10px 0" },
  muted: { color: "#889", fontSize: 13.5 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "20px 22px" },
  lead: { fontSize: 14, color: "#445", lineHeight: 1.6, margin: "0 0 12px" },
  passBanner: { display: "flex", alignItems: "center", gap: 8, background: "#eef7f0", border: "1px solid #b7dfc0", color: "#2e7d32", borderRadius: 8, padding: "9px 13px", fontSize: 13.5, marginBottom: 12, fontWeight: 600 },
  metaRow: { display: "flex", gap: 20, fontSize: 13.5, color: "#445", marginBottom: 6 },
  history: { marginTop: 16, borderTop: "1px solid #eef2f6", paddingTop: 12 },
  histHead: { fontSize: 12, fontWeight: 700, color: "#8b98a6", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 },
  histRow: { display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #f2f5f8", padding: "8px 0", fontSize: 13, color: "#445", cursor: "pointer", alignItems: "center" },
  passTag: { color: "#2e7d32", fontWeight: 700, fontSize: 12 },
  failTag: { color: "#c07a1a", fontWeight: 600, fontSize: 12 },
  introFoot: { marginTop: 18, display: "flex", justifyContent: "flex-end" },
  primary: { background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  ghost: { background: "none", border: "1px solid #cdd7e3", borderRadius: 8, padding: "9px 16px", fontSize: 13, color: "#4a5b6d", cursor: "pointer" },
  instructions: { background: "#f6f2fb", border: "1px solid #e2d5f0", borderRadius: 9, padding: "12px 15px", fontSize: 13.5, color: "#4a3a5c", marginBottom: 12, lineHeight: 1.5 },
  qList: { display: "flex", flexDirection: "column", gap: 12, marginTop: 6 },
  qCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "15px 17px" },
  qPrompt: { fontSize: 14.5, color: "#22303f", marginBottom: 10, lineHeight: 1.45 },
  qNum: { fontWeight: 700, color: "#6a1b9a", marginRight: 4 },
  qImg: { display: "block", maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 0 12px" },
  pts: { fontSize: 12, color: "#8b98a6", fontWeight: 400 },
  opts: { display: "flex", flexDirection: "column", gap: 7 },
  opt: { display: "flex", alignItems: "center", gap: 10, border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 12px", fontSize: 13.5, color: "#334", cursor: "pointer" },
  optPicked: { borderColor: "#b39ddb", background: "#f6f2fb" },
  textIn: { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  submitBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  resultBanner: { display: "flex", alignItems: "center", gap: 12, borderRadius: 10, padding: "14px 18px", fontSize: 14, lineHeight: 1.45, marginBottom: 12 },
  bPass: { background: "#eef7f0", border: "1px solid #b7dfc0", color: "#2e6b3e" },
  bFail: { background: "#fdecea", border: "1px solid #f3cfcf", color: "#a5372f" },
  bPending: { background: "#fff8e1", border: "1px solid #ffe0a3", color: "#7a5b12" },
  awardChip: { display: "inline-flex", alignItems: "center", gap: 6, background: "#f3eef8", border: "1px solid #d9c9ec", color: "#6a1b9a", borderRadius: 999, padding: "5px 13px", fontSize: 12.5, fontWeight: 600, marginBottom: 8 },
  optReview: { fontSize: 13.5, color: "#556", padding: "6px 10px", borderRadius: 7, border: "1px solid transparent" },
  optRight: { color: "#2e7d32", fontWeight: 600, background: "#eef7f0", border: "1px solid #cfe8d5" },
  optWrong: { color: "#c62828", background: "#fdecea", border: "1px solid #f3cfcf" },
  optChosen: { color: "#334", background: "#eef2f7", border: "1px solid #d5dee8" },
  youPicked: { fontSize: 12, fontStyle: "italic", opacity: 0.85 },
  ptsBadge: { marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#4a5b6d", background: "#eef2f7", borderRadius: 6, padding: "1px 7px" },
  shortReview: { fontSize: 13.5, color: "#334", display: "flex", flexDirection: "column", gap: 3 },
  explain: { marginTop: 10, fontSize: 12.5, color: "#5a5266", background: "#faf8fc", border: "1px solid #ece5f3", borderRadius: 7, padding: "8px 11px", lineHeight: 1.45 },
  pendTag: { marginLeft: 8, fontSize: 11, color: "#c07a1a", fontWeight: 600 },
};
