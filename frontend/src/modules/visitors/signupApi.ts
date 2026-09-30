import { api } from "../../core/api";

/** Public, tokenised visitor join flow — no login. */
export interface JoinVisitor {
  visitor_id: number;
  first_name: string; middle_name: string | null; last_name: string;
  birthday: string | null; email: string | null; phone: string | null;
  address_line1: string | null; address_line2: string | null;
  city: string | null; state: string | null; zip_code: string | null;
  program_interest_id: number | null;
}

export interface JoinForm {
  org_name: string;
  visitor: JoinVisitor;
  siblings: JoinVisitor[];
  guardian: { name: string | null; email: string | null; phone: string | null };
  programs: { id: number; name: string }[];
  expires_at: string | null;
}

export interface JoinResult {
  ok: boolean;
  created: { member_id: number; name: string; type: string }[];
  /** Already had an account — linked, not duplicated. They keep their existing login. */
  existing: { name: string; type: string }[];
  emails: { name: string; sent: boolean; to: string | null }[];
  email_problems: string[];
  login_url: string;
}

export interface YouthMedical {
  alt_contact_name?: string;
  alt_contact_relationship?: string;
  alt_contact_phone?: string;
  health_problems?: string;
  food_allergies?: string;
  environmental_allergies?: string;
  medication_allergies?: string;
  medications_current?: string;
  otc_permission?: "give" | "decline" | "";
}
export interface JoinYouth {
  visitor_id: number;
  first_name: string;
  last_name: string;
  birthday: string | null;
  email: string | null;
  program_id: number | null;
  grade?: number | null;
  sex?: string;
  shirt_size?: string;
  race?: string;
  medical?: YouthMedical;
}
export interface JoinSubmission {
  create_guardian_account: boolean;
  guardian: { name: string; email: string; phone: string };
  youth: JoinYouth[];
}

export const visitorSignupApi = {
  resolve: (token: string) =>
    api.get(`/api/v1/public/visitor-signup/${token}`).then((r) => r.data as JoinForm),

  submit: (token: string, body: JoinSubmission) =>
    api.post(`/api/v1/public/visitor-signup/${token}`, body).then((r) => r.data as JoinResult),

  /** Staff-side: mint a link for a one-off email. */
  mintLink: (visitorId: number) =>
    api.post(`/api/v1/visitors/${visitorId}/signup-link`, {}).then((r) => (r.data as { url: string }).url),
};
