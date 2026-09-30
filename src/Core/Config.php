<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Loads environment configuration (.env) once and exposes typed getters.
 * Mirrors the Python app's pydantic Settings.
 */
final class Config
{
    private static array $cache = [];

    public static function load(string $rootDir): void
    {
        if (is_file($rootDir . '/.env')) {
            $dotenv = \Dotenv\Dotenv::createImmutable($rootDir);
            $dotenv->safeLoad();
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }
        $val = $_ENV[$key] ?? getenv($key);
        $val = ($val === false || $val === null || $val === '') ? $default : (string)$val;
        self::$cache[$key] = $val;
        return $val;
    }

    public static function int(string $key, int $default): int
    {
        $v = self::get($key);
        return $v === null ? $default : (int)$v;
    }

    /** Comma-separated origins → array. */
    public static function corsOrigins(): array
    {
        $raw = self::get('ALLOWED_ORIGINS', 'http://localhost:8080');
        return array_values(array_filter(array_map('trim', explode(',', (string)$raw))));
    }
}
