import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { twoFactorApi } from "./twoFactorApi";

/**
 * Personal two-factor (TOTP) enrollment panel. Shows on a user's own account.
 * Renders nothing when the feature is turned off org-wide.
 */
export default function TwoFactorPanel() {
  const [status, setStatus] = useState<{ feature_enabled: boolean; enabled: boolean } | null>(null);
  const [stage, setStage] = useState<"idle" | "setup" | "backup">("idle");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePw, setDisablePw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { twoFactorApi.status().then(setStatus).catch(() => setStatus(null)); }, []);

  if (!status || !status.feature_enabled) return null;

  async function startSetup() {
    setErr(""); setBusy(true);
    try {
      const { secret, otpauth_uri } = await twoFactorApi.setup();
      setSecret(secret);
      setQr(await QRCode.toDataURL(otpauth_uri, { margin: 1, width: 200 }));
      setStage("setup");
    } catch { setErr("Could not start setup."); } finally { setBusy(false); }
  }
  async function confirmEnable() {
    setErr(""); setBusy(true);
    try {
      const { backup_codes } = await twoFactorApi.enable(code);
      setBackupCodes(backup_codes); setStage("backup"); setCode("");
      setStatus((s) => s && { ...s, enabled: true });
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "That code was not correct.");
    } finally { setBusy(false); }
  }
  async function disable() {
    setErr(""); setBusy(true);
    try {
      await twoFactorApi.disable({ password: disablePw });
      setStatus((s) => s && { ...s, enabled: false }); setDisablePw(""); setStage("idle");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not disable.");
    } finally { setBusy(false); }
  }

  return (
    <div style={s.card}>
      <div style={s.head}>
        {status.enabled ? <ShieldCheck size={18} color="#2e7d32" /> : <ShieldOff size={18} color="#889" />}
        <span style={s.title}>Two-Factor Authentication</span>
        <span style={{ ...s.badge, ...(status.enabled ? s.on : s.off) }}>{status.enabled ? "On" : "Off"}</span>
      </div>

      {status.enabled && stage === "idle" && (
        <div>
          <p style={s.p}>Your account is protected with an authenticator app. To turn it off, enter your password.</p>
          <div style={s.row}>
            <input style={s.in} type="password" placeholder="Your password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
            <button style={s.danger} disabled={busy || !disablePw} onClick={disable}>Turn off</button>
          </div>
        </div>
      )}

      {!status.enabled && stage === "idle" && (
        <div>
          <p style={s.p}>Add a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password, etc.).</p>
          <button style={s.primary} disabled={busy} onClick={startSetup}>Set up authenticator</button>
        </div>
      )}

      {stage === "setup" && (
        <div>
          <p style={s.p}>1. Scan this QR code with your authenticator app (or enter the key manually), then 2. type the 6-digit code it shows.</p>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
            {qr && <img src={qr} alt="2FA QR code" width={180} height={180} style={{ border: "1px solid #e2e8f0", borderRadius: 8 }} />}
            <div>
              <div style={s.small}>Manual key</div>
              <code style={s.key}>{secret}</code>
              <div style={{ marginTop: 12 }}>
                <input style={s.in} inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button style={s.primary} disabled={busy || code.length < 6} onClick={confirmEnable}>Verify & turn on</button>
                  <button style={s.cancel} onClick={() => { setStage("idle"); setCode(""); setErr(""); }}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {stage === "backup" && (
        <div>
          <p style={{ ...s.p, color: "#2e7d32", fontWeight: 600 }}>Two-factor is now on. Save these one-time backup codes somewhere safe — each works once if you lose your authenticator.</p>
          <div style={s.codes}>{backupCodes.map((c) => <code key={c} style={s.codeChip}>{c}</code>)}</div>
          <button style={s.primary} onClick={() => setStage("idle")}>I've saved them</button>
        </div>
      )}

      {err && <p style={s.err}>{err}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginTop: 16 },
  head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  badge: { marginLeft: "auto", padding: "2px 10px", borderRadius: 11, fontSize: 11, fontWeight: 700 },
  on: { background: "#e8f5e9", color: "#2e7d32" },
  off: { background: "#f1f3f5", color: "#889" },
  p: { fontSize: 13.5, color: "#556", lineHeight: 1.5, margin: "0 0 12px" },
  row: { display: "flex", gap: 8 },
  in: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14, boxSizing: "border-box" },
  primary: { padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  danger: { padding: "9px 16px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 7, fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  cancel: { padding: "9px 14px", background: "#fff", color: "#556", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13.5, cursor: "pointer" },
  small: { fontSize: 11, color: "#99a", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  key: { display: "inline-block", background: "#f4f6fa", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", fontFamily: "monospace", fontSize: 13, letterSpacing: 1 },
  codes: { display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 14px" },
  codeChip: { background: "#f4f6fa", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", fontFamily: "monospace", fontSize: 14, letterSpacing: 1 },
  err: { color: "#c62828", fontSize: 13, marginTop: 10 },
};
