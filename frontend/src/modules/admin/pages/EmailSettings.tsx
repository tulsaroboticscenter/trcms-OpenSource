import { useState, useEffect, useCallback } from "react";
import { adminApi, type EmailSettings as EmailSettingsT } from "../api";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { IncidentRoutingSettings } from "../../incidents/pages/IncidentSettings";
import { ArrowLeft, Mail, Send, CheckCircle, AlertTriangle } from "lucide-react";

type Form = { host: string; port: string; user: string; encryption: string; from: string; purchasing_email: string; visitor_email: string; signup_email: string; reservation_email: string; resource_email: string; payment_email: string; checkout_email: string; volunteer_email: string; scholarship_email: string; cc_address: string; cc_enabled: boolean; pass: string };

export default function EmailSettings() {
  const goBack = useGoBack("/admin");
  const { canWrite } = useAuth();
  const [current, setCurrent] = useState<EmailSettingsT | null>(null);
  const [addrTest, setAddrTest] = useState<Record<string, { ok: boolean; error: string | null } | "sending">>({});
  const [f, setF] = useState<Form>({ host: "", port: "", user: "", encryption: "none", from: "", purchasing_email: "", visitor_email: "", signup_email: "", reservation_email: "", resource_email: "", payment_email: "", checkout_email: "", volunteer_email: "", scholarship_email: "", cc_address: "", cc_enabled: false, pass: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearPass, setClearPass] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    const s = await adminApi.getEmailSettings().catch(() => null);
    // A failed load used to leave the form blank but fully editable, so a Save
    // would write empty strings over every setting -- silently stopping ALL email
    // until someone re-entered the server by hand. Now the failure is visible and
    // Save is blocked until we actually have the current settings.
    if (!s) setLoadError("Couldn't load the current email settings. Saving is disabled until they load — reload to try again.");
    if (s) {
      setCurrent(s);
      setF({ host: s.host, port: s.port, user: s.user, encryption: s.encryption || "none", from: s.from, purchasing_email: s.purchasing_email ?? "", visitor_email: s.visitor_email ?? "", signup_email: s.signup_email ?? "", reservation_email: s.reservation_email ?? "", resource_email: s.resource_email ?? "", payment_email: s.payment_email ?? "", checkout_email: s.checkout_email ?? "", volunteer_email: s.volunteer_email ?? "", scholarship_email: s.scholarship_email ?? "", cc_address: s.cc_address ?? "", cc_enabled: s.cc_enabled === "1", pass: "" });
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Default the test recipient to the configured From address once settings load.
  useEffect(() => { if (current?.from && !testTo) setTestTo(current.from); }, [current, testTo]);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setF((p) => ({ ...p, [k]: v })); setSaved(false); }

  async function save() {
    // Belt and braces: never post a form that was never populated.
    if (!current) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { host: f.host, port: f.port, user: f.user, encryption: f.encryption, from: f.from, purchasing_email: f.purchasing_email, visitor_email: f.visitor_email, signup_email: f.signup_email, reservation_email: f.reservation_email, resource_email: f.resource_email, payment_email: f.payment_email, checkout_email: f.checkout_email, volunteer_email: f.volunteer_email, scholarship_email: f.scholarship_email, cc_address: f.cc_address, cc_enabled: f.cc_enabled ? "1" : "" };
      if (clearPass) payload.clear_password = true;
      else if (f.pass.trim()) payload.pass = f.pass.trim();
      const s = await adminApi.saveEmailSettings(payload);
      setCurrent(s); setF((p) => ({ ...p, pass: "" })); setClearPass(false); setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  async function sendTest() {
    setTesting(true); setTestResult(null);
    try { setTestResult(await adminApi.testEmail(testTo.trim())); }
    catch (e: unknown) { setTestResult({ ok: false, error: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Request failed." }); }
    finally { setTesting(false); }
  }

  // Per-address test — sends a test email straight to that one notification address.
  async function testAddr(key: string, addr: string) {
    const a = addr.trim(); if (!a) return;
    setAddrTest((p) => ({ ...p, [key]: "sending" }));
    try { const r = await adminApi.testEmail(a); setAddrTest((p) => ({ ...p, [key]: r })); }
    catch (e: unknown) { setAddrTest((p) => ({ ...p, [key]: { ok: false, error: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "failed" } })); }
  }

  if (loading) return <div style={st.page}><p style={st.muted}>Loading…</p></div>;

  return (
    <div style={st.page}>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Admin Console</button>
      <h1 style={st.heading}><Mail size={20} style={{ verticalAlign: -3 }} /> Email Settings</h1>
      <p style={st.sub}>
        Outbound email (SMTP) for invites, confirmations, and Communications. Settings saved here override the server's
        <code style={st.code}>.env</code> and take effect immediately — no server restart. Leave the username/password blank
        for an unauthenticated relay (e.g. <code style={st.code}>relay4.tulsaconnect.com</code> on port 25).
      </p>

      {loadError && (
        <div style={st.loadError} role="alert">
          <AlertTriangle size={15} />
          <span>{loadError}</span>
          <button style={st.retry} onClick={() => { setLoading(true); load(); }}>Retry</button>
        </div>
      )}
      <div style={{ ...st.statusBar, background: current?.configured ? "#e8f5e9" : "#fff3e0", borderColor: current?.configured ? "#a5d6a7" : "#ffcc80" }}>
        {current?.configured
          ? <><CheckCircle size={15} color="#2e7d32" /> <span>SMTP is configured (host <strong>{current.host}</strong>). The server uses these settings to send mail.</span></>
          : <><AlertTriangle size={15} color="#e65100" /> <span>SMTP is <strong>not configured</strong> — emails can't be sent until a host is set below.</span></>}
      </div>

      <div style={st.card}>
        <div style={st.grid}>
          <F label="SMTP host *" hint={src(current, "host")}><input style={st.in} value={f.host} onChange={(e) => set("host", e.target.value)} placeholder="relay4.tulsaconnect.com" /></F>
          <F label="Port" hint={src(current, "port")}><input style={st.in} value={f.port} onChange={(e) => set("port", e.target.value)} placeholder="25, 587, or 465" /></F>
          <F label="Encryption" hint={src(current, "encryption")}>
            <select style={st.in} value={f.encryption} onChange={(e) => set("encryption", e.target.value)}>
              <option value="none">None (plain relay, usually port 25)</option>
              <option value="tls">STARTTLS (usually port 587)</option>
              <option value="ssl">SSL (usually port 465)</option>
            </select>
          </F>
          <F label="From address" hint={src(current, "from")}><input style={st.in} value={f.from} onChange={(e) => set("from", e.target.value)} placeholder="noreply@tulsaroboticscenter.org" /></F>
          <AddrField label="Purchasing notifications" hint="where BOM order-request emails go" value={f.purchasing_email} onChange={(v) => set("purchasing_email", v)} onTest={() => testAddr("purchasing", f.purchasing_email)} result={addrTest.purchasing} />
          <AddrField label="Visitor signup notifications" hint="where new-visitor emails go" value={f.visitor_email} onChange={(v) => set("visitor_email", v)} onTest={() => testAddr("visitor", f.visitor_email)} result={addrTest.visitor} />
          <AddrField label="Self-signup notifications" hint="where a visitor self-converting via a join link is recorded — blank uses the visitor address" value={f.signup_email} onChange={(v) => set("signup_email", v)} onTest={() => testAddr("signup", f.signup_email)} result={addrTest.signup} />
          <AddrField label="Reservation request notifications" hint="where new room/resource reservation requests go" value={f.reservation_email} onChange={(v) => set("reservation_email", v)} onTest={() => testAddr("reservation", f.reservation_email)} result={addrTest.reservation} />
          <AddrField label="Resource access-request notifications" hint="where resource access requests go (one mailbox)" value={f.resource_email} onChange={(v) => set("resource_email", v)} onTest={() => testAddr("resource", f.resource_email)} result={addrTest.resource} />
          <AddrField label="Payment-received notifications" hint="where a note goes each time a card payment is processed" value={f.payment_email} onChange={(v) => set("payment_email", v)} onTest={() => testAddr("payment", f.payment_email)} result={addrTest.payment} />
          <AddrField label="Nightly auto check-out report" hint="where the midnight auto check-out report goes; nothing on a quiet night" value={f.checkout_email} onChange={(v) => set("checkout_email", v)} onTest={() => testAddr("checkout", f.checkout_email)} result={addrTest.checkout} />
          <AddrField label="Volunteer sign-up notifications" hint="where a note goes when someone creates a volunteer account from the public form" value={f.volunteer_email} onChange={(v) => set("volunteer_email", v)} onTest={() => testAddr("volunteer", f.volunteer_email)} result={addrTest.volunteer} />
          <AddrField label="Scholarship application notifications" hint="where a note goes when a family submits a scholarship application" value={f.scholarship_email} onChange={(v) => set("scholarship_email", v)} onTest={() => testAddr("scholarship", f.scholarship_email)} result={addrTest.scholarship} />
          <F label="Username (blank = no auth)" hint={src(current, "user")}><input style={st.in} value={f.user} onChange={(e) => set("user", e.target.value)} placeholder="leave blank for a relay" /></F>
          <F label="Password" hint={current?.has_password ? `set (${current.password_source})` : "not set"}>
            <input style={st.in} type="password" value={f.pass} disabled={clearPass} onChange={(e) => set("pass", e.target.value)} placeholder={current?.has_password ? "•••••• (unchanged)" : "leave blank for a relay"} />
            {current?.has_password && <label style={st.clearRow}><input type="checkbox" checked={clearPass} onChange={(e) => { setClearPass(e.target.checked); setSaved(false); }} /> Clear the saved password</label>}
          </F>
        </div>
        {/* #172 — always-CC a copy of Communications emails to a tracking inbox (e.g. info@). */}
        <label style={st.clearRow}>
          <input type="checkbox" checked={f.cc_enabled} onChange={(e) => set("cc_enabled", e.target.checked)} />
          Always CC a copy of Communications emails to a tracking address
        </label>
        {f.cc_enabled && (
          <div style={{ marginTop: 8, maxWidth: 420 }}>
            <input style={st.in} value={f.cc_address} onChange={(e) => set("cc_address", e.target.value)} placeholder="info@tulsaroboticscenter.org" />
            <p style={st.muted}>A copy of every single/reply email is CC'd here; a group send delivers one copy.</p>
          </div>
        )}
        <div style={st.actions}>
          <button style={st.primary} disabled={saving || !current} title={!current ? "Settings haven't loaded — saving is disabled to avoid overwriting them" : undefined} onClick={save}>{saved ? <><CheckCircle size={14} /> Saved</> : (saving ? "Saving…" : "Save settings")}</button>
        </div>
      </div>

      {canWrite("incidents.settings") && (
        <div style={st.card}>
          <div style={st.cardTitle}>Incident report routing</div>
          <p style={st.hint}>Where incident reports are emailed, by type and severity. Each destination has its own Test button.</p>
          <IncidentRoutingSettings embedded />
        </div>
      )}

      <div style={st.card}>
        <div style={st.cardTitle}>Send a test email</div>
        <p style={st.hint}>Saves nothing — just attempts a send with the <em>currently saved</em> settings and shows the result.</p>
        <div style={st.testRow}>
          <input style={st.in} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <button style={st.testBtn} disabled={testing || !testTo.trim()} onClick={sendTest}><Send size={14} /> {testing ? "Sending…" : "Send test"}</button>
        </div>
        {testResult && (
          <div style={{ ...st.result, background: testResult.ok ? "#e8f5e9" : "#fdecea", borderColor: testResult.ok ? "#a5d6a7" : "#f5c6cb", color: testResult.ok ? "#2e7d32" : "#c62828" }}>
            {testResult.ok
              ? <><CheckCircle size={15} /> <span>Sent! Check the inbox for <strong>{testTo}</strong>.</span></>
              : <><AlertTriangle size={15} /> <span><strong>Send failed.</strong> {testResult.error}</span></>}
          </div>
        )}
      </div>

      <details style={st.help}>
        <summary style={st.helpSummary}>Setup help</summary>
        <div style={st.helpBody}>
          <p><strong>TulsaConnect relay (current TRC setup):</strong> host <code style={st.code}>relay4.tulsaconnect.com</code>, port <code style={st.code}>25</code>, encryption <strong>None</strong>, username & password <strong>blank</strong>, From <code style={st.code}>noreply@tulsaroboticscenter.org</code>. Works because the server relays without authentication.</p>
          <p><strong>Mailbox on the domain:</strong> host <code style={st.code}>mail.tulsaroboticscenter.org</code>, port <code style={st.code}>587</code>, encryption <strong>STARTTLS</strong>, username = the full mailbox address, password = its mailbox password.</p>
          <p><strong>Gmail / Google Workspace:</strong> host <code style={st.code}>smtp.gmail.com</code>, port <code style={st.code}>587</code>, encryption <strong>STARTTLS</strong>, username = the Gmail address, password = an <strong>App Password</strong> (not the normal password).</p>
          <p style={st.muted}>If a test fails, the exact SMTP error appears above — common causes are the wrong port/encryption combo, the host blocking outbound port 25, or a bad login.</p>
        </div>
      </details>
    </div>
  );
}

function src(s: EmailSettingsT | null, k: string): string {
  const v = s?.source?.[k];
  return v === "database" ? "saved here" : v === "env" ? "from server .env" : "not set";
}
function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div><label style={st.lbl}>{label}{hint ? <span style={st.hintTag}> · {hint}</span> : null}</label>{children}</div>;
}
function AddrField({ label, hint, value, onChange, onTest, result }: { label: string; hint?: string; value: string; onChange: (v: string) => void; onTest: () => void; result?: { ok: boolean; error: string | null } | "sending" }) {
  return (
    <div>
      <label style={st.lbl}>{label}{hint ? <span style={st.hintTag}> · {hint}</span> : null}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={st.in} value={value} onChange={(e) => onChange(e.target.value)} placeholder="info@tulsaroboticscenter.org" />
        <button type="button" style={st.miniTest} disabled={!value.trim() || result === "sending"} onClick={onTest}>{result === "sending" ? "…" : "Test"}</button>
      </div>
      {result && result !== "sending" && <div style={{ fontSize: 11.5, marginTop: 2, color: result.ok ? "#2e7d32" : "#c62828" }}>{result.ok ? "✓ sent" : `⚠ ${result.error}`}</div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  loadError: { display: "flex", alignItems: "center", gap: 8, background: "#fdecec", border: "1px solid #f5c2c2", color: "#8a2b2b", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13 },
  retry: { marginLeft: "auto", fontSize: 12, padding: "4px 10px", border: "1px solid #d99", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#8a2b2b" },
  page: { maxWidth: 760, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  heading: { margin: 0, fontSize: 22, fontWeight: 800, color: "#1a3a5c" },
  sub: { fontSize: 13, color: "#667", lineHeight: 1.6, margin: "6px 0 14px" },
  code: { background: "#f0f4f8", padding: "1px 5px", borderRadius: 4, fontSize: 12 },
  statusBar: { display: "flex", alignItems: "center", gap: 8, border: "1px solid", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14, color: "#334155" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.1rem", marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 4 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  hintTag: { fontWeight: 400, color: "#94a3b8" },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  clearRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#778", marginTop: 4 },
  actions: { display: "flex", justifyContent: "flex-end", marginTop: 12 },
  primary: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  hint: { fontSize: 12, color: "#888", margin: "0 0 10px" },
  testRow: { display: "flex", gap: 8 },
  testBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#0277bd", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" },
  miniTest: { padding: "8px 12px", background: "#0277bd", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
  result: { display: "flex", alignItems: "center", gap: 8, border: "1px solid", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginTop: 12, lineHeight: 1.5 },
  help: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" },
  helpSummary: { fontSize: 13, fontWeight: 600, color: "#1a3a5c", cursor: "pointer" },
  helpBody: { fontSize: 12.5, color: "#556", lineHeight: 1.7, marginTop: 8 },
  muted: { color: "#888", fontSize: 13 },
};
