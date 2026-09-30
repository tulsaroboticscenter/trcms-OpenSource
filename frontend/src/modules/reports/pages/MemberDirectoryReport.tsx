import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { reportsApi, type MemberDirRow } from "../api";
import { Download, ArrowLeft, Search, FileText } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const TYPE_COLORS: Record<string, string> = {
  youth: "#1565c0", mentor: "#2e7d32", parent: "#e65100", volunteer: "#6a1b9a",
};
const TYPE_LABELS: Record<string, string> = {
  youth: "Youth Members", mentor: "Mentors", parent: "Parents / Guardians", volunteer: "Volunteers",
};
const byName = (a: MemberDirRow, b: MemberDirRow) =>
  (a.last_name || "").localeCompare(b.last_name || "") || (a.first_name || "").localeCompare(b.first_name || "");

export default function MemberDirectoryReport() {
  const navigate = useNavigate();
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [rows, setRows] = useState<MemberDirRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberType, setMemberType] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"alpha" | "type" | "family">("alpha");
  const [enrolledOnly, setEnrolledOnly] = useState(false);

  useEffect(() => { load(); }, [memberType, enrolledOnly]);

  async function load() {
    setLoading(true);
    reportsApi.getMemberDirectory({
      ...(memberType ? { member_type: memberType } : {}),
      ...(enrolledOnly ? { enrolled_only: true } : {}),
    }).then(setRows).finally(() => setLoading(false));
  }

  const filtered = search
    ? rows.filter((r) =>
        `${r.first_name} ${r.last_name} ${r.email} ${r.guardian1_name}`.toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  function buildGroups(): { title: string; rows: MemberDirRow[] }[] {
    if (groupBy === "type") {
      const order = ["youth", "mentor", "parent", "volunteer"];
      const map: Record<string, MemberDirRow[]> = {};
      filtered.forEach((r) => { (map[r.member_type] ||= []).push(r); });
      const keys = [...order.filter((t) => map[t]), ...Object.keys(map).filter((t) => !order.includes(t))];
      return keys.map((t) => ({ title: TYPE_LABELS[t] ?? t, rows: [...map[t]].sort(byName) }));
    }
    if (groupBy === "family") {
      const map: Record<string, MemberDirRow[]> = {};
      filtered.forEach((r) => { const k = r.family_name || "— No family —"; (map[k] ||= []).push(r); });
      return Object.keys(map).sort().map((k) => ({ title: k, rows: [...map[k]].sort(byName) }));
    }
    return [{ title: "", rows: [...filtered].sort(byName) }];
  }

  function downloadPDF() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16); doc.setTextColor(26, 58, 92);
    doc.text("Tulsa Robotics Center — Member Directory", 14, 15);
    doc.setFontSize(9); doc.setTextColor(120);
    const sub = `${filtered.length} member${filtered.length !== 1 ? "s" : ""} · generated ${new Date().toLocaleDateString()}`
      + (memberType ? ` · ${memberType}` : "") + (enrolledOnly ? " · currently enrolled only" : "") + ` · grouped by ${groupBy === "alpha" ? "name" : groupBy}`;
    doc.text(sub, 14, 21);
    const head = [["Last", "First", "Type", "Email", "Phone", "Guardian", "Guardian Phone", "School", "Teams"]];
    let y = 26;
    for (const g of buildGroups()) {
      if (g.title) { doc.setFontSize(11); doc.setTextColor(26, 58, 92); doc.text(`${g.title} (${g.rows.length})`, 14, y + 6); y += 8; }
      autoTable(doc, {
        startY: y,
        head,
        body: g.rows.map((r) => [r.last_name, r.first_name, r.member_type, r.email || "", r.phone || "", r.guardian1_name || "", r.guardian1_phone || "", r.school || "", (r.teams || []).join(", ")]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [26, 58, 92], fontSize: 8 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }
    doc.save("member-directory.pdf");
  }

  function downloadCSV() {
    const token = localStorage.getItem("trc_token");
    const url = reportsApi.csvMemberDirectory(memberType || undefined);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "member-directory.csv";
        a.click();
      });
  }

  return (
    <div>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Reports</button>
        <h1 style={styles.heading}>Member Directory</h1>
        <p style={styles.sub}>{filtered.length} member{filtered.length !== 1 ? "s" : ""}</p>
      </div>

      <div style={styles.toolbar}>
        <select style={styles.select} value={memberType} onChange={(e) => setMemberType(e.target.value)}>
          <option value="">All Types</option>
          <option value="youth">Youth</option>
          <option value="mentor">Mentor</option>
          <option value="parent">Parent</option>
          <option value="volunteer">Volunteer</option>
        </select>
        <div style={styles.searchWrap}>
          <Search size={14} color="#aaa" style={styles.searchIcon} />
          <input style={styles.searchInput} placeholder="Filter by name, email, or guardian…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label style={styles.enrolledToggle} title="Exclude youth without an active enrollment this year (e.g. alumni)">
          <input type="checkbox" checked={enrolledOnly} onChange={(e) => setEnrolledOnly(e.target.checked)} />
          Currently enrolled only
        </label>
        {canRead("reports.export") && (
          <>
            <select style={styles.select} value={groupBy} onChange={(e) => setGroupBy(e.target.value as "alpha" | "type" | "family")} title="Grouping for the PDF">
              <option value="alpha">Alphabetical</option>
              <option value="type">By Member Type</option>
              <option value="family">By Family</option>
            </select>
            <button style={styles.pdfBtn} onClick={downloadPDF}>
              <FileText size={14} /> Download PDF
            </button>
            <button style={styles.csvBtn} onClick={downloadCSV}>
              <Download size={14} /> Export CSV
            </button>
          </>
        )}
      </div>

      {loading ? <p style={styles.muted}>Loading…</p> : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {["Last Name","First Name","Type","Email","Phone","Guardian","Guardian Phone","School","Teams"].map((h) => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={styles.tr}
                  onClick={() => navigate(`/members/${r.id}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={styles.td}><strong>{r.last_name}</strong></td>
                  <td style={styles.td}>{r.first_name}</td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: TYPE_COLORS[r.member_type] ?? "#888" }}>
                      {r.member_type}
                    </span>
                  </td>
                  <td style={styles.td}>{r.email || "—"}</td>
                  <td style={styles.td}>{r.phone || "—"}</td>
                  <td style={styles.td}>{r.guardian1_name || "—"}</td>
                  <td style={styles.td}>{r.guardian1_phone || "—"}</td>
                  <td style={styles.td}>{r.school || "—"}</td>
                  <td style={styles.td}>{r.teams.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p style={styles.empty}>No members match this filter.</p>}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "2px 0 0", fontSize: 13, color: "#888" },
  toolbar: { display: "flex", gap: 10, marginBottom: 14, alignItems: "center" },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  enrolledToggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444", whiteSpace: "nowrap" as const, cursor: "pointer" },
  searchWrap: { position: "relative", flex: 1 },
  searchIcon: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" },
  searchInput: { width: "100%", padding: "8px 12px 8px 32px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" as const },
  pdfBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#c62828", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" as const },
  muted: { color: "#888", fontSize: 13 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th: { padding: "10px 14px", background: "#f0f4f8", textAlign: "left" as const, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" as const },
  tr: { cursor: "pointer", transition: "background 0.1s", borderBottom: "1px solid #f0f4f8" },
  td: { padding: "9px 14px", color: "#333" },
  badge: { padding: "2px 8px", borderRadius: 10, color: "#fff", fontSize: 11, fontWeight: 600, textTransform: "capitalize" as const },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
};
