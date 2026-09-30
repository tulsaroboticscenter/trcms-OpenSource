import { api } from "../../core/api";

export interface OpportunityEvent {
  id: number;
  name: string;
  event_date?: string | null;
  start_time?: string | null;
  location?: string | null;
  signup_url?: string | null;
  signup_note?: string | null;
  my_rsvp?: string | null;   // Attending / Maybe / Not Attending, or null
  has_slots?: boolean;
  open_slots?: number;
  im_signed_up?: boolean;
}
export interface Opportunities {
  events: OpportunityEvent[];
}

export interface HoursEvent {
  event_id: number;
  name: string;
  event_date?: string | null;
  location?: string | null;
  minutes: number;
  hours: number;
}
export interface MyHours {
  member_name: string;
  org_name: string;
  events: HoursEvent[];
  other_minutes: number;
  event_minutes: number;
  checkin_minutes: number;   // unclassified check-in presence (mentors/volunteers only)
  total_minutes: number;
  total_hours: number;
}

export const volunteeringApi = {
  opportunities: () => api.get("/api/v1/volunteering/opportunities").then((r) => r.data as Opportunities),
  myHours: () => api.get("/api/v1/volunteering/my-hours").then((r) => r.data as MyHours),
};
