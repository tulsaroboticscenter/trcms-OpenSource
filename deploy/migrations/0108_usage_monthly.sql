-- 0108 — Usage monthly rollup. A compact per-member, per-month summary of the
-- in-app activity stream (usage_events) so long-term adoption trends survive the
-- pruning of raw events. One row per (member, month) with page views, sessions,
-- estimated active minutes, active days, and last-seen. Populated by the rollup
-- job; the prune job rolls up a month before deleting its raw rows.

CREATE TABLE IF NOT EXISTS usage_monthly (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  member_id      INT NOT NULL,
  period_month   CHAR(7) NOT NULL,           -- 'YYYY-MM'
  pageviews      INT NOT NULL DEFAULT 0,
  sessions       INT NOT NULL DEFAULT 0,
  active_minutes INT NOT NULL DEFAULT 0,
  active_days    INT NOT NULL DEFAULT 0,
  last_seen      DATETIME NULL,
  captured_at    DATETIME NOT NULL,
  UNIQUE KEY uq_member_month (member_id, period_month),
  KEY idx_um_month (period_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0108', NOW());
