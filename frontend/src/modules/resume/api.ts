import { api } from "../../core/api";

/** One question in the builder. `type` decides the input control. */
export interface ResumeQuestion {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "skills" | "positions";
  help?: string;
}

/** Facts the system already holds — shown on the resume, not typed by the youth. */
export interface ResumePulled {
  name: string;
  grade_label: string | null;
  school: string | null;
  email: string | null;
  teams: { team: string; season: string }[];
  first_seasons: string[];
  first_seasons_count: number;
  certifications: string[];
  reflections_done: boolean;
}

/** Answers are keyed by question key; skills/positions are arrays, everything else a string. */
export type ResumeAnswers = Record<string, string | string[]>;

export interface ResumeData {
  member_id: number;
  questions: ResumeQuestion[];
  skill_options: string[];
  position_options: string[];
  answers: ResumeAnswers;
  show_contact: boolean;
  uploaded_url: string | null;
  completed: boolean;
  completed_at: string | null;
  pulled: ResumePulled;
  can_edit: boolean;
  can_mark_complete?: boolean;   // a permitted staff member (resume.mark_complete) viewing someone else's resume
}

export interface ResumeSavePayload {
  answers: ResumeAnswers;
  show_contact?: boolean;
  uploaded_url?: string;
  complete?: boolean;
}

export const resumeApi = {
  /** The signed-in youth's own resume workspace. */
  mine: () => api.get("/api/v1/resume/me").then((r) => r.data as ResumeData),
  /** View a youth's resume (self, parent/guardian, or FDP manager). */
  forMember: (memberId: number) =>
    api.get(`/api/v1/resume/member/${memberId}`).then((r) => r.data as ResumeData),
  /** Save the youth's own answers. Pass complete:true to mark it finished. */
  save: (d: ResumeSavePayload) =>
    api.put("/api/v1/resume/me", d).then((r) => r.data as ResumeData),
  /** Staff (resume.mark_complete) marks another member's resume complete / reopens it. */
  markComplete: (memberId: number, complete: boolean) =>
    api.post(`/api/v1/resume/member/${memberId}/complete`, { complete }).then((r) => r.data as ResumeData),
  /** Staff attach a youth's externally-built resume by link (#187). Empty string clears it. */
  setMemberUpload: (memberId: number, uploaded_url: string) =>
    api.put(`/api/v1/resume/member/${memberId}/uploaded-url`, { uploaded_url }).then((r) => r.data as ResumeData),
  options: () =>
    api.get("/api/v1/resume/options").then((r) => r.data as { skills: string[]; positions: string[] }),
};
