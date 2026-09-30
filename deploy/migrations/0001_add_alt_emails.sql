-- Alternate emails per member, each with an opt-in delivery toggle.
ALTER TABLE members
  ADD COLUMN alt_email1 VARCHAR(200) NULL,
  ADD COLUMN alt_email1_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN alt_email2 VARCHAR(200) NULL,
  ADD COLUMN alt_email2_enabled TINYINT(1) NOT NULL DEFAULT 0;
