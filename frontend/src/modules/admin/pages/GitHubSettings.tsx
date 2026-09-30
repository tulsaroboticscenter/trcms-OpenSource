import { useState, useEffect, useCallback } from "react";
import { adminApi, type GithubSettings as GithubSettingsT } from "../api";
import { GitBranch, ArrowLeft } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

interface Form { owner: string; repo: string; project_number: string; token: string }

export default function GitHubSettings() {
  const goBack = useGoBack("/admin");
  const [current, setCurrent] = useState<GithubSettingsT | null>(null);
  const [f, setF] = useState<Form>({ owner: "", repo: "", project_number: "", token: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearToken, setClearToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    const s = await adminApi.getGithubSettings().catch(() => null);
    if (s) { setCurrent(s); setF({ owner: s.owner, repo: s.repo, project_number: s.project_number, token: "" }); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof Form, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const payload: Record<string, unknown> = { owner: f.owner.trim(), repo: f.repo.trim(), project_number: f.project_number.trim() };
      if (clearToken) payload.clear_token = true;
      else if (f.token.trim()) payload.token = f.token.trim();
      const s = await adminApi.saveGithubSettings(payload);
      setCurrent(s); setF((p) => ({ ...p, token: "" })); setClearToken(false); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try { setTestResult(await adminApi.testGithub()); }
    finally { setTesting(false); }
  }

  if (loading) return <div style={st.muted}>Loading…</div>;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Admin</button>
      <h1 style={st.heading}><GitBranch size={20} style={{ verticalAlign: -3 }} /> GitHub Integration</h1>
      <p style={st.sub}>
        Connect TRCMS to GitHub so you can push a feedback item to an Issue on your development
        Project board with one click. Needs a fine-grained token with <b>Issues: Read &amp; Write</b>
        {" "}and (for the board) <b>Projects: Read &amp; Write</b> on the org's repos.
      </p>

      <div style={st.card}>
        <label style={st.l}>Organization (owner)</label>
        <input style={st.input} value={f.owner} onChange={(e) => set("owner", e.target.value)} placeholder="Tulsa-Robotics-Center" />

        <label style={st.l}>Default repository</label>
        <input style={st.input} value={f.repo} onChange={(e) => set("repo", e.target.value)} placeholder="trcms-backend" />
        <p style={st.hint}>Issues created from feedback will be filed here.</p>

        <label style={st.l}>Project number (optional)</label>
        <input style={st.input} value={f.project_number} onChange={(e) => set("project_number", e.target.value)} placeholder="e.g. 1" />
        <p style={st.hint}>The number in your org Project's URL (…/orgs/&lt;org&gt;/projects/<b>1</b>). Leave blank to create issues without adding them to a board.</p>

        <label style={st.l}>Access token</label>
        <input style={st.input} type="password" value={f.token} onChange={(e) => set("token", e.target.value)}
          placeholder={current?.has_token ? "•••••••• (saved — leave blank to keep)" : "github_pat_…"} disabled={clearToken} />
        {current?.has_token && (
          <label style={st.check}>
            <input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} /> Clear the saved token
          </label>
        )}
        <p style={st.hint}>Write-only — the token is never shown back. {current?.has_token ? "A token is currently saved." : "No token saved yet."}</p>

        <div style={st.actions}>
          <button style={st.testBtn} onClick={test} disabled={testing || !current?.has_token}>{testing ? "Testing…" : "Test connection"}</button>
          <div style={{ flex: 1 }} />
          {saved && <span style={st.savedMsg}>Saved ✓</span>}
          <button style={st.saveBtn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>

        {testResult && (
          <div style={{ ...st.result, ...(testResult.ok ? st.ok : st.err) }}>
            {testResult.ok ? "✓ " : "✕ "}{testResult.message}
          </div>
        )}
      </div>

      <p style={st.foot}>
        Once configured, open any feedback item and use <b>“Send to GitHub”</b> to create the Issue.
      </p>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 640, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  heading: { margin: "0 0 4px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "0 0 16px", fontSize: 13, color: "#777", lineHeight: 1.5 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.25rem 1.5rem" },
  l: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", margin: "12px 0 4px" },
  input: { width: "100%", padding: "9px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  hint: { fontSize: 11, color: "#999", margin: "4px 0 0", lineHeight: 1.5 },
  check: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#c62828", marginTop: 6 },
  actions: { display: "flex", alignItems: "center", gap: 10, marginTop: 18 },
  testBtn: { padding: "9px 16px", background: "#fff", color: "#1565c0", border: "1px solid #cfe0f3", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  savedMsg: { color: "#2e7d32", fontSize: 13, fontWeight: 600 },
  result: { marginTop: 14, padding: "10px 12px", borderRadius: 6, fontSize: 13 },
  ok: { background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7" },
  err: { background: "#fdeaea", color: "#c62828", border: "1px solid #f3c0c0" },
  muted: { color: "#888", fontSize: 14 },
  foot: { fontSize: 12, color: "#999", marginTop: 14 },
};
