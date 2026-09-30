-- 0132_youth_message_history_perm.sql
-- Youth must not read other members' message history ("System Email History").
-- The data is now gated server-side on the profile.communications permission
-- (CommunicationsController::recipientThreads / getThread) — plus you always see
-- your own and a guardian sees their youth's. Defensively remove any
-- profile.communications grant from the youth-facing roles so they don't hold it
-- (some environments had it granted). Grant it back to any role in Admin ->
-- Role Management (Profile Sections -> Message History) if it should see message
-- history on profiles.
--
-- Keyed by role NAME (env-safe). Deleting the row falls back to the default ('none').

DELETE rp FROM role_permissions rp
  JOIN system_roles sr ON sr.id = rp.role_id
 WHERE sr.name IN ('Youth Member', 'Team Leader')
   AND rp.resource_key = 'profile.communications';
