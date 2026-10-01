-- TRCMS database schema (structure only — NO data, NO real member info).
-- Loaded by bin/install.php, then the migration baseline, then seed_base.sql.
-- Collations normalized for MariaDB / MySQL 5.7+. Regenerate: deploy/tools/gen_schema.sh
-- MySQL dump 10.13  Distrib 9.6.0, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: trcms
-- ------------------------------------------------------
-- Server version	9.6.0
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `adult_roles`
--

DROP TABLE IF EXISTS `adult_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `adult_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `ypt_complete` tinyint(1) DEFAULT NULL,
  `ypt_date` date DEFAULT NULL,
  `background_check_complete` tinyint(1) DEFAULT NULL,
  `background_check_date` date DEFAULT NULL,
  `first_complete` tinyint(1) DEFAULT NULL,
  `first_date` date DEFAULT NULL,
  `consent_release_complete` tinyint(1) DEFAULT NULL,
  `consent_release_date` date DEFAULT NULL,
  `role_specific_complete` tinyint(1) DEFAULT NULL,
  `role_specific_date` date DEFAULT NULL,
  `role` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `areas_of_expertise` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `service_years` int DEFAULT NULL,
  `on_hold` tinyint(1) DEFAULT NULL,
  `on_hold_note` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_id` (`member_id`),
  CONSTRAINT `adult_roles_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `adult_roles_chk_1` CHECK (json_valid(`areas_of_expertise`))
) ENGINE=InnoDB AUTO_INCREMENT=101 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `announcements`
--

DROP TABLE IF EXISTS `announcements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `announcements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `pinned` tinyint(1) NOT NULL DEFAULT '0',
  `published_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ann_active` (`published_at`,`expires_at`),
  KEY `fk_ann_creator` (`created_by_id`),
  CONSTRAINT `fk_ann_creator` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `asset_categories`
--

DROP TABLE IF EXISTS `asset_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `asset_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asset_cat_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `actor_id` int DEFAULT NULL,
  `impersonating_role` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `table_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `record_id` int DEFAULT NULL,
  `action` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `old_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `new_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `ip_address` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `actor_id` (`actor_id`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`actor_id`) REFERENCES `members` (`id`),
  CONSTRAINT `audit_logs_chk_1` CHECK (json_valid(`old_values`)),
  CONSTRAINT `audit_logs_chk_2` CHECK (json_valid(`new_values`))
) ENGINE=InnoDB AUTO_INCREMENT=7450 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `availability_invites`
--

DROP TABLE IF EXISTS `availability_invites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `availability_invites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` char(40) COLLATE utf8mb4_general_ci NOT NULL,
  `family_id` int NOT NULL,
  `season` varchar(9) COLLATE utf8mb4_general_ci NOT NULL,
  `program_id` int DEFAULT NULL,
  `sent_to` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `used_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_invite_token` (`token`),
  KEY `idx_invite_family` (`family_id`,`season`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `calendar_holidays`
--

DROP TABLE IF EXISTS `calendar_holidays`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `calendar_holidays` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `holiday_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `recurring_annual` tinyint(1) NOT NULL DEFAULT '0',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_holiday_date` (`holiday_date`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_attendance`
--

DROP TABLE IF EXISTS `camp_attendance`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_attendance` (
  `id` int NOT NULL AUTO_INCREMENT,
  `registration_id` int NOT NULL,
  `day_date` date NOT NULL,
  `present` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `camp_att_reg_day` (`registration_id`,`day_date`),
  CONSTRAINT `camp_att_reg_fk` FOREIGN KEY (`registration_id`) REFERENCES `camp_registrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=259 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_contacts`
--

DROP TABLE IF EXISTS `camp_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_contacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(160) COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `marketing_consent` tinyint(1) NOT NULL DEFAULT '0',
  `opt_out` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `camp_contacts_email` (`email`),
  KEY `camp_contacts_member` (`member_id`),
  CONSTRAINT `camp_contacts_member_fk` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=55 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_programs`
--

DROP TABLE IF EXISTS `camp_programs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_programs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `display_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_registrations`
--

DROP TABLE IF EXISTS `camp_registrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_registrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `camper_id` int NOT NULL,
  `session_id` int NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `payment_method` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payment_status` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'unpaid',
  `confirmation_sent` tinyint(1) NOT NULL DEFAULT '0',
  `shirt_size` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shirt_received` tinyint(1) NOT NULL DEFAULT '0',
  `emergency1_name` varchar(160) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency1_relation` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency1_phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency2_name` varchar(160) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency2_relation` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency2_phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `waiver_liability_agreed` tinyint(1) NOT NULL DEFAULT '0',
  `waiver_media_agreed` tinyint(1) NOT NULL DEFAULT '0',
  `waiver_firstaid_agreed` tinyint(1) NOT NULL DEFAULT '0',
  `waiver_agreed_by` varchar(160) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `waiver_agreed_at` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `waiver_snapshot` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `camp_reg_camper_session` (`camper_id`,`session_id`),
  KEY `camp_reg_session` (`session_id`),
  CONSTRAINT `camp_reg_camper_fk` FOREIGN KEY (`camper_id`) REFERENCES `campers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `camp_reg_session_fk` FOREIGN KEY (`session_id`) REFERENCES `camp_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=82 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_resources`
--

DROP TABLE IF EXISTS `camp_resources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_resources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `season_id` int NOT NULL,
  `bucket` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'general',
  `title` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `url` varchar(1000) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `resource_type` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_camp_res_season` (`season_id`,`bucket`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_seasons`
--

DROP TABLE IF EXISTS `camp_seasons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_seasons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `year` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `registration_open` tinyint(1) NOT NULL DEFAULT '0',
  `intro_text` text COLLATE utf8mb4_general_ci,
  `waiver_liability` text COLLATE utf8mb4_general_ci,
  `waiver_media` text COLLATE utf8mb4_general_ci,
  `waiver_firstaid` text COLLATE utf8mb4_general_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `camp_seasons_year` (`year`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_sessions`
--

DROP TABLE IF EXISTS `camp_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `season_id` int NOT NULL,
  `program_id` int DEFAULT NULL,
  `title` varchar(160) COLLATE utf8mb4_general_ci NOT NULL,
  `week_label` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `start_time` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `end_time` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `age_band` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `capacity` int DEFAULT NULL,
  `public_blurb` text COLLATE utf8mb4_general_ci,
  `event_id` int DEFAULT NULL,
  `is_open` tinyint(1) NOT NULL DEFAULT '0',
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `camp_sessions_season` (`season_id`),
  KEY `camp_sessions_program` (`program_id`),
  KEY `camp_sessions_event` (`event_id`),
  CONSTRAINT `camp_sessions_event_fk` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `camp_sessions_program_fk` FOREIGN KEY (`program_id`) REFERENCES `camp_programs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `camp_sessions_season_fk` FOREIGN KEY (`season_id`) REFERENCES `camp_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_staff_apps`
--

DROP TABLE IF EXISTS `camp_staff_apps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_staff_apps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `season_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `name` varchar(160) COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `affiliation` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `sessions_applied` text COLLATE utf8mb4_general_ci,
  `roles_applied` text COLLATE utf8mb4_general_ci,
  `prior_summers` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `first_experience` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shirt_size` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `why_interested` text COLLATE utf8mb4_general_ci,
  `qualifications` text COLLATE utf8mb4_general_ci,
  `status` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `camp_staff_season` (`season_id`),
  KEY `camp_staff_member` (`member_id`),
  CONSTRAINT `camp_staff_member_fk` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `camp_staff_season_fk` FOREIGN KEY (`season_id`) REFERENCES `camp_seasons` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_submit_log`
--

DROP TABLE IF EXISTS `camp_submit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_submit_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ip_hash` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `camp_submit_ip` (`ip_hash`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `camp_worker_assignments`
--

DROP TABLE IF EXISTS `camp_worker_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `camp_worker_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `session_id` int NOT NULL,
  `member_id` int NOT NULL,
  `role` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_worker_camp` (`session_id`,`member_id`),
  KEY `idx_cwa_session` (`session_id`),
  KEY `idx_cwa_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `campers`
--

DROP TABLE IF EXISTS `campers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `campers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `contact_id` int DEFAULT NULL,
  `first_name` varchar(80) COLLATE utf8mb4_general_ci NOT NULL,
  `last_name` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `grade` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `school` varchar(160) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `age_band` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shirt_size` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `accommodations` text COLLATE utf8mb4_general_ci,
  `medical_notes` text COLLATE utf8mb4_general_ci,
  `food_allergies` text COLLATE utf8mb4_general_ci,
  `prior_experience` text COLLATE utf8mb4_general_ci,
  `member_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `campers_contact` (`contact_id`),
  KEY `campers_member` (`member_id`),
  CONSTRAINT `campers_contact_fk` FOREIGN KEY (`contact_id`) REFERENCES `camp_contacts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `campers_member_fk` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_badges`
--

DROP TABLE IF EXISTS `cert_badges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_badges` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `icon_name` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `color` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `criteria_type` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `criteria_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `tier` int DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `cert_badges_chk_1` CHECK (json_valid(`criteria_value`))
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_member_badges`
--

DROP TABLE IF EXISTS `cert_member_badges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_member_badges` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `badge_id` int NOT NULL,
  `earned_date` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_badge` (`member_id`,`badge_id`),
  KEY `badge_id` (`badge_id`),
  CONSTRAINT `cert_member_badges_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cert_member_badges_ibfk_2` FOREIGN KEY (`badge_id`) REFERENCES `cert_badges` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=266 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_quiz_answers`
--

DROP TABLE IF EXISTS `cert_quiz_answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_quiz_answers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `attempt_id` int NOT NULL,
  `question_id` int NOT NULL,
  `selected_option_ids` text,
  `response_text` text,
  `is_correct` tinyint(1) DEFAULT NULL,
  `points_earned` decimal(6,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_cqan_attempt` (`attempt_id`)
) ENGINE=InnoDB AUTO_INCREMENT=107 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_quiz_attempts`
--

DROP TABLE IF EXISTS `cert_quiz_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_quiz_attempts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quiz_id` int NOT NULL,
  `member_id` int NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'in_progress',
  `score_pct` decimal(5,2) DEFAULT NULL,
  `passed` tinyint(1) DEFAULT NULL,
  `awarded` tinyint(1) NOT NULL DEFAULT '0',
  `started_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `submitted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cqa_quiz_member` (`quiz_id`,`member_id`),
  KEY `idx_cqa_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_quiz_options`
--

DROP TABLE IF EXISTS `cert_quiz_options`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_quiz_options` (
  `id` int NOT NULL AUTO_INCREMENT,
  `question_id` int NOT NULL,
  `label` text NOT NULL,
  `is_correct` tinyint(1) NOT NULL DEFAULT '0',
  `display_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_cqo_question` (`question_id`)
) ENGINE=InnoDB AUTO_INCREMENT=906 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_quiz_questions`
--

DROP TABLE IF EXISTS `cert_quiz_questions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_quiz_questions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quiz_id` int NOT NULL,
  `type` varchar(20) NOT NULL DEFAULT 'single',
  `prompt` text NOT NULL,
  `points` int NOT NULL DEFAULT '1',
  `answer_key` text,
  `explanation` text,
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `image_url` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cqq_quiz` (`quiz_id`)
) ENGINE=InnoDB AUTO_INCREMENT=214 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cert_quizzes`
--

DROP TABLE IF EXISTS `cert_quizzes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cert_quizzes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `certification_id` int NOT NULL,
  `title` varchar(300) DEFAULT NULL,
  `instructions` text,
  `pass_pct` int NOT NULL DEFAULT '80',
  `max_attempts` int DEFAULT NULL,
  `shuffle_questions` tinyint(1) NOT NULL DEFAULT '0',
  `hold_results` tinyint(1) NOT NULL DEFAULT '0',
  `is_published` tinyint(1) NOT NULL DEFAULT '0',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cert_quiz_certification` (`certification_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `certifications`
--

DROP TABLE IF EXISTS `certifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `certifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `section` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `level` int DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `points` int DEFAULT NULL,
  `is_tool_gate` tinyint(1) DEFAULT NULL,
  `tool_name` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `prerequisites` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `classroom_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `display_order` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  CONSTRAINT `certifications_chk_1` CHECK (json_valid(`prerequisites`))
) ENGINE=InnoDB AUTO_INCREMENT=103 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `checkins`
--

DROP TABLE IF EXISTS `checkins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `checkins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `event_id` int DEFAULT NULL,
  `time_in` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `time_out` datetime DEFAULT NULL,
  `has_visitor` tinyint(1) DEFAULT NULL,
  `visitor_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `activity_area` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `open_member_id` int GENERATED ALWAYS AS (if((`time_out` is null),`member_id`,NULL)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_checkins_open_member` (`open_member_id`),
  KEY `member_id` (`member_id`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `checkins_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `checkins_ibfk_2` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=696 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `college_scholarship_app_requirements`
--

DROP TABLE IF EXISTS `college_scholarship_app_requirements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `college_scholarship_app_requirements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `application_id` int NOT NULL,
  `label` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `is_complete` tinyint(1) NOT NULL DEFAULT '0',
  `due_date` date DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_csar_app` (`application_id`),
  CONSTRAINT `fk_csar_app` FOREIGN KEY (`application_id`) REFERENCES `college_scholarship_applications` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `college_scholarship_applications`
--

DROP TABLE IF EXISTS `college_scholarship_applications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `college_scholarship_applications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scholarship_id` int NOT NULL,
  `member_id` int NOT NULL,
  `season` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('interested','applied','granted','partial','declined','no_decision') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'interested',
  `amount_awarded` decimal(10,2) DEFAULT NULL,
  `youth_award_response` enum('accepted','declined') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `target_college` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `thank_you_sent` tinyint(1) NOT NULL DEFAULT '0',
  `thank_you_date` date DEFAULT NULL,
  `applied_date` date DEFAULT NULL,
  `decision_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_capp` (`scholarship_id`,`member_id`,`season`),
  KEY `idx_capp_member` (`member_id`),
  KEY `idx_capp_status` (`status`),
  CONSTRAINT `fk_csca_mem` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_csca_sch` FOREIGN KEY (`scholarship_id`) REFERENCES `college_scholarships` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `college_scholarship_dismissed`
--

DROP TABLE IF EXISTS `college_scholarship_dismissed`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `college_scholarship_dismissed` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scholarship_id` int NOT NULL,
  `member_id` int NOT NULL,
  `reason` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'not_eligible',
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cdismiss` (`scholarship_id`,`member_id`),
  KEY `idx_cdismiss_member` (`member_id`),
  CONSTRAINT `fk_cdismiss_mem` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cdismiss_sch` FOREIGN KEY (`scholarship_id`) REFERENCES `college_scholarships` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `college_scholarship_follows`
--

DROP TABLE IF EXISTS `college_scholarship_follows`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `college_scholarship_follows` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scholarship_id` int NOT NULL,
  `member_id` int NOT NULL,
  `created_by_id` int DEFAULT NULL,
  `suggested_note` varchar(1000) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cfollow` (`scholarship_id`,`member_id`),
  KEY `idx_cfollow_member` (`member_id`),
  CONSTRAINT `fk_cscf_mem` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cscf_sch` FOREIGN KEY (`scholarship_id`) REFERENCES `college_scholarships` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `college_scholarships`
--

DROP TABLE IF EXISTS `college_scholarships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `college_scholarships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `provider` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `info_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `amount_min` decimal(10,2) DEFAULT NULL,
  `amount_max` decimal(10,2) DEFAULT NULL,
  `renewable` tinyint(1) NOT NULL DEFAULT '0',
  `renewable_years` tinyint DEFAULT NULL,
  `renewable_annual_amount` decimal(10,2) DEFAULT NULL,
  `season` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `open_date` date DEFAULT NULL,
  `close_date` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `elig_grad_year_min` int DEFAULT NULL,
  `elig_grad_year_max` int DEFAULT NULL,
  `elig_class_min` tinyint DEFAULT NULL,
  `elig_class_max` tinyint DEFAULT NULL,
  `elig_sex` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `elig_races` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `elig_states` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `elig_min_gpa` decimal(3,2) DEFAULT NULL,
  `elig_tags` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `elig_notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_csch_season` (`season`),
  KEY `idx_csch_active` (`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `comm_email_links`
--

DROP TABLE IF EXISTS `comm_email_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `comm_email_links` (
  `id` int NOT NULL AUTO_INCREMENT,
  `link_token` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `message_id` int NOT NULL,
  `url` varchar(1024) COLLATE utf8mb4_general_ci NOT NULL,
  `click_count` int NOT NULL DEFAULT '0',
  `first_clicked_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cel_token` (`link_token`),
  KEY `idx_cel_message` (`message_id`),
  CONSTRAINT `fk_cel_message` FOREIGN KEY (`message_id`) REFERENCES `communication_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9753 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `communication_messages`
--

DROP TABLE IF EXISTS `communication_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `communication_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `thread_id` int NOT NULL,
  `sender_id` int DEFAULT NULL,
  `sender_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `direction` enum('outbound','inbound') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `subject` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `body_html` text COLLATE utf8mb4_general_ci NOT NULL,
  `body_text` text COLLATE utf8mb4_general_ci,
  `status` enum('draft','sent','failed') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_general_ci,
  `template_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `track_token` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `opened_at` datetime DEFAULT NULL,
  `open_count` int NOT NULL DEFAULT '0',
  `clicked_at` datetime DEFAULT NULL,
  `click_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `thread_id` (`thread_id`),
  KEY `sender_id` (`sender_id`),
  KEY `template_id` (`template_id`),
  KEY `idx_cm_track_token` (`track_token`),
  CONSTRAINT `communication_messages_ibfk_1` FOREIGN KEY (`thread_id`) REFERENCES `communication_threads` (`id`),
  CONSTRAINT `communication_messages_ibfk_2` FOREIGN KEY (`sender_id`) REFERENCES `members` (`id`),
  CONSTRAINT `communication_messages_ibfk_3` FOREIGN KEY (`template_id`) REFERENCES `email_templates` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1138 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `communication_threads`
--

DROP TABLE IF EXISTS `communication_threads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `communication_threads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `subject` varchar(500) COLLATE utf8mb4_general_ci NOT NULL,
  `recipient_type` enum('member','visitor','volunteer','sponsor') COLLATE utf8mb4_general_ci NOT NULL,
  `recipient_id` int NOT NULL,
  `recipient_email` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `recipient_name` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reply_enabled` tinyint(1) DEFAULT NULL,
  `reply_token` varchar(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `batch_id` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `batch_personalized` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `reply_token` (`reply_token`),
  KEY `created_by_id` (`created_by_id`),
  KEY `idx_ct_batch` (`batch_id`),
  CONSTRAINT `communication_threads_ibfk_1` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1138 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `compliance_reminder_log`
--

DROP TABLE IF EXISTS `compliance_reminder_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `compliance_reminder_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `item` varchar(32) NOT NULL,
  `expires_date` date NOT NULL,
  `milestone` varchar(16) NOT NULL,
  `sent_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crl` (`member_id`,`item`,`expires_date`,`milestone`),
  KEY `idx_crl_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_attachments`
--

DROP TABLE IF EXISTS `email_attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` varchar(40) COLLATE utf8mb4_general_ci NOT NULL,
  `filename` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `stored_name` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `mime_type` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `size_bytes` int NOT NULL DEFAULT '0',
  `is_inline` tinyint(1) NOT NULL DEFAULT '0',
  `uploaded_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_att_token` (`token`),
  KEY `fk_email_att_uploader` (`uploaded_by_id`),
  CONSTRAINT `fk_email_att_uploader` FOREIGN KEY (`uploaded_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_drafts`
--

DROP TABLE IF EXISTS `email_drafts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_drafts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `created_by_id` int DEFAULT NULL,
  `subject` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payload` longtext COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ed_author` (`created_by_id`,`updated_at`),
  CONSTRAINT `fk_ed_author` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_layouts`
--

DROP TABLE IF EXISTS `email_layouts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_layouts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `header_html` text COLLATE utf8mb4_general_ci,
  `footer_html` text COLLATE utf8mb4_general_ci,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email_layout_default` (`is_default`),
  KEY `fk_email_layout_creator` (`created_by_id`),
  CONSTRAINT `fk_email_layout_creator` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_optouts`
--

DROP TABLE IF EXISTS `email_optouts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_optouts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(190) COLLATE utf8mb4_general_ci NOT NULL,
  `token` varchar(40) COLLATE utf8mb4_general_ci NOT NULL,
  `unsubscribed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_optout_email` (`email`),
  UNIQUE KEY `uq_optout_token` (`token`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `email_templates`
--

DROP TABLE IF EXISTS `email_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `category` enum('visitor','member','volunteer','sponsor','summer_camp','general','past_due') COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `subject_template` varchar(500) COLLATE utf8mb4_general_ci NOT NULL,
  `body_html_template` text COLLATE utf8mb4_general_ci NOT NULL,
  `available_variables` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `reply_enabled` tinyint(1) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by_id` (`created_by_id`),
  CONSTRAINT `email_templates_ibfk_1` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`),
  CONSTRAINT `email_templates_chk_1` CHECK (json_valid(`available_variables`))
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employer_form_invites`
--

DROP TABLE IF EXISTS `employer_form_invites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employer_form_invites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` varchar(64) NOT NULL,
  `member_id` int NOT NULL,
  `sent_to` varchar(255) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `last_used_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_efi_token` (`token`),
  KEY `idx_efi_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `enrollment_installments`
--

DROP TABLE IF EXISTS `enrollment_installments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollment_installments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `enrollment_id` int NOT NULL,
  `seq` int NOT NULL,
  `due_date` date NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `paid_date` date DEFAULT NULL,
  `paid_amount` decimal(10,2) DEFAULT NULL,
  `method` varchar(50) DEFAULT NULL,
  `reference` varchar(100) DEFAULT NULL,
  `recorded_by_id` int DEFAULT NULL,
  `notes` varchar(300) DEFAULT NULL,
  `reminded_at` date DEFAULT NULL,
  `reminders_suppressed` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ei_enrollment` (`enrollment_id`),
  KEY `idx_ei_due` (`due_date`,`status`),
  CONSTRAINT `fk_ei_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `enrollment_payment_plans`
--

DROP TABLE IF EXISTS `enrollment_payment_plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollment_payment_plans` (
  `enrollment_id` int NOT NULL,
  `reminders_suppressed` tinyint(1) NOT NULL DEFAULT '0',
  `note` varchar(500) DEFAULT NULL,
  `confirmation_sent_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`enrollment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `enrollment_season_closings`
--

DROP TABLE IF EXISTS `enrollment_season_closings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollment_season_closings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `enrollment_year` int NOT NULL,
  `closed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `closed_by_id` int DEFAULT NULL,
  `enrollments_expired` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `enrollment_year` (`enrollment_year`),
  KEY `closed_by_id` (`closed_by_id`),
  CONSTRAINT `enrollment_season_closings_ibfk_1` FOREIGN KEY (`closed_by_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `enrollments`
--

DROP TABLE IF EXISTS `enrollments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `program_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `date_enrolled` date DEFAULT NULL,
  `date_payment` date DEFAULT NULL,
  `pastdue_reminded_at` date DEFAULT NULL,
  `payment_amount` decimal(10,2) DEFAULT NULL,
  `payment_override` tinyint(1) DEFAULT NULL,
  `payment_method` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payment_reference` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `scholarship_fund` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `scholarship_amount` decimal(10,2) DEFAULT NULL,
  `tc_youth_agreed` tinyint(1) DEFAULT NULL,
  `tc_youth_date` datetime DEFAULT NULL,
  `tc_parent_agreed` tinyint(1) DEFAULT NULL,
  `tc_parent_date` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `auto_created_at` datetime DEFAULT NULL,
  `auto_created_by_id` int DEFAULT NULL,
  `amount_due` decimal(10,2) DEFAULT NULL,
  `amount_due_overridden` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `member_id` (`member_id`),
  KEY `program_id` (`program_id`),
  KEY `idx_enrollments_year_status` (`enrollment_year`,`status`),
  CONSTRAINT `enrollments_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `enrollments_ibfk_2` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=140 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_bring_items`
--

DROP TABLE IF EXISTS `event_bring_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_bring_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `name` varchar(150) NOT NULL,
  `qty_needed` int NOT NULL DEFAULT '1',
  `notes` varchar(300) DEFAULT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_bring_item_event` (`event_id`),
  CONSTRAINT `fk_bring_item_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_bring_signups`
--

DROP TABLE IF EXISTS `event_bring_signups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_bring_signups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `bring_item_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `other_name` varchar(150) DEFAULT NULL,
  `qty` int NOT NULL DEFAULT '1',
  `note` varchar(300) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_bring_signup_event` (`event_id`),
  KEY `fk_bring_signup_item` (`bring_item_id`),
  CONSTRAINT `fk_bring_signup_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bring_signup_item` FOREIGN KEY (`bring_item_id`) REFERENCES `event_bring_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_fundraising`
--

DROP TABLE IF EXISTS `event_fundraising`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_fundraising` (
  `event_id` int NOT NULL,
  `total_amount_available` decimal(12,2) DEFAULT NULL,
  `hourly_rate` decimal(14,6) DEFAULT NULL,
  `total_youth_hours` decimal(12,2) DEFAULT NULL,
  `finalized_at` datetime DEFAULT NULL,
  `finalized_by_id` int DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  CONSTRAINT `fk_efund_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_fundraising_teams`
--

DROP TABLE IF EXISTS `event_fundraising_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_fundraising_teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `team_season_id` int NOT NULL,
  `expected_amount` decimal(12,2) DEFAULT NULL,
  `budget_category_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_evt_team` (`event_id`,`team_season_id`),
  CONSTRAINT `fk_eft_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_groups`
--

DROP TABLE IF EXISTS `event_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `group_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_group` (`event_id`,`group_id`),
  KEY `idx_eg_group` (`group_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_logistics`
--

DROP TABLE IF EXISTS `event_logistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_logistics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `logistics_lead_id` int DEFAULT NULL,
  `destination_address` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `meetup_location` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `meetup_address` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `meetup_time` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `num_days` int DEFAULT NULL,
  `travel_required` tinyint(1) DEFAULT NULL,
  `travel_lead_id` int DEFAULT NULL,
  `participating_teams` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `housing_needed` tinyint(1) DEFAULT NULL,
  `housing_arranger_id` int DEFAULT NULL,
  `official_hotel_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_address_line1` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_address_line2` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_city` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_state` varchar(2) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_zip` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_contact_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_contact_phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `hotel_contact_email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `equipment_lead_id` int DEFAULT NULL,
  `meal_coordinator_id` int DEFAULT NULL,
  `budget_per_meal` decimal(10,2) DEFAULT NULL,
  `total_meal_budget` decimal(10,2) DEFAULT NULL,
  `youth_meal_contribution` decimal(10,2) DEFAULT NULL,
  `youth_meals_responsible_for` int DEFAULT NULL,
  `equipment_checklist` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `meal_notes` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  UNIQUE KEY `event_id` (`event_id`),
  KEY `logistics_lead_id` (`logistics_lead_id`),
  KEY `travel_lead_id` (`travel_lead_id`),
  KEY `housing_arranger_id` (`housing_arranger_id`),
  KEY `equipment_lead_id` (`equipment_lead_id`),
  KEY `meal_coordinator_id` (`meal_coordinator_id`),
  CONSTRAINT `event_logistics_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
  CONSTRAINT `event_logistics_ibfk_2` FOREIGN KEY (`logistics_lead_id`) REFERENCES `members` (`id`),
  CONSTRAINT `event_logistics_ibfk_3` FOREIGN KEY (`travel_lead_id`) REFERENCES `members` (`id`),
  CONSTRAINT `event_logistics_ibfk_4` FOREIGN KEY (`housing_arranger_id`) REFERENCES `members` (`id`),
  CONSTRAINT `event_logistics_ibfk_5` FOREIGN KEY (`equipment_lead_id`) REFERENCES `members` (`id`),
  CONSTRAINT `event_logistics_ibfk_6` FOREIGN KEY (`meal_coordinator_id`) REFERENCES `members` (`id`),
  CONSTRAINT `event_logistics_chk_1` CHECK (json_valid(`participating_teams`)),
  CONSTRAINT `event_logistics_chk_2` CHECK (json_valid(`equipment_checklist`))
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_member_distribution`
--

DROP TABLE IF EXISTS `event_member_distribution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_member_distribution` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `member_id` int NOT NULL,
  `team_season_id` int NOT NULL,
  `locked_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_evt_mem_team` (`event_id`,`member_id`,`team_season_id`),
  CONSTRAINT `fk_emd_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=70 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_participants`
--

DROP TABLE IF EXISTS `event_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_participants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `participant_type` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `other_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `section_label` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `separate_travel_to` tinyint(1) DEFAULT NULL,
  `separate_travel_from` tinyint(1) DEFAULT NULL,
  `separate_housing` tinyint(1) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `display_order` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `event_id` (`event_id`),
  KEY `member_id` (`member_id`),
  CONSTRAINT `event_participants_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`),
  CONSTRAINT `event_participants_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=537 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_rsvp_tokens`
--

DROP TABLE IF EXISTS `event_rsvp_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_rsvp_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `member_id` int NOT NULL,
  `token` varchar(36) COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_evt_rsvp_member` (`event_id`,`member_id`),
  UNIQUE KEY `uq_evt_rsvp_token` (`token`),
  KEY `fk_evt_rsvp_member` (`member_id`),
  CONSTRAINT `fk_evt_rsvp_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_evt_rsvp_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=445 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_signup_responses`
--

DROP TABLE IF EXISTS `event_signup_responses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_signup_responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slot_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `guest_name` varchar(200) DEFAULT NULL,
  `notes` varchar(400) DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_esr_slot_member` (`slot_id`,`member_id`),
  KEY `idx_esr_slot` (`slot_id`),
  KEY `idx_esr_member` (`member_id`),
  CONSTRAINT `fk_esr_slot` FOREIGN KEY (`slot_id`) REFERENCES `event_signup_slots` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_signup_slots`
--

DROP TABLE IF EXISTS `event_signup_slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_signup_slots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `area` varchar(200) DEFAULT NULL,
  `title` varchar(200) DEFAULT NULL,
  `slot_date` date DEFAULT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `capacity` int NOT NULL DEFAULT '1',
  `notes` varchar(400) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ess_event` (`event_id`),
  CONSTRAINT `fk_ess_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_sponsorship_packages`
--

DROP TABLE IF EXISTS `event_sponsorship_packages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_sponsorship_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `price` decimal(12,2) DEFAULT NULL,
  `quantity_available` int DEFAULT NULL,
  `benefits` text COLLATE utf8mb4_general_ci,
  `display_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_esp_event` (`event_id`),
  CONSTRAINT `fk_esp_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_sponsorships`
--

DROP TABLE IF EXISTS `event_sponsorships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_sponsorships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `sponsor_id` int NOT NULL,
  `package_id` int DEFAULT NULL,
  `contribution_id` int DEFAULT NULL,
  `stage` enum('prospect','invited','interested','committed','fulfilled','declined') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'interested',
  `pledged_amount` decimal(12,2) DEFAULT NULL,
  `received_amount` decimal(12,2) DEFAULT NULL,
  `in_kind_description` text COLLATE utf8mb4_general_ci,
  `received_date` date DEFAULT NULL,
  `relationship_owner_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_sponsor` (`event_id`,`sponsor_id`),
  KEY `idx_es_event` (`event_id`),
  KEY `fk_es_sponsor` (`sponsor_id`),
  KEY `fk_es_package` (`package_id`),
  CONSTRAINT `fk_es_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_es_package` FOREIGN KEY (`package_id`) REFERENCES `event_sponsorship_packages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_es_sponsor` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_spotlight`
--

DROP TABLE IF EXISTS `event_spotlight`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_spotlight` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `selected_member_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event` (`event_id`)
) ENGINE=InnoDB AUTO_INCREMENT=46 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_team_links`
--

DROP TABLE IF EXISTS `event_team_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_team_links` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `team_season_id` int NOT NULL,
  `category` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `event_id` (`event_id`),
  KEY `team_season_id` (`team_season_id`),
  CONSTRAINT `event_team_links_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `event_team_links_ibfk_2` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=277 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_transport_responses`
--

DROP TABLE IF EXISTS `event_transport_responses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_transport_responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `member_id` int NOT NULL,
  `response` varchar(20) DEFAULT NULL,
  `ride_to` varchar(20) DEFAULT NULL,
  `ride_back` varchar(20) DEFAULT NULL,
  `seats_available` int DEFAULT NULL,
  `assigned_driver_id` int DEFAULT NULL,
  `assigned_driver_to_id` int DEFAULT NULL,
  `assigned_driver_back_id` int DEFAULT NULL,
  `note` varchar(300) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_member` (`event_id`,`member_id`),
  CONSTRAINT `fk_transport_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `events`
--

DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `event_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `location` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `meeting_mode` enum('in_person','remote','hybrid') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'in_person',
  `remote_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `remote_details` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `details` text COLLATE utf8mb4_general_ci,
  `event_type` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_informational` tinyint(1) NOT NULL DEFAULT '0',
  `event_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `coordinator_id` int DEFAULT NULL,
  `post_to_public_calendar` tinyint(1) DEFAULT NULL,
  `google_calendar_event_id` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `mentor_coverage_met` tinyint(1) DEFAULT NULL,
  `mentor1_id` int DEFAULT NULL,
  `mentor2_id` int DEFAULT NULL,
  `requires_logistics` tinyint(1) DEFAULT NULL,
  `default_area_youth` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `default_area_adult` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `default_area_parent` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `fundraising_opportunity` tinyint(1) NOT NULL DEFAULT '0',
  `benefits_season` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_sponsorable` tinyint(1) NOT NULL DEFAULT '0',
  `sponsorship_deadline` date DEFAULT NULL,
  `sponsorship_goal` decimal(12,2) DEFAULT NULL,
  `sponsorship_owning_team_id` int DEFAULT NULL,
  `is_recurring` tinyint(1) DEFAULT NULL,
  `recurrence_group_id` varchar(36) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `recurrence_description` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `recurrence_index` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `volunteer_open` tinyint NOT NULL DEFAULT '0',
  `volunteer_signup_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `volunteer_signup_note` text COLLATE utf8mb4_general_ci,
  `bring_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `transport_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `is_tentative` tinyint(1) NOT NULL DEFAULT '0',
  `quicktrack_enabled` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `coordinator_id` (`coordinator_id`),
  KEY `mentor1_id` (`mentor1_id`),
  KEY `mentor2_id` (`mentor2_id`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`coordinator_id`) REFERENCES `members` (`id`),
  CONSTRAINT `events_ibfk_2` FOREIGN KEY (`mentor1_id`) REFERENCES `members` (`id`),
  CONSTRAINT `events_ibfk_3` FOREIGN KEY (`mentor2_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=249 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `families`
--

DROP TABLE IF EXISTS `families`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `families` (
  `id` int NOT NULL AUTO_INCREMENT,
  `family_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=900003 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `family_members`
--

DROP TABLE IF EXISTS `family_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `family_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `family_id` int NOT NULL,
  `member_id` int NOT NULL,
  `relationship_label` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_primary_contact` tinyint(1) DEFAULT NULL,
  `added_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_family_member` (`member_id`),
  KEY `family_id` (`family_id`),
  CONSTRAINT `family_members_ibfk_1` FOREIGN KEY (`family_id`) REFERENCES `families` (`id`),
  CONSTRAINT `family_members_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=253 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fdp_interviews`
--

DROP TABLE IF EXISTS `fdp_interviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fdp_interviews` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `team_season_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `direction` varchar(10) NOT NULL DEFAULT 'team',
  `status` varchar(20) NOT NULL DEFAULT 'requested',
  `requested_by_id` int DEFAULT NULL,
  `scheduled_at` datetime DEFAULT NULL,
  `location` varchar(200) DEFAULT NULL,
  `outcome` varchar(20) DEFAULT NULL,
  `reminded_at` date DEFAULT NULL,
  `notes` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fdp_int_member` (`member_id`,`enrollment_year`),
  KEY `idx_fdp_int_team` (`team_season_id`,`status`),
  CONSTRAINT `fk_fdp_int_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fdp_int_team` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fdp_memberships`
--

DROP TABLE IF EXISTS `fdp_memberships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fdp_memberships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `joined_date` date DEFAULT NULL,
  `joined_source` varchar(20) NOT NULL DEFAULT 'manual',
  `graduated_date` date DEFAULT NULL,
  `graduated_by_id` int DEFAULT NULL,
  `graduated_note` text,
  `notes` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_year` (`member_id`,`enrollment_year`),
  KEY `idx_year_status` (`enrollment_year`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fdp_progress`
--

DROP TABLE IF EXISTS `fdp_progress`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fdp_progress` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `resume_url` varchar(500) DEFAULT NULL,
  `resume_updated_at` datetime DEFAULT NULL,
  `resume_updated_by_id` int DEFAULT NULL,
  `board_review_date` date DEFAULT NULL,
  `board_review_outcome` varchar(20) DEFAULT NULL,
  `board_review_panel` varchar(300) DEFAULT NULL,
  `board_review_notes` text,
  `board_review_scores` text,
  `board_review_by_id` int DEFAULT NULL,
  `board_review_scheduled_at` datetime DEFAULT NULL,
  `board_review_reminded_at` date DEFAULT NULL,
  `board_review_location` varchar(200) DEFAULT NULL,
  `notes` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fdp_progress_member` (`member_id`),
  CONSTRAINT `fk_fdp_progress_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `feedback`
--

DROP TABLE IF EXISTS `feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `feedback` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int DEFAULT NULL,
  `type` enum('bug','feature','enhancement','other') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'bug',
  `title` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `steps` text COLLATE utf8mb4_general_ci,
  `page` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `app_version` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `user_agent` varchar(400) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('new','planned','in_progress','in_review','testing','done','declined') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'new',
  `priority` enum('low','normal','high','critical') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'normal',
  `admin_notes` text COLLATE utf8mb4_general_ci,
  `resolution_release` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `deployed_on` date DEFAULT NULL,
  `resolution_notes` text COLLATE utf8mb4_general_ci,
  `confirmed_at` datetime DEFAULT NULL,
  `confirmed_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `target_release` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `entered_by_id` int DEFAULT NULL,
  `github_issue_number` int DEFAULT NULL,
  `github_issue_url` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_feedback_member` (`member_id`),
  KEY `idx_feedback_status` (`status`,`type`),
  KEY `fk_feedback_entered_by` (`entered_by_id`),
  CONSTRAINT `fk_feedback_entered_by` FOREIGN KEY (`entered_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=166 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `feedback_comments`
--

DROP TABLE IF EXISTS `feedback_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `feedback_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `feedback_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `body` text NOT NULL,
  `kind` varchar(20) NOT NULL DEFAULT 'comment',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feedback` (`feedback_id`,`created_at`),
  CONSTRAINT `fk_fbcomment_feedback` FOREIGN KEY (`feedback_id`) REFERENCES `feedback` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `finance_imports`
--

DROP TABLE IF EXISTS `finance_imports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `finance_imports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source` varchar(40) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'quickbooks',
  `filename` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `label` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `as_of_date` date DEFAULT NULL,
  `period_start` date DEFAULT NULL,
  `period_end` date DEFAULT NULL,
  `segment_kind` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notes` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  KEY `idx_fin_import_date` (`as_of_date`),
  KEY `fk_fin_import_creator` (`created_by_id`),
  CONSTRAINT `fk_fin_import_creator` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `finance_lines`
--

DROP TABLE IF EXISTS `finance_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `finance_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `import_id` int NOT NULL,
  `segment_label` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `account` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `income` decimal(12,2) NOT NULL DEFAULT '0.00',
  `expense` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_fin_line_import` (`import_id`),
  KEY `idx_fin_line_segment` (`segment_label`),
  CONSTRAINT `fk_fin_line_import` FOREIGN KEY (`import_id`) REFERENCES `finance_imports` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `finance_segment_map`
--

DROP TABLE IF EXISTS `finance_segment_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `finance_segment_map` (
  `id` int NOT NULL AUTO_INCREMENT,
  `segment_label` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `team_season_id` int DEFAULT NULL,
  `scope` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'team',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fin_seg_label` (`segment_label`),
  KEY `fk_fin_seg_team` (`team_season_id`),
  CONSTRAINT `fk_fin_seg_team` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `first_aid_log`
--

DROP TABLE IF EXISTS `first_aid_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `first_aid_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int DEFAULT NULL,
  `person_name` varchar(120) DEFAULT NULL,
  `occurred_at` datetime DEFAULT NULL,
  `treatment` varchar(300) DEFAULT NULL,
  `provided_by_id` int DEFAULT NULL,
  `supplies_used` varchar(300) DEFAULT NULL,
  `notes` varchar(500) DEFAULT NULL,
  `promoted_incident_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_firstaid_occurred` (`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `first_seasons`
--

DROP TABLE IF EXISTS `first_seasons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `first_seasons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `theme` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `fll_explore_game` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `fll_challenge_game` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `ftc_game` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `frc_game` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `fdp_game` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `display_order` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `season` (`season`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grant_correspondence`
--

DROP TABLE IF EXISTS `grant_correspondence`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grant_correspondence` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grant_id` int NOT NULL,
  `subject` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `sender` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `correspondence_date` date DEFAULT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `attachment_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_gc_grant` (`grant_id`),
  CONSTRAINT `fk_gc_grant` FOREIGN KEY (`grant_id`) REFERENCES `grants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grant_custom_fields`
--

DROP TABLE IF EXISTS `grant_custom_fields`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grant_custom_fields` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grant_id` int NOT NULL,
  `label` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `response` text COLLATE utf8mb4_general_ci,
  `display_order` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_gcf_grant` (`grant_id`),
  CONSTRAINT `fk_gcf_grant` FOREIGN KEY (`grant_id`) REFERENCES `grants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grant_teams`
--

DROP TABLE IF EXISTS `grant_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grant_teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grant_id` int NOT NULL,
  `team_season_id` int DEFAULT NULL,
  `is_trc` tinyint(1) NOT NULL DEFAULT '0',
  `eligible` tinyint(1) NOT NULL DEFAULT '1',
  `submitted` tinyint(1) NOT NULL DEFAULT '0',
  `submitted_date` date DEFAULT NULL,
  `amount_requested` decimal(12,2) DEFAULT NULL,
  `outcome` enum('pending','awarded','declined') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `amount_received` decimal(12,2) DEFAULT NULL,
  `restricted_amount` decimal(12,2) DEFAULT NULL,
  `distribution_method` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `distribution_note` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `budget_donation_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grant_team` (`grant_id`,`team_season_id`),
  CONSTRAINT `fk_gt_grant` FOREIGN KEY (`grant_id`) REFERENCES `grants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `grants`
--

DROP TABLE IF EXISTS `grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(250) COLLATE utf8mb4_general_ci NOT NULL,
  `funder_name` varchar(250) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `scope` enum('trc','team','multi_team') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'multi_team',
  `recurrence` enum('one_time','annual','other') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'one_time',
  `status` varchar(40) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'researching',
  `season` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `submitted_by_id` int DEFAULT NULL,
  `submitted_date` date DEFAULT NULL,
  `expected_response_date` date DEFAULT NULL,
  `num_rounds` int DEFAULT NULL,
  `current_round` int DEFAULT NULL,
  `restricted_funds` tinyint(1) NOT NULL DEFAULT '0',
  `restriction_note` text COLLATE utf8mb4_general_ci,
  `available_date` date DEFAULT NULL,
  `remind_date` date DEFAULT NULL,
  `remind_note` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `description` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_grants_season` (`season`),
  CONSTRAINT `grants_chk_1` CHECK (json_valid(`links`))
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `guided_tours`
--

DROP TABLE IF EXISTS `guided_tours`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `guided_tours` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tour_key` varchar(80) NOT NULL,
  `title` varchar(200) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `steps` mediumtext NOT NULL,
  `roles` varchar(200) DEFAULT NULL,
  `auto_key` varchar(80) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_published` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tour_key` (`tour_key`),
  KEY `idx_tour_auto` (`auto_key`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `help_articles`
--

DROP TABLE IF EXISTS `help_articles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `help_articles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(120) NOT NULL,
  `title` varchar(200) NOT NULL,
  `category` varchar(80) NOT NULL DEFAULT 'General',
  `summary` varchar(300) DEFAULT NULL,
  `body` mediumtext,
  `tags` varchar(300) DEFAULT NULL,
  `roles` varchar(200) DEFAULT NULL,
  `help_key` varchar(80) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_published` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_help_slug` (`slug`),
  KEY `idx_help_category` (`category`),
  KEY `idx_help_key` (`help_key`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hof_members`
--

DROP TABLE IF EXISTS `hof_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hof_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int DEFAULT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `photo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `graduation_year` int DEFAULT NULL,
  `years_in_program` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `high_school` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `deans_list_semifinalist` tinyint(1) NOT NULL DEFAULT '0',
  `deans_list_finalist` tinyint(1) NOT NULL DEFAULT '0',
  `eagle_scout` tinyint(1) NOT NULL DEFAULT '0',
  `eagle_scout_troop` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `college` varchar(250) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `field_of_study` varchar(250) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `degrees` varchar(400) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `where_now` text COLLATE utf8mb4_general_ci,
  `teams` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `awards` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `positions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `project_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `article_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `album_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `documents` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `is_published` tinyint(1) NOT NULL DEFAULT '0',
  `display_order` int NOT NULL DEFAULT '0',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `college_grad_year` int DEFAULT NULL,
  `still_in_school` tinyint(1) NOT NULL DEFAULT '0',
  `reflections` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (`id`),
  KEY `fk_hof_member` (`member_id`),
  KEY `idx_hof_class` (`graduation_year`,`is_published`),
  CONSTRAINT `fk_hof_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `hof_members_chk_1` CHECK (json_valid(`teams`)),
  CONSTRAINT `hof_members_chk_2` CHECK (json_valid(`awards`)),
  CONSTRAINT `hof_members_chk_3` CHECK (json_valid(`positions`)),
  CONSTRAINT `hof_members_chk_4` CHECK (json_valid(`project_links`)),
  CONSTRAINT `hof_members_chk_5` CHECK (json_valid(`article_links`)),
  CONSTRAINT `hof_members_chk_6` CHECK (json_valid(`album_links`)),
  CONSTRAINT `hof_members_chk_7` CHECK (json_valid(`documents`)),
  CONSTRAINT `hof_members_chk_8` CHECK (json_valid(`reflections`))
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel_room_assignments`
--

DROP TABLE IF EXISTS `hotel_room_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel_room_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `room_id` int NOT NULL,
  `member_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `room_id` (`room_id`),
  KEY `member_id` (`member_id`),
  CONSTRAINT `hotel_room_assignments_ibfk_1` FOREIGN KEY (`room_id`) REFERENCES `hotel_rooms` (`id`),
  CONSTRAINT `hotel_room_assignments_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel_rooms`
--

DROP TABLE IF EXISTS `hotel_rooms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel_rooms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `logistics_id` int NOT NULL,
  `room_label` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `room_number` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `room_type` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `room_rate` decimal(10,2) DEFAULT NULL,
  `max_occupants` int DEFAULT NULL,
  `confirmation_number` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `canceled` tinyint(1) DEFAULT NULL,
  `cancellation_number` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `paid_by_trc` tinyint(1) DEFAULT NULL,
  `reimbursement_amount` decimal(10,2) DEFAULT NULL,
  `reimbursement_by_id` int DEFAULT NULL,
  `reimbursement_date` date DEFAULT NULL,
  `reimbursement_method` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reimbursement_reference` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `logistics_id` (`logistics_id`),
  KEY `reimbursement_by_id` (`reimbursement_by_id`),
  CONSTRAINT `hotel_rooms_ibfk_1` FOREIGN KEY (`logistics_id`) REFERENCES `event_logistics` (`id`),
  CONSTRAINT `hotel_rooms_ibfk_2` FOREIGN KEY (`reimbursement_by_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_attachments`
--

DROP TABLE IF EXISTS `incident_attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `stored_name` varchar(160) NOT NULL,
  `original_name` varchar(255) DEFAULT NULL,
  `mime` varchar(120) DEFAULT NULL,
  `size_bytes` int DEFAULT NULL,
  `uploaded_by_id` int DEFAULT NULL,
  `is_restricted` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_incatt_incident` (`incident_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_identity_vault`
--

DROP TABLE IF EXISTS `incident_identity_vault`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_identity_vault` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `sealed` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vault_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_injury`
--

DROP TABLE IF EXISTS `incident_injury`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_injury` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `body_parts` json DEFAULT NULL,
  `injury_nature` varchar(60) DEFAULT NULL,
  `mechanism` varchar(60) DEFAULT NULL,
  `inv_item_id` int DEFAULT NULL,
  `ppe_required` varchar(120) DEFAULT NULL,
  `ppe_worn` varchar(120) DEFAULT NULL,
  `trained_certified` tinyint(1) DEFAULT NULL,
  `certification_id` int DEFAULT NULL,
  `supervised_by_id` int DEFAULT NULL,
  `treatment_level` enum('none','first_aid','sent_to_parent_or_doctor','urgent_care','er','ems_transport','refused') DEFAULT NULL,
  `loss_of_consciousness` tinyint(1) DEFAULT NULL,
  `concussion_protocol` tinyint(1) DEFAULT NULL,
  `returned_to_activity` tinyint(1) DEFAULT NULL,
  `restriction` varchar(200) DEFAULT NULL,
  `medication_given` tinyint(1) DEFAULT NULL,
  `rescue_med` varchar(40) DEFAULT NULL,
  `outcome` varchar(60) DEFAULT NULL,
  `claim_likely` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_incinjury_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_notes`
--

DROP TABLE IF EXISTS `incident_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `author_id` int DEFAULT NULL,
  `body` text NOT NULL,
  `note_kind` enum('addendum','witness_statement','triage','closure') NOT NULL DEFAULT 'addendum',
  `visibility` enum('standard','restricted') NOT NULL DEFAULT 'standard',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_incnotes_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_notifications`
--

DROP TABLE IF EXISTS `incident_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `channel` varchar(20) NOT NULL DEFAULT 'email',
  `recipient` varchar(255) DEFAULT NULL,
  `reason` varchar(200) DEFAULT NULL,
  `rule_id` int DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ok` tinyint(1) NOT NULL DEFAULT '1',
  `error` varchar(300) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_incnotif_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_people`
--

DROP TABLE IF EXISTS `incident_people`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_people` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `name` varchar(120) DEFAULT NULL,
  `person_role` enum('affected','witness','involved','responder') NOT NULL DEFAULT 'affected',
  `is_youth` tinyint(1) DEFAULT NULL,
  `notes` varchar(300) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_incpeople_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_reports`
--

DROP TABLE IF EXISTS `incident_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ref_no` varchar(20) DEFAULT NULL,
  `type` varchar(40) NOT NULL,
  `severity` enum('minor','moderate','serious','critical') DEFAULT NULL,
  `reporter_severity` enum('minor','moderate','serious','critical') DEFAULT NULL,
  `status` enum('submitted','triaged','in_review','awaiting_action','closed') NOT NULL DEFAULT 'submitted',
  `is_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `reporter_id` int DEFAULT NULL,
  `filed_for_member_id` int DEFAULT NULL,
  `filed_for_name` varchar(120) DEFAULT NULL,
  `filed_for_relationship` varchar(80) DEFAULT NULL,
  `occurred_at` datetime DEFAULT NULL,
  `occurred_approx` tinyint(1) NOT NULL DEFAULT '0',
  `location_kind` enum('trc','offsite','other') DEFAULT NULL,
  `location_area` varchar(60) DEFAULT NULL,
  `location_other` varchar(200) DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `team_id` int DEFAULT NULL,
  `description` text,
  `immediate_actions` text,
  `notified_at_time` json DEFAULT NULL,
  `ems_called` tinyint(1) NOT NULL DEFAULT '0',
  `police_called` tinyint(1) NOT NULL DEFAULT '0',
  `parent_notified` tinyint(1) NOT NULL DEFAULT '0',
  `parent_notified_at` datetime DEFAULT NULL,
  `parent_notified_by_id` int DEFAULT NULL,
  `parent_notify_method` varchar(20) DEFAULT NULL,
  `parent_notify_result` varchar(20) DEFAULT NULL,
  `ongoing_risk` tinyint(1) NOT NULL DEFAULT '0',
  `is_sensitive` tinyint(1) NOT NULL DEFAULT '0',
  `is_restricted` tinyint(1) NOT NULL DEFAULT '0',
  `detail` json DEFAULT NULL,
  `assigned_to_id` int DEFAULT NULL,
  `triaged_at` datetime DEFAULT NULL,
  `triaged_by_id` int DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  `closed_by_id` int DEFAULT NULL,
  `closure_summary` text,
  `board_reportable` tinyint(1) NOT NULL DEFAULT '0',
  `external_notified` json DEFAULT NULL,
  `retention_hold` tinyint(1) NOT NULL DEFAULT '1',
  `retention_review_on` date DEFAULT NULL,
  `follow_up_due` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_incident_ref` (`ref_no`),
  KEY `idx_incident_type` (`type`),
  KEY `idx_incident_status` (`status`),
  KEY `idx_incident_severity` (`severity`),
  KEY `idx_incident_occurred` (`occurred_at`),
  KEY `idx_incident_assigned` (`assigned_to_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_tasks`
--

DROP TABLE IF EXISTS `incident_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `task_id` int NOT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inctask` (`incident_id`,`task_id`),
  KEY `idx_inctask_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `incident_vault_access_log`
--

DROP TABLE IF EXISTS `incident_vault_access_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `incident_vault_access_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `incident_id` int NOT NULL,
  `unsealed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `os_user` varchar(120) DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `host` varchar(160) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vaultlog_incident` (`incident_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_battery_tests`
--

DROP TABLE IF EXISTS `inv_battery_tests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_battery_tests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `test_date` date DEFAULT NULL,
  `resistance_beak` decimal(8,2) DEFAULT NULL,
  `resistance_gobilda` decimal(8,2) DEFAULT NULL,
  `result` varchar(12) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `tested_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `item_id` (`item_id`),
  KEY `tested_by_id` (`tested_by_id`),
  CONSTRAINT `inv_battery_tests_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_battery_tests_ibfk_2` FOREIGN KEY (`tested_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_bom_lines`
--

DROP TABLE IF EXISTS `inv_bom_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_bom_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bom_id` int NOT NULL,
  `item_id` int DEFAULT NULL,
  `part_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` varchar(400) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `package_quantity` int DEFAULT NULL,
  `quantity_required` decimal(12,2) DEFAULT NULL,
  `expected_price` decimal(12,2) DEFAULT NULL,
  `budget_category_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `actual_purchase_price` decimal(12,2) DEFAULT NULL,
  `ordered_quantity` decimal(12,2) DEFAULT NULL,
  `backorder_flag` tinyint(1) DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `received_quantity` decimal(12,2) DEFAULT NULL,
  `damaged_quantity` decimal(12,2) DEFAULT NULL,
  `missing_quantity` decimal(12,2) DEFAULT NULL,
  `is_received` tinyint(1) DEFAULT NULL,
  `destination_type` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `destination_team_season_id` int DEFAULT NULL,
  `receiving_budget_category_id` int DEFAULT NULL,
  `packing_slip_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `received_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `bom_id` (`bom_id`),
  KEY `item_id` (`item_id`),
  KEY `budget_category_id` (`budget_category_id`),
  KEY `destination_team_season_id` (`destination_team_season_id`),
  KEY `receiving_budget_category_id` (`receiving_budget_category_id`),
  CONSTRAINT `inv_bom_lines_ibfk_1` FOREIGN KEY (`bom_id`) REFERENCES `inv_boms` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_bom_lines_ibfk_2` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_bom_lines_ibfk_3` FOREIGN KEY (`budget_category_id`) REFERENCES `inv_budget_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_bom_lines_ibfk_4` FOREIGN KEY (`destination_team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_bom_lines_ibfk_5` FOREIGN KEY (`receiving_budget_category_id`) REFERENCES `inv_budget_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=73 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_boms`
--

DROP TABLE IF EXISTS `inv_boms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_boms` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int DEFAULT NULL,
  `vendor_id` int DEFAULT NULL,
  `budget_category_id` int DEFAULT NULL,
  `po_id` int DEFAULT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `version` int DEFAULT NULL,
  `is_locked` tinyint(1) DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `submitted_by_id` int DEFAULT NULL,
  `order_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `confirmation_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shipping` decimal(12,2) DEFAULT NULL,
  `tax` decimal(12,2) DEFAULT NULL,
  `shipment_address` text COLLATE utf8mb4_general_ci,
  `expected_delivery_date` date DEFAULT NULL,
  `tracking_number` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `order_date` date DEFAULT NULL,
  `ordered_flag` tinyint(1) DEFAULT NULL,
  `backorder_flag` tinyint(1) DEFAULT NULL,
  `invoice_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `needed_by` varchar(16) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `needed_by_date` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `vendor_id` (`vendor_id`),
  KEY `budget_category_id` (`budget_category_id`),
  KEY `po_id` (`po_id`),
  KEY `created_by_id` (`created_by_id`),
  KEY `submitted_by_id` (`submitted_by_id`),
  CONSTRAINT `inv_boms_ibfk_1` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_boms_ibfk_2` FOREIGN KEY (`vendor_id`) REFERENCES `inv_vendors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_boms_ibfk_3` FOREIGN KEY (`budget_category_id`) REFERENCES `inv_budget_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_boms_ibfk_4` FOREIGN KEY (`po_id`) REFERENCES `inv_purchase_orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_boms_ibfk_5` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_boms_ibfk_6` FOREIGN KEY (`submitted_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_budget_categories`
--

DROP TABLE IF EXISTS `inv_budget_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_budget_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `parent_id` int DEFAULT NULL,
  `name` varchar(150) COLLATE utf8mb4_general_ci NOT NULL,
  `budgeted_amount` decimal(12,2) DEFAULT NULL,
  `actual_amount` decimal(12,2) DEFAULT NULL,
  `is_fundraising` tinyint(1) DEFAULT NULL,
  `fundraising_goal` decimal(12,2) DEFAULT NULL,
  `fundraising_raised` decimal(12,2) DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `idx_budget_cat_parent` (`parent_id`),
  CONSTRAINT `fk_budget_cat_parent` FOREIGN KEY (`parent_id`) REFERENCES `inv_budget_categories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_budget_categories_ibfk_1` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=87 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_categories`
--

DROP TABLE IF EXISTS `inv_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `parent_id` int DEFAULT NULL,
  `icon_name` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `color` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `inv_categories_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `inv_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=77 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_checkouts`
--

DROP TABLE IF EXISTS `inv_checkouts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_checkouts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int DEFAULT NULL,
  `custom_item_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `checkout_type` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `quantity` decimal(12,2) DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `team_season_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `checkout_date` datetime DEFAULT NULL,
  `expected_return_date` date DEFAULT NULL,
  `extension_requested_date` date DEFAULT NULL,
  `extension_requested_by_id` int DEFAULT NULL,
  `extension_requested_at` datetime DEFAULT NULL,
  `extension_note` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `returned_date` datetime DEFAULT NULL,
  `condition_out` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `condition_in` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `damage_report` text COLLATE utf8mb4_general_ci,
  `notes` text COLLATE utf8mb4_general_ci,
  `requested_by_id` int DEFAULT NULL,
  `approved_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `item_id` (`item_id`),
  KEY `member_id` (`member_id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `event_id` (`event_id`),
  KEY `requested_by_id` (`requested_by_id`),
  KEY `approved_by_id` (`approved_by_id`),
  KEY `idx_inv_checkout_ext_pending` (`extension_requested_date`),
  CONSTRAINT `inv_checkouts_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_checkouts_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_checkouts_ibfk_3` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_checkouts_ibfk_4` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_checkouts_ibfk_5` FOREIGN KEY (`requested_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_checkouts_ibfk_6` FOREIGN KEY (`approved_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_fundraising_donations`
--

DROP TABLE IF EXISTS `inv_fundraising_donations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_fundraising_donations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `budget_category_id` int NOT NULL,
  `event_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `expected_amount` decimal(12,2) DEFAULT NULL,
  `received_amount` decimal(12,2) DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `grant_id` int DEFAULT NULL,
  `sponsor_id` int DEFAULT NULL,
  `restricted_amount` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `budget_category_id` (`budget_category_id`),
  CONSTRAINT `inv_fundraising_donations_ibfk_1` FOREIGN KEY (`budget_category_id`) REFERENCES `inv_budget_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=477 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_item_holdings`
--

DROP TABLE IF EXISTS `inv_item_holdings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_item_holdings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `location_id` int DEFAULT NULL,
  `team_season_id` int DEFAULT NULL,
  `quantity` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `item_id` (`item_id`),
  KEY `location_id` (`location_id`),
  KEY `team_season_id` (`team_season_id`),
  CONSTRAINT `inv_item_holdings_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_item_holdings_ibfk_2` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_item_holdings_ibfk_3` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=105 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_item_locations`
--

DROP TABLE IF EXISTS `inv_item_locations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_item_locations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `location_id` int NOT NULL,
  `rack` varchar(40) DEFAULT NULL,
  `shelf` varchar(40) DEFAULT NULL,
  `bin` varchar(40) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_item_location` (`item_id`,`location_id`),
  KEY `idx_location` (`location_id`),
  CONSTRAINT `fk_iil_item` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_iil_location` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_item_photos`
--

DROP TABLE IF EXISTS `inv_item_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_item_photos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `url` varchar(500) COLLATE utf8mb4_general_ci NOT NULL,
  `caption` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `uploaded_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_iip_item` (`item_id`,`display_order`),
  KEY `fk_iip_user` (`uploaded_by`),
  CONSTRAINT `fk_iip_item` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_iip_user` FOREIGN KEY (`uploaded_by`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_item_sources`
--

DROP TABLE IF EXISTS `inv_item_sources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_item_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `vendor_id` int NOT NULL,
  `vendor_part_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `price` decimal(12,2) DEFAULT NULL,
  `url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_preferred` tinyint(1) NOT NULL DEFAULT '0',
  `notes` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `item_id` (`item_id`),
  KEY `vendor_id` (`vendor_id`),
  CONSTRAINT `inv_item_sources_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_item_sources_ibfk_2` FOREIGN KEY (`vendor_id`) REFERENCES `inv_vendors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_items`
--

DROP TABLE IF EXISTS `inv_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_type` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `category` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `subcategory` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `part_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `category_id` int DEFAULT NULL,
  `asset_category_id` int DEFAULT NULL,
  `asset_tag` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `serial_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `vendor_id` int DEFAULT NULL,
  `location_id` int DEFAULT NULL,
  `assigned_team_season_id` int DEFAULT NULL,
  `unit_of_measure` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `package_quantity` int DEFAULT NULL,
  `current_quantity` decimal(12,2) DEFAULT NULL,
  `minimum_stock_level` decimal(12,2) DEFAULT NULL,
  `reorder_flag` tinyint(1) DEFAULT NULL,
  `cost` decimal(12,2) DEFAULT NULL,
  `purchase_date` date DEFAULT NULL,
  `warranty_info` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `maintenance_schedule` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `battery_type` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `retirement_date` date DEFAULT NULL,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `notes` text COLLATE utf8mb4_general_ci,
  `is_donated` tinyint(1) NOT NULL DEFAULT '0',
  `donor_member_id` int DEFAULT NULL,
  `donor_sponsor_id` int DEFAULT NULL,
  `donor_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `donation_date` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `is_discontinued` tinyint(1) NOT NULL DEFAULT '0',
  `is_kit` tinyint(1) NOT NULL DEFAULT '0',
  `color` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `length` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `pitch` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `pattern` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `inner_diameter` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `outer_diameter` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `measurement_system` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'na',
  PRIMARY KEY (`id`),
  UNIQUE KEY `asset_tag` (`asset_tag`),
  KEY `category_id` (`category_id`),
  KEY `vendor_id` (`vendor_id`),
  KEY `location_id` (`location_id`),
  KEY `assigned_team_season_id` (`assigned_team_season_id`),
  KEY `fk_inv_asset_cat` (`asset_category_id`),
  KEY `fk_inv_donor_member` (`donor_member_id`),
  KEY `fk_inv_donor_sponsor` (`donor_sponsor_id`),
  CONSTRAINT `fk_inv_asset_cat` FOREIGN KEY (`asset_category_id`) REFERENCES `asset_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inv_donor_member` FOREIGN KEY (`donor_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inv_donor_sponsor` FOREIGN KEY (`donor_sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_items_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `inv_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_items_ibfk_2` FOREIGN KEY (`vendor_id`) REFERENCES `inv_vendors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_items_ibfk_3` FOREIGN KEY (`location_id`) REFERENCES `inv_locations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_items_ibfk_4` FOREIGN KEY (`assigned_team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_items_chk_1` CHECK (json_valid(`tags`))
) ENGINE=InnoDB AUTO_INCREMENT=1242 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_kit_components`
--

DROP TABLE IF EXISTS `inv_kit_components`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_kit_components` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kit_item_id` int NOT NULL,
  `component_item_id` int NOT NULL,
  `quantity` decimal(12,2) NOT NULL DEFAULT '1.00',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `kit_item_id` (`kit_item_id`),
  KEY `component_item_id` (`component_item_id`),
  CONSTRAINT `inv_kit_components_ibfk_1` FOREIGN KEY (`kit_item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_kit_components_ibfk_2` FOREIGN KEY (`component_item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_locations`
--

DROP TABLE IF EXISTS `inv_locations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_locations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `kind` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `parent_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `inv_locations_ibfk_1` FOREIGN KEY (`parent_id`) REFERENCES `inv_locations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_movements`
--

DROP TABLE IF EXISTS `inv_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_movements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `movement_type` varchar(40) COLLATE utf8mb4_general_ci NOT NULL,
  `quantity` decimal(12,2) DEFAULT NULL,
  `from_location_id` int DEFAULT NULL,
  `to_location_id` int DEFAULT NULL,
  `from_team_season_id` int DEFAULT NULL,
  `to_team_season_id` int DEFAULT NULL,
  `reason` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `actor_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `item_id` (`item_id`),
  KEY `from_location_id` (`from_location_id`),
  KEY `to_location_id` (`to_location_id`),
  KEY `from_team_season_id` (`from_team_season_id`),
  KEY `to_team_season_id` (`to_team_season_id`),
  KEY `actor_id` (`actor_id`),
  CONSTRAINT `inv_movements_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `inv_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inv_movements_ibfk_2` FOREIGN KEY (`from_location_id`) REFERENCES `inv_locations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_movements_ibfk_3` FOREIGN KEY (`to_location_id`) REFERENCES `inv_locations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_movements_ibfk_4` FOREIGN KEY (`from_team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_movements_ibfk_5` FOREIGN KEY (`to_team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_movements_ibfk_6` FOREIGN KEY (`actor_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=73 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_purchase_orders`
--

DROP TABLE IF EXISTS `inv_purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_purchase_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `po_number` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `vendor_id` int DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payment_method` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `invoice_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shipping` decimal(12,2) DEFAULT NULL,
  `tax` decimal(12,2) DEFAULT NULL,
  `order_date` date DEFAULT NULL,
  `order_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `confirmation_number` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shipment_address` text COLLATE utf8mb4_general_ci,
  `expected_delivery_date` date DEFAULT NULL,
  `tracking_number` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `po_number` (`po_number`),
  KEY `vendor_id` (`vendor_id`),
  KEY `created_by_id` (`created_by_id`),
  CONSTRAINT `inv_purchase_orders_ibfk_1` FOREIGN KEY (`vendor_id`) REFERENCES `inv_vendors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inv_purchase_orders_ibfk_2` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inv_vendors`
--

DROP TABLE IF EXISTS `inv_vendors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inv_vendors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `contact_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contact_email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contact_phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `account_number` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `login_attempts`
--

DROP TABLE IF EXISTS `login_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_attempts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `ip_address` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `user_agent` varchar(400) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `country` varchar(8) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `success` tinyint(1) DEFAULT NULL,
  `reason` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1094 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mailing_list_subscribers`
--

DROP TABLE IF EXISTS `mailing_list_subscribers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mailing_list_subscribers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `first_name` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_name` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(190) COLLATE utf8mb4_general_ci NOT NULL,
  `phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `interests` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `notes` text COLLATE utf8mb4_general_ci,
  `source` varchar(40) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'volunteer_form',
  `member_id` int DEFAULT NULL,
  `unsubscribed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mls_email` (`email`),
  KEY `idx_mls_member` (`member_id`),
  CONSTRAINT `mailing_list_subscribers_chk_1` CHECK (json_valid(`interests`))
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `meeting_action_item_assignees`
--

DROP TABLE IF EXISTS `meeting_action_item_assignees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_action_item_assignees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `action_item_id` int NOT NULL,
  `member_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_action_member` (`action_item_id`,`member_id`),
  KEY `idx_aia_member` (`member_id`),
  CONSTRAINT `fk_aia_action` FOREIGN KEY (`action_item_id`) REFERENCES `meeting_action_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aia_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `meeting_action_items`
--

DROP TABLE IF EXISTS `meeting_action_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_action_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `description` varchar(500) NOT NULL,
  `assignee_member_id` int DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'open',
  `task_id` int DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_action_meeting` (`meeting_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `meeting_attendees`
--

DROP TABLE IF EXISTS `meeting_attendees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meeting_attendees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meeting_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `name` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_meeting_att` (`meeting_id`)
) ENGINE=InnoDB AUTO_INCREMENT=77 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `meetings`
--

DROP TABLE IF EXISTS `meetings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `meetings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_label` varchar(60) NOT NULL DEFAULT 'YLC',
  `event_id` int DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `agenda` mediumtext,
  `meeting_date` date DEFAULT NULL,
  `location` varchar(200) DEFAULT NULL,
  `notes` mediumtext,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `locked_at` datetime DEFAULT NULL,
  `locked_by_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_meetings_group` (`group_label`,`meeting_date`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_annual_tc`
--

DROP TABLE IF EXISTS `member_annual_tc`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_annual_tc` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `signed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `signed_by_id` int DEFAULT NULL,
  `parent_signed_at` datetime DEFAULT NULL,
  `parent_signed_by_id` int DEFAULT NULL,
  `waiver_liability_agreed` tinyint(1) NOT NULL DEFAULT '0',
  `waiver_firstaid_agreed` tinyint(1) NOT NULL DEFAULT '0',
  `waiver_privacy_agreed` tinyint(1) NOT NULL DEFAULT '0',
  `media_release_granted` tinyint(1) DEFAULT NULL,
  `waivers_agreed_at` datetime DEFAULT NULL,
  `waivers_agreed_by_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_annual_tc` (`member_id`,`enrollment_year`),
  KEY `signed_by_id` (`signed_by_id`),
  CONSTRAINT `member_annual_tc_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `member_annual_tc_ibfk_2` FOREIGN KEY (`signed_by_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=152 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_backup_codes`
--

DROP TABLE IF EXISTS `member_backup_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_backup_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `code_hash` varchar(255) NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_backup_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_certifications`
--

DROP TABLE IF EXISTS `member_certifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_certifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `certification_id` int NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `completed_date` date DEFAULT NULL,
  `awarded_by_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_cert` (`member_id`,`certification_id`),
  KEY `certification_id` (`certification_id`),
  KEY `awarded_by_id` (`awarded_by_id`),
  CONSTRAINT `member_certifications_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `member_certifications_ibfk_2` FOREIGN KEY (`certification_id`) REFERENCES `certifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `member_certifications_ibfk_3` FOREIGN KEY (`awarded_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=220 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_comm_preferences`
--

DROP TABLE IF EXISTS `member_comm_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_comm_preferences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `preference_type` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `opted_in` tinyint(1) DEFAULT '1',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_comm_pref` (`member_id`,`preference_type`),
  CONSTRAINT `fk_mcp_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_consent_agreements`
--

DROP TABLE IF EXISTS `member_consent_agreements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_consent_agreements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `section_key` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `audience` varchar(16) COLLATE utf8mb4_general_ci NOT NULL,
  `response` varchar(16) COLLATE utf8mb4_general_ci NOT NULL,
  `section_title` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `section_text` mediumtext COLLATE utf8mb4_general_ci NOT NULL,
  `agreed_at` datetime NOT NULL,
  `agreed_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_consent` (`member_id`,`enrollment_year`,`section_key`,`audience`),
  KEY `idx_consent_member_year` (`member_id`,`enrollment_year`),
  KEY `idx_consent_section` (`section_key`,`enrollment_year`)
) ENGINE=InnoDB AUTO_INCREMENT=199 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_group_members`
--

DROP TABLE IF EXISTS `member_group_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_group_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `member_id` int NOT NULL,
  `role_label` varchar(50) DEFAULT NULL,
  `added_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_group_member` (`group_id`,`member_id`),
  KEY `idx_gm_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_groups`
--

DROP TABLE IF EXISTS `member_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `is_private` tinyint(1) NOT NULL DEFAULT '0',
  `public_view` tinyint(1) NOT NULL DEFAULT '0',
  `position_options` text,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  `source` varchar(20) NOT NULL DEFAULT 'manual',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_group_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_medical`
--

DROP TABLE IF EXISTS `member_medical`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_medical` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `contact_address` varchar(200) DEFAULT NULL,
  `contact_city_state` varchar(200) DEFAULT NULL,
  `contact_zip` varchar(10) DEFAULT NULL,
  `guardian1_name` varchar(200) DEFAULT NULL,
  `guardian1_phone` varchar(30) DEFAULT NULL,
  `guardian2_name` varchar(200) DEFAULT NULL,
  `guardian2_phone` varchar(30) DEFAULT NULL,
  `alt_contact_name` varchar(200) DEFAULT NULL,
  `alt_contact_relationship` varchar(120) DEFAULT NULL,
  `alt_contact_phone` varchar(30) DEFAULT NULL,
  `ins_company` varchar(200) DEFAULT NULL,
  `ins_member_phone` varchar(30) DEFAULT NULL,
  `ins_policy` varchar(100) DEFAULT NULL,
  `ins_group` varchar(100) DEFAULT NULL,
  `otc_permission` enum('give','decline') DEFAULT NULL,
  `health_problems` text,
  `food_allergies` text,
  `environmental_allergies` text,
  `medication_allergies` text,
  `medications_current` text,
  `notes` text,
  `accommodations` text,
  `self_administer` tinyint(1) DEFAULT NULL,
  `treatment_authorized` tinyint(1) NOT NULL DEFAULT '0',
  `coverage_start` date DEFAULT NULL,
  `coverage_end` date DEFAULT NULL,
  `signed_name` varchar(200) DEFAULT NULL,
  `signed_at` datetime DEFAULT NULL,
  `signed_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_year` (`member_id`,`enrollment_year`),
  KEY `idx_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_onboarding_tasks`
--

DROP TABLE IF EXISTS `member_onboarding_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_onboarding_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `category` varchar(20) NOT NULL DEFAULT 'onboarding',
  `title` varchar(200) DEFAULT NULL,
  `description` text,
  `item_key` varchar(64) NOT NULL,
  `assigned_by_id` int DEFAULT NULL,
  `assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `due_date` date DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `completed_by_id` int DEFAULT NULL,
  `notes` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_item` (`member_id`,`item_key`),
  KEY `idx_open` (`member_id`,`completed_at`),
  KEY `idx_item` (`item_key`),
  KEY `idx_member_category` (`member_id`,`category`,`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_program_support`
--

DROP TABLE IF EXISTS `member_program_support`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_program_support` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `program_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_member_program` (`member_id`,`program_id`),
  KEY `idx_mps_member` (`member_id`),
  KEY `idx_mps_program` (`program_id`)
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_reflections`
--

DROP TABLE IF EXISTS `member_reflections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_reflections` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `question_key` varchar(60) NOT NULL,
  `answer` text,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_year_q` (`member_id`,`enrollment_year`,`question_key`),
  KEY `idx_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_season_participation`
--

DROP TABLE IF EXISTS `member_season_participation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_season_participation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `season_id` int NOT NULL,
  `participated_fll_explore` tinyint(1) DEFAULT NULL,
  `participated_fll_challenge` tinyint(1) DEFAULT NULL,
  `participated_ftc` tinyint(1) DEFAULT NULL,
  `participated_frc` tinyint(1) DEFAULT NULL,
  `participated_fdp` tinyint(1) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `member_id` (`member_id`),
  KEY `season_id` (`season_id`),
  CONSTRAINT `member_season_participation_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `member_season_participation_ibfk_2` FOREIGN KEY (`season_id`) REFERENCES `first_seasons` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=216 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `member_system_roles`
--

DROP TABLE IF EXISTS `member_system_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_system_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `role_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `member_id` (`member_id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `member_system_roles_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `member_system_roles_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `system_roles` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=711 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `members`
--

DROP TABLE IF EXISTS `members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_number` varchar(5) COLLATE utf8mb4_general_ci NOT NULL,
  `username` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `totp_secret` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `totp_pending_secret` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `totp_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `totp_last_step` bigint DEFAULT NULL,
  `totp_enrolled_at` datetime DEFAULT NULL,
  `member_type` enum('youth','mentor','parent','volunteer') COLLATE utf8mb4_general_ci NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `middle_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `birthday` date DEFAULT NULL,
  `graduation_year` int DEFAULT NULL,
  `date_joined` date DEFAULT NULL,
  `photo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `school` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `shirt_size` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `robotics_experience_years` int DEFAULT NULL,
  `employer_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `employer_job_title` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `employer_matches_donations` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `employer_volunteer_grants` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `employer_offers_grants` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `employer_program_info` text COLLATE utf8mb4_general_ci,
  `employer_matching_help` tinyint(1) NOT NULL DEFAULT '0',
  `employer_notes` text COLLATE utf8mb4_general_ci,
  `special_notes` text COLLATE utf8mb4_general_ci,
  `sex` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `race` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `free_reduced_lunch_eligible` tinyint(1) DEFAULT NULL,
  `address_line1` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `address_line2` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `city` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `state` varchar(2) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `zip_code` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency_contact_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency_contact_phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency_contact_relationship` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency_contact2_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency_contact2_phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `emergency_contact2_relationship` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian1_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian1_phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian1_email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian2_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian2_phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian2_email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `youth_tc_agreed` tinyint(1) DEFAULT NULL,
  `youth_tc_date` datetime DEFAULT NULL,
  `parent_tc_agreed` tinyint(1) DEFAULT NULL,
  `parent_tc_date` datetime DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `force_password_change` tinyint(1) DEFAULT NULL,
  `is_compliance_exempt` tinyint(1) DEFAULT NULL,
  `is_junior_mentor` tinyint(1) DEFAULT NULL,
  `is_kiosk` tinyint(1) DEFAULT NULL,
  `is_system` tinyint(1) DEFAULT NULL,
  `ui_preferences` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `is_archived` tinyint(1) DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  `archived_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `alt_email1` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `alt_email1_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `alt_email2` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `alt_email2_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `is_alumni` tinyint(1) NOT NULL DEFAULT '0',
  `calendar_token` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `requires_ypt` tinyint(1) NOT NULL DEFAULT '0',
  `token_version` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_number` (`member_number`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `members_calendar_token_unique` (`calendar_token`),
  KEY `archived_by_id` (`archived_by_id`),
  CONSTRAINT `members_ibfk_1` FOREIGN KEY (`archived_by_id`) REFERENCES `members` (`id`),
  CONSTRAINT `members_chk_1` CHECK (json_valid(`ui_preferences`))
) ENGINE=InnoDB AUTO_INCREMENT=346 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_compliance_records`
--

DROP TABLE IF EXISTS `mentor_compliance_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_compliance_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `compliance_type` varchar(30) COLLATE utf8mb4_general_ci NOT NULL,
  `enrollment_year` int NOT NULL,
  `completed_date` date NOT NULL,
  `expires_date` date NOT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_by_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `member_id` (`member_id`),
  KEY `created_by_id` (`created_by_id`),
  CONSTRAINT `mentor_compliance_records_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`),
  CONSTRAINT `mentor_compliance_records_ibfk_2` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=138 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_prospects`
--

DROP TABLE IF EXISTS `mentor_prospects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_prospects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `kind` enum('mentor','volunteer') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'mentor',
  `email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `source` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `stage` enum('interested','contacted','onboarding','active','declined') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'interested',
  `ypt_done` tinyint(1) NOT NULL DEFAULT '0',
  `background_done` tinyint(1) NOT NULL DEFAULT '0',
  `tc_done` tinyint(1) NOT NULL DEFAULT '0',
  `orientation_done` tinyint(1) NOT NULL DEFAULT '0',
  `owner_id` int DEFAULT NULL,
  `from_visitor_id` int DEFAULT NULL,
  `converted_member_id` int DEFAULT NULL,
  `sponsor_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mp_stage` (`stage`),
  KEY `fk_mp_visitor` (`from_visitor_id`),
  KEY `fk_mp_member` (`converted_member_id`),
  KEY `fk_mp_sponsor` (`sponsor_id`),
  CONSTRAINT `fk_mp_member` FOREIGN KEY (`converted_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mp_sponsor` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mp_visitor` FOREIGN KEY (`from_visitor_id`) REFERENCES `visitors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `mentor_unavailability`
--

DROP TABLE IF EXISTS `mentor_unavailability`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentor_unavailability` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `note` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mu_member` (`member_id`),
  KEY `idx_mu_range` (`start_date`,`end_date`),
  CONSTRAINT `fk_mu_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `metric_snapshots`
--

DROP TABLE IF EXISTS `metric_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `metric_snapshots` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `metric_key` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `period_type` enum('day','week','month','quarter','year') COLLATE utf8mb4_general_ci NOT NULL,
  `period_key` varchar(16) COLLATE utf8mb4_general_ci NOT NULL,
  `period_start` date NOT NULL,
  `scope_type` varchar(32) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'global',
  `scope_id` varchar(64) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `value` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `captured_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_metric_period_scope` (`metric_key`,`period_type`,`period_key`,`scope_type`,`scope_id`),
  KEY `idx_ms_metric_start` (`metric_key`,`period_start`),
  KEY `idx_ms_scope` (`scope_type`,`scope_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1876 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `night_preferences`
--

DROP TABLE IF EXISTS `night_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `night_preferences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int DEFAULT NULL,
  `visitor_id` int DEFAULT NULL,
  `program_id` int NOT NULL,
  `season` varchar(10) NOT NULL,
  `available_night_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `preferred_night_id` int DEFAULT NULL,
  `flexible` tinyint(1) NOT NULL DEFAULT '0',
  `siblings_together` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(20) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_np_member` (`member_id`,`program_id`,`season`),
  UNIQUE KEY `uq_np_visitor` (`visitor_id`,`program_id`,`season`),
  KEY `idx_np_program_season` (`program_id`,`season`),
  CONSTRAINT `night_preferences_chk_1` CHECK (json_valid(`available_night_ids`))
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `password_reset_tokens`
--

DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `token_hash` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prt_token` (`token_hash`),
  KEY `ix_prt_member` (`member_id`),
  CONSTRAINT `fk_prt_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=99 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payment_enrollments`
--

DROP TABLE IF EXISTS `payment_enrollments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_enrollments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `payment_id` int NOT NULL,
  `enrollment_id` int NOT NULL,
  `base_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_pe_payment` (`payment_id`),
  KEY `idx_pe_enrollment` (`enrollment_id`)
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provider` varchar(20) NOT NULL,
  `source_type` varchar(40) NOT NULL,
  `source_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `base_amount` decimal(10,2) DEFAULT NULL,
  `donation_amount` decimal(10,2) DEFAULT NULL,
  `fee_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `fee_covered` tinyint(1) NOT NULL DEFAULT '0',
  `currency` varchar(3) NOT NULL DEFAULT 'USD',
  `status` varchar(20) NOT NULL DEFAULT 'created',
  `provider_ref` varchar(120) DEFAULT NULL,
  `provider_txn_id` varchar(120) DEFAULT NULL,
  `payer_email` varchar(200) DEFAULT NULL,
  `error_detail` varchar(400) DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payments_source` (`source_type`,`source_id`),
  KEY `idx_payments_provider_ref` (`provider`,`provider_ref`),
  KEY `idx_payments_txn` (`provider`,`provider_txn_id`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `plan_night_teams`
--

DROP TABLE IF EXISTS `plan_night_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plan_night_teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `season` varchar(9) COLLATE utf8mb4_general_ci NOT NULL,
  `program_id` int NOT NULL,
  `night_id` int NOT NULL,
  `label` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `based_on_team_id` int DEFAULT NULL,
  `is_holding` tinyint(1) NOT NULL DEFAULT '0',
  `display_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_plan_team` (`season`,`program_id`,`night_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `plan_placements`
--

DROP TABLE IF EXISTS `plan_placements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plan_placements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `plan_night_team_id` int NOT NULL,
  `member_id` int NOT NULL,
  `role` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'youth',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_placement` (`plan_night_team_id`,`member_id`),
  KEY `idx_placement_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portfolio_captures`
--

DROP TABLE IF EXISTS `portfolio_captures`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portfolio_captures` (
  `id` int NOT NULL AUTO_INCREMENT,
  `portfolio_id` int NOT NULL,
  `piece_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `capture_type` enum('design_decision','test_result','outreach_event','photo','reflection','metric','quote') NOT NULL DEFAULT 'reflection',
  `title` varchar(255) DEFAULT NULL,
  `body` text,
  `occurred_on` date DEFAULT NULL,
  `evidence_id` int DEFAULT NULL,
  `file_id` int DEFAULT NULL,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_portfolio` (`portfolio_id`),
  KEY `idx_piece` (`piece_id`),
  CONSTRAINT `portfolio_captures_chk_1` CHECK (json_valid(`tags`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `portfolio_pieces`
--

DROP TABLE IF EXISTS `portfolio_pieces`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `portfolio_pieces` (
  `id` int NOT NULL AUTO_INCREMENT,
  `portfolio_id` int NOT NULL,
  `section_type` enum('team_background','sustainability','engineering_process','robot_design','outreach_impact','awards_narrative','custom') NOT NULL DEFAULT 'custom',
  `title` varchar(255) NOT NULL,
  `description` text,
  `owner_member_id` int DEFAULT NULL,
  `status` enum('not_started','in_progress','review','done') NOT NULL DEFAULT 'not_started',
  `due_date` date DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `resource_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_portfolio` (`portfolio_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `program_nights`
--

DROP TABLE IF EXISTS `program_nights`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `program_nights` (
  `id` int NOT NULL AUTO_INCREMENT,
  `program_id` int NOT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(60) COLLATE utf8mb4_general_ci NOT NULL,
  `capacity` int NOT NULL DEFAULT '0',
  `max_teams` int DEFAULT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pn_prog_season` (`program_id`,`season`),
  CONSTRAINT `fk_pn_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `programs`
--

DROP TABLE IF EXISTS `programs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `programs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `full_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `affiliation` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `age_range` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `display_order` int DEFAULT NULL,
  `quick_attendance` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `raffle_orders`
--

DROP TABLE IF EXISTS `raffle_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `raffle_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `raffle_id` int NOT NULL,
  `buyer_name` varchar(200) NOT NULL,
  `buyer_email` varchar(200) DEFAULT NULL,
  `buyer_phone` varchar(40) DEFAULT NULL,
  `interested_program` tinyint(1) NOT NULL DEFAULT '0',
  `interested_volunteer` tinyint(1) NOT NULL DEFAULT '0',
  `interested_sponsor` tinyint(1) NOT NULL DEFAULT '0',
  `stay_in_touch` tinyint(1) NOT NULL DEFAULT '1',
  `quantity` int NOT NULL DEFAULT '1',
  `unit_price` decimal(10,2) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `sale_channel` varchar(20) NOT NULL DEFAULT 'online',
  `payment_status` varchar(20) NOT NULL DEFAULT 'pending',
  `payment_method` varchar(20) DEFAULT NULL,
  `payment_id` int DEFAULT NULL,
  `recorded_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` datetime DEFAULT NULL,
  `routed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_raffle_orders_raffle` (`raffle_id`),
  KEY `idx_raffle_orders_status` (`payment_status`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `raffle_tickets`
--

DROP TABLE IF EXISTS `raffle_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `raffle_tickets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `raffle_id` int NOT NULL,
  `order_id` int NOT NULL,
  `ticket_number` int NOT NULL,
  `is_winner` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_raffle_ticket_number` (`raffle_id`,`ticket_number`),
  KEY `idx_raffle_tickets_order` (`order_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `raffles`
--

DROP TABLE IF EXISTS `raffles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `raffles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL,
  `prize_description` text,
  `ticket_price` decimal(10,2) NOT NULL DEFAULT '5.00',
  `fine_print` text,
  `sales_open_at` datetime DEFAULT NULL,
  `sales_close_at` datetime DEFAULT NULL,
  `draw_date` datetime DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'draft',
  `public_slug` varchar(40) NOT NULL,
  `event_id` int DEFAULT NULL,
  `winner_ticket_id` int DEFAULT NULL,
  `winner_drawn_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_raffles_slug` (`public_slug`),
  KEY `idx_raffles_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `rate_limit_hits`
--

DROP TABLE IF EXISTS `rate_limit_hits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rate_limit_hits` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `bucket` varchar(40) NOT NULL,
  `ip_hash` char(64) NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rlh_lookup` (`bucket`,`ip_hash`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `readiness_criteria`
--

DROP TABLE IF EXISTS `readiness_criteria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `readiness_criteria` (
  `id` int NOT NULL AUTO_INCREMENT,
  `crit_key` varchar(40) NOT NULL,
  `label` varchar(120) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `weight` int NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_key` (`crit_key`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repair_correspondence`
--

DROP TABLE IF EXISTS `repair_correspondence`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repair_correspondence` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `direction` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'outgoing',
  `channel` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'email',
  `contact_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `vendor_id` int DEFAULT NULL,
  `subject` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `reference` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `corresponded_on` date DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rc_ticket` (`ticket_id`),
  KEY `idx_rc_vendor` (`vendor_id`),
  KEY `fk_rc_member` (`member_id`),
  CONSTRAINT `fk_rc_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rc_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rc_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `inv_vendors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repair_parts`
--

DROP TABLE IF EXISTS `repair_parts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repair_parts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `inv_item_id` int DEFAULT NULL,
  `part_name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '1.00',
  `unit_cost` decimal(10,2) DEFAULT NULL,
  `notes` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rp_ticket` (`ticket_id`),
  KEY `fk_rp_item` (`inv_item_id`),
  CONSTRAINT `fk_rp_item` FOREIGN KEY (`inv_item_id`) REFERENCES `inv_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rp_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repair_tickets`
--

DROP TABLE IF EXISTS `repair_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repair_tickets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `equipment_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `inv_item_id` int DEFAULT NULL,
  `kind` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'repair',
  `status` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `priority` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'normal',
  `location_id` int DEFAULT NULL,
  `reported_by_id` int DEFAULT NULL,
  `reported_date` date DEFAULT NULL,
  `assigned_to_id` int DEFAULT NULL,
  `completed_date` date DEFAULT NULL,
  `resolution` text COLLATE utf8mb4_general_ci,
  `repair_cost` decimal(10,2) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_repair_status` (`status`),
  KEY `idx_repair_assigned` (`assigned_to_id`),
  KEY `idx_repair_item` (`inv_item_id`),
  KEY `fk_repair_reporter` (`reported_by_id`),
  CONSTRAINT `fk_repair_assignee` FOREIGN KEY (`assigned_to_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_repair_item` FOREIGN KEY (`inv_item_id`) REFERENCES `inv_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_repair_reporter` FOREIGN KEY (`reported_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `repair_updates`
--

DROP TABLE IF EXISTS `repair_updates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `repair_updates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `old_status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `new_status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rupd_ticket` (`ticket_id`),
  KEY `fk_rupd_member` (`member_id`),
  CONSTRAINT `fk_rupd_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rupd_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `repair_tickets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `report_definitions`
--

DROP TABLE IF EXISTS `report_definitions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_definitions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `dataset` varchar(60) COLLATE utf8mb4_general_ci NOT NULL,
  `definition` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `folder_id` int DEFAULT NULL,
  `owner_id` int DEFAULT NULL,
  `visibility` enum('private','roles','org') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'private',
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rd_owner` (`owner_id`),
  KEY `idx_rd_folder` (`folder_id`),
  KEY `idx_rd_dataset` (`dataset`),
  CONSTRAINT `report_definitions_chk_1` CHECK (json_valid(`definition`))
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `report_folders`
--

DROP TABLE IF EXISTS `report_folders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_folders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(160) COLLATE utf8mb4_general_ci NOT NULL,
  `parent_id` int DEFAULT NULL,
  `owner_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `report_permissions`
--

DROP TABLE IF EXISTS `report_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `dataset` varchar(60) COLLATE utf8mb4_general_ci NOT NULL,
  `capability` enum('run','build_scoped','build_full','publish','manage') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'run',
  `row_scope` enum('all','own_teams','self','none') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'own_teams',
  `max_field_tier` enum('public','internal','pii','financial') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'internal',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_dataset` (`role_name`,`dataset`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `report_runs`
--

DROP TABLE IF EXISTS `report_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_runs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `definition_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `dataset` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `format` varchar(10) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'screen',
  `row_count` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rr_def` (`definition_id`),
  KEY `idx_rr_member` (`member_id`),
  KEY `idx_rr_time` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=94 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `report_schedules`
--

DROP TABLE IF EXISTS `report_schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `report_schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `definition_id` int NOT NULL,
  `owner_id` int DEFAULT NULL,
  `cadence` enum('daily','weekly','monthly') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'weekly',
  `day_of_week` tinyint DEFAULT NULL,
  `day_of_month` tinyint DEFAULT NULL,
  `send_hour` tinyint NOT NULL DEFAULT '6',
  `recipient_emails` text COLLATE utf8mb4_general_ci NOT NULL,
  `team_season_id` int DEFAULT NULL,
  `params` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_run_at` datetime DEFAULT NULL,
  `next_run_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rs_due` (`is_active`,`next_run_at`),
  KEY `idx_rs_def` (`definition_id`),
  CONSTRAINT `fk_rs_def` FOREIGN KEY (`definition_id`) REFERENCES `report_definitions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `report_schedules_chk_1` CHECK (json_valid(`params`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reservation_resources`
--

DROP TABLE IF EXISTS `reservation_resources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reservation_resources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_general_ci NOT NULL,
  `kind` enum('room','equipment') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'room',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `is_hidden` tinyint(1) NOT NULL DEFAULT '0',
  `display_order` int NOT NULL DEFAULT '0',
  `notes` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reservations`
--

DROP TABLE IF EXISTS `reservations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reservations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `resource_id` int NOT NULL,
  `member_id` int NOT NULL,
  `purpose` enum('personal','trc','team') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'personal',
  `team_season_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `usage_details` text COLLATE utf8mb4_general_ci,
  `special_considerations` text COLLATE utf8mb4_general_ci,
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `status` enum('pending','approved','denied','cancelled') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `reviewed_by_id` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_note` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_resv_range` (`resource_id`,`start_at`,`end_at`,`status`),
  KEY `idx_resv_event` (`event_id`),
  CONSTRAINT `fk_resv_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_resv_resource` FOREIGN KEY (`resource_id`) REFERENCES `reservation_resources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resource_access`
--

DROP TABLE IF EXISTS `resource_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resource_access` (
  `id` int NOT NULL AUTO_INCREMENT,
  `resource_id` int NOT NULL,
  `member_id` int NOT NULL,
  `status` varchar(12) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `requested_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `granted_at` datetime DEFAULT NULL,
  `granted_by_member_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resource_member` (`resource_id`,`member_id`),
  KEY `member_id` (`member_id`),
  KEY `granted_by_member_id` (`granted_by_member_id`),
  CONSTRAINT `resource_access_ibfk_1` FOREIGN KEY (`resource_id`) REFERENCES `resources` (`id`) ON DELETE CASCADE,
  CONSTRAINT `resource_access_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `resource_access_ibfk_3` FOREIGN KEY (`granted_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resource_types`
--

DROP TABLE IF EXISTS `resource_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resource_types` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `icon` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `attributes` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `sort_order` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `resource_types_chk_1` CHECK (json_valid(`attributes`))
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resources`
--

DROP TABLE IF EXISTS `resources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `resource_type_id` int DEFAULT NULL,
  `scope` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `team_season_id` int DEFAULT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `notes` text COLLATE utf8mb4_general_ci,
  `resets_each_season` tinyint(1) DEFAULT NULL,
  `needs_update` tinyint(1) DEFAULT NULL,
  `sort_order` int DEFAULT NULL,
  `is_archived` tinyint(1) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `resource_type_id` (`resource_type_id`),
  KEY `team_season_id` (`team_season_id`),
  CONSTRAINT `resources_ibfk_1` FOREIGN KEY (`resource_type_id`) REFERENCES `resource_types` (`id`) ON DELETE SET NULL,
  CONSTRAINT `resources_ibfk_2` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `resources_chk_1` CHECK (json_valid(`values`))
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_answers`
--

DROP TABLE IF EXISTS `resume_answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_answers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `answers` longtext,
  `show_contact` tinyint(1) NOT NULL DEFAULT '0',
  `uploaded_url` varchar(500) DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resume_member` (`member_id`),
  CONSTRAINT `fk_resume_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role_permissions`
--

DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_id` int NOT NULL,
  `resource_key` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `level` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `role_permissions_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `system_roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12563 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schema_migrations`
--

DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(190) COLLATE utf8mb4_general_ci NOT NULL,
  `applied_at` datetime NOT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scholarship_applications`
--

DROP TABLE IF EXISTS `scholarship_applications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scholarship_applications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `enrollment_year` int DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `submitted_by_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `contact_email` varchar(200) DEFAULT NULL,
  `contact_name` varchar(200) DEFAULT NULL,
  `contact_phone` varchar(50) DEFAULT NULL,
  `program` varchar(20) DEFAULT NULL,
  `program_other` varchar(120) DEFAULT NULL,
  `youth_name` varchar(200) DEFAULT NULL,
  `youth_grade_school` varchar(300) DEFAULT NULL,
  `choose_one` varchar(300) DEFAULT NULL,
  `household_size` int DEFAULT NULL,
  `youth_count` int DEFAULT NULL,
  `frl_eligible` varchar(10) DEFAULT NULL,
  `certified` tinyint(1) NOT NULL DEFAULT '0',
  `registration_cost` decimal(10,2) DEFAULT NULL,
  `contribution_amount` decimal(10,2) DEFAULT NULL,
  `amount_requested` decimal(10,2) DEFAULT NULL,
  `received_before` tinyint(1) DEFAULT NULL,
  `narrative` text,
  `need_explanation` text,
  `referral` text,
  `optional_info` text,
  `answers` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `reviewer_id` int DEFAULT NULL,
  `review_notes` text,
  `decision_amount` decimal(10,2) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sch_app_status` (`status`),
  KEY `idx_sch_app_member` (`member_id`),
  KEY `idx_sch_app_year` (`enrollment_year`),
  CONSTRAINT `scholarship_applications_chk_1` CHECK (json_valid(`answers`))
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scholarship_awards`
--

DROP TABLE IF EXISTS `scholarship_awards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scholarship_awards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `application_id` int DEFAULT NULL,
  `fund_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `enrollment_id` int DEFAULT NULL,
  `enrollment_year` int DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `note` varchar(300) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'applied',
  `awarded_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reversed_at` datetime DEFAULT NULL,
  `clawed_back_at` datetime DEFAULT NULL,
  `clawed_back_by_id` int DEFAULT NULL,
  `clawback_note` varchar(300) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sch_award_fund` (`fund_id`,`status`),
  KEY `idx_sch_award_app` (`application_id`),
  KEY `idx_sch_award_member` (`member_id`),
  KEY `idx_awards_fund_year` (`fund_id`,`enrollment_year`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scholarship_fund_allocations`
--

DROP TABLE IF EXISTS `scholarship_fund_allocations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scholarship_fund_allocations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fund_id` int NOT NULL,
  `enrollment_year` int NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `source` varchar(40) NOT NULL DEFAULT 'general_fund',
  `note` varchar(300) DEFAULT NULL,
  `allocated_by_id` int DEFAULT NULL,
  `allocated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fund_year` (`fund_id`,`enrollment_year`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scholarship_funds`
--

DROP TABLE IF EXISTS `scholarship_funds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scholarship_funds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(160) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `school_contacts`
--

DROP TABLE IF EXISTS `school_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_contacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `school_id` int NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `title` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sc_school` (`school_id`),
  CONSTRAINT `fk_sc_school` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `school_engagements`
--

DROP TABLE IF EXISTS `school_engagements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_engagements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `school_id` int NOT NULL,
  `engaged_on` date DEFAULT NULL,
  `type` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `outcome` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_se_school` (`school_id`),
  CONSTRAINT `fk_se_school` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `school_payments`
--

DROP TABLE IF EXISTS `school_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `school_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `school_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `enrollment_id` int DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pledged',
  `note` varchar(300) DEFAULT NULL,
  `invoiced_at` datetime DEFAULT NULL,
  `paid_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reversed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_school_pay_school` (`school_id`,`status`),
  KEY `idx_school_pay_enrollment` (`enrollment_id`),
  KEY `idx_school_pay_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schools`
--

DROP TABLE IF EXISTS `schools`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `type` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `district` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `address` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_event_alliances`
--

DROP TABLE IF EXISTS `scout_event_alliances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_event_alliances` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `scout_event_id` int unsigned NOT NULL,
  `alliance_number` tinyint unsigned NOT NULL,
  `captain` int unsigned NOT NULL,
  `pick1` int unsigned DEFAULT NULL,
  `pick2` int unsigned DEFAULT NULL,
  `fetched_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_alliance` (`scout_event_id`,`alliance_number`),
  KEY `idx_event` (`scout_event_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3569 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_event_teams`
--

DROP TABLE IF EXISTS `scout_event_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_event_teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scout_event_id` int NOT NULL,
  `team_number` int NOT NULL,
  `team_name` varchar(160) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `pit_priority` tinyint(1) NOT NULL DEFAULT '0',
  `match_priority` tinyint(1) NOT NULL DEFAULT '0',
  `watchlist` tinyint(1) NOT NULL DEFAULT '0',
  `watch_column` varchar(8) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `watch_rank` int DEFAULT NULL,
  `did_not_show` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_event_team` (`scout_event_id`,`team_number`),
  CONSTRAINT `scout_event_teams_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1711 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_events`
--

DROP TABLE IF EXISTS `scout_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scout_season_id` int NOT NULL,
  `event_code` varchar(40) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `division_code` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `city` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `state` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `source` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'ftcscout',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `schedule_synced_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `is_training` tinyint(1) NOT NULL DEFAULT '0',
  `our_team_number` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_event` (`scout_season_id`,`event_code`),
  CONSTRAINT `scout_events_ibfk_1` FOREIGN KEY (`scout_season_id`) REFERENCES `scout_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_live_stats`
--

DROP TABLE IF EXISTS `scout_live_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_live_stats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scout_event_id` int NOT NULL,
  `team_number` int NOT NULL,
  `opr_total` decimal(8,3) DEFAULT NULL,
  `rank` int DEFAULT NULL,
  `qual_matches_played` int DEFAULT NULL,
  `stats` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `fetched_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_live` (`scout_event_id`,`team_number`),
  CONSTRAINT `scout_live_stats_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scout_live_stats_chk_1` CHECK (json_valid(`stats`))
) ENGINE=InnoDB AUTO_INCREMENT=24859 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_match_records`
--

DROP TABLE IF EXISTS `scout_match_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_match_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_uuid` char(36) COLLATE utf8mb4_general_ci NOT NULL,
  `scout_event_id` int NOT NULL,
  `match_num` int NOT NULL,
  `tournament_level` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Quals',
  `scouted_team_number` int NOT NULL,
  `alliance` varchar(8) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `scouter_member_id` int DEFAULT NULL,
  `scouter_name` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `showed_up` tinyint(1) NOT NULL DEFAULT '1',
  `whole_match` tinyint(1) NOT NULL DEFAULT '1',
  `confidence` varchar(12) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `is_ignored` tinyint(1) NOT NULL DEFAULT '0',
  `device_id` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `client_ts` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_match_uuid` (`client_uuid`),
  KEY `idx_mr_event_match` (`scout_event_id`,`tournament_level`,`match_num`),
  KEY `idx_mr_team` (`scout_event_id`,`scouted_team_number`),
  KEY `scout_match_records_ibfk_2` (`scouter_member_id`),
  CONSTRAINT `scout_match_records_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scout_match_records_ibfk_2` FOREIGN KEY (`scouter_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `scout_match_records_chk_1` CHECK (json_valid(`payload`))
) ENGINE=InnoDB AUTO_INCREMENT=197 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_matches`
--

DROP TABLE IF EXISTS `scout_matches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_matches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scout_event_id` int NOT NULL,
  `match_num` int NOT NULL,
  `tournament_level` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Quals',
  `scheduled_start` datetime DEFAULT NULL,
  `red1` int DEFAULT NULL,
  `red2` int DEFAULT NULL,
  `blue1` int DEFAULT NULL,
  `blue2` int DEFAULT NULL,
  `has_been_played` tinyint(1) NOT NULL DEFAULT '0',
  `fetched_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `red_score` int DEFAULT NULL,
  `blue_score` int DEFAULT NULL,
  `revealed` tinyint(1) NOT NULL DEFAULT '0',
  `surrogates` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_match` (`scout_event_id`,`tournament_level`,`match_num`),
  CONSTRAINT `scout_matches_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=111752 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_observations`
--

DROP TABLE IF EXISTS `scout_observations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_observations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_uuid` char(36) COLLATE utf8mb4_general_ci NOT NULL,
  `scout_event_id` int NOT NULL,
  `team_number` int NOT NULL,
  `match_num` int DEFAULT NULL,
  `scouter_member_id` int DEFAULT NULL,
  `scouter_name` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `observation` text COLLATE utf8mb4_general_ci NOT NULL,
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `is_ignored` tinyint(1) NOT NULL DEFAULT '0',
  `device_id` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `client_ts` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_obs_uuid` (`client_uuid`),
  KEY `idx_obs_event_team` (`scout_event_id`,`team_number`),
  KEY `scout_observations_ibfk_2` (`scouter_member_id`),
  CONSTRAINT `scout_observations_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scout_observations_ibfk_2` FOREIGN KEY (`scouter_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `scout_observations_chk_1` CHECK (json_valid(`tags`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_pit_reports`
--

DROP TABLE IF EXISTS `scout_pit_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_pit_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_uuid` char(36) COLLATE utf8mb4_general_ci NOT NULL,
  `scout_event_id` int NOT NULL,
  `team_number` int NOT NULL,
  `scouter_member_id` int DEFAULT NULL,
  `scouter_name` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `robot_nickname` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `is_ignored` tinyint(1) NOT NULL DEFAULT '0',
  `device_id` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `client_ts` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pit_uuid` (`client_uuid`),
  KEY `idx_pit_event_team` (`scout_event_id`,`team_number`),
  KEY `scout_pit_reports_ibfk_2` (`scouter_member_id`),
  CONSTRAINT `scout_pit_reports_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scout_pit_reports_ibfk_2` FOREIGN KEY (`scouter_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `scout_pit_reports_chk_1` CHECK (json_valid(`payload`))
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_preevent_stats`
--

DROP TABLE IF EXISTS `scout_preevent_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_preevent_stats` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scout_event_id` int NOT NULL,
  `team_number` int NOT NULL,
  `np_opr` decimal(8,3) DEFAULT NULL,
  `stats` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `fetched_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_preevent` (`scout_event_id`,`team_number`),
  CONSTRAINT `scout_preevent_stats_ibfk_1` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scout_preevent_stats_chk_1` CHECK (json_valid(`stats`))
) ENGINE=InnoDB AUTO_INCREMENT=957 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_robot_photos`
--

DROP TABLE IF EXISTS `scout_robot_photos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_robot_photos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scout_event_id` int NOT NULL,
  `team_number` int NOT NULL,
  `file_path` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `is_profile` tinyint(1) NOT NULL DEFAULT '0',
  `uploaded_by_member_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_robot_photo_event_team` (`scout_event_id`,`team_number`),
  KEY `robot_photos_member_fk` (`uploaded_by_member_id`),
  CONSTRAINT `robot_photos_event_fk` FOREIGN KEY (`scout_event_id`) REFERENCES `scout_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `robot_photos_member_fk` FOREIGN KEY (`uploaded_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `scout_seasons`
--

DROP TABLE IF EXISTS `scout_seasons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scout_seasons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `program` varchar(8) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'FTC',
  `season_year` int NOT NULL,
  `code` varchar(40) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `api_stats_type` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_season` (`program`,`season_year`,`code`),
  CONSTRAINT `scout_seasons_chk_1` CHECK (json_valid(`config`))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_activities`
--

DROP TABLE IF EXISTS `season_activities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_activities` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `team_season_id` int NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `start_date` date DEFAULT NULL,
  `duration_days` int DEFAULT NULL,
  `target_date` date DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `percent_complete` tinyint NOT NULL DEFAULT '0',
  `lead_member_id` int DEFAULT NULL,
  `assigned_role_id` int DEFAULT NULL,
  `sort_order` int DEFAULT NULL,
  `estimated_minutes` int DEFAULT NULL,
  `actual_minutes` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `lead_member_id` (`lead_member_id`),
  KEY `fk_sa_role` (`assigned_role_id`),
  CONSTRAINT `fk_sa_role` FOREIGN KEY (`assigned_role_id`) REFERENCES `team_roles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `season_activities_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `season_categories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `season_activities_ibfk_2` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `season_activities_ibfk_3` FOREIGN KEY (`lead_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_activity_assignees`
--

DROP TABLE IF EXISTS `season_activity_assignees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_activity_assignees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activity_id` int NOT NULL,
  `member_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_activity_member` (`activity_id`,`member_id`),
  KEY `member_id` (`member_id`),
  CONSTRAINT `season_activity_assignees_ibfk_1` FOREIGN KEY (`activity_id`) REFERENCES `season_activities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `season_activity_assignees_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_activity_dependencies`
--

DROP TABLE IF EXISTS `season_activity_dependencies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_activity_dependencies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `activity_id` int NOT NULL,
  `depends_on_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_activity_dep` (`activity_id`,`depends_on_id`),
  KEY `depends_on_id` (`depends_on_id`),
  CONSTRAINT `season_activity_dependencies_ibfk_1` FOREIGN KEY (`activity_id`) REFERENCES `season_activities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `season_activity_dependencies_ibfk_2` FOREIGN KEY (`depends_on_id`) REFERENCES `season_activities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_availability`
--

DROP TABLE IF EXISTS `season_availability`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_availability` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `season` varchar(9) COLLATE utf8mb4_general_ci NOT NULL,
  `program_id` int DEFAULT NULL,
  `mentor_willing` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `flexible` tinyint(1) NOT NULL DEFAULT '0',
  `night_prefs` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `siblings_together` tinyint(1) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `submitted_by_id` int DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_avail` (`member_id`,`season`,`program_id`),
  KEY `idx_avail_season` (`season`,`program_id`),
  CONSTRAINT `season_availability_chk_1` CHECK (json_valid(`night_prefs`))
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_categories`
--

DROP TABLE IF EXISTS `season_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `color` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `sort_order` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_season_id` (`team_season_id`),
  CONSTRAINT `season_categories_ibfk_1` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_deadlines`
--

DROP TABLE IF EXISTS `season_deadlines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_deadlines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `deadline_date` date NOT NULL,
  `event_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sd_team` (`team_season_id`),
  KEY `fk_sd_event` (`event_id`),
  CONSTRAINT `fk_sd_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_goal_updates`
--

DROP TABLE IF EXISTS `season_goal_updates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_goal_updates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `goal_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `value` decimal(12,2) DEFAULT NULL,
  `note` text,
  `evidence_id` int DEFAULT NULL,
  `logged_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_goal` (`goal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_goals`
--

DROP TABLE IF EXISTS `season_goals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_goals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `season` varchar(10) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `category` enum('robot','outreach','portfolio','team','fundraising','competition','skills','other') NOT NULL DEFAULT 'other',
  `owner_member_id` int DEFAULT NULL,
  `metric_type` enum('count','currency','percent','hours','milestone') NOT NULL DEFAULT 'count',
  `target_value` decimal(12,2) DEFAULT NULL,
  `current_value` decimal(12,2) NOT NULL DEFAULT '0.00',
  `unit` varchar(40) DEFAULT NULL,
  `metric_source` enum('manual','impact_hours','budget','outreach_events','task_progress','certifications') NOT NULL DEFAULT 'manual',
  `start_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `priority` enum('low','med','high') NOT NULL DEFAULT 'med',
  `status` enum('draft','active','at_risk','achieved','missed','archived') NOT NULL DEFAULT 'draft',
  `linked_deadline_id` int DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_team_season` (`team_season_id`),
  KEY `idx_owner` (`owner_member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_planning_exclusions`
--

DROP TABLE IF EXISTS `season_planning_exclusions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_planning_exclusions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `season` varchar(10) NOT NULL,
  `program_id` int NOT NULL DEFAULT '0',
  `fam_key` int NOT NULL,
  `family_name` varchar(200) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_spx` (`season`,`program_id`,`fam_key`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_planning_hidden_mentors`
--

DROP TABLE IF EXISTS `season_planning_hidden_mentors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_planning_hidden_mentors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sphm_member` (`member_id`)
) ENGINE=InnoDB AUTO_INCREMENT=67 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `season_transitions`
--

DROP TABLE IF EXISTS `season_transitions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `season_transitions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `from_season` varchar(12) COLLATE utf8mb4_general_ci NOT NULL,
  `to_season` varchar(12) COLLATE utf8mb4_general_ci NOT NULL,
  `state` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_season_transition` (`from_season`,`to_season`),
  KEY `fk_season_transition_creator` (`created_by_id`),
  CONSTRAINT `fk_season_transition_creator` FOREIGN KEY (`created_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `season_transitions_chk_1` CHECK (json_valid(`state`))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopping_categories`
--

DROP TABLE IF EXISTS `shopping_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopping_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `destination` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `color` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `icon_name` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `org_budget_category_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopping_items`
--

DROP TABLE IF EXISTS `shopping_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopping_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `quantity` decimal(12,2) DEFAULT NULL,
  `unit` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `category_id` int DEFAULT NULL,
  `store_id` int DEFAULT NULL,
  `priority` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `needed_by` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `photo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `est_price` decimal(12,2) DEFAULT NULL,
  `requested_by_id` int DEFAULT NULL,
  `claimed_by_id` int DEFAULT NULL,
  `claimed_at` datetime DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `purchased_by_id` int DEFAULT NULL,
  `purchased_at` datetime DEFAULT NULL,
  `actual_amount` decimal(12,2) DEFAULT NULL,
  `receipt_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `budget_category_id` int DEFAULT NULL,
  `reimbursed` tinyint(1) DEFAULT NULL,
  `reimbursed_at` datetime DEFAULT NULL,
  `reimbursed_by_id` int DEFAULT NULL,
  `reimburse_method` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  KEY `store_id` (`store_id`),
  KEY `requested_by_id` (`requested_by_id`),
  KEY `claimed_by_id` (`claimed_by_id`),
  KEY `purchased_by_id` (`purchased_by_id`),
  KEY `reimbursed_by_id` (`reimbursed_by_id`),
  CONSTRAINT `shopping_items_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `shopping_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shopping_items_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `shopping_stores` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shopping_items_ibfk_3` FOREIGN KEY (`requested_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shopping_items_ibfk_4` FOREIGN KEY (`claimed_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shopping_items_ibfk_5` FOREIGN KEY (`purchased_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shopping_items_ibfk_6` FOREIGN KEY (`reimbursed_by_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopping_staples`
--

DROP TABLE IF EXISTS `shopping_staples`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopping_staples` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `default_category_id` int DEFAULT NULL,
  `default_store_id` int DEFAULT NULL,
  `default_unit` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `default_quantity` decimal(12,2) DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `default_category_id` (`default_category_id`),
  KEY `default_store_id` (`default_store_id`),
  CONSTRAINT `shopping_staples_ibfk_1` FOREIGN KEY (`default_category_id`) REFERENCES `shopping_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `shopping_staples_ibfk_2` FOREIGN KEY (`default_store_id`) REFERENCES `shopping_stores` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `shopping_stores`
--

DROP TABLE IF EXISTS `shopping_stores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shopping_stores` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  `display_order` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sponsor_contacts`
--

DROP TABLE IF EXISTS `sponsor_contacts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sponsor_contacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sponsor_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `method` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `outcome` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contacted_at` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contact_sponsor` (`sponsor_id`),
  CONSTRAINT `fk_contact_sponsor` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sponsor_contributions`
--

DROP TABLE IF EXISTS `sponsor_contributions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sponsor_contributions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sponsor_id` int NOT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `event_id` int DEFAULT NULL,
  `contribution_type` enum('monetary','in_kind') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'monetary',
  `amount` decimal(12,2) DEFAULT NULL,
  `in_kind_description` text COLLATE utf8mb4_general_ci,
  `in_kind_value` decimal(12,2) DEFAULT NULL,
  `status` enum('pledged','received','declined','refunded') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pledged',
  `designation` varchar(40) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'general',
  `scholarship_fund_id` int DEFAULT NULL,
  `program_model` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tax_deductible` tinyint(1) NOT NULL DEFAULT '1',
  `pledge_date` date DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `payment_reference` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `credited_team_id` int DEFAULT NULL,
  `budget_donation_id` int DEFAULT NULL,
  `recorded_by_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contrib_sponsor` (`sponsor_id`),
  KEY `idx_contrib_season` (`season`),
  CONSTRAINT `fk_contrib_sponsor` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sponsor_deliverables`
--

DROP TABLE IF EXISTS `sponsor_deliverables`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sponsor_deliverables` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sponsor_id` int NOT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci NOT NULL,
  `category` varchar(60) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `assigned_to_id` int DEFAULT NULL,
  `status` enum('pending','in_progress','complete','overdue','waived') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `completion_date` date DEFAULT NULL,
  `completion_notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliv_sponsor` (`sponsor_id`),
  CONSTRAINT `fk_deliv_sponsor` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sponsor_teams`
--

DROP TABLE IF EXISTS `sponsor_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sponsor_teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sponsor_id` int NOT NULL,
  `team_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sponsor_team` (`sponsor_id`,`team_id`),
  KEY `fk_spt_team` (`team_id`),
  CONSTRAINT `fk_spt_sponsor` FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_spt_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sponsors`
--

DROP TABLE IF EXISTS `sponsors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sponsors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(250) COLLATE utf8mb4_general_ci NOT NULL,
  `scope` enum('program','team') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'team',
  `tier` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tier_locked` tinyint(1) NOT NULL DEFAULT '0',
  `lifecycle_state` enum('prospective','active','lapsed','declined') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'prospective',
  `relationship_owner_id` int DEFAULT NULL,
  `primary_contact_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `primary_contact_email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `primary_contact_phone` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `website` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `logo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `industry_category` varchar(120) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `youth_safety_flag` tinyint(1) NOT NULL DEFAULT '0',
  `youth_safety_notes` text COLLATE utf8mb4_general_ci,
  `source` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `decline_reason` text COLLATE utf8mb4_general_ci,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sponsors_scope` (`scope`),
  KEY `idx_sponsors_state` (`lifecycle_state`),
  KEY `idx_sponsors_season` (`season`),
  KEY `fk_sponsors_owner` (`relationship_owner_id`),
  CONSTRAINT `fk_sponsors_owner` FOREIGN KEY (`relationship_owner_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `strategy_evidence`
--

DROP TABLE IF EXISTS `strategy_evidence`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `strategy_evidence` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_type` enum('impact_log','outreach_event','task','budget_line','certification','resource','file','portfolio_capture','external_link') NOT NULL DEFAULT 'external_link',
  `source_id` int DEFAULT NULL,
  `external_url` varchar(1000) DEFAULT NULL,
  `label` varchar(255) NOT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_config`
--

DROP TABLE IF EXISTS `system_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `label` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `category` (`category`),
  CONSTRAINT `system_config_chk_1` CHECK (json_valid(`values`))
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_roles`
--

DROP TABLE IF EXISTS `system_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `display_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `is_active` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=1358 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_adhoc_expenses`
--

DROP TABLE IF EXISTS `team_adhoc_expenses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_adhoc_expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `source_po_id` int DEFAULT NULL,
  `budget_category_id` int DEFAULT NULL,
  `vendor` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_general_ci NOT NULL,
  `fee_kind` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `purchaser_id` int DEFAULT NULL,
  `expense_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_adhoc_team` (`team_season_id`),
  KEY `idx_adhoc_cat` (`budget_category_id`),
  KEY `fk_adhoc_purchaser` (`purchaser_id`),
  KEY `idx_adhoc_source_po` (`source_po_id`),
  CONSTRAINT `fk_adhoc_cat` FOREIGN KEY (`budget_category_id`) REFERENCES `inv_budget_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_adhoc_purchaser` FOREIGN KEY (`purchaser_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_adhoc_team` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_issue_comments`
--

DROP TABLE IF EXISTS `team_issue_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_issue_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `issue_id` int NOT NULL,
  `author_id` int DEFAULT NULL,
  `body` text COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tic_issue` (`issue_id`),
  CONSTRAINT `fk_tic_issue` FOREIGN KEY (`issue_id`) REFERENCES `team_issues` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_issue_stakeholders`
--

DROP TABLE IF EXISTS `team_issue_stakeholders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_issue_stakeholders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `issue_id` int NOT NULL,
  `member_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tis` (`issue_id`,`member_id`),
  KEY `fk_tis_member` (`member_id`),
  CONSTRAINT `fk_tis_issue` FOREIGN KEY (`issue_id`) REFERENCES `team_issues` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tis_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_issues`
--

DROP TABLE IF EXISTS `team_issues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_issues` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `title` varchar(250) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `reporter_id` int DEFAULT NULL,
  `status` enum('open','in_progress','on_hold','closed') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `resolution_notes` text COLLATE utf8mb4_general_ci,
  `linked_activity_id` int DEFAULT NULL,
  `linked_bom_id` int DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `updated_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ti_team` (`team_season_id`),
  KEY `idx_ti_status` (`status`),
  KEY `fk_ti_activity` (`linked_activity_id`),
  CONSTRAINT `fk_ti_activity` FOREIGN KEY (`linked_activity_id`) REFERENCES `season_activities` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_member_assignments`
--

DROP TABLE IF EXISTS `team_member_assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_member_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `member_id` int NOT NULL,
  `date_joined` date DEFAULT NULL,
  `date_left` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `registered_on_first` tinyint(1) DEFAULT NULL,
  `first_consent_release` tinyint(1) DEFAULT NULL,
  `primary_role` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `secondary_role` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `member_id` (`member_id`),
  CONSTRAINT `team_member_assignments_ibfk_1` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`),
  CONSTRAINT `team_member_assignments_ibfk_2` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=145 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_portfolios`
--

DROP TABLE IF EXISTS `team_portfolios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_portfolios` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `season` varchar(10) DEFAULT NULL,
  `program` enum('FTC','FRC','FLL') NOT NULL DEFAULT 'FTC',
  `award_target` enum('inspire','impact','other') NOT NULL DEFAULT 'inspire',
  `builder_tool` varchar(60) NOT NULL DEFAULT 'Canva',
  `status` enum('planning','drafting','review','submission_ready') NOT NULL DEFAULT 'planning',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_team` (`team_season_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_role_members`
--

DROP TABLE IF EXISTS `team_role_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_role_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_role_id` int NOT NULL,
  `member_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_trm` (`team_role_id`,`member_id`),
  KEY `fk_trm_member` (`member_id`),
  CONSTRAINT `fk_trm_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trm_role` FOREIGN KEY (`team_role_id`) REFERENCES `team_roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=98 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_roles`
--

DROP TABLE IF EXISTS `team_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tr_team` (`team_season_id`)
) ENGINE=InnoDB AUTO_INCREMENT=45 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_season_cert_needs`
--

DROP TABLE IF EXISTS `team_season_cert_needs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_season_cert_needs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int NOT NULL,
  `certification_id` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tscn` (`team_season_id`,`certification_id`),
  KEY `idx_tscn_team` (`team_season_id`),
  KEY `fk_tscn_cert` (`certification_id`),
  CONSTRAINT `fk_tscn_cert` FOREIGN KEY (`certification_id`) REFERENCES `certifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tscn_team` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_seasons`
--

DROP TABLE IF EXISTS `team_seasons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_seasons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_id` int NOT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `team_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `mission` text COLLATE utf8mb4_general_ci,
  `status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `instagram` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tiktok` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `youtube` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `x_account` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `website` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `discord_links` text COLLATE utf8mb4_general_ci,
  `robot_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `robot_photo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `team_logo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `team_photo_url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `theme_preset` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `theme_font` varchar(40) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `theme_accent` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `carryover_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `team_id` (`team_id`),
  CONSTRAINT `team_seasons_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_task_rotation`
--

DROP TABLE IF EXISTS `team_task_rotation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_task_rotation` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `team_season_id` int NOT NULL,
  `position` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_ttr_task` (`task_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_task_updates`
--

DROP TABLE IF EXISTS `team_task_updates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_task_updates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `progress_pct` tinyint unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ttu_task` (`task_id`),
  KEY `fk_ttu_member` (`member_id`),
  CONSTRAINT `fk_ttu_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ttu_task` FOREIGN KEY (`task_id`) REFERENCES `team_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_tasks`
--

DROP TABLE IF EXISTS `team_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_season_id` int DEFAULT NULL,
  `assigned_team_season_id` int DEFAULT NULL,
  `is_private` tinyint(1) NOT NULL DEFAULT '0',
  `assigned_member_id` int DEFAULT NULL,
  `title` varchar(300) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `category` varchar(80) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `progress_pct` tinyint unsigned DEFAULT NULL,
  `linked_activity_id` int DEFAULT NULL,
  `created_by_member_id` int DEFAULT NULL,
  `claimed_by_member_id` int DEFAULT NULL,
  `completed_by_member_id` int DEFAULT NULL,
  `completed_by_team_season_id` int DEFAULT NULL,
  `actual_minutes` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `claimed_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `recurrence` varchar(20) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'none',
  `due_date` date DEFAULT NULL,
  `rotation_index` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `linked_activity_id` (`linked_activity_id`),
  KEY `created_by_member_id` (`created_by_member_id`),
  KEY `claimed_by_member_id` (`claimed_by_member_id`),
  KEY `completed_by_member_id` (`completed_by_member_id`),
  KEY `idx_team_tasks_assigned` (`assigned_team_season_id`),
  KEY `idx_team_tasks_private` (`is_private`,`assigned_member_id`),
  CONSTRAINT `team_tasks_ibfk_1` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `team_tasks_ibfk_2` FOREIGN KEY (`linked_activity_id`) REFERENCES `season_activities` (`id`) ON DELETE SET NULL,
  CONSTRAINT `team_tasks_ibfk_3` FOREIGN KEY (`created_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `team_tasks_ibfk_4` FOREIGN KEY (`claimed_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `team_tasks_ibfk_5` FOREIGN KEY (`completed_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `teams`
--

DROP TABLE IF EXISTS `teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `teams` (
  `id` int NOT NULL AUTO_INCREMENT,
  `team_number` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `program_id` int NOT NULL,
  `rookie_season` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `team_number` (`team_number`),
  KEY `program_id` (`program_id`),
  CONSTRAINT `teams_ibfk_1` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `time_entries`
--

DROP TABLE IF EXISTS `time_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `time_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `entry_date` date NOT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `minutes` int NOT NULL,
  `area` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_volunteer` tinyint(1) DEFAULT NULL,
  `team_season_id` int DEFAULT NULL,
  `source` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `checkin_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `item_type` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `item_id` int DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `verified` tinyint(1) DEFAULT NULL,
  `verified_by_member_id` int DEFAULT NULL,
  `created_by_member_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `entry_method` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `member_id` (`member_id`),
  KEY `team_season_id` (`team_season_id`),
  KEY `checkin_id` (`checkin_id`),
  KEY `event_id` (`event_id`),
  KEY `verified_by_member_id` (`verified_by_member_id`),
  KEY `created_by_member_id` (`created_by_member_id`),
  CONSTRAINT `time_entries_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE,
  CONSTRAINT `time_entries_ibfk_2` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE SET NULL,
  CONSTRAINT `time_entries_ibfk_3` FOREIGN KEY (`checkin_id`) REFERENCES `checkins` (`id`) ON DELETE SET NULL,
  CONSTRAINT `time_entries_ibfk_4` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `time_entries_ibfk_5` FOREIGN KEY (`verified_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `time_entries_ibfk_6` FOREIGN KEY (`created_by_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=271 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `usage_events`
--

DROP TABLE IF EXISTS `usage_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usage_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `event_type` enum('pageview','heartbeat') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pageview',
  `path` varchar(200) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ue_member_time` (`member_id`,`created_at`),
  KEY `idx_ue_time` (`created_at`),
  CONSTRAINT `fk_ue_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15094 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `usage_monthly`
--

DROP TABLE IF EXISTS `usage_monthly`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usage_monthly` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `period_month` char(7) COLLATE utf8mb4_general_ci NOT NULL,
  `pageviews` int NOT NULL DEFAULT '0',
  `sessions` int NOT NULL DEFAULT '0',
  `active_minutes` int NOT NULL DEFAULT '0',
  `active_days` int NOT NULL DEFAULT '0',
  `last_seen` datetime DEFAULT NULL,
  `captured_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_member_month` (`member_id`,`period_month`),
  KEY `idx_um_month` (`period_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `visitor_interactions`
--

DROP TABLE IF EXISTS `visitor_interactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `visitor_interactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `visitor_id` int NOT NULL,
  `member_id` int DEFAULT NULL,
  `method` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `occurred_at` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vi_visitor` (`visitor_id`),
  CONSTRAINT `fk_vi_visitor` FOREIGN KEY (`visitor_id`) REFERENCES `visitors` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `visitor_signup_invites`
--

DROP TABLE IF EXISTS `visitor_signup_invites`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `visitor_signup_invites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` char(40) NOT NULL,
  `visitor_id` int NOT NULL,
  `sent_to` varchar(255) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token` (`token`),
  KEY `idx_visitor` (`visitor_id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `visitors`
--

DROP TABLE IF EXISTS `visitors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `visitors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `visitor_number` varchar(5) COLLATE utf8mb4_general_ci NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `middle_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `birthday` date DEFAULT NULL,
  `grade` int DEFAULT NULL,
  `address_line1` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `address_line2` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `city` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `state` varchar(2) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `zip_code` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian1_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian1_phone` varchar(20) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `guardian1_email` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `referral_source` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `referral_detail` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `school_id` int DEFAULT NULL,
  `parent_mentor_interest` tinyint(1) NOT NULL DEFAULT '0',
  `program_interest_id` int DEFAULT NULL,
  `additional_info` text COLLATE utf8mb4_general_ci,
  `status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `owner_id` int DEFAULT NULL,
  `next_follow_up_date` date DEFAULT NULL,
  `scheduled_visit_date` date DEFAULT NULL,
  `follow_up_reminded_at` date DEFAULT NULL,
  `converted_member_id` int DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT '0',
  `archived_at` datetime DEFAULT NULL,
  `archived_by_id` int DEFAULT NULL,
  `camper_id` int DEFAULT NULL,
  `inquiry_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `visitor_number` (`visitor_number`),
  KEY `program_interest_id` (`program_interest_id`),
  KEY `converted_member_id` (`converted_member_id`),
  KEY `idx_visitors_camper` (`camper_id`),
  KEY `idx_visitors_archived` (`is_archived`),
  CONSTRAINT `visitors_ibfk_1` FOREIGN KEY (`program_interest_id`) REFERENCES `programs` (`id`),
  CONSTRAINT `visitors_ibfk_2` FOREIGN KEY (`converted_member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=222 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `volunteer_submit_log`
--

DROP TABLE IF EXISTS `volunteer_submit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `volunteer_submit_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ip_hash` char(64) COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vsl_ip_time` (`ip_hash`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `waitlist_entries`
--

DROP TABLE IF EXISTS `waitlist_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `waitlist_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `visitor_id` int DEFAULT NULL,
  `member_id` int DEFAULT NULL,
  `program_id` int NOT NULL,
  `season` varchar(10) COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('waiting','offered','accepted','declined','expired','withdrawn') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'waiting',
  `sibling_of_member` tinyint(1) NOT NULL DEFAULT '0',
  `parent_mentor_interest` tinyint(1) NOT NULL DEFAULT '0',
  `available_night_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `preferred_night_id` int DEFAULT NULL,
  `requested_date` date NOT NULL,
  `carried_from_season` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `offered_night_id` int DEFAULT NULL,
  `offered_at` datetime DEFAULT NULL,
  `offer_expires` date DEFAULT NULL,
  `responded_at` datetime DEFAULT NULL,
  `offered_by_id` int DEFAULT NULL,
  `priority_reason` varchar(300) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_wl_prog_season` (`program_id`,`season`),
  KEY `idx_wl_status` (`status`),
  KEY `fk_wl_visitor` (`visitor_id`),
  KEY `fk_wl_member` (`member_id`),
  CONSTRAINT `fk_wl_member` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wl_program` FOREIGN KEY (`program_id`) REFERENCES `programs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wl_visitor` FOREIGN KEY (`visitor_id`) REFERENCES `visitors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `waitlist_entries_chk_1` CHECK (json_valid(`available_night_ids`))
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wish_list_fulfillments`
--

DROP TABLE IF EXISTS `wish_list_fulfillments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wish_list_fulfillments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `wish_id` int NOT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `amount` decimal(10,2) DEFAULT NULL,
  `donor_member_id` int DEFAULT NULL,
  `donor_sponsor_id` int DEFAULT NULL,
  `donor_name` varchar(200) DEFAULT NULL,
  `fulfilled_date` date DEFAULT NULL,
  `notes` text,
  `thanked` tinyint(1) NOT NULL DEFAULT '0',
  `thanked_date` date DEFAULT NULL,
  `thanked_by_id` int DEFAULT NULL,
  `linked_inv_item_id` int DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wlf_wish` (`wish_id`),
  CONSTRAINT `fk_wlf_wish` FOREIGN KEY (`wish_id`) REFERENCES `wish_list_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wish_list_items`
--

DROP TABLE IF EXISTS `wish_list_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wish_list_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scope` enum('trc','team') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'trc',
  `team_season_id` int DEFAULT NULL,
  `name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `url` varchar(500) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `priority` enum('low','normal','high','urgent') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'normal',
  `is_asset` tinyint(1) NOT NULL DEFAULT '1',
  `status` enum('open','fulfilled','archived') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `fulfilled_date` date DEFAULT NULL,
  `fulfilled_amount` decimal(10,2) DEFAULT NULL,
  `donor_member_id` int DEFAULT NULL,
  `donor_sponsor_id` int DEFAULT NULL,
  `donor_name` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `fulfilled_notes` text COLLATE utf8mb4_general_ci,
  `linked_inv_item_id` int DEFAULT NULL,
  `requested_by_id` int DEFAULT NULL,
  `created_by_id` int DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_wl_scope` (`scope`,`team_season_id`),
  KEY `idx_wl_status` (`status`),
  KEY `fk_wl_team` (`team_season_id`),
  KEY `fk_wl_donor_member` (`donor_member_id`),
  KEY `fk_wl_donor_sponsor` (`donor_sponsor_id`),
  KEY `fk_wl_inv` (`linked_inv_item_id`),
  CONSTRAINT `fk_wl_donor_member` FOREIGN KEY (`donor_member_id`) REFERENCES `members` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wl_donor_sponsor` FOREIGN KEY (`donor_sponsor_id`) REFERENCES `sponsors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wl_inv` FOREIGN KEY (`linked_inv_item_id`) REFERENCES `inv_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_wl_team` FOREIGN KEY (`team_season_id`) REFERENCES `team_seasons` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ylc_memberships`
--

DROP TABLE IF EXISTS `ylc_memberships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ylc_memberships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `team_id` int DEFAULT NULL,
  `term` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `role` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ylc_member_term_team` (`member_id`,`term`,`team_id`),
  KEY `idx_ylc_team_term` (`team_id`,`term`),
  CONSTRAINT `fk_ylc_team` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ylc_memberships_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=868 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `youth_roles`
--

DROP TABLE IF EXISTS `youth_roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `youth_roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `ylc_member` tinyint(1) DEFAULT NULL,
  `ylc_role` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `ylc_term` varchar(10) COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `member_id` (`member_id`),
  CONSTRAINT `youth_roles_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-30 16:21:17
