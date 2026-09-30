-- Reconcile schema_migrations to the runner's full-name convention.
-- SAFE + idempotent: records the full-name key ONLY where the short numeric key
-- already exists (i.e. the migration provably ran on THIS database). Adds nothing
-- for migrations that have not run. Paste into phpMyAdmin (SQL tab) on production.
-- Generated from deploy/migrations/*.sql.

INSERT INTO schema_migrations (version, applied_at)
SELECT '0001_add_alt_emails', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_add_alt_emails');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0002_reservations', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0002')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0002_reservations');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0003_hall_of_fame', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0003')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0003_hall_of_fame');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0004_time_entry_input', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0004')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0004_time_entry_input');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0005_hof_college_grad', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0005')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0005_hof_college_grad');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0006_hof_reflections', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0006')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0006_hof_reflections');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0007_feedback', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0007')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0007_feedback');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0008_feedback_fields', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0008')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0008_feedback_fields');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0009_alumni_flag', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0009')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0009_alumni_flag');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0010_default_role', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0010')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0010_default_role');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0011_enrollment_amount_due', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0011')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0011_enrollment_amount_due');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0012_inv_discontinued', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0012')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0012_inv_discontinued');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0013_inv_stock_holdings', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0013')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0013_inv_stock_holdings');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0014_inv_kits', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0014')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0014_inv_kits');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0015_inv_item_sources', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0015')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0015_inv_item_sources');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0016_calendar_token', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0016')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0016_calendar_token');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0017_inv_item_specs', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0017')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0017_inv_item_specs');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0018_scouting', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0018')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0018_scouting');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0019_scouting_decode_seed', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0019')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0019_scouting_decode_seed');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0020_scouting_training', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0020')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0020_scouting_training');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0021_scout_priority', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0021')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0021_scout_priority');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0022_scout_surrogates', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0022')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0022_scout_surrogates');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0023_scout_decode_auto_leave', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0023')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0023_scout_decode_auto_leave');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0024_scout_decode_auto_movement', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0024')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0024_scout_decode_auto_movement');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0025_scout_watchlist', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0025')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0025_scout_watchlist');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0026_scout_robot_photos', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0026')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0026_scout_robot_photos');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0027_scout_our_team_number', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0027')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0027_scout_our_team_number');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0028_pit_dns_and_weight', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0028')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0028_pit_dns_and_weight');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0029_scout_event_alliances', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0029')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0029_scout_event_alliances');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0030_summer_camp', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0030')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0030_summer_camp');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0031_camp_hardening', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0031')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0031_camp_hardening');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0032_camp_worker_assignments', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0032')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0032_camp_worker_assignments');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0033_camp_resources', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0033')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0033_camp_resources');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0034_member_program_support', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0034')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0034_member_program_support');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0035_comm_thread_batches', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0035')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0035_comm_thread_batches');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0036_bom_optional_team', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0036')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0036_bom_optional_team');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0037_item_location_bins', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0037')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0037_item_location_bins');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0038_feedback_github', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0038')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0038_feedback_github');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0039_grant_team_submitted_date', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0039')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0039_grant_team_submitted_date');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0040_repair_tickets', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0040')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0040_repair_tickets');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0041_finance_quickbooks', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0041')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0041_finance_quickbooks');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0042_event_rsvp_tokens', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0042')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0042_event_rsvp_tokens');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0043_email_layouts', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0043')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0043_email_layouts');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0044_team_adhoc_expenses', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0044')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0044_team_adhoc_expenses');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0045_email_optouts', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0045')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0045_email_optouts');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0046_announcements', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0046')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0046_announcements');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0047_email_attachments', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0047')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0047_email_attachments');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0048_season_transitions', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0048')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0048_season_transitions');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0049_first_annual_compliance', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0049')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0049_first_annual_compliance');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0050_sponsors_module', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0050')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0050_sponsors_module');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0051_event_sponsorship', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0051')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0051_event_sponsorship');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0052_event_sponsorship_contribution_link', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0052')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0052_event_sponsorship_contribution_link');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0053_scholarship_funds', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0053')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0053_scholarship_funds');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0054_waitlist', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0054')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0054_waitlist');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0055_visitor_pipeline', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0055')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0055_visitor_pipeline');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0056_schools', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0056')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0056_schools');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0057_visitor_parent_mentor', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0057')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0057_visitor_parent_mentor');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0058_mentor_prospects', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0058')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0058_mentor_prospects');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0059_mentor_kind_sponsor_link', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0059')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0059_mentor_kind_sponsor_link');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0060_backfill_waitlist_program', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0060')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0060_backfill_waitlist_program');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0061_event_benefits_season', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0061')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0061_event_benefits_season');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0062_payments', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0062')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0062_payments');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0063_payment_fee_cover', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0063')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0063_payment_fee_cover');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0064_scholarship_applications', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0064')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0064_scholarship_applications');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0065_school_payments', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0065')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0065_school_payments');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0066_scholarship_need_fields', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0066')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0066_scholarship_need_fields');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0067_second_emergency_contact', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0067')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0067_second_emergency_contact');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0068_two_factor', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0068')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0068_two_factor');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0069_tasks', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0069')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0069_tasks');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0070_meeting_minutes', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0070')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0070_meeting_minutes');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0071_totp_last_step', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0071')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0071_totp_last_step');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0072_meeting_event_link', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0072')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0072_meeting_event_link');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0073_groups', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0073')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0073_groups');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0074_drop_standalone_tasks', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0074')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0074_drop_standalone_tasks');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0075_team_task_assign_recurring', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0075')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0075_team_task_assign_recurring');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0076_group_source_and_minutes_authorship', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0076')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0076_group_source_and_minutes_authorship');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0077_task_completed_by_team', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0077')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0077_task_completed_by_team');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0078_feedback_testing_status', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0078')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0078_feedback_testing_status');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0079_meeting_agenda', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0079')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0079_meeting_agenda');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0080_payment_enrollments', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0080')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0080_payment_enrollments');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0081_help_articles', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0081')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0081_help_articles');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0082_seed_help_articles', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0082')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0082_seed_help_articles');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0083_calendar_holidays', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0083')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0083_calendar_holidays');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0084_event_informational', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0084')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0084_event_informational');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0085_guided_tours', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0085')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0085_guided_tours');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0086_seed_guided_tours', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0086')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0086_seed_guided_tours');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0087_college_scholarships', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0087')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0087_college_scholarships');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0088_help_contextual_keys', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0088')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0088_help_contextual_keys');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0089_season_activity_dates_progress', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0089')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0089_season_activity_dates_progress');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0090_season_deadlines', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0090')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0090_season_deadlines');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0091_team_issues', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0091')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0091_team_issues');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0092_team_roles', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0092')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0092_team_roles');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0093_season_plan_own_tab', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0093')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0093_season_plan_own_tab');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0094_asset_categories', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0094')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0094_asset_categories');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0095_asset_donations', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0095')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0095_asset_donations');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0096_wish_list', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0096')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0096_wish_list');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0097_inv_item_photos', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0097')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0097_inv_item_photos');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0098_email_tracking', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0098')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0098_email_tracking');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0099_reservation_event_link', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0099')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0099_reservation_event_link');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0100_checkout_freetext_item', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0100')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0100_checkout_freetext_item');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0101_event_meeting_mode', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0101')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0101_event_meeting_mode');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0102_email_drafts', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0102')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0102_email_drafts');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0103_repair_costs', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0103')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0103_repair_costs');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0104_metric_snapshots', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0104')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0104_metric_snapshots');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0105_usage_events', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0105')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0105_usage_events');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0106_report_engine', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0106')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0106_report_engine');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0107_report_schedules', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0107')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0107_report_schedules');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0108_usage_monthly', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0108')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0108_usage_monthly');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0109_mentor_unavailability', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0109')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0109_mentor_unavailability');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0110_issue_bom_link', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0110')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0110_issue_bom_link');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0111_reports_permissions_seed', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0111')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0111_reports_permissions_seed');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0112_budget_subcategories', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0112')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0112_budget_subcategories');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0113_repair_correspondence', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0113')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0113_repair_correspondence');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0114_task_progress', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0114')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0114_task_progress');

INSERT INTO schema_migrations (version, applied_at)
SELECT '0115_college_scholarship_tracking', NOW() FROM DUAL
 WHERE EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0115')
   AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0115_college_scholarship_tracking');

