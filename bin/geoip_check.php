<?php
declare(strict_types=1);

/**
 * Geo-restriction diagnostic. Prints exactly what the app sees so a "country stays blank"
 * problem can be pinpointed (path wrong / file missing / unreadable / library absent / bad DB).
 *
 * Run on the server:  php bin/geoip_check.php
 * (or as a one-off Plesk scheduled task with command `php /full/path/bin/geoip_check.php`)
 */

use App\Core\Config;
use App\Core\GeoIp;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$path = Config::get('GEOIP_DB_PATH');

echo "=== GeoIP diagnostic — " . gmdate('c') . " ===\n";
echo "app root:            " . dirname(__DIR__) . "\n";
echo "GEOIP_DB_PATH (app): " . var_export($path, true) . "\n";
echo "geoip2 library:      " . (class_exists('\GeoIp2\Database\Reader') ? 'PRESENT' : 'MISSING — pull vendor/ (composer)') . "\n";

if ($path === null || $path === '') {
    echo "-> GEOIP_DB_PATH is EMPTY. The .env the app loads has no valid value.\n";
    echo "   (Is it in THIS app's .env? Is the line 'GEOIP_DB_PATH=/abs/path' — no https://, no duplicate key?)\n";
} else {
    echo "file_exists:         " . (is_file($path) ? 'YES' : 'NO — nothing at that path') . "\n";
    echo "is_readable:         " . (is_readable($path) ? 'YES' : 'NO — check permissions for the web/CLI user') . "\n";
    echo "size:                " . (is_file($path) ? number_format((int)@filesize($path)) . ' bytes' : 'n/a') . "\n";
    echo "realpath:            " . var_export(realpath($path), true) . "\n";
}

// Locate the actual .mmdb so the correct GEOIP_DB_PATH is obvious, no guessing.
$appRoot = dirname(__DIR__);
echo "-- searching for GeoLite2-Country.mmdb (skips vendor/.git) --\n";
$found = [];
try {
    $it = new RecursiveIteratorIterator(
        new RecursiveCallbackFilterIterator(
            new RecursiveDirectoryIterator($appRoot, FilesystemIterator::SKIP_DOTS),
            fn ($cur) => !in_array($cur->getFilename(), ['vendor', '.git', 'node_modules'], true)
        ),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $f) {
        if ($f->isFile() && strtolower($f->getFilename()) === 'geolite2-country.mmdb') $found[] = $f->getPathname();
    }
} catch (\Throwable $e) { echo "  (scan error: " . $e->getMessage() . ")\n"; }
if ($found) {
    foreach ($found as $p) echo "  FOUND: $p\n";
    echo "  -> set GEOIP_DB_PATH in .env to exactly one of the FOUND paths above.\n";
    echo "  -> prefer a copy OUTSIDE the web docroot (not under public/) so it isn't downloadable.\n";
} else {
    echo "  not found anywhere under the app root. Upload GeoLite2-Country.mmdb to, e.g.,\n";
    echo "  $appRoot/data/  (create the folder), then point GEOIP_DB_PATH there.\n";
}

echo "GeoIp::available():  " . var_export(GeoIp::available(), true) . "  (must be TRUE for country lookups)\n";
echo "lookup 8.8.8.8:      " . var_export(GeoIp::country('8.8.8.8'), true) . "   (expect 'US' when working)\n";
echo "lookup 108.89.127.166: " . var_export(GeoIp::country('108.89.127.166'), true) . " (your IP; expect 'US')\n";
echo "=== end ===\n";
