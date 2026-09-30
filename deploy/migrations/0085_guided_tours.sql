-- 0085 — Guided Tours (Release 3.3). DB-backed, admin-editable step-by-step tours
-- that walk a user through a screen or workflow with a spotlight + tooltip overlay.
-- Complements the searchable Help Center: help = reference, tours = "show me".
--
-- steps is a JSON array of objects: { "selector": "#nav-events", "title": "...",
-- "body": "...", "route": "/events", "placement": "auto" }. selector is a CSS
-- selector to spotlight (omit for a centered modal step). route (optional) is a
-- path to navigate to before showing the step. roles = comma-separated role names
-- that may see/launch the tour (empty = everyone). auto_key, when set, makes the
-- tour auto-offer once on the matching screen (dismissed state kept client-side).

CREATE TABLE IF NOT EXISTS guided_tours (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tour_key VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description VARCHAR(400) NULL,
  steps MEDIUMTEXT NOT NULL,          -- JSON array of step objects
  roles VARCHAR(200) NULL,
  auto_key VARCHAR(80) NULL,          -- screen key to auto-offer on (optional)
  sort_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_by_id INT NULL,
  updated_by_id INT NULL,
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_tour_key (tour_key),
  KEY idx_tour_auto (auto_key)
);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0085', NOW());
