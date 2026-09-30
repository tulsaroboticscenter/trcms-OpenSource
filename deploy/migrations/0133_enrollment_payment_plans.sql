-- 0133_enrollment_payment_plans.sql
-- Admin-set payment plans for enrollments (Release 3.13). An admin can split an
-- enrollment's amount due — minus any scholarship credit — into monthly
-- installments the family pays by CC, check, or cash, with monthly reminders.
--
-- scholarship_amount is a real dollar credit applied to the enrollment (distinct
-- from the free-text scholarship_fund label). The REMAINING balance (amount_due -
-- scholarship_amount) is what gets split into installments.

ALTER TABLE enrollments
  ADD COLUMN scholarship_amount DECIMAL(10,2) NULL AFTER scholarship_fund;

CREATE TABLE IF NOT EXISTS enrollment_installments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id  INT NOT NULL,
  seq            INT NOT NULL,                       -- 1..N
  due_date       DATE NOT NULL,
  amount         DECIMAL(10,2) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | paid | waived
  paid_date      DATE NULL,
  paid_amount    DECIMAL(10,2) NULL,
  method         VARCHAR(50) NULL,                   -- cc | check | cash | (manual method)
  reference      VARCHAR(100) NULL,
  recorded_by_id INT NULL,
  notes          VARCHAR(300) NULL,
  reminded_at    DATE NULL,                          -- last reminder email sent (dedup)
  created_at     DATETIME NOT NULL,
  updated_at     DATETIME NOT NULL,
  INDEX idx_ei_enrollment (enrollment_id),
  INDEX idx_ei_due (due_date, status),
  CONSTRAINT fk_ei_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE CASCADE
);
