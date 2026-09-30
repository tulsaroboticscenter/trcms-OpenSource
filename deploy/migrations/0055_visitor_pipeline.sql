-- 0055_visitor_pipeline.sql — Recruitment Phase 1: Visitors pipeline ergonomics.
-- Adds an assigned follow-up owner and next-follow-up date to prospects, plus an
-- interaction log so staff can track calls/emails/visits and nobody falls through.

ALTER TABLE visitors
  ADD COLUMN owner_id            INT NULL AFTER status,
  ADD COLUMN next_follow_up_date DATE NULL AFTER owner_id;

CREATE TABLE IF NOT EXISTS visitor_interactions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  visitor_id   INT NOT NULL,
  member_id    INT NULL,            -- staff member who logged it
  method       VARCHAR(30) NULL,    -- call / email / text / in_person / event / other
  notes        TEXT NULL,
  occurred_at  DATE NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_vi_visitor (visitor_id),
  CONSTRAINT fk_vi_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0055_visitor_pipeline', NOW());
