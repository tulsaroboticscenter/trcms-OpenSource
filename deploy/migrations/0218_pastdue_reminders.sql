-- 0218 — Weekly "past-due membership payment" reminders for families that owe a balance and
-- have NOT set up a payment plan. Adds a throttle column so the weekly cron won't double-send,
-- and seeds an admin-editable email template (Communications -> Email Templates, category
-- "past_due"). Idempotent: the template is only inserted if one doesn't already exist.

ALTER TABLE enrollments ADD COLUMN pastdue_reminded_at DATE NULL AFTER date_payment;

-- New template category for the past-due reminder (keeps it grouped/filterable in the admin
-- Email Templates manager, and gives the cron a stable handle that a rename can't break).
ALTER TABLE email_templates
  MODIFY category ENUM('visitor','member','volunteer','sponsor','summer_camp','general','past_due') NOT NULL;

INSERT INTO email_templates
    (name, category, description, subject_template, body_html_template, available_variables, reply_enabled, is_active, created_at, updated_at)
SELECT
    'Past-Due Payment Reminder',
    'past_due',
    'Weekly reminder to the parents/guardians of members who still owe a membership balance and have NOT set up a payment plan. One email per family (all their youth listed). Sent automatically by the past-due reminder cron; nothing is sent to families with a $0 balance, a payment plan, or a payment override.',
    'Membership payment reminder — {{total_due}} due',
    CONCAT(
        '<p>Hello,</p>',
        '<p>Our records show an outstanding membership balance for your family at {{center_name}}:</p>',
        '{{members}}',
        '<p><strong>Total due: {{total_due}}</strong></p>',
        '<p>You can pay online by card, or by check or cash at the center. If you have already paid, thank you — please disregard this notice. If you would like to set up a monthly payment plan, just reply and we will help.</p>',
        '{{pay_link}}',
        '<p>Thank you,<br>{{center_name}}</p>'
    ),
    '["center_name","family_name","members","total_due","pay_link"]',
    1, 1, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM email_templates t WHERE t.category = 'past_due');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0218_pastdue_reminders', NOW());
