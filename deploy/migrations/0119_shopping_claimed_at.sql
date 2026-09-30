-- #142 (Anita): show when shopping-list items were added and claimed/purchased.
-- created_at (added) and purchased_at already exist; add claimed_at so the list
-- can show when someone picked up an item.
ALTER TABLE shopping_items
  ADD COLUMN claimed_at DATETIME NULL AFTER claimed_by_id;
