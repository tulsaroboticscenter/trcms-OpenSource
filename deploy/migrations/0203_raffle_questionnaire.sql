-- 0203 — Raffle buyer questionnaire: turn ticket buyers into leads.
-- Each order captures a few opt-ins so a paid buyer can be routed into the right place:
-- interested in the program for their kids (-> a Visitor/recruiting record), wants to hear
-- about volunteering, wants to become a TRC Supporter (-> a prospective Sponsor), and a
-- default-on "stay in touch" (-> the mailing list). routed_at guards against double-routing.
ALTER TABLE raffle_orders
  ADD COLUMN interested_program   TINYINT(1) NOT NULL DEFAULT 0 AFTER buyer_phone,
  ADD COLUMN interested_volunteer TINYINT(1) NOT NULL DEFAULT 0 AFTER interested_program,
  ADD COLUMN interested_sponsor   TINYINT(1) NOT NULL DEFAULT 0 AFTER interested_volunteer,
  ADD COLUMN stay_in_touch        TINYINT(1) NOT NULL DEFAULT 1 AFTER interested_sponsor,
  ADD COLUMN routed_at            DATETIME NULL;
