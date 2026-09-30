-- 0102 — Save-as-draft for the email composer. A draft stores the whole compose
-- state (recipients, subject, body, template/layout, embedded events) as JSON so
-- the author can reopen and finish it later. Drafts are per-author.

CREATE TABLE IF NOT EXISTS email_drafts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  created_by_id  INT NULL,
  subject        VARCHAR(300) NULL,
  payload        LONGTEXT NOT NULL,
  created_at     DATETIME NULL,
  updated_at     DATETIME NULL,
  KEY idx_ed_author (created_by_id, updated_at),
  CONSTRAINT fk_ed_author FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0102', NOW());
