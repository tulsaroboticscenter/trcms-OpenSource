<?php
declare(strict_types=1);
/**
 * TRCMS first-run CLI installer (open-source Phase 1).
 * ====================================================
 * Turns a fresh host into a working TRCMS in one command: preflight → write .env
 * (with fresh per-install secrets) → build the database (schema + migration
 * baseline + generic seed) → create the single System Administrator. After this,
 * open APP_URL in a browser to finish setup (org identity, email, modules) in the
 * first-run wizard.
 *
 * Usage (interactive):   php bin/install.php
 * Usage (non-interactive, all values from env):
 *   TRCMS_DB_URL="mysql://user:pass@127.0.0.1:3306/trcms" \
 *   TRCMS_APP_URL="https://trcms.example.org" TRCMS_ORG_NAME="Example Robotics" \
 *   TRCMS_ADMIN_USER=siteadmin TRCMS_ADMIN_PASS='Str0ng!Passw0rd' \
 *   TRCMS_ADMIN_EMAIL=admin@example.org TRCMS_ADMIN_FIRST=Site TRCMS_ADMIN_LAST=Admin \
 *   php bin/install.php --yes --create-db
 *
 * Flags: --yes (non-interactive; fail if a required value is missing)
 *        --create-db (CREATE DATABASE if it doesn't exist)
 *        --force (overwrite an existing .env / rebuild an already-built DB)
 */
require __DIR__ . '/../vendor/autoload.php';

use App\Core\Installer;

$args     = array_slice($argv, 1);
$YES      = in_array('--yes', $args, true);
$CREATEDB = in_array('--create-db', $args, true);
$FORCE    = in_array('--force', $args, true);

$installer = new Installer();

function out(string $s = ''): void { fwrite(STDOUT, $s . "\n"); }
function fail(string $s): never { fwrite(STDERR, "\n✗ $s\n"); exit(1); }

/** Ask on the terminal, or take an env default; error in --yes mode if empty+required. */
function ask(string $label, string $env, string $default = '', bool $secret = false, bool $required = true): string {
    global $YES;
    $envVal = getenv($env);
    if ($envVal !== false && $envVal !== '') return $envVal;
    if ($YES) {
        if ($default !== '') return $default;
        if ($required) fail("Missing required value for $label. Set $env or drop --yes.");
        return '';
    }
    $suffix = $default !== '' ? " [$default]" : '';
    fwrite(STDOUT, "$label$suffix: ");
    if ($secret && DIRECTORY_SEPARATOR !== '\\') @shell_exec('stty -echo');
    $line = trim((string)fgets(STDIN));
    if ($secret && DIRECTORY_SEPARATOR !== '\\') { @shell_exec('stty echo'); fwrite(STDOUT, "\n"); }
    if ($line === '' && $default !== '') return $default;
    if ($line === '' && $required) fail("$label is required.");
    return $line;
}

out("TRCMS Installer");
out(str_repeat('=', 40));

// ── 1. Preflight ─────────────────────────────────────────────────────────────
out("\nPreflight checks:");
$hardFail = false;
foreach ($installer->preflight() as $c) {
    out(sprintf("  [%s] %s%s", $c['ok'] ? 'OK' : ($c['required'] ? 'XX' : '--'), $c['name'], $c['ok'] ? '' : "  → {$c['detail']}"));
    if (!$c['ok'] && $c['required']) $hardFail = true;
}
if ($hardFail) fail("Preflight failed. Fix the items above and re-run.");

// ── 2. Database ───────────────────────────────────────────────────────────────
out("\nDatabase:");
$dbUrl = ask("  DATABASE_URL (mysql://user:pass@host:3306/dbname)", 'TRCMS_DB_URL');
if ($CREATEDB) { try { $installer->ensureDatabase($dbUrl); out("  created database if missing"); } catch (Throwable $e) { fail("Create database: " . $e->getMessage()); } }
try { $installer->testConnection($dbUrl); out("  connection OK"); } catch (Throwable $e) { fail("Cannot connect: " . $e->getMessage()); }

// ── 3. Identity ────────────────────────────────────────────────────────────────
out("\nOrganization:");
$orgName = ask("  Organization name", 'TRCMS_ORG_NAME', 'My Organization');
$appUrl  = ask("  Public URL (APP_URL, e.g. https://trcms.example.org)", 'TRCMS_APP_URL');
$tz      = ask("  Timezone", 'TRCMS_TIMEZONE', 'America/Chicago');

// ── 4. Secrets + 5. .env ─────────────────────────────────────────────────────
$env = [
    'DATABASE_URL' => $dbUrl, 'APP_URL' => $appUrl, 'ALLOWED_ORIGINS' => $appUrl,
    'ORG_NAME' => $orgName, 'APP_TIMEZONE' => $tz, 'ENVIRONMENT' => 'production',
    'SECRET_KEY' => Installer::generateSecret(), 'INCIDENT_VAULT_KEY' => Installer::generateSecret(),
];
try { $path = $installer->writeEnv($env, $FORCE); out("\nWrote $path (with fresh SECRET_KEY + INCIDENT_VAULT_KEY)"); }
catch (Throwable $e) { fail($e->getMessage()); }

// ── 6. Build the database ────────────────────────────────────────────────────
$pdo = $installer->connect($dbUrl, true);
if ($installer->databaseBuilt($pdo) && !$FORCE) {
    fail("The database already has tables. Use --force to rebuild (DESTRUCTIVE), or point at an empty database.");
}
out("\nBuilding database:");
$installer->loadSchema($pdo);                     out("  loaded schema.sql");
$n = $installer->stampMigrationBaseline($pdo);    out("  stamped $n migrations as baseline");
$installer->loadSeed($pdo);                       out("  loaded base configuration (roles, permissions, config, programs)");

// ── 7. First System Administrator ─────────────────────────────────────────────
out("\nSystem Administrator (the single super account):");
$adminUser  = ask("  Username", 'TRCMS_ADMIN_USER', 'siteadmin');
$adminEmail = ask("  Email", 'TRCMS_ADMIN_EMAIL');
$adminFirst = ask("  First name", 'TRCMS_ADMIN_FIRST', 'Site', false, false);
$adminLast  = ask("  Last name", 'TRCMS_ADMIN_LAST', 'Administrator', false, false);
$adminPass  = ask("  Password (12+ chars, upper/lower/number/symbol)", 'TRCMS_ADMIN_PASS', '', true);
try {
    $mid = $installer->createSysadmin($pdo, $adminUser, $adminPass, $adminFirst, $adminLast, $adminEmail);
    out("  created System Administrator (member id $mid, username '$adminUser')");
} catch (Throwable $e) { fail("Create administrator: " . $e->getMessage()); }

// ── 8. Mark bootstrapped ──────────────────────────────────────────────────────
$installer->markBootstrapped($pdo);

out("\n" . str_repeat('=', 40));
out("✓ Install complete.\n");
out("Next steps:");
out("  1. Point your web server's document root at the  public/  directory.");
out("  2. Serve over HTTPS.");
out("  3. Open  $appUrl  and sign in as '$adminUser' to finish setup");
out("     (organization branding, email/SMTP, and which modules to enable).");
out("  4. Set up the cron jobs printed in Admin → (setup) for reminders/notifications.");
out("");
