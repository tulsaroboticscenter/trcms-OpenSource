<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Single shared PDO connection. Driver is chosen from the DATABASE_URL scheme:
 *   mysql://…  → MySQL (the production/hosting target)
 *   postgresql://… (or postgres://) → PostgreSQL
 * This app never creates or alters schema — the schema is provisioned separately.
 */
final class Database
{
    private static ?PDO $pdo = null;

    /**
     * The parsed DATABASE_URL connection parts (driver/host/port/dbname/user/pass).
     * Used by tooling that needs to shell out to mysqldump/pg_dump for backups.
     */
    public static function config(): array
    {
        $url = Config::get('DATABASE_URL');
        if (!$url) throw new \RuntimeException('DATABASE_URL is not set.');
        $p = parse_url($url);
        if ($p === false || !isset($p['host'])) throw new \RuntimeException('DATABASE_URL is malformed.');
        $scheme = strtolower($p['scheme'] ?? 'postgresql');
        $isMysql = in_array($scheme, ['mysql', 'mysql2', 'mariadb'], true);
        return [
            'driver' => $isMysql ? 'mysql' : 'pgsql',
            'host'   => $p['host'],
            'port'   => (int)($p['port'] ?? ($isMysql ? 3306 : 5432)),
            'dbname' => ltrim($p['path'] ?? '', '/'),
            'user'   => isset($p['user']) ? urldecode($p['user']) : '',
            'pass'   => isset($p['pass']) ? urldecode($p['pass']) : '',
        ];
    }

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        $url = Config::get('DATABASE_URL');
        if (!$url) {
            throw new \RuntimeException('DATABASE_URL is not set.');
        }
        $p = parse_url($url);
        if ($p === false || !isset($p['host'])) {
            throw new \RuntimeException('DATABASE_URL is malformed.');
        }
        $scheme = strtolower($p['scheme'] ?? 'postgresql');
        $isMysql = in_array($scheme, ['mysql', 'mysql2', 'mariadb'], true);
        $host = $p['host'];
        $port = $p['port'] ?? ($isMysql ? 3306 : 5432);
        $db   = ltrim($p['path'] ?? '', '/');
        $user = isset($p['user']) ? urldecode($p['user']) : '';
        $pass = isset($p['pass']) ? urldecode($p['pass']) : '';

        $dsn = $isMysql
            ? sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $db)
            : sprintf('pgsql:host=%s;port=%d;dbname=%s', $host, $port, $db);

        self::$pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return self::$pdo;
    }
}
