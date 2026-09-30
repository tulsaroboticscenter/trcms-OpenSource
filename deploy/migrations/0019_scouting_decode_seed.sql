-- Seed the FTC DECODE (2025-26) season config — the JSON that drives the pit and
-- match scouting forms and ties generic analytics metrics to ftcscout's DECODE fields.
-- This is the "config-driven form engine" payload: a new game next year is a new row
-- like this one, not a code change. Idempotent: re-running updates the same season.
--
-- config sections:
--   fieldZones          launch zones used by the tap counters and shoot-position pickers
--   pitForm             capability questions (grouped) collected at the pit
--   matchForm           per-phase scoring/counters/flags + confidence scale
--   tagVocabulary       structured tags for free-text observations
--   reconciliationRules over/under-performer + pit-claim-vs-reality rules (tunable)
--   metricMap           generic metric -> ftcscout TeamEventStats2025 opr field

INSERT INTO scout_seasons (program, season_year, code, name, api_stats_type, config, is_active)
VALUES ('FTC', 2025, 'DECODE', 'FTC DECODE (2025-26)', 'TeamEventStats2025',
'{
  "fieldZones": ["close", "far", "gate"],
  "pitForm": [
    { "group": "Robot Capabilities", "fields": [
      { "key": "groundIntake", "label": "Can intake from the ground (vs. human-fed only)?", "type": "bool" },
      { "key": "shooterType", "label": "Turret or fixed shooter?", "type": "enum", "options": ["fixed", "turret", "turret_and_fixed"] },
      { "key": "artifactCapacity", "label": "How many artifacts can it hold at once?", "type": "int" },
      { "key": "sortsArtifacts", "label": "Does it sort artifacts?", "type": "bool" },
      { "key": "shootPositions", "label": "Field shooting positions", "type": "multiselect", "options": ["close_to_goal", "fixed_in_large_launch", "anywhere_in_large_launch", "far_launch"] },
      { "key": "doublePark", "label": "Double park capability?", "type": "bool" },
      { "key": "doubleParkHow", "label": "How does double park work?", "type": "enum", "options": ["elevator", "lifts_off_ground", "other"], "showIf": "doublePark" },
      { "key": "doubleParkNotes", "label": "Double park notes", "type": "text", "showIf": "doublePark" },
      { "key": "drivetrain", "label": "Drivetrain", "type": "enum", "options": ["mecanum_4in", "mecanum_6in", "omni", "stealth", "hybrid"] },
      { "key": "drivetrainNotes", "label": "Drivetrain notes", "type": "text" },
      { "key": "launchMechanism", "label": "How does it launch artifacts?", "type": "enum", "options": ["two_wheel", "single_wheel", "multi_single_wheel", "launch_arm", "multi_launch_arm", "other"] },
      { "key": "launchCount", "label": "Artifacts launched at once", "type": "enum", "options": ["1", "2", "3"] },
      { "key": "dimL", "label": "Length", "type": "decimal" },
      { "key": "dimW", "label": "Width", "type": "decimal" },
      { "key": "dimH", "label": "Height", "type": "decimal" }
    ]},
    { "group": "Autonomous", "fields": [
      { "key": "autos", "label": "What autos do you have?", "type": "multiselect", "options": ["goal", "far", "park_only"] },
      { "key": "autoStartPreferred", "label": "Preferred starting position", "type": "enum", "options": ["goal", "far"] },
      { "key": "autoGoalScore", "label": "Artifacts scored — Goal auto", "type": "int" },
      { "key": "autoFarScore", "label": "Artifacts scored — Far auto", "type": "int" },
      { "key": "autoLeaves", "label": "Does the bot Leave during auto?", "type": "bool" },
      { "key": "autoSorts", "label": "Does auto sort artifacts?", "type": "bool" },
      { "key": "autoOpensGate", "label": "Can the bot open the gate during auto?", "type": "bool" }
    ]},
    { "group": "Teleop", "fields": [
      { "key": "teleopPosition", "label": "Preferred teleop position", "type": "enum", "options": ["gate_and_close", "far", "defense"] },
      { "key": "teleopAvgScore", "label": "Avg artifacts scored in teleop", "type": "int" },
      { "key": "parkTime", "label": "How long to park?", "type": "text" },
      { "key": "teleopDoublePark", "label": "Able to double park?", "type": "bool" },
      { "key": "teleopNotes", "label": "Other notes", "type": "text" }
    ]}
  ],
  "matchForm": {
    "scoringGrid": {
      "type": "tap4box", "decrementable": true,
      "buttons": [
        { "key": "closeMake", "label": "Close make", "corner": "top-right" },
        { "key": "farMake",   "label": "Far make",   "corner": "bottom-right" },
        { "key": "closeMiss", "label": "Close miss", "corner": "top-left" },
        { "key": "farMiss",   "label": "Far miss",   "corner": "bottom-left" }
      ],
      "center": { "key": "gateOpens", "label": "Gate opens" }
    },
    "setup": {
      "startingPosition": { "type": "enum", "options": ["gate", "far"] },
      "preloads": { "type": "enum", "options": ["0", "1", "2", "3"], "default": "3" }
    },
    "phases": {
      "auto": { "grid": true, "counters": ["gateOpens", "majorPenalties", "minorPenalties"], "flags": ["did_not_move"], "notes": true },
      "teleop": { "grid": true, "counters": ["gateOpens", "majorPenalties", "minorPenalties"],
        "majorFailure": { "type": "enum", "options": ["mechanical_unknown", "intake_failed", "shooter_failed", "drivetrain", "disconnected", "powered_off", "connection_issue"] },
        "failureResponse": { "type": "enum", "options": ["out_of_game", "recovered", "played_defense"] },
        "notes": true },
      "endgame": {
        "park": { "type": "enum", "options": ["no_park", "no_park_scoring", "no_park_scoring_fouled", "full_park", "partial_park"] },
        "penalty": { "type": "enum", "options": ["none", "major_one_base", "double_major_both_base"], "default": "none" }
      }
    },
    "confidence": [
      { "key": "low", "label": "Low (25%)", "weight": 0.25 },
      { "key": "medium", "label": "Medium (50%)", "weight": 0.50 },
      { "key": "high", "label": "High (75%)", "weight": 0.75 },
      { "key": "very_high", "label": "Very High (90%+)", "weight": 0.90 }
    ]
  },
  "tagVocabulary": [
    "plays_defense", "draws_tunnel_fouls", "cant_intake", "cant_shoot", "gate_only",
    "fast_cycler", "unreliable", "strong_auto", "good_endgame", "aggressive"
  ],
  "reconciliationRules": [
    { "id": "overperforming_total", "metric": "totalPointsNp", "compare": "liveOpr", "against": "preNpOpr", "operator": "gt", "threshold": "1.5*dev", "label": "Overperforming", "severity": "positive" },
    { "id": "underperforming_total", "metric": "totalPointsNp", "compare": "liveOpr", "against": "preNpOpr", "operator": "lt", "threshold": "-1.5*dev", "label": "Underperforming", "severity": "warn" },
    { "id": "pit_claim_teleop_high", "metric": "teleopArtifacts", "compare": "pitClaimed", "against": "liveOpr", "operator": "deltaGt", "threshold": 5, "label": "Pit claim exceeds observed", "severity": "warn" }
  ],
  "metricMap": {
    "autoArtifacts": "autoArtifactPoints",
    "teleopArtifacts": "dcArtifactPoints",
    "autoPoints": "autoPoints",
    "teleopPoints": "dcPoints",
    "penaltyFor": "penaltyPointsByOpp",
    "penaltyAgainst": "penaltyPointsCommitted",
    "totalPointsNp": "totalPointsNp"
  }
}', 1)
ON DUPLICATE KEY UPDATE name=VALUES(name), api_stats_type=VALUES(api_stats_type), config=VALUES(config), is_active=VALUES(is_active), updated_at=NOW();
