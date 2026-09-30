import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Eye, Save } from "lucide-react";
import { helpApi, type HelpArticle } from "./api";
import { renderMarkdown } from "./markdown";

type Draft = Partial<HelpArticle>;
const BLANK: Draft = { title: "", category: "General", summary: "", body: "", tags: "", roles: "", help_key: "", sort_order: 0, is_published: true };

export default function HelpAdmin() {
  const navigate = useNavigate();
  const [list, setList] = useState<HelpArticle[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => helpApi.adminList().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  function edit(a: HelpArticle) { helpApi.adminGet(a.id).then((full) => { setDraft(full); setPreview(false); }); }
  const set = (k: keyof Draft, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function save() {
    if (!draft?.title?.trim()) { setMsg("Title is required."); return; }
    const saved = draft.id ? await helpApi.update(draft.id, draft) : await helpApi.create(draft);
    setDraft(saved); await load(); setMsg("Saved."); setTimeout(() => setMsg(""), 2500);
  }
  async function del() {
    if (!draft?.id || !confirm(`Delete "${draft.title}"?`)) return;
    await helpApi.remove(draft.id); setDraft(null); load();
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <button style={s.back} onClick={() => navigate("/admin")}>← Admin</button>
      <div style={s.headRow}>
        <h1 style={s.h1}>Help Articles</h1>
        <button style={s.new} onClick={() => { setDraft({ ...BLANK }); setPreview(false); }}><Plus size={15} /> New article</button>
      </div>
      <p style={s.sub}>Write help in Markdown. Published articles appear in the in-app ? search for members (limited by role if set). Category groups them; help key ties one to a screen for contextual help.</p>

      <div style={s.cols}>
        {/* List */}
        <div style={s.listCol}>
          {list.length === 0 && <p style={s.muted}>No articles yet.</p>}
          {list.map((a) => (
            <button key={a.id} style={{ ...s.listItem, ...(draft?.id === a.id ? s.listItemActive : {}) }} onClick={() => edit(a)}>
              <div style={s.liTitle}>{a.title} {!a.is_published && <span style={s.draftTag}>draft</span>}</div>
              <div style={s.liCat}>{a.category}</div>
            </button>
          ))}
        </div>

        {/* Editor */}
        <div style={s.editCol}>
          {!draft ? <p style={s.muted}>Select an article, or create a new one.</p> : (
            <>
              <div style={s.two}>
                <label style={s.field}><span style={s.l}>Title</span>
                  <input style={s.in} value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} /></label>
                <label style={s.field}><span style={s.l}>Category</span>
                  <input style={s.in} value={draft.category ?? ""} onChange={(e) => set("category", e.target.value)} /></label>
              </div>
              <label style={s.field}><span style={s.l}>Summary (shown in search results)</span>
                <input style={s.in} value={draft.summary ?? ""} onChange={(e) => set("summary", e.target.value)} /></label>
              <div style={s.three}>
                <label style={s.field}><span style={s.l}>Tags (comma-sep)</span>
                  <input style={s.in} value={draft.tags ?? ""} onChange={(e) => set("tags", e.target.value)} /></label>
                <label style={s.field}><span style={s.l}>Roles (blank = everyone)</span>
                  <input style={s.in} placeholder="e.g. Mentor, Admin" value={draft.roles ?? ""} onChange={(e) => set("roles", e.target.value)} /></label>
                <label style={s.field}><span style={s.l}>Help key (screen)</span>
                  <input style={s.in} value={draft.help_key ?? ""} onChange={(e) => set("help_key", e.target.value)} /></label>
              </div>

              <div style={s.bodyHead}>
                <span style={s.l}>Body (Markdown)</span>
                <button style={s.previewBtn} onClick={() => setPreview((p) => !p)}><Eye size={13} /> {preview ? "Edit" : "Preview"}</button>
              </div>
              {preview
                ? <div style={s.preview} dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body ?? "") }} />
                : <textarea style={s.body} value={draft.body ?? ""} onChange={(e) => set("body", e.target.value)} placeholder="# Heading&#10;&#10;Write help here. **Bold**, _italic_, [links](https://…), lists, and `code` are supported." />}

              <div style={s.footRow}>
                <label style={s.pub}><input type="checkbox" checked={!!draft.is_published} onChange={(e) => set("is_published", e.target.checked)} /> Published</label>
                <label style={s.pub}>Sort <input style={s.sortIn} type="number" value={draft.sort_order ?? 0} onChange={(e) => set("sort_order", parseInt(e.target.value) || 0)} /></label>
                <div style={{ flex: 1 }} />
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
  listCol: { width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 },
  listItem: { textAlign: "left", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 11px", cursor: "pointer" },
  listItemActive: { borderColor: "#1565c0", boxShadow: "0 0 0 1px #1565c0" },
  liTitle: { fontSize: 13.5, fontWeight: 600, color: "#1a3a5c" },
  liCat: { fontSize: 11.5, color: "#889", marginTop: 2 },
  draftTag: { fontSize: 10, color: "#e65100", background: "#fff3e0", borderRadius: 8, padding: "1px 6px", fontWeight: 700 },
  editCol: { flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, minWidth: 0 },
  two: { display: "flex", gap: 10 },
  three: { display: "flex", gap: 10, flexWrap: "wrap" },
  field: { display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 140, marginBottom: 8 },
  l: { fontSize: 11.5, fontWeight: 700, color: "#556" },
  in: { padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13.5 },
  bodyHead: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 4px" },
  previewBtn: { display: "flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #cdd7e3", borderRadius: 6, padding: "5px 10px", fontSize: 12.5, cursor: "pointer", color: "#1a3a5c" },
  body: { width: "100%", minHeight: 280, padding: "10px 12px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 13.5, fontFamily: "ui-monospace, monospace", boxSizing: "border-box", resize: "vertical" },
  preview: { minHeight: 280, border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", fontSize: 14, lineHeight: 1.6, color: "#243", background: "#fbfdff" },
  footRow: { display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" },
  pub: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334" },
  sortIn: { width: 56, padding: "5px 7px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 13 },
  del: { display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "#fff", color: "#c62828", border: "1px solid #f0c5c5", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  save: { display: "flex", alignItems: "center", gap: 5, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 700 },
  saved: { color: "#2e7d32", fontSize: 13, fontWeight: 600 },
  muted: { color: "#889", fontSize: 13.5 },
};
