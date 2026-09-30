/**
 * MentorProspects — Recruitment Phase 3. Interested adults from first contact
 * through onboarding (YPT, background, T&C, orientation) to active mentor.
 * Parents are the best source; a prospect can be spawned from a youth's intake.
 */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGoBack } from "../../../core/useGoBack";
import { mentorProspectsApi, type MentorProspect, type MentorStage } from "../mentorProspectsApi";
import { ArrowLeft, Plus, Trash2, UserPlus, CheckCircle2, Circle, Handshake } from "lucide-react";

const STAGES: { key: MentorStage; label: string; color: string }[] = [
  { key: "interested", label: "Interested", color: "#1565c0" },
  { key: "contacted", label: "Contacted", color: "#00897b" },
  { key: "onboarding", label: "Onboarding", color: "#f57c00" },
  { key: "active", label: "Active", color: "#2e7d32" },
  { key: "declined", label: "Declined", color: "#9aa5b1" },
];
const CHECKS: { key: keyof MentorProspect; label: string }[] = [
  { key: "ypt_done", label: "YPT" }, { key: "background_done", label: "Background" },
  { key: "tc_done", label: "T&C" }, { key: "orientation_done", label: "Orientation" },
];

export default function MentorProspects() {
  const navigate = useNavigate();
  const goBack = useGoBack("/visitors");
  const [rows, setRows] = useState<MentorProspect[]>([]);
  const [kind, setKind] = useState<"" | "mentor" | "volunteer">("");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", phone: "", source: "parent", kind: "mentor" });

  const load = useCallback(() => { mentorProspectsApi.list(kind ? { kind } : undefined).then(setRows); }, [kind]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!f.name.trim()) return;
    await mentorProspectsApi.create(f); setF({ name: "", email: "", phone: "", source: "parent", kind: "mentor" }); setAdding(false); load();
  }
  async function addSponsor(p: MentorProspect) {
    if (p.sponsor_id) { navigate(`/sponsors/${p.sponsor_id}`); return; }
    if (confirm(`Also track ${p.name} as a Sponsor/supporter? They stay in this pipeline too.`)) { await mentorProspectsApi.toSponsor(p.id); load(); }
  }
  const patch = async (id: number, d: Record<string, unknown>) => { await mentorProspectsApi.update(id, d); load(); };
  async function convert(p: MentorProspect) {
    await mentorProspectsApi.convert(p.id);
    navigate(`/members/add`); // create the mentor member; the prospect is marked active
  }
  async function del(p: MentorProspect) { if (confirm(`Remove ${p.name} from the mentor pipeline?`)) { await mentorProspectsApi.remove(p.id); load(); } }

  return (
    <div style={s.page}>
      <button style={s.back} onClick={goBack}><ArrowLeft size={14} /> Visitors</button>
      <div style={s.head}>
        <h1 style={s.h1}><UserPlus size={22} /> Mentor &amp; Volunteer Pipeline</h1>
        <button style={s.newBtn} onClick={() => setAdding(true)}><Plus size={16} /> Add Prospect</button>
      </div>
      <p style={s.sub}>Recruit and onboard the adults who power our teams. A full FLL waitlist is a mentor problem — turn interested parents into team leaders. Some of these contacts are also sponsors/supporters.</p>

      <div style={s.filter}>
        {([["", "All"], ["mentor", "Mentors"], ["volunteer", "Volunteers"]] as const).map(([k, lbl]) => (
          <button key={k} style={{ ...s.filterBtn, ...(kind === k ? s.filterOn : {}) }} onClick={() => setKind(k)}>{lbl}</button>
        ))}
      </div>

      {adding && (
        <div style={s.addForm}>
          <div style={s.formRow}>
            <input style={s.fin} placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input style={s.fin} placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input style={s.fin} placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <select style={s.fin} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="mentor">Mentor</option><option value="volunteer">Volunteer</option>
            </select>
          </div>
          <div style={s.formActions}>
            <button style={s.cancel} onClick={() => setAdding(false)}>Cancel</button>
            <button style={s.save} onClick={add}>Add</button>
          </div>
        </div>
      )}

      {STAGES.map((st) => {
        const group = rows.filter((r) => r.stage === st.key);
        if (group.length === 0) return null;
        return (
          <div key={st.key} style={s.section}>
            <div style={{ ...s.sectionHead, color: st.color }}><span style={{ ...s.dot, background: st.color }} /> {st.label} <span style={s.count}>{group.length}</span></div>
            {group.map((p) => (
              <div key={p.id} style={s.card}>
                <div style={s.cardTop}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={s.name}>{p.name}</span>
                    {p.from_visitor_name && <span style={s.fromTag}>parent of {p.from_visitor_name}</span>}
                    {p.sponsor_id && <span style={s.sponsorTag}>also a sponsor</span>}
                    {p.onboarding_complete && p.stage !== "active" && <span style={s.readyTag}>onboarding complete</span>}
                    <div style={s.contact}>{[p.email, p.phone, p.source].filter(Boolean).join(" · ")}</div>
                  </div>
                  <select style={s.kindSel} value={p.kind} onChange={(e) => patch(p.id, { kind: e.target.value })} title="Mentor or volunteer">
                    <option value="mentor">Mentor</option><option value="volunteer">Volunteer</option>
                  </select>
                  <select style={s.stageSel} value={p.stage} onChange={(e) => patch(p.id, { stage: e.target.value })}>
                    {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                  <button style={s.iconX} onClick={() => del(p)}><Trash2 size={14} /></button>
                </div>
                <div style={s.checks}>
                  {CHECKS.map((c) => {
                    const on = p[c.key] as boolean;
                    return (
                      <button key={c.key} style={{ ...s.check, ...(on ? s.checkOn : {}) }} onClick={() => patch(p.id, { [c.key]: !on })}>
                        {on ? <CheckCircle2 size={13} /> : <Circle size={13} />} {c.label}
                      </button>
                    );
                  })}
                  <button style={{ ...s.sponsorBtn, ...(p.sponsor_id ? s.sponsorBtnOn : {}) }} onClick={() => addSponsor(p)}>
                    <Handshake size={12} /> {p.sponsor_id ? "View sponsor" : "Add to Sponsors"}
                  </button>
                  {p.stage !== "active" && p.stage !== "declined" && (
                    <button style={s.convertBtn} onClick={() => convert(p)}><UserPlus size={12} /> Convert to {p.kind}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {rows.length === 0 && <p style={s.muted}>No mentor prospects yet. Add one, or recruit a parent from a youth's inquiry.</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 820, margin: "0 auto" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 8 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { margin: 0, fontSize: 22, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  newBtn: { display: "flex", alignItems: "center", gap: 6, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13.5, margin: "6px 0 12px" },
  filter: { display: "flex", gap: 6, marginBottom: 14 },
  filterBtn: { background: "#fff", border: "1px solid #cdd7e3", borderRadius: 16, padding: "5px 14px", fontSize: 12.5, fontWeight: 600, color: "#556", cursor: "pointer" },
  filterOn: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  addForm: { background: "#f8fafc", border: "1px dashed #cdd7e3", borderRadius: 8, padding: 12, marginBottom: 14 },
  formRow: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  fin: { flex: 1, minWidth: 130, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 14 },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancel: { padding: "7px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  save: { padding: "7px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  section: { marginBottom: 18 },
  sectionHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  count: { fontSize: 12, fontWeight: 700, background: "#eef4fb", color: "#1565c0", borderRadius: 9, padding: "0 8px" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 8 },
  cardTop: { display: "flex", alignItems: "center", gap: 10 },
  name: { fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  fromTag: { fontSize: 11, fontWeight: 600, background: "#ede7f6", color: "#5e35b1", borderRadius: 5, padding: "1px 7px", marginLeft: 8 },
  sponsorTag: { fontSize: 11, fontWeight: 700, background: "#e7f3f0", color: "#00695c", borderRadius: 5, padding: "1px 7px", marginLeft: 8 },
  readyTag: { fontSize: 11, fontWeight: 700, background: "#e8f5e9", color: "#2e7d32", borderRadius: 5, padding: "1px 7px", marginLeft: 8 },
  kindSel: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12, background: "#f8fafc", color: "#556" },
  sponsorBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", color: "#00695c", border: "1px solid #a8d5c9", borderRadius: 6, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  sponsorBtnOn: { background: "#e7f3f0" },
  contact: { fontSize: 12.5, color: "#778", marginTop: 3 },
  stageSel: { padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, background: "#fff" },
  iconX: { background: "none", border: "none", color: "#c62828", cursor: "pointer", display: "flex", padding: 3 },
  checks: { display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap", alignItems: "center" },
  check: { display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 14, padding: "4px 11px", fontSize: 12, color: "#556", cursor: "pointer" },
  checkOn: { background: "#e8f5e9", borderColor: "#a5d6a7", color: "#2e7d32", fontWeight: 600 },
  convertBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginLeft: "auto" },
  muted: { color: "#889", fontSize: 14 },
};
