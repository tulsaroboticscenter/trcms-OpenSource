<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\StrategyEvidence;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Season Strategy — Portfolio piece tracker (Phase 2). One portfolio per team-season;
 * a list of tracked PIECES (owner/status/due) whose finished asset is a Canva link/file
 * stored in the team's Resources section (piece.resource_id → resources); plus all-season
 * captures. TRCMS tracks and feeds the portfolio — Canva builds the final artifact.
 */
final class PortfolioController
{
    private const SECTIONS = ['team_background', 'sustainability', 'engineering_process', 'robot_design', 'outreach_impact', 'awards_narrative', 'custom'];
    private const PIECE_STATUS = ['not_started', 'in_progress', 'review', 'done'];
    private const PORTFOLIO_STATUS = ['planning', 'drafting', 'review', 'submission_ready'];
    private const CAPTURE_TYPES = ['design_decision', 'test_result', 'outreach_event', 'photo', 'reflection', 'metric', 'quote'];

    /** Default piece templates by award target (Q-B: generic sets, refine after a real cycle). */
    private const TEMPLATES = [
        'inspire' => [
            ['team_background', 'Team Background & Story'],
            ['outreach_impact', 'Outreach & Community Impact'],
            ['engineering_process', 'Engineering Process'],
            ['robot_design', 'Robot Design & Innovation'],
            ['sustainability', 'Sustainability & Team Plan'],
            ['awards_narrative', 'Inspire Award Narrative'],
        ],
        'impact' => [
            ['team_background', 'Team Background & Story'],
            ['outreach_impact', 'Outreach & Community Impact'],
            ['sustainability', 'Sustainability & Business Plan'],
            ['engineering_process', 'Engineering & Technical Process'],
            ['awards_narrative', 'Impact Essay'],
            ['custom', 'Impact Video Outline'],
        ],
    ];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level = 'write'): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }
    private static function teamOr404(PDO $pdo, int $tsid): ?array
    {
        $s = $pdo->prepare("SELECT * FROM team_seasons WHERE id = ?"); $s->execute([$tsid]);
        return $s->fetch() ?: null;
    }
    private static function memberBrief(PDO $pdo, ?int $id): ?array
    {
        if ($id === null) return null;
        $s = $pdo->prepare("SELECT id, first_name, last_name FROM members WHERE id = ?"); $s->execute([$id]);
        $m = $s->fetch();
        return $m ? ['member_id' => (int)$m['id'], 'name' => trim($m['first_name'] . ' ' . $m['last_name'])] : null;
    }
    private static function enum($v, array $allowed, string $default): string
    {
        return in_array($v, $allowed, true) ? (string)$v : $default;
    }

    /** Get-or-create the portfolio row for a team season. */
    private static function ensurePortfolio(PDO $pdo, array $ts): array
    {
        $s = $pdo->prepare("SELECT * FROM team_portfolios WHERE team_season_id = ?"); $s->execute([(int)$ts['id']]);
        $p = $s->fetch();
        if ($p) return $p;
        $pdo->prepare("INSERT INTO team_portfolios (team_season_id, season, created_at, updated_at) VALUES (?,?,NOW(),NOW())")
            ->execute([(int)$ts['id'], $ts['season'] ?? null]);
        $s->execute([(int)$ts['id']]);
        return $s->fetch();
    }

    private static function serializePiece(PDO $pdo, array $p): array
    {
        $resource = null;
        if ($p['resource_id'] !== null) {
            $rs = $pdo->prepare("SELECT id, name, `values` FROM resources WHERE id = ?"); $rs->execute([(int)$p['resource_id']]);
            if ($r = $rs->fetch()) {
                $vals = $r['values'] ? json_decode((string)$r['values'], true) : [];
                $resource = ['id' => (int)$r['id'], 'name' => $r['name'], 'canva_url' => $vals['canva_url'] ?? null];
            }
        }
        return [
            'id' => (int)$p['id'], 'portfolio_id' => (int)$p['portfolio_id'],
            'section_type' => $p['section_type'], 'title' => $p['title'], 'description' => $p['description'],
            'owner' => self::memberBrief($pdo, $p['owner_member_id'] !== null ? (int)$p['owner_member_id'] : null),
            'owner_member_id' => $p['owner_member_id'] !== null ? (int)$p['owner_member_id'] : null,
            'status' => $p['status'], 'due_date' => $p['due_date'], 'sort_order' => (int)$p['sort_order'],
            'resource_id' => $p['resource_id'] !== null ? (int)$p['resource_id'] : null, 'resource' => $resource,
        ];
    }

    // ── Portfolio ─────────────────────────────────────────────────────────────

    /** GET /strategy/team/{tsid}/portfolio */
    public static function getPortfolio(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.view', 'read')) return Http::error($res, 'Access denied', 403);
        $ts = self::teamOr404($pdo, (int)$route['team_season_id']);
        if (!$ts) return Http::error($res, 'Team season not found', 404);
        $p = self::ensurePortfolio($pdo, $ts);

        $ps = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE portfolio_id = ? ORDER BY sort_order, id");
        $ps->execute([(int)$p['id']]);
        $pieces = array_map(fn($x) => self::serializePiece($pdo, $x), $ps->fetchAll());
        $done = count(array_filter($pieces, fn($x) => $x['status'] === 'done'));

        $cs = $pdo->prepare("SELECT * FROM portfolio_captures WHERE portfolio_id = ? ORDER BY COALESCE(occurred_on, created_at) DESC, id DESC LIMIT 100");
        $cs->execute([(int)$p['id']]);
        $captures = array_map(fn($c) => [
            'id' => (int)$c['id'], 'piece_id' => $c['piece_id'] !== null ? (int)$c['piece_id'] : null,
            'member' => self::memberBrief($pdo, $c['member_id'] !== null ? (int)$c['member_id'] : null),
            'capture_type' => $c['capture_type'], 'title' => $c['title'], 'body' => $c['body'],
            'occurred_on' => $c['occurred_on'], 'created_at' => Time::naiveIso($c['created_at'] ?? null),
        ], $cs->fetchAll());

        // Team resources of the Portfolio Asset type, for the "pick existing" linker.
        $assets = $pdo->prepare("SELECT r.id, r.name FROM resources r JOIN resource_types t ON t.id = r.resource_type_id
                                 WHERE r.team_season_id = ? AND r.is_archived = 0 AND t.name = 'Portfolio Asset' ORDER BY r.name");
        $assets->execute([(int)$ts['id']]);

        return Http::json($res, [
            'team_season_id' => (int)$ts['id'],
            'portfolio' => ['id' => (int)$p['id'], 'program' => $p['program'], 'award_target' => $p['award_target'],
                'builder_tool' => $p['builder_tool'], 'status' => $p['status']],
            'pieces' => $pieces, 'captures' => $captures,
            'progress_pct' => $pieces ? (int)round($done / count($pieces) * 100) : 0,
            'done_count' => $done, 'piece_count' => count($pieces),
            'existing_assets' => $assets->fetchAll(PDO::FETCH_ASSOC),
            'can_contribute' => self::perm($pdo, $m, 'portfolio.contribute', 'write'),
            'can_manage' => self::perm($pdo, $m, 'portfolio.manage', 'write'),
            'template_seeded' => count($pieces) > 0,
        ]);
    }

    /** PATCH /strategy/portfolio/{portfolio_id} — set program/award/status/builder_tool. */
    public static function updatePortfolio(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['portfolio_id']; $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (isset($d['program'])) { $set[] = 'program = ?'; $args[] = self::enum($d['program'], ['FTC', 'FRC', 'FLL'], 'FTC'); }
        if (isset($d['award_target'])) { $set[] = 'award_target = ?'; $args[] = self::enum($d['award_target'], ['inspire', 'impact', 'other'], 'inspire'); }
        if (isset($d['status'])) { $set[] = 'status = ?'; $args[] = self::enum($d['status'], self::PORTFOLIO_STATUS, 'planning'); }
        if (isset($d['builder_tool'])) { $set[] = 'builder_tool = ?'; $args[] = trim((string)$d['builder_tool']) ?: 'Canva'; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE team_portfolios SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'team_portfolios', $id, 'update', null, $d);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /strategy/portfolio/{portfolio_id}/seed-template — create the default piece set. */
    public static function seedTemplate(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['portfolio_id'];
        $pr = $pdo->prepare("SELECT * FROM team_portfolios WHERE id = ?"); $pr->execute([$id]);
        $portfolio = $pr->fetch();
        if (!$portfolio) return Http::error($res, 'Portfolio not found', 404);
        $target = self::TEMPLATES[$portfolio['award_target']] ?? self::TEMPLATES['inspire'];
        $existing = (int)$pdo->query("SELECT COUNT(*) FROM portfolio_pieces WHERE portfolio_id = $id")->fetchColumn();
        $order = $existing; $created = 0;
        foreach ($target as [$section, $title]) {
            $pdo->prepare("INSERT INTO portfolio_pieces (portfolio_id, section_type, title, status, sort_order, created_at, updated_at) VALUES (?,?,?, 'not_started', ?, NOW(), NOW())")
                ->execute([$id, $section, $title, ++$order]);
            $created++;
        }
        Audit::write($pdo, (int)$m['id'], 'portfolio_pieces', null, 'portfolio.seed_template', null, ['portfolio_id' => $id, 'award' => $portfolio['award_target'], 'created' => $created]);
        return Http::json($res, ['ok' => true, 'created' => $created]);
    }

    // ── Pieces ────────────────────────────────────────────────────────────────

    /** POST /strategy/portfolio/{portfolio_id}/pieces */
    public static function createPiece(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['portfolio_id']; $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? ''));
        if ($title === '') return Http::error($res, 'A piece title is required.', 422);
        $ord = (int)($pdo->query("SELECT COALESCE(MAX(sort_order),0)+1 FROM portfolio_pieces WHERE portfolio_id = $pid")->fetchColumn());
        $pdo->prepare("INSERT INTO portfolio_pieces (portfolio_id, section_type, title, description, owner_member_id, status, due_date, sort_order, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())")
            ->execute([$pid, self::enum($d['section_type'] ?? null, self::SECTIONS, 'custom'), $title, ($d['description'] ?? null) ?: null,
                !empty($d['owner_member_id']) ? (int)$d['owner_member_id'] : null,
                self::enum($d['status'] ?? null, self::PIECE_STATUS, 'not_started'), ($d['due_date'] ?? null) ?: null, $ord]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'portfolio_pieces', $newId, 'create', null, ['title' => $title]);
        $r = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE id = ?"); $r->execute([$newId]);
        return Http::json($res, self::serializePiece($pdo, $r->fetch()), 201);
    }

    /** PATCH /strategy/portfolio-pieces/{piece_id} — edit / set status / owner (contribute). */
    public static function updatePiece(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.contribute', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['piece_id'];
        $r = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE id = ?"); $r->execute([$id]);
        if (!$r->fetch()) return Http::error($res, 'Piece not found', 404);
        $d = (array)$req->getParsedBody(); $set = []; $args = [];
        if (array_key_exists('title', $d) && trim((string)$d['title']) !== '') { $set[] = 'title = ?'; $args[] = trim((string)$d['title']); }
        if (array_key_exists('description', $d)) { $set[] = 'description = ?'; $args[] = ($d['description'] !== '' ? $d['description'] : null); }
        if (array_key_exists('section_type', $d)) { $set[] = 'section_type = ?'; $args[] = self::enum($d['section_type'], self::SECTIONS, 'custom'); }
        if (array_key_exists('owner_member_id', $d)) { $set[] = 'owner_member_id = ?'; $args[] = !empty($d['owner_member_id']) ? (int)$d['owner_member_id'] : null; }
        if (array_key_exists('status', $d)) { $set[] = 'status = ?'; $args[] = self::enum($d['status'], self::PIECE_STATUS, 'not_started'); }
        if (array_key_exists('due_date', $d)) { $set[] = 'due_date = ?'; $args[] = ($d['due_date'] ?: null); }
        if (array_key_exists('resource_id', $d)) { $set[] = 'resource_id = ?'; $args[] = !empty($d['resource_id']) ? (int)$d['resource_id'] : null; }
        if ($set) { $set[] = 'updated_at = NOW()'; $args[] = $id; $pdo->prepare("UPDATE portfolio_pieces SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'portfolio_pieces', $id, 'update', null, array_keys($d));
        $r2 = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE id = ?"); $r2->execute([$id]);
        return Http::json($res, self::serializePiece($pdo, $r2->fetch()));
    }

    /** DELETE /strategy/portfolio-pieces/{piece_id} */
    public static function deletePiece(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['piece_id'];
        $pdo->prepare("UPDATE portfolio_captures SET piece_id = NULL WHERE piece_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM portfolio_pieces WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'portfolio_pieces', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    /** POST /strategy/portfolio/{portfolio_id}/reorder — {piece_ids:[...]} in new order. */
    public static function reorderPieces(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['portfolio_id']; $d = (array)$req->getParsedBody();
        $ids = array_map('intval', (array)($d['piece_ids'] ?? []));
        $order = 0;
        foreach ($ids as $id) { $pdo->prepare("UPDATE portfolio_pieces SET sort_order = ? WHERE id = ? AND portfolio_id = ?")->execute([++$order, $id, $pid]); }
        return Http::json($res, ['ok' => true]);
    }

    /**
     * POST /strategy/portfolio-pieces/{piece_id}/link — attach a Canva asset. Either
     * {resource_id} to link an existing team resource, or {canva_url, name} to create a
     * "Portfolio Asset" resource in the team's Resources section and link it.
     */
    public static function linkResource(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.contribute', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['piece_id'];
        $pr = $pdo->prepare("SELECT pp.*, tp.team_season_id FROM portfolio_pieces pp JOIN team_portfolios tp ON tp.id = pp.portfolio_id WHERE pp.id = ?");
        $pr->execute([$id]); $piece = $pr->fetch();
        if (!$piece) return Http::error($res, 'Piece not found', 404);
        $d = (array)$req->getParsedBody();

        $resourceId = !empty($d['resource_id']) ? (int)$d['resource_id'] : null;
        if ($resourceId === null && !empty($d['canva_url'])) {
            $typeId = (int)$pdo->query("SELECT id FROM resource_types WHERE name = 'Portfolio Asset' LIMIT 1")->fetchColumn();
            if (!$typeId) return Http::error($res, 'Portfolio Asset resource type is missing.', 500);
            $name = trim((string)($d['name'] ?? '')) ?: ($piece['title'] . ' (Canva)');
            $vals = json_encode(['canva_url' => (string)$d['canva_url']]);
            $ord = (int)($pdo->query("SELECT COALESCE(MAX(sort_order),0)+1 FROM resources WHERE team_season_id = " . (int)$piece['team_season_id'])->fetchColumn());
            $pdo->prepare("INSERT INTO resources (resource_type_id, scope, team_season_id, name, `values`, resets_each_season, needs_update, sort_order, is_archived, created_at, updated_at)
                           VALUES (?, 'team', ?, ?, ?, 0, 0, ?, 0, NOW(), NOW())")
                ->execute([$typeId, (int)$piece['team_season_id'], $name, $vals, $ord]);
            $resourceId = (int)$pdo->lastInsertId();
        }
        if ($resourceId === null) return Http::error($res, 'Provide a Canva link or pick an existing asset.', 422);
        $pdo->prepare("UPDATE portfolio_pieces SET resource_id = ?, updated_at = NOW() WHERE id = ?")->execute([$resourceId, $id]);
        Audit::write($pdo, (int)$m['id'], 'portfolio_pieces', $id, 'portfolio.link_asset', null, ['resource_id' => $resourceId]);
        $r2 = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE id = ?"); $r2->execute([$id]);
        return Http::json($res, self::serializePiece($pdo, $r2->fetch()));
    }

    // ── Captures ──────────────────────────────────────────────────────────────

    /** POST /strategy/portfolio/{portfolio_id}/captures — log a capture (<30s cadence habit). */
    public static function createCapture(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.contribute', 'write')) return Http::error($res, 'Access denied', 403);
        $pid = (int)$route['portfolio_id']; $d = (array)$req->getParsedBody();
        $title = trim((string)($d['title'] ?? '')); $body = trim((string)($d['body'] ?? ''));
        if ($title === '' && $body === '') return Http::error($res, 'Add a title or a note.', 422);
        $evidenceId = StrategyEvidence::create($pdo, is_array($d['evidence'] ?? null) ? $d['evidence'] : null, (int)$m['id']);
        $pdo->prepare("INSERT INTO portfolio_captures (portfolio_id, piece_id, member_id, capture_type, title, body, occurred_on, evidence_id, created_at)
                       VALUES (?,?,?,?,?,?,?,?,NOW())")
            ->execute([$pid, !empty($d['piece_id']) ? (int)$d['piece_id'] : null, (int)$m['id'],
                self::enum($d['capture_type'] ?? null, self::CAPTURE_TYPES, 'reflection'),
                $title ?: null, $body ?: null, ($d['occurred_on'] ?? null) ?: date('Y-m-d'), $evidenceId]);
        $id = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'portfolio_captures', $id, 'create', null, ['portfolio_id' => $pid]);
        return Http::json($res, ['ok' => true, 'id' => $id], 201);
    }

    /** DELETE /strategy/portfolio-captures/{capture_id} */
    public static function deleteCapture(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.contribute', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['capture_id'];
        $pdo->prepare("DELETE FROM portfolio_captures WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$m['id'], 'portfolio_captures', $id, 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Cross-team overview (/portfolio) ──────────────────────────────────────

    /** GET /strategy/portfolios — every team's portfolio status + piece roll-up. */
    public static function overview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.view', 'read')) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query(
            "SELECT tp.id, tp.team_season_id, tp.program, tp.award_target, tp.status, ts.team_name, ts.season, t.team_number,
                    (SELECT COUNT(*) FROM portfolio_pieces pp WHERE pp.portfolio_id = tp.id) AS piece_count,
                    (SELECT COUNT(*) FROM portfolio_pieces pp WHERE pp.portfolio_id = tp.id AND pp.status = 'done') AS done_count
             FROM team_portfolios tp
             JOIN team_seasons ts ON ts.id = tp.team_season_id
             LEFT JOIN teams t ON t.id = ts.team_id
             ORDER BY ts.team_name"
        )->fetchAll();
        $out = array_map(function ($r) {
            $pc = (int)$r['piece_count']; $dc = (int)$r['done_count'];
            $label = trim(($r['team_number'] ? '#' . $r['team_number'] . ' ' : '') . ($r['team_name'] ?? '')) ?: 'Team';
            return ['team_season_id' => (int)$r['team_season_id'], 'team_label' => $label, 'season' => $r['season'],
                'program' => $r['program'], 'award_target' => $r['award_target'], 'status' => $r['status'],
                'piece_count' => $pc, 'done_count' => $dc, 'progress_pct' => $pc ? (int)round($dc / $pc * 100) : 0];
        }, $rows);
        return Http::json($res, ['teams' => $out]);
    }

    // ── Exports (FR-X1 / FR-X2) ───────────────────────────────────────────────

    /** GET /strategy/team/{tsid}/portfolio/manifest.csv — every piece for the Canva builder. */
    public static function manifestCsv(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.view', 'read')) return Http::error($res, 'Access denied', 403);
        $ts = self::teamOr404($pdo, (int)$route['team_season_id']);
        if (!$ts) return Http::error($res, 'Team season not found', 404);
        $p = self::ensurePortfolio($pdo, $ts);
        $ps = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE portfolio_id = ? ORDER BY sort_order, id"); $ps->execute([(int)$p['id']]);
        $field = fn($v) => preg_match('/[",\r\n]/', (string)$v) ? '"' . str_replace('"', '""', (string)$v) . '"' : (string)$v;
        $csv = implode(',', ['Section', 'Piece', 'Owner', 'Status', 'Due', 'Canva link', 'Captures']) . "\r\n";
        foreach ($ps->fetchAll() as $piece) {
            $s = self::serializePiece($pdo, $piece);
            $capCount = (int)$pdo->query("SELECT COUNT(*) FROM portfolio_captures WHERE piece_id = " . (int)$piece['id'])->fetchColumn();
            $csv .= implode(',', array_map($field, [
                $piece['section_type'], $piece['title'], $s['owner']['name'] ?? '', $piece['status'],
                $piece['due_date'] ?? '', $s['resource']['canva_url'] ?? '', $capCount,
            ])) . "\r\n";
        }
        $res->getBody()->write($csv);
        return $res->withHeader('Content-Type', 'text/csv')->withHeader('Content-Disposition', 'attachment; filename=portfolio-manifest.csv');
    }

    /**
     * GET /strategy/team/{tsid}/portfolio/content-pack — captures grouped by piece, the
     * raw material to copy into Canva for each section (FR-X2).
     */
    public static function contentPack(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'portfolio.view', 'read')) return Http::error($res, 'Access denied', 403);
        $ts = self::teamOr404($pdo, (int)$route['team_season_id']);
        if (!$ts) return Http::error($res, 'Team season not found', 404);
        $p = self::ensurePortfolio($pdo, $ts);
        $ps = $pdo->prepare("SELECT * FROM portfolio_pieces WHERE portfolio_id = ? ORDER BY sort_order, id"); $ps->execute([(int)$p['id']]);
        $sections = [];
        foreach ($ps->fetchAll() as $piece) {
            $cs = $pdo->prepare("SELECT capture_type, title, body, occurred_on FROM portfolio_captures WHERE piece_id = ? ORDER BY COALESCE(occurred_on, created_at), id");
            $cs->execute([(int)$piece['id']]);
            $sections[] = [
                'piece_id' => (int)$piece['id'], 'section_type' => $piece['section_type'], 'title' => $piece['title'],
                'captures' => array_map(fn($c) => ['type' => $c['capture_type'], 'title' => $c['title'], 'body' => $c['body'], 'occurred_on' => $c['occurred_on']], $cs->fetchAll()),
            ];
        }
        // Unfiled captures (piece_id null) — still useful material.
        $u = $pdo->prepare("SELECT capture_type, title, body, occurred_on FROM portfolio_captures WHERE portfolio_id = ? AND piece_id IS NULL ORDER BY COALESCE(occurred_on, created_at), id");
        $u->execute([(int)$p['id']]);
        $unfiled = array_map(fn($c) => ['type' => $c['capture_type'], 'title' => $c['title'], 'body' => $c['body'], 'occurred_on' => $c['occurred_on']], $u->fetchAll());
        return Http::json($res, ['team_season_id' => (int)$ts['id'], 'award_target' => $p['award_target'], 'sections' => $sections, 'unfiled' => $unfiled]);
    }
}
