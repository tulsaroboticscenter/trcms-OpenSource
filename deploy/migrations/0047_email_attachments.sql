-- 0047 Email attachments + inline images (feedback #102)
-- Files uploaded for an email. Non-inline rows are sent as MIME attachments;
-- inline rows are images embedded in the body via their hosted URL. Files live
-- under public/uploads/email/<stored_name>.

CREATE TABLE IF NOT EXISTS email_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token          VARCHAR(40) NOT NULL,
  filename       VARCHAR(255) NOT NULL,
  stored_name    VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(150) NULL,
  size_bytes     INT NOT NULL DEFAULT 0,
  is_inline      TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by_id INT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_att_token (token),
  CONSTRAINT fk_email_att_uploader FOREIGN KEY (uploaded_by_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0047_email_attachments', NOW());
