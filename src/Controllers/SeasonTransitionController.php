<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Season Transition readiness checklist (Admin → Season Transition).
 *
 * A tracked checklist for rolling the program from one FIRST season to the next.
 * The item DEFINITIONS live here (single source of truth); per-item completion
 * state (done / who / when / notes) is persisted in `season_transitions`, keyed
 * by (from_season → to_season). Most subsystems are already season-scoped, so a
 * "reset" really means creating the new season's records while last season's stay
 * on file — the descriptions make that explicit.
 */
final class SeasonTransitionController
{
    /** phase: readiness (verify first) | transition (perform) | retained (confirm, no action). */
    private const ITEMS = [
        // ── Readiness — verify BEFORE you transition ──
        ['key' => 'backup',           'phase' => 'readiness',  'label' => 'Back up the database',
         'desc' => 'Export a full production backup in phpMyAdmin before making any changes — this is your safety net.', 'link' => null],
        ['key' => 'new_first_season',  'phase' => 'readiness',  'label' => 'Create the new FIRST season',
         'desc' => 'Add the {to} season (theme + game names) in Season Manager so the app recognizes it.', 'link' => '/admin/seasons'],
        ['key' => 'review_fees',       'phase' => 'readiness',  'label' => 'Review enrollment fees for the new season',
         'desc' => 'Set/confirm fees for {to}. Last season\'s fees stay on record.', 'link' => '/enrollment/admin'],
        ['key' => 'tc_current',        'phase' => 'readiness',  'label' => 'Confirm Terms & Conditions text is current',
         'desc' => 'Make sure the T&C wording members will agree to is up to date for {to}.', 'link' => null],
        ['key' => 'finalize_budgets',  'phase' => 'readiness',  'label' => 'Finalize {from} team budgets',
         'desc' => 'Review each team\'s {from} budget before the new season is created — the {from} figures stay on file.', 'link' => '/inventory/budgets'],
        ['key' => 'comms_ready',       'phase' => 'readiness',  'label' => 'Prepare the re-enrollment communication',
         'desc' => 'Draft the email/announcement telling families to re-enroll for {to}.', 'link' => '/communications/compose'],
        ['key' => 'tag_summer_fundraisers', 'phase' => 'readiness', 'label' => 'Tag summer fundraisers to {to}',
         'desc' => 'For fundraisers held between seasons (summer camp, golf tournament), set each event\'s "Benefits season" to {to} so its earnings post into the new season\'s team budgets. Tag these as you schedule them — the earnings post once the {to} team-seasons exist. Each youth\'s earnings lock to the team they earned for and stay there even if they graduate or change teams.', 'link' => '/events'],

        // ── Transition — perform the rollover ──
        ['key' => 'create_team_seasons', 'phase' => 'transition', 'label' => 'Create {to} team-seasons (cleared budgets)',
         'desc' => 'Give every active team a new {to} season row. Team identity (name, logo, socials, theme) carries forward; robot, budgets, plan and resources start blank. The {from} season stays on file. Runs right here — do this first, before the resource/plan steps that need the new seasons.',
         'link' => null, 'action' => 'create_team_seasons'],
        ['key' => 'repoint_fundraising', 'phase' => 'transition', 'label' => 'Point {to} fundraisers at the {to} budgets',
         'desc' => 'Summer fundraisers (golf tournament, camps) set up BEFORE the {to} team-seasons existed kept their team links on {from}, so their earnings would post to last season\'s budgets. This moves the team links of every fundraiser tagged "benefits {to}" onto the matching {to} team-seasons, and creates their fundraising budget lines there. Tag each event\'s "Benefits season" first (Events → the event → Fundraising), then run this. Earnings still only post when you finalize the event. Safe to re-run. Runs right here — do this after the {to} team-seasons exist.',
         'link' => null, 'action' => 'repoint_fundraising'],
        ['key' => 'repoint_grants',      'phase' => 'transition', 'label' => 'Point {to} grants at the {to} budgets',
         'desc' => 'A grant now carries its own Season — set a grant\'s Season to {to} and it shows on the {to} team budgets no matter when it was created. This moves any grant already marked for {to} whose team links are still on {from} — the amount requested, outcome and award amount are kept, and the budget line is rebuilt on the new season. Grants marked for other seasons are left alone (that\'s their season\'s history). If a grant is still missing, set its Season to {to}; also note a grant with no amount requested and no award has no budget line at all. Safe to re-run. Runs right here.',
         'link' => null, 'action' => 'repoint_grants'],
        ['key' => 'roll_rosters',        'phase' => 'transition', 'label' => 'Roll team rosters forward to {to}',
         'desc' => 'Carry each team\'s roster from {from} into {to} — active members only (graduated/alumni and inactive members are left off). Team roles carry forward; FIRST registration & Consent/Release start unsigned so they\'re re-collected. Creates the {to} team-season if it doesn\'t exist yet, and skips anyone already on the new roster (safe to re-run). Runs right here.',
         'link' => null, 'action' => 'roll_rosters'],
        ['key' => 'close_enrollment',    'phase' => 'transition', 'label' => 'Close {from} enrollments',
         'desc' => 'Mark last season\'s enrollments expired. Records (including who enrolled) stay on file. Runs right here.',
         'link' => null, 'action' => 'close_enrollment'],
        ['key' => 'create_enrollments',   'phase' => 'transition', 'label' => 'Create {to} youth enrollments (reviewed)',
         'desc' => 'Build every returning youth\'s {to} enrollment in one reviewed pass instead of hand-entering each. Opens a roster where you carry each youth\'s program forward or promote them (FLLe→FLLc, FLLc→FTC…), drop anyone leaving, and add youth with no prior enrollment — then create them all as "pending." A pending enrollment isn\'t counted as an active member until the family completes it (payment + annual T&C + shirt size), at which point it auto-confirms. Run after {from} enrollments are closed and {to} fees are set.',
         'link' => null, 'action' => 'create_enrollments'],
        ['key' => 'enrollment_validation','phase' => 'transition', 'label' => 'Enrollment validation rolls to {to} automatically',
         'desc' => 'Nothing to run here: new enrollments always validate against the current FIRST season, which the app derives from the calendar (it switches to {to} on July 1). Just confirm and check this off.', 'link' => null],
        ['key' => 'reset_shirts',        'phase' => 'transition', 'label' => 'Reset shirt sizes',
         'desc' => 'Clear members\' shirt sizes so they\'re re-collected for {to}. Runs right here.',
         'link' => null, 'action' => 'reset_shirts'],
        ['key' => 'reset_member_tc',     'phase' => 'transition', 'label' => 'Annual TRC T&C re-collects for {to} (everyone)',
         'desc' => 'Nothing to clear here — the annual TRC T&C is now stored per season for every member (youth, guardian, mentor, volunteer). The {to} season simply starts with no signatures, so everyone re-signs when they enroll; every prior season\'s acceptance stays on file so you can always see who signed each year. Confirm and check this off.',
         'link' => null],
        ['key' => 'inventory_rollover',  'phase' => 'transition', 'label' => 'Archive inventory & roll resources',
         'desc' => 'Archive {from} BOMs and purchase orders (they lock as historical), and copy each team\'s resources forward into {to}. Inventory items and assets carry forward; new-season budgets start fresh. Runs right here — do this after the {to} team-seasons exist.',
         'link' => null, 'action' => 'inventory_rollover'],
        ['key' => 'reset_team_first_reg', 'phase' => 'transition', 'label' => 'Set up {to} FIRST reg & Consent/Release',
         'desc' => 'One button clears the FIRST registration + Consent & Release flags on every {to} team-roster member — mentors and youth alike — so the team re-collects them for the new season. Each prior season keeps its own roster record, so every member\'s FIRST registration is retained season to season and you can always see who was registered and who signed the C&R in any past year. Runs right here — do this after the {to} team-seasons and roster exist.',
         'link' => null, 'action' => 'reset_team_first_reg'],
        ['key' => 'roll_scholarships',   'phase' => 'transition', 'label' => 'Roll college scholarships forward',
         'desc' => 'Clone the active {from} college scholarships into {to} (application dates are cleared on the copies so you can set the new deadlines). Runs right here — no need to leave this page.',
         'link' => null, 'action' => 'roll_scholarships'],
        ['key' => 'close_scholarship_funds', 'phase' => 'transition', 'label' => 'Close out {from} scholarship funds',
         'desc' => 'Wrap up the family-aid scholarship funds for {from}: reclaim any awards whose youth never enrolled (they show in the fund page\'s "needs attention" list) and decide any still-open applications, so the season\'s paid-out history is accurate for grant writing. The unspent balance is FORFEITED — it does not carry into {to} (D2). Then set {to}\'s new allocation with a deposit. Open the fund page to do all of this; nothing rolls automatically.',
         'link' => '/admin/scholarship-funds'],

        // ── Retained / background — confirm, no action needed ──
        ['key' => 'graduate_seniors', 'phase' => 'retained', 'label' => 'Graduate seniors (optional)',
         'desc' => 'Not required for the transition — do it whenever it fits. Graduating a senior moves them into the Hall of Fame; you can graduate them here or from their profile any time.', 'link' => '/hall-of-fame/graduate'],
        ['key' => 'ypt_background',   'phase' => 'retained', 'label' => 'YPT & background checks kept as-is',
         'desc' => 'These are 2-year (not seasonal) — they are NOT reset at transition. Confirm and move on.', 'link' => null],
        ['key' => 'team_members',     'phase' => 'retained', 'label' => 'Team members retained',
         'desc' => 'Rosters carry over; you\'ll manually move members as they change teams, leave the program, or graduate.', 'link' => null],
        ['key' => 'history_kept',     'phase' => 'retained', 'label' => 'Prior-season history preserved',
         'desc' => '{from} budgets, enrollments, T&C signers, and compliance records all remain on file for reference.', 'link' => null],
    ];

    private static function gate(PDO $pdo, ?array $m, string $level = 'write'): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, 'seasons.manage', $level);
    }

    /** Current FIRST season string per the Aug-start convention, e.g. "2025-2026". */
    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return "$y-" . ($y + 1);
    }
    private static function nextSeason(string $season): string
    {
        [$a] = explode('-', $season);
        $a = (int)$a + 1;
        return "$a-" . ($a + 1);
    }

    /**
     * The season to default the "from" side of the transition to: the most recent
     * season that actually has team rosters — i.e. the last season truly set up.
     * This keeps the default from jumping a year ahead just because the calendar
     * boundary rolled over (e.g. July 1), which would otherwise point the checklist
     * (and its "Run now" steps) at a season that doesn't exist yet. Falls back to
     * the latest existing team-season, then to the calendar's current season.
     */
    private static function defaultFromSeason(PDO $pdo): string
    {
        $s = $pdo->query(
            "SELECT ts.season FROM team_seasons ts
               JOIN team_member_assignments tma ON tma.team_season_id = ts.id
              GROUP BY ts.season ORDER BY ts.season DESC LIMIT 1"
        )->fetchColumn();
        if ($s) return (string)$s;
        $s = $pdo->query("SELECT season FROM team_seasons ORDER BY season DESC LIMIT 1")->fetchColumn();
        return $s ?: self::currentSeason();
    }

    /**
     * The [from, to] pair to default the checklist to. Prefer a transition the admin
     * has STARTED but not finished (a season_transitions row whose transition-phase
     * items aren't all done) — so mid-transition the page stays on the pair you're
     * working, instead of jumping a year ahead the moment the calendar rolls or a
     * single step (e.g. rolling rosters) completes. If none is in progress, prepare
     * the next transition from the most recently set-up season.
     */
    private static function defaultPair(PDO $pdo): array
    {
        $transitionKeys = array_column(array_filter(self::ITEMS, fn($i) => $i['phase'] === 'transition'), 'key');
        $rows = $pdo->query("SELECT from_season, to_season, state FROM season_transitions ORDER BY to_season DESC")->fetchAll();
        foreach ($rows as $r) {
            $state = $r['state'] ? (json_decode((string)$r['state'], true) ?: []) : [];
            $doneCount = 0;
            foreach ($transitionKeys as $k) if (!empty($state[$k]['done'])) $doneCount++;
            // Started (>=1 done) but not finished → this is the active transition.
            if ($doneCount > 0 && $doneCount < count($transitionKeys)) {
                return [(string)$r['from_season'], (string)$r['to_season']];
            }
        }
        $from = self::defaultFromSeason($pdo);
        return [$from, self::nextSeason($from)];
    }

    private static function items(string $from, string $to): array
    {
        return array_map(function ($it) use ($from, $to) {
            $sub = fn($s) => $s === null ? null : str_replace(['{from}', '{to}'], [$from, $to], $s);
            return ['key' => $it['key'], 'phase' => $it['phase'], 'label' => $sub($it['label']),
                    'desc' => $sub($it['desc']), 'link' => $it['link'], 'action' => $it['action'] ?? null];
        }, self::ITEMS);
    }

    // GET /admin/season-transition?from=&to=
    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::gate($pdo, $m, 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $from = trim((string)($q['from'] ?? ''));
        $to = trim((string)($q['to'] ?? ''));
        if ($from === '' && $to === '') {
            [$from, $to] = self::defaultPair($pdo);
        } elseif ($to === '') {
            $to = self::nextSeason($from);
        }

        $s = $pdo->prepare("SELECT state FROM season_transitions WHERE from_season = ? AND to_season = ?");
        $s->execute([$from, $to]);
        $row = $s->fetch();
        $state = $row && $row['state'] ? (json_decode((string)$row['state'], true) ?: []) : [];
        return Http::json($res, ['from_season' => $from, 'to_season' => $to, 'items' => self::items($from, $to), 'state' => (object)$state]);
    }

    // POST /admin/season-transition/item  { from, to, key, done, notes? }
    public static function setItem(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::gate($pdo, $cur, 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $from = trim((string)($d['from'] ?? '')); $to = trim((string)($d['to'] ?? ''));
        $key = trim((string)($d['key'] ?? ''));
        $validKeys = array_column(self::ITEMS, 'key');
        if ($from === '' || $to === '' || !in_array($key, $validKeys, true)) {
            return Http::error($res, 'Invalid checklist item.', 422);
        }
        $done = !empty($d['done']);

        // Load-or-init the row + its state.
        $s = $pdo->prepare("SELECT id, state FROM season_transitions WHERE from_season = ? AND to_season = ?");
        $s->execute([$from, $to]); $row = $s->fetch();
        $state = ($row && $row['state']) ? (json_decode((string)$row['state'], true) ?: []) : [];

        $name = trim(($cur['first_name'] ?? '') . ' ' . ($cur['last_name'] ?? ''));
        $state[$key] = $done
            ? ['done' => true, 'done_at' => date('Y-m-d H:i:s'), 'done_by_id' => (int)$cur['id'], 'done_by_name' => $name,
               'notes' => trim((string)($d['notes'] ?? '')) ?: null]
            : ['done' => false, 'notes' => trim((string)($d['notes'] ?? '')) ?: null];

        $json = json_encode($state);
        if ($row) {
            $pdo->prepare("UPDATE season_transitions SET state = ? WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO season_transitions (from_season, to_season, state, created_by_id) VALUES (?, ?, ?, ?)")
                ->execute([$from, $to, $json, (int)$cur['id']]);
        }
        Audit::write($pdo, (int)$cur['id'], 'season_transitions', null, 'checklist_item', null, ['from' => $from, 'to' => $to, 'key' => $key, 'done' => $done]);
        return Http::json($res, ['from_season' => $from, 'to_season' => $to, 'items' => self::items($from, $to), 'state' => (object)$state]);
    }
}
