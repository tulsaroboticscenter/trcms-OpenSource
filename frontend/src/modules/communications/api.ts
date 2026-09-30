import { api } from "../../core/api";

export const commsApi = {
  // Templates
  listTemplates: (category?: string, includeInactive = false) =>
    api.get("/api/v1/comms/templates", { params: { ...(category ? { category } : {}), ...(includeInactive ? { active_only: false } : {}) } })
       .then(r => r.data as EmailTemplate[]),

  getTemplate: (id: number) =>
    api.get(`/api/v1/comms/templates/${id}`).then(r => r.data as EmailTemplate),

  getCategories: () =>
    api.get("/api/v1/comms/templates/categories").then(r => r.data as string[]),

  getVariables: (recipientType: string) =>
    api.get("/api/v1/comms/templates/variables", { params: { recipient_type: recipientType } })
       .then(r => r.data as string[]),

  // Program-wide links usable in every template (Google Classroom + Discord invite).
  getEmailLinks: () =>
    api.get("/api/v1/comms/email-links").then(r => r.data as EmailLinks),
  setEmailLinks: (discordResourceId: number | null) =>
    api.put("/api/v1/comms/email-links", { discord_resource_id: discordResourceId })
       .then(r => r.data as EmailLinks),

  createTemplate: (data: Partial<EmailTemplate>) =>
    api.post("/api/v1/comms/templates", data).then(r => r.data as EmailTemplate),

  updateTemplate: (id: number, data: Partial<EmailTemplate>) =>
    api.patch(`/api/v1/comms/templates/${id}`, data).then(r => r.data),

  deleteTemplate: (id: number) =>
    api.delete(`/api/v1/comms/templates/${id}`).then(r => r.data),

  // Attachments + inline images (#102)
  uploadAttachment: (file: File, inline = false) => {
    const fd = new FormData(); fd.append("file", file); if (inline) fd.append("inline", "1");
    return api.post("/api/v1/comms/attachments", fd).then(r => r.data as EmailAttachment);
  },
  deleteAttachment: (id: number) => api.delete(`/api/v1/comms/attachments/${id}`).then(r => r.data),

  // Email drafts (#132)
  listDrafts: () => api.get("/api/v1/comms/drafts").then(r => r.data as { id: number; subject: string; updated_at: string }[]),
  getDraft: (id: number) => api.get(`/api/v1/comms/drafts/${id}`).then(r => r.data as { id: number; subject: string; payload: Record<string, unknown> }),
  saveDraft: (subject: string, payload: Record<string, unknown>, id?: number) =>
    (id ? api.put(`/api/v1/comms/drafts/${id}`, { subject, payload }) : api.post("/api/v1/comms/drafts", { subject, payload })).then(r => r.data as { id: number }),
  deleteDraft: (id: number) => api.delete(`/api/v1/comms/drafts/${id}`).then(r => r.data),

  // Header/footer layouts (#101)
  listLayouts: () => api.get("/api/v1/comms/layouts").then(r => r.data as EmailLayout[]),
  getLayout: (id: number) => api.get(`/api/v1/comms/layouts/${id}`).then(r => r.data as EmailLayout),
  createLayout: (data: Partial<EmailLayout>) => api.post("/api/v1/comms/layouts", data).then(r => r.data as EmailLayout),
  updateLayout: (id: number, data: Partial<EmailLayout>) => api.patch(`/api/v1/comms/layouts/${id}`, data).then(r => r.data as EmailLayout),
  deleteLayout: (id: number) => api.delete(`/api/v1/comms/layouts/${id}`).then(r => r.data),

  // Preview
  preview: (data: { recipient_type: string; recipient_id: number; subject_template: string; body_html_template: string; event_ids?: number[]; layout_id?: number }) =>
    api.post("/api/v1/comms/preview", data).then(r => r.data as PreviewResult),

  // Send
  send: (data: SendRequest) =>
    api.post("/api/v1/comms/send", data).then(r => r.data as SendResult),

  // Bulk / group send
  resolveRecipients: (sel: RecipientSelectors) =>
    api.post("/api/v1/comms/resolve-recipients", sel).then(r => r.data as ResolvedRecipients),
  sendBulk: (data: { subject: string; body_html: string; template_id?: number; reply_enabled: boolean; recipients: ResolvedRecipient[]; event_ids?: number[]; layout_id?: number; include_unsubscribe?: boolean; attachment_ids?: number[]; copy_to?: string; category?: string }) =>
    api.post("/api/v1/comms/send-bulk", data).then(r => r.data as BulkSendResult),

  preferenceTypes: () =>
    api.get("/api/v1/comms/preference-types").then(r => r.data as string[]),

  // Mailing-list subscribers (volunteers / newsletter contacts with no account)
  listSubscribers: (params: { search?: string; include_unsubscribed?: number } = {}) =>
    api.get("/api/v1/mailing-list/subscribers", { params }).then(r => r.data as SubscriberList),
  setSubscribed: (id: number, subscribed: boolean) =>
    api.patch(`/api/v1/mailing-list/subscribers/${id}`, { subscribed }).then(r => r.data as { ok: boolean; subscribed: boolean }),

  // Admin-wide message history (all recipients), with filters
  listMessages: (filters: MessageHistoryFilters) =>
    api.get("/api/v1/comms/messages", { params: filters }).then(r => r.data as MessageHistoryResult),

  // Pickers for the history filters
  teamSeasons: () =>
    api.get("/api/v1/comms/team-seasons").then(r => r.data as TeamSeasonOption[]),
  listPrograms: () =>
    api.get("/api/v1/programs/").then(r => r.data as ProgramOption[]),

  // Threads
  getRecipientThreads: (recipientType: string, recipientId: number) =>
    api.get("/api/v1/comms/threads/recipient", {
      params: { recipient_type: recipientType, recipient_id: recipientId },
    }).then(r => r.data as ThreadSummary[]),

  getThread: (id: number) =>
    api.get(`/api/v1/comms/threads/${id}`).then(r => r.data as ThreadDetail),

  closeThread: (id: number) =>
    api.patch(`/api/v1/comms/threads/${id}/close`).then(r => r.data),

  // Member communication preferences
  getMemberPreferences: (memberId: number) =>
    api.get(`/api/v1/comms/preferences/${memberId}`).then(r => r.data as CommPreference[]),

  updateMemberPreferences: (memberId: number, preferences: CommPreference[]) =>
    api.put(`/api/v1/comms/preferences/${memberId}`, { preferences }).then(r => r.data),

  getPreferenceTypes: () =>
    api.get("/api/v1/comms/preferences/1/types").then(r => r.data as string[]),
};

export interface EmailTemplate {
  id: number;
  name: string;
  category: string;
  description?: string;
  subject_template: string;
  body_html_template: string;
  available_variables: string[];
  reply_enabled: boolean;
  is_active: boolean;
  created_at: string;
}

export interface EmailLinkResourceOption {
  id: number;
  name: string;
  type: string | null;
  url: string;
}
export interface EmailLinks {
  /** Set in the Certifications module; read-only here. */
  google_classroom_url: string;
  /** The TRC resource designated as the Discord invite (null if none). */
  discord_resource_id: number | null;
  discord_invite_url: string;
  resource_options: EmailLinkResourceOption[];
  can_manage: boolean;
}

export interface PreviewResult {
  subject: string;
  body_html: string;
  body_text: string;
  context_used: Record<string, string>;
}

export interface SendRequest {
  recipient_type: string;
  recipient_id: number;
  subject: string;
  body_html: string;
  template_id?: number;
  reply_enabled?: boolean;
  event_ids?: number[];
  layout_id?: number;
  attachment_ids?: number[];
  cc?: string;
}

export interface EmailAttachment {
  id: number;
  filename: string;
  mime_type?: string | null;
  size: number;
  is_inline: boolean;
  url: string;
}

export interface EmailLayout {
  id: number;
  name: string;
  header_html?: string | null;
  footer_html?: string | null;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SendResult {
  ok: boolean;
  thread_id: number;
  message_id: number;
  email_sent: boolean;
  email_enabled: boolean;
  recipient_email: string;
  subject: string;
  error?: string;
  body_html: string;
  body_text: string;
}

export interface ThreadSummary {
  id: number;
  subject: string;
  recipient_email: string;
  reply_enabled: boolean;
  status: string;
  created_at: string;
  message_count: number;
  last_message_at: string;
  last_sender?: string;
  last_status?: string;
}

export interface ThreadMessage {
  id: number;
  sender_id?: number;
  sender_name: string;
  direction: string;
  subject?: string;
  body_html: string;
  body_text?: string;
  status: string;
  sent_at?: string;
  created_at: string;
  opened_at?: string | null;
  open_count?: number;
  clicked_at?: string | null;
  click_count?: number;
}

export interface ThreadDetail {
  id: number;
  subject: string;
  recipient_type: string;
  recipient_id: number;
  recipient_email: string;
  recipient_name?: string;
  reply_enabled: boolean;
  status: string;
  created_at: string;
  messages: ThreadMessage[];
}

export interface CommPreference {
  preference_type: string;
  opted_in: boolean;
}

// ── Admin message history ──
export interface MessageHistoryFilters {
  team_season_id?: number;
  program_id?: number;
  member_type?: string;   // youth | mentor | parent | volunteer | sponsor | visitor
  search?: string;
  date_from?: string;     // YYYY-MM-DD (inclusive)
  date_to?: string;       // YYYY-MM-DD (inclusive)
  limit?: number;
  offset?: number;
}
export interface MessageRecipient {
  thread_id: number;
  recipient_name: string;
  recipient_email: string;
  audience: string;       // youth | mentor | parent | volunteer | sponsor | visitor | member
  last_status: string | null;
  opened?: boolean;
  clicked?: boolean;
}
export interface MessageGroup {
  group_key: string;
  is_group: boolean;          // true when sent to more than one recipient
  thread_id: number | null;   // set for single sends (direct-open)
  subject: string;
  personalized: boolean;      // recipients got per-person content
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  opened_count?: number;
  clicked_count?: number;
  audiences: string[];
  sent_by: string | null;
  created_at: string;
  recipients: MessageRecipient[];
}
export interface MessageHistoryResult {
  total: number;          // number of groups
  limit: number;
  offset: number;
  groups: MessageGroup[];
}
export interface TeamSeasonOption {
  team_season_id: number;
  team_number: string | number;
  season: string;
  team_name: string;
}
export interface ProgramOption {
  id: number;
  name: string;
  full_name?: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  visitor: "Visitors",
  member: "Members",
  volunteer: "Volunteers",
  sponsor: "Sponsors",
  summer_camp: "Summer Camp",
  general: "General",
  past_due: "Past-Due Billing",
};

// ── Bulk / group recipients ──
export interface Subscriber {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  interests: string[];
  notes?: string | null;
  source?: string | null;
  member_id?: number | null;
  subscribed: boolean;
  created_at?: string;
}
export interface SubscriberList {
  subscribers: Subscriber[];
  active: number;
  unsubscribed: number;
}
export interface RecipientSelectors {
  teams?: { team_season_id: number; members?: boolean; parents?: boolean; mentors?: boolean }[];
  programs?: { program_id: number; members?: boolean; parents?: boolean; mentors?: boolean }[];
  org?: string[];          // "mentors" | "youth" | "parents" | "volunteers"
  individuals?: number[];  // member ids
  // from_date/to_date = "visited between" (YYYY-MM-DD); matches first contact
  // (inquiry_date) or any logged interaction in the window.
  visitors?: { all?: boolean; statuses?: string[]; program_id?: number; ids?: number[]; from_date?: string; to_date?: string };
  mailing_list?: boolean;  // active volunteer/newsletter subscribers (no account)
  // Compliance groups (#179): this season's enrollees by status. Gated on finance.view
  // server-side. "tc_incomplete" | "unpaid" | "payment_plan". Youth → guardians.
  compliance?: string[];
  include_inactive?: boolean; // default false: inactive member accounts are dropped from every audience
  category?: string;       // optional comm category — members who opted out of it are dropped
}
export interface ResolvedRecipient {
  member_id: number | null;
  visitor_id?: number | null;
  subscriber_id?: number | null;
  email: string;
  name: string;
  kind: string;            // youth | mentor | parent | volunteer | individual | visitor | subscriber
  vars?: Record<string, string>;  // per-recipient merge variables (#106)
}
export interface ResolvedRecipients {
  count: number;
  skipped_no_email: number;
  skipped_optout?: number;
  recipients: ResolvedRecipient[];
}
export interface BulkSendResult {
  ok: boolean;
  total: number;
  sent: number;
  failed: number;
  skipped_unsubscribed?: number;
  skipped_optout?: number;
  email_enabled: boolean;
  errors: { email: string; error: string }[];
}
