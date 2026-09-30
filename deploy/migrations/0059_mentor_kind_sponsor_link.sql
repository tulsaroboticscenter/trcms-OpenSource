-- 0059_mentor_kind_sponsor_link.sql — let the adult pipeline hold both mentors and
-- volunteers (a 'kind'), and link a prospect to a Sponsor record without removing
-- them from the pipeline (sponsor contacts often become mentors).

ALTER TABLE mentor_prospects
  ADD COLUMN kind       ENUM('mentor','volunteer') NOT NULL DEFAULT 'mentor' AFTER name,
  ADD COLUMN sponsor_id INT NULL AFTER converted_member_id;

ALTER TABLE mentor_prospects
  ADD CONSTRAINT fk_mp_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0059_mentor_kind_sponsor_link', NOW());
