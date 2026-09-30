-- 0045 Email unsubscribe / opt-out tracking (feedback #100)
-- One row per email address: holds the stable unsubscribe token and, once the
-- recipient clicks Unsubscribe, the timestamp. Mass emails that opt in to the
-- unsubscribe feature include a per-recipient link and skip opted-out addresses.

CREATE TABLE IF NOT EXISTS email_optouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(190) NOT NULL,
  token           VARCHAR(40) NOT NULL,
  unsubscribed_at DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_optout_email (email),
  UNIQUE KEY uq_optout_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0045_email_optouts', NOW());
