import { api } from "../../core/api";

export type Scope = "program" | "team";
export type Lifecycle = "prospective" | "active" | "lapsed" | "declined";

export interface OwningTeam { team_id: number; team_number: string; label: string; }

export interface SponsorSummary {
  id: number;
  name: string;
  scope: Scope;
  tier: string | null;
  tier_locked: boolean;
  lifecycle_state: Lifecycle;
  relationship_owner_id: number | null;
  relationship_owner_name: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  website: string | null;
  logo_url: string | null;
  industry_category: string | null;
  season: string;
  youth_safety_flag: boolean;
  source: string | null;
  decline_reason: string | null;
  owning_teams: OwningTeam[];
  received_total: number;
  can_contact: boolean;
}

export interface Contribution {
  id: number; sponsor_id: number; season: string;
  contribution_type: "monetary" | "in_kind";
  amount: number | null; in_kind_description: string | null; in_kind_value: number | null;
  status: "pledged" | "received" | "declined" | "refunded";
  designation: string; scholarship_fund_id: number | null; program_model: string | null; tax_deductible: boolean;
  pledge_date: string | null; received_date: string | null;
  payment_reference: string | null; credited_team_id: number | null;
  recorded_by_name: string | null; notes: string | null;
}

export interface ScholarshipFund {
  id: number; name: string; description: string | null; is_active: boolean;
  balance: number; contribution_count: number;
}

export interface Deliverable {
  id: number; sponsor_id: number; season: string; description: string;
  category: string | null; due_date: string | null; assigned_to_id: number | null;
  assigned_to_name: string | null;
  status: "pending" | "in_progress" | "complete" | "overdue" | "waived";
  completion_date: string | null; completion_notes: string | null;
}

export interface ContactLog {
  id: number; member_id: number | null; member_name: string | null;
  method: string | null; notes: string | null; outcome: string | null; contacted_at: string | null;
}

export interface SponsoredEvent {
  id: number; event_id: number; event_name: string; event_date: string | null;
  stage: string; package_name: string | null;
  pledged_amount: number | null; received_amount: number | null; in_kind_description: string | null;
}

export interface SponsorDetail extends SponsorSummary {
  youth_safety_notes: string | null; notes: string | null;
  contributions: Contribution[]; deliverables: Deliverable[]; contacts: ContactLog[]; events: SponsoredEvent[];
}

export const sponsorsApi = {
  list: (params?: Record<string, string>) =>
    api.get("/api/v1/sponsors/", { params }).then((r) => r.data as SponsorSummary[]),
  get: (id: number) => api.get(`/api/v1/sponsors/${id}`).then((r) => r.data as SponsorDetail),
  create: (data: Record<string, unknown>) => api.post("/api/v1/sponsors/", data).then((r) => r.data as SponsorDetail),
  update: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/sponsors/${id}`, data).then((r) => r.data as SponsorDetail),
  remove: (id: number) => api.delete(`/api/v1/sponsors/${id}`).then((r) => r.data),

  addContribution: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/sponsors/${id}/contributions`, data).then((r) => r.data as SponsorDetail),
  updateContribution: (cid: number, data: Record<string, unknown>) => api.patch(`/api/v1/sponsors/contributions/${cid}`, data).then((r) => r.data as SponsorDetail),
  deleteContribution: (cid: number) => api.delete(`/api/v1/sponsors/contributions/${cid}`).then((r) => r.data as SponsorDetail),

  addDeliverable: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/sponsors/${id}/deliverables`, data).then((r) => r.data as SponsorDetail),
  updateDeliverable: (did: number, data: Record<string, unknown>) => api.patch(`/api/v1/sponsors/deliverables/${did}`, data).then((r) => r.data as SponsorDetail),
  deleteDeliverable: (did: number) => api.delete(`/api/v1/sponsors/deliverables/${did}`).then((r) => r.data as SponsorDetail),

  addContact: (id: number, data: Record<string, unknown>) => api.post(`/api/v1/sponsors/${id}/contacts`, data).then((r) => r.data as SponsorDetail),
  deleteContact: (kid: number) => api.delete(`/api/v1/sponsors/contacts/${kid}`).then((r) => r.data as SponsorDetail),

  reminders: () => api.get("/api/v1/sponsors/reminders").then((r) => r.data as SponsorReminder[]),
  reports: () => api.get("/api/v1/sponsors/reports").then((r) => r.data as SponsorReports),
};

// Phase 3 — fund ledger
export interface FundLedgerRow {
  id: number; name: string; is_active: boolean;
  allocated: number; awarded: number; available: number; sponsor_support: number;
}
export interface FundAllocationRow { id: number; amount: number; source: string; note: string | null; by_name: string | null; allocated_at: string | null; }
export type AwardOutcome = "enrolled" | "pending" | "not_enrolled" | "none";
export type ExpiryState = "active" | "expiring_soon" | "expired" | "secured" | "closed";
export interface AwardExpiry { state: ExpiryState; days_left: number | null; expires_on: string | null; }
export interface FundAwardRow { id: number; recipient: string | null; amount: number; status: string; created_at: string; enrollment_id: number | null; outcome: AwardOutcome; expiry: AwardExpiry; }
export interface FundHistoryRow { year: number; allocated: number; paid_out: number; }

// Phase 4 — award expiration + clawback
export interface ExpiringAward {
  id: number; application_id: number; fund_id: number | null; fund_name: string | null;
  recipient: string | null; enrollment_id: number | null; amount: number; created_at: string;
  outcome: AwardOutcome; expiry: AwardExpiry;
}
export interface ExpiringAwards {
  year: number;
  awards: ExpiringAward[];
  counts: { active: number; expiring_soon: number; expired: number };
  reclaimable: number;
}
export interface FundLedger {
  year: number;
  funds: FundLedgerRow[];
  totals: { allocated: number; awarded: number; available: number };
  detail: { fund_id: number; allocations: FundAllocationRow[]; awards: FundAwardRow[]; history: FundHistoryRow[] } | null;
}

// Phase 5 — TRCF Board report
export interface BoardReportFund { id: number; name: string; is_active: boolean; award_count: number; allocated: number; awarded: number; available: number; sponsor_support: number; }
export interface BoardReportAward { id: number; recipient: string | null; program: string | null; fund_name: string | null; amount: number; date: string | null; outcome: AwardOutcome; }
export interface BoardReportHistory { year: number; allocated: number; paid_out: number; youth_helped: number; }
export interface BoardReport {
  year: number; year_label: string; generated_at: string;
  summary: {
    funds_count: number; total_allocated: number; total_awarded: number; total_available: number; total_sponsor_support: number;
    youth_helped: number; award_count: number; avg_award: number;
    reclaimed_count: number; reclaimed_total: number;
    outcomes: { enrolled: number; pending: number; not_enrolled: number; none: number };
  };
  funds: BoardReportFund[];
  awards: BoardReportAward[];
  history: BoardReportHistory[];
}

// Phase 6 — season close-out
export interface SeasonCloseout {
  year: number; year_label: string;
  allocated: number; awarded: number; unspent: number;
  reclaimable: { count: number; amount: number };
  open_applications: number;
  ready: boolean;
}

export const scholarshipsApi = {
  listFunds: () => api.get("/api/v1/scholarships/funds").then((r) => r.data as ScholarshipFund[]),
  boardReport: (year?: number) =>
    api.get("/api/v1/scholarships/board-report", { params: year ? { year } : {} }).then((r) => r.data as BoardReport),
  createFund: (d: Record<string, unknown>) => api.post("/api/v1/scholarships/funds", d).then((r) => r.data as ScholarshipFund),
  updateFund: (id: number, d: Record<string, unknown>) => api.patch(`/api/v1/scholarships/funds/${id}`, d).then((r) => r.data as ScholarshipFund),
  fundLedger: (params?: { year?: number; fund_id?: number }) =>
    api.get("/api/v1/scholarships/fund-ledger", { params: params ?? {} }).then((r) => r.data as FundLedger),
  addAllocation: (fundId: number, d: { year?: number; amount: number; note?: string; source?: string }) =>
    api.post(`/api/v1/scholarships/funds/${fundId}/allocations`, d).then((r) => r.data),
  seasonCloseout: (year?: number) =>
    api.get("/api/v1/scholarships/season-closeout", { params: year ? { year } : {} }).then((r) => r.data as SeasonCloseout),
  expiringAwards: (params?: { year?: number; state?: string }) =>
    api.get("/api/v1/scholarships/expiring-awards", { params: params ?? {} }).then((r) => r.data as ExpiringAwards),
  clawBack: (awardId: number, note?: string) =>
    api.post(`/api/v1/scholarships/awards/${awardId}/claw-back`, note ? { note } : {}).then((r) => r.data),
};

export interface SponsorReports {
  lifetime_received: number;
  outstanding_pledged: number;
  by_season: { season: string; received: number }[];
  by_scope: { scope: Scope; count: number; received: number }[];
  by_state: { state: Lifecycle; count: number }[];
  by_tier: { tier: string; count: number; received: number }[];
  top_sponsors: { id: number; name: string; received: number }[];
}

export interface SponsorReminder {
  contribution_id: number; sponsor_id: number; sponsor_name: string;
  amount: number | null; in_kind: boolean; pledge_date: string | null; season: string;
}

export const TIER_COLORS: Record<string, string> = {
  Gold: "#c9a227", Silver: "#8d96a3", Bronze: "#b06a34",
  "In-Kind Partner": "#6a1b9a", "Community Supporter": "#4e7a51",
};
export const tierColor = (tier: string | null) => (tier && TIER_COLORS[tier]) || "#94a3b8";

export const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
