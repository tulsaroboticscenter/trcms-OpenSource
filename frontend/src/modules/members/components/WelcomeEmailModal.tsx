/**
 * WelcomeEmailModal
 * =================
 * Sends a welcome email to a member with their login credentials.
 * Always shows a preview + copy option in case SMTP is not configured.
 *
 * Behavior:
 *   1. Admin clicks "Send Welcome Email" on a member profile
 *   2. A confirmation dialog appears showing what will happen
 *   3. On confirm, the backend generates a temp password, updates the member,
 *      and (if SMTP is set up) sends the email
 *   4. The modal shows the result:
 *      - If sent: "Email sent to [address]"
 *      - If not sent (no SMTP): shows the full email text to copy/paste manually
 *      - Always shows the generated credentials for the admin's reference
 */
import { useState } from "react";
import { api } from "../../../core/api";
import { Mail, Copy, CheckCircle, AlertTriangle, X, ExternalLink } from "lucide-react";

interface Props {
  memberId: number;
  memberName: string;
  memberType: string;
  onClose: () => void;
}

interface EmailResult {
  ok: boolean;
  email_sent: boolean;
  email_enabled: boolean;
  send_error?: string;
  recipient_email: string;
  cc_email?: string;
  subject: string;
  body_text: string;
  temp_password: string;
  username: string;
  login_url: string;
}

type Stage = "confirm" | "sending" | "result";

export default function WelcomeEmailModal({ memberId, memberName, memberType, onClose }: Props) {
  const [stage, setStage] = useState<Stage>("confirm");
  const [result, setResult] = useState<EmailResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function handleSend() {
    setStage("sending");
    try {
      const { data } = await api.post(`/api/v1/members/${memberId}/send-welcome-email`);
      setResult(data);
      setStage("result");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to send welcome email.");
      setStage("confirm");
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function CopyBtn({ text, id, label = "Copy" }: { text: string; id: string; label?: string }) {
    return (
      <button style={styles.copyBtn} onClick={() => copy(text, id)}>
        {copied === id ? <CheckCircle size={12} color="#2e7d32" /> : <Copy size={12} />}
        {copied === id ? "Copied!" : label}
      </button>
    );
  }

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>
            <Mail size={18} color="#1a3a5c" />
            <span>Send Welcome Email</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose}><X size={16} /></button>
        </div>

        {/* ── Confirm stage ── */}
        {stage === "confirm" && (
          <div style={styles.body}>
            <p style={styles.confirmText}>
              This will generate a new temporary password for <strong>{memberName}</strong> and
              {memberType === "youth"
                ? " send their login credentials to their parent/guardian's email address."
                : " send their login credentials to their email address."
              }
            </p>
            <div style={styles.warningBox}>
              <AlertTriangle size={14} color="#f57c00" />
              <span>
                <strong>This resets their password.</strong> Their current password will stop working.
                The new temporary password will be included in the email and shown here for your reference.
              </span>
            </div>
            {error && <div style={styles.errorBox}>{error}</div>}
            <div style={styles.confirmActions}>
              <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={styles.sendBtn} onClick={handleSend}>
                <Mail size={14} /> Generate &amp; Send Welcome Email
              </button>
            </div>
          </div>
        )}

        {/* ── Sending stage ── */}
        {stage === "sending" && (
          <div style={styles.body}>
            <div style={styles.sending}>
              <div style={styles.spinner} />
              <p>Generating password and sending email…</p>
            </div>
          </div>
        )}

        {/* ── Result stage ── */}
        {stage === "result" && result && (
          <div style={styles.body}>
            {/* Status banner */}
            {result.email_sent ? (
              <div style={styles.successBanner}>
                <CheckCircle size={16} color="#2e7d32" />
                <div>
                  <strong>Email sent!</strong>
                  <div style={styles.bannerSub}>
                    To: {result.recipient_email}
                    {result.cc_email && ` · CC: ${result.cc_email}`}
                  </div>
                </div>
              </div>
            ) : (
              <div style={styles.noSmtpBanner}>
                <AlertTriangle size={16} color="#f57c00" />
                <div>
                  <strong>Email not sent</strong> — SMTP is not configured.
                  {result.send_error && <div style={styles.bannerSub}>Error: {result.send_error}</div>}
                  <div style={styles.bannerSub}>
                    Copy the email content below and send it manually to <strong>{result.recipient_email}</strong>.
                    {result.cc_email && ` Also CC: ${result.cc_email}`}
                  </div>
                </div>
              </div>
            )}

            {/* Credentials box — always shown */}
            <div style={styles.credsBox}>
              <div style={styles.credsTitle}>Generated Login Credentials</div>
              <div style={styles.credRow}>
                <span style={styles.credLabel}>Username</span>
                <code style={styles.credValue}>{result.username}</code>
                <CopyBtn text={result.username} id="username" />
              </div>
              <div style={styles.credRow}>
                <span style={styles.credLabel}>Password</span>
                <code style={styles.credValue}>{result.temp_password}</code>
                <CopyBtn text={result.temp_password} id="password" />
              </div>
              <div style={styles.credRow}>
                <span style={styles.credLabel}>Login URL</span>
                <a href={result.login_url} target="_blank" rel="noopener noreferrer" style={styles.loginLink}>
                  {result.login_url} <ExternalLink size={10} />
                </a>
                <CopyBtn text={result.login_url} id="url" />
              </div>
            </div>

            {/* Email body preview — especially useful when SMTP is off */}
            <div style={styles.previewSection}>
              <div style={styles.previewHeader}>
                <span style={styles.previewTitle}>Email Content</span>
                <CopyBtn text={result.body_text} id="body" label="Copy full email" />
              </div>
              <div style={styles.subjectRow}>
                <span style={styles.subjectLabel}>Subject:</span>
                <span style={styles.subjectText}>{result.subject}</span>
                <CopyBtn text={result.subject} id="subject" label="Copy" />
              </div>
              <pre style={styles.bodyPre}>{result.body_text}</pre>
            </div>

            <div style={styles.resultActions}>
              <button style={styles.doneBtn} onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, width: 580, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" },
  modalTitle: { display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex", padding: 4 },
  body: { padding: "20px", overflowY: "auto", flex: 1 },
  confirmText: { fontSize: 14, color: "#444", lineHeight: 1.7, marginBottom: 14 },
  warningBox: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548", marginBottom: 16, lineHeight: 1.6 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 14, fontSize: 13 },
  confirmActions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  cancelBtn: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  sendBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  sending: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "32px 0", color: "#666" },
  spinner: { width: 36, height: 36, border: "3px solid #e2e8f0", borderTop: "3px solid #1a3a5c", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  successBanner: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, fontSize: 14, color: "#2e7d32", marginBottom: 16 },
  noSmtpBanner: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548", marginBottom: 16, lineHeight: 1.6 },
  bannerSub: { fontSize: 12, marginTop: 3, opacity: 0.8 },
  credsBox: { background: "#f0f4f8", border: "1px solid #1a3a5c", borderRadius: 9, padding: "14px 16px", marginBottom: 14 },
  credsTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 10 },
  credRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13 },
  credLabel: { color: "#888", minWidth: 80, fontSize: 12, fontWeight: 600 },
  credValue: { background: "#fff", border: "1px solid #ccc", borderRadius: 4, padding: "2px 8px", fontFamily: "monospace", fontSize: 14, color: "#1a3a5c", fontWeight: 700, flex: 1 },
  loginLink: { color: "#1565c0", fontSize: 13, flex: 1, display: "flex", alignItems: "center", gap: 4 },
  copyBtn: { display: "flex", alignItems: "center", gap: 4, padding: "3px 9px", border: "1px solid #ccc", background: "#fff", borderRadius: 4, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" as const, flexShrink: 0 },
  previewSection: { border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: 14 },
  previewHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" },
  previewTitle: { fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  subjectRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #f0f4f8", fontSize: 13 },
  subjectLabel: { fontSize: 11, fontWeight: 600, color: "#888", minWidth: 55 },
  subjectText: { flex: 1, color: "#333" },
  bodyPre: { margin: 0, padding: "12px", fontSize: 12, lineHeight: 1.7, color: "#444", whiteSpace: "pre-wrap" as const, fontFamily: "inherit", maxHeight: 220, overflowY: "auto" as const },
  resultActions: { display: "flex", justifyContent: "flex-end" },
  doneBtn: { padding: "9px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
