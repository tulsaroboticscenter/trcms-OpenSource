-- Scholarship Fund Management — Phase 3: the fund ledger.
-- The fund is now a PER-SEASON allocation from the General Fund (set by the Program
-- Committee, renewable, augmentable mid-year, NO carryover), DECOUPLED from sponsor
-- money. Balance = allocations - applied awards (not sponsor_contributions).

-- 1) Deposits into a fund for a season: who / when / how much. Multiple rows per
--    (fund, year) = the initial allocation plus any mid-year augmentations; their sum
--    is that season's allocation.
CREATE TABLE IF NOT EXISTS scholarship_fund_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fund_id INT NOT NULL,
  enrollment_year INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  source VARCHAR(40) NOT NULL DEFAULT 'general_fund',
  note VARCHAR(300) NULL,
  allocated_by_id INT NULL,
  allocated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_fund_year (fund_id, enrollment_year)
);

-- 2) Attribute each award to a season, so balance and annual paid-out totals key by
--    year. Backfill from the award's application year, else its enrollment's year.
ALTER TABLE scholarship_awards ADD COLUMN enrollment_year INT NULL AFTER enrollment_id;

UPDATE scholarship_awards aw
  JOIN scholarship_applications a ON a.id = aw.application_id
   SET aw.enrollment_year = a.enrollment_year
 WHERE aw.enrollment_year IS NULL AND a.enrollment_year IS NOT NULL;

UPDATE scholarship_awards aw
  JOIN enrollments e ON e.id = aw.enrollment_id
   SET aw.enrollment_year = e.enrollment_year
 WHERE aw.enrollment_year IS NULL AND e.enrollment_year IS NOT NULL;

ALTER TABLE scholarship_awards ADD KEY idx_awards_fund_year (fund_id, enrollment_year);

-- 3) Opening balance so nothing breaks when the balance source flips from sponsor money
--    to allocations: for each active fund with no allocation yet, seed the CURRENT season
--    (enrollment year 2026) with its current available balance (received sponsor money -
--    applied awards). From here the Program Committee adds General-Fund allocations and
--    sponsor dollars are tracked separately (informational only).
INSERT INTO scholarship_fund_allocations
       (fund_id, enrollment_year, amount, source, note, allocated_at, created_at, updated_at)
SELECT f.id, 2026,
       GREATEST(0, ROUND(
         COALESCE((SELECT SUM(CASE WHEN sc.contribution_type='monetary' THEN sc.amount
                                   ELSE COALESCE(sc.in_kind_value,0) END)
                   FROM sponsor_contributions sc
                   WHERE sc.scholarship_fund_id = f.id AND sc.status = 'received'), 0)
       - COALESCE((SELECT SUM(aw.amount) FROM scholarship_awards aw
                   WHERE aw.fund_id = f.id AND aw.status = 'applied'), 0), 2)),
       'opening',
       'Opening balance at migration (carried from prior sponsor-funded balance)',
       NOW(), NOW(), NOW()
  FROM scholarship_funds f
 WHERE f.is_active = 1
   AND NOT EXISTS (SELECT 1 FROM scholarship_fund_allocations a WHERE a.fund_id = f.id);
