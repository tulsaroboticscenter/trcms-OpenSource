/**
 * AdultRolePanel — embedded in MemberProfile for mentor/adult members.
 * Shows YPT & background check compliance with expiration dates and warnings.
 * Admins can update compliance and log new completion records per season.
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { currentSeasonYear } from "../../../core/dateUtils";
import { useAuth } from "../../../core/AuthContext";
import { rolesApi, type AdultRoleRecord } from "../api";
import { api } from "../../../core/api";
import { CheckCircle, XCircle, AlertTriangle, Clock, PlusCircle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

const ADULT_ROLES = ["Mentor", "Admin", "Volunteer", "Parent", "Sponsor", "Board Member"];

interface ComplianceStatus {
  status: string;
  days_remaining?: number;
  expires_date?: string;
  expiring_soon: boolean;
  expired: boolean;
  completed_date?: string;
  enrollment_year?: number;
}

interface FullComplianceStatus {
  is_compliant: boolean;
  has_warning: boolean;
  ypt: ComplianceStatus;
  background_check: ComplianceStatus;
  first: ComplianceStatus;
  consent_release: ComplianceStatus;
  role_specific: ComplianceStatus;
  config: { ypt_valid_years: number; bgcheck_valid_years: number; first_valid_years: number; consent_release_valid_years: number; role_specific_valid_years: number; warning_days: number };
}

type ComplianceType = "ypt" | "background_check" | "first" | "consent_release" | "role_specific";
const TYPE_LABELS: Record<ComplianceType, string> = {
  ypt: "YPT", background_check: "Background Check", first: "FIRST Registration",
  consent_release: "Consent & Release", role_specific: "Role-Specific Training",
};

interface ComplianceRecord {
  id: number;
  compliance_type: string;
  enrollment_year: number;
  enrollment_year_label: string;
  completed_date: string;
  expires_date: string;
  notes?: string;
}

interface Props { memberId: number; }

export default function AdultRolePanel({ memberId }: Props) {
  const { isAdmin, user } = useAuth();
  const isSelf = user?.id === memberId;   // a member may edit their own expertise (#146)
  const [role, setRole] = useState<AdultRoleRecord & { compliance_status?: FullComplianceStatus } | null>(null);
  const [expertiseOptions, setExpertiseOptions] = useState<string[]>([]);
  const [history, setHistory] = useState<ComplianceRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [addingRecord, setAddingRecord] = useState<ComplianceType | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Edit fields
  const [yptDone, setYptDone] = useState(false);
  const [yptDate, setYptDate] = useState("");
  const [bgDone, setBgDone] = useState(false);
  const [bgDate, setBgDate] = useState("");
  const [firstDone, setFirstDone] = useState(false);
  const [firstDate, setFirstDate] = useState("");
  const [crDone, setCrDone] = useState(false);
  const [crDate, setCrDate] = useState("");
  const [rsDone, setRsDone] = useState(false);
  const [rsDate, setRsDate] = useState("");
  const [adultRole, setAdultRole] = useState("");
  const [expertise, setExpertise] = useState<string[]>([]);
  const [serviceYears, setServiceYears] = useState("");
  const [onHold, setOnHold] = useState(false);
  const [holdNote, setHoldNote] = useState("");
  const [requiresYpt, setRequiresYpt] = useState(false);

  // New compliance record fields
  const [newYear, setNewYear] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newNotes, setNewNotes] = useState("");

  // Build enrollment year options
  const currentYear = currentSeasonYear();
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i).reverse();

  // Configurable compliance item labels (open-source Phase 4); default to the
  // built-in FIRST names until the org's config loads.
  const [labels, setLabels] = useState<Record<string, string>>(TYPE_LABELS);

  useEffect(() => {
    Promise.all([
      rolesApi.getAdultRole(memberId),
      rolesApi.getExpertise(),
      rolesApi.complianceItems().catch(() => null),
    ]).then(([r, opts, items]) => {
      setRole(r as AdultRoleRecord & { compliance_status?: FullComplianceStatus });
      setExpertiseOptions(opts);
      if (items?.items) setLabels(Object.fromEntries(items.items.map((it) => [it.key, it.label])));
    }).finally(() => setLoading(false));
  }, [memberId]);

  async function loadHistory() {
    const { data } = await api.get(`/api/v1/roles/adult/${memberId}/compliance-history`);
    setHistory(data);
  }

  async function deleteRecord(rec: ComplianceRecord) {
    if (!confirm(`Delete this ${labels[rec.compliance_type] ?? rec.compliance_type} record (completed ${new Date(rec.completed_date).toLocaleDateString()})? This can't be undone.`)) return;
    try {
      const data = await rolesApi.deleteComplianceRecord(memberId, rec.id);
      setHistory(prev => prev.filter(r => r.id !== rec.id));
      if (data?.compliance_status) setRole(prev => prev ? { ...prev, compliance_status: data.compliance_status } : prev);
    } catch { setError("Failed to delete record."); }
  }

  function startEdit() {
    if (!role) return;
    setYptDone(role.ypt_complete);
    setYptDate(role.ypt_date?.split("T")[0] ?? "");
    setBgDone(role.background_check_complete);
    setBgDate(role.background_check_date?.split("T")[0] ?? "");
    setFirstDone(role.first_complete ?? false);
    setFirstDate(role.first_date?.split("T")[0] ?? "");
    setCrDone(role.consent_release_complete ?? false);
    setCrDate(role.consent_release_date?.split("T")[0] ?? "");
    setRsDone(role.role_specific_complete ?? false);
    setRsDate(role.role_specific_date?.split("T")[0] ?? "");
    setAdultRole(role.role ?? "");
    setExpertise(role.areas_of_expertise ?? []);
    setServiceYears(String(role.service_years ?? 0));
    setOnHold(role.on_hold);
    setHoldNote(role.on_hold_note ?? "");
    setRequiresYpt(role.requires_ypt ?? false);
    setError("");
    setEditing(true);
  }

  function toggleExpertise(item: string) {
    setExpertise(prev => prev.includes(item) ? prev.filter(e => e !== item) : [...prev, item]);
  }

  async function save() {
    setSaving(true); setError("");
    try {
      // A member editing their own record may only change expertise; admins send everything.
      // Send null (not undefined) when a box is unchecked or a date is cleared so the server
      // actually removes a stored/erroneous date (#82).
      const payload = isAdmin ? {
        ypt_complete: yptDone, ypt_date: yptDone ? (yptDate || null) : null,
        background_check_complete: bgDone, background_check_date: bgDone ? (bgDate || null) : null,
        first_complete: firstDone, first_date: firstDone ? (firstDate || null) : null,
        consent_release_complete: crDone, consent_release_date: crDone ? (crDate || null) : null,
        role_specific_complete: rsDone, role_specific_date: rsDone ? (rsDate || null) : null,
        role: adultRole || undefined, areas_of_expertise: expertise,
        service_years: parseInt(serviceYears) || 0,
        on_hold: onHold, on_hold_note: holdNote || undefined,
        requires_ypt: requiresYpt,
      } : { areas_of_expertise: expertise };
      const updated = await rolesApi.updateAdultRole(memberId, payload);
      setRole(updated as AdultRoleRecord & { compliance_status?: FullComplianceStatus });
      setEditing(false);
    } catch { setError("Failed to save."); }
    finally { setSaving(false); }
  }

  async function saveComplianceRecord() {
    if (!addingRecord || !newYear || !newDate) return;
    setSaving(true); setError("");
    try {
      const { data } = await api.post(`/api/v1/roles/adult/${memberId}/compliance-record`, {
        compliance_type: addingRecord,
        enrollment_year: parseInt(newYear),
        completed_date: newDate,
        notes: newNotes || null,
      });
      setRole(prev => prev ? { ...prev, compliance_status: data.compliance_status } : prev);
      setAddingRecord(null);
      setNewYear(""); setNewNotes("");
      if (showHistory) loadHistory();
    } catch { setError("Failed to save compliance record."); }
    finally { setSaving(false); }
  }

  if (loading) return <p style={s.muted}>Loading…</p>;

  const cs = role?.compliance_status;
  const compliant = cs?.is_compliant ?? false;
  const hasWarning = cs?.has_warning ?? false;

  return (
    <div>
      {/* Compliance status bar */}
      <div style={{
        ...s.complianceBar,
        background: compliant && !hasWarning ? "#e8f5e9" : hasWarning ? "#fff8e1" : "#ffebee",
        borderColor: compliant && !hasWarning ? "#a5d6a7" : hasWarning ? "#ffd54f" : "#ef9a9a",
      }}>
        {compliant && !hasWarning
          ? <CheckCircle size={14} color="#2e7d32" />
          : hasWarning
          ? <Clock size={14} color="#f57c00" />
          : <AlertTriangle size={14} color="#c62828" />
        }
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: compliant && !hasWarning ? "#2e7d32" : hasWarning ? "#f57c00" : "#c62828",
        }}>
          {compliant && !hasWarning
            ? "FIRST Compliant"
            : hasWarning
            ? "Compliance expiring soon — renewal required"
            : "Not Fully Compliant — limited access applies"
          }
        </span>
      </div>

      {/* Getting-started instructions (#165) — the VIRTUS registration walkthrough */}
      <div style={{ marginTop: 6, marginBottom: 2 }}>
        <Link to="/help/youth-protection-training" style={s.instructionsLink}>
          How to complete YPT &amp; the background check (VIRTUS) →
        </Link>
      </div>

      {/* YPT and BG check with expiration */}
      <div style={s.infoGrid}>
        <ComplianceRow
          label="YPT"
          done={role?.ypt_complete ?? false}
          date={role?.ypt_date}
          status={cs?.ypt}
          onAdd={isAdmin ? () => { setAddingRecord("ypt"); setNewYear(String(currentYear)); setNewDate(new Date().toISOString().split("T")[0]); } : undefined}
        />
        <ComplianceRow
          label="Background Check"
          done={role?.background_check_complete ?? false}
          date={role?.background_check_date}
          status={cs?.background_check}
          onAdd={isAdmin ? () => { setAddingRecord("background_check"); setNewYear(String(currentYear)); setNewDate(new Date().toISOString().split("T")[0]); } : undefined}
        />
        <ComplianceRow
          label="FIRST Registration"
          done={role?.first_complete ?? false}
          date={role?.first_date}
          status={cs?.first}
          onAdd={isAdmin ? () => { setAddingRecord("first"); setNewYear(String(currentYear)); setNewDate(new Date().toISOString().split("T")[0]); } : undefined}
        />
        <ComplianceRow
          label="Consent & Release"
          done={role?.consent_release_complete ?? false}
          date={role?.consent_release_date}
          status={cs?.consent_release}
          onAdd={isAdmin ? () => { setAddingRecord("consent_release"); setNewYear(String(currentYear)); setNewDate(new Date().toISOString().split("T")[0]); } : undefined}
        />
        <ComplianceRow
          label="Role-Specific Training"
          done={role?.role_specific_complete ?? false}
          date={role?.role_specific_date}
          status={cs?.role_specific}
          onAdd={isAdmin ? () => { setAddingRecord("role_specific"); setNewYear(String(currentYear)); setNewDate(new Date().toISOString().split("T")[0]); } : undefined}
        />
      </div>

      {/* Add compliance record form */}
      {addingRecord && (
        <div style={s.addRecordForm}>
          <div style={s.addRecordTitle}>
            Log new {labels[addingRecord]} completion
            {cs?.config && (() => {
              const yrs = { ypt: cs.config.ypt_valid_years, background_check: cs.config.bgcheck_valid_years, first: cs.config.first_valid_years, consent_release: cs.config.consent_release_valid_years, role_specific: cs.config.role_specific_valid_years }[addingRecord];
              return <span style={s.durationNote}>(valid {yrs} year{yrs !== 1 ? "s" : ""} from completion date)</span>;
            })()}
          </div>
          <div style={s.addRecordGrid}>
            <div>
              <label style={s.label}>Season</label>
              <select style={s.input} value={newYear} onChange={e => setNewYear(e.target.value)}>
                <option value="">Select season…</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}–{y+1}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Completion Date</label>
              <input type="date" style={s.input} value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Notes</label>
              <input style={s.input} value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          {error && <p style={s.error}>{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={s.saveBtn} onClick={saveComplianceRecord} disabled={saving || !newYear || !newDate}>
              {saving ? "Saving…" : "Save Record"}
            </button>
            <button style={s.cancelBtn} onClick={() => { setAddingRecord(null); setError(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Role, expertise, service */}
      {!editing ? (
        <>
          {role?.role && <div style={s.roleTag}>{role.role}</div>}
          {(role?.areas_of_expertise?.length ?? 0) > 0 && (
            <div style={s.expertiseTags}>
              {role!.areas_of_expertise.map(e => <span key={e} style={s.expertiseTag}>{e}</span>)}
            </div>
          )}
          <div style={s.serviceRow}>
            {(role?.service_years ?? 0) > 0 && (
              <span style={s.serviceBadge}>🏆 {role!.service_years} year{role!.service_years !== 1 ? "s" : ""} of service</span>
            )}
            {role?.on_hold && <span style={s.holdBadge}>⏸ On Hold{role.on_hold_note ? `: ${role.on_hold_note}` : ""}</span>}
            {role?.requires_ypt && role?.member_type !== "mentor" && <span style={s.serviceBadge}>🛡️ YPT-required volunteer</span>}
          </div>
          {(isAdmin || isSelf) && <button style={s.editBtn} onClick={startEdit}>{isAdmin ? "Update Role & Expertise" : "Update My Expertise"}</button>}
        </>
      ) : (
        /* Edit form */
        <div style={s.editForm}>
          {/* Compliance (YPT/BG/FIRST) and role/service are admin-verified — hidden when a
              member is editing their own record (#146). */}
          {isAdmin && (
            <div style={s.formSection}>
              <div style={s.formSectionLabel}>FIRST Compliance</div>
              <div style={s.grid2}>
                <div>
                  <label style={s.checkRow}><input type="checkbox" checked={yptDone} onChange={e => setYptDone(e.target.checked)} /><span>YPT Complete</span></label>
                  {yptDone && <><label style={s.label}>YPT Date</label><input type="date" style={s.input} value={yptDate} onChange={e => setYptDate(e.target.value)} /></>}
                </div>
                <div>
                  <label style={s.checkRow}><input type="checkbox" checked={bgDone} onChange={e => setBgDone(e.target.checked)} /><span>Background Check Complete</span></label>
                  {bgDone && <><label style={s.label}>BG Check Date</label><input type="date" style={s.input} value={bgDate} onChange={e => setBgDate(e.target.value)} /></>}
                </div>
                <div>
                  <label style={s.checkRow}><input type="checkbox" checked={firstDone} onChange={e => setFirstDone(e.target.checked)} /><span>FIRST Registration (annual)</span></label>
                  {firstDone && <><label style={s.label}>FIRST Date</label><input type="date" style={s.input} value={firstDate} onChange={e => setFirstDate(e.target.value)} /></>}
                </div>
                <div>
                  <label style={s.checkRow}><input type="checkbox" checked={crDone} onChange={e => setCrDone(e.target.checked)} /><span>Consent &amp; Release (annual)</span></label>
                  {crDone && <><label style={s.label}>Consent &amp; Release Date</label><input type="date" style={s.input} value={crDate} onChange={e => setCrDate(e.target.value)} /></>}
                </div>
                <div>
                  <label style={s.checkRow}><input type="checkbox" checked={rsDone} onChange={e => setRsDone(e.target.checked)} /><span>Role-Specific Training (annual)</span></label>
                  {rsDone && <><label style={s.label}>Role-Specific Date</label><input type="date" style={s.input} value={rsDate} onChange={e => setRsDate(e.target.value)} /></>}
                </div>
              </div>
              {/* #182 — hold this adult (volunteer/parent) to mentor-level YPT compliance. */}
              <label style={s.checkRow}>
                <input type="checkbox"
                  checked={role?.member_type === "mentor" ? true : requiresYpt}
                  disabled={role?.member_type === "mentor"}
                  onChange={e => setRequiresYpt(e.target.checked)} />
                <span>Requires YPT — works near youth regularly (a "TRC Volunteer"){role?.member_type === "mentor" ? "; mentors always require it" : ""}</span>
              </label>
              <p style={s.hint}>When on, this person must have current YPT + background check to check in, and shows on the compliance list — just like a mentor.</p>
            </div>
          )}
          {isAdmin && (
            <div style={s.formSection}>
              <div style={s.formSectionLabel}>Role & Service</div>
              <div style={s.grid2}>
                <div><label style={s.label}>Role</label><select style={s.input} value={adultRole} onChange={e => setAdultRole(e.target.value)}><option value="">Select…</option>{ADULT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                <div><label style={s.label}>Years of Service</label><input type="number" min="0" style={s.input} value={serviceYears} onChange={e => setServiceYears(e.target.value)} /></div>
              </div>
              <label style={s.checkRow}><input type="checkbox" checked={onHold} onChange={e => setOnHold(e.target.checked)} /><span>On Hold</span></label>
              {onHold && <input style={s.input} value={holdNote} onChange={e => setHoldNote(e.target.value)} placeholder="Reason for hold…" />}
            </div>
          )}
          <div style={s.formSection}>
            <div style={s.formSectionLabel}>Areas of Expertise</div>
            <div style={s.expertiseCheckGrid}>
              {expertiseOptions.map(opt => (
                <label key={opt} style={s.expertiseCheck}><input type="checkbox" checked={expertise.includes(opt)} onChange={() => toggleExpertise(opt)} /><span>{opt}</span></label>
              ))}
            </div>
          </div>
          {error && <p style={s.error}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setEditing(false)} style={s.cancelBtn}>Cancel</button>
            <button onClick={save} style={s.saveBtn} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}

      {/* Compliance history toggle */}
      <button style={s.historyToggle} onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}>
        {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {showHistory ? "Hide" : "Show"} compliance history
      </button>

      {showHistory && history.length > 0 && (
        <div style={s.historyList}>
          {history.map(rec => (
            <div key={rec.id} style={s.historyRow}>
              <span style={{ ...s.historyType, color: rec.compliance_type === "ypt" ? "#1565c0" : "#2e7d32" }}>
                {labels[rec.compliance_type] ?? rec.compliance_type}
              </span>
              <span style={s.historyYear}>{rec.enrollment_year_label}</span>
              <span style={s.historyDate}>Completed {new Date(rec.completed_date).toLocaleDateString()}</span>
              <span style={s.historyExpiry}>Expires {new Date(rec.expires_date).toLocaleDateString()}</span>
              {rec.notes && <span style={s.historyNotes}>{rec.notes}</span>}
              {isAdmin && (
                <button style={s.historyDelete} title="Delete this record" onClick={() => deleteRecord(rec)}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {showHistory && history.length === 0 && <p style={s.muted}>No compliance history records yet.</p>}
    </div>
  );
}

function ComplianceRow({ label, done, date, status, onAdd }: {
  label: string; done: boolean; date?: string;
  status?: ComplianceStatus; onAdd?: () => void;
}) {
  const color = status?.expired ? "#c62828" : status?.expiring_soon ? "#f57c00" : done ? "#2e7d32" : "#ccc";
  const Icon = status?.expired || !done ? XCircle : status?.expiring_soon ? Clock : CheckCircle;
  return (
    <div style={s.complianceItem}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Icon size={14} color={color} />
        <span style={{ fontSize: 13, color: done ? "#333" : "#aaa", fontWeight: 500 }}>{label}</span>
      </div>
      {done && date && <div style={s.complianceDate}>Completed {new Date(date).toLocaleDateString()}</div>}
      {status?.expires_date && <div style={{ ...s.expiryDate, color }}>
        {status.expired ? "Expired" : "Expires"} {new Date(status.expires_date).toLocaleDateString()}
        {status.days_remaining != null && !status.expired && (
          <span style={s.daysLeft}> · {status.days_remaining}d left</span>
        )}
        {status.expired && status.days_remaining != null && (
          <span style={s.daysLeft}> · {Math.abs(status.days_remaining)}d ago</span>
        )}
      </div>}
      {onAdd && (
        <button style={s.addRecordBtn} onClick={onAdd}>
          <PlusCircle size={11} /> Log renewal
        </button>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  muted: { fontSize: 13, color: "#aaa", margin: 0 },
  complianceBar: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, border: "1px solid", marginBottom: 10, fontSize: 12 },
  instructionsLink: { fontSize: 11.5, color: "#1a3a5c", textDecoration: "underline", fontWeight: 600 },
  infoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 },
  complianceItem: { background: "#f8fafc", borderRadius: 7, padding: "8px 10px", border: "1px solid #e2e8f0" },
  complianceDate: { fontSize: 11, color: "#888", marginTop: 2 },
  expiryDate: { fontSize: 11, fontWeight: 600, marginTop: 3 },
  daysLeft: { fontWeight: 400, color: "inherit", opacity: 0.8 },
  addRecordBtn: { display: "flex", alignItems: "center", gap: 4, marginTop: 6, background: "none", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer", fontSize: 11, padding: "2px 8px", color: "#555" },
  addRecordForm: { background: "#f0f4f8", border: "1px solid #1a3a5c", borderRadius: 8, padding: "12px", marginBottom: 10 },
  addRecordTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 },
  durationNote: { fontSize: 11, color: "#888", fontWeight: 400 },
  addRecordGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 12px" },
  roleTag: { display: "inline-block", padding: "3px 10px", background: "#1a3a5c", color: "#fff", borderRadius: 10, fontSize: 12, fontWeight: 600, marginBottom: 8 },
  expertiseTags: { display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 },
  expertiseTag: { padding: "2px 8px", background: "#e3f2fd", color: "#1565c0", borderRadius: 8, fontSize: 11, fontWeight: 500 },
  serviceRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  serviceBadge: { fontSize: 12, color: "#f57c00", fontWeight: 600 },
  holdBadge: { fontSize: 12, color: "#757575", fontWeight: 600 },
  hint: { fontSize: 11.5, color: "#889", margin: "4px 0 0", lineHeight: 1.4 },
  editBtn: { marginTop: 10, padding: "5px 14px", fontSize: 12, border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", display: "block" },
  editForm: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px" },
  formSection: { marginBottom: 14 },
  formSectionLabel: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 8 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: 8 },
  checkRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6, fontSize: 13 },
  label: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "7px 9px", border: "1px solid #ccc", borderRadius: 5, fontSize: 13, boxSizing: "border-box" as const },
  expertiseCheckGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" },
  expertiseCheck: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" },
  error: { fontSize: 12, color: "#c62828", margin: "4px 0" },
  saveBtn: { padding: "6px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  cancelBtn: { padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 5, cursor: "pointer", fontSize: 13 },
  historyToggle: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, padding: "8px 0", marginTop: 4 },
  historyList: { display: "flex", flexDirection: "column", gap: 4, marginTop: 4 },
  historyRow: { display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "#f8fafc", borderRadius: 6, fontSize: 12, flexWrap: "wrap" as const },
  historyType: { fontWeight: 700, minWidth: 70 },
  historyYear: { color: "#888", minWidth: 80 },
  historyDate: { color: "#555" },
  historyExpiry: { color: "#888" },
  historyNotes: { color: "#aaa", fontStyle: "italic" },
  historyDelete: { marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#c62828", display: "flex", alignItems: "center", padding: 2 },
};
