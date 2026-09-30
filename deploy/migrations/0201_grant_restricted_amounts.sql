-- 0201 — Restricted vs unrestricted funds on grant awards and team budget income.
-- A grant award can be partly restricted (e.g. $3,000 of a $5,000 award earmarked for a
-- specific purpose). restricted_amount is that earmarked portion; unrestricted is the rest.
-- The amount flows from the grant award into the team's budget income line so the Team
-- Budget can split Expected and Net Available into restricted vs unrestricted.
ALTER TABLE grant_teams
  ADD COLUMN restricted_amount DECIMAL(12,2) NULL AFTER amount_received;

ALTER TABLE inv_fundraising_donations
  ADD COLUMN restricted_amount DECIMAL(12,2) NULL;
