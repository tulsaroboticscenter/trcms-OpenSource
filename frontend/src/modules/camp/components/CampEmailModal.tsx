/**
 * CampEmailModal (#85)
 * ====================
 * Bulk-emails the parent/guardian contacts of camp registrations. The audience
 * is built inside the modal: pick one or more camps (sessions), choose which
 * registration statuses to include (e.g. confirmed + pending, but not waitlist
 * or cancelled), optionally start from a saved template, and send.
 *
 * Recipients are resolved from the camp backend (de-duped by email, opted-out
 * contacts excluded) and sent through the communications bulk pipeline
 * (comms/send-bulk) so every message is logged in Message History.
 */
import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import { campApi, type CampEmailRecipient, type CampSession } from "../api";
import { commsApi, type EmailTemplate, type EmailLayout } from "../../communications/api";
import RichTextEditor, { type RichTextEditorHandle } from "../../communications/components/RichTextEditor";
import { Mail, Send, X, CheckCircle, AlertTriangle, Users, Save } from "lucide-react";

interface Props {
  season?: { id: number; name: string };
  sessions?: CampSession[];
  initialSessionId?: number | "all";
  initialStatus?: string;          // a status pre-selected on the Registrations screen
  singleContact?: { email: string; name: string } | null;  // #104 — email one contact
  onClose: () => void;
}

type Stage = "compose" | "result";
const ALL_STATUSES = ["confirmed", "pending", "waitlist", "cancelled"];
const DEFAULT_STATUSES = ["confirmed", "pending"];   // skip waitlist + cancelled by default

export default function CampEmailModal({ season, sessions = [], initialSessionId, initialStatus, singleContact, onClose }: Props) {
  const [selSessions, setSelSessions] = useState<Set<number>>(
    () => (typeof initialSessionId === "number" ? new Set([initialSessionId]) : new Set()));
  const [selStatuses, setSelStatuses] = useState<Set<string>>(
    () => new Set(initialStatus ? [initialStatus] : DEFAULT_STATUSES));

  const [recipients, setRecipients] = useState<CampEmailRecipient[] | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<number | "">("");
  const [layouts, setLayouts] = useState<EmailLayout[]>([]);
  const [layoutId, setLayoutId] = useState<number | "">("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p></p>");
  const [replyEnabled, setReplyEnabled] = useState(true);
  const [copyTo, setCopyTo] = useState("");
  const [includeUnsub, setIncludeUnsub] = useState(true);
  const [stage, setStage] = useState<Stage>("compose");
  const [sending, setSending] = useState(false);
  const [savingTpl, setSavingTpl] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<{ sent: number; failed: number; total: number; email_enabled: boolean } | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  // Camp/Summer-camp + general templates to start from.
  useEffect(() => {
    Promise.all([commsApi.listTemplates("summer_camp").catch(() => []), commsApi.listTemplates("general").catch(() => [])])
      .then(([camp, gen]) => setTemplates([...camp, ...gen]));
    commsApi.listLayouts().then(setLayouts).catch(() => {});
  }, []);

  // Resolve recipients whenever the audience selection changes.
  const sessionKey = useMemo(() => [...selSessions].sort().join(","), [selSessions]);
  const statusKey = useMemo(() => [...selStatuses].sort().join(","), [selStatuses]);
  useEffect(() => {
    if (singleContact) { setRecipients([{ email: singleContact.email, name: singleContact.name, campers: [] }]); return; }
    setRecipients(null);
    if (selStatuses.size === 0) { setRecipients([]); return; }
    campApi.emailRecipients({
      season_id: season?.id,
      ...(selSessions.size > 0 ? { session_ids: [...selSessions].join(",") } : {}),
      statuses: [...selStatuses].join(","),
    }).then(setRecipients).catch(() => setRecipients([]));
  }, [sessionKey, statusKey, season?.id, singleContact]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); return n;
  }

  async function loadTemplate(id: number) {
    const t = await commsApi.getTemplate(id);
    setSubject(t.subject_template);
    setBodyHtml(t.body_html_template);
    setReplyEnabled(t.reply_enabled);
  }

  async function saveAsTemplate() {
    const name = window.prompt("Save this email as a reusable camp template. Name it:");
    if (!name || !name.trim()) return;
    setSavingTpl(true); setError("");
    try {
      const t = await commsApi.createTemplate({
        name: name.trim(), category: "summer_camp",
        subject_template: subject, body_html_template: bodyHtml, reply_enabled: replyEnabled,
      });
      setTemplates((ts) => [t, ...ts]);
      setTemplateId(t.id);
      setNotice(`Saved template “${t.name}”.`);
      setTimeout(() => setNotice(""), 2500);
    } catch {
      setError("Could not save the template.");
    } finally { setSavingTpl(false); }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim()) { setError("Subject is required."); return; }
    if (!recipients || recipients.length === 0) { setError("No contacts to email — adjust the camps or statuses."); return; }
    setError(""); setSending(true);
    try {
      const r = await commsApi.sendBulk({
        subject, body_html: bodyHtml, reply_enabled: replyEnabled,
        template_id: templateId ? Number(templateId) : undefined,
        layout_id: layoutId ? Number(layoutId) : undefined,
        include_unsubscribe: includeUnsub,
        copy_to: copyTo.trim() || undefined,
        recipients: recipients.map((c) => ({ member_id: null, email: c.email, name: c.name, kind: "parent", vars: c.vars })),
      });
      setResult({ sent: r.sent, failed: r.failed, total: r.total, email_enabled: r.email_enabled });
      setStage("result");
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Send failed. Please try again.");
    } finally { setSending(false); }
  }

  const campLabel = selSessions.size === 0 ? `All camps${season ? ` — ${season.name}` : ""}` : `${selSessions.size} camp${selSessions.size === 1 ? "" : "s"} selected`;

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.head}>
          <div style={s.title}><Mail size={18} color="#1a3a5c" /> {stage === "compose" ? "Email camp contacts" : "Email sent"}</div>
          <button style={s.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        {stage === "compose" && (
          <form onSubmit={handleSend} style={s.form}>
            <div style={s.body}>
            {singleContact ? (
              <div style={s.audience}>
                <Mail size={15} color="#0277bd" />
                <div><strong>To: {singleContact.name}</strong> &lt;{singleContact.email}&gt;</div>
              </div>
            ) : (<>
            {/* Camps (sessions) multi-select */}
            <div style={s.field}>
              <label style={s.label}>Camps <span style={s.hint}>(none selected = all camps this season)</span></label>
              <div style={s.checkGrid}>
                {sessions.map((ss) => (
                  <label key={ss.id} style={s.chk}>
                    <input type="checkbox" checked={selSessions.has(ss.id)} onChange={() => setSelSessions((x) => toggle(x, ss.id))} />
                    <span>{ss.title}{ss.week_label ? ` · ${ss.week_label}` : ""}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Status multi-select */}
            <div style={s.field}>
              <label style={s.label}>Registration status to include</label>
              <div style={s.statusRow}>
                {ALL_STATUSES.map((st) => (
                  <label key={st} style={{ ...s.statusChip, ...(selStatuses.has(st) ? s.statusChipOn : {}) }}>
                    <input type="checkbox" style={{ display: "none" }} checked={selStatuses.has(st)} onChange={() => setSelStatuses((x) => toggle(x, st))} />
                    {st}
                  </label>
                ))}
              </div>
            </div>

            {/* Audience summary */}
            <div style={s.audience}>
              <Users size={15} color="#0277bd" />
              <div>
                <div><strong>{campLabel}</strong> · {[...selStatuses].join(", ") || "no status selected"}</div>
                <div style={s.audienceSub}>
                  {recipients === null ? "Finding contacts…"
                    : `${recipients.length} contact${recipients.length === 1 ? "" : "s"} (one email per address; opted-out contacts excluded)`}
                </div>
              </div>
            </div>

            {recipients && recipients.length > 0 && (
              <details style={s.details}>
                <summary style={s.summary}>Show recipients</summary>
                <div style={s.recipList}>
                  {recipients.map((c) => (
                    <div key={c.email} style={s.recipRow}>
                      <span><strong>{c.name}</strong> &lt;{c.email}&gt;</span>
                      {c.campers.length > 0 && <span style={s.recipCampers}>{c.campers.join(", ")}</span>}
                    </div>
                  ))}
                </div>
              </details>
            )}
            </>)}

            {/* Template picker */}
            <div style={s.field}>
              <label style={s.label}>Start from a saved template</label>
              <select style={s.input} value={templateId} onChange={(e) => { const id = e.target.value; setTemplateId(id as "" | number); if (id) loadTemplate(Number(id)); }}>
                <option value="">— Start from scratch —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            {layouts.length > 0 && (
              <div style={s.field}>
                <label style={s.label}>Header / footer layout</label>
                <select style={s.input} value={layoutId} onChange={(e) => setLayoutId(e.target.value as "" | number)}>
                  <option value="">{layouts.find((l) => l.is_default) ? "Default layout" : "Built-in TRCMS branding"}</option>
                  {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}{l.is_default ? " (default)" : ""}</option>)}
                </select>
              </div>
            )}

            <div style={s.field}>
              <label style={s.label}>Subject *</label>
              <input style={s.input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject…" />
            </div>

            <div style={s.field}>
              <label style={s.label}>CC / send a copy to <span style={s.hint}>(optional — one copy for your records, not one per family)</span></label>
              <input style={s.input} value={copyTo} onChange={(e) => setCopyTo(e.target.value)} placeholder="you@example.com, board@example.com" />
            </div>

            <div style={s.field}>
              <label style={s.label}>Message</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, color: "#889" }}>Personalize:</span>
                {[
                  { t: "{{camper_first_name}}", l: "Camper first name" },
                  { t: "{{camper_names}}", l: "All campers" },
                  { t: "{{parent_name}}", l: "Parent name" },
                  { t: "{{camp_sessions}}", l: "Camp(s)" },
                ].map((v) => (
                  <button key={v.t} type="button" title={`Insert ${v.t}`}
                    onClick={() => editorRef.current?.insertText(v.t)}
                    style={{ padding: "3px 9px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 12, fontSize: 11.5, cursor: "pointer" }}>
                    + {v.l}
                  </button>
                ))}
              </div>
              <RichTextEditor ref={editorRef} value={bodyHtml} onChange={setBodyHtml} placeholder="Details about location, snacks, what to bring… Try: Hi {{camper_first_name}}!" minHeight={200} />
            </div>

            <label style={s.checkRow}>
              <input type="checkbox" checked={replyEnabled} onChange={(e) => setReplyEnabled(e.target.checked)} />
              <div>
                <div style={s.checkLabel}>Allow recipients to reply</div>
                <div style={s.checkHint}>Adds a Reply-To so parents can respond; replies appear in the thread when inbound mail is configured.</div>
              </div>
            </label>

            <label style={s.checkRow}>
              <input type="checkbox" checked={includeUnsub} onChange={(e) => setIncludeUnsub(e.target.checked)} />
              <div>
                <div style={s.checkLabel}>Add an unsubscribe link</div>
                <div style={s.checkHint}>Adds an Unsubscribe footer and skips anyone who has opted out of mass emails.</div>
              </div>
            </label>

            {notice && <div style={s.noticeBox}>{notice}</div>}
            {error && <div style={s.errorBox}>{error}</div>}
            </div>

            <div style={s.actions}>
              <button type="button" onClick={saveAsTemplate} style={s.saveBtn} disabled={savingTpl || !subject.trim()} title="Save this subject + message as a reusable camp template">
                <Save size={14} /> {savingTpl ? "Saving…" : "Save as template"}
              </button>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={onClose} style={s.cancelBtn}>Cancel</button>
              <button type="submit" style={s.sendBtn} disabled={sending || !recipients || recipients.length === 0}>
                <Send size={14} /> {sending ? "Sending…" : `Send to ${recipients?.length ?? 0}`}
              </button>
            </div>
          </form>
        )}

        {stage === "result" && result && (
          <div style={s.body}>
            {result.email_enabled ? (
              <div style={s.successBanner}>
                <CheckCircle size={18} color="#2e7d32" />
                <div><strong>Sent to {result.sent} of {result.total}.</strong>
                  {result.failed > 0 && <div style={s.bannerSub}>{result.failed} failed — see Message History for details.</div>}
                </div>
              </div>
            ) : (
              <div style={s.warnBanner}>
                <AlertTriangle size={18} color="#f57c00" />
                <div><strong>SMTP not configured — emails were logged but not sent.</strong>
                  <div style={s.bannerSub}>Configure email in Admin → System settings to actually deliver.</div>
                </div>
              </div>
            )}
            <div style={s.actions}>
              <button style={s.sendBtn} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 16px", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 640, maxHeight: "94vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.25)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #eef0f4", flexShrink: 0 },
  title: { display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  form: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1 },
  body: { padding: "18px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", flex: 1, minHeight: 0 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  hint: { fontWeight: 400, color: "#99a" },
  checkGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", maxHeight: 130, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" },
  chk: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334155", cursor: "pointer" },
  statusRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  statusChip: { padding: "5px 12px", borderRadius: 14, border: "1px solid #cdd7e3", background: "#fff", color: "#667", fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" },
  statusChipOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  audience: { display: "flex", gap: 10, alignItems: "flex-start", background: "#eef6fb", border: "1px solid #cfe6f5", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "#1a3a5c" },
  audienceSub: { fontSize: 12, color: "#5a7184", marginTop: 2 },
  details: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px" },
  summary: { cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#1565c0" },
  recipList: { marginTop: 8, maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 },
  recipRow: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: "#445", borderBottom: "1px solid #f4f6fa", padding: "2px 0" },
  recipCampers: { color: "#99a", whiteSpace: "nowrap" },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box", width: "100%" },
  checkRow: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
  checkLabel: { fontSize: 14, fontWeight: 600, color: "#333" },
  checkHint: { fontSize: 11, color: "#888", marginTop: 2, lineHeight: 1.5 },
  noticeBox: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "8px 14px", color: "#2e7d32", fontSize: 13 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, padding: "12px 18px", borderTop: "1px solid #eef0f4", background: "#fff", borderRadius: "0 0 12px 12px", flexShrink: 0 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  sendBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 22px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  successBanner: { display: "flex", gap: 10, padding: "12px 14px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, fontSize: 14, color: "#2e7d32" },
  warnBanner: { display: "flex", gap: 10, padding: "12px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548" },
  bannerSub: { fontSize: 12, marginTop: 3, opacity: 0.9 },
};
