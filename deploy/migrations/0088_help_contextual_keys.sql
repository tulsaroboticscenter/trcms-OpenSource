-- 0088 — Documentation P2: wire more screens to contextual help. Give existing
-- seeded articles a help_key so the on-screen "?" opens the right article, and add
-- two articles for the newest features (Events Calendar overlays, College
-- Scholarships). Idempotent: keyed by unique slug.

UPDATE help_articles SET help_key = 'terms-conditions' WHERE slug = 'terms-and-conditions';
UPDATE help_articles SET help_key = 'waitlist'         WHERE slug = 'the-waitlist';
UPDATE help_articles SET help_key = 'donation'         WHERE slug = 'one-time-donation';
UPDATE help_articles SET help_key = 'ylc-minutes'      WHERE slug = 'ylc-minutes';
UPDATE help_articles SET help_key = 'dashboard'        WHERE slug = 'getting-started';
UPDATE help_articles SET help_key = 'payment-settings' WHERE slug = 'admin-payment-settings';

INSERT INTO help_articles (slug, title, category, summary, body, tags, roles, help_key, sort_order, is_published, created_at, updated_at)
VALUES
('events-calendar', 'The Events Calendar', 'Events',
 'Reading the calendar, RSVPs, and the mentor-coverage & RSVP overlays.',
 '# The Events Calendar\n\nThe calendar shows every event, plus US federal holidays (automatic) and any TRC closures.\n\n## RSVP to events\nOpen an event and choose **Attending**, **Maybe**, or **Not Attending**. Mentors use this to signal their availability for an event.\n\n## Coverage & RSVP overlays\nTwo buttons at the top color the whole month at a glance:\n\n- **Check Mentor Availability** — each event turns **green** when 3+ mentors have RSVP''d Attending, **yellow** at exactly 2, and **red** under 2. The number on the event is how many mentors are attending. (Informational events are skipped — they need no coverage.)\n- **RSVP Status** — colors events by *your* RSVP: green = Attending, yellow = Maybe/Not Attending, red = you haven''t responded.\n\nClick a button again (or **Clear**) to turn the overlay off.\n\n## Informational events\nAn **info event** is an announcement or deadline with no check-in. Tag teams on it and it appears on their team calendars, shown in purple with a 📣.',
 'calendar,events,rsvp,mentor coverage,holidays', NULL, 'events-calendar', 10, 1, NOW(), NOW()),

('college-scholarships', 'College Scholarships', 'College Scholarships',
 'Browse, follow, and apply for outside college scholarships.',
 '# College Scholarships\n\nThis is where youth find **outside scholarships to apply to for college**. It is separate from TRC''s internal dues scholarship.\n\n## For youth & families\n- **Browse the board** and filter by *Open now*, *I''m eligible*, or *Following*.\n- A **“You may be eligible”** flag appears when your profile (graduation year, race, sex) matches the scholarship''s requirements. Always read the full eligibility — some criteria (career path, GPA, tribal affiliation, etc.) aren''t on your profile.\n- **Follow** a scholarship to be reminded — followed and eligible scholarships that are open show up in your alerts.\n- Tap **I applied** once you''ve submitted, and use **Learn more & apply** to reach the provider''s site.\n\n## For mentors & admins\nUnder **Manage** you maintain the catalog: link, award amount, application window, and eligibility (structured fields drive the eligibility flags; tags/notes cover everything else). **Reports** shows who applied and lets you record outcomes (granted / partial / declined / no decision). At season change, **Roll season forward** clones the catalog into the new season.',
 'scholarship,college,apply,eligibility,follow', NULL, 'college-scholarships', 10, 1, NOW(), NOW())
ON DUPLICATE KEY UPDATE title = VALUES(title), summary = VALUES(summary), body = VALUES(body), help_key = VALUES(help_key), updated_at = NOW();

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0088', NOW());
