-- Self-service join link for visitors. The follow-up email carries a per-visitor
-- {{signup_url}}; clicking it opens a public page where the family confirms their
-- details and the program, and TRCMS converts them to members and sends the standard
-- welcome email.
--
-- Single-use and expiring, mirroring availability_invites (the emailed FLL family
-- form) -- these are the only unauthenticated write paths in the app, so the token IS
-- the authorization and must behave like one.
CREATE TABLE IF NOT EXISTS visitor_signup_invites (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  token         CHAR(40) NOT NULL,
  visitor_id    INT NOT NULL,
  sent_to       VARCHAR(255) NULL,
  expires_at    DATETIME NULL,
  used_at       DATETIME NULL,
  revoked_at    DATETIME NULL,
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_token (token),
  KEY idx_visitor (visitor_id)
);
