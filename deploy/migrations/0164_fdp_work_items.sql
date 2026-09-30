-- FDP Management, Phase 3: assign work to FDP youth.
--
-- Reuses the per-member task machinery built for the onboarding checklist (0160)
-- rather than standing up a second task system: it already does assign-to-a-person,
-- due dates, completion, and a manager/self split, and it already renders on the
-- member's profile.
--
-- Two kinds of row now live in this table, told apart by `category`:
--   'onboarding' — the fixed joining checklist (YPT, background check, …). Its label
--                  and description come from the code catalog, keyed by item_key.
--   'fdp_work'   — free-form work a mentor assigns to an FDP youth. Its label lives in
--                  the new `title`/`description` columns, because there's no catalog.
--
-- The existing UNIQUE(member_id, item_key) is deliberately kept: it's what makes
-- re-assigning 'ypt' update instead of duplicate. Work items get a generated unique
-- item_key ('work:<random>') so a youth can hold many of them without touching that
-- constraint.
ALTER TABLE member_onboarding_tasks
  ADD COLUMN category    VARCHAR(20)  NOT NULL DEFAULT 'onboarding' AFTER member_id,
  ADD COLUMN title       VARCHAR(200) NULL AFTER category,
  ADD COLUMN description TEXT         NULL AFTER title;

-- Listing one youth's work, or everything still outstanding, are the two hot reads.
CREATE INDEX idx_member_category ON member_onboarding_tasks (member_id, category, completed_at);
