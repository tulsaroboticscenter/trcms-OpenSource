import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { api } from "./api";
import { Lock, Eye, EyeOff, CheckCircle, AlertTriangle } from "lucide-react";

export default function ChangePassword() {
  const { user, clearForcePasswordChange } = useAuth();
  const navigate = useNavigate();
  const isForced = user?.force_password_change ?? false;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const rules = [
    { label: "At least 12 characters", ok: next.length >= 12 },
    { label: "Upper and lower case letters", ok: /[a-z]/.test(next) && /[A-Z]/.test(next) },
    { label: "At least one number", ok: /[0-9]/.test(next) },
    { label: "At least one symbol", ok: /[^A-Za-z0-9]/.test(next) },
    { label: "Passwords match", ok: next.length > 0 && next === confirm },
    { label: "Different from current password", ok: next.length > 0 && next !== current },
  ];
  const allRulesPass = rules.every((r) => r.ok);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!allRulesPass) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/api/v1/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      setSuccess(true);
      clearForcePasswordChange();
      // Redirect after a short delay so the success message is visible
      setTimeout(() => navigate("/"), 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to change password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.successIcon}><CheckCircle size={56} color="#2e7d32" /></div>
          <h2 style={styles.successTitle}>Password Changed!</h2>
          <p style={styles.successText}>
            Your password has been updated. Redirecting you to the dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <Lock size={24} color="#1a3a5c" />
          <div>
            <h1 style={styles.heading}>
              {isForced ? "Set Your New Password" : "Change Password"}
            </h1>
            {isForced && (
              <p style={styles.forcedNote}>
                Your account was set up with a temporary password. Please create a new
                password before continuing.
              </p>
            )}
          </div>
        </div>

        {isForced && (
          <div style={styles.forcedBanner}>
            <AlertTriangle size={15} color="#f57c00" />
            <span>
              Your temporary password (sent by email or provided by your administrator)
              was entered as the <strong>Current Password</strong> below.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <Field label="Current Password">
            <div style={styles.pwWrap}>
              <input
                type={showPw ? "text" : "password"}
                style={styles.input}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                autoFocus
                placeholder={isForced ? "Enter your temporary password" : ""}
              />
              <button type="button" style={styles.eyeBtn} onClick={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>

          <Field label="New Password">
            <div style={styles.pwWrap}>
              <input
                type={showPw ? "text" : "password"}
                style={styles.input}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </Field>

          <Field label="Confirm New Password">
            <div style={styles.pwWrap}>
              <input
                type={showPw ? "text" : "password"}
                style={styles.input}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </Field>

          {/* Password rules */}
          <div style={styles.rules}>
            {rules.map((r) => (
              <div key={r.label} style={{ ...styles.rule, color: r.ok ? "#2e7d32" : "#bbb" }}>
                <span style={styles.ruleDot}>{r.ok ? "✓" : "○"}</span>
                {r.label}
              </div>
            ))}
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.actions}>
            {!isForced && (
              <button type="button" onClick={() => navigate(-1)} style={styles.cancelBtn}>
                Cancel
              </button>
            )}
            <button
              type="submit"
              style={{ ...styles.submitBtn, opacity: allRulesPass ? 1 : 0.5 }}
              disabled={!allRulesPass || saving}
            >
              {saving ? "Saving…" : isForced ? "Set New Password & Continue →" : "Change Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8", padding: "1rem" },
  card: { background: "#fff", borderRadius: 14, padding: "2.5rem", width: 440, maxWidth: "100%", boxShadow: "0 4px 24px rgba(0,0,0,0.1)" },
  cardHeader: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  forcedNote: { margin: "4px 0 0", fontSize: 13, color: "#666", lineHeight: 1.5 },
  forcedBanner: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548", marginBottom: 20, lineHeight: 1.6 },
  form: {},
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  pwWrap: { position: "relative" as const },
  input: { width: "100%", padding: "10px 40px 10px 12px", border: "1px solid #ccc", borderRadius: 7, fontSize: 15, boxSizing: "border-box" as const },
  eyeBtn: { position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex" },
  rules: { display: "flex", flexDirection: "column", gap: 5, background: "#f8fafc", borderRadius: 8, padding: "12px 14px", marginBottom: 16 },
  rule: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 },
  ruleDot: { fontSize: 14, fontWeight: 900, width: 16, flexShrink: 0 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", marginBottom: 14, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  cancelBtn: { padding: "10px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 7, cursor: "pointer", fontSize: 14 },
  submitBtn: { padding: "11px 24px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 14 },
  successIcon: { textAlign: "center" as const, marginBottom: 16 },
  successTitle: { margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#2e7d32", textAlign: "center" as const },
  successText: { color: "#555", textAlign: "center" as const, lineHeight: 1.6 },
};
