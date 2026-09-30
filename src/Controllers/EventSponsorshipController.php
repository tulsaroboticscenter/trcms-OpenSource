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
 * Event Sponsorship (2.1). Opens an event for sponsorship with configurable
 * packages and a sponsor pipeline (prospect → invited → interested → committed →
 * fulfilled). Ties each entry to a Sponsors-module record; dollars are tracked
 * per entry and summarised on the event. Reuses sponsors.view / sponsors.manage.
 */
final class EventSponsorshipController
{
    private const STAGES = ['prospect', 'invited', 'interested', 'committed', 'fulfilled', 'declined'];
    private const COMMITTED = ['committed', 'fulfilled'];

    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'sponsors.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'sponsors.manage', 'write'); }

    private static function num($v): ?float { return $v === null || $v === '' ? null : (float)$v; }
    private static function intOrNull($v): ?int { return $v === null || $v === '' ? null : (int)$v; }
    private static function dateOrNull($v): ?string { return $v === null || $v === '' ? null : substr((string)$v, 0, 10); }

    private static function event(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM events WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    /** FIRST season string for an event date (Aug-start), e.g. "2026-2027". */
    private static function seasonForDate(?string $date): string
    {
        $ts = $date ? strtotime($date) : time();
        $m = (int)date('n', $ts); $y = (int)date('Y', $ts);
        $start = $m >= EnrollmentService::SEASON_START_MONTH ? $y : $y - 1;
        return "$start-" . ($start + 1);
    }

    /**
     * Keep a Sponsors-module contribution in sync with a pipeline entry: a
     * committed/fulfilled monetary entry gets (or updates) a linked contribution
     * — credited to the event's owning team — which flows through the normal
     * budget/reporting path. Non-committed or non-monetary entries drop any link.
     */
    private static function syncEntryContribution(PDO $pdo, int $entryId, int $actorId): void
    {
        $s = $pdo->prepare("SELECT * FROM event_sponsorships WHERE id = ?"); $s->execute([$entryId]); $e = $s->fetch();
        if (!$e) return;
        $conId = self::intOrNull($e['contribution_id']);
        $committed = in_array($e['stage'], self::COMMITTED, true);
        $amount = self::num($e['pledged_amount']);
        $fulfilled = $e['stage'] === 'fulfilled';
        $received = self::num($e['received_amount']);
        $giftAmount = $fulfilled && $received !== null ? $received : $amount;

        // Drop the linked contribution when the entry no longer represents a monetary commitment.
        if (!$committed || $giftAmount === null) {
            if ($conId) {
                $r = $pdo->prepare("SELECT budget_donation_id FROM sponsor_contributions WHERE id = ?"); $r->execute([$conId]); $row = $r->fetch();
                if ($row && $row['budget_donation_id']) $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([(int)$row['budget_donation_id']]);
                $pdo->prepare("DELETE FROM sponsor_contributions WHERE id = ?")->execute([$conId]);
                $pdo->prepare("UPDATE event_sponsorships SET contribution_id = NULL WHERE id = ?")->execute([$entryId]);
            }
            return;
        }

        $ev = self::event($pdo, (int)$e['event_id']);
        $season = self::seasonForDate($ev['event_date'] ?? null);
        $creditTeam = self::intOrNull($ev['sponsorship_owning_team_id'] ?? null);
        $status = $fulfilled ? 'received' : 'pledged';
        $recvDate = $fulfilled ? ($e['received_date'] ?? date('Y-m-d')) : null;

        if ($conId) {
            $pdo->prepare("UPDATE sponsor_contributions SET season = ?, event_id = ?, contribution_type = 'monetary', amount = ?,
                           status = ?, credited_team_id = ?, received_date = ? WHERE id = ?")
                ->execute([$season, (int)$e['event_id'], $giftAmount, $status, $creditTeam, $recvDate, $conId]);
        } else {
            $pdo->prepare("INSERT INTO sponsor_contributions (sponsor_id, season, event_id, contribution_type, amount, status,
                           designation, credited_team_id, received_date, recorded_by_id)
                           VALUES (?,?,?,'monetary',?,?,'general',?,?,?)")
                ->execute([(int)$e['sponsor_id'], $season, (int)$e['event_id'], $giftAmount, $status, $creditTeam, $recvDate, $actorId]);
            $conId = (int)$pdo->lastInsertId();
            $pdo->prepare("UPDATE event_sponsorships SET contribution_id = ? WHERE id = ?")->execute([$conId, $entryId]);
        }
        SponsorsController::syncContributionBudget($pdo, $conId);
    }

    // GET /events/{event_id}/sponsorship
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $ev = self::event($pdo, $eid);
        if (!$ev) return Http::error($res, 'Event not found', 404);

        // Committed count per package (for slots remaining).
        $usedStmt = $pdo->prepare("SELECT package_id, COUNT(*) AS n FROM event_sponsorships
                                   WHERE event_id = ? AND package_id IS NOT NULL AND stage IN ('committed','fulfilled') GROUP BY package_id");
        $usedStmt->execute([$eid]);
        $used = [];
        foreach ($usedStmt->fetchAll() as $r) $used[(int)$r['package_id']] = (int)$r['n'];

        $ps = $pdo->prepare("SELECT * FROM event_sponsorship_packages WHERE event_id = ? ORDER BY display_order, id");
        $ps->execute([$eid]);
        $packages = array_map(function ($p) use ($used) {
            $qty = self::intOrNull($p['quantity_available']);
            return [
                'id' => (int)$p['id'], 'name' => $p['name'], 'price' => self::num($p['price']),
                'quantity_available' => $qty, 'benefits' => $p['benefits'],
                'display_order' => (int)$p['display_order'], 'is_active' => (bool)$p['is_active'],
                'committed_count' => $used[(int)$p['id']] ?? 0,
                'slots_remaining' => $qty === null ? null : max(0, $qty - ($used[(int)$p['id']] ?? 0)),
            ];
        }, $ps->fetchAll());

        $es = $pdo->prepare("SELECT es.*, s.name AS sponsor_name, s.scope AS sponsor_scope, pk.name AS package_name,
                                    m.first_name AS owner_first, m.last_name AS owner_last
                             FROM event_sponsorships es
                             JOIN sponsors s ON s.id = es.sponsor_id
                             LEFT JOIN event_sponsorship_packages pk ON pk.id = es.package_id
                             LEFT JOIN members m ON m.id = es.relationship_owner_id
                             WHERE es.event_id = ? ORDER BY FIELD(es.stage,'fulfilled','committed','interested','invited','prospect','declined'), s.name");
        $es->execute([$eid]);
        $pipeline = array_map(fn($r) => [
            'id' => (int)$r['id'], 'sponsor_id' => (int)$r['sponsor_id'], 'sponsor_name' => $r['sponsor_name'],
            'sponsor_scope' => $r['sponsor_scope'], 'package_id' => self::intOrNull($r['package_id']), 'package_name' => $r['package_name'],
            'stage' => $r['stage'], 'pledged_amount' => self::num($r['pledged_amount']), 'received_amount' => self::num($r['received_amount']),
            'in_kind_description' => $r['in_kind_description'], 'received_date' => $r['received_date'],
            'relationship_owner_id' => self::intOrNull($r['relationship_owner_id']),
            'relationship_owner_name' => ($r['owner_first'] || $r['owner_last']) ? trim("{$r['owner_first']} {$r['owner_last']}") : null,
            'notes' => $r['notes'],
        ], $es->fetchAll());

        $tot = $pdo->prepare("SELECT
            SUM(stage IN ('interested','committed','fulfilled')) AS interested,
            SUM(stage IN ('committed','fulfilled')) AS committed,
            COALESCE(SUM(CASE WHEN stage IN ('committed','fulfilled') THEN pledged_amount ELSE 0 END),0) AS pledged,
            COALESCE(SUM(received_amount),0) AS received
            FROM event_sponsorships WHERE event_id = ?");
        $tot->execute([$eid]); $t = $tot->fetch();

        return Http::json($res, [
            'settings' => [
                'is_sponsorable' => (bool)$ev['is_sponsorable'],
                'sponsorship_deadline' => $ev['sponsorship_deadline'],
                'sponsorship_goal' => self::num($ev['sponsorship_goal']),
                'sponsorship_owning_team_id' => self::intOrNull($ev['sponsorship_owning_team_id']),
            ],
            'packages' => $packages,
            'pipeline' => $pipeline,
            'totals' => [
                'interested_count' => (int)$t['interested'], 'committed_count' => (int)$t['committed'],
                'pledged' => round((float)$t['pledged'], 2), 'received' => round((float)$t['received'], 2),
                'goal' => self::num($ev['sponsorship_goal']),
            ],
        ]);
    }

    // PATCH /events/{event_id}/sponsorship — settings
    public static function updateSettings(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('is_sponsorable', $d)) { $set[] = 'is_sponsorable = ?'; $args[] = (int)!empty($d['is_sponsorable']); }
        if (array_key_exists('sponsorship_deadline', $d)) { $set[] = 'sponsorship_deadline = ?'; $args[] = self::dateOrNull($d['sponsorship_deadline']); }
        if (array_key_exists('sponsorship_goal', $d)) { $set[] = 'sponsorship_goal = ?'; $args[] = self::num($d['sponsorship_goal']); }
        if (array_key_exists('sponsorship_owning_team_id', $d)) { $set[] = 'sponsorship_owning_team_id = ?'; $args[] = self::intOrNull($d['sponsorship_owning_team_id']); }
        if ($set) { $args[] = $eid; $pdo->prepare("UPDATE events SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'events', $eid, 'update', null, ['event_sponsorship_settings' => $d]);
        return self::get($req, $res, ['event_id' => $eid]);
    }

    // ── Packages ──────────────────────────────────────────────────────────
    public static function addPackage(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Package name is required.', 422);
        $pdo->prepare("INSERT INTO event_sponsorship_packages (event_id, name, price, quantity_available, benefits, display_order) VALUES (?,?,?,?,?,?)")
            ->execute([$eid, $d['name'], self::num($d['price'] ?? null), self::intOrNull($d['quantity_available'] ?? null),
                $d['benefits'] ?? null, (int)($d['display_order'] ?? 0)]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'event_sponsorship_packages', $newId, 'create', null, ['event_id' => $eid, 'name' => $d['name']]);
        return self::get($req, $res, ['event_id' => $eid]);
    }

    public static function updatePackage(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['package_id'];
        $s = $pdo->prepare("SELECT * FROM event_sponsorship_packages WHERE id = ?"); $s->execute([$pid]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Package not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('name', $d)) { $set[] = 'name = ?'; $args[] = $d['name']; }
        if (array_key_exists('price', $d)) { $set[] = 'price = ?'; $args[] = self::num($d['price']); }
        if (array_key_exists('quantity_available', $d)) { $set[] = 'quantity_available = ?'; $args[] = self::intOrNull($d['quantity_available']); }
        if (array_key_exists('benefits', $d)) { $set[] = 'benefits = ?'; $args[] = $d['benefits']; }
        if (array_key_exists('display_order', $d)) { $set[] = 'display_order = ?'; $args[] = (int)$d['display_order']; }
        if (array_key_exists('is_active', $d)) { $set[] = 'is_active = ?'; $args[] = (int)!empty($d['is_active']); }
        if ($set) { $args[] = $pid; $pdo->prepare("UPDATE event_sponsorship_packages SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'event_sponsorship_packages', $pid, 'update', null, $d);
        return self::get($req, $res, ['event_id' => (int)$row['event_id']]);
    }

    public static function deletePackage(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['package_id'];
        $s = $pdo->prepare("SELECT event_id FROM event_sponsorship_packages WHERE id = ?"); $s->execute([$pid]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Package not found', 404);
        $pdo->prepare("DELETE FROM event_sponsorship_packages WHERE id = ?")->execute([$pid]);
        Audit::write($pdo, (int)$cur['id'], 'event_sponsorship_packages', $pid, 'delete', null, null);
        return self::get($req, $res, ['event_id' => (int)$row['event_id']]);
    }

    // ── Pipeline ──────────────────────────────────────────────────────────
    public static function addPipeline(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        if (!self::event($pdo, $eid)) return Http::error($res, 'Event not found', 404);
        $d = (array)$req->getParsedBody();
        $sponsorId = self::intOrNull($d['sponsor_id'] ?? null);
        if (!$sponsorId) return Http::error($res, 'A sponsor is required.', 422);
        $exists = $pdo->prepare("SELECT 1 FROM event_sponsorships WHERE event_id = ? AND sponsor_id = ?");
        $exists->execute([$eid, $sponsorId]);
        if ($exists->fetch()) return Http::error($res, 'That sponsor is already on this event.', 409);
        $stage = in_array($d['stage'] ?? 'interested', self::STAGES, true) ? $d['stage'] : 'interested';
        $pdo->prepare("INSERT INTO event_sponsorships (event_id, sponsor_id, package_id, stage, pledged_amount, in_kind_description, relationship_owner_id, notes, created_by_id)
            VALUES (?,?,?,?,?,?,?,?,?)")
            ->execute([$eid, $sponsorId, self::intOrNull($d['package_id'] ?? null), $stage, self::num($d['pledged_amount'] ?? null),
                $d['in_kind_description'] ?? null, self::intOrNull($d['relationship_owner_id'] ?? null), $d['notes'] ?? null, (int)$cur['id']]);
        $entryId = (int)$pdo->lastInsertId();
        self::syncEntryContribution($pdo, $entryId, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'event_sponsorships', $entryId, 'create', null, ['event_id' => $eid, 'sponsor_id' => $sponsorId]);
        return self::get($req, $res, ['event_id' => $eid]);
    }

    public static function updatePipeline(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['entry_id'];
        $s = $pdo->prepare("SELECT * FROM event_sponsorships WHERE id = ?"); $s->execute([$id]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Entry not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('stage', $d) && in_array($d['stage'], self::STAGES, true)) { $set[] = 'stage = ?'; $args[] = $d['stage']; }
        if (array_key_exists('package_id', $d)) { $set[] = 'package_id = ?'; $args[] = self::intOrNull($d['package_id']); }
        foreach (['pledged_amount', 'received_amount'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::num($d[$f]); }
        if (array_key_exists('in_kind_description', $d)) { $set[] = 'in_kind_description = ?'; $args[] = $d['in_kind_description']; }
        if (array_key_exists('received_date', $d)) { $set[] = 'received_date = ?'; $args[] = self::dateOrNull($d['received_date']); }
        if (array_key_exists('relationship_owner_id', $d)) { $set[] = 'relationship_owner_id = ?'; $args[] = self::intOrNull($d['relationship_owner_id']); }
        if (array_key_exists('notes', $d)) { $set[] = 'notes = ?'; $args[] = $d['notes']; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE event_sponsorships SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        self::syncEntryContribution($pdo, $id, (int)$cur['id']);
        Audit::write($pdo, (int)$cur['id'], 'event_sponsorships', $id, 'update', null, $d);
        return self::get($req, $res, ['event_id' => (int)$row['event_id']]);
    }

    public static function deletePipeline(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['entry_id'];
        $s = $pdo->prepare("SELECT event_id, contribution_id FROM event_sponsorships WHERE id = ?"); $s->execute([$id]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Entry not found', 404);
        // Remove the linked contribution (and its budget line) this entry generated.
        if ($row['contribution_id']) {
            $c = $pdo->prepare("SELECT budget_donation_id FROM sponsor_contributions WHERE id = ?"); $c->execute([(int)$row['contribution_id']]); $cr = $c->fetch();
            if ($cr && $cr['budget_donation_id']) $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([(int)$cr['budget_donation_id']]);
            $pdo->prepare("DELETE FROM sponsor_contributions WHERE id = ?")->execute([(int)$row['contribution_id']]);
        }
        $pdo->prepare("DELETE FROM event_sponsorships WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'event_sponsorships', $id, 'delete', null, null);
        return self::get($req, $res, ['event_id' => (int)$row['event_id']]);
    }
}
