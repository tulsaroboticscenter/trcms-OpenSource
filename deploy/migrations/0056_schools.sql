-- 0056_schools.sql — Recruitment Phase 2: School & Partner relationship management.
-- Schools are TRC's primary recruiting channel. Track each school, its contacts,
-- engagement history, and attribution (which prospects/enrollments came from it).

CREATE TABLE IF NOT EXISTS schools (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(200) NOT NULL,
  type          VARCHAR(40) NULL,     -- elementary/middle/high/library/community/other
  district      VARCHAR(150) NULL,
  address       VARCHAR(300) NULL,
  notes         TEXT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by_id INT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS school_contacts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  school_id  INT NOT NULL,
  name       VARCHAR(200) NOT NULL,
  title      VARCHAR(120) NULL,       -- STEM teacher / counselor / principal / PTO
  email      VARCHAR(200) NULL,
  phone      VARCHAR(40) NULL,
  notes      TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sc_school (school_id),
  CONSTRAINT fk_sc_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS school_engagements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  school_id     INT NOT NULL,
  engaged_on    DATE NULL,
  type          VARCHAR(40) NULL,     -- visit / presentation / demo / fair / flyer / call / email / other
  notes         TEXT NULL,
  outcome       VARCHAR(200) NULL,
  member_id     INT NULL,             -- who did it
  created_by_id INT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_se_school (school_id),
  CONSTRAINT fk_se_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Self-reported attribution: which school a prospect came from.
ALTER TABLE visitors ADD COLUMN school_id INT NULL AFTER referral_detail;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0056_schools', NOW());
