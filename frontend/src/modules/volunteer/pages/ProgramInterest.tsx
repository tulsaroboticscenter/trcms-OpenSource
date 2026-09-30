import { useState } from "react";
import { volunteerApi } from "../api";

/**
 * Public, no-login "join our mailing list" form for families interested in summer
 * camps and program opportunities. Designed for a printed QR code / a direct link on
 * the marketing site — renders bare, with no app chrome, and works standalone or in an
 * iframe. Posts to /public/program-interest (source = "program_interest"); it is NOT
 * gated by the volunteer sign-up toggle, so the QR code keeps working year-round.
 */
const ORG = "Tulsa Robotics Center";

const PROGRAMS = [
  "Summer camps",
  "FIRST LEGO League Explore (ages 6–9)",
  "FIRST LEGO League Challenge (grades 4–8)",
  "Competitive robotics teams (FTC / FRC)",
  "Workshops & community events",
  "Homeschool programs",
];

export default function ProgramInterest() {
  const [f, setF] = useState<Record<string, string>>({});
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  function set(k: string, v: string) { setF((p) => ({ ...p, [k]: v })); }
  function toggle(name: string) {
    setInterests((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!f.first_name?.trim() || !f.last_name?.trim()) { setError("Please enter your first and last name."); return; }
    if (!f.email?.trim()) { setError("An email address is required."); return; }
    setSubmitting(true);
    try {
      // Fold the optional "child's grade(s)" into comments so it lands in the note.
      const comments = [f.child_grades?.trim() ? `Child's grade(s): ${f.child_grades.trim()}` : "", f.comments?.trim() ?? ""]
        .filter(Boolean).join("\n");
      const res = await volunteerApi.programInterest({
        first_name: f.first_name, last_name: f.last_name, email: f.email, phone: f.phone,
        interests: Array.from(interests), comments, how_heard: f.how_heard, website,
      });
      setDone(res.message ?? "Thanks — you're all set!");
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string; error?: string } } };
      setError(e2?.response?.data?.detail ?? e2?.response?.data?.error ?? "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  if (done) return (
    <Shell>
      <h2 style={st.h2}>✓ Thank you!</h2>
      <p style={st.lead}>{done}</p>
      <p style={st.hint}>You can close this page. We won't share your information, and every email has an easy way to unsubscribe.</p>
    </Shell>
  );

  return (
    <Shell>
      <h2 style={st.h2}>Stay in the loop with {ORG}</h2>
      <p style={st.lead}>
        Join our mailing list and we'll let you know about <strong>summer camps</strong>, robotics programs,
        workshops, and other ways your family can get involved. No account needed.
      </p>
      <form onSubmit={submit}>
        <div style={st.grid}>
          <F label="First name *"><input style={st.in} value={f.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></F>
          <F label="Last name *"><input style={st.in} value={f.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></F>
          <F label="Email *"><input type="email" style={st.in} value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></F>
          <F label="Phone (optional)"><input style={st.in} value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></F>
          <F label="Child's grade(s) (optional)"><input style={st.in} value={f.child_grades ?? ""} onChange={(e) => set("child_grades", e.target.value)} placeholder="e.g. 3rd and 6th" /></F>
        </div>

        <h3 style={st.h3}>What are you interested in?</h3>
        <p style={st.hint}>Check any that interest you — optional, and it just helps us send you the right news.</p>
        <div style={st.interests}>
          {PROGRAMS.map((name) => (
            <label key={name} style={{ ...st.interest, ...(interests.has(name) ? st.interestOn : {}) }}>
              <input type="checkbox" checked={interests.has(name)} onChange={() => toggle(name)} />
              <span>{name}</span>
            </label>
          ))}
        </div>

        <F label="Anything you'd like us to know? (optional)">
          <textarea style={st.ta} value={f.comments ?? ""} onChange={(e) => set("comments", e.target.value)} />
        </F>

        {/* Honeypot — hidden from humans */}
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} aria-hidden="true" />

        {error && <div style={st.err}>{error}</div>}
        <button type="submit" style={{ ...st.submit, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
          {submitting ? "Submitting…" : "Add me to the mailing list"}
        </button>
        <p style={st.fineprint}>Your information is used only to keep you informed about our programs. We never sell or share it, and you can unsubscribe any time.</p>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={st.wrap}><div style={st.card}>{children}</div></div>;
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.lbl}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 680, margin: "0 auto", padding: "16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a2733" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  h2: { margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  h3: { margin: "22px 0 8px", fontSize: 15, fontWeight: 700, color: "#1a3a5c", borderBottom: "2px solid #eef2f7", paddingBottom: 5 },
  lead: { fontSize: 14, color: "#445", lineHeight: 1.6, margin: "0 0 10px" },
  hint: { fontSize: 12.5, color: "#889", margin: "0 0 8px" },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px 14px", marginBottom: 6 },
  in: { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  ta: { width: "100%", minHeight: 56, padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, resize: "vertical", boxSizing: "border-box" },
  interests: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 },
  interest: { display: "flex", gap: 9, alignItems: "flex-start", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 12px", cursor: "pointer", fontSize: 13.5, color: "#334", lineHeight: 1.35 },
  interestOn: { borderColor: "#1565c0", background: "#f3f8ff" },
  err: { background: "#fdecea", border: "1px solid #f5c2c0", color: "#c62828", borderRadius: 8, padding: "10px 13px", fontSize: 13.5, margin: "14px 0" },
  submit: { width: "100%", padding: "13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 16, marginTop: 16 },
  fineprint: { fontSize: 11.5, color: "#99a", textAlign: "center", marginTop: 10 },
};
