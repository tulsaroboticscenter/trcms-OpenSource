-- Feedback follow-up: let the person who submitted a piece of feedback confirm the
-- fix/enhancement works as they asked, and carry on a conversation about it (#161,
-- Anita: "would be cool to be able to update feedbacks").
--
-- Two parts:
--   1. A threaded comment trail, usable by the submitter AND by triagers, so a
--      "tested and it works" note (or a "not quite, here's what's still off") has a
--      home instead of dying in an email.
--   2. A confirmation stamp on the feedback itself, set when the submitter says the
--      resolution works, so triage can see at a glance which delivered items the
--      reporter has actually signed off.
CREATE TABLE IF NOT EXISTS feedback_comments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  feedback_id  INT NOT NULL,
  member_id    INT NULL,               -- author; NULL if the account is later removed
  body         TEXT NOT NULL,
  -- 'confirmed' marks the comment that accompanied the submitter's sign-off, so the
  -- thread shows WHY the item was confirmed. Plain comments are 'comment'.
  kind         VARCHAR(20) NOT NULL DEFAULT 'comment',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_feedback (feedback_id, created_at),
  CONSTRAINT fk_fbcomment_feedback FOREIGN KEY (feedback_id) REFERENCES feedback (id) ON DELETE CASCADE
);

-- Submitter sign-off, stamped once and clearable if they change their mind.
ALTER TABLE feedback
  ADD COLUMN confirmed_at    DATETIME NULL AFTER resolution_notes,
  ADD COLUMN confirmed_by_id INT      NULL AFTER confirmed_at;
