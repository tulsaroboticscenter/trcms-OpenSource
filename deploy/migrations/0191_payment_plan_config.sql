-- 0191 — Configurable payment plans.
--
-- Adds plan-level meta (kept out of the enrollments row) so an admin-built plan can carry a note,
-- a "suppress automatic reminders" switch, and a record of when the family was last emailed the
-- schedule. Per-installment reminder suppression lives on the installment itself, so a single due
-- date can be silenced without silencing the whole plan.

CREATE TABLE IF NOT EXISTS enrollment_payment_plans (
  enrollment_id        INT NOT NULL PRIMARY KEY,
  reminders_suppressed TINYINT(1) NOT NULL DEFAULT 0,   -- plan-level: skip all auto reminders
  note                 VARCHAR(500) NULL,               -- internal note / terms shown to the family
  confirmation_sent_at DATETIME NULL,                   -- last time the schedule email was sent
  created_by_id        INT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE enrollment_installments
  ADD COLUMN reminders_suppressed TINYINT(1) NOT NULL DEFAULT 0 AFTER reminded_at;
