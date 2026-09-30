-- Canonical night preference — one source of truth, captured at first touch.
--
-- Which meeting night(s) a youth can do was previously asked only when staff put
-- them on the waitlist (waitlist_entries.available_night_ids / preferred_night_id),
-- or via the separate tokenized Season Planning availability form
-- (season_availability.night_prefs). The actual intake points -- the visitor/interest
-- kiosk and enrollment -- never asked, so by the time someone was waitlisted nobody
-- had captured their preference.
--
-- This table holds ONE preference per youth per program per season, keyed on EITHER a
-- visitor_id (prospective, pre-member) OR a member_id (mirrors how waitlist_entries
-- already keys). Every surface -- visitor intake, visitor->member convert, waitlist
-- add, enrollment, the planning board -- reads and writes this one record.
--
-- Model (per the FLL Director's choice): "nights that work" (available_night_ids, a
-- JSON array of program_nights.id) plus one "preferred night" (preferred_night_id).
-- siblings_together carries the family-default "keep my kids on the same night" signal.
CREATE TABLE IF NOT EXISTS night_preferences (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  member_id           INT NULL,                 -- set once the youth is a member
  visitor_id          INT NULL,                 -- set at the prospective/visitor stage
  program_id          INT NOT NULL,
  season              VARCHAR(10) NOT NULL,      -- "YYYY-YYYY"
  available_night_ids JSON NULL,                 -- nights that work (program_nights.id[])
  preferred_night_id  INT NULL,                  -- the single preferred night
  flexible            TINYINT(1) NOT NULL DEFAULT 0,  -- "any night works"
  siblings_together   TINYINT(1) NOT NULL DEFAULT 0,  -- keep siblings on the same night
  source              VARCHAR(20) NULL,          -- intake | waitlist | enrollment | family_form | admin
  notes               VARCHAR(255) NULL,
  updated_by_id       INT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- MySQL treats NULLs as distinct in a UNIQUE index, so member rows (visitor_id NULL)
  -- and visitor rows (member_id NULL) never collide with each other on these keys.
  UNIQUE KEY uq_np_member  (member_id, program_id, season),
  UNIQUE KEY uq_np_visitor (visitor_id, program_id, season),
  KEY idx_np_program_season (program_id, season)
);

-- Don't lose what was already captured on the waitlist. Seed the canonical record
-- from every waitlist entry that carries a night answer. INSERT IGNORE because the
-- table is new/empty and a couple of waitlist rows may carry both ids.
INSERT IGNORE INTO night_preferences
  (member_id, visitor_id, program_id, season, available_night_ids, preferred_night_id, source, created_at, updated_at)
SELECT we.member_id, we.visitor_id, we.program_id, we.season,
       we.available_night_ids, we.preferred_night_id, 'waitlist', NOW(), NOW()
  FROM waitlist_entries we
 WHERE we.available_night_ids IS NOT NULL OR we.preferred_night_id IS NOT NULL;
