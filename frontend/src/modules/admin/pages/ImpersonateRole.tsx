import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi, type SystemRole } from "../api";
import { ArrowLeft, Eye, AlertTriangle, CheckCircle, LogOut } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

export default function ImpersonateRole() {
  const navigate = useNavigate();
  const goBack = useGoBack("/admin");
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [selected, setSelected] = useState("");
  const [impersonating, setImpersonating] = useState<string | null>(
    localStorage.getItem("trc_impersonating")
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    adminApi.listRoles().then((r) => setRoles(r.filter((role) => role.is_active)));
  }, []);

  async function startImpersonation() {
    if (!selected) return;
    setLoading(true); setError("");
    try {
      const result = await adminApi.impersonate(selected);
      // Save real token, swap in impersonation token
      localStorage.setItem("trc_real_token", localStorage.getItem("trc_token") ?? "");
      localStorage.setItem("trc_token", result.access_token);
      localStorage.setItem("trc_impersonating", result.impersonating);
      setImpersonating(result.impersonating);
      navigate("/");  // go to dashboard to see it as that role
    } catch {
      setError("Failed to start impersonation.");
    } finally { setLoading(false); }
  }

  function stopImpersonation() {
    const realToken = localStorage.getItem("trc_real_token");
    if (realToken) localStorage.setItem("trc_token", realToken);
    localStorage.removeItem("trc_real_token");
    localStorage.removeItem("trc_impersonating");
    setImpersonating(null);
    navigate("/admin");
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={styles.heading}>Role Impersonation</h1>
        <p style={styles.sub}>
          Switch into any system role to verify what members of that role can see and do.
          Your real admin session is preserved — switch back at any time.
        </p>
      </div>

      {impersonating ? (
        <div style={styles.activeCard}>
          <div style={styles.activeHeader}>
            <Eye size={20} color="#6a1b9a" />
            <div>
              <div style={styles.activeTitle}>Currently impersonating: <strong>{impersonating}</strong></div>
              <div style={styles.activeSub}>You are viewing the system as a <strong>{impersonating}</strong> would see it.</div>
            </div>
          </div>
          <div style={styles.activeActions}>
            <button style={styles.dashboardBtn} onClick={() => navigate("/")}>
              Go to Dashboard →
            </button>
            <button style={styles.stopBtn} onClick={stopImpersonation}>
              <LogOut size={14} /> Stop Impersonating
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.card}>
          <div style={styles.warningBox}>
            <AlertTriangle size={14} />
            <span>
              While impersonating, the system will behave as if you have <em>only</em> the selected role.
              Admin capabilities will be hidden. Navigate normally to test the experience.
            </span>
          </div>

          <label style={styles.label}>Select a role to impersonate:</label>
          <div style={styles.roleGrid}>
            {roles.map((r) => (
              <label key={r.id} style={{ ...styles.roleOption, ...(selected === r.name ? styles.roleOptionSelected : {}) }}>
                <input type="radio" name="role" value={r.name}
                  checked={selected === r.name} onChange={() => setSelected(r.name)}
                  style={{ display: "none" }} />
                <div style={styles.roleOptionName}>{r.name}</div>
                {r.description && <div style={styles.roleOptionDesc}>{r.description}</div>}
                <div style={styles.roleOptionCount}>{r.member_count} member{r.member_count !== 1 ? "s" : ""}</div>
              </label>
            ))}
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button style={{ ...styles.startBtn, opacity: !selected ? 0.6 : 1 }}
            onClick={startImpersonation} disabled={!selected || loading}>
            {loading ? "Starting…" : `Impersonate "${selected || "…"}" →`}
          </button>
        </div>
      )}

      <div style={styles.infoBox}>
        <CheckCircle size={14} color="#2e7d32" />
        <div>
          <strong>How it works:</strong> Impersonation issues a short-lived token scoped to the selected role.
          Your real admin token is saved in the browser and restored when you stop impersonating.
          All actions taken while impersonating are recorded in the audit log with a note that they were performed by an admin in test mode.
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 680, margin: "0 auto" },
  header: { marginBottom: 24 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#666", lineHeight: 1.6 },
  activeCard: { background: "#f3e5f5", border: "2px solid #ce93d8", borderRadius: 12, padding: "1.5rem", marginBottom: 16 },
  activeHeader: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 },
  activeTitle: { fontSize: 16, color: "#4a148c", marginBottom: 4 },
  activeSub: { fontSize: 13, color: "#7b1fa2" },
  activeActions: { display: "flex", gap: 10 },
  dashboardBtn: { padding: "10px 20px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  stopBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "#fff", border: "1px solid #ce93d8", color: "#6a1b9a", borderRadius: 7, cursor: "pointer", fontSize: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", marginBottom: 16 },
  warningBox: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548", marginBottom: 20, lineHeight: 1.6 },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#555", marginBottom: 10 },
  roleGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 },
  roleOption: { padding: "12px 14px", border: "2px solid #e2e8f0", borderRadius: 8, cursor: "pointer", background: "#fafafa" },
  roleOptionSelected: { borderColor: "#6a1b9a", background: "#f3e5f5" },
  roleOptionName: { fontWeight: 700, fontSize: 14, color: "#1a3a5c", marginBottom: 2 },
  roleOptionDesc: { fontSize: 12, color: "#888", marginBottom: 3 },
  roleOptionCount: { fontSize: 11, color: "#aaa" },
  error: { fontSize: 12, color: "#c62828", marginBottom: 8 },
  startBtn: { width: "100%", padding: "12px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 15 },
  infoBox: { display: "flex", gap: 10, padding: "14px 16px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 10, fontSize: 13, color: "#2e7d32", lineHeight: 1.6 },
};
