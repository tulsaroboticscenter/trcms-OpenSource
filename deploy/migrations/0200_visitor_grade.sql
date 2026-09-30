-- 0200 — Grade level on the visitor record (#176). Lets staff gauge the FLL level a
-- prospective youth fits (Explore vs Challenge) before sending an invite. Numeric grade
-- follows the app convention: -1 = Pre-K, 0 = Kindergarten, 1..12 = grades.
ALTER TABLE visitors ADD COLUMN grade INT NULL AFTER birthday;
