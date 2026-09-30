-- Feedback enhancements: a 4th type ("enhancement"), a submitter-suggested
-- target release, and tracking who actually entered an item (when a manager
-- submits on behalf of someone else).
ALTER TABLE feedback
  MODIFY COLUMN type ENUM('bug','feature','enhancement','other') NOT NULL DEFAULT 'bug',
  ADD COLUMN target_release VARCHAR(40) NULL,
  ADD COLUMN entered_by_id INT NULL;

ALTER TABLE feedback
  ADD CONSTRAINT fk_feedback_entered_by FOREIGN KEY (entered_by_id) REFERENCES members(id) ON DELETE SET NULL;
