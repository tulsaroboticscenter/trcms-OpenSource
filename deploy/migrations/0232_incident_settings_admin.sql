-- 0232_incident_settings_admin.sql
-- Grant incidents.settings (write) to the Admin role, in addition to System Administrator.
--
-- Incident report routing lives inside Admin -> Email Settings, which is gated on admin.config
-- (Admins manage it). But incidents.settings was seeded only to System Administrator (0231), so an
-- Admin opening Email Settings could not see or set the incident inbox / routing block. Admins
-- already have incidents.queue/triage/close, so managing where reports are emailed fits their role.
-- Idempotent: NOT EXISTS guard (role_permissions has no unique key on (role_id, resource_key)).

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'incidents.settings', 'write'
  FROM system_roles sr
 WHERE sr.name = 'Admin'
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'incidents.settings');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0232_incident_settings_admin', NOW());
