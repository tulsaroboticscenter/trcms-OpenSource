-- Configurable consent/waiver sections + per-person agreement tracking.
--
-- The section catalog itself lives in system_config (category 'consent_sections'),
-- so no table is needed for it. This migration adds the audit trail: one row per
-- section a person actually agreed to, per season, capturing a FULL-TEXT SNAPSHOT
-- of exactly what they saw at the moment they agreed (so a later edit to the
-- section text never changes the historical record).

CREATE TABLE IF NOT EXISTS member_consent_agreements (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    member_id       INT NOT NULL,
    enrollment_year INT NOT NULL,
    section_key     VARCHAR(64) NOT NULL,
    -- Which signing context recorded this: 'youth' (self), 'parent' (guardian for
    -- a youth), 'mentor', or 'volunteer'.
    audience        VARCHAR(16) NOT NULL,
    -- 'agreed' (acknowledgment), 'granted' / 'declined' (grant-decline sections).
    response        VARCHAR(16) NOT NULL,
    section_title   VARCHAR(255) NOT NULL,
    section_text    MEDIUMTEXT NOT NULL,          -- snapshot of the body they saw
    agreed_at       DATETIME NOT NULL,
    agreed_by_id    INT NULL,                     -- who clicked (self, guardian, or admin)
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_consent (member_id, enrollment_year, section_key, audience),
    KEY idx_consent_member_year (member_id, enrollment_year),
    KEY idx_consent_section (section_key, enrollment_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
