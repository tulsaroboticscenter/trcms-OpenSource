/**
 * First-run setup wizard (open-source Phase 1, web half).
 * Full-screen, admins only. Appears after `php bin/install.php` bootstraps the
 * database and the System Administrator signs in (setup_complete=false). Walks
 * through organization identity, email (SMTP) + test, module selection, and cron
 * instructions, then flips setup_complete so the app opens normally.
 *
 * Self-contained by necessity: while setup is incomplete the app routes admins
 * here, so it can't link out to the normal admin pages.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./AuthContext";
import { CheckCircle2, Circle, Loader2, Send, Copy, ArrowRight, ArrowLeft } from "lucide-react";

const STEPS = ["Welcome", "Organization", "Email", "Modules", "Cron jobs", "Finish"];

interface Mod { key: string; label: string; group: string; core: boolean; deps: string[]; enabled: boolean }
interface CronJob { description: string; schedule: string; command: string; crontab: string }

export default function Setup() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Organization
  const [org, setOrg] = useState({ name: "", short_name: "", tagline: "", website: "", timezone: "America/Chicago", contact_email: "" });
  // Email
  const [smtp, setSmtp] = useState({ host: "", port: "587", user: "", pass: "", encryption: "tls", from: "" });
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("");
  // Modules
  const [mods, setMods] = useState<Mod[]>([]);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  // Cron
  const [cron, setCron] = useState<{ php_binary: string; jobs: CronJob[] }>({ php_binary: "", jobs: [] });

  useEffect(() => {
    api.get("/api/v1/setup/status").then((r) => {
      const o = r.data?.org ?? {};
      setOrg((prev) => ({ ...prev, ...o, name: o.name ?? prev.name }));
      if (!o.contact_email && r.data?.app_url) { /* leave */ }
    }).catch(() => {});
  }, []);

  // Lazy-load per step
  useEffect(() => {
    if (step === 2 && !smtp.host) {
      api.get("/api/v1/admin/email-settings").then((r) => {
        const d = r.data ?? {};
        setSmtp((s) => ({ ...s, host: d.host ?? "", port: String(d.port ?? "587"), user: d.user ?? "", encryption: d.encryption ?? "tls", from: d.from ?? "" }));
      }).catch(() => {});
    }
    if (step === 3 && mods.length === 0) {
      api.get("/api/v1/modules").then((r) => {
        const list: Mod[] = r.data?.modules ?? [];
        setMods(list);
        setDisabled(new Set(list.filter((m) => !m.enabled).map((m) => m.key)));
      }).catch(() => {});
    }
    if (step === 4 && cron.jobs.length === 0) {
      api.get("/api/v1/setup/cron").then((r) => setCron({ php_binary: r.data?.php_binary ?? "", jobs: r.data?.jobs ?? [] })).catch(() => {});
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const order: string[] = []; const by = new Map<string, Mod[]>();
    for (const m of mods) { if (!by.has(m.group)) { by.set(m.group, []); order.push(m.group); } by.get(m.group)!.push(m); }
    return order.map((g) => ({ group: g, items: by.get(g)! }));
  }, [mods]);

  async function saveOrg() {
    if (!org.name.trim()) { setErr("Organization name is required."); return false; }
    setBusy(true); setErr("");
    try { await api.put("/api/v1/setup/org", org); return true; }
    catch (e: unknown) { setErr(errMsg(e)); return false; }
    finally { setBusy(false); }
  }
  async function saveSmtp() {
    setBusy(true); setErr("");
    try { await api.put("/api/v1/admin/email-settings", { ...smtp, port: Number(smtp.port) || 587 }); return true; }
    catch (e: unknown) { setErr(errMsg(e)); return false; }
    finally { setBusy(false); }
  }
  async function sendTest() {
    setTestMsg(""); setBusy(true);
    try {
      await api.put("/api/v1/admin/email-settings", { ...smtp, port: Number(smtp.port) || 587 });
      const r = await api.post("/api/v1/admin/email-settings/test", { to: testTo || org.contact_email });
      setTestMsg(r.data?.ok ? `Sent a test email to ${r.data.to}.` : `Failed: ${r.data?.error ?? "unknown error"}`);
    } catch (e: unknown) { setTestMsg("Failed: " + errMsg(e)); }
    finally { setBusy(false); }
  }
  async function saveModules() {
    setBusy(true); setErr("");
    try { await api.put("/api/v1/modules", { disabled: [...disabled] }); return true; }
    catch (e: unknown) { setErr(errMsg(e)); return false; }
    finally { setBusy(false); }
  }
  async function finish() {
    setBusy(true); setErr("");
    try {
      await api.post("/api/v1/setup/complete");
      await refreshUser();
      navigate("/", { replace: true });
    } catch (e: unknown) { setErr(errMsg(e)); setBusy(false); }
  }

  async function next() {
    if (step === 1 && !(await saveOrg())) return;
    if (step === 2 && smtp.host && !(await saveSmtp())) return; // only save if they entered a host
    if (step === 3 && !(await saveModules())) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.stepper}>
          {STEPS.map((label, i) => (
            <div key={label} style={s.stepItem}>
              {i < step ? <CheckCircle2 size={16} color="#0b5c4f" /> : i === step ? <Circle size={16} color="#0b5c4f" fill="#d4ede7" /> : <Circle size={16} color="#cdd7e3" />}
              <span style={{ ...s.stepLabel, color: i === step ? "#1a2634" : i < step ? "#0b5c4f" : "#9aa7b4", fontWeight: i === step ? 700 : 500 }}>{label}</span>
            </div>
          ))}
        </div>

        <div style={s.body}>
          {err && <div style={s.err}>{err}</div>}

          {step === 0 && (
            <>
              <h1 style={s.h1}>Welcome to TRCMS</h1>
              <p style={s.p}>Your database is set up and you're signed in as the System Administrator. A few quick steps and you're ready to go:</p>
              <ul style={s.ul}>
                <li>Name your organization</li>
                <li>Connect email (so the system can send invitations and reminders)</li>
                <li>Choose which modules to turn on</li>
                <li>Set up the background jobs (cron)</li>
              </ul>
              <p style={s.hint}>You can change any of this later in the Admin console.</p>
            </>
          )}

          {step === 1 && (
            <>
              <h1 style={s.h1}>Organization</h1>
              <Field label="Organization name *"><input style={s.input} value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} placeholder="Example Robotics" /></Field>
              <div style={s.grid2}>
                <Field label="Short name / wordmark"><input style={s.input} value={org.short_name} onChange={(e) => setOrg({ ...org, short_name: e.target.value })} placeholder="e.g. ERO (defaults to initials)" /></Field>
                <Field label="Tagline"><input style={s.input} value={org.tagline} onChange={(e) => setOrg({ ...org, tagline: e.target.value })} placeholder="Program Management System" /></Field>
              </div>
              <Field label="Public website"><input style={s.input} value={org.website} onChange={(e) => setOrg({ ...org, website: e.target.value })} placeholder="https://example.org" /></Field>
              <Field label="Contact / reply-to email"><input style={s.input} value={org.contact_email} onChange={(e) => setOrg({ ...org, contact_email: e.target.value })} placeholder="info@example.org" /></Field>
              <Field label="Timezone"><input style={s.input} value={org.timezone} onChange={(e) => setOrg({ ...org, timezone: e.target.value })} placeholder="America/Chicago" /></Field>
            </>
          )}

          {step === 2 && (
            <>
              <h1 style={s.h1}>Email (SMTP)</h1>
              <p style={s.p}>Connect an outbound mail server so TRCMS can send invitations, reminders and notifications. You can skip this and set it up later.</p>
              <div style={s.grid2}>
                <Field label="SMTP host"><input style={s.input} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.org" /></Field>
                <Field label="Port"><input style={s.input} value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} placeholder="587" /></Field>
                <Field label="Username"><input style={s.input} value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} /></Field>
                <Field label="Password"><input style={s.input} type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} /></Field>
                <Field label="Encryption">
                  <select style={s.input} value={smtp.encryption} onChange={(e) => setSmtp({ ...smtp, encryption: e.target.value })}>
                    <option value="tls">TLS (STARTTLS)</option><option value="ssl">SSL</option><option value="none">None</option>
                  </select>
                </Field>
                <Field label="From address"><input style={s.input} value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="no-reply@example.org" /></Field>
              </div>
              <div style={s.testRow}>
                <input style={{ ...s.input, maxWidth: 240 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send a test to…" />
                <button style={s.ghost} onClick={sendTest} disabled={busy || !smtp.host}><Send size={14} /> Send test</button>
              </div>
              {testMsg && <div style={testMsg.startsWith("Sent") ? s.ok : s.err}>{testMsg}</div>}
            </>
          )}

          {step === 3 && (
            <>
              <h1 style={s.h1}>Modules</h1>
              <p style={s.p}>Turn on the features your organization will use. Core features are always on; dependencies are handled automatically. You can change these anytime in Admin → Modules.</p>
              {groups.map(({ group, items }) => (
                <div key={group} style={s.modGroup}>
                  <div style={s.modGroupLabel}>{group}</div>
                  {items.map((m) => {
                    const on = !disabled.has(m.key);
                    return (
                      <label key={m.key} style={s.modRow}>
                        <input type="checkbox" checked={on} disabled={m.core || busy}
                          onChange={() => setDisabled((prev) => { const n = new Set(prev); on ? n.add(m.key) : n.delete(m.key); return n; })} />
                        <span>{m.label}</span>{m.core && <span style={s.badge}>always on</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </>
          )}

          {step === 4 && (
            <>
              <h1 style={s.h1}>Background jobs (cron)</h1>
              <p style={s.p}>Add these to your server's crontab so reminders and notifications run automatically. Detected PHP: <code style={s.code}>{cron.php_binary}</code></p>
              <div style={s.cronBox}>
                {cron.jobs.map((j, i) => (
                  <div key={i} style={s.cronRow}>
                    <div style={s.cronDesc}>{j.description}</div>
                    <div style={s.cronLine}><code style={s.code}>{j.crontab}</code>
                      <button style={s.copyBtn} title="Copy" onClick={() => navigator.clipboard?.writeText(j.crontab)}><Copy size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <p style={s.hint}>On cPanel/Plesk, add each as a scheduled task with the shown schedule and command.</p>
            </>
          )}

          {step === 5 && (
            <>
              <h1 style={s.h1}>You're all set</h1>
              <p style={s.p}>{org.name || "Your organization"} is ready. Click Finish to open your dashboard.</p>
              <ul style={s.ul}>
                <li>Add members and teams, or import them</li>
                <li>Point your web server's document root at <code style={s.code}>public/</code> and serve over HTTPS</li>
                <li>Invite mentors and start your season</li>
              </ul>
            </>
          )}
        </div>

        <div style={s.footer}>
          <button style={s.ghost} onClick={back} disabled={step === 0 || busy}><ArrowLeft size={14} /> Back</button>
          {step < STEPS.length - 1
            ? <button style={s.primary} onClick={next} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <>Next <ArrowRight size={14} /></>}</button>
            : <button style={s.primary} onClick={finish} disabled={busy}>{busy ? <Loader2 size={14} /> : "Finish"}</button>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={s.field}><span style={s.fieldLabel}>{label}</span>{children}</label>;
}
function errMsg(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong.";
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#eef2f6", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "32px 16px" },
  card: { width: "100%", maxWidth: 680, background: "#fff", borderRadius: 14, boxShadow: "0 8px 30px rgba(20,40,60,.12)", overflow: "hidden" },
  stepper: { display: "flex", flexWrap: "wrap", gap: 14, padding: "16px 24px", borderBottom: "1px solid #eef2f6", background: "#fafcfe" },
  stepItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  stepLabel: { fontSize: 12.5 },
  body: { padding: "24px 28px", minHeight: 300 },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a2634", margin: "0 0 10px" },
  p: { fontSize: 14, color: "#4a5b6d", lineHeight: 1.55, margin: "0 0 14px" },
  hint: { fontSize: 12.5, color: "#8b98a6", margin: "10px 0 0" },
  ul: { fontSize: 14, color: "#4a5b6d", lineHeight: 1.7, paddingLeft: 20, margin: "0 0 8px" },
  field: { display: "block", marginBottom: 12 },
  fieldLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#5a6b7d", marginBottom: 4 },
  input: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" },
  testRow: { display: "flex", gap: 8, alignItems: "center", marginTop: 6 },
  modGroup: { marginBottom: 14 },
  modGroupLabel: { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#7a8899", marginBottom: 6 },
  modRow: { display: "flex", alignItems: "center", gap: 9, padding: "5px 2px", fontSize: 13.5, color: "#33475b", cursor: "pointer" },
  badge: { fontSize: 10.5, color: "#7a8899", background: "#eef2f6", borderRadius: 5, padding: "1px 6px" },
  cronBox: { border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" },
  cronRow: { padding: "9px 12px", borderBottom: "1px solid #f0f4f8" },
  cronDesc: { fontSize: 12.5, color: "#5a6b7d", marginBottom: 3 },
  cronLine: { display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" },
  code: { fontFamily: "ui-monospace,Menlo,Consolas,monospace", fontSize: 12, background: "#f4f7fa", padding: "2px 6px", borderRadius: 4, color: "#1a3a5c", wordBreak: "break-all" },
  copyBtn: { background: "none", border: "1px solid #dde5ee", borderRadius: 5, cursor: "pointer", color: "#5a6b7d", padding: "3px 5px", flexShrink: 0 },
  footer: { display: "flex", justifyContent: "space-between", padding: "16px 24px", borderTop: "1px solid #eef2f6", background: "#fafcfe" },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  ghost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, fontWeight: 600, color: "#33475b", cursor: "pointer" },
  ok: { fontSize: 13, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 8, padding: "9px 12px", marginTop: 10 },
  err: { fontSize: 13, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6c2", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
};
