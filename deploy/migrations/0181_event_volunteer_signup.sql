-- Events can be opened to OUTSIDE volunteers, and carry their own sign-up details.
--
-- The "My Volunteering" opportunities feed shows ONLY events flagged volunteer_open. Each
-- can add an external sign-up link (e.g. the FIRST volunteer site) and a note, shown next
-- to signing up through our own interface.

ALTER TABLE events
  ADD COLUMN volunteer_open        TINYINT      NOT NULL DEFAULT 0,
  ADD COLUMN volunteer_signup_url  VARCHAR(500) NULL,
  ADD COLUMN volunteer_signup_note TEXT         NULL;
