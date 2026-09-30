-- 0190 — Scholarship Fund Management P4: award expiration + staff-confirmed clawback
--
-- D4: a scholarship award expires 30 days after it is granted if the youth has not
--     enrolled. Expiration is DERIVED (created_at + 30 days) — no stored flag, no cron
--     needed to detect it (important on the shared Plesk host).
-- D5: clawback is staff-confirmed — an admin reclaims an expired award. That flips the
--     award to status='clawed_back', restores the enrollment's amount_due, and returns
--     the money to the fund's available balance (fundAvailable() only counts 'applied').
--
-- This migration only adds the clawback audit columns; the 'clawed_back' status value is
-- a convention on the existing varchar status column.

ALTER TABLE scholarship_awards
  ADD COLUMN clawed_back_at    DATETIME NULL AFTER reversed_at,
  ADD COLUMN clawed_back_by_id INT      NULL AFTER clawed_back_at,
  ADD COLUMN clawback_note     VARCHAR(300) NULL AFTER clawed_back_by_id;
