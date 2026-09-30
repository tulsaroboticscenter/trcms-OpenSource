<?php
declare(strict_types=1);

namespace App\Core\Payments;

/**
 * A hosted-checkout payment provider (Square, PayPal, …). Implementations keep
 * ALL card handling on the provider's own pages — this app only ever creates a
 * checkout and later confirms it from a signed webhook. No PCI card data here.
 */
interface PaymentProvider
{
    /** Machine key stored in payments.provider, e.g. 'square' | 'paypal'. */
    public function key(): string;

    /** Human label for the Pay-with button. */
    public function label(): string;

    /** True only when every required secret is configured (else the button hides). */
    public function isConfigured(): bool;

    /** Processing fee percent (e.g. 2.6 for 2.6%). Configurable per provider. */
    public function feePercent(): float;

    /** Fixed processing fee per transaction in dollars (e.g. 0.10). */
    public function feeFixed(): float;

    /**
     * Create a hosted checkout for an amount and return where to send the payer.
     *
     * @param array $ctx  ['amount'=>float,'currency'=>string,'reference'=>string,
     *                     'description'=>string,'return_url'=>string,'cancel_url'=>string,
     *                     'payer_email'=>?string]
     * @return array ['redirect_url'=>string, 'provider_ref'=>string]
     * @throws \RuntimeException on provider/config error
     */
    public function createCheckout(array $ctx): array;

    /**
     * Called when the payer is redirected back after approving. Providers that
     * need an explicit capture (PayPal) do it here and return a normalized event;
     * webhook-only providers (Square) return null and rely on the webhook.
     * @return array|null same shape as parseWebhook(), or null.
     */
    public function onReturn(string $providerRef): ?array;

    /**
     * Verify a webhook's authenticity from the raw body + headers.
     * @return bool true if the signature is valid.
     */
    public function verifyWebhook(string $rawBody, array $headers): bool;

    /**
     * Parse a verified webhook into a normalized event.
     * @return array|null ['type'=>'paid'|'failed'|'refunded'|'other',
     *                     'provider_ref'=>?string, 'provider_txn_id'=>?string,
     *                     'payer_email'=>?string, 'amount'=>?float] or null to ignore.
     */
    public function parseWebhook(string $rawBody, array $headers): ?array;
}
