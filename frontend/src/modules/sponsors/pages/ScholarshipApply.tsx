import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, ArrowLeft, Check } from "lucide-react";
import { scholarshipsApi, type NewApplication, type ApplicationPrefill, type PrefillYouth } from "../scholarshipsApi";
import { gradeFromGradYear, gradeLabel } from "../../../core/grade";

const PROGRAMS = [
  { v: "FLL", label: "FLL — FIRST LEGO League (2nd–8th grade)" },
  { v: "FTC", label: "FTC — FIRST Tech Challenge (8th–12th grade)" },
  { v: "FRC", label: "FRC — FIRST Robotics Challenge (9th–12th grade)" },
  { v: "Other", label: "Other" },
];

/** Map an enrolled program name (FLLe, FLLc, FTC, FRC, FDP) onto a form option. */
function programOption(name: string | null): string {
  const n = (name ?? "").toUpperCase();
  if (n.startsWith("FLL")) return "FLL";
  if (n.startsWith("FTC")) return "FTC";
  if (n.startsWith("FRC")) return "FRC";
  return n ? "Other" : "";
}

/**
 * "10th grade at Jenks High School" — whatever we actually know. The form asks for
 * the grade IN THE FALL, so the grade is reckoned against the enrollment season.
 */
function gradeSchool(y: PrefillYouth, seasonYear: number): string {
  const g = y.graduation_year ? gradeLabel(gradeFromGradYear(y.graduation_year, seasonYear)) : "";
  if (g && y.school) return `${g} at ${y.school}`;
  return g || y.school || "";
}

const CATEGORIES = [
  "Needs-Based — Youth is non-member or new to TRC",
  "Needs-Based — Youth is a current member of TRC",
  "Needs-Based — Youth has been a member of TRC for more than 1 year",
];

/**
 * Tulsa Robotics Center Scholarship Application (rebuilt from the Google Form).
 * One application per youth. Self-certified — no document uploads.
 */
export default function ScholarshipApply() {
  const navigate = useNavigate();
  const [f, setF] = useState<NewApplication>({
    contact_email: "", contact_name: "", contact_phone: "",
    program: "", program_other: "",
    youth_name: "", youth_grade_school: "", choose_one: "",
    household_size: "", youth_count: "", frl_eligible: "", need_explanation: "", certified: false,
    registration_cost: 240, contribution_amount: "",
    received_before: false, narrative: "", referral: "", optional_info: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  // Everything TRCMS already knows, so the family retypes as little as possible.
  const [prefill, setPrefill] = useState<ApplicationPrefill | null>(null);
  const [youthId, setYouthId] = useState<number | null>(null);

  useEffect(() => {
    scholarshipsApi.applicationPrefill().then((p) => {
      setPrefill(p);
      setF((prev) => ({
        ...prev,
        contact_name: prev.contact_name || p.contact_name,
        contact_email: prev.contact_email || p.contact_email,
        contact_phone: prev.contact_phone || p.contact_phone,
        household_size: prev.household_size === "" && p.household_size ? String(p.household_size) : prev.household_size,
        youth_count: prev.youth_count === "" && p.youth_count ? String(p.youth_count) : prev.youth_count,
      }));
      // One youth: fill them straight in. Several: they pick, and it fills.
      if (p.youth.length === 1) applyYouth(p.youth[0], p.enrollment_year);
    }).catch(() => { /* an empty form still works — never block the application */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyYouth(y: PrefillYouth, seasonYear?: number) {
    setYouthId(y.member_id);
    setF((prev) => ({
      ...prev,
      member_id: y.member_id,
      youth_name: y.name,
      youth_grade_school: gradeSchool(y, seasonYear ?? prefill?.enrollment_year ?? new Date().getFullYear()) || prev.youth_grade_school,
      program: programOption(y.program_name) || prev.program,
      registration_cost: y.registration_cost ?? prev.registration_cost,
      received_before: y.received_before,
    }));
  }

  const set = (k: keyof NewApplication, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setErr("");
    for (const [k, label] of [["contact_email", "your email"], ["contact_name", "your name"], ["contact_phone", "your phone"], ["program", "a program"], ["youth_name", "the youth's name"], ["choose_one", "the scholarship category"]] as const) {
      if (!String(f[k as keyof NewApplication] ?? "").trim()) { setErr(`Please provide ${label}.`); return; }
    }
    if (!f.certified) { setErr("Please check the certification box to submit."); return; }
    setBusy(true);
    try { await scholarshipsApi.submit(f); setDone(true); }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not submit. Please try again."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div style={s.wrap}>
        <div style={s.doneCard}>
          <div style={s.doneIcon}><Check size={28} /></div>
          <h2 style={s.doneH}>Application submitted</h2>
          <p style={s.doneP}>Thank you. The Tulsa Robotics Center team will review your scholarship application and follow up by email. You can submit another application for a different youth if needed.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
            <button style={s.secondary} onClick={() => { setDone(false); setF((p) => ({ ...p, youth_name: "", youth_grade_school: "", choose_one: "", contribution_amount: "", narrative: "", referral: "", optional_info: "" })); }}>Apply for another youth</button>
            <button style={s.primary} onClick={() => navigate(-1)}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <button onClick={() => navigate(-1)} style={s.back}><ArrowLeft size={15} /> Back</button>
      <div style={s.head}>
        <GraduationCap size={22} style={{ verticalAlign: -4, marginRight: 8, color: "#1a3a5c" }} />
        <span style={s.title}>Tulsa Robotics Center Scholarship Application</span>
      </div>
      <p style={s.intro}>To be completed by parent/guardian and/or youth 15 years and older. Complete one application for each youth.</p>

      <Section title="Person completing this form">
        {prefill && (prefill.contact_name || prefill.youth.length > 0) && (
          <div style={s.prefillBanner}>
            We've filled in what we already have on file. Please check it over and correct anything that's out of date.
          </div>
        )}
        <Field label="Email" required><input style={s.in} type="email" value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></Field>
        <Field label="Name" required><input style={s.in} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></Field>
        <Field label="Phone number" required><input style={s.in} value={f.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} /></Field>
      </Section>

      <Section title="Program">
        <Field label="Select the program your youth is planning to register for" required>
          <select style={s.in} value={f.program} onChange={(e) => set("program", e.target.value)}>
            <option value="">Choose…</option>
            {PROGRAMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </Field>
        {f.program === "Other" && (
          <Field label="Please specify"><input style={s.in} value={f.program_other} onChange={(e) => set("program_other", e.target.value)} /></Field>
        )}
        <Field label="Which best describes your request?" required>
          <select style={s.in} value={f.choose_one} onChange={(e) => set("choose_one", e.target.value)}>
            <option value="">Choose one…</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Youth information">
        {prefill && prefill.youth.length > 1 && (
          <Field label="Which youth is this application for?" required>
            <select style={s.in} value={youthId ?? ""} onChange={(e) => {
              const y = prefill.youth.find((k) => k.member_id === Number(e.target.value));
              if (y) applyYouth(y, prefill.enrollment_year);
            }}>
              <option value="">Select…</option>
              {prefill.youth.map((y) => <option key={y.member_id} value={y.member_id}>{y.name}</option>)}
            </select>
            <div style={s.prefillNote}>One application per youth — picking one fills in their details below.</div>
          </Field>
        )}
        <Field label="Youth name" required><input style={s.in} value={f.youth_name} onChange={(e) => set("youth_name", e.target.value)} /></Field>
        <Field label="Youth grade level in the fall and school attending"><input style={s.in} value={f.youth_grade_school} onChange={(e) => set("youth_grade_school", e.target.value)} /></Field>
        <Field label="What amount are you able to contribute toward the $240 annual registration cost?">
          <input style={s.in} type="number" step="0.01" min="0" placeholder="e.g. 40" value={f.contribution_amount as string} onChange={(e) => set("contribution_amount", e.target.value)} />
        </Field>
        <Field label="Has your family received a Tulsa Robotics Center scholarship before?">
          <label style={s.check}><input type="checkbox" checked={!!f.received_before} onChange={(e) => set("received_before", e.target.checked)} /> Yes, we have</label>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Number of people in your household?"><input style={s.in} type="number" min="1" value={f.household_size as string} onChange={(e) => set("household_size", e.target.value)} /></Field>
          <Field label="Number of youth you're enrolling at TRC?"><input style={s.in} type="number" min="1" value={f.youth_count as string} onChange={(e) => set("youth_count", e.target.value)} /></Field>
        </div>
        <Field label="Is the youth eligible for free or reduced-price school lunch?">
          <select style={s.in} value={f.frl_eligible} onChange={(e) => set("frl_eligible", e.target.value)}>
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unsure">Unsure</option>
          </select>
        </Field>
        <Field label="Please explain your family's need for this scholarship.">
          <textarea style={s.area} rows={4} value={f.need_explanation} onChange={(e) => set("need_explanation", e.target.value)} />
        </Field>
        <Field label="For FTC or FRC participants: what does this program mean to you? Include prior service/fundraising with TRC and your goals for the season.">
          <textarea style={s.area} rows={4} value={f.narrative} onChange={(e) => set("narrative", e.target.value)} />
        </Field>
        <Field label="Referral / reference: if a new youth, list any current or former TRC members you're acquainted with.">
          <textarea style={s.area} rows={3} value={f.referral} onChange={(e) => set("referral", e.target.value)} />
        </Field>
        <Field label="Anything else you'd like us to be aware of (optional)">
          <textarea style={s.area} rows={3} value={f.optional_info} onChange={(e) => set("optional_info", e.target.value)} />
        </Field>
      </Section>

      <label style={{ ...s.check, marginBottom: 14, alignItems: "flex-start" }}>
        <input type="checkbox" checked={!!f.certified} onChange={(e) => set("certified", e.target.checked)} style={{ marginTop: 3 }} />
        <span>I certify that the information provided in this application is accurate and complete to the best of my knowledge. <span style={{ color: "#c62828" }}>*</span></span>
      </label>
      {err && <div style={s.err}>{err}</div>}
      <button style={s.primary} disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit application"}</button>
      <p style={s.note}>Your application is confidential and reviewed by TRC staff.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={s.section}><h3 style={s.sectionH}>{title}</h3>{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div style={s.field}><label style={s.label}>{label}{required && <span style={{ color: "#c62828" }}> *</span>}</label>{children}</div>;
}

const s: Record<string, React.CSSProperties> = {
  prefillBanner: { background: "#eef5ff", border: "1px solid #cfe0f5", color: "#1a3a5c", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginBottom: 12 },
  prefillNote: { fontSize: 11, color: "#90a4ae", marginTop: 4 },
  wrap: { maxWidth: 680, margin: "0 auto", paddingBottom: 40 },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, marginBottom: 12, padding: 0 },
  head: { marginBottom: 6 },
  title: { fontSize: 21, fontWeight: 800, color: "#1a3a5c" },
  intro: { color: "#667", fontSize: 13.5, margin: "0 0 18px", lineHeight: 1.5 },
  section: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginBottom: 16 },
  sectionH: { fontSize: 14.5, fontWeight: 700, color: "#1a3a5c", margin: "0 0 14px" },
  field: { marginBottom: 14 },
  label: { display: "block", fontSize: 13, color: "#334155", marginBottom: 6, lineHeight: 1.4 },
  in: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  area: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box", resize: "vertical" },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#333", cursor: "pointer" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", color: "#c62828", borderRadius: 7, padding: "9px 12px", fontSize: 13, marginBottom: 12 },
  primary: { padding: "11px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  secondary: { padding: "9px 18px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  note: { color: "#99a", fontSize: 12, marginTop: 12 },
  doneCard: { background: "#fff", border: "1px solid #cbe6cf", borderRadius: 12, padding: "32px 28px", textAlign: "center", maxWidth: 480, margin: "40px auto" },
  doneIcon: { width: 52, height: 52, borderRadius: "50%", background: "#2e7d32", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" },
  doneH: { fontSize: 19, fontWeight: 800, color: "#1a3a5c", margin: "0 0 8px" },
  doneP: { color: "#556", fontSize: 14, lineHeight: 1.55, margin: "0 0 8px" },
};
