-- 0106 — Reports Engine. Declarative, permission-aware custom reporting.
-- Users compose reports as JSON definitions over curated datasets (never raw
-- SQL); the server compiles each definition to a safe parameterized query and
-- runs it as the viewer. This migration adds the persistence + access-control
-- tables. The dataset registry, definition validator, and query compiler live
-- in code (src/Reports/*).

-- Saved report definitions. `dataset` names a registered dataset (members,
-- events, ...). `definition` is the JSON document (fields, filters, params,
-- grouping, sort). `visibility`: private (owner only), roles (see
-- report_permissions), or org (any report user).
CREATE TABLE IF NOT EXISTS report_definitions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  description  VARCHAR(500) NULL,
  dataset      VARCHAR(60)  NOT NULL,
  definition   JSON         NOT NULL,
  folder_id    INT          NULL,
  owner_id     INT          NULL,
  visibility   ENUM('private','roles','org') NOT NULL DEFAULT 'private',
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NULL,
  KEY idx_rd_owner (owner_id),
  KEY idx_rd_folder (folder_id),
  KEY idx_rd_dataset (dataset)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional folders for organizing the report library.
CREATE TABLE IF NOT EXISTS report_folders (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(160) NOT NULL,
  parent_id   INT NULL,
  owner_id    INT NULL,
  created_at  DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Role x dataset access matrix. capability = what the role may do; row_scope =
-- which rows they may see (enforced in the compiler); max_field_tier = the most
-- sensitive field tier they may read (public < internal < pii < financial).
-- Absence of a row = no access to that dataset (deny by default).
CREATE TABLE IF NOT EXISTS report_permissions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  role_name      VARCHAR(100) NOT NULL,
  dataset        VARCHAR(60)  NOT NULL,
  capability     ENUM('run','build_scoped','build_full','publish','manage') NOT NULL DEFAULT 'run',
  row_scope      ENUM('all','own_teams','self','none') NOT NULL DEFAULT 'own_teams',
  max_field_tier ENUM('public','internal','pii','financial') NOT NULL DEFAULT 'internal',
  created_at     DATETIME NOT NULL,
  UNIQUE KEY uq_role_dataset (role_name, dataset)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lightweight run audit (who ran what, how many rows, what format).
CREATE TABLE IF NOT EXISTS report_runs (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  definition_id  INT NULL,
  member_id      INT NULL,
  dataset        VARCHAR(60) NULL,
  format         VARCHAR(10) NOT NULL DEFAULT 'screen',
  row_count      INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL,
  KEY idx_rr_def (definition_id),
  KEY idx_rr_member (member_id),
  KEY idx_rr_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0106', NOW());
