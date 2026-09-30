-- 0054_waitlist.sql — Recruitment & Growth, Phase 1: FLL waitlist methodology.
-- Per-night capacity (defined by the Program Director), and a weighted, night-aware
-- waitlist that carries forward across seasons. Extends the Visitors module.

-- Meeting nights/sections for a program+season, each with its own capacity.
CREATE TABLE IF NOT EXISTS program_nights (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  program_id    INT NOT NULL,
  season        VARCHAR(10) NOT NULL,
  name          VARCHAR(60) NOT NULL,        -- e.g. "Monday", "Tuesday Team A"
  capacity      INT NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pn_prog_season (program_id, season),
  CONSTRAINT fk_pn_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One waitlist entry = a youth waiting for a spot in a program (per season).
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  visitor_id            INT NULL,
  member_id             INT NULL,
  program_id            INT NOT NULL,
  season                VARCHAR(10) NOT NULL,
  status                ENUM('waiting','offered','accepted','declined','expired','withdrawn') NOT NULL DEFAULT 'waiting',
  -- weighting factors (decided): siblings + parent willing to mentor
  sibling_of_member     TINYINT(1) NOT NULL DEFAULT 0,
  parent_mentor_interest TINYINT(1) NOT NULL DEFAULT 0,
  -- FLL night preference: availability (hard) + preferred (soft)
  available_night_ids   JSON NULL,
  preferred_night_id    INT NULL,
  requested_date        DATE NOT NULL,
  carried_from_season   VARCHAR(10) NULL,
  -- offer workflow
  offered_night_id      INT NULL,
  offered_at            DATETIME NULL,
  offer_expires         DATE NULL,
  responded_at          DATETIME NULL,
  offered_by_id         INT NULL,
  priority_reason       VARCHAR(300) NULL,   -- required when overriding computed order
  notes                 TEXT NULL,
  created_by_id         INT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_wl_prog_season (program_id, season),
  KEY idx_wl_status (status),
  CONSTRAINT fk_wl_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE SET NULL,
  CONSTRAINT fk_wl_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
  CONSTRAINT fk_wl_program FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0054_waitlist', NOW());
