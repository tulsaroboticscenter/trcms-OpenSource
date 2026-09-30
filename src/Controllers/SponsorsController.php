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
 * Sponsors Module (2.0 Phase 1). Program vs. Team sponsors with a team-scoped
 * outreach guardrail: everyone may VIEW any sponsor, but only members of an
 * owning team may CONTACT a team sponsor. Contributions post to the crediting
 * team's fundraising budget (a "Sponsorships" line), mirroring the Grants module.
 */
final class SponsorsController
{
    private const SPONSOR_CATEGORY = 'Sponsorships';
    private const TIERS = [ // label => minimum received (per season)
        'Gold' => 5000.0, 'Silver' => 1000.0, 'Bronze' => 250.0, 'Community Supporter' => 0.01,
    ];

    private static function canView(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'sponsors.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'sponsors.manage', 'write'); }

    private static function num($v): ?float { return $v === null || $v === '' ? null : (float)$v; }
    private static function intOrNull($v): ?int { return $v === null || $v === '' ? null : (int)$v; }
    private static function dateOrNull($v): ?string { return $v === null || $v === '' ? null : substr((string)$v, 0, 10); }

    /** Current FIRST season, Aug-start convention, e.g. "2026-2027". */
    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return "$y-" . ($y + 1);
    }

    private static function sponsor(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM sponsors WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    private static function owningTeams(PDO $pdo, int $sponsorId): array
    {
        $s = $pdo->prepare("SELECT st.team_id, t.team_number, p.name AS program
                            FROM sponsor_teams st JOIN teams t ON t.id = st.team_id
                            LEFT JOIN programs p ON p.id = t.program_id
                            WHERE st.sponsor_id = ? ORDER BY t.team_number");
        $s->execute([$sponsorId]);
        return array_map(fn($r) => [
            'team_id' => (int)$r['team_id'], 'team_number' => $r['team_number'],
            'label' => '#' . $r['team_number'] . ($r['program'] ? ' · ' . $r['program'] : ''),
        ], $s->fetchAll());
    }

    /** True if the member is on an active assignment to any of the sponsor's owning teams. */
    private static function memberOnOwningTeam(PDO $pdo, int $memberId, int $sponsorId): bool
    {
        $s = $pdo->prepare(
            "SELECT 1 FROM team_member_assignments tma
             JOIN team_seasons ts ON ts.id = tma.team_season_id
             JOIN sponsor_teams st ON st.team_id = ts.team_id
             WHERE st.sponsor_id = ? AND tma.member_id = ? AND tma.status = 'active' LIMIT 1");
        $s->execute([$sponsorId, $memberId]);
        return (bool)$s->fetch();
    }

    /**
     * The team-scoped outreach guardrail. View is open to all (canView); this
     * governs who may CONTACT a sponsor: managers always; otherwise the member
     * needs the contact permission, and for TEAM sponsors must be on an owning team.
     */
    private static function canContact(PDO $pdo, ?array $m, array $sponsor): bool
    {
        if ($m === null) return false;
        if (self::canManage($pdo, $m)) return true;
        if (!Permissions::memberCan($pdo, $m, 'sponsors.contact', 'write')) return false;
        if ($sponsor['scope'] === 'program') return true; // coordinated via fundraising reps
        return self::memberOnOwningTeam($pdo, (int)$m['id'], (int)$sponsor['id']);
    }

    private static function memberName(PDO $pdo, ?int $id): ?string
    {
        if (!$id) return null;
        $s = $pdo->prepare("SELECT first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $r = $s->fetch();
        return $r ? trim("{$r['first_name']} {$r['last_name']}") : null;
    }

    /** Sum of received contributions (monetary amount + in-kind value) for a season. */
    private static function receivedTotal(PDO $pdo, int $sponsorId, string $season): array
    {
        $s = $pdo->prepare(
            "SELECT COALESCE(SUM(CASE WHEN contribution_type='monetary' THEN amount ELSE COALESCE(in_kind_value,0) END),0) AS total,
                    SUM(CASE WHEN contribution_type='monetary' THEN 1 ELSE 0 END) AS monetary_count
             FROM sponsor_contributions WHERE sponsor_id = ? AND season = ? AND status = 'received'");
        $s->execute([$sponsorId, $season]);
        $r = $s->fetch();
        return ['total' => round((float)$r['total'], 2), 'monetary' => (int)$r['monetary_count']];
    }

    private static function computeTier(float $total, int $monetaryCount): ?string
    {
        if ($total <= 0) return null;
        if ($monetaryCount === 0) return 'In-Kind Partner';
        foreach (self::TIERS as $label => $min) if ($total >= $min) return $label;
        return null;
    }

    private static function serializeSponsor(PDO $pdo, array $s, ?array $viewer, bool $withDetail = false): array
    {
        $sid = (int)$s['id'];
        $recv = self::receivedTotal($pdo, $sid, $s['season']);
        $tier = ($s['tier_locked'] && $s['tier']) ? $s['tier'] : self::computeTier($recv['total'], $recv['monetary']);
        $out = [
            'id' => $sid, 'name' => $s['name'], 'scope' => $s['scope'],
            'tier' => $tier, 'tier_locked' => (bool)$s['tier_locked'],
            'lifecycle_state' => $s['lifecycle_state'],
            'relationship_owner_id' => self::intOrNull($s['relationship_owner_id']),
            'relationship_owner_name' => self::memberName($pdo, self::intOrNull($s['relationship_owner_id'])),
            'primary_contact_name' => $s['primary_contact_name'], 'primary_contact_email' => $s['primary_contact_email'],
            'primary_contact_phone' => $s['primary_contact_phone'], 'website' => $s['website'],
            'logo_url' => $s['logo_url'], 'industry_category' => $s['industry_category'],
            'season' => $s['season'], 'youth_safety_flag' => (bool)$s['youth_safety_flag'],
            'source' => $s['source'], 'decline_reason' => $s['decline_reason'],
            'owning_teams' => self::owningTeams($pdo, $sid),
            'received_total' => $recv['total'],
            'can_contact' => self::canContact($pdo, $viewer, $s),
        ];
        if ($withDetail) {
            $out['youth_safety_notes'] = $s['youth_safety_flag'] ? $s['youth_safety_notes'] : null;
            $out['notes'] = $s['notes'];
        }
        return $out;
    }

    // ── Sponsor CRUD ──────────────────────────────────────────────────────────

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = '1=1'; $args = [];
        if (!empty($q['scope'])) { $where .= ' AND scope = ?'; $args[] = $q['scope']; }
        if (!empty($q['lifecycle_state'])) { $where .= ' AND lifecycle_state = ?'; $args[] = $q['lifecycle_state']; }
        if (!empty($q['season'])) { $where .= ' AND season = ?'; $args[] = $q['season']; }
        if (!empty($q['search'])) { $where .= ' AND (name LIKE ? OR primary_contact_name LIKE ? OR primary_contact_email LIKE ?)';
            $t = '%' . $q['search'] . '%'; array_push($args, $t, $t, $t); }
        $s = $pdo->prepare("SELECT * FROM sponsors WHERE $where ORDER BY name");
        $s->execute($args);
        $out = array_map(fn($row) => self::serializeSponsor($pdo, $row, $cur), $s->fetchAll());
        return Http::json($res, $out);
    }

    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $s = self::sponsor($pdo, (int)$route['sponsor_id']);
        if (!$s) return Http::error($res, 'Sponsor not found', 404);
        $sid = (int)$s['id'];

        $cs = $pdo->prepare("SELECT * FROM sponsor_contributions WHERE sponsor_id = ? ORDER BY COALESCE(received_date, pledge_date, created_at) DESC, id DESC");
        $cs->execute([$sid]);
        $contributions = array_map(fn($c) => self::serializeContribution($pdo, $c), $cs->fetchAll());

        $ds = $pdo->prepare("SELECT * FROM sponsor_deliverables WHERE sponsor_id = ? ORDER BY COALESCE(due_date, created_at), id");
        $ds->execute([$sid]);
        $deliverables = array_map(fn($d) => self::serializeDeliverable($pdo, $d), $ds->fetchAll());

        $ks = $pdo->prepare("SELECT * FROM sponsor_contacts WHERE sponsor_id = ? ORDER BY COALESCE(contacted_at, created_at) DESC, id DESC");
        $ks->execute([$sid]);
        $contacts = array_map(fn($k) => [
            'id' => (int)$k['id'], 'member_id' => self::intOrNull($k['member_id']),
            'member_name' => self::memberName($pdo, self::intOrNull($k['member_id'])),
            'method' => $k['method'], 'notes' => $k['notes'], 'outcome' => $k['outcome'],
            'contacted_at' => $k['contacted_at'],
        ], $ks->fetchAll());

        $evs = $pdo->prepare("SELECT es.id, es.event_id, es.stage, es.pledged_amount, es.received_amount, es.in_kind_description,
                                     e.name AS event_name, e.event_date, pk.name AS package_name
                              FROM event_sponsorships es
                              JOIN events e ON e.id = es.event_id
                              LEFT JOIN event_sponsorship_packages pk ON pk.id = es.package_id
                              WHERE es.sponsor_id = ? ORDER BY e.event_date DESC, es.id DESC");
        $evs->execute([$sid]);
        $events = array_map(fn($r) => [
            'id' => (int)$r['id'], 'event_id' => (int)$r['event_id'], 'event_name' => $r['event_name'],
            'event_date' => $r['event_date'], 'stage' => $r['stage'], 'package_name' => $r['package_name'],
            'pledged_amount' => self::num($r['pledged_amount']), 'received_amount' => self::num($r['received_amount']),
            'in_kind_description' => $r['in_kind_description'],
        ], $evs->fetchAll());

        return Http::json($res, self::serializeSponsor($pdo, $s, $cur, true) + [
            'contributions' => $contributions, 'deliverables' => $deliverables, 'contacts' => $contacts, 'events' => $events,
        ]);
    }

    private const FIELDS_TEXT = ['name', 'primary_contact_name', 'primary_contact_email', 'primary_contact_phone',
        'website', 'logo_url', 'industry_category', 'source', 'decline_reason', 'youth_safety_notes', 'notes', 'tier', 'season'];

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        if (empty($d['name'])) return Http::error($res, 'Sponsor name is required.', 422);
        $scope = ($d['scope'] ?? 'team') === 'program' ? 'program' : 'team';
        $pdo->prepare("INSERT INTO sponsors (name, scope, lifecycle_state, relationship_owner_id, primary_contact_name,
            primary_contact_email, primary_contact_phone, website, logo_url, industry_category, season, youth_safety_flag,
            youth_safety_notes, source, notes, tier, tier_locked, created_by_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $d['name'], $scope, $d['lifecycle_state'] ?? 'prospective', self::intOrNull($d['relationship_owner_id'] ?? null),
                $d['primary_contact_name'] ?? null, $d['primary_contact_email'] ?? null, $d['primary_contact_phone'] ?? null,
                $d['website'] ?? null, $d['logo_url'] ?? null, $d['industry_category'] ?? null,
                $d['season'] ?? self::currentSeason(), (int)!empty($d['youth_safety_flag']), $d['youth_safety_notes'] ?? null,
                $d['source'] ?? null, $d['notes'] ?? null, $d['tier'] ?? null, (int)!empty($d['tier_locked']), (int)$cur['id'],
            ]);
        $id = (int)$pdo->lastInsertId();
        if ($scope === 'team' && !empty($d['team_ids'])) self::replaceTeams($pdo, $id, (array)$d['team_ids']);
        Audit::write($pdo, (int)$cur['id'], 'sponsors', $id, 'create', null, ['name' => $d['name'], 'scope' => $scope]);
        return self::get($req, $res, ['sponsor_id' => $id]);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['sponsor_id'];
        if (!self::sponsor($pdo, $sid)) return Http::error($res, 'Sponsor not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (self::FIELDS_TEXT as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if (array_key_exists('scope', $d)) { $set[] = 'scope = ?'; $args[] = $d['scope'] === 'program' ? 'program' : 'team'; }
        if (array_key_exists('lifecycle_state', $d) && in_array($d['lifecycle_state'], ['prospective', 'active', 'lapsed', 'declined'], true)) { $set[] = 'lifecycle_state = ?'; $args[] = $d['lifecycle_state']; }
        if (array_key_exists('relationship_owner_id', $d)) { $set[] = 'relationship_owner_id = ?'; $args[] = self::intOrNull($d['relationship_owner_id']); }
        if (array_key_exists('youth_safety_flag', $d)) { $set[] = 'youth_safety_flag = ?'; $args[] = (int)!empty($d['youth_safety_flag']); }
        if (array_key_exists('tier_locked', $d)) { $set[] = 'tier_locked = ?'; $args[] = (int)!empty($d['tier_locked']); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $sid; $pdo->prepare("UPDATE sponsors SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        if (array_key_exists('team_ids', $d)) self::replaceTeams($pdo, $sid, (array)$d['team_ids']);
        Audit::write($pdo, (int)$cur['id'], 'sponsors', $sid, 'update', null, $d);
        return self::get($req, $res, ['sponsor_id' => $sid]);
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['sponsor_id'];
        if (!self::sponsor($pdo, $sid)) return Http::error($res, 'Sponsor not found', 404);
        // Remove any budget lines this sponsor's contributions created, then the sponsor (cascades children).
        $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE sponsor_id = ?")->execute([$sid]);
        $pdo->prepare("DELETE FROM sponsors WHERE id = ?")->execute([$sid]);
        Audit::write($pdo, (int)$cur['id'], 'sponsors', $sid, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    private static function replaceTeams(PDO $pdo, int $sponsorId, array $teamIds): void
    {
        $wanted = array_values(array_unique(array_map('intval', $teamIds)));
        $pdo->prepare("DELETE FROM sponsor_teams WHERE sponsor_id = ?")->execute([$sponsorId]);
        $ins = $pdo->prepare("INSERT IGNORE INTO sponsor_teams (sponsor_id, team_id) VALUES (?, ?)");
        foreach ($wanted as $tid) if ($tid > 0) $ins->execute([$sponsorId, $tid]);
    }

    // ── Contributions (+ budget posting) ──────────────────────────────────────

    private static function serializeContribution(PDO $pdo, array $c): array
    {
        return [
            'id' => (int)$c['id'], 'sponsor_id' => (int)$c['sponsor_id'], 'season' => $c['season'],
            'contribution_type' => $c['contribution_type'], 'amount' => self::num($c['amount']),
            'in_kind_description' => $c['in_kind_description'], 'in_kind_value' => self::num($c['in_kind_value']),
            'status' => $c['status'], 'designation' => $c['designation'],
            'pledge_date' => $c['pledge_date'], 'received_date' => $c['received_date'],
            'payment_reference' => $c['payment_reference'], 'credited_team_id' => self::intOrNull($c['credited_team_id']),
            'scholarship_fund_id' => self::intOrNull($c['scholarship_fund_id'] ?? null),
            'program_model' => $c['program_model'] ?? null, 'tax_deductible' => (bool)($c['tax_deductible'] ?? true),
            'recorded_by_name' => self::memberName($pdo, self::intOrNull($c['recorded_by_id'])), 'notes' => $c['notes'],
        ];
    }

    public static function addContribution(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['sponsor_id'];
        $sp = self::sponsor($pdo, $sid);
        if (!$sp) return Http::error($res, 'Sponsor not found', 404);
        $d = (array)$req->getParsedBody();
        $type = ($d['contribution_type'] ?? 'monetary') === 'in_kind' ? 'in_kind' : 'monetary';
        $model = $d['program_model'] ?? null;
        // TRC is a 501c3, so gifts are deductible by default; a gift earmarked to a
        // specific NAMED individual is flagged non-deductible unless explicitly set.
        $deductible = array_key_exists('tax_deductible', $d) ? (int)!empty($d['tax_deductible']) : ($model === 'named' ? 0 : 1);
        $pdo->prepare("INSERT INTO sponsor_contributions (sponsor_id, season, contribution_type, amount, in_kind_description,
            in_kind_value, status, designation, scholarship_fund_id, program_model, tax_deductible, pledge_date, received_date,
            payment_reference, credited_team_id, recorded_by_id, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([
                $sid, $d['season'] ?? $sp['season'], $type, self::num($d['amount'] ?? null),
                $d['in_kind_description'] ?? null, self::num($d['in_kind_value'] ?? null),
                in_array($d['status'] ?? 'pledged', ['pledged', 'received', 'declined', 'refunded'], true) ? $d['status'] : 'pledged',
                $d['designation'] ?? 'general', self::intOrNull($d['scholarship_fund_id'] ?? null), $model, $deductible,
                self::dateOrNull($d['pledge_date'] ?? null), self::dateOrNull($d['received_date'] ?? null),
                $d['payment_reference'] ?? null, self::intOrNull($d['credited_team_id'] ?? null), (int)$cur['id'], $d['notes'] ?? null,
            ]);
        $cid = (int)$pdo->lastInsertId();
        self::syncContributionBudget($pdo, $cid);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_contributions', $cid, 'create', null, ['sponsor_id' => $sid]);
        return self::get($req, $res, ['sponsor_id' => $sid]);
    }

    public static function updateContribution(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $cid = (int)$route['contribution_id'];
        $s = $pdo->prepare("SELECT * FROM sponsor_contributions WHERE id = ?"); $s->execute([$cid]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Contribution not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['season', 'in_kind_description', 'designation', 'program_model', 'payment_reference', 'notes'] as $f)
            if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        if (array_key_exists('scholarship_fund_id', $d)) { $set[] = 'scholarship_fund_id = ?'; $args[] = self::intOrNull($d['scholarship_fund_id']); }
        if (array_key_exists('tax_deductible', $d)) { $set[] = 'tax_deductible = ?'; $args[] = (int)!empty($d['tax_deductible']); }
        foreach (['amount', 'in_kind_value'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::num($d[$f]); }
        foreach (['pledge_date', 'received_date'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::dateOrNull($d[$f]); }
        if (array_key_exists('contribution_type', $d)) { $set[] = 'contribution_type = ?'; $args[] = $d['contribution_type'] === 'in_kind' ? 'in_kind' : 'monetary'; }
        if (array_key_exists('status', $d) && in_array($d['status'], ['pledged', 'received', 'declined', 'refunded'], true)) { $set[] = 'status = ?'; $args[] = $d['status']; }
        if (array_key_exists('credited_team_id', $d)) { $set[] = 'credited_team_id = ?'; $args[] = self::intOrNull($d['credited_team_id']); }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $cid; $pdo->prepare("UPDATE sponsor_contributions SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        self::syncContributionBudget($pdo, $cid);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_contributions', $cid, 'update', null, $d);
        return self::get($req, $res, ['sponsor_id' => (int)$row['sponsor_id']]);
    }

    public static function deleteContribution(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $cid = (int)$route['contribution_id'];
        $s = $pdo->prepare("SELECT * FROM sponsor_contributions WHERE id = ?"); $s->execute([$cid]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Contribution not found', 404);
        if ($row['budget_donation_id']) $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([(int)$row['budget_donation_id']]);
        $pdo->prepare("DELETE FROM sponsor_contributions WHERE id = ?")->execute([$cid]);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_contributions', $cid, 'delete', null, null);
        return self::get($req, $res, ['sponsor_id' => (int)$row['sponsor_id']]);
    }

    private static function ensureSponsorCategory(PDO $pdo, int $teamSeasonId): int
    {
        $s = $pdo->prepare("SELECT id FROM inv_budget_categories WHERE team_season_id = ? AND is_fundraising = 1 AND name = ?");
        $s->execute([$teamSeasonId, self::SPONSOR_CATEGORY]);
        if ($r = $s->fetch()) return (int)$r['id'];
        $pdo->prepare("INSERT INTO inv_budget_categories (team_season_id, name, is_fundraising, budgeted_amount, actual_amount, created_at) VALUES (?, ?, 1, 0, 0, NOW())")
            ->execute([$teamSeasonId, self::SPONSOR_CATEGORY]);
        return (int)$pdo->lastInsertId();
    }

    /**
     * Post a monetary contribution to the crediting team's "Sponsorships" fundraising
     * line. Expected = amount; received = amount only when status is 'received' (turns
     * the line green in the budget panel). Program-level or in-kind → no team budget line.
     */
    public static function syncContributionBudget(PDO $pdo, int $contributionId): void
    {
        $s = $pdo->prepare("SELECT * FROM sponsor_contributions WHERE id = ?"); $s->execute([$contributionId]); $c = $s->fetch();
        if (!$c) return;
        $teamId = self::intOrNull($c['credited_team_id']);
        $donId = self::intOrNull($c['budget_donation_id']);
        $amount = $c['contribution_type'] === 'monetary' ? self::num($c['amount']) : null;

        $removeLine = function () use ($pdo, $donId, $contributionId) {
            if ($donId) { $pdo->prepare("DELETE FROM inv_fundraising_donations WHERE id = ?")->execute([$donId]);
                $pdo->prepare("UPDATE sponsor_contributions SET budget_donation_id = NULL WHERE id = ?")->execute([$contributionId]); }
        };
        // Only monetary, credited-to-a-team, non-declined contributions get a budget line.
        if ($teamId === null || $amount === null || in_array($c['status'], ['declined', 'refunded'], true)) { $removeLine(); return; }

        $tsStmt = $pdo->prepare("SELECT id FROM team_seasons WHERE team_id = ? AND season = ?");
        $tsStmt->execute([$teamId, $c['season']]); $ts = $tsStmt->fetch();
        if (!$ts) { $removeLine(); return; } // no matching team-season → nothing to post to

        $sp = self::sponsor($pdo, (int)$c['sponsor_id']);
        $label = 'Sponsor: ' . ($sp['name'] ?? 'Sponsor');
        $received = $c['status'] === 'received' ? $amount : null;
        $cat = self::ensureSponsorCategory($pdo, (int)$ts['id']);
        if ($donId) {
            $pdo->prepare("UPDATE inv_fundraising_donations SET budget_category_id = ?, name = ?, expected_amount = ?, received_amount = ?, received_date = ?, sponsor_id = ? WHERE id = ?")
                ->execute([$cat, $label, $amount, $received, $c['received_date'], (int)$c['sponsor_id'], $donId]);
        } else {
            $pdo->prepare("INSERT INTO inv_fundraising_donations (budget_category_id, sponsor_id, name, expected_amount, received_amount, received_date, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())")
                ->execute([$cat, (int)$c['sponsor_id'], $label, $amount, $received, $c['received_date']]);
            $pdo->prepare("UPDATE sponsor_contributions SET budget_donation_id = ? WHERE id = ?")->execute([(int)$pdo->lastInsertId(), $contributionId]);
        }
    }

    // ── Deliverables ──────────────────────────────────────────────────────────

    private static function serializeDeliverable(PDO $pdo, array $d): array
    {
        return [
            'id' => (int)$d['id'], 'sponsor_id' => (int)$d['sponsor_id'], 'season' => $d['season'],
            'description' => $d['description'], 'category' => $d['category'], 'due_date' => $d['due_date'],
            'assigned_to_id' => self::intOrNull($d['assigned_to_id']), 'assigned_to_name' => self::memberName($pdo, self::intOrNull($d['assigned_to_id'])),
            'status' => $d['status'], 'completion_date' => $d['completion_date'], 'completion_notes' => $d['completion_notes'],
        ];
    }

    public static function addDeliverable(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['sponsor_id'];
        $sp = self::sponsor($pdo, $sid);
        if (!$sp) return Http::error($res, 'Sponsor not found', 404);
        $d = (array)$req->getParsedBody();
        if (empty($d['description'])) return Http::error($res, 'Deliverable description is required.', 422);
        $pdo->prepare("INSERT INTO sponsor_deliverables (sponsor_id, season, description, category, due_date, assigned_to_id, status, created_by_id)
            VALUES (?,?,?,?,?,?,?,?)")
            ->execute([$sid, $d['season'] ?? $sp['season'], $d['description'], $d['category'] ?? null,
                self::dateOrNull($d['due_date'] ?? null), self::intOrNull($d['assigned_to_id'] ?? null),
                in_array($d['status'] ?? 'pending', ['pending', 'in_progress', 'complete', 'overdue', 'waived'], true) ? $d['status'] : 'pending', (int)$cur['id']]);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_deliverables', (int)$pdo->lastInsertId(), 'create', null, ['sponsor_id' => $sid]);
        return self::get($req, $res, ['sponsor_id' => $sid]);
    }

    public static function updateDeliverable(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $did = (int)$route['deliverable_id'];
        $s = $pdo->prepare("SELECT * FROM sponsor_deliverables WHERE id = ?"); $s->execute([$did]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Deliverable not found', 404);
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['description', 'category', 'completion_notes', 'season'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = $d[$f]; }
        foreach (['due_date', 'completion_date'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::dateOrNull($d[$f]); }
        if (array_key_exists('assigned_to_id', $d)) { $set[] = 'assigned_to_id = ?'; $args[] = self::intOrNull($d['assigned_to_id']); }
        if (array_key_exists('status', $d) && in_array($d['status'], ['pending', 'in_progress', 'complete', 'overdue', 'waived'], true)) {
            $set[] = 'status = ?'; $args[] = $d['status'];
            if ($d['status'] === 'complete' && empty($d['completion_date']) && !$row['completion_date']) { $set[] = 'completion_date = ?'; $args[] = date('Y-m-d'); }
        }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $did; $pdo->prepare("UPDATE sponsor_deliverables SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$cur['id'], 'sponsor_deliverables', $did, 'update', null, $d);
        return self::get($req, $res, ['sponsor_id' => (int)$row['sponsor_id']]);
    }

    public static function deleteDeliverable(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $did = (int)$route['deliverable_id'];
        $s = $pdo->prepare("SELECT sponsor_id FROM sponsor_deliverables WHERE id = ?"); $s->execute([$did]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Deliverable not found', 404);
        $pdo->prepare("DELETE FROM sponsor_deliverables WHERE id = ?")->execute([$did]);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_deliverables', $did, 'delete', null, null);
        return self::get($req, $res, ['sponsor_id' => (int)$row['sponsor_id']]);
    }

    // ── Outreach contact log (team-scoped guardrail enforced here) ────────────

    public static function addContact(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['sponsor_id'];
        $sp = self::sponsor($pdo, $sid);
        if (!$sp) return Http::error($res, 'Sponsor not found', 404);
        if (!self::canContact($pdo, $cur, $sp)) {
            return Http::error($res, 'Only members of an owning team may contact this sponsor.', 403);
        }
        $d = (array)$req->getParsedBody();
        $pdo->prepare("INSERT INTO sponsor_contacts (sponsor_id, member_id, method, notes, outcome, contacted_at) VALUES (?,?,?,?,?,?)")
            ->execute([$sid, (int)$cur['id'], $d['method'] ?? null, $d['notes'] ?? null, $d['outcome'] ?? null,
                self::dateOrNull($d['contacted_at'] ?? null) ?? date('Y-m-d')]);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_contacts', (int)$pdo->lastInsertId(), 'create', null, ['sponsor_id' => $sid]);
        return self::get($req, $res, ['sponsor_id' => $sid]);
    }

    /** GET /sponsors/reports — totals by scope, tier, season, state + lifetime & outstanding. */
    public static function reports(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $recvExpr = "CASE WHEN contribution_type='monetary' THEN amount ELSE COALESCE(in_kind_value,0) END";

        $lifetime = (float)$pdo->query("SELECT COALESCE(SUM($recvExpr),0) FROM sponsor_contributions WHERE status='received'")->fetchColumn();
        $outstanding = (float)$pdo->query("SELECT COALESCE(SUM($recvExpr),0) FROM sponsor_contributions WHERE status='pledged'")->fetchColumn();

        $bySeason = array_map(fn($r) => ['season' => $r['season'], 'received' => round((float)$r['received'], 2)],
            $pdo->query("SELECT season, COALESCE(SUM($recvExpr),0) AS received FROM sponsor_contributions WHERE status='received' GROUP BY season ORDER BY season DESC")->fetchAll());

        $byScope = [];
        foreach ($pdo->query("SELECT s.scope, COUNT(DISTINCT s.id) AS n, COALESCE(SUM(CASE WHEN c.status='received' THEN ($recvExpr) ELSE 0 END),0) AS received
                              FROM sponsors s LEFT JOIN sponsor_contributions c ON c.sponsor_id = s.id GROUP BY s.scope")->fetchAll() as $r) {
            $byScope[] = ['scope' => $r['scope'], 'count' => (int)$r['n'], 'received' => round((float)$r['received'], 2)];
        }

        $byState = array_map(fn($r) => ['state' => $r['lifecycle_state'], 'count' => (int)$r['n']],
            $pdo->query("SELECT lifecycle_state, COUNT(*) AS n FROM sponsors GROUP BY lifecycle_state")->fetchAll());

        // Per-sponsor received + computed tier → aggregate by tier, and top sponsors.
        $sponsors = $pdo->query("SELECT id, name, season FROM sponsors")->fetchAll();
        $tierAgg = []; $top = [];
        foreach ($sponsors as $sp) {
            $recv = self::receivedTotal($pdo, (int)$sp['id'], $sp['season']);
            $tier = self::computeTier($recv['total'], $recv['monetary']) ?? 'Untiered';
            if (!isset($tierAgg[$tier])) $tierAgg[$tier] = ['tier' => $tier, 'count' => 0, 'received' => 0.0];
            $tierAgg[$tier]['count']++; $tierAgg[$tier]['received'] += $recv['total'];
            if ($recv['total'] > 0) $top[] = ['id' => (int)$sp['id'], 'name' => $sp['name'], 'received' => $recv['total']];
        }
        foreach ($tierAgg as &$t) $t['received'] = round($t['received'], 2); unset($t);
        usort($top, fn($a, $b) => $b['received'] <=> $a['received']);

        return Http::json($res, [
            'lifetime_received' => round($lifetime, 2), 'outstanding_pledged' => round($outstanding, 2),
            'by_season' => $bySeason, 'by_scope' => $byScope, 'by_state' => $byState,
            'by_tier' => array_values($tierAgg), 'top_sponsors' => array_slice($top, 0, 10),
        ]);
    }

    /** GET /sponsors/reminders — pledged contributions awaiting receipt (dashboard). */
    public static function reminders(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canView($pdo, $cur)) return Http::json($res, []);
        $s = $pdo->query(
            "SELECT c.id, c.contribution_type, c.amount, c.in_kind_value, c.pledge_date, c.season,
                    s.id AS sponsor_id, s.name AS sponsor_name
             FROM sponsor_contributions c JOIN sponsors s ON s.id = c.sponsor_id
             WHERE c.status = 'pledged' ORDER BY COALESCE(c.pledge_date, c.created_at), c.id LIMIT 25");
        return Http::json($res, array_map(fn($r) => [
            'contribution_id' => (int)$r['id'], 'sponsor_id' => (int)$r['sponsor_id'], 'sponsor_name' => $r['sponsor_name'],
            'amount' => self::num($r['contribution_type'] === 'monetary' ? $r['amount'] : $r['in_kind_value']),
            'in_kind' => $r['contribution_type'] === 'in_kind', 'pledge_date' => $r['pledge_date'], 'season' => $r['season'],
        ], $s->fetchAll()));
    }

    public static function deleteContact(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $kid = (int)$route['contact_id'];
        $s = $pdo->prepare("SELECT sponsor_id FROM sponsor_contacts WHERE id = ?"); $s->execute([$kid]); $row = $s->fetch();
        if (!$row) return Http::error($res, 'Not found', 404);
        $pdo->prepare("DELETE FROM sponsor_contacts WHERE id = ?")->execute([$kid]);
        Audit::write($pdo, (int)$cur['id'], 'sponsor_contacts', $kid, 'delete', null, null);
        return self::get($req, $res, ['sponsor_id' => (int)$row['sponsor_id']]);
    }
}
