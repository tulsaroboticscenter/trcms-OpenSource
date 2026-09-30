/**
 * ComposeModal
 * ============
 * Launched from any profile page (member, visitor, etc.) via a "Send Email" button.
 *
 * Flow:
 *   1. Optional: select a template (pre-fills subject + body)
 *   2. Edit subject and body in rich text editor
 *   3. Toggle "Allow replies" for 1:1 conversations
 *   4. Preview with real recipient data (variable substitution)
 *   5. Send — shows result with copy option if SMTP not configured
 */
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { commsApi, type EmailTemplate, type SendResult, CATEGORY_LABELS } from "../api";
import RichTextEditor, { type RichTextEditorHandle } from "./RichTextEditor";
import DOMPurify from "dompurify";
import { Mail, Eye, Send, X, CheckCircle, AlertTriangle, ExternalLink, Copy } from "lucide-react";

interface Props {
  recipientType: "member" | "visitor" | "volunteer" | "sponsor";
  recipientId: number;
  recipientName: string;
  recipientEmail?: string;
  onClose: () => void;
  onSent?: () => void;   // called after successful send to refresh history panel
}

type Stage = "compose" | "preview" | "result";

export default function ComposeModal({
  recipientType, recipientId, recipientName, recipientEmail, onClose, onSent,
}: Props) {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("compose");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<number | "">("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p></p>");
  const [replyEnabled, setReplyEnabled] = useState(true); // reply-enabled by default
  const [variables, setVariables] = useState<string[]>([]);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    commsApi.listTemplates(recipientType)
      .then(setTemplates)
      .catch(() => commsApi.listTemplates().then(setTemplates));
    commsApi.getVariables(recipientType).then(setVariables);
  }, [recipientType]);

  async function loadTemplate(id: number) {
    setLoading(true);
    try {
      const t = await commsApi.getTemplate(id);
      setSubject(t.subject_template);
      setBodyHtml(t.body_html_template);
      setReplyEnabled(t.reply_enabled);
    } finally { setLoading(false); }
  }

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim()) { setError("Subject is required."); return; }
    setError("");
    setLoading(true);
    try {
      const p = await commsApi.preview({
        recipient_type: recipientType,
        recipient_id: recipientId,
        subject_template: subject,
        body_html_template: bodyHtml,
      });
      setPreview(p);
      setStage("preview");
    } catch { setError("Preview failed."); }
    finally { setLoading(false); }
  }

  async function handleSend() {
    setSending(true);
    try {
      const r = await commsApi.send({
        recipient_type: recipientType,
        recipient_id: recipientId,
        subject,
        body_html: bodyHtml,
        template_id: selectedTemplate ? Number(selectedTemplate) : undefined,
        reply_enabled: replyEnabled,
      });
      setResult(r);
      setStage("result");
      onSent?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Send failed. Please try again.");
      setStage("compose");
    } finally { setSending(false); }
  }

  function copyBody() {
    if (result?.body_text) {
      navigator.clipboard.writeText(result.body_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>
            <Mail size={18} color="#1a3a5c" />
            <span>
              {stage === "compose" ? `Email to ${recipientName}` :
               stage === "preview" ? "Preview Email" :
               "Email Sent"}
            </span>
          </div>
          <button style={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        {/* ── Compose stage ── */}
        {stage === "compose" && (
          <form onSubmit={handlePreview} style={styles.body}>
            {recipientEmail && (
              <div style={styles.recipientChip}>
                To: <strong>{recipientName}</strong> &lt;{recipientEmail}&gt;
              </div>
            )}

            {/* Template selector */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Template (optional)</label>
              <select
                style={styles.input}
                value={selectedTemplate}
                onChange={e => {
                  const id = e.target.value;
                  setSelectedTemplate(id as "" | number);
                  if (id) loadTemplate(Number(id));
                }}
              >
                <option value="">— Start from scratch —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    [{CATEGORY_LABELS[t.category] ?? t.category}] {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Subject */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Subject *</label>
              <input
                style={styles.input}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Email subject…"
              />
            </div>

            {/* Variable chips — blue for subject, green for body */}
            {variables.length > 0 && (
              <div style={styles.variableHint}>
                <div style={styles.varRow}>
                  <span style={styles.varRowLabel}>→ Subject:</span>
                  <div style={styles.varChips}>
                    {variables.map(v => (
                      <code key={`s-${v}`} style={styles.varChip}
                        onClick={() => setSubject(s => s + `{{${v}}}`)}
                        title="Insert into subject line"
                      >{`{{${v}}}`}</code>
                    ))}
                  </div>
                </div>
                <div style={styles.varRow}>
                  <span style={{ ...styles.varRowLabel, color: "#2e7d32" }}>→ Body:</span>
                  <div style={styles.varChips}>
                    {variables.map(v => (
                      <code key={`b-${v}`} style={{ ...styles.varChip, background: "#2e7d32" }}
                        onClick={() => editorRef.current?.insertText(`{{${v}}}`)}
                        title="Insert at cursor position in the body"
                      >{`{{${v}}}`}</code>
                    ))}
                  </div>
                </div>
                <p style={styles.varHintNote}>
                  <strong>Blue</strong> = add to subject · <strong style={{ color: "#2e7d32" }}>Green</strong> = insert at cursor in body (click in the editor first to place your cursor)
                </p>
              </div>
            )}

            {/* Rich text body */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Message</label>
              {!loading && (
                <RichTextEditor
                  ref={editorRef}
                  value={bodyHtml}
                  onChange={setBodyHtml}
                  placeholder="Write your message here… Click green variable chips above to insert {{variables}} at cursor."
                  minHeight={200}
                />
              )}
              {loading && <div style={styles.loadingEditor}>Loading template…</div>}
            </div>

            {/* Reply option */}
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={replyEnabled}
                onChange={e => setReplyEnabled(e.target.checked)}
              />
              <div>
                <div style={styles.checkLabel}>Allow recipient to reply</div>
                <div style={styles.checkHint}>
                  Includes a Reply-To address. Replies will be visible in the thread when inbound processing is configured.
                </div>
              </div>
            </label>

            {error && <div style={styles.errorBox}>{error}</div>}

            <div style={styles.actions}>
              <button type="button" onClick={onClose} style={styles.cancelBtn}>Cancel</button>
              <button type="submit" style={styles.previewBtn} disabled={loading}>
                <Eye size={14} /> Preview
              </button>
            </div>
          </form>
        )}

        {/* ── Preview stage ── */}
        {stage === "preview" && preview && (
          <div style={styles.body}>
            <div style={styles.previewSubject}>
              <span style={styles.previewSubjectLabel}>Subject:</span>
              <strong>{preview.subject}</strong>
            </div>
            <div
              style={styles.previewFrame}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.body_html, { ADD_ATTR: ["target", "rel"] }) }}
            />
            {error && <div style={styles.errorBox}>{error}</div>}
            <div style={styles.actions}>
              <button onClick={() => setStage("compose")} style={styles.cancelBtn}>← Edit</button>
              <button onClick={handleSend} style={styles.sendBtn} disabled={sending}>
                <Send size={14} /> {sending ? "Sending…" : "Send Email"}
              </button>
            </div>
          </div>
        )}

        {/* ── Result stage ── */}
        {stage === "result" && result && (
          <div style={styles.body}>
            {result.email_sent ? (
              <div style={styles.successBanner}>
                <CheckCircle size={18} color="#2e7d32" />
                <div>
                  <strong>Email sent!</strong>
                  <div style={styles.bannerSub}>To: {result.recipient_email}</div>
                </div>
              </div>
            ) : (
              <div style={styles.noSmtpBanner}>
                <AlertTriangle size={18} color="#f57c00" />
                <div>
                  <strong>SMTP not configured — email not sent</strong>
                  <div style={styles.bannerSub}>
                    Copy the message below and send manually to <strong>{result.recipient_email}</strong>.
                  </div>
                </div>
              </div>
            )}

            <div style={styles.resultSubject}>
              <span style={styles.previewSubjectLabel}>Subject:</span> {result.subject}
            </div>

            <div style={styles.resultActions}>
              <button style={styles.copyBtn} onClick={copyBody}>
                <Copy size={13} /> {copied ? "Copied!" : "Copy as plain text"}
              </button>
              <button
                style={styles.viewThreadBtn}
                onClick={() => { onClose(); navigate(`/communications/threads/${result.thread_id}`); }}
              >
                <ExternalLink size={13} /> View Thread
              </button>
            </div>

            <pre style={styles.bodyPre}>{result.body_text}</pre>

            <div style={styles.actions}>
              <button style={styles.sendBtn} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, width: 680, maxWidth: "95vw", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" },
  modalTitle: { display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  body: { padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 },
  recipientChip: { padding: "7px 12px", background: "#f0f4f8", borderRadius: 7, fontSize: 13, color: "#555" },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const, width: "100%" },
  loadingEditor: { height: 120, background: "#f8fafc", border: "1px solid #ccc", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 13 },
  variableHint: { background: "#f0f4f8", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 },
  varRow: { display: "flex", alignItems: "flex-start", gap: 8 },
  varRowLabel: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", minWidth: 58, paddingTop: 2, whiteSpace: "nowrap" as const },
  varChips: { display: "flex", flexWrap: "wrap", gap: 4 },
  varChip: { fontSize: 11, background: "#1a3a5c", color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", userSelect: "none" as const },
  varHintNote: { fontSize: 10, color: "#888", margin: 0, lineHeight: 1.5 },
  variableHintLabel: { fontSize: 11, color: "#888", fontWeight: 600, marginRight: 4 },
  checkRow: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
  checkLabel: { fontSize: 14, fontWeight: 600, color: "#333" },
  checkHint: { fontSize: 11, color: "#888", marginTop: 2, lineHeight: 1.5 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  previewBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  sendBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 22px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  previewSubject: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 7, fontSize: 14 },
  previewSubjectLabel: { fontSize: 12, color: "#888", fontWeight: 600 },
  previewFrame: { border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem", fontSize: 13, maxHeight: 400, overflowY: "auto" as const, background: "#fff" },
  successBanner: { display: "flex", gap: 10, padding: "12px 14px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, fontSize: 14, color: "#2e7d32" },
  noSmtpBanner: { display: "flex", gap: 10, padding: "12px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548" },
  bannerSub: { fontSize: 12, marginTop: 3, opacity: 0.85 },
  resultSubject: { fontSize: 14, color: "#333", padding: "4px 0" },
  resultActions: { display: "flex", gap: 8 },
  copyBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  viewThreadBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", border: "1px solid #1a3a5c", color: "#1a3a5c", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  bodyPre: { fontSize: 12, lineHeight: 1.7, color: "#444", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, padding: "12px", whiteSpace: "pre-wrap" as const, maxHeight: 200, overflowY: "auto" as const, fontFamily: "inherit" },
};

