-- 0233_employer_form_invites.sql
-- Security finding #1b: replace the employer-form's purpose-scoped JWT with a random,
-- DB-stored, revocable, short-lived token — the same pattern as visitor_signup_invites.
-- The old JWT links stop working (finding #1a already neutralised them as session tokens);
-- members with a stale link simply get a fresh one on the next Communications send.

CREATE TABLE IF NOT EXISTS employer_form_invites (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  token         VARCHAR(64) NOT NULL,
  member_id     INT NOT NULL,
  sent_to       VARCHAR(255) NULL,
  expires_at    DATETIME NULL,
  revoked_at    DATETIME NULL,
  last_used_at  DATETIME NULL,
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uq_efi_token (token),
  KEY idx_efi_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0233_employer_form_invites', NOW());
