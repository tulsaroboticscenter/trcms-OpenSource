-- 0057_visitor_parent_mentor.sql — capture at intake whether a prospect's parent
-- is interested in mentoring / helping lead a team. Feeds the FLL waitlist weight
-- (a decided priority factor) and the future mentor-prospect pipeline.

ALTER TABLE visitors ADD COLUMN parent_mentor_interest TINYINT(1) NOT NULL DEFAULT 0 AFTER school_id;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0057_visitor_parent_mentor', NOW());
