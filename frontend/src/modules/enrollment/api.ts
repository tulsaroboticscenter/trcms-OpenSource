import { api } from "../../core/api";

export interface EnrollmentAlert {
  enrollment_id: number;
  member_id: number;
  member_name: string;
  program_label: string;
  needs_tc: boolean;
  unpaid: boolean;
  balance: number;
}

export interface ReceiptRecipient {
  to: string | null; cc: string | null;
  recipient_name: string; member_name: string;
  program_name: string | null; amount_due: number | null; payment_amount: number | null;
}

export const enrollmentApi = {
  /** Who a payment receipt would go to — for the confirmation dialog. Sends nothing. */
  receiptRecipient: (enrollmentId: number) =>
    api.get(`/api/v1/enrollment/${enrollmentId}/receipt-recipient`).then((r) => r.data as ReceiptRecipient),
  getCurrentYear: () =>
    api.get("/api/v1/enrollment/current-year").then((r) => r.data.enrollment_year as number),

  /** This season's enrollments (self + family youth) that still need T&C or payment. */
  myAlerts: () =>
    api.get("/api/v1/enrollment/my-alerts").then((r) => r.data as EnrollmentAlert[]),

  getByMember: (memberId: number) =>
    api.get(`/api/v1/enrollment/member/${memberId}`).then((r) => r.data),

  getById: (id: number) =>
    api.get(`/api/v1/enrollment/${id}`).then((r) => r.data),

  create: (data: Record<string, unknown>) =>
    api.post("/api/v1/enrollment/", data).then((r) => r.data),

  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/enrollment/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/api/v1/enrollment/${id}`).then((r) => r.data),

  /** Sign a portion of a youth enrollment. `responses` maps section key → true (acknowledge)
   *  or "grant"/"decline" (grant-decline sections). */
  signTC: (enrollmentId: number, signer: "youth" | "parent", signedBy: string, responses: ConsentResponses) =>
    api.post(`/api/v1/enrollment/${enrollmentId}/sign-tc`, { signer, signed_by: signedBy, responses })
       .then((r) => r.data),

  // ── Consent sections (admin-configurable catalog) ──
  getConsentSections: () => api.get("/api/v1/enrollment/consent-sections").then((r) => r.data as ConsentSection[]),
  setConsentSections: (sections: ConsentSection[]) =>
    api.put("/api/v1/enrollment/admin/consent-sections", { sections }).then((r) => r.data as ConsentSection[]),
  memberConsents: (memberId: number, year?: number) =>
    api.get(`/api/v1/enrollment/member/${memberId}/consents`, { params: year ? { year } : {} })
       .then((r) => r.data as MemberConsents),

  // ── Medical Consent & Emergency Information ──
  getMedical: (memberId: number, year: number) =>
    api.get(`/api/v1/medical/${memberId}`, { params: { year } }).then((r) => r.data as MedicalForm),
  saveMedical: (memberId: number, form: Partial<MedicalForm> & { year: number; treatment_authorized?: boolean }) =>
    api.post(`/api/v1/medical/${memberId}`, form).then((r) => r.data as { ok: boolean; signed: boolean }),

  /** Enrollee/guardian confirms shirt size + grade (+ birthday if missing) during registration. */
  saveDetails: (enrollmentId: number, d: { shirt_size?: string; grade?: number | null; birthday?: string }) =>
    api.post(`/api/v1/enrollment/${enrollmentId}/details`, d).then((r) => r.data as { ok: boolean; changed: Record<string, unknown> }),

  /** Convert this member's FDP enrollment to FTC/FRC at no additional cost (the fee already
   *  paid moves with it). Managers only. */
  transferFdpFee: (memberId: number, program: "FTC" | "FRC") =>
    api.post("/api/v1/fdp/transfer-fee", { member_id: memberId, program }).then((r) => r.data as { ok: boolean; moved: boolean }),

  /** Ask staff to set up a payment plan for this member's enrollment fees. */
  requestPaymentPlan: (memberId: number) =>
    api.post(`/api/v1/members/${memberId}/request-payment-plan`, {}).then((r) => r.data as { ok: boolean; sent_to: string; detail: string }),

  getHandbook: () => api.get("/api/v1/handbook").then((r) => r.data as HandbookLink),
  setHandbook: (data: HandbookLink) =>
    api.put("/api/v1/admin/handbook", data).then((r) => r.data as HandbookLink),
  uploadHandbook: (file: File, title?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (title) fd.append("title", title);
    return api.post("/api/v1/admin/handbook/upload", fd).then((r) => r.data as HandbookLink);
  },

  getFees: () => api.get("/api/v1/enrollment/fees").then((r) => r.data as EnrollmentFees),
  setFees: (base: number, additional_program: number) =>
    api.put("/api/v1/enrollment/fees", { base, additional_program }).then((r) => r.data as EnrollmentFees),
  previewFee: (memberId: number, programId: number, year: number) =>
    api.get("/api/v1/enrollment/preview-fee", { params: { member_id: memberId, program_id: programId, enrollment_year: year } })
       .then((r) => r.data.amount_due as number),

  // ── Payment plans ──
  getPaymentPlan: (enrollmentId: number) =>
    api.get(`/api/v1/enrollment/${enrollmentId}/payment-plan`).then((r) => r.data as PaymentPlan),
  createPaymentPlan: (enrollmentId: number, body: {
    scholarship_amount?: number;
    installments?: { due_date: string; amount: number; reminders_suppressed?: boolean }[];
    note?: string; reminders_suppressed?: boolean; send_confirmation?: boolean;
  }) =>
    api.post(`/api/v1/enrollment/${enrollmentId}/payment-plan`, body).then((r) => r.data as PaymentPlan),
  updatePaymentPlan: (enrollmentId: number, body: { reminders_suppressed?: boolean; note?: string }) =>
    api.patch(`/api/v1/enrollment/${enrollmentId}/payment-plan`, body).then((r) => r.data as PaymentPlan),
  sendPlanConfirmation: (enrollmentId: number) =>
    api.post(`/api/v1/enrollment/${enrollmentId}/payment-plan/send-confirmation`, {}).then((r) => r.data as PaymentPlan & { ok: boolean }),
  toggleInstallmentReminder: (installmentId: number, suppressed: boolean) =>
    api.patch(`/api/v1/enrollment/installments/${installmentId}/reminder`, { reminders_suppressed: suppressed }).then((r) => r.data as PaymentPlan),
  deletePaymentPlan: (enrollmentId: number) =>
    api.delete(`/api/v1/enrollment/${enrollmentId}/payment-plan`).then((r) => r.data as PaymentPlan),
  payInstallment: (installmentId: number, body: { method: string; paid_amount?: number; paid_date?: string; reference?: string; notes?: string }) =>
    api.post(`/api/v1/enrollment/installments/${installmentId}/pay`, body).then((r) => r.data as PaymentPlan),
  unpayInstallment: (installmentId: number) =>
    api.delete(`/api/v1/enrollment/installments/${installmentId}/pay`).then((r) => r.data as PaymentPlan),

  // Family-facing: the current parent's youth's pending installments.
  myPaymentPlans: () =>
    api.get("/api/v1/members/me/payment-plans").then((r) => r.data as MyPaymentPlans),
  payInstallmentOnline: (installmentId: number, provider: string, coverFee = false) =>
    api.post(`/api/v1/enrollment/installments/${installmentId}/pay-online`, { provider, cover_fee: coverFee })
       .then((r) => r.data as { payment_id: number; redirect_url: string }),
  sendPlanReminders: () =>
    api.post("/api/v1/enrollment/payment-plans/send-reminders", {}).then((r) => r.data as { ok: boolean; sent: number; skipped: number }),
};

export interface FamilyInstallment {
  installment_id: number; enrollment_id: number; seq: number; youth_name: string;
  program: string | null; due_date: string; amount: number; overdue: boolean;
}
export interface MyPaymentPlans { installments: FamilyInstallment[]; payments_enabled: boolean; }

export interface Installment {
  id: number; seq: number; due_date: string; amount: number; status: string;
  paid_date: string | null; paid_amount: number | null; method: string | null; reference: string | null; notes: string | null;
  reminders_suppressed: boolean;
}
export interface PaymentPlan {
  enrollment_id: number; has_plan: boolean; amount_due: number; scholarship_amount: number;
  family_total: number; family_paid: number; family_remaining: number;
  scheduled_total: number; schedule_matches: boolean;
  reminders_suppressed: boolean; note: string | null; confirmation_sent_at: string | null;
  next_due: { due_date: string; amount: number } | null; installments: Installment[];
}

export interface EnrollmentFees { base: number; additional_program: number; }

/** A configurable consent/waiver section. `audiences` decides which signing
 *  screens show it (youth / parent / mentor / volunteer). */
export type ConsentAudience = "youth" | "parent" | "mentor" | "volunteer";
export interface ConsentSection {
  key: string;
  title: string;
  body: string;
  response_type: "acknowledge" | "grant_decline";
  required: boolean;
  audiences: ConsentAudience[];
}
/** Signer's answers: section key → true (acknowledge) or "grant"/"decline". */
export type ConsentResponses = Record<string, boolean | "grant" | "decline">;
/** What a member was asked to agree to for a season, and how they responded. */
export interface MemberConsents {
  member_id: number;
  enrollment_year: number;
  sections: {
    key: string; title: string; response_type: "acknowledge" | "grant_decline";
    applicable: boolean; response: "agreed" | "granted" | "declined" | "pending" | "na"; agreed_at: string | null;
  }[];
}
/** Admin-configurable TRC Handbook link (blank url until an admin sets it). */
export interface HandbookLink { url: string; title: string; }

export interface MedicalForm {
  member_id: number;
  member_name: string;
  member_type: string;
  is_youth: boolean;
  birthday: string | null;
  enrollment_year: number;
  on_file: boolean;
  signed_at: string | null;
  signed_name: string | null;
  coverage_start: string;
  coverage_end: string;
  contact_address: string | null;
  contact_city_state: string | null;
  contact_zip: string | null;
  guardian1_name: string | null;
  guardian1_phone: string | null;
  guardian2_name: string | null;
  guardian2_phone: string | null;
  alt_contact_name: string | null;
  alt_contact_relationship: string | null;
  alt_contact_phone: string | null;
  ins_company: string | null;
  ins_member_phone: string | null;
  ins_policy: string | null;
  ins_group: string | null;
  otc_permission: "give" | "decline" | null;
  health_problems: string | null;
  food_allergies: string | null;
  environmental_allergies: string | null;
  medication_allergies: string | null;
  medications_current: string | null;
  accommodations: string | null;
  notes: string | null;
  self_administer: boolean | null;
}

export const programsApi = {
  list: () => api.get("/api/v1/programs/").then((r) => r.data as Program[]),
};

export interface Program {
  id: number;
  name: string;
  full_name?: string;
  affiliation?: string;
  age_range?: string;
  status: string;
}

export interface Enrollment {
  id: number;
  member_id: number;
  program_id: number;
  program_name?: string;
  program_full_name?: string;
  enrollment_year: number;
  enrollment_year_label: string;
  status: string;
  date_enrolled?: string;
  date_payment?: string;
  payment_amount?: number;
  amount_due?: number | null;
  amount_due_overridden?: boolean;
  balance?: number;
  financials?: {
    fee_gross: number;
    scholarship_credit: number;
    scholarship_lines: { amount: number; fund_name: string; date: string | null }[];
    school_credit?: number;
    school_lines?: { amount: number; source: string; date: string | null }[];
    payment_lines: { amount: number; method: string; date: string | null; reference: string | null }[];
    paid_total: number;
    balance: number;
  };
  payment_override: boolean;
  payment_method?: string;
  payment_reference?: string;
  scholarship_fund?: string;
  shirt_size?: string;
  grade?: number | null;
  grade_label?: string | null;
  member_birthday?: string | null;
  member_type?: string | null;
  tc_youth_agreed: boolean;
  tc_youth_date?: string;
  tc_parent_agreed: boolean;
  tc_parent_date?: string;
  fully_signed: boolean;
  waiver_liability_agreed?: boolean;
  waiver_firstaid_agreed?: boolean;
  waiver_privacy_agreed?: boolean;
  media_release_granted?: boolean | null;
  waivers_agreed_at?: string;
  notes?: string;
}
