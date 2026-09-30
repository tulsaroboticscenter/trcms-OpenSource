<?php
/**
 * seed_dev.php — fill a LOCAL DEVELOPMENT database with a little fake data so a
 * new contributor can log in and see populated screens. It creates NO real
 * member information of any kind.
 *
 *   Usage:  php deploy/seed_dev.php
 *
 * Safety: this script refuses to run unless ENVIRONMENT=development AND the
 * database looks empty/fresh (few members). It will never touch production.
 *
 * Test login it creates:   username  devadmin     password  password123
 */
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use App\Core\Config;
use App\Core\Database;

// --- Load .env the same way the app does ---------------------------------
if (class_exists(\Dotenv\Dotenv::class)) {
    \Dotenv\Dotenv::createImmutable(__DIR__ . '/..')->safeLoad();
}

// --- Guardrails: never run against production -----------------------------
$env = strtolower((string) Config::get('ENVIRONMENT', ''));
if ($env !== 'development') {
    fwrite(STDERR, "Refusing to seed: ENVIRONMENT is not 'development' (got '" . $env . "').\n");
    fwrite(STDERR, "This script is for local dev databases only.\n");
    exit(1);
}

$pdo = Database::pdo();
$existing = (int) $pdo->query("SELECT COUNT(*) FROM members")->fetchColumn();
if ($existing > 5) {
    fwrite(STDERR, "Refusing to seed: the members table already has {$existing} rows.\n");
    fwrite(STDERR, "Seed only runs on a fresh/empty dev database to avoid clobbering real data.\n");
    exit(1);
}

echo "Seeding development data…\n";
$pdo->beginTransaction();
try {
    // Programs (idempotent) ------------------------------------------------
    $prog = function (string $name) use ($pdo): int {
        $s = $pdo->prepare("SELECT id FROM programs WHERE name = ?");
        $s->execute([$name]);
        if ($id = $s->fetchColumn()) return (int) $id;
        $pdo->prepare("INSERT INTO programs (name) VALUES (?)")->execute([$name]);
        return (int) $pdo->lastInsertId();
    };
    $ftc = $prog('FTC');
    $fll = $prog('FLL');

    // Test admin login -----------------------------------------------------
    $hash = password_hash('password123', PASSWORD_BCRYPT);
    $pdo->prepare(
        "INSERT INTO members (member_number, username, password_hash, member_type, first_name, last_name, email)
         VALUES ('D9000', 'devadmin', ?, 'mentor', 'Dev', 'Admin', 'devadmin@example.test')"
    )->execute([$hash]);
    $adminId = (int) $pdo->lastInsertId();

    // Give the test login the Admin system role if it exists ---------------
    $roleId = $pdo->query("SELECT id FROM system_roles WHERE name = 'Admin' LIMIT 1")->fetchColumn();
    if ($roleId) {
        $pdo->prepare("INSERT INTO member_system_roles (member_id, role_id) VALUES (?, ?)")
            ->execute([$adminId, (int) $roleId]);
    }

    // A few fake youth members --------------------------------------------
    $fakeYouth = [
        ['Robbie', 'Robot'], ['Ada', 'Gearheart'], ['Sam', 'Sprocket'],
        ['Kai', 'Circuit'], ['Nina', 'Newton'],
    ];
    $ins = $pdo->prepare(
        "INSERT INTO members (member_number, username, password_hash, member_type, first_name, last_name)
         VALUES (?, ?, ?, 'youth', ?, ?)"
    );
    foreach ($fakeYouth as $i => [$first, $last]) {
        $num = sprintf('D9%03d', $i + 1);
        $ins->execute([$num, "youth{$i}", $hash, $first, $last]);
    }

    // A team + current season ---------------------------------------------
    $season = '2025-2026';
    $pdo->prepare("INSERT INTO teams (team_number, program_id) VALUES ('99999', ?)")->execute([$ftc]);
    $teamId = (int) $pdo->lastInsertId();
    $pdo->prepare("INSERT INTO team_seasons (team_id, season, team_name, status) VALUES (?, ?, 'Test Bots', 'active')")
        ->execute([$teamId, $season]);

    // A few inventory items ------------------------------------------------
    $item = $pdo->prepare(
        "INSERT INTO inv_items (item_type, name, category, part_number, unit_of_measure, current_quantity)
         VALUES ('part', ?, ?, ?, 'Each', ?)"
    );
    $item->execute(['Sample Motor', 'Motors', 'MTR-001', 4]);
    $item->execute(['Sample Wheel', 'Drive', 'WHL-001', 8]);
    $item->execute(['Sample Bracket', 'Structure', 'BRK-001', 25]);

    $pdo->commit();
    echo "Done. Created test login:  username = devadmin   password = password123\n";
    echo "Plus " . count($fakeYouth) . " fake youth, 1 team, and 3 inventory items.\n";
} catch (\Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "Seed failed: " . $e->getMessage() . "\n");
    exit(1);
}
