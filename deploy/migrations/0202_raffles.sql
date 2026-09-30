-- 0202 — Raffles: reusable prize drawings with online + booth ticket sales.
-- A raffle is a configurable event (prize, price/ticket, sales window, draw date). Guests
-- buy tickets via a public QR-code form (paid by card) or in person at the booth (staff
-- records the sale); each paid order issues sequential numbered tickets that print for the
-- bowl. A winner is drawn from paid tickets.

CREATE TABLE raffles (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,
  prize_description TEXT NULL,
  ticket_price      DECIMAL(10,2) NOT NULL DEFAULT 5.00,
  fine_print        TEXT NULL,
  sales_open_at     DATETIME NULL,
  sales_close_at    DATETIME NULL,
  draw_date         DATETIME NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft|open|closed|drawn|archived
  public_slug       VARCHAR(40) NOT NULL,
  event_id          INT NULL,                               -- optional link to an events row
  winner_ticket_id  INT NULL,
  winner_drawn_at   DATETIME NULL,
  created_by_id     INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NULL,
  UNIQUE KEY uq_raffles_slug (public_slug),
  KEY idx_raffles_status (status)
);

CREATE TABLE raffle_orders (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  raffle_id      INT NOT NULL,
  buyer_name     VARCHAR(200) NOT NULL,
  buyer_email    VARCHAR(200) NULL,
  buyer_phone    VARCHAR(40) NULL,
  quantity       INT NOT NULL DEFAULT 1,
  unit_price     DECIMAL(10,2) NOT NULL,
  amount         DECIMAL(10,2) NOT NULL,
  sale_channel   VARCHAR(20) NOT NULL DEFAULT 'online',     -- online|booth
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',    -- pending|paid|refunded|void
  payment_method VARCHAR(20) NULL,                          -- cc|cash|check|other (booth)
  payment_id     INT NULL,                                  -- links to payments.id for online
  recorded_by_id INT NULL,                                  -- staff who recorded a booth sale
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at        DATETIME NULL,
  KEY idx_raffle_orders_raffle (raffle_id),
  KEY idx_raffle_orders_status (payment_status)
);

CREATE TABLE raffle_tickets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  raffle_id     INT NOT NULL,
  order_id      INT NOT NULL,
  ticket_number INT NOT NULL,
  is_winner     TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_raffle_ticket_number (raffle_id, ticket_number),
  KEY idx_raffle_tickets_order (order_id)
);
