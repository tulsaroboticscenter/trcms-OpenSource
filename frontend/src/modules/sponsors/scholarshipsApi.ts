import { api } from "../../core/api";

export interface ScholarshipAward {
  id: number; fund_id: number | null; fund_name?: string | null;
  member_id: number | null; enrollment_id: number | null;
  amount: number; note?: string | null; status: string; created_at: string;
}

export interface ApplicationEnrollment {
  enrollment_id: number; member_id: number; youth_name: string; program: string;
  amount_due: number; paid: number; balance: number; status: string;
}
export interface ApplicationEnrollments {
  year: number; applicant_member_id: number; enrollments: ApplicationEnrollment[];
}

export interface ScholarshipApplication {
  id: number;
  status: string;
  enrollment_year: number | null;
  submitted_by_id: number | null;
  member_id: number | null;
  contact_email?: string; contact_name?: string; contact_phone?: string;
  program?: string; program_other?: string | null;
  youth_name?: string; youth_grade_school?: string | null; choose_one?: string | null;
  household_size?: number | null; youth_count?: number | null; frl_eligible?: string | null;
  need_explanation?: string | null; certified?: boolean;
  registration_cost?: number | null;
  contribution_amount?: number | null;
  amount_requested?: number | null;
  received_before?: boolean | null;
  narrative?: string | null; referral?: string | null; optional_info?: string | null;
  answers?: Record<string, unknown> | null;
  reviewer_id?: number | null; review_notes?: string | null; decision_amount?: number | null;
  reviewed_at?: string | null; created_at: string;
  awards?: ScholarshipAward[]; awarded_total?: number;
}

export interface ScholarshipFund {
  id: number; name: string; description?: string; is_active: boolean;
  balance: number; available: number; awarded: number; contribution_count: number;
}

export interface NewApplication {
  contact_email: string; contact_name: string; contact_phone: string;
  program: string; program_other?: string;
  youth_name: string; youth_grade_school?: string; choose_one?: string;
  household_size?: number | string; youth_count?: number | string; frl_eligible?: string;
  need_explanation?: string; certified?: boolean;
  member_id?: number | null;
  registration_cost?: number; contribution_amount?: number | string;
  received_before?: boolean;
  narrative?: string; referral?: string; optional_info?: string;
}

export interface PrefillYouth {
  member_id: number;
  name: string;
  graduation_year: number | null;
  school: string | null;
  program_name: string | null;
  /** The youth's real amount due for this season; null when not enrolled yet. */
  registration_cost: number | null;
  received_before: boolean;
}
export interface ApplicationPrefill {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  youth: PrefillYouth[];
  youth_count: number | null;
  household_size: number | null;
  enrollment_year: number;
}

export const scholarshipsApi = {
  submit: (data: NewApplication) =>
    api.post("/api/v1/scholarships/applications", data).then((r) => r.data as ScholarshipApplication),
  mine: () =>
    api.get("/api/v1/scholarships/applications/mine").then((r) => r.data as ScholarshipApplication[]),
  /** What we already know about the applicant and their youth, to pre-fill the form. */
  applicationPrefill: () =>
    api.get("/api/v1/scholarships/applications/prefill").then((r) => r.data as ApplicationPrefill),
  list: (params?: { status?: string; enrollment_year?: number }) =>
    api.get("/api/v1/scholarships/applications", { params }).then((r) => r.data as ScholarshipApplication[]),
  get: (id: number) =>
    api.get(`/api/v1/scholarships/applications/${id}`).then((r) => r.data as ScholarshipApplication),
  review: (id: number, data: { status?: string; review_notes?: string; decision_amount?: number | null }) =>
    api.patch(`/api/v1/scholarships/applications/${id}/review`, data).then((r) => r.data as ScholarshipApplication),
  /** Delete an application (e.g. a duplicate). Refused server-side if a live award is attached. */
  remove: (id: number) =>
    api.delete(`/api/v1/scholarships/applications/${id}`).then((r) => r.data),
  award: (id: number, data: { fund_id: number; amount: number; member_id?: number | null; enrollment_id?: number | null; note?: string }) =>
    api.post(`/api/v1/scholarships/applications/${id}/award`, data).then((r) => r.data as ScholarshipApplication),
  /** Enrollments an award can be applied against — the applicant + family siblings, this season. */
  applicationEnrollments: (id: number) =>
    api.get(`/api/v1/scholarships/applications/${id}/enrollments`).then((r) => r.data as ApplicationEnrollments),
  reverseAward: (awardId: number) =>
    api.post(`/api/v1/scholarships/awards/${awardId}/reverse`).then((r) => r.data),
  /** (Re)send the staff notice + applicant confirmation for an application. */
  resendNotifications: (id: number) =>
    api.post(`/api/v1/scholarships/applications/${id}/notify`).then((r) => r.data as { ok: boolean; staff: string; applicant: string }),
  funds: () =>
    api.get("/api/v1/scholarships/funds").then((r) => r.data as ScholarshipFund[]),
};
