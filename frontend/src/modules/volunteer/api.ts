import { api } from "../../core/api";

export interface VolunteerIntro {
  org_name: string;
  open: boolean;
  intro: string;
  interests: string[];
}

export interface VolunteerSubmitResult {
  ok: boolean;
  existing?: boolean;
  member_id?: number;
  welcome_email_sent?: boolean;
  login_url?: string;
  message?: string;
}

export const volunteerApi = {
  // Public (no login) — used by the embeddable volunteer sign-up form.
  intro: () => api.get("/api/v1/public/volunteer-signup").then((r) => r.data as VolunteerIntro),
  // Account track: creates a Volunteer member.
  submit: (payload: Record<string, unknown>) =>
    api.post("/api/v1/public/volunteer-signup", payload).then((r) => r.data as VolunteerSubmitResult),
  // Mailing-list track: just captures a contact, no account.
  subscribe: (payload: Record<string, unknown>) =>
    api.post("/api/v1/public/mailing-list", payload).then((r) => r.data as VolunteerSubmitResult),
  // Camps & programs mailing list (QR code / website link) — standalone contact capture.
  programInterest: (payload: Record<string, unknown>) =>
    api.post("/api/v1/public/program-interest", payload).then((r) => r.data as VolunteerSubmitResult),
};
