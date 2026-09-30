<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Reports\DatasetRegistry;
use App\Reports\ReportAccess;
use App\Reports\ReportCompiler;
use App\Reports\ReportException;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Reports Engine API — the declarative report builder/runner. Users compose
 * reports over curated datasets; the compiler enforces field-tier, row-scope,
 * and whitelist safety. Reports run as the viewer.
 */
final class ReportEngineController
{
    /** GET /api/v1/reports/engine/datasets — datasets + fields the viewer may use. */
    public static function datasets(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);

        $out = [];
        foreach (DatasetRegistry::all() as $key => $ds) {
            $access = ReportAccess::forViewer($pdo, $cur, $key);
            $out[] = [
                'meta' => $ds->meta($access['max_field_tier']),
                'access' => [
                    'capability' => $access['capability'],
                    'row_scope' => $access['row_scope'],
                    'max_field_tier' => $access['max_field_tier'],
                    'can_build' => ReportAccess::canBuild($access),
                ],
            ];
        }
        return Http::json($res, ['datasets' => $out]);
    }

    /** POST /api/v1/reports/engine/preview — compile+run an ad-hoc definition. */
    public static function preview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);

        $body = (array)($req->getParsedBody() ?? []);
        $datasetKey = (string)($body['dataset'] ?? '');
        $definition = (array)($body['definition'] ?? []);
        $runtime = (array)($body['params'] ?? []);

        $ds = DatasetRegistry::get($datasetKey);
        if (!$ds) return Http::error($res, 'Unknown dataset', 404);
        $access = ReportAccess::forViewer($pdo, $cur, $datasetKey);
        if (!ReportAccess::canBuild($access)) return Http::error($res, 'You do not have permission to build reports on this dataset', 403);

        $teamId = isset($body['team_season_id']) ? (int)$body['team_season_id'] : null;
        return self::runDefinition($res, $pdo, $ds, $definition, $access, (int)$cur['id'], $runtime, null, $teamId);
    }

    /** GET /api/v1/reports/engine — list saved reports visible to the viewer. */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);

        $st = $pdo->prepare(
            "SELECT id, name, description, dataset, folder_id, owner_id, visibility, created_at, updated_at
               FROM report_definitions
              WHERE visibility = 'org' OR owner_id = ?
              ORDER BY name"
        );
        $st->execute([(int)$cur['id']]);
        return Http::json($res, ['reports' => $st->fetchAll()]);
    }

    /** POST /api/v1/reports/engine — save a new report. */
    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);

        $body = (array)($req->getParsedBody() ?? []);
        $datasetKey = (string)($body['dataset'] ?? '');
        $ds = DatasetRegistry::get($datasetKey);
        if (!$ds) return Http::error($res, 'Unknown dataset', 404);
        $access = ReportAccess::forViewer($pdo, $cur, $datasetKey);
        if (!ReportAccess::canBuild($access)) return Http::error($res, 'You do not have permission to build reports on this dataset', 403);

        $name = trim((string)($body['name'] ?? ''));
        if ($name === '') return Http::error($res, 'A report name is required', 422);
        $definition = (array)($body['definition'] ?? []);
        // Validate the definition compiles for this viewer before saving.
        try { (new ReportCompiler())->compile($ds, $definition, self::ctx($access, (int)$cur['id'], [])); }
        catch (ReportException $e) { return Http::error($res, $e->getMessage(), 422); }

        $visibility = in_array(($body['visibility'] ?? 'private'), ['private', 'roles', 'org'], true) ? $body['visibility'] : 'private';
        $st = $pdo->prepare(
            "INSERT INTO report_definitions (name, description, dataset, definition, folder_id, owner_id, visibility, created_at)
             VALUES (?,?,?,?,?,?,?,NOW())"
        );
        $st->execute([
            $name, (string)($body['description'] ?? '') ?: null, $datasetKey,
            json_encode($definition), $body['folder_id'] ?? null, (int)$cur['id'], $visibility,
        ]);
        $newId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'report_definitions', $newId, 'create', null, ['name' => $name, 'dataset' => $datasetKey, 'visibility' => $visibility]);
        return Http::json($res, ['id' => $newId], 201);
    }

    /** GET /api/v1/reports/engine/{id} — fetch a saved report definition. */
    public static function get(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $rep = self::loadVisible($pdo, (int)$args['id'], (int)$cur['id']);
        if (!$rep) return Http::error($res, 'Report not found', 404);
        $rep['definition'] = json_decode($rep['definition'], true);
        return Http::json($res, $rep);
    }

    /** PUT /api/v1/reports/engine/{id} — update a report (owner or manager). */
    public static function update(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $rep = self::loadVisible($pdo, (int)$args['id'], (int)$cur['id']);
        if (!$rep) return Http::error($res, 'Report not found', 404);
        $access = ReportAccess::forViewer($pdo, $cur, $rep['dataset']);
        if ((int)$rep['owner_id'] !== (int)$cur['id'] && !ReportAccess::canManage($access)) {
            return Http::error($res, 'Only the owner or a report manager can edit this report', 403);
        }
        $body = (array)($req->getParsedBody() ?? []);
        $ds = DatasetRegistry::get($rep['dataset']);
        $definition = array_key_exists('definition', $body) ? (array)$body['definition'] : json_decode($rep['definition'], true);
        try { (new ReportCompiler())->compile($ds, $definition, self::ctx($access, (int)$cur['id'], [])); }
        catch (ReportException $e) { return Http::error($res, $e->getMessage(), 422); }

        $st = $pdo->prepare("UPDATE report_definitions SET name=?, description=?, definition=?, visibility=?, updated_at=NOW() WHERE id=?");
        $st->execute([
            trim((string)($body['name'] ?? $rep['name'])),
            (string)($body['description'] ?? $rep['description']) ?: null,
            json_encode($definition),
            in_array(($body['visibility'] ?? $rep['visibility']), ['private', 'roles', 'org'], true) ? $body['visibility'] : $rep['visibility'],
            (int)$args['id'],
        ]);
        Audit::write($pdo, (int)$cur['id'], 'report_definitions', (int)$args['id'], 'update');
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /api/v1/reports/engine/{id} — delete (owner or manager). */
    public static function delete(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $rep = self::loadVisible($pdo, (int)$args['id'], (int)$cur['id']);
        if (!$rep) return Http::error($res, 'Report not found', 404);
        $access = ReportAccess::forViewer($pdo, $cur, $rep['dataset']);
        if ((int)$rep['owner_id'] !== (int)$cur['id'] && !ReportAccess::canManage($access)) {
            return Http::error($res, 'Only the owner or a report manager can delete this report', 403);
        }
        $pdo->prepare("DELETE FROM report_definitions WHERE id=?")->execute([(int)$args['id']]);
        Audit::write($pdo, (int)$cur['id'], 'report_definitions', (int)$args['id'], 'delete', ['name' => $rep['name'] ?? null], null);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /api/v1/reports/engine/{id}/run — run a saved report as the viewer. */
    public static function run(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $rep = self::loadVisible($pdo, (int)$args['id'], (int)$cur['id']);
        if (!$rep) return Http::error($res, 'Report not found', 404);
        $ds = DatasetRegistry::get($rep['dataset']);
        if (!$ds) return Http::error($res, 'Report dataset unavailable', 500);
        $access = ReportAccess::forViewer($pdo, $cur, $rep['dataset']);
        // Running needs at least 'run' — every authenticated member has that.
        $body = (array)($req->getParsedBody() ?? []);
        $runtime = (array)($body['params'] ?? []);
        $teamId = isset($body['team_season_id']) ? (int)$body['team_season_id'] : null;
        return self::runDefinition($res, $pdo, $ds, json_decode($rep['definition'], true), $access, (int)$cur['id'], $runtime, (int)$rep['id'], $teamId);
    }

    // ---- permissions matrix (admin) ---------------------------------------

    private static function requireAdmin(PDO $pdo, Request $req): ?array
    {
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return null;
        if (!\App\Core\Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return null;
        return $cur;
    }

    /** GET /api/v1/reports/engine/permissions — matrix + roles + datasets. */
    public static function permissionsList(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::requireAdmin($pdo, $req)) return Http::error($res, 'Admins only', 403);

        $roles = $pdo->query("SELECT name FROM system_roles WHERE is_active = true ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
        $datasets = [];
        foreach (DatasetRegistry::all() as $key => $ds) $datasets[] = ['key' => $key, 'label' => $ds->label()];
        $rows = $pdo->query("SELECT id, role_name, dataset, capability, row_scope, max_field_tier FROM report_permissions ORDER BY role_name, dataset")->fetchAll();

        return Http::json($res, ['roles' => $roles, 'datasets' => $datasets, 'rows' => $rows]);
    }

    /** PUT /api/v1/reports/engine/permissions — upsert one role×dataset rule. */
    public static function permissionsSave(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $admin = self::requireAdmin($pdo, $req);
        if (!$admin) return Http::error($res, 'Admins only', 403);

        $b = (array)($req->getParsedBody() ?? []);
        $role = trim((string)($b['role_name'] ?? ''));
        $dataset = (string)($b['dataset'] ?? '');
        if ($role === '' || !DatasetRegistry::get($dataset)) return Http::error($res, 'role_name and a valid dataset are required', 422);
        $cap = in_array($b['capability'] ?? '', ['run', 'build_scoped', 'build_full', 'publish', 'manage'], true) ? $b['capability'] : 'run';
        $scope = in_array($b['row_scope'] ?? '', ['all', 'own_teams', 'self', 'none'], true) ? $b['row_scope'] : 'own_teams';
        $tier = in_array($b['max_field_tier'] ?? '', ['public', 'internal', 'pii', 'financial'], true) ? $b['max_field_tier'] : 'internal';

        $st = $pdo->prepare(
            "INSERT INTO report_permissions (role_name, dataset, capability, row_scope, max_field_tier, created_at)
             VALUES (?,?,?,?,?,NOW())
             ON DUPLICATE KEY UPDATE capability=VALUES(capability), row_scope=VALUES(row_scope), max_field_tier=VALUES(max_field_tier)"
        );
        $st->execute([$role, $dataset, $cap, $scope, $tier]);
        Audit::write($pdo, (int)$admin['id'], 'report_permissions', null, 'update', null,
            ['role' => $role, 'dataset' => $dataset, 'capability' => $cap, 'row_scope' => $scope, 'max_field_tier' => $tier]);
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /api/v1/reports/engine/permissions/{id} — revert to preset default. */
    public static function permissionsDelete(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $admin = self::requireAdmin($pdo, $req);
        if (!$admin) return Http::error($res, 'Admins only', 403);
        $pdo->prepare("DELETE FROM report_permissions WHERE id = ?")->execute([(int)$args['id']]);
        Audit::write($pdo, (int)$admin['id'], 'report_permissions', (int)$args['id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ---- helpers ----------------------------------------------------------

    private static function runDefinition(Response $res, PDO $pdo, $ds, array $definition, array $access, int $memberId, array $runtime, ?int $defId, ?int $teamSeasonId = null): Response
    {
        try {
            $r = (new ReportCompiler())->compile($ds, $definition, self::ctx($access, $memberId, $runtime, $teamSeasonId));
        } catch (ReportException $e) {
            return Http::error($res, $e->getMessage(), 422);
        }
        try {
            $st = $pdo->prepare($r['sql']);
            $st->execute($r['params']);
            $rows = $st->fetchAll(PDO::FETCH_NUM);
        } catch (\Throwable $e) {
            return Http::error($res, 'The report could not be run.', 500);
        }
        // Log the run.
        try {
            $pdo->prepare("INSERT INTO report_runs (definition_id, member_id, dataset, format, row_count, created_at) VALUES (?,?,?,?,?,NOW())")
                ->execute([$defId, $memberId, $ds->key(), 'screen', count($rows)]);
        } catch (\Throwable $e) { /* audit is best-effort */ }

        return Http::json($res, [
            'columns' => $r['columns'],
            'rows' => $rows,
            'row_count' => count($rows),
        ]);
    }

    private static function ctx(array $access, int $memberId, array $runtime, ?int $teamSeasonId = null): array
    {
        return [
            'scope' => $access['row_scope'],
            'maxTier' => $access['max_field_tier'],
            'memberId' => $memberId,
            'params' => $runtime,
            'teamSeasonId' => $teamSeasonId,
        ];
    }

    private static function loadVisible(PDO $pdo, int $id, int $memberId): ?array
    {
        $st = $pdo->prepare("SELECT * FROM report_definitions WHERE id = ? AND (visibility='org' OR owner_id = ?)");
        $st->execute([$id, $memberId]);
        $r = $st->fetch();
        return $r ?: null;
    }
}
