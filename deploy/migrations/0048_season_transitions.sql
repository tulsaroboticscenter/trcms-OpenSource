-- 0048 Season transition readiness checklist (Admin → Season Transition)
-- Tracks completion of the season-rollover checklist per (from_season → to_season)
-- so admins can run a readiness check and verify each step. The checklist item
-- DEFINITIONS live in code (SeasonTransitionController); this stores only per-item
-- state (done / who / when) as JSON.

CREATE TABLE IF NOT EXISTS season_transitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_season   VARCHAR(12) NOT NULL,
  to_season     VARCHAR(12) NOT NULL,
  state         JSON NULL,            -- { "<item_key>": {done, done_at, done_by_id, done_by_name, notes} }
  notes         TEXT NULL,
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_season_transition (from_season, to_season),
  CONSTRAINT fk_season_transition_creator FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0048_season_transitions', NOW());
