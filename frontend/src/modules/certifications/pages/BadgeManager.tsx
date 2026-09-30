/**
 * BadgeManager — view and (for managers) create/edit auto-awarded badges.
 * Saving re-evaluates all members so newly-qualifying badges award immediately.
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { certApi, type Badge, type CatalogResponse } from "../api";
import * as Icons from "lucide-react";
import { ArrowLeft, Medal, PlusCircle, Edit2, Trash2, X } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

function BadgeIcon({ name, size = 18, color }: { name?: string; size?: number; color?: string }) {
  const Cmp = (name && (Icons as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>)[name]) || Medal;
  return <Cmp size={size} color={color} />;
}

const CRITERIA = [
  { value: "count", label: "Earn N certifications" },
  { value: "section", label: "Complete all active certs in a section" },
  { value: "level", label: "Complete all active certs of a level" },
  { value: "tool", label: "Hold a specific certification" },
  { value: "bundle", label: "Complete a set of certifications" },
];
const ICON_SUGGESTIONS = ["Medal", "Award", "Trophy", "Crown", "ShieldCheck", "Star", "Wrench", "Cog", "Code", "PenTool", "Bot", "Sparkles", "Layers", "Zap", "Flame", "Target"];

export default function BadgeManager() {
  const goBack = useGoBack("/certifications");
  const { canWrite } = useAuth();
  const canManage = canWrite("certifications.manage");
  const [badges, setBadges] = useState<Badge[]>([]);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [editing, setEditing] = useState<Badge | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => { certApi.listBadges().then(setBadges).catch(() => {}); }, []);
  useEffect(() => { load(); certApi.catalog().then(setCatalog).catch(() => {}); }, [load]);

  return (
    <div>
      <button style={st.back} onClick={goBack}><ArrowLeft size={14} /> Certifications</button>
      <div style={st.header}>
        <h1 style={st.heading}><Medal size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />Badges</h1>
        {canManage && !adding && !editing && <button style={st.addBtn} onClick={() => setAdding(true)}><PlusCircle size={15} /> New Badge</button>}
      </div>
      {msg && <div style={st.msg}>{msg}</div>}

      {(adding || editing) && canManage && catalog && (
        <BadgeForm badge={editing} catalog={catalog}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={(awarded) => { setAdding(false); setEditing(null); load(); if (awarded) { setMsg(`Saved — ${awarded} badge(s) newly awarded.`); setTimeout(() => setMsg(""), 4000); } }} />
      )}

      <div style={st.grid}>
        {badges.map((b) => (
          <div key={b.id} style={st.card}>
            <div style={{ ...st.coin, background: b.color }}><BadgeIcon name={b.icon_name} color="#fff" size={22} /></div>
            <div style={st.cardMain}>
              <div style={st.name}>{b.name}{b.is_active === false && <span style={st.inactive}> (inactive)</span>}</div>
              <div style={st.desc}>{b.description}</div>
              <div style={st.meta}>{b.earned_count ?? 0} earned · {b.criteria_type}</div>
            </div>
            {canManage && (
              <div style={st.actions}>
                <button style={st.iconBtn} onClick={() => { setEditing(b); setAdding(false); }}><Edit2 size={13} /></button>
                <button style={st.iconBtn} onClick={() => { if (confirm(`Delete badge "${b.name}"? Members who earned it will lose it.`)) certApi.deleteBadge(b.id).then(load); }}><Trash2 size={13} color="#c62828" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BadgeForm({ badge, catalog, onClose, onSaved }: {
  badge: Badge | null; catalog: CatalogResponse; onClose: () => void; onSaved: (awarded: number) => void;
}) {
  const cv = (badge?.criteria_value ?? {}) as Record<string, unknown>;
  const [f, setF] = useState({
    name: badge?.name ?? "", description: badge?.description ?? "",
    icon_name: badge?.icon_name ?? "Medal", color: badge?.color ?? "#6a1b9a",
    criteria_type: badge?.criteria_type ?? "count",
  });
  const [threshold, setThreshold] = useState(String((cv.threshold as number) ?? 5));
  const [section, setSection] = useState((cv.section as string) ?? "");
  const [level, setLevel] = useState(String((cv.level as number) ?? 1));
  const [toolCode, setToolCode] = useState((cv.cert_code as string) ?? "");
  const [bundleCodes, setBundleCodes] = useState<string[]>((cv.cert_codes as string[]) ?? []);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const allCerts = catalog.sections.flatMap((s) => s.certifications);

  function criteriaValue(): Record<string, unknown> {
    switch (f.criteria_type) {
      case "count": return { threshold: parseInt(threshold) || 1 };
      case "section": return { section };
      case "level": return { level: parseInt(level) };
      case "tool": return { cert_code: toolCode };
      case "bundle": return { cert_codes: bundleCodes };
      default: return {};
    }
  }

  async function save() {
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...f, name: f.name.trim(), criteria_value: criteriaValue() };
      const r = badge ? await certApi.updateBadge(badge.id, payload) : await certApi.createBadge(payload);
      onSaved((r as { newly_awarded?: number })?.newly_awarded ?? 0);
    } finally { setSaving(false); }
  }

  return (
    <div style={st.form}>
      <div style={st.formHead}><span style={st.formTitle}>{badge ? "Edit" : "New"} Badge</span><button style={st.closeBtn} onClick={onClose}><X size={16} /></button></div>
      <div style={st.formGrid}>
        <div style={{ gridColumn: "span 2" }}><label style={st.l}>Name *</label><input style={st.input} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div><label style={st.l}>Color</label><input type="color" style={{ ...st.input, height: 38, padding: 2 }} value={f.color} onChange={(e) => set("color", e.target.value)} /></div>
        <div style={{ gridColumn: "span 2" }}><label style={st.l}>Description</label><input style={st.input} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div><label style={st.l}>Icon</label><input style={st.input} value={f.icon_name} onChange={(e) => set("icon_name", e.target.value)} list="badge-icons" /><datalist id="badge-icons">{ICON_SUGGESTIONS.map((i) => <option key={i} value={i} />)}</datalist></div>
        <div style={{ gridColumn: "span 3" }}><label style={st.l}>Criteria</label>
          <select style={st.input} value={f.criteria_type} onChange={(e) => set("criteria_type", e.target.value)}>
            {CRITERIA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        {f.criteria_type === "count" && <div><label style={st.l}>Certifications needed</label><input type="number" min="1" style={st.input} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>}
        {f.criteria_type === "section" && <div style={{ gridColumn: "span 2" }}><label style={st.l}>Section</label>
          <select style={st.input} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">Select…</option>{catalog.sections.map((s) => <option key={s.section} value={s.section}>{s.section}</option>)}
          </select></div>}
        {f.criteria_type === "level" && <div><label style={st.l}>Level</label><select style={st.input} value={level} onChange={(e) => setLevel(e.target.value)}><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3</option></select></div>}
        {f.criteria_type === "tool" && <div style={{ gridColumn: "span 2" }}><label style={st.l}>Certification</label>
          <select style={st.input} value={toolCode} onChange={(e) => setToolCode(e.target.value)}>
            <option value="">Select…</option>{allCerts.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          </select></div>}
        {f.criteria_type === "bundle" && <div style={{ gridColumn: "1 / -1" }}><label style={st.l}>Certifications in this bundle (Ctrl/Cmd-click for multiple)</label>
          <select multiple style={{ ...st.input, height: 140 }} value={bundleCodes}
            onChange={(e) => setBundleCodes(Array.from(e.target.selectedOptions).map((o) => o.value))}>
            {catalog.sections.map((s) => <optgroup key={s.section} label={s.section}>{s.certifications.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</optgroup>)}
          </select></div>}
      </div>
      <div style={st.formActions}>
        <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
        <button style={st.saveBtn} onClick={save} disabled={saving || !f.name.trim()}>{saving ? "Saving…" : "Save Badge"}</button>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  back: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 10 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  heading: { margin: 0, fontSize: 24, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  msg: { background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 6, padding: "8px 14px", color: "#2e7d32", marginBottom: 12, fontSize: 13 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  card: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" },
  coin: { width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" },
  cardMain: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  inactive: { fontSize: 11, color: "#aaa", fontWeight: 400 },
  desc: { fontSize: 12, color: "#666", marginTop: 1 },
  meta: { fontSize: 11, color: "#aaa", marginTop: 3 },
  actions: { display: "flex", gap: 4 },
  iconBtn: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", padding: 5, display: "flex", color: "#888" },
  form: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem", marginBottom: 14 },
  formHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  formTitle: { fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#888", display: "flex" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 12px" },
  l: { display: "block", fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  formActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 18px", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
};
