import { useEffect, useMemo, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { reportsApi, type CertsByMemberReport } from "../api";
import { ArrowLeft, GraduationCap, Download, ChevronDown, ChevronUp, Award, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/** Active members and the certifications each has completed. Doubles as a "who still needs certs" list. */
export default function CertificationsByMemberReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [data, setData] = useState<CertsByMemberReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [only, setOnly] = useState<"all" | "with" | "without">("all");
  const [expanded, setExpanded] = useState<number[]>([]);

  useEffect(() => {
    reportsApi.getCertificationsByMember()
      .then(setData)
      .catch(() => setErr("Failed to load the report."))
      .finally(() => setLoading(false));
  }, []);

  const types = useMemo(
    () => [...new Set((data?.members ?? []).map((m) => m.member_type).filter(Boolean))].sort(),
    [data]);

  const rows = useMemo(() => {
    let r = data?.members ?? [];
    if (type) r = r.filter((m) => m.member_type === type);
    if (only === "with") r = r.filter((m) => m.cert_count > 0);
    if (only === "without") r = r.filter((m) => m.cert_count === 0);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((m) => m.name.toLowerCase().includes(q) || (m.member_number ?? "").toLowerCase().includes(q)
      || m.certifications.some((c) => `${c.code} ${c.name}`.toLowerCase().includes(q)));
    return r;
  }, [data, type, only, search]);

  function downloadPDF() {
    const doc = new jsPDF({ orientation: "portrait" });
    const withCerts = rows.filter((m) => m.cert_count > 0);
    doc.setFontSize(16); doc.setTextColor(26, 58, 92);
    doc.text("Tulsa Robotics Center — Certifications by Member", 14, 15);
    doc.setFontSize(9); doc.setTextColor(120);
    const bits = [`${withCerts.length} member${withCerts.length !== 1 ? "s" : ""} shown`,
      `generated ${new Date().toLocaleDateString()}`];
    if (type) bits.push(cap(type));
    if (search.trim()) bits.push(`search: "${search.trim()}"`);
    doc.text(bits.join(" · "), 14, 21);

    let y = 28;
    const pageH = doc.internal.pageSize.getHeight();
    for (const m of withCerts) {
      if (y > pageH - 24) { doc.addPage(); y = 18; }
      doc.setFontSize(11); doc.setTextColor(26, 58, 92);
      doc.text(`${m.last_name}, ${m.first_name}  (${cap(m.member_type)}) — ${m.cert_count} certification${m.cert_count !== 1 ? "s" : ""}`, 14, y);
      y += 2;
      autoTable(doc, {
        startY: y + 2,
        head: [["Code", "Certification", "Section", "Completed"]],
        body: m.certifications.map((c) => [c.code, c.name, c.section ?? "", c.completed_date ?? ""]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [106, 27, 154], fontSize: 8 },
        columnStyles: { 0: { cellWidth: 20 }, 3: { cellWidth: 26 } },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
    if (withCerts.length === 0) { doc.setFontSize(10); doc.setTextColor(120); doc.text("No members with certifications in the current view.", 14, y); }
    doc.save("certifications-by-member.pdf");
  }

  function downloadCSV() {
    const token = localStorage.getItem("trc_token");
    fetch(reportsApi.csvCertificationsByMember(), { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob()).then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "certifications-by-member.csv";
        a.click();
      });
  }

  const toggle = (id: number) => setExpanded((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  return (
    <div style={S.wrap}>
      <button onClick={goBack} style={S.back}><ArrowLeft size={14} /> Back to Reports</button>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}><GraduationCap size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Certifications by Member</h1>
          <p style={S.sub}>Every active member and the certifications they've completed. Excludes inactive and archived members.</p>
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
            <span style={S.stat}><strong>{data.member_count}</strong> active members</span>
            <span style={S.stat}><strong>{data.certified_count}</strong> with at least one certification</span>
          </div>

          <div style={S.toolbar}>
            <input style={S.input} placeholder="Search name, #, or certification…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select style={S.select} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All member types</option>
              {types.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
            <select style={S.select} value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
              <option value="all">All members</option>
              <option value="with">With certifications</option>
              <option value="without">No certifications yet</option>
            </select>
            <span style={S.count}>{rows.length} shown</span>
          </div>

          <div style={S.list}>
            {rows.map((m) => (
              <div key={m.member_id} style={S.card}>
                <div style={S.row} onClick={() => m.cert_count > 0 && toggle(m.member_id)}>
                  <div style={S.who}>
                    <span style={S.name}>{m.last_name}, {m.first_name}</span>
                    <span style={S.typeTag}>{cap(m.member_type)}</span>
                    {m.member_number && <span style={S.num}>#{m.member_number}</span>}
                  </div>
                  <div style={S.right}>
                    <span style={{ ...S.certCount, ...(m.cert_count === 0 ? S.zero : {}) }}>
                      <Award size={12} /> {m.cert_count}
                    </span>
                    {m.cert_count > 0 && (expanded.includes(m.member_id) ? <ChevronUp size={15} color="#889" /> : <ChevronDown size={15} color="#889" />)}
                  </div>
                </div>
                {m.cert_count > 0 && expanded.includes(m.member_id) && (
                  <div style={S.certs}>
                    {m.certifications.map((c, i) => (
                      <div key={i} style={S.certRow}>
                        <span style={S.code}>{c.code}</span>
                        <span style={S.certName}>{c.name}</span>
                        {c.section && <span style={S.section}>{c.section}</span>}
                        <span style={S.date}>{c.completed_date ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {rows.length === 0 && <p style={S.muted}>No members match.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 900, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13.5, marginBottom: 14, padding: 0 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 14 },
  h1: { fontSize: 24, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 0", maxWidth: 620 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  csv: { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  pdf: { display: "flex", alignItems: "center", gap: 6, padding: "9px 15px", background: "#c62828", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  muted: { color: "#889", fontSize: 14 },
  stats: { display: "flex", gap: 18, marginBottom: 12, flexWrap: "wrap" },
  stat: { fontSize: 13.5, color: "#445" },
  toolbar: { display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" },
  input: { flex: "1 1 240px", padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  count: { fontSize: 12.5, color: "#889", whiteSpace: "nowrap" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 15px", cursor: "pointer" },
  who: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  name: { fontWeight: 600, fontSize: 14, color: "#1a3a5c" },
  typeTag: { fontSize: 11, padding: "1px 8px", background: "#f0f4f8", borderRadius: 8, color: "#556", fontWeight: 600 },
  num: { fontSize: 12, color: "#99a" },
  right: { display: "flex", alignItems: "center", gap: 8 },
  certCount: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700, color: "#2e7d32", background: "#eef7f0", borderRadius: 12, padding: "2px 10px" },
  zero: { color: "#99a", background: "#f4f6f8" },
  certs: { borderTop: "1px solid #eef2f7", padding: "6px 15px 10px" },
  certRow: { display: "grid", gridTemplateColumns: "48px 1fr auto auto", gap: 10, alignItems: "center", padding: "5px 0", fontSize: 13, borderBottom: "1px solid #f6f8fa" },
  code: { fontWeight: 700, color: "#6a1b9a", fontSize: 12.5 },
  certName: { color: "#334" },
  section: { fontSize: 11.5, color: "#8b98a6", background: "#f7f9fc", borderRadius: 6, padding: "1px 7px" },
  date: { fontSize: 12.5, color: "#667", whiteSpace: "nowrap" },
};
