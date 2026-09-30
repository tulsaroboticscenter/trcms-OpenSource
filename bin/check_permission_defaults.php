<?php
declare(strict_types=1);

/**
 * CI/pre-deploy guard for the RBAC fail-open gap fixed in the 2026-08-16 security
 * review (finding F2): every key in config/permissions.json's PERMISSION_CATALOG
 * must have an explicit entry in RESOURCE_DEFAULTS. Without this, a new permission
 * key silently inherits the global DEFAULT_LEVEL fallback — which must stay "none"
 * (never "write"/"read") precisely because keys are expected to be listed here
 * explicitly, not to rely on the fallback.
 *
 * Run manually:   php bin/check_permission_defaults.php
 * Exit code 0 = all keys covered and DEFAULT_LEVEL is "none". Non-zero = problem found.
 */

$path = __DIR__ . '/../config/permissions.json';
$raw = file_get_contents($path);
if ($raw === false) {
    fwrite(STDERR, "Could not read $path\n");
    exit(1);
}

$cfg = json_decode($raw, true);
if ($cfg === null) {
    fwrite(STDERR, "config/permissions.json is not valid JSON: " . json_last_error_msg() . "\n");
    exit(1);
}

$catalogKeys = [];
foreach ($cfg['PERMISSION_CATALOG'] ?? [] as $moduleId => $mod) {
    foreach ($mod['items'] ?? [] as $item) {
        $catalogKeys[$item['key']] = true;
    }
}

$defaults = $cfg['RESOURCE_DEFAULTS'] ?? [];
$missing = array_values(array_diff(array_keys($catalogKeys), array_keys($defaults)));
$orphans = array_values(array_diff(array_keys($defaults), array_keys($catalogKeys)));
$writeDefaults = array_keys(array_filter($defaults, fn ($v) => $v === 'write'));

$ok = true;

if ($missing) {
    $ok = false;
    fwrite(STDERR, "FAIL: " . count($missing) . " permission key(s) have no explicit RESOURCE_DEFAULTS entry (would silently fall back to DEFAULT_LEVEL):\n");
    foreach ($missing as $k) {
        fwrite(STDERR, "  - $k\n");
    }
}

if (($cfg['DEFAULT_LEVEL'] ?? null) !== 'none') {
    $ok = false;
    fwrite(STDERR, "FAIL: DEFAULT_LEVEL is '" . ($cfg['DEFAULT_LEVEL'] ?? '(unset)') . "', expected 'none'. "
        . "Every real permission key must be listed explicitly in RESOURCE_DEFAULTS; the global "
        . "fallback exists only for a key that hasn't been added yet and must fail closed.\n");
}

if ($writeDefaults) {
    // Not a hard failure — 'write' can be a legitimate default for a genuinely
    // self-scoped action (e.g. members.edit_own) — but it's worth a human glance
    // on every deploy, since it's also exactly how F2 happened in the first place.
    fwrite(STDOUT, "NOTE: " . count($writeDefaults) . " key(s) default to 'write' — confirm each is intentionally self-scoped:\n");
    foreach ($writeDefaults as $k) {
        fwrite(STDOUT, "  - $k\n");
    }
}

if ($orphans) {
    // Informational only: a RESOURCE_DEFAULTS entry with no matching catalog key
    // is dead data, not a security gap.
    fwrite(STDOUT, "NOTE: " . count($orphans) . " RESOURCE_DEFAULTS entr" . (count($orphans) === 1 ? 'y has' : 'ies have') . " no matching catalog key (harmless, but worth cleaning up):\n");
    foreach ($orphans as $k) {
        fwrite(STDOUT, "  - $k\n");
    }
}

if ($ok) {
    fwrite(STDOUT, "OK: all " . count($catalogKeys) . " permission catalog keys have an explicit default, and DEFAULT_LEVEL is 'none'.\n");
    exit(0);
}

exit(1);
