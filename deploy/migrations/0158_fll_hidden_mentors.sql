-- "Always hide" for adults on the FLL planning board pool.
--
-- The board pool lists every active adult (mentor/parent/volunteer) so any of them
-- can be assigned to lead/assist. But most adults aren't FLL mentors and just clutter
-- the pool. This records a persistent, program-agnostic hide so a chosen adult stays
-- off the board until explicitly un-hidden. (The System Administrator account is hidden
-- unconditionally in code — it should never be an assignable option — so it doesn't need
-- a row here.)
CREATE TABLE IF NOT EXISTS season_planning_hidden_mentors (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  member_id     INT NOT NULL,
  reason        VARCHAR(255) NULL,
  created_by_id INT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sphm_member (member_id)
);
