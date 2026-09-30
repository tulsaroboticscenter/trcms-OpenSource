-- 0105 — Usage events. Lightweight in-app activity stream for the User Activity
-- report: who uses TRCMS, how many pages they view, and how much time they
-- spend. The frontend posts a 'pageview' on each route change and a periodic
-- 'heartbeat' while the tab is visible. Time-in-system is derived from these by
-- grouping a member's events into sessions (a gap over 30 min starts a new one).
--
-- Paths are normalized client-side (query strings dropped, numeric ids -> :id)
-- so no record ids or personal data land in the log and top-pages aggregate
-- cleanly.

CREATE TABLE IF NOT EXISTS usage_events (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  member_id   INT NOT NULL,
  event_type  ENUM('pageview','heartbeat') NOT NULL DEFAULT 'pageview',
  path        VARCHAR(200) NOT NULL DEFAULT '',
  created_at  DATETIME NOT NULL,
  KEY idx_ue_member_time (member_id, created_at),
  KEY idx_ue_time (created_at),
  CONSTRAINT fk_ue_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0105', NOW());
