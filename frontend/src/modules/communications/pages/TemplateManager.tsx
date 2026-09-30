import { useState, useEffect, useRef } from "react";
import { commsApi, type EmailTemplate, type EmailLinks, CATEGORY_LABELS } from "../api";
import RichTextEditor, { type RichTextEditorHandle } from "../components/RichTextEditor";
import DOMPurify from "dompurify";
import { ArrowLeft, PlusCircle, Edit2, Eye, Power, Trash2, Link2, GraduationCap, MessageCircle } from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";

const CATEGORIES = Object.entries(CATEGORY_LABELS);

// Program-wide links resolved on the server for every template.
const PROGRAM_LINKS = ["google_classroom_url", "discord_invite_url"];
const DEFAULT_VARIABLES: Record<string, string[]> = {
  visitor:    ["first_name", "last_name", "guardian1_name", "guardian1_email", "program_interest", "visitor_number", "signup_url", "org_name", ...PROGRAM_LINKS],
  member:     ["first_name", "last_name", "member_number", "guardian1_name", "guardian1_email", "email", "org_name", "login_url", ...PROGRAM_LINKS],
  volunteer:  ["first_name", "last_name", "email", "org_name", ...PROGRAM_LINKS],
  sponsor:    ["contact_name", "email", "org_name"],
  summer_camp:["first_name", "last_name", "guardian1_name", "guardian1_email", "org_name", ...PROGRAM_LINKS],
  general:    ["org_name", "login_url", ...PROGRAM_LINKS],
  past_due:   ["center_name", "family_name", "members", "total_due", "pay_link"],
};

export default function TemplateManager() {
  const goBack = useGoBack("/communications");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [editing, setEditing] = useState<Partial<EmailTemplate> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [links, setLinks] = useState<EmailLinks | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [linkMsg, setLinkMsg] = useState("");

  useEffect(() => { load(); commsApi.getEmailLinks().then(setLinks).catch(() => setLinks(null)); }, []);

  async function saveDiscord(resourceId: number | null) {
    setSavingLink(true); setLinkMsg("");
    try {
      const l = await commsApi.setEmailLinks(resourceId);
      setLinks(l);
      setLinkMsg(resourceId ? "Discord invite linked." : "Discord invite cleared.");
    } catch (e: unknown) {
      setLinkMsg((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not save.");
    } finally {
      setSavingLink(false);
    }
  }

  async function load() {
    setLoading(true);
    // includeInactive: managers see deactivated templates here so they can reactivate or delete them.
    commsApi.listTemplates(undefined, true).then(setTemplates).finally(() => setLoading(false));
  }

  function startNew() {
    setEditing({ name: "", category: "visitor", subject_template: "", body_html_template: "<p></p>", reply_enabled: false, available_variables: DEFAULT_VARIABLES.visitor });
    setIsNew(true);
    setError("");
  }

  function startEdit(t: EmailTemplate) {
    setEditing({ ...t });
    setIsNew(false);
    setError("");
  }

  async function save() {
    if (!editing?.name?.trim() || !editing.subject_template?.trim()) {
      setError("Name and subject are required.");
      return;
    }
    setSaving(true); setError("");
    try {
      if (isNew) {
        await commsApi.createTemplate(editing);
      } else if (editing.id) {
        await commsApi.updateTemplate(editing.id, editing);
      }
      setEditing(null);
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to save.");
    } finally { setSaving(false); }
  }

  async function toggleActive(t: EmailTemplate) {
    if (t.is_active && !confirm(`Deactivate “${t.name}”?\n\nIt stays here but is hidden from the template list when composing an email. You can reactivate it any time.`)) return;
    await commsApi.updateTemplate(t.id, { is_active: !t.is_active });
    load();
  }

  async function remove(t: EmailTemplate) {
    if (!confirm(`Permanently delete “${t.name}”?\n\nThis can’t be undone. (To just hide it from the composer instead, use Deactivate.)`)) return;
    await commsApi.deleteTemplate(t.id);
    load();
  }

  const filtered = filterCategory ? templates.filter(t => t.category === filterCategory) : templates;
  const grouped: Record<string, EmailTemplate[]> = {};
  for (const t of filtered) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Communications</button>
        <div style={styles.headingRow}>
          <h1 style={styles.heading}>Email Templates</h1>
          <button style={styles.addBtn} onClick={startNew} disabled={!!editing}><PlusCircle size={13} /> New Template</button>
        </div>
        <p style={styles.sub}>Reusable email templates with <code>{"{{variable}}"}</code> placeholders. Variables are substituted with real data when sending.</p>
      </div>

      {/* Program links — drop these into any template body/subject and they fill in
          automatically from where they're already maintained. */}
      {links && (
        <div style={styles.linksCard}>
          <div style={styles.linksHeader}><Link2 size={14} /> Program links you can drop into any template</div>
          <div style={styles.linksGrid}>
            <div style={styles.linkItem}>
              <div style={styles.linkTitle}><GraduationCap size={14} /> Google Classroom</div>
              <code style={styles.linkToken}>{"{{google_classroom_url}}"}</code>
              {links.google_classroom_url
                ? <div style={styles.linkVal} title={links.google_classroom_url}>{links.google_classroom_url}</div>
                : <div style={styles.linkUnset}>Not set — add it in Certifications → Settings.</div>}
              <div style={styles.linkNote}>Pulled from the Certifications module.</div>
            </div>

            <div style={styles.linkItem}>
              <div style={styles.linkTitle}><MessageCircle size={14} /> Discord invite</div>
              <code style={styles.linkToken}>{"{{discord_invite_url}}"}</code>
              {links.can_manage ? (
                <select
                  style={styles.linkSelect}
                  value={links.discord_resource_id ?? ""}
                  disabled={savingLink}
                  onChange={e => saveDiscord(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— Pick a resource —</option>
                  {links.resource_options.map(o => (
                    <option key={o.id} value={o.id}>{o.name}{o.type ? ` (${o.type})` : ""}</option>
                  ))}
                </select>
              ) : links.discord_invite_url
                ? <div style={styles.linkVal} title={links.discord_invite_url}>{links.discord_invite_url}</div>
                : <div style={styles.linkUnset}>Not set yet.</div>}
              {links.can_manage && links.discord_invite_url && (
                <div style={styles.linkVal} title={links.discord_invite_url}>{links.discord_invite_url}</div>
              )}
              <div style={styles.linkNote}>Points at a resource in TRC Resources — change it there and this follows.</div>
            </div>
          </div>
          {linkMsg && <div style={styles.linkMsg}>{linkMsg}</div>}
        </div>
      )}

      {/* Edit / New form */}
      {editing && (
        <div style={styles.editCard}>
          <h3 style={styles.editTitle}>{isNew ? "New Template" : `Edit: ${editing.name}`}</h3>
          <div style={styles.grid2}>
            <div>
              <label style={styles.label}>Template Name *</label>
              <input style={styles.input} value={editing.name ?? ""} onChange={e => setEditing(p => ({ ...p!, name: e.target.value }))} placeholder="e.g. Welcome — Visitor" />
            </div>
            <div>
              <label style={styles.label}>Category *</label>
              <select style={styles.input} value={editing.category ?? "general"}
                onChange={e => {
                  const cat = e.target.value;
                  setEditing(p => ({ ...p!, category: cat, available_variables: DEFAULT_VARIABLES[cat] ?? [] }));
                }}>
                {CATEGORIES.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={styles.label}>Subject *</label>
            <input style={styles.input} value={editing.subject_template ?? ""} onChange={e => setEditing(p => ({ ...p!, subject_template: e.target.value }))} placeholder="e.g. Welcome to {{org_name}}!" />
          </div>
          {/* Variable insertion — two clearly-labelled rows */}
          <div style={styles.variableHintsBox}>
            <div style={styles.varRow}>
              <span style={styles.varRowLabel}>→ Subject:</span>
              <div style={styles.varChips}>
                {(DEFAULT_VARIABLES[editing.category ?? ""] ?? editing.available_variables ?? []).map(v => (
                  <code
                    key={`subj-${v}`}
                    style={styles.varChip}
                    title="Click to insert into Subject"
                    onClick={() => setEditing(p => ({
                      ...p!,
                      subject_template: (p!.subject_template ?? "") + `{{${v}}}`,
                    }))}
                  >{`{{${v}}}`}</code>
                ))}
              </div>
            </div>
            <div style={styles.varRow}>
              <span style={{ ...styles.varRowLabel, color: "#2e7d32" }}>→ Body:</span>
              <div style={styles.varChips}>
                {(DEFAULT_VARIABLES[editing.category ?? ""] ?? editing.available_variables ?? []).map(v => (
                  <code
                    key={`body-${v}`}
                    style={{ ...styles.varChip, background: "#2e7d32" }}
                    title="Click to insert into Body at cursor position"
                    onClick={() => editorRef.current?.insertText(`{{${v}}}`)}
                  >{`{{${v}}}`}</code>
                ))}
              </div>
            </div>
            <p style={styles.varHint}>
              Click a <span style={{ color: "#1a3a5c", fontWeight: 700 }}>blue</span> chip to add a variable to the <strong>subject line</strong>.
              Click a <span style={{ color: "#2e7d32", fontWeight: 700 }}>green</span> chip to insert at your <strong>cursor position in the body</strong>.
            </p>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={styles.label}>Body</label>
            <RichTextEditor
              ref={editorRef}
              value={editing.body_html_template ?? "<p></p>"}
              onChange={html => setEditing(p => ({ ...p!, body_html_template: html }))}
              placeholder="Write your template here. Click green variable chips above to insert {{variables}}."
              minHeight={220}
            />
          </div>
          <label style={styles.checkRow}>
            <input type="checkbox" checked={editing.reply_enabled ?? false}
              onChange={e => setEditing(p => ({ ...p!, reply_enabled: e.target.checked }))} />
            <span>Allow replies — messages sent with this template include a Reply-To address</span>
          </label>
          {error && <p style={styles.error}>{error}</p>}
          <div style={styles.editActions}>
            <button onClick={() => setEditing(null)} style={styles.cancelBtn}>Cancel</button>
            <button onClick={save} style={styles.saveBtn} disabled={saving}>{saving ? "Saving…" : "Save Template"}</button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={styles.filterRow}>
        <select style={styles.filterSelect} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>

      {loading ? <p style={styles.muted}>Loading…</p> : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category} style={styles.categoryGroup}>
            <div style={styles.categoryLabel}>{CATEGORY_LABELS[category] ?? category}</div>
            {items.map(t => (
              <div key={t.id} style={{ ...styles.templateRow, opacity: t.is_active ? 1 : 0.5 }}>
                <div style={styles.templateInfo}>
                  <div style={styles.templateName}>{t.name}</div>
                  <div style={styles.templateSubject}>{t.subject_template}</div>
                  <div style={styles.templateMeta}>
                    {t.reply_enabled && <span style={styles.replyTag}>replies on</span>}
                    {!t.is_active && <span style={styles.inactiveTag}>inactive</span>}
                  </div>
                </div>
                <div style={styles.templateActions}>
                  <button style={styles.iconBtn} onClick={() => setPreviewId(previewId === t.id ? null : t.id)} title="Preview">
                    <Eye size={13} />
                  </button>
                  <button style={styles.iconBtn} onClick={() => startEdit(t)} disabled={!!editing} title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button style={{ ...styles.textBtn, ...(t.is_active ? {} : styles.activateBtn) }} onClick={() => toggleActive(t)}
                    title={t.is_active ? "Hide from the composer (reversible)" : "Make available in the composer again"}>
                    <Power size={12} /> {t.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button style={styles.delBtn} onClick={() => remove(t)} title="Permanently delete this template">
                    <Trash2 size={13} />
                  </button>
                </div>
                {/* Inline preview */}
                {previewId === t.id && (
                  <div style={styles.inlinePreview}>
                    <div style={styles.previewSubj}><strong>Subject:</strong> {t.subject_template}</div>
                    <div style={styles.previewBody} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.body_html_template, { ADD_ATTR: ["target", "rel"] }) }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ))
      )}
      {!loading && filtered.length === 0 && (
        <div style={styles.empty}>
          No templates found.{" "}
          <button style={styles.linkBtn} onClick={startNew}>Create the first one.</button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: "0 auto" },
  header: { marginBottom: 20 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 4 },
  headingRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#888", lineHeight: 1.6 },
  linksCard: { background: "#f7fafc", border: "1px solid #dbe4ee", borderRadius: 10, padding: "14px 16px", marginBottom: 20 },
  linksHeader: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: "#1a3a5c", marginBottom: 10 },
  linksGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 },
  linkItem: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" },
  linkTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#33475b", marginBottom: 6 },
  linkToken: { display: "inline-block", fontSize: 12, background: "#eef2f7", color: "#1a3a5c", borderRadius: 4, padding: "2px 7px", fontFamily: "monospace" },
  linkVal: { fontSize: 11.5, color: "#5a6b7d", marginTop: 6, wordBreak: "break-all", lineHeight: 1.4 },
  linkUnset: { fontSize: 11.5, color: "#b06a00", marginTop: 6, lineHeight: 1.4 },
  linkNote: { fontSize: 11, color: "#9aa7b4", marginTop: 6, lineHeight: 1.4 },
  linkSelect: { width: "100%", marginTop: 7, padding: "6px 8px", border: "1px solid #cdd7e3", borderRadius: 6, fontSize: 12.5, boxSizing: "border-box", background: "#fff" },
  linkMsg: { marginTop: 10, fontSize: 12, color: "#2e7d32" },
  editCard: { background: "#fff", border: "2px solid #1a3a5c", borderRadius: 10, padding: "1.5rem", marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 },
  editTitle: { margin: 0, fontSize: 15, fontWeight: 700, color: "#1a3a5c" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 3 },
  input: { width: "100%", padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const },
  variableHintsBox: { background: "#f0f4f8", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 },
  varRow: { display: "flex", alignItems: "flex-start", gap: 8 },
  varRowLabel: { fontSize: 11, fontWeight: 700, color: "#1a3a5c", minWidth: 60, paddingTop: 2, whiteSpace: "nowrap" as const },
  varChips: { display: "flex", flexWrap: "wrap", gap: 4 },
  varChip: { fontSize: 11, background: "#1a3a5c", color: "#fff", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", userSelect: "none" as const },
  varHint: { fontSize: 11, color: "#888", margin: 0, lineHeight: 1.5 },
  checkRow: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 },
  error: { fontSize: 12, color: "#c62828" },
  editActions: { display: "flex", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { padding: "8px 16px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  saveBtn: { padding: "8px 20px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 13 },
  filterRow: { marginBottom: 14 },
  filterSelect: { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 },
  muted: { color: "#888", fontSize: 13 },
  categoryGroup: { marginBottom: 20 },
  categoryLabel: { fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid #e2e8f0" },
  templateRow: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, marginBottom: 6, overflow: "hidden" },
  templateInfo: { padding: "10px 14px", display: "flex", flexDirection: "column", gap: 3, flex: 1 },
  templateName: { fontWeight: 700, fontSize: 14, color: "#1a3a5c" },
  templateSubject: { fontSize: 12, color: "#666" },
  templateMeta: { display: "flex", gap: 6 },
  replyTag: { fontSize: 10, padding: "1px 6px", background: "#e8f5e9", color: "#2e7d32", borderRadius: 6 },
  inactiveTag: { fontSize: 10, padding: "1px 6px", background: "#f5f5f5", color: "#aaa", borderRadius: 6 },
  templateActions: { display: "flex", gap: 4, padding: "8px 14px", alignItems: "center" },
  iconBtn: { background: "none", border: "1px solid #e2e8f0", borderRadius: 4, cursor: "pointer", padding: "4px 8px", fontSize: 13, color: "#555" },
  textBtn: { display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "1px solid #e2e8f0", borderRadius: 4, cursor: "pointer", padding: "4px 9px", fontSize: 12, fontWeight: 600, color: "#667" },
  activateBtn: { color: "#2e7d32", borderColor: "#a5d6a7", background: "#f1f8f2" },
  delBtn: { display: "inline-flex", alignItems: "center", background: "none", border: "1px solid #f1d4d4", borderRadius: 4, cursor: "pointer", padding: "4px 8px", color: "#c62828" },
  inlinePreview: { padding: "12px 14px", borderTop: "1px solid #f0f4f8", background: "#f8fafc" },
  previewSubj: { fontSize: 12, marginBottom: 8, color: "#555" },
  previewBody: { fontSize: 12, lineHeight: 1.6, color: "#444" },
  empty: { textAlign: "center", color: "#888", padding: "2rem", fontSize: 14 },
  linkBtn: { background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 14, padding: 0, textDecoration: "underline" },
};
