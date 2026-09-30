-- 0234_member_token_version.sql
-- Security finding #3: session revocation. Stateless JWTs had no jti / session table /
-- token-version, so changing or resetting a password (or 2FA change) did NOT invalidate
-- previously issued tokens, and Auth::refreshed() would renew a stolen token indefinitely.
--
-- Add a per-member token_version. It is stamped into each token at mint (claim `tv`) and
-- compared on every request (Auth::currentMember and Auth::refreshed). Bumping it on a
-- credential change instantly invalidates every token issued before the bump. Existing
-- tokens carry no `tv` claim and are treated as tv=0, matching the DEFAULT 0 here, so the
-- deploy does NOT log everyone out — only a subsequent credential change does.

ALTER TABLE members ADD COLUMN token_version INT NOT NULL DEFAULT 0;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0234_member_token_version', NOW());
