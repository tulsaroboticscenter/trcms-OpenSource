-- 0095 — Track asset donations: whether an item was donated to the program and
-- who donated it. The donor can be a member (parent/mentor/volunteer), a sponsor,
-- or a free-form name (individual or company). Only one donor reference is set.

ALTER TABLE inv_items
  ADD COLUMN is_donated       TINYINT(1) NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN donor_member_id  INT NULL AFTER is_donated,
  ADD COLUMN donor_sponsor_id INT NULL AFTER donor_member_id,
  ADD COLUMN donor_name       VARCHAR(200) NULL AFTER donor_sponsor_id,
  ADD COLUMN donation_date    DATE NULL AFTER donor_name,
  ADD CONSTRAINT fk_inv_donor_member  FOREIGN KEY (donor_member_id)  REFERENCES members(id)  ON DELETE SET NULL,
  ADD CONSTRAINT fk_inv_donor_sponsor FOREIGN KEY (donor_sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0095', NOW());
