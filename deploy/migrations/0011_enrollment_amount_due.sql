-- Enrollment fee tracking: the amount owed for an enrollment, and a flag for when
-- an admin overrides the auto-calculated amount. The controller already reads and
-- writes these (serialize, create, update), but the columns were added ad-hoc in
-- development and never captured as a migration — so production was missing them,
-- causing "Unknown column 'amount_due'" when adding an enrollment.
ALTER TABLE enrollments
  ADD COLUMN amount_due DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN amount_due_overridden TINYINT(1) NOT NULL DEFAULT 0;
