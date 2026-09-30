-- 0081 — Help Center: DB-backed, admin-editable help articles (Release 3.3).
-- Powers the in-app searchable ? help panel and the generated user manual.
-- body is Markdown. roles = comma-separated role names that may see it (empty =
-- everyone). help_key optionally ties an article to a screen for contextual help.

CREATE TABLE IF NOT EXISTS help_articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(120) NOT NULL,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'General',
  summary VARCHAR(300) NULL,
  body MEDIUMTEXT NULL,
  tags VARCHAR(300) NULL,
  roles VARCHAR(200) NULL,
  help_key VARCHAR(80) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_by_id INT NULL,
  updated_by_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_help_slug (slug),
  KEY idx_help_category (category),
  KEY idx_help_key (help_key)
);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0081', NOW());
