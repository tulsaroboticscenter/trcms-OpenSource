import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Clock, Printer, MapPin, ChevronRight, Users, ExternalLink } from "lucide-react";
import { volunteeringApi, type Opportunities, type MyHours, type OpportunityEvent } from "../api";

/**
 * "My Volunteering" — a self-service page for volunteers, mentors and parents to find
 * opportunities and report the time they've given. Gated on volunteering.view.
 */
type Tab = "opportunities" | "hours";

function fmtDate(d?: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  if (!y) return d;
  return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtHours(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Colored bubble for the volunteer's own RSVP status on an opportunity.
function rsvpStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, borderRadius: 10, padding: "3px 10px", whiteSpace: "nowrap" };
  const s = status.toLowerCase();
  if (s === "attending") return { ...base, color: "#2e7d32", background: "#e8f5e9" };
  if (s === "maybe") return { ...base, color: "#b26a00", background: "#fff3e0" };
  if (s.includes("not")) return { ...base, color: "#c62828", background: "#fdecea" };
  return { ...base, color: "#1565c0", background: "#e7f0fb" };
}

export default function MyVolunteering() {
  const [tab, setTab] = useState<Tab>("opportunities");
  return (
    <div style={st.wrap}>
      <div className="no-print">
        <h1 style={st.h1}>My Volunteering</h1>
        <p style={st.sub}>Find ways to help, and track the time you've given.</p>
        <div style={st.tabs}>
          <button style={tab === "opportunities" ? st.tabOn : st.tab} onClick={() => setTab("opportunities")}>
            <CalendarDays size={15} /> Opportunities
          </button>
          <button style={tab === "hours" ? st.tabOn : st.tab} onClick={() => setTab("hours")}>
            <Clock size={15} /> My Hours
          </button>
        </div>
      </div>
      {tab === "opportunities" ? <OpportunitiesTab /> : <HoursTab />}
    </div>
  );
}

function OpportunitiesTab() {
  const navigate = useNavigate();
  const [data, setData] = useState<Opportunities | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { volunteeringApi.opportunities().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); }, []);

  if (loading) return <p style={st.muted}>Loading…</p>;
  if (!data) return <p style={st.muted}>We couldn't load opportunities right now.</p>;

  const Card = ({ e }: { e: OpportunityEvent }) => (
    <div style={st.oppCard}>
      <div style={st.oppHead}>
        <div style={st.evMain}>
          <span style={st.evName}>{e.name}</span>
          <span style={st.evMeta}>
            {fmtDate(e.event_date)}{e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ""}
            {e.location ? <> · <MapPin size={11} style={{ verticalAlign: -1 }} /> {e.location}</> : null}
          </span>
        </div>
        {e.my_rsvp
          ? <span style={rsvpStyle(e.my_rsvp)}>{e.my_rsvp}</span>
          : (e.im_signed_up
              ? <span style={st.signedTag}>You're signed up</span>
              : (e.has_slots && e.open_slots ? <span style={st.openTag}>{e.open_slots} open {e.open_slots === 1 ? "spot" : "spots"}</span> : null))}
      </div>
      {e.signup_note && <p style={st.oppNote}>{e.signup_note}</p>}
      <div style={st.oppActions}>
        <button style={st.actInternal} onClick={() => navigate(`/events/${e.id}`)}>
          Sign up through us <ChevronRight size={14} style={{ verticalAlign: -2 }} />
        </button>
        {e.signup_url && (
          <a style={st.actExternal} href={e.signup_url} target="_blank" rel="noopener noreferrer">
            External sign-up <ExternalLink size={13} style={{ verticalAlign: -2 }} />
          </a>
        )}
      </div>
    </div>
  );

  return (
    <div className="no-print">
      <div style={st.sectionH}><Users size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Volunteer opportunities</div>
      {data.events.length === 0
        ? <p style={st.muted}>No volunteer opportunities are open right now — check back soon.</p>
        : data.events.map((e) => <Card key={e.id} e={e} />)}
    </div>
  );
}

function HoursTab() {
  const [data, setData] = useState<MyHours | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { volunteeringApi.myHours().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); }, []);

  if (loading) return <p style={st.muted}>Loading…</p>;
  if (!data) return <p style={st.muted}>We couldn't load your hours right now.</p>;

  const generated = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <div style={st.hoursBar} className="no-print">
        <div style={st.muted}>{data.events.length} {data.events.length === 1 ? "event" : "events"} · {fmtHours(data.total_minutes)} total</div>
        <button style={st.printBtn} onClick={() => window.print()}><Printer size={15} /> Print report</button>
      </div>

      {/* This block is the printable statement. */}
      <div className="vol-print" style={st.report}>
        <div style={st.reportHead}>
          <div>
            <div style={st.reportOrg}>{data.org_name}</div>
            <div style={st.reportTitle}>Volunteer Hours Statement</div>
          </div>
          <div style={st.reportMeta}>
            <div><strong>{data.member_name}</strong></div>
            <div style={st.muted}>Generated {generated}</div>
          </div>
        </div>

        {data.events.length === 0 && data.other_minutes === 0 && (data.checkin_minutes ?? 0) === 0 ? (
          <p style={st.muted}>No volunteer time has been recorded yet.</p>
        ) : (
          <table style={st.table}>
            <thead>
              <tr><th style={st.th}>Event</th><th style={st.th}>Date</th><th style={{ ...st.th, textAlign: "right" }}>Hours</th></tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.event_id}>
                  <td style={st.td}>{e.name}{e.location ? <span style={st.tdSub}> · {e.location}</span> : null}</td>
                  <td style={st.td}>{fmtDate(e.event_date)}</td>
                  <td style={{ ...st.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtHours(e.minutes)}</td>
                </tr>
              ))}
              {data.other_minutes > 0 && (
                <tr>
                  <td style={st.td}>Other volunteer time <span style={st.tdSub}>(not tied to a specific event)</span></td>
                  <td style={st.td}>—</td>
                  <td style={{ ...st.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtHours(data.other_minutes)}</td>
                </tr>
              )}
              {(data.checkin_minutes ?? 0) > 0 && (
                <tr>
                  <td style={st.td}>Check-in time <span style={st.tdSub}>(present but not classified — tag it on My Time to categorize)</span></td>
                  <td style={st.td}>—</td>
                  <td style={{ ...st.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtHours(data.checkin_minutes)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={st.totalTd} colSpan={2}>Total volunteer time</td>
                <td style={{ ...st.totalTd, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtHours(data.total_minutes)} ({data.total_hours} hrs)</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p style={st.reportFoot}>This statement reflects time recorded in {data.org_name}'s program management system.</p>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .vol-print, .vol-print * { visibility: visible !important; }
          .vol-print { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 820, margin: "0 auto" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c" },
  sub: { margin: "4px 0 14px", fontSize: 13, color: "#889" },
  tabs: { display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #e2e8f0" },
  tab: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", borderBottom: "2px solid transparent", color: "#667", fontSize: 14, fontWeight: 600, padding: "8px 10px", cursor: "pointer", marginBottom: -1 },
  tabOn: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", borderBottom: "2px solid #1a3a5c", color: "#1a3a5c", fontSize: 14, fontWeight: 700, padding: "8px 10px", cursor: "pointer", marginBottom: -1 },
  section: { marginBottom: 20 },
  sectionH: { fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 8 },
  muted: { color: "#889", fontSize: 13.5, margin: "4px 0" },
  oppCard: { background: "#fff", border: "1px solid #e8edf3", borderRadius: 10, padding: "14px 16px", marginBottom: 10 },
  oppHead: { display: "flex", alignItems: "flex-start", gap: 12 },
  oppNote: { fontSize: 13, color: "#445", lineHeight: 1.55, margin: "8px 0 0", whiteSpace: "pre-wrap" },
  oppActions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 },
  actInternal: { display: "inline-flex", alignItems: "center", gap: 4, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  actExternal: { display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, textDecoration: "none" },
  evMain: { flex: 1, minWidth: 0 },
  evName: { display: "block", fontSize: 14.5, fontWeight: 600, color: "#1a3a5c" },
  evMeta: { display: "block", fontSize: 12.5, color: "#778", marginTop: 2 },
  openTag: { fontSize: 11.5, fontWeight: 700, color: "#2e7d32", background: "#e8f5e9", borderRadius: 10, padding: "3px 9px", whiteSpace: "nowrap" },
  signedTag: { fontSize: 11.5, fontWeight: 700, color: "#1565c0", background: "#e7f0fb", borderRadius: 10, padding: "3px 9px", whiteSpace: "nowrap" },
  hoursBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  printBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  report: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.75rem" },
  reportHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", borderBottom: "2px solid #1a3a5c", paddingBottom: 12, marginBottom: 14 },
  reportOrg: { fontSize: 13, fontWeight: 700, color: "#1565c0", textTransform: "uppercase", letterSpacing: 0.5 },
  reportTitle: { fontSize: 22, fontWeight: 800, color: "#1a3a5c", marginTop: 2 },
  reportMeta: { textAlign: "right", fontSize: 13.5, color: "#33475b" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  th: { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0" },
  td: { padding: "9px 10px", color: "#243", borderBottom: "1px solid #f1f4f8", verticalAlign: "top" },
  tdSub: { color: "#8895a3", fontSize: 12.5 },
  totalTd: { padding: "12px 10px", fontWeight: 800, color: "#1a3a5c", fontSize: 14.5, borderTop: "2px solid #1a3a5c" },
  reportFoot: { fontSize: 11.5, color: "#99a", marginTop: 14, fontStyle: "italic" },
};
