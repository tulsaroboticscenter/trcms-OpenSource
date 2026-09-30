import { useState, type FormEvent, useEffect } from "react";
import { api } from "../../../core/api";
import { PlusCircle, CheckCircle, Users } from "lucide-react";
import PhoneInput from "../../../core/components/PhoneInput";
import { GRADE_OPTIONS } from "../../../core/grade";

interface YouthData {
  first_name: string;
  middle_name: string;
  last_name: string;
  birthday: string;
  grade: string;
  program_interest_id: string;
}

interface SharedData {
  phone: string;
  email: string;
  guardian1_name: string;
  guardian1_phone: string;
  guardian1_email: string;
  referral_source: string;
  referral_detail: string;
  additional_info: string;
  parent_mentor_interest: string;
}

interface Program { id: number; name: string; full_name?: string; }

const blankYouth = (): YouthData => ({
  first_name: "", middle_name: "", last_name: "", birthday: "", grade: "", program_interest_id: "",
});

const blankShared: SharedData = {
  phone: "", email: "", guardian1_name: "", guardian1_phone: "",
  guardian1_email: "", referral_source: "", referral_detail: "", additional_info: "", parent_mentor_interest: "",
};

const REFERRAL_SOURCES = [
  { value: "word_of_mouth", label: "Word of mouth — who told you?" },
  { value: "google",        label: "Google search" },
  { value: "magazine_ad",   label: "Ad in a local magazine — which one?" },
  { value: "event",         label: "Saw us at an event — which one?" },
  { value: "other",         label: "Other — please describe" },
];

export default function VisitorCheckin() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [youth, setYouth] = useState<YouthData[]>([blankYouth()]);
  const [shared, setShared] = useState<SharedData>(blankShared);
  const [submitted, setSubmitted] = useState<{ names: string[]; numbers: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/v1/programs/").then((r) => setPrograms(r.data));
  }, []);

  function setYouthField(index: number, field: keyof YouthData, value: string) {
    setYouth((prev) => prev.map((y, i) => i === index ? { ...y, [field]: value } : y));
  }

  function setSharedField(field: keyof SharedData, value: string) {
    setShared((prev) => ({ ...prev, [field]: value }));
  }

  function addYouth() {
    setYouth((prev) => [...prev, blankYouth()]);
  }

  function removeYouth(index: number) {
    if (youth.length <= 1) return;
    setYouth((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const missing = youth.some((y) => !y.first_name.trim() || !y.last_name.trim());
    if (missing) { setError("Please enter first and last name for each youth."); return; }
    setError("");
    setLoading(true);
    const names: string[] = [];
    const numbers: string[] = [];
    try {
      for (const y of youth) {
        const payload = {
          first_name: y.first_name.trim(),
          middle_name: y.middle_name.trim() || null,
          last_name: y.last_name.trim(),
          birthday: y.birthday || null,
          grade: y.grade !== "" ? parseInt(y.grade) : null,
          program_interest_id: y.program_interest_id ? parseInt(y.program_interest_id) : null,
          phone: shared.phone || null,
          email: shared.email || null,
          guardian1_name: shared.guardian1_name || null,
          guardian1_phone: shared.guardian1_phone || null,
          guardian1_email: shared.guardian1_email || null,
          referral_source: shared.referral_source || null,
          parent_mentor_interest: shared.parent_mentor_interest ? 1 : 0,
          referral_detail: shared.referral_detail || null,
          additional_info: shared.additional_info || null,
        };
        const { data } = await api.post("/api/v1/visitors/", payload);
        names.push(data.name);
        numbers.push(data.visitor_number);
      }
      setSubmitted({ names, numbers });
      setTimeout(() => {
        setSubmitted(null);
        setYouth([blankYouth()]);
        setShared(blankShared);
      }, 8000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const needsDetail = ["word_of_mouth", "magazine_ad", "event", "other"].includes(shared.referral_source);
  const detailPlaceholder: Record<string, string> = {
    word_of_mouth: "Who told you about us?",
    magazine_ad: "Which magazine or publication?",
    event: "Which event did you see us at?",
    other: "Please describe",
  };

  if (submitted) {
    return (
      <div style={styles.successPage}>
        <div style={styles.successBox}>
          <CheckCircle size={72} color="#2e7d32" style={{ margin: "0 auto 16px", display: "block" }} />
          <h2 style={styles.successHeading}>Welcome to TRC!</h2>
          {submitted.names.map((name, i) => (
            <div key={i} style={styles.successEntry}>
              <strong>{name}</strong> — Visitor #{submitted.numbers[i]}
            </div>
          ))}
          <p style={styles.successHint}>
            Thank you for your interest! A team member will follow up with you soon.
          </p>
          <p style={styles.countdown}>This screen will reset automatically in 8 seconds…</p>
          <button style={styles.resetBtn} onClick={() => {
            setSubmitted(null); setYouth([blankYouth()]); setShared(blankShared);
          }}>
            Submit Another →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.heading}>Welcome to the Tulsa Robotics Center!</h1>
        <p style={styles.sub}>Please fill out this form so we can follow up with you. It only takes a minute!</p>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>

        {/* Youth entries */}
        {youth.map((y, i) => (
          <div key={i} style={styles.youthCard}>
            <div style={styles.youthCardHeader}>
              <span style={styles.youthCardTitle}>
                {youth.length > 1 ? `Youth #${i + 1}` : "Youth Information"}
              </span>
              {youth.length > 1 && (
                <button type="button" onClick={() => removeYouth(i)} style={styles.removeBtn}>
                  Remove
                </button>
              )}
            </div>
            <Grid cols={3}>
              <Field label="First Name *">
                <input style={styles.input} value={y.first_name}
                  onChange={(e) => setYouthField(i, "first_name", e.target.value)} />
              </Field>
              <Field label="Middle Name">
                <input style={styles.input} value={y.middle_name}
                  onChange={(e) => setYouthField(i, "middle_name", e.target.value)} />
              </Field>
              <Field label="Last Name *">
                <input style={styles.input} value={y.last_name}
                  onChange={(e) => setYouthField(i, "last_name", e.target.value)} />
              </Field>
              <Field label="Birthday">
                <input type="date" style={styles.input} value={y.birthday}
                  onChange={(e) => setYouthField(i, "birthday", e.target.value)} />
              </Field>
              <Field label="Grade">
                <select style={styles.input} value={y.grade}
                  onChange={(e) => setYouthField(i, "grade", e.target.value)}>
                  <option value="">—</option>
                  {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Program of Interest">
                <select style={styles.input} value={y.program_interest_id}
                  onChange={(e) => setYouthField(i, "program_interest_id", e.target.value)}>
                  <option value="">Not sure yet</option>
                  {programs.filter((p: Program) => p.name !== "FDP" || true).map((p: Program) => (
                    <option key={p.id} value={p.id}>{p.name}{p.full_name ? ` — ${p.full_name}` : ""}</option>
                  ))}
                </select>
              </Field>
            </Grid>
          </div>
        ))}

        {/* Add another youth */}
        <button type="button" style={styles.addYouthBtn} onClick={addYouth}>
          <PlusCircle size={15} />
          Add another youth{youth.length > 0 ? " (same parent/guardian)" : ""}
        </button>

        {/* Shared parent/contact info */}
        <div style={styles.sectionDivider}>
          <Users size={14} />
          <span>Parent / Guardian Information</span>
          {youth.length > 1 && <span style={styles.sharedNote}>(shared for all youth above)</span>}
        </div>

        <Grid cols={3}>
          <Field label="Parent/Guardian Name">
            <input style={styles.input} value={shared.guardian1_name}
              onChange={(e) => setSharedField("guardian1_name", e.target.value)} />
          </Field>
          <Field label="Parent/Guardian Phone">
            <PhoneInput style={styles.input} value={shared.guardian1_phone} onChange={(v) => setSharedField("guardian1_phone", v)} />
          </Field>
          <Field label="Parent/Guardian Email">
            <input type="email" style={styles.input} value={shared.guardian1_email}
              onChange={(e) => setSharedField("guardian1_email", e.target.value)} />
          </Field>
          <Field label="Youth Phone (if applicable)">
            <PhoneInput style={styles.input} value={shared.phone} onChange={(v) => setSharedField("phone", v)} />
          </Field>
          <Field label="Youth Email (if applicable)">
            <input type="email" style={styles.input} value={shared.email}
              onChange={(e) => setSharedField("email", e.target.value)} />
          </Field>
        </Grid>

        {/* How did you hear about us */}
        <div style={styles.sectionDivider}>
          How Did You Hear About Us?
        </div>
        <div style={styles.radioGroup}>
          {REFERRAL_SOURCES.map(({ value, label }) => (
            <label key={value} style={styles.radioLabel}>
              <input type="radio" name="referral" value={value}
                checked={shared.referral_source === value}
                onChange={() => setSharedField("referral_source", value)} />
              {label.split(" — ")[0]}
            </label>
          ))}
        </div>
        {needsDetail && (
          <div style={{ marginBottom: 12 }}>
            <input
              style={styles.input}
              placeholder={detailPlaceholder[shared.referral_source] ?? ""}
              value={shared.referral_detail}
              onChange={(e) => setSharedField("referral_detail", e.target.value)}
            />
          </div>
        )}

        {/* Parent mentoring interest */}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "14px 0", padding: "12px 14px", background: "#f0f7ff", border: "1px solid #cfe0f3", borderRadius: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={shared.parent_mentor_interest === "1"}
            onChange={(e) => setSharedField("parent_mentor_interest", e.target.checked ? "1" : "")} style={{ marginTop: 3 }} />
          <span style={{ fontSize: 14, color: "#1a3a5c" }}>
            <strong>A parent or guardian would be interested in mentoring or helping lead a team.</strong>
            <span style={{ display: "block", fontSize: 12.5, color: "#667", marginTop: 3 }}>Our teams are mentor-powered — families who can help are a big part of how we grow (and it can help with placement).</span>
          </span>
        </label>

        {/* Additional info */}
        <div style={styles.sectionDivider}>Any Questions or Additional Information?</div>
        <textarea
          style={styles.textarea}
          value={shared.additional_info}
          onChange={(e) => setSharedField("additional_info", e.target.value)}
          placeholder="Questions, comments, or anything else you'd like us to know…"
        />

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" style={styles.submitBtn} disabled={loading}>
          {loading ? "Submitting…" : `Submit${youth.length > 1 ? ` (${youth.length} youth)` : ""}`}
        </button>
      </form>
    </div>
  );
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "10px 14px", marginBottom: 12 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto", padding: "1rem" },
  pageHeader: { textAlign: "center", marginBottom: 24 },
  heading: { margin: 0, fontSize: 26, color: "#1a3a5c", fontWeight: 800 },
  sub: { color: "#666", marginTop: 6, fontSize: 14 },
  form: { background: "#fff", borderRadius: 12, padding: "2rem", boxShadow: "0 2px 12px rgba(0,0,0,0.07)" },
  youthCard: { border: "2px solid #e3f2fd", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 12, background: "#fafcff" },
  youthCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  youthCardTitle: { fontSize: 13, fontWeight: 700, color: "#1565c0" },
  removeBtn: { background: "none", border: "1px solid #ef9a9a", borderRadius: 4, color: "#c62828", cursor: "pointer", fontSize: 12, padding: "2px 10px" },
  addYouthBtn: { display: "flex", alignItems: "center", gap: 8, background: "#e3f2fd", border: "2px dashed #90caf9", borderRadius: 8, padding: "10px 16px", cursor: "pointer", color: "#1565c0", fontWeight: 600, fontSize: 14, marginBottom: 20, width: "100%", justifyContent: "center" },
  sectionDivider: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1a3a5c", borderBottom: "2px solid #e2e8f0", paddingBottom: 6, marginBottom: 12 },
  sharedNote: { fontSize: 11, color: "#888", fontWeight: 400 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 5, fontSize: 14, boxSizing: "border-box" as const },
  radioGroup: { display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  radioLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 5, fontSize: 14, resize: "vertical" as const, boxSizing: "border-box" as const, marginBottom: 16 },
  error: { color: "#c62828", marginBottom: 8 },
  submitBtn: { width: "100%", padding: 14, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: "pointer" },
  successPage: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8" },
  successBox: { textAlign: "center", background: "#fff", padding: "3rem 2.5rem", borderRadius: 14, boxShadow: "0 4px 24px rgba(0,0,0,0.1)", maxWidth: 480 },
  successHeading: { fontSize: 26, fontWeight: 800, color: "#1a3a5c", margin: "0 0 16px" },
  successEntry: { fontSize: 16, color: "#333", marginBottom: 8 },
  successHint: { color: "#555", fontSize: 14, margin: "16px 0 6px" },
  countdown: { color: "#aaa", fontSize: 12 },
  resetBtn: { marginTop: 16, padding: "10px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};

