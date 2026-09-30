-- FLL Season Planning — Phase 1 data model.
--
-- Availability collection (tokenized family form + in-app) and per-program,
-- per-night team/youth capacity. The drag-drop planning board (plan_night_teams
-- / plan_placements) is seeded here too so Phase 2 can build on it.

-- Per-night max number of (lead-able) teams, alongside the existing `capacity`
-- (which we treat as max youth per night for that program).
ALTER TABLE program_nights ADD COLUMN max_teams INT NULL AFTER capacity;

-- One row per member per season (per program), capturing what nights they're
-- available and — for parents — whether they'll mentor. night_prefs is a JSON
-- map { "<night_id>": "preferred" | "ok" | "no" }.
CREATE TABLE IF NOT EXISTS season_availability (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    member_id      INT NOT NULL,
    season         VARCHAR(9) NOT NULL,              -- "YYYY-YYYY"
    program_id     INT NULL,                          -- FLLc / FLLe (null = general)
    mentor_willing VARCHAR(10) NULL,                  -- 'lead' | 'assist' | 'admin' | 'no' (parents)
    flexible       TINYINT(1) NOT NULL DEFAULT 0,     -- available any night
    night_prefs    JSON NULL,
    siblings_together TINYINT(1) NULL,                -- keep this family's youth on the same night
    notes          TEXT NULL,
    submitted_by_id INT NULL,                         -- who entered it (self, other guardian, or admin)
    submitted_at   DATETIME NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_avail (member_id, season, program_id),
    KEY idx_avail_season (season, program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Emailed no-login form tokens. Resolve to a FAMILY so the form shows every
-- guardian + youth (Dad sees Mom's answers). Expiring + revocable.
CREATE TABLE IF NOT EXISTS availability_invites (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    token         CHAR(40) NOT NULL,
    family_id     INT NOT NULL,
    season        VARCHAR(9) NOT NULL,
    program_id    INT NULL,
    sent_to       VARCHAR(255) NULL,                  -- email address it was sent to
    expires_at    DATETIME NULL,
    created_by_id INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at       DATETIME NULL,
    revoked_at    DATETIME NULL,
    UNIQUE KEY uq_invite_token (token),
    KEY idx_invite_family (family_id, season)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Draft team buckets on the planning board (Phase 2). based_on_team_id lets a
-- bucket carry forward a prior-season team as its starting point.
CREATE TABLE IF NOT EXISTS plan_night_teams (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    season         VARCHAR(9) NOT NULL,
    program_id     INT NOT NULL,
    night_id       INT NOT NULL,
    label          VARCHAR(120) NULL,
    based_on_team_id INT NULL,
    display_order  INT NOT NULL DEFAULT 0,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_plan_team (season, program_id, night_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who is placed in each draft bucket (until the plan is published to real teams).
CREATE TABLE IF NOT EXISTS plan_placements (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    plan_night_team_id INT NOT NULL,
    member_id          INT NOT NULL,
    role               VARCHAR(10) NOT NULL DEFAULT 'youth',  -- 'lead' | 'assist' | 'youth'
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_placement (plan_night_team_id, member_id),
    KEY idx_placement_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
