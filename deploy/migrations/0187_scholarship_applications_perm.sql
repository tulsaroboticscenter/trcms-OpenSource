-- Dedicated permission for the CONFIDENTIAL scholarship applications (family aid: who
-- applied + financial-need details). Previously the review queue was gated on
-- sponsors.view / sponsors.manage — a shared Sponsors permission held by Mentors, Team
-- Leaders, etc. (default 'read'), so they could see who was applying. Now the queue,
-- the Members-page entry point, the review/award/resend actions, and the nav badge all
-- gate on 'scholarships.applications' (default 'none' in permissions.json), separate
-- from Sponsors. Read = view the queue; Write = review / decide / award / resend.
--
-- Seed WRITE for Admin and System Administrator ONLY; every other role stays 'none'.
-- A future "Scholarship Manager" role can be granted it in Admin -> Role Management.
-- By role NAME + NOT EXISTS guard (env-safe, re-runnable; role_permissions has no unique
-- key on role/resource).

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'scholarships.applications', 'write'
  FROM system_roles sr
 WHERE sr.is_active = 1
   AND sr.name IN ('Admin', 'System Administrator')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'scholarships.applications');
