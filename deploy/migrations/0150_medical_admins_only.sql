-- Medical forms are now surfaced on a Medical tab on the member profile, so who holds
-- members.view_medical decides who can read another member's medical and emergency
-- information from the UI.
--
-- Per policy: Admin and System Administrator only. Mentor previously held this (seeded
-- by 0140 and re-granted by 0149) and is revoked here. Mentors are NOT losing their own
-- form — MedicalController always allows a member to read and write their own record,
-- and a guardian to manage their youth's, without any permission key.
--
-- If you later want a specific mentor (a first-aid lead, a trip chaperone) to see
-- medical info, grant members.view_medical to a role in Admin -> Role Management
-- rather than reverting this.
DELETE rp FROM role_permissions rp
  JOIN system_roles sr ON sr.id = rp.role_id
 WHERE rp.resource_key = 'members.view_medical'
   AND sr.name NOT IN ('System Administrator', 'Admin');
