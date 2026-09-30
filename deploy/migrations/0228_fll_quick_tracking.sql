-- 0228 — FLL attendance quick-tracking. Adds a per-event flag ("Enable Quick Tracking for FLL")
-- and a dedicated kiosk station type. The FLL Attendance Station lands on a roster grid of all
-- current-season FLL (Explore + Challenge) teams with per-member check-in / check-out checkboxes,
-- tied to a quick-tracking event so presence credits their time.

ALTER TABLE events ADD COLUMN quicktrack_enabled TINYINT(1) NOT NULL DEFAULT 0;

-- New station role so a kiosk device can be created for FLL attendance (Admin -> Station Manager).
-- Modeled on the other station roles (see the 'Generic Station' etc. rows in system_roles).
INSERT IGNORE INTO system_roles (name, display_name, description, is_active)
VALUES ('FLL Attendance Station', 'FLL Attendance Station',
        'Kiosk station for FLL team attendance quick-tracking.', 1);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0228_fll_quick_tracking', NOW());
