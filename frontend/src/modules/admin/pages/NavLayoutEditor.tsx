/**
 * Sidebar organiser — admins arrange the nav into sections: rename/reorder/add/remove
 * sections, set which start collapsed, and file each nav item into a section. Saved to
 * the server (system_config 'nav_layout') so it applies for everyone; the live sidebar
 * refreshes via a window event on save.
 *
 * Items are identified by route. The catalog of assignable items comes from the module
 * registry plus the handful of hard-coded links, so every possible sidebar entry can be
 * placed regardless of who is editing.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../core/api";
import { allNavItems } from "../../../moduleRegistry";
import { useGoBack } from "../../../core/useGoBack";
import { ArrowLeft, ChevronUp, ChevronDown, Trash2, Plus, RotateCcw, Save, GripVertical } from "lucide-react";

interface Section { id: string; label: string; collapsed: boolean; items: string[] }

// The hard-coded sidebar links that live outside the module registry.
const EXTRA_ITEMS = [
  { to: "/roles/ylc", label: "YLC" },
  { to: "/roles/compliance", label: "Compliance" },
  { to: "/minutes?group=TRCF%20Board", label: "TRCF Board" },
  { to: "/minutes?group=Program%20Team", label: "Program Team" },
  { to: "/admin", label: "Admin" },
];

export default function NavLayoutEditor() {
  const goBack = useGoBack("/admin");
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // route -> label for every placeable item.
  const labelByRoute = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of allNavItems) m.set(n.to, n.label);
    for (const e of EXTRA_ITEMS) m.set(e.to, e.label);
    return m;
  }, []);

  const load = () => {
    setLoading(true);
    api.get("/api/v1/nav-layout").then((r) => setSections(r.data?.sections ?? [])).finally(() => setLoading(false));
  };
  useEffect(load, []);

  // Items in the catalog that aren't filed into any section yet.
  const unassigned = useMemo(() => {
    const placed = new Set(sections.flatMap((s) => s.items));
    return [...labelByRoute.keys()].filter((r) => !placed.has(r));
  }, [sections, labelByRoute]);

  const label = (route: string) => labelByRoute.get(route) ?? route;

  // ── section ops ──
  const renameSection = (i: number, label: string) =>
    setSections((s) => s.map((x, j) => (j === i ? { ...x, label } : x)));
  const toggleCollapsed = (i: number) =>
    setSections((s) => s.map((x, j) => (j === i ? { ...x, collapsed: !x.collapsed } : x)));
  const moveSection = (i: number, dir: -1 | 1) =>
    setSections((s) => {
      const j = i + dir; if (j < 0 || j >= s.length) return s;
      const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  const addSection = () =>
    setSections((s) => [...s, { id: `section_${Date.now()}`, label: "New section", collapsed: true, items: [] }]);
  const deleteSection = (i: number) =>
    setSections((s) => s.filter((_, j) => j !== i)); // its items fall back to Unassigned

  // ── item ops ──
  const assignItem = (route: string, toSectionId: string) =>
    setSections((s) => s.map((x) => {
      const without = x.items.filter((r) => r !== route);
      if (x.id === toSectionId) return { ...x, items: [...without, route] };
      return { ...x, items: without };
    }));
  const removeItem = (route: string) =>
    setSections((s) => s.map((x) => ({ ...x, items: x.items.filter((r) => r !== route) })));
  const moveItem = (sectionIdx: number, itemIdx: number, dir: -1 | 1) =>
    setSections((s) => s.map((x, j) => {
      if (j !== sectionIdx) return x;
      const k = itemIdx + dir; if (k < 0 || k >= x.items.length) return x;
      const items = [...x.items]; [items[itemIdx], items[k]] = [items[k], items[itemIdx]];
      return { ...x, items };
    }));

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    try {
      await api.put("/api/v1/nav-layout", { sections });
      window.dispatchEvent(new Event("trc:nav-layout-changed"));
      setMsg("Saved — the sidebar has been updated for everyone.");
      load();
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally { setSaving(false); }
  }
  async function reset() {
    if (!confirm("Reset the sidebar to the default organisation? Your customisations will be lost.")) return;
    setSaving(true); setErr("");
    try {
      const r = await api.post("/api/v1/nav-layout/reset");
      setSections(r.data?.sections ?? []);
      window.dispatchEvent(new Event("trc:nav-layout-changed"));
      setMsg("Reset to the default organisation.");
    } finally { setSaving(false); }
  }

  if (loading) return <div style={s.wrap}><p style={s.muted}>Loading…</p></div>;

  return (
    <div style={s.wrap}>
      <button onClick={goBack} style={s.back}><ArrowLeft size={14} /> Admin</button>
      <div style={s.head}>
        <div>
          <h1 style={s.h1}>Sidebar Organizer</h1>
          <p style={s.sub}>Group the navigation into sections and file each item where it belongs. Everyone sees these sections; each person can collapse the ones they don't use.</p>
        </div>
        <div style={s.headBtns}>
          <button style={s.ghost} onClick={reset} disabled={saving}><RotateCcw size={14} /> Reset to default</button>
          <button style={s.primary} onClick={save} disabled={saving}><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {msg && <div style={s.ok}>{msg}</div>}
      {err && <div style={s.err}>{err}</div>}

      {sections.map((section, i) => (
        <div key={section.id} style={s.section}>
          <div style={s.sectionHead}>
            <div style={s.reorder}>
              <button style={s.iconBtn} disabled={i === 0} onClick={() => moveSection(i, -1)} title="Move up"><ChevronUp size={15} /></button>
              <button style={s.iconBtn} disabled={i === sections.length - 1} onClick={() => moveSection(i, 1)} title="Move down"><ChevronDown size={15} /></button>
            </div>
            <input style={s.nameInput} value={section.label} onChange={(e) => renameSection(i, e.target.value)} />
            <label style={s.collapseLbl}>
              <input type="checkbox" checked={section.collapsed} onChange={() => toggleCollapsed(i)} /> starts collapsed
            </label>
            <button style={s.del} onClick={() => deleteSection(i)} title="Delete section (items move to Unassigned)"><Trash2 size={14} /></button>
          </div>
          <div style={s.items}>
            {section.items.length === 0 && <p style={s.empty}>No items — assign some from below.</p>}
            {section.items.map((route, k) => (
              <div key={route} style={s.itemRow}>
                <GripVertical size={13} color="#c3cdd9" />
                <span style={s.itemLabel}>{label(route)}</span>
                <button style={s.iconBtn} disabled={k === 0} onClick={() => moveItem(i, k, -1)} title="Up"><ChevronUp size={14} /></button>
                <button style={s.iconBtn} disabled={k === section.items.length - 1} onClick={() => moveItem(i, k, 1)} title="Down"><ChevronDown size={14} /></button>
                <select style={s.moveSel} value={section.id} onChange={(e) => (e.target.value === "__remove" ? removeItem(route) : assignItem(route, e.target.value))}>
                  {sections.map((sec) => <option key={sec.id} value={sec.id}>{sec.label}</option>)}
                  <option value="__remove">— Unassign —</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button style={s.addSection} onClick={addSection}><Plus size={14} /> Add section</button>

      {unassigned.length > 0 && (
        <div style={{ ...s.section, borderStyle: "dashed" }}>
          <div style={s.sectionHead}><strong style={{ color: "#7a8899" }}>Unassigned</strong>
            <span style={s.hint}>Not shown in a section yet — pick a section for each. (New modules land here.)</span>
          </div>
          <div style={s.items}>
            {unassigned.map((route) => (
              <div key={route} style={s.itemRow}>
                <span style={s.itemLabel}>{label(route)}</span>
                <select style={s.moveSel} value="" onChange={(e) => e.target.value && assignItem(route, e.target.value)}>
                  <option value="">Assign to…</option>
                  {sections.map((sec) => <option key={sec.id} value={sec.id}>{sec.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 760, margin: "0 auto" },
  back: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#5a6b7d", cursor: "pointer", fontSize: 13, padding: "8px 0" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  headBtns: { display: "flex", gap: 8 },
  h1: { fontSize: 22, fontWeight: 800, color: "#1a2634", margin: 0 },
  sub: { fontSize: 13, color: "#7a8899", margin: "4px 0 0", maxWidth: 560, lineHeight: 1.5 },
  section: { border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", marginBottom: 12, background: "#fff" },
  sectionHead: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  reorder: { display: "flex", flexDirection: "column" },
  nameInput: { flex: 1, minWidth: 140, padding: "6px 9px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  collapseLbl: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#7a8899" },
  del: { background: "none", border: "none", cursor: "pointer", color: "#c62828", padding: 4 },
  items: { display: "flex", flexDirection: "column", gap: 5 },
  itemRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "#f7fafc", border: "1px solid #eef2f6", borderRadius: 7 },
  itemLabel: { flex: 1, fontSize: 13, color: "#33475b" },
  moveSel: { padding: "4px 6px", border: "1px solid #cdd7e3", borderRadius: 5, fontSize: 12, background: "#fff" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#5a6b7d", padding: 1, display: "inline-flex" },
  empty: { fontSize: 12.5, color: "#aab4c0", fontStyle: "italic", margin: 0 },
  hint: { fontSize: 11.5, color: "#aab4c0" },
  addSection: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", border: "1px dashed #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, color: "#33475b", cursor: "pointer", marginBottom: 16 },
  primary: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#0b5c4f", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  ghost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, fontWeight: 600, color: "#33475b", cursor: "pointer" },
  ok: { fontSize: 13, color: "#2e7d32", background: "#eef7f0", border: "1px solid #b7dcc0", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  err: { fontSize: 13, color: "#c62828", background: "#fdecea", border: "1px solid #f5c6c2", borderRadius: 8, padding: "9px 12px", marginBottom: 12 },
  muted: { fontSize: 13, color: "#8b98a6" },
};
