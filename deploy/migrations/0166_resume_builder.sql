-- Resume builder for youth (FDP and beyond).
--
-- A guided questionnaire whose answers, combined with facts the system already knows
-- (school, grade, TRC teams, FIRST seasons, certifications), render a one-page printable
-- resume. Available to every youth; assignable as a task by the Dev Program manager.
--
-- Answers are stored as JSON keyed by question so the question set can grow without a
-- schema change. The skill list is config-driven (system_config 'resume_skills') for the
-- same reason.
CREATE TABLE IF NOT EXISTS resume_answers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  member_id    INT NOT NULL,
  answers      LONGTEXT NULL,          -- JSON: { question_key: value | [values] }
  -- Whether the youth wants email/phone on the printed resume (default off — minors).
  show_contact TINYINT(1) NOT NULL DEFAULT 0,
  -- Set when the youth marks the resume finished. Doubles as the "resume on file"
  -- signal for the FDP, alongside an uploaded fdp_progress.resume_url.
  completed_at DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NULL,
  UNIQUE KEY uq_resume_member (member_id),
  CONSTRAINT fk_resume_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
);

-- The configurable skill checklist. Admins can edit this list in system_config; these
-- are the starting values from the request.
INSERT INTO system_config (category, label, `values`)
SELECT 'resume_skills', 'Resume — Skills', JSON_ARRAY(
  'Java Programming', 'Kotlin Programming', 'Python Programming', 'C++ Programming',
  'Engineering Design Process', 'OnShape CAD', 'Fusion 360 CAD', 'SolidWorks CAD',
  '3D Printing', 'CNC Machining', 'Electronics & Wiring', 'FTC Build Skills',
  'FRC Build Skills', 'Robot Programming', 'Computer Vision', 'Control Systems',
  'Portfolio', 'Graphic Design', 'Written Communication', 'Oral Communication',
  'Project Management', 'Fundraising & Sponsorship', 'Social Media & Marketing',
  'Business & Finance', 'Outreach & Community'
)
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'resume_skills');

-- Positions a youth can say they're seeking on a team (also configurable).
INSERT INTO system_config (category, label, `values`)
SELECT 'resume_positions', 'Resume — Positions Sought', JSON_ARRAY(
  'Programmer', 'CAD / Design', 'Mechanical / Build', 'Electrical', 'Drive Team',
  'Portfolio / Award Submissions', 'Business / Fundraising', 'Outreach / Community',
  'Media / Marketing', 'Team Leadership'
)
WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'resume_positions');
