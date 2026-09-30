/** Create / edit a season goal (modal). */
import { useState } from "react";
import type { SeasonGoal, GoalDraft, GoalCategory, MetricType, GoalPriority } from "../api";
import { CATEGORY_LABELS, METRIC_LABELS } from "../api";
import { X } from "lucide-react";

export default function GoalForm({ initial, roster, onSave, onClose }: {
  initial?: SeasonGoal | null;
  roster: { member_id: number; name: string }[];
  onSave: (d: GoalDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<GoalDraft>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    category: initial?.category ?? "outreach",
    owner_member_id: initial?.owner_member_id ?? null,
    metric_type: initial?.metric_type ?? "count",
    target_value: initial?.target_value ?? null,
    unit: initial?.unit ?? "",
    start_date: initial?.start_date ?? null,
    due_date: initial?.due_date ?? null,
    priority: initial?.priority ?? "med",
    status: initial?.status ?? "active",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof GoalDraft, v: unknown) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!(d.title ?? "").trim()) { setErr("Give the goal a title."); return; }
    setErr(""); setSaving(true);
    try { await onSave(d); onClose(); }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save."); }
    finally { setSaving(false); }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.head}><h3 style={s.h}>{initial ? "Edit Goal" : "New Season Goal"}</h3><button style={s.x} onClick={onClose}><X size={18} /></button></div>

        <label style={s.lbl}>Title *</label>
        <input style={s.inp} value={d.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Reach 500 students through outreach" />

        <label style={s.lbl}>Description</label>
        <textarea style={s.area} rows={2} value={d.description ?? ""} onChange={(e) => set("description", e.target.value)} />

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.lbl}>Category</label>
            <select style={s.inp} value={d.category} onChange={(e) => set("category", e.target.value as GoalCategory)}>
              {(Object.keys(CATEGORY_LABELS) as GoalCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div style={s.col}>
            <label style={s.lbl}>Owner</label>
            <select style={s.inp} value={d.owner_member_id ?? ""} onChange={(e) => set("owner_member_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Unassigned —</option>
              {roster.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
            </select>
          </div>
        </div>

        <div style={s.row}>
          <div style={s.col}>
            <label style={s.lbl}>Metric</label>
            <select style={s.inp} value={d.metric_type} onChange={(e) => set("metric_type", e.target.value as MetricType)}>
              {(Object.keys(METRIC_LABELS) as MetricType[]).map((t) => <option key={t} value={t}>{METRIC_LABELS[t]}</option>)}
            </select>
          </div>
          {d.metric_type !== "milestone" && <>
            <div style={s.colNarrow}>
              <label style={s.lbl}>Target</label>
              <input style={s.inp} type="number" value={d.target_value ?? ""} onChange={(e) => set("target_value", e.target.value === "" ? null : Number(e.target.value))} />
            </div>
            {d.metric_type === "count" || d.metric_type === "hours"
              ? <div style={s.colNarrow}><label style={s.lbl}>Unit</label><input style={s.inp} value={d.unit ?? ""} onChange={(e) => set("unit", e.target.value)} placeholder="hrs, kids…" /></div>
              : null}
          </>}
        </div>

        <div style={s.row}>
          <div style={s.col}><label style={s.lbl}>Start date</label><input style={s.inp} type="date" value={d.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} /></div>
          <div style={s.col}><label style={s.lbl}>Due date</label><input style={s.inp} type="date" value={d.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} /></div>
          <div style={s.colNarrow}>
            <label style={s.lbl}>Priority</label>
            <select style={s.inp} value={d.priority} onChange={(e) => set("priority", e.target.value as GoalPriority)}>
              <option value="low">Low</option><option value="med">Med</option><option value="high">High</option>
            </select>
          </div>
        </div>

        {err && <div style={s.err}>{err}</div>}
        <div style={s.actions}>
          <button style={s.cancel} onClick={onClose}>Cancel</button>
          <button style={s.save} onClick={save} disabled={saving}>{saving ? "Saving…" : initial ? "Save Changes" : "Create Goal"}</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "5vh 16px", overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, padding: "18px 20px", width: "100%", maxWidth: 560, boxShadow: "0 12px 40px rgba(0,0,0,0.2)" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  h: { margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a5c" },
  x: { background: "none", border: "none", cursor: "pointer", color: "#889", padding: 4 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "10px 0 4px" },
  inp: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box" },
  area: { width: "100%", padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5, boxSizing: "border-box", resize: "vertical" },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  col: { flex: "1 1 160px" },
  colNarrow: { flex: "0 1 110px" },
  err: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "8px 12px", color: "#c62828", marginTop: 10, fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  cancel: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  save: { padding: "10px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
};
