import { useEffect, useMemo, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { useAuth } from "../../../core/AuthContext";
import { reportsApi, type CertOption, type CertHolder, type CertHoldersReport } from "../api";
import { ArrowLeft, Award, Download, FileText, X, Search } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type GroupBy = "none" | "team" | "fdp";
interface Group { key: string; label: string; members: CertHolder[]; }

/** Pick one or more certifications → all active members who hold them, groupable by team or FDP. */
export default function CertificationHoldersReport() {
  const goBack = useGoBack("/reports");
  const { canRead } = useAuth();
  const [options, setOptions] = useState<CertOption[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [match, setMatch] = useState<"any" | "all">("any");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [memberType, setMemberType] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [data, setData] = useState<CertHoldersReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { reportsApi.getCertificationOptions().then(setOptions).catch(() => setOptions([])); }, []);

  useEffect(() => {
    if (selected.length === 0) { setData(null); return; }
    setLoading(true);
    reportsApi.getCertificationHolders(selected, match)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [selected, match]);

  const optById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const pickerRows = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    return options.filter((o) => !q || `${o.code} ${o.name} ${o.section ?? ""}`.toLowerCase().includes(q));
  }, [options, pickerSearch]);

  const toggle = (id: number) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const memberTypes = useMemo(
    () => [...new Set((data?.members ?? []).map((m) => m.member_type).filter(Boolean))].sort(), [data]);
  const shownMembers = useMemo(
    () => (data?.members ?? []).filter((m) => !memberType || m.member_type === memberType), [data, memberType]);

  const groups: Group[] = useMemo(() => {
    const members = shownMembers;
    if (members.length === 0) return [];
    if (groupBy === "none") return [{ key: "all", label: "", members }];
    if (groupBy === "fdp") {
      const inF = members.filter((m) => m.fdp), out = members.filter((m) => !m.fdp);
      const gs: Group[] = [];
      if (inF.length) gs.push({ key: "fdp", label: `In the FDP (${inF.length})`, members: inF });
      if (out.length) gs.push({ key: "nofdp", label: `Not in the FDP (${out.length})`, members: out });
      return gs;
    }
    // team
    const byTeam = new Map<string, { name: string | null; members: CertHolder[] }>();
    const noTeam: CertHolder[] = [];
    for (const m of members) {
      if (m.teams.length === 0) { noTeam.push(m); continue; }
      for (const t of m.teams) {
        if (!byTeam.has(t.team_number)) byTeam.set(t.team_number, { name: t.team_name, members: [] });
        byTeam.get(t.team_number)!.members.push(m);
      }
    }
    const gs: Group[] = [...byTeam.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([num, v]) => ({ key: num, label: `Team ${num}${v.name ? ` — ${v.name}` : ""} (${v.members.length})`, members: v.members }));
    if (noTeam.length) gs.push({ key: "noteam", label: `No team (${noTeam.length})`, members: noTeam });
    return gs;
  }, [shownMembers, groupBy]);

  const fdpLabel = (m: CertHolder) => m.fdp ? (m.fdp === "graduated" ? "FDP (graduated)" : "FDP") : "";

  function downloadCSV() {
    const head = ["Member #", "Last Name", "First Name", "Type", "Certifications", "Teams", "FDP"];
    const lines = [head.join(",")];
    for (const g of groups) for (const m of g.members) {
      const row = [m.member_number ?? "", m.last_name, m.first_name, m.member_type,
        m.certs.map((c) => c.code).join(" / "), m.teams.map((t) => t.team_number).join(" / "), fdpLabel(m)];
      lines.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "certification-holders.csv"; a.click();
  }

  function downloadPDF() {
    if (!data) return;
    const doc = new jsPDF({ orientation: "portrait" });
    doc.setFontSize(15); doc.setTextColor(26, 58, 92);
    doc.text("Tulsa Robotics Center — Certification Holders", 14, 15);
    doc.setFontSize(9); doc.setTextColor(120);
    const certLabel = data.certifications.map((c) => c.code).join(", ");
    const sub = `${shownMembers.length} ${memberType ? cap(memberType) + " " : ""}member${shownMembers.length !== 1 ? "s" : ""} holding ${match === "all" ? "ALL of" : "any of"}: ${certLabel}`
      + (groupBy !== "none" ? ` · grouped by ${groupBy === "team" ? "team" : "FDP"}` : "") + ` · generated ${new Date().toLocaleDateString()}`;
    doc.text(doc.splitTextToSize(sub, 182), 14, 21);
    let y = 30;
    const pageH = doc.internal.pageSize.getHeight();
    for (const g of groups) {
      if (y > pageH - 24) { doc.addPage(); y = 18; }
      if (g.label) { doc.setFontSize(11); doc.setTextColor(26, 58, 92); doc.text(g.label, 14, y); y += 2; }
      autoTable(doc, {
        startY: y + 2,
        head: [["Last", "First", "Type", "Certifications", "Teams", "FDP"]],
        body: g.members.map((m) => [m.last_name, m.first_name, m.member_type,
          m.certs.map((c) => c.code).join(", "), m.teams.map((t) => t.team_number).join(", "), fdpLabel(m)]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [26, 58, 92], fontSize: 8 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
    doc.save("certification-holders.pdf");
  }

  return (
    <div style={S.wrap}>
      <button onClick={goBack} style={S.back}><ArrowLeft size={14} /> Back to Reports</button>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}><Award size={22} style={{ verticalAlign: -3, marginRight: 8 }} />Certification Holders</h1>
          <p style={S.sub}>Choose one or more certifications to list every active member who has earned them. Group the results by team or by FDP membership.</p>
        </div>
        {data && shownMembers.length > 0 && canRead("reports.export") && (
          <div style={S.actions}>
            <button onClick={downloadPDF} style={S.pdf}><FileText size={15} /> Download PDF</button>
            <button onClick={downloadCSV} style={S.csv}><Download size={15} /> Export CSV</button>
          </div>
        )}
      </div>

      {/* Certification picker */}
      <div style={S.picker}>
        <div style={S.pickerHead}>
          <span style={S.pickerTitle}>Certifications</span>
          {selected.length > 0 && <button style={S.clear} onClick={() => setSelected([])}>Clear ({selected.length})</button>}
        </div>
        {selected.length > 0 && (
          <div style={S.chips}>
            {selected.map((id) => {
              const o = optById.get(id);
              return <span key={id} style={S.chip}>{o ? `${o.code} — ${o.name}` : id}<X size={12} style={{ cursor: "pointer" }} onClick={() => toggle(id)} /></span>;
            })}
          </div>
        )}
        <div style={S.searchRow}><Search size={14} color="#889" /><input style={S.search} placeholder="Search certifications…" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} /></div>
        <div style={S.optList}>
          {pickerRows.map((o) => (
            <label key={o.id} style={{ ...S.opt, ...(selected.includes(o.id) ? S.optOn : {}) }}>
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
              <span style={S.optCode}>{o.code}</span>
              <span style={S.optName}>{o.name}</span>
              {o.section && <span style={S.optSection}>{o.section}</span>}
            </label>
          ))}
          {pickerRows.length === 0 && <p style={S.muted}>No certifications match.</p>}
        </div>
      </div>

      {/* Controls */}
      {selected.length > 0 && (
        <div style={S.controls}>
          {selected.length > 1 && (
            <div style={S.seg}>
              <button style={{ ...S.segBtn, ...(match === "any" ? S.segOn : {}) }} onClick={() => setMatch("any")}>Holds any selected</button>
              <button style={{ ...S.segBtn, ...(match === "all" ? S.segOn : {}) }} onClick={() => setMatch("all")}>Holds all selected</button>
            </div>
          )}
          <div style={S.groupWrap}>
            <span style={S.groupLbl}>Member type</span>
            <select style={S.select} value={memberType} onChange={(e) => setMemberType(e.target.value)}>
              <option value="">All types</option>
              {memberTypes.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
          </div>
          <div style={S.groupWrap}>
            <span style={S.groupLbl}>Group by</span>
            <select style={S.select} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="none">None (by name)</option>
              <option value="team">Team</option>
              <option value="fdp">FDP membership</option>
            </select>
          </div>
          {data && <span style={S.total}>{shownMembers.length} member{shownMembers.length !== 1 ? "s" : ""}</span>}
        </div>
      )}

      {/* Results */}
      {selected.length === 0 ? <p style={S.hint}>Select a certification above to see who holds it.</p>
        : loading ? <p style={S.muted}>Loading…</p>
        : !data || shownMembers.length === 0 ? <p style={S.muted}>No {memberType ? cap(memberType) + " members" : "active members"} hold {match === "all" ? "all of" : "any of"} the selected certification{selected.length !== 1 ? "s" : ""}.</p>
        : (
          <div style={S.list}>
            {groups.map((g) => (
              <div key={g.key} style={S.group}>
                {g.label && <div style={S.groupHead}>{g.label}</div>}
                {g.members.map((m) => (
                  <div key={m.member_id} style={S.member}>
                    <span style={S.name}>{m.last_name}, {m.first_name}</span>
                    <span style={S.typeTag}>{m.member_type}</span>
                    <span style={S.certCodes}>{m.certs.map((c) => <span key={c.id} style={S.certCode}>{c.code}</span>)}</span>
                    {groupBy !== "team" && m.teams.length > 0 && <span style={S.teamsInline}>{m.teams.map((t) => `#${t.team_number}`).join(" ")}</span>}
                    {groupBy !== "fdp" && m.fdp && <span style={S.fdpTag}>{fdpLabel(m)}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
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
  hint: { color: "#889", fontSize: 14, textAlign: "center", padding: "1.5rem" },
  picker: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginBottom: 14 },
  pickerHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  pickerTitle: { fontWeight: 700, fontSize: 14, color: "#1a3a5c" },
  clear: { background: "none", border: "none", color: "#c62828", fontSize: 12.5, cursor: "pointer", fontWeight: 600 },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  chip: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, background: "#f3e9fb", color: "#6a1b9a", borderRadius: 14, padding: "3px 10px", fontWeight: 600 },
  searchRow: { display: "flex", alignItems: "center", gap: 8, border: "1px solid #ccc", borderRadius: 6, padding: "0 10px", marginBottom: 8 },
  search: { flex: 1, border: "none", outline: "none", padding: "8px 0", fontSize: 14 },
  optList: { maxHeight: 260, overflowY: "auto", border: "1px solid #eef2f7", borderRadius: 6 },
  opt: { display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f6f8fa" },
  optOn: { background: "#f7f2fc" },
  optCode: { fontWeight: 700, color: "#6a1b9a", minWidth: 42 },
  optName: { color: "#334", flex: 1 },
  optSection: { fontSize: 11.5, color: "#8b98a6", background: "#f7f9fc", borderRadius: 6, padding: "1px 7px" },
  controls: { display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" },
  seg: { display: "inline-flex", border: "1px solid #d5dee8", borderRadius: 7, overflow: "hidden" },
  segBtn: { padding: "7px 12px", background: "#fff", border: "none", fontSize: 12.5, cursor: "pointer", color: "#445" },
  segOn: { background: "#6a1b9a", color: "#fff", fontWeight: 600 },
  groupWrap: { display: "flex", alignItems: "center", gap: 8 },
  groupLbl: { fontSize: 12.5, color: "#667" },
  select: { padding: "7px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13.5 },
  total: { marginLeft: "auto", fontSize: 13, color: "#445", fontWeight: 600 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  group: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" },
  groupHead: { padding: "9px 15px", background: "#f8fafc", borderBottom: "1px solid #eef2f7", fontWeight: 700, fontSize: 13.5, color: "#1a3a5c" },
  member: { display: "flex", alignItems: "center", gap: 10, padding: "8px 15px", fontSize: 13.5, borderBottom: "1px solid #f6f8fa", flexWrap: "wrap" },
  name: { color: "#243b53", fontWeight: 500, minWidth: 160 },
  typeTag: { fontSize: 11, padding: "1px 8px", background: "#f0f4f8", borderRadius: 8, color: "#556", fontWeight: 600 },
  certCodes: { display: "inline-flex", gap: 4, flexWrap: "wrap" },
  certCode: { fontSize: 11, fontWeight: 700, color: "#6a1b9a", background: "#f3e9fb", borderRadius: 5, padding: "1px 6px" },
  teamsInline: { fontSize: 12, color: "#1565c0", marginLeft: "auto" },
  fdpTag: { fontSize: 11, color: "#2e7d32", background: "#eef7f0", borderRadius: 6, padding: "1px 7px", fontWeight: 600 },
};
