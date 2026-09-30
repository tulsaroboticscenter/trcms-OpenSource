-- 0225 — Record PO shipping/tax as itemized ad-hoc expenses under the team's budget item, instead
-- of silently bumping the budget category's actual_amount total. This makes each fee show as its own
-- line ("Shipping — PO …" / "Tax — PO …") assigned to a budget category, like any other expense.
ALTER TABLE team_adhoc_expenses
  ADD COLUMN source_po_id INT NULL AFTER team_season_id,
  ADD COLUMN fee_kind     VARCHAR(20) NULL AFTER description,
  ADD KEY idx_adhoc_source_po (source_po_id);

-- Migrate anything already charged by 0224: undo the direct actual_amount bump...
UPDATE inv_budget_categories bc
  JOIN (SELECT budget_category_id, SUM(shipping_amount + tax_amount) AS amt
          FROM inv_po_fee_charges GROUP BY budget_category_id) x ON x.budget_category_id = bc.id
  SET bc.actual_amount = COALESCE(bc.actual_amount, 0) - x.amt;

-- ...and re-create the fees as itemized ad-hoc expenses on the same budget category.
INSERT INTO team_adhoc_expenses (team_season_id, source_po_id, budget_category_id, vendor, description, fee_kind, amount, expense_date, created_at)
SELECT bc.team_season_id, f.po_id, f.budget_category_id, v.name,
       CONCAT('Shipping — PO ', COALESCE(NULLIF(po.po_number, ''), po.id)), 'shipping', f.shipping_amount, po.order_date, NOW()
FROM inv_po_fee_charges f
JOIN inv_budget_categories bc ON bc.id = f.budget_category_id
JOIN inv_purchase_orders po ON po.id = f.po_id
LEFT JOIN inv_vendors v ON v.id = po.vendor_id
WHERE f.shipping_amount > 0;

INSERT INTO team_adhoc_expenses (team_season_id, source_po_id, budget_category_id, vendor, description, fee_kind, amount, expense_date, created_at)
SELECT bc.team_season_id, f.po_id, f.budget_category_id, v.name,
       CONCAT('Tax — PO ', COALESCE(NULLIF(po.po_number, ''), po.id)), 'tax', f.tax_amount, po.order_date, NOW()
FROM inv_po_fee_charges f
JOIN inv_budget_categories bc ON bc.id = f.budget_category_id
JOIN inv_purchase_orders po ON po.id = f.po_id
LEFT JOIN inv_vendors v ON v.id = po.vendor_id
WHERE f.tax_amount > 0;

-- The ledger table is replaced by the ad-hoc expense rows (fee_kind + source_po_id).
DROP TABLE inv_po_fee_charges;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0225_po_fees_as_adhoc', NOW());
