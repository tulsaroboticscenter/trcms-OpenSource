-- Provider-agnostic online-payment ledger. One row per attempted payment; the
-- webhook flips it to 'paid' and stamps the source record (e.g. enrollments).
-- Card data NEVER touches this system — providers host the checkout (PCI SAQ A).
CREATE TABLE IF NOT EXISTS payments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  provider         VARCHAR(20)  NOT NULL,            -- 'square' | 'paypal'
  source_type      VARCHAR(40)  NOT NULL,            -- 'enrollment' (camp/sponsor later)
  source_id        INT          NOT NULL,            -- e.g. enrollments.id
  member_id        INT          NULL,                -- who it's for (convenience)
  amount           DECIMAL(10,2) NOT NULL,
  currency         VARCHAR(3)   NOT NULL DEFAULT 'USD',
  status           VARCHAR(20)  NOT NULL DEFAULT 'created', -- created|paid|failed|canceled|refunded
  provider_ref     VARCHAR(120) NULL,                -- checkout/order id we created
  provider_txn_id  VARCHAR(120) NULL,                -- settled payment id (from webhook)
  payer_email      VARCHAR(200) NULL,
  error_detail     VARCHAR(400) NULL,
  created_by_id    INT          NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at          DATETIME     NULL,
  updated_at       DATETIME     NULL,
  INDEX idx_payments_source (source_type, source_id),
  INDEX idx_payments_provider_ref (provider, provider_ref),
  INDEX idx_payments_txn (provider, provider_txn_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0062_payments', NOW());
