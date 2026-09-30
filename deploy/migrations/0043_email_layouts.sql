-- 0043 Customizable email header/footer layouts (feedback #101)
-- Named header/footer HTML that can be applied to outgoing emails instead of the
-- built-in TRCMS branding. One layout may be marked default (applied when the
-- composer doesn't pick a specific one). Header/footer may use {{variables}}.

CREATE TABLE IF NOT EXISTS email_layouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(120) NOT NULL,
  header_html  TEXT NULL,
  footer_html  TEXT NULL,
  is_default   TINYINT(1) NOT NULL DEFAULT 0,
  created_by_id INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_email_layout_default (is_default),
  CONSTRAINT fk_email_layout_creator FOREIGN KEY (created_by_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0043_email_layouts', NOW());
