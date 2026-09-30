/**
 * MentorTCSign — the annual TRC Terms & Conditions signing screen for an adult
 * (mentor or volunteer). It renders whichever admin-configured consent sections
 * target that audience, records the signer's response to each, and marks the
 * annual T&C signed for the season. Signing is never silent.
 *
 * Reached from the dashboard MentorTcBanner and the MentorTCPanel on a profile.
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, FileSignature } from "lucide-react";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { enrollmentApi, type HandbookLink, type ConsentSection, type ConsentResponses } from "../api";
import ConsentSections, { consentComplete } from "../components/ConsentSections";
import MedicalForm from "../components/MedicalForm";

interface TCStatus {
  current_year: number; current_year_label: string;
  signed_current_year: boolean; in_grace_period: boolean;
  grace_ends?: string; grace_days_remaining?: number;
}

export default function MentorTCSign({ memberIdProp, onComplete, onExit }: {
  memberIdProp?: number; onComplete?: () => void; onExit?: () => void;
} = {}) {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { user, isAdmin, hasRole } = useAuth();
  const mid = memberIdProp ?? parseInt(memberId ?? "0");

  const [status, setStatus] = useState<TCStatus | null>(null);
  const [sections, setSections] = useState<ConsentSection[]>([]);
  const [handbook, setHandbook] = useState<HandbookLink | null>(null);
  const [responses, setResponses] = useState<ConsentResponses>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const [medicalPhase, setMedicalPhase] = useState(false);
  const [error, setError] = useState("");

  const canSign = isAdmin || hasRole("Admin", "System Administrator") || user?.id === mid;
  const audience = user?.id === mid && user?.member_type === "volunteer" ? "volunteer" : "mentor";

  useEffect(() => {
    api.get(`/api/v1/enrollment/mentor-tc/${mid}`).then((r) => setStatus(r.data)).catch(() => setError("Could not load your T&C status.")).finally(() => setLoading(false));
    enrollmentApi.getConsentSections().then((all) => setSections(all.filter((s) => s.audiences.includes(audience)))).catch(() => setSections([]));
    enrollmentApi.getHandbook().then(setHandbook).catch(() => setHandbook(null));
  }, [mid, audience]);

  async function sign() {
    if (!consentComplete(sections, responses)) { setError("Please complete every required item above before signing."); return; }
    if (!name.trim()) { setError("Please type your full legal name to sign."); return; }
    setError(""); setSigning(true);
    try {
      await api.post(`/api/v1/enrollment/mentor-tc/${mid}/sign`, { enrollment_year: status?.current_year, responses });
      setMedicalPhase(true);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not record your signature. Please try again.");
    } finally { setSigning(false); }
  }

  if (loading) return <div style={s.center}>Loading…</div>;
  if (!status) return <div style={s.center}>{error || "T&C status unavailable."}</div>;

  if (medicalPhase) {
    return (
      <div style={s.page}>
        <div style={s.topBar}>
          <div style={s.trcTitle}>Tulsa Robotics Center</div>
          <div style={s.trcSub}>Medical Consent &amp; Emergency Information — {status.current_year_label}</div>
        </div>
        <div style={s.card}>
          <h2 style={s.heading}>Medical &amp; Emergency Information</h2>
          <p style={s.intro}>Optional but recommended: emergency contact, insurance, allergies, and a treatment authorization for the {status.current_year_label} season.</p>
          <MedicalForm memberId={mid} year={status.current_year} yearLabel={status.current_year_label}
            embedded onSaved={() => setDone(true)} onSkip={() => setDone(true)} />
        </div>
      </div>
    );
  }

  if (done || status.signed_current_year) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: "center" }}>
          <CheckCircle size={60} color="#2e7d32" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ ...s.heading, color: "#2e7d32" }}>Terms &amp; Conditions Signed</h2>
          <p style={s.intro}>Your TRC Terms &amp; Conditions for {status.current_year_label} are on file. Thank you — you&apos;re all set to check in to events.</p>
          <button style={{ ...s.primary, marginTop: 12 }} onClick={() => (onComplete ? onComplete() : navigate("/"))}>
            {onComplete ? "Continue" : "Back to Dashboard"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div style={s.trcTitle}>Tulsa Robotics Center</div>
        <div style={s.trcSub}>{audience === "volunteer" ? "Volunteer" : "Mentor"} Terms &amp; Conditions — {status.current_year_label}</div>
      </div>

      <div style={s.card}>
        <h2 style={s.heading}><FileSignature size={20} style={{ verticalAlign: -3 }} /> Annual Terms &amp; Conditions</h2>
        <p style={s.intro}>Please review and agree to the following for the {status.current_year_label} season. This is renewed each season and is required to check in to events.</p>
        {status.in_grace_period && status.grace_ends && (
          <div style={s.grace}>
            You signed last season&apos;s T&amp;C. Grace period ends {new Date(status.grace_ends + "T00:00:00").toLocaleDateString()}
            {status.grace_days_remaining != null ? ` (${status.grace_days_remaining} day${status.grace_days_remaining !== 1 ? "s" : ""} left)` : ""} — please renew for the new season.
          </div>
        )}

        {canSign ? (
          <>
            {sections.length === 0
              ? <p style={s.intro}>No consent sections are configured for your role yet. Please contact an administrator.</p>
              : <ConsentSections sections={sections} responses={responses} handbook={handbook}
                  onChange={(k, v) => setResponses((r) => ({ ...r, [k]: v }))} />}

            <div style={s.sigBlock}>
              <label style={s.sigLabel}>Type your full legal name to sign electronically:</label>
              <input style={s.sigInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              <p style={s.sigNote}>Date: {new Date().toLocaleDateString()} &nbsp;|&nbsp; Season: {status.current_year_label}</p>
            </div>
            {error && <div style={s.errorBox}>{error}</div>}
            <div style={s.actions}>
              <button style={s.cancel} onClick={() => (onExit ? onExit() : navigate(-1))}>Cancel</button>
              <button style={s.primary} onClick={sign} disabled={signing}>{signing ? "Signing…" : `Sign for ${status.current_year_label}`}</button>
            </div>
          </>
        ) : (
          <div style={s.errorBox}>You don&apos;t have permission to sign this member&apos;s T&amp;C.</div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto" },
  center: { textAlign: "center", padding: "3rem", color: "#888" },
  topBar: { textAlign: "center", marginBottom: 20 },
  trcTitle: { fontSize: 26, fontWeight: 900, color: "#1a3a5c" },
  trcSub: { fontSize: 13, color: "#666", marginTop: 2 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "2rem", marginBottom: 16 },
  heading: { margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#1a3a5c" },
  intro: { fontSize: 14, color: "#555", lineHeight: 1.7, marginBottom: 16 },
  grace: { background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#8a5a00", marginBottom: 16 },
  sigBlock: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem 1.25rem", marginTop: 8, marginBottom: 16 },
  sigLabel: { display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 8 },
  sigInput: { width: "100%", padding: "10px 12px", border: "2px solid #1a3a5c", borderRadius: 6, fontSize: 16, fontFamily: "cursive, serif", boxSizing: "border-box" as const },
  sigNote: { fontSize: 11, color: "#888", marginTop: 8, marginBottom: 0 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 16, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  cancel: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  primary: { padding: "10px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
