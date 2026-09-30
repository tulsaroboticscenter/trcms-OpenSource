<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use RuntimeException;

/**
 * First-run installer service (open-source Phase 1).
 * =================================================
 * Pure logic shared by the CLI bootstrap (bin/install.php) and, later, the
 * in-browser setup wizard. Turns a brand-new host into a working TRCMS:
 *   preflight → write .env (with fresh secrets) → build the database
 *   (schema + migration baseline + generic seed) → create the single
 *   System Administrator → mark bootstrapped.
 *
 * "Installed" is tracked in system_config category 'install'
 * ({ bootstrapped_at, app_version, setup_complete }). setup_complete flips to
 * true when the browser wizard (org identity, SMTP, modules, cron) finishes.
 */
final class Installer
{
    public const INSTALL_CATEGORY = 'install';

    private string $root;

    public function __construct(?string $root = null)
    {
        $this->root = $root ?? dirname(__DIR__, 2);
    }

    // ── Preflight ────────────────────────────────────────────────────────────

    /** @return array<int,array{name:string,ok:bool,required:bool,detail:string}> */
    public function preflight(): array
    {
        $checks = [];
        $php = PHP_VERSION;
        $checks[] = ['name' => "PHP $php (>= 8.1)", 'ok' => version_compare($php, '8.1.0', '>='),
                     'required' => true, 'detail' => version_compare($php, '8.1.0', '>=') ? 'ok' : 'Upgrade to PHP 8.1+'];
        foreach (['pdo_mysql', 'openssl', 'mbstring', 'dom', 'json'] as $ext) {
            $ok = extension_loaded($ext);
            $checks[] = ['name' => "ext-$ext", 'ok' => $ok, 'required' => true,
                         'detail' => $ok ? 'loaded' : "Enable the $ext extension"];
        }
        $envDir = $this->root;
        $envOk = is_writable(is_file("$envDir/.env") ? "$envDir/.env" : $envDir);
        $checks[] = ['name' => '.env is writable', 'ok' => $envOk, 'required' => true,
                     'detail' => $envOk ? 'ok' : "Make $envDir writable so .env can be created"];
        $vendorOk = is_file("$this->root/vendor/autoload.php");
        $checks[] = ['name' => 'Composer dependencies installed', 'ok' => $vendorOk, 'required' => true,
                     'detail' => $vendorOk ? 'ok' : 'Run: composer install'];
        $schemaOk = is_file($this->schemaPath()) && is_file($this->seedPath());
        $checks[] = ['name' => 'schema.sql + seed_base.sql present', 'ok' => $schemaOk, 'required' => true,
                     'detail' => $schemaOk ? 'ok' : 'Missing deploy/schema.sql or deploy/seed_base.sql'];
        return $checks;
    }

    public function preflightPasses(): bool
    {
        foreach ($this->preflight() as $c) if ($c['required'] && !$c['ok']) return false;
        return true;
    }

    // ── Secrets ──────────────────────────────────────────────────────────────

    /** A fresh, per-install random secret (hex). Never a shipped default. */
    public static function generateSecret(int $bytes = 32): string
    {
        return bin2hex(random_bytes($bytes));
    }

    // ── Database connection ───────────────────────────────────────────────────

    /** Parse a DATABASE_URL into parts (mysql only for install). */
    public static function parseUrl(string $url): array
    {
        $p = parse_url($url);
        if ($p === false || !isset($p['host'])) throw new RuntimeException('DATABASE_URL is malformed.');
        return [
            'host'   => $p['host'],
            'port'   => (int)($p['port'] ?? 3306),
            'dbname' => ltrim($p['path'] ?? '', '/'),
            'user'   => isset($p['user']) ? urldecode($p['user']) : '',
            'pass'   => isset($p['pass']) ? urldecode($p['pass']) : '',
        ];
    }

    /**
     * Open a PDO for the install (multi-statement enabled so we can load the
     * schema/seed .sql files in one shot). Pass $withDb=false to connect to the
     * server without selecting a database (to CREATE it).
     */
    public function connect(string $url, bool $withDb = true): PDO
    {
        $c = self::parseUrl($url);
        $dsn = "mysql:host={$c['host']};port={$c['port']};charset=utf8mb4";
        if ($withDb) {
            if ($c['dbname'] === '') throw new RuntimeException('DATABASE_URL has no database name.');
            $dsn .= ";dbname={$c['dbname']}";
        }
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES   => true,
            PDO::MYSQL_ATTR_MULTI_STATEMENTS => true,
        ]);
        return $pdo;
    }

    /** Test a DATABASE_URL: true if we can connect (to the server). */
    public function testConnection(string $url): bool
    {
        $this->connect($url, false);
        return true;
    }

    /** CREATE DATABASE IF NOT EXISTS for the db named in the URL. */
    public function ensureDatabase(string $url): void
    {
        $c = self::parseUrl($url);
        if ($c['dbname'] === '') throw new RuntimeException('DATABASE_URL has no database name.');
        $srv = $this->connect($url, false);
        $srv->exec("CREATE DATABASE IF NOT EXISTS `{$c['dbname']}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
    }

    // ── Build the database ─────────────────────────────────────────────────────

    public function schemaPath(): string { return "$this->root/deploy/schema.sql"; }
    public function seedPath(): string   { return "$this->root/deploy/seed_base.sql"; }
    private function migrationsDir(): string { return "$this->root/deploy/migrations"; }

    /** Is the target database already built (has the members table)? */
    public function databaseBuilt(PDO $pdo): bool
    {
        try {
            $pdo->query("SELECT 1 FROM members LIMIT 1");
            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /** Load a .sql file (multi-statement). */
    private function runSqlFile(PDO $pdo, string $path): void
    {
        $sql = file_get_contents($path);
        if ($sql === false) throw new RuntimeException("Cannot read $path");
        $pdo->exec($sql);
    }

    /** Load the structure-only schema. */
    public function loadSchema(PDO $pdo): void { $this->runSqlFile($pdo, $this->schemaPath()); }

    /** Load the generic base-config seed (roles/permissions/config/programs). */
    public function loadSeed(PDO $pdo): void { $this->runSqlFile($pdo, $this->seedPath()); }

    /**
     * Record every migration present in this release as already applied — schema.sql
     * already reflects them, so they must NOT be re-run. migrate.php afterward only
     * applies migrations added after this snapshot.
     */
    public function stampMigrationBaseline(PDO $pdo): int
    {
        $pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $files = glob($this->migrationsDir() . '/*.sql') ?: [];
        sort($files);
        $ins = $pdo->prepare("INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES (?, NOW())");
        $n = 0;
        foreach ($files as $f) { $ins->execute([basename($f, '.sql')]); $n++; }
        return $n;
    }

    // ── First System Administrator ─────────────────────────────────────────────

    /**
     * Create the single is_system=1 System Administrator. Refuses if one already
     * exists (there is only ever ONE sysadmin; Admin accounts are created later
     * in-app and are NOT is_system).
     *
     * @return int new member id
     */
    public function createSysadmin(PDO $pdo, string $username, string $password, string $firstName, string $lastName, string $email): int
    {
        if ($this->sysadminExists($pdo)) {
            throw new RuntimeException('A System Administrator already exists.');
        }
        if ($err = Auth::passwordError($password)) throw new RuntimeException($err);
        $roleId = (int)$pdo->query("SELECT id FROM system_roles WHERE name='System Administrator'")->fetchColumn();
        if (!$roleId) throw new RuntimeException('System Administrator role is missing — seed did not load.');

        $num = $this->nextMemberNumber($pdo);
        $pdo->prepare("INSERT INTO members (member_number, username, password_hash, member_type, first_name, last_name, email, is_active, is_system)
                       VALUES (?,?,?,'mentor',?,?,?,1,1)")
            ->execute([$num, $username, password_hash($password, PASSWORD_BCRYPT), $firstName, $lastName, $email]);
        $mid = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")->execute([$mid, $roleId]);
        return $mid;
    }

    public function sysadminExists(PDO $pdo): bool
    {
        return (bool)$pdo->query("SELECT 1 FROM members WHERE is_system=1 LIMIT 1")->fetchColumn();
    }

    private function nextMemberNumber(PDO $pdo): string
    {
        $max = (int)$pdo->query("SELECT COALESCE(MAX(CAST(member_number AS UNSIGNED)),0) FROM members")->fetchColumn();
        return str_pad((string)($max + 1), 4, '0', STR_PAD_LEFT);
    }

    // ── .env ────────────────────────────────────────────────────────────────

    /**
     * Write .env with the given database URL, generated secrets, and identity.
     * Refuses to clobber an existing .env unless $force.
     */
    public function writeEnv(array $v, bool $force = false): string
    {
        $path = "$this->root/.env";
        if (is_file($path) && !$force) throw new RuntimeException('.env already exists (use --force to overwrite).');
        $lines = [
            "# Generated by the TRCMS installer on " . date('c'),
            "DATABASE_URL=" . ($v['DATABASE_URL'] ?? ''),
            "SECRET_KEY=" . ($v['SECRET_KEY'] ?? self::generateSecret()),
            "INCIDENT_VAULT_KEY=" . ($v['INCIDENT_VAULT_KEY'] ?? self::generateSecret()),
            "ACCESS_TOKEN_EXPIRE_MINUTES=" . ($v['ACCESS_TOKEN_EXPIRE_MINUTES'] ?? '1440'),
            "ALGORITHM=HS256",
            "ENVIRONMENT=" . ($v['ENVIRONMENT'] ?? 'production'),
            "APP_URL=" . ($v['APP_URL'] ?? ''),
            "ALLOWED_ORIGINS=" . ($v['ALLOWED_ORIGINS'] ?? ($v['APP_URL'] ?? '')),
            "ORG_NAME=" . ($v['ORG_NAME'] ?? 'My Organization'),
            "APP_TIMEZONE=" . ($v['APP_TIMEZONE'] ?? 'America/Chicago'),
            // Optional path/URL to the org's logo image. Empty → the UI shows a text
            // wordmark (the org's initials). Set it (or upload a logo) to show an image.
            "LOGO_URL=" . ($v['LOGO_URL'] ?? ''),
        ];
        if (file_put_contents($path, implode("\n", $lines) . "\n") === false) {
            throw new RuntimeException("Could not write $path");
        }
        @chmod($path, 0640);
        return $path;
    }

    // ── Install marker ─────────────────────────────────────────────────────────

    public function installState(PDO $pdo): ?array
    {
        try {
            $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category=?");
            $s->execute([self::INSTALL_CATEGORY]);
            $v = $s->fetchColumn();
            return $v ? (json_decode((string)$v, true) ?: null) : null;
        } catch (\Throwable) { return null; }
    }

    public function isInstalled(PDO $pdo): bool
    {
        $st = $this->installState($pdo);
        return is_array($st) && !empty($st['bootstrapped_at']);
    }

    /** Record that the DB bootstrap finished. setup_complete flips later via the wizard. */
    public function markBootstrapped(PDO $pdo, string $appVersion = ''): void
    {
        $payload = json_encode(['bootstrapped_at' => date('c'), 'app_version' => $appVersion, 'setup_complete' => false]);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category=?");
        $ex->execute([self::INSTALL_CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values`=?, updated_at=NOW() WHERE id=?")->execute([$payload, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category,label,`values`) VALUES (?, 'Install', ?)")->execute([self::INSTALL_CATEGORY, $payload]);
        }
    }

    public function markSetupComplete(PDO $pdo): void
    {
        $st = $this->installState($pdo) ?: ['bootstrapped_at' => date('c'), 'app_version' => ''];
        $st['setup_complete'] = true;
        $st['setup_completed_at'] = date('c');
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category=?");
        $ex->execute([self::INSTALL_CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values`=?, updated_at=NOW() WHERE id=?")->execute([json_encode($st), (int)$row['id']]);
        }
    }
}
