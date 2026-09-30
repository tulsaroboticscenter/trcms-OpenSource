<?php
declare(strict_types=1);

namespace App\Core\Payments;

use App\Core\Config;

/**
 * Square hosted checkout (Payment Links / Quick Pay). Card entry happens on
 * Square's page; we get a redirect URL and later a signed webhook.
 * Docs: connect.squareup.com /v2/online-checkout/payment-links, webhooks HMAC.
 */
final class SquareProvider implements PaymentProvider
{
    private const API_VERSION = '2025-01-23';

    public function key(): string { return 'square'; }
    public function label(): string { return 'Square'; }

    private function token(): ?string { return Config::get('SQUARE_ACCESS_TOKEN'); }
    private function locationId(): ?string { return Config::get('SQUARE_LOCATION_ID'); }
    private function signatureKey(): ?string { return Config::get('SQUARE_WEBHOOK_SIGNATURE_KEY'); }
    private function webhookUrl(): ?string { return Config::get('SQUARE_WEBHOOK_URL'); }

    private function base(): string
    {
        return (Config::get('SQUARE_ENV', 'sandbox') === 'production')
            ? 'https://connect.squareup.com'
            : 'https://connect.squareupsandbox.com';
    }

    public function isConfigured(): bool
    {
        return (bool)$this->token() && (bool)$this->locationId();
    }

    public function feePercent(): float { return (float)Config::get('SQUARE_FEE_PCT', '2.6'); }
    public function feeFixed(): float { return (float)Config::get('SQUARE_FEE_FIXED', '0.10'); }

    public function createCheckout(array $ctx): array
    {
        if (!$this->isConfigured()) throw new \RuntimeException('Square is not configured.');
        $cents = (int)round(((float)$ctx['amount']) * 100);
        $resp = Http::request('POST', $this->base() . '/v2/online-checkout/payment-links', [
            'Authorization' => 'Bearer ' . $this->token(),
            'Square-Version' => self::API_VERSION,
            'Content-Type' => 'application/json',
        ], [
            'idempotency_key' => bin2hex(random_bytes(16)),
            'quick_pay' => [
                'name' => (string)($ctx['description'] ?? 'TRC payment'),
                'price_money' => ['amount' => $cents, 'currency' => (string)($ctx['currency'] ?? 'USD')],
                'location_id' => $this->locationId(),
            ],
            'checkout_options' => ['redirect_url' => (string)($ctx['return_url'] ?? '')],
            'payment_note' => (string)($ctx['reference'] ?? ''),
        ]);
        if ($resp['status'] >= 300 || empty($resp['body']['payment_link'])) {
            throw new \RuntimeException('Square checkout failed: ' . ($resp['body']['errors'][0]['detail'] ?? $resp['raw']));
        }
        $link = $resp['body']['payment_link'];
        // Match the later webhook by the order id.
        return ['redirect_url' => $link['url'], 'provider_ref' => (string)($link['order_id'] ?? $link['id'])];
    }

    public function onReturn(string $providerRef): ?array
    {
        return null; // Square confirms via webhook only.
    }

    public function verifyWebhook(string $rawBody, array $headers): bool
    {
        $key = $this->signatureKey(); $url = $this->webhookUrl();
        if (!$key || !$url) return false;
        $sig = $headers['x-square-hmacsha256-signature'] ?? '';
        $expected = base64_encode(hash_hmac('sha256', $url . $rawBody, $key, true));
        return is_string($sig) && hash_equals($expected, $sig);
    }

    public function parseWebhook(string $rawBody, array $headers): ?array
    {
        $e = json_decode($rawBody, true);
        if (!is_array($e)) return null;
        $type = $e['type'] ?? '';
        $payment = $e['data']['object']['payment'] ?? null;
        if (!$payment) return null;
        $status = strtoupper((string)($payment['status'] ?? ''));
        $norm = $status === 'COMPLETED' ? 'paid' : ($status === 'FAILED' ? 'failed' : 'other');
        if ($type === 'refund.created' || $type === 'refund.updated') $norm = 'refunded';
        return [
            'type' => $norm,
            'provider_ref' => (string)($payment['order_id'] ?? ''),
            'provider_txn_id' => (string)($payment['id'] ?? ''),
            'payer_email' => $payment['buyer_email_address'] ?? null,
            'amount' => isset($payment['amount_money']['amount']) ? ((int)$payment['amount_money']['amount']) / 100 : null,
        ];
    }
}
