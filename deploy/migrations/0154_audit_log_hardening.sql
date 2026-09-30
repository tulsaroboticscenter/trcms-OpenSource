-- Audit log hardening.
--
-- `audit_logs.action` was varchar(20). Real production data shows EIGHT distinct action
-- names sitting at exactly 20 characters — they were silently truncated:
--
--     password_reset_reque   (password_reset_requested, 46 rows)
--     enrollment.sign_ment   (enrollment.sign_mentor_tc)
--     enrollment.rollover_   enrollment.set_handb   enrollment.close_sea
--     resource_season_roll   first_reg_season_res   reset_station_passwo
--
-- Truncation alone makes the log ambiguous. Worse, under STRICT_TRANS_TABLES the
-- oversized INSERT throws instead of truncating, and Audit::write catches and discards
-- every exception ("auditing must never break a real operation") — so the audit row is
-- lost completely and nothing anywhere reports it. An action longer than 20 characters
-- has therefore never reliably been recorded.
--
-- 64 leaves room for the descriptive names already in use (the longest existing is 25)
-- without inviting essays into the column.
ALTER TABLE audit_logs
  MODIFY COLUMN action VARCHAR(64) NOT NULL;

-- Existing truncated values are left as they are: the original strings can't be
-- reconstructed with certainty, and rewriting history in an audit log is exactly the
-- thing an audit log exists to prevent. New rows will be complete.
