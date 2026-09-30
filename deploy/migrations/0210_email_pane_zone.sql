-- 0210 — Move the "System Email History" profile pane onto its own new "Email" tab.
-- The saved profile_layout config explicitly places panes and overrides the code default
-- (AdminController::PROFILE_PANE_DEFAULTS['communications'] = 'email'), so patch the saved
-- JSON. If no saved layout row exists, the code default already puts it on the Email tab.
-- Admins can re-place it anytime via Admin -> Profile Sections (the new "Email Page" zone).
UPDATE system_config
   SET `values` = JSON_SET(`values`, '$.communications', 'email')
 WHERE category = 'profile_layout' AND JSON_VALID(`values`);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0210_email_pane_zone', NOW());
