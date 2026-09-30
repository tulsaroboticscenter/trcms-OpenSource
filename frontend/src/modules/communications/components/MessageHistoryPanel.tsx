/**
 * MessageHistoryPanel
 * ===================
 * Embedded in member profiles, visitor detail pages, and any future contact profiles.
 * Shows all email threads for this contact with date, sender, subject, and status.
 * Clicking a subject opens the full ThreadView.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { commsApi, type ThreadSummary } from "../api";
import ComposeModal from "./ComposeModal";
import { Mail, PlusCircle, ChevronRight, CheckCircle, AlertTriangle, Clock } from "lucide-react";

interface Props {
  recipientType: "member" | "visitor" | "volunteer" | "sponsor";
  recipientId: number;
  recipientName: string;
  recipientEmail?: string;
  /** Set false to hide the Compose button (e.g. on member profiles viewed by the member themselves) */
  showCompose?: boolean;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  sent: <CheckCircle size={12} color="#2e7d32" />,
  failed: <AlertTriangle size={12} color="#c62828" />,
  draft: <Clock size={12} color="#888" />,
};

export default function MessageHistoryPanel({
  recipientType, recipientId, recipientName, recipientEmail, showCompose = true,
}: Props) {
  const navigate = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const canSend = showCompose && (isAdmin || hasRole("Admin", "System Administrator", "Mentor"));

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => { load(); }, [recipientId]);

  async function load() {
    setLoading(true);
    commsApi.getRecipientThreads(recipientType, recipientId)
      .then(setThreads)
      .finally(() => setLoading(false));
  }

  function fmtDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return (
    <>
      {/* Compose button */}
      {canSend && (
        <div style={styles.composeRow}>
          <button style={styles.composeBtn} onClick={() => setComposeOpen(true)}>
            <PlusCircle size={13} /> Compose Email
          </button>
        </div>
      )}

      {loading && <p style={styles.muted}>Loading…</p>}

      {!loading && threads.length === 0 && (
        <p style={styles.muted}>No email history yet.</p>
      )}

      {!loading && threads.length > 0 && (
        <div style={styles.list}>
          {threads.map(t => (
            <div
              key={t.id}
              style={styles.row}
              onClick={() => navigate(`/communications/threads/${t.id}`)}
              onMouseEnter={e => (e.currentTarget.style.background = "#f0f4f8")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
            >
              <div style={styles.iconCol}>
                <Mail size={14} color="#1a3a5c" />
              </div>
              <div style={styles.info}>
                <div style={styles.subject}>{t.subject}</div>
                <div style={styles.meta}>
                  {t.last_sender ?? "System"} · {fmtDate(t.last_message_at)}
                  {t.message_count > 1 && (
                    <span style={styles.countBadge}>{t.message_count}</span>
                  )}
                  {t.reply_enabled && (
                    <span style={styles.replyTag}>replies on</span>
                  )}
                </div>
              </div>
              <div style={styles.statusCol}>
                {t.last_status && STATUS_ICON[t.last_status]}
              </div>
              <ChevronRight size={13} color="#ccc" />
            </div>
          ))}
        </div>
      )}

      {composeOpen && (
        <ComposeModal
          recipientType={recipientType}
          recipientId={recipientId}
          recipientName={recipientName}
          recipientEmail={recipientEmail}
          onClose={() => setComposeOpen(false)}
          onSent={load}
        />
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  composeRow: { display: "flex", justifyContent: "flex-end", marginBottom: 10 },
  composeBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  list: { display: "flex", flexDirection: "column", gap: 2 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 7, cursor: "pointer", background: "#fff", border: "1px solid #f0f4f8", transition: "background 0.1s" },
  iconCol: { flexShrink: 0 },
  info: { flex: 1, minWidth: 0 },
  subject: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  meta: { fontSize: 11, color: "#aaa", marginTop: 2, display: "flex", alignItems: "center", gap: 6 },
  countBadge: { background: "#e3f2fd", color: "#1565c0", borderRadius: 10, padding: "0 6px", fontSize: 10, fontWeight: 700 },
  replyTag: { background: "#e8f5e9", color: "#2e7d32", borderRadius: 6, padding: "0 5px", fontSize: 10 },
  statusCol: { flexShrink: 0 },
};
