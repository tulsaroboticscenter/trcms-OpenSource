/**
 * ClassroomEmailReadinessReport — Phase 0 of the Google Classroom integration.
 * Before we can auto-mark certifications earned from Classroom grades, we have to
 * match TRCMS members to Classroom students by email. This report surfaces the
 * gaps: members with no email, emails off the Workspace domain, and duplicates.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { reportsApi, type ClassroomEmailReadiness, type ClassroomEmailMember } from "../api";
import { ArrowLeft, GraduationCap, MailWarning, MailX, Copy, CheckCircle } from "lucide-react";

export default function ClassroomEmailReadinessReport() {
  const navigate = useNavigate();
  const [domain, setDomain] = useState("tulsaroboticscenter.org");
  const [data, setData] = useState<ClassroomEmailReadiness | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((d: string) => {
    setLoading(true);
    reportsApi.getClassroomEmailReadiness(d).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(domain); }, [load]); // initial

  const pct = (n: number) => (data && data.total ? Math.round((n / data.total) * 100) : 0);

  return (
    <div style={s.page}>
      <button style={s.back} onClick={() => navigate("/reports")}><ArrowLeft size={14} /> Reports</button>
      <div style={s.head}>
        <h1 style={s.h1}><GraduationCap size={22} /> Classroom Email Readiness</h1>
        <div style={s.domainRow}>
          <label style={s.domainLbl}>Workspace domain</label>
          <input style={s.domainIn} value={domain} onChange={(e) => setDomain(e.target.value)} />
          <button style={s.loadBtn} onClick={() => load(domain)}>Check</button>
        </div>
      </div>
      <p style={s.sub}>
        A pre-check for the Google Classroom integration: members are matched to Classroom students by email.
        This shows which active youth &amp; mentors would match cleanly and which need attention first.
      </p>

      {loading ? <p style={s.muted}>Loading…</p> : !data ? <p style={s.muted}>Couldn’t load the report.</p> : (
        <>
          <div style={s.cards}>
            <Stat label="Active youth & mentors" value={data.total} color="#1a3a5c" icon={<GraduationCap size={16} />} />
            <Stat label={`On ${data.workspace_domain}`} value={data.on_domain_count} sub={`${pct(data.on_domain_count)}%`} color="#2e7d32" icon={<CheckCircle size={16} />} />
            <Stat label="Off-domain email" value={data.off_domain_count} sub={`${pct(data.off_domain_count)}%`} color="#e65100" icon={<MailWarning size={16} />} />
            <Stat label="No email on file" value={data.missing_email_count} sub={`${pct(data.missing_email_count)}%`} color="#c62828" icon={<MailX size={16} />} />
            <Stat label="Duplicate emails" value={data.duplicate_count} color="#6a1b9a" icon={<Copy size={16} />} />
          </div>

          <div style={s.note}>
            <strong>How to read this:</strong> Members <em>on</em> {data.workspace_domain} match automatically. Off-domain
            emails (personal Gmail, school accounts) still match <em>if</em> that exact address is the one they log into
            Classroom with — worth spot-checking. Members with no email can’t be matched until one is added, and duplicate
            emails must be resolved so a Classroom student maps to a single member.
          </div>

          {data.domains.length > 0 && (
            <Section title="Email domains">
              <div style={s.domainBars}>
                {data.domains.map((d) => (
                  <div key={d.domain} style={s.domainBarRow}>
                    <span style={s.domainName}>{d.domain}</span>
                    <div style={s.barTrack}><div style={{ ...s.barFill, width: `${pct(d.count)}%`, background: d.domain === data.workspace_domain ? "#2e7d32" : "#90a4ae" }} /></div>
                    <span style={s.domainCount}>{d.count}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {data.duplicates.length > 0 && (
            <Section title={`Duplicate emails (${data.duplicates.length})`}>
              {data.duplicates.map((g) => (
                <div key={g.email} style={s.dupRow}>
                  <span style={s.dupEmail}>{g.email}</span>
                  <span style={s.dupMembers}>{g.members.map((m) => m.name).join(", ")}</span>
                </div>
              ))}
            </Section>
          )}

          {data.missing_email.length > 0 && (
            <MemberSection title={`No email on file (${data.missing_email.length})`} members={data.missing_email} navigate={navigate} showEmail={false} />
          )}
          {data.off_domain.length > 0 && (
            <MemberSection title={`Off-domain email (${data.off_domain.length})`} members={data.off_domain} navigate={navigate} showEmail />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color, icon }: { label: string; value: number; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div style={s.stat}>
      <div style={{ ...s.statIcon, color }}>{icon}</div>
      <div style={{ ...s.statVal, color }}>{value}{sub && <span style={s.statSub}> · {sub}</span>}</div>
      <div style={s.statLbl}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={s.section}><div style={s.sectionHead}>{title}</div>{children}</div>;
}

function MemberSection({ title, members, navigate, showEmail }: {
  title: string; members: ClassroomEmailMember[]; navigate: (p: string) => void; showEmail: boolean;
}) {
  return (
    <Section title={title}>
      <div style={s.memberList}>
        {members.map((m) => (
          <button key={m.id} style={s.memberRow} onClick={() => navigate(`/members/${m.id}`)}>
            <span style={s.memberName}>{m.name}</span>
            <span style={s.memberType}>{m.member_type}</span>
            {showEmail && <span style={s.memberEmail}>{m.email}</span>}
          </button>
        ))}
      </div>
    </Section>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  domainRow: { display: "flex", alignItems: "center", gap: 6 },
  domainLbl: { fontSize: 12, color: "#667" },
  domainIn: { padding: "7px 9px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, width: 200 },
  loadBtn: { padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  sub: { color: "#667", fontSize: 14, margin: "6px 0 16px", lineHeight: 1.5 },
  muted: { color: "#888", fontSize: 14 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 },
  stat: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", textAlign: "center" },
  statIcon: { display: "flex", justifyContent: "center", marginBottom: 4 },
  statVal: { fontSize: 24, fontWeight: 800 },
  statSub: { fontSize: 13, fontWeight: 600, opacity: 0.7 },
  statLbl: { fontSize: 11.5, color: "#667", marginTop: 2 },
  note: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, color: "#556", lineHeight: 1.55, marginBottom: 16 },
  section: { marginBottom: 16, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  sectionHead: { fontSize: 13.5, fontWeight: 800, color: "#1a3a5c", marginBottom: 8 },
  domainBars: { display: "flex", flexDirection: "column", gap: 6 },
  domainBarRow: { display: "flex", alignItems: "center", gap: 10 },
  domainName: { width: 190, fontSize: 12.5, color: "#2a3f55", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  barTrack: { flex: 1, height: 10, background: "#eef1f5", borderRadius: 5, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 5 },
  domainCount: { width: 34, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: "#455a64" },
  dupRow: { display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid #f3f6f9", fontSize: 13 },
  dupEmail: { fontWeight: 700, color: "#6a1b9a", minWidth: 220 },
  dupMembers: { color: "#556" },
  memberList: { display: "flex", flexDirection: "column", gap: 4 },
  memberRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: "#f8fafc", border: "1px solid #eef2f6", borderRadius: 7, cursor: "pointer", textAlign: "left" },
  memberName: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", flex: 1 },
  memberType: { fontSize: 11, color: "#889", textTransform: "capitalize" },
  memberEmail: { fontSize: 12, color: "#667", minWidth: 200, textAlign: "right" },
};
