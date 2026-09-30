-- 0098 — Email open/click tracking. A per-message token backs a 1x1 tracking
-- pixel (open) and rewritten links (click) that hit public /track endpoints.
-- Opens are approximate (image-blocking, Apple MPP pre-fetch, Gmail proxy), so
-- treat them as a floor, not an exact count.

ALTER TABLE communication_messages
  ADD COLUMN track_token  VARCHAR(64) NULL,
  ADD COLUMN opened_at    DATETIME NULL,
  ADD COLUMN open_count   INT NOT NULL DEFAULT 0,
  ADD COLUMN clicked_at   DATETIME NULL,
  ADD COLUMN click_count  INT NOT NULL DEFAULT 0;

CREATE INDEX idx_cm_track_token ON communication_messages (track_token);

-- One row per tracked link in a sent message. Redirecting by stored token (not a
-- caller-supplied URL) avoids an open-redirect and records which link was clicked.
CREATE TABLE IF NOT EXISTS comm_email_links (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  link_token        VARCHAR(64) NOT NULL,
  message_id        INT NOT NULL,
  url               VARCHAR(1024) NOT NULL,
  click_count       INT NOT NULL DEFAULT 0,
  first_clicked_at  DATETIME NULL,
  created_at        DATETIME NULL,
  UNIQUE KEY uq_cel_token (link_token),
  KEY idx_cel_message (message_id),
  CONSTRAINT fk_cel_message FOREIGN KEY (message_id) REFERENCES communication_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0098', NOW());
