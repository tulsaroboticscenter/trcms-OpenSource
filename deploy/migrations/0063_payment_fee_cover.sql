-- Optional "cover the processing fee" at checkout. `amount` stays the total we
-- charge the card; base_amount is the actual fee owed (what we stamp onto the
-- enrollment), fee_amount is the covered processing fee (0 when TRC absorbs it).
ALTER TABLE payments
  ADD COLUMN base_amount DECIMAL(10,2) NULL AFTER amount,
  ADD COLUMN fee_amount  DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER base_amount,
  ADD COLUMN fee_covered TINYINT(1)    NOT NULL DEFAULT 0 AFTER fee_amount;

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0063_payment_fee_cover', NOW());
