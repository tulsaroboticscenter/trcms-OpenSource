import { useEffect, useMemo, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { reportsApi, type YouthByGradeReport as Data } from "../api";
import { ArrowLeft, GraduationCap, Download, AlertTriangle, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/** Active youth grouped by school grade — 9th–12th shown as Freshman / Sophomore / Junior / Senior. */
export default function YouthByGradeReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    reportsApi.getYouthByGrade()
      .then(setData)
      .catch(() => setErr("Failed to load the report."))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.groups;
    return data.groups
      .map((g) => ({ ...g, members: g.members.filter((m) => m.name.toLowerCase().includes(q) || (m.member_number ?? "").toLowerCase().includes(q)) }))
      .filter((g) => g.members.length > 0);
  }, [data, search]);

  function downloadPDF() {
    const doc = new jsPDF({ orientation: "portrait" });
    const shown = groups.reduce((s, g) => s + g.members.length, 0);
    doc.setFontSize(16); doc.setTextColor(26, 58, 92);
    doc.text("Tulsa Robotics Center — Youth by Grade", 14, 15);
    doc.setFontSize(9); doc.setTextColor(120);
    const bits = [`${data?.season_label ?? ""} school year`, `${shown} youth`, `generated ${new Date().toLocaleDateString()}`];
    if (search.trim()) bits.push(`search: "${search.trim()}"`);
    doc.text(bits.filter(Boolean).join(" · "), 14, 21);

    let y = 28;
    const pageH = doc.internal.pageSize.getHeight();
    for (const g of groups) {
      if (y > pageH - 24) { doc.addPage(); y = 18; }
      doc.setFontSize(11); doc.setTextColor(26, 58, 92);
      doc.text(`${g.label} — ${g.members.length}`, 14, y);
      autoTable(doc, {
        startY: y + 3,
        head: [["Last", "First", "Program(s)", "Member #", "Graduation Year"]],
        body: g.members.map((m) => [m.last_name, m.first_name, (m.programs ?? []).join(", "), m.member_number ?? "", m.graduation_year ?? ""]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [26, 58, 92], fontSize: 8 },
        columnStyles: { 3: { cellWidth: 26 }, 4: { cellWidth: 30 } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
    doc.save("youth-by-grade.pdf");
  }

  function downloadCSV() {
    const token = localStorage.getItem("trc_token");
    fetch(reportsApi.csvYouthByGrade(), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob()).then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "youth-by-grade.csv";
        a.click();
      });
  }

  const unknown = data?.groups.find((g) => g.grade === null);

  return (
    <div style={S.wrap}>
      <button onClick={goBack} style={S.back}><ArrowLeft size={14} /> Back to Reports</button>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}><GraduationCap size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Youth by Grade</h1>
          <p style={S.sub}>Active youth grouped by their {data ? data.season_label : "current"} school grade. High-school years show as Freshman / Sophomore / Junior / Senior. Grade is figured from each youth's graduation year.</p>
        </div>
        {data && canRead("reports.export") && (
          <div style={S.actions}>
            <button onClick={downloadPDF} style={S.pdf}><FileText size={15} /> Download PDF</button>
            <button onClick={downloadCSV} style={S.csv}><Download size={15} /> Export CSV</button>
          </div>
        )}
      </div>

      {loading && <p style={S.muted}>Loading…</p>}
      {err && <p style={{ ...S.muted, color: "#c62828" }}>{err}</p>}

      {data && (
        <>
          <div style={S.stats}>
            <span style={S.stat}><strong>{data.total}</strong> active youth</span>
            {unknown && unknown.count > 0 && (
              <span style={S.warn}><AlertTriangle size={13} /> {unknown.count} have no graduation year on file — set it on their profile so their grade shows.</span>
            )}
          </div>

          <input style={S.input} placeholder="Search name or member #…" value={search} onChange={(e) => setSearch(e.target.value)} />

          <div style={S.list}>
            {groups.map((g) => (
              <div key={g.label} style={S.group}>
                <div style={S.groupHead}>
                  <span style={S.gradeLabel}>{g.label}</span>
                  <span style={S.gradeCount}>{g.members.length}</span>
                </div>
                <div style={S.members}>
                  {g.members.map((m) => (
                    <div key={m.member_id} style={S.member}>
                      <span style={S.name}>{m.last_name}, {m.first_name}</span>
                      {(m.programs ?? []).map((p) => <span key={p} style={S.prog}>{p}</span>)}
                      {m.member_number && <span style={S.num}>#{m.member_number}</span>}
                      {m.graduation_year && <span style={S.grad}>grad {m.graduation_year}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {groups.length === 0 && <p style={S.muted}>No youth match.</p>}
          </div>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 860, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, marginBottom: 14, padding: 0 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 },
  h1: { fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 0", maxWidth: 640 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  csv: { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  pdf: { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", background: "#c62828", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  muted: { color: "#889", fontSize: 14 },
  stats: { display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap", alignItems: "center" },
  stat: { fontSize: 13.5, color: "#445" },
  warn: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#7a5b12", background: "#fff8e1", border: "1px solid #ffe0a3", borderRadius: 8, padding: "5px 10px" },
  input: { width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, marginBottom: 14 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  group: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  groupHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 15px", background: "#f8fafc", borderBottom: "1px solid #eef2f7" },
  gradeLabel: { fontWeight: 700, fontSize: 14.5, color: "#1a3a5c" },
  gradeCount: { fontSize: 12.5, fontWeight: 700, color: "#6a1b9a", background: "#f3e9fb", borderRadius: 12, padding: "2px 11px" },
  members: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "2px 16px", padding: "10px 15px" },
  member: { display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", fontSize: 13.5, borderBottom: "1px solid #f6f8fa" },
  name: { color: "#243b53", fontWeight: 500 },
  prog: { fontSize: 10.5, fontWeight: 700, color: "#1565c0", background: "#e7f0fb", borderRadius: 5, padding: "1px 6px" },
  num: { fontSize: 12, color: "#99a" },
  grad: { fontSize: 11.5, color: "#8b98a6", marginLeft: "auto" },
};
