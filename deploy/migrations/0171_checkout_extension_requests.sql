-- Equipment checkout: let a holder request an extension on the due date.
--
-- Someone holding checked-out equipment can ask to keep it longer. The request goes to
-- the checkout request queue for an approver to process: approving moves the expected
-- return date to the requested one; denying leaves it. One pending request per checkout —
-- these fields are cleared once the request is decided (the decision is in the audit log).
ALTER TABLE inv_checkouts
  ADD COLUMN extension_requested_date  DATE     NULL AFTER expected_return_date,
  ADD COLUMN extension_requested_by_id INT      NULL AFTER extension_requested_date,
  ADD COLUMN extension_requested_at    DATETIME NULL AFTER extension_requested_by_id,
  ADD COLUMN extension_note            VARCHAR(500) NULL AFTER extension_requested_at;

CREATE INDEX idx_inv_checkout_ext_pending ON inv_checkouts (extension_requested_date);
