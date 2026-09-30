-- 0104 — Metric snapshots. Generic fact table for time-series/trend reporting.
-- Each row freezes ONE metric value for ONE period at ONE scope, captured by the
-- nightly/weekly metric-capture job. Trend reports read straight from here, so
-- point-in-time state (inventory value, active headcount, backlogs) stays
-- permanently reproducible even after the underlying rows change.
--
-- period_type is the grain (day/week/month/quarter/year). period_key is the
-- human bucket label (2026-07, 2026-Q3, 2026). period_start is the first date of
-- the bucket for range filtering and sorting. scope_type/scope_id narrow the
-- value (global, program, team, cohort, night, category, location). scope_id is
-- NOT NULL (empty string for global) so the unique key dedups cleanly for upsert.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  metric_key    VARCHAR(64)  NOT NULL,
  period_type   ENUM('day','week','month','quarter','year') NOT NULL,
  period_key    VARCHAR(16)  NOT NULL,
  period_start  DATE         NOT NULL,
  scope_type    VARCHAR(32)  NOT NULL DEFAULT 'global',
  scope_id      VARCHAR(64)  NOT NULL DEFAULT '',
  value         DECIMAL(18,4) NOT NULL DEFAULT 0,
  captured_at   DATETIME     NOT NULL,
  UNIQUE KEY uq_metric_period_scope (metric_key, period_type, period_key, scope_type, scope_id),
  KEY idx_ms_metric_start (metric_key, period_start),
  KEY idx_ms_scope (scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0104', NOW());
