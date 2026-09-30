/**
 * CertQuizGradebook — who attempted a certification's quiz, their scores, and the queue of
 * short answers awaiting a manual grade. Grading the last pending answer finalizes the
 * attempt and, on a pass, awards the certification. Admins reach it from the quiz builder.
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { certApi, type QuizGradebook, type GradebookAttempt } from "../api";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Award, PencilRuler, Send } from "lucide-react";

export default function CertQuizGradebook() {
  const { certId } = useParams();
  const cid = Number(certId);
  const navigate = useNavigate();
  const nav = (useLocation().state ?? {}) as { code?: string; name?: string };
  const { isAdmin, canWrite } = useAuth();
  const canManageLms = isAdmin || canWrite("cert_lms.manage");
  const heading = nav.name ? `${nav.code ? nav.code + " · " : ""}${nav.name}` : `Certification #${cid}`;

  const [gb, setGb] = useState<QuizGradebook | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    certApi.quizAttempts(cid).then(setGb).catch(() => setErr("Couldn't load results."));
  }, [cid]);
  useEffect(() => { load(); }, [load]);

  if (!canManageLms) return <p style={s.muted}>This area isn't available.</p>;

  return (
    <div style={s.wrap}>
      <button style={s.back} onClick={() => navigate(`/certifications/${cid}/quiz`, { state: nav })}><ArrowLeft size={14} /> Quiz builder</button>
      <div style={s.eyebrow}>Quiz results</div>
      <h1 style={s.h1}>{heading}</h1>
      {err && <div style={s.err}>{err}</div>}

      {gb === null ? <p style={s.muted}>Loading…</p> :
        !gb.exists ? <p style={s.muted}>No quiz has been created for this certification yet.</p> :
        gb.attempts.length === 0 ? <p style={s.muted}>No one has taken this quiz yet.</p> : (
        <>
          <div style={s.stats}>
            <Stat label="Attempts" value={gb.total ?? 0} />
            <Stat label="Passed" value={gb.passed ?? 0} color="#2e7d32" />
            <Stat label="Awaiting review" value={gb.pending ?? 0} color={(gb.pending ?? 0) > 0 ? "#c07a1a" : "#889"} />
          </div>

          {gb.hold_results && <div style={s.holdNote}><Clock size={13} /> Results are held for review — students don't see their score until you release each attempt below.</div>}
          <div style={s.list}>
            {gb.attempts.map((a) => <AttemptRow key={a.id} a={a} onGraded={load} passPct={gb.pass_pct ?? 80} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return <div style={s.stat}><div style={{ ...s.statVal, color: color ?? "#1a3a5c" }}>{value}</div><div style={s.statLbl}>{label}</div></div>;
}

function AttemptRow({ a, onGraded, passPct }: { a: GradebookAttempt; onGraded: () => void; passPct: number }) {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const hasPending = a.status === "submitted" && a.pending.length > 0;
  // A held-results attempt with everything auto-graded still waits for the manager to release it.
  const canRelease = a.status === "submitted" && a.pending.length === 0;
  const wouldPass = a.score_pct != null && a.score_pct >= passPct;

  async function saveGrades() {
    setSaving(true);
    try {
      await certApi.gradeAttempt(a.id, a.pending.map((p) => ({ question_id: p.question_id, is_correct: !!marks[p.question_id] })));
      onGraded();
    } finally { setSaving(false); }
  }

  async function releaseNow() {
    setSaving(true);
    try { await certApi.gradeAttempt(a.id, []); onGraded(); }
    finally { setSaving(false); }
  }

  return (
    <div style={s.row}>
      <div style={s.rowMain} onClick={() => hasPending && setOpen((o) => !o)}>
        <span style={s.name}>{a.member_name}</span>
        <span style={s.date}>{a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—"}</span>
        <span style={s.score}>{a.score_pct != null ? `${Math.round(a.score_pct)}%` : "—"}</span>
        <span style={s.statusCell}>
          {a.status === "submitted" ? <span style={s.pendBadge}><Clock size={12} /> review</span>
            : a.passed ? <span style={s.passBadge}><CheckCircle2 size={12} /> passed</span>
            : <span style={s.failBadge}><XCircle size={12} /> not yet</span>}
          {a.awarded && <span style={s.awardBadge} title="Certification awarded by this attempt"><Award size={12} /></span>}
        </span>
      </div>

      {hasPending && (
        <div style={s.gradeArea}>
          {!open ? (
            <button style={s.gradeLink} onClick={() => setOpen(true)}><PencilRuler size={13} /> Grade {a.pending.length} short answer{a.pending.length === 1 ? "" : "s"}</button>
          ) : (
            <div style={s.gradeBox}>
              {a.pending.map((p) => (
                <div key={p.question_id} style={s.pendItem}>
                  <div style={s.pendPrompt}>{p.prompt} <span style={s.pts}>({p.points} pt{p.points === 1 ? "" : "s"})</span></div>
                  <div style={s.pendAnswer}>“{p.response_text || <em>(blank)</em>}”</div>
                  {p.answer_key.length > 0 && <div style={s.acceptNote}>Suggested: {p.answer_key.join(", ")}</div>}
                  <div style={s.markBtns}>
                    <button style={{ ...s.markBtn, ...(marks[p.question_id] === true ? s.markRight : {}) }} onClick={() => setMarks((m) => ({ ...m, [p.question_id]: true }))}>✓ Correct</button>
                    <button style={{ ...s.markBtn, ...(marks[p.question_id] === false ? s.markWrong : {}) }} onClick={() => setMarks((m) => ({ ...m, [p.question_id]: false }))}>✗ Incorrect</button>
                  </div>
                </div>
              ))}
              <div style={s.gradeFoot}>
                <button style={s.ghost} onClick={() => setOpen(false)}>Cancel</button>
                <button style={s.primary} onClick={saveGrades}
                  disabled={saving || a.pending.some((p) => marks[p.question_id] === undefined)}>
                  {saving ? "Saving…" : "Save & release results"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {canRelease && (
        <div style={s.gradeArea}>
          <button style={s.gradeLink} onClick={releaseNow} disabled={saving}>
            <Send size={13} /> {saving ? "Releasing…" : "Release results"}
            {a.score_pct != null && <span style={s.releaseNote}> — {Math.round(a.score_pct)}%, {wouldPass ? "will pass & award" : "below passing"}</span>}
          </button>
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
  stats: { display: "flex", gap: 10, marginBottom: 14 },
  stat: { flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 15px", textAlign: "center" },
  statVal: { fontSize: 24, fontWeight: 800 },
  statLbl: { fontSize: 11.5, color: "#8b98a6", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 2 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  rowMain: { display: "grid", gridTemplateColumns: "1fr auto 60px 110px", gap: 12, alignItems: "center", padding: "12px 15px" },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  date: { fontSize: 12.5, color: "#7a8899" },
  score: { fontSize: 14, fontWeight: 700, color: "#334", textAlign: "right", fontVariantNumeric: "tabular-nums" },
  statusCell: { display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" },
  pendBadge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#c07a1a", background: "#fdf3e3", borderRadius: 10, padding: "2px 9px" },
  passBadge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#2e7d32", background: "#eef7f0", borderRadius: 10, padding: "2px 9px" },
  failBadge: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "#c62828", background: "#fdecea", borderRadius: 10, padding: "2px 9px" },
  awardBadge: { display: "inline-flex", alignItems: "center", color: "#6a1b9a" },
  gradeArea: { borderTop: "1px solid #eef2f6", padding: "10px 15px", background: "#fcfbfe" },
  gradeLink: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#6a1b9a", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 },
  gradeBox: { display: "flex", flexDirection: "column", gap: 12 },
  pendItem: { borderLeft: "3px solid #d9c9ec", paddingLeft: 12 },
  pendPrompt: { fontSize: 13.5, color: "#22303f", fontWeight: 600 },
  pts: { fontSize: 11.5, color: "#8b98a6", fontWeight: 400 },
  pendAnswer: { fontSize: 13.5, color: "#334", margin: "5px 0", fontStyle: "italic" },
  acceptNote: { fontSize: 12, color: "#7a8899", marginBottom: 6 },
  releaseNote: { fontWeight: 400, color: "#4a5b6d" },
  holdNote: { display: "flex", alignItems: "center", gap: 7, background: "#fff8e1", border: "1px solid #ffe0a3", color: "#7a5b12", borderRadius: 8, padding: "8px 12px", fontSize: 13, margin: "0 0 12px" },
  markBtns: { display: "flex", gap: 8 },
  markBtn: { border: "1px solid #cdd7e3", background: "#fff", borderRadius: 7, padding: "5px 13px", fontSize: 12.5, fontWeight: 600, color: "#556", cursor: "pointer" },
  markRight: { background: "#eef7f0", borderColor: "#a5d6a7", color: "#2e7d32" },
  markWrong: { background: "#fdecea", borderColor: "#ef9a9a", color: "#c62828" },
  gradeFoot: { display: "flex", justifyContent: "flex-end", gap: 8 },
  primary: { background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 7, padding: "8px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ghost: { background: "none", border: "1px solid #cdd7e3", borderRadius: 7, padding: "8px 14px", fontSize: 13, color: "#4a5b6d", cursor: "pointer" },
};
