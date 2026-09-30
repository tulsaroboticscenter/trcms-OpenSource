-- Meeting action items can be assigned to more than one person.
--
-- Adds a join table (one row per assignee) as the source of truth. The existing single
-- meeting_action_items.assignee_member_id column is kept and set to the first assignee for
-- backward compatibility, but reads use this table. Existing single assignments are
-- backfilled so nothing is lost.
CREATE TABLE IF NOT EXISTS meeting_action_item_assignees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  action_item_id INT NOT NULL,
  member_id      INT NOT NULL,
  UNIQUE KEY uq_action_member (action_item_id, member_id),
  KEY idx_aia_member (member_id),
  CONSTRAINT fk_aia_action FOREIGN KEY (action_item_id) REFERENCES meeting_action_items (id) ON DELETE CASCADE,
  CONSTRAINT fk_aia_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
);

INSERT IGNORE INTO meeting_action_item_assignees (action_item_id, member_id)
SELECT id, assignee_member_id FROM meeting_action_items WHERE assignee_member_id IS NOT NULL;
