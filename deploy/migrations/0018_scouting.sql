-- Scouting module (#NN) — FTC-first competition scouting: pre-event prediction
-- (sourced from ftcscout.org), human pit/match/observation scouting, and the data
-- needed for alliance modeling. Designed to be season-reconfigurable: the stable,
-- queryable columns live as real columns; everything game-specific (the DECODE tap
-- counters, endgame options, capability questions) lives in a `payload` JSON column
-- driven by the season config, so a new game = a new config row, not a schema change.
--
-- Key design points (see project memory "project-trc-scouting"):
--  * FTC scoring is alliance-level, not robot-level, so per-team artifact/penalty
--    figures come from ftcscout's OPR decomposition (cached here), while human
--    scouting captures the per-robot behavior the API cannot attribute.
--  * Pre-event stats (scout_preevent_stats) are retained separately from live
--    stats (scout_live_stats) so live results never corrupt the pre-event baseline.
--  * Every human-entered record carries a client-generated UUID with a UNIQUE key,
--    so offline devices can sync via idempotent INSERT ... ON DUPLICATE KEY UPDATE.
--  * Multiple scouters may report the same team/match; all rows are retained and an
--    is_ignored flag (not deletion) is used to discount a report during reconciliation.

-- ── Season config: the form/scoring engine, one row per game season ──────────────
CREATE TABLE IF NOT EXISTS scout_seasons (
  id INT NOT NULL AUTO_INCREMENT,
  program VARCHAR(8) NOT NULL DEFAULT 'FTC',         -- FTC | FRC
  season_year INT NOT NULL,                          -- e.g. 2025 (the 2025-26 season)
  code VARCHAR(40) NOT NULL,                          -- e.g. 'DECODE'
  name VARCHAR(120) NOT NULL,
  api_stats_type VARCHAR(60) DEFAULT NULL,            -- ftcscout type, e.g. 'TeamEventStats2025'
  config JSON NOT NULL,                               -- pitForm, matchForm, reconciliationRules, metricMap, fieldZones
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_season (program, season_year, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── External competition events being scouted (cached from ftcscout) ─────────────
CREATE TABLE IF NOT EXISTS scout_events (
  id INT NOT NULL AUTO_INCREMENT,
  scout_season_id INT NOT NULL,
  event_code VARCHAR(40) NOT NULL,                    -- e.g. 'FPEMICRFT'
  name VARCHAR(200) NOT NULL,
  division_code VARCHAR(40) DEFAULT NULL,             -- parent event code if this is a division
  city VARCHAR(120) DEFAULT NULL,
  state VARCHAR(40) DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'ftcscout',
  is_active TINYINT(1) NOT NULL DEFAULT 1,            -- are we actively scouting this event?
  schedule_synced_at DATETIME DEFAULT NULL,           -- last time the match schedule was pulled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_event (scout_season_id, event_code),
  CONSTRAINT scout_events_ibfk_1 FOREIGN KEY (scout_season_id) REFERENCES scout_seasons (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Roster cache: teams at an event (number + name), for offline autoload ────────
CREATE TABLE IF NOT EXISTS scout_event_teams (
  id INT NOT NULL AUTO_INCREMENT,
  scout_event_id INT NOT NULL,
  team_number INT NOT NULL,
  team_name VARCHAR(160) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_event_team (scout_event_id, team_number),
  CONSTRAINT scout_event_teams_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Pre-event projection per team (ftcscout previewStats: npOpr + breakdown). ────
--    Retained as the baseline; never overwritten by live results.
CREATE TABLE IF NOT EXISTS scout_preevent_stats (
  id INT NOT NULL AUTO_INCREMENT,
  scout_event_id INT NOT NULL,
  team_number INT NOT NULL,
  np_opr DECIMAL(8,3) DEFAULT NULL,                   -- no-penalty OPR projection
  stats JSON DEFAULT NULL,                            -- full opr component breakdown
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_preevent (scout_event_id, team_number),
  CONSTRAINT scout_preevent_stats_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Live (current-event) stats per team — kept separate from pre-event. ──────────
CREATE TABLE IF NOT EXISTS scout_live_stats (
  id INT NOT NULL AUTO_INCREMENT,
  scout_event_id INT NOT NULL,
  team_number INT NOT NULL,
  opr_total DECIMAL(8,3) DEFAULT NULL,                -- current-event total-points OPR
  `rank` INT DEFAULT NULL,                            -- `rank` is a reserved word in MySQL 8
  qual_matches_played INT DEFAULT NULL,
  stats JSON DEFAULT NULL,                            -- full current opr/avg breakdown
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_live (scout_event_id, team_number),
  CONSTRAINT scout_live_stats_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Match schedule cache (from ftcscout). Pairings don't change; replays append
--    new results keyed on the same match number. ───────────────────────────────
CREATE TABLE IF NOT EXISTS scout_matches (
  id INT NOT NULL AUTO_INCREMENT,
  scout_event_id INT NOT NULL,
  match_num INT NOT NULL,
  tournament_level VARCHAR(20) NOT NULL DEFAULT 'Quals',  -- Quals | Playoffs
  scheduled_start DATETIME DEFAULT NULL,
  red1 INT DEFAULT NULL,
  red2 INT DEFAULT NULL,
  blue1 INT DEFAULT NULL,
  blue2 INT DEFAULT NULL,
  has_been_played TINYINT(1) NOT NULL DEFAULT 0,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_match (scout_event_id, tournament_level, match_num),
  CONSTRAINT scout_matches_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Human PIT scouting. Multiple reports per (event, team) allowed; ignore flag
--    discounts a report during consolidation. Game-specific answers in `payload`. ─
CREATE TABLE IF NOT EXISTS scout_pit_reports (
  id INT NOT NULL AUTO_INCREMENT,
  client_uuid CHAR(36) NOT NULL,                      -- client-generated; idempotent sync key
  scout_event_id INT NOT NULL,
  team_number INT NOT NULL,
  scouter_member_id INT DEFAULT NULL,                 -- TRC member, if known
  scouter_name VARCHAR(120) DEFAULT NULL,             -- free text fallback (offline / non-member)
  robot_nickname VARCHAR(120) DEFAULT NULL,
  payload JSON DEFAULT NULL,                          -- capability answers per season config
  is_ignored TINYINT(1) NOT NULL DEFAULT 0,
  device_id VARCHAR(80) DEFAULT NULL,
  client_ts DATETIME DEFAULT NULL,                    -- advisory device timestamp
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_pit_uuid (client_uuid),
  KEY idx_pit_event_team (scout_event_id, team_number),
  CONSTRAINT scout_pit_reports_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE,
  CONSTRAINT scout_pit_reports_ibfk_2 FOREIGN KEY (scouter_member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Pit photos. One may be flagged as the profile image for the scouting report. ─
CREATE TABLE IF NOT EXISTS scout_pit_photos (
  id INT NOT NULL AUTO_INCREMENT,
  scout_pit_report_id INT NOT NULL,
  file_path VARCHAR(255) NOT NULL,                    -- stored under public/uploads/
  is_profile TINYINT(1) NOT NULL DEFAULT 0,
  caption VARCHAR(200) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pit_photo_report (scout_pit_report_id),
  CONSTRAINT scout_pit_photos_ibfk_1 FOREIGN KEY (scout_pit_report_id) REFERENCES scout_pit_reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Human MATCH scouting. Stable columns kept queryable; game-specific scoring
--    (tap counters, endgame, penalties, failures) lives in `payload`. ───────────
CREATE TABLE IF NOT EXISTS scout_match_records (
  id INT NOT NULL AUTO_INCREMENT,
  client_uuid CHAR(36) NOT NULL,
  scout_event_id INT NOT NULL,
  match_num INT NOT NULL,
  tournament_level VARCHAR(20) NOT NULL DEFAULT 'Quals',
  scouted_team_number INT NOT NULL,
  alliance VARCHAR(8) DEFAULT NULL,                   -- Red | Blue
  scouter_member_id INT DEFAULT NULL,
  scouter_name VARCHAR(120) DEFAULT NULL,
  showed_up TINYINT(1) NOT NULL DEFAULT 1,
  whole_match TINYINT(1) NOT NULL DEFAULT 1,          -- did the scouter watch the whole match?
  confidence VARCHAR(12) DEFAULT NULL,                -- low | medium | high | very_high (weighting)
  payload JSON DEFAULT NULL,                          -- season-config scoring/penalty/endgame data
  is_ignored TINYINT(1) NOT NULL DEFAULT 0,
  device_id VARCHAR(80) DEFAULT NULL,
  client_ts DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_match_uuid (client_uuid),
  KEY idx_mr_event_match (scout_event_id, tournament_level, match_num),
  KEY idx_mr_team (scout_event_id, scouted_team_number),
  CONSTRAINT scout_match_records_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE,
  CONSTRAINT scout_match_records_ibfk_2 FOREIGN KEY (scouter_member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ── Free-form scouting observations (the "scouting report" input), with tags. ────
CREATE TABLE IF NOT EXISTS scout_observations (
  id INT NOT NULL AUTO_INCREMENT,
  client_uuid CHAR(36) NOT NULL,
  scout_event_id INT NOT NULL,
  team_number INT NOT NULL,
  match_num INT DEFAULT NULL,                         -- optional: which match prompted it
  scouter_member_id INT DEFAULT NULL,
  scouter_name VARCHAR(120) DEFAULT NULL,
  observation TEXT NOT NULL,
  tags JSON DEFAULT NULL,                             -- array of structured tag keys (e.g. ["plays_defense"])
  is_ignored TINYINT(1) NOT NULL DEFAULT 0,
  device_id VARCHAR(80) DEFAULT NULL,
  client_ts DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_obs_uuid (client_uuid),
  KEY idx_obs_event_team (scout_event_id, team_number),
  CONSTRAINT scout_observations_ibfk_1 FOREIGN KEY (scout_event_id) REFERENCES scout_events (id) ON DELETE CASCADE,
  CONSTRAINT scout_observations_ibfk_2 FOREIGN KEY (scouter_member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
