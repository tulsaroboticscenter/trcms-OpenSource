import { api } from "../../core/api";

export interface SignupResponse { id: number; member_id: number | null; name: string; notes: string | null; is_me: boolean; }
export interface SignupSlot {
  id: number; area: string | null; title: string | null; slot_date: string | null;
  start_time: string | null; end_time: string | null; capacity: number; notes: string | null;
  sort_order: number; responses: SignupResponse[]; filled: number; is_full: boolean; me_signed_up: boolean;
}
export interface SignupData { event_id: number; can_manage: boolean; slots: SignupSlot[]; }

// "What are you bringing" / potluck sign-up (0207).
export interface BringSignup { id: number; member_id: number | null; name: string; qty: number; note: string | null; is_me: boolean; other_name?: string | null; }
export interface BringItem { id: number; name: string; qty_needed: number; notes: string | null; display_order: number; claimed_qty: number; remaining: number; signups: BringSignup[]; }
export interface BringData { event_id: number; bring_enabled: boolean; can_manage: boolean; items: BringItem[]; other_signups: BringSignup[]; }

export const bringApi = {
  list: (eventId: number) =>
    api.get(`/api/v1/events/${eventId}/bring`).then((r) => r.data as BringData),
  saveConfig: (eventId: number, body: { enabled: boolean; items: { id?: number; name: string; qty_needed: number; notes?: string | null }[] }) =>
    api.post(`/api/v1/events/${eventId}/bring`, body).then((r) => r.data as BringData),
  signUp: (eventId: number, body: { bring_item_id?: number | null; other_name?: string; qty: number; note?: string }) =>
    api.post(`/api/v1/events/${eventId}/bring/signup`, body).then((r) => r.data as BringData),
  cancel: (signupId: number) =>
    api.delete(`/api/v1/events/bring/signups/${signupId}`).then((r) => r.data as BringData),
};

// Transportation planning (0221) — "How will you get to this event?"
// A single leg's answer (ride to the event, or ride back).
export type TransportLeg = "have" | "need" | "drive" | "not_sure";
export type TransportWhich = "to" | "back";
export interface TransportRow { member_id: number; name: string; ride_to: TransportLeg | null; ride_back: TransportLeg | null; seats_available: number | null; assigned_driver_to_id: number | null; assigned_driver_back_id: number | null; rsvp_status?: string | null; note: string | null; is_me: boolean; }
export interface TransportRider { member_id: number; name: string; note: string | null; rsvp_status?: string | null; }
export interface TransportDriver { member_id: number; name: string; seats: number | null; note: string | null; riders: TransportRider[]; filled: number; open_seats: number | null; }
export interface TransportLegPlan { drivers: TransportDriver[]; unassigned_riders: TransportRider[]; have_ride: TransportRider[]; }
export interface TransportPlan { to: TransportLegPlan; back: TransportLegPlan; }
export interface TransportYouth { member_id: number; name: string; ride_to: TransportLeg | null; ride_back: TransportLeg | null; seats_available: number | null; note: string | null; }
export interface TransportData {
  event_id: number; transport_enabled: boolean; can_manage: boolean;
  my_response: TransportRow | null;
  my_youth: TransportYouth[];
  summary: { need_to: number; need_back: number; drive_to: number; drive_back: number; have_to: number; have_back: number; seats_to: number; seats_back: number };
  responses: TransportRow[];
  plan: TransportPlan | null;
}
export const transportApi = {
  list: (eventId: number) =>
    api.get(`/api/v1/events/${eventId}/transport`).then((r) => r.data as TransportData),
  setEnabled: (eventId: number, enabled: boolean) =>
    api.post(`/api/v1/events/${eventId}/transport/config`, { enabled }).then((r) => r.data as TransportData),
  respond: (eventId: number, body: { ride_to?: TransportLeg | null; ride_back?: TransportLeg | null; seats_available?: number | null; note?: string; member_id?: number }) =>
    api.post(`/api/v1/events/${eventId}/transport/respond`, body).then((r) => r.data as TransportData),
  assign: (eventId: number, riderMemberId: number, driverMemberId: number | null, leg: TransportWhich) =>
    api.post(`/api/v1/events/${eventId}/transport/assign`, { rider_member_id: riderMemberId, driver_member_id: driverMemberId, leg }).then((r) => r.data as TransportData),
};

// FLL attendance quick-tracking kiosk (0228) — roster grid of check-in / check-out boxes.
export type FllAttState = "none" | "in" | "out";
export interface FllAttMember {
  member_id: number; first_name: string; last_name: string; name: string;
  member_type: string; state: FllAttState; time_in: string | null; time_out: string | null;
}
export interface FllAttTeam {
  team_season_id: number; team_name: string; team_number: string;
  program: string; program_id: number; members: FllAttMember[];
}
export interface FllAttEvent { id: number; name: string; event_date: string; start_time: string | null; end_time: string | null; checked_in?: number; }
export interface FllAttRoster { event: FllAttEvent; season: string; teams: FllAttTeam[]; }
export interface FllAttMarkResult { ok: boolean; warning?: boolean; member_id: number; state: FllAttState; message?: string; time_in?: string | null; time_out?: string | null; }
export const fllAttendanceApi = {
  today: () =>
    api.get(`/api/v1/fll-attendance/today`).then((r) => r.data as { today: string; events: FllAttEvent[] }),
  roster: (eventId: number) =>
    api.get(`/api/v1/fll-attendance/roster`, { params: { event_id: eventId } }).then((r) => r.data as FllAttRoster),
  mark: (eventId: number, memberId: number, field: "in" | "out", value: boolean) =>
    api.post(`/api/v1/fll-attendance/mark`, { event_id: eventId, member_id: memberId, field, value }).then((r) => r.data as FllAttMarkResult),
  close: (eventId: number) =>
    api.post(`/api/v1/fll-attendance/close`, { event_id: eventId }).then((r) => r.data as { ok: boolean; closed: number; duration_minutes: number }),
};

export const signupsApi = {
  list: (eventId: number) =>
    api.get(`/api/v1/events/${eventId}/signups`).then((r) => r.data as SignupData),
  addSlot: (eventId: number, slot: Partial<SignupSlot>) =>
    api.post(`/api/v1/events/${eventId}/signups`, slot).then((r) => r.data as SignupData),
  bulk: (eventId: number, body: { areas: string[]; slot_date?: string; start_time?: string; end_time?: string; block_minutes?: number; capacity?: number }) =>
    api.post(`/api/v1/events/${eventId}/signups/bulk`, body).then((r) => r.data as SignupData),
  updateSlot: (slotId: number, patch: Partial<SignupSlot>) =>
    api.patch(`/api/v1/events/signups/slots/${slotId}`, patch).then((r) => r.data as SignupData),
  deleteSlot: (slotId: number) =>
    api.delete(`/api/v1/events/signups/slots/${slotId}`).then((r) => r.data as SignupData),
  signUp: (slotId: number, body?: { member_id?: number; guest_name?: string; notes?: string }) =>
    api.post(`/api/v1/events/signups/slots/${slotId}/signup`, body ?? {}).then((r) => r.data as SignupData),
  cancel: (responseId: number) =>
    api.delete(`/api/v1/events/signups/responses/${responseId}`).then((r) => r.data as SignupData),
};

export const eventsApi = {
  list: (params?: { from_date?: string; to_date?: string; event_type?: string }) =>
    api.get("/api/v1/events/", { params }).then((r) => r.data as { total: number; events: TRCEvent[] }),

  get: (id: number) =>
    api.get(`/api/v1/events/${id}`).then((r) => r.data as TRCEvent),

  getUpcoming: (days = 30) =>
    api.get("/api/v1/events/upcoming", { params: { days } }).then((r) => r.data as TRCEvent[]),

  birthdays: (month: number) =>
    api.get("/api/v1/events/birthdays", { params: { month } }).then((r) => r.data as { month: number; birthdays: Birthday[] }),

  getTypes: () =>
    api.get("/api/v1/events/types").then((r) => r.data as string[]),

  // Holidays overlay (#118) — federal (auto) + TRC closures, in a date range.
  getHolidays: (from: string, to: string) =>
    api.get("/api/v1/holidays", { params: { from, to } }).then((r) => r.data as Holiday[]),
  adminHolidays: () => api.get("/api/v1/admin/holidays").then((r) => r.data as TrcHoliday[]),
  createHoliday: (d: Partial<TrcHoliday>) => api.post("/api/v1/admin/holidays", d).then((r) => r.data as TrcHoliday[]),
  updateHoliday: (id: number, d: Partial<TrcHoliday>) => api.put(`/api/v1/admin/holidays/${id}`, d).then((r) => r.data as TrcHoliday[]),
  deleteHoliday: (id: number) => api.delete(`/api/v1/admin/holidays/${id}`).then((r) => r.data as TrcHoliday[]),

  // Calendar subscription (#43) — reveal/mint my personal feed token + URLs.
  getCalendarSubscription: () =>
    api.get("/api/v1/calendar/my-subscription").then((r) => r.data as CalendarSubscription),
  rotateCalendarToken: () =>
    api.post("/api/v1/calendar/my-subscription/rotate").then((r) => r.data as CalendarSubscription),

  getAttendance: (id: number) =>
    api.get(`/api/v1/events/${id}/attendance`).then((r) => r.data as EventAttendance),

  // Self-service RSVP
  getMyRsvp: (id: number) =>
    api.get(`/api/v1/events/${id}/my-rsvp`).then((r) => r.data as { status: string | null; participant_id: number | null }),
  rsvp: (id: number, status: "Attending" | "Not Attending" | "Maybe", memberId?: number) =>
    api.post(`/api/v1/events/${id}/rsvp`, memberId ? { status, member_id: memberId } : { status }).then((r) => r.data),
  bulkRsvp: (eventIds: number[], status: "Attending" | "Not Attending" | "Maybe") =>
    api.post(`/api/v1/events/rsvp-bulk`, { event_ids: eventIds, status }).then((r) => r.data as { ok: boolean; status: string; updated: number }),
  listParticipants: (id: number, sync = false) =>
    api.get(`/api/v1/events/${id}/participants`, { params: sync ? { sync: 1 } : {} }).then((r) => r.data as EventParticipantData),
  getMemberUpcomingEvents: (memberId: number) =>
    api.get(`/api/v1/members/${memberId}/upcoming-events`).then((r) => r.data as MemberUpcomingEvent[]),
  getTeamEvents: (teamSeasonId: number, includePast = false) =>
    api.get(`/api/v1/events/team/${teamSeasonId}`, { params: { include_past: includePast } }).then((r) => r.data as TeamEvent[]),

  create: (data: Record<string, unknown>) =>
    api.post("/api/v1/events/", data).then((r) => r.data as TRCEvent),

  update: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/events/${id}`, data).then((r) => r.data as TRCEvent),

  delete: (id: number) =>
    api.delete(`/api/v1/events/${id}`).then((r) => r.data),

  // Recurring events
  createRecurring: (data: Record<string, unknown>) =>
    api.post("/api/v1/events/recurring", data).then((r) => r.data as RecurringCreateResult),

  previewRecurrence: (startDate: string, options: RecurrenceOptions) =>
    api.post("/api/v1/events/preview-recurrence", options, {
      params: { start_date: startDate },
    }).then((r) => r.data as RecurrencePreview),

  getRecurrenceGroup: (groupId: string) =>
    api.get(`/api/v1/events/recurring/${groupId}`).then((r) => r.data as TRCEvent[]),

  deleteRecurrenceGroup: (groupId: string, fromDate?: string) =>
    api.delete(`/api/v1/events/recurring/${groupId}`, {
      params: fromDate ? { from_date: fromDate } : {},
    }).then((r) => r.data),

  getLogistics: (eventId: number) =>
    api.get(`/api/v1/events/${eventId}/logistics`).then((r) => r.data as EventLogistics),

  saveLogistics: (eventId: number, data: Record<string, unknown>) =>
    api.put(`/api/v1/events/${eventId}/logistics`, data).then((r) => r.data as EventLogistics),

  // ── Team fundraising ──
  getFundraising: (eventId: number) =>
    api.get(`/api/v1/events/${eventId}/fundraising`).then((r) => r.data as FundraisingConfig),
  setFundraisingAmount: (eventId: number, total_amount_available: number | null) =>
    api.put(`/api/v1/events/${eventId}/fundraising`, { total_amount_available }).then((r) => r.data),
  setFundraisingTeams: (eventId: number, team_season_ids: number[]) =>
    api.put(`/api/v1/events/${eventId}/fundraising/teams`, { team_season_ids }).then((r) => r.data as FundraisingConfig),
  setTeamExpected: (eventId: number, teamSeasonId: number, expected_amount: number | null) =>
    api.patch(`/api/v1/events/${eventId}/fundraising/teams/${teamSeasonId}`, { expected_amount }).then((r) => r.data),
  calculateFundraising: (eventId: number) =>
    api.post(`/api/v1/events/${eventId}/fundraising/calculate`).then((r) => r.data as FundraisingConfig),
  finalizeFundraising: (eventId: number) =>
    api.post(`/api/v1/events/${eventId}/fundraising/finalize`).then((r) => r.data as FundraisingConfig),
  getMyDistribution: (eventId: number, memberId?: number) =>
    api.get(`/api/v1/events/${eventId}/fundraising/my-distribution`, { params: memberId ? { member_id: memberId } : {} }).then((r) => r.data as MyDistribution),
  setMyDistribution: (eventId: number, team_season_ids: number[], memberId?: number) =>
    api.post(`/api/v1/events/${eventId}/fundraising/my-distribution`, { team_season_ids, ...(memberId ? { member_id: memberId } : {}) }).then((r) => r.data as { ok: boolean; re_finalized: boolean }),
  earningsTodo: (memberId: number) =>
    api.get(`/api/v1/members/${memberId}/earnings-todo`).then((r) => r.data as EarningsTodo[]),

  addRoom: (eventId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/events/${eventId}/rooms`, data).then((r) => r.data),

  updateRoom: (roomId: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/events/rooms/${roomId}`, data).then((r) => r.data),

  assignToRoom: (roomId: number, memberId: number) =>
    api.post(`/api/v1/events/rooms/${roomId}/assign`, { member_id: memberId }).then((r) => r.data),

  removeFromRoom: (roomId: number, memberId: number) =>
    api.delete(`/api/v1/events/rooms/${roomId}/assign/${memberId}`).then((r) => r.data),
};

export interface Birthday { member_id: number; name: string; member_type: string; day: number; }

export interface CalendarSubscription {
  token: string;
  personal_ics_url: string;
  personal_webcal_url: string;
  google_add_url: string;
  public_ics_url: string;
}

export interface FundraisingTeam { team_season_id: number; label: string; expected_amount: number | null; }
export interface FundraisingRosterRow {
  member_id: number; name: string; hours: number; earned: number;
  status: "none" | "auto" | "chosen" | "held" | "locked" | "unassigned"; team_season_ids: number[]; team_labels: string[];
}
export interface FundraisingConfig {
  event_id: number; event_name: string; enabled: boolean;
  benefits_season?: string | null;
  total_amount_available: number | null; hourly_rate: number; total_youth_hours: number;
  finalized_at: string | null;
  eligible_teams: FundraisingTeam[];
  all_teams: { team_season_id: number; label: string }[];
  roster: FundraisingRosterRow[]; held_count: number; unassigned_count?: number;
}
export interface MyDistribution {
  event_id: number; enabled: boolean; finalized: boolean;
  eligible_teams: { team_season_id: number; label: string }[];
  chosen_team_season_ids: number[]; needs_choice: boolean; single_team: number | null;
}
export interface EarningsTodo { event_id: number; event_name: string; event_date: string; }

export interface Holiday {
  date: string;
  end_date?: string | null;
  name: string;
  source: "federal" | "trc";
}

export interface TrcHoliday {
  id: number;
  name: string;
  holiday_date: string;
  end_date: string | null;
  recurring_annual: boolean;
}

export interface TRCEvent {
  id: number;
  name: string;
  rsvp?: { attending: number; maybe: number; not_attending: number };
  event_date: string;
  end_date?: string;   // set for multi-day events; undefined/null = single day
  start_time?: string;
  end_time?: string;
  location?: string;
  meeting_mode?: "in_person" | "remote" | "hybrid";
  remote_url?: string | null;
  remote_details?: string | null;
  details?: string;
  event_type?: string;
  is_informational?: boolean;
  is_tentative?: boolean;
  quicktrack_enabled?: boolean;
  coordinator_id?: number;
  coordinator_name?: string;
  post_to_public_calendar: boolean;
  mentor_coverage_met: boolean;
  mentors_attending?: number;
  mentor1_id?: number;
  mentor1_name?: string;
  mentor2_id?: number;
  mentor2_name?: string;
  requires_logistics: boolean;
  fundraising_opportunity?: boolean;
  benefits_season?: string | null;
  default_area_youth?: string | null;
  default_area_adult?: string | null;
  default_area_parent?: string | null;
  volunteer_open?: boolean;
  volunteer_signup_url?: string | null;
  volunteer_signup_note?: string | null;
  bring_enabled?: boolean;
  has_logistics: boolean;
  event_url?: string;
  is_recurring: boolean;
  recurrence_group_id?: string;
  recurrence_description?: string;
  recurrence_index?: number;
  team_season_ids?: number[];
  mentor_attending?: number;         // # mentors who RSVP'd Attending (calendar overlay)
  my_rsvp?: string | null;           // current user's RSVP status for this event
  created_at: string;
}

export interface RecurrenceOptions {
  pattern: "daily" | "weekly" | "biweekly" | "monthly" | "custom";
  interval: number;
  end_type: "occurrences" | "until_date";
  occurrences?: number;
  until_date?: string;
  days_of_week?: number[];
}

export interface RecurrencePreview {
  count: number;
  dates: string[];
  description: string;
  first_date?: string;
  last_date?: string;
}

export interface RecurringCreateResult {
  ok: boolean;
  recurrence_group_id: string;
  description: string;
  count: number;
  event_ids: number[];
  first_date: string;
  last_date: string;
}

export interface AttendanceMember {
  member_id: number;
  first_name: string;
  last_name: string;
  member_type: string;
  member_number: string;
  photo_url?: string;
  section_label: string;
  present: boolean;
  walk_in: boolean;
  still_in: boolean;
  hours: number;
}

export interface EventAttendance {
  event_id: number;
  total_attending: number;
  present_count: number;
  absent_count: number;
  walk_in_count: number;
  total_hours: number;
  hours_by_type: Record<string, number>;
  roster: AttendanceMember[];
}

export interface EventParticipantRec {
  id: number;
  member_id?: number;
  participant_type: string;
  other_name?: string;
  section_label: string;
  status: string;
  first_name?: string;
  last_name?: string;
  member_type?: string;
  photo_url?: string;
}

export interface EventParticipantSection {
  section_label: string;
  participants: EventParticipantRec[];
  count: number;
}

export interface EventParticipantData {
  sections: EventParticipantSection[];
  total: number;
  by_status: Record<string, number>;
  available_statuses: string[];
}

export interface MemberUpcomingEvent {
  event_id: number;
  rsvp_status: "Attending" | "Maybe";
  name: string;
  event_date: string;
  end_date?: string | null;
  start_time?: string | null;
  location?: string | null;
  event_type?: string | null;
}

export interface TeamEvent {
  category: string;
  event_id: number;
  name: string;
  event_date: string;
  end_date?: string | null;
  start_time?: string | null;
  location?: string | null;
  event_type?: string | null;
}

export interface HotelRoom {
  id: number;
  room_label: string;
  room_number?: string;
  room_type?: string;
  room_rate?: number;
  max_occupants?: number;
  confirmation_number?: string;
  canceled: boolean;
  cancellation_number?: string;
  paid_by_trc: boolean;
  reimbursement_amount?: number;
  reimbursement_by_id?: number;
  reimbursement_date?: string;
  reimbursement_method?: string;
  reimbursement_reference?: string;
  assignments: { id: number; member_id: number; member_name?: string }[];
}

export interface EventLogistics {
  id: number;
  event_id: number;
  logistics_lead_id?: number;
  destination_address?: string;
  meetup_location?: string;
  meetup_address?: string;
  meetup_time?: string;
  num_days?: number;
  travel_required: boolean;
  travel_lead_id?: number;
  participating_teams: number[];
  housing_needed: boolean;
  housing_arranger_id?: number;
  official_hotel_name?: string;
  hotel_address_line1?: string;
  hotel_address_line2?: string;
  hotel_city?: string;
  hotel_state?: string;
  hotel_zip?: string;
  hotel_contact_name?: string;
  hotel_contact_phone?: string;
  hotel_contact_email?: string;
  equipment_lead_id?: number;
  meal_coordinator_id?: number;
  budget_per_meal?: number;
  total_meal_budget?: number;
  youth_meal_contribution?: number;
  youth_meals_responsible_for?: number;
  meal_notes?: string | null;
  equipment_checklist: { item: string; checked: boolean; team_label?: string }[];
  hotel_rooms: HotelRoom[];
}

// ── Mentor unavailability (informational calendar overlay) ──────────────────
export interface MentorUnavailability {
  id: number;
  member_id: number;
  member_name: string;
  start_date: string;
  end_date: string;
  note: string | null;
  is_own: boolean;
}

export const mentorAvailabilityApi = {
  list: (from: string, to: string) =>
    api.get("/api/v1/mentor-unavailability", { params: { from, to } })
      .then(r => r.data as { entries: MentorUnavailability[]; can_see_all: boolean }),
  create: (payload: { start_date: string; end_date?: string; note?: string; member_id?: number }) =>
    api.post("/api/v1/mentor-unavailability", payload).then(r => r.data as { id: number }),
  update: (id: number, payload: Partial<{ start_date: string; end_date: string; note: string }>) =>
    api.put(`/api/v1/mentor-unavailability/${id}`, payload).then(r => r.data),
  remove: (id: number) =>
    api.delete(`/api/v1/mentor-unavailability/${id}`).then(r => r.data),
};
