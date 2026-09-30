import { useEffect, useState } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { Plus, Trash2, Save, Users } from "lucide-react";
import { scholarshipsApi, type Scholarship } from "../api";
import { useSeasons, seasonOptions } from "../../../core/useSeasons";

type Draft = Partial<Scholarship>;
const BLANK: Draft = { name: "", is_active: true, renewable: false };

/** Manager (Mentor/Admin): maintain the scholarship catalog + eligibility, and roll a season forward. */
export default function ScholarshipManager() {
  const goBack = useGoBack("/scholarships");
  const [list, setList] = useState<Scholarship[]>([]);
  const seasons = useSeasons();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");

  const load = () => scholarshipsApi.manageList().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const set = (k: keyof Draft, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function save() {
    if (!draft?.name?.trim()) { setMsg("Name is required."); return; }
    // Guard against typo'd years (e.g. "0026" instead of "2026"), which would make
    // the board mis-judge whether the scholarship is open.
    for (const [field, label] of [["open_date", "Opens"], ["close_date", "Deadline"]] as const) {
      const v = (draft as Record<string, unknown>)[field] as string | undefined;
      if (v) { const yr = Number(v.slice(0, 4)); if (yr < 2000 || yr > 2100) { setMsg(`${label} date has an invalid year (${v}). Please re-enter it.`); return; } }
    }
    try {
      const saved = draft.id ? await scholarshipsApi.update(draft.id, draft) : await scholarshipsApi.create(draft);
      setDraft(saved); await load(); setMsg("Saved."); setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    }
  }
  async function del() {
    if (!draft?.id || !confirm(`Delete "${draft.name}"? This removes its follows and applications.`)) return;
    await scholarshipsApi.remove(draft.id); setDraft(null); load();
  }

  return (
    <div style={{ maxWidth: 1050, margin: "0 auto" }}>
      <button style={x.back} onClick={goBack}>← Scholarship board</button>
      <div style={x.headRow}>
        <h1 style={x.h1}>Manage Scholarships</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={x.new} onClick={() => { setDraft({ ...BLANK }); setMsg(""); }}><Plus size={15} /> New scholarship</button>
        </div>
      </div>
      <p style={x.sub}>Enter each scholarship with a link, eligibility, and its application window. Youth see active ones on the board; structured eligibility (graduation year, race, sex) drives the "you may be eligible" flags, and tags/notes cover the rest (career path, tribe, parent employer…).</p>
      {msg && <div style={x.msg}>{msg}</div>}

      <div style={x.cols}>
        <div style={x.listCol}>
          {list.length === 0 && <p style={x.muted}>No scholarships yet.</p>}
          {list.map((sc) => (
            <button key={sc.id} style={{ ...x.item, ...(draft?.id === sc.id ? x.itemOn : {}) }} onClick={() => setDraft({ ...sc })}>
              <div style={x.itemName}>{sc.name} {!sc.is_active && <span style={x.inactive}>inactive</span>}</div>
              <div style={x.itemMeta}>{sc.season ?? "—"} · <Users size={11} style={{ verticalAlign: -1 }} /> {sc.followers ?? 0} following · {sc.applicants ?? 0} applied</div>
            </button>
          ))}
        </div>

        <div style={x.editCol}>
          {!draft ? <p style={x.muted}>Select a scholarship, or create a new one.</p> : (
            <>
              <Row><Field label="Name" wide><input style={x.in} value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field></Row>
              <Row>
                <Field label="Provider / sponsor"><input style={x.in} value={draft.provider ?? ""} onChange={(e) => set("provider", e.target.value)} /></Field>
                <Field label="Season">
                  <select style={x.in} value={draft.season ?? ""} onChange={(e) => set("season", e.target.value)}>
                    <option value="">—</option>
                    {seasonOptions(seasons, draft.season).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </Row>
              <Row><Field label="Info / application URL" wide><input style={x.in} value={draft.info_url ?? ""} onChange={(e) => set("info_url", e.target.value)} /></Field></Row>
              <Row><Field label="Description" wide><textarea style={x.ta} value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field></Row>
              <Row>
                <Field label="Award min ($)"><input style={x.in} type="number" value={draft.amount_min ?? ""} onChange={(e) => set("amount_min", e.target.value)} /></Field>
                <Field label="Award max ($)"><input style={x.in} type="number" value={draft.amount_max ?? ""} onChange={(e) => set("amount_max", e.target.value)} /></Field>
                <Field label="Opens"><input style={x.in} type="date" min="2000-01-01" max="2100-12-31" value={draft.open_date ?? ""} onChange={(e) => set("open_date", e.target.value)} /></Field>
                <Field label="Deadline"><input style={x.in} type="date" min="2000-01-01" max="2100-12-31" value={draft.close_date ?? ""} onChange={(e) => set("close_date", e.target.value)} /></Field>
              </Row>

              <div style={x.section}>Eligibility (structured — drives "you may be eligible")</div>
              <Row>
                <Field label="Grad year from"><input style={x.in} type="number" value={draft.elig_grad_year_min ?? ""} onChange={(e) => set("elig_grad_year_min", e.target.value)} /></Field>
                <Field label="Grad year to"><input style={x.in} type="number" value={draft.elig_grad_year_max ?? ""} onChange={(e) => set("elig_grad_year_max", e.target.value)} /></Field>
                <Field label="Sex (blank = any)"><input style={x.in} value={draft.elig_sex ?? ""} onChange={(e) => set("elig_sex", e.target.value)} /></Field>
                <Field label="Min GPA (info)"><input style={x.in} type="number" step="0.01" value={draft.elig_min_gpa ?? ""} onChange={(e) => set("elig_min_gpa", e.target.value)} /></Field>
              </Row>
              <Row>
                <Field label="Race/ethnicity (comma-sep, any match)" wide><input style={x.in} placeholder="Black or African American, Hispanic, Native American" value={draft.elig_races ?? ""} onChange={(e) => set("elig_races", e.target.value)} /></Field>
                <Field label="States (comma-sep)"><input style={x.in} placeholder="OK, TX" value={draft.elig_states ?? ""} onChange={(e) => set("elig_states", e.target.value)} /></Field>
              </Row>
              <div style={x.section}>Eligibility (open-ended — shown to youth as chips/notes)</div>
              <Row>
                <Field label="Tags (comma-sep)" wide><input style={x.in} placeholder="STEM, first-gen, Cherokee Nation, parent at ONEOK" value={draft.elig_tags ?? ""} onChange={(e) => set("elig_tags", e.target.value)} /></Field>
              </Row>
              <Row><Field label="Eligibility notes" wide><textarea style={x.ta} value={draft.elig_notes ?? ""} onChange={(e) => set("elig_notes", e.target.value)} /></Field></Row>

              <div style={x.footRow}>
                <label style={x.chk}><input type="checkbox" checked={!!draft.is_active} onChange={(e) => set("is_active", e.target.checked)} /> Active (shown to youth)</label>
                <label style={x.chk}><input type="checkbox" checked={!!draft.renewable} onChange={(e) => set("renewable", e.target.checked)} /> Renewable</label>
                <div style={{ flex: 1 }} />
                {draft.id && <button style={x.del} onClick={del}><Trash2 size={14} /> Delete</button>}
                <button style={x.save} onClick={save}><Save size={14} /> Save</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) { return <div style={x.row}>{children}</div>; }
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label style={{ ...x.field, ...(wide ? { flex: 3 } : {}) }}><span style={x.l}>{label}</span>{children}</label>;
}

const x: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  sub: { color: "#667", fontSize: 13, margin: "6px 0 12px", lineHeight: 1.5 },
  msg: { background: "#e8f5e9", color: "#2e7d32", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, marginBottom: 10 },
  new: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  sec: { display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  rollBox: { background: "#f3effa", border: "1px solid #d6c9ee", borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13, color: "#445" },
  rollRow: { display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" },
  cols: { display: "flex", gap: 16, alignItems: "flex-start" },
  listCol: { width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 },
  item: { textAlign: "left", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", cursor: "pointer" },
  itemOn: { borderColor: "#1a3a5c", boxShadow: "0 0 0 1px #1a3a5c" },
  itemName: { fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  itemMeta: { fontSize: 11.5, color: "#889", marginTop: 2 },
  inactive: { fontSize: 10, color: "#c62828", background: "#ffebee", borderRadius: 8, padding: "1px 6px", fontWeight: 700 },
  editCol: { flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, minWidth: 0 },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 130, marginBottom: 9 },
  l: { fontSize: 11.5, fontWeight: 700, color: "#556" },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, width: "100%", boxSizing: "border-box" },
  ta: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, width: "100%", boxSizing: "border-box", minHeight: 60, resize: "vertical", fontFamily: "inherit" },
  section: { fontSize: 12, fontWeight: 800, color: "#5e35b1", textTransform: "uppercase", letterSpacing: 0.4, margin: "8px 0 6px", borderTop: "1px solid #f0f0f5", paddingTop: 10 },
  footRow: { display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" },
  chk: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334" },
  del: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  save: { display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  ghost: { background: "none", border: "1px solid #cdd7e3", borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer", color: "#556" },
  muted: { color: "#889", fontSize: 13.5 },
};
