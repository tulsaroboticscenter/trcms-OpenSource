-- 0230 — Incident Reports module (Phase 1). Report intake + triage-to-closure workflow, a
-- separate lightweight First Aid Log, anonymous reporting with a sealed identity vault, and
-- configurable email routing. See docs/INCIDENT_REPORTS_SPEC.md. Cross-type facts that get
-- reported on are flat columns; the long tail of type-specific answers lives in a `detail` JSON
-- column (deliberate split per §9). No FK constraints on any incident table — incident records
-- must outlive cascades (retention: never auto-purged), and the identity vault must never be
-- silently dropped.

CREATE TABLE IF NOT EXISTS incident_reports (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  ref_no                VARCHAR(20) NULL,                 -- INC-2026-0001, assigned post-insert
  type                  VARCHAR(40) NOT NULL,
  severity              ENUM('minor','moderate','serious','critical') NULL,   -- triage-confirmed
  reporter_severity     ENUM('minor','moderate','serious','critical') NULL,   -- what the reporter chose
  status                ENUM('submitted','triaged','in_review','awaiting_action','closed') NOT NULL DEFAULT 'submitted',
  is_anonymous          TINYINT(1) NOT NULL DEFAULT 0,
  reporter_id           INT NULL,                         -- NULL when anonymous (§7)
  filed_for_member_id   INT NULL,
  filed_for_name        VARCHAR(120) NULL,
  filed_for_relationship VARCHAR(80) NULL,
  occurred_at           DATETIME NULL,
  occurred_approx       TINYINT(1) NOT NULL DEFAULT 0,
  location_kind         ENUM('trc','offsite','other') NULL,
  location_area         VARCHAR(60) NULL,
  location_other        VARCHAR(200) NULL,
  event_id              INT NULL,
  team_id               INT NULL,
  description           TEXT NULL,
  immediate_actions     TEXT NULL,
  notified_at_time      JSON NULL,
  ems_called            TINYINT(1) NOT NULL DEFAULT 0,
  police_called         TINYINT(1) NOT NULL DEFAULT 0,
  parent_notified       TINYINT(1) NOT NULL DEFAULT 0,
  parent_notified_at    DATETIME NULL,
  parent_notified_by_id INT NULL,
  parent_notify_method  VARCHAR(20) NULL,                 -- call | text | in_person
  parent_notify_result  VARCHAR(20) NULL,                 -- reached | left_message
  ongoing_risk          TINYINT(1) NOT NULL DEFAULT 0,
  is_sensitive          TINYINT(1) NOT NULL DEFAULT 0,
  is_restricted         TINYINT(1) NOT NULL DEFAULT 0,
  detail                JSON NULL,
  assigned_to_id        INT NULL,
  triaged_at            DATETIME NULL,
  triaged_by_id         INT NULL,
  closed_at             DATETIME NULL,
  closed_by_id          INT NULL,
  closure_summary       TEXT NULL,
  board_reportable      TINYINT(1) NOT NULL DEFAULT 0,
  external_notified     JSON NULL,
  retention_hold        TINYINT(1) NOT NULL DEFAULT 1,
  retention_review_on   DATE NULL,
  follow_up_due         DATE NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_incident_ref (ref_no),
  KEY idx_incident_type (type),
  KEY idx_incident_status (status),
  KEY idx_incident_severity (severity),
  KEY idx_incident_occurred (occurred_at),
  KEY idx_incident_assigned (assigned_to_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_people (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  member_id     INT NULL,
  name          VARCHAR(120) NULL,
  person_role   ENUM('affected','witness','involved','responder') NOT NULL DEFAULT 'affected',
  is_youth      TINYINT(1) NULL,
  notes         VARCHAR(300) NULL,
  KEY idx_incpeople_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 1:1 optional flat medical/injury facts that reports slice on.
CREATE TABLE IF NOT EXISTS incident_injury (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  incident_id           INT NOT NULL,
  body_parts            JSON NULL,
  injury_nature         VARCHAR(60) NULL,
  mechanism             VARCHAR(60) NULL,
  inv_item_id           INT NULL,
  ppe_required          VARCHAR(120) NULL,
  ppe_worn              VARCHAR(120) NULL,
  trained_certified     TINYINT(1) NULL,
  certification_id      INT NULL,
  supervised_by_id      INT NULL,
  treatment_level       ENUM('none','first_aid','sent_to_parent_or_doctor','urgent_care','er','ems_transport','refused') NULL,
  loss_of_consciousness TINYINT(1) NULL,
  concussion_protocol   TINYINT(1) NULL,
  returned_to_activity  TINYINT(1) NULL,
  restriction           VARCHAR(200) NULL,
  medication_given      TINYINT(1) NULL,
  rescue_med            VARCHAR(40) NULL,                 -- epi_pen | inhaler | glucagon
  outcome               VARCHAR(60) NULL,
  claim_likely          TINYINT(1) NULL,
  UNIQUE KEY uq_incinjury_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only. No UPDATE/DELETE code path (§3.10).
CREATE TABLE IF NOT EXISTS incident_notes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  author_id     INT NULL,
  body          TEXT NOT NULL,
  note_kind     ENUM('addendum','witness_statement','triage','closure') NOT NULL DEFAULT 'addendum',
  visibility    ENUM('standard','restricted') NOT NULL DEFAULT 'standard',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_incnotes_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_attachments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  stored_name   VARCHAR(160) NOT NULL,
  original_name VARCHAR(255) NULL,
  mime          VARCHAR(120) NULL,
  size_bytes    INT NULL,
  uploaded_by_id INT NULL,
  is_restricted TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_incatt_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_notifications (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  channel       VARCHAR(20) NOT NULL DEFAULT 'email',
  recipient     VARCHAR(255) NULL,
  reason        VARCHAR(200) NULL,
  rule_id       INT NULL,
  sent_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ok            TINYINT(1) NOT NULL DEFAULT 1,
  error         VARCHAR(300) NULL,
  KEY idx_incnotif_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incident_tasks (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  task_id       INT NOT NULL,                             -- existing Planning task
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inctask (incident_id, task_id),
  KEY idx_inctask_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sealed submitter identity for anonymous reports. NO FK (must never cascade-drop).
CREATE TABLE IF NOT EXISTS incident_identity_vault (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  sealed        TEXT NOT NULL,                            -- base64(iv‖tag‖ciphertext), AES-256-GCM
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vault_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Back-door access audit, written by bin/unseal_incident.php only.
CREATE TABLE IF NOT EXISTS incident_vault_access_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  incident_id   INT NOT NULL,
  unsealed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  os_user       VARCHAR(120) NULL,
  reason        VARCHAR(500) NULL,
  host          VARCHAR(160) NULL,
  KEY idx_vaultlog_incident (incident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS first_aid_log (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  member_id            INT NULL,
  person_name          VARCHAR(120) NULL,
  occurred_at          DATETIME NULL,
  treatment            VARCHAR(300) NULL,
  provided_by_id       INT NULL,
  supplies_used        VARCHAR(300) NULL,
  notes                VARCHAR(500) NULL,
  promoted_incident_id INT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_firstaid_occurred (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0230_incident_reports', NOW());
