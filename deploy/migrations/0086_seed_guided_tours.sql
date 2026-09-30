-- 0086 — Seed starter guided tours (Release 3.3). Admins can edit/expand these
-- under Admin → Guided Tours. Steps use centered cards (no CSS selector) so they
-- are robust to layout changes; admins can add spotlight selectors later.

INSERT INTO guided_tours (tour_key, title, description, roles, auto_key, sort_order, is_published, steps, created_at, updated_at)
VALUES
('welcome', 'Welcome to TRCMS', 'A quick orientation to the dashboard and where to find things.', NULL, 'dashboard', 10, 1,
 '[
   {"title":"Welcome to TRCMS 👋","body":"This is the Tulsa Robotics Center Management System. This short tour shows you the basics. You can stop any time with **Skip**, and re-take any tour from the **?** button in the corner.","route":"/"},
   {"title":"Your dashboard","body":"The dashboard is your home base. Tiles here take you to the areas you have access to — members, teams, events, and more. What you see depends on your role.","route":"/"},
   {"title":"The calendar","body":"**Events** shows the shared calendar. US federal holidays appear automatically, and your teams'' events (including informational announcements) show here too.","route":"/events"},
   {"title":"Getting help","body":"The **?** button in the bottom corner opens the Help Center — search articles, open the full user manual, or launch a tour like this one. That is the fastest way to answer a ''how do I…'' question.","route":"/"}
 ]', NOW(), NOW()),

('parent-register-pay', 'Enroll & pay for your youth', 'How guardians agree to Terms, enter shirt sizes, and pay enrollment.', 'Parent', NULL, 20, 1,
 '[
   {"title":"Your family dashboard","body":"As a guardian you see each of your youth here. From a youth you can review their enrollments and complete what''s needed for the season.","route":"/"},
   {"title":"Step 1 — Terms & Conditions","body":"Before paying, each enrollment''s **Terms & Conditions** must be signed. Signing once covers all of that youth''s enrollments for the season. If anything is outstanding you''ll also see a reminder banner when you log in."},
   {"title":"Step 2 — Shirt size","body":"At checkout you''ll confirm your youth''s shirt size. Whatever you pick updates their record automatically — no need to tell a mentor separately."},
   {"title":"Step 3 — Pay","body":"Use **Check out with CC** to pay a youth''s unpaid enrollments together in one secure transaction. You can also choose to cover the small processing fee, or make a one-time donation to TRC from the same screen."}
 ]', NOW(), NOW()),

('admin-settings', 'Admin: settings & content', 'Where the admin team manages payments, help, holidays, and tours.', 'Admin', NULL, 30, 1,
 '[
   {"title":"The Admin Console","body":"Everything an administrator configures lives under **Admin**. This tour points out the pieces most teams touch.","route":"/admin"},
   {"title":"Payment Settings","body":"Under **Admin → Payment Settings** you turn card providers (Square, PayPal) on or off, set the processing-fee percentages, and manage the manual methods (Cash, Check, Scholarship…) that only staff can record.","route":"/admin/payments"},
   {"title":"Help articles","body":"**Admin → Help Articles** is where you write and edit the searchable in-app help (Markdown). The user manual is generated from these same articles.","route":"/admin/help"},
   {"title":"Holidays & closures","body":"**Admin → Holidays & Closures** lets you add TRC-specific closures or breaks on top of the automatic federal holidays.","route":"/admin/holidays"},
   {"title":"Guided tours","body":"**Admin → Guided Tours** (this feature) is where you create and edit tours like this one for your members.","route":"/admin/tours"}
 ]', NOW(), NOW());

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0086', NOW());
