<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Module catalog + org-wide enable/disable (open-source Phase 2).
 * =================================================================
 * TRCMS ships every module's schema always; which modules an organization
 * actually *uses* is a runtime choice. This class is the single source of
 * truth for that choice on the backend, and the frontend receives the
 * resolved "disabled" set via /auth/me and hides nav/tiles/routes to match.
 *
 * Storage mirrors NavLayoutController: an admin-editable JSON blob in
 * system_config, category 'enabled_modules', shape { "disabled": ["raffles", ...] }.
 * We store the *disabled* set (not enabled) so that:
 *   - a fresh install (no row) has nothing disabled → everything on;
 *   - a module added in a future release is ON by default for existing
 *     installs (it simply isn't in anyone's disabled list);
 *   - if the backend catalog and the frontend registry ever drift, the
 *     effect is fail-OPEN (the module shows) rather than hiding a working
 *     feature.
 *
 * `key` values MUST match the frontend moduleRegistry module ids.
 * `core` modules can never be disabled (the app is unusable without them).
 * `deps` are hard requirements: disabling a module cascades to everything
 * that depends on it (a dependent can't function without its dependency).
 * `prefixes` are API path prefixes (under /api/v1) owned exclusively by an
 * optional, self-contained module — used by the ModuleGuard middleware to
 * 404 a disabled module's API. Shared/core prefixes are deliberately left
 * unmapped so the guard can never false-positive a working endpoint
 * (unmapped = always allowed).
 */
final class Modules
{
    private const CATEGORY = 'enabled_modules';

    /**
     * The catalog. Order is roughly the display order; `group` mirrors the
     * frontend feature-index areas. Draft dependency graph — review before
     * generalizing beyond FIRST robotics.
     */
    private const CATALOG = [
        // key             label                     group                  core   deps                          prefixes
        ['members',        'Members',                'People',              true,  [],                           []],
        ['roles',          'Roles & Permissions',    'Admin & System',      true,  [],                           []],
        ['admin',          'Admin Console',          'Admin & System',      true,  [],                           []],
        ['help',           'Help Center',            'Admin & System',      true,  [],                           []],

        ['families',       'Families',               'People',              false, ['members'],                  []],
        ['visitors',       'Visitors & Recruiting',  'People',              false, ['members'],                  ['/visitors', '/waitlist', '/schools', '/mentor-prospects', '/recruitment']],
        ['enrollment',     'Enrollment',             'People',              false, ['members'],                  []],
        ['certifications', 'Certifications',         'People',              false, ['members'],                  ['/certifications']],
        ['groups',         'Groups',                 'People',              false, ['members'],                  ['/groups']],

        ['seasons',        'Seasons',                'Teams & Season',      false, ['members'],                  []],
        ['teams',          'Teams & Rosters',        'Teams & Season',      false, ['members'],                  []],
        ['planning',       'Team Tasks & Planning',  'Teams & Season',      false, ['teams'],                    ['/planning']],
        ['strategy',       'Season Strategy',        'Teams & Season',      false, ['teams'],                    ['/strategy']],
        ['minutes',        'Meeting Minutes',        'Teams & Season',      false, ['members'],                  ['/meetings']],
        ['fdp',            'FIRST Dev Program (FDP)','Teams & Season',      false, ['members', 'teams'],         ['/fdp']],
        ['season-planning','Season Planning',        'Teams & Season',      false, ['teams', 'seasons'],         ['/season-planning', '/night-prefs']],

        ['events',         'Events & Calendar',      'Events & Attendance', false, ['members'],                  []],
        // Check-in works with no event (checkins.event_id is nullable); the FLL
        // quick-track kiosk benefits from Events but core check-in is standalone.
        ['checkin',        'Check-In & Kiosks',      'Events & Attendance', false, ['members'],                  ['/checkin', '/fll-attendance']],
        ['reservations',   'Reservations',           'Events & Attendance', false, [],                           ['/reservations']],
        ['summer_camp',    'Summer Camp',            'Events & Attendance', false, ['members'],                  ['/camp']],
        // Public marketing-site intake form (iframe) + mailing list — unrelated to
        // Events. Its public endpoints are mapped so the form stops working when off.
        ['volunteer',      'Volunteer Sign-Up',      'People',              false, [],                           ['/public/volunteer-signup', '/public/mailing-list', '/public/program-interest', '/mailing-list']],

        ['finance',        'Team Finance & Budgets', 'Money & Fundraising', false, ['members'],                  ['/finance']],
        ['invoices',       'Invoices',               'Money & Fundraising', false, ['members', 'enrollment'],    ['/invoices']],
        ['grants',         'Grants',                 'Money & Fundraising', false, ['members'],                  ['/grants']],
        ['sponsors',       'Sponsors',               'Money & Fundraising', false, ['members'],                  ['/sponsors']],
        ['scholarships',   'Scholarships',           'Money & Fundraising', false, ['members'],                  ['/scholarships']],
        // Shopping is a standalone supply/grocery list (shopping_* tables only) —
        // NOT tied to the parts-room Inventory.
        ['shopping',       'Shopping Lists',         'Money & Fundraising', false, [],                           ['/shopping']],
        ['wishlist',       'Wish List',              'Money & Fundraising', false, [],                           ['/wishlist']],
        ['raffles',        'Raffles',                'Money & Fundraising', false, [],                           ['/raffles']],

        ['inventory',      'Inventory & Assets',     'Inventory & Assets',  false, [],                           []],
        ['repairs',        'Repairs & Maintenance',  'Inventory & Assets',  false, ['inventory'],                ['/repairs']],
        ['resources',      'Resources',              'Inventory & Assets',  false, [],                           ['/resources']],
        ['myequipment',    'My Equipment',           'Inventory & Assets',  false, ['inventory'],                []],

        ['communications', 'Communications',         'Communication',       false, ['members'],                  ['/comms', '/mailing-list']],
        ['announcements',  'Announcements',          'Communication',       false, ['members'],                  ['/announcements']],
        ['feedback',       'Feedback & Tickets',     'Communication',       false, [],                           ['/feedback']],

        ['hof',            'Hall of Fame',           'Recognition',         false, ['members'],                  ['/hof']],
        ['resume',         'Youth Resume',           'Recognition',         false, ['members'],                  ['/resume']],
        ['feature_names',  'Feature Names',          'Recognition',         false, [],                           ['/feature-names']],

        ['activity',       'Time & Activity',        'People',              false, ['members'],                  []],
        ['volunteering',   'My Volunteering',        'People',              false, ['members', 'activity'],      ['/volunteering']],

        ['reports',        'Reports',                'Admin & System',      false, ['members'],                  []],
        ['incidents',      'Incident Reports',       'Admin & System',      false, ['members'],                  ['/incidents']],
    ];

    /** Catalog as a list of assoc rows (blank-key reserved slots filtered out). */
    public static function catalog(): array
    {
        $out = [];
        foreach (self::CATALOG as [$key, $label, $group, $core, $deps, $prefixes]) {
            if ($key === '' || $label === '') continue;
            $out[] = [
                'key' => $key, 'label' => $label, 'group' => $group,
                'core' => $core, 'deps' => $deps, 'prefixes' => $prefixes,
            ];
        }
        return $out;
    }

    /** All non-blank module keys. */
    public static function allKeys(): array
    {
        return array_map(fn($m) => $m['key'], self::catalog());
    }

    /** Keys that can never be disabled. */
    public static function coreKeys(): array
    {
        return array_values(array_map(fn($m) => $m['key'],
            array_filter(self::catalog(), fn($m) => $m['core'])));
    }

    /** dependents[key] = keys that declare `key` in their deps (reverse edges). */
    private static function dependents(): array
    {
        $rev = [];
        foreach (self::catalog() as $m) {
            foreach ($m['deps'] as $d) {
                $rev[$d][] = $m['key'];
            }
        }
        return $rev;
    }

    /**
     * Resolve a requested disabled set into the *effective* disabled set:
     * drop unknown/core keys, then cascade to every dependent (transitively),
     * since a module can't run without a disabled dependency.
     */
    public static function resolveDisabled(array $requested): array
    {
        $valid = array_flip(self::allKeys());
        $core  = array_flip(self::coreKeys());
        $rev   = self::dependents();

        $disabled = [];
        $queue = [];
        foreach ($requested as $k) {
            $k = (string)$k;
            if (isset($valid[$k]) && !isset($core[$k])) { $queue[] = $k; }
        }
        while ($queue) {
            $k = array_shift($queue);
            if (isset($disabled[$k])) continue;
            $disabled[$k] = true;
            foreach ($rev[$k] ?? [] as $dep) {
                if (!isset($core[$dep]) && !isset($disabled[$dep])) $queue[] = $dep;
            }
        }
        return array_keys($disabled);
    }

    /** Raw stored value ({ disabled: [...] }) or null when unset. */
    private static function raw(PDO $pdo): ?array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::CATEGORY]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode((string)$r['values'], true) : null;
        return is_array($v) ? $v : null;
    }

    /** The effective disabled set for this install (already cascaded, core-stripped). */
    public static function disabledSet(PDO $pdo): array
    {
        $raw = self::raw($pdo);
        $requested = (is_array($raw) && isset($raw['disabled']) && is_array($raw['disabled']))
            ? $raw['disabled'] : [];
        return self::resolveDisabled($requested);
    }

    /** Is a module enabled for this install? Unknown keys are treated as enabled (fail-open). */
    public static function isEnabled(PDO $pdo, string $key): bool
    {
        return !in_array($key, self::disabledSet($pdo), true);
    }

    /**
     * The module that exclusively owns an API path (longest prefix match),
     * or null when no optional module claims it (→ always allowed).
     * $path is the request path WITHOUT the /api/v1 prefix (e.g. "/raffles/3").
     */
    public static function moduleForPath(string $path): ?string
    {
        $best = null; $bestLen = -1;
        foreach (self::catalog() as $m) {
            foreach ($m['prefixes'] as $p) {
                // Match exact prefix followed by end or a '/' so "/repairs" never
                // matches "/repairs-elsewhere" but does match "/repairs/5".
                if ($path === $p || str_starts_with($path, $p . '/')) {
                    if (strlen($p) > $bestLen) { $best = $m['key']; $bestLen = strlen($p); }
                }
            }
        }
        return $best;
    }
}
