-- Scholarship Fund Management Phase 1 (D3): the application lifecycle now starts at
-- 'pending' instead of 'submitted' → pending → under_review → approved/declined/withdrawn.
-- Rename existing rows and change the column default. Idempotent.

UPDATE scholarship_applications SET status = 'pending' WHERE status = 'submitted';
ALTER TABLE scholarship_applications ALTER status SET DEFAULT 'pending';
