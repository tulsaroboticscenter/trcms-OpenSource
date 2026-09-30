-- 0226 — Let a visitor record be archived so it drops out of the visitor list/search, status
-- counts, and follow-up reminders, without deleting it. Reversible (un-archive).
ALTER TABLE visitors
  ADD COLUMN is_archived    TINYINT(1) NOT NULL DEFAULT 0 AFTER converted_member_id,
  ADD COLUMN archived_at    DATETIME NULL AFTER is_archived,
  ADD COLUMN archived_by_id INT NULL AFTER archived_at,
  ADD KEY idx_visitors_archived (is_archived);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0226_visitor_archive', NOW());
