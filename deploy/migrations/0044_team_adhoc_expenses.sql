-- 0044 Ad-hoc team expenses (feedback #98)
-- Lets mentors record a purchase made for a team (e.g. Home Depot run) that isn't
-- a tracked BOM/PO. Folds into the team's budget actuals. Optionally filed under
-- a budget category; the purchaser is recorded so we know who to ask.

CREATE TABLE IF NOT EXISTS team_adhoc_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id    INT NOT NULL,
  budget_category_id INT NULL,            -- optional: which budget line it counts against
  vendor            VARCHAR(200) NULL,
  description       VARCHAR(500) NOT NULL,
  amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
  purchaser_id      INT NULL,             -- who made the purchase
  expense_date      DATE NULL,
  notes             TEXT NULL,
  created_by_id     INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_adhoc_team (team_season_id),
  KEY idx_adhoc_cat (budget_category_id),
  CONSTRAINT fk_adhoc_team FOREIGN KEY (team_season_id) REFERENCES team_seasons(id) ON DELETE CASCADE,
  CONSTRAINT fk_adhoc_cat FOREIGN KEY (budget_category_id) REFERENCES inv_budget_categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_adhoc_purchaser FOREIGN KEY (purchaser_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0044_team_adhoc_expenses', NOW());
