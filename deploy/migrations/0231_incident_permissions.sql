-- 0231 — Incident Reports permission seeds. The "Incidents" group and each key's default ("none")
-- live in config/permissions.json; this migration seeds role_permissions by role NAME with
-- NOT EXISTS guards (re-runnable — role_permissions has no unique key on (role_id, resource_key),
-- so INSERT IGNORE would double-insert). All gating is on these keys, never member_type/role name.
--
-- Keys (§10):
--   incidents.report        write -> every real role incl Youth Member (not Default, not a Station)
--   incidents.view_own      read  -> same set
--   incidents.queue         read  -> Admin, System Administrator
--   incidents.triage        write -> Admin, System Administrator
--   incidents.close         write -> Admin, System Administrator
--   incidents.settings      write -> System Administrator
--   incidents.first_aid_log write -> Mentor, Admin, System Administrator
--   incidents.view_restricted      no seed (Phase 2)

-- incidents.report -> every real role (exclude the locked-down Default role and station/kiosk roles)
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.report', 'write'
  FROM system_roles sr
 WHERE sr.name NOT IN ('Default','Event Check-In Station','Visitor Registration Station',
                       'Parts Room Station','Team Tasks Station','FLL Attendance Station','Generic Station')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.report');

-- incidents.view_own -> same set, read
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.view_own', 'read'
  FROM system_roles sr
 WHERE sr.name NOT IN ('Default','Event Check-In Station','Visitor Registration Station',
                       'Parts Room Station','Team Tasks Station','FLL Attendance Station','Generic Station')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.view_own');

-- incidents.queue -> read, Admin + System Administrator
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.queue', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('Admin','System Administrator')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.queue');

-- incidents.triage -> write, Admin + System Administrator
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.triage', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('Admin','System Administrator')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.triage');

-- incidents.close -> write, Admin + System Administrator
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.close', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('Admin','System Administrator')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.close');

-- incidents.settings -> write, System Administrator
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.settings', 'write'
  FROM system_roles sr
 WHERE sr.name = 'System Administrator'
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.settings');

-- incidents.first_aid_log -> write, Mentor + Admin + System Administrator
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.first_aid_log', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('Mentor','Admin','System Administrator')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.first_aid_log');

-- Seed routing rule 1 (all reports to the inbox) so the module works on deploy (§8). The value is
-- a single object wrapped in an array ([{...}]), matching the other settings categories; `values`
-- is a reserved word so it is backtick-quoted. Idempotent: only insert if the category is absent.
INSERT INTO system_config (category, label, `values`)
SELECT 'incident_routing', 'Incident Routing',
       '[{"default_to":["incidentreport@tulsaroboticscenter.org"],"reply_to":"","digest_enabled":true,"rules":[{"id":1,"label":"All reports to the inbox","types":["*"],"min_severity":"minor","to":["incidentreport@tulsaroboticscenter.org"],"cc":[],"notify_roles":[],"board_notify":false},{"id":2,"label":"Serious and above to the ED","types":["*"],"min_severity":"serious","to":[],"cc":[],"notify_roles":["Admin"],"board_notify":true}]}]'
 WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'incident_routing');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0231_incident_permissions', NOW());
