-- 0110 — Link a team BOM to an Issue Log entry. When resolving an issue depends
-- on ordering parts, tag the team's BOM so the dependency is visible on the
-- issue. Mirrors the existing linked_activity_id.

ALTER TABLE team_issues
  ADD COLUMN linked_bom_id INT NULL AFTER linked_activity_id;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0110', NOW());
