/**
 * LayoutManager (#101) — create/edit reusable email header & footer layouts.
 * A layout's header/footer HTML replaces the built-in TRCMS branding on emails
 * that select it; the layout marked "default" is applied when none is chosen.
 * Header/footer may use {{org_name}} / {{login_url}} style variables.
 */
import { useState, useEffect, useRef } from "react";
import { useGoBack } from "../../../core/useGoBack";
import { commsApi, type EmailLayout } from "../api";
import { ArrowLeft, Plus, Trash2, Star, Save, Layout as LayoutIcon, Image as ImageIcon } from "lucide-react";

const BLANK: Partial<EmailLayout> = { name: "", header_html: "", footer_html: "", is_default: false };
// Show authored line breaks as line breaks (HTML collapses raw newlines) so the
// preview matches the sent email (backend applies the same nl2br at send time).
const nl2br = (s?: string | null) => (s ?? "").replace(/\r?\n/g, "<br>");

export default function LayoutManager() {
  const goBack = useGoBack("/communications");
  const [layouts, setLayouts] = useState<EmailLayout[]>([]);
  const [editing, setEditing] = useState<Partial<EmailLayout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() { commsApi.listLayouts().then(setLayouts).catch(() => setLayouts([])); }
  useEffect(load, []);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  async function save() {
    if (!editing?.name?.trim()) { flash("Give the layout a name."); return; }
    setBusy(true);
    try {
      if (editing.id) await commsApi.updateLayout(editing.id, editing);
      else await commsApi.createLayout(editing);
      setEditing(null); load(); flash("Saved.");
    } finally { setBusy(false); }
  }
  async function remove(l: EmailLayout) {
    if (!confirm(`Delete the “${l.name}” layout?`)) return;
    await commsApi.deleteLayout(l.id); load(); flash("Deleted.");
  }
  async function makeDefault(l: EmailLayout) { await commsApi.updateLayout(l.id, { is_default: true }); load(); }

  const set = (k: keyof EmailLayout, v: unknown) => setEditing((e) => ({ ...e, [k]: v }));

  return (
    <div style={s.page}>
      <div style={s.head}>
        <button onClick={goBack} style={s.back}><ArrowLeft size={14} /> Communications</button>
        <h1 style={s.h1}><LayoutIcon size={20} /> Email Header &amp; Footer Layouts</h1>
        {!editing && <button style={s.addBtn} onClick={() => setEditing({ ...BLANK })}><Plus size={15} /> New layout</button>}
      </div>
      {msg && <div style={s.flash}>{msg}</div>}

      {editing ? (
        <div style={s.card}>
          <label style={s.field}><span style={s.label}>Name</span>
            <input style={s.input} value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. TRC Branded, Summer Camp" />
          </label>
          <HtmlField label="Header HTML" hint="(leave blank to use the default TRCMS header)"
            value={editing.header_html ?? ""} onChange={(v) => set("header_html", v)} onError={flash}
            placeholder='<div style="background:#1a3a5c;color:#fff;padding:20px">…</div>' />
          <HtmlField label="Footer HTML"
            value={editing.footer_html ?? ""} onChange={(v) => set("footer_html", v)} onError={flash}
            placeholder='<div style="padding:14px;font-size:11px;color:#888;text-align:center">{{org_name}} · 123 Main St</div>' />
          <label style={s.checkRow}>
            <input type="checkbox" checked={!!editing.is_default} onChange={(e) => set("is_default", e.target.checked)} />
            <span>Use as the default layout for all emails</span>
          </label>
          {(editing.header_html || editing.footer_html) && (
            <div style={s.previewWrap}>
              <div style={s.previewLabel}>Preview</div>
              <iframe title="layout preview" style={s.previewFrame} sandbox=""
                srcDoc={`<body style="font-family:Arial;max-width:600px;margin:0 auto">${nl2br(editing.header_html)}<div style="background:#f8fafc;padding:28px;border:1px solid #e2e8f0">Your message text appears here…</div>${nl2br(editing.footer_html)}</body>`} />
            </div>
          )}
          <div style={s.actions}>
            <button style={s.cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
            <button style={s.saveBtn} onClick={save} disabled={busy}><Save size={14} /> {busy ? "Saving…" : "Save layout"}</button>
          </div>
        </div>
      ) : layouts.length === 0 ? (
        <div style={s.empty}><LayoutIcon size={42} color="#cdd7e3" /><p style={s.muted}>No custom layouts yet. Emails use the built-in TRCMS header/footer until you add one.</p></div>
      ) : (
        <div style={s.list}>
          {layouts.map((l) => (
            <div key={l.id} style={s.row}>
              <div style={{ flex: 1 }}>
                <div style={s.name}>{l.name} {l.is_default && <span style={s.defaultBadge}><Star size={11} /> Default</span>}</div>
                <div style={s.sub}>{[l.header_html ? "header" : null, l.footer_html ? "footer" : null].filter(Boolean).join(" + ") || "empty"}</div>
              </div>
              {!l.is_default && <button style={s.iconBtn} title="Make default" onClick={() => makeDefault(l)}><Star size={15} /></button>}
              <button style={s.iconBtn} onClick={() => setEditing(l)}>Edit</button>
              <button style={s.delBtn} onClick={() => remove(l)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** HTML textarea with an "Add image" button + drag-and-drop that uploads the
 *  image and inserts an <img> tag (hosted URL) at the cursor (#101). */
function HtmlField({ label, hint, value, onChange, onError, placeholder }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; onError: (m: string) => void; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);

  function insert(snippet: string) {
    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + snippet + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => { if (ta) { const p = start + snippet.length; ta.focus(); ta.setSelectionRange(p, p); } });
  }

  async function handleFiles(files: FileList | null) {
    const imgs = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploading(true);
    try {
      for (const f of imgs) {
        const a = await commsApi.uploadAttachment(f, true);
        insert(`<img src="${a.url}" alt="" style="max-width:100%;height:auto" />`);
      }
    } catch { onError("Image upload failed (10 MB max)."); }
    finally { setUploading(false); }
  }

  return (
    <div style={s.field}>
      <div style={s.fieldHead}>
        <span style={s.label}>{label} {hint && <span style={s.hint}>{hint}</span>}</span>
        <label style={s.imgBtn}>
          <ImageIcon size={12} /> {uploading ? "Uploading…" : "Add image"}
          <input type="file" accept="image/*" multiple style={{ display: "none" }}
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <textarea ref={ref} style={s.code} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { if (e.dataTransfer.files?.length) { e.preventDefault(); handleFiles(e.dataTransfer.files); } }} />
      <span style={s.dropHint}>Tip: click <strong>Add image</strong> or drag an image file onto the box to drop in your own logo/graphic.</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: "0 auto" },
  head: { display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" },
  back: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  h1: { margin: 0, fontSize: 20, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, marginLeft: "auto" },
  flash: { background: "#e8f5e9", border: "1px solid #a5d6a7", color: "#2e7d32", borderRadius: 8, padding: "8px 14px", fontSize: 13, marginBottom: 12 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  imgBtn: { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", background: "#eef4fb", color: "#1a3a5c", border: "1px dashed #9cc0e6", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 11 },
  dropHint: { fontSize: 10, color: "#aaa" },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  hint: { fontWeight: 400, color: "#aaa" },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, width: "100%", boxSizing: "border-box" },
  code: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 12, fontFamily: "ui-monospace, monospace", minHeight: 80, resize: "vertical", width: "100%", boxSizing: "border-box" },
  checkRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155", cursor: "pointer" },
  previewWrap: { border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" },
  previewLabel: { fontSize: 11, fontWeight: 700, color: "#888", padding: "6px 10px", background: "#f8fafc", borderBottom: "1px solid #eef0f4" },
  previewFrame: { width: "100%", height: 240, border: "none", background: "#fff" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  cancelBtn: { padding: "9px 18px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  saveBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 20px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  empty: { textAlign: "center", padding: "3rem 1rem" },
  muted: { color: "#888", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 },
  name: { fontSize: 15, fontWeight: 600, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  defaultBadge: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "#b8860b", background: "#fdf6e3", borderRadius: 10, padding: "2px 8px" },
  sub: { fontSize: 12, color: "#888", marginTop: 2 },
  iconBtn: { padding: "6px 12px", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 5 },
  delBtn: { padding: "7px", border: "1px solid #f1d4d4", background: "#fff", color: "#c62828", borderRadius: 6, cursor: "pointer" },
};
