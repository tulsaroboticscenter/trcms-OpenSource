/**
 * SocialLinksManager — admin management of the TRC social-media links (#59).
 * Each entry is platform + label + URL; shown on the dashboard and member profiles.
 */
import { useState, useEffect } from "react";
import { socialApi, type SocialLink } from "../api";
import { ArrowLeft, PlusCircle, Edit2, Trash2, Check, X, Share2 } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const PLATFORMS = ["Instagram", "Facebook", "YouTube", "X", "TikTok"];

export default function SocialLinksManager() {
  const goBack = useGoBack("/admin");
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { load(); }, []);
  function load() { socialApi.list().then(setLinks).catch(() => {}).finally(() => setLoading(false)); }

  function startAdd() { setAdding(true); setEditIndex(null); setPlatform(""); setLabel(""); setUrl(""); setError(""); }
  function startEdit(i: number) {
    setEditIndex(i); setAdding(false);
    setPlatform(links[i].platform ?? ""); setLabel(links[i].label ?? ""); setUrl(links[i].url ?? ""); setError("");
  }
  function cancel() { setAdding(false); setEditIndex(null); setError(""); }

  async function save() {
    if (!platform.trim() || !url.trim()) { setError("Platform and URL are required."); return; }
    setSaving(true); setError("");
    const entry = { platform: platform.trim(), label: label.trim(), url: url.trim() };
    try {
      const updated = adding ? await socialApi.add(entry) : await socialApi.update(editIndex!, entry);
      setLinks(updated); cancel();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to save.");
    } finally { setSaving(false); }
  }

  async function remove(i: number) {
    if (!confirm(`Remove this link?\n\n${links[i].platform}${links[i].label ? " — " + links[i].label : ""}`)) return;
    try { setLinks(await socialApi.remove(i)); } catch { alert("Failed to remove. Please try again."); }
  }

  const editing = adding || editIndex !== null;

  return (
    <div style={st.page}>
      <div style={st.header}>
        <button onClick={goBack} style={st.backBtn}><ArrowLeft size={14} /> Admin Console</button>
        <h1 style={st.heading}><Share2 size={20} style={{ verticalAlign: -4 }} /> TRC Social Media Links</h1>
        <p style={st.sub}>These appear on the dashboard and on member profiles so people can find TRC's content.</p>
      </div>

      {loading ? <p style={st.muted}>Loading…</p> : (
        <div style={st.card}>
          {links.length === 0 && !adding && <p style={st.muted}>No links yet. Click "Add Link" to create one.</p>}
          {links.map((l, i) => editIndex === i ? (
            <EditRow key={i} {...{ platform, setPlatform, label, setLabel, url, setUrl, save, cancel, saving, error }} />
          ) : (
            <div key={i} style={st.row}>
              <div style={{ flex: 1 }}>
                <span style={st.platform}>{l.platform}</span>
                {l.label && <span style={st.label}>{l.label}</span>}
                <div style={st.url}>{l.url}</div>
              </div>
              <button style={st.iconBtn} onClick={() => startEdit(i)} title="Edit"><Edit2 size={15} /></button>
              <button style={{ ...st.iconBtn, color: "#c62828" }} onClick={() => remove(i)} title="Remove"><Trash2 size={15} /></button>
            </div>
          ))}
          {adding && <EditRow {...{ platform, setPlatform, label, setLabel, url, setUrl, save, cancel, saving, error }} />}
          {!editing && <button style={st.addBtn} onClick={startAdd}><PlusCircle size={15} /> Add Link</button>}
        </div>
      )}
    </div>
  );
}

// Defined at module scope (not inside SocialLinksManager) so its component
// identity is stable across re-renders — otherwise every keystroke remounts
// these inputs and the field loses focus after each character (#73).
function EditRow(p: {
  platform: string; setPlatform: (v: string) => void; label: string; setLabel: (v: string) => void;
  url: string; setUrl: (v: string) => void; save: () => void; cancel: () => void; saving: boolean; error: string;
}) {
    return (
      <div style={st.editRow}>
        <div style={st.editFields}>
          <input style={st.input} list="social-platforms" placeholder="Platform (e.g. Instagram)" value={p.platform} onChange={(e) => p.setPlatform(e.target.value)} />
          <datalist id="social-platforms">{PLATFORMS.map((x) => <option key={x} value={x} />)}</datalist>
          <input style={st.input} placeholder="Label (e.g. TRC, or Carl's page)" value={p.label} onChange={(e) => p.setLabel(e.target.value)} />
          <input style={{ ...st.input, flex: 2 }} placeholder="https://…" value={p.url} onChange={(e) => p.setUrl(e.target.value)} />
          <button style={st.saveBtn} disabled={p.saving} onClick={p.save}><Check size={15} /></button>
          <button style={st.cancelBtn} onClick={p.cancel}><X size={15} /></button>
        </div>
        {p.error && <div style={st.error}>{p.error}</div>}
      </div>
    );
}

const st: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto" },
  header: { marginBottom: 16 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  sub: { margin: "4px 0 0", fontSize: 13, color: "#666" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem 1.25rem" },
  muted: { color: "#888", fontSize: 13 },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f0f4f8" },
  platform: { fontWeight: 700, color: "#1a3a5c", fontSize: 14, marginRight: 8 },
  label: { fontSize: 13, color: "#666" },
  url: { fontSize: 12, color: "#1565c0", wordBreak: "break-all" as const },
  iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#1565c0", padding: 4 },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#eef2f7", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 10 },
  editRow: { padding: "8px 0", borderBottom: "1px solid #f0f4f8" },
  editFields: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const },
  input: { flex: 1, minWidth: 120, padding: "7px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  saveBtn: { background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", padding: "7px 10px", display: "flex" },
  cancelBtn: { background: "#fff", color: "#555", border: "1px solid #ccc", borderRadius: 6, cursor: "pointer", padding: "7px 10px", display: "flex" },
  error: { color: "#c62828", fontSize: 12, marginTop: 6 },
};
