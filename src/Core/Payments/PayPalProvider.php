<?php
declare(strict_types=1);

namespace App\Core\Payments;

use App\Core\Config;

/**
 * PayPal hosted checkout (Orders v2). Buyer approves on PayPal, is redirected
 * back, and we capture the order (onReturn). A PAYMENT.CAPTURE.COMPLETED webhook
 * is the idempotent backstop. Card entry never touches this app.
 */
final class PayPalProvider implements PaymentProvider
{
    public function key(): string { return 'paypal'; }
    public function label(): string { return 'PayPal'; }

    private function clientId(): ?string { return Config::get('PAYPAL_CLIENT_ID'); }
    private function secret(): ?string { return Config::get('PAYPAL_CLIENT_SECRET'); }
    private function webhookId(): ?string { return Config::get('PAYPAL_WEBHOOK_ID'); }

    private function base(): string
    {
        return (Config::get('PAYPAL_ENV', 'sandbox') === 'production')
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

    public function isConfigured(): bool
    {
        return (bool)$this->clientId() && (bool)$this->secret();
    }

    // Default to the confirmed-501(c)(3) nonprofit rate; override in .env if needed.
    public function feePercent(): float { return (float)Config::get('PAYPAL_FEE_PCT', '1.99'); }
    public function feeFixed(): float { return (float)Config::get('PAYPAL_FEE_FIXED', '0.49'); }

    private function accessToken(): string
    {
        $ch = curl_init($this->base() . '/v1/oauth2/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_USERPWD => $this->clientId() . ':' . $this->secret(),
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => 'grant_type=client_credentials',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        $raw = curl_exec($ch);
        if ($raw === false) { $e = curl_error($ch); curl_close($ch); throw new \RuntimeException("PayPal auth failed: $e"); }
        curl_close($ch);
        $tok = json_decode((string)$raw, true)['access_token'] ?? null;
        if (!$tok) throw new \RuntimeException('PayPal auth failed: no token');
        return (string)$tok;
    }

    public function createCheckout(array $ctx): array
    {
        if (!$this->isConfigured()) throw new \RuntimeException('PayPal is not configured.');
        $tok = $this->accessToken();
        $resp = Http::request('POST', $this->base() . '/v2/checkout/orders', [
            'Authorization' => 'Bearer ' . $tok,
            'Content-Type' => 'application/json',
        ], [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'custom_id' => (string)($ctx['reference'] ?? ''),
                'description' => mb_substr((string)($ctx['description'] ?? 'TRC payment'), 0, 127),
                'amount' => ['currency_code' => (string)($ctx['currency'] ?? 'USD'), 'value' => number_format((float)$ctx['amount'], 2, '.', '')],
            ]],
            'application_context' => [
                'return_url' => (string)($ctx['return_url'] ?? ''),
                'cancel_url' => (string)($ctx['cancel_url'] ?? ''),
                'shipping_preference' => 'NO_SHIPPING',
                'user_action' => 'PAY_NOW',
            ],
        ]);
        if ($resp['status'] >= 300 || empty($resp['body']['id'])) {
            throw new \RuntimeException('PayPal order failed: ' . ($resp['body']['message'] ?? $resp['raw']));
        }
        $approve = '';
        foreach ($resp['body']['links'] ?? [] as $l) {
            if (($l['rel'] ?? '') === 'approve') { $approve = $l['href']; break; }
        }
        if (!$approve) throw new \RuntimeException('PayPal order failed: no approve link');
        return ['redirect_url' => $approve, 'provider_ref' => (string)$resp['body']['id']];
    }

    public function onReturn(string $providerRef): ?array
    {
        // Capture the approved order. Idempotent-ish: a second capture returns an
        // error we treat as already-captured; the webhook is the final backstop.
        $tok = $this->accessToken();
        $resp = Http::request('POST', $this->base() . "/v2/checkout/orders/{$providerRef}/capture", [
            'Authorization' => 'Bearer ' . $tok,
            'Content-Type' => 'application/json',
        ], []);
        $status = strtoupper((string)($resp['body']['status'] ?? ''));
        if ($status !== 'COMPLETED') return null;
        $cap = $resp['body']['purchase_units'][0]['payments']['captures'][0] ?? [];
        return [
            'type' => 'paid',
            'provider_ref' => $providerRef,
            'provider_txn_id' => (string)($cap['id'] ?? $providerRef),
            'payer_email' => $resp['body']['payer']['email_address'] ?? null,
            'amount' => isset($cap['amount']['value']) ? (float)$cap['amount']['value'] : null,
        ];
    }

    public function verifyWebhook(string $rawBody, array $headers): bool
    {
        if (!$this->webhookId()) return false;
        $event = json_decode($rawBody, true);
        if (!is_array($event)) return false;
        $tok = $this->accessToken();
        $resp = Http::request('POST', $this->base() . '/v1/notifications/verify-webhook-signature', [
            'Authorization' => 'Bearer ' . $tok,
            'Content-Type' => 'application/json',
        ], [
            'auth_algo' => $headers['paypal-auth-algo'] ?? '',
            'cert_url' => $headers['paypal-cert-url'] ?? '',
            'transmission_id' => $headers['paypal-transmission-id'] ?? '',
            'transmission_sig' => $headers['paypal-transmission-sig'] ?? '',
            'transmission_time' => $headers['paypal-transmission-time'] ?? '',
            'webhook_id' => $this->webhookId(),
            'webhook_event' => $event,
        ]);
        return ($resp['body']['verification_status'] ?? '') === 'SUCCESS';
    }

    public function parseWebhook(string $rawBody, array $headers): ?array
    {
        $e = json_decode($rawBody, true);
        if (!is_array($e)) return null;
        $type = $e['event_type'] ?? '';
        $r = $e['resource'] ?? [];
        $norm = match (true) {
            $type === 'PAYMENT.CAPTURE.COMPLETED' => 'paid',
            $type === 'PAYMENT.CAPTURE.DENIED' || $type === 'PAYMENT.CAPTURE.DECLINED' => 'failed',
            $type === 'PAYMENT.CAPTURE.REFUNDED' => 'refunded',
            default => 'other',
        };
        // custom_id carries our reference; capture links back to the order via supplementary data.
        $ref = $r['supplementary_data']['related_ids']['order_id'] ?? ($r['custom_id'] ?? '');
        return [
            'type' => $norm,
            'provider_ref' => (string)$ref,
            'provider_txn_id' => (string)($r['id'] ?? ''),
            'payer_email' => null,
            'amount' => isset($r['amount']['value']) ? (float)$r['amount']['value'] : null,
        ];
    }
}
