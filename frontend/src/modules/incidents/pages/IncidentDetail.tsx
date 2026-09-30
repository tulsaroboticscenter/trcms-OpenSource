import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { incidentsApi, type Incident } from "../api";
import { useAuth } from "../../../core/AuthContext";
import { ArrowLeft, Paperclip, ShieldOff, AlertTriangle } from "lucide-react";

const SEV_COLOR: Record<string, string> = { minor: "#6b7280", moderate: "#b7791f", serious: "#c2410c", critical: "#b91c1c" };

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { canRead, canWrite } = useAuth();
  const [inc, setInc] = useState<Incident | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState("addendum");
  const [taskId, setTaskId] = useState("");
  const [closeSummary, setCloseSummary] = useState("");
  const [sev, setSev] = useState("");
  const [shareSummary, setShareSummary] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const isHandler = canRead("incidents.queue");
  const canTriage = canWrite("incidents.triage");
  const canClose = canWrite("incidents.close");

  function reload() { incidentsApi.get(Number(id)).then(setInc).catch(() => setErr("Not found or access denied.")); }
  useEffect(reload, [id]);

  if (err) return <div style={{ padding: 24, color: "#a4291c" }}>{err}</div>;
  if (!inc) return <div style={{ padding: 24, color: "#888" }}>Loading…</div>;

  const act = async (fn: () => Promise<Incident>) => { try { setInc(await fn()); setErr(""); } catch (e) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Action failed."); } };

  async function shareToParents() {
    if (!inc) return;
    setSharing(true); setShareMsg("");
    try {
      const r = await incidentsApi.shareParent(inc.id, shareSummary);
      setInc(r.incident);
      setShareMsg(r.failed.length ? `⚠ Sent to ${r.sent}; failed: ${r.failed.join(", ")}` : `✓ Sent to ${r.recipients.join(", ")}`);
      setShareSummary("");
    } catch (e) { setShareMsg("⚠ " + ((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to send.")); }
    finally { setSharing(false); }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "8px 14px 40px" }}>
      <button onClick={() => nav(-1)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}><ArrowLeft size={15} /> Back</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: "4px 0" }}>{inc.type_label}</h1>
          <div style={{ color: "#888", fontSize: 13 }}>{inc.ref_no} · occurred {inc.occurred_at}{inc.occurred_approx ? " (approx)" : ""}
            {inc.is_anonymous && <span style={{ ...badge, marginLeft: 8 }}><ShieldOff size={11} /> anonymous</span>}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, textTransform: "uppercase", color: SEV_COLOR[inc.effective_severity] }}>{inc.effective_severity}</div>
          <div style={{ fontSize: 13, color: "#666", textTransform: "capitalize" }}>{inc.status.replace(/_/g, " ")}</div>
        </div>
      </div>

      {inc.ongoing_risk && <div style={{ background: "#fff0f0", border: "2px solid #c62828", color: "#7a1d1d", borderRadius: 10, padding: "10px 14px", margin: "10px 0", display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}><AlertTriangle size={18} /> The reporter flagged an ongoing risk.</div>}

      <Card title="What happened">
        <p style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.5 }}>{inc.description}</p>
        {inc.immediate_actions && <><div style={sub}>Done right away</div><p style={{ fontSize: 14 }}>{inc.immediate_actions}</p></>}
        {inc.event_name && <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>Related event: <strong>{inc.event_name}</strong></div>}
        {inc.filed_for_name && <div style={{ fontSize: 13, color: "#666" }}>Filed on behalf of <strong>{inc.filed_for_name}</strong>{inc.filed_for_relationship ? ` (${inc.filed_for_relationship})` : ""}.</div>}
        {isHandler && !inc.is_anonymous && inc.reporter_name && <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>Reported by <strong>{inc.reporter_name}</strong>.</div>}
        {inc.people.length > 0 && <div style={{ marginTop: 8 }}><div style={sub}>People</div>{inc.people.map((p, i) => <div key={i} style={{ fontSize: 13.5 }}>• {p.name} <span style={{ color: "#999" }}>({p.person_role})</span></div>)}</div>}
      </Card>

      {(inc.injury || inc.detail) && (
        <Card title="Details">
          {inc.detail && Object.entries(inc.detail).filter(([, v]) => v !== null && v !== "" && v !== false).map(([k, v]) => <Row key={k} k={k} v={v} />)}
          {inc.injury && Object.entries(inc.injury).filter(([, v]) => v !== null && v !== "" && v !== false).map(([k, v]) => <Row key={k} k={k} v={v} />)}
        </Card>
      )}

      <Card title="Attachments">
        {inc.attachments.length === 0 && <p style={{ color: "#999", fontSize: 13 }}>None.</p>}
        {inc.attachments.map((a) => <div key={a.id} style={{ fontSize: 13.5 }}><a href={a.url} target="_blank" rel="noreferrer" style={{ color: "#1565c0" }}><Paperclip size={12} /> {a.name}</a> <span style={{ color: "#aaa" }}>({Math.round(a.size_bytes / 1024)} KB)</span></div>)}
        <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) act(() => incidentsApi.upload(inc.id, f)); }} />
        <button onClick={() => fileRef.current?.click()} style={btnLight}>Add photo / document</button>
      </Card>

      {/* Handler surfaces */}
      {canTriage && (
        <Card title="Triage & assignment">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={sev} onChange={(e) => setSev(e.target.value)} style={inp}><option value="">Confirm severity…</option>{["minor", "moderate", "serious", "critical"].map((x) => <option key={x} value={x}>{x}</option>)}</select>
            <button style={btn} onClick={() => act(() => incidentsApi.triage(inc.id, sev ? { severity: sev } : { status: "in_review" }))}>Triage</button>
            <button style={btnLight} onClick={() => act(() => incidentsApi.notifyParent(inc.id, { method: "call", result: "reached" }))}>Log parent notified</button>
          </div>
          <div style={{ fontSize: 12.5, color: "#888", marginTop: 6 }}>{inc.parent_notified ? `Parent notified ${inc.parent_notified_at}.` : "Parent not yet notified."}{inc.board_reportable && " · Board-reportable."}</div>
        </Card>
      )}

      {canTriage && (
        <Card title="Share a summary with parents">
          {inc.guardian_emails && inc.guardian_emails.length > 0 ? (
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Will email the guardian(s) on file: <strong>{inc.guardian_emails.join(", ")}</strong></div>
          ) : (
            <div style={{ fontSize: 13, color: "#b7791f", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={14} /> No guardian email on file for the affected member(s). Add one to their profile, or notify the family another way.</div>
          )}
          <textarea style={{ ...inp, width: "100%", boxSizing: "border-box", minHeight: 90 }} value={shareSummary} onChange={(e) => setShareSummary(e.target.value)} placeholder="Write a parent-facing summary — plain language, only what the family needs to know. This is emailed to the guardians and logged as a parent notification." />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
            <button style={btn} disabled={sharing || !shareSummary.trim() || !(inc.guardian_emails && inc.guardian_emails.length > 0)} onClick={shareToParents}>{sharing ? "Sending…" : "Send to parents"}</button>
            {shareMsg && <span style={{ fontSize: 13, color: shareMsg.startsWith("✓") ? "#2e7d32" : "#a4291c" }}>{shareMsg}</span>}
          </div>
        </Card>
      )}

      {canTriage && (
        <Card title="Corrective-action tasks">
          {inc.tasks.length === 0 && <p style={{ color: "#999", fontSize: 13 }}>No linked tasks.</p>}
          {inc.tasks.map((t) => <div key={t.task_id} style={{ fontSize: 13.5, display: "flex", justifyContent: "space-between" }}><span>#{t.task_id} {t.title ?? ""} <span style={{ color: t.open ? "#c2410c" : "#2e7d32" }}>({t.status})</span></span><button style={linkBtn} onClick={() => act(() => incidentsApi.unlinkTask(inc.id, t.task_id))}>unlink</button></div>)}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input style={inp} placeholder="Planning task #" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
            <button style={btnLight} disabled={!taskId} onClick={() => { act(() => incidentsApi.linkTask(inc.id, Number(taskId))); setTaskId(""); }}>Link task</button>
          </div>
        </Card>
      )}

      {isHandler && (
        <Card title="Notes & addenda">
          {inc.notes.length === 0 && <p style={{ color: "#999", fontSize: 13 }}>No notes yet.</p>}
          {inc.notes.map((n) => <div key={n.id} style={{ borderLeft: "3px solid #e2d7d7", paddingLeft: 10, margin: "8px 0" }}>
            <div style={{ fontSize: 11, color: "#999" }}>{n.note_kind} · {n.author_name ?? "—"} · {n.created_at}</div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{n.body}</div></div>)}
          <div style={{ marginTop: 8 }}>
            <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)} style={{ ...inp, marginBottom: 6 }}>
              <option value="addendum">Addendum</option><option value="witness_statement">Witness statement</option>
              {canTriage && <option value="triage">Triage note</option>}
            </select>
            <textarea style={{ ...inp, width: "100%", boxSizing: "border-box", minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an addendum — the original narrative is never rewritten." />
            <button style={btn} disabled={!note.trim()} onClick={() => { act(() => incidentsApi.addNote(inc.id, { body: note, note_kind: noteKind })); setNote(""); }}>Add note</button>
          </div>
        </Card>
      )}

      {canClose && inc.status !== "closed" && (
        <Card title="Close">
          <textarea style={{ ...inp, width: "100%", boxSizing: "border-box", minHeight: 60 }} value={closeSummary} onChange={(e) => setCloseSummary(e.target.value)} placeholder="Closure summary (required). Must be someone other than the reporter; no open tasks." />
          <button style={{ ...btn, background: "#2e7d32" }} disabled={!closeSummary.trim()} onClick={() => act(() => incidentsApi.close(inc.id, closeSummary))}>Close incident</button>
        </Card>
      )}
      {inc.status === "closed" && <Card title="Closed"><p style={{ fontSize: 14 }}>{inc.closure_summary}</p><div style={{ fontSize: 12, color: "#888" }}>Closed {inc.closed_at}.</div></Card>}

      {err && <div style={{ background: "#fdecea", color: "#a4291c", border: "1px solid #f5b8b0", borderRadius: 8, padding: 10, fontSize: 13.5, marginTop: 10 }}>{err}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", marginTop: 12 }}>
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>{title}</div>{children}</div>;
}
function Row({ k, v }: { k: string; v: unknown }) {
  return <div style={{ fontSize: 13.5, display: "flex", gap: 8, padding: "2px 0" }}><span style={{ color: "#888", minWidth: 160, textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span><span>{Array.isArray(v) ? v.join(", ") : String(v)}</span></div>;
}
const sub: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#aaa", textTransform: "uppercase", marginTop: 8 };
const badge: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, background: "#eef2f6", color: "#667", borderRadius: 5, padding: "1px 6px", textTransform: "uppercase" };
const inp: React.CSSProperties = { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, fontFamily: "inherit" };
const btn: React.CSSProperties = { padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13.5, marginTop: 6 };
const btnLight: React.CSSProperties = { padding: "9px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13, marginTop: 6 };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#c2410c", cursor: "pointer", fontSize: 12, textDecoration: "underline" };
