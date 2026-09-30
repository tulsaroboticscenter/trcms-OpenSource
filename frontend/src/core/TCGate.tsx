/**
 * TCGate — blocks the portal until the member agrees to the TRC Terms & Conditions.
 *
 * Shown (full-screen, replacing the app) whenever the logged-in member is required
 * to agree to T&C and hasn't. The member must either complete the agreement or be
 * logged out — there is no way past it.
 *
 *   Youth  → the enrollment T&C signing flow (youth + parent signatures).
 *   Mentor → the annual T&C agreement (single signature).
 *
 * Exiting / cancelling the process logs the member out.
 */
import { useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { api } from "./api";
import { ShieldAlert, LogOut, CheckCircle } from "lucide-react";
import TCSign from "../modules/enrollment/pages/TCSign";
import MentorTCSign from "../modules/enrollment/pages/MentorTCSign";

interface GateInfo {
  required: boolean;
  member_type: string;
  enrollment_id: number | null;
  can_self_resolve: boolean;
  year_label: string;
}

export default function TCGate() {
  const { user, logout, refreshUser } = useAuth();
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    api.get("/api/v1/enrollment/my-tc-gate").then((r) => setGate(r.data)).catch(() => setGate(null));
  }, []);

  async function finishAndRefresh() {
    // Re-fetch the user so the surrounding gate condition clears and the app loads.
    await refreshUser();
  }

  if (!gate) return <div style={st.page}><p style={{ color: "#888" }}>Loading…</p></div>;

  // ── Started: render the actual signing flow ──
  if (started) {
    if (gate.member_type === "youth" && gate.enrollment_id) {
      return (
        <div style={st.page}>
          <div style={st.signWrap}>
            <TCSign enrollmentIdProp={gate.enrollment_id} onComplete={finishAndRefresh} onExit={logout} />
            <div style={{ textAlign: "center" }}>
              <button style={st.logoutLink} onClick={logout}><LogOut size={13} /> Cancel &amp; Log Out</button>
            </div>
          </div>
        </div>
      );
    }
    // Mentor / volunteer annual agreement — the full flow that renders the
    // configured consent sections and records a response to each. (A hand-rolled
    // inline card here used to POST an empty body, which the backend rejects when
    // any mentor-audience section is required — leaving the signer stuck.)
    return (
      <div style={st.page}>
        <div style={st.signWrap}>
          <MentorTCSign memberIdProp={user!.id} onComplete={finishAndRefresh} onExit={logout} />
          <div style={{ textAlign: "center" }}>
            <button style={st.logoutLink} onClick={logout}><LogOut size={13} /> Cancel &amp; Log Out</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Intro: the message they see first ──
  return (
    <div style={st.page}>
      <div style={st.card}>
        <div style={st.iconWrap}><ShieldAlert size={40} color="#e65100" /></div>
        <h2 style={st.heading}>Agreement Required</h2>
        <p style={st.body}>
          Before you can use the TRC portal, you must read and agree to the
          <strong> Terms &amp; Conditions</strong> for the {gate.year_label} season.
        </p>
        {gate.can_self_resolve ? (
          <>
            <p style={st.subBody}>Click below to review and agree. If you exit without agreeing, you'll be logged out.</p>
            <div style={st.actions}>
              <button style={st.logoutBtn} onClick={logout}><LogOut size={14} /> Log Out</button>
              <button style={st.primaryBtn} onClick={() => setStarted(true)}>
                <CheckCircle size={14} /> Review &amp; Agree to Terms
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={st.subBody}>
              You don't have an active enrollment for this season yet, so there's nothing to sign.
              Please contact a TRC admin to be enrolled, then log back in.
            </p>
            <div style={st.actions}>
              <button style={st.primaryBtn} onClick={logout}><LogOut size={14} /> Log Out</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8", padding: 20 },
  signWrap: { width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", gap: 8 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "2rem 2.25rem", maxWidth: 560, width: "100%", textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.08)" },
  iconWrap: { width: 72, height: 72, borderRadius: "50%", background: "#fff3e0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" },
  heading: { margin: "0 0 10px", fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  body: { fontSize: 15, color: "#444", lineHeight: 1.6, margin: "0 0 8px" },
  subBody: { fontSize: 13, color: "#777", lineHeight: 1.6, margin: "0 0 20px" },
  handbook: { textAlign: "left", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px", fontSize: 13, color: "#444", lineHeight: 1.6, maxHeight: 240, overflowY: "auto", margin: "0 0 16px" },
  ackRow: { display: "flex", alignItems: "flex-start", gap: 10, textAlign: "left", fontSize: 14, color: "#333", marginBottom: 14, cursor: "pointer" },
  sigLabel: { display: "block", textAlign: "left", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 6 },
  sigInput: { width: "100%", padding: "10px 12px", border: "2px solid #1a3a5c", borderRadius: 6, fontSize: 16, fontFamily: "cursive, serif", boxSizing: "border-box", marginBottom: 14 },
  error: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "8px 12px", color: "#c62828", fontSize: 13, marginBottom: 14, textAlign: "left" },
  actions: { display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" },
  primaryBtn: { display: "flex", alignItems: "center", gap: 7, padding: "11px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  logoutBtn: { display: "flex", alignItems: "center", gap: 7, padding: "11px 20px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  logoutLink: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, padding: "8px 0", textDecoration: "underline" },
};
