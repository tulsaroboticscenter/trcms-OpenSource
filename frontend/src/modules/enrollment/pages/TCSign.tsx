/**
 * TCSign — Terms & Conditions signing for a youth enrollment.
 *
 * The youth signs the sections configured for the "youth" audience; a parent or
 * guardian signs the sections configured for the "parent" audience. Every section
 * and its wording comes from the admin-configurable consent catalog, and each
 * response is recorded with a snapshot of exactly what was agreed to. A youth may
 * not sign the guardian's portion.
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";
import { enrollmentApi, type Enrollment, type ConsentSection, type ConsentResponses, type HandbookLink } from "../api";
import { useAuth } from "../../../core/AuthContext";
import ConsentSections, { consentComplete } from "../components/ConsentSections";
import MedicalForm from "../components/MedicalForm";
import { GRADE_OPTIONS } from "../../../core/grade";

const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL"];

type Step = "info" | "youth" | "parent" | "medical" | "complete";

export default function TCSign({ enrollmentIdProp, onComplete, onExit }: {
  enrollmentIdProp?: number; onComplete?: () => void; onExit?: () => void;
} = {}) {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const eid = enrollmentIdProp ?? parseInt(enrollmentId ?? "0");
  const exit = () => (onExit ? onExit() : navigate(-1));
  const complete = () => (onComplete ? onComplete() : navigate(-1));

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [sections, setSections] = useState<ConsentSection[]>([]);
  const [handbook, setHandbook] = useState<HandbookLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("info");
  // Details confirmed on the Review step before any signature is taken.
  const [grade, setGrade] = useState<number | null>(null);
  const [shirt, setShirt] = useState("");
  // Birthday is asked here only when the youth has none on file (it drives age-based
  // eligibility, e.g. FLL meeting-night preference). A date already on file is left alone.
  const [birthday, setBirthday] = useState("");
  const [needsBirthday, setNeedsBirthday] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsErr, setDetailsErr] = useState("");

  const [youthName, setYouthName] = useState("");
  const [youthResp, setYouthResp] = useState<ConsentResponses>({});
  const [savingYouth, setSavingYouth] = useState(false);

  const [parentName, setParentName] = useState("");
  const [parentResp, setParentResp] = useState<ConsentResponses>({});
  const [savingParent, setSavingParent] = useState(false);

  const [error, setError] = useState("");

  const youthSections = sections.filter((s) => s.audiences.includes("youth"));
  const parentSections = sections.filter((s) => s.audiences.includes("parent"));

  useEffect(() => {
    enrollmentApi.getById(eid)
      .then((e: Enrollment) => {
        setEnrollment(e);
        setGrade(e.grade ?? null);
        setShirt(e.shirt_size ?? "");
        setNeedsBirthday(e.member_type === "youth" && !e.member_birthday);
        if (e.tc_youth_agreed && e.tc_parent_agreed) setStep("complete");
        else if (e.tc_youth_agreed) setStep("parent");
        else setStep("info");
      })
      .finally(() => setLoading(false));
    enrollmentApi.getConsentSections().then(setSections).catch(() => setSections([]));
    enrollmentApi.getHandbook().then(setHandbook).catch(() => setHandbook(null));
  }, [enrollmentId]);

  async function signYouth() {
    if (!youthName.trim()) { setError("Please type your full name to sign."); return; }
    if (!consentComplete(youthSections, youthResp)) { setError("Please complete every required item above."); return; }
    setError(""); setSavingYouth(true);
    try {
      await enrollmentApi.signTC(eid, "youth", youthName.trim(), youthResp);
      setStep("parent");
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to record signature. Please try again.");
    } finally { setSavingYouth(false); }
  }

  async function signParent() {
    if (!parentName.trim()) { setError("Please type your full name to sign."); return; }
    if (!consentComplete(parentSections, parentResp)) { setError("Please complete every required item above."); return; }
    setError(""); setSavingParent(true);
    try {
      await enrollmentApi.signTC(eid, "parent", parentName.trim(), parentResp);
      setStep("medical");
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to record signature. Please try again.");
    } finally { setSavingParent(false); }
  }

  if (loading) return <div style={styles.center}>Loading…</div>;
  if (!enrollment) return <div style={styles.center}>Enrollment not found.</div>;

  const programLabel = enrollment.program_full_name ?? enrollment.program_name;
  async function saveDetailsAndContinue() {
    const needsGrade = enrollment?.member_type === "youth";
    if (needsGrade && grade === null) { setDetailsErr("Please select the grade for this school year."); return; }
    if (!shirt) { setDetailsErr("Please select a shirt size."); return; }
    if (needsBirthday && !birthday) { setDetailsErr("Please enter the youth's date of birth."); return; }
    setSavingDetails(true); setDetailsErr("");
    try {
      await enrollmentApi.saveDetails(eid, {
        shirt_size: shirt,
        ...(needsGrade ? { grade } : {}),
        ...(needsBirthday && birthday ? { birthday } : {}),
      });
      setStep("youth");
    } catch (e: unknown) {
      setDetailsErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save these details.");
    } finally { setSavingDetails(false); }
  }

  const viewerIsEnrolleeYouth = !!user && user.id === enrollment.member_id && user.member_type === "youth";

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div style={styles.trcTitle}>Tulsa Robotics Center</div>
        <div style={styles.trcSub}>Terms &amp; Conditions Agreement — {enrollment.enrollment_year_label}</div>
      </div>

      <div style={styles.progress}>
        <ProgressStep num={1} label="Review" done={step !== "info"} active={step === "info"} />
        <div style={styles.progressLine} />
        <ProgressStep num={2} label="Youth Signature" done={["parent", "medical", "complete"].includes(step)} active={step === "youth"} />
        <div style={styles.progressLine} />
        <ProgressStep num={3} label="Parent Signature" done={["medical", "complete"].includes(step)} active={step === "parent"} />
        <div style={styles.progressLine} />
        <ProgressStep num={4} label="Medical" done={step === "complete"} active={step === "medical"} />
        <div style={styles.progressLine} />
        <ProgressStep num={5} label="Complete" done={step === "complete"} active={step === "complete"} />
      </div>

      {step === "info" && (
        <div style={styles.card}>
          <h2 style={styles.cardHeading}>TRC Program Terms &amp; Conditions</h2>
          <p style={styles.intro}>
            Before participating in the Tulsa Robotics Center program, the youth member and a parent or guardian
            each review and agree to the sections below. Please read the {handbook?.title?.trim() || "TRC Handbook"} and
            each consent carefully before proceeding.
          </p>
          {/* Confirm the two details that go stale every season before signing. Shirt
              size is also what the enrollment needs to finish activating, so asking
              here means a family can complete registration without staff filling it in. */}
          <div style={styles.verifyBox}>
            <div style={styles.verifyHead}>Please confirm these details for {enrollment.enrollment_year_label}</div>
            <div style={styles.verifyGrid}>
              {enrollment.member_type === "youth" && (
                <label style={styles.verifyField}>
                  <span style={styles.verifyLabel}>Grade this school year</span>
                  <select style={styles.verifyInput} value={grade === null ? "" : String(grade)}
                    onChange={(e) => { setGrade(e.target.value === "" ? null : parseInt(e.target.value)); setDetailsErr(""); }}>
                    <option value="">— please select —</option>
                    {GRADE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              <label style={styles.verifyField}>
                <span style={styles.verifyLabel}>Shirt size</span>
                <select style={styles.verifyInput} value={shirt}
                  onChange={(e) => { setShirt(e.target.value); setDetailsErr(""); }}>
                  <option value="">— please select —</option>
                  {SHIRT_SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
                </select>
              </label>
              {needsBirthday && (
                <label style={styles.verifyField}>
                  <span style={styles.verifyLabel}>Date of birth</span>
                  <input type="date" style={styles.verifyInput} value={birthday} max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => { setBirthday(e.target.value); setDetailsErr(""); }} />
                </label>
              )}
            </div>
            {detailsErr && <div style={styles.verifyErr}>{detailsErr}</div>}
          </div>
          <div style={styles.actions}>
            <button style={styles.cancelBtn} onClick={exit}>Back</button>
            <button style={styles.primaryBtn} disabled={savingDetails} onClick={saveDetailsAndContinue}>
              {savingDetails ? "Saving…" : "Proceed to Youth Signature →"}
            </button>
          </div>
        </div>
      )}

      {step === "youth" && (
        <div style={styles.card}>
          <h2 style={styles.cardHeading}>Youth Member Signature</h2>
          {enrollment.tc_youth_agreed ? (
            <AlreadySigned label="Youth" date={enrollment.tc_youth_date} onNext={() => setStep("parent")} />
          ) : (
            <>
              <p style={styles.intro}>
                By signing below, the youth member agrees to the following for the {enrollment.enrollment_year_label} program year.
              </p>
              <ConsentSections sections={youthSections} responses={youthResp} handbook={handbook}
                onChange={(k, v) => setYouthResp((r) => ({ ...r, [k]: v }))} />
              <div style={styles.signatureBlock}>
                <label style={styles.sigLabel}>Youth: type your full legal name to sign electronically:</label>
                <input style={styles.sigInput} value={youthName} onChange={(e) => setYouthName(e.target.value)} placeholder="Full name" />
                <p style={styles.sigNote}>Date: {new Date().toLocaleDateString()} &nbsp;|&nbsp; {programLabel} — {enrollment.enrollment_year_label}</p>
              </div>
              {/* #162: a parent/guardian driving the signup can skip the youth's
                  signature for now — to let the youth sign later, or to come back and
                  review the handbook & Code of Conduct together first. Nothing is
                  recorded; the youth's signature stays outstanding. Not offered to a
                  youth signing their own enrollment. */}
              {!viewerIsEnrolleeYouth && (
                <div style={styles.bypassNote}>
                  Reviewing the handbook &amp; Code of Conduct with your youth later? You can skip this
                  for now and continue — the youth&apos;s signature stays required and the enrollment
                  isn&apos;t complete until it&apos;s done.
                </div>
              )}
              {error && <div style={styles.errorBox}>{error}</div>}
              <div style={styles.actions}>
                <button style={styles.cancelBtn} onClick={() => setStep("info")}>← Back</button>
                {!viewerIsEnrolleeYouth && (
                  <button style={styles.skipBtn} onClick={() => { setError(""); setStep("parent"); }}>
                    Skip for now — youth signs later
                  </button>
                )}
                <button style={styles.primaryBtn} onClick={signYouth} disabled={savingYouth}>{savingYouth ? "Saving…" : "Sign as Youth Member →"}</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "parent" && (
        <div style={styles.card}>
          <h2 style={styles.cardHeading}>Parent / Guardian Signature</h2>
          {enrollment.tc_parent_agreed ? (
            <AlreadySigned label="Parent/Guardian" date={enrollment.tc_parent_date} onNext={() => setStep("medical")} />
          ) : viewerIsEnrolleeYouth ? (
            <div style={styles.guardianNotice}>
              <p style={styles.intro}>
                This section must be completed by a <strong>parent or guardian</strong>. A youth member can&apos;t sign the
                parent/guardian portion. Please have your parent or guardian sign in to their own account and open this
                enrollment to complete their signature.
              </p>
              <div style={styles.actions}>
                <button style={styles.cancelBtn} onClick={() => setStep("youth")}>← Back</button>
                <button style={styles.primaryBtn} onClick={exit}>Done for now</button>
              </div>
            </div>
          ) : (
            <>
              <p style={styles.intro}>
                As the parent or legal guardian, please review and provide your consent for your youth&apos;s participation
                for {enrollment.enrollment_year_label}.
              </p>
              <ConsentSections sections={parentSections} responses={parentResp} handbook={handbook}
                onChange={(k, v) => setParentResp((r) => ({ ...r, [k]: v }))} />
              <div style={styles.signatureBlock}>
                <label style={styles.sigLabel}>Parent/Guardian: type your full legal name to sign electronically:</label>
                <input style={styles.sigInput} value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Parent/Guardian full name" />
                <p style={styles.sigNote}>Date: {new Date().toLocaleDateString()} &nbsp;|&nbsp; {programLabel} — {enrollment.enrollment_year_label}</p>
              </div>
              {error && <div style={styles.errorBox}>{error}</div>}
              <div style={styles.actions}>
                <button style={styles.cancelBtn} onClick={() => setStep("youth")}>← Back</button>
                <button style={styles.primaryBtn} onClick={signParent} disabled={savingParent}>{savingParent ? "Saving…" : "Sign as Parent/Guardian →"}</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "medical" && (
        <div style={styles.card}>
          <h2 style={styles.cardHeading}>Medical Consent &amp; Emergency Information</h2>
          {viewerIsEnrolleeYouth ? (
            <div style={styles.guardianNotice}>
              <p style={styles.intro}>
                The medical form must be completed by a <strong>parent or guardian</strong>. Please have them sign in and
                open this enrollment to complete it. It&apos;s optional to check in, but strongly recommended.
              </p>
              <div style={styles.actions}>
                <button style={styles.primaryBtn} onClick={() => setStep("complete")}>Skip for now →</button>
              </div>
            </div>
          ) : (
            <>
              <p style={styles.intro}>
                Please provide emergency and medical information for your youth for the
                {" "}{enrollment.enrollment_year_label} season. This is optional but strongly recommended so our first-aid
                supervisors have what they need.
              </p>
              <MedicalForm memberId={enrollment.member_id} year={enrollment.enrollment_year} yearLabel={enrollment.enrollment_year_label}
                embedded onSaved={() => setStep("complete")} onSkip={() => setStep("complete")} />
            </>
          )}
        </div>
      )}

      {step === "complete" && (
        <div style={{ ...styles.card, textAlign: "center" }}>
          <CheckCircle size={64} color="#2e7d32" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ ...styles.cardHeading, color: "#2e7d32" }}>Terms &amp; Conditions Complete!</h2>
          <p style={styles.intro}>
            The youth member and parent/guardian have signed the TRC Terms &amp; Conditions for the
            {" "}{enrollment.enrollment_year_label} program year. This member is now cleared to check in to events.
          </p>
          <button style={{ ...styles.primaryBtn, marginTop: 16 }} onClick={complete}>Done</button>
        </div>
      )}
    </div>
  );
}

function AlreadySigned({ label, date, onNext }: { label: string; date?: string; onNext: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "2rem 0" }}>
      <CheckCircle size={40} color="#2e7d32" style={{ margin: "0 auto 12px" }} />
      <p style={{ fontSize: 15, color: "#2e7d32", fontWeight: 600 }}>{label} has already signed.</p>
      {date && <p style={{ fontSize: 13, color: "#888" }}>Signed on {new Date(date).toLocaleDateString()}</p>}
      <button style={styles.primaryBtn} onClick={onNext}>Continue →</button>
    </div>
  );
}

function ProgressStep({ num, label, done, active }: { num: number; label: string; done: boolean; active: boolean }) {
  return (
    <div style={{ textAlign: "center", minWidth: 80 }}>
      <div style={{ ...styles.progressDot, background: done ? "#2e7d32" : active ? "#1a3a5c" : "#ddd", color: done || active ? "#fff" : "#999" }}>
        {done ? <CheckCircle size={14} /> : num}
      </div>
      <div style={{ fontSize: 11, color: active ? "#1a3a5c" : "#999", marginTop: 4, fontWeight: active ? 700 : 400 }}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  verifyBox: { background: "#f7fafc", border: "1px solid #cdd7e3", borderRadius: 8, padding: "14px 16px", margin: "14px 0" },
  verifyHead: { fontSize: 13.5, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  verifyGrid: { display: "flex", gap: 14, flexWrap: "wrap" as const },
  verifyField: { display: "flex", flexDirection: "column" as const, gap: 4, flex: "1 1 210px" },
  verifyLabel: { fontSize: 12, fontWeight: 600, color: "#4a5b6d" },
  verifyInput: { padding: "9px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, background: "#fff" },
  verifyErr: { marginTop: 10, fontSize: 12.5, color: "#c62828", fontWeight: 600 },

  page: { maxWidth: 720, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  topBar: { textAlign: "center", marginBottom: 24 },
  trcTitle: { fontSize: 26, fontWeight: 900, color: "#1a3a5c" },
  trcSub: { fontSize: 13, color: "#666", marginTop: 2 },
  progress: { display: "flex", alignItems: "flex-start", justifyContent: "center", marginBottom: 28 },
  progressLine: { flex: 1, height: 2, background: "#ddd", marginTop: 14, maxWidth: 60 },
  progressDot: { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, margin: "0 auto" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "2rem", marginBottom: 16 },
  cardHeading: { margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#1a3a5c" },
  intro: { fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 16 },
  guardianNotice: { background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 10, padding: "16px 18px" },
  signatureBlock: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: 16, marginTop: 8 },
  sigLabel: { display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 8 },
  sigInput: { width: "100%", padding: "10px 12px", border: "2px solid #1a3a5c", borderRadius: 6, fontSize: 16, fontFamily: "cursive, serif", boxSizing: "border-box" as const },
  sigNote: { fontSize: 11, color: "#888", marginTop: 8, marginBottom: 0 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancelBtn: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  skipBtn: { padding: "9px 18px", border: "1px solid #cdb98a", background: "#fff8ea", color: "#8a5a00", borderRadius: 6, cursor: "pointer", fontSize: 13.5, fontWeight: 600 },
  bypassNote: { marginTop: 12, padding: "9px 12px", background: "#fff8ea", border: "1px solid #f0d9a8", borderRadius: 8, fontSize: 12.5, color: "#7a5200", lineHeight: 1.5 },
  primaryBtn: { padding: "10px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
