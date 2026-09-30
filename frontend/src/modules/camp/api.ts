import { api } from "../../core/api";

export interface CampSeason {
  id: number;
  year: number;
  name: string;
  registration_open: boolean;
  intro_text?: string | null;
  waiver_liability?: string | null;
  waiver_media?: string | null;
  waiver_firstaid?: string | null;
  is_active: boolean;
}

export interface CampProgram {
  id: number;
  name: string;
  description?: string | null;
  display_order: number;
  is_active: boolean;
}

export interface CampSession {
  id: number;
  season_id: number;
  program_id?: number | null;
  program_name?: string | null;
  title: string;
  week_label?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  age_band?: string | null;
  price?: number | null;
  capacity?: number | null;
  public_blurb?: string | null;
  event_id?: number | null;
  is_open: boolean;
  display_order: number;
  registered_count: number;
}

export const campApi = {
  listSeasons: () => api.get("/api/v1/camp/seasons").then((r) => r.data as CampSeason[]),
  currentSeason: () => api.get("/api/v1/camp/seasons/current").then((r) => r.data as CampSeason | null),
  saveSeason: (data: Partial<CampSeason>) =>
    (data.id
      ? api.patch(`/api/v1/camp/seasons/${data.id}`, data)
      : api.post("/api/v1/camp/seasons", data)).then((r) => r.data as CampSeason),
  toggleRegistration: (seasonId: number, open: boolean) =>
    api.patch(`/api/v1/camp/seasons/${seasonId}/registration`, { registration_open: open })
       .then((r) => r.data as { ok: boolean; registration_open: boolean }),

  listPrograms: () => api.get("/api/v1/camp/programs").then((r) => r.data as CampProgram[]),
  saveProgram: (data: Partial<CampProgram>) =>
    (data.id
      ? api.patch(`/api/v1/camp/programs/${data.id}`, data)
      : api.post("/api/v1/camp/programs", data)).then((r) => r.data as CampProgram),

  listSessions: (seasonId: number) =>
    api.get("/api/v1/camp/sessions", { params: { season_id: seasonId } }).then((r) => r.data as CampSession[]),
  saveSession: (data: Partial<CampSession>) =>
    (data.id
      ? api.patch(`/api/v1/camp/sessions/${data.id}`, data)
      : api.post("/api/v1/camp/sessions", data)).then((r) => r.data as CampSession),
  deleteSession: (id: number) =>
    api.delete(`/api/v1/camp/sessions/${id}`).then((r) => r.data),

  listRegistrations: (params: { season_id?: number; session_id?: number; status?: string }) =>
    api.get("/api/v1/camp/registrations", { params }).then((r) => r.data as CampRegistration[]),
  updateRegistration: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/camp/registrations/${id}`, data).then((r) => r.data as CampRegistration),
  createRegistration: (data: Record<string, unknown>) =>
    api.post(`/api/v1/camp/registrations`, data).then((r) => r.data as CampRegistration),
  convertToMember: (camperId: number) =>
    api.post(`/api/v1/camp/campers/${camperId}/convert-to-member`).then((r) => r.data as { ok: boolean; member_id: number }),
  // #85 — resolve the distinct, opted-in parent contacts for a filtered set of
  // registrations (de-duped by email). The send itself reuses comms/send-bulk.
  emailRecipients: (params: { season_id?: number; program_id?: number; session_id?: number; session_ids?: string; status?: string; statuses?: string }) =>
    api.get("/api/v1/camp/email-recipients", { params }).then((r) => r.data as CampEmailRecipient[]),
  getAttendance: (sessionId: number) =>
    api.get(`/api/v1/camp/sessions/${sessionId}/attendance`).then((r) => r.data as CampAttendance),
  markAttendance: (registrationId: number, dayDate: string, present: boolean) =>
    api.post("/api/v1/camp/attendance", { registration_id: registrationId, day_date: dayDate, present }).then((r) => r.data),
  listStaffApps: (seasonId?: number) =>
    api.get("/api/v1/camp/staff-apps", { params: seasonId ? { season_id: seasonId } : {} }).then((r) => r.data as CampStaffApp[]),
  saveStaffApp: (data: Partial<CampStaffApp>) =>
    (data.id
      ? api.patch(`/api/v1/camp/staff-apps/${data.id}`, data)
      : api.post("/api/v1/camp/staff-apps", data)).then((r) => r.data as { ok: boolean; id: number }),

  listContacts: (params: { consent?: number; search?: string } = {}) =>
    api.get("/api/v1/camp/contacts", { params }).then((r) => r.data as CampContact[]),
  updateContact: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/camp/contacts/${id}`, data).then((r) => r.data),
  exportContactsUrl: (consentOnly: boolean) => `${api.defaults.baseURL}/api/v1/camp/contacts/export${consentOnly ? "?consent=1" : ""}`,
  report: (seasonId?: number) =>
    api.get("/api/v1/camp/report", { params: seasonId ? { season_id: seasonId } : {} }).then((r) => r.data as CampReport),
  importContacts: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post("/api/v1/camp/import-contacts", fd).then((r) => r.data as { ok: boolean; contacts_created: number; campers_created: number; registrations_created: number; errors: string[] });
  },
  importStaff: (file: File, seasonId?: number) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post("/api/v1/camp/import-staff", fd, { params: seasonId ? { season_id: seasonId } : {} }).then((r) => r.data as { ok: boolean; created: number; errors: string[] });
  },

  // Resources (#68) — planning links grouped by General + per-week buckets.
  listResources: (seasonId?: number) =>
    api.get("/api/v1/camp/resources", { params: seasonId ? { season_id: seasonId } : {} }).then((r) => r.data as CampResource[]),
  saveResource: (data: Partial<CampResource>) =>
    (data.id
      ? api.patch(`/api/v1/camp/resources/${data.id}`, data)
      : api.post("/api/v1/camp/resources", data)).then((r) => r.data as CampResource),
  deleteResource: (id: number) =>
    api.delete(`/api/v1/camp/resources/${id}`).then((r) => r.data),

  // Staffing — who worked each camp, derived from the linked event's check-ins.
  getStaffing: (seasonId?: number) =>
    api.get("/api/v1/camp/staffing", { params: seasonId ? { season_id: seasonId } : {} }).then((r) => r.data as CampStaffing),
  assignWorker: (sessionId: number, memberId: number, assigned: boolean) =>
    api.post("/api/v1/camp/staffing/assign", { session_id: sessionId, member_id: memberId, assigned })
       .then((r) => r.data as { ok: boolean; session_id: number; member_id: number; assigned: boolean }),

  // Public (no-login) — used by the embeddable registration form.
  publicRegistration: () =>
    api.get("/api/v1/camp/public/registration").then((r) => r.data as PublicRegistration),
  publicRegister: (payload: Record<string, unknown>) =>
    api.post("/api/v1/camp/public/register", payload).then((r) => r.data as { ok: boolean; registered: number; message?: string }),
};

export interface CampEmailRecipient {
  email: string;
  name: string;
  campers: string[];
  vars?: Record<string, string>;
}

export interface CampContact {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  marketing_consent: boolean;
  opt_out: boolean;
  source?: string | null;
  member_id?: number | null;
  camper_count: number;
}

export interface CampReport {
  camper_shirts: Record<string, number>;
  staff_shirts: Record<string, number>;
  by_camp: { title: string; week_label?: string | null; registered: number; confirmed: number; paid: number }[];
}

export interface CampRegistration {
  id: number;
  session_id: number;
  session_title?: string | null;
  camper: { id: number; first_name: string; last_name?: string | null; grade?: string | null; school?: string | null;
    shirt_size?: string | null; medical_notes?: string | null; food_allergies?: string | null; accommodations?: string | null;
    prior_experience?: string | null; member_id?: number | null };
  contact: { id?: number | null; name?: string | null; email?: string | null; phone?: string | null };
  status: string;
  payment_method?: string | null;
  payment_status: string;
  confirmation_sent: boolean;
  shirt_size?: string | null;
  shirt_received: boolean;
  emergency1_name?: string | null; emergency1_relation?: string | null; emergency1_phone?: string | null;
  emergency2_name?: string | null; emergency2_relation?: string | null; emergency2_phone?: string | null;
  waiver_liability_agreed: boolean; waiver_media_agreed: boolean; waiver_firstaid_agreed: boolean;
  waiver_agreed_by?: string | null; waiver_agreed_at?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface CampAttendance {
  session: { id: number; title: string };
  days: string[];
  campers: { registration_id: number; name: string; present: Record<string, boolean> }[];
}

export interface CampStaffApp {
  id: number;
  season_id?: number | null;
  member_id?: number | null;
  member_name?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  affiliation?: string | null;
  sessions_applied?: string | null;
  roles_applied?: string | null;
  prior_summers?: string | null;
  first_experience?: string | null;
  shirt_size?: string | null;
  why_interested?: string | null;
  qualifications?: string | null;
  status: string;
  notes?: string | null;
}

export interface CampResource {
  id: number;
  season_id: number;
  bucket: "general" | "week1" | "week2" | "week3";
  title: string;
  url?: string | null;
  resource_type?: string | null;
  notes?: string | null;
  display_order: number;
}

export interface CampStaffWorker {
  member_id: number;
  name: string;
  minutes: number;
  hours: number;
  days: number;
  open_count: number;
  assigned_session_ids: number[];
  is_floater: boolean;
}
export interface CampStaffWeek {
  event_id: number;
  event_name: string;
  event_date?: string | null;
  end_date?: string | null;
  camps: { session_id: number; title: string; week_label?: string | null }[];
  workers: CampStaffWorker[];
}
export interface CampStaffing {
  season_id: number;
  weeks: CampStaffWeek[];
}

export interface PublicSession {
  id: number;
  title: string;
  program_name?: string | null;
  week_label?: string | null;
  age_band?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  price?: number | null;
  public_blurb?: string | null;
  spots_left?: number | null;
  is_full: boolean;
}

export interface PublicRegistration {
  open: boolean;
  message?: string;
  season?: {
    name: string;
    intro_text?: string | null;
    waiver_liability?: string | null;
    waiver_media?: string | null;
    waiver_firstaid?: string | null;
  };
  sessions?: PublicSession[];
}
