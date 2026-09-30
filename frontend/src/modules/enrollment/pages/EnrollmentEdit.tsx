/**
 * EnrollmentEdit
 * Edit payment details, status, shirt size, override flag, and notes
 * for an existing enrollment record.
 */
import { useState, useEffect, type FormEvent } from "react";
import DOMPurify from "dompurify";
import { useParams, useNavigate } from "react-router-dom";
import { enrollmentApi, type Enrollment } from "../api";
import PaymentPlanPanel from "../components/PaymentPlanPanel";
import { useAuth } from "../../../core/AuthContext";
import { useManualMethods } from "../../payments/useManualMethods";

const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL"];
const STATUSES = ["active", "not_active", "suspended"];

export default function EnrollmentEdit() {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const navigate = useNavigate();
  const { canWrite } = useAuth();
  // Deleting an enrollment is gated on the enrollment.delete permission (Admin +
  // System Administrator by default; configurable in Role Management).
  const canDelete = canWrite("enrollment.delete");
  const paymentMethods = useManualMethods();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState("active");
  const [dateEnrolled, setDateEnrolled] = useState("");
  const [amountDue, setAmountDue] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentOverride, setPaymentOverride] = useState(false);
  const [scholarshipFund, setScholarshipFund] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Recording a payment emails the family a receipt, so it is confirmed first --
  // showing the exact address it will go to. Cancel means nothing is saved and
  // nothing is sent.
  const [confirmPay, setConfirmPay] = useState<{ amount: number; to: string | null; name: string; memberName: string } | null>(null);

  useEffect(() => {
    enrollmentApi.getById(parseInt(enrollmentId!)).then((e: Enrollment) => {
      setEnrollment(e);
      setStatus(e.status);
      setDateEnrolled(e.date_enrolled?.split("T")[0] ?? "");
      setAmountDue(e.amount_due != null ? String(e.amount_due) : "");
      setPaymentAmount(e.payment_amount != null ? String(e.payment_amount) : "");
      setPaymentDate(e.date_payment?.split("T")[0] ?? "");
      setPaymentMethod(e.payment_method ?? "");
      setPaymentRef(e.payment_reference ?? "");
      setPaymentOverride(e.payment_override);
      setScholarshipFund(e.scholarship_fund ?? "");
      setShirtSize(e.shirt_size ?? "");
      setNotes(e.notes ?? "");
    }).finally(() => setLoading(false));
  }, [enrollmentId]);

  async function handleDelete() {
    if (!confirm(`Permanently delete this enrollment (${enrollment?.program_name} ${enrollment?.enrollment_year_label})? This cannot be undone.`)) return;
    try {
      await enrollmentApi.delete(parseInt(enrollmentId!));
      navigate(-1);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to delete the enrollment.");
    }
  }

  /** Money going UP is a payment being recorded — that's what triggers a receipt. */
  function newMoney(): number {
    const before = enrollment?.payment_amount ?? 0;
    const after = paymentAmount ? parseFloat(paymentAmount) : 0;
    return Math.round((after - before) * 100) / 100;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const added = newMoney();
    if (added > 0 && !confirmPay) {
      // Ask the server who the receipt would go to, then confirm before saving.
      try {
        const r = await enrollmentApi.receiptRecipient(parseInt(enrollmentId!));
        setConfirmPay({ amount: added, to: r.to, name: r.recipient_name, memberName: r.member_name });
      } catch {
        setConfirmPay({ amount: added, to: null, name: "", memberName: "" });
      }
      return;   // nothing saved yet — the dialog decides
    }
    setConfirmPay(null);
    setSaving(true);
    try {
      await enrollmentApi.update(parseInt(enrollmentId!), {
        status,
        date_enrolled: dateEnrolled || null,
        amount_due: amountDue === "" ? null : parseFloat(amountDue),
        payment_amount: paymentAmount ? parseFloat(paymentAmount) : null,
        date_payment: paymentDate || null,
        payment_method: paymentMethod || null,
        payment_reference: paymentRef || null,
        payment_override: paymentOverride,
        scholarship_fund: scholarshipFund || null,
        shirt_size: shirtSize || null,
        notes: notes || null,
      });
      navigate(-1);
    } catch {
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading…</div>;
  if (!enrollment) return <div style={{ padding: "2rem", color: "#c62828" }}>Enrollment not found.</div>;

  const payDialog = confirmPay ? (
    <div style={styles.payOverlay} onClick={() => setConfirmPay(null)} role="presentation">
      <div style={styles.payModal} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="payTitle">
        <h2 id="payTitle" style={styles.payTitle}>Confirm this payment</h2>
        <p style={styles.payBody}>
          You're recording <strong>${confirmPay.amount.toFixed(2)}</strong> for{" "}
          <strong>{confirmPay.memberName || "this member"}</strong>
          {enrollment?.program_name ? ` (${enrollment.program_name})` : ""}.
        </p>
        {confirmPay.to ? (
          <p style={styles.payBody}>
            A payment receipt will be emailed to{" "}
            <strong>{confirmPay.to}</strong>{confirmPay.name ? ` (${confirmPay.name})` : ""}.
          </p>
        ) : (
          <p style={styles.payWarn}>
            No email address is on file for this family, so <strong>no receipt can be sent</strong>.
            The payment will still be recorded.
          </p>
        )}
        <div style={styles.payActions}>
          <button type="button" style={styles.payCancel} onClick={() => setConfirmPay(null)}>Cancel</button>
          <button type="button" style={styles.payOk} autoFocus disabled={saving}
            onClick={() => handleSubmit({ preventDefault() {} } as unknown as FormEvent)}>
            {saving ? "Saving…" : "Confirm payment"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {payDialog}
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back</button>
        <h1 style={styles.heading}>
          Edit Enrollment — {enrollment.program_name} {enrollment.enrollment_year_label}
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card title="Status &amp; Details">
          <Grid>
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

        <Card title="Payment">
          <Grid>
            <Field label="Amount Due ($)">
              <input type="number" step="0.01" min="0" style={styles.input}
                value={amountDue} onChange={(e) => setAmountDue(e.target.value)} />
              <div style={styles.dueHint}>
                {enrollment.amount_due_overridden ? "Manually set (override)" : "Auto-calculated from fee schedule"}
                {" · Balance: $"}{(Number(amountDue || 0) - Number(paymentAmount || 0)).toFixed(2)}
              </div>
            </Field>
            <Field label="Payment Amount ($)">
              <input type="number" step="0.01" min="0" style={styles.input}
                value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
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
              <input style={styles.input} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} />
            </Field>
            <Field label="Scholarship Fund">
              <input style={styles.input} value={scholarshipFund} onChange={(e) => setScholarshipFund(e.target.value)} />
            </Field>
          </Grid>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={paymentOverride} onChange={(e) => setPaymentOverride(e.target.checked)} />
            <span>
              <strong>Payment Override</strong> — Allow participation before payment is received.
            </span>
          </label>
        </Card>

        <Card title="Notes">
          <textarea style={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Card>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.actions}>
          {canDelete && (
            <button type="button" onClick={handleDelete} style={styles.deleteBtn}>Delete Enrollment</button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => navigate(-1)} style={styles.cancelBtn}>Cancel</button>
          <button type="submit" style={styles.saveBtn} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      <PaymentPlanPanel enrollmentId={parseInt(enrollmentId!)} />
    </div>
    </>
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
  payOverlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 },
  payModal: { background: "#fff", borderRadius: 12, padding: "20px 22px", maxWidth: 480, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" },
  payTitle: { margin: "0 0 12px", fontSize: 17, color: "#1a3a5c" },
  payBody: { margin: "0 0 10px", fontSize: 14, lineHeight: 1.6, color: "#33475b" },
  payWarn: { margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6, color: "#8a5a00", background: "#fff6e5", border: "1px solid #f0d9a8", borderRadius: 8, padding: "9px 11px" },
  payActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  payCancel: { padding: "8px 16px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 7, cursor: "pointer", fontSize: 13.5 },
  payOk: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13.5, fontWeight: 600 },
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
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", alignItems: "center", gap: 10, paddingBottom: 32 },
  deleteBtn: { padding: "9px 18px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  cancelBtn: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { padding: "9px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
