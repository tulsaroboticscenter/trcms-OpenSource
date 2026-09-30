-- Medical Consent & Emergency Information form, collected per member per season as
-- part of registration (youth: parent-signed; adult volunteers: self-signed).
-- Tracked but NOT gating check-in. Fields kept flat so allergy/med reports are easy.
CREATE TABLE IF NOT EXISTS member_medical (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  member_id                INT NOT NULL,
  enrollment_year          INT NOT NULL,

  -- Contact snapshot (prefilled from the member record, editable at sign time)
  contact_address          VARCHAR(200) NULL,
  contact_city_state       VARCHAR(200) NULL,
  contact_zip              VARCHAR(10)  NULL,
  guardian1_name           VARCHAR(200) NULL,
  guardian1_phone          VARCHAR(30)  NULL,
  guardian2_name           VARCHAR(200) NULL,
  guardian2_phone          VARCHAR(30)  NULL,
  alt_contact_name         VARCHAR(200) NULL,
  alt_contact_relationship VARCHAR(120) NULL,
  alt_contact_phone        VARCHAR(30)  NULL,

  -- Insurance
  ins_company              VARCHAR(200) NULL,
  ins_member_phone         VARCHAR(30)  NULL,
  ins_policy               VARCHAR(100) NULL,
  ins_group                VARCHAR(100) NULL,

  -- Over-the-counter meds permission
  otc_permission           ENUM('give','decline') NULL,

  -- Health details (free text blocks)
  health_problems          TEXT NULL,
  food_allergies           TEXT NULL,
  environmental_allergies  TEXT NULL,
  medication_allergies     TEXT NULL,
  medications_current      TEXT NULL,
  notes                    TEXT NULL,
  self_administer          TINYINT(1) NULL,   -- may the youth self-administer meds

  -- Treatment authorization (date-bound to the season)
  treatment_authorized     TINYINT(1) NOT NULL DEFAULT 0,
  coverage_start           DATE NULL,
  coverage_end             DATE NULL,
  signed_name              VARCHAR(200) NULL,
  signed_at                DATETIME NULL,
  signed_by_id             INT NULL,

  updated_by_id            INT NULL,
  created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_member_year (member_id, enrollment_year),
  KEY idx_member (member_id)
);

-- Viewing medical info is gated by members.view_medical (Admin -> Role Management);
-- defaults to 'none'. Seed the staff roles that already see sensitive info.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'members.view_medical', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('Admin', 'System Administrator', 'Mentor')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'members.view_medical');
