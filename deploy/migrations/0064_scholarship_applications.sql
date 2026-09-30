-- Scholarships Phase B: confidential applications (from registration) + review +
-- awards that draw from a fund and reduce a youth's enrollment amount due.
-- Sensitive family/minor data — access-controlled + audit-logged in the app.

CREATE TABLE IF NOT EXISTS scholarship_applications (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_year   INT           NULL,          -- registration cycle
  status            VARCHAR(20)   NOT NULL DEFAULT 'submitted', -- submitted|under_review|approved|declined|withdrawn
  submitted_by_id   INT           NULL,          -- the account that submitted (parent/guardian)
  member_id         INT           NULL,          -- the youth, once matched to a member record

  -- Person completing the form
  contact_email     VARCHAR(200)  NULL,
  contact_name      VARCHAR(200)  NULL,
  contact_phone     VARCHAR(50)   NULL,

  -- Program + youth (from the form)
  program           VARCHAR(20)   NULL,          -- FLL|FTC|FRC|Other
  program_other     VARCHAR(120)  NULL,
  youth_name        VARCHAR(200)  NULL,
  youth_grade_school VARCHAR(300) NULL,
  choose_one        VARCHAR(300)  NULL,          -- the "Choose one of the below" question

  -- Need / assessment fields
  registration_cost   DECIMAL(10,2) NULL,        -- e.g. 240.00
  contribution_amount DECIMAL(10,2) NULL,        -- what the family can pay
  amount_requested    DECIMAL(10,2) NULL,        -- cost - contribution (convenience)
  received_before     TINYINT(1)    NULL,        -- prior TRC scholarship?
  narrative           TEXT          NULL,        -- FTC/FRC: what the program means, service, goals
  referral            TEXT          NULL,        -- known current/former members
  optional_info       TEXT          NULL,
  answers             JSON          NULL,         -- flexible catch-all for extra questions

  -- Review
  reviewer_id       INT           NULL,
  review_notes      TEXT          NULL,
  decision_amount   DECIMAL(10,2) NULL,          -- approved award total
  reviewed_at       DATETIME      NULL,

  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NULL,
  INDEX idx_sch_app_status (status),
  INDEX idx_sch_app_member (member_id),
  INDEX idx_sch_app_year (enrollment_year)
);

-- Awards actually applied: draw from a fund, credit a youth's enrollment.
CREATE TABLE IF NOT EXISTS scholarship_awards (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT           NULL,
  fund_id        INT           NULL,             -- scholarship_funds.id it draws from
  member_id      INT           NULL,             -- the youth
  enrollment_id  INT           NULL,             -- the enrollment it reduced
  amount         DECIMAL(10,2) NOT NULL,
  note           VARCHAR(300)  NULL,
  status         VARCHAR(20)   NOT NULL DEFAULT 'applied', -- applied|reversed
  awarded_by_id  INT           NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at    DATETIME      NULL,
  INDEX idx_sch_award_fund (fund_id, status),
  INDEX idx_sch_award_app (application_id),
  INDEX idx_sch_award_member (member_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0064_scholarship_applications', NOW());
