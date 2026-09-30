-- Hall of Fame: free-text reflections from the member (prompt + response pairs),
-- e.g. "My favorite experience at the TRC...", "How the TRC has impacted me...".
ALTER TABLE hof_members
  ADD COLUMN reflections JSON NULL;
