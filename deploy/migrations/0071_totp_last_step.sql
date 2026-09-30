-- TOTP replay protection: remember the last time-step a member's code was
-- accepted, so the same 6-digit code can't be replayed within its window.
ALTER TABLE members
  ADD COLUMN totp_last_step BIGINT NULL AFTER totp_enabled;

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0071_totp_last_step', NOW());
