<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\PaymentSettings;
use App\Core\Permissions;
use App\Core\Payments\PaymentProvider;
use App\Core\Payments\PayPalProvider;
use App\Core\Payments\SquareProvider;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Provider-agnostic online payments. Currently wired to enrollment fees; the
 * ledger + provider abstraction are reusable for camp/sponsor later.
 *
 * Card data never reaches this app — providers host checkout (PCI SAQ A). Flow:
 *   pay() → provider.createCheckout() → redirect the payer to the provider →
 *   payer approves → return()/webhook() confirm → reconcile() stamps the source.
 */
final class PaymentsController
{
    /** @return array<string,PaymentProvider> */
    private static function providers(): array
    {
        return ['square' => new SquareProvider(), 'paypal' => new PayPalProvider()];
    }

    private static function paymentsEnabled(): bool
    {
        return filter_var(Config::get('PAYMENTS_ENABLED', 'false'), FILTER_VALIDATE_BOOLEAN);
    }

    private static function appUrl(): string
    {
        return rtrim((string)Config::get('APP_URL', 'http://localhost:5173'), '/');
    }

    private static function apiUrl(): string
    {
        // Base for provider redirects/webhooks back into this API.
        return rtrim((string)Config::get('API_URL', self::appUrl()), '/');
    }

    /** Lowercased single-value header map for signature checks. */
    private static function headers(Request $req): array
    {
        $out = [];
        foreach ($req->getHeaders() as $k => $v) $out[strtolower($k)] = is_array($v) ? ($v[0] ?? '') : $v;
        return $out;
    }

    /**
     * Gross-up so TRC nets the full base after the processor's cut is taken on
     * the TOTAL charged: total = (base + fixed) / (1 - pct/100); fee = total-base.
     * @return array{fee:float,total:float}
     */
    private static function feeQuote(PDO $pdo, PaymentProvider $p, float $base): array
    {
        $ov = PaymentSettings::providerFeeOverride($pdo, $p->key());
        $pctVal = $ov['fee_percent'] !== null ? $ov['fee_percent'] : $p->feePercent();
        $fixedVal = $ov['fee_fixed'] !== null ? $ov['fee_fixed'] : $p->feeFixed();
        $pct = $pctVal / 100.0;
        $total = $pct < 1 ? ($base + $fixedVal) / (1 - $pct) : $base;
        $total = round($total, 2);
        return ['fee' => round($total - $base, 2), 'total' => $total];
    }

    /**
     * Start a hosted card checkout for a PUBLIC / guest purchase (e.g. a raffle order). Creates
     * the payments ledger row (member_id NULL) and the provider checkout. On payment the shared
     * reconcile() applies the effect for the source_type. Returns [payment_id, redirect_url];
     * throws on any failure so the caller can void its order.
     *
     * @return array{payment_id:int,redirect_url:string}
     */
    public static function beginPublicCheckout(PDO $pdo, string $sourceType, int $sourceId, float $amount, ?string $providerKey, string $description, ?string $payerEmail): array
    {
        if (!self::paymentsEnabled()) throw new \RuntimeException('Online payments are not enabled.');
        $providers = self::providers();
        $key = ($providerKey !== null && isset($providers[$providerKey])) ? $providerKey : array_key_first($providers);
        $provider = $providers[$key];

        $pdo->prepare(
            "INSERT INTO payments (provider, source_type, source_id, member_id, amount, currency, status, created_at)
             VALUES (?, ?, ?, NULL, ?, 'USD', 'created', NOW())"
        )->execute([$key, $sourceType, $sourceId, round($amount, 2)]);
        $paymentId = (int)$pdo->lastInsertId();

        $checkout = $provider->createCheckout([
            'amount' => round($amount, 2),
            'currency' => 'USD',
            'reference' => "$sourceType:$sourceId:payment:$paymentId",
            'description' => $description,
            'return_url' => self::apiUrl() . "/api/v1/payments/return/$paymentId",
            'cancel_url' => self::apiUrl() . "/api/v1/payments/cancel/$paymentId",
            'payer_email' => $payerEmail ?: null,
        ]);
        $pdo->prepare("UPDATE payments SET provider_ref=?, updated_at=NOW() WHERE id=?")
            ->execute([$checkout['provider_ref'], $paymentId]);
        return ['payment_id' => $paymentId, 'redirect_url' => $checkout['redirect_url']];
    }

    /** A provider is offerable only when configured in .env AND enabled in Admin. */
    private static function available(PDO $pdo, PaymentProvider $p): bool
    {
        return $p->isConfigured() && PaymentSettings::providerEnabled($pdo, $p->key());
    }

    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return $y . '-' . ($y + 1);
    }

    /**
     * A youth still 'waiting' on the list this season shouldn't pay yet. Once
     * they've been formally 'offered' a spot (or accepted), they may pay.
     */
    private static function isWaitlisted(PDO $pdo, int $mid): bool
    {
        // Only a YOUTH can be waitlisted. A parent/mentor/volunteer never is — this guards
        // against a waitlist entry that got carried onto a non-youth member (e.g. a parent
        // who was entered as the waitlisted "visitor" and later converted to a member).
        $s = $pdo->prepare(
            "SELECT 1 FROM waitlist_entries we
               JOIN members m ON m.id = we.member_id
              WHERE we.member_id = ? AND we.status = 'waiting' AND we.season = ?
                AND m.member_type = 'youth' LIMIT 1");
        $s->execute([$mid, self::currentSeason()]);
        return (bool)$s->fetchColumn();
    }

    /** POST /members/{id}/shirt-size — confirm a youth's shirt size without paying. */
    public static function saveMemberShirt(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if (!self::canPayFor($pdo, $cur, $mid)) return Http::error($res, 'Access denied', 403);
        $shirt = mb_substr(trim((string)(((array)$req->getParsedBody())['shirt_size'] ?? '')), 0, 10);
        if ($shirt === '') return Http::error($res, 'Please choose a shirt size.', 422);
        $pdo->prepare("UPDATE members SET shirt_size = ? WHERE id = ?")->execute([$shirt, $mid]);
        return Http::json($res, ['ok' => true, 'shirt_size' => $shirt]);
    }

    /** GET /payments/manual-methods — enabled admin-recorded methods (for the record dropdown). */
    public static function manualMethods(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, PaymentSettings::manualMethods($pdo, true));
    }

    // ── Quote: base + per-provider fee/total for the UI's "cover fee" toggle ─
    public static function enrollmentQuote(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['enrollment_id'];
        $enr = self::enrollment($pdo, $eid);
        if (!$enr) return Http::error($res, 'Enrollment not found', 404);
        if (!self::canPayFor($pdo, $cur, (int)$enr['member_id'])) return Http::error($res, 'Access denied', 403);
        $base = round((float)($enr['amount_due'] ?? 0) - (float)($enr['payment_amount'] ?? 0), 2);
        $providers = [];
        if (self::paymentsEnabled()) {
            foreach (self::providers() as $p) {
                if (!self::available($pdo, $p)) continue;
                $q = self::feeQuote($pdo, $p, $base);
                $providers[] = ['key' => $p->key(), 'label' => $p->label(), 'fee' => $q['fee'], 'total_with_fee' => $q['total']];
            }
        }
        return Http::json($res, ['base' => max(0, $base), 'enabled' => $providers !== [], 'providers' => $providers]);
    }

    // ── Public: which providers can the UI offer? ───────────────────────────
    public static function options(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $enabled = self::paymentsEnabled();
        $list = [];
        if ($enabled) {
            foreach (self::providers() as $p) {
                if (!self::available($pdo, $p)) continue;
                $ov = PaymentSettings::providerFeeOverride($pdo, $p->key());
                $list[] = ['key' => $p->key(), 'label' => $p->label(),
                    'fee_pct' => $ov['fee_percent'] !== null ? $ov['fee_percent'] : $p->feePercent(),
                    'fee_fixed' => $ov['fee_fixed'] !== null ? $ov['fee_fixed'] : $p->feeFixed()];
            }
        }
        return Http::json($res, ['enabled' => $enabled && $list !== [], 'providers' => $list]);
    }

    // ── Start a payment for an enrollment ───────────────────────────────────
    public static function payEnrollment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::paymentsEnabled()) return Http::error($res, 'Online payments are not enabled.', 400);

        $eid = (int)$route['enrollment_id'];
        $enr = self::enrollment($pdo, $eid);
        if (!$enr) return Http::error($res, 'Enrollment not found', 404);
        if (!self::canPayFor($pdo, $cur, (int)$enr['member_id'])) return Http::error($res, 'Access denied', 403);

        $providerKey = (string)(((array)$req->getParsedBody())['provider'] ?? '');
        $provider = self::providers()[$providerKey] ?? null;
        if (!$provider || !self::available($pdo, $provider)) return Http::error($res, 'That payment method is unavailable.', 400);

        $base = round((float)($enr['amount_due'] ?? 0) - (float)($enr['payment_amount'] ?? 0), 2);
        if ($base <= 0) return Http::error($res, 'This enrollment has nothing due.', 400);

        // Optional: payer covers the processing fee so TRC nets the full base.
        $coverFee = filter_var(((array)$req->getParsedBody())['cover_fee'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $fee = 0.0; $total = $base;
        if ($coverFee) { $q = self::feeQuote($pdo, $provider, $base); $fee = $q['fee']; $total = $q['total']; }

        // Ledger row first, so we can correlate the provider callback back to it.
        $pdo->prepare(
            "INSERT INTO payments (provider, source_type, source_id, member_id, amount, base_amount, fee_amount, fee_covered, currency, status, created_by_id, created_at)
             VALUES (?, 'enrollment', ?, ?, ?, ?, ?, ?, 'USD', 'created', ?, NOW())"
        )->execute([$providerKey, $eid, (int)$enr['member_id'], $total, $base, $fee, $coverFee ? 1 : 0, (int)$cur['id']]);
        $paymentId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'payments', $paymentId, 'payment.initiate', null, ['source' => 'enrollment', 'enrollment_id' => $eid, 'member_id' => (int)$enr['member_id'], 'amount' => $total]);

        try {
            $checkout = $provider->createCheckout([
                'amount' => $total,
                'currency' => 'USD',
                'reference' => "enrollment:$eid:payment:$paymentId",
                'description' => $coverFee ? 'TRC enrollment fee (incl. processing fee)' : 'TRC enrollment fee',
                'return_url' => self::apiUrl() . "/api/v1/payments/return/$paymentId",
                'cancel_url' => self::apiUrl() . "/api/v1/payments/cancel/$paymentId",
                'payer_email' => null,
            ]);
        } catch (\Throwable $e) {
            $pdo->prepare("UPDATE payments SET status='failed', error_detail=?, updated_at=NOW() WHERE id=?")
                ->execute([mb_substr($e->getMessage(), 0, 400), $paymentId]);
            return Http::error($res, 'Could not start the payment. Please try again.', 502);
        }

        $pdo->prepare("UPDATE payments SET provider_ref=?, updated_at=NOW() WHERE id=?")
            ->execute([$checkout['provider_ref'], $paymentId]);
        return Http::json($res, ['payment_id' => $paymentId, 'redirect_url' => $checkout['redirect_url']]);
    }

    /** Whether online payment is available at all (enabled + a configured provider). */
    public static function paymentsPublicEnabled(PDO $pdo): bool
    {
        if (!self::paymentsEnabled()) return false;
        foreach (self::providers() as $p) if (self::available($pdo, $p)) return true;
        return false;
    }

    /**
     * POST /enrollment/installments/{installment_id}/pay-online  { provider, cover_fee? }
     * Family pays a single payment-plan installment by card. On success the webhook
     * marks the installment paid and reconciles the enrollment.
     */
    public static function payInstallment(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::paymentsEnabled()) return Http::error($res, 'Online payments are not enabled.', 400);
        $iid = (int)$route['installment_id'];
        $inst = $pdo->prepare(
            "SELECT i.*, e.member_id FROM enrollment_installments i JOIN enrollments e ON e.id = i.enrollment_id WHERE i.id = ?");
        $inst->execute([$iid]);
        $row = $inst->fetch();
        if (!$row) return Http::error($res, 'Installment not found', 404);
        if ($row['status'] === 'paid') return Http::error($res, 'This installment is already paid.', 409);
        if (!self::canPayFor($pdo, $cur, (int)$row['member_id'])) return Http::error($res, 'Access denied', 403);

        $d = (array)$req->getParsedBody();
        $provider = self::providers()[(string)($d['provider'] ?? '')] ?? null;
        if (!$provider || !self::available($pdo, $provider)) return Http::error($res, 'That payment method is unavailable.', 400);
        $base = (float)$row['amount'];
        if ($base <= 0) return Http::error($res, 'Nothing due on this installment.', 400);
        $coverFee = filter_var($d['cover_fee'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $fee = 0.0; $total = $base;
        if ($coverFee) { $q = self::feeQuote($pdo, $provider, $base); $fee = $q['fee']; $total = $q['total']; }

        $pdo->prepare(
            "INSERT INTO payments (provider, source_type, source_id, member_id, amount, base_amount, fee_amount, fee_covered, currency, status, created_by_id, created_at)
             VALUES (?, 'installment', ?, ?, ?, ?, ?, ?, 'USD', 'created', ?, NOW())"
        )->execute([$provider->key(), $iid, (int)$row['member_id'], $total, $base, $fee, $coverFee ? 1 : 0, (int)$cur['id']]);
        $paymentId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'payments', $paymentId, 'payment.initiate', null, ['source' => 'installment', 'installment_id' => $iid]);
        try {
            $checkout = $provider->createCheckout([
                'amount' => $total, 'currency' => 'USD',
                'reference' => "installment:$iid:payment:$paymentId",
                'description' => 'TRC enrollment payment' . ($coverFee ? ' (incl. processing fee)' : ''),
                'return_url' => self::apiUrl() . "/api/v1/payments/return/$paymentId",
                'cancel_url' => self::apiUrl() . "/api/v1/payments/cancel/$paymentId",
                'payer_email' => null,
            ]);
        } catch (\Throwable $e) {
            $pdo->prepare("UPDATE payments SET status='failed', error_detail=?, updated_at=NOW() WHERE id=?")->execute([mb_substr($e->getMessage(), 0, 400), $paymentId]);
            return Http::error($res, 'Could not start the payment. Please try again.', 502);
        }
        $pdo->prepare("UPDATE payments SET provider_ref=?, updated_at=NOW() WHERE id=?")->execute([$checkout['provider_ref'], $paymentId]);
        return Http::json($res, ['payment_id' => $paymentId, 'redirect_url' => $checkout['redirect_url']]);
    }

    // ── Combined per-youth payment (FTC + FRC together) ─────────────────────
    /** A youth's unpaid enrollments with a balance, each with its T&C state. */
    private static function payableEnrollments(PDO $pdo, int $memberId): array
    {
        $s = $pdo->prepare(
            "SELECT e.id, e.amount_due, e.payment_amount, e.enrollment_year,
                    e.tc_youth_agreed, e.tc_parent_agreed,
                    p.name AS program_name, p.full_name AS program_full_name
             FROM enrollments e LEFT JOIN programs p ON p.id = e.program_id
             WHERE e.member_id = ?
               AND e.date_payment IS NULL
               -- #190: payment-override enrollments with a real balance are still CC-payable
               AND (COALESCE(e.amount_due,0) - COALESCE(e.payment_amount,0)) > 0
             ORDER BY e.enrollment_year DESC, p.name");
        $s->execute([$memberId]);
        $out = [];
        foreach ($s->fetchAll() as $e) {
            $yr = (int)$e['enrollment_year'];
            $out[] = [
                'enrollment_id' => (int)$e['id'],
                'label' => ($e['program_full_name'] ?: $e['program_name'] ?: 'Enrollment') . ' · ' . $yr . '–' . ($yr + 1),
                'balance' => round((float)($e['amount_due'] ?? 0) - (float)($e['payment_amount'] ?? 0), 2),
                'fully_signed' => (bool)$e['tc_youth_agreed'] && (bool)$e['tc_parent_agreed'],
            ];
        }
        return $out;
    }

    // GET /members/{id}/pay-quote — combined breakdown + per-provider totals.
    public static function memberPayQuote(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if (!self::canPayFor($pdo, $cur, $mid)) return Http::error($res, 'Access denied', 403);
        // Only enrollments whose T&C signatures are complete can be paid; the rest
        // are surfaced so the UI can prompt to finish signing first.
        $all = self::payableEnrollments($pdo, $mid);
        $signed = array_values(array_filter($all, fn($i) => $i['fully_signed']));
        $unsigned = array_values(array_filter($all, fn($i) => !$i['fully_signed']));
        $base = round(array_sum(array_map(fn($i) => $i['balance'], $signed)), 2);
        $providers = [];
        if (self::paymentsEnabled()) {
            foreach (self::providers() as $p) {
                if (!self::available($pdo, $p)) continue;
                $q = self::feeQuote($pdo, $p, $base);
                $providers[] = ['key' => $p->key(), 'label' => $p->label(), 'fee' => $q['fee'], 'total_with_fee' => $q['total']];
            }
        }
        $ss = $pdo->prepare("SELECT shirt_size FROM members WHERE id = ?"); $ss->execute([$mid]);
        return Http::json($res, [
            'base' => $base, 'enabled' => $providers !== [],
            'enrollments' => $signed, 'unsigned_enrollments' => $unsigned, 'providers' => $providers,
            'shirt_size' => (string)($ss->fetchColumn() ?: ''),
            'waitlisted' => self::isWaitlisted($pdo, $mid),
        ]);
    }

    // POST /members/{id}/pay-enrollments — one checkout for all of a youth's dues.
    public static function payMemberEnrollments(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::paymentsEnabled()) return Http::error($res, 'Online payments are not enabled.', 400);
        $mid = (int)$route['member_id'];
        if (!self::canPayFor($pdo, $cur, $mid)) return Http::error($res, 'Access denied', 403);
        if (self::isWaitlisted($pdo, $mid)) return Http::error($res, 'This youth is on the waitlist — no registration payment is needed yet.', 422);

        $d = (array)$req->getParsedBody();
        $providerKey = (string)($d['provider'] ?? '');
        $provider = self::providers()[$providerKey] ?? null;
        if (!$provider || !self::available($pdo, $provider)) return Http::error($res, 'That payment method is unavailable.', 400);

        // Only enrollments with completed T&C signatures are payable. Parents must
        // finish the enrollment Terms & Conditions before they can check out.
        $items = array_values(array_filter(self::payableEnrollments($pdo, $mid), fn($i) => $i['fully_signed']));
        if (!$items) return Http::error($res, 'Please complete the enrollment Terms & Conditions before paying.', 422);

        // Confirm the youth's shirt size at checkout. Stored on the MEMBER only —
        // the single source of truth for a member's size.
        $shirt = mb_substr(trim((string)($d['shirt_size'] ?? '')), 0, 10);
        if ($shirt === '') return Http::error($res, "Please confirm the youth's shirt size before paying.", 422);
        $pdo->prepare("UPDATE members SET shirt_size = ? WHERE id = ?")->execute([$shirt, $mid]);

        $enrollBase = round(array_sum(array_map(fn($i) => $i['balance'], $items)), 2);
        if ($enrollBase <= 0) return Http::error($res, 'There is nothing due for this member.', 400);
        // An optional donation is added to the same charge (one Square transaction).
        $donation = max(0.0, round((float)($d['donation_amount'] ?? 0), 2));
        $base = round($enrollBase + $donation, 2);
        $coverFee = filter_var($d['cover_fee'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $fee = 0.0; $total = $base;
        if ($coverFee) { $q = self::feeQuote($pdo, $provider, $base); $fee = $q['fee']; $total = $q['total']; }

        $pdo->prepare(
            "INSERT INTO payments (provider, source_type, source_id, member_id, amount, base_amount, donation_amount, fee_amount, fee_covered, currency, status, created_by_id, created_at)
             VALUES (?, 'enrollment_group', ?, ?, ?, ?, ?, ?, ?, 'USD', 'created', ?, NOW())"
        )->execute([$providerKey, $mid, $mid, $total, $enrollBase, $donation, $fee, $coverFee ? 1 : 0, (int)$cur['id']]);
        $paymentId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'payments', $paymentId, 'payment.initiate', null, ['source' => 'enrollment_group', 'member_id' => $mid, 'donation' => $donation, 'amount' => $total]);
        $link = $pdo->prepare("INSERT INTO payment_enrollments (payment_id, enrollment_id, base_amount) VALUES (?,?,?)");
        foreach ($items as $i) $link->execute([$paymentId, $i['enrollment_id'], $i['balance']]);

        try {
            $desc = 'TRC enrollment fees' . ($donation > 0 ? ' + donation' : '') . ($coverFee ? ' (incl. processing fee)' : '');
            $checkout = $provider->createCheckout([
                'amount' => $total, 'currency' => 'USD',
                'reference' => "member:$mid:payment:$paymentId",
                'description' => $desc,
                'return_url' => self::apiUrl() . "/api/v1/payments/return/$paymentId",
                'cancel_url' => self::apiUrl() . "/api/v1/payments/cancel/$paymentId",
                'payer_email' => null,
            ]);
        } catch (\Throwable $e) {
            $pdo->prepare("UPDATE payments SET status='failed', error_detail=?, updated_at=NOW() WHERE id=?")
                ->execute([mb_substr($e->getMessage(), 0, 400), $paymentId]);
            return Http::error($res, 'Could not start the payment. Please try again.', 502);
        }
        $pdo->prepare("UPDATE payments SET provider_ref=?, updated_at=NOW() WHERE id=?")
            ->execute([$checkout['provider_ref'], $paymentId]);
        return Http::json($res, ['payment_id' => $paymentId, 'redirect_url' => $checkout['redirect_url']]);
    }

    // ── Parent family combined checkout ─────────────────────────────────────

    /** Enrollment-fee schedule (base + sibling tiers + additional program), #66. */
    private static function feesSchedule(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'enrollment_fees'");
        $s->execute();
        $v = ($r = $s->fetch()) && $r['values'] ? (json_decode((string)$r['values'], true) ?: []) : [];
        $base = (float)($v['base'] ?? 0);
        return [
            'base' => $base,
            'additional_program' => (float)($v['additional_program'] ?? 0),
            'second_youth_base' => isset($v['second_youth_base']) ? (float)$v['second_youth_base'] : $base,
            'third_plus_youth_base' => isset($v['third_plus_youth_base']) ? (float)$v['third_plus_youth_base'] : $base,
        ];
    }
    private static function tierFor(array $fees, int $rank): float
    {
        if ($rank >= 3) return $fees['third_plus_youth_base'];
        if ($rank === 2) return $fees['second_youth_base'];
        return $fees['base'];
    }

    /** The youth in the current user's family (empty if the viewer is a youth). */
    private static function familyYouthIds(PDO $pdo, int $memberId): array
    {
        $who = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $who->execute([$memberId]);
        if (($who->fetchColumn() ?: '') === 'youth') return [];
        $fam = $pdo->prepare("SELECT family_id FROM family_members WHERE member_id = ?");
        $fam->execute([$memberId]);
        $fids = array_map('intval', array_column($fam->fetchAll(), 'family_id'));
        if (!$fids) return [];
        $in = implode(',', array_fill(0, count($fids), '?'));
        $s = $pdo->prepare("SELECT DISTINCT m.id FROM family_members fm JOIN members m ON m.id = fm.member_id
                            WHERE fm.family_id IN ($in) AND m.member_type = 'youth' AND m.is_active = 1 ORDER BY m.id");
        $s->execute($fids);
        return array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN));
    }

    /**
     * Every payable enrollment for a family's youth in the current season, joined with
     * youth + T&C/shirt readiness. One row per enrollment.
     */
    private static function familyPayable(PDO $pdo, array $youthIds, int $year): array
    {
        if (!$youthIds) return [];
        $in = implode(',', array_fill(0, count($youthIds), '?'));
        $s = $pdo->prepare(
            "SELECT e.id, e.member_id, e.program_id, e.enrollment_year, e.amount_due, e.payment_amount, e.amount_due_overridden,
                    e.tc_youth_agreed, e.tc_parent_agreed, e.scholarship_fund,
                    COALESCE((SELECT SUM(w.amount) FROM scholarship_awards w
                               WHERE w.enrollment_id = e.id AND w.status = 'applied'), 0) AS scholarship_credit,
                    m.first_name, m.last_name, m.shirt_size AS member_shirt,
                    p.name AS program_name, p.full_name AS program_full_name
               FROM enrollments e
               JOIN members m ON m.id = e.member_id
               LEFT JOIN programs p ON p.id = e.program_id
              WHERE e.member_id IN ($in) AND e.enrollment_year = ?
                AND e.date_payment IS NULL
                -- #190: payment-override enrollments with a real balance are still CC-payable
                AND (COALESCE(e.amount_due,0) - COALESCE(e.payment_amount,0)) > 0
              ORDER BY m.id, p.name");
        $s->execute(array_merge($youthIds, [$year]));
        return $s->fetchAll();
    }

    /** Count DISTINCT youth in a family who already have a PAID enrollment this year. */
    private static function paidYouthCount(PDO $pdo, array $youthIds, int $year): int
    {
        if (!$youthIds) return 0;
        $in = implode(',', array_fill(0, count($youthIds), '?'));
        $s = $pdo->prepare("SELECT COUNT(DISTINCT member_id) FROM enrollments
                            WHERE member_id IN ($in) AND enrollment_year = ? AND status = 'paid'");
        $s->execute(array_merge($youthIds, [$year]));
        return (int)$s->fetchColumn();
    }

    /**
     * The season the family checkout should target. Normally the current enrollment
     * year, but registrations for the NEXT season are created in the summer (the
     * Season Transition) before the calendar rolls over — so if the only unpaid
     * enrollments a family has are for a later year, target that year instead. This
     * lets parents pay next season's registration during the pre-season window rather
     * than waiting until August. Falls back to the current year when nothing is due.
     */
    private static function targetPayYear(PDO $pdo, array $youthIds): int
    {
        $current = \App\Core\EnrollmentService::currentEnrollmentYear();
        if (!$youthIds) return $current;
        $in = implode(',', array_fill(0, count($youthIds), '?'));
        $s = $pdo->prepare(
            "SELECT MAX(enrollment_year) FROM enrollments
              WHERE member_id IN ($in) AND enrollment_year >= ?
                AND date_payment IS NULL
                -- #190: payment-override enrollments with a real balance are still CC-payable
                AND (COALESCE(amount_due,0) - COALESCE(payment_amount,0)) > 0");
        $s->execute(array_merge($youthIds, [$current]));
        $y = $s->fetchColumn();
        return $y !== null && $y !== false ? (int)$y : $current;
    }

    /**
     * Authoritative per-enrollment prices for a SELECTED set: each line is charged its
     * outstanding balance (amount_due − payment_amount). The sibling tier is already stored
     * in amount_due at signup, so it is NOT re-derived here (see body). Admin overrides — which
     * simply set amount_due — are respected the same way, since balance reads straight off it.
     * $paidYouth/$fees are retained for signature stability but no longer used.
     * @return array<int,array{enrollment_id:int,member_id:int,price:float,label:string,youth_name:string}>
     */
    private static function familyLineItems(PDO $pdo, array $payable, array $selectedIds, int $paidYouth, array $fees): array
    {
        $selected = array_values(array_filter($payable, fn($e) => in_array((int)$e['id'], $selectedIds, true)));
        // The sibling tier (base / 2nd-youth / 3rd+, and the flat additional-program fee) is
        // already baked into each enrollment's amount_due when it is created (computeAmountDue
        // at signup / rollover). So the price to charge is simply the outstanding BALANCE.
        //
        // We deliberately do NOT re-derive the tier from payment order here: doing so
        // double-applied the discount when siblings paid separately — e.g. the 2nd youth pays
        // her stored 2nd-youth price first, which then made the paid-youth offset re-rank the
        // FIRST youth down to the 2nd-youth tier too, so neither child was ever charged the
        // base fee. Trusting the stored amount_due keeps the family total stable regardless of
        // who pays first or in how many transactions.
        $out = [];
        foreach ($selected as $e) {
            $price = round((float)($e['amount_due'] ?? 0) - (float)($e['payment_amount'] ?? 0), 2);
            $out[] = [
                'enrollment_id' => (int)$e['id'], 'member_id' => (int)$e['member_id'], 'price' => $price,
                'youth_name' => trim($e['first_name'] . ' ' . $e['last_name']),
                'label' => ($e['program_full_name'] ?: $e['program_name'] ?: 'Enrollment'),
            ];
        }
        return $out;
    }

    /**
     * GET /members/me/family-pay-quote — the parent's whole-family checkout data:
     * each youth with their payable enrollments, T&C/shirt readiness blockers, the
     * fee schedule + already-paid rank offset (so the UI can price any selection
     * live), and the available providers.
     */
    public static function familyPayQuote(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $youthIds = self::familyYouthIds($pdo, (int)$cur['id']);
        $year = self::targetPayYear($pdo, $youthIds);
        $fees = self::feesSchedule($pdo);
        $paidYouth = self::paidYouthCount($pdo, $youthIds, $year);
        $payable = self::familyPayable($pdo, $youthIds, $year);

        // Group into per-youth cards with readiness flags.
        $byYouth = [];
        foreach ($payable as $e) {
            $mid = (int)$e['member_id'];
            $byYouth[$mid] ??= ['member_id' => $mid, 'name' => trim($e['first_name'] . ' ' . $e['last_name']),
                                'waitlisted' => self::isWaitlisted($pdo, $mid), 'enrollments' => []];
            $shirtOk = trim((string)($e['member_shirt'] ?? '')) !== '';
            $tcOk = (bool)$e['tc_youth_agreed'] && (bool)$e['tc_parent_agreed'];
            $yr = (int)$e['enrollment_year'] ?? $year;
            $credit = round((float)($e['scholarship_credit'] ?? 0), 2);
            $byYouth[$mid]['enrollments'][] = [
                'enrollment_id' => (int)$e['id'], 'program_id' => (int)$e['program_id'],
                'label' => ($e['program_full_name'] ?: $e['program_name'] ?: 'Enrollment'),
                'balance' => round((float)($e['amount_due'] ?? 0) - (float)($e['payment_amount'] ?? 0), 2),
                'amount_due_overridden' => (bool)$e['amount_due_overridden'],
                // Scholarship applied to this enrollment (from applied awards), for the
                // itemized credit line: fee_gross = net fee + credit (the fee before the award).
                'scholarship_credit' => $credit,
                'scholarship_fund' => $e['scholarship_fund'],
                'fee_gross' => round((float)($e['amount_due'] ?? 0) + $credit, 2),
                'fully_signed' => $tcOk, 'shirt_ok' => $shirtOk,
                'ready' => $tcOk && $shirtOk && !self::isWaitlisted($pdo, $mid),
            ];
        }
        $providers = [];
        if (self::paymentsEnabled()) {
            foreach (self::providers() as $p) {
                if (self::available($pdo, $p)) $providers[] = ['key' => $p->key(), 'label' => $p->label()];
            }
        }
        return Http::json($res, [
            'year' => $year, 'year_label' => $year . '–' . ($year + 1),
            'fees' => $fees, 'paid_youth_count' => $paidYouth,
            'youth' => array_values($byYouth), 'enabled' => $providers !== [], 'providers' => $providers,
        ]);
    }

    /**
     * POST /members/me/pay-family — one invoice across several youth + optional donation.
     * Body: { provider, enrollment_ids:[], donation_amount?, cover_fee? }. Prices are
     * recomputed server-side (dynamic sibling tiers over the selection); only ready
     * (signed + shirt) non-waitlisted enrollments in the family may be paid.
     */
    public static function payFamily(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::paymentsEnabled()) return Http::error($res, 'Online payments are not enabled.', 400);
        $d = (array)$req->getParsedBody();
        $providerKey = (string)($d['provider'] ?? '');
        $provider = self::providers()[$providerKey] ?? null;
        if (!$provider || !self::available($pdo, $provider)) return Http::error($res, 'That payment method is unavailable.', 400);

        $youthIds = self::familyYouthIds($pdo, (int)$cur['id']);
        if (!$youthIds) return Http::error($res, 'No youth found for your account.', 400);
        $year = self::targetPayYear($pdo, $youthIds);
        $fees = self::feesSchedule($pdo);
        $payable = self::familyPayable($pdo, $youthIds, $year);
        $payableById = [];
        foreach ($payable as $e) $payableById[(int)$e['id']] = $e;

        $selectedIds = array_values(array_unique(array_map('intval', (array)($d['enrollment_ids'] ?? []))));
        // Every selected enrollment must belong to this family and be ready to pay.
        foreach ($selectedIds as $eid) {
            $e = $payableById[$eid] ?? null;
            if (!$e) return Http::error($res, 'One of the selected enrollments is not payable.', 422);
            $shirtOk = trim((string)($e['member_shirt'] ?? '')) !== '';
            if (!((bool)$e['tc_youth_agreed'] && (bool)$e['tc_parent_agreed']))
                return Http::error($res, trim($e['first_name'] . ' ' . $e['last_name']) . " still needs the enrollment Terms & Conditions signed.", 422);
            if (!$shirtOk) return Http::error($res, "Please set a shirt size for " . trim($e['first_name'] . ' ' . $e['last_name']) . " first.", 422);
            if (self::isWaitlisted($pdo, (int)$e['member_id'])) return Http::error($res, trim($e['first_name'] . ' ' . $e['last_name']) . " is on the waitlist.", 422);
        }

        $paidYouth = self::paidYouthCount($pdo, $youthIds, $year);
        $lines = self::familyLineItems($pdo, $payable, $selectedIds, $paidYouth, $fees);
        $enrollBase = round(array_sum(array_map(fn($l) => $l['price'], $lines)), 2);
        $donation = max(0.0, round((float)($d['donation_amount'] ?? 0), 2));
        $base = round($enrollBase + $donation, 2);
        if ($base <= 0) return Http::error($res, 'Select at least one enrollment to pay, or enter a donation.', 422);

        $coverFee = filter_var($d['cover_fee'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $fee = 0.0; $total = $base;
        if ($coverFee) { $q = self::feeQuote($pdo, $provider, $base); $fee = $q['fee']; $total = $q['total']; }

        $pdo->prepare(
            "INSERT INTO payments (provider, source_type, source_id, member_id, amount, base_amount, donation_amount, fee_amount, fee_covered, currency, status, created_by_id, created_at)
             VALUES (?, 'family_group', ?, ?, ?, ?, ?, ?, ?, 'USD', 'created', ?, NOW())"
        )->execute([$providerKey, (int)$cur['id'], (int)$cur['id'], $total, $enrollBase, $donation, $fee, $coverFee ? 1 : 0, (int)$cur['id']]);
        $paymentId = (int)$pdo->lastInsertId();
        $link = $pdo->prepare("INSERT INTO payment_enrollments (payment_id, enrollment_id, base_amount) VALUES (?,?,?)");
        foreach ($lines as $l) $link->execute([$paymentId, $l['enrollment_id'], $l['price']]);
        Audit::write($pdo, (int)$cur['id'], 'payments', $paymentId, 'payment.initiate', null,
            ['source' => 'family_group', 'enrollments' => count($lines), 'donation' => $donation, 'amount' => $total]);

        $descParts = [];
        if ($lines) $descParts[] = count($lines) . ' enrollment' . (count($lines) === 1 ? '' : 's');
        if ($donation > 0) $descParts[] = 'donation';
        try {
            $checkout = $provider->createCheckout([
                'amount' => $total, 'currency' => 'USD',
                'reference' => "family:{$cur['id']}:payment:$paymentId",
                'description' => 'TRC ' . implode(' + ', $descParts ?: ['payment']) . ($coverFee ? ' (incl. processing fee)' : ''),
                'return_url' => self::apiUrl() . "/api/v1/payments/return/$paymentId",
                'cancel_url' => self::apiUrl() . "/api/v1/payments/cancel/$paymentId",
                'payer_email' => null,
            ]);
        } catch (\Throwable $e) {
            $pdo->prepare("UPDATE payments SET status='failed', error_detail=?, updated_at=NOW() WHERE id=?")
                ->execute([mb_substr($e->getMessage(), 0, 400), $paymentId]);
            return Http::error($res, 'Could not start the payment. Please try again.', 502);
        }
        $pdo->prepare("UPDATE payments SET provider_ref=?, updated_at=NOW() WHERE id=?")->execute([$checkout['provider_ref'], $paymentId]);
        return Http::json($res, ['payment_id' => $paymentId, 'redirect_url' => $checkout['redirect_url'],
            'enroll_base' => $enrollBase, 'donation' => $donation, 'base' => $base, 'fee' => $fee, 'total' => $total]);
    }

    // ── One-time donation ───────────────────────────────────────────────────
    public static function donate(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!self::paymentsEnabled()) return Http::error($res, 'Online payments are not enabled.', 400);
        $d = (array)$req->getParsedBody();
        $provider = self::providers()[(string)($d['provider'] ?? '')] ?? null;
        if (!$provider || !self::available($pdo, $provider)) return Http::error($res, 'That payment method is unavailable.', 400);

        $amount = round((float)($d['amount'] ?? 0), 2);
        if ($amount < 1) return Http::error($res, 'Enter a donation amount of at least $1.', 422);
        if ($amount > 100000) return Http::error($res, 'Please contact us to make a gift this large.', 422);
        $note = mb_substr(trim((string)($d['note'] ?? '')), 0, 200) ?: null;

        $coverFee = filter_var($d['cover_fee'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $fee = 0.0; $total = $amount;
        if ($coverFee) { $q = self::feeQuote($pdo, $provider, $amount); $fee = $q['fee']; $total = $q['total']; }

        $pdo->prepare(
            "INSERT INTO payments (provider, source_type, source_id, member_id, amount, base_amount, fee_amount, fee_covered, currency, status, created_by_id, created_at)
             VALUES (?, 'donation', ?, ?, ?, ?, ?, ?, 'USD', 'created', ?, NOW())"
        )->execute([$provider->key(), (int)$cur['id'], (int)$cur['id'], $total, $amount, $fee, $coverFee ? 1 : 0, (int)$cur['id']]);
        $paymentId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'payments', $paymentId, 'payment.initiate', null, ['source' => 'donation', 'amount' => $total]);

        try {
            $checkout = $provider->createCheckout([
                'amount' => $total, 'currency' => 'USD',
                'reference' => "donation:$paymentId",
                'description' => 'TRC donation' . ($note ? ' — ' . $note : ''),
                'return_url' => self::apiUrl() . "/api/v1/payments/return/$paymentId",
                'cancel_url' => self::apiUrl() . "/api/v1/payments/cancel/$paymentId",
                'payer_email' => null,
            ]);
        } catch (\Throwable $e) {
            $pdo->prepare("UPDATE payments SET status='failed', error_detail=?, updated_at=NOW() WHERE id=?")
                ->execute([mb_substr($e->getMessage(), 0, 400), $paymentId]);
            return Http::error($res, 'Could not start the donation. Please try again.', 502);
        }
        $pdo->prepare("UPDATE payments SET provider_ref=?, updated_at=NOW() WHERE id=?")
            ->execute([$checkout['provider_ref'], $paymentId]);
        return Http::json($res, ['payment_id' => $paymentId, 'redirect_url' => $checkout['redirect_url']]);
    }

    // ── Payer returns after approving (browser GET; no auth) ────────────────
    public static function returnFromProvider(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $p = self::payment($pdo, (int)$route['payment_id']);
        $isDonation = $p && $p['source_type'] === 'donation';
        if ($p) {
            $provider = self::providers()[$p['provider']] ?? null;
            if ($provider && $p['status'] !== 'paid') {
                try {
                    $event = $provider->onReturn((string)$p['provider_ref']);
                    if ($event) self::reconcile($pdo, $p, $event);
                } catch (\Throwable $e) { /* webhook will back this up */ }
            }
        }
        $isFamily = $p && in_array($p['source_type'], ['family_group','installment'], true);
        $dest = $p && $p['source_type'] === 'raffle_order' ? '/raffle/thanks'
            : ($isDonation ? '/?payment=donation-success' : ($isFamily ? '/?payment=success' : '/enrollment?payment=success'));
        return $res->withHeader('Location', self::appUrl() . $dest)->withStatus(302);
    }

    public static function cancelFromProvider(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $p = self::payment($pdo, (int)$route['payment_id']);
        $isDonation = $p && $p['source_type'] === 'donation';
        if ($p && $p['status'] === 'created') {
            $pdo->prepare("UPDATE payments SET status='canceled', updated_at=NOW() WHERE id=?")->execute([(int)$p['id']]);
        }
        $isFamily = $p && in_array($p['source_type'], ['family_group','installment'], true);
        $dest = $p && $p['source_type'] === 'raffle_order' ? '/raffle/canceled'
            : ($isDonation ? '/?payment=donation-canceled' : ($isFamily ? '/?payment=canceled' : '/enrollment?payment=canceled'));
        return $res->withHeader('Location', self::appUrl() . $dest)->withStatus(302);
    }

    // ── Provider webhook (public; signature-verified) ───────────────────────
    public static function webhook(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $provider = self::providers()[(string)$route['provider']] ?? null;
        $raw = (string)$req->getBody();
        $headers = self::headers($req);
        // Always 200 so providers don't hammer retries; act only when verified.
        if (!$provider || !$provider->verifyWebhook($raw, $headers)) {
            return Http::json($res, ['ok' => true, 'verified' => false]);
        }
        $event = $provider->parseWebhook($raw, $headers);
        if ($event && !empty($event['provider_ref'])) {
            $p = self::paymentByRef($pdo, $provider->key(), (string)$event['provider_ref']);
            if ($p) self::reconcile($pdo, $p, $event);
        }
        return Http::json($res, ['ok' => true, 'verified' => true]);
    }

    // ── Shared, idempotent reconciliation ───────────────────────────────────
    private static function reconcile(PDO $pdo, array $p, array $event): void
    {
        $type = $event['type'] ?? 'other';
        if ($type === 'paid') {
            if ($p['status'] === 'paid') return; // idempotent (stale-read guard)
            // Conditional UPDATE is the real idempotency gate: the browser return
            // and the provider webhook can fire near-simultaneously. Only the first
            // to flip status away from non-paid proceeds to stamp the enrollment.
            $upd = $pdo->prepare("UPDATE payments SET status='paid', provider_txn_id=?, payer_email=?, paid_at=NOW(), updated_at=NOW() WHERE id=? AND status<>'paid'");
            $upd->execute([$event['provider_txn_id'] ?? null, $event['payer_email'] ?? null, (int)$p['id']]);
            if ($upd->rowCount() === 0) return; // another thread already marked it paid
            $ref = $event['provider_txn_id'] ?? $p['provider_ref'];
            if ($p['source_type'] === 'raffle_order') {
                // Guest raffle purchase cleared → issue tickets, route interests, email numbers.
                \App\Controllers\RafflesController::markOrderPaid($pdo, (int)$p['source_id'], 'cc');
            } elseif ($p['source_type'] === 'enrollment') {
                // Stamp the enrollment with the fee owed (base), NOT the total charged —
                // any covered processing fee is extra and isn't part of the enrollment fee.
                $recorded = $p['base_amount'] !== null ? (float)$p['base_amount'] : (float)$p['amount'];
                $pdo->prepare(
                    "UPDATE enrollments
                        SET status='paid', payment_amount=?, date_payment=CURDATE(),
                            payment_method=?, payment_reference=?
                      WHERE id=?"
                )->execute([$recorded, $p['provider'], $ref, (int)$p['source_id']]);
            } elseif ($p['source_type'] === 'installment') {
                // Pay-plan installment: mark it paid (recorded as a card payment) and
                // reconcile the enrollment's paid total.
                $recorded = $p['base_amount'] !== null ? (float)$p['base_amount'] : (float)$p['amount'];
                $eidRow = $pdo->prepare("SELECT enrollment_id FROM enrollment_installments WHERE id = ?");
                $eidRow->execute([(int)$p['source_id']]);
                $enrId = (int)($eidRow->fetchColumn() ?: 0);
                $pdo->prepare(
                    "UPDATE enrollment_installments SET status='paid', paid_amount=?, paid_date=CURDATE(), method='cc', reference=?, updated_at=NOW() WHERE id=?"
                )->execute([$recorded, $ref, (int)$p['source_id']]);
                if ($enrId) \App\Controllers\PaymentPlanController::reconcileEnrollment($pdo, $enrId);
            } elseif ($p['source_type'] === 'enrollment_group' || $p['source_type'] === 'family_group') {
                // A combined payment covers several enrollments, each credited its own share
                // (recorded in payment_enrollments). The enrollment fee (amount_due) is
                // authoritative — the sibling tier is baked in at signup — so we ACCUMULATE the
                // payment and only mark an enrollment 'paid' once its balance is covered. We
                // never overwrite amount_due: an underpayment must leave a real remaining
                // balance rather than silently collapsing the fee to whatever was paid (which
                // is how a mispriced family share previously marked a half-paid youth as paid).
                $rows = $pdo->prepare(
                    "SELECT pe.enrollment_id, pe.base_amount, e.amount_due, e.payment_amount, e.status, e.date_payment
                       FROM payment_enrollments pe JOIN enrollments e ON e.id = pe.enrollment_id
                      WHERE pe.payment_id = ?");
                $rows->execute([(int)$p['id']]);
                $mark = $pdo->prepare(
                    "UPDATE enrollments SET status=?, payment_amount=?, date_payment=?,
                            payment_method=?, payment_reference=? WHERE id=?");
                foreach ($rows->fetchAll() as $r) {
                    $newPaid = round((float)($r['payment_amount'] ?? 0) + (float)$r['base_amount'], 2);
                    $covered = ($newPaid + 0.005) >= (float)($r['amount_due'] ?? 0);
                    $status = $covered ? 'paid' : (string)($r['status'] ?? 'pending');
                    $datePay = $covered ? date('Y-m-d') : ($r['date_payment'] ?? null);
                    $mark->execute([$status, $newPaid, $datePay, $p['provider'], $ref, (int)$r['enrollment_id']]);
                }
            }
            Audit::write($pdo, $p['created_by_id'] ? (int)$p['created_by_id'] : null, 'payments', (int)$p['id'], 'paid',
                null, ['provider' => $p['provider'], 'amount' => $p['amount'], 'source' => $p['source_type'] . ':' . $p['source_id']]);
            self::notifyPaymentReceived($pdo, $p, (string)($ref ?? ''), $event);
        } elseif ($type === 'failed') {
            $pdo->prepare("UPDATE payments SET status='failed', updated_at=NOW() WHERE id=? AND status<>'paid'")->execute([(int)$p['id']]);
        } elseif ($type === 'refunded') {
            $pdo->prepare("UPDATE payments SET status='refunded', updated_at=NOW() WHERE id=?")->execute([(int)$p['id']]);
            Audit::write($pdo, null, 'payments', (int)$p['id'], 'refunded', null, ['provider' => $p['provider']]);
        }
    }

    /**
     * Notify the org's payment mailbox (Admin → Email Settings → payment_email,
     * default info@tulsaroboticscenter.org) whenever a payment completes. Best-effort:
     * a mail failure never blocks reconciliation.
     */
    /**
     * Send a SAMPLE "payment received" email through the real notification path, so
     * the SMTP setup, the configured address and the template can be verified without
     * putting a live payment through the card processor. Used by bin/test_payment_email.php.
     * @return array{sent:bool,to:string,reason:string}
     */
    public static function sendTestPaymentNotification(PDO $pdo): array
    {
        $to = \App\Controllers\EmailSettingsController::paymentEmail($pdo);
        if (!\App\Core\Mailer::enabled()) return ['sent' => false, 'to' => $to, 'reason' => 'Email (SMTP) is not configured — see Admin → Email Settings.'];
        if ($to === '') return ['sent' => false, 'to' => '', 'reason' => 'No payment-notification address is set.'];
        // A representative family payment: fees + a donation, fee covered by the payer.
        $sample = [
            'id' => 0, 'provider' => 'square', 'source_type' => 'family_group', 'source_id' => 0,
            'amount' => '212.00', 'base_amount' => '200.00', 'donation_amount' => '12.00',
            'fee_amount' => '0.00', 'member_id' => null, 'payer_email' => 'parent@example.com',
            'created_by_id' => null,
        ];
        self::notifyPaymentReceived($pdo, $sample, 'TEST-NOT-A-REAL-PAYMENT', ['payer_email' => 'parent@example.com'], true);
        return ['sent' => true, 'to' => $to, 'reason' => ''];
    }

    private static function notifyPaymentReceived(PDO $pdo, array $p, string $ref, array $event, bool $isTest = false): void
    {
        try {
            if (!\App\Core\Mailer::enabled()) return;
            $to = \App\Controllers\EmailSettingsController::paymentEmail($pdo);
            if ($to === '') return;

            $providerLabel = ['square' => 'Square', 'paypal' => 'PayPal'][$p['provider']] ?? ucfirst((string)$p['provider']);
            $labels = [
                'enrollment' => 'Enrollment fee', 'enrollment_group' => 'Enrollment fees',
                'family_group' => 'Family enrollment fees', 'installment' => 'Payment-plan installment',
                'donation' => 'Donation',
            ];
            $what = $labels[$p['source_type']] ?? 'Payment';
            $amount = number_format((float)$p['amount'], 2);
            $base = $p['base_amount'] !== null ? number_format((float)$p['base_amount'], 2) : null;
            $donation = isset($p['donation_amount']) && $p['donation_amount'] !== null ? (float)$p['donation_amount'] : 0.0;
            $fee = isset($p['fee_amount']) && $p['fee_amount'] !== null ? (float)$p['fee_amount'] : 0.0;

            // Who paid (member on the payment, if any) for quick context.
            $who = '';
            if (!empty($p['member_id'])) {
                $ms = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?");
                $ms->execute([(int)$p['member_id']]);
                if ($m = $ms->fetch()) $who = trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? ''));
            }
            $payer = trim((string)($event['payer_email'] ?? $p['payer_email'] ?? ''));

            $rows = [
                ['Amount', '$' . $amount . ($fee > 0 ? ' (incl. $' . number_format($fee, 2) . ' processing fee)' : '')],
                ['Type', $what],
                ['Processor', $providerLabel],
            ];
            if ($base !== null && $base !== $amount) $rows[] = ['Base', '$' . $base];
            if ($donation > 0) $rows[] = ['Donation portion', '$' . number_format($donation, 2)];
            if ($who !== '') $rows[] = ['Member', $who];
            if ($payer !== '') $rows[] = ['Payer email', $payer];
            if ($ref !== '') $rows[] = ['Reference', $ref];
            $rows[] = ['Payment ID', '#' . (int)$p['id']];

            $body = $isTest
                ? '<p style="padding:10px 12px;background:#fff8e1;border:1px solid #ffe0a3;border-radius:8px">'
                    . '<strong>This is a TEST.</strong> No money changed hands — someone used the payment-notification '
                    . 'test to check that these emails arrive. A real one looks exactly like this, without this banner.</p>'
                    . '<p>A payment was just processed successfully.</p>'
                : '<p>A payment was just processed successfully.</p>';
            $body .= '<table cellpadding="4" style="border-collapse:collapse">';
            foreach ($rows as [$k, $v]) {
                $body .= '<tr><td style="color:#667;padding-right:12px"><strong>' . htmlspecialchars($k) . '</strong></td>'
                       . '<td>' . htmlspecialchars((string)$v) . '</td></tr>';
            }
            $body .= '</table>';

            $subject = ($isTest ? '[TEST] ' : '') . "Payment received: \${$amount} via {$providerLabel}" . ($who !== '' ? " — {$who}" : '');
            \App\Core\Mailer::send($to, $subject, \App\Core\Mailer::wrap($isTest ? 'Payment Received (TEST)' : 'Payment Received', $body));

            // The staff alert above is NOT a receipt. Send the family their own, so a
            // card payer gets one from us and not only from Square/PayPal. Never on a
            // test notification -- that would email a real family about a fake payment.
            if (!$isTest && !empty($p['member_id'])) {
                \App\Core\PaymentReceipt::send($pdo, [
                    'member_id' => (int)$p['member_id'],
                    'amount' => (float)$p['amount'],
                    'method' => (string)$p['provider'],
                    'paid_on' => date('Y-m-d'),
                    'reference' => $ref !== '' ? $ref : null,
                    'what' => $what,
                ]);
            }
        } catch (\Throwable $e) {
            error_log('notifyPaymentReceived failed: ' . $e->getMessage());
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────
    private static function enrollment(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT id, member_id, amount_due, payment_amount, status FROM enrollments WHERE id = ?");
        $s->execute([$id]); return $s->fetch() ?: null;
    }
    private static function payment(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM payments WHERE id = ?"); $s->execute([$id]); return $s->fetch() ?: null;
    }
    private static function paymentByRef(PDO $pdo, string $provider, string $ref): ?array
    {
        $s = $pdo->prepare("SELECT * FROM payments WHERE provider = ? AND provider_ref = ? ORDER BY id DESC LIMIT 1");
        $s->execute([$provider, $ref]); return $s->fetch() ?: null;
    }

    /** Admin/enrollment-manager, the member themselves, or a family guardian. */
    private static function canPayFor(PDO $pdo, array $cur, int $memberId): bool
    {
        if ((int)$cur['id'] === $memberId) return true;
        if (Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])
            || Permissions::memberCan($pdo, $cur, 'enrollment.payments', 'write')) return true;
        $s = $pdo->prepare(
            "SELECT 1 FROM family_members fm1
             JOIN family_members fm2 ON fm2.family_id = fm1.family_id
             WHERE fm1.member_id = ? AND fm2.member_id = ? LIMIT 1"
        );
        $s->execute([(int)$cur['id'], $memberId]);
        return (bool)$s->fetchColumn();
    }
}
