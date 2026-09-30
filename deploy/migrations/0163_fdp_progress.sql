-- FDP Management, Phase 1: progress tracking for FIRST Development Program youth.
--
-- The FDP already tracks WHO is in the program (fdp_memberships, per season, with
-- graduation). This adds what they've DONE, so mentors can see a youth's readiness to
-- be interviewed by a team and parents can follow their own child's progress.
--
-- Two one-time-per-youth facts live here (NOT per season), matching how FDP graduation
-- already works:
--   * resume — a URL. An in-app upload (POST /uploads/document) and a pasted link both
--     produce one, so the field works either way. NOTE: production currently returns
--     403 for /uploads/**, so an uploaded file will not download there until that
--     hosting issue is resolved — a link is the working option on prod today.
--   * board of review — the milestone that makes a youth eligible to be interviewed
--     for a team. Recorded once and never expires (the user's choice), so it is keyed
--     by member rather than by season.
--
-- Certification counts are NOT stored — they're computed from member_certifications so
-- they can never drift.
CREATE TABLE IF NOT EXISTS fdp_progress (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  member_id             INT NOT NULL,
  resume_url            VARCHAR(500) NULL,
  resume_updated_at     DATETIME NULL,
  resume_updated_by_id  INT NULL,
  -- Board of review: 'passed' is the milestone that grants eligibility. 'not_yet' and
  -- 'deferred' record that a review happened without granting it.
  board_review_date     DATE NULL,
  board_review_outcome  VARCHAR(20) NULL,
  board_review_panel    VARCHAR(300) NULL,
  board_review_notes    TEXT NULL,
  board_review_by_id    INT NULL,
  notes                 TEXT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NULL,
  UNIQUE KEY uq_fdp_progress_member (member_id),
  CONSTRAINT fk_fdp_progress_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
);

-- Interviews between a team and an FDP youth. Schema lands now so the roster can show
-- "has this youth interviewed, and with which teams"; the request/scheduling workflow
-- is Phase 2.
--   direction: 'team'  = the team asked to interview the youth
--              'youth' = the youth asked to interview with the team
CREATE TABLE IF NOT EXISTS fdp_interviews (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  member_id        INT NOT NULL,
  team_season_id   INT NOT NULL,
  enrollment_year  INT NOT NULL,
  direction        VARCHAR(10) NOT NULL DEFAULT 'team',
  status           VARCHAR(20) NOT NULL DEFAULT 'requested',
  requested_by_id  INT NULL,
  scheduled_at     DATETIME NULL,
  location         VARCHAR(200) NULL,
  outcome          VARCHAR(20) NULL,
  notes            TEXT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NULL,
  KEY idx_fdp_int_member (member_id, enrollment_year),
  KEY idx_fdp_int_team (team_season_id, status),
  CONSTRAINT fk_fdp_int_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE,
  CONSTRAINT fk_fdp_int_team FOREIGN KEY (team_season_id) REFERENCES team_seasons (id) ON DELETE CASCADE
);
