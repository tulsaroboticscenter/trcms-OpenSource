import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { feedbackApi, TYPE_META, STATUS_META, PRIORITY_META, type Feedback } from "../api";
import { RELEASES } from "../../../core/version";
import { ArrowLeft, Edit, Trash2, Rocket, GitBranch, CheckCircle2, MessageSquare } from "lucide-react";

const fmtDate = (d?: string | null) => d ? new Date((d.length > 10 ? d : d + "T00:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function FeedbackDetail() {
  const navigate = useNavigate();
  const goBack = useGoBack("/feedback");
  const { id } = useParams();
  const { canWrite, user } = useAuth();
  const canManage = canWrite("feedback.manage");
  const [f, setF] = useState<Feedback | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushErr, setPushErr] = useState<string | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentMsg, setCommentMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // The submitter/triager discussion thread (distinct from the GitHub comment box above).
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyErr, setReplyErr] = useState("");

  async function sendReply(confirm?: boolean) {
    if (!f) return;
    if (!reply.trim() && confirm === undefined) return;
    setReplyBusy(true); setReplyErr("");
    try {
      const updated = await feedbackApi.addComment(f.id, reply.trim(), confirm);
      setF(updated); setReply("");
    } catch (e) {
      setReplyErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't post that. Please try again.");
    } finally { setReplyBusy(false); }
  }

  function load() { feedbackApi.get(parseInt(id!)).then(setF).catch(() => setNotFound(true)); }
  useEffect(load, [id]);

  async function remove() {
    if (!f || !window.confirm("Delete this feedback?")) return;
    await feedbackApi.remove(f.id);
    navigate("/feedback");
  }

  async function sendToGithub() {
    if (!f || !window.confirm("Create a GitHub Issue from this feedback and add it to the project board?")) return;
    setPushing(true); setPushErr(null);
    try {
      const updated = await feedbackApi.pushToGithub(f.id);
      setF(updated);
      if (updated.github_result && updated.github_result.added_to_project === false) {
        setPushErr("Issue created, but adding it to the project board failed: " + (updated.github_result.project_error ?? "unknown"));
      }
    } catch (e: unknown) {
      setPushErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't create the GitHub issue.");
    } finally { setPushing(false); }
  }

  function openComment() {
    setCommentBody(f?.admin_notes ?? "");   // pre-fill with current internal notes
    setCommentMsg(null);
    setCommenting(true);
  }
  async function postComment() {
    if (!f || !commentBody.trim()) return;
    setCommentBusy(true); setCommentMsg(null);
    try {
      await feedbackApi.commentToGithub(f.id, commentBody.trim());
      setCommentMsg({ ok: true, text: "Comment posted to GitHub." });
      setCommenting(false);
    } catch (e: unknown) {
      setCommentMsg({ ok: false, text: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Couldn't post the comment." });
    } finally { setCommentBusy(false); }
  }

  if (notFound) return <div style={st.wrap}><p style={st.muted}>This feedback isn’t available.</p>
    <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Back</button></div>;
  if (!f) return <p style={st.muted}>Loading…</p>;

  const tm = TYPE_META[f.type]; const sm = STATUS_META[f.status]; const pm = PRIORITY_META[f.priority];
  const isOwner = f.member_id === user?.id;

  return (
    <div style={st.wrap}>
      <div style={st.topRow}>
        <button style={st.back} onClick={goBack}><ArrowLeft size={15} /> Feedback</button>
        <div style={st.topBtns}>
          {canManage && !f.github_issue_url && (
            <button style={st.ghostBtn} onClick={sendToGithub} disabled={pushing}>
              <GitBranch size={14} /> {pushing ? "Sending…" : "Send to GitHub"}
            </button>
          )}
          {(canManage || (isOwner && f.status === "new")) && (
            <button style={st.ghostBtn} onClick={() => navigate(`/feedback/${f.id}/edit`)}><Edit size={14} /> Edit</button>
          )}
          {(canManage || (isOwner && f.status === "new")) && (
            <button style={st.delBtn} onClick={remove}><Trash2 size={14} /></button>
          )}
        </div>
      </div>

      {f.github_issue_url && (
        <div style={st.ghBox}>
          <div style={st.ghRow}>
            <a href={f.github_issue_url} target="_blank" rel="noopener noreferrer" style={st.ghLink}>
              <GitBranch size={14} /> Tracked on GitHub — Issue #{f.github_issue_number} ↗
            </a>
            {canManage && !commenting && (
              <button style={st.ghCommentBtn} onClick={openComment}>Comment on GitHub</button>
            )}
          </div>
          {commenting && (
            <div style={st.ghComposer}>
              <textarea style={st.ghTextarea} value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Write a comment to post on the GitHub issue…" />
              <div style={st.ghComposerActions}>
                <button style={st.cancelBtn} onClick={() => setCommenting(false)}>Cancel</button>
                <button style={st.saveBtn} onClick={postComment} disabled={commentBusy || !commentBody.trim()}>
                  {commentBusy ? "Posting…" : "Post comment"}
                </button>
              </div>
            </div>
          )}
          {commentMsg && <div style={commentMsg.ok ? st.ghOk : st.pushErr}>{commentMsg.text}</div>}
        </div>
      )}
      {pushErr && <div style={st.pushErr}>{pushErr}</div>}

      <div style={st.badges}>
        <span style={{ ...st.badge, color: tm.color, background: tm.color + "1a" }}>{tm.label}</span>
        <span style={{ ...st.badge, color: sm.color, background: sm.color + "1a" }}>{sm.label}</span>
        {canManage && <span style={{ ...st.badge, color: pm.color, background: pm.color + "1a" }}>{pm.label} priority</span>}
      </div>
      <h1 style={st.title}><span style={st.idTag}>#{f.id}</span> {f.title}</h1>
      <div style={st.meta}>
        {f.submitter_name && <>Reported by {f.submitter_name} · </>}{fmtDate(f.created_at)}
        {f.app_version && <> · {f.app_version}</>}
        {f.entered_by_name && <> · entered by {f.entered_by_name}</>}
        {f.target_release && <> · target {f.target_release}</>}
      </div>

      {f.description && <Section title="Details"><p style={st.body}>{f.description}</p></Section>}
      {f.steps && <Section title="Steps to reproduce"><p style={st.bodyPre}>{f.steps}</p></Section>}
      {f.page && <Section title="Where"><code style={st.code}>{f.page}</code></Section>}

      {/* Shipped banner — visible to everyone once resolved */}
      {f.status === "done" && (f.resolution_release || f.deployed_on || f.resolution_notes) && (
        <div style={st.shipped}>
          <Rocket size={16} />
          <div>
            <div style={st.shippedHead}>
              Shipped{f.resolution_release ? ` in ${f.resolution_release}` : ""}{f.deployed_on ? ` · ${fmtDate(f.deployed_on)}` : ""}
            </div>
            {f.resolution_notes && <div style={st.shippedNotes}>{f.resolution_notes}</div>}
          </div>
        </div>
      )}

      {/* Discussion + the submitter's confirmation. Open to the submitter and to triagers. */}
      {(isOwner || canManage) && (
        <div style={st.discuss}>
          <div style={st.discussHead}><MessageSquare size={15} /> Discussion</div>

          {f.confirmed_at && (
            <div style={st.confirmedBanner}>
              <CheckCircle2 size={15} />
              <span>
                Confirmed working{f.confirmed_by_name ? ` by ${f.confirmed_by_name}` : ""} · {fmtDate(f.confirmed_at)}
              </span>
            </div>
          )}

          {f.comments.length > 0 ? (
            <div style={st.thread}>
              {f.comments.map((c) => (
                <div key={c.id} style={st.comment}>
                  <div style={st.commentHead}>
                    <strong>{c.author_name ?? "Someone"}</strong>
                    {c.kind === "confirmed" && <span style={st.confirmChip}><CheckCircle2 size={11} /> confirmed</span>}
                    <span style={st.commentDate}>{fmtDate(c.created_at)}</span>
                  </div>
                  <div style={st.commentBody}>{c.body}</div>
                </div>
              ))}
            </div>
          ) : <div style={st.noComments}>No comments yet.</div>}

          <textarea style={st.replyBox} value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder={isOwner ? "Let us know how it's working, or add more detail…" : "Reply to the submitter…"} />
          {replyErr && <div style={st.pushErr}>{replyErr}</div>}
          <div style={st.replyActions}>
            {/* The submitter signs off that it works. Hidden once confirmed; a "still not right"
                reply lets them re-open the conversation. */}
            {isOwner && !f.confirmed_at && (
              <button style={st.confirmBtn} disabled={replyBusy} onClick={() => sendReply(true)}>
                <CheckCircle2 size={14} /> Confirm this works as requested
              </button>
            )}
            {isOwner && f.confirmed_at && (
              <button style={st.unconfirmBtn} disabled={replyBusy} onClick={() => sendReply(false)}>
                It's not quite right — reopen
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button style={st.saveBtn} disabled={replyBusy || !reply.trim()} onClick={() => sendReply()}>
              {replyBusy ? "Posting…" : "Add comment"}
            </button>
          </div>
        </div>
      )}

      {canManage && <TriagePanel f={f} onSaved={() => navigate("/feedback")} />}
    </div>
  );
}

function TriagePanel({ f, onSaved }: { f: Feedback; onSaved: () => void }) {
  const [status, setStatus] = useState(f.status);
  const [priority, setPriority] = useState(f.priority);
  const [adminNotes, setAdminNotes] = useState(f.admin_notes ?? "");
  const [release, setRelease] = useState(f.resolution_release ?? "");
  const [deployedOn, setDeployedOn] = useState(f.deployed_on ?? "");
  const [resNotes, setResNotes] = useState(f.resolution_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  async function save() {
    setSaving(true); setSavedMsg("");
    try {
      await feedbackApi.update(f.id, {
        status, priority, admin_notes: adminNotes,
        resolution_release: release, deployed_on: deployedOn, resolution_notes: resNotes,
      });
      setSavedMsg("Saved."); onSaved();
      setTimeout(() => setSavedMsg(""), 2500);
    } finally { setSaving(false); }
  }

  return (
    <div style={st.triage}>
      <h2 style={st.triageHead}>Triage</h2>
      <div style={st.grid2}>
        <label style={st.tl}>Status
          <select style={st.input} value={status} onChange={(e) => setStatus(e.target.value as Feedback["status"])}>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label style={st.tl}>Priority
          <select style={st.input} value={priority} onChange={(e) => setPriority(e.target.value as Feedback["priority"])}>
            {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
      </div>
      <label style={st.tl}>Internal notes
        <textarea style={{ ...st.input, minHeight: 60, resize: "vertical" }} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
          placeholder="Triage notes, investigation, decisions…" />
      </label>

      <div style={st.deploySection}>
        <div style={st.deployHead}><Rocket size={14} /> Deployment</div>
        <div style={st.grid2}>
          <label style={st.tl}>Release / version
            <input style={st.input} list="hof-release-versions" value={release} onChange={(e) => setRelease(e.target.value)} placeholder="e.g. Beta 0.12" />
            <datalist id="hof-release-versions">
              {RELEASES.map((r) => <option key={r.version} value={r.version} />)}
            </datalist>
          </label>
          <label style={st.tl}>Deployed date
            <input type="date" style={st.input} value={deployedOn ?? ""} onChange={(e) => setDeployedOn(e.target.value)} />
          </label>
        </div>
        <label style={st.tl}>Fix notes
          <textarea style={{ ...st.input, minHeight: 60, resize: "vertical" }} value={resNotes} onChange={(e) => setResNotes(e.target.value)}
            placeholder="What was changed to resolve this." />
        </label>
      </div>

      <div style={st.triageActions}>
        {savedMsg && <span style={st.savedMsg}>{savedMsg}</span>}
        <button style={st.saveBtn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Triage"}</button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={st.section}><h2 style={st.sectionTitle}>{title}</h2>{children}</section>;
}

const st: Record<string, React.CSSProperties> = {
  discuss: { marginTop: 22, paddingTop: 16, borderTop: "1px solid #eef0f4" },
  discussHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  confirmedBanner: { display: "flex", alignItems: "center", gap: 7, background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 11px", fontSize: 13, marginBottom: 12, fontWeight: 600 },
  thread: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 },
  comment: { border: "1px solid #eef2f7", borderRadius: 8, padding: "8px 11px", background: "#fafbfc" },
  commentHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#33475b", marginBottom: 3 },
  confirmChip: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 10, padding: "1px 7px" },
  commentDate: { marginLeft: "auto", fontSize: 11, color: "#90a4ae" },
  commentBody: { fontSize: 13.5, color: "#33475b", whiteSpace: "pre-wrap", lineHeight: 1.5 },
  noComments: { fontSize: 12.5, color: "#90a4ae", marginBottom: 12 },
  replyBox: { width: "100%", minHeight: 68, padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" },
  replyActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  confirmBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  unconfirmBtn: { padding: "8px 12px", background: "#fff", color: "#8a5a00", border: "1px solid #f0d9a8", borderRadius: 7, cursor: "pointer", fontSize: 12.5 },
  wrap: { maxWidth: 720, margin: "0 auto" },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  back: { display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 14, padding: 0 },
  topBtns: { display: "flex", gap: 8 },
  ghostBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  delBtn: { display: "flex", alignItems: "center", padding: "7px 11px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 6, cursor: "pointer" },
  ghBox: { marginBottom: 12 },
  ghRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  ghLink: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#f6f8fa", border: "1px solid #d0d7de", borderRadius: 6, color: "#24292f", fontSize: 13, fontWeight: 600, textDecoration: "none" },
  ghCommentBtn: { padding: "6px 12px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  ghComposer: { marginTop: 8 },
  ghTextarea: { width: "100%", minHeight: 70, padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" },
  ghComposerActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  cancelBtn: { padding: "9px 16px", background: "#fff", color: "#666", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  ghOk: { marginTop: 8, padding: "8px 12px", background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7", borderRadius: 6, fontSize: 13 },
  pushErr: { marginBottom: 12, padding: "8px 12px", background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0", borderRadius: 6, fontSize: 13 },
  badges: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  badge: { padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 700 },
  title: { margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  meta: { fontSize: 13, color: "#888", marginBottom: 18 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  body: { margin: 0, fontSize: 15, color: "#2a2418", lineHeight: 1.5, whiteSpace: "pre-wrap" },
  bodyPre: { margin: 0, fontSize: 14, color: "#2a2418", lineHeight: 1.5, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" },
  code: { fontSize: 13, color: "#1565c0", background: "#f0f4f8", borderRadius: 5, padding: "3px 8px" },
  shipped: { display: "flex", gap: 10, alignItems: "flex-start", background: "#e8f5e9", border: "1px solid #c8e6c9", borderRadius: 10, padding: "12px 16px", color: "#2e7d32", marginBottom: 18 },
  shippedHead: { fontWeight: 700, fontSize: 14 },
  shippedNotes: { color: "#33691e", fontSize: 14, marginTop: 3, whiteSpace: "pre-wrap" },
  triage: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginTop: 8 },
  triageHead: { margin: "0 0 12px", fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  tl: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 10 },
  input: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, fontWeight: 400, boxSizing: "border-box", width: "100%", background: "#fff", fontFamily: "inherit" },
  deploySection: { borderTop: "1px solid #e2e8f0", marginTop: 6, paddingTop: 12 },
  deployHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#2e7d32", marginBottom: 10 },
  triageActions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 6 },
  savedMsg: { color: "#2e7d32", fontSize: 13, fontWeight: 600 },
  saveBtn: { padding: "9px 20px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  muted: { color: "#888", textAlign: "center", padding: "2rem" },
};
