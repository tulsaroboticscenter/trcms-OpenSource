-- 0214 — Optional image on a certification quiz question, so a question can ask about a
-- picture. Stored as a URL (paste a link to a hosted image) because the production host
-- doesn't serve uploaded files — see the /uploads/ limitation.
ALTER TABLE cert_quiz_questions ADD COLUMN image_url VARCHAR(1000) NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0214_cert_quiz_question_image', NOW());
