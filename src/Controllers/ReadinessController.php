<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Season Strategy — Inspire/Impact Readiness (Phase 4). Scores the "Six Separators"
 * of world-class award teams from the team's real data (goals, portfolio pieces,
 * captures, mission, certifications), computed on READ. Weights/labels are the
 * admin-tunable readiness_criteria rows. No per-team score is stored.
 */
final class ReadinessController
{
    private static function perm(PDO $pdo, ?array $m, string $key, string $level = 'read'): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function clamp(float $v): int { return (int)max(0, min(100, round($v))); }

    /** GET /strategy/team/{team_season_id}/readiness */
    public static function readiness(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'strategy.readiness.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $tsr = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $tsr->execute([$tsid]);
        $ts = $tsr->fetch();
        if (!$ts) return Http::error($res, 'Team season not found', 404);

        // ── Gather the raw material ──
        $goals = $pdo->prepare("SELECT category, target_value, current_value, status, owner_member_id, title, description FROM season_goals WHERE team_season_id = ? AND status <> 'archived'");
        $goals->execute([$tsid]); $goals = $goals->fetchAll();

        $pf = $pdo->prepare("SELECT id FROM team_portfolios WHERE team_season_id = ?"); $pf->execute([$tsid]);
        $portfolioId = (int)($pf->fetchColumn() ?: 0);
        $pieces = []; $captures = [];
        if ($portfolioId) {
            $ps = $pdo->prepare("SELECT section_type, status, owner_member_id FROM portfolio_pieces WHERE portfolio_id = ?"); $ps->execute([$portfolioId]);
            $pieces = $ps->fetchAll();
            $cs = $pdo->prepare("SELECT capture_type, member_id, evidence_id, created_at FROM portfolio_captures WHERE portfolio_id = ?"); $cs->execute([$portfolioId]);
            $captures = $cs->fetchAll();
        }

        // Team roster (active youth) + certification breadth.
        $roster = $pdo->prepare("SELECT tma.member_id FROM team_member_assignments tma JOIN members mm ON mm.id = tma.member_id
                                 WHERE tma.team_season_id = ? AND (tma.status IS NULL OR tma.status <> 'inactive') AND mm.member_type = 'youth'");
        $roster->execute([$tsid]);
        $rosterIds = array_map('intval', $roster->fetchAll(PDO::FETCH_COLUMN));
        $rosterSize = count($rosterIds);
        $youthWithCerts = 0;
        if ($rosterIds) {
            $in = implode(',', array_fill(0, count($rosterIds), '?'));
            $c = $pdo->prepare("SELECT COUNT(DISTINCT member_id) FROM member_certifications WHERE status = 'completed' AND member_id IN ($in)");
            $c->execute($rosterIds);
            $youthWithCerts = (int)$c->fetchColumn();
        }

        // ── Score each separator (0–100) + guidance ──
        $scores = []; $guide = [];

        // one_story: mission + narrative pieces drafted
        $missionSet = trim((string)($ts['mission'] ?? '')) !== '';
        $narr = array_filter($pieces, fn($p) => in_array($p['section_type'], ['awards_narrative', 'team_background'], true));
        $narrDrafted = array_filter($narr, fn($p) => $p['status'] !== 'not_started');
        $narrFrac = $narr ? count($narrDrafted) / count($narr) : 0.0;
        $scores['one_story'] = self::clamp(($missionSet ? 50 : 0) + $narrFrac * 50);
        $guide['one_story'] = !$missionSet ? 'Set your team mission on the Goals tab.'
            : (count($narr) === 0 ? 'Add and start your team-background and award-narrative portfolio pieces.'
            : (count($narrDrafted) < count($narr) ? 'Move your narrative pieces past "not started".' : 'Strong — a clear mission with narrative in progress.'));

        // measured_impact: goals with a real target + progress
        $measured = array_filter($goals, fn($g) => $g['target_value'] !== null && (float)$g['target_value'] > 0 && (float)$g['current_value'] > 0);
        $scores['measured_impact'] = count($goals) ? self::clamp(count($measured) / count($goals) * 100) : 0;
        $guide['measured_impact'] = count($goals) === 0 ? 'Add measurable outreach/impact goals with a target.'
            : (count($measured) < count($goals) ? 'Give each goal a target and log progress against it.' : 'Strong — goals are measured and moving.');

        // engineering_process: design_decision / test_result captures, weighted by recency
        $engTotal = 0; $engRecent = 0; $cut = strtotime('-45 days');
        foreach ($captures as $c) {
            if (in_array($c['capture_type'], ['design_decision', 'test_result'], true)) {
                $engTotal++;
                if (strtotime((string)$c['created_at']) >= $cut) $engRecent++;
            }
        }
        $scores['engineering_process'] = self::clamp(max($engRecent * 20, $engTotal * 10));
        $guide['engineering_process'] = $engTotal === 0 ? 'Log design decisions and test results as you build.'
            : ($engRecent === 0 ? 'Keep the habit current — no engineering captures in the last 45 days.' : 'Strong — you\'re documenting the engineering story.');

        // everyone_owns_it: owner spread + cert breadth + contributor spread
        $ownerIds = [];
        foreach ($goals as $g) if ($g['owner_member_id'] !== null) $ownerIds[(int)$g['owner_member_id']] = true;
        foreach ($pieces as $p) if ($p['owner_member_id'] !== null) $ownerIds[(int)$p['owner_member_id']] = true;
        $targetOwners = max(3, (int)ceil($rosterSize / 2));
        $ownerFrac = $targetOwners ? min(1.0, count($ownerIds) / $targetOwners) : 0.0;
        $certFrac = $rosterSize ? $youthWithCerts / $rosterSize : 0.0;
        $byContrib = [];
        foreach ($captures as $c) if ($c['member_id'] !== null) $byContrib[(int)$c['member_id']] = ($byContrib[(int)$c['member_id']] ?? 0) + 1;
        $totalCap = array_sum($byContrib);
        $spreadFrac = $totalCap > 0 ? 1 - (max($byContrib) / $totalCap) : 0.0;
        $scores['everyone_owns_it'] = self::clamp($ownerFrac * 40 + $certFrac * 40 + $spreadFrac * 20);
        $guide['everyone_owns_it'] = count($ownerIds) < $targetOwners ? 'Spread goal and piece ownership across more of the team.'
            : ($certFrac < 0.5 ? 'Grow certification breadth — get more youth earning skills.' : 'Strong — ownership and skills are shared.');

        // sustainability: sustainability piece progress + growth/mentoring goals
        $susPiece = 0;
        foreach ($pieces as $p) if ($p['section_type'] === 'sustainability') {
            $susPiece = max($susPiece, ['not_started' => 0, 'in_progress' => 25, 'review' => 45, 'done' => 60][$p['status']] ?? 0);
        }
        $susGoal = 0;
        foreach ($goals as $g) {
            if (in_array($g['category'], ['team', 'fundraising'], true) || preg_match('/sustain|mentor|start(ed)? a team|grow/i', $g['title'] . ' ' . $g['description'])) { $susGoal = 40; break; }
        }
        $scores['sustainability'] = self::clamp($susPiece + $susGoal);
        $guide['sustainability'] = $susPiece === 0 ? 'Work your sustainability portfolio piece.'
            : ($susGoal === 0 ? 'Add a goal about growing, mentoring, or starting other teams.' : 'Strong — a real sustainability plan is forming.');

        // felt_evidence: share of captures backed by evidence
        $withEvidence = count(array_filter($captures, fn($c) => $c['evidence_id'] !== null));
        $totalCaptures = count($captures);
        $scores['felt_evidence'] = $totalCaptures ? self::clamp($withEvidence / $totalCaptures * 100) : 0;
        $guide['felt_evidence'] = $totalCaptures === 0 ? 'Start logging captures and attach evidence to them.'
            : ($withEvidence < $totalCaptures ? 'Attach evidence (photos, data, links) to more of your captures.' : 'Strong — your story is backed by evidence.');

        // ── Assemble with the admin-tuned criteria (weights/labels/order) ──
        $crit = $pdo->query("SELECT * FROM readiness_criteria WHERE is_active = 1 ORDER BY sort_order, id")->fetchAll();
        $out = []; $weightSum = 0; $weightedTotal = 0;
        foreach ($crit as $c) {
            $key = $c['crit_key'];
            if (!array_key_exists($key, $scores)) continue;
            $w = max(0, (int)$c['weight']);
            $out[] = ['key' => $key, 'label' => $c['label'], 'description' => $c['description'],
                'weight' => $w, 'score' => $scores[$key], 'guidance' => $guide[$key] ?? null];
            $weightSum += $w; $weightedTotal += $w * $scores[$key];
        }
        $overall = $weightSum > 0 ? (int)round($weightedTotal / $weightSum) : 0;
        $band = $overall >= 75 ? 'strong' : ($overall >= 45 ? 'developing' : 'early');

        return Http::json($res, [
            'team_season_id' => $tsid,
            'overall' => $overall, 'band' => $band, 'criteria' => $out,
            'context' => ['goals' => count($goals), 'pieces' => count($pieces), 'captures' => $totalCaptures,
                'roster' => $rosterSize, 'youth_with_certs' => $youthWithCerts, 'mission_set' => $missionSet],
        ]);
    }

    /** GET /strategy/readiness/criteria — the tunable criteria list (admin editor). */
    public static function listCriteria(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'strategy.readiness.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT id, crit_key, label, description, weight, sort_order, is_active FROM readiness_criteria ORDER BY sort_order, id")->fetchAll();
        return Http::json($res, array_map(fn($c) => [
            'id' => (int)$c['id'], 'key' => $c['crit_key'], 'label' => $c['label'], 'description' => $c['description'],
            'weight' => (int)$c['weight'], 'sort_order' => (int)$c['sort_order'], 'is_active' => (bool)$c['is_active'],
        ], $rows));
    }

    /** PUT /strategy/readiness/criteria — tune weights/labels/active (admin). */
    public static function saveCriteria(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Admins only', 403);
        $d = (array)$req->getParsedBody();
        foreach ((array)($d['criteria'] ?? []) as $c) {
            if (empty($c['id'])) continue;
            $pdo->prepare("UPDATE readiness_criteria SET label = COALESCE(?, label), weight = ?, is_active = ? WHERE id = ?")
                ->execute([$c['label'] ?? null, max(0, (int)($c['weight'] ?? 1)), !empty($c['is_active']) ? 1 : 0, (int)$c['id']]);
        }
        Audit::write($pdo, (int)$m['id'], 'readiness_criteria', null, 'strategy.readiness_config', null, null);
        return self::listCriteria($req, $res);
    }
}
