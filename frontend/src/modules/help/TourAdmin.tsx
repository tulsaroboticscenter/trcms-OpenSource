import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Save, ArrowUp, ArrowDown, Play } from "lucide-react";
import { tourApi, type GuidedTour, type TourStep } from "./tourApi";
import { useTour } from "./TourContext";

type Draft = Partial<GuidedTour> & { steps?: TourStep[] };
const BLANK: Draft = { tour_key: "", title: "", description: "", roles: "", auto_key: "", sort_order: 0, is_published: true, steps: [{ title: "", body: "" }] };

/** Admin → author guided tours. Each tour is a list of steps; a step can spotlight
 *  an element (CSS selector) or show a centered card, and optionally navigate first. */
export default function TourAdmin() {
  const navigate = useNavigate();
  const { startTour } = useTour();
  const [list, setList] = useState<GuidedTour[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");

  const load = () => tourApi.adminList().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const set = (k: keyof Draft, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const steps = draft?.steps ?? [];
  const setStep = (i: number, k: keyof TourStep, v: string) =>
    setDraft((d) => d ? { ...d, steps: steps.map((s, j) => j === i ? { ...s, [k]: v } : s) } : d);
  const addStep = () => setDraft((d) => d ? { ...d, steps: [...steps, { title: "", body: "" }] } : d);
  const delStep = (i: number) => setDraft((d) => d ? { ...d, steps: steps.filter((_, j) => j !== i) } : d);
  const moveStep = (i: number, dir: -1 | 1) => setDraft((d) => {
    if (!d) return d;
    const j = i + dir; if (j < 0 || j >= steps.length) return d;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]];
    return { ...d, steps: next };
  });

  async function save() {
    if (!draft?.title?.trim()) { setMsg("Title is required."); return; }
    const clean = steps.filter((s) => s.title.trim() || s.body.trim());
    if (!clean.length) { setMsg("Add at least one step."); return; }
    const payload = { ...draft, steps: clean };
    try {
      const saved = draft.id ? await tourApi.update(draft.id, payload) : await tourApi.create(payload);
      setDraft(saved); await load(); setMsg("Saved."); setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    }
  }
  async function del() {
    if (!draft?.id || !confirm(`Delete "${draft.title}"?`)) return;
    await tourApi.remove(draft.id); setDraft(null); load();
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <button style={s.back} onClick={() => navigate("/admin")}>← Admin</button>
      <div style={s.headRow}>
        <h1 style={s.h1}>Guided Tours</h1>
        <button style={s.new} onClick={() => setDraft({ ...BLANK })}><Plus size={15} /> New tour</button>
      </div>
      <p style={s.sub}>A tour walks a member through a screen or workflow with a tooltip on each step. Leave a step's <strong>selector</strong> blank for a centered card, or use a CSS selector (e.g. <code>#nav-events</code>) to spotlight an element. Set <strong>Route</strong> to send the user to a page before that step. Members launch tours from the <strong>?</strong> Help panel; a tour with auto-key <code>dashboard</code> is offered once to new users.</p>

      <div style={s.cols}>
        <div style={s.listCol}>
          {list.length === 0 && <p style={s.muted}>No tours yet.</p>}
          {list.map((t) => (
            <button key={t.id} style={{ ...s.listItem, ...(draft?.id === t.id ? s.listItemActive : {}) }} onClick={() => setDraft({ ...t })}>
              <div style={s.liTitle}>{t.title} {!t.is_published && <span style={s.draftTag}>draft</span>}</div>
              <div style={s.liCat}>{t.step_count ?? t.steps?.length ?? 0} steps · {t.tour_key}</div>
            </button>
          ))}
        </div>

        <div style={s.editCol}>
          {!draft ? <p style={s.muted}>Select a tour, or create a new one.</p> : (
            <>
              <div style={s.two}>
                <label style={s.field}><span style={s.l}>Title</span>
                  <input style={s.in} value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} /></label>
                <label style={s.field}><span style={s.l}>Key {draft.id ? "(fixed)" : "(auto from title if blank)"}</span>
                  <input style={s.in} disabled={!!draft.id} value={draft.tour_key ?? ""} onChange={(e) => set("tour_key", e.target.value)} /></label>
              </div>
              <label style={s.field}><span style={s.l}>Description</span>
                <input style={s.in} value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} /></label>
              <div style={s.three}>
                <label style={s.field}><span style={s.l}>Roles (blank = everyone)</span>
                  <input style={s.in} placeholder="e.g. Parent, Admin" value={draft.roles ?? ""} onChange={(e) => set("roles", e.target.value)} /></label>
                <label style={s.field}><span style={s.l}>Auto-offer key (optional)</span>
                  <input style={s.in} placeholder="e.g. dashboard" value={draft.auto_key ?? ""} onChange={(e) => set("auto_key", e.target.value)} /></label>
                <label style={s.field}><span style={s.l}>Sort</span>
                  <input style={s.in} type="number" value={draft.sort_order ?? 0} onChange={(e) => set("sort_order", parseInt(e.target.value) || 0)} /></label>
              </div>

              <div style={s.stepsHead}><span style={s.l}>Steps</span><button style={s.addStep} onClick={addStep}><Plus size={13} /> Add step</button></div>
              {steps.map((st, i) => (
                <div key={i} style={s.stepCard}>
                  <div style={s.stepTop}>
                    <span style={s.stepNum}>Step {i + 1}</span>
                    <div style={{ flex: 1 }} />
                    <button style={s.iconBtn} disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp size={13} /></button>
                    <button style={s.iconBtn} disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown size={13} /></button>
                    <button style={{ ...s.iconBtn, color: "#c62828" }} onClick={() => delStep(i)}><Trash2 size={13} /></button>
                  </div>
                  <input style={s.in} placeholder="Step title" value={st.title} onChange={(e) => setStep(i, "title", e.target.value)} />
                  <textarea style={s.stepBody} placeholder="What to explain (Markdown: **bold**, links, lists)…" value={st.body} onChange={(e) => setStep(i, "body", e.target.value)} />
                  <div style={s.two}>
                    <input style={s.in} placeholder="CSS selector to spotlight (optional)" value={st.selector ?? ""} onChange={(e) => setStep(i, "selector", e.target.value)} />
                    <input style={s.in} placeholder="Route, e.g. /events (optional)" value={st.route ?? ""} onChange={(e) => setStep(i, "route", e.target.value)} />
                  </div>
                </div>
              ))}

              <div style={s.footRow}>
                <label style={s.pub}><input type="checkbox" checked={!!draft.is_published} onChange={(e) => set("is_published", e.target.checked)} /> Published</label>
                <div style={{ flex: 1 }} />
                {draft.id && draft.is_published && <button style={s.try} onClick={() => startTour(draft.tour_key!)}><Play size={14} /> Try it</button>}
                {draft.id && <button style={s.del} onClick={del}><Trash2 size={14} /> Delete</button>}
                <button style={s.save} onClick={save}><Save size={14} /> Save</button>
                {msg && <span style={s.saved}>{msg}</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  back: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 6 },
  headRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 23, fontWeight: 800, color: "#1a3a5c", margin: 0 },
  new: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  sub: { color: "#667", fontSize: 13, margin: "6px 0 14px", lineHeight: 1.5 },
  cols: { display: "flex", gap: 16, alignItems: "flex-start" },
  listCol: { width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 },
  listItem: { textAlign: "left", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", cursor: "pointer" },
  listItemActive: { borderColor: "#5e35b1", boxShadow: "0 0 0 1px #5e35b1" },
  liTitle: { fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  liCat: { fontSize: 11.5, color: "#889", marginTop: 2 },
  draftTag: { fontSize: 10, color: "#e65100", background: "#fff3e0", borderRadius: 8, padding: "1px 6px", fontWeight: 700 },
  editCol: { flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, minWidth: 0 },
  two: { display: "flex", gap: 10 },
  three: { display: "flex", gap: 10, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 140, marginBottom: 8 },
  l: { fontSize: 11.5, fontWeight: 700, color: "#556" },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, width: "100%", boxSizing: "border-box" },
  stepsHead: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 6px" },
  addStep: { display: "flex", alignItems: "center", gap: 5, background: "#f0f4f8", border: "1px solid #cdd7e3", borderRadius: 6, padding: "5px 10px", fontSize: 12.5, cursor: "pointer", color: "#1a3a5c" },
  stepCard: { border: "1px solid #e6e0f2", background: "#faf8fe", borderRadius: 9, padding: 10, marginBottom: 8, display: "flex", flexDirection: "column", gap: 6 },
  stepTop: { display: "flex", alignItems: "center", gap: 4 },
  stepNum: { fontSize: 12, fontWeight: 700, color: "#5e35b1" },
  iconBtn: { background: "#fff", border: "1px solid #d6dde6", borderRadius: 6, padding: 4, cursor: "pointer", color: "#556", display: "flex" },
  stepBody: { width: "100%", minHeight: 70, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" },
  footRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" },
  pub: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334" },
  try: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", color: "#5e35b1", border: "1px solid #d6c9ee", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  del: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  save: { display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  saved: { color: "#2e7d32", fontSize: 13, fontWeight: 600 },
  muted: { color: "#889", fontSize: 13.5 },
};
