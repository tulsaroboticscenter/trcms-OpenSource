-- Distinguish WHY a youth hid a scholarship: "not_eligible" (doesn't qualify) vs
-- "not_applying" (eligible, but choosing not to). Both hide it from the board;
-- the reason is shown in the "Hidden" review list. Existing rows were all the
-- original not-eligible dismissals.
ALTER TABLE college_scholarship_dismissed
  ADD COLUMN reason VARCHAR(20) NOT NULL DEFAULT 'not_eligible' AFTER member_id;
