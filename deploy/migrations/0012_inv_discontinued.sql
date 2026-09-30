-- "Discontinued" inventory flag: the vendor no longer sells this part, so we
-- can't order more — but we can still hold, adjust, and transfer existing stock,
-- and it stays visible/usable until it's fully retired. (Retired, separately,
-- zeroes stock and hides the item.) Discontinued items are excluded from
-- low-stock / reorder suggestions.
ALTER TABLE inv_items
  ADD COLUMN is_discontinued TINYINT(1) NOT NULL DEFAULT 0;
