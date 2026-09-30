-- 0127_payment_donation_amount.sql
-- Parent family combined checkout (Release 3.12): a parent can pay several youth's
-- enrollments in one invoice and optionally add a donation. The donation portion of
-- a combined ('family_group') payment is recorded here so reporting can separate
-- enrollment revenue from donations on a single charge.

ALTER TABLE payments
  ADD COLUMN donation_amount DECIMAL(10,2) NULL AFTER base_amount;
