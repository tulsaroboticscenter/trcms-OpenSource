import { useEffect, useState, useCallback } from "react";
import { Check, X, Clock, ShieldCheck } from "lucide-react";
import { resourcesApi, type AccessRow } from "../api";

/** Consolidated access requests + history for a resource manager (#144). */
export default function AccessRequestsPanel({ scope }: { scope: "trc" | "team" }) {
  const [pending, setPending] = useState<AccessRow[]>([]);
  const [history, setHistory] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    resourcesApi.accessLog(scope)
      .then((d) => { setPending(d.pending); setHistory(d.history); })
      .catch(() => { setPending([]); setHistory([]); })
      .finally(() => setLoading(false));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  async function act(row: AccessRow, action: "grant" | "revoke") {
    setBusy(`${row.resource_id}:${row.member_id}`);
    try {
      if (action === "grant") await resourcesApi.grant(row.resource_id, row.member_id);
      else await resourcesApi.revoke(row.resource_id, row.member_id);
      load();
    } finally { setBusy(null); }
  }

  const fmt = (s?: string | null) => s ? new Date(s.replace(" ", "T")).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  if (loading) return <p style={s.muted}>Loading…</p>;

  return (
    <div>
      <div style={s.sectionHead}><Clock size={15} /> Pending requests {pending.length > 0 && <span style={s.badge}>{pending.length}</span>}</div>
      {pending.length === 0 ? (
        <p style={s.muted}>No pending access requests.</p>
      ) : (
        <div style={s.list}>
          {pending.map((r) => (
            <div key={`${r.resource_id}:${r.member_id}`} style={s.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.name}>{r.member_name}</div>
                <div style={s.meta}>wants <strong>{r.resource_name}</strong>{r.requested_at ? ` · ${fmt(r.requested_at)}` : ""}</div>
              </div>
              <button style={s.grantBtn} disabled={busy === `${r.resource_id}:${r.member_id}`} onClick={() => act(r, "grant")}>
                <Check size={13} /> Grant
              </button>
              <button style={s.denyBtn} disabled={busy === `${r.resource_id}:${r.member_id}`} onClick={() => act(r, "revoke")}>
                <X size={13} /> Deny
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...s.sectionHead, marginTop: 22 }}><ShieldCheck size={15} /> History</div>
      {history.length === 0 ? (
        <p style={s.muted}>Nothing granted or revoked yet.</p>
      ) : (
        <div style={s.list}>
          {history.map((r) => (
            <div key={`${r.resource_id}:${r.member_id}:${r.status}`} style={{ ...s.row, background: "#fbfcfe" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.name}>{r.member_name} <span style={{ ...s.statusPill, ...(r.status === "granted" ? s.pillGranted : s.pillRevoked) }}>{r.status}</span></div>
                <div style={s.meta}>{r.resource_name}{r.granted_at ? ` · ${fmt(r.granted_at)}` : ""}{r.acted_by ? ` · by ${r.acted_by}` : ""}</div>
              </div>
              {r.status === "revoked" && (
                <button style={s.grantBtn} disabled={busy === `${r.resource_id}:${r.member_id}`} onClick={() => act(r, "grant")}>
                  <Check size={13} /> Re-grant
                </button>
              )}
              {r.status === "granted" && (
                <button style={s.denyBtn} disabled={busy === `${r.resource_id}:${r.member_id}`} onClick={() => act(r, "revoke")}>
                  <X size={13} /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  muted: { color: "#94a3b8", fontSize: 14 },
  sectionHead: { display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 800, color: "#1a3a5c", marginBottom: 10 },
  badge: { background: "#e65100", color: "#fff", borderRadius: 10, fontSize: 11, fontWeight: 700, padding: "1px 8px" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px" },
  name: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  meta: { fontSize: 12.5, color: "#64748b", marginTop: 2 },
  grantBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12.5, flexShrink: 0 },
  denyBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12.5, flexShrink: 0 },
  statusPill: { fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "1px 7px", textTransform: "uppercase" as const },
  pillGranted: { background: "#e8f5e9", color: "#2e7d32" },
  pillRevoked: { background: "#fdecea", color: "#c62828" },
};
