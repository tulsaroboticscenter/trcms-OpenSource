import { useState, useEffect } from "react";
import { currentSeasonYear } from "../../../core/dateUtils";
import { useNavigate } from "react-router-dom";
import { reportsApi, type EnrollmentRow } from "../api";
import { Download, ArrowLeft, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";

export default function EnrollmentReport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [data, setData] = useState<{ enrollment_year: number; enrollments: EnrollmentRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | "">("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTC, setFilterTC] = useState("");
  const [filterPaid, setFilterPaid] = useState("");
  const [filterProgram, setFilterProgram] = useState("");
  const [search, setSearch] = useState("");

  const activeYear = currentSeasonYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => activeYear - 2 + i).reverse();

  useEffect(() => { load(activeYear); setYear(activeYear); }, []);

  async function load(y: number) {
    setLoading(true);
    reportsApi.getEnrollmentStatus(y).then(setData).finally(() => setLoading(false));
  }

  function downloadCSV() {
    const token = localStorage.getItem("trc_token");
    const url = reportsApi.csvEnrollmentStatus(year as number);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob()).then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `enrollment-${year}.csv`;
        a.click();
      });
  }

  const rows = data?.enrollments ?? [];
  // "Paid" for the summary/counts = fully settled (a cash payment, an override, or a
  // scholarship covering the balance) — i.e. payment status Paid or Scholarship.
  const isPaid = (r: EnrollmentRow) => r.payment_status === "Paid" || r.payment_status === "Scholarship";
  const programs = [...new Set(rows.map((r) => r.program).filter(Boolean))].sort();
  const membershipOpts = [...new Set(rows.map((r) => r.membership_status).filter(Boolean))] as string[];
  const paymentOpts = [...new Set(rows.map((r) => r.payment_status).filter(Boolean))] as string[];
  const filtered = rows.filter((r) => {
    if (filterProgram && r.program !== filterProgram) return false;
    if (filterStatus && r.membership_status !== filterStatus) return false;
    if (filterTC === "signed" && !r.fully_signed) return false;
    if (filterTC === "unsigned" && r.fully_signed) return false;
    if (filterPaid && r.payment_status !== filterPaid) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.first_name} ${r.last_name} ${r.member_number}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Summary counts follow the selected program (but not the table-only status/paid/T&C filters).
  const scoped = filterProgram ? rows.filter((r) => r.program === filterProgram) : rows;
  const paidCount = scoped.filter(isPaid).length;
  const unpaidCount = scoped.length - paidCount;
  const signedCount = scoped.filter((r) => r.fully_signed).length;

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Reports</button>
        <h1 style={styles.heading}>Enrollment & Payment Status</h1>
        {data && <p style={styles.sub}>{data.enrollment_year}–{data.enrollment_year + 1} · {scoped.length} enrollments{filterProgram ? ` · ${filterProgram}` : ""}</p>}
      </div>

      {data && (
        <div style={styles.summaryStrip}>
          <Stat label="Total" value={rows.length} color="#1a3a5c" />
          <Stat label="Paid" value={paidCount} color="#2e7d32" />
          <Stat label="Payment Pending" value={unpaidCount} color="#c62828" />
          <Stat label="T&C Signed" value={signedCount} color="#6a1b9a" />
          <Stat label="T&C Pending" value={rows.length - signedCount} color="#e65100" />
        </div>
      )}

      <div style={styles.toolbar}>
        <select style={styles.select} value={year}
          onChange={(e) => { const y = parseInt(e.target.value); setYear(y); load(y); }}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}–{y + 1}</option>)}
        </select>
        <select style={styles.select} value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)}>
          <option value="">All Programs</option>
          {programs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select style={styles.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Memberships</option>
          {membershipOpts.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={styles.select} value={filterPaid} onChange={(e) => setFilterPaid(e.target.value)}>
          <option value="">All Payments</option>
          {paymentOpts.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={styles.select} value={filterTC} onChange={(e) => setFilterTC(e.target.value)}>
          <option value="">All T&C</option>
          <option value="signed">T&C Signed</option>
          <option value="unsigned">T&C Pending</option>
        </select>
        <input style={styles.searchInput} placeholder="Search name or #…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {canRead("reports.export") && <button style={styles.csvBtn} onClick={downloadCSV}><Download size={14} /> Export CSV</button>}
      </div>

      {loading ? <p style={styles.muted}>Loading…</p> : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Member","Program","Membership","Enrolled","Payment Status","Method","Shirt","T&C Youth","T&C Parent"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={styles.tr}
                  onClick={() => navigate(`/members/${r.member_id}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={styles.td}>
                    <strong>{r.last_name}</strong>, {r.first_name}
                    <span style={styles.memberNum}> #{r.member_number}</span>
                  </td>
                  <td style={styles.td}>{r.program || "—"}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.statusBadge, background: membershipColor(r.membership_status) }}>
                      {r.membership_status ?? r.status}
                    </span>
                  </td>
                  <td style={styles.td}>{r.date_enrolled ? fmt(r.date_enrolled) : "—"}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.payStatus, color: paymentColor(r.payment_status) }}>
                      {r.payment_status === "Pending" && <AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 3 }} />}
                      {r.payment_status ?? "—"}
                    </span>
                    {paymentDetail(r) && <div style={styles.payDetail}>{paymentDetail(r)}</div>}
                  </td>
                  <td style={styles.td}>{r.payment_method || "—"}</td>
                  <td style={styles.td}>{r.shirt_size || "—"}</td>
                  <td style={styles.td}><FlagCell ok={r.tc_youth_agreed} /></td>
                  <td style={styles.td}><FlagCell ok={r.tc_parent_agreed} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p style={styles.empty}>No enrollments match this filter.</p>}
        </div>
      )}
    </div>
  );
}

function FlagCell({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle size={14} color="#2e7d32" /> : <XCircle size={14} color="#e0e0e0" />;
}

function membershipColor(s?: string) {
  return s === "Active" ? "#2e7d32" : s === "Pending" ? "#e65100" : "#757575";
}
function paymentColor(s?: string) {
  switch (s) {
    case "Paid": return "#2e7d32";
    case "Scholarship": return "#6a1b9a";
    case "Partial": return "#e65100";
    case "Pending": return "#c62828";
    default: return "#888";
  }
}
function paymentDetail(r: EnrollmentRow): string {
  if ((r.payment_status === "Pending" || r.payment_status === "Partial") && r.balance != null && r.balance > 0) return `$${r.balance.toFixed(2)} due`;
  if (r.payment_status === "Scholarship" && (r.scholarship_credit ?? 0) > 0) return `$${(r.scholarship_credit ?? 0).toFixed(2)} covered`;
  if (r.payment_status === "Paid" && r.payment_amount) return `$${r.payment_amount.toFixed(2)}`;
  return "";
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ ...styles.statChip, borderColor: color }}>
      <span style={{ ...styles.statNum, color }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

function fmt(d: string) {
  // A bare YYYY-MM-DD is parsed as UTC midnight by Date(), which renders as the
  // previous day in timezones behind UTC (e.g. 2025-09-01 → 08/31). Parse the
  // date parts as local to keep the calendar date intact.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString();
  return new Date(d).toLocaleDateString();
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  summaryStrip: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  statChip: { display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 16px", border: "2px solid #ccc", borderRadius: 8, minWidth: 80 },
  statNum: { fontSize: 22, fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: 11, color: "#888", fontWeight: 600, marginTop: 2 },
  toolbar: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" },
  select: { padding: "7px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  searchInput: { padding: "7px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, flex: 1, minWidth: 140 },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" as const },
  muted: { color: "#888", fontSize: 13 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "9px 12px", background: "#f0f4f8", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" as const },
  tr: { cursor: "pointer", borderBottom: "1px solid #f0f4f8", transition: "background 0.1s" },
  td: { padding: "8px 12px" },
  memberNum: { fontSize: 11, color: "#aaa" },
  statusBadge: { padding: "2px 7px", borderRadius: 8, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  payStatus: { fontSize: 12.5, fontWeight: 700 },
  payDetail: { fontSize: 11, color: "#8b98a6", marginTop: 1 },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};
