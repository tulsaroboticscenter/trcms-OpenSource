<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Raffles — reusable prize drawings with online (card) + booth (in-person) ticket sales.
 *
 * A raffle is configured once (prize, price/ticket, sales window, draw date) and exposes a
 * public QR-code signup page. Guests buy tickets online by card, or staff record in-person
 * sales at the booth; each PAID order issues sequential numbered tickets that print for the
 * bowl. A winner is drawn at random from paid tickets.
 *
 * Ticket issuance (issueTicketsForOrder) is shared: the booth path calls it directly when a
 * cash/card sale is recorded, and the online path calls it from the payment webhook once the
 * card charge clears.
 */
final class RafflesController
{
    private const STATUSES = ['draft', 'open', 'closed', 'drawn', 'archived'];

    /**
     * Guard for management endpoints. Gated on the configurable `raffles.manage`
     * permission (Admin -> Role Management), not a hardcoded role name — Admin /
     * System Administrator are superusers and pass automatically. The public
     * ticket-buying endpoints do NOT call this; they stay unauthenticated.
     */
    private static function staff(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'raffles.manage', 'write');
    }

    private static function num($v): ?float
    {
        return ($v === null || $v === '') ? null : round((float)$v, 2);
    }

    private static function slugify(string $name): string
    {
        $base = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $name)) ?: 'raffle';
        return trim($base, '-');
    }

    /** A unique public slug derived from the name (adds a short suffix on collision). */
    private static function uniqueSlug(PDO $pdo, string $name): string
    {
        $base = self::slugify($name);
        $slug = $base;
        for ($i = 0; $i < 50; $i++) {
            $s = $pdo->prepare("SELECT 1 FROM raffles WHERE public_slug = ? LIMIT 1");
            $s->execute([$slug]);
            if (!$s->fetchColumn()) return $slug;
            $slug = $base . '-' . substr(bin2hex(random_bytes(2)), 0, 4);
        }
        return $base . '-' . substr(bin2hex(random_bytes(4)), 0, 8);
    }

    /** Aggregate sales for a raffle: paid tickets + revenue, plus pending. */
    private static function stats(PDO $pdo, int $raffleId): array
    {
        $s = $pdo->prepare(
            "SELECT
                COALESCE(SUM(CASE WHEN payment_status='paid' THEN quantity ELSE 0 END),0) AS tickets_sold,
                COALESCE(SUM(CASE WHEN payment_status='paid' THEN amount ELSE 0 END),0)   AS revenue,
                COALESCE(SUM(CASE WHEN payment_status='pending' THEN quantity ELSE 0 END),0) AS tickets_pending,
                COUNT(CASE WHEN payment_status='paid' THEN 1 END) AS buyers
             FROM raffle_orders WHERE raffle_id = ?"
        );
        $s->execute([$raffleId]);
        $r = $s->fetch() ?: [];
        return [
            'tickets_sold' => (int)($r['tickets_sold'] ?? 0),
            'tickets_pending' => (int)($r['tickets_pending'] ?? 0),
            'revenue' => round((float)($r['revenue'] ?? 0), 2),
            'buyers' => (int)($r['buyers'] ?? 0),
        ];
    }

    private static function serialize(PDO $pdo, array $r, bool $withStats = true): array
    {
        $out = [
            'id' => (int)$r['id'], 'name' => $r['name'], 'prize_description' => $r['prize_description'],
            'ticket_price' => self::num($r['ticket_price']), 'fine_print' => $r['fine_print'],
            'sales_open_at' => $r['sales_open_at'], 'sales_close_at' => $r['sales_close_at'],
            'draw_date' => $r['draw_date'], 'status' => $r['status'], 'public_slug' => $r['public_slug'],
            'event_id' => $r['event_id'] !== null ? (int)$r['event_id'] : null,
            'winner_ticket_id' => $r['winner_ticket_id'] !== null ? (int)$r['winner_ticket_id'] : null,
            'winner_drawn_at' => $r['winner_drawn_at'],
            'created_at' => $r['created_at'],
        ];
        if ($withStats) $out['stats'] = self::stats($pdo, (int)$r['id']);
        return $out;
    }

    /** Whether a raffle is currently open for purchases (status + sales window). */
    private static function saleOpen(array $r): bool
    {
        if (($r['status'] ?? '') !== 'open') return false;
        $now = date('Y-m-d H:i:s');
        if (!empty($r['sales_open_at']) && $now < $r['sales_open_at']) return false;
        if (!empty($r['sales_close_at']) && $now > $r['sales_close_at']) return false;
        return true;
    }

    private static function loadRaffle(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM raffles WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function loadRaffleBySlug(PDO $pdo, string $slug): ?array
    {
        $s = $pdo->prepare("SELECT * FROM raffles WHERE public_slug = ?"); $s->execute([$slug]);
        return $s->fetch() ?: null;
    }

    /**
     * Issue `quantity` sequential tickets for a PAID order (idempotent: does nothing if the
     * order already has tickets). Returns the assigned ticket numbers. Shared by booth sales
     * and the online payment webhook.
     */
    public static function issueTicketsForOrder(PDO $pdo, int $orderId): array
    {
        $o = $pdo->prepare("SELECT * FROM raffle_orders WHERE id = ?"); $o->execute([$orderId]);
        $order = $o->fetch();
        if (!$order) return [];
        $existing = $pdo->prepare("SELECT ticket_number FROM raffle_tickets WHERE order_id = ? ORDER BY ticket_number");
        $existing->execute([$orderId]);
        $have = array_map('intval', array_column($existing->fetchAll(), 'ticket_number'));
        if ($have) return $have; // already issued

        $raffleId = (int)$order['raffle_id'];
        $qty = max(1, (int)$order['quantity']);
        $pdo->beginTransaction();
        try {
            $mx = $pdo->prepare("SELECT COALESCE(MAX(ticket_number),0) FROM raffle_tickets WHERE raffle_id = ? FOR UPDATE");
            $mx->execute([$raffleId]);
            $next = (int)$mx->fetchColumn();
            $ins = $pdo->prepare("INSERT INTO raffle_tickets (raffle_id, order_id, ticket_number, created_at) VALUES (?,?,?,NOW())");
            $nums = [];
            for ($i = 1; $i <= $qty; $i++) { $n = $next + $i; $ins->execute([$raffleId, $orderId, $n]); $nums[] = $n; }
            $pdo->commit();
            return $nums;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            return [];
        }
    }

    /** Mark an order paid (if not already), issue its tickets, and route the buyer's interests.
     *  Called by the payment webhook/return for online orders. */
    public static function markOrderPaid(PDO $pdo, int $orderId, ?string $method = 'cc'): array
    {
        $pdo->prepare("UPDATE raffle_orders SET payment_status='paid', payment_method=COALESCE(payment_method,?), paid_at=COALESCE(paid_at,NOW()) WHERE id=? AND payment_status<>'paid'")
            ->execute([$method, $orderId]);
        $nums = self::issueTicketsForOrder($pdo, $orderId);
        self::emailBuyerTickets($pdo, $orderId, $nums);
        self::routeBuyerInterests($pdo, $orderId);
        return $nums;
    }

    /** Read the questionnaire opt-ins from a request body (stay-in-touch defaults ON). */
    private static function flagsFrom(array $d): array
    {
        return [
            'interested_program'   => (int)!empty($d['interested_program']),
            'interested_volunteer' => (int)!empty($d['interested_volunteer']),
            'interested_sponsor'   => (int)!empty($d['interested_sponsor']),
            // Default-on: only an explicit false opts out.
            'stay_in_touch'        => array_key_exists('stay_in_touch', $d) ? (int)!empty($d['stay_in_touch']) : 1,
        ];
    }

    /**
     * Route a paid buyer's questionnaire answers into the right systems (idempotent via
     * routed_at): the mailing list (stay-in-touch / any interest), a Visitor/recruiting
     * record (interested in the program), and a prospective Sponsor (wants to support TRC).
     */
    public static function routeBuyerInterests(PDO $pdo, int $orderId): void
    {
        $o = $pdo->prepare("SELECT ro.*, r.name AS raffle_name FROM raffle_orders ro JOIN raffles r ON r.id = ro.raffle_id WHERE ro.id = ?");
        $o->execute([$orderId]);
        $order = $o->fetch();
        if (!$order || $order['payment_status'] !== 'paid' || $order['routed_at'] !== null) return;

        $email = trim((string)($order['buyer_email'] ?? ''));
        $name = trim((string)($order['buyer_name'] ?? ''));
        [$first, $last] = array_pad(explode(' ', $name, 2), 2, '');
        $phone = trim((string)($order['buyer_phone'] ?? ''));
        $wantsProgram = (bool)$order['interested_program'];
        $wantsVolunteer = (bool)$order['interested_volunteer'];
        $wantsSponsor = (bool)$order['interested_sponsor'];
        $stay = (bool)$order['stay_in_touch'];
        $note = 'From the "' . $order['raffle_name'] . '" raffle sign-up.';

        // 1) Mailing list — anyone who opted to stay in touch or expressed any interest.
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) && ($stay || $wantsProgram || $wantsVolunteer || $wantsSponsor)) {
            $interests = [];
            if ($wantsProgram) $interests[] = 'program';
            if ($wantsVolunteer) $interests[] = 'volunteer';
            if ($wantsSponsor) $interests[] = 'sponsor';
            // Don't resurrect someone who has unsubscribed; otherwise upsert + re-subscribe.
            $pdo->prepare(
                "INSERT INTO mailing_list_subscribers (first_name, last_name, email, phone, interests, notes, source, created_at, updated_at)
                 VALUES (?,?,?,?,?,?, 'raffle', NOW(), NOW())
                 ON DUPLICATE KEY UPDATE first_name=VALUES(first_name), last_name=VALUES(last_name),
                   phone=COALESCE(VALUES(phone), phone), interests=VALUES(interests), notes=VALUES(notes), updated_at=NOW()"
            )->execute([$first ?: null, $last ?: null, $email, $phone ?: null, $interests ? json_encode($interests) : null, $note]);
        }

        // 2) Recruiting — interested in the program for their kids → a Visitor record.
        if ($wantsProgram && $name !== '') {
            $exists = false;
            if ($email !== '') { $ex = $pdo->prepare("SELECT 1 FROM visitors WHERE LOWER(email)=LOWER(?) OR LOWER(guardian1_email)=LOWER(?) LIMIT 1"); $ex->execute([$email, $email]); $exists = (bool)$ex->fetchColumn(); }
            if (!$exists) {
                $pdo->prepare(
                    "INSERT INTO visitors (visitor_number, first_name, last_name, email, phone, guardian1_name, guardian1_email, guardian1_phone, referral_source, additional_info, status)
                     VALUES (?,?,?,?,?,?,?,?, 'event', ?, 'new')"
                )->execute([\App\Controllers\VisitorsController::nextVisitorNumber($pdo), $first ?: $name, $last ?: '(raffle)', $email ?: null, $phone ?: null, $name, $email ?: null, $phone ?: null, $note . ' Interested in the program for their child.']);
            }
        }

        // 3) Sponsors — wants to become a TRC Supporter → a prospective Sponsor.
        if ($wantsSponsor && $name !== '') {
            $exists = false;
            if ($email !== '') { $ex = $pdo->prepare("SELECT 1 FROM sponsors WHERE LOWER(primary_contact_email)=LOWER(?) LIMIT 1"); $ex->execute([$email]); $exists = (bool)$ex->fetchColumn(); }
            if (!$exists) {
                $pdo->prepare(
                    "INSERT INTO sponsors (name, scope, lifecycle_state, primary_contact_name, primary_contact_email, primary_contact_phone, season, source, notes, created_at)
                     VALUES (?, 'program', 'prospective', ?, ?, ?, ?, 'raffle', ?, NOW())"
                )->execute([$name, $name, $email ?: null, $phone ?: null, \App\Core\NightPrefs::currentSeason(), $note . ' Expressed interest in supporting TRC.']);
            }
        }

        $pdo->prepare("UPDATE raffle_orders SET routed_at = NOW() WHERE id = ?")->execute([$orderId]);
    }

    /** Best-effort confirmation email listing the buyer's ticket numbers. */
    private static function emailBuyerTickets(PDO $pdo, int $orderId, array $nums): void
    {
        if (!$nums || !Mailer::enabled()) return;
        $o = $pdo->prepare("SELECT ro.*, r.name AS raffle_name, r.prize_description, r.draw_date FROM raffle_orders ro JOIN raffles r ON r.id = ro.raffle_id WHERE ro.id = ?");
        $o->execute([$orderId]); $order = $o->fetch();
        if (!$order || empty($order['buyer_email'])) return;
        $name = htmlspecialchars((string)$order['buyer_name'], ENT_QUOTES);
        $raffle = htmlspecialchars((string)$order['raffle_name'], ENT_QUOTES);
        $list = implode(', ', array_map(fn($n) => '#' . $n, $nums));
        $draw = !empty($order['draw_date']) ? '<p>Winner drawn: <strong>' . htmlspecialchars((string)$order['draw_date'], ENT_QUOTES) . '</strong>.</p>' : '';
        $html = "<p>Hi {$name},</p><p>Thank you for supporting the Tulsa Robotics Center! You're entered in the <strong>{$raffle}</strong> raffle with "
            . count($nums) . " ticket" . (count($nums) === 1 ? '' : 's') . ": <strong>{$list}</strong>.</p>{$draw}<p>Good luck!</p>";
        try { Mailer::send((string)$order['buyer_email'], 'Your raffle tickets — ' . $order['raffle_name'], $html); } catch (\Throwable $e) { /* best-effort */ }
    }

    // ── Admin: manage raffles ────────────────────────────────────────────────

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM raffles ORDER BY FIELD(status,'open','draft','closed','drawn','archived'), created_at DESC")->fetchAll();
        return Http::json($res, array_map(fn($r) => self::serialize($pdo, $r), $rows));
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $r = self::loadRaffle($pdo, (int)$route['raffle_id']);
        if (!$r) return Http::error($res, 'Raffle not found', 404);
        return Http::json($res, self::serialize($pdo, $r));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['name'] ?? ''));
        if ($name === '') return Http::error($res, 'A raffle name is required.', 422);
        $slug = self::uniqueSlug($pdo, $name);
        $pdo->prepare(
            "INSERT INTO raffles (name, prize_description, ticket_price, fine_print, sales_open_at, sales_close_at, draw_date, status, public_slug, event_id, created_by_id, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())"
        )->execute([
            $name, ($d['prize_description'] ?? null) ?: null,
            self::num($d['ticket_price'] ?? 5) ?? 5, ($d['fine_print'] ?? null) ?: null,
            ($d['sales_open_at'] ?? null) ?: null, ($d['sales_close_at'] ?? null) ?: null, ($d['draw_date'] ?? null) ?: null,
            in_array($d['status'] ?? '', self::STATUSES, true) ? $d['status'] : 'draft',
            $slug, !empty($d['event_id']) ? (int)$d['event_id'] : null, (int)$m['id'],
        ]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'raffles', $id, 'create', null, ['name' => $name]);
        return Http::json($res, self::serialize($pdo, self::loadRaffle($pdo, $id)), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['raffle_id'];
        if (!self::loadRaffle($pdo, $id)) return Http::error($res, 'Raffle not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'prize_description', 'fine_print', 'sales_open_at', 'sales_close_at', 'draw_date'] as $f) {
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = ($d[$f] === '' ? null : $d[$f]); }
        }
        if (array_key_exists('ticket_price', $d)) { $set[] = 'ticket_price = ?'; $args[] = self::num($d['ticket_price']) ?? 0; }
        if (array_key_exists('status', $d) && in_array($d['status'], self::STATUSES, true)) { $set[] = 'status = ?'; $args[] = $d['status']; }
        if (array_key_exists('event_id', $d)) { $set[] = 'event_id = ?'; $args[] = !empty($d['event_id']) ? (int)$d['event_id'] : null; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE raffles SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'raffles', $id, 'update', null, $d);
        return Http::json($res, self::serialize($pdo, self::loadRaffle($pdo, $id)));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['raffle_id'];
        $paid = $pdo->prepare("SELECT COUNT(*) FROM raffle_orders WHERE raffle_id = ? AND payment_status = 'paid'");
        $paid->execute([$id]);
        if ((int)$paid->fetchColumn() > 0) return Http::error($res, 'This raffle has paid ticket sales and can\'t be deleted. Archive it instead.', 409);
        $pdo->prepare("DELETE FROM raffle_tickets WHERE raffle_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM raffle_orders WHERE raffle_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM raffles WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'raffles', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /** GET /raffles/{id}/orders — every order (buyers) for a raffle. */
    public static function orders(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT * FROM raffle_orders WHERE raffle_id = ? ORDER BY created_at DESC");
        $s->execute([(int)$route['raffle_id']]);
        return Http::json($res, array_map(fn($o) => [
            'id' => (int)$o['id'], 'buyer_name' => $o['buyer_name'], 'buyer_email' => $o['buyer_email'], 'buyer_phone' => $o['buyer_phone'],
            'quantity' => (int)$o['quantity'], 'amount' => self::num($o['amount']),
            'sale_channel' => $o['sale_channel'], 'payment_status' => $o['payment_status'], 'payment_method' => $o['payment_method'],
            'created_at' => $o['created_at'], 'paid_at' => $o['paid_at'],
        ], $s->fetchAll()));
    }

    /** GET /raffles/{id}/tickets — paid tickets in number order (for the print sheet + draw). */
    public static function tickets(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rid = (int)$route['raffle_id'];
        $r = self::loadRaffle($pdo, $rid);
        if (!$r) return Http::error($res, 'Raffle not found', 404);
        $s = $pdo->prepare(
            "SELECT t.ticket_number, t.is_winner, o.buyer_name, o.buyer_email, o.buyer_phone
               FROM raffle_tickets t JOIN raffle_orders o ON o.id = t.order_id
              WHERE t.raffle_id = ? AND o.payment_status = 'paid'
              ORDER BY t.ticket_number"
        );
        $s->execute([$rid]);
        return Http::json($res, [
            'raffle' => ['id' => $rid, 'name' => $r['name'], 'prize_description' => $r['prize_description'], 'draw_date' => $r['draw_date']],
            'tickets' => array_map(fn($t) => [
                'ticket_number' => (int)$t['ticket_number'], 'is_winner' => (bool)$t['is_winner'],
                'buyer_name' => $t['buyer_name'], 'buyer_email' => $t['buyer_email'], 'buyer_phone' => $t['buyer_phone'],
            ], $s->fetchAll()),
        ]);
    }

    /** POST /raffles/{id}/booth-sale — record an in-person sale (cash/card) and issue tickets. */
    public static function boothSale(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rid = (int)$route['raffle_id'];
        $r = self::loadRaffle($pdo, $rid);
        if (!$r) return Http::error($res, 'Raffle not found', 404);
        if (in_array($r['status'], ['drawn', 'archived'], true)) return Http::error($res, 'This raffle is closed to new sales.', 409);
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['buyer_name'] ?? ''));
        $qty = max(1, (int)($d['quantity'] ?? 1));
        if ($name === '') return Http::error($res, 'A buyer name is required.', 422);
        $method = in_array($d['payment_method'] ?? '', ['cash', 'cc', 'check', 'other'], true) ? $d['payment_method'] : 'cash';
        $unit = (float)$r['ticket_price'];
        $amount = round($unit * $qty, 2);
        $fl = self::flagsFrom($d);
        $pdo->prepare(
            "INSERT INTO raffle_orders (raffle_id, buyer_name, buyer_email, buyer_phone, interested_program, interested_volunteer, interested_sponsor, stay_in_touch, quantity, unit_price, amount, sale_channel, payment_status, payment_method, recorded_by_id, created_at, paid_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?, 'booth', 'paid', ?, ?, NOW(), NOW())"
        )->execute([$rid, $name, ($d['buyer_email'] ?? null) ?: null, ($d['buyer_phone'] ?? null) ?: null,
            $fl['interested_program'], $fl['interested_volunteer'], $fl['interested_sponsor'], $fl['stay_in_touch'],
            $qty, $unit, $amount, $method, (int)$m['id']]);
        $orderId = (int)$pdo->lastInsertId();
        $nums = self::issueTicketsForOrder($pdo, $orderId);
        self::emailBuyerTickets($pdo, $orderId, $nums);
        self::routeBuyerInterests($pdo, $orderId);
        Audit::write($pdo, (int)$m['id'], 'raffle_orders', $orderId, 'booth_sale', null, ['qty' => $qty, 'amount' => $amount, 'method' => $method]);
        return Http::json($res, ['order_id' => $orderId, 'ticket_numbers' => $nums, 'amount' => $amount], 201);
    }

    /** POST /raffles/{id}/draw — pick a random paid ticket as the winner. */
    public static function drawWinner(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::staff($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $rid = (int)$route['raffle_id'];
        $r = self::loadRaffle($pdo, $rid);
        if (!$r) return Http::error($res, 'Raffle not found', 404);
        if ($r['winner_ticket_id'] !== null && empty(((array)$req->getParsedBody())['redraw'])) {
            return Http::error($res, 'A winner has already been drawn. Pass redraw to draw again.', 409);
        }
        // Random paid ticket. RAND() is fine for a single draw; the pool is small.
        $s = $pdo->prepare(
            "SELECT t.id, t.ticket_number, o.buyer_name, o.buyer_email, o.buyer_phone
               FROM raffle_tickets t JOIN raffle_orders o ON o.id = t.order_id
              WHERE t.raffle_id = ? AND o.payment_status = 'paid'
              ORDER BY RAND() LIMIT 1"
        );
        $s->execute([$rid]);
        $win = $s->fetch();
        if (!$win) return Http::error($res, 'No paid tickets to draw from yet.', 409);
        $pdo->prepare("UPDATE raffle_tickets SET is_winner = 0 WHERE raffle_id = ?")->execute([$rid]);
        $pdo->prepare("UPDATE raffle_tickets SET is_winner = 1 WHERE id = ?")->execute([(int)$win['id']]);
        $pdo->prepare("UPDATE raffles SET winner_ticket_id = ?, winner_drawn_at = NOW(), status = 'drawn', updated_at = NOW() WHERE id = ?")
            ->execute([(int)$win['id'], $rid]);
        Audit::write($pdo, (int)$m['id'], 'raffles', $rid, 'draw_winner', null, ['ticket_number' => (int)$win['ticket_number']]);
        return Http::json($res, [
            'ticket_number' => (int)$win['ticket_number'],
            'buyer_name' => $win['buyer_name'], 'buyer_email' => $win['buyer_email'], 'buyer_phone' => $win['buyer_phone'],
        ]);
    }

    // ── Public: the guest signup page ────────────────────────────────────────

    /** GET /public/raffle/{slug} — raffle info for the signup form (no auth). */
    public static function publicGet(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $r = self::loadRaffleBySlug($pdo, (string)$route['slug']);
        if (!$r) return Http::error($res, 'Raffle not found', 404);
        return Http::json($res, [
            'name' => $r['name'], 'prize_description' => $r['prize_description'],
            'ticket_price' => self::num($r['ticket_price']), 'fine_print' => $r['fine_print'],
            'draw_date' => $r['draw_date'], 'status' => $r['status'],
            'sale_open' => self::saleOpen($r),
        ]);
    }

    /**
     * POST /public/raffle/{slug}/purchase — a guest buys tickets online (no auth). Creates a
     * pending order + starts a hosted card checkout; tickets are issued (and interests routed)
     * only once the payment clears via the webhook/return. Returns a redirect_url to the
     * provider's hosted checkout.
     */
    public static function publicPurchase(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $r = self::loadRaffleBySlug($pdo, (string)$route['slug']);
        if (!$r) return Http::error($res, 'Raffle not found', 404);
        if (!self::saleOpen($r)) return Http::error($res, 'Ticket sales for this raffle are closed.', 409);
        $d = (array)$req->getParsedBody();
        $name = trim((string)($d['buyer_name'] ?? ''));
        $email = trim((string)($d['buyer_email'] ?? ''));
        $qty = max(1, min(100, (int)($d['quantity'] ?? 1)));
        if ($name === '') return Http::error($res, 'Please enter your name.', 422);
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'Please enter a valid email so we can send your tickets.', 422);
        $unit = (float)$r['ticket_price'];
        $amount = round($unit * $qty, 2);
        if ($amount <= 0) return Http::error($res, 'This raffle has no ticket price set.', 400);

        $fl = self::flagsFrom($d);
        $pdo->prepare(
            "INSERT INTO raffle_orders (raffle_id, buyer_name, buyer_email, buyer_phone, interested_program, interested_volunteer, interested_sponsor, stay_in_touch, quantity, unit_price, amount, sale_channel, payment_status, payment_method, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?, 'online', 'pending', 'cc', NOW())"
        )->execute([(int)$r['id'], $name, $email, ($d['buyer_phone'] ?? null) ?: null,
            $fl['interested_program'], $fl['interested_volunteer'], $fl['interested_sponsor'], $fl['stay_in_touch'],
            $qty, $unit, $amount]);
        $orderId = (int)$pdo->lastInsertId();

        try {
            $out = PaymentsController::beginPublicCheckout($pdo, 'raffle_order', $orderId, $amount,
                isset($d['provider']) ? (string)$d['provider'] : null,
                $qty . ' raffle ticket' . ($qty === 1 ? '' : 's') . ' — ' . $r['name'], $email);
        } catch (\Throwable $e) {
            $pdo->prepare("UPDATE raffle_orders SET payment_status='void' WHERE id=?")->execute([$orderId]);
            return Http::error($res, 'Could not start the payment. Please try again, or pay at the booth.', 502);
        }
        $pdo->prepare("UPDATE raffle_orders SET payment_id=? WHERE id=?")->execute([(int)$out['payment_id'], $orderId]);
        return Http::json($res, ['order_id' => $orderId, 'redirect_url' => $out['redirect_url']]);
    }
}
