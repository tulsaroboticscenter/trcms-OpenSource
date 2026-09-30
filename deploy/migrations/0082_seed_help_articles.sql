-- 0082 — Seed starter Help Center articles (Release 3.3). INSERT IGNORE by slug
-- so it's safe to re-run and won't clobber edits your team makes in-app.

INSERT IGNORE INTO help_articles (slug, title, category, summary, body, tags, roles, help_key, sort_order, is_published, created_at, updated_at) VALUES

('getting-started', 'Getting started with TRCMS', 'General',
 'A quick tour of what you can do and where to find it.',
'# Welcome to TRCMS

TRCMS is the Tulsa Robotics Center management system. What you can see and do depends on your role.

- **Parents/Guardians** manage your youth: enrollment, Terms & Conditions, payments, and shirt sizes.
- **Youth** see your teams, events, tasks, and can log your time.
- **Mentors & Admins** manage teams, events, recruiting, and program settings.

**Finding help:** click the **?** button (bottom-right of any screen) to search these articles anytime.

**Your dashboard** shows what needs your attention — outstanding enrollment items, upcoming events for your groups, and your assigned tasks.',
 'welcome,overview,start', '', '', 0, 1, NOW(), NOW()),

('paying-registration', 'Paying a registration fee', 'Enrollment & Payments',
 'How to pay your youth''s enrollment fees online.',
'# Paying a registration fee

1. Open your youth''s profile and go to the **Enrollments** tab.
2. In the **Pay enrollment fees** box you''ll see each unpaid enrollment and a **Total due**. A youth''s enrollments (e.g. FTC + FRC) are paid together in one transaction.
3. Confirm the **shirt size** (required) and, if you like, check the box to **cover the processing fee** so 100% of your payment supports TRC.
4. Click **Check out with CC** to finish on a secure checkout page. A receipt is emailed to you, and the balance updates automatically.

**Note:** the enrollment **Terms & Conditions** must be signed before you can pay — see *Signing the Terms & Conditions*.',
 'pay,payment,fee,checkout,shirt', '', 'pay-enrollments', 0, 1, NOW(), NOW()),

('terms-and-conditions', 'Signing the Terms & Conditions', 'Enrollment & Payments',
 'Why and how to sign the enrollment T&C.',
'# Signing the Terms & Conditions

Each season''s enrollment requires the **Terms & Conditions** to be signed before payment.

- You only sign **once per season** — it covers all of that youth''s enrollments (e.g. FTC and FRC together).
- If something still needs signing, you''ll see a **Sign T&C** prompt on the payment screen or a reminder banner on your dashboard.
- Click **Sign T&C**, review, and agree. The enrollment then becomes payable.',
 'terms,conditions,tc,sign,agreement', '', '', 1, 1, NOW(), NOW()),

('the-waitlist', 'How the waitlist works', 'Enrollment & Payments',
 'What it means to be waitlisted and when you can pay.',
'# How the waitlist works

Some programs (like FLL) have limited spots per night, so youth may join a **waitlist**.

- While a youth is **waiting**, you **don''t pay** the registration fee yet. You can still sign the T&C and confirm the shirt size.
- When a spot opens, you''ll be **offered** it — at that point the payment option appears and you can check out.
- Priority considers siblings of current members and parents willing to mentor, then the date you requested.',
 'waitlist,waiting,offer,spot,fll', '', '', 2, 1, NOW(), NOW()),

('one-time-donation', 'Making a one-time donation', 'Enrollment & Payments',
 'Give a tax-deductible gift to TRC.',
'# Making a one-time donation

On the payment screen there''s a **Make a one-time donation** box.

1. Pick a preset amount or enter your own.
2. Optionally add a note (e.g. "in honor of…") and choose to cover the processing fee.
3. Click **Donate** to finish on the secure checkout page.

TRC is a 501(c)(3) nonprofit; your gift is tax-deductible and a receipt is emailed to you.',
 'donate,donation,gift,give', '', '', 3, 1, NOW(), NOW()),

('logging-your-time', 'Logging your time', 'Members',
 'Record the time you spend and credit it to your team.',
'# Logging your time

Open **My Time** to record hours you spend on the robot, portfolio, outreach, and more.

1. Click **Log Time**, choose the date, and add one or more activities (category + hours or start/stop).
2. Use **Credit to a team** to attribute the time to your team — it rolls up into that team''s **Time & Impact**.
3. Community/outreach time counts toward volunteer hours.

Time logged on a team''s Season Plan activity or Team Task also counts toward that team automatically.',
 'time,hours,log,activity,impact', '', '', 0, 1, NOW(), NOW()),

('team-tasks', 'The TRC/Team Tasks board', 'Teams',
 'Claim, assign, and complete team tasks.',
'# TRC/Team Tasks

Each team (and the TRC general board) has a task board.

- **Add Task** to create work; anyone can **claim** ("I''ll take it") and mark it **Done**.
- Mentors can **assign a whole team** to a task with the **Team** button — it then appears on that team''s board.
- When completing a task you can record that a **person or a whole team** did it.',
 'tasks,team,board,claim,assign', '', '', 0, 1, NOW(), NOW()),

('recurring-tasks', 'Recurring & rotating tasks', 'Teams',
 'Set up chores that repeat and rotate between teams.',
'# Recurring & rotating tasks

When adding a task, open **Assign a team or make it recurring**:

- Set a **frequency** (daily / weekly / every 2 weeks / monthly) and a first due date.
- Optionally **rotate** the responsible team through a list you choose (the Quartermaster''s schedule).
- Each time the task is completed it rolls forward to the next due date and hands off to the next team — e.g. "take out the trash" weekly, rotating teams.',
 'recurring,rotating,chore,quartermaster,schedule', '', '', 1, 1, NOW(), NOW()),

('ylc-minutes', 'YLC meeting minutes & agenda', 'YLC',
 'Prepare agendas and record minutes and action items.',
'# YLC meeting minutes

From the **YLC** page (Roles → Youth Leadership Council, or the YLC group) open **Meeting Minutes**.

- **New meeting:** optionally tie it to a scheduled YLC event (pre-fills the title and date), or start blank.
- **Agenda:** prepare topics ahead of time in the Agenda box; capture the actual **Minutes** during/after.
- **Action items:** assign each to a member with a due date — they appear on that member''s dashboard under *My Assigned Tasks*.

The YLC group''s membership comes automatically from who''s tagged as a YLC member on the Roles page.',
 'ylc,minutes,agenda,meeting,action items', '', '', 0, 1, NOW(), NOW()),

('add-visitor', 'Adding a visitor (phone inquiries)', 'Recruiting',
 'Log a new inquiry that came in by phone or in person.',
'# Adding a visitor

For an inquiry that didn''t come through the public form (e.g. a phone call):

1. Go to **Visitor Management** and click **Add Visitor**.
2. Enter the youth''s name, guardian contact, program interest, how they heard about us, and any notes.
3. Save — the visitor is created in **new** status and you land on their record, where you can log the call, assign an owner, set a follow-up, or place them on the waitlist.

Use the **filters** (program, school, age) to find inquiries later.',
 'visitor,inquiry,phone,recruiting,add', 'Mentor, Admin, System Administrator', '', 0, 1, NOW(), NOW()),

('admin-payment-settings', 'Payment settings (admin)', 'Admin',
 'Turn providers on/off, set fees, and manage manual methods.',
'# Payment settings

**Admin → Payment Settings** controls online payments.

- **Online providers (Square, PayPal):** enable/disable each, and set its card **fee %** and fixed fee (used for the "cover the processing fee" math). A provider only appears to families when it''s configured on the server **and** enabled here.
- **Manual methods:** the list of admin-recorded payment methods (Cash, Check, Scholarship, eCheck, add your own). These are **admin-recorded only** — parents can never mark their own accounts paid.

Provider credentials (secret keys) live on the server (.env), never in the app.',
 'payments,admin,square,paypal,fees,settings', 'Admin, System Administrator', '', 0, 1, NOW(), NOW()),

('writing-help', 'Writing help articles', 'Admin',
 'How to add and edit Help Center content.',
'# Writing help articles

**Admin → Help Articles** is where this help content is managed.

- Click **New article**, give it a **Title** and **Category**, and write the **Body** in Markdown (headings, **bold**, _italic_, lists, [links](https://tulsaroboticscenter.org), and `code`). Use **Preview** to check formatting.
- **Summary** shows in search results. **Tags** improve search. **Roles** limits who sees it (blank = everyone).
- Toggle **Published** when it''s ready. Members find articles via the **?** button.

Tip: keep articles task-focused ("How to pay a fee") rather than screen-focused.',
 'help,articles,markdown,documentation,authoring', 'Admin, System Administrator', '', 1, 1, NOW(), NOW());

-- Contextual help keys (safe to re-run): tie articles to screens for the inline ? buttons.
UPDATE help_articles SET help_key = 'add-visitor'   WHERE slug = 'add-visitor'          AND (help_key IS NULL OR help_key = '');
UPDATE help_articles SET help_key = 'logging-time'  WHERE slug = 'logging-your-time'     AND (help_key IS NULL OR help_key = '');
UPDATE help_articles SET help_key = 'team-tasks'    WHERE slug = 'team-tasks'            AND (help_key IS NULL OR help_key = '');
