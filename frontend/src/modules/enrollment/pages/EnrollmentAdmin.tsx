/**
 * EnrollmentAdmin
 * ===============
 * Admin page for annual enrollment management:
 *   - View all seasons with enrollment counts
 *   - Close (expire) a past season with confirmation
 *   - Configure the renewal reminder notification
 *   - Understand grace period status
 */
import { useState, useEffect, type FormEvent } from "react";
import { api } from "../../../core/api";
import {
  ArrowLeft, CheckCircle, AlertTriangle,
  Lock, Clock, Bell, BellOff, RefreshCw,
} from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { graceEndLabel, formatDate } from "../../../core/dateUtils";
import ConsentSectionsEditor from "../components/ConsentSectionsEditor";
import HandbookEditor from "../components/HandbookEditor";

interface SeasonSummary {
  enrollment_year: number;
  label: string;
  season_end: string;
  is_current: boolean;
  is_future: boolean;
  is_past: boolean;
  in_grace_period: boolean;
  grace_ends?: string;
  active_count: number;
  expired_count: number;
  suspended_count: number;
  total_count: number;
  bulk_closed: boolean;
  closed_at?: string;
  closed_by_id?: number;
  enrollments_expired?: number;
  can_close: boolean;
}

interface RenewalReminder {
  enabled: boolean;
  message: string;
  target_year: number;
}

export default function EnrollmentAdmin() {
  const goBack = useGoBack("/admin");
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [reminder, setReminder] = useState<RenewalReminder>({ enabled: false, message: "", target_year: 0 });
  const [loading, setLoading] = useState(true);
  const [confirmSeason, setConfirmSeason] = useState<SeasonSummary | null>(null);
  const [closeNotes, setCloseNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<{ label: string; count: number } | null>(null);
  const [savingReminder, setSavingReminder] = useState(false);
  const [reminderSaved, setReminderSaved] = useState(false);
  const [fees, setFees] = useState({ base: "", additional_program: "", second_youth_base: "", third_plus_youth_base: "" });
  const [savingFees, setSavingFees] = useState(false);
  const [feesSaved, setFeesSaved] = useState(false);
  const [resettingShirts, setResettingShirts] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [seasonsData, reminderData, feesData] = await Promise.all([
        api.get("/api/v1/enrollment/admin/season-summary").then(r => r.data),
        api.get("/api/v1/enrollment/admin/renewal-reminder").then(r => r.data),
        api.get("/api/v1/enrollment/fees").then(r => r.data),
      ]);
      setSeasons(seasonsData);
      setReminder(reminderData);
      setFees({ base: String(feesData.base ?? 0), additional_program: String(feesData.additional_program ?? 0),
        second_youth_base: String(feesData.second_youth_base ?? feesData.base ?? 0),
        third_plus_youth_base: String(feesData.third_plus_youth_base ?? feesData.base ?? 0) });
    } finally {
      setLoading(false);
    }
  }

  async function handleClose() {
    if (!confirmSeason) return;
    setClosing(true);
    try {
      const { data } = await api.post("/api/v1/enrollment/admin/close-season", {
        enrollment_year: confirmSeason.enrollment_year,
        notes: closeNotes || null,
      });
      setCloseResult({ label: data.label, count: data.enrollments_expired });
      setConfirmSeason(null);
      setCloseNotes("");
      loadAll();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to close season.");
    } finally {
      setClosing(false);
    }
  }

  async function saveReminder(e: FormEvent) {
    e.preventDefault();
    setSavingReminder(true);
    try {
      await api.put("/api/v1/enrollment/admin/renewal-reminder", reminder);
      setReminderSaved(true);
      setTimeout(() => setReminderSaved(false), 3000);
    } finally {
      setSavingReminder(false);
    }
  }

  async function saveFees(e: FormEvent) {
    e.preventDefault();
    setSavingFees(true);
    try {
      await api.put("/api/v1/enrollment/fees", {
        base: parseFloat(fees.base) || 0,
        additional_program: parseFloat(fees.additional_program) || 0,
        second_youth_base: parseFloat(fees.second_youth_base) || 0,
        third_plus_youth_base: parseFloat(fees.third_plus_youth_base) || 0,
      });
      setFeesSaved(true);
      setTimeout(() => setFeesSaved(false), 3000);
    } finally {
      setSavingFees(false);
    }
  }

  async function resetShirtSizes() {
    if (!confirm("Clear the shirt size on every active member so they re-enter it for the new season? This can't be undone.")) return;
    setResettingShirts(true);
    try {
      const { data } = await api.post("/api/v1/enrollment/admin/reset-shirt-sizes", {});
      alert(data.message ?? `Cleared ${data.reset} shirt size(s).`);
    } catch (err) {
      alert((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to reset shirt sizes.");
    } finally {
      setResettingShirts(false);
    }
  }

  // const currentYear = seasons.find(s => s.is_current);
  const graceSeason = seasons.find(s => s.in_grace_period);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>Enrollment Season Management</h1>
          <button style={styles.refreshBtn} onClick={loadAll} disabled={loading}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <p style={styles.sub}>
          Manage annual enrollment cycles, close expired seasons, and configure member notifications.
          Enrollment year runs <strong>July 1 – June 30</strong>.
          A grace period (through <strong>{graceEndLabel()}</strong>) applies after each season ends.
        </p>
      </div>

      {/* Grace period notice */}
      {graceSeason && (
        <div style={styles.graceBanner}>
          <Clock size={16} color="#f57c00" />
          <div>
            <strong>Grace period active</strong> for season {graceSeason.label}.
            Members who were enrolled last season but haven't re-enrolled yet can still check in until {graceSeason.grace_ends ? formatDate(graceSeason.grace_ends) : graceEndLabel()}.
            T&C enforcement is also suspended during this window.
          </div>
        </div>
      )}

      {/* Enrollment fee schedule */}
      <form onSubmit={saveFees} style={styles.feesCard}>
        <div style={styles.feesTitle}>Enrollment Fees</div>
        <p style={styles.feesHint}>
          New enrollments auto-calculate the amount due: the <strong>first-program fee</strong> (discounted for a
          family's 2nd and 3rd+ youth), and the <strong>additional-program fee</strong> for every program beyond a
          youth's first. Sibling rank is by the order youth in a family enroll each year. Admins can override the amount
          on any individual enrollment.
        </p>
        <div style={styles.feesRow}>
          <div>
            <label style={styles.label}>1st youth — first program ($)</label>
            <input type="number" step="0.01" min="0" style={styles.feeInput}
              value={fees.base} onChange={(e) => setFees({ ...fees, base: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>2nd youth — first program ($)</label>
            <input type="number" step="0.01" min="0" style={styles.feeInput}
              value={fees.second_youth_base} onChange={(e) => setFees({ ...fees, second_youth_base: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>3rd+ youth — first program ($)</label>
            <input type="number" step="0.01" min="0" style={styles.feeInput}
              value={fees.third_plus_youth_base} onChange={(e) => setFees({ ...fees, third_plus_youth_base: e.target.value })} />
          </div>
          <div>
            <label style={styles.label}>Additional-program fee ($)</label>
            <input type="number" step="0.01" min="0" style={styles.feeInput}
              value={fees.additional_program} onChange={(e) => setFees({ ...fees, additional_program: e.target.value })} />
          </div>
          <button type="submit" style={styles.feesSaveBtn} disabled={savingFees}>
            {feesSaved ? <><CheckCircle size={14} /> Saved</> : (savingFees ? "Saving…" : "Save Fees")}
          </button>
        </div>
      </form>

      {/* Registration waivers & consents editor (configurable catalog) */}
      <ConsentSectionsEditor />

      {/* TRC Handbook link editor */}
      <HandbookEditor />

      {/* Season rollover utilities */}
      <div style={styles.feesCard}>
        <div style={styles.feesTitle}>New-Season Reset</div>
        <p style={styles.feesHint}>
          Start-of-season housekeeping. <strong>Reset shirt sizes</strong> clears the saved shirt size on every active
          member so everyone re-enters a current size for the new season.
        </p>
        <button type="button" style={styles.resetBtn} onClick={resetShirtSizes} disabled={resettingShirts}>
          {resettingShirts ? "Resetting…" : "Reset all shirt sizes"}
        </button>
      </div>

      {/* Close confirmation modal */}
      {confirmSeason && (
        <div style={styles.modalOverlay} onClick={() => setConfirmSeason(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Close Season {confirmSeason.label}?</h2>
            <p style={styles.modalText}>
              This will set <strong>{confirmSeason.active_count} active enrollment record{confirmSeason.active_count !== 1 ? "s" : ""}</strong> to
              <strong> expired</strong>. This action cannot be undone from this screen.
            </p>
            <div style={styles.modalWarning}>
              <AlertTriangle size={14} />
              <span>
                Members with no current-season enrollment will lose check-in access
                (after the grace period ends on {graceEndLabel()}).
              </span>
            </div>
            <label style={styles.label}>Notes (optional)</label>
            <textarea
              style={styles.textarea}
              value={closeNotes}
              onChange={e => setCloseNotes(e.target.value)}
              placeholder="e.g. End of 2024-2025 season"
            />
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setConfirmSeason(null)}>Cancel</button>
              <button style={styles.closeSeasonBtn} onClick={handleClose} disabled={closing}>
                <Lock size={13} /> {closing ? "Closing…" : `Yes, Expire ${confirmSeason.active_count} Enrollments`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {closeResult && (
        <div style={styles.successToast}>
          <CheckCircle size={16} color="#2e7d32" />
          Season {closeResult.label} closed — {closeResult.count} enrollment{closeResult.count !== 1 ? "s" : ""} expired.
          <button style={styles.dismissBtn} onClick={() => setCloseResult(null)}>✕</button>
        </div>
      )}

      {/* Season table */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Enrollment Seasons</h2>
        {loading ? <p style={styles.muted}>Loading…</p> : (
          <table style={styles.table}>
            <thead>
              <tr>
                {["Season","Status","Active","Expired","Suspended","Total","Action"].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seasons.map(s => (
                <tr key={s.enrollment_year} style={{
                  ...styles.tr,
                  background: s.is_current ? "#f0f8ff" : s.is_future ? "#f9fff9" : "transparent",
                }}>
                  <td style={styles.td}>
                    <strong>{s.label}</strong>
                    <div style={{ fontSize: 11, color: "#aaa" }}>ends {s.season_end}</div>
                  </td>
                  <td style={styles.td}>
                    <SeasonStatusBadge season={s} />
                  </td>
                  <td style={{ ...styles.td, color: s.active_count > 0 ? "#2e7d32" : "#aaa", fontWeight: 600 }}>
                    {s.active_count}
                  </td>
                  <td style={{ ...styles.td, color: s.expired_count > 0 ? "#888" : "#ccc" }}>
                    {s.expired_count}
                  </td>
                  <td style={{ ...styles.td, color: s.suspended_count > 0 ? "#f57c00" : "#ccc" }}>
                    {s.suspended_count}
                  </td>
                  <td style={styles.td}>{s.total_count}</td>
                  <td style={styles.td}>
                    {s.can_close ? (
                      <button style={styles.closeBtn} onClick={() => { setConfirmSeason(s); setCloseNotes(""); }}>
                        <Lock size={12} /> Close Season
                      </button>
                    ) : s.bulk_closed ? (
                      <div style={styles.closedTag}>
                        <CheckCircle size={12} /> Closed {s.closed_at ? new Date(s.closed_at).toLocaleDateString() : ""}
                      </div>
                    ) : s.is_current ? (
                      <span style={styles.activeTag}>Active</span>
                    ) : s.is_future ? (
                      <span style={styles.futureTag}>Future</span>
                    ) : (
                      <span style={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={styles.tableNote}>
          💡 Only past seasons with active enrollments can be closed. Current and future seasons cannot be closed.
          Members can enroll for the next season before the current one ends.
        </div>
      </div>

      {/* Renewal reminder */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>
          <Bell size={14} style={{ marginRight: 6 }} />
          Enrollment Renewal Reminder
        </h2>
        <p style={styles.sub}>
          When enabled, a notification banner is shown to all members when they log in.
          Use this to remind members to re-enroll for the new season.
        </p>
        <form onSubmit={saveReminder}>
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={reminder.enabled}
              onChange={e => setReminder(r => ({ ...r, enabled: e.target.checked }))}
            />
            <span><strong>Show renewal reminder to all members</strong></span>
            {reminder.enabled
              ? <span style={styles.enabledTag}><Bell size={11} /> Showing</span>
              : <span style={styles.disabledTag}><BellOff size={11} /> Hidden</span>
            }
          </label>
          <div style={{ marginTop: 12 }}>
            <label style={styles.label}>Reminder Message</label>
            <textarea
              style={styles.textarea}
              value={reminder.message}
              onChange={e => setReminder(r => ({ ...r, message: e.target.value }))}
              placeholder="e.g. Enrollment for the 2026-2027 season is now open! Please re-enroll to continue participating."
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={styles.label}>Target Enrollment Year</label>
            <input
              type="number"
              style={styles.input}
              value={reminder.target_year || ""}
              onChange={e => setReminder(r => ({ ...r, target_year: parseInt(e.target.value) || 0 }))}
              placeholder="e.g. 2026"
            />
            <p style={styles.inputHint}>
              The year members are being asked to enroll for (e.g. 2026 = the 2026-2027 season).
            </p>
          </div>
          <div style={styles.saveRow}>
            {reminderSaved && (
              <span style={styles.savedMsg}><CheckCircle size={13} /> Saved</span>
            )}
            <button type="submit" style={styles.saveBtn} disabled={savingReminder}>
              {savingReminder ? "Saving…" : "Save Reminder Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SeasonStatusBadge({ season: s }: { season: SeasonSummary }) {
  if (s.in_grace_period) return <span style={styles.graceBadge}><Clock size={11} /> Grace Period</span>;
  if (s.bulk_closed) return <span style={styles.expiredBadge}><Lock size={11} /> Closed</span>;
  if (s.is_future) return <span style={styles.futureBadge}>Future</span>;
  if (s.is_current) return <span style={styles.currentBadge}>Current</span>;
  return <span style={styles.pastBadge}>Past</span>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 980, margin: "0 auto" },
  feesCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: 16 },
  feesTitle: { fontSize: 13, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 6 },
  feesHint: { fontSize: 12.5, color: "#666", lineHeight: 1.5, margin: "0 0 12px" },
  feesRow: { display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" as const },
  feeInput: { width: 160, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  feesSaveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  resetBtn: { padding: "9px 18px", background: "#fff", color: "#c62828", border: "1px solid #ef9a9a", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  header: { marginBottom: 20 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  headingRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  refreshBtn: { display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#666", lineHeight: 1.6 },
  graceBanner: { display: "flex", alignItems: "flex-start", gap: 10, background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 9, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#e65100" },
  section: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem", marginBottom: 16 },
  sectionTitle: { margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a3a5c", display: "flex", alignItems: "center", paddingBottom: 10, borderBottom: "1px solid #f0f4f8" },
  muted: { fontSize: 13, color: "#aaa" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "9px 12px", background: "#f0f4f8", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "10px 12px" },
  tableNote: { fontSize: 12, color: "#888", marginTop: 12, lineHeight: 1.6 },
  closeBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#c62828", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  closedTag: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#2e7d32" },
  activeTag: { fontSize: 12, color: "#1565c0", fontWeight: 600 },
  futureTag: { fontSize: 12, color: "#2e7d32", fontWeight: 600 },
  // Badges
  currentBadge: { padding: "2px 8px", borderRadius: 8, background: "#e3f2fd", color: "#1565c0", fontSize: 11, fontWeight: 600 },
  futureBadge: { padding: "2px 8px", borderRadius: 8, background: "#e8f5e9", color: "#2e7d32", fontSize: 11, fontWeight: 600 },
  pastBadge: { padding: "2px 8px", borderRadius: 8, background: "#f5f5f5", color: "#888", fontSize: 11 },
  graceBadge: { display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 8, background: "#fff3e0", color: "#e65100", fontSize: 11, fontWeight: 600 },
  expiredBadge: { display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 8, background: "#f5f5f5", color: "#757575", fontSize: 11 },
  // Confirmation modal
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal: { background: "#fff", borderRadius: 12, padding: "2rem", width: 520, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" },
  modalTitle: { margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#c62828" },
  modalText: { fontSize: 14, color: "#444", lineHeight: 1.7, marginBottom: 14 },
  modalWarning: { display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 7, fontSize: 13, color: "#795548", marginBottom: 16, lineHeight: 1.6 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  closeSeasonBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  successToast: { display: "flex", alignItems: "center", gap: 10, background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 9, padding: "12px 16px", marginBottom: 14, fontSize: 14, color: "#2e7d32" },
  dismissBtn: { marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16 },
  // Reminder form
  checkRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 },
  enabledTag: { display: "flex", alignItems: "center", gap: 4, marginLeft: 12, padding: "2px 10px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 10, fontSize: 11, fontWeight: 600 },
  disabledTag: { display: "flex", alignItems: "center", gap: 4, marginLeft: 12, padding: "2px 10px", background: "#f5f5f5", color: "#888", borderRadius: 10, fontSize: 11 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 },
  textarea: { width: "100%", minHeight: 80, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, resize: "vertical" as const, boxSizing: "border-box" as const },
  input: { width: 120, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  inputHint: { fontSize: 11, color: "#888", margin: "4px 0 0" },
  saveRow: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 14 },
  savedMsg: { display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#2e7d32" },
  saveBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
