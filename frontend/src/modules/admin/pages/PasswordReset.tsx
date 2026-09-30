import { useState, type FormEvent } from "react";
import { adminApi } from "../api";
import { api } from "../../../core/api";
import { ArrowLeft, Key, CheckCircle, Eye, EyeOff } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface MemberResult { id: number; first_name: string; last_name: string; member_number: string; member_type: string; }

export default function PasswordReset() {
  const goBack = useGoBack("/admin");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MemberResult[]>([]);
  const [selected, setSelected] = useState<MemberResult | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function doSearch() {
    if (!search.trim()) return;
    const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(search)}&limit=10`);
    setResults(data.members);
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError("Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.");
      return;
    }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setError(""); setSaving(true);
    try {
      await adminApi.resetPassword(selected.id, password);
      setSuccess(`Password reset for ${selected.first_name} ${selected.last_name}.`);
      setPassword(""); setConfirm(""); setSelected(null); setResults([]);
    } catch {
      setError("Failed to reset password.");
    } finally { setSaving(false); }
  }

  const TYPE_COLORS: Record<string, string> = {
    youth: "#1565c0", mentor: "#2e7d32", parent: "#e65100", volunteer: "#6a1b9a",
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={styles.heading}>Password Reset</h1>
        <p style={styles.sub}>Reset any member's password. They should change it on their next login.</p>
      </div>

      {success && (
        <div style={styles.successBox}>
          <CheckCircle size={16} color="#2e7d32" />
          {success}
        </div>
      )}

      {/* Step 1 — Find member */}
      <div style={styles.card}>
        <div style={styles.cardTitle}>Step 1 — Find the Member</div>
        <div style={styles.searchRow}>
          <input style={{ ...styles.input, flex: 1 }}
            placeholder="Search by name, email, or member number…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()} />
          <button style={styles.searchBtn} onClick={doSearch}>Search</button>
        </div>
        {results.map((m) => (
          <div key={m.id}
            style={{ ...styles.resultRow, ...(selected?.id === m.id ? styles.resultRowSelected : {}) }}
            onClick={() => { setSelected(m); setSuccess(""); setError(""); }}
          >
            <div style={styles.avatar}>{m.first_name[0]}{m.last_name[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={styles.memberName}>{m.first_name} {m.last_name}</div>
              <div style={styles.memberMeta}>#{m.member_number}</div>
            </div>
            <span style={{ ...styles.typeBadge, background: TYPE_COLORS[m.member_type] ?? "#888" }}>
              {m.member_type}
            </span>
            {selected?.id === m.id && <CheckCircle size={16} color="#2e7d32" />}
          </div>
        ))}
      </div>

      {/* Step 2 — Set password */}
      {selected && (
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            Step 2 — Set New Password for {selected.first_name} {selected.last_name}
          </div>
          <form onSubmit={handleReset}>
            <div style={styles.pwRow}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>New Password</label>
                <div style={styles.pwWrap}>
                  <input
                    type={showPw ? "text" : "password"}
                    style={{ ...styles.input, paddingRight: 40 }}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password" placeholder="12+ chars · upper, lower, number, symbol"
                  />
                  <button type="button" style={styles.eyeBtn} onClick={() => setShowPw(!showPw)}>
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Confirm Password</label>
                <input
                  type={showPw ? "text" : "password"}
                  style={styles.input} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div style={styles.strengthRow}>
              {["Length ≥ 8", "Upper & lower", "Number"].map((rule, i) => {
                const ok = i === 0 ? password.length >= 8
                  : i === 1 ? /[a-z]/.test(password) && /[A-Z]/.test(password)
                  : /[0-9]/.test(password);
                return (
                  <span key={rule} style={{ ...styles.rule, color: ok ? "#2e7d32" : "#ccc" }}>
                    {ok ? "✓" : "○"} {rule}
                  </span>
                );
              })}
            </div>

            {error && <p style={styles.error}>{error}</p>}

            <div style={styles.actions}>
              <button type="button" onClick={() => { setSelected(null); setPassword(""); setConfirm(""); }} style={styles.cancelBtn}>
                Cancel
              </button>
              <button type="submit" style={styles.resetBtn} disabled={saving}>
                <Key size={14} /> {saving ? "Resetting…" : "Reset Password"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 640, margin: "0 auto" },
  header: { marginBottom: 24 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#888" },
  successBox: { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 9, fontSize: 14, color: "#2e7d32", marginBottom: 16 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 12 },
  searchRow: { display: "flex", gap: 8, marginBottom: 10 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  searchBtn: { padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" as const },
  resultRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 7, marginBottom: 4, cursor: "pointer" },
  resultRowSelected: { border: "2px solid #2e7d32", background: "#f1f8f2" },
  avatar: { width: 34, height: 34, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  memberName: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  memberMeta: { fontSize: 12, color: "#aaa" },
  typeBadge: { padding: "2px 8px", borderRadius: 10, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  pwRow: { display: "flex", gap: 12, marginBottom: 10 },
  pwWrap: { position: "relative" as const },
  eyeBtn: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex" },
  strengthRow: { display: "flex", gap: 16, marginBottom: 14 },
  rule: { fontSize: 12, fontWeight: 600 },
  error: { fontSize: 12, color: "#c62828", marginBottom: 8 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  resetBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#e65100", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
