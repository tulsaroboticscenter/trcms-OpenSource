-- Group/bulk emails currently fan out into one communication_thread per
-- recipient with nothing linking them. Add a batch id (shared across all
-- threads from one bulk send) so the Message History can consolidate them
-- into a single expandable line. `batch_personalized` records whether the
-- send used per-recipient variables (so content differs per person).
ALTER TABLE communication_threads
  ADD COLUMN batch_id VARCHAR(64) NULL AFTER created_by_id,
  ADD COLUMN batch_personalized TINYINT(1) NULL AFTER batch_id,
  ADD KEY idx_ct_batch (batch_id);

-- Backfill: stitch together legacy bulk sends that share the same sender,
-- subject, and send-minute (this catches non-personalized blasts, whose
-- subject line is identical for everyone). Personalized legacy sends have
-- differing subjects and stay as individual lines — acceptable for old data.
-- The lowest thread id in each (sender, subject, minute) group is a compact,
-- deterministic key for that batch — no hashing function needed (MySQL 9
-- removed MD5/SHA1).
UPDATE communication_threads t
JOIN (
  SELECT created_by_id, subject, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS minute,
         MIN(id) AS min_id, COUNT(*) AS c
  FROM communication_threads
  WHERE batch_id IS NULL
  GROUP BY created_by_id, subject, minute
  HAVING c > 1
) g
  ON g.created_by_id <=> t.created_by_id
 AND g.subject = t.subject
 AND DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i') = g.minute
SET t.batch_id = CONCAT('legacy-', g.min_id),
    t.batch_personalized = 0
WHERE t.batch_id IS NULL;
