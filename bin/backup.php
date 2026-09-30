<?php
declare(strict_types=1);

/**
 * TRCMS System Backup
 * ===================
 * Creates a timestamped backup of the MySQL database AND the application files,
 * then prunes old backups on a grandfather-father-son retention schedule.
 *
 * Each run produces  <BACKUP_DIR>/trcms-YYYYMMDD-HHMMSS/  containing:
 *   db.sql.gz       gzip'd mysqldump (schema + data, consistent InnoDB snapshot)
 *   files.tar.gz    the app tree (code, vendor, public/uploads, .env)
 *   manifest.json   what's in this backup + sizes + versions
 *
 * SECURITY: backups contain ALL member PII and the app secrets (.env). They are
 * written OUTSIDE the web root and locked to the owner (dir 0700, files 0600).
 * Never move BACKUP_DIR under public/.
 *
 * Config (all optional, via .env):
 *   BACKUP_DIR             where to store backups (default: <app>/../trcms-backups)
 *   BACKUP_KEEP_WEEKLY     keep this many most-recent backups   (default 8)
 *   BACKUP_KEEP_MONTHLY    then one per month for N months      (default 12)
 *   BACKUP_KEEP_YEARLY     then one per year for N years         (default 3)
 *   MYSQLDUMP_BIN          path to mysqldump (default: "mysqldump" on PATH)
 *
 * Usage (Plesk Scheduled Task, weekly):
 *   php bin/backup.php
 * Flags:
 *   --prune-only   run retention pruning without creating a new backup
 *   --dry-run      show what a backup/prune would do, change nothing
 */

use App\Core\Config;
use App\Core\Database;

require __DIR__ . '/../vendor/autoload.php';

$appRoot = dirname(__DIR__);
Config::load($appRoot);

$argsList  = array_slice($argv, 1);
$dryRun    = in_array('--dry-run', $argsList, true);
$pruneOnly = in_array('--prune-only', $argsList, true);

// --check: report why a run would fail, without attempting one. Safe to run any time.
if (in_array('--check', $argsList, true)) {
    $pre = App\Core\SystemBackup::preflight();
    echo "TRCMS backup preflight
";
    echo str_repeat('-', 60) . "
";
    foreach ($pre['checks'] as $c) {
        printf("[%s] %s
      %s
", $c['ok'] ? ' OK ' : 'FAIL', $c['label'], $c['detail']);
        if (!$c['ok'] && $c['fix']) printf("      FIX: %s
", $c['fix']);
    }
    echo str_repeat('-', 60) . "
";
    echo $pre['can_run'] ? "Backups can run.
" : ('BLOCKED: ' . implode('; ', $pre['blockers']) . "
");
    exit($pre['can_run'] ? 0 : 1);
}

function human(int $b): string {
    $u = ['B', 'KB', 'MB', 'GB', 'TB']; $i = 0;
    while ($b >= 1024 && $i < count($u) - 1) { $b /= 1024; $i++; }
    return round($b, 1) . ' ' . $u[$i];
}
function out(string $m): void { echo $m . "\n"; }
function fail(string $m): void { fwrite(STDERR, "ERROR: $m\n"); exit(1); }

// ── Resolve + secure the backup directory ─────────────────────────────────────
$backupDir = Config::get('BACKUP_DIR');
if (!$backupDir) $backupDir = $appRoot . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'trcms-backups';
$backupDir = rtrim($backupDir, "/\\");
if (!is_dir($backupDir)) {
    if ($dryRun) { out("[dry-run] would create backup dir: $backupDir"); }
    elseif (!@mkdir($backupDir, 0700, true) && !is_dir($backupDir)) fail("Could not create backup dir: $backupDir");
}
@chmod($backupDir, 0700);

// Refuse to write backups anywhere web-servable.
$docRoot = $appRoot . DIRECTORY_SEPARATOR . 'public';
$realBackup = realpath($backupDir) ?: $backupDir;
$realDoc = realpath($docRoot) ?: $docRoot;
if (strpos($realBackup, $realDoc) === 0) {
    fail("Refusing to write backups inside the web root ($realDoc). Set BACKUP_DIR to a path outside public/.");
}

// ── Create a new backup (unless --prune-only) ─────────────────────────────────
if (!$pruneOnly) {
    $stamp = date('Ymd-His');
    $dest  = $backupDir . DIRECTORY_SEPARATOR . "trcms-$stamp";
    out("TRCMS backup → $dest");

    if ($dryRun) {
        out("[dry-run] would dump database and tar app files here.");
    } else {
        if (!@mkdir($dest, 0700, true)) fail("Could not create $dest");

        // 1) Database — mysqldump piped to gzip. Password passed via a 0600 temp
        //    defaults file so it never appears in the process list.
        $db = Database::config();
        if ($db['driver'] !== 'mysql') fail("Only MySQL backups are supported (driver: {$db['driver']}).");
        $dumpBin = Config::get('MYSQLDUMP_BIN') ?: 'mysqldump';
        $cnf = $dest . DIRECTORY_SEPARATOR . '.my.cnf.tmp';
        file_put_contents($cnf, "[client]\nuser=\"{$db['user']}\"\npassword=\"{$db['pass']}\"\nhost=\"{$db['host']}\"\nport={$db['port']}\n");
        @chmod($cnf, 0600);
        $dbFile = $dest . DIRECTORY_SEPARATOR . 'db.sql.gz';
        $cmd = escapeshellarg($dumpBin) . ' --defaults-extra-file=' . escapeshellarg($cnf)
             . ' --single-transaction --quick --routines --triggers --events --no-tablespaces '
             . escapeshellarg($db['dbname'])
             . ' 2> ' . escapeshellarg($dest . DIRECTORY_SEPARATOR . 'db.err')
             . ' | gzip > ' . escapeshellarg($dbFile);
        exec($cmd, $o, $rc);
        @unlink($cnf);
        if ($rc !== 0 || !is_file($dbFile) || filesize($dbFile) < 100) {
            $err = @file_get_contents($dest . DIRECTORY_SEPARATOR . 'db.err');
            fail("Database dump failed (exit $rc). " . trim((string)$err));
        }
        @unlink($dest . DIRECTORY_SEPARATOR . 'db.err');
        @chmod($dbFile, 0600);
        out("  database  ✓  " . human((int)filesize($dbFile)));

        // 2) Files — tar the app tree. Exclude VCS/build junk and the backups dir
        //    itself; INCLUDE vendor, public/uploads and .env so a restore is
        //    self-contained.
        $filesFile = $dest . DIRECTORY_SEPARATOR . 'files.tar.gz';
        $excludes = ['./.git', './node_modules', './.github', './*.log'];
        $exArgs = '';
        foreach ($excludes as $e) $exArgs .= ' --exclude=' . escapeshellarg($e);
        // Also exclude the backup dir if it happens to sit inside the app tree.
        if (strpos($realBackup, realpath($appRoot) ?: $appRoot) === 0) {
            $exArgs .= ' --exclude=' . escapeshellarg('./' . basename($realBackup));
        }
        // --force-local: don't treat a ":" in the archive path as a remote host
        // (matters when BACKUP_DIR is an absolute Windows path like C:\…).
        $tarCmd = 'tar --force-local -czf ' . escapeshellarg($filesFile) . $exArgs
                . ' -C ' . escapeshellarg($appRoot) . ' . 2> ' . escapeshellarg($dest . DIRECTORY_SEPARATOR . 'files.err');
        exec($tarCmd, $o2, $rc2);
        // tar exit 1 = "some files changed while reading" (harmless); treat only >1 as fatal.
        if ($rc2 > 1 || !is_file($filesFile)) {
            $err = @file_get_contents($dest . DIRECTORY_SEPARATOR . 'files.err');
            fail("File archive failed (exit $rc2). " . trim((string)$err));
        }
        @unlink($dest . DIRECTORY_SEPARATOR . 'files.err');
        @chmod($filesFile, 0600);
        out("  files     ✓  " . human((int)filesize($filesFile)));

        // 3) Manifest
        $manifest = [
            'created_at'   => date('c'),
            'hostname'     => gethostname() ?: null,
            'php_version'  => PHP_VERSION,
            'git_commit'   => trim((string)@shell_exec('git -C ' . escapeshellarg($appRoot) . ' rev-parse --short HEAD 2>/dev/null')) ?: null,
            'database'     => ['file' => 'db.sql.gz', 'bytes' => (int)filesize($dbFile), 'dbname' => $db['dbname']],
            'files'        => ['file' => 'files.tar.gz', 'bytes' => (int)filesize($filesFile)],
        ];
        file_put_contents($dest . DIRECTORY_SEPARATOR . 'manifest.json', json_encode($manifest, JSON_PRETTY_PRINT));
        @chmod($dest . DIRECTORY_SEPARATOR . 'manifest.json', 0600);
        @chmod($dest, 0700);
        out("  total     " . human((int)filesize($dbFile) + (int)filesize($filesFile)));
    }
}

// ── Retention: grandfather-father-son pruning ─────────────────────────────────
$keepWeekly  = (int)(Config::get('BACKUP_KEEP_WEEKLY')  ?: 8);
$keepMonthly = (int)(Config::get('BACKUP_KEEP_MONTHLY') ?: 12);
$keepYearly  = (int)(Config::get('BACKUP_KEEP_YEARLY')  ?: 3);

$all = [];
foreach (glob($backupDir . DIRECTORY_SEPARATOR . 'trcms-*', GLOB_ONLYDIR) ?: [] as $d) {
    if (preg_match('/trcms-(\d{8})-(\d{6})$/', $d, $m)) {
        $ts = \DateTime::createFromFormat('Ymd His', $m[1] . ' ' . $m[2]);
        if ($ts) $all[$d] = $ts;
    }
}
uasort($all, fn($a, $b) => $b <=> $a); // newest first

$keep = []; $i = 0; $months = []; $years = [];
foreach ($all as $dir => $ts) {
    if ($i < $keepWeekly) { $keep[$dir] = 'recent'; $i++; continue; }
    $ym = $ts->format('Y-m'); $y = $ts->format('Y');
    if (!isset($months[$ym]) && count($months) < $keepMonthly) { $months[$ym] = true; $keep[$dir] = 'monthly'; continue; }
    if (!isset($years[$y]) && count($years) < $keepYearly)     { $years[$y] = true;  $keep[$dir] = 'yearly';  continue; }
}
$prune = array_diff(array_keys($all), array_keys($keep));

out("\nRetention: keep " . count($keep) . " (weekly $keepWeekly / monthly $keepMonthly / yearly $keepYearly), prune " . count($prune) . ".");
foreach ($prune as $dir) {
    if ($dryRun) { out("  [dry-run] would delete " . basename($dir)); continue; }
    foreach (glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) @unlink($f);
    @rmdir($dir);
    out("  deleted " . basename($dir));
}

out("\nDone.");
