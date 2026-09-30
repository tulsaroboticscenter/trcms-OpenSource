-- 0184 — Seed a Youth getting-started tour + a first batch of end-user Help articles
-- (documentation review, 2026-07-28). Tour is role-targeted (Youth Member) and auto-offers
-- on the dashboard; the role-aware AutoOffer prefers it over the generic Welcome tour for
-- youth. Articles are INSERT IGNORE by slug (safe to re-run; never clobbers in-app edits).
-- Admins can edit both under Admin -> Guided Tours / Help Articles.

-- Youth getting-started tour (guarded so a re-run doesn't duplicate it).
INSERT INTO guided_tours (tour_key, title, description, roles, auto_key, sort_order, is_published, steps, created_at, updated_at)
SELECT 'youth-getting-started', 'Getting Started (Youth)',
       'A quick orientation for youth: time, resume, events, and where to get help.',
       'Youth Member', 'dashboard', 15, 1,
 '[
   {"title":"Welcome to TRC!","body":"Here''s a quick lay of the land. You can replay this anytime from the **?** button in the bottom corner.","route":"/"},
   {"title":"Your dashboard","body":"This is your home base — upcoming events, your tasks, and quick links to your teams all live here.","route":"/"},
   {"title":"Log your time","body":"Track the hours you put in — robot, outreach, portfolio, and more. It adds up across the season and counts toward recognition.","route":"/my-time"},
   {"title":"Build your resume","body":"Turn your robotics experience into a printable one-page resume. It fills in your teams, roles, and certifications for you.","route":"/resume"},
   {"title":"Events & RSVP","body":"See what''s coming up and let mentors know you''ll be there by tapping **Will you attend?** on an event.","route":"/events"},
   {"title":"Certifications","body":"See the skills and certifications you''ve earned, and what you can work toward next.","route":"/certifications"},
   {"title":"Need a hand?","body":"The **?** button opens searchable help articles, the full manual, and this tour — anytime.","route":"/"}
 ]', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM guided_tours WHERE tour_key = 'youth-getting-started');

-- Help articles.
INSERT IGNORE INTO help_articles (slug, title, category, summary, body, tags, roles, help_key, sort_order, is_published, created_at, updated_at) VALUES

('building-your-resume', 'Building your resume', 'Members',
 'Turn your TRC experience into a printable one-page resume.',
'# Building your resume

The Resume Builder turns your robotics experience into a clean, one-page resume.

1. Open **My Resume**.
2. Answer a few short questions. The page pre-fills what we already know — your **teams, roles, seasons, and certifications** — so there''s less to type.
3. Watch the live preview build as you go.
4. Click **Print** to save it as a PDF.

Prefer your own format? You can **upload** a version instead — it still counts as a resume on file (useful for the Dev Program).',
 'resume,my resume,pdf,cv', '', 'resume', 30, 1, NOW(), NOW()),

('my-volunteering', 'Volunteering: opportunities & your hours', 'Volunteering',
 'Find ways to help and print a report of the hours you''ve given.',
'# Volunteering

**My Volunteering** has two tabs.

**Opportunities** — upcoming events open to volunteers. Tap **Sign up through us** to sign up in our system, and use the **External sign-up** link when one is shown (for example, a FIRST event where you also register on the FIRST site).

**My Hours** — the time you''ve given, totalled event by event, plus a printable **Volunteer Hours Statement**. That statement is handy for reporting volunteer hours to an employer (many companies match or track volunteer time).',
 'volunteer,volunteering,hours,opportunities', '', 'my-volunteering', 30, 1, NOW(), NOW()),

('rsvping-to-events', 'RSVPing to an event', 'Events',
 'Let mentors know whether you''ll attend.',
'# RSVPing to an event

Open any event and use the **Will you attend?** box:

- Choose **Attending**, **Maybe**, or **Not Attending**.
- Tap a different option any time to change your answer.

Your RSVP helps mentors plan coverage for the event, and on fundraising events it''s how your participation is credited toward earnings.',
 'rsvp,events,attend,attending', '', 'events-rsvp', 30, 1, NOW(), NOW()),

('certifications', 'Certifications', 'Certifications',
 'Track the skills you''ve been signed off on.',
'# Certifications

Certifications track the skills you''ve been signed off on — tools, safety, software, and more.

- Open **Certifications** to see what you''ve earned, when, and what''s still available to work toward.
- Certifications feed your **resume** automatically, so anything you earn shows up there.
- For teams and the Dev Program, certifications help show you''re ready for hands-on work.

If you think a certification is missing, ask the mentor who signed you off — a mentor or admin records them.',
 'certifications,skills,badges,sign off', '', 'certifications', 30, 1, NOW(), NOW()),

('checking-in', 'Checking in at TRC', 'Check-In',
 'How to record that you were here, and for how long.',
'# Checking in at TRC

Checking in records that you were here and for how long — it''s how your time adds up across the season.

1. When you arrive, go to the **check-in kiosk**.
2. Find your name (or enter your member number) and confirm it''s you.
3. Pick what you''re here to work on if asked.
4. When you leave, **check out**. If you forget, the system closes you out at the end of the day so your hours aren''t overstated.

Your check-ins feed your logged **time** automatically, so you usually don''t have to enter hours by hand for time spent at the center.',
 'check-in,checkin,kiosk,arrive,time', '', 'checking-in', 30, 1, NOW(), NOW());
