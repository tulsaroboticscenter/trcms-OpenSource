-- The 1st/2nd emergency contacts don't always match the parent/guardian who
-- completed the form, so add a second emergency-contact set (#109, mostly youth).
ALTER TABLE members
  ADD COLUMN emergency_contact2_name         VARCHAR(200) NULL AFTER emergency_contact_relationship,
  ADD COLUMN emergency_contact2_phone        VARCHAR(20)  NULL AFTER emergency_contact2_name,
  ADD COLUMN emergency_contact2_relationship VARCHAR(100) NULL AFTER emergency_contact2_phone;

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0067_second_emergency_contact', NOW());
