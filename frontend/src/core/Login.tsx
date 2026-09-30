import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function Login() {
  const { login, branding } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Default ON: the typical member wants to stay signed in (3-day sliding session). Someone
  // on a shared/public computer can untick it for a short (same-day) session.
  const [remember, setRemember] = useState(true);
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await login(username, password, needCode ? code : undefined, remember);
      if (res === "2fa") {
        // Password was correct; this account has 2FA — ask for the code.
        setNeedCode(true);
        setError("");
      }
      // On success, setUser re-renders the /login route, which redirects the
      // user back to the page they originally requested (see AppRoutes).
    } catch (err: unknown) {
      const twoFA = (err as { response?: { data?: { two_factor_required?: boolean; error?: string } } })?.response?.data;
      if (twoFA?.two_factor_required) {
        setNeedCode(true);
        setError(twoFA.error ?? "Enter the 6-digit code from your authenticator app.");
      } else {
        setError(needCode ? "That code didn't work. Try again." : "Invalid username or password.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoText}>{branding.short_name}</span>
          <span style={styles.logoSub}>{branding.tagline}</span>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
          <label style={styles.label}>Password</label>
          <input
            type="password"
            style={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={needCode}
          />
          {needCode && (
            <>
              <label style={styles.label}>Authentication code</label>
              <input
                style={styles.input}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9a-fA-F]/g, ""))}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code or a backup code"
              />
            </>
          )}
          {!needCode && (
            <label style={styles.remember}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep me logged in
            </label>
          )}
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Signing in…" : needCode ? "Verify" : "Sign In"}
          </button>
        </form>
        <div style={styles.links}>
          <Link to="/forgot-password" style={styles.link}>Forgot password?</Link>
          <span style={styles.dot}>·</span>
          <Link to="/forgot-username" style={styles.link}>Forgot username?</Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8" },
  card: { background: "#fff", borderRadius: 12, padding: "2.5rem", width: 360, boxShadow: "0 4px 24px rgba(0,0,0,0.1)" },
  logo: { textAlign: "center", marginBottom: "2rem" },
  logoText: { fontSize: 48, fontWeight: 900, color: "#1a3a5c", display: "block" },
  logoSub: { fontSize: 13, color: "#666", letterSpacing: 1 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 4, marginTop: 16 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc", fontSize: 15, boxSizing: "border-box" },
  remember: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#445", marginTop: 16, cursor: "pointer" },
  error: { color: "#c0392b", fontSize: 13, marginTop: 8 },
  button: { marginTop: 24, width: "100%", padding: "12px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  links: { marginTop: 18, textAlign: "center", fontSize: 13 },
  link: { color: "#1565c0", textDecoration: "none" },
  dot: { color: "#bbb", margin: "0 8px" },
};
