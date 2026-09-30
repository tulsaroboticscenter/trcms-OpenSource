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
 * Team Financials — QuickBooks import (feedback #89).
 *
 * Imports a QuickBooks report export (e.g. Profit & Loss by Class) so each
 * team's real-world actuals can be shown next to the budget tracked in TRCMS.
 * The flow is mapping-driven and format-agnostic:
 *   1. preview()      — upload a CSV; we return its columns + sample rows + a
 *                       best-guess of which column is the team label / income /
 *                       expense, so the admin can confirm the mapping.
 *   2. createImport() — re-upload with the chosen column map; we parse every row
 *                       into finance_lines and remember any new segment labels.
 *   3. setSegmentMap()— map each export label (Class/Customer/Account) to a TRC
 *                       team-season (or org-wide / ignore); remembered for next time.
 *   4. byTeam()       — roll the latest import up per team for display.
 */
final class FinanceController
{
    private static function canView(PDO $pdo, ?array $m): bool
    { return $m !== null && Permissions::memberCan($pdo, $m, 'finance.view', 'read'); }
    private static function canManage(PDO $pdo, ?array $m): bool
    { return $m !== null && Permissions::memberCan($pdo, $m, 'finance.manage', 'write'); }

    /** Parse a QuickBooks-style money cell: "$1,234.56", "(1,234.56)", "-12.00", "". */
    private static function money(?string $s): float
    {
        $s = trim((string)$s);
        if ($s === '') return 0.0;
        $neg = false;
        if (preg_match('/^\((.*)\)$/', $s, $m)) { $neg = true; $s = $m[1]; }
        if (str_starts_with($s, '-')) { $neg = true; $s = substr($s, 1); }
        $s = preg_replace('/[^0-9.]/', '', $s);
        $v = $s === '' ? 0.0 : (float)$s;
        return $neg ? -$v : $v;
    }

    /** Read uploaded CSV into [headers, rows[]] (rows are assoc by header). */
    private static function readCsv(Request $req, Response $res): array
    {
        $files = $req->getUploadedFiles();
        $file = $files['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return [null, 'No file uploaded'];
        $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)$file->getStream());
        $fh = fopen('php://temp', 'r+'); fwrite($fh, $text); rewind($fh);
        $headers = null; $rows = [];
        while (($cells = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            // Skip fully blank lines (QuickBooks pads reports with them).
            if (count(array_filter($cells, fn($c) => trim((string)$c) !== '')) === 0) continue;
            if ($headers === null) { $headers = array_map(fn($h) => trim((string)$h), $cells); continue; }
            $row = [];
            foreach ($headers as $i => $h) { if ($h === '') continue; $row[$h] = $cells[$i] ?? ''; }
            $rows[] = $row;
        }
        fclose($fh);
        if ($headers === null) return [null, 'The file appears to be empty.'];
        return [['headers' => array_values(array_filter($headers, fn($h) => $h !== '')), 'rows' => $rows], null];
    }

    private static function guessColumn(array $headers, array $needles): ?string
    {
        foreach ($headers as $h) {
            $lh = strtolower($h);
            foreach ($needles as $n) if (str_contains($lh, $n)) return $h;
        }
        return null;
    }

    // POST /finance/preview — inspect an uploaded CSV without saving.
    public static function preview(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canManage($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        [$data, $err] = self::readCsv($req, $res);
        if ($err) return Http::error($res, $err, 400);
        $headers = $data['headers'];
        return Http::json($res, [
            'headers' => $headers,
            'sample_rows' => array_slice($data['rows'], 0, 15),
            'row_count' => count($data['rows']),
            'guessed' => [
                'segment' => self::guessColumn($headers, ['class', 'customer', 'project', 'segment', 'team', 'name']),
                'account' => self::guessColumn($headers, ['account', 'category', 'memo', 'description']),
                'income'  => self::guessColumn($headers, ['income', 'revenue', 'credit', 'deposit']),
                'expense' => self::guessColumn($headers, ['expense', 'debit', 'spent', 'withdrawal']),
                'amount'  => self::guessColumn($headers, ['amount', 'total', 'balance', 'net']),
            ],
        ]);
    }

    // POST /finance/imports — parse + persist with the chosen column map.
    public static function createImport(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        [$data, $err] = self::readCsv($req, $res);
        if ($err) return Http::error($res, $err, 400);

        $b = (array)$req->getParsedBody();
        $map = json_decode((string)($b['column_map'] ?? '{}'), true) ?: [];
        $segCol = (string)($map['segment'] ?? '');
        if ($segCol === '') return Http::error($res, 'Choose which column holds the team/class label.', 422);
        $acctCol = (string)($map['account'] ?? '');
        $incCol = (string)($map['income'] ?? '');
        $expCol = (string)($map['expense'] ?? '');
        $amtCol = (string)($map['amount'] ?? '');
        if ($incCol === '' && $expCol === '' && $amtCol === '') {
            return Http::error($res, 'Choose an income/expense column, or a single amount column.', 422);
        }

        $pdo->beginTransaction();
        try {
            $ins = $pdo->prepare("INSERT INTO finance_imports (source, filename, label, as_of_date, period_start, period_end, segment_kind, created_by_id, notes)
                                  VALUES ('quickbooks', ?, ?, ?, ?, ?, ?, ?, ?)");
            $ins->execute([
                substr((string)(($req->getUploadedFiles()['file'] ?? null)?->getClientFilename() ?? ''), 0, 255),
                trim((string)($b['label'] ?? '')) ?: null,
                ($b['as_of_date'] ?? '') ?: null,
                ($b['period_start'] ?? '') ?: null,
                ($b['period_end'] ?? '') ?: null,
                trim((string)($b['segment_kind'] ?? '')) ?: null,
                (int)$cur['id'],
                trim((string)($b['notes'] ?? '')) ?: null,
            ]);
            $importId = (int)$pdo->lastInsertId();

            $lineIns = $pdo->prepare("INSERT INTO finance_lines (import_id, segment_label, account, income, expense) VALUES (?, ?, ?, ?, ?)");
            $labels = []; $kept = 0;
            foreach ($data['rows'] as $row) {
                $seg = trim((string)($row[$segCol] ?? ''));
                if ($seg === '') continue; // QuickBooks subtotal/blank rows carry no class
                $income = 0.0; $expense = 0.0;
                if ($amtCol !== '') {
                    $amt = self::money($row[$amtCol] ?? '');
                    if ($amt >= 0) $income = $amt; else $expense = -$amt;
                }
                if ($incCol !== '') $income += self::money($row[$incCol] ?? '');
                if ($expCol !== '') $expense += abs(self::money($row[$expCol] ?? ''));
                if ($income == 0.0 && $expense == 0.0) continue;
                $lineIns->execute([$importId, substr($seg, 0, 200), $acctCol !== '' ? substr(trim((string)($row[$acctCol] ?? '')), 0, 200) : null, $income, $expense]);
                $labels[$seg] = true; $kept++;
            }

            // Remember any segment labels we haven't seen before (unmapped by default).
            $seg2map = $pdo->prepare("INSERT IGNORE INTO finance_segment_map (segment_label, team_season_id, scope) VALUES (?, NULL, 'team')");
            foreach (array_keys($labels) as $lbl) $seg2map->execute([substr($lbl, 0, 200)]);

            Audit::write($pdo, (int)$cur['id'], 'finance_imports', $importId, 'finance.import', null, ['lines' => $kept, 'labels' => count($labels)]);
            $pdo->commit();
            return Http::json($res, ['ok' => true, 'import_id' => $importId, 'lines' => $kept, 'segments' => count($labels)], 201);
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Import failed: ' . $e->getMessage(), 500);
        }
    }

    // GET /finance/imports — list past imports (newest first).
    public static function listImports(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canView($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query(
            "SELECT fi.*, m.first_name, m.last_name,
                    (SELECT COUNT(*) FROM finance_lines fl WHERE fl.import_id = fi.id) AS line_count,
                    (SELECT COALESCE(SUM(income),0) FROM finance_lines fl WHERE fl.import_id = fi.id) AS total_income,
                    (SELECT COALESCE(SUM(expense),0) FROM finance_lines fl WHERE fl.import_id = fi.id) AS total_expense
             FROM finance_imports fi LEFT JOIN members m ON m.id = fi.created_by_id
             ORDER BY fi.id DESC"
        )->fetchAll();
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'filename' => $r['filename'], 'label' => $r['label'],
            'as_of_date' => $r['as_of_date'], 'period_start' => $r['period_start'], 'period_end' => $r['period_end'],
            'segment_kind' => $r['segment_kind'], 'created_at' => $r['created_at'],
            'created_by_name' => $r['first_name'] ? trim("{$r['first_name']} {$r['last_name']}") : null,
            'line_count' => (int)$r['line_count'],
            'total_income' => (float)$r['total_income'], 'total_expense' => (float)$r['total_expense'],
            'total_net' => (float)$r['total_income'] - (float)$r['total_expense'],
        ], $rows));
    }

    // DELETE /finance/imports/{id}
    public static function deleteImport(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['import_id'];
        $pdo->prepare("DELETE FROM finance_imports WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'finance_imports', $id, 'finance.import_delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** Resolve the import to use: explicit ?import_id, else the most recent. */
    private static function resolveImportId(PDO $pdo, array $q): int
    {
        if (!empty($q['import_id'])) return (int)$q['import_id'];
        return (int)($pdo->query("SELECT id FROM finance_imports ORDER BY id DESC LIMIT 1")->fetchColumn() ?: 0);
    }

    // GET /finance/segments — distinct labels from an import + their current mapping
    //                         + the team-season options, with a suggested match.
    public static function segments(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canManage($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $importId = self::resolveImportId($pdo, $q);

        $teams = $pdo->query(
            "SELECT id, team_name, season FROM team_seasons ORDER BY season DESC, team_name"
        )->fetchAll();
        $teamOpts = array_map(fn($t) => ['team_season_id' => (int)$t['id'], 'label' => trim("{$t['team_name']} ({$t['season']})")], $teams);

        $segStmt = $pdo->prepare(
            "SELECT fl.segment_label,
                    COALESCE(SUM(fl.income),0) AS income, COALESCE(SUM(fl.expense),0) AS expense,
                    fsm.team_season_id, fsm.scope
             FROM finance_lines fl
             LEFT JOIN finance_segment_map fsm ON fsm.segment_label = fl.segment_label
             WHERE fl.import_id = ?
             GROUP BY fl.segment_label, fsm.team_season_id, fsm.scope
             ORDER BY fl.segment_label"
        );
        $segStmt->execute([$importId]);
        $segments = array_map(function ($r) use ($teams) {
            // Suggest a team whose name appears in (or contains) the label.
            $suggest = null; $ll = strtolower($r['segment_label']);
            foreach ($teams as $t) {
                $tn = strtolower((string)$t['team_name']);
                if ($tn !== '' && (str_contains($ll, $tn) || str_contains($tn, $ll))) { $suggest = (int)$t['id']; break; }
            }
            return [
                'segment_label' => $r['segment_label'],
                'income' => (float)$r['income'], 'expense' => (float)$r['expense'],
                'net' => (float)$r['income'] - (float)$r['expense'],
                'team_season_id' => $r['team_season_id'] !== null ? (int)$r['team_season_id'] : null,
                'scope' => $r['scope'] ?? 'team',
                'suggested_team_season_id' => $suggest,
            ];
        }, $segStmt->fetchAll());

        return Http::json($res, ['import_id' => $importId, 'teams' => $teamOpts, 'segments' => $segments]);
    }

    // PUT /finance/segments — upsert the label→team mapping. Body: { maps: [{segment_label, team_season_id, scope}] }
    public static function setSegmentMap(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $b = (array)$req->getParsedBody();
        $maps = is_array($b['maps'] ?? null) ? $b['maps'] : [];
        $up = $pdo->prepare(
            "INSERT INTO finance_segment_map (segment_label, team_season_id, scope) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE team_season_id = VALUES(team_season_id), scope = VALUES(scope)"
        );
        $n = 0;
        foreach ($maps as $m) {
            $label = trim((string)($m['segment_label'] ?? ''));
            if ($label === '') continue;
            $scope = in_array($m['scope'] ?? '', ['team', 'org', 'ignore'], true) ? $m['scope'] : 'team';
            $tsid = ($scope === 'team' && !empty($m['team_season_id'])) ? (int)$m['team_season_id'] : null;
            $up->execute([substr($label, 0, 200), $tsid, $scope]);
            $n++;
        }
        Audit::write($pdo, (int)$cur['id'], 'finance_segment_map', null, 'finance.map', null, ['count' => $n]);
        return Http::json($res, ['ok' => true, 'updated' => $n]);
    }

    // GET /finance/by-team — roll an import up per team-season (+ unmapped bucket).
    public static function byTeam(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::canView($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $importId = self::resolveImportId($pdo, $q);
        if ($importId === 0) return Http::json($res, ['import_id' => 0, 'teams' => [], 'org' => null, 'unmapped' => []]);

        $stmt = $pdo->prepare(
            "SELECT fl.segment_label, fsm.scope, fsm.team_season_id, ts.team_name, ts.season,
                    SUM(fl.income) AS income, SUM(fl.expense) AS expense
             FROM finance_lines fl
             LEFT JOIN finance_segment_map fsm ON fsm.segment_label = fl.segment_label
             LEFT JOIN team_seasons ts ON ts.id = fsm.team_season_id
             WHERE fl.import_id = ?
             GROUP BY fl.segment_label, fsm.scope, fsm.team_season_id, ts.team_name, ts.season"
        );
        $stmt->execute([$importId]);

        $teams = []; $org = ['income' => 0.0, 'expense' => 0.0, 'labels' => []]; $unmapped = [];
        foreach ($stmt->fetchAll() as $r) {
            $inc = (float)$r['income']; $exp = (float)$r['expense'];
            $scope = $r['scope'] ?? null;
            if ($scope === 'ignore') continue;
            if ($scope === 'org') { $org['income'] += $inc; $org['expense'] += $exp; $org['labels'][] = $r['segment_label']; continue; }
            if ($r['team_season_id']) {
                $id = (int)$r['team_season_id'];
                if (!isset($teams[$id])) $teams[$id] = ['team_season_id' => $id, 'team_name' => $r['team_name'], 'season' => $r['season'], 'income' => 0.0, 'expense' => 0.0, 'labels' => []];
                $teams[$id]['income'] += $inc; $teams[$id]['expense'] += $exp; $teams[$id]['labels'][] = $r['segment_label'];
            } else {
                $unmapped[] = ['segment_label' => $r['segment_label'], 'income' => $inc, 'expense' => $exp, 'net' => $inc - $exp];
            }
        }
        $finishTeam = function ($t) { $t['net'] = $t['income'] - $t['expense']; return $t; };
        return Http::json($res, [
            'import_id' => $importId,
            'teams' => array_map($finishTeam, array_values($teams)),
            'org' => $org['labels'] ? $finishTeam($org) : null,
            'unmapped' => $unmapped,
        ]);
    }
}
