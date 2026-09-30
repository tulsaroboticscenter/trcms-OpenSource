/**
 * HandbookEditor — Admin editor for the TRC Handbook link. The URL + title are
 * stored in system_config (category 'handbook') and drive the Handbook card in
 * TRC Resources plus the acknowledgment on every T&C signing screen. Blank until
 * an admin sets it; update it here each season if the link changes.
 */
import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle, Upload, ExternalLink } from "lucide-react";
import { enrollmentApi, type HandbookLink } from "../api";

export default function HandbookEditor() {
  const [data, setData] = useState<HandbookLink>({ url: "", title: "TRC Handbook" });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    enrollmentApi.getHandbook().then((d) => { setData(d); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true); setSaved(false); setError("");
    try {
      const updated = await enrollmentApi.setHandbook({ url: data.url.trim(), title: data.title.trim() || "TRC Handbook" });
      setData(updated); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save the Handbook link.");
    } finally { setSaving(false); }
  }

  async function upload(file: File) {
    setUploading(true); setSaved(false); setError("");
    try {
      const updated = await enrollmentApi.uploadHandbook(file, data.title.trim());
      setData(updated); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not upload the file.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const isUploaded = data.url.startsWith("/uploads/");

  return (
    <div style={s.card}>
      <button style={s.head} onClick={() => setOpen((o) => !o)}>
        <BookOpen size={16} /> TRC Handbook Link
        <span style={s.hint}>{open ? "Hide" : "Set the Handbook members see & acknowledge"}</span>
      </button>
      {open && (
        <div style={s.body}>
          {!loaded ? <p style={s.muted}>Loading…</p> : (
            <>
              <div style={s.field}>
                <label style={s.label}>Handbook title</label>
                <input style={s.input} value={data.title} placeholder="TRC Handbook"
                  onChange={(e) => setData({ ...data, title: e.target.value })} />
              </div>
              {/* Upload a file — TRCMS hosts it and fills in the link */}
              <div style={s.field}>
                <label style={s.label}>Upload the Handbook file</label>
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" style={s.uploadBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload size={14} /> {uploading ? "Uploading…" : "Choose PDF or Word file…"}
                  </button>
                  {isUploaded && data.url && (
                    <a href={data.url} target="_blank" rel="noopener noreferrer" style={s.currentLink}>
                      Current file <ExternalLink size={12} style={{ verticalAlign: -1 }} />
                    </a>
                  )}
                </div>
                <p style={s.note}>PDF or Word (.pdf, .doc, .docx), up to 25&nbsp;MB. Re-upload any time to replace it.</p>
              </div>

              <div style={s.field}>
                <label style={s.label}>…or paste a link (URL)</label>
                <input style={s.input} value={data.url} placeholder="https://…"
                  onChange={(e) => setData({ ...data, url: e.target.value })} />
                <p style={s.note}>
                  Use this instead if the Handbook lives elsewhere (e.g. a Google Drive link). The link appears in TRC
                  Resources and on the T&amp;C signing screens for mentors, youth, and parents.
                </p>
              </div>
              {error && <div style={s.error}>{error}</div>}
              <button style={s.saveBtn} onClick={save} disabled={saving}>
                {saved ? <><CheckCircle size={14} /> Saved</> : saving ? "Saving…" : "Save Handbook link"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  hint: { marginLeft: "auto", fontSize: 12, fontWeight: 500, color: "#8894a5" },
  body: { padding: "0 16px 16px", borderTop: "1px solid #f0f4f8" },
  field: { marginTop: 12 },
  label: { display: "block", fontSize: 12.5, fontWeight: 700, color: "#455", marginBottom: 5 },
  input: { width: "100%", padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" },
  note: { fontSize: 12, color: "#8894a5", marginTop: 6, lineHeight: 1.5 },
  error: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "8px 12px", color: "#c62828", marginTop: 12, fontSize: 12.5 },
  saveBtn: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  uploadBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  currentLink: { fontSize: 12.5, color: "#1565c0", fontWeight: 600, textDecoration: "none" },
  muted: { color: "#889", fontSize: 13, padding: "12px 0" },
};
