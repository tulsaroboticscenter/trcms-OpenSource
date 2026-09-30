import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../../core/AuthContext";
import { campApi, type CampSeason, type CampResource } from "../api";
import CampTabs from "../components/CampTabs";
import { Plus, Trash2, ExternalLink, X, Pencil } from "lucide-react";

const BUCKETS: { key: CampResource["bucket"]; label: string }[] = [
  { key: "general", label: "General Resources" },
  { key: "week1", label: "Week 1" },
  { key: "week2", label: "Week 2" },
  { key: "week3", label: "Week 3" },
];
const TYPES = ["document", "website", "social", "other"];

export default function CampResources() {
  const { canWrite } = useAuth();
  const canManage = canWrite("camp.manage");
  const [season, setSeason] = useState<CampSeason | null>(null);
  const [resources, setResources] = useState<CampResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Partial<CampResource> | null>(null);

  const load = useCallback(async () => {
    const s = await campApi.currentSeason().catch(() => null);
    setSeason(s);
    setResources(await campApi.listResources(s?.id).catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }

  async function save() {
    if (!editing?.title?.trim()) { flash("Title is required."); return; }
    const saved = await campApi.saveResource({ ...editing, season_id: season?.id });
    setResources((rs) => editing.id ? rs.map((r) => r.id === saved.id ? saved : r) : [...rs, saved]);
    setEditing(null); flash("Resource saved.");
  }
  async function remove(r: CampResource) {
    if (!confirm(`Delete "${r.title}"?`)) return;
    await campApi.deleteResource(r.id);
    setResources((rs) => rs.filter((x) => x.id !== r.id));
  }

  if (loading) return <div style={st.page}><CampTabs /><p style={st.muted}>Loading…</p></div>;
  if (!season) return <div style={st.page}><CampTabs /><p style={st.muted}>No camp season set up yet — create one on the Setup tab.</p></div>;

  return (
    <div style={st.page}>
      <CampTabs />
      {msg && <div style={st.flash}>{msg}</div>}
      <p style={st.intro}>Links to documents, websites, social posts, and anything else being developed for the camp season. Grouped into General and per-week buckets.</p>

      {editing && (
        <div style={st.editor}>
          <div style={st.editorHead}><strong>{editing.id ? "Edit resource" : "New resource"}</strong><button style={st.iconBtn} onClick={() => setEditing(null)}><X size={16} /></button></div>
          <div style={st.grid}>
            <L label="Title *"><input style={st.in} value={editing.title ?? ""} onChange={(e) => setEditing((p) => ({ ...p, title: e.target.value }))} /></L>
            <L label="Group"><select style={st.in} value={editing.bucket ?? "general"} onChange={(e) => setEditing((p) => ({ ...p, bucket: e.target.value as CampResource["bucket"] }))}>{BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></L>
            <L label="Link (URL)"><input style={st.in} value={editing.url ?? ""} onChange={(e) => setEditing((p) => ({ ...p, url: e.target.value }))} placeholder="https://…" /></L>
            <L label="Type"><select style={st.in} value={editing.resource_type ?? ""} onChange={(e) => setEditing((p) => ({ ...p, resource_type: e.target.value }))}><option value="">—</option>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></L>
          </div>
          <L label="Notes"><textarea style={st.ta} value={editing.notes ?? ""} onChange={(e) => setEditing((p) => ({ ...p, notes: e.target.value }))} /></L>
          <div style={st.actions}><button style={st.ghost} onClick={() => setEditing(null)}>Cancel</button><button style={st.primary} onClick={save}>Save resource</button></div>
        </div>
      )}

      {BUCKETS.map((b) => {
        const items = resources.filter((r) => r.bucket === b.key);
        return (
          <div key={b.key} style={st.card}>
            <div style={st.cardHead}>
              <span style={st.cardTitle}>{b.label}</span>
              {canManage && <button style={st.addBtn} onClick={() => setEditing({ bucket: b.key })}><Plus size={13} /> Add</button>}
            </div>
            {items.length === 0 ? <p style={st.muted}>No resources yet.</p> : (
              <div style={st.list}>
                {items.map((r) => (
                  <div key={r.id} style={st.row}>
                    <div style={{ flex: 1 }}>
                      <div style={st.rowTitle}>
                        {r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={st.link}>{r.title} <ExternalLink size={11} /></a> : r.title}
                        {r.resource_type && <span style={st.typeTag}>{r.resource_type}</span>}
                      </div>
                      {r.notes && <div style={st.notes}>{r.notes}</div>}
                    </div>
                    {canManage && <div style={st.rowBtns}>
                      <button style={st.iconBtn} title="Edit" onClick={() => setEditing(r)}><Pencil size={14} /></button>
                      <button style={{ ...st.iconBtn, color: "#c62828" }} title="Delete" onClick={() => remove(r)}><Trash2 size={14} /></button>
                    </div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={st.lbl}>{label}</label>{children}</div>;
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  muted: { color: "#888", fontSize: 14 },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  intro: { fontSize: 12.5, color: "#667", lineHeight: 1.6, marginBottom: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", marginBottom: 14 },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  cardTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase", letterSpacing: 0.5 },
  addBtn: { display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 },
  list: { display: "flex", flexDirection: "column", gap: 2 },
  row: { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid #f4f6fa" },
  rowTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#1a3a5c", fontWeight: 600 },
  link: { color: "#1565c0", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 },
  typeTag: { fontSize: 10, fontWeight: 700, color: "#667", background: "#f0f4f8", borderRadius: 8, padding: "1px 7px", textTransform: "uppercase" },
  notes: { fontSize: 12, color: "#778", marginTop: 2 },
  rowBtns: { display: "flex", gap: 4 },
  editor: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem", marginBottom: 14 },
  editorHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", marginBottom: 8 },
  lbl: { display: "block", fontSize: 12, fontWeight: 600, color: "#556", margin: "6px 0 3px" },
  in: { width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, boxSizing: "border-box" },
  ta: { width: "100%", minHeight: 48, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, resize: "vertical", boxSizing: "border-box" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 },
  primary: { padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  ghost: { padding: "8px 14px", background: "#fff", color: "#555", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#1565c0", padding: 4, display: "flex" },
};
