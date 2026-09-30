/**
 * ComposePage — standalone email compose at /communications/compose
 *
 * Two-column layout:
 *   Left  — recipient search & selection
 *   Right — template picker, subject, rich text body, options, send
 *
 * Supports members, visitors, and volunteers.
 * Template variables are substituted with real recipient data on preview/send.
 */
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../../core/api";
import {
  commsApi, type EmailTemplate, type EmailLayout, type EmailAttachment, type SendResult, CATEGORY_LABELS,
} from "../api";
import RichTextEditor, { type RichTextEditorHandle } from "../components/RichTextEditor";
import BulkRecipientBuilder from "../components/BulkRecipientBuilder";
import type { ResolvedRecipient, BulkSendResult } from "../api";
import {
  ArrowLeft, Search, Mail, Send, Eye, CheckCircle, AlertTriangle,
  ExternalLink, Copy, X, Users, UserCheck, User, UsersRound, CalendarPlus,
  Paperclip, Image as ImageIcon,
} from "lucide-react";
import { useGoBack } from "../../../core/useGoBack";
import { eventCardHtml, eventWhen, type EmbeddedEvent } from "../eventEmbed";

type RecipientType = "member" | "visitor" | "volunteer";

interface RecipientOption {
  id: number;
  name: string;
  email?: string;
  sub?: string;   // extra info line
  type: RecipientType;
}

const TYPE_OPTIONS: { value: RecipientType; label: string; icon: React.ReactNode }[] = [
  { value: "member",   label: "Members",   icon: <Users size={14} /> },
  { value: "visitor",  label: "Visitors",  icon: <UserCheck size={14} /> },
  { value: "volunteer",label: "Volunteers",icon: <User size={14} /> },
];

type Stage = "compose" | "preview" | "result";

/**
 * Variables offered for the BODY only, never the subject.
 *
 * {{signup_url}} is a per-visitor join link. The server already fills it for any
 * visitor recipient, but the chip list is keyed off the single-recipient type picker
 * and a group send is typed as "member" — so without this it never appears, even
 * though a group send is exactly where you'd use it (a follow-up to everyone who
 * visited on a given night).
 */
const BODY_ONLY_VARIABLES = ["signup_url"];
const BODY_ONLY_HINTS: Record<string, string> = {
  signup_url: "Insert at cursor — each visitor gets their own join link. Body only.",
};

export default function ComposePage() {
  const navigate = useNavigate();
  const goBack = useGoBack("/communications");
  const [params] = useSearchParams();

  // Recipient state
  const [mode, setMode] = useState<"single" | "group">("single");
  const [recipientType, setRecipientType] = useState<RecipientType>("member");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RecipientOption[]>([]);
  const [recipient, setRecipient] = useState<RecipientOption | null>(null);
  const [bulkRecipients, setBulkRecipients] = useState<ResolvedRecipient[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkSendResult | null>(null);

  // Compose state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [cc, setCc] = useState("");   // #172: CC / send-a-copy addresses (comma-separated)
  const [selectedTemplate, setSelectedTemplate] = useState<number | "">("");
  const [layouts, setLayouts] = useState<EmailLayout[]>([]);
  const [layoutId, setLayoutId] = useState<number | "">("");
  const [includeUnsub, setIncludeUnsub] = useState(false);
  const [category, setCategory] = useState("");   // optional comm category for preference-aware sends
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function onAttachFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const a = await commsApi.uploadAttachment(file, false);
        setAttachments((xs) => [...xs, a]);
      }
    } catch { setError("Upload failed (file may be too large — 10 MB max)."); }
    finally { setUploading(false); }
  }
  async function removeAttachment(id: number) {
    await commsApi.deleteAttachment(id).catch(() => {});
    setAttachments((xs) => xs.filter((a) => a.id !== id));
  }
  async function onInsertImage(files: FileList | null) {
    if (!files?.[0]) return;
    setUploading(true);
    try {
      const a = await commsApi.uploadAttachment(files[0], true);
      editorRef.current?.insertImage(a.url, a.filename);
    } catch { setError("Image upload failed (10 MB max)."); }
    finally { setUploading(false); }
  }
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("<p></p>");
  const [replyEnabled, setReplyEnabled] = useState(true); // reply-enabled by default
  const [variables, setVariables] = useState<string[]>([]);
  const editorRef = useRef<RichTextEditorHandle>(null);
  // Group sends can address visitors, so offer the join link there. Filtered against
  // `variables` so it never doubles up when the server already advertises it.
  const bodyOnlyVariables = mode === "group"
    ? BODY_ONLY_VARIABLES.filter(v => !variables.includes(v))
    : [];

  // #96 — optional embedded event with RSVP buttons
  const [embeddedEvents, setEmbeddedEvents] = useState<EmbeddedEvent[]>([]);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<EmbeddedEvent[]>([]);

  // Body actually sent = editor content + a card for each embedded event.
  function finalBody(): string {
    return bodyHtml + embeddedEvents.map((ev) => eventCardHtml(ev, `${window.location.origin}/events/${ev.id}`)).join("");
  }
  function addEvent(ev: EmbeddedEvent) {
    setEmbeddedEvents((xs) => xs.some((e) => e.id === ev.id) ? xs : [...xs, ev]);
    setEventPickerOpen(false);
  }
  function removeEvent(id: number) { setEmbeddedEvents((xs) => xs.filter((e) => e.id !== id)); }
  function openEventPicker() {
    setEventPickerOpen(true);
    if (upcomingEvents.length === 0) {
      api.get("/api/v1/events/upcoming?days=120").then((r) => setUpcomingEvents(r.data)).catch(() => {});
    }
  }

  // Flow state
  const [stage, setStage] = useState<Stage>("compose");
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Drafts (#132)
  const [draftId, setDraftId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<{ id: number; subject: string; updated_at: string }[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");

  function draftPayload(): Record<string, unknown> {
    return { mode, recipientType, recipient, bulkRecipients, subject, bodyHtml, selectedTemplate, layoutId, includeUnsub, replyEnabled, embeddedEvents };
  }
  async function saveDraft() {
    try {
      const r = await commsApi.saveDraft(subject, draftPayload(), draftId ?? undefined);
      setDraftId(r.id); setDraftMsg("Draft saved"); setTimeout(() => setDraftMsg(""), 2500);
    } catch { setError("Could not save the draft."); }
  }
  async function openDrafts() {
    setDrafts(await commsApi.listDrafts()); setShowDrafts(true);
  }
  async function loadDraft(id: number) {
    const d = await commsApi.getDraft(id);
    const p = d.payload as Record<string, unknown>;
    setMode((p.mode as "single" | "group") ?? "single");
    setRecipientType((p.recipientType as RecipientType) ?? "member");
    setRecipient((p.recipient as RecipientOption) ?? null);
    setBulkRecipients((p.bulkRecipients as ResolvedRecipient[]) ?? []);
    setSubject((p.subject as string) ?? "");
    setBodyHtml((p.bodyHtml as string) ?? "<p></p>");
    setSelectedTemplate((p.selectedTemplate as number | "") ?? "");
    setLayoutId((p.layoutId as number | "") ?? "");
    setIncludeUnsub(!!p.includeUnsub);
    setReplyEnabled(!!p.replyEnabled);
    setEmbeddedEvents((p.embeddedEvents as EmbeddedEvent[]) ?? []);
    setDraftId(id); setShowDrafts(false);
  }

  // Pre-fill from query params (?type=member&id=123)
  useEffect(() => {
    const type = params.get("type") as RecipientType | null;
    const id   = params.get("id");
    if (type && id) {
      setRecipientType(type);
      prefillRecipient(type, parseInt(id));
    }
    if (params.get("drafts")) openDrafts(); // opened from the Communications “Drafts” tile
  }, []);

  useEffect(() => {
    commsApi.listTemplates(recipientType).then(setTemplates);
    commsApi.getVariables(recipientType).then(setVariables);
  }, [recipientType]);

  useEffect(() => { commsApi.listLayouts().then(setLayouts).catch(() => {}); }, []);

  async function prefillRecipient(type: RecipientType, id: number) {
    try {
      if (type === "member") {
        const { data } = await api.get(`/api/v1/members/${id}`);
        const email = data.email || data.guardian1_email || "";
        const name = data.email ? `${data.first_name} ${data.last_name}`
          : (data.guardian1_name || `${data.first_name} ${data.last_name}'s parent`);
        setRecipient({ id, name, email, sub: `#${data.member_number} · ${data.member_type}`, type });
      } else if (type === "visitor") {
        const { data } = await api.get(`/api/v1/visitors/${id}`);
        // Youth usually have no email of their own, so the message goes to the guardian —
        // address the To to the parent by name, not the youth.
        const email = data.email || data.guardian1_email || "";
        const name = data.email ? data.full_name : (data.guardian1_name || `${data.full_name}'s parent`);
        setRecipient({ id, name, email, sub: `Visitor #${data.visitor_number}`, type });
      }
    } catch { /* ignore */ }
  }

  async function searchRecipients() {
    if (!searchQuery.trim()) return;
    setSearchResults([]);
    try {
      if (recipientType === "member") {
        const { data } = await api.get(`/api/v1/members/?search=${encodeURIComponent(searchQuery)}&is_active=true&limit=15`);
        setSearchResults(data.members.map((m: { id: number; first_name: string; last_name: string; email?: string; member_number: string; member_type: string }) => ({
          id: m.id,
          name: `${m.first_name} ${m.last_name}`,
          email: m.email,
          sub: `#${m.member_number} · ${m.member_type}`,
          type: "member" as RecipientType,
        })));
      } else if (recipientType === "visitor") {
        const { data } = await api.get(`/api/v1/visitors/?search=${encodeURIComponent(searchQuery)}&limit=15`);
        setSearchResults(data.visitors.map((v: { id: number; full_name: string; guardian1_name?: string; guardian1_email?: string; email?: string; visitor_number: string }) => ({
          id: v.id,
          // Message goes to the guardian when the youth has no email — show the parent's name.
          name: v.email ? v.full_name : (v.guardian1_name || `${v.full_name}'s parent`),
          email: v.email || v.guardian1_email,
          sub: `Visitor #${v.visitor_number}`,
          type: "visitor" as RecipientType,
        })));
      }
    } catch { setError("Search failed."); }
  }

  async function loadTemplate(id: number) {
    setLoading(true);
    try {
      const t = await commsApi.getTemplate(id);
      setSubject(t.subject_template);
      setBodyHtml(t.body_html_template);
      setReplyEnabled(t.reply_enabled);
    } finally { setLoading(false); }
  }

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    if (!recipient) { setError("Please select a recipient."); return; }
    if (!subject.trim()) { setError("Subject is required."); return; }
    setError("");
    setLoading(true);
    try {
      const p = await commsApi.preview({
        recipient_type: recipient.type,
        recipient_id: recipient.id,
        subject_template: subject,
        body_html_template: finalBody(),
        event_ids: embeddedEvents.map((e) => e.id),
        layout_id: layoutId ? Number(layoutId) : undefined,
      });
      setPreview(p);
      setStage("preview");
    } catch { setError("Preview failed."); }
    finally { setLoading(false); }
  }

  async function handleSend() {
    if (!recipient) return;
    setSending(true);
    try {
      const r = await commsApi.send({
        recipient_type: recipient.type,
        recipient_id: recipient.id,
        subject,
        body_html: finalBody(),
        template_id: selectedTemplate ? Number(selectedTemplate) : undefined,
        reply_enabled: replyEnabled,
        event_ids: embeddedEvents.map((e) => e.id),
        layout_id: layoutId ? Number(layoutId) : undefined,
        attachment_ids: attachments.map((a) => a.id),
        cc: cc.trim() || undefined,
      });
      setResult(r);
      setStage("result");
      if (draftId) { commsApi.deleteDraft(draftId).catch(() => {}); setDraftId(null); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Send failed. Please try again.");
      setStage("compose");
    } finally { setSending(false); }
  }

  async function handleBulkSend() {
    if (!subject.trim()) { setError("Subject is required."); return; }
    if (bulkRecipients.length === 0) { setError("No recipients — build a group and click Preview recipients."); return; }
    setError(""); setSending(true);
    try {
      const r = await commsApi.sendBulk({
        subject, body_html: finalBody(),
        template_id: selectedTemplate ? Number(selectedTemplate) : undefined,
        reply_enabled: replyEnabled,
        recipients: bulkRecipients,
        event_ids: embeddedEvents.map((e) => e.id),
        layout_id: layoutId ? Number(layoutId) : undefined,
        include_unsubscribe: includeUnsub,
        attachment_ids: attachments.map((a) => a.id),
        copy_to: cc.trim() || undefined,
        category: category || undefined,
      });
      setBulkResult(r);
      setStage("result");
      if (draftId) { commsApi.deleteDraft(draftId).catch(() => {}); setDraftId(null); }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Bulk send failed.");
    } finally { setSending(false); }
  }

  function reset() {
    setRecipient(null); setBulkRecipients([]); setBulkResult(null);
    setSubject(""); setBodyHtml("<p></p>"); setSelectedTemplate("");
    setEmbeddedEvents([]); setEventPickerOpen(false); setAttachments([]);
    setStage("compose"); setResult(null); setPreview(null); setError("");
  }

  // ── Bulk result view ───────────────────────────────────────────────────

  if (stage === "result" && bulkResult) {
    const r = bulkResult;
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Communications</button>
        </div>
        <div style={styles.resultCard}>
          {!r.email_enabled ? (
            <div style={styles.noSmtpBanner}><AlertTriangle size={20} color="#f57c00" /><div><strong>Email is not configured</strong><div style={styles.bannerSub}>{r.total} message(s) were recorded but not sent. Configure SMTP in Admin → Email Settings.</div></div></div>
          ) : r.failed === 0 ? (
            <div style={styles.successBanner}><CheckCircle size={20} color="#2e7d32" /><div><strong>Sent to {r.sent} recipient{r.sent === 1 ? "" : "s"}!</strong></div></div>
          ) : (
            <div style={styles.noSmtpBanner}><AlertTriangle size={20} color="#f57c00" /><div><strong>Sent {r.sent} of {r.total}; {r.failed} failed.</strong><div style={styles.bannerSub}>See the failures below.</div></div></div>
          )}
          {(r.skipped_unsubscribed ?? 0) > 0 && (
            <div style={styles.bannerSub}>{r.skipped_unsubscribed} recipient{r.skipped_unsubscribed === 1 ? "" : "s"} skipped (unsubscribed).</div>
          )}
          {(r.skipped_optout ?? 0) > 0 && (
            <div style={styles.bannerSub}>{r.skipped_optout} recipient{r.skipped_optout === 1 ? "" : "s"} skipped (opted out of “{category}”).</div>
          )}
          {r.errors.length > 0 && (
            <div style={styles.bodyPre}>{r.errors.map((e) => `${e.email}: ${e.error}`).join("\n")}{r.failed > r.errors.length ? `\n…and ${r.failed - r.errors.length} more` : ""}</div>
          )}
          <div style={styles.resultFooterBtns}>
            <button style={styles.secondaryBtn} onClick={reset}>Compose Another</button>
            <button style={styles.primaryBtn} onClick={goBack}>Back to Communications</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Result view ────────────────────────────────────────────────────────

  if (stage === "result" && result) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Communications</button>
        </div>
        <div style={styles.resultCard}>
          {result.email_sent ? (
            <div style={styles.successBanner}><CheckCircle size={20} color="#2e7d32" /><div><strong>Email sent!</strong><div style={styles.bannerSub}>To: {result.recipient_email}</div></div></div>
          ) : (
            <div style={styles.noSmtpBanner}><AlertTriangle size={20} color="#f57c00" /><div><strong>SMTP not configured — not sent</strong><div style={styles.bannerSub}>Copy the email below and send manually to <strong>{result.recipient_email}</strong>.</div></div></div>
          )}
          <div style={styles.resultMeta}><strong>Subject:</strong> {result.subject}</div>
          <div style={styles.resultActions}>
            <button style={styles.iconBtn} onClick={() => { navigator.clipboard.writeText(result.body_text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              <Copy size={13} /> {copied ? "Copied!" : "Copy plain text"}
            </button>
            <button style={styles.iconBtn} onClick={() => navigate(`/communications/threads/${result.thread_id}`)}>
              <ExternalLink size={13} /> View Thread
            </button>
          </div>
          <pre style={styles.bodyPre}>{result.body_text}</pre>
          <div style={styles.resultFooterBtns}>
            <button style={styles.secondaryBtn} onClick={reset}>Compose Another</button>
            <button style={styles.primaryBtn} onClick={goBack}>Back to Communications</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Preview view ───────────────────────────────────────────────────────

  if (stage === "preview" && preview) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <button onClick={() => setStage("compose")} style={styles.backBtn}><ArrowLeft size={14} /> Back to Compose</button>
          <h1 style={styles.heading}>Preview Email</h1>
        </div>
        <div style={styles.previewCard}>
          <div style={styles.previewSubjectRow}><span style={styles.previewLabel}>To:</span> <strong>{recipient?.name}</strong> &lt;{recipient?.email}&gt;</div>
          <div style={styles.previewSubjectRow}><span style={styles.previewLabel}>Subject:</span> <strong>{preview.subject}</strong></div>
          {/* Render the email in a sandboxed iframe so its <style> (which sets
              body{max-width:600px}) can't leak into and shrink the whole app (#69). */}
          <iframe title="Email preview" srcDoc={preview.body_html} style={styles.previewFrame} sandbox="" />
          {error && <div style={styles.errorBox}>{error}</div>}
          <div style={styles.previewActions}>
            <button onClick={() => setStage("compose")} style={styles.secondaryBtn}>← Edit</button>
            <button onClick={handleSend} style={styles.sendBtn} disabled={sending}>
              <Send size={14} /> {sending ? "Sending…" : "Send Email"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Compose view ───────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={goBack} style={styles.backBtn}><ArrowLeft size={14} /> Communications</button>
        <h1 style={styles.heading}>New Email</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
          {draftMsg && <span style={{ fontSize: 12, color: "#2e7d32", fontWeight: 600 }}>✓ {draftMsg}</span>}
          <button onClick={saveDraft} style={styles.secondaryBtn}>💾 Save draft</button>
          <button onClick={openDrafts} style={styles.secondaryBtn}>Drafts</button>
          {showDrafts && (
            <div style={styles.draftMenu}>
              <div style={styles.draftMenuHead}>Your drafts <button style={styles.draftClose} onClick={() => setShowDrafts(false)}>✕</button></div>
              {drafts.length === 0 ? <div style={styles.draftEmpty}>No saved drafts.</div> : drafts.map((d) => (
                <div key={d.id} style={styles.draftRow}>
                  <button style={styles.draftLoad} onClick={() => loadDraft(d.id)}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.subject}</div>
                    <div style={{ fontSize: 11, color: "#90a4ae" }}>{new Date(d.updated_at).toLocaleString()}</div>
                  </button>
                  <button style={styles.draftDel} onClick={async () => { await commsApi.deleteDraft(d.id); setDrafts((x) => x.filter((y) => y.id !== d.id)); if (draftId === d.id) setDraftId(null); }}>🗑</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.composeGrid}>
        {/* ── Left: Recipient picker ── */}
        <div style={styles.leftCol}>
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Recipients</div>

            {/* Mode toggle */}
            <div style={styles.typeSelector}>
              <button style={{ ...styles.typeBtn, ...(mode === "single" ? styles.typeBtnActive : {}) }}
                onClick={() => { setMode("single"); setError(""); }}><User size={13} /> One recipient</button>
              <button style={{ ...styles.typeBtn, ...(mode === "group" ? styles.typeBtnActive : {}) }}
                onClick={() => { setMode("group"); setError(""); }}><UsersRound size={13} /> Group / many</button>
            </div>

            {mode === "group" ? (<>
              {/* Template audience for a group send — a waitlisted group is visitors, so its
                  Visitor templates/variables must be available here (#170). This only drives
                  the template & variable lists; the actual recipients come from the builder. */}
              <label style={styles.label}>Template audience</label>
              <div style={styles.typeSelector}>
                {TYPE_OPTIONS.map(opt => (
                  <button key={opt.value} type="button"
                    style={{ ...styles.typeBtn, ...(recipientType === opt.value ? styles.typeBtnActive : {}) }}
                    onClick={() => setRecipientType(opt.value)}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
              <BulkRecipientBuilder onResolved={setBulkRecipients} category={category} onCategoryChange={setCategory} />
            </>
            ) : (<>
            {/* Type selector */}
            <div style={styles.typeSelector}>
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  style={{ ...styles.typeBtn, ...(recipientType === opt.value ? styles.typeBtnActive : {}) }}
                  onClick={() => { setRecipientType(opt.value); setRecipient(null); setSearchResults([]); setSearchQuery(""); }}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>

            {/* Selected recipient */}
            {recipient ? (
              <div style={styles.selectedRecipient}>
                <div style={styles.selectedAvatar}>{recipient.name[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={styles.selectedName}>{recipient.name}</div>
                  {recipient.email && <div style={styles.selectedSub}>{recipient.email}</div>}
                  {recipient.sub && <div style={styles.selectedSub}>{recipient.sub}</div>}
                </div>
                <button style={styles.clearBtn} onClick={() => { setRecipient(null); setSearchResults([]); }} title="Change recipient">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div style={styles.searchRow}>
                  <input
                    style={styles.searchInput}
                    placeholder={`Search ${recipientType}s…`}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchRecipients()}
                    autoFocus
                  />
                  <button style={styles.searchBtn} onClick={searchRecipients}><Search size={14} /></button>
                </div>
                {searchResults.length > 0 && (
                  <div style={styles.results}>
                    {searchResults.map(r => (
                      <div key={r.id} style={styles.resultRow} onClick={() => { setRecipient(r); setSearchResults([]); setSearchQuery(""); }}>
                        <div style={styles.resultAvatar}>{r.name[0]}</div>
                        <div>
                          <div style={styles.resultName}>{r.name}</div>
                          <div style={styles.resultSub}>{r.sub}</div>
                          {r.email && <div style={styles.resultEmail}>{r.email}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            </>)}
          </div>

          {/* Variable reference */}
          {(variables.length > 0 || bodyOnlyVariables.length > 0) && (
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Available Variables</div>
              <p style={styles.varNote}>Click a chip to insert into the subject (blue) or body at cursor (green).</p>
              {variables.length > 0 && (
                <div style={styles.varSection}>
                  <div style={styles.varLabel}>→ Subject</div>
                  <div style={styles.varChips}>
                    {variables.map(v => (
                      <code key={`s-${v}`} style={styles.varChipBlue}
                        onClick={() => setSubject(s => s + `{{${v}}}`)}
                        title="Add to subject"
                      >{`{{${v}}}`}</code>
                    ))}
                  </div>
                </div>
              )}
              <div style={styles.varSection}>
                <div style={{ ...styles.varLabel, color: "#2e7d32" }}>→ Body</div>
                <div style={styles.varChips}>
                  {[...variables, ...bodyOnlyVariables].map(v => (
                    <code key={`b-${v}`} style={styles.varChipGreen}
                      onClick={() => editorRef.current?.insertText(`{{${v}}}`)}
                      title={BODY_ONLY_HINTS[v] ?? "Insert at cursor in body"}
                    >{`{{${v}}}`}</code>
                  ))}
                </div>
              </div>
              {bodyOnlyVariables.length > 0 && (
                <p style={styles.varNote}>
                  <strong>{`{{signup_url}}`}</strong> gives each visitor their own private link to join.
                  Body only — it's a long link, and it fills in for visitor recipients, so it stays blank for members.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Compose form ── */}
        <form style={styles.rightCol} onSubmit={handlePreview}>
          <div style={styles.panel}>
            <div style={styles.panelTitle}>
              <Mail size={14} /> Compose
            </div>

            {/* Template */}
            <div style={styles.field}>
              <label style={styles.label}>Template (optional)</label>
              <select style={styles.input} value={selectedTemplate}
                onChange={e => { const id = e.target.value; setSelectedTemplate(id as "" | number); if (id) loadTemplate(Number(id)); }}>
                <option value="">— Start from scratch —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>[{CATEGORY_LABELS[t.category] ?? t.category}] {t.name}</option>
                ))}
              </select>
            </div>

            {/* Header/footer layout (#101) */}
            {layouts.length > 0 && (
              <div style={styles.field}>
                <label style={styles.label}>Header / footer layout</label>
                <select style={styles.input} value={layoutId} onChange={e => setLayoutId(e.target.value as "" | number)}>
                  <option value="">{layouts.find(l => l.is_default) ? "Default layout" : "Built-in TRCMS branding"}</option>
                  {layouts.map(l => <option key={l.id} value={l.id}>{l.name}{l.is_default ? " (default)" : ""}</option>)}
                </select>
              </div>
            )}

            {/* Subject */}
            <div style={styles.field}>
              <label style={styles.label}>Subject *</label>
              <input style={styles.input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject…" />
            </div>

            {/* #172 / #150 / #168 — CC / send-a-copy. One copy of a group send goes to each. */}
            <div style={styles.field}>
              <label style={styles.label}>CC <span style={{ fontWeight: 400, color: "#8a97a5" }}>(optional, comma-separated)</span></label>
              <input style={styles.input} value={cc} onChange={e => setCc(e.target.value)} placeholder="e.g. info@tulsaroboticscenter.org" />
            </div>

            {/* Body */}
            <div style={styles.field}>
              <label style={styles.label}>Message</label>
              {!loading && (
                <RichTextEditor
                  ref={editorRef}
                  value={bodyHtml}
                  onChange={setBodyHtml}
                  placeholder="Write your message… Use variable chips on the left to insert dynamic content."
                  minHeight={320}
                />
              )}
              {loading && <div style={styles.loadingEditor}>Loading template…</div>}
            </div>

            {/* #102 — Attachments + inline images */}
            <div style={styles.field}>
              <div style={styles.attBar}>
                <label style={styles.attBtn}>
                  <Paperclip size={14} /> Attach files
                  <input type="file" multiple style={{ display: "none" }} onChange={(e) => { onAttachFiles(e.target.files); e.target.value = ""; }} />
                </label>
                <label style={styles.attBtn}>
                  <ImageIcon size={14} /> Insert image
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onInsertImage(e.target.files); e.target.value = ""; }} />
                </label>
                {uploading && <span style={styles.noRecipientNote}>Uploading…</span>}
              </div>
              {attachments.length > 0 && (
                <div style={styles.attList}>
                  {attachments.map((a) => (
                    <span key={a.id} style={styles.attChip}>
                      <Paperclip size={11} /> {a.filename} <span style={styles.attSize}>({Math.round(a.size / 1024)} KB)</span>
                      <button type="button" style={styles.attRemove} onClick={() => removeAttachment(a.id)}><X size={11} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* #96 — Embed one or more events with RSVP buttons */}
            <div style={styles.field}>
              {embeddedEvents.map((ev) => (
                <div key={ev.id} style={styles.eventChip}>
                  <CalendarPlus size={15} color="#1a3a5c" />
                  <div style={{ flex: 1 }}>
                    <div style={styles.eventChipName}>{ev.name}</div>
                    <div style={styles.eventChipSub}>{eventWhen(ev)} · RSVP buttons added to the email</div>
                  </div>
                  <button type="button" style={styles.clearBtn} title="Remove event" onClick={() => removeEvent(ev.id)}><X size={14} /></button>
                </div>
              ))}
              {eventPickerOpen ? (
                <div style={styles.eventPicker}>
                  <div style={styles.eventPickerHead}>
                    <span>Pick an event to embed</span>
                    <button type="button" style={styles.clearBtn} onClick={() => setEventPickerOpen(false)}><X size={14} /></button>
                  </div>
                  {upcomingEvents.filter((ev) => !embeddedEvents.some((e) => e.id === ev.id)).length === 0 ? (
                    <div style={styles.eventEmpty}>No more upcoming events to add (next 120 days).</div>
                  ) : (
                    <div style={styles.eventList}>
                      {upcomingEvents.filter((ev) => !embeddedEvents.some((e) => e.id === ev.id)).map((ev) => (
                        <div key={ev.id} style={styles.eventRow} onClick={() => addEvent(ev)}>
                          <div style={styles.eventRowName}>{ev.name}</div>
                          <div style={styles.eventRowSub}>{eventWhen(ev)}{ev.location ? ` · ${ev.location}` : ""}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button type="button" style={styles.insertEventBtn} onClick={openEventPicker}>
                  <CalendarPlus size={14} /> {embeddedEvents.length ? "Add another event" : "Insert event with RSVP buttons"}
                </button>
              )}
            </div>

            {/* Reply option */}
            <label style={styles.checkRow}>
              <input type="checkbox" checked={replyEnabled} onChange={e => setReplyEnabled(e.target.checked)} />
              <div>
                <div style={styles.checkLabel}>Allow recipient to reply</div>
                <div style={styles.checkHint}>Includes a Reply-To address for 1:1 conversation threading.</div>
              </div>
            </label>

            {/* #100 — unsubscribe (mass/marketing emails) */}
            {mode === "group" && (
              <label style={styles.checkRow}>
                <input type="checkbox" checked={includeUnsub} onChange={e => setIncludeUnsub(e.target.checked)} />
                <div>
                  <div style={styles.checkLabel}>Add an unsubscribe link (mass email)</div>
                  <div style={styles.checkHint}>Adds an Unsubscribe footer and skips anyone who has already opted out. Leave off for important/transactional messages.</div>
                </div>
              </label>
            )}

            {error && <div style={styles.errorBox}>{error}</div>}

            {/* Actions */}
            <div style={styles.formActions}>
              {mode === "single" ? (<>
                {!recipient && <span style={styles.noRecipientNote}>← Select a recipient first</span>}
                <button type="submit" style={{ ...styles.previewBtn, opacity: (!recipient || loading) ? 0.5 : 1 }} disabled={!recipient || loading}>
                  <Eye size={14} /> Preview & Send
                </button>
              </>) : (<>
                {bulkRecipients.length === 0 && <span style={styles.noRecipientNote}>← Build a group and click "Preview recipients"</span>}
                <button type="button" style={{ ...styles.sendBtn, opacity: (bulkRecipients.length === 0 || sending) ? 0.5 : 1 }} disabled={bulkRecipients.length === 0 || sending} onClick={handleBulkSend}>
                  <Send size={14} /> {sending ? "Sending…" : `Send to ${bulkRecipients.length} recipient${bulkRecipients.length === 1 ? "" : "s"}`}
                </button>
              </>)}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: "0 auto" },
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 20 },
  backBtn: { display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "#1565c0", cursor: "pointer", fontSize: 13, padding: 0 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: "#1a3a5c" },
  composeGrid: { display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" },
  leftCol: { display: "flex", flexDirection: "column", gap: 12 },
  rightCol: { display: "flex", flexDirection: "column", gap: 0 },
  panel: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", display: "flex", flexDirection: "column", gap: 10 },
  panelTitle: { fontSize: 12, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5, borderBottom: "1px solid #f0f4f8", paddingBottom: 8, display: "flex", alignItems: "center", gap: 6 },
  typeSelector: { display: "flex", gap: 4 },
  typeBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px 0", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#555" },
  typeBtnActive: { background: "#1a3a5c", color: "#fff", borderColor: "#1a3a5c" },
  searchRow: { display: "flex", gap: 6 },
  searchInput: { flex: 1, padding: "7px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 },
  searchBtn: { padding: "7px 10px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", display: "flex" },
  results: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" as const },
  resultRow: { display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", background: "#fafafa" },
  resultAvatar: { width: 30, height: 30, borderRadius: "50%", background: "#1a3a5c", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  resultName: { fontWeight: 600, fontSize: 13, color: "#1a3a5c" },
  resultSub: { fontSize: 11, color: "#888" },
  resultEmail: { fontSize: 11, color: "#aaa" },
  selectedRecipient: { display: "flex", alignItems: "center", gap: 10, padding: "10px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8 },
  selectedAvatar: { width: 34, height: 34, borderRadius: "50%", background: "#2e7d32", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 },
  selectedName: { fontWeight: 700, fontSize: 13, color: "#1a3a5c" },
  selectedSub: { fontSize: 11, color: "#555" },
  clearBtn: { background: "none", border: "none", cursor: "pointer", color: "#aaa", display: "flex" },
  varNote: { fontSize: 11, color: "#888", margin: 0, lineHeight: 1.5 },
  varSection: { display: "flex", flexDirection: "column", gap: 4 },
  varLabel: { fontSize: 10, fontWeight: 700, color: "#1a3a5c", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  varChips: { display: "flex", flexWrap: "wrap", gap: 3 },
  varChipBlue: { fontSize: 10, background: "#1a3a5c", color: "#fff", padding: "1px 6px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", userSelect: "none" as const },
  varChipGreen: { fontSize: 10, background: "#2e7d32", color: "#fff", padding: "1px 6px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", userSelect: "none" as const },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 12, fontWeight: 600, color: "#555" },
  input: { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14, boxSizing: "border-box" as const, width: "100%" },
  loadingEditor: { height: 120, background: "#f8fafc", border: "1px solid #ccc", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 13 },
  insertEventBtn: { display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", background: "#eef4fb", color: "#1a3a5c", border: "1px dashed #9cc0e6", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 13, alignSelf: "flex-start" },
  eventChip: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#eef4fb", border: "1px solid #c9ddf3", borderRadius: 8 },
  eventChipName: { fontWeight: 700, fontSize: 13, color: "#1a3a5c" },
  eventChipSub: { fontSize: 11, color: "#5a7184", marginTop: 1 },
  eventPicker: { border: "1px solid #cdd7e3", borderRadius: 8, background: "#fff", overflow: "hidden" },
  eventPickerHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #eef0f4", fontSize: 12, fontWeight: 700, color: "#1a3a5c" },
  eventEmpty: { padding: "14px", fontSize: 13, color: "#888", textAlign: "center" as const },
  eventList: { maxHeight: 220, overflowY: "auto" as const },
  eventRow: { padding: "9px 12px", borderBottom: "1px solid #f4f6fa", cursor: "pointer" },
  eventRowName: { fontSize: 13, fontWeight: 600, color: "#1a3a5c" },
  eventRowSub: { fontSize: 11, color: "#888", marginTop: 1 },
  attBar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  attBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#eef4fb", color: "#1a3a5c", border: "1px dashed #9cc0e6", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 12 },
  attList: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  attChip: { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 14, fontSize: 12, color: "#334155" },
  attSize: { color: "#99a", fontSize: 11 },
  attRemove: { background: "none", border: "none", cursor: "pointer", color: "#c62828", display: "flex", padding: 0, marginLeft: 2 },
  checkRow: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
  checkLabel: { fontSize: 13, fontWeight: 600, color: "#333" },
  checkHint: { fontSize: 11, color: "#888", marginTop: 2 },
  errorBox: { background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 6, padding: "10px 14px", color: "#c62828", fontSize: 13 },
  formActions: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 },
  noRecipientNote: { fontSize: 12, color: "#aaa", fontStyle: "italic" },
  previewBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  previewCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem", display: "flex", flexDirection: "column", gap: 14 },
  previewSubjectRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 14 },
  previewLabel: { fontSize: 12, color: "#888", fontWeight: 600, minWidth: 55 },
  previewFrame: { width: "100%", height: 480, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff" },
  previewActions: { display: "flex", justifyContent: "flex-end", gap: 10 },
  secondaryBtn: { padding: "9px 20px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 14 },
  draftMenu: { position: "absolute", top: "110%", right: 0, width: 300, maxHeight: 340, overflowY: "auto", background: "#fff", border: "1px solid #cdd7e3", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)", zIndex: 50 },
  draftMenuHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #eef1f5", fontSize: 12, fontWeight: 700, color: "#607d8b" },
  draftClose: { background: "none", border: "none", cursor: "pointer", color: "#90a4ae", fontSize: 13 },
  draftEmpty: { padding: "14px 12px", fontSize: 13, color: "#90a4ae" },
  draftRow: { display: "flex", alignItems: "center", borderBottom: "1px solid #f5f7f9" },
  draftLoad: { flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "9px 12px" },
  draftDel: { background: "none", border: "none", cursor: "pointer", padding: "0 10px", fontSize: 13 },
  sendBtn: { display: "flex", alignItems: "center", gap: 7, padding: "10px 22px", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  primaryBtn: { padding: "9px 22px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 },
  resultCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem", display: "flex", flexDirection: "column", gap: 14 },
  successBanner: { display: "flex", gap: 12, padding: "12px 14px", background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 8, fontSize: 14, color: "#2e7d32" },
  noSmtpBanner: { display: "flex", gap: 12, padding: "12px 14px", background: "#fff8e1", border: "1px solid #ffd54f", borderRadius: 8, fontSize: 13, color: "#795548" },
  bannerSub: { fontSize: 12, marginTop: 3 },
  resultMeta: { fontSize: 14, color: "#444" },
  resultActions: { display: "flex", gap: 8 },
  iconBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", border: "1px solid #ccc", background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13 },
  bodyPre: { fontSize: 12, lineHeight: 1.7, color: "#444", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, padding: "12px", whiteSpace: "pre-wrap" as const, maxHeight: 300, overflowY: "auto" as const, fontFamily: "inherit" },
  resultFooterBtns: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 },
};
