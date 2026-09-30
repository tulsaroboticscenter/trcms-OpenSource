/**
 * EnrollmentAdd
 * Admin form to enroll a member in a program for a given year.
 */
import { useState, useEffect, type FormEvent } from "react";
import DOMPurify from "dompurify";
import { useParams, useNavigate } from "react-router-dom";
import { enrollmentApi, programsApi, type Program } from "../api";
import { membersApi } from "../../members/api";
import HelpTip from "../../../core/components/HelpTip";
import { useManualMethods } from "../../payments/useManualMethods";
import { nightPrefsApi, type NightOption } from "../../../core/nightPrefsApi";
import NightPreferencePicker, { type NightPrefValue } from "../../../components/NightPreferencePicker";

const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL"];
const STATUSES = ["active", "not_active", "suspended"];

export default function EnrollmentAdd() {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const paymentMethods = useManualMethods();

  const [member, setMember] = useState<{ first_name: string; last_name: string } | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());

  const [programId, setProgramId] = useState("");
  const [enrollmentYear, setEnrollmentYear] = useState("");
  const [status, setStatus] = useState("active");
  const [dateEnrolled, setDateEnrolled] = useState(new Date().toISOString().split("T")[0]);
  const [amountDue, setAmountDue] = useState("");
  const [amountDueTouched, setAmountDueTouched] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentOverride, setPaymentOverride] = useState(false);
  const [scholarshipFund, setScholarshipFund] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [nights, setNights] = useState<NightOption[]>([]);
  const [nightApplies, setNightApplies] = useState(false);
  const [night, setNight] = useState<NightPrefValue>({ available: [], preferred: null, siblings: false });
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = parseInt(memberId!);
    membersApi.get(id).then(setMember).catch(() => setMember(null));
    programsApi.list().then((p) => {
      setPrograms(p.filter((prog: Program) => prog.status === "active"));
    });
    enrollmentApi.getCurrentYear().then((y) => {
      setCurrentYear(y);
      setEnrollmentYear(String(y));
    });
  }, [memberId]);

  // Load the program's nights for the season + prefill this member's existing preference
  // (or their family's default) so we don't re-ask what a sibling already answered.
  useEffect(() => {
    if (!programId || !enrollmentYear) { setNights([]); setNightApplies(false); return; }
    const pid = parseInt(programId);
    const season = `${enrollmentYear}-${parseInt(enrollmentYear) + 1}`;
    let live = true;
    nightPrefsApi.get({ program_id: pid, season, member_id: parseInt(memberId!) })
      .then((d) => {
        if (!live) return;
        setNights(d.nights);
        setNightApplies(d.applies);
        const src = d.preference ?? d.family_default;
        if (src) setNight({
          available: src.available_night_ids ?? [],
          preferred: src.preferred_night_id ?? null,
          siblings: !!src.siblings_together,
        });
      })
      .catch(() => { if (live) { setNights([]); setNightApplies(false); } });
    return () => { live = false; };
  }, [programId, enrollmentYear, memberId]);

  // Auto-preview the amount due from the fee schedule (unless admin has overridden it).
  useEffect(() => {
    if (!programId || !enrollmentYear || amountDueTouched) return;
    enrollmentApi.previewFee(parseInt(memberId!), parseInt(programId), parseInt(enrollmentYear))
      .then((amt) => setAmountDue(String(amt)))
      .catch(() => {});
  }, [programId, enrollmentYear, amountDueTouched, memberId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!programId) { setError("Please select a program."); return; }
    setError("");
    setSaving(true);
    try {
      await enrollmentApi.create({
        member_id: parseInt(memberId!),
        program_id: parseInt(programId),
        enrollment_year: parseInt(enrollmentYear),
        status,
        date_enrolled: dateEnrolled || null,
        ...(amountDueTouched ? { amount_due: amountDue === "" ? null : parseFloat(amountDue) } : {}),
        payment_amount: paymentAmount ? parseFloat(paymentAmount) : null,
        date_payment: paymentDate || null,
        payment_method: paymentMethod || null,
        payment_reference: paymentRef || null,
        payment_override: paymentOverride,
        scholarship_fund: scholarshipFund || null,
        shirt_size: shirtSize || null,
        available_night_ids: night.available,
        preferred_night_id: night.preferred,
        siblings_together: night.siblings,
        notes: notes || null,
      });
      navigate(`/members/${memberId}`, { state: { success: "Enrollment added successfully." } });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to save enrollment.");
    } finally {
      setSaving(false);
    }
  }

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back</button>
        <h1 style={styles.heading}>
          Add Enrollment{member ? ` — ${member.first_name} ${member.last_name}` : ""}
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card title="Program &amp; Year">
          <Grid>
            <Field label="Program *">
              <select style={styles.input} value={programId} onChange={(e) => setProgramId(e.target.value)} required>
                <option value="">Select a program…</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.full_name ? ` — ${p.full_name}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Enrollment Year *">
              <select style={styles.input} value={enrollmentYear} onChange={(e) => setEnrollmentYear(e.target.value)}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}–{y + 1}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select style={styles.input} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Date Enrolled">
              <input type="date" style={styles.input} value={dateEnrolled} onChange={(e) => setDateEnrolled(e.target.value)} />
            </Field>
            <Field label="Shirt Size">
              <select style={styles.input} value={shirtSize} onChange={(e) => setShirtSize(e.target.value)}>
                <option value="">Select…</option>
                {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </Grid>
        </Card>

        {nightApplies && nights.length > 0 && (
          <Card title="Meeting Night Preference">
            <NightPreferencePicker nights={nights} value={night} onChange={setNight} />
          </Card>
        )}

        <Card title="Payment">
          <Grid>
            <Field label="Amount Due ($)">
              <input type="number" step="0.01" min="0" style={styles.input}
                value={amountDue} onChange={(e) => { setAmountDue(e.target.value); setAmountDueTouched(true); }}
                placeholder="0.00" />
              <div style={styles.dueHint}>{amountDueTouched ? "Manual override" : "Auto from fee schedule"}</div>
            </Field>
            <Field label="Payment Amount ($)">
              <input type="number" step="0.01" min="0" style={styles.input}
                value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00" />
            </Field>
            <Field label="Date of Payment">
              <input type="date" style={styles.input} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </Field>
            <Field label="Payment Method">
              <select style={styles.input} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="">Select…</option>
                {[...new Set([...paymentMethods, ...(paymentMethod && !paymentMethods.includes(paymentMethod) ? [paymentMethod] : [])])].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Check # / Transaction ID">
              <input style={styles.input} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Reference number" />
            </Field>
            <Field label="Scholarship Fund">
              <input style={styles.input} value={scholarshipFund} onChange={(e) => setScholarshipFund(e.target.value)}
                placeholder="Fund name if applicable" />
            </Field>
          </Grid>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={paymentOverride} onChange={(e) => setPaymentOverride(e.target.checked)} />
            <span>
              <strong>Payment Override</strong> — Allow this member to participate before payment is received.{" "}
              <HelpTip text="Use this for scholarship recipients, hardship cases, or when a payment is pending. The member gets full access but their enrollment shows as unpaid in reports." />
            </span>
          </label>
        </Card>

        <Card title="Notes">
          <textarea style={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes about this enrollment…" />
        </Card>

        <div style={styles.tcNotice}>
          <strong>Note:</strong> After saving, the Terms &amp; Conditions must be signed by both the youth and a
          parent/guardian before this member can check in to events. You will be prompted to do this after saving.
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          <button type="button" onClick={() => navigate(-1)} style={styles.cancelBtn}>Cancel</button>
          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving ? "Saving…" : "Save & Continue to T&C"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(title) }} />
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={styles.grid}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 860, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { margin: "0 0 1rem", fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  dueHint: { fontSize: 11, color: "#888", marginTop: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  checkboxLabel: { display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, fontSize: 13, color: "#444", cursor: "pointer", lineHeight: 1.5 },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical" as const, boxSizing: "border-box" as const },
  tcNotice: { background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#1565c0", marginBottom: 16 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, paddingBottom: 32 },
  cancelBtn: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
