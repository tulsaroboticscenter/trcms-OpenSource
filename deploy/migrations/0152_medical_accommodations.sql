-- Medical Consent & Emergency Information gains an accommodations question:
-- "Please list any accommodations or supports that are provided in an educational
-- and/or group environment."
--
-- This captures things like an IEP/504 plan, sensory needs, or communication supports
-- that a mentor running a meeting would need to know about. It is free text and
-- optional, like the rest of the health details, and lives with the medical record so
-- it inherits the same narrow access rules (member, their guardian, Admin/SysAdmin).
ALTER TABLE member_medical
  ADD COLUMN accommodations TEXT NULL AFTER notes;
