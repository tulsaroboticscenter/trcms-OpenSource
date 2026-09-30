/**
 * System Backups — monitoring view for the weekly database + files backup
 * (bin/backup.php). Read-only: backups contain member PII and app secrets, so
 * they're stored off the web root and are not downloadable here. System
 * Administrators can trigger an out-of-band run.
 */
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../core/api";
import { formatDateTime } from "../../../core/dateUtils";
import { ArrowLeft, DatabaseBackup, RefreshCw, Play, ShieldCheck, HardDrive, CheckCircle, AlertTriangle } from "lucide-react";

interface Backup {
  name: string; created_at: string | null;
  db_bytes: number; files_bytes: number; total_bytes: number; complete: boolean;
}
interface BackupData {
  backups: Backup[]; dir: string;
  retention: { weekly: number; monthly: number; yearly: number };
  can_run_now: boolean;
  preflight?: { checks: PreflightCheck[]; can_run: boolean; blockers: string[]; php_cli: string | null; backup_dir: string };
  log_tail?: string | null;
}
interface PreflightCheck { key: string; label: string; ok: boolean; detail: string; fix: string | null; blocking: boolean }

function human(b: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${Math.round(b * 10) / 10} ${u[i]}`;
}

export default function SystemBackups() {
  const navigate = useNavigate();
  const [data, setData] = useState<BackupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get("/api/v1/admin/backups")
      .then((r) => setData(r.data))
      .catch((e) => setErr(e?.response?.data?.detail ?? "Could not load backups."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setRunning(true); setMsg(""); setErr("");
    try {
      const r = await api.post("/api/v1/admin/backups/run", {});
      setMsg(r.data?.detail ?? "Backup started. It runs in the background — refresh in a minute or two to see it appear.");
      setTimeout(load, 8000);
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not start the backup.");
    } finally { setRunning(false); }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button onClick={() => navigate("/admin")} style={s.back}><ArrowLeft size={14} /> Admin Console</button>
      <div style={s.head}>
        <h1 style={s.heading}><DatabaseBackup size={22} style={{ verticalAlign: -4 }} /> System Backups</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.ghost} onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
          {data?.can_run_now && (
            <button style={s.primary} onClick={runNow} disabled={running}><Play size={14} /> {running ? "Starting…" : "Run backup now"}</button>
          )}
        </div>
      </div>

      <p style={s.sub}>
        Each backup captures the full database and application files (code, uploads, config). Backups run on the
        weekly schedule and older ones are pruned automatically.
      </p>

      {msg && <div style={s.info}>{msg}</div>}
      {err && <div style={s.err}>{err}</div>}

      {/* Diagnostics. "Run backup now" used to report success even when the host
          blocked it, so a failing setup looked identical to a working one. This
          says plainly whether a backup can run, and what to fix if not. */}
      {data?.preflight && !data.preflight.can_run && (
        <div style={s.diagBad}>
          <div style={s.diagHead}><AlertTriangle size={16} /> Backups cannot run on this server yet</div>
          <ul style={s.diagList}>
            {data.preflight.checks.filter((c) => !c.ok).map((c) => (
              <li key={c.key} style={{ marginBottom: 6 }}>
                <strong>{c.label}</strong>
                <div style={s.diagDetail}>{c.detail}</div>
                {c.fix && <div style={s.diagFix}>Fix: {c.fix}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data?.preflight?.can_run && data.backups.length === 0 && (
        <div style={s.diagOk}>
          <CheckCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            The server passes every backup check, but no backup has completed yet. Press
            <strong> Run backup now</strong>, wait a minute, then Refresh. If nothing appears, the log below will say why.
          </div>
        </div>
      )}
      {data?.log_tail && (
        <details style={s.logBox}>
          <summary style={s.logSummary}>Backup log (most recent output)</summary>
          <pre style={s.logPre}>{data.log_tail}</pre>
        </details>
      )}

      {/* Security / storage note */}
      <div style={s.noteBox}>
        <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          Backups contain member personal information and system secrets, so they are stored <strong>outside the website</strong>
          {data?.dir ? <> (<code style={s.code}>{data.dir}</code>)</> : null} and are <strong>not downloadable from here</strong>.
          Retrieve one over SSH or the host File Manager when you need to restore.
        </div>
      </div>

      {loading ? <p style={s.muted}>Loading…</p> : !data ? null : (
        <>
          <div style={s.table}>
            <div style={s.tHead}>
              <span style={{ flex: 1 }}>Backup</span>
              <span style={s.col}>Database</span>
              <span style={s.col}>Files</span>
              <span style={s.col}>Total</span>
              <span style={s.col}>Status</span>
            </div>
            {data.backups.length === 0 ? (
              <div style={s.empty}>
                No backups yet. They&apos;ll appear here after the first scheduled run (or click <strong>Run backup now</strong>).
              </div>
            ) : data.backups.map((b) => (
              <div key={b.name} style={s.row}>
                <div style={{ flex: 1 }}>
                  <div style={s.name}>{b.created_at ? formatDateTime(b.created_at) : b.name}</div>
                  <div style={s.nameSub}>{b.name}</div>
                </div>
                <span style={s.col}>{human(b.db_bytes)}</span>
                <span style={s.col}>{human(b.files_bytes)}</span>
                <span style={{ ...s.col, fontWeight: 700 }}>{human(b.total_bytes)}</span>
                <span style={s.col}>
                  {b.complete
                    ? <span style={s.ok}><CheckCircle size={13} /> Complete</span>
                    : <span style={s.bad}><AlertTriangle size={13} /> Incomplete</span>}
                </span>
              </div>
            ))}
          </div>

          <div style={s.retention}>
            <HardDrive size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Retention (grandfather-father-son):</strong> the most recent <strong>{data.retention.weekly}</strong> backups are kept,
              then one per month for <strong>{data.retention.monthly}</strong> months, then one per year for <strong>{data.retention.yearly}</strong> years.
              Everything older is pruned automatically after each run. Adjust with the <code style={s.code}>BACKUP_KEEP_WEEKLY / _MONTHLY / _YEARLY</code> settings.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  diagBad: { background: "#fff4f4", border: "1px solid #ef9a9a", borderRadius: 8, padding: "12px 14px", marginBottom: 14 },
  diagHead: { display: "flex", alignItems: "center", gap: 7, fontWeight: 700, color: "#c62828", fontSize: 14, marginBottom: 8 },
  diagList: { margin: 0, paddingLeft: 18, fontSize: 13, color: "#4a5b6d" },
  diagDetail: { fontSize: 12, color: "#5a6b7d", marginTop: 2, wordBreak: "break-word" as const },
  diagFix: { fontSize: 12, color: "#00695c", marginTop: 3, fontWeight: 600 },
  diagOk: { display: "flex", gap: 8, background: "#f1f8f4", border: "1px solid #a5d6a7", borderRadius: 8, padding: "11px 14px", marginBottom: 14, fontSize: 13, color: "#2e5b3e", lineHeight: 1.5 },
  logBox: { border: "1px solid #cdd7e3", borderRadius: 8, marginBottom: 14, background: "#fbfdff" },
  logSummary: { cursor: "pointer", padding: "9px 13px", fontSize: 12.5, fontWeight: 600, color: "#4a5b6d" },
  logPre: { margin: 0, padding: "0 13px 12px", fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, color: "#37474f", maxHeight: 260, overflow: "auto" as const },

  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#667", cursor: "pointer", fontSize: 13, marginBottom: 8, padding: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  sub: { color: "#667", fontSize: 14, marginTop: 6, marginBottom: 16 },
  ghost: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  primary: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", background: "#1a3a5c", color: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  info: { background: "#e8f4fd", border: "1px solid #b3d8f0", borderRadius: 8, padding: "10px 14px", color: "#1565c0", fontSize: 13, marginBottom: 12 },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 8, padding: "10px 14px", color: "#c62828", fontSize: 13, marginBottom: 12 },
  noteBox: { display: "flex", gap: 10, background: "#f3e5f5", border: "1px solid #ce93d8", borderRadius: 10, padding: "12px 16px", color: "#6a1b9a", fontSize: 13, marginBottom: 16, lineHeight: 1.55 },
  code: { background: "rgba(0,0,0,.06)", padding: "1px 5px", borderRadius: 4, fontSize: 12 },
  table: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  tHead: { display: "flex", alignItems: "center", padding: "10px 16px", background: "#f0f4f8", fontSize: 11, fontWeight: 700, color: "#889", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", gap: 10 },
  col: { width: 110, flexShrink: 0, fontSize: 13, color: "#445" },
  row: { display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #f0f4f8", gap: 10 },
  name: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  nameSub: { fontSize: 11, color: "#aab" },
  ok: { display: "flex", alignItems: "center", gap: 4, color: "#2e7d32", fontWeight: 600, fontSize: 12.5 },
  bad: { display: "flex", alignItems: "center", gap: 4, color: "#c62828", fontWeight: 600, fontSize: 12.5 },
  empty: { textAlign: "center", color: "#889", padding: "2rem", fontSize: 14 },
  muted: { color: "#889", padding: "2rem", textAlign: "center" },
  retention: { display: "flex", gap: 10, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px", color: "#556", fontSize: 13, marginTop: 14, lineHeight: 1.55 },
};
