-- Summer Camp module: tracks camps, campers, and registrations entirely SEPARATE
-- from members (transient attendees never clutter the member roster). A "season"
-- is one summer's program holding the on/off registration toggle + editable waiver
-- text; sessions are the per-year camp offerings (program × week) shown on the
-- public form; contacts are the durable, promotable parents/guardians; campers are
-- the kids (convertible to members later); registrations tie a camper to a session.

-- One summer's camp program: the master registration toggle + editable legal text.
CREATE TABLE IF NOT EXISTS camp_seasons (
  id INT NOT NULL AUTO_INCREMENT,
  year INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  registration_open TINYINT(1) NOT NULL DEFAULT 0,
  intro_text TEXT DEFAULT NULL,
  waiver_liability TEXT DEFAULT NULL,
  waiver_media TEXT DEFAULT NULL,
  waiver_firstaid TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY camp_seasons_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Reusable camp types (FLL, FTC, 3D Printing, Battle Bots, Drone, …).
CREATE TABLE IF NOT EXISTS camp_programs (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  description TEXT DEFAULT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- A specific offering: program × week, with public-facing info + open/close toggle.
CREATE TABLE IF NOT EXISTS camp_sessions (
  id INT NOT NULL AUTO_INCREMENT,
  season_id INT NOT NULL,
  program_id INT DEFAULT NULL,
  title VARCHAR(160) NOT NULL,
  week_label VARCHAR(60) DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  start_time VARCHAR(20) DEFAULT NULL,
  end_time VARCHAR(20) DEFAULT NULL,
  age_band VARCHAR(60) DEFAULT NULL,
  price DECIMAL(10,2) DEFAULT NULL,
  capacity INT DEFAULT NULL,
  public_blurb TEXT DEFAULT NULL,
  event_id INT DEFAULT NULL,
  is_open TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY camp_sessions_season (season_id),
  KEY camp_sessions_program (program_id),
  KEY camp_sessions_event (event_id),
  CONSTRAINT camp_sessions_season_fk FOREIGN KEY (season_id) REFERENCES camp_seasons (id) ON DELETE CASCADE,
  CONSTRAINT camp_sessions_program_fk FOREIGN KEY (program_id) REFERENCES camp_programs (id) ON DELETE SET NULL,
  CONSTRAINT camp_sessions_event_fk FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Durable, promotable people (the registering parent/guardian or interested party).
CREATE TABLE IF NOT EXISTS camp_contacts (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) DEFAULT NULL,
  phone VARCHAR(40) DEFAULT NULL,
  marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
  opt_out TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(60) DEFAULT NULL,
  member_id INT DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY camp_contacts_email (email),
  KEY camp_contacts_member (member_id),
  CONSTRAINT camp_contacts_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- The kids (transient). Convertible to a member via member_id once they join.
CREATE TABLE IF NOT EXISTS campers (
  id INT NOT NULL AUTO_INCREMENT,
  contact_id INT DEFAULT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) DEFAULT NULL,
  grade VARCHAR(20) DEFAULT NULL,
  school VARCHAR(160) DEFAULT NULL,
  age_band VARCHAR(60) DEFAULT NULL,
  shirt_size VARCHAR(20) DEFAULT NULL,
  accommodations TEXT DEFAULT NULL,
  medical_notes TEXT DEFAULT NULL,
  food_allergies TEXT DEFAULT NULL,
  prior_experience TEXT DEFAULT NULL,
  member_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY campers_contact (contact_id),
  KEY campers_member (member_id),
  CONSTRAINT campers_contact_fk FOREIGN KEY (contact_id) REFERENCES camp_contacts (id) ON DELETE SET NULL,
  CONSTRAINT campers_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- A camper registered into a specific session (per program).
CREATE TABLE IF NOT EXISTS camp_registrations (
  id INT NOT NULL AUTO_INCREMENT,
  camper_id INT NOT NULL,
  session_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(40) DEFAULT NULL,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  confirmation_sent TINYINT(1) NOT NULL DEFAULT 0,
  shirt_size VARCHAR(20) DEFAULT NULL,
  shirt_received TINYINT(1) NOT NULL DEFAULT 0,
  emergency1_name VARCHAR(160) DEFAULT NULL,
  emergency1_relation VARCHAR(80) DEFAULT NULL,
  emergency1_phone VARCHAR(40) DEFAULT NULL,
  emergency2_name VARCHAR(160) DEFAULT NULL,
  emergency2_relation VARCHAR(80) DEFAULT NULL,
  emergency2_phone VARCHAR(40) DEFAULT NULL,
  waiver_liability_agreed TINYINT(1) NOT NULL DEFAULT 0,
  waiver_media_agreed TINYINT(1) NOT NULL DEFAULT 0,
  waiver_firstaid_agreed TINYINT(1) NOT NULL DEFAULT 0,
  waiver_agreed_by VARCHAR(160) DEFAULT NULL,
  waiver_agreed_at DATETIME DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY camp_reg_camper_session (camper_id, session_id),
  KEY camp_reg_session (session_id),
  CONSTRAINT camp_reg_camper_fk FOREIGN KEY (camper_id) REFERENCES campers (id) ON DELETE CASCADE,
  CONSTRAINT camp_reg_session_fk FOREIGN KEY (session_id) REFERENCES camp_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Per-day attendance for a registration (the camp runs a date range, usually Mon-Fri).
CREATE TABLE IF NOT EXISTS camp_attendance (
  id INT NOT NULL AUTO_INCREMENT,
  registration_id INT NOT NULL,
  day_date DATE NOT NULL,
  present TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY camp_att_reg_day (registration_id, day_date),
  CONSTRAINT camp_att_reg_fk FOREIGN KEY (registration_id) REFERENCES camp_registrations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Staff/volunteer applications; linked to a member when the applicant already is one.
CREATE TABLE IF NOT EXISTS camp_staff_apps (
  id INT NOT NULL AUTO_INCREMENT,
  season_id INT DEFAULT NULL,
  member_id INT DEFAULT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) DEFAULT NULL,
  phone VARCHAR(40) DEFAULT NULL,
  affiliation VARCHAR(120) DEFAULT NULL,
  sessions_applied TEXT DEFAULT NULL,
  roles_applied TEXT DEFAULT NULL,
  prior_summers VARCHAR(120) DEFAULT NULL,
  first_experience VARCHAR(60) DEFAULT NULL,
  shirt_size VARCHAR(20) DEFAULT NULL,
  why_interested TEXT DEFAULT NULL,
  qualifications TEXT DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY camp_staff_season (season_id),
  KEY camp_staff_member (member_id),
  CONSTRAINT camp_staff_season_fk FOREIGN KEY (season_id) REFERENCES camp_seasons (id) ON DELETE SET NULL,
  CONSTRAINT camp_staff_member_fk FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
