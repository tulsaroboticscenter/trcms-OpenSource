<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Preflight checks for the System Backup feature.
 *
 * "Run now" launches bin/backup.php as a detached process. On shared hosting that
 * can fail for several unrelated reasons, and it used to fail SILENTLY: the endpoint
 * called @exec() — suppressing errors, ignoring the return value — and then reported
 * ok/started regardless, so the button always looked like it worked while nothing ran.
 *
 * These checks name the actual blocker instead. Each returns ok plus a human
 * explanation and, where relevant, a fix.
 */
final class SystemBackup
{
    /** PHP functions we need to launch anything at all. */
    private const LAUNCHERS = ['exec', 'shell_exec', 'proc_open', 'popen'];

    /** True when the host has disabled the function via disable_functions. */
    public static function functionDisabled(string $fn): bool
    {
        if (!function_exists($fn)) return true;
        $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
        return in_array($fn, $disabled, true);
    }

    /**
     * Find a PHP **CLI** binary. Under PHP-FPM, PHP_BINARY is the php-fpm binary —
     * handing bin/backup.php to that does not run the script, which is a common and
     * very confusing cause of "nothing happened". Prefer an explicit PHP_BIN from
     * .env, then the usual locations, and only fall back to PHP_BINARY if it looks
     * like a CLI build.
     *
     * @return array{path:?string,candidates:array<string,string>}
     */
    public static function findPhpCli(): array
    {
        $tried = [];
        $candidates = array_values(array_unique(array_filter(array_merge(
            [Config::get('PHP_BIN') ?: null],
            // Every Plesk-installed PHP version keeps its CLI at /opt/plesk/php/<ver>/bin/php.
            // Scan them newest-first so we don't depend on which version the site's FPM runs.
            self::pleskPhpCandidates(),
            [
                PHP_BINDIR . '/php',
                '/usr/bin/php',
                '/usr/local/bin/php',
                self::phpOnPath(),                       // whatever `php` resolves to on PATH
                (PHP_SAPI === 'cli' ? PHP_BINARY : null),
            ]
        ))));

        foreach ($candidates as $c) {
            // Try to RUN it first: exec/shell_exec are not subject to open_basedir, whereas
            // is_file()/is_executable() are — so on hosts that wall off /opt a perfectly good
            // /opt/plesk/php/<ver>/bin/php would otherwise be reported as "not found".
            $sapi = self::probeSapi($c);
            if ($sapi === 'cli') { $tried[$c] = 'OK'; return ['path' => $c, 'candidates' => $tried]; }
            if ($sapi !== null) { $tried[$c] = "wrong SAPI ($sapi) — not a CLI binary"; continue; }
            // Couldn't run it — say why as best we can (these checks may be open_basedir-limited).
            if (!@is_file($c)) { $tried[$c] = 'not found'; continue; }
            if (!@is_executable($c)) { $tried[$c] = 'not executable'; continue; }
            $tried[$c] = 'could not run it';
        }
        return ['path' => null, 'candidates' => $tried];
    }

    /** Every Plesk-installed PHP CLI (/opt/plesk/php/<ver>/bin/php), newest version first. */
    private static function pleskPhpCandidates(): array
    {
        $found = @glob('/opt/plesk/php/*/bin/php') ?: [];   // empty if open_basedir blocks /opt
        if (!$found && !self::functionDisabled('shell_exec')) {
            // glob() respects open_basedir; a shell `ls` does not — so this reaches /opt even
            // when PHP's own filesystem calls can't.
            $out = (string) @shell_exec('ls -d /opt/plesk/php/*/bin/php 2>/dev/null');
            $found = array_values(array_filter(array_map('trim', explode("\n", $out)), fn($p) => $p !== '' && $p[0] === '/'));
        }
        // Sort by version descending (…/8.3/… before …/8.2/…) so we prefer the newest.
        usort($found, fn($a, $b) => version_compare(
            (string) (preg_match('#/php/([0-9.]+)/#', $b, $m) ? $m[1] : '0'),
            (string) (preg_match('#/php/([0-9.]+)/#', $a, $n) ? $n[1] : '0')
        ));
        return $found;
    }

    /** Absolute path of whatever `php` resolves to on PATH, or null. */
    private static function phpOnPath(): ?string
    {
        if (self::functionDisabled('shell_exec')) return null;
        $out = trim((string) @shell_exec('command -v php 2>/dev/null'));
        return ($out !== '' && $out[0] === '/') ? $out : null;
    }

    /** Ask a candidate binary what SAPI it is; null when it can't be run. */
    private static function probeSapi(string $bin): ?string
    {
        if (self::functionDisabled('shell_exec')) return null;
        $out = @shell_exec(escapeshellarg($bin) . ' -r "echo PHP_SAPI;" 2>&1');
        $out = trim((string)$out);
        return $out !== '' && preg_match('/^[a-z0-9_\-]+$/i', $out) ? $out : null;
    }

    /** Is an external command available on PATH (or at an absolute path)? */
    public static function commandExists(string $cmd): bool
    {
        if (self::functionDisabled('shell_exec')) return false;
        if (str_contains($cmd, '/') || str_contains($cmd, '\\')) return @is_executable($cmd);
        $which = DIRECTORY_SEPARATOR === '/' ? 'command -v ' : 'where ';
        return trim((string)@shell_exec($which . escapeshellarg($cmd) . ' 2>&1')) !== '';
    }

    public static function backupDir(): string
    {
        $dir = Config::get('BACKUP_DIR');
        if (!$dir) $dir = dirname(__DIR__, 2) . '/../trcms-backups';
        return rtrim($dir, "/\\");
    }

    /**
     * Run every check. Returns a list of ['key','label','ok','detail','fix'] plus an
     * overall can_run flag for the things that actually block a run.
     */
    public static function preflight(): array
    {
        $checks = [];

        // 1. Can we launch a process at all?
        $available = array_values(array_filter(self::LAUNCHERS, fn($f) => !self::functionDisabled($f)));
        $checks[] = [
            'key' => 'launcher', 'label' => 'PHP can start a background process',
            'ok' => $available !== [],
            'detail' => $available !== []
                ? 'Available: ' . implode(', ', $available)
                : 'exec, shell_exec, proc_open and popen are all disabled by the host.',
            'fix' => $available !== [] ? null
                : 'Ask the host to allow exec() for this site, or skip "Run now" and rely on a Plesk Scheduled Task running: php bin/backup.php',
            'blocking' => true,
        ];

        // 2. A real CLI php.
        $php = self::findPhpCli();
        $checks[] = [
            'key' => 'php_cli', 'label' => 'A PHP command-line binary is available',
            'ok' => $php['path'] !== null,
            'detail' => $php['path'] !== null
                ? 'Using ' . $php['path']
                : 'No CLI PHP found. Tried: ' . json_encode($php['candidates']),
            'fix' => $php['path'] !== null ? null
                : 'Auto-detection scanned /opt/plesk/php/*/bin/php and PATH but found nothing usable. '
                . 'Over SSH run:  ls /opt/plesk/php/*/bin/php  (or:  command -v php)  to get the full path, '
                . 'then set PHP_BIN to it in .env. If the list is empty, the host may block /opt via open_basedir — '
                . 'ask TulsaConnect for the CLI php path, or rely on a Plesk Scheduled Task running: php bin/backup.php',
            'blocking' => true,
        ];

        // 3. Backup directory usable, and outside the web root.
        $dir = self::backupDir();
        $exists = is_dir($dir);
        $writable = $exists ? is_writable($dir) : @is_writable(dirname($dir));
        $public = realpath(dirname(__DIR__, 2) . '/public') ?: '';
        $inWebRoot = $public !== '' && str_starts_with((string)(realpath($dir) ?: $dir), $public);
        $checks[] = [
            'key' => 'backup_dir', 'label' => 'Backup directory is writable and outside the web root',
            'ok' => $writable && !$inWebRoot,
            'detail' => $dir . ($exists ? ' (exists)' : ' (does not exist yet)')
                . ($writable ? ', writable' : ', NOT writable')
                . ($inWebRoot ? ' — WARNING: inside public/' : ''),
            'fix' => $writable && !$inWebRoot ? null
                : 'Create the directory and give the web user write access, or set BACKUP_DIR in .env to a writable path outside public/.',
            'blocking' => true,
        ];

        // 4. External tools the script shells out to.
        $dump = Config::get('MYSQLDUMP_BIN') ?: 'mysqldump';
        foreach ([['mysqldump', $dump], ['tar', 'tar'], ['gzip', 'gzip']] as [$label, $cmd]) {
            $found = self::commandExists($cmd);
            $checks[] = [
                'key' => $label, 'label' => "$label is available",
                'ok' => $found,
                'detail' => $found ? "Found: $cmd" : "Not found on PATH: $cmd",
                'fix' => $found ? null
                    : ($label === 'mysqldump'
                        ? 'Set MYSQLDUMP_BIN in .env to the full path of mysqldump on this server.'
                        : "Ask the host whether $label is available to this account."),
                'blocking' => $label === 'mysqldump',
            ];
        }

        $blockers = array_values(array_filter($checks, fn($c) => $c['blocking'] && !$c['ok']));
        return [
            'checks' => $checks,
            'can_run' => $blockers === [],
            // Report the actual reason (+fix), not the affirmatively-worded check label —
            // "Backup cannot start: A PHP command-line binary is available" reads backwards.
            'blockers' => array_map(fn($c) => $c['detail'] . (!empty($c['fix']) ? ' — ' . $c['fix'] : ''), $blockers),
            'php_cli' => $php['path'],
            'backup_dir' => $dir,
        ];
    }
}
