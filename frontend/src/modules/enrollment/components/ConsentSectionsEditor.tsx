/**
 * ConsentSectionsEditor — Admin editor for the consent/waiver catalog. Each
 * section has a title, body, response type (acknowledge or grant/decline),
 * required flag, and a set of audiences (Youth / Parent / Mentor / Volunteer)
 * that decide which signing screens show it. Stored in system_config; changes
 * take effect on the next signing. The per-person snapshot recorded at signing
 * preserves what each person actually saw, regardless of later edits here.
 */
import { useEffect, useState } from "react";
import { ClipboardCheck, CheckCircle, Trash2, Plus, ChevronUp, ChevronDown, Eye, X } from "lucide-react";
import { enrollmentApi, type ConsentSection, type ConsentAudience, type ConsentResponses, type HandbookLink } from "../api";
import ConsentSections from "./ConsentSections";

const AUDIENCES: { key: ConsentAudience; label: string }[] = [
  { key: "youth", label: "Youth" },
  { key: "parent", label: "Parent/Guardian" },
  { key: "mentor", label: "Mentor" },
  { key: "volunteer", label: "Volunteer" },
];

export default function ConsentSectionsEditor() {
  const [sections, setSections] = useState<ConsentSection[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ConsentAudience | null>(null);
  const [previewResp, setPreviewResp] = useState<ConsentResponses>({});
  const [handbook, setHandbook] = useState<HandbookLink | null>(null);

  useEffect(() => { enrollmentApi.getConsentSections().then(setSections).catch(() => setSections([])); }, []);
  useEffect(() => { enrollmentApi.getHandbook().then(setHandbook).catch(() => setHandbook(null)); }, []);

  function openPreview(a: ConsentAudience) { setPreviewResp({}); setPreview(a); }

  function update(i: number, patch: Partial<ConsentSection>) {
    setSections((s) => s!.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)));
  }
  function toggleAudience(i: number, a: ConsentAudience) {
    const sec = sections![i];
    const has = sec.audiences.includes(a);
    update(i, { audiences: has ? sec.audiences.filter((x) => x !== a) : [...sec.audiences, a] });
  }
  function move(i: number, dir: -1 | 1) {
    setSections((s) => {
      const arr = [...s!]; const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }
  function remove(i: number) {
    if (!window.confirm("Remove this consent section? Existing signed records are unaffected.")) return;
    setSections((s) => s!.filter((_, j) => j !== i));
  }
  function add() {
    const key = "section_" + Math.random().toString(36).slice(2, 7);
    setSections((s) => [...s!, { key, title: "New Consent Section", body: "", response_type: "acknowledge", required: true, audiences: [] }]);
  }

  async function save() {
    if (!sections) return;
    setSaving(true); setSaved(false);
    try {
      const updated = await enrollmentApi.setConsentSections(sections);
      setSections(updated); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  return (
    <div style={s.card}>
      <button style={s.head} onClick={() => setOpen((o) => !o)}>
        <ClipboardCheck size={16} /> Registration Waivers &amp; Consents
        <span style={s.hint}>{open ? "Hide" : "Edit sections, wording, and who sees each"}</span>
      </button>
      {open && (
        <div style={s.body}>
          {!sections ? <p style={s.muted}>Loading…</p> : (
            <>
              <p style={s.note}>
                Tick which audiences must see and agree to each section. Signing screens for youth, parents, mentors,
                and volunteers render only the sections assigned to them. The exact wording each person agrees to is
                recorded at signing.
              </p>
              {sections.map((sec, i) => (
                <div key={i} style={s.section}>
                  <div style={s.sectionTop}>
                    <input style={s.titleInput} value={sec.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Section title" />
                    <div style={s.iconBtns}>
                      <button style={s.iconBtn} title="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp size={15} /></button>
                      <button style={s.iconBtn} title="Move down" onClick={() => move(i, 1)} disabled={i === sections.length - 1}><ChevronDown size={15} /></button>
                      <button style={{ ...s.iconBtn, color: "#c62828" }} title="Remove" onClick={() => remove(i)}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <textarea style={s.textarea} value={sec.body} onChange={(e) => update(i, { body: e.target.value })} placeholder="Consent text shown to the signer" />
                  <div style={s.controls}>
                    <label style={s.ctrlLabel}>Response:
                      <select style={s.select} value={sec.response_type} onChange={(e) => update(i, { response_type: e.target.value as ConsentSection["response_type"] })}>
                        <option value="acknowledge">Acknowledge (checkbox)</option>
                        <option value="grant_decline">Consent / Decline (choice)</option>
                      </select>
                    </label>
                    <label style={s.ctrlLabel}>
                      <input type="checkbox" checked={sec.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
                    </label>
                    <div style={s.audiences}>
                      <span style={s.audLabel}>Shown to:</span>
                      {AUDIENCES.map((a) => (
                        <label key={a.key} style={{ ...s.audChip, ...(sec.audiences.includes(a.key) ? s.audOn : {}) }}>
                          <input type="checkbox" checked={sec.audiences.includes(a.key)} onChange={() => toggleAudience(i, a.key)} style={{ marginRight: 5 }} />
                          {a.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button style={s.addBtn} onClick={add}><Plus size={14} /> Add section</button>
                <button style={s.saveBtn} onClick={save} disabled={saving}>
                  {saved ? <><CheckCircle size={14} /> Saved</> : saving ? "Saving…" : "Save consent sections"}
                </button>
              </div>

              {/* Preview: render the signing screen as each audience would see it */}
              <div style={s.previewBar}>
                <span style={s.previewLabel}><Eye size={14} style={{ verticalAlign: -2 }} /> Preview the signing screen as:</span>
                {AUDIENCES.map((a) => (
                  <button key={a.key} style={s.previewBtn} onClick={() => openPreview(a.key)}>{a.label}</button>
                ))}
              </div>
              <p style={s.previewNote}>
                Preview uses your current edits above (even before saving) and never records anything.
              </p>
            </>
          )}
        </div>
      )}

      {preview && sections && (
        <PreviewModal
          audienceLabel={AUDIENCES.find((a) => a.key === preview)!.label}
          sections={sections.filter((sec) => sec.audiences.includes(preview))}
          responses={previewResp}
          onChange={(k, v) => setPreviewResp((r) => ({ ...r, [k]: v }))}
          handbook={handbook}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function PreviewModal({ audienceLabel, sections, responses, onChange, handbook, onClose }: {
  audienceLabel: string; sections: ConsentSection[];
  responses: ConsentResponses; onChange: (k: string, v: boolean | "grant" | "decline") => void;
  handbook: HandbookLink | null; onClose: () => void;
}) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <div>
            <div style={s.modalTitle}>Signing preview — {audienceLabel}</div>
            <div style={s.modalSub}>Exactly what a {audienceLabel.toLowerCase()} sees when signing. Preview only — nothing is saved.</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div style={s.modalBody}>
          {sections.length === 0 ? (
            <p style={s.empty}>No sections are assigned to the “{audienceLabel}” audience yet. Tick “{audienceLabel}” on a section above to include it here.</p>
          ) : (
            <>
              <ConsentSections sections={sections} responses={responses} onChange={onChange} handbook={handbook} />
              <div style={s.sigStub}>
                <div style={s.sigStubLabel}>Type your full legal name to sign electronically:</div>
                <div style={s.sigStubInput}>Full name</div>
              </div>
              <div style={s.previewActions}>
                <button style={s.previewDisabled} disabled>Sign (disabled in preview)</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 16 },
  head: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  hint: { marginLeft: "auto", fontSize: 12, fontWeight: 500, color: "#8894a5" },
  body: { padding: "0 16px 16px", borderTop: "1px solid #f0f4f8" },
  note: { fontSize: 12.5, color: "#667", lineHeight: 1.6, margin: "12px 0" },
  section: { border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fbfcfe" },
  sectionTop: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
  titleInput: { flex: 1, padding: "8px 10px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 14, fontWeight: 700, color: "#1a3a5c" },
  iconBtns: { display: "flex", gap: 4 },
  iconBtn: { width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #cdd7e3", background: "#fff", borderRadius: 6, cursor: "pointer", color: "#556" },
  textarea: { width: "100%", minHeight: 90, padding: "9px 11px", border: "1px solid #cdd7e3", borderRadius: 7, fontSize: 12.5, lineHeight: 1.5, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" },
  controls: { display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginTop: 10 },
  ctrlLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#455" },
  select: { padding: "5px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5 },
  audiences: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  audLabel: { fontSize: 12.5, fontWeight: 600, color: "#455" },
  audChip: { display: "flex", alignItems: "center", padding: "5px 10px", border: "1px solid #cdd7e3", borderRadius: 14, fontSize: 12.5, cursor: "pointer", color: "#556" },
  audOn: { borderColor: "#1565c0", background: "#eef4fb", color: "#1565c0", fontWeight: 700 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#1a3a5c", border: "1px solid #cdd7e3", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  saveBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 13 },
  muted: { color: "#889", fontSize: 13, padding: "12px 0" },
  previewBar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 18, paddingTop: 14, borderTop: "1px dashed #dbe3ec" },
  previewLabel: { fontSize: 13, fontWeight: 700, color: "#1a3a5c" },
  previewBtn: { padding: "7px 14px", background: "#eef4fb", color: "#1565c0", border: "1px solid #cdd7e3", borderRadius: 16, cursor: "pointer", fontWeight: 700, fontSize: 12.5 },
  previewNote: { fontSize: 11.5, color: "#8894a5", margin: "6px 0 0" },
  overlay: { position: "fixed", inset: 0, background: "rgba(20,30,45,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", zIndex: 1000, overflowY: "auto" },
  modal: { background: "#fff", borderRadius: 12, maxWidth: 640, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.3)" },
  modalHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid #eef2f6" },
  modalTitle: { fontSize: 16, fontWeight: 800, color: "#1a3a5c" },
  modalSub: { fontSize: 12, color: "#8894a5", marginTop: 2 },
  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#889", padding: 4, flexShrink: 0 },
  modalBody: { padding: 18 },
  empty: { fontSize: 13.5, color: "#778", lineHeight: 1.6 },
  sigStub: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "1rem 1.25rem", marginTop: 8 },
  sigStubLabel: { fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 8 },
  sigStubInput: { padding: "10px 12px", border: "2px solid #cdd7e3", borderRadius: 6, fontSize: 15, color: "#aab4c0", fontFamily: "cursive, serif", background: "#fff" },
  previewActions: { display: "flex", justifyContent: "flex-end", marginTop: 14 },
  previewDisabled: { padding: "10px 22px", background: "#cbd5e1", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: "not-allowed" },
};
