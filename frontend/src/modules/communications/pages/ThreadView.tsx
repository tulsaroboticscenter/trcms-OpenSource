import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { commsApi, type ThreadDetail } from "../api";
import { ArrowLeft, Mail, CheckCircle, AlertTriangle, Clock, Lock } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  sent: "#2e7d32", failed: "#c62828", draft: "#888",
};

export default function ThreadView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    commsApi.getThread(parseInt(id!))
      .then(setThread)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleClose() {
    if (!thread) return;
    if (!confirm("Mark this thread as closed?")) return;
    await commsApi.closeThread(thread.id);
    setThread(t => t ? { ...t, status: "closed" } : t);
  }

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (!thread) return <div style={styles.center}>Thread not found.</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>
          <ArrowLeft size={14} /> Back
        </button>
        <div style={styles.headerRight}>
          {thread.status === "open" && (
            <button style={styles.closeBtn} onClick={handleClose}>
              <Lock size={13} /> Close Thread
            </button>
          )}
          {thread.status === "closed" && (
            <span style={styles.closedTag}>Closed</span>
          )}
        </div>
      </div>

      {/* Thread info */}
      <div style={styles.threadCard}>
        <h1 style={styles.subject}>{thread.subject}</h1>
        <div style={styles.threadMeta}>
          <span>To: <strong>{thread.recipient_name ?? thread.recipient_email}</strong> &lt;{thread.recipient_email}&gt;</span>
          {thread.reply_enabled && (
            <span style={styles.replyBadge}>📨 Replies enabled</span>
          )}
          <span style={styles.msgCount}>{thread.messages.length} message{thread.messages.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {thread.messages.map((msg, idx) => (
          <div key={msg.id} style={{
            ...styles.messageCard,
            borderLeftColor: msg.direction === "inbound" ? "#2e7d32" : "#1a3a5c",
          }}>
            <div style={styles.msgHeader}>
              <div style={styles.msgSender}>
                {msg.direction === "inbound"
                  ? <span style={styles.inboundTag}>↩ Reply from {thread.recipient_name ?? "recipient"}</span>
                  : <span>{msg.sender_name}</span>
                }
              </div>
              <div style={styles.msgMeta}>
                <span style={{ color: STATUS_COLORS[msg.status] ?? "#888", fontSize: 12 }}>
                  {msg.status === "sent" && <CheckCircle size={12} />}
                  {msg.status === "failed" && <AlertTriangle size={12} />}
                  {msg.status === "draft" && <Clock size={12} />}
                  {" "}{msg.status}
                </span>
                <span style={styles.msgDate}>
                  {msg.sent_at
                    ? new Date(msg.sent_at).toLocaleString()
                    : new Date(msg.created_at).toLocaleString()
                  }
                </span>
              </div>
            </div>
            {msg.subject && idx > 0 && (
              <div style={styles.msgSubject}>Re: {msg.subject}</div>
            )}
            {msg.direction === "outbound" && (msg.opened_at || msg.clicked_at) && (
              <div style={styles.engagement}>
                {msg.opened_at && <span style={styles.engOpen}>👁 Opened {new Date(msg.opened_at).toLocaleString()}{(msg.open_count ?? 0) > 1 ? ` (${msg.open_count}×)` : ""}</span>}
                {msg.clicked_at && <span style={styles.engClick}>🔗 Clicked {new Date(msg.clicked_at).toLocaleString()}{(msg.click_count ?? 0) > 1 ? ` (${msg.click_count}×)` : ""}</span>}
              </div>
            )}
            <EmailBody html={msg.body_html} />
          </div>
        ))}
      </div>

      {/* Phase 2 note */}
      {thread.reply_enabled && thread.status === "open" && (
        <div style={styles.replyNote}>
          <Mail size={14} />
          <div>
            <strong>Replies enabled</strong> — when the recipient replies to this email, their response will appear here automatically once inbound email processing is configured (Phase 2).
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Renders email HTML inside an isolated, sandboxed iframe so the email's own
 * <style> rules can't leak into the app and it displays as it would in an
 * email client. The iframe auto-sizes to its content height.
 * sandbox="allow-same-origin" (no allow-scripts) keeps scripts disabled while
 * still letting us measure the content height.
 */
function EmailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  function resize() {
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.body) {
        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
        setHeight(h + 16);
      }
    } catch { /* ignore cross-origin */ }
  }

  return (
    <iframe
      ref={ref}
      title="Email content"
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={resize}
      style={{ width: "100%", border: "none", height, display: "block" }}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 780, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  closeBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  closedTag: { padding: "4px 12px", background: "#f5f5f5", color: "#888", borderRadius: 8, fontSize: 12, fontWeight: 600 },
  threadCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", marginBottom: 16 },
  subject: { margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#1a3a5c" },
  threadMeta: { display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13, color: "#555", alignItems: "center" },
  replyBadge: { padding: "2px 9px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 8, fontSize: 12, fontWeight: 600 },
  msgCount: { color: "#aaa", fontSize: 12 },
  messages: { display: "flex", flexDirection: "column", gap: 14 },
  messageCard: { background: "#fff", border: "1px solid #e2e8f0", borderLeft: "4px solid #1a3a5c", borderRadius: "0 10px 10px 0", padding: "1.25rem", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" },
  engagement: { display: "flex", flexWrap: "wrap", gap: 12, margin: "0 0 10px", fontSize: 12 },
  engOpen: { color: "#1565c0", fontWeight: 600 },
  engClick: { color: "#2e7d32", fontWeight: 600 },
  msgHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  msgSender: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  inboundTag: { color: "#2e7d32" },
  msgMeta: { display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#888" },
  msgDate: { color: "#aaa" },
  msgSubject: { fontSize: 12, color: "#888", fontStyle: "italic", marginBottom: 8 },
  msgBody: { fontSize: 13, lineHeight: 1.7, color: "#333" },
  replyNote: { display: "flex", gap: 10, padding: "14px 16px", background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 10, fontSize: 13, color: "#1565c0", marginTop: 16, lineHeight: 1.6 },
};
