-- Public volunteer sign-up form (embedded on the marketing site via an iframe).
--
-- The form offers two tracks:
--   1. Mailing list only — a lightweight subscribe (name + email) that captures contact
--      info so we can keep people informed. Stored in mailing_list_subscribers (NOT a
--      member account). Emailable via the Communications bulk sender's new "Mailing list"
--      source, and convertible to an account later.
--   2. Volunteer account — a full member with the Volunteer type/role and a welcome email
--      (the same createSelfSignup path a self-signing visitor uses), for someone starting
--      the process of getting certified to work with youth. Being a member with an email
--      puts them on the mailing list (the bulk sender reaches every member not opted out).
--
-- Supporting data: a per-IP rate-limit log for the open endpoints (mirrors
-- camp_submit_log), the subscribers table, and two admin-editable config rows.

CREATE TABLE IF NOT EXISTS volunteer_submit_log (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  ip_hash    CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_vsl_ip_time (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Mailing-list subscribers: contacts who gave us their email but do NOT have an account.
-- member_id is set if they later become a member (then the member record is the source of
-- truth and the subscriber row is unsubscribed to avoid a double send). unsubscribed_at
-- lets staff (or the person) drop off the list without deleting the record.
CREATE TABLE IF NOT EXISTS mailing_list_subscribers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  first_name      VARCHAR(80)  NULL,
  last_name       VARCHAR(80)  NULL,
  email           VARCHAR(190) NOT NULL,
  phone           VARCHAR(40)  NULL,
  interests       JSON         NULL,
  notes           TEXT         NULL,
  source          VARCHAR(40)  NOT NULL DEFAULT 'volunteer_form',
  member_id       INT          NULL,
  unsubscribed_at DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mls_email (email),
  INDEX idx_mls_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Interest areas offered on the form. Admin-editable in Admin -> Configurable Options.
INSERT INTO system_config (category, label, `values`)
SELECT 'volunteer_interests', 'Volunteer — Areas of Interest', JSON_ARRAY(
  'Event support (setup, check-in, concessions)',
  'Mentoring / coaching a team',
  'Judging & competition volunteering',
  'Fundraising & grant writing',
  'Marketing, social media & photography',
  'Administrative & office help',
  'Build / technical / shop help',
  'Transportation & logistics',
  'Food & hospitality',
  'Skilled trades or professional expertise'
)
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'volunteer_interests');

-- Form settings: a master on/off toggle and the intro paragraph shown at the top.
-- Stored as a JSON object (read directly, not via the array config helper).
INSERT INTO system_config (category, label, `values`)
SELECT 'volunteer_signup', 'Volunteer Sign-up Form', JSON_OBJECT(
  'open', TRUE,
  'intro', 'Thanks for your interest in volunteering with Tulsa Robotics Center! Tell us a little about yourself and how you would like to help. We will create your account, add you to our volunteer mailing list, and be in touch about opportunities.'
)
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'volunteer_signup');
