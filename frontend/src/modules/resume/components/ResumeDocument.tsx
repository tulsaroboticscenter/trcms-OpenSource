/**
 * The rendered one-page resume. Two jobs:
 *   - preview inside the builder (what the youth sees as they fill it in)
 *   - the print target — the print stylesheet (see ResumeBuilder) hides everything on
 *     the page except the element with class "resume-print-area", so this component is
 *     what lands on the PDF when the youth uses their browser's Print → Save as PDF.
 *
 * Contact info is name / grade / school / TRC email only — these are minors, so no home
 * address or personal phone ever appears, and the email is opt-in via show_contact.
 */
import type { ResumeData, ResumeAnswers } from "../api";

/** A resume section is only rendered when it has content, so the page stays tight. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={rs.section}>
      <h2 style={rs.h2}>{title}</h2>
      {children}
    </section>
  );
}

/** Split a textarea answer into lines so multi-item answers read as a list. */
function lines(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function has(a: ResumeAnswers, k: string): boolean {
  const v = a[k];
  return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
}

export default function ResumeDocument({ data }: { data: ResumeData }) {
  const a = data.answers;
  const p = data.pulled;
  const objective = (a.objective as string) || "";

  const contactBits = [
    p.grade_label,
    p.school,
    data.show_contact ? p.email : null,
  ].filter(Boolean);

  return (
    <div className="resume-print-area" style={rs.page}>
      {/* Header — name + contact line */}
      <header style={rs.header}>
        <h1 style={rs.name}>{p.name}</h1>
        {contactBits.length > 0 && (
          <div style={rs.contact}>{contactBits.join("  ·  ")}</div>
        )}
      </header>

      {objective.trim() && <p style={rs.objective}>{objective.trim()}</p>}

      {/* Robotics snapshot — pulled facts, always meaningful for our youth */}
      {(p.teams.length > 0 || p.first_seasons_count > 0 || has(a, "experience_years")) && (
        <Section title="FIRST Robotics">
          <ul style={rs.list}>
            {has(a, "experience_years") && (
              <li style={rs.li}>{a.experience_years as string} year(s) of robotics experience{p.first_seasons_count ? ` · ${p.first_seasons_count} FIRST season(s)` : ""}</li>
            )}
            {p.teams.map((t, i) => (
              <li key={i} style={rs.li}>{t.team} <span style={rs.dim}>({t.season})</span></li>
            ))}
            {has(a, "positions") && (
              <li style={rs.li}><strong>Seeking:</strong> {(a.positions as string[]).join(", ")}</li>
            )}
          </ul>
        </Section>
      )}

      {has(a, "skills") && (
        <Section title="Skills">
          <div style={rs.chips}>
            {(a.skills as string[]).map((sk) => (
              <span key={sk} style={rs.chip}>{sk}</span>
            ))}
          </div>
        </Section>
      )}

      {p.certifications.length > 0 && (
        <Section title="Certifications">
          <div style={rs.chips}>
            {p.certifications.map((c) => <span key={c} style={rs.chip}>{c}</span>)}
          </div>
        </Section>
      )}

      {has(a, "leadership") && (
        <Section title="Leadership">
          <ul style={rs.list}>{lines(a.leadership).map((l, i) => <li key={i} style={rs.li}>{l}</li>)}</ul>
        </Section>
      )}

      {(has(a, "awards_robotics") || has(a, "awards_other")) && (
        <Section title="Awards & Honors">
          <ul style={rs.list}>
            {lines(a.awards_robotics).map((l, i) => <li key={`r${i}`} style={rs.li}>{l}</li>)}
            {lines(a.awards_other).map((l, i) => <li key={`o${i}`} style={rs.li}>{l}</li>)}
          </ul>
        </Section>
      )}

      {has(a, "projects") && (
        <Section title="Projects">
          <ul style={rs.list}>{lines(a.projects).map((l, i) => <li key={i} style={rs.li}>{l}</li>)}</ul>
        </Section>
      )}

      {(has(a, "community") || has(a, "outreach")) && (
        <Section title="Community & Outreach">
          <ul style={rs.list}>
            {lines(a.community).map((l, i) => <li key={`c${i}`} style={rs.li}>{l}</li>)}
            {lines(a.outreach).map((l, i) => <li key={`u${i}`} style={rs.li}>{l}</li>)}
          </ul>
        </Section>
      )}

      {(has(a, "organizations") || has(a, "languages") || has(a, "gpa") || has(a, "colleges")) && (
        <Section title="Education & Activities">
          <ul style={rs.list}>
            {has(a, "gpa") && <li style={rs.li}><strong>GPA:</strong> {a.gpa as string}</li>}
            {lines(a.organizations).map((l, i) => <li key={`g${i}`} style={rs.li}>{l}</li>)}
            {has(a, "languages") && <li style={rs.li}><strong>Languages:</strong> {(a.languages as string)}</li>}
            {has(a, "colleges") && <li style={rs.li}><strong>Interested in:</strong> {(a.colleges as string)}</li>}
          </ul>
        </Section>
      )}
    </div>
  );
}

const rs: Record<string, React.CSSProperties> = {
  page: {
    background: "#fff", color: "#1a2634", width: "100%", maxWidth: 760,
    margin: "0 auto", padding: "34px 40px", boxSizing: "border-box",
    fontFamily: "'Georgia', 'Times New Roman', serif", fontSize: 12.5, lineHeight: 1.4,
  },
  header: { borderBottom: "2px solid #1a2634", paddingBottom: 8, marginBottom: 12 },
  name: { fontSize: 26, fontWeight: 700, letterSpacing: 0.5, margin: 0, fontFamily: "'Georgia', serif" },
  contact: { fontSize: 12, color: "#43536b", marginTop: 4, fontFamily: "'Helvetica Neue', Arial, sans-serif" },
  objective: { fontStyle: "italic", color: "#33475b", margin: "0 0 14px", fontSize: 12.5 },
  section: { marginBottom: 12, breakInside: "avoid" },
  h2: {
    fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
    color: "#0b5c4f", borderBottom: "1px solid #cfd8e0", paddingBottom: 2, marginBottom: 6,
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  list: { margin: 0, paddingLeft: 18 },
  li: { marginBottom: 2 },
  dim: { color: "#7a8899", fontSize: 11.5 },
  chips: { display: "flex", flexWrap: "wrap", gap: 5 },
  chip: {
    fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11,
    background: "#eef4f2", color: "#0b5c4f", borderRadius: 3, padding: "2px 8px",
  },
};
