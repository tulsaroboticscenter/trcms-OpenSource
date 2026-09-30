-- Calendar feed subscriptions (#43): each member gets an opaque token that lets
-- them subscribe to the full TRC events calendar from Google/Apple/Outlook. The
-- token goes in the feed URL (calendar apps can't send an auth header), so it is
-- a capability secret — revealed only to the member and rotatable. A separate
-- public .ics feed (events flagged post_to_public_calendar) needs no token.
ALTER TABLE members
  ADD COLUMN calendar_token VARCHAR(64) DEFAULT NULL,
  ADD UNIQUE KEY members_calendar_token_unique (calendar_token);
