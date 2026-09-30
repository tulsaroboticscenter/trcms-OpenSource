-- 0134_enrollment_waivers.sql
-- Capture the four registration consents on the parent/guardian T&C signature,
-- stored per (member, season) in member_annual_tc:
--   - Liability Waiver, First Aid/Emergency Care, Privacy Policy: required acks.
--   - Media Release: per-youth OPT-IN/OPT-OUT (NULL = not yet answered, 1 = granted,
--     0 = declined). Declining does NOT block participation.
-- The waiver TEXT is admin-editable (system_config category 'enrollment_waivers');
-- defaults live in code so the real wording ships even before any edit.

ALTER TABLE member_annual_tc
  ADD COLUMN waiver_liability_agreed TINYINT(1) NOT NULL DEFAULT 0 AFTER parent_signed_by_id,
  ADD COLUMN waiver_firstaid_agreed  TINYINT(1) NOT NULL DEFAULT 0 AFTER waiver_liability_agreed,
  ADD COLUMN waiver_privacy_agreed   TINYINT(1) NOT NULL DEFAULT 0 AFTER waiver_firstaid_agreed,
  ADD COLUMN media_release_granted   TINYINT(1) DEFAULT NULL       AFTER waiver_privacy_agreed,
  ADD COLUMN waivers_agreed_at       DATETIME  DEFAULT NULL        AFTER media_release_granted,
  ADD COLUMN waivers_agreed_by_id    INT       DEFAULT NULL        AFTER waivers_agreed_at;
