/**
 * FIRST Development Program roster for a season.
 *
 * Every youth in FTC or FRC starts here and stays until they graduate. Graduation
 * criteria are not defined yet, so graduating is a deliberate action with an optional
 * note — the note is where the reason lives until criteria are agreed.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fdpApi, type FdpRoster as Roster, type FdpMember, type FdpPipeline } from "../api";
import { onboardingApi } from "../../onboarding";
import { ArrowLeft, GraduationCap, RefreshCw, Undo2, Trash2, Award, FileText, MessageSquare, ShieldCheck, ClipboardCheck, ClipboardList, CheckSquare, Square, CalendarClock, GitBranch, Bell } from "lucide-react";

export default function FdpRoster() {
  const navigate = useNavigate();
  const [data, setData] = useState<Roster | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // Multi-select for assigning the same work to several youth at once.
  const [sel, setSel] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bTitle, setBTitle] = useState("");
  const [bDesc, setBDesc] = useState("");
  const [bDue, setBDue] = useState("");
  // Bulk board-review scheduling for the selected youth.
  const [schedBulkOpen, setSchedBulkOpen] = useState(false);
  const [sWhen, setSWhen] = useState("");
  const [sPanel, setSPanel] = useState("");
  const [sWhere, setSWhere] = useState("");

  // Board of review + resume, recorded by a manager against one youth.
  const [progFor, setProgFor] = useState<FdpMember | null>(null);
  const [pOutcome, setPOutcome] = useState("");
  const [pDate, setPDate] = useState("");
  const [pPanel, setPPanel] = useState("");
  const [pNotes, setPNotes] = useState("");
  const [pResume, setPResume] = useState("");
  const [pSched, setPSched] = useState("");
  const [pScores, setPScores] = useState<Record<string, number>>({});
  const [rubric, setRubric] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<FdpPipeline | null>(null);
  const [showPipeline, setShowPipeline] = useState(false);
  const [gradFor, setGradFor] = useState<FdpMember | null>(null);
  const [gradNote, setGradNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fdpApi.roster(year)
      .then((d) => { setData(d); setYear(d.year); })
      .catch((e) => setErr(e?.response?.data?.detail ?? "Could not load the FDP roster."))
      .finally(() => setLoading(false));
  }, [year]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fdpApi.reviewRubric().then(setRubric).catch(() => setRubric([])); }, []);

  async function act(fn: () => Promise<unknown>, note?: string) {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); if (note) setMsg(note); load(); }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That didn't work."); }
    finally { setBusy(false); }
  }

  async function doGraduate() {
    if (!gradFor) return;
    const m = gradFor; const note = gradNote;
    setGradFor(null); setGradNote("");
    await act(() => fdpApi.graduate(m.id, { note: note.trim() || undefined }), `${m.name} has graduated from the FDP.`);
  }

  const toggleSel = (id: number) =>
    setSel((l) => l.includes(id) ? l.filter((x) => x !== id) : [...l, id]);

  async function saveBulkWork() {
    const ids = [...sel];
    setBulkOpen(false);
    await act(async () => {
      const r = await onboardingApi.assignWorkBulk(ids, {
        title: bTitle.trim(), description: bDesc.trim() || undefined, due_date: bDue || undefined,
      });
      setSel([]); setBTitle(""); setBDesc(""); setBDue("");
      return r;
    }, `Work assigned to ${ids.length} youth.`);
  }

  async function assignResumeTask() {
    const ids = [...sel];
    await act(async () => {
      const r = await onboardingApi.assignResumeTaskBulk(ids);
      setSel([]);
      return r;
    }, `"Build your resume" assigned to ${ids.length} youth.`);
  }

  async function saveBulkSchedule() {
    const ids = [...sel];
    setSchedBulkOpen(false);
    await act(async () => {
      const r = await fdpApi.scheduleBoardReview(ids, {
        scheduled_at: sWhen, panel: sPanel.trim() || undefined, location: sWhere.trim() || undefined,
      });
      setSel([]); setSWhen(""); setSPanel(""); setSWhere("");
      return r;
    }, `Board of review scheduled for ${ids.length} youth.`);
  }

  function openProgress(m: FdpMember) {
    setProgFor(m);
    setPOutcome(m.progress?.board_review_outcome ?? "");
    setPDate(m.progress?.board_review_date ?? "");
    setPPanel(m.progress?.board_review_panel ?? "");
    setPNotes(m.progress?.board_review_notes ?? "");
    setPResume(m.progress?.resume_url ?? "");
    setPSched(m.progress?.board_review_scheduled_at?.slice(0, 16) ?? "");
    setPScores({ ...(m.progress?.board_review_scores ?? {}) });
  }
  async function saveProgress() {
    if (!progFor) return;
    const target = progFor;
    setProgFor(null);
    await act(() => fdpApi.setProgress(target.member_id, {
      board_review_outcome: pOutcome,
      board_review_date: pDate,
      board_review_panel: pPanel,
      board_review_notes: pNotes,
      board_review_scheduled_at: pSched,
      board_review_scores: pScores,
      resume_url: pResume,
    }), `Updated ${target.name}'s development record.`);
  }

  function togglePipeline() {
    const next = !showPipeline;
    setShowPipeline(next);
    if (next && !pipeline) fdpApi.pipeline(year).then(setPipeline).catch(() => setPipeline(null));
  }
  async function sendReminders() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fdpApi.sendReminders();
      setMsg(r.sent > 0 ? `Sent ${r.sent} reminder${r.sent === 1 ? "" : "s"}.` : "No upcoming interviews or board reviews to remind about.");
    } catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not send reminders."); }
    finally { setBusy(false); }
  }

  const active = (data?.members ?? []).filter((m) => m.status === "active");
  const graduated = (data?.members ?? []).filter((m) => m.status === "graduated");

  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      <button onClick={() => navigate("/admin")} style={s.back}><ArrowLeft size={14} /> Admin Console</button>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}><GraduationCap size={22} style={{ verticalAlign: -4 }} /> FIRST Development Program</h1>
          <p style={s.sub}>
            Youth join the FDP when they enrol in FTC or FRC, and stay until they graduate.
            There is no fee for the FDP. {data && <>Season <strong>{data.year_label}</strong>.</>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={s.ghost} onClick={togglePipeline}><GitBranch size={14} /> {showPipeline ? "Hide pipeline" : "Pipeline"}</button>
          <button style={s.ghost} onClick={sendReminders} disabled={busy} title="Email families about upcoming interviews and board reviews">
            <Bell size={14} /> Send reminders
          </button>
          <button style={s.ghost} onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {msg && <div style={s.ok}>{msg}</div>}
      {err && <div style={s.err}>{err}</div>}

      {showPipeline && pipeline && (
        <div style={s.pipeline}>
          {pipeline.stages.map((st, i) => (
            <div key={st.key} style={s.pipeStage}>
              <div style={s.pipeCount}>{st.count}</div>
              <div style={s.pipeLabel}>{st.label}</div>
              {st.members.length > 0 && (
                <div style={s.pipeNames}>{st.members.slice(0, 8).map((m) => m.name.split(" ")[0]).join(", ")}{st.members.length > 8 ? ` +${st.members.length - 8}` : ""}</div>
              )}
              {i < pipeline.stages.length - 1 && <span style={s.pipeArrow}>›</span>}
            </div>
          ))}
        </div>
      )}

      {/* Assign the same work to several youth at once. Each gets their own item, so
          they complete it independently. */}
      {active.length > 0 && (
        <div style={s.bulkBar}>
          <button style={s.selAll}
            onClick={() => setSel(sel.length === active.length ? [] : active.map((m) => m.member_id))}>
            {sel.length === active.length && active.length > 0
              ? <><CheckSquare size={13} /> Clear selection</>
              : <><Square size={13} /> Select all ({active.length})</>}
          </button>
          <span style={s.selCount}>{sel.length} selected</span>
          <button style={{ ...s.ghost, opacity: sel.length ? 1 : 0.45 }} disabled={!sel.length}
            onClick={() => setSchedBulkOpen(true)}>
            <CalendarClock size={14} /> Schedule board of review
          </button>
          <button style={{ ...s.ghost, opacity: sel.length ? 1 : 0.45 }} disabled={!sel.length || busy}
            onClick={assignResumeTask}>
            <FileText size={14} /> Assign resume task
          </button>
          <button style={{ ...s.primary, opacity: sel.length ? 1 : 0.45 }} disabled={!sel.length}
            onClick={() => setBulkOpen(true)}>
            <ClipboardList size={14} /> Assign work
          </button>
        </div>
      )}


      {loading ? <p style={s.muted}>Loading…</p> : !data ? null : (
        <>
          <Section title={`In the program (${active.length})`} empty="Nobody is in the FDP for this season yet.">
            {active.map((m) => (
              <Row key={m.id} m={m} busy={busy}
                  selected={sel.includes(m.member_id)} onToggle={() => toggleSel(m.member_id)}
                  onOpen={() => navigate(`/members/${m.member_id}`)}
                  onResume={() => navigate(`/resume/member/${m.member_id}`)}
                right={
                  <>
                    <button style={s.gradBtn} disabled={busy} onClick={() => { setGradFor(m); setGradNote(""); }}>
                      <GraduationCap size={13} /> Graduate
                    </button>
                    <button style={s.iconBtn} title="Remove from the FDP" disabled={busy}
                      onClick={() => { if (confirm(`Remove ${m.name} from the FDP for this season?`)) act(() => fdpApi.remove(m.id), `${m.name} removed.`); }}>
                      <Trash2 size={13} />
                    </button>
                    <button style={s.iconBtn} title="Record board of review / resume" disabled={busy}
                      onClick={() => openProgress(m)}>
                      <ClipboardCheck size={13} />
                    </button>
                  </>
                } />
            ))}
          </Section>

          {graduated.length > 0 && (
            <Section title={`Graduated (${graduated.length})`} empty="">
              {graduated.map((m) => (
                <Row key={m.id} m={m} busy={busy} onOpen={() => navigate(`/members/${m.member_id}`)}
                  onResume={() => navigate(`/resume/member/${m.member_id}`)}
                  right={
                    <>
                      <button style={s.iconBtn} title="View board of review / development record" disabled={busy}
                        onClick={() => openProgress(m)}>
                        <ClipboardCheck size={13} />
                      </button>
                      <button style={s.iconBtn} title="Undo graduation" disabled={busy}
                        onClick={() => act(() => fdpApi.graduate(m.id, { undo: true }), `${m.name} is back in the FDP.`)}>
                        <Undo2 size={13} />
                      </button>
                    </>
                  } />
              ))}
            </Section>
          )}
        </>
      )}

      {schedBulkOpen && (
        <div style={s.modalWrap} onClick={() => setSchedBulkOpen(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>Schedule a board of review for {sel.length} youth</h3>
            <p style={s.modalP}>
              Books the sitting for everyone selected. Each youth&apos;s result is recorded
              individually afterwards — scheduling doesn&apos;t decide anything on its own.
            </p>
            <label style={s.label}>When</label>
            <input style={s.input} type="datetime-local" autoFocus value={sWhen} onChange={(e) => setSWhen(e.target.value)} />
            <label style={s.label}>Panel</label>
            <input style={s.input} value={sPanel} placeholder="Who's sitting on it" onChange={(e) => setSPanel(e.target.value)} />
            <label style={s.label}>Where</label>
            <input style={s.input} value={sWhere} placeholder="e.g. Conference room" onChange={(e) => setSWhere(e.target.value)} />
            <div style={s.modalActions}>
              <button style={s.ghost} onClick={() => setSchedBulkOpen(false)}>Cancel</button>
              <button style={s.primary} disabled={!sWhen} onClick={saveBulkSchedule}>
                <CalendarClock size={14} /> Schedule {sel.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div style={s.modalWrap} onClick={() => setBulkOpen(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>Assign work to {sel.length} youth</h3>
            <p style={s.modalP}>
              Each youth gets their own copy, so they complete it independently and one
              finishing doesn&apos;t mark it done for the rest.
            </p>
            <label style={s.label}>What&apos;s the work?</label>
            <input style={s.input} autoFocus value={bTitle} onChange={(e) => setBTitle(e.target.value)} />
            <label style={s.label}>Detail (optional)</label>
            <textarea style={s.textarea} rows={2} value={bDesc} onChange={(e) => setBDesc(e.target.value)} />
            <label style={s.label}>Due date (optional)</label>
            <input style={s.input} type="date" value={bDue} onChange={(e) => setBDue(e.target.value)} />
            <div style={s.modalActions}>
              <button style={s.ghost} onClick={() => setBulkOpen(false)}>Cancel</button>
              <button style={s.primary} disabled={!bTitle.trim()} onClick={saveBulkWork}>
                <ClipboardList size={14} /> Assign to {sel.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {progFor && (
        <div style={s.modalWrap} onClick={() => setProgFor(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>{progFor.name} — development record</h3>
            <p style={s.modalP}>
              Passing the board of review makes this youth eligible to be interviewed by a team.
              It&apos;s a one-time milestone and doesn&apos;t expire.
            </p>
            <label style={s.label}>Scheduled for</label>
            <input style={s.input} type="datetime-local" value={pSched} onChange={(e) => setPSched(e.target.value)} />
            <label style={s.label}>Result</label>
            <select style={s.input} value={pOutcome} onChange={(e) => setPOutcome(e.target.value)}>
              <option value="">Not held yet</option>
              <option value="passed">Passed — eligible to interview</option>
              <option value="not_yet">Not yet</option>
              <option value="deferred">Deferred</option>
            </select>
            <div style={s.grid2}>
              <div>
                <label style={s.label}>Date</label>
                <input style={s.input} type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
              </div>
              <div>
                <label style={s.label}>Panel</label>
                <input style={s.input} value={pPanel} placeholder="Who sat on it" onChange={(e) => setPPanel(e.target.value)} />
              </div>
            </div>
            {rubric.length > 0 && (
              <>
                <label style={s.label}>Board rubric <span style={s.rubricHint}>(1 = needs work · 4 = strong)</span></label>
                {rubric.map((c) => (
                  <div key={c} style={s.rubricRow}>
                    <span style={s.rubricCrit}>{c}</span>
                    <div style={s.rubricScores}>
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} type="button"
                          style={{ ...s.scoreBtn, ...(pScores[c] === n ? s.scoreBtnOn : {}) }}
                          onClick={() => setPScores((sc) => sc[c] === n ? (() => { const x = { ...sc }; delete x[c]; return x; })() : { ...sc, [c]: n })}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
            <label style={s.label}>Review notes</label>
            <textarea style={s.textarea} rows={2} value={pNotes} onChange={(e) => setPNotes(e.target.value)} />
            <label style={s.label}>Resume link</label>
            {progFor.progress?.resume_builder_complete && (
              <p style={{ ...s.hint, color: "#1565c0", marginBottom: 6 }}>
                ✓ This youth built a resume in the system —{" "}
                <a href={`/resume/member/${progFor.member_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "#1565c0", fontWeight: 700 }}>view it here</a>.
                No need to paste anything; the field below is only for an external/uploaded resume.
              </p>
            )}
            <input style={s.input} value={pResume} placeholder="Paste a link, or an uploaded file URL"
              onChange={(e) => setPResume(e.target.value)} />
            <p style={s.hint}>
              A pasted link (Google Drive, for example) works everywhere. An uploaded file will not
              download on the live site until the hosting upload issue is resolved.
            </p>
            <div style={s.modalActions}>
              <button style={s.ghost} onClick={() => setProgFor(null)}>Cancel</button>
              <button style={s.primary} onClick={saveProgress}><ClipboardCheck size={14} /> Save</button>
            </div>
          </div>
        </div>
      )}

      {gradFor && (
        <div style={s.modalWrap} onClick={() => setGradFor(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalH}>Graduate {gradFor.name} from the FDP</h3>
            <p style={s.modalP}>
              Graduation criteria haven&apos;t been formalised yet — note what they completed so the
              record makes sense later. This is optional.
            </p>
            <textarea style={s.textarea} rows={3} value={gradNote} autoFocus
              placeholder="e.g. Completed the intro build sequence and safety training."
              onChange={(e) => setGradNote(e.target.value)} />
            <div style={s.modalActions}>
              <button style={s.ghost} onClick={() => setGradFor(null)}>Cancel</button>
              <button style={s.primary} onClick={doGraduate}><GraduationCap size={14} /> Graduate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div style={s.section}>
      <div style={s.sectionH}>{title}</div>
      {has ? <div style={s.list}>{children}</div> : empty ? <p style={s.muted}>{empty}</p> : null}
    </div>
  );
}

function Row({ m, right, onOpen, onResume, selected, onToggle }: {
  m: FdpMember; busy: boolean; right: React.ReactNode; onOpen: () => void;
  onResume: () => void; selected?: boolean; onToggle?: () => void;
}) {
  return (
    <div style={s.row}>
      {onToggle && (
        <button style={s.check} onClick={onToggle} title={selected ? "Deselect" : "Select"}>
          {selected ? <CheckSquare size={16} color="#00695c" /> : <Square size={16} color="#b0bcc9" />}
        </button>
      )}
      <div style={{ flex: 1, cursor: "pointer" }} onClick={onOpen}>
        <div style={s.name}>
          {m.name} {m.grade_label && <span style={s.grade}>{m.grade_label}</span>}
          {m.progress?.eligible_for_interview ? (
            <span style={s.eligibleChip} title={`Passed the board of review${m.progress.board_review_date ? ` on ${m.progress.board_review_date}` : ""}`}>
              <ShieldCheck size={11} /> eligible
            </span>
          ) : m.progress?.board_review_pending && m.progress.board_review_scheduled_at ? (
            <span style={s.schedChip} title={`Board of review${m.progress.board_review_location ? ` · ${m.progress.board_review_location}` : ""}`}>
              <CalendarClock size={11} /> review {new Date(m.progress.board_review_scheduled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          ) : null}
        </div>
        <div style={s.meta}>
          {m.status === "graduated"
            ? <>Graduated {m.graduated_date ?? ""}{m.graduated_by ? ` · by ${m.graduated_by}` : ""}{m.graduated_note ? ` · ${m.graduated_note}` : ""}</>
            : <>Joined {m.joined_date ?? "—"}{m.joined_source === "auto" ? " · added automatically with their FTC/FRC enrolment" : ""}</>}
        </div>
        {/* Progress at a glance: certifications, resume, interviews. */}
        <div style={s.chips}>
          <span style={s.chip}><Award size={11} /> {m.certifications_completed} cert{m.certifications_completed === 1 ? "" : "s"}</span>
          <button type="button"
            style={{ ...s.chip, ...s.chipBtn, ...(m.progress?.has_resume ? s.chipOk : {}) }}
            title="Open this youth's resume"
            onClick={(e) => { e.stopPropagation(); onResume(); }}>
            <FileText size={11} /> {m.progress?.has_resume ? "View resume" : "Resume"}
          </button>
          <span style={s.chip}>
            <MessageSquare size={11} /> {m.interviews} interview{m.interviews === 1 ? "" : "s"}
            {m.interview_teams?.length > 0 && ` · ${m.interview_teams.map((t) => t.team).join(", ")}`}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{right}</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#4a5b6d", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" },
  h1: { fontSize: 22, margin: "0 0 4px", color: "#1a3a5c" },
  sub: { fontSize: 13, color: "#667", margin: 0, maxWidth: 640, lineHeight: 1.5 },
  ghost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 7, fontSize: 13, cursor: "pointer", color: "#4a5b6d" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#00695c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  callout: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, padding: "12px 15px", margin: "14px 0", fontSize: 13, color: "#5d4037", lineHeight: 1.5 },
  ok: { background: "#f1f8f4", border: "1px solid #a5d6a7", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#2e5b3e", margin: "12px 0" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#c62828", margin: "12px 0" },
  label: { display: "block", fontSize: 11.5, fontWeight: 700, color: "#5a6b7d", margin: "10px 0 4px" },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  hint: { fontSize: 11.5, color: "#8b98a6", margin: "6px 0 0", lineHeight: 1.45 },
  pipeline: { display: "flex", gap: 6, flexWrap: "wrap", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  pipeStage: { position: "relative", flex: "1 1 130px", minWidth: 120, background: "#f7fafc", border: "1px solid #eef2f6", borderRadius: 8, padding: "8px 10px" },
  pipeCount: { fontSize: 20, fontWeight: 800, color: "#1a3a5c" },
  pipeLabel: { fontSize: 11.5, fontWeight: 700, color: "#5a6b7d", marginTop: 1 },
  pipeNames: { fontSize: 11, color: "#8b98a6", marginTop: 4, lineHeight: 1.35 },
  pipeArrow: { position: "absolute", right: -8, top: "50%", transform: "translateY(-50%)", color: "#c3ccd6", fontSize: 18, fontWeight: 700, zIndex: 1 },
  rubricHint: { fontWeight: 400, color: "#8b98a6", textTransform: "none" },
  rubricRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" },
  rubricCrit: { fontSize: 13, color: "#334" },
  rubricScores: { display: "flex", gap: 4 },
  scoreBtn: { width: 28, height: 28, border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#667" },
  scoreBtnOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  bulkBar: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "14px 0 0", padding: "9px 12px", background: "#f4f8f7", border: "1px solid #cfe0dc", borderRadius: 8 },
  selAll: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", fontSize: 12.5, color: "#00695c", fontWeight: 600, padding: 0 },
  selCount: { fontSize: 12, color: "#5a6b7d" },
  check: { background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", marginRight: 2 },
  section: { marginTop: 18 },
  sectionH: { fontSize: 12, fontWeight: 800, color: "#8b98a6", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  list: { border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", background: "#fff" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #eef2f6" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#5a6b7d", background: "#f2f5f8", borderRadius: 10, padding: "2px 9px" },
  chipBtn: { border: "1px solid #d7e0ea", cursor: "pointer", fontWeight: 600 },
  chipOk: { color: "#2e7d32", background: "#eef7f0" },
  eligibleChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 10, padding: "1px 8px", marginLeft: 6 },
  schedChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: "#1565c0", background: "#e7f0fb", borderRadius: 10, padding: "1px 8px", marginLeft: 6 },
  name: { fontSize: 14, fontWeight: 600, color: "#1a3a5c" },
  grade: { marginLeft: 7, fontSize: 10.5, fontWeight: 700, color: "#1565c0", background: "#e8f0fe", borderRadius: 10, padding: "1px 8px" },
  meta: { fontSize: 12, color: "#7a8899", marginTop: 2 },
  gradBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#1a3a5c", cursor: "pointer" },
  iconBtn: { padding: "6px 9px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, color: "#7a8899", cursor: "pointer" },
  muted: { color: "#889", fontSize: 13 },
  modalWrap: { position: "fixed", inset: 0, background: "rgba(15,30,45,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 },
  modal: { background: "#fff", borderRadius: 12, padding: "20px 22px", maxWidth: 460, width: "100%" },
  modalH: { margin: "0 0 6px", fontSize: 17, color: "#1a3a5c" },
  modalP: { fontSize: 13, color: "#667", lineHeight: 1.5, margin: "0 0 12px" },
  textarea: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, fontFamily: "inherit", resize: "vertical" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 },
};
