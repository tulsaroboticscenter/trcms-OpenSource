import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/api/v1/auth/forgot-password", { email });
      setDevLink(data?.dev_reset_link ?? null);
      setSent(true);
    } catch {
      setSent(true); // never reveal whether the email exists
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Reset your password</h2>
        {sent ? (
          <>
            <p style={styles.msg}>
              If an account matches, we&apos;ve sent a password reset link to the
              email address on file. It expires in one hour. Check your inbox (and
              spam folder).
            </p>
            {devLink && (
              <p style={styles.dev}>
                Dev link: <a href={devLink}>{devLink}</a>
              </p>
            )}
            <Link to="/login" style={styles.back}>← Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={styles.sub}>Enter your email address <strong>or</strong> username and we&apos;ll send a reset link to the email on your account.</p>
            <label style={styles.label}>Email or username</label>
            <input
              style={styles.input}
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="you@example.com or your username"
              required
            />
            <button type="submit" style={styles.button} disabled={loading || !email}>
              {loading ? "Sending…" : "Send reset link"}
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
  card: { background: "#fff", borderRadius: 12, padding: "2.5rem", width: 380, boxShadow: "0 4px 24px rgba(0,0,0,0.1)" },
  title: { margin: "0 0 6px", color: "#1a3a5c", fontSize: 22 },
  sub: { color: "#666", fontSize: 14, marginBottom: 16 },
  msg: { color: "#333", fontSize: 14, lineHeight: 1.5 },
  dev: { background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 6, padding: "8px 10px", fontSize: 12, wordBreak: "break-all" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4, marginTop: 8 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 15, boxSizing: "border-box" },
  button: { marginTop: 20, width: "100%", padding: "12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  links: { marginTop: 16, textAlign: "center", fontSize: 13 },
  link: { color: "#1565c0", textDecoration: "none" },
  back: { display: "inline-block", marginTop: 16, color: "#1565c0", textDecoration: "none", fontSize: 13 },
};
