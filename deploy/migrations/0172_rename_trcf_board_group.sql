-- Rename the foundation board group "TRCFB" -> "TRCF Board" so its meeting manager reads
-- "TRCF Board Meeting Minutes". The meetings bucket is keyed by the group name (a string),
-- so move any existing rows to match. Idempotent — a no-op once the name is already set.
UPDATE member_groups SET name = 'TRCF Board' WHERE name = 'TRCFB';
UPDATE meetings SET group_label = 'TRCF Board' WHERE group_label = 'TRCFB';
