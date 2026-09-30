-- 0083 — Calendar holidays / closures (#118). US federal holidays are computed
-- automatically; this table holds TRC-specific extras (breaks, closures). A row
-- can be a single date or a range (end_date), and optionally repeat every year.

CREATE TABLE IF NOT EXISTS calendar_holidays (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  holiday_date DATE NOT NULL,
  end_date DATE NULL,
  recurring_annual TINYINT(1) NOT NULL DEFAULT 0,
  created_by_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  KEY idx_holiday_date (holiday_date)
);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0083', NOW());
