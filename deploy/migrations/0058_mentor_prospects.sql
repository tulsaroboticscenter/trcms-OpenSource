-- 0058_mentor_prospects.sql — Recruitment Phase 3: mentor / volunteer prospect
-- pipeline. Capture interested adults (parents are the best source), move them
-- through onboarding, and convert to a mentor member. Pairs with the youth
-- intake's parent-mentor flag (a mentor prospect can be spawned from a visitor).

CREATE TABLE IF NOT EXISTS mentor_prospects (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  name                 VARCHAR(200) NOT NULL,
  email                VARCHAR(200) NULL,
  phone                VARCHAR(40) NULL,
  source               VARCHAR(40) NULL,   -- parent / referral / event / website / other
  stage                ENUM('interested','contacted','onboarding','active','declined') NOT NULL DEFAULT 'interested',
  ypt_done             TINYINT(1) NOT NULL DEFAULT 0,
  background_done      TINYINT(1) NOT NULL DEFAULT 0,
  tc_done              TINYINT(1) NOT NULL DEFAULT 0,
  orientation_done     TINYINT(1) NOT NULL DEFAULT 0,
  owner_id             INT NULL,
  from_visitor_id      INT NULL,           -- the youth prospect whose parent this is
  converted_member_id  INT NULL,
  notes                TEXT NULL,
  created_by_id        INT NULL,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mp_stage (stage),
  CONSTRAINT fk_mp_visitor FOREIGN KEY (from_visitor_id) REFERENCES visitors(id) ON DELETE SET NULL,
  CONSTRAINT fk_mp_member FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0058_mentor_prospects', NOW());
