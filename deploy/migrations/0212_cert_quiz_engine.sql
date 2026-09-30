-- 0212 — Certification Quiz Engine (LMS Phase 1), data model only.
-- Five new tables that add native quizzes to the certification program. Nothing existing
-- changes shape — quizzes read `certifications` and, on a pass, the app writes the normal
-- `member_certifications` award record. The whole feature stays HIDDEN behind the
-- `cert_lms.enabled` settings flag (default off) + the `cert_lms.manage` / `cert_lms.take`
-- permissions (default "none" in config/permissions.json), so shipping these tables exposes
-- nothing to users. JSON-ish columns use TEXT to stay portable across MySQL (dev) and
-- MariaDB (prod). No hard foreign keys (matches the app's convention); referential cleanup
-- is handled in code.

CREATE TABLE IF NOT EXISTS cert_quizzes (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  certification_id  INT NOT NULL,
  title             VARCHAR(300) NULL,
  instructions      TEXT NULL,
  pass_pct          INT NOT NULL DEFAULT 80,
  max_attempts      INT NULL,                       -- null = unlimited retakes
  shuffle_questions TINYINT(1) NOT NULL DEFAULT 0,
  is_published      TINYINT(1) NOT NULL DEFAULT 0,  -- draft until an admin publishes
  created_by_id     INT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NULL,
  UNIQUE KEY uq_cert_quiz_certification (certification_id)  -- one quiz per certification
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cert_quiz_questions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  quiz_id       INT NOT NULL,
  type          VARCHAR(20) NOT NULL DEFAULT 'single',  -- single | multi | truefalse | short
  prompt        TEXT NOT NULL,
  points        INT NOT NULL DEFAULT 1,
  answer_key    TEXT NULL,                              -- short-answer: JSON array of accepted strings
  explanation   TEXT NULL,                              -- shown on the results page
  display_order INT NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cqq_quiz (quiz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cert_quiz_options (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  question_id   INT NOT NULL,
  label         TEXT NOT NULL,
  is_correct    TINYINT(1) NOT NULL DEFAULT 0,          -- never sent to a learner before submit
  display_order INT NOT NULL DEFAULT 0,
  KEY idx_cqo_question (question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cert_quiz_attempts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  quiz_id      INT NOT NULL,
  member_id    INT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'in_progress',  -- in_progress | submitted | graded
  score_pct    DECIMAL(5,2) NULL,
  passed       TINYINT(1) NULL,
  awarded      TINYINT(1) NOT NULL DEFAULT 0,               -- did this attempt write the cert
  started_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME NULL,
  KEY idx_cqa_quiz_member (quiz_id, member_id),
  KEY idx_cqa_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cert_quiz_answers (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id          INT NOT NULL,
  question_id         INT NOT NULL,
  selected_option_ids TEXT NULL,                     -- JSON array of chosen option ids
  response_text       TEXT NULL,                     -- short-answer text
  is_correct          TINYINT(1) NULL,               -- null = awaiting manual grade
  points_earned       DECIMAL(6,2) NOT NULL DEFAULT 0,
  KEY idx_cqan_attempt (attempt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0212_cert_quiz_engine', NOW());
