import { api } from "../../core/api";

export interface PaymentOption { key: string; label: string; fee_pct?: number; fee_fixed?: number; }
export interface PaymentOptions { enabled: boolean; providers: PaymentOption[]; }

export interface QuoteProvider { key: string; label: string; fee: number; total_with_fee: number; }
export interface PaymentQuote { base: number; enabled: boolean; providers: QuoteProvider[]; }

export interface PayableEnrollment { enrollment_id: number; label: string; balance: number; fully_signed: boolean; }
export interface MemberPayQuote {
  base: number;
  enabled: boolean;
  enrollments: PayableEnrollment[];          // T&C signed → payable
  unsigned_enrollments: PayableEnrollment[]; // unpaid but T&C not yet signed
  providers: QuoteProvider[];
  shirt_size: string;                        // youth's current shirt size (to verify)
  waitlisted: boolean;                       // on the waitlist this season → don't pay yet
}

export interface FamilyFees { base: number; additional_program: number; second_youth_base: number; third_plus_youth_base: number; }
export interface FamilyPayEnrollment {
  enrollment_id: number; program_id: number; label: string; balance: number;
  amount_due_overridden: boolean; fully_signed: boolean; shirt_ok: boolean; ready: boolean;
  scholarship_credit: number; scholarship_fund?: string | null; fee_gross: number;
}
export interface FamilyPayYouth { member_id: number; name: string; waitlisted: boolean; enrollments: FamilyPayEnrollment[]; }
export interface FamilyPayQuote {
  year: number; year_label: string; fees: FamilyFees; paid_youth_count: number;
  youth: FamilyPayYouth[]; enabled: boolean; providers: { key: string; label: string }[];
}

export const paymentsApi = {
  /** The parent's whole-family checkout data (all youth + payable enrollments). */
  getFamilyPayQuote: () =>
    api.get("/api/v1/members/me/family-pay-quote").then((r) => r.data as FamilyPayQuote),

  /** One rolled-up invoice across selected youth enrollments + optional donation. */
  payFamily: (enrollmentIds: number[], provider: string, coverFee: boolean, donationAmount: number) =>
    api.post("/api/v1/members/me/pay-family", { enrollment_ids: enrollmentIds, provider, cover_fee: coverFee, donation_amount: donationAmount })
       .then((r) => r.data as { payment_id: number; redirect_url: string; enroll_base: number; donation: number; base: number; fee: number; total: number }),

  /** Which providers the UI may offer (empty/disabled until configured on the server). */
  getOptions: () =>
    api.get("/api/v1/payments/options").then((r) => r.data as PaymentOptions),

  /** Base due + per-provider fee/total for the "cover the fee" toggle. */
  getEnrollmentQuote: (enrollmentId: number) =>
    api.get(`/api/v1/enrollments/${enrollmentId}/pay-quote`).then((r) => r.data as PaymentQuote),

  /** Start a hosted checkout for an enrollment; returns where to send the payer. */
  payEnrollment: (enrollmentId: number, provider: string, coverFee: boolean) =>
    api.post(`/api/v1/enrollments/${enrollmentId}/pay`, { provider, cover_fee: coverFee })
       .then((r) => r.data as { payment_id: number; redirect_url: string }),

  /** Start a one-time donation checkout; returns where to send the donor. */
  donate: (provider: string, amount: number, coverFee: boolean, note?: string) =>
    api.post("/api/v1/payments/donate", { provider, amount, cover_fee: coverFee, note })
       .then((r) => r.data as { payment_id: number; redirect_url: string }),

  /** Confirm a youth's shirt size without paying (e.g. while waitlisted). */
  saveMemberShirt: (memberId: number, shirtSize: string) =>
    api.post(`/api/v1/members/${memberId}/shirt-size`, { shirt_size: shirtSize }).then((r) => r.data as { ok: boolean; shirt_size: string }),

  /** Combined per-youth quote: all their unpaid enrollments + a single total. */
  getMemberPayQuote: (memberId: number) =>
    api.get(`/api/v1/members/${memberId}/pay-quote`).then((r) => r.data as MemberPayQuote),

  /** One checkout for all of a youth's T&C-signed, unpaid enrollments (+ optional donation). */
  payMemberEnrollments: (memberId: number, provider: string, coverFee: boolean, shirtSize: string, donationAmount = 0) =>
    api.post(`/api/v1/members/${memberId}/pay-enrollments`, { provider, cover_fee: coverFee, shirt_size: shirtSize, donation_amount: donationAmount })
       .then((r) => r.data as { payment_id: number; redirect_url: string }),
};
