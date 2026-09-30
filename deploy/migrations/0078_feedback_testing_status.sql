-- 0078 — Feedback: add a 'testing' status (work built, undergoing testing) and
-- reconcile the enum with the app's status list. The column was missing
-- 'in_review' (referenced in code) — add both so every status is storable.
-- Order reflects the pipeline: new → planned → in_progress → in_review →
-- testing → done / declined.

ALTER TABLE feedback
  MODIFY status ENUM('new','planned','in_progress','in_review','testing','done','declined')
  NOT NULL DEFAULT 'new';

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0078', NOW());
