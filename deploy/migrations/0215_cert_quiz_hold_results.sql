-- 0215 — Per-quiz "hold results" flag. When set, a submitted attempt is graded but its score and
-- pass/fail stay hidden from the learner until a manager reviews it in the gradebook and releases
-- the results (which then awards the certification if passed). Default 0 = release immediately.
ALTER TABLE cert_quizzes ADD COLUMN hold_results TINYINT(1) NOT NULL DEFAULT 0 AFTER shuffle_questions;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0215_cert_quiz_hold_results', NOW());
