-- 0115 — College Scholarship: grade-level eligibility + richer per-youth tracking.
--
-- Eligibility: adds a durable grade band (elig_class_min/max, grades 9-12) that
-- is compared against each youth's CURRENT grade (derived from graduation_year),
-- so "seniors only" keeps meaning grade 12 every season instead of a stale
-- absolute graduation year. The controller also now gates on member_type=youth,
-- so mentors/parents/volunteers can browse the board but are never flagged
-- eligible and get no alerts.
--
-- Renewable detail: the scholarship can record how many years it renews and the
-- annual amount (we intentionally do NOT track year-by-year renewal upkeep).
--
-- Per-application tracking: youth award acceptance (accepted/declined), the
-- target college the award applies to, and a donor thank-you flag/date. Plus a
-- per-application requirements checklist (essay, recommendations, transcript...).

ALTER TABLE college_scholarships
  ADD COLUMN elig_class_min          TINYINT       NULL AFTER elig_grad_year_max,
  ADD COLUMN elig_class_max          TINYINT       NULL AFTER elig_class_min,
  ADD COLUMN renewable_years         TINYINT       NULL AFTER renewable,
  ADD COLUMN renewable_annual_amount DECIMAL(10,2) NULL AFTER renewable_years;

ALTER TABLE college_scholarship_applications
  ADD COLUMN youth_award_response ENUM('accepted','declined') NULL AFTER amount_awarded,
  ADD COLUMN target_college       VARCHAR(200)                NULL AFTER youth_award_response,
  ADD COLUMN thank_you_sent       TINYINT(1)         NOT NULL DEFAULT 0 AFTER target_college,
  ADD COLUMN thank_you_date       DATE                        NULL AFTER thank_you_sent;

CREATE TABLE IF NOT EXISTS college_scholarship_app_requirements (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  label          VARCHAR(200) NOT NULL,
  is_complete    TINYINT(1) NOT NULL DEFAULT 0,
  due_date       DATE NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     DATETIME NULL,
  updated_at     DATETIME NULL,
  KEY idx_csar_app (application_id),
  CONSTRAINT fk_csar_app FOREIGN KEY (application_id)
    REFERENCES college_scholarship_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0115', NOW());
