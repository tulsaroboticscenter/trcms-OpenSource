import { useState, type FormEvent } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { api } from "./api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const rules = [
    { label: "At least 12 characters", ok: next.length >= 12 },
    { label: "Upper and lower case letters", ok: /[a-z]/.test(next) && /[A-Z]/.test(next) },
    { label: "At least one number", ok: /[0-9]/.test(next) },
    { label: "At least one symbol", ok: /[^A-Za-z0-9]/.test(next) },
    { label: "Passwords match", ok: next.length > 0 && next === confirm },
  ];
  const allOk = rules.every((r) => r.ok);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/api/v1/auth/reset-password", { token, new_password: next });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Could not reset your password. The link may have expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Set a new password</h2>
        {!token ? (
          <p style={styles.error}>This reset link is missing its token. Please request a new one from the <Link to="/forgot-password">Forgot password</Link> page.</p>
        ) : done ? (
          <p style={styles.msg}>Your password has been reset. Redirecting you to sign in…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={styles.label}>New password</label>
            <input type="password" style={styles.input} value={next} onChange={(e) => setNext(e.target.value)} autoFocus autoComplete="new-password" />
            <label style={styles.label}>Confirm new password</label>
            <input type="password" style={styles.input} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            <ul style={styles.rules}>
              {rules.map((r) => (
                <li key={r.label} style={{ color: r.ok ? "#1b7f3b" : "#999" }}>{r.ok ? "✓" : "○"} {r.label}</li>
              ))}
            </ul>
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" style={styles.button} disabled={loading || !allOk}>
              {loading ? "Resetting…" : "Reset password"}
            </button>
            <div style={styles.links}><Link to="/login" style={styles.link}>Back to sign in</Link></div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8" },
  card: { background: "#fff", borderRadius: 12, padding: "2.5rem", width: 400, boxShadow: "0 4px 24px rgba(0,0,0,0.1)" },
  title: { margin: "0 0 12px", color: "#1a3a5c", fontSize: 22 },
  msg: { color: "#333", fontSize: 14, lineHeight: 1.5 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4, marginTop: 12 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 15, boxSizing: "border-box" },
  rules: { listStyle: "none", padding: 0, margin: "14px 0 0", fontSize: 13, lineHeight: 1.7 },
  error: { color: "#c0392b", fontSize: 13, marginTop: 8 },
  button: { marginTop: 18, width: "100%", padding: "12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  links: { marginTop: 16, textAlign: "center", fontSize: 13 },
  link: { color: "#1565c0", textDecoration: "none" },
};
