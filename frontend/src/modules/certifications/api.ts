import { api } from "../../core/api";

export interface Certification {
  id: number; code: string; name: string; section?: string; level?: number;
  status: string; points?: number; is_tool_gate?: boolean; tool_name?: string;
  prerequisites?: string[]; classroom_url?: string; description?: string;
  earned_count?: number; has_quiz?: boolean;
}
export interface CertSectionGroup { section: string; certifications: Certification[]; }
export interface CatalogResponse { sections: CertSectionGroup[]; total: number; active: number; pending: number; }

export interface MemberCert {
  id: number; certification_id: number; code?: string; name?: string; section?: string;
  level?: number; is_tool_gate?: boolean; tool_name?: string; status: string;
  completed_date?: string | null; awarded_by?: string; notes?: string;
}
export interface MemberCertsResponse {
  member_id: number; completed_count: number; completed: MemberCert[]; in_progress: MemberCert[];
}

export interface LeaderboardTeam {
  rank: number; team_season_id: number; team_number?: number; team_name?: string;
  program?: string; member_count: number; certs_completed: number; score: number;
}
export interface LeaderboardGroup { label: string; member_count: number; certs_completed: number; score: number; }
export interface Leaderboard { season: string; teams: LeaderboardTeam[]; groups: LeaderboardGroup[]; }

export interface TeamCertMember { member_id: number; first_name: string; last_name: string; photo_url?: string; completed_count: number; }
export interface TeamCertScore {
  team_season_id: number; team_number?: number; member_count: number;
  certs_completed: number; score: number; members: TeamCertMember[];
  badges?: (Badge & { holder_count: number })[];
}
export interface ToolClearance {
  code: string; name: string; tool_name: string; cleared_count: number;
  members: { member_id: number; name: string }[];
}

export interface Badge {
  id: number; name: string; description?: string; icon_name: string; color: string;
  criteria_type: string; criteria_value?: Record<string, unknown>; earned_count?: number;
  is_active?: boolean;
}
export interface EarnedBadge extends Badge { earned_date?: string | null; }
export interface BadgeProgress extends Badge { have: number; need: number; }
export interface MemberBadges { member_id: number; earned: EarnedBadge[]; progress: BadgeProgress[]; }

export const certApi = {
  catalog: (params?: Record<string, string>) =>
    api.get("/api/v1/certifications/", { params }).then(r => r.data as CatalogResponse),
  importProgressChart: (file: File, dryRun: boolean) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post(`/api/v1/certifications/import-progress${dryRun ? "?dry_run=1" : ""}`, fd).then(r => r.data as ImportResult);
  },
  createCert: (data: Record<string, unknown>) =>
    api.post("/api/v1/certifications/", data).then(r => r.data as Certification),
  updateCert: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/v1/certifications/${id}`, data).then(r => r.data as Certification),
  deleteCert: (id: number) => api.delete(`/api/v1/certifications/${id}`).then(r => r.data),

  listBadges: () => api.get("/api/v1/certifications/badges").then(r => r.data as Badge[]),
  createBadge: (data: Record<string, unknown>) => api.post("/api/v1/certifications/badges", data).then(r => r.data),
  updateBadge: (id: number, data: Record<string, unknown>) => api.patch(`/api/v1/certifications/badges/${id}`, data).then(r => r.data),
  deleteBadge: (id: number) => api.delete(`/api/v1/certifications/badges/${id}`).then(r => r.data),
  toolClearances: () => api.get("/api/v1/certifications/tool-clearances").then(r => r.data as ToolClearance[]),
  memberBadges: (memberId: number) =>
    api.get(`/api/v1/certifications/member/${memberId}/badges`).then(r => r.data as MemberBadges),

  leaderboard: () => api.get("/api/v1/certifications/leaderboard").then(r => r.data as Leaderboard),
  teamCerts: (teamSeasonId: number) =>
    api.get(`/api/v1/certifications/team/${teamSeasonId}`).then(r => r.data as TeamCertScore),

  memberCerts: (memberId: number) =>
    api.get(`/api/v1/certifications/member/${memberId}`).then(r => r.data as MemberCertsResponse),
  award: (memberId: number, data: Record<string, unknown>) =>
    api.post(`/api/v1/certifications/member/${memberId}`, data).then(r => r.data as MemberCert),
  removeAward: (memberId: number, certId: number) =>
    api.delete(`/api/v1/certifications/member/${memberId}/${certId}`).then(r => r.data),
  getSettings: () =>
    api.get("/api/v1/certifications/settings").then(r => r.data as CertSettings),
  updateSettings: (data: { classroom_url?: string; lms_enabled?: boolean }) =>
    api.put("/api/v1/certifications/settings", data).then(r => r.data as CertSettings),

  // ── Certification Quiz Engine (LMS) — author side (hidden until enabled) ──
  getQuiz: (certId: number) =>
    api.get(`/api/v1/certifications/${certId}/quiz`).then(r => r.data as CertQuiz | null),
  saveQuizMeta: (certId: number, data: Partial<Pick<CertQuiz, "title" | "instructions" | "pass_pct" | "max_attempts" | "shuffle_questions" | "hold_results">>) =>
    api.put(`/api/v1/certifications/${certId}/quiz`, data).then(r => r.data as CertQuiz),
  addQuestion: (certId: number, q: QuizQuestionInput) =>
    api.post(`/api/v1/certifications/${certId}/quiz/questions`, q).then(r => r.data as CertQuiz),
  updateQuestion: (questionId: number, q: QuizQuestionInput & { display_order?: number }) =>
    api.patch(`/api/v1/cert-quiz/questions/${questionId}`, q).then(r => r.data as CertQuiz),
  deleteQuestion: (questionId: number) =>
    api.delete(`/api/v1/cert-quiz/questions/${questionId}`).then(r => r.data as CertQuiz),
  publishQuiz: (certId: number, published: boolean) =>
    api.post(`/api/v1/certifications/${certId}/quiz/publish`, { published }).then(r => r.data as CertQuiz),

  // ── Learner side ──
  myQuiz: (certId: number) =>
    api.get(`/api/v1/certifications/${certId}/quiz/mine`).then(r => r.data as MyQuiz),
  startQuiz: (certId: number) =>
    api.post(`/api/v1/certifications/${certId}/quiz/start`).then(r => r.data as QuizAttemptStart),
  submitAttempt: (attemptId: number, answers: SubmitAnswer[]) =>
    api.post(`/api/v1/cert-quiz/attempts/${attemptId}/submit`, { answers }).then(r => r.data as QuizResult),
  getAttempt: (attemptId: number) =>
    api.get(`/api/v1/cert-quiz/attempts/${attemptId}`).then(r => r.data as QuizResult),

  // ── Gradebook (manager side) ──
  quizAttempts: (certId: number) =>
    api.get(`/api/v1/certifications/${certId}/quiz/attempts`).then(r => r.data as QuizGradebook),
  gradeAttempt: (attemptId: number, grades: { question_id: number; is_correct: boolean }[]) =>
    api.patch(`/api/v1/cert-quiz/attempts/${attemptId}/grade`, { grades }).then(r => r.data as QuizResult),
};

export interface CertSettings {
  classroom_url: string | null;
  can_manage: boolean;
  lms_enabled?: boolean;
  can_manage_lms?: boolean;
  can_take_lms?: boolean;
}

export type QuizQuestionType = "single" | "multi" | "truefalse" | "short";
export interface QuizOption { id?: number; label: string; is_correct?: boolean; }
export interface QuizQuestion {
  id: number;
  type: QuizQuestionType;
  prompt: string;
  points: number;
  display_order: number;
  options: QuizOption[];
  explanation?: string | null;
  answer_key?: string[];
  image_url?: string | null;
}
export interface QuizQuestionInput {
  type: QuizQuestionType;
  prompt: string;
  points: number;
  options?: { label: string; is_correct: boolean }[];
  answer_key?: string[];
  explanation?: string | null;
  image_url?: string | null;
}
export interface CertQuiz {
  id: number;
  certification_id: number;
  title: string | null;
  instructions: string | null;
  pass_pct: number;
  max_attempts: number | null;
  shuffle_questions: boolean;
  hold_results: boolean;
  is_published: boolean;
  question_count: number;
  total_points: number;
  questions: QuizQuestion[];
}

// Learner-facing (answers hidden until the attempt is submitted).
export interface TakeQuestion { id: number; type: QuizQuestionType; prompt: string; points: number; image_url?: string | null; options: { id: number; label: string }[]; }
export interface QuizAttemptStart {
  attempt_id: number; certification_id: number;
  title: string | null; instructions: string | null; pass_pct: number; is_published: boolean;
  hold_results?: boolean;
  questions: TakeQuestion[];
}
export interface SubmitAnswer { question_id: number; selected_option_ids?: number[]; response_text?: string; }
export interface ReviewQuestion {
  id: number; type: QuizQuestionType; prompt: string; points: number; points_possible: number; explanation: string | null; image_url?: string | null;
  options: { id: number; label: string; is_correct: boolean | null }[]; answer_key: string[];
  your_option_ids: number[]; your_text: string | null; is_correct: boolean | null; points_earned: number | null;
}
export interface QuizResult {
  attempt_id: number; status: string; score_pct: number | null; passed: boolean | null;
  awarded: boolean; pending_review: boolean; pass_pct: number; total_points?: number; submitted_at: string | null;
  questions: ReviewQuestion[];
}
export interface MyQuizAttempt { id: number; status: string; score_pct: number | null; passed: boolean | null; awarded: boolean; submitted_at: string | null; }
export interface MyQuiz {
  available: boolean; is_published?: boolean; title?: string | null; pass_pct?: number; hold_results?: boolean;
  max_attempts?: number | null; attempts_used?: number; ever_passed?: boolean; can_take?: boolean;
  attempts: MyQuizAttempt[];
}
export interface PendingAnswer { question_id: number; prompt: string; response_text: string | null; points: number; answer_key: string[]; }
export interface GradebookAttempt {
  id: number; member_id: number; member_name: string; status: string;
  score_pct: number | null; passed: boolean | null; awarded: boolean; submitted_at: string | null;
  pending: PendingAnswer[];
}
export interface QuizGradebook {
  exists: boolean; is_published?: boolean; pass_pct?: number; hold_results?: boolean;
  total?: number; passed?: number; pending?: number;
  attempts: GradebookAttempt[];
}

export interface ImportResult {
  dry_run: boolean;
  members_matched: number;
  certs_awarded: number;
  certs_already_had: number;
  members_not_found: string[];
  members_ambiguous: string[];
  unknown_codes: string[];
  cert_columns: number;
}
