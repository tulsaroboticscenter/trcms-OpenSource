-- Allow a youth to hold a YLC role on more than one team in the same term.
--
-- ylc_memberships had UNIQUE (member_id, term) — one YLC role per youth per term. That
-- blocks the whole point of 0169: a crossover youth being Team Leader on one team and
-- holding a role on another. Replace it with UNIQUE (member_id, term, team_id).
--
-- MySQL treats NULLs as distinct in a unique key, so this enforces one row per
-- (member, term, TEAM) for team-scoped roles while NOT constraining program-wide council
-- rows (team_id NULL) — those are kept to one-per-term in application code
-- (RolesController scopes its upsert to team_id IS NULL).
-- Add the replacement first: its leftmost column is member_id, so it keeps an index
-- available for the member_id foreign key, letting us drop the old unique afterwards.
ALTER TABLE ylc_memberships ADD UNIQUE KEY uq_ylc_member_term_team (member_id, term, team_id);
ALTER TABLE ylc_memberships DROP INDEX uq_ylc_member_term;
