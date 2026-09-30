-- Meeting engagement — the "Who's It?" spotlight picker.
-- A mentor turns it on for an event from their My Page and picks (or shuffles, or
-- hand-picks) someone from the members currently checked into that event. Members
-- checked into that event get a press-and-hold pane telling them only whether THEY
-- are it — never who else is.
CREATE TABLE IF NOT EXISTS event_spotlight (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  event_id           INT NOT NULL,
  is_active          TINYINT(1) NOT NULL DEFAULT 0,
  selected_member_id INT NULL,
  updated_by_id      INT NULL,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event (event_id)
);

-- Running the spotlight is gated by spotlight.manage (defaults 'none' in
-- config/permissions.json). Seed ADULTS who lead meetings only — deliberately NOT
-- Team Leader, so youth can't control who gets picked (grant it in Role Management
-- if you want youth leads to run it). Keyed by role NAME; safe to re-run.
-- Members need no permission to check their own status.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'spotlight.manage', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Mentor')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'spotlight.manage');
