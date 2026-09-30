/**
 * MentorTCPanel
 * =============
 * Embedded in MemberProfile for Mentor members.
 * Shows annual T&C agreement status and allows signing.
 * Mentors do NOT need enrollment but DO need to agree to T&C each season.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { api } from "../../../core/api";
import { membersApi } from "../../members/api";
import { CheckCircle, Clock, XCircle, FileText, ChevronDown, ChevronUp } from "lucide-react";

const SHIRT_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "AS", "AM", "AL", "AXL", "A2XL", "A3XL"];

interface TCStatus {
  current_year: number;
  current_year_label: string;
  signed_current_year: boolean;
  signed_at?: string;
  in_grace_period: boolean;
  grace_ends?: string;
  grace_days_remaining?: number;
  prev_year: number;
  signed_prev_year: boolean;
}

interface TCHistoryRecord {
  id: number;
  enrollment_year: number;
  enrollment_year_label: string;
  signed_at?: string;
  signed_by_id?: number;
}

interface Props { memberId: number; }

export default function MentorTCPanel({ memberId }: Props) {
  const { user, isAdmin, hasRole } = useAuth();
  const navigate = useNavigate();
  const canSign = isAdmin || hasRole("Admin", "System Administrator") || user?.id === memberId;

  const [status, setStatus] = useState<TCStatus | null>(null);
  const [history, setHistory] = useState<TCHistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [consents, setConsents] = useState<import("../api").MemberConsents | null>(null);
  const [loading, setLoading] = useState(true);
  const [shirtSize, setShirtSize] = useState("");
  const [shirtOnFile, setShirtOnFile] = useState<boolean | null>(null);   // null = unknown/loading
  const [shirtBusy, setShirtBusy] = useState(false);
  const [shirtSaved, setShirtSaved] = useState(false);

  useEffect(() => { load(); }, [memberId]);
  useEffect(() => {
    import("../api").then(({ enrollmentApi }) => enrollmentApi.memberConsents(memberId).then(setConsents).catch(() => setConsents(null)));
  }, [memberId]);
  useEffect(() => {
    membersApi.get(memberId).then((m) => {
      const s = (m as { shirt_size?: string | null }).shirt_size ?? "";
      setShirtSize(s); setShirtOnFile(!!s);
    }).catch(() => setShirtOnFile(null));
  }, [memberId]);

  async function saveShirt() {
    if (!shirtSize) return;
    setShirtBusy(true);
    try {
      await membersApi.update(memberId, { shirt_size: shirtSize });
      setShirtOnFile(true); setShirtSaved(true);
    } catch { /* leave prompt up */ }
    finally { setShirtBusy(false); }
  }

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/v1/enrollment/mentor-tc/${memberId}`);
      setStatus(data);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    const { data } = await api.get(`/api/v1/enrollment/mentor-tc/${memberId}/history`);
    setHistory(data);
  }

  if (loading) return <p style={styles.muted}>Loading…</p>;
  if (!status) return null;

  const { signed_current_year, current_year_label, signed_at, in_grace_period, grace_ends, grace_days_remaining } = status;

  return (
    <div>
      {/* Status card */}
      <div style={{
        ...styles.statusCard,
        background: signed_current_year ? "#e8f5e9" : in_grace_period ? "#fff8e1" : "#ffebee",
        borderColor: signed_current_year ? "#a5d6a7" : in_grace_period ? "#ffd54f" : "#ef9a9a",
      }}>
        <div style={styles.statusRow}>
          {signed_current_year
            ? <CheckCircle size={18} color="#2e7d32" />
            : in_grace_period
            ? <Clock size={18} color="#f57c00" />
            : <XCircle size={18} color="#c62828" />
          }
          <div style={{ flex: 1 }}>
            <div style={{
              fontWeight: 700, fontSize: 14,
              color: signed_current_year ? "#2e7d32" : in_grace_period ? "#f57c00" : "#c62828",
            }}>
              {signed_current_year
                ? `T&C Signed — ${current_year_label}`
                : in_grace_period
                ? `T&C Not Signed — Grace Period Active`
                : `T&C Not Signed — ${current_year_label}`
              }
            </div>
            {signed_current_year && signed_at && (
              <div style={styles.statusSub}>
                Signed {new Date(signed_at).toLocaleDateString()}
              </div>
            )}
            {in_grace_period && grace_ends && (
              <div style={styles.statusSub}>
                You signed last season's T&C. Grace period ends {new Date(grace_ends + "T00:00:00").toLocaleDateString()}
                {grace_days_remaining != null && ` (${grace_days_remaining} day${grace_days_remaining !== 1 ? "s" : ""} remaining)`}.
                Please sign for {current_year_label} soon.
              </div>
            )}
            {!signed_current_year && !in_grace_period && (
              <div style={styles.statusSub}>
                Annual T&C agreement required to check in to events.
              </div>
            )}
          </div>
        </div>

        {/* Sign button — opens the signing screen where the member reads & agrees */}
        {!signed_current_year && canSign && (
          <button style={styles.signBtn} onClick={() => navigate(`/enrollment/mentor-tc/${memberId}/sign`)}>
            <FileText size={14} />
            Sign T&amp;C for {current_year_label}
          </button>
        )}
      </div>

      {/* Shirt size nudge — mentors are never asked for it during enrollment, so collect it here. */}
      {canSign && shirtOnFile === false && !shirtSaved && (
        <div style={styles.shirtPrompt}>
          <span style={{ flex: 1, fontSize: 13 }}>We don't have your shirt size on file — add it so you're counted for team shirts.</span>
          <select style={styles.shirtSelect} value={shirtSize} onChange={(e) => setShirtSize(e.target.value)}>
            <option value="">Size…</option>
            {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button style={styles.shirtBtn} disabled={!shirtSize || shirtBusy} onClick={saveShirt}>{shirtBusy ? "Saving…" : "Save"}</button>
        </div>
      )}
      {shirtSaved && <div style={{ ...styles.shirtPrompt, background: "#e8f5e9", borderColor: "#a5d6a7" }}><span style={{ fontSize: 13, color: "#2e7d32" }}>Shirt size saved — thanks!</span></div>}

      {/* What this member was asked to agree to this season, and how they responded */}
      {consents && consents.sections.some((s) => s.applicable) && (
        <div style={styles.consentBox}>
          <div style={styles.consentTitle}>This season&apos;s consents</div>
          {consents.sections.filter((s) => s.applicable).map((s) => (
            <div key={s.key} style={styles.consentRow}>
              <span style={{ flex: 1 }}>{s.title}</span>
              <span style={{ fontWeight: 700, color: consentColor(s.response) }}>{consentLabel(s.response)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Info note */}
      <p style={styles.note}>
        Mentors are required to sign the TRC Terms & Conditions each season. No enrollment is needed.
        A grace period through August 31 applies after each season ends.
      </p>

      {/* History toggle */}
      <button style={styles.historyToggle} onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}>
        {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showHistory ? "Hide" : "Show"} T&C signing history
      </button>

      {showHistory && (
        <div style={styles.historyList}>
          {history.length === 0 ? (
            <p style={styles.muted}>No T&C history recorded.</p>
          ) : (
            history.map(rec => (
              <div key={rec.id} style={styles.historyRow}>
                <span style={styles.historyYear}>{rec.enrollment_year_label}</span>
                <CheckCircle size={13} color="#2e7d32" />
                <span style={styles.historyDate}>
                  Signed {rec.signed_at ? new Date(rec.signed_at).toLocaleDateString() : "—"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function consentLabel(r: string): string {
  return { agreed: "Agreed", granted: "Consented", declined: "Declined", pending: "Not yet", na: "N/A" }[r] ?? r;
}
function consentColor(r: string): string {
  return { agreed: "#2e7d32", granted: "#2e7d32", declined: "#c62828", pending: "#b26a00", na: "#999" }[r] ?? "#555";
}

const styles: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  consentBox: { border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 12px", margin: "8px 0" },
  consentTitle: { fontSize: 12, fontWeight: 800, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  consentRow: { display: "flex", gap: 10, fontSize: 12.5, color: "#445", padding: "3px 0", borderTop: "1px solid #f4f7fa" },
  statusCard: { border: "1px solid", borderRadius: 9, padding: "12px 14px", marginBottom: 8 },
  statusRow: { display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  statusSub: { fontSize: 12, marginTop: 3, opacity: 0.85 },
  signBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 14, marginTop: 4 },
  error: { fontSize: 12, color: "#c62828", margin: "6px 0 0" },
  note: { fontSize: 12, color: "#888", lineHeight: 1.6, margin: "0 0 6px" },
  shirtPrompt: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#eef4fb", border: "1px solid #cfe0f3", borderRadius: 9, padding: "10px 12px", marginBottom: 8 },
  shirtSelect: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  shirtBtn: { padding: "6px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  historyToggle: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, padding: "4px 0" },
  historyList: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  historyRow: { display: "flex", alignItems: "center", gap: 10, padding: "5px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 12 },
  historyYear: { fontWeight: 700, color: "#1a3a5c", minWidth: 90 },
  historyDate: { color: "#555" },
};
