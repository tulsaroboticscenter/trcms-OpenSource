/**
 * MemberEnrollments
 * Displays all enrollment records for a single member.
 * Used both as a standalone page (/enrollment/member/:memberId)
 * and as an embedded panel inside MemberProfile.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../core/AuthContext";
import { enrollmentApi, type Enrollment } from "../api";
import PayYouthEnrollments from "../../payments/PayYouthEnrollments";
import RecordSchoolPayment from "../../invoices/RecordSchoolPayment";
import {
  CheckCircle, XCircle, AlertCircle, PlusCircle,
  DollarSign, FileText, ChevronDown, ChevronUp,
} from "lucide-react";

interface Props {
  memberId: number;
  memberName?: string;
  embedded?: boolean; // when true, skip the page header
}

export default function MemberEnrollments({ memberId, memberName, embedded = false }: Props) {
  const navigate = useNavigate();
  const { isAdmin, hasRole } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canManage = isAdmin || hasRole("Admin", "System Administrator");

  // "Pay with Cash/Check" — purely informational; records nothing. The payment is
  // recorded by the admin team when it's handed over in person.
  const [cashOpen, setCashOpen] = useState(false);
  // "Request Payment Plan" — notifies whoever arranges plans; creates nothing here.
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState("");
  const [planErr, setPlanErr] = useState("");
  // FDP -> FTC/FRC no-cost transfer (managers only).
  const hasActiveFdp = enrollments.some((e) => (e.program_name === "FDP") && e.status !== "cancelled");
  const [xferBusy, setXferBusy] = useState(false);
  const [xferMsg, setXferMsg] = useState("");
  const [xferErr, setXferErr] = useState("");
  async function transferFdp(program: "FTC" | "FRC") {
    setXferBusy(true); setXferMsg(""); setXferErr("");
    try {
      await enrollmentApi.transferFdpFee(memberId, program);
      setXferMsg(`FDP enrollment transferred to ${program} at no additional cost.`);
      load();
    } catch (e: unknown) {
      setXferErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not transfer the FDP enrollment.");
    } finally { setXferBusy(false); }
  }

  async function requestPlan() {
    setPlanBusy(true); setPlanMsg(""); setPlanErr("");
    try {
      const r = await enrollmentApi.requestPaymentPlan(memberId);
      setPlanMsg(r.detail ?? "Your payment plan request has been sent.");
    } catch (e: unknown) {
      setPlanErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Could not send the request. Please try again, or email us directly.");
    } finally { setPlanBusy(false); }
  }

  function load() {
    enrollmentApi.getByMember(memberId)
      .then(setEnrollments)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [memberId]);

  function toggle(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  if (loading) return <div style={styles.loading}>Loading enrollments…</div>;

  return (
    <div>
      {!embedded && (
        <div style={styles.pageHeader}>
          <div>
            <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back</button>
            <h1 style={styles.heading}>
              Enrollments{memberName ? ` — ${memberName}` : ""}
            </h1>
          </div>
          {canManage && (
            <button
              style={styles.addBtn}
              onClick={() => navigate(`/enrollment/add/${memberId}`)}
            >
              <PlusCircle size={15} /> Add Enrollment
            </button>
          )}
        </div>
      )}

      {embedded && canManage && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button
            style={styles.addBtnSmall}
            onClick={() => navigate(`/enrollment/add/${memberId}`)}
          >
            <PlusCircle size={13} /> Add Enrollment
          </button>
        </div>
      )}

      <div style={{ margin: "0 0 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => navigate("/scholarship/apply")}
          style={requestBtn}
        >
          🎓 Apply for a scholarship
        </button>
        {/* Doesn't create a plan — emails whoever arranges them, with the balance and
            the family's contact details, and Reply-To set to the parent. */}
        <button onClick={requestPlan} disabled={planBusy} style={requestBtn}>
          🗓️ {planBusy ? "Sending…" : "Request Payment Plan"}
        </button>
        <button onClick={() => setCashOpen(true)} style={requestBtn}>
          💵 Pay with Cash/Check
        </button>
      </div>

      {cashOpen && (
        <div style={cashOverlay} onClick={() => setCashOpen(false)} role="presentation">
          <div style={cashModal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cashTitle">
            <h2 id="cashTitle" style={cashTitle}>Paying by cash or check</h2>
            <p style={cashBody}>
              To pay by Cash or Check, please make your payment in person at the Tulsa Robotics Center.
              Checks should be made out to &ldquo;Tulsa Robotics Center&rdquo; and payments should be made
              directly to the admin team.
            </p>
            <div style={cashActions}>
              <button style={cashOk} onClick={() => setCashOpen(false)} autoFocus>Got it</button>
            </div>
          </div>
        </div>
      )}
      {planMsg && <div style={planNote}>{planMsg}</div>}
      {planErr && <div style={planErrNote}>{planErr}</div>}

      {/* An FDP enrollment can be converted to FTC/FRC at no additional cost — the fee
          already paid moves with it. Only shown to managers, and only when the youth
          actually holds an active FDP enrollment. */}
      {canManage && hasActiveFdp && (
        <div style={{ ...planNote, background: "#eef3f8", borderColor: "#cdd7e3", color: "#33475b", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>This youth is in the FDP. Moving to a team? Transfer their FDP fee at no additional cost:</span>
          <button style={requestBtn} disabled={xferBusy} onClick={() => transferFdp("FTC")}>➡️ Transfer to FTC</button>
          <button style={requestBtn} disabled={xferBusy} onClick={() => transferFdp("FRC")}>➡️ Transfer to FRC</button>
        </div>
      )}
      {xferMsg && <div style={planNote}>{xferMsg}</div>}
      {xferErr && <div style={planErrNote}>{xferErr}</div>}

      {/* One combined "Check out with CC" for all of this youth's unpaid enrollments. */}
      <PayYouthEnrollments memberId={memberId} />
      {enrollments.length === 0 ? (
        <div style={styles.empty}>
          No enrollment records found.{" "}
          {canManage && (
            <button style={styles.linkBtn} onClick={() => navigate(`/enrollment/add/${memberId}`)}>
              Add the first one.
            </button>
          )}
        </div>
      ) : (
        <div style={styles.list}>
          {enrollments.map((e) => (
            <EnrollmentCard
              key={e.id}
              enrollment={e}
              expanded={expandedId === e.id}
              onToggle={() => toggle(e.id)}
              onEdit={() => navigate(`/enrollment/${e.id}/edit`)}
              onSignTC={() => navigate(`/enrollment/${e.id}/sign-tc`)}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  enrollment: Enrollment;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onSignTC: () => void;
  canManage: boolean;
}

function EnrollmentCard({ enrollment: e, expanded, onToggle, onEdit, onSignTC, canManage }: CardProps) {
  const isPaid = !!e.date_payment || e.payment_override;
  const tcStatus = e.fully_signed ? "complete" : e.tc_youth_agreed || e.tc_parent_agreed ? "partial" : "none";

  return (
    <div style={styles.card}>
      {/* Card header — always visible */}
      <div style={styles.cardHeader} onClick={onToggle}>
        <div style={styles.cardLeft}>
          <div style={styles.programBadge}>{e.program_name ?? "Unknown"}</div>
          <div style={styles.cardMeta}>
            <span style={styles.yearLabel}>{e.enrollment_year_label}</span>
            <StatusBadge status={e.status} />
          </div>
        </div>
        <div style={styles.cardRight}>
          <TCIndicator status={tcStatus} />
          <PaymentIndicator paid={isPaid} override={e.payment_override} />
          {expanded ? <ChevronUp size={16} color="#888" /> : <ChevronDown size={16} color="#888" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={styles.cardBody}>
          <div style={styles.detailGrid}>
            <DetailSection title="Enrollment">
              <Row label="Program" value={e.program_full_name ?? e.program_name} />
              <Row label="Year" value={e.enrollment_year_label} />
              <Row label="Date Enrolled" value={e.date_enrolled ? fmt(e.date_enrolled) : "—"} />
              <Row label="Status" value={e.status} />
              <Row label="Shirt Size" value={e.shirt_size ?? "—"} />
            </DetailSection>

            <DetailSection title="Fees & Payments">
              <FeeBreakdown e={e} />
              {e.payment_override && (
                <div style={styles.overrideTag}>⚠ Payment Override Active</div>
              )}
              {canManage && <RecordSchoolPayment enrollmentId={e.id} memberId={e.member_id} onRecorded={() => window.location.reload()} />}
            </DetailSection>

            <DetailSection title="Terms &amp; Conditions">
              <TCRow label="Youth" agreed={e.tc_youth_agreed} date={e.tc_youth_date} />
              <TCRow label="Parent / Guardian" agreed={e.tc_parent_agreed} date={e.tc_parent_date} />
              {!e.fully_signed && (
                <button style={styles.signBtn} onClick={onSignTC}>
                  <FileText size={13} /> Complete T&amp;C Signatures
                </button>
              )}
            </DetailSection>

            {e.notes && (
              <DetailSection title="Notes">
                <p style={styles.notes}>{e.notes}</p>
              </DetailSection>
            )}
          </div>

          {canManage && (
            <div style={styles.cardActions}>
              <button style={styles.editBtn} onClick={onEdit}>Edit Enrollment</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "#2e7d32", not_active: "#757575", suspended: "#c62828",
  };
  return (
    <span style={{ ...styles.statusBadge, background: colors[status] ?? "#999" }}>
      {status.replace("_", " ")}
    </span>
  );
}

function TCIndicator({ status }: { status: "complete" | "partial" | "none" }) {
  if (status === "complete") return <CheckCircle size={16} color="#2e7d32" aria-label="T&C Complete" />;
  if (status === "partial") return <AlertCircle size={16} color="#f57c00" aria-label="T&C Partially Signed" />;
  return <XCircle size={16} color="#c62828" aria-label="T&C Not Signed" />;
}

function PaymentIndicator({ paid, override }: { paid: boolean; override: boolean }) {
  if (paid) return <DollarSign size={16} color="#2e7d32" aria-label="Payment received" />;
  if (override) return <DollarSign size={16} color="#f57c00" aria-label="Payment override active" />;
  return <DollarSign size={16} color="#bbb" aria-label="No payment recorded" />;
}

function TCRow({ label, agreed, date }: { label: string; agreed: boolean; date?: string }) {
  return (
    <div style={styles.tcRow}>
      {agreed
        ? <CheckCircle size={14} color="#2e7d32" />
        : <XCircle size={14} color="#c62828" />
      }
      <span style={styles.tcLabel}>{label}</span>
      <span style={styles.tcDate}>
        {agreed && date ? `Signed ${fmt(date)}` : "Not yet signed"}
      </span>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.detailSection}>
      <div style={styles.detailTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value ?? "—"}</span>
    </div>
  );
}

const money = (n: number) => `$${Math.abs(n).toFixed(2)}`;

/**
 * Itemized money breakdown for one enrollment: the membership fee charged, any scholarship
 * credits (fund + date), the payments made (method + date), and the remaining balance.
 * Built from the server's `financials` (real award/payment records); falls back to the flat
 * fields if an older payload is served.
 */
function FeeBreakdown({ e }: { e: Enrollment }) {
  const f = e.financials;
  if (!f) {
    return (
      <>
        <Row label="Amount paid" value={e.payment_amount != null ? money(e.payment_amount) : "—"} />
        <Row label="Date paid" value={e.date_payment ? fmt(e.date_payment) : "—"} />
        <Row label="Method" value={e.payment_method ?? "—"} />
        <Row label="Scholarship fund" value={e.scholarship_fund ?? "—"} />
      </>
    );
  }
  const balance = f.balance;
  return (
    <div style={styles.ledger}>
      <div style={styles.ledgerRow}>
        <span>Membership fee</span>
        <span style={styles.ledgerAmt}>{money(f.fee_gross)}</span>
      </div>
      {f.scholarship_lines.map((s, i) => (
        <div key={`s${i}`} style={styles.ledgerRow}>
          <span style={styles.credit}>Scholarship — {s.fund_name}{s.date ? ` · ${fmt(s.date)}` : ""}</span>
          <span style={{ ...styles.ledgerAmt, ...styles.credit }}>−{money(s.amount)}</span>
        </div>
      ))}
      {(f.school_lines ?? []).map((s, i) => (
        <div key={`sc${i}`} style={styles.ledgerRow}>
          <span style={styles.credit}>{s.source}{s.date ? ` · ${fmt(s.date)}` : ""}</span>
          <span style={{ ...styles.ledgerAmt, ...styles.credit }}>−{money(s.amount)}</span>
        </div>
      ))}
      {f.payment_lines.map((p, i) => (
        <div key={`p${i}`} style={styles.ledgerRow}>
          <span style={styles.credit}>Paid — {p.method}{p.date ? ` · ${fmt(p.date)}` : ""}</span>
          <span style={{ ...styles.ledgerAmt, ...styles.credit }}>−{money(p.amount)}</span>
        </div>
      ))}
      {f.scholarship_lines.length === 0 && f.payment_lines.length === 0 && (f.school_lines ?? []).length === 0 && (
        <div style={styles.ledgerNote}>No scholarship or payments recorded yet.</div>
      )}
      <div style={{ ...styles.ledgerRow, ...styles.ledgerTotal }}>
        <span>{balance <= 0.005 ? "Balance — paid in full" : "Balance due"}</span>
        <span style={{ ...styles.ledgerAmt, color: balance <= 0.005 ? "#2e7d32" : "#c62828" }}>{money(balance)}</span>
      </div>
    </div>
  );
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString();
}

const styles: Record<string, React.CSSProperties> = {
  loading: { color: "#888", fontSize: 13, padding: "1rem 0" },
  pageHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  backBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, display: "block", marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  addBtnSmall: { display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 },
  empty: { color: "#888", fontSize: 14, padding: "1.5rem 0" },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 14, padding: 0, textDecoration: "underline" },
  list: { display: "flex", flexDirection: "column", gap: 8 },

  ledger: { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 },
  ledgerRow: { display: "flex", justifyContent: "space-between", gap: 12, color: "#334", lineHeight: 1.35 },
  ledgerAmt: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  credit: { color: "#2e7d32" },
  ledgerNote: { color: "#889", fontStyle: "italic", fontSize: 12 },
  ledgerTotal: { borderTop: "1px solid #e2e8f0", marginTop: 4, paddingTop: 6, fontWeight: 700, color: "#1a3a5c" },

  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", userSelect: "none" },
  cardLeft: { display: "flex", alignItems: "center", gap: 12 },
  cardRight: { display: "flex", alignItems: "center", gap: 10 },
  programBadge: { background: "#1a3a5c", color: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 13, fontWeight: 700 },
  cardMeta: { display: "flex", alignItems: "center", gap: 8 },
  yearLabel: { fontSize: 13, color: "#555" },
  statusBadge: { padding: "2px 8px", borderRadius: 10, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },

  cardBody: { borderTop: "1px solid #f0f4f8", padding: "16px" },
  detailGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 },
  detailSection: { padding: "12px", background: "#f8fafc", borderRadius: 8 },
  detailTitle: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 8 },

  row: { display: "flex", gap: 8, marginBottom: 4, fontSize: 13 },
  rowLabel: { color: "#888", minWidth: 110, flexShrink: 0 },
  rowValue: { color: "#222" },

  overrideTag: { marginTop: 8, padding: "4px 8px", background: "#fff8e1", border: "1px solid #ffc107", borderRadius: 4, fontSize: 11, color: "#795548" },

  tcRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13 },
  tcLabel: { minWidth: 130, color: "#555" },
  tcDate: { color: "#888", fontSize: 12 },
  signBtn: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, padding: "7px 14px", background: "#1565c0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },

  notes: { margin: 0, fontSize: 13, color: "#444", lineHeight: 1.6 },

  cardActions: { display: "flex", justifyContent: "flex-end" },
  editBtn: { padding: "7px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
};

const requestBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff",
  color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const cashOverlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex",
  alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000,
};
const cashModal: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: "20px 22px", maxWidth: 460, width: "100%",
  boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
};
const cashTitle: React.CSSProperties = { margin: "0 0 10px", fontSize: 17, color: "#1a3a5c" };
const cashBody: React.CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.6, color: "#33475b" };
const cashActions: React.CSSProperties = { display: "flex", justifyContent: "flex-end", marginTop: 18 };
const cashOk: React.CSSProperties = {
  padding: "8px 18px", background: "#1a3a5c", color: "#fff", border: "none",
  borderRadius: 7, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
};
const planNote: React.CSSProperties = {
  background: "#f1f8f4", border: "1px solid #a5d6a7", borderRadius: 7,
  padding: "9px 13px", fontSize: 13, color: "#2e5b3e", marginBottom: 12,
};
const planErrNote: React.CSSProperties = {
  background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 7,
  padding: "9px 13px", fontSize: 13, color: "#c62828", marginBottom: 12,
};
