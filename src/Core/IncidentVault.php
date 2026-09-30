<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Seals an anonymous incident reporter's identity so it can be recovered ONLY out-of-band
 * (Plesk shell access + the .env key), never by the running web application.
 *
 * There is deliberately NO decrypt counterpart in this class or anywhere the web app
 * autoloads. Recovery is possible only through the offline CLI back door (in bin/, documented
 * in docs/INCIDENT_REPORTS_SPEC.md §7). That absence is the entire anonymity guarantee: a
 * permission key cannot hide anything from a super role (Permissions::resolve grants super
 * roles write on every key), so anonymity is enforced by there being no read path at all.
 *
 * A code reviewer can grep src/ for a decryption call and find none.
 */
final class IncidentVault
{
    /** Raw 32-byte key from the hex INCIDENT_VAULT_KEY in .env. Never stored in the DB. */
    private static function key(): ?string
    {
        $hex = Config::get('INCIDENT_VAULT_KEY');
        if (!$hex) return null;
        $raw = @hex2bin(trim($hex));
        return ($raw !== false && strlen($raw) === 32) ? $raw : null;
    }

    /** Whether a valid vault key is configured — lets submit warn if anonymity can't be honored. */
    public static function keyConfigured(): bool
    {
        return self::key() !== null;
    }

    /**
     * Encrypt the submitter identity with AES-256-GCM and store it against the incident.
     * Stored form is base64 of iv(12) ‖ tag(16) ‖ ciphertext.
     *
     * @param array{member_id:?int,name:?string,email:?string,ip:?string,user_agent:?string,submitted_at:string} $identity
     * @return bool true if sealed; false if no key is configured (caller decides how to handle)
     */
    public static function seal(PDO $pdo, int $incidentId, array $identity): bool
    {
        $key = self::key();
        if ($key === null) return false;

        $plain = json_encode($identity, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt((string)$plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) return false;

        $sealed = base64_encode($iv . $tag . $cipher);
        $pdo->prepare("INSERT INTO incident_identity_vault (incident_id, sealed) VALUES (?, ?)")
            ->execute([$incidentId, $sealed]);
        return true;
    }
}
