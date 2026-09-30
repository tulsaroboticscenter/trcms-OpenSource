-- Alliance selection roster per scouted event.
-- Populated by syncLive when playoff matches are scheduled on FTCScout
-- (allianceRole field on TeamMatchParticipation tells us Captain vs Pick).
CREATE TABLE IF NOT EXISTS scout_event_alliances (
    id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    scout_event_id    INT UNSIGNED NOT NULL,
    alliance_number   TINYINT UNSIGNED NOT NULL,   -- 1-8
    captain           INT UNSIGNED NOT NULL,
    pick1             INT UNSIGNED,
    pick2             INT UNSIGNED,
    fetched_at        DATETIME NOT NULL DEFAULT NOW(),
    UNIQUE KEY uq_event_alliance (scout_event_id, alliance_number),
    KEY idx_event (scout_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
