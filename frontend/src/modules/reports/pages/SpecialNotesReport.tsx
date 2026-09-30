/**
 * SpecialNotesReport — the member-side counterpart of the Summer Camp "Special Notes"
 * tab: youth enrolled in a program this season with their medical / allergy /
 * accommodation notes, general special notes, and photo-release status, so staff can
 * see who needs attention at a glance. Filterable by program. Confidential medical PII
 * (requires members.view_medical); CSV export for printing/handoff.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../../core/api";
import { reportsApi, type SpecialNotesRow } from "../api";
import { Camera, CameraOff, AlertTriangle, Download, HelpCircle } from "lucide-react";

type Program = { id: number; name: string };

// Filler answers ("No", "None", "N/A", "-") aren't real notes — treat them as blank so a
// youth who answered "none" doesn't read as having a medical issue (same rule as camp).
const meaningful = (v?: string | null): string => {
  const t = (v ?? "").trim();
  if (!t) return "";
  return /^(no|none|n\/a|na|n\.a\.|nope|nil|-|--|0|n)$/i.test(t) ? "" : t;
};
const join = (...parts: (string | null | undefined)[]) => parts.map((p) => meaningful(p)).filter(Boolean).join("; ");

export default function SpecialNotesReport() {
  const [rows, setRows] = useState<SpecialNotesRow[] | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [programId, setProgramId] = useState<string>("");   // "" = all programs
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    api.get("/api/v1/programs/").then(({ data }) => setPrograms(data as Program[])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true); setDenied(false);
    reportsApi.getYouthSpecialNotes({ enrollmentYear: year ?? undefined, programId: programId ? Number(programId) : undefined })
      .then((d) => { setRows(d.youth); if (year === null) setYear(d.enrollment_year); })
      .catch((e) => { if ((e as { response?: { status?: number } })?.response?.status === 403) setDenied(true); setRows([]); })
      .finally(() => setLoading(false));
  }, [year, programId]);
  useEffect(() => { load(); }, [load]);

  const yearOpts = year ? [year + 1, year, year - 1, year - 2] : [];

  // Label each allergy field only when it holds a *meaningful* value — guarding on the
  // filtered value, not the raw one, so a present-but-empty field doesn't render a phantom
  // "Food:; Env:; Meds:" that reads as a real allergy note.
  const labelIf = (label: string, v?: string | null) => { const t = meaningful(v); return t ? `${label}: ${t}` : ""; };
  const allergiesOf = (r: SpecialNotesRow) => join(
    labelIf("Food", r.food_allergies),
    labelIf("Env", r.environmental_allergies),
    labelIf("Meds", r.medication_allergies),
  );
  const medicalOf = (r: SpecialNotesRow) => join(r.health_problems, r.medical_notes);
  const hasNotes = (r: SpecialNotesRow) =>
    !!(medicalOf(r) || allergiesOf(r) || meaningful(r.medications_current) || meaningful(r.accommodations) || meaningful(r.special_notes));
  // "Needs attention" = has real notes, or the photo release was explicitly DECLINED (an
  // event-day concern). A merely unreturned photo form no longer keeps a note-free youth on
  // the list — it's still visible in the Photos column and the no-photo count.
  const needsAttention = (r: SpecialNotesRow) => hasNotes(r) || r.media_release === "declined";

  const view = useMemo(() => {
    let list = rows ?? [];
    if (needsAttentionOnly) list = list.filter(needsAttention);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, needsAttentionOnly]);

  const withNotes = view.filter(hasNotes).length;
  const noMedia = view.filter((r) => r.media_release !== "granted").length;

  function exportCsv() {
    const head = ["Youth", "Grade", "Program", "Medical", "Allergies", "Medications", "Accommodations", "Special notes", "Photo release"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of view) {
      lines.push([
        `${r.last_name}, ${r.first_name}`, r.grade_label ?? "", r.program ?? "",
        medicalOf(r), allergiesOf(r), meaningful(r.medications_current), meaningful(r.accommodations), meaningful(r.special_notes),
        r.media_release,
      ].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const prog = programId ? (programs.find((p) => String(p.id) === programId)?.name ?? "program") : "all-programs";
    a.download = `special-notes-${prog}-${year ?? ""}.csv`.replace(/\s+/g, "-");
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <h1 style={st.heading}>Special Notes</h1>
      <p style={st.sub}>Medical, allergy, and accommodation notes for youth in a program — plus their general special notes and whether they've granted the photo/media release. Confidential — visible only to staff with medical access.</p>

      {denied ? (
        <p style={st.muted}>You don't have permission to view medical information. Ask an admin for the <strong>members.view_medical</strong> access.</p>
      ) : (
        <>
          <div style={st.toolbar}>
            <select style={st.select} value={programId} onChange={(e) => setProgramId(e.target.value)}>
              <option value="">All programs</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {year !== null && (
              <select style={st.select} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOpts.map((y) => <option key={y} value={y}>{y}–{y + 1}</option>)}
              </select>
            )}
            <label style={st.toggle}>
              <input type="checkbox" checked={needsAttentionOnly} onChange={(e) => setNeedsAttentionOnly(e.target.checked)} />
              Only youth needing attention
            </label>
            <button style={st.csvBtn} onClick={exportCsv} disabled={view.length === 0}><Download size={14} /> CSV</button>
            <div style={st.counts}>
              <span>{view.length} youth</span>
              {withNotes > 0 && <span style={st.countWarn}><AlertTriangle size={12} /> {withNotes} with notes</span>}
              {noMedia > 0 && <span style={st.countNoMedia}><CameraOff size={12} /> {noMedia} no-photo</span>}
            </div>
          </div>

          {loading ? <p style={st.muted}>Loading…</p> : (
            <div style={st.tableWrap}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>Youth</th>
                    <th style={st.th}>Program</th>
                    <th style={st.th}>Medical</th>
                    <th style={st.th}>Allergies</th>
                    <th style={st.th}>Medications</th>
                    <th style={st.th}>Accommodations</th>
                    <th style={st.th}>Special notes</th>
                    <th style={{ ...st.th, textAlign: "center" }}>Photos?</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => {
                    const med = medicalOf(r), alg = allergiesOf(r), meds = meaningful(r.medications_current),
                      acc = meaningful(r.accommodations), sn = meaningful(r.special_notes);
                    const flagged = hasNotes(r);
                    return (
                      <tr key={`${r.member_id}-${r.program_id}`} style={{ ...st.tr, background: flagged ? "#fffdf5" : "#fff" }}>
                        <td style={st.td}>
                          <strong>{r.last_name}, {r.first_name}</strong>
                          {r.grade_label && <div style={st.subCell}>{r.grade_label}</div>}
                        </td>
                        <td style={st.td}>{r.program ?? "—"}</td>
                        <td style={{ ...st.td, ...(med ? st.noteCell : {}) }}>{med || "—"}</td>
                        <td style={{ ...st.td, ...(alg ? st.noteCell : {}) }}>{alg || "—"}</td>
                        <td style={{ ...st.td, ...(meds ? st.noteCell : {}) }}>{meds || "—"}</td>
                        <td style={{ ...st.td, ...(acc ? st.noteCell : {}) }}>{acc || "—"}</td>
                        <td style={{ ...st.td, ...(sn ? st.noteCell : {}) }}>{sn || "—"}</td>
                        <td style={{ ...st.td, textAlign: "center" }}>
                          {r.media_release === "granted"
                            ? <span style={st.mediaOk}><Camera size={12} /> OK</span>
                            : r.media_release === "declined"
                              ? <span style={st.mediaNo}><CameraOff size={12} /> No</span>
                              : <span style={st.mediaUnk}><HelpCircle size={12} /> —</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {view.length === 0 && (
                    <tr><td style={st.empty} colSpan={8}>No youth match this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  heading: { margin: "0 0 2px", fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "0 0 16px", fontSize: 13, color: "#888", maxWidth: 720, lineHeight: 1.5 },
  muted: { color: "#888", fontSize: 14 },
  toolbar: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
  select: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, minWidth: 180 },
  toggle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444", cursor: "pointer" },
  csvBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13, fontWeight: 600, color: "#1a3a5c", cursor: "pointer" },
  counts: { display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: "#888", marginLeft: "auto" },
  countWarn: { display: "flex", alignItems: "center", gap: 4, color: "#b45309", fontWeight: 600 },
  countNoMedia: { display: "flex", alignItems: "center", gap: 4, color: "#c62828", fontWeight: 600 },
  tableWrap: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "10px 14px", background: "#f0f4f8", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #f0f4f8" },
  td: { padding: "9px 14px", color: "#333", verticalAlign: "top" },
  noteCell: { color: "#7c2d12", fontWeight: 500 },
  subCell: { fontSize: 11, color: "#aaa", marginTop: 2 },
  mediaOk: { display: "inline-flex", alignItems: "center", gap: 4, color: "#2e7d32", fontWeight: 700, fontSize: 12 },
  mediaNo: { display: "inline-flex", alignItems: "center", gap: 4, color: "#c62828", fontWeight: 700, fontSize: 12 },
  mediaUnk: { display: "inline-flex", alignItems: "center", gap: 4, color: "#aaa", fontWeight: 700, fontSize: 12 },
  empty: { textAlign: "center", color: "#aaa", padding: "2rem", fontSize: 14 },
};
