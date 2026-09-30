<?php
declare(strict_types=1);

/**
 * TRCMS database migration runner.
 *
 * Every schema change lives in deploy/migrations/NNNN_description.sql (forward-only,
 * never edited once released). This script applies the ones that haven't run yet and
 * records them in a `schema_migrations` table, so each environment knows exactly what
 * it's at — no more guessing what's pending.
 *
 * Usage (from the project root, against whatever DATABASE_URL the .env points to):
 *   php deploy/migrate.php            Apply all pending migrations to this database.
 *   php deploy/migrate.php --print    Print the pending SQL (+ tracking inserts) WITHOUT
 *                                     applying — paste this into phpMyAdmin on a host
 *                                     where you can't run PHP from a shell.
 *   php deploy/migrate.php --status   Show applied vs pending, then exit.
 *
 * Production (no shell): run `php deploy/migrate.php --print` on your dev machine, then
 * paste the output into phpMyAdmin → SQL on the production DB. It includes the INSERTs
 * that mark the migrations as applied there too.
 */

require __DIR__ . '/../vendor/autoload.php';

use App\Core\Config;
use App\Core\Database;

Config::load(dirname(__DIR__));
$pdo = Database::pdo();
$args = array_slice($argv, 1);
$print    = in_array('--print', $args, true);
$printAll = in_array('--print-all', $args, true);
$status   = in_array('--status', $args, true);

$pdo->exec("CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$applied = $pdo->query("SELECT version FROM schema_migrations")->fetchAll(PDO::FETCH_COLUMN);
$files = glob(__DIR__ . '/migrations/*.sql');
sort($files);

$pending = [];
foreach ($files as $f) {
    $version = basename($f, '.sql');
    if (!in_array($version, $applied, true)) $pending[$version] = $f;
}

if ($status) {
    echo "Applied (" . count($applied) . "):\n";
    foreach ($applied as $v) echo "  ✓ $v\n";
    echo "Pending (" . count($pending) . "):\n";
    foreach ($pending as $v => $_) echo "  • $v\n";
    exit(0);
}

// --print-all emits EVERY migration (not just pending) wrapped in IF-NOT-EXISTS-style
// guards via the schema_migrations check, for bootstrapping a brand-new database (e.g.
// production, where there's no shell to run pending detection). Each block is skipped on
// the target if its version is already recorded there.
if ($printAll) {
    echo "-- ===== ALL migrations — paste into phpMyAdmin (SQL tab) on the target DB =====\n";
    echo "-- Use this ONCE to bootstrap a database that has never run migrations (e.g. prod).\n";
    echo "-- Each block records itself in schema_migrations; afterward use --print for deltas.\n\n";
    echo "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n\n";
    foreach ($files as $file) {
        $version = basename($file, '.sql');
        echo "-- migration: $version\n";
        echo rtrim(file_get_contents($file)) . "\n";
        echo "INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('$version', NOW());\n\n";
    }
    exit(0);
}

if (!$pending) { echo "Database is up to date. Nothing to apply.\n"; exit(0); }

if ($print) {
    echo "-- ===== Paste into phpMyAdmin (SQL tab) on the target database =====\n\n";
    foreach ($pending as $version => $file) {
        echo "-- migration: $version\n";
        echo rtrim(file_get_contents($file)) . "\n";
        echo "INSERT INTO schema_migrations (version, applied_at) VALUES ('$version', NOW());\n\n";
    }
    exit(0);
}

// Apply for real.
foreach ($pending as $version => $file) {
    echo "Applying $version ... ";
    $sql = file_get_contents($file);
    // Strip full-line SQL comments, then run each statement (DDL migrations are
    // split on a semicolon that ends a line).
    $sql = preg_replace('/^\s*--.*$/m', '', (string)$sql);
    foreach (array_filter(array_map('trim', preg_split('/;\s*\n/', $sql))) as $stmt) {
        if ($stmt === '') continue;
        $pdo->exec($stmt);
    }
    $pdo->prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, NOW())")->execute([$version]);
    echo "done\n";
}
echo "All migrations applied.\n";
