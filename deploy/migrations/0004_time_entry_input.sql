-- Time tracking: support entering duration as decimal hours OR a start/stop
-- time range. `minutes` remains the canonical stored duration; these columns
-- record HOW it was entered so the UI can show "2.5 hrs" or "1:00–3:30 PM".
ALTER TABLE time_entries
  ADD COLUMN entry_method VARCHAR(10) NULL,
  ADD COLUMN start_time TIME NULL,
  ADD COLUMN end_time TIME NULL;
