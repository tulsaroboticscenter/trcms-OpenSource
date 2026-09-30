import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, FileText, ChevronRight, PenLine, Layout, FileEdit, Users } from "lucide-react";
import { commsApi } from "../api";

export default function CommsDashboard() {
  const navigate = useNavigate();
  const [draftCount, setDraftCount] = useState<number | null>(null);
  useEffect(() => { commsApi.listDrafts().then((d) => setDraftCount(d.length)).catch(() => setDraftCount(null)); }, []);
  const tiles = [
    {
      title: "Compose New Email",
      desc: "Search for a member, visitor, or volunteer and send them a custom or template-based email.",
      icon: PenLine, color: "#2e7d32", path: "/communications/compose",
    },
    {
      title: draftCount ? `Drafts (${draftCount})` : "Drafts",
      desc: "Reopen an email you saved to finish later. Saved drafts are per-person.",
      icon: FileEdit, color: "#e65100", path: "/communications/compose?drafts=1",
    },
    {
      title: "Email Templates",
      desc: "Create and manage reusable email templates with variable substitution for visitors, members, volunteers, and more.",
      icon: FileText, color: "#1a3a5c", path: "/communications/templates",
    },
    {
      title: "Header & Footer Layouts",
      desc: "Create custom email header/footer designs and pick one when composing. Set a default that applies to every email.",
      icon: Layout, color: "#6a1b9a", path: "/communications/layouts",
    },
    {
      title: "Message History",
      desc: "View every email sent from Communications, across all recipients. Filter by team, program, or recipient type and open any thread.",
      icon: Mail, color: "#2e7d32", path: "/communications/history",
    },
    {
      title: "Mailing List",
      desc: "Volunteers and newsletter contacts who signed up from the public form without an account. Review the list, unsubscribe, or email them from Compose.",
      icon: Users, color: "#00838f", path: "/communications/mailing-list",
    },
  ];

  return (
    <div>
      <div style={styles.pageHeader}>
        <h1 style={styles.heading}>Communications</h1>
        <p style={styles.sub}>
          Send templated or custom emails directly from member and visitor profiles.
          All correspondence is logged in the profile's Communications panel.
        </p>
      </div>

      <div style={styles.grid}>
        {tiles.map(t => {
          const Icon = t.icon;
          return (
            <div
              key={t.title}
              style={{ ...styles.card, cursor: t.path ? "pointer" : "default" }}
              onClick={() => t.path && navigate(t.path)}
              onMouseEnter={e => t.path && (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")}
              onMouseLeave={e => t.path && (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)")}
            >
              <div style={{ ...styles.cardIcon, color: t.color }}><Icon size={28} /></div>
              <div style={styles.cardBody}>
                <div style={styles.cardTitle}>{t.title}</div>
                <div style={styles.cardDesc}>{t.desc}</div>
              </div>
              {t.path && <ChevronRight size={18} color="#ccc" style={{ flexShrink: 0, alignSelf: "center" }} />}
            </div>
          );
        })}
      </div>

      {/* How-to guide */}
      <div style={styles.howTo}>
        <h2 style={styles.howToTitle}>How to send an email</h2>
        <ol style={styles.steps}>
          <li><strong>Open a profile</strong> — navigate to any member or visitor profile.</li>
          <li><strong>Scroll to Communications</strong> — the panel is at the bottom of every profile.</li>
          <li><strong>Click Compose Email</strong> — optionally select a template, write your message, and preview it with real data.</li>
          <li><strong>Send</strong> — the email is sent and recorded in the thread history.</li>
        </ol>
        <div style={styles.smtpNote}>
          <strong>📡 SMTP not yet configured?</strong> The system will show a copy-paste preview of the email so you can send it manually from any email client.
          Configure TulsaConnect SMTP credentials in <code>backend/.env</code> to enable one-click sending.
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageHeader: { marginBottom: 24 },
  heading: { margin: 0, fontSize: 26, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#888", lineHeight: 1.6 },
  grid: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 },
  card: { display: "flex", alignItems: "flex-start", gap: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", transition: "box-shadow 0.15s" },
  cardIcon: { flexShrink: 0, marginTop: 2 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 700, color: "#1a3a5c", marginBottom: 4 },
  cardDesc: { fontSize: 13, color: "#666", lineHeight: 1.6 },
  cardNote: { fontSize: 11, color: "#aaa", marginTop: 4, fontStyle: "italic" },
  howTo: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem" },
  howToTitle: { margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  steps: { margin: "0 0 16px", paddingLeft: 20, fontSize: 14, lineHeight: 2, color: "#444" },
  smtpNote: { background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1565c0", lineHeight: 1.6 },
};
