import { useState, useEffect } from "react";
import { volunteerApi, type VolunteerIntro } from "../api";

/**
 * Public, no-login volunteer sign-up form — designed to be embedded on the
 * WordPress marketing site (tulsaroboticscenter.org) via an iframe. Renders bare,
 * with no app chrome.
 *
 * Two tracks:
 *   • Mailing list — just name + email, so we can keep them informed. No account.
 *   • Volunteer account — full contact + interests; creates a Volunteer member with a
 *     login, for someone starting the process of getting certified to work with youth.
 */
type Track = null | "list" | "account";

export default function VolunteerSignup() {
  const [data, setData] = useState<VolunteerIntro | null>(null);
  const [loading, setLoading] = useState(true);
  const [track, setTrack] = useState<Track>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [mailingList, setMailingList] = useState(true);
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    volunteerApi.intro().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);

  function set(k: string, v: string) { setF((p) => ({ ...p, [k]: v })); }
  function toggleInterest(name: string) {
    setInterests((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!f.first_name?.trim() || !f.last_name?.trim()) { setError("Please enter your first and last name."); return; }
    if (!f.email?.trim()) { setError("An email address is required."); return; }
    setSubmitting(true);
    try {
      const payload = { ...f, website, interests: Array.from(interests) };
      const res = track === "account"
        ? await volunteerApi.submit({ ...payload, mailing_list: mailingList })
        : await volunteerApi.subscribe(payload);
      setDone(res.message ?? "Thanks — you're all set!");
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string; error?: string } } };
      setError(e2?.response?.data?.detail ?? e2?.response?.data?.error ?? "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  if (loading) return <div style={st.wrap}><p style={st.muted}>Loading…</p></div>;
  if (!data) return <Shell><h2 style={st.h2}>Get Involved</h2><p style={st.muted}>We couldn't load the sign-up form right now. Please try again later.</p></Shell>;
  if (!data.open) return <Shell><h2 style={st.h2}>Get Involved</h2><p style={st.muted}>Sign-ups are closed right now. Please check back soon!</p></Shell>;
  if (done) return <Shell><h2 style={st.h2}>✓ Thank you!</h2><p style={st.lead}>{done}</p></Shell>;

  // Track chooser.
  if (track === null) {
    return (
      <Shell>
        <h2 style={st.h2}>Get involved with {data.org_name}</h2>
        {data.intro && <p style={st.lead}>{data.intro}</p>}
        <p style={st.lead}>How would you like to start?</p>
        <div style={st.choices}>
          <button type="button" style={st.choice} onClick={() => setTrack("list")}>
            <span style={st.choiceTitle}>Join our mailing list</span>
            <span style={st.choiceDesc}>Just share your email and we'll keep you posted about ways to help, events, and news. No account needed.</span>
          </button>
          <button type="button" style={{ ...st.choice, ...st.choicePrimary }} onClick={() => setTrack("account")}>
            <span style={st.choiceTitle}>Become a volunteer</span>
            <span style={st.choiceDesc}>Set up an account to start the process of getting certified to work with youth — help at events, mentor a team, and volunteer your time.</span>
          </button>
        </div>
      </Shell>
    );
  }

  const isAccount = track === "account";

  return (
    <Shell>
      <button type="button" style={st.back} onClick={() => { setTrack(null); setError(""); }}>← Back</button>
      <h2 style={st.h2}>{isAccount ? `Volunteer with ${data.org_name}` : "Join our mailing list"}</h2>
      <p style={st.lead}>
        {isAccount
          ? "Set up your volunteer account. We'll email your login and be in touch about getting certified to work with youth."
          : "Add your details and we'll keep you informed about volunteer opportunities and news. You can create a full volunteer account any time."}
      </p>
      <form onSubmit={submit}>
        <div style={st.grid}>
          <F label="First name *"><input style={st.in} value={f.first_name ?? ""} onChange={(e) => set("first_name", e.target.value)} /></F>
          <F label="Last name *"><input style={st.in} value={f.last_name ?? ""} onChange={(e) => set("last_name", e.target.value)} /></F>
          <F label="Email *"><input type="email" style={st.in} value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></F>
          <F label="Phone"><input style={st.in} value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></F>
          {isAccount && <F label="City"><input style={st.in} value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} /></F>}
          {isAccount && <F label="ZIP"><input style={st.in} value={f.zip_code ?? ""} onChange={(e) => set("zip_code", e.target.value)} /></F>}
        </div>

        {data.interests.length > 0 && (
          <>
            <h3 style={st.h3}>How would you like to help?</h3>
            <p style={st.hint}>Check any that interest you — optional, and you can change it later.</p>
            <div style={st.interests}>
              {data.interests.map((name) => (
                <label key={name} style={{ ...st.interest, ...(interests.has(name) ? st.interestOn : {}) }}>
                  <input type="checkbox" checked={interests.has(name)} onChange={() => toggleInterest(name)} />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {isAccount && (
          <>
            <h3 style={st.h3}>A little more (optional)</h3>
            <F label="When are you generally available?"><input style={st.in} value={f.availability ?? ""} onChange={(e) => set("availability", e.target.value)} placeholder="e.g. weekday evenings, Saturday mornings" /></F>
          </>
        )}
        <F label="How did you hear about us?"><input style={st.in} value={f.how_heard ?? ""} onChange={(e) => set("how_heard", e.target.value)} /></F>
        <F label="Anything you'd like us to know?"><textarea style={st.ta} value={f.comments ?? ""} onChange={(e) => set("comments", e.target.value)} /></F>

        {isAccount && (
          <label style={st.check}>
            <input type="checkbox" checked={mailingList} onChange={(e) => setMailingList(e.target.checked)} />
            Also add me to the volunteer mailing list so I hear about opportunities and news.
          </label>
        )}

        {/* Honeypot — hidden from humans */}
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} aria-hidden="true" />

        {error && <div style={st.err}>{error}</div>}
        <button type="submit" style={{ ...st.submit, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
          {submitting ? "Submitting…" : isAccount ? "Create my volunteer account" : "Add me to the mailing list"}
        </button>
        <p style={st.fineprint}>Your information is used only to coordinate volunteering and is not sold or shared.</p>
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
  muted: { color: "#888", fontSize: 14 },
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  choices: { display: "grid", gap: 12, marginTop: 6 },
  choice: { display: "flex", flexDirection: "column", gap: 4, textAlign: "left", border: "1px solid #cdd7e3", borderRadius: 10, padding: "16px 18px", cursor: "pointer", background: "#fff" },
  choicePrimary: { borderColor: "#1565c0", background: "#f3f8ff" },
  choiceTitle: { fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  choiceDesc: { fontSize: 13, color: "#556", lineHeight: 1.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px 14px", marginBottom: 6 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  in: { width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  ta: { width: "100%", minHeight: 56, padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: 14, resize: "vertical", boxSizing: "border-box" },
  interests: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 8 },
  interest: { display: "flex", gap: 9, alignItems: "flex-start", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 12px", cursor: "pointer", fontSize: 13.5, color: "#334", lineHeight: 1.35 },
  interestOn: { borderColor: "#1565c0", background: "#f3f8ff" },
  check: { display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13.5, color: "#334", margin: "14px 0 4px", cursor: "pointer", lineHeight: 1.4 },
  err: { background: "#fdecea", border: "1px solid #f5c2c0", color: "#c62828", borderRadius: 8, padding: "10px 13px", fontSize: 13.5, margin: "14px 0" },
  submit: { width: "100%", padding: "13px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 16, marginTop: 16 },
  fineprint: { fontSize: 11.5, color: "#99a", textAlign: "center", marginTop: 10 },
};
