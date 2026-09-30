-- Two-factor authentication (TOTP). Per-user enrollment; a system toggle in
-- security_settings governs whether the feature is active.
ALTER TABLE members
  ADD COLUMN totp_secret         VARCHAR(64) NULL AFTER password_hash,
  ADD COLUMN totp_pending_secret VARCHAR(64) NULL AFTER totp_secret,
  ADD COLUMN totp_enabled        TINYINT(1)  NOT NULL DEFAULT 0 AFTER totp_pending_secret,
  ADD COLUMN totp_enrolled_at    DATETIME    NULL AFTER totp_enabled;

-- One-time backup codes (hashed), used in place of a TOTP code if the app is lost.
CREATE TABLE IF NOT EXISTS member_backup_codes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  member_id  INT NOT NULL,
  code_hash  VARCHAR(255) NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_backup_member (member_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0068_two_factor', NOW());
