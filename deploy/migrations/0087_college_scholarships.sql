-- 0087 — College Scholarship Module. Track external scholarship opportunities for
-- youth members across each season: a manager-maintained catalog with eligibility,
-- youth "follow" for notifications, and a per-youth/per-season application lifecycle
-- (interested → applied → granted / partial / declined / no decision) for reporting.
-- NOTE: prefixed `college_` to stay clearly distinct from the Sponsors module's
-- sponsor-funded scholarship_* tables (scholarship_funds/awards/applications) —
-- those are TRC awarding money to youth; these are outside scholarships youth
-- apply to for college.

CREATE TABLE IF NOT EXISTS college_scholarships (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  provider           VARCHAR(200) NULL,
  info_url           VARCHAR(500) NULL,
  description        TEXT NULL,
  amount_min         DECIMAL(10,2) NULL,
  amount_max         DECIMAL(10,2) NULL,
  renewable          TINYINT(1) NOT NULL DEFAULT 0,
  season             VARCHAR(40) NULL,
  open_date          DATE NULL,
  close_date         DATE NULL,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  -- Structured, auto-matchable eligibility (blank = no restriction on that axis)
  elig_grad_year_min INT NULL,
  elig_grad_year_max INT NULL,
  elig_sex           VARCHAR(20) NULL,
  elig_races         VARCHAR(300) NULL,
  elig_states        VARCHAR(200) NULL,
  elig_min_gpa       DECIMAL(3,2) NULL,
  -- Free-form eligibility (career path, tribe, parent employer, etc.)
  elig_tags          VARCHAR(500) NULL,
  elig_notes         TEXT NULL,
  created_by_id      INT NULL,
  updated_by_id      INT NULL,
  created_at         DATETIME NULL,
  updated_at         DATETIME NULL,
  KEY idx_csch_season (season),
  KEY idx_csch_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS college_scholarship_follows (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  scholarship_id INT NOT NULL,
  member_id      INT NOT NULL,
  created_by_id  INT NULL,
  created_at     DATETIME NULL,
  UNIQUE KEY uq_cfollow (scholarship_id, member_id),
  KEY idx_cfollow_member (member_id),
  CONSTRAINT fk_cscf_sch FOREIGN KEY (scholarship_id) REFERENCES college_scholarships(id) ON DELETE CASCADE,
  CONSTRAINT fk_cscf_mem FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS college_scholarship_applications (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  scholarship_id INT NOT NULL,
  member_id      INT NOT NULL,
  season         VARCHAR(40) NULL,
  status         ENUM('interested','applied','granted','partial','declined','no_decision') NOT NULL DEFAULT 'interested',
  amount_awarded DECIMAL(10,2) NULL,
  applied_date   DATE NULL,
  decision_date  DATE NULL,
  notes          TEXT NULL,
  created_by_id  INT NULL,
  updated_by_id  INT NULL,
  created_at     DATETIME NULL,
  updated_at     DATETIME NULL,
  UNIQUE KEY uq_capp (scholarship_id, member_id, season),
  KEY idx_capp_member (member_id),
  KEY idx_capp_status (status),
  CONSTRAINT fk_csca_sch FOREIGN KEY (scholarship_id) REFERENCES college_scholarships(id) ON DELETE CASCADE,
  CONSTRAINT fk_csca_mem FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0087', NOW());
