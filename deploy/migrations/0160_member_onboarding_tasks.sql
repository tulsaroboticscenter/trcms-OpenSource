-- Per-member onboarding checklist ("jumping-off point" for YPT and the rest of
-- joining TRC). Admins assign items to a person as they join; the member sees the
-- open ones on their own page with a link to the instructions.
--
-- IMPORTANT: completion is NOT stored here for items that already have a canonical
-- source. The 'ypt' and 'background_check' items derive their completed state from
-- the existing compliance records (adult_roles / mentor_compliance_records) at read
-- time -- see OnboardingController::ITEMS. completed_at below is authoritative only
-- for source='manual' items (handbook read, Code of Conduct signature page), so
-- there is exactly one source of truth per item.
CREATE TABLE IF NOT EXISTS member_onboarding_tasks (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  member_id       INT NOT NULL,
  item_key        VARCHAR(64) NOT NULL,
  assigned_by_id  INT NULL,
  assigned_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date        DATE NULL,
  completed_at    DATETIME NULL,
  completed_by_id INT NULL,
  notes           TEXT NULL,
  UNIQUE KEY uq_member_item (member_id, item_key),
  KEY idx_open (member_id, completed_at),
  KEY idx_item (item_key)
);

-- Permissions. onboarding.view = see someone else's checklist / the outstanding
-- report; onboarding.manage = assign, unassign, mark a manual item done for someone.
-- A member always sees and completes their OWN items with no key (self-access is
-- handled in the controller), same as the medical/reflections pattern.
-- Both default to 'none' in config/permissions.json -- a key that is only in the
-- catalog falls through to DEFAULT_LEVEL='write' and is silently world-writable.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'onboarding.view', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Executive Director', 'Mentor', 'Mentor - Lead')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'onboarding.view');

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'onboarding.manage', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Executive Director', 'Mentor - Lead')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'onboarding.manage');

-- The instructions themselves, as a Help Center article. This is what the onboarding
-- item links to, and what you can point people at directly. Screenshots live in the
-- linked PDF (prod cannot serve /uploads/, so that file is hosted on Google Drive --
-- paste its share link where the placeholder says so).
INSERT INTO help_articles (slug, title, category, summary, body, tags, roles, help_key, sort_order, is_published, created_at, updated_at)
SELECT 'youth-protection-training',
       'Youth Protection Training & Background Check (VIRTUS)',
       'Volunteering',
       'Everyone 18 and older who is active at TRC completes youth protection training, a background check, and the Code of Conduct. Start here.',
       CONCAT(
'# Youth Protection Training & Background Check\n\n',
'Everyone age 18 and older who is active in the Tulsa Robotics Center — youth, volunteers, and mentors — completes the volunteer certification process and abides by the **TRC Code of Conduct**, which requires two-deep leadership in all settings where youth under 18 are involved.\n\n',
'## What the process includes\n\n',
'1. An online youth protection training program\n',
'2. Authorizing a criminal background check\n',
'3. Committing to uphold the STEAM Post 26 Code of Conduct\n\n',
'## Start here\n\n',
'**[Register with VIRTUS Online](http://www.ncsrisk.org/ncs/registration/reg_2.cfm?theme=0&org=37871)**\n\n',
'After setting up your account you will be prompted to authorize the background check and take the training modules.\n\n',
'## Step by step\n\n',
'1. **Create a User ID and password** you can easily remember — this establishes your VIRTUS account. If your preferred ID is taken, choose another. Click **Continue**.\n',
'2. **Fill in every requested field.** First and last name, email, home address, city, state, ZIP, phone, and date of birth are all required. *Do not click the back button or your registration will be lost.* Click **Continue**.\n',
'3. **Confirm your location**, then select the role(s) you serve and a short description of your service. Click **Continue**.\n',
'4. **Click "Begin Sterling Volunteers Background Check."** This takes you to Sterling''s site to submit the background check. Once you fully submit, you are returned to VIRTUS.\n',
'5. **Complete the training.** Click "You have 1 online module assigned," then the green circle to begin.\n\n',
'The modules take about an hour to an hour and a half. You can stop, log out, and resume — your progress is saved.\n\n',
'**Please authorize the background check right away** so it can be in process, and complete the training at your earliest opportunity.\n\n',
'## Illustrated instructions\n\n',
'The screenshot walkthrough is here: **[VIRTUS Registration Instructions (PDF)](PASTE_GOOGLE_DRIVE_LINK_HERE)**\n\n',
'## Already trained elsewhere?\n\n',
'If you have current youth protection credentials through **VIRTUS or BSA**, you do not have to start over. Send a digital copy of your training completion certificate and the date of your last background check to the admin team. You will still need to submit a signature page for the Code of Conduct.\n\n',
'## Also required\n\n',
'- Read the **TRC Handbook**, which contains the Code of Conduct.\n',
'- Make sure your **TRC Terms & Conditions** are fully executed in your account.\n',
'- After reading the Code of Conduct, sign it and give the signature page to anyone on the admin team.\n\n',
'## Need help?\n\n',
'For trouble logging in or other VIRTUS issues, contact the **VIRTUS Help Desk at 1-888-847-8870**. For anything TRC-specific, ask the admin team.\n'
       ),
       'ypt,virtus,background check,volunteer,onboarding,code of conduct,compliance',
       NULL,
       'onboarding.ypt',
       10,
       1,
       NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM help_articles WHERE slug = 'youth-protection-training');

-- The email you already send by hand, as a reusable Communications template.
INSERT INTO email_templates (name, category, description, subject_template, body_html_template, available_variables, reply_enabled, is_active, created_at, updated_at)
-- Category 'member' (not 'volunteer') because these go to people who already have a
-- member record -- that context is the one that supplies {{login_url}}.
SELECT 'YPT / Volunteer Certification — Getting Started',
       'member',
       'Sent to a new adult (mentor, volunteer, or 18+ youth) to kick off youth protection training, the background check, and the Code of Conduct.',
       'Getting started: TRC volunteer certification',
       CONCAT(
'<p>Dear {{first_name}},</p>',
'<p>As you may know, everyone age 18 and older who is active in the Tulsa Robotics Center &mdash; youth, volunteers, and mentors &mdash; needs to complete the volunteer certification process* and abide by the TRC Code of Conduct, which requires two-deep leadership in all settings where youth under age 18 are involved. Please take a moment to read the instructions, then get started on the certification.</p>',
'<p>The process includes</p>',
'<ol><li>completion of an online youth protection training program,</li>',
'<li>authorizing a criminal background check, and</li>',
'<li>committing to upholding the STEAM Post 26 Code of Conduct.</li></ol>',
'<p>After setting up your online account, you&rsquo;ll be prompted to authorize a criminal background check and take the youth protection training modules.</p>',
'<p><strong>Detailed instructions, including screenshots, are in TRCMS: <a href="{{login_url}}">sign in</a> and go to ',
'Help &rarr; &ldquo;Youth Protection Training &amp; Background Check.&rdquo;</strong></p>',
'<p>Please read the TRC Handbook, which includes the Code of Conduct, and then make sure that your TRC T&amp;C is fully executed in your account.</p>',
'<p>*If you have current youth protection training credentials via VIRTUS or BSA, please reply with a digital copy of your training completion certificate and the date of your last background check. You will still need to submit a signature page for the Code of Conduct.</p>',
'<p>Please go ahead and authorize the background check so that it can be in process. The youth protection training needs to be completed at your earliest opportunity. The training modules should take about an hour to an hour and a half to complete. You can stop, log out, and resume the modules if need be.</p>',
'<p>After reading the Code of Conduct, please sign and give the signature page of that document to anyone on the admin team.</p>',
'<p>If you have any questions, please let us know.</p>',
'<p>To start the process, please <a href="http://www.ncsrisk.org/ncs/registration/reg_2.cfm?theme=0&amp;org=37871">click here</a>.</p>',
'<p>Thanks so much!<br>The admin team~<br>Christopher, Bonnie, Anita, and Josh</p>'
       ),
       '["first_name","last_name","email","org_name","login_url"]',
       1, 1, NOW(), NOW()
 WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'YPT / Volunteer Certification — Getting Started');
