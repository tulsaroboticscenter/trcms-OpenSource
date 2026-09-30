-- 0236_compliance_reminder_log.sql
-- Dedupe log for the compliance-renewal reminder cron (YPT + background check). One row per
-- (member, item, expiry, milestone) that's been emailed, so each milestone (60/30/14/1-day, overdue)
-- fires exactly once per expiry cycle even though the cron runs daily. A renewal (new expiry date)
-- starts a fresh cycle. See bin/run_compliance_reminders.php.

CREATE TABLE IF NOT EXISTS compliance_reminder_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  member_id    INT NOT NULL,
  item         VARCHAR(32) NOT NULL,   -- 'ypt' | 'background_check'
  expires_date DATE NOT NULL,
  milestone    VARCHAR(16) NOT NULL,   -- '60d' | '30d' | '14d' | '1d' | 'overdue'
  sent_at      DATETIME NOT NULL,
  UNIQUE KEY uq_crl (member_id, item, expires_date, milestone),
  KEY idx_crl_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0236_compliance_reminder_log', NOW());
