-- 0229 — Meal Planning notes. Adds a free-text notes field to the event logistics
-- Meal Planning panel for additional details (menu, dietary needs, who's bringing what, etc.).

ALTER TABLE event_logistics ADD COLUMN meal_notes TEXT NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0229_meal_notes', NOW());
