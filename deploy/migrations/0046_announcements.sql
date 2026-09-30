-- 0046 Announcements (feedback #94)
-- A lightweight in-app announcements feed: mentors/admins post; everyone sees
-- active (published, not-yet-expired) announcements on the dashboard + a list.

CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  body          TEXT NULL,
  pinned        TINYINT(1) NOT NULL DEFAULT 0,
  published_at  DATETIME NULL,            -- null = draft / unpublished
  expires_at    DATETIME NULL,            -- null = never expires
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ann_active (published_at, expires_at),
  CONSTRAINT fk_ann_creator FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0046_announcements', NOW());
