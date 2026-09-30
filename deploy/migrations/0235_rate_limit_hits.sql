-- 0235_rate_limit_hits.sql
-- Security finding #8: a generic per-IP rate-limit log so unauthenticated endpoints that had no
-- brake (password-reset, and reusable for other public forms) can be throttled. Login itself is
-- throttled by reading login_attempts, so it needs no rows here. Rows are disposable telemetry;
-- prune with:  DELETE FROM rate_limit_hits WHERE created_at < NOW() - INTERVAL 1 DAY;

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  bucket     VARCHAR(40) NOT NULL,
  ip_hash    CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_rlh_lookup (bucket, ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0235_rate_limit_hits', NOW());
