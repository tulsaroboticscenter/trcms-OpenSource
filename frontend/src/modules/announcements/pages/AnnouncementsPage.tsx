/**
 * AnnouncementsPage (#94) — in-app announcements feed. Everyone sees active
 * items; managers (announcements.manage) can post, edit, pin, set an expiry,
 * save drafts, and delete.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../../../core/AuthContext";
import { announcementsApi, type Announcement } from "../api";
import { Megaphone, Plus, Pin, Trash2, Edit2, Save } from "lucide-react";

const fmt = (d?: string | null) => d ? new Date(d.replace(" ", "T")).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

type Draft = Partial<Announcement>;
const BLANK: Draft = { title: "", body: "", pinned: false, expires_at: "" };

export default function AnnouncementsPage() {
  const { canWrite } = useAuth();
  const canManage = canWrite("announcements.manage");
  const [items, setItems] = useState<Announcement[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  function load() { announcementsApi.list(canManage && showAll).then(setItems).catch(() => setItems([])); }
  useEffect(load, [showAll, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!editing?.title?.trim()) return;
    setBusy(true);
    try {
      const payload: Draft = { title: editing.title, body: editing.body, pinned: editing.pinned, expires_at: editing.expires_at || null };
      if (editing.id) await announcementsApi.update(editing.id, payload);
      else await announcementsApi.create(payload);
      setEditing(null); load();
    } finally { setBusy(false); }
  }
  async function togglePin(a: Announcement) { await announcementsApi.update(a.id, { pinned: !a.pinned }); load(); }
  async function remove(a: Announcement) { if (confirm(`Delete “${a.title}”?`)) { await announcementsApi.remove(a.id); load(); } }

  const set = (k: keyof Draft, v: unknown) => setEditing((e) => ({ ...e, [k]: v }));
  const isExpired = (a: Announcement) => a.expires_at && new Date(a.expires_at.replace(" ", "T")) < new Date();
  const isDraft = (a: Announcement) => !a.published_at;

  return (
    <div style={st.page}>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}><Megaphone size={22} /> Announcements</h1>
          <p style={st.sub}>News and updates for the program.</p>
        </div>
        {canManage && !editing && <button style={st.addBtn} onClick={() => setEditing({ ...BLANK })}><Plus size={15} /> New announcement</button>}
      </div>

      {canManage && !editing && (
        <label style={st.showAll}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show drafts &amp; expired</label>
      )}

      {editing && canManage && (
        <div style={st.card}>
          <input style={st.titleInput} value={editing.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="Announcement title" autoFocus />
          <textarea style={st.bodyInput} value={editing.body ?? ""} onChange={(e) => set("body", e.target.value)} placeholder="Write the announcement…" />
          <div style={st.editRow}>
            <label style={st.chk}><input type="checkbox" checked={!!editing.pinned} onChange={(e) => set("pinned", e.target.checked)} /> Pin to top</label>
            <label style={st.dateLbl}>Expires <input type="datetime-local" style={st.dateInput} value={(editing.expires_at ?? "").replace(" ", "T").slice(0, 16)} onChange={(e) => set("expires_at", e.target.value ? e.target.value.replace("T", " ") + ":00" : "")} /></label>
            <div style={{ flex: 1 }} />
            <button style={st.cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
            <button style={st.saveBtn} disabled={busy || !editing.title?.trim()} onClick={save}><Save size={14} /> {editing.id ? "Save" : "Post"}</button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div style={st.empty}><Megaphone size={42} color="#cdd7e3" /><p style={st.muted}>No announcements right now.</p></div>
      ) : (
        <div style={st.list}>
          {items.map((a) => (
            <div key={a.id} style={{ ...st.item, ...(a.pinned ? st.pinnedItem : {}) }}>
              <div style={st.itemHead}>
                {a.pinned && <Pin size={14} color="#b8860b" style={{ transform: "rotate(45deg)" }} />}
                <span style={st.itemTitle}>{a.title}</span>
                {isDraft(a) && <span style={st.tagDraft}>Draft</span>}
                {isExpired(a) && <span style={st.tagExpired}>Expired</span>}
                <div style={{ flex: 1 }} />
                {canManage && (
                  <div style={st.actions}>
                    <button style={st.iconBtn} title={a.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(a)}><Pin size={13} /></button>
                    <button style={st.iconBtn} title="Edit" onClick={() => setEditing({ ...a })}><Edit2 size={13} /></button>
                    <button style={st.delBtn} title="Delete" onClick={() => remove(a)}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              {a.body && <div style={st.itemBody}>{a.body}</div>}
              <div style={st.itemMeta}>{[a.created_by_name, fmt(a.published_at || a.created_at)].filter(Boolean).join(" · ")}{a.expires_at && !isExpired(a) ? ` · until ${fmt(a.expires_at)}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: "0 auto" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 24, fontWeight: 800, color: "#1a3a5c", display: "flex", alignItems: "center", gap: 8 },
  sub: { color: "#666", fontSize: 14, marginTop: 4 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  showAll: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#778", marginBottom: 12, cursor: "pointer" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 },
  titleInput: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 16, fontWeight: 600, color: "#1a3a5c" },
  bodyInput: { padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 8, fontSize: 14, minHeight: 90, resize: "vertical" },
  editRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  chk: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#334155" },
  dateLbl: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#667" },
  dateInput: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 7, cursor: "pointer", fontSize: 13 },
  saveBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  empty: { textAlign: "center", padding: "3rem 1rem" },
  muted: { color: "#888", fontSize: 14 },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  item: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px" },
  pinnedItem: { borderColor: "#f0d9a8", background: "#fffdf6" },
  itemHead: { display: "flex", alignItems: "center", gap: 8 },
  itemTitle: { fontSize: 16, fontWeight: 700, color: "#1a3a5c" },
  tagDraft: { fontSize: 10, fontWeight: 700, color: "#6a1b9a", background: "#f3e5f5", borderRadius: 8, padding: "1px 7px" },
  tagExpired: { fontSize: 10, fontWeight: 700, color: "#757575", background: "#eee", borderRadius: 8, padding: "1px 7px" },
  actions: { display: "flex", gap: 4 },
  iconBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: 5, cursor: "pointer", color: "#667", display: "flex" },
  delBtn: { background: "none", border: "1px solid #f1d4d4", borderRadius: 6, padding: 5, cursor: "pointer", color: "#c62828", display: "flex" },
  itemBody: { fontSize: 14, color: "#445", lineHeight: 1.55, marginTop: 6, whiteSpace: "pre-wrap" },
  itemMeta: { fontSize: 11, color: "#9aa7b4", marginTop: 8 },
};
