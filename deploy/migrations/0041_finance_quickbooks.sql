-- 0041 Finance: QuickBooks import (feedback #89)
-- Import a QuickBooks report export (e.g. Profit & Loss by Class) so each team's
-- real-world financial actuals can be shown alongside the budget tracked in
-- TRCMS. The import is mapping-driven: whatever "segment" label the export uses
-- (Class, Customer, or Account name) is mapped to a TRC team-season once and
-- remembered for future imports.

CREATE TABLE IF NOT EXISTS finance_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source        VARCHAR(40)  NOT NULL DEFAULT 'quickbooks',
  filename      VARCHAR(255) NULL,
  label         VARCHAR(200) NULL,          -- admin's description, e.g. "P&L by Class — 2026 YTD"
  as_of_date    DATE NULL,                  -- the report's "as of" / run date
  period_start  DATE NULL,
  period_end    DATE NULL,
  segment_kind  VARCHAR(40) NULL,           -- what the label column represents: class | customer | account
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes         TEXT NULL,
  KEY idx_fin_import_date (as_of_date),
  CONSTRAINT fk_fin_import_creator FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- One parsed row per (segment × account) from the export. income/expense are
-- both kept so a Profit & Loss collapses cleanly to a per-team net.
CREATE TABLE IF NOT EXISTS finance_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  import_id     INT NOT NULL,
  segment_label VARCHAR(200) NOT NULL,      -- the Class/Customer/Account name from the file
  account       VARCHAR(200) NULL,          -- account/line name within the segment, if present
  income        DECIMAL(12,2) NOT NULL DEFAULT 0,
  expense       DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY idx_fin_line_import (import_id),
  KEY idx_fin_line_segment (segment_label),
  CONSTRAINT fk_fin_line_import FOREIGN KEY (import_id) REFERENCES finance_imports(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Remembered mapping: an export segment label → a TRC team-season (or org-wide,
-- or ignore). Applied automatically to every future import.
CREATE TABLE IF NOT EXISTS finance_segment_map (
  id INT AUTO_INCREMENT PRIMARY KEY,
  segment_label  VARCHAR(200) NOT NULL,
  team_season_id INT NULL,
  scope          VARCHAR(20) NOT NULL DEFAULT 'team',   -- team | org | ignore
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fin_seg_label (segment_label),
  CONSTRAINT fk_fin_seg_team FOREIGN KEY (team_season_id) REFERENCES team_seasons(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0041_finance_quickbooks', NOW());
