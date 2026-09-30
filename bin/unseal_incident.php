<?php
declare(strict_types=1);

/**
 * Incident identity back door — the ONLY place the sealed anonymous-reporter identity can be
 * recovered. It requires Plesk (server) shell access AND the INCIDENT_VAULT_KEY from .env.
 *
 * This is intentionally a standalone CLI script, NOT a class the web app autoloads: the running
 * application has no decryption path, so no user — not Admin, not System Administrator — can ever
 * see a sealed identity through the app. See docs/INCIDENT_REPORTS_SPEC.md §7.
 *
 * Usage:
 *   php bin/unseal_incident.php <REF_NO>     Recover the identity behind an anonymous report.
 *   php bin/unseal_incident.php --genkey     Print a fresh 64-hex-char key for .env.
 *
 * Every recovery is appended to incident_vault_access_log and must be reported to the board.
 * If INCIDENT_VAULT_KEY is lost, sealed identities are permanently unrecoverable.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../vendor/autoload.php';

use App\Core\Config;
use App\Core\Database;

$args = array_slice($argv, 1);

// --genkey: no DB or key needed; just emit a key to paste into .env.
if (in_array('--genkey', $args, true)) {
    echo bin2hex(random_bytes(32)) . "\n";
    exit(0);
}

$ref = $args[0] ?? '';
if ($ref === '' || in_array('--help', $args, true) || in_array('-h', $args, true)) {
    fwrite(STDERR, "Usage:\n");
    fwrite(STDERR, "  php bin/unseal_incident.php <REF_NO>   Recover an anonymous reporter's identity\n");
    fwrite(STDERR, "  php bin/unseal_incident.php --genkey   Generate a new INCIDENT_VAULT_KEY\n");
    exit(1);
}

Config::load(dirname(__DIR__));

$hex = Config::get('INCIDENT_VAULT_KEY');
$key = $hex ? @hex2bin(trim($hex)) : false;
if ($key === false || strlen($key) !== 32) {
    fwrite(STDERR, "INCIDENT_VAULT_KEY is missing or not 64 hex characters in .env.\n");
    exit(1);
}

$pdo = Database::pdo();

$st = $pdo->prepare("SELECT id, ref_no, is_anonymous, created_at FROM incident_reports WHERE ref_no = ?");
$st->execute([$ref]);
$inc = $st->fetch();
if (!$inc) {
    fwrite(STDERR, "No incident found with ref_no {$ref}.\n");
    exit(1);
}

$vs = $pdo->prepare("SELECT sealed FROM incident_identity_vault WHERE incident_id = ?");
$vs->execute([(int)$inc['id']]);
$row = $vs->fetch();
if (!$row) {
    fwrite(STDERR, "No sealed identity exists for {$ref}. Was it actually filed anonymously?\n");
    exit(1);
}

$blob = base64_decode((string)$row['sealed'], true);
if ($blob === false || strlen($blob) < 28) {
    fwrite(STDERR, "The sealed record is corrupt or truncated.\n");
    exit(1);
}
$iv     = substr($blob, 0, 12);
$tag    = substr($blob, 12, 16);
$cipher = substr($blob, 28);

$plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
if ($plain === false) {
    fwrite(STDERR, "Decryption failed — wrong INCIDENT_VAULT_KEY, or the data was tampered with.\n");
    exit(1);
}
$identity = json_decode($plain, true);

// Record the reason before revealing anything. This access is logged no matter what.
fwrite(STDERR, "Reason for opening this sealed identity (recorded in incident_vault_access_log):\n> ");
$reason = trim((string)fgets(STDIN));
$osUser = getenv('USER') ?: getenv('USERNAME') ?: 'unknown';
$host   = gethostname() ?: 'unknown';
$pdo->prepare("INSERT INTO incident_vault_access_log (incident_id, os_user, reason, host) VALUES (?,?,?,?)")
    ->execute([(int)$inc['id'], $osUser, $reason, $host]);

echo "\n=== Sealed identity behind {$ref} ===\n";
echo json_encode($identity, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
echo "\nThis access has been recorded in incident_vault_access_log ({$osUser}@{$host}).\n";
echo "Per policy, inform the board that a sealed reporter identity was opened, and why.\n";
exit(0);
