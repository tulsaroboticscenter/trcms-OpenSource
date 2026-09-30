<?php
declare(strict_types=1);

/**
 * Backfill tagged-asset quantities.
 *
 * A tagged asset (item_type='asset_tagged') is a single physical item and
 * should count as quantity 1. Legacy assets created before that default may
 * sit at current_quantity 0/NULL, which makes their value compute to 0.
 *
 * For each such asset this script — respecting the holdings ledger, since
 * current_quantity is the SUM of inv_item_holdings — does the safe thing:
 *   - if the asset already has holdings summing to > 0, it only re-syncs the
 *     denormalized current_quantity from those holdings (no new stock invented);
 *   - otherwise it seeds a single holding of 1 at the asset's home bucket
 *     (its assigned team-season if set, else its location, else unassigned)
 *     and sets current_quantity to 1.
 *
 * DRY RUN BY DEFAULT — prints what it would do and changes nothing. Pass
 * --apply to commit. Idempotent: re-running only touches assets still at 0.
 *
 * Usage:
 *   php bin/backfill_tagged_asset_qty.php            # preview
 *   php bin/backfill_tagged_asset_qty.php --apply    # commit
 */

use App\Core\Config;
use App\Core\Database;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$apply = in_array('--apply', $argv, true);
$pdo = Database::pdo();

// Candidate assets: tagged, quantity currently empty.
$targets = $pdo->query(
    "SELECT id, name, asset_tag, location_id, assigned_team_season_id, cost
       FROM inv_items
      WHERE item_type = 'asset_tagged'
        AND COALESCE(current_quantity, 0) = 0
      ORDER BY id"
)->fetchAll(PDO::FETCH_ASSOC);

if (!$targets) {
    fwrite(STDOUT, "No tagged assets need backfilling — all already have a quantity.\n");
    exit(0);
}

$sumHoldings = $pdo->prepare("SELECT COALESCE(SUM(quantity), 0) FROM inv_item_holdings WHERE item_id = ?");
$findBucket  = $pdo->prepare(
    "SELECT id FROM inv_item_holdings WHERE item_id = ? AND location_id <=> ? AND team_season_id <=> ? LIMIT 1"
);
$updBucket   = $pdo->prepare("UPDATE inv_item_holdings SET quantity = 1, updated_at = NOW() WHERE id = ?");
$insBucket   = $pdo->prepare(
    "INSERT INTO inv_item_holdings (item_id, location_id, team_season_id, quantity, created_at, updated_at)
     VALUES (?, ?, ?, 1, NOW(), NOW())"
);
$setQty      = $pdo->prepare("UPDATE inv_items SET current_quantity = ?, updated_at = NOW() WHERE id = ?");

$seed = 0; $resync = 0;
if ($apply) $pdo->beginTransaction();
try {
    foreach ($targets as $t) {
        $id = (int)$t['id'];
        $sumHoldings->execute([$id]);
        $held = (float)$sumHoldings->fetchColumn();

        if ($held > 0.0001) {
            // Holdings exist; just fix the stale denormalized field.
            $resync++;
            fwrite(STDOUT, sprintf("  [resync] #%d %-30s holdings=%.2f -> current_quantity=%.2f\n", $id, mb_strimwidth((string)$t['name'], 0, 30), $held, $held));
            if ($apply) $setQty->execute([$held, $id]);
            continue;
        }

        // No stock recorded — seed a single holding at the home bucket.
        // Team wins if both team and location are set (mirrors item create).
        $team = $t['assigned_team_season_id'] !== null ? (int)$t['assigned_team_season_id'] : null;
        $loc  = $team !== null ? null : ($t['location_id'] !== null ? (int)$t['location_id'] : null);
        $seed++;
        $where = $team !== null ? "team_season $team" : ($loc !== null ? "location $loc" : "unassigned");
        fwrite(STDOUT, sprintf("  [seed]   #%d %-30s qty 1 @ %s\n", $id, mb_strimwidth((string)$t['name'], 0, 30), $where));
        if ($apply) {
            $findBucket->execute([$id, $loc, $team]);
            $bid = $findBucket->fetchColumn();
            if ($bid !== false) $updBucket->execute([(int)$bid]);
            else $insBucket->execute([$id, $loc, $team]);
            $setQty->execute([1, $id]);
        }
    }
    if ($apply) $pdo->commit();
} catch (\Throwable $e) {
    if ($apply && $pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "ERROR: " . $e->getMessage() . "\nNo changes were committed.\n");
    exit(1);
}

fwrite(STDOUT, sprintf(
    "\n%s %d tagged asset(s): %d seeded to qty 1, %d re-synced from existing holdings.\n",
    $apply ? "Applied to" : "Would update",
    count($targets), $seed, $resync
));
if (!$apply) fwrite(STDOUT, "Dry run — nothing changed. Re-run with --apply to commit.\n");
exit(0);
