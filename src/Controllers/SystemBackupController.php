<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Permissions;
use App\Core\SystemBackup;
use App\Core\Http;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;

/**
 * System Backups — a read-only monitoring view over the backups produced by
 * bin/backup.php, plus a "run now" trigger. System-Administrator only.
 *
 * NOTE: backups contain all member PII and the app secrets, so they live outside
 * the web root and are NEVER downloadable through the app. This controller only
 * reports what exists; retrieving a backup is done over SSH/File Manager.
 */
final class SystemBackupController
{
    private static function guard(Request $req): ?array
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['System Administrator'])) return null;
        return $m;
    }

    private static function backupDir(): string
    {
        $appRoot = dirname(__DIR__, 2);
        $dir = Config::get('BACKUP_DIR');
        if (!$dir) $dir = $appRoot . '/../trcms-backups';
        return rtrim($dir, "/\\");
    }

    /** GET /admin/backups — list existing backups + config (System Administrator). */
    public static function list(Request $req, Response $res): Response
    {
        if (!self::guard($req)) return Http::error($res, 'Access denied', 403);
        $dir = self::backupDir();
        $items = [];
        foreach (glob($dir . '/trcms-*', GLOB_ONLYDIR) ?: [] as $d) {
            if (!preg_match('/trcms-(\d{8})-(\d{6})$/', $d, $mm)) continue;
            $manifest = @json_decode((string)@file_get_contents($d . '/manifest.json'), true) ?: [];
            $dbBytes = (int)($manifest['database']['bytes'] ?? (is_file($d . '/db.sql.gz') ? filesize($d . '/db.sql.gz') : 0));
            $fBytes  = (int)($manifest['files']['bytes'] ?? (is_file($d . '/files.tar.gz') ? filesize($d . '/files.tar.gz') : 0));
            $items[] = [
                'name'        => basename($d),
                'created_at'  => $manifest['created_at'] ?? null,
                'db_bytes'    => $dbBytes,
                'files_bytes' => $fBytes,
                'total_bytes' => $dbBytes + $fBytes,
                'complete'    => is_file($d . '/db.sql.gz') && is_file($d . '/files.tar.gz'),
            ];
        }
        usort($items, fn($a, $b) => strcmp($b['name'], $a['name'])); // newest first
        return Http::json($res, [
            'backups'   => $items,
            'dir'       => $dir,
            'retention' => [
                'weekly'  => (int)(Config::get('BACKUP_KEEP_WEEKLY')  ?: 8),
                'monthly' => (int)(Config::get('BACKUP_KEEP_MONTHLY') ?: 12),
                'yearly'  => (int)(Config::get('BACKUP_KEEP_YEARLY')  ?: 3),
            ],
            'can_run_now' => DIRECTORY_SEPARATOR === '/', // detached run only supported on the Linux host
            // Why a run might not be working, so the page can say so instead of the
            // admin pressing a button that silently does nothing.
            'preflight' => SystemBackup::preflight(),
            'log_tail'  => self::logTail(),
        ]);
    }

    /** Last few KB of the backup log — the fastest way to see why a run died. */
    private static function logTail(int $bytes = 4000): ?string
    {
        $f = self::backupDir() . '/backup.log';
        if (!is_file($f)) return null;
        $size = filesize($f) ?: 0;
        $fh = @fopen($f, 'rb');
        if (!$fh) return null;
        if ($size > $bytes) fseek($fh, $size - $bytes);
        $out = stream_get_contents($fh);
        fclose($fh);
        return $out === false ? null : $out;
    }

    /** POST /admin/backups/run — launch a backup in the background (System Administrator). */
    public static function runNow(Request $req, Response $res): Response
    {
        $m = self::guard($req);
        if (!$m) return Http::error($res, 'Access denied', 403);
        if (DIRECTORY_SEPARATOR !== '/') {
            return Http::error($res, 'Run-now is only available on the server. Backups otherwise run on the weekly schedule.', 400);
        }
        // Check BEFORE claiming anything. This endpoint used to @exec() and return
        // ok/started unconditionally, so a run blocked by the host looked successful.
        $pre = SystemBackup::preflight();
        if (!$pre['can_run']) {
            return Http::json($res, [
                'ok' => false, 'started' => false,
                'detail' => 'Backup cannot start: ' . implode('; ', $pre['blockers']),
                'preflight' => $pre,
            ], 400);
        }

        $appRoot = dirname(__DIR__, 2);
        $log = self::backupDir() . '/backup.log';
        $marker = 'run requested ' . gmdate('c') . " by member {$m['id']}";
        @file_put_contents($log, "\n=== $marker ===\n", FILE_APPEND);

        // Fully detach into its own session (setsid) with stdin off /dev/null, so the
        // child survives PHP-FPM tearing the request down — the usual reason a run
        // "started" but nothing was ever produced. Falls back to plain nohup if the host
        // has no setsid.
        $php = escapeshellarg($pre['php_cli']);
        $script = escapeshellarg($appRoot . '/bin/backup.php');
        $redir = '< /dev/null >> ' . escapeshellarg($log) . ' 2>&1';
        $cmd = \App\Core\SystemBackup::commandExists('setsid')
            ? "setsid $php $script $redir &"
            : "nohup $php $script $redir &";
        $out = []; $rc = 0;
        exec($cmd, $out, $rc);

        \App\Core\Audit::write(Database::pdo(), (int)$m['id'], 'system', null, 'system.run_backup', null,
            ['php' => $pre['php_cli'], 'rc' => $rc]);

        if ($rc !== 0) {
            return Http::json($res, [
                'ok' => false, 'started' => false,
                'detail' => "Could not start the backup process (exit $rc). " . trim(implode(' ', $out)),
                'preflight' => $pre,
            ], 500);
        }

        // Peek the log after a moment so an immediate crash (fatal, bad path, dump error)
        // is reported right here instead of the user having to hunt for it.
        usleep(2500000);
        $tail = self::logTail(2500) ?? '';
        if (preg_match('/ERROR:|PHP (Fatal|Parse|Warning)|Uncaught|No such file|Permission denied|command not found/i', $tail)) {
            return Http::json($res, [
                'ok' => false, 'started' => true,
                'detail' => 'The backup process started but reported an error. See the log below.',
                'log_tail' => $tail,
            ], 200);
        }
        return Http::json($res, [
            'ok' => true, 'started' => true,
            'detail' => 'Backup started. It runs in the background — refresh in a minute to see it listed.',
            'log_tail' => $tail,
            'log' => $log,
        ]);
    }
}
