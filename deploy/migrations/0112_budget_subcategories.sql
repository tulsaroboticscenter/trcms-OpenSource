-- Sub-categories for team spending budgets. A top-level category (e.g. "Robot")
-- can have child sub-systems (Drive Train, Climber, Shooter, Intake, Bumpers),
-- each with its own budget. The parent's budget is the cap: the sum of child
-- budgets may not exceed it (enforced in PurchasingController). BOM lines,
-- ad-hoc expenses, and PO receipts already carry a per-line budget_category_id,
-- so an item can be charged to the parent or to any child with no further schema
-- change. Nesting is one level deep (a child cannot itself have children).
--
-- Fundraising categories stay flat (parent_id NULL); only spending categories nest.

ALTER TABLE inv_budget_categories
  ADD COLUMN parent_id INT NULL AFTER team_season_id,
  ADD KEY idx_budget_cat_parent (parent_id),
  ADD CONSTRAINT fk_budget_cat_parent
      FOREIGN KEY (parent_id) REFERENCES inv_budget_categories (id) ON DELETE CASCADE;
