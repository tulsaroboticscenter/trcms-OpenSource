<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use App\Reports\ReportSchedule;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * CRUD for emailed report schedules. A schedule belongs to a saved report; only
 * the report's owner (or a report manager) may manage its schedules. The cron
 * runner (bin/run_report_schedules.php) does the actual sending.
 */
final class ReportScheduleController
{
    /** GET /api/v1/reports/engine/schedules — schedules the viewer owns. */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $st = $pdo->prepare(
            "SELECT s.*, d.name AS report_name FROM report_schedules s
               JOIN report_definitions d ON d.id = s.definition_id
              WHERE s.owner_id = ? ORDER BY s.created_at DESC"
        );
        $st->execute([(int)$cur['id']]);
        return Http::json($res, ['schedules' => array_map([self::class, 'shape'], $st->fetchAll())]);
    }

    /** GET /api/v1/reports/engine/{id}/schedules — schedules for one report. */
    public static function forReport(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        if (!self::ownedReport($pdo, (int)$args['id'], (int)$cur['id'])) return Http::error($res, 'Report not found', 404);
        $st = $pdo->prepare("SELECT * FROM report_schedules WHERE definition_id = ? ORDER BY created_at DESC");
        $st->execute([(int)$args['id']]);
        return Http::json($res, ['schedules' => array_map([self::class, 'shape'], $st->fetchAll())]);
    }

    /** POST /api/v1/reports/engine/{id}/schedules — create a schedule. */
    public static function create(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $repId = (int)$args['id'];
        if (!self::ownedReport($pdo, $repId, (int)$cur['id'])) return Http::error($res, 'Report not found', 404);

        $b = (array)($req->getParsedBody() ?? []);
        $emails = self::cleanEmails($b['recipient_emails'] ?? '');
        if (!$emails) return Http::error($res, 'At least one valid recipient email is required.', 422);
        if ($bad = self::ineligibleRecipients($pdo, $emails)) {
            return Http::error($res, 'Reports may only be emailed to TRC members who can view reports. These recipients aren\'t eligible: ' . implode(', ', $bad), 422);
        }

        [$cadence, $dow, $dom, $hour] = self::cadenceFields($b);
        $teamId = isset($b['team_season_id']) && $b['team_season_id'] !== '' ? (int)$b['team_season_id'] : null;
        $params = isset($b['params']) && is_array($b['params']) ? json_encode($b['params']) : null;
        $next = date('Y-m-d H:i:s', ReportSchedule::nextRun($cadence, $dow, $dom, $hour));

        $st = $pdo->prepare(
            "INSERT INTO report_schedules
               (definition_id, owner_id, cadence, day_of_week, day_of_month, send_hour, recipient_emails, team_season_id, params, is_active, next_run_at, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,1,?,NOW())"
        );
        $st->execute([$repId, (int)$cur['id'], $cadence, $dow, $dom, $hour, implode(',', $emails), $teamId, $params, $next]);
        $schedId = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$cur['id'], 'report_schedules', $schedId, 'create', null, ['definition_id' => $repId]);
        return Http::json($res, ['id' => $schedId, 'next_run_at' => $next], 201);
    }

    /** PUT /api/v1/reports/engine/schedules/{sid} — update. */
    public static function update(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $s = self::ownedSchedule($pdo, (int)$args['sid'], (int)$cur['id']);
        if (!$s) return Http::error($res, 'Schedule not found', 404);

        $b = (array)($req->getParsedBody() ?? []);
        $emails = array_key_exists('recipient_emails', $b) ? self::cleanEmails($b['recipient_emails']) : explode(',', $s['recipient_emails']);
        if (!$emails) return Http::error($res, 'At least one valid recipient email is required.', 422);
        if (array_key_exists('recipient_emails', $b) && ($bad = self::ineligibleRecipients($pdo, $emails))) {
            return Http::error($res, 'Reports may only be emailed to TRC members who can view reports. These recipients aren\'t eligible: ' . implode(', ', $bad), 422);
        }
        [$cadence, $dow, $dom, $hour] = self::cadenceFields($b + $s);
        $teamId = array_key_exists('team_season_id', $b) ? ($b['team_season_id'] !== '' && $b['team_season_id'] !== null ? (int)$b['team_season_id'] : null) : ($s['team_season_id'] !== null ? (int)$s['team_season_id'] : null);
        $active = array_key_exists('is_active', $b) ? (int)(bool)$b['is_active'] : (int)$s['is_active'];
        $params = array_key_exists('params', $b) ? (is_array($b['params']) ? json_encode($b['params']) : null) : $s['params'];
        $next = date('Y-m-d H:i:s', ReportSchedule::nextRun($cadence, $dow, $dom, $hour));

        $pdo->prepare(
            "UPDATE report_schedules SET cadence=?, day_of_week=?, day_of_month=?, send_hour=?, recipient_emails=?, team_season_id=?, params=?, is_active=?, next_run_at=? WHERE id=?"
        )->execute([$cadence, $dow, $dom, $hour, implode(',', $emails), $teamId, $params, $active, $next, (int)$s['id']]);
        Audit::write($pdo, (int)$cur['id'], 'report_schedules', (int)$args['sid'], 'update');
        return Http::json($res, ['ok' => true, 'next_run_at' => $next]);
    }

    /** DELETE /api/v1/reports/engine/schedules/{sid}. */
    public static function delete(Request $req, Response $res, array $args): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        if (!Permissions::memberCan($pdo, $cur, 'reports.view', 'read')) return Http::error($res, 'You do not have permission to view reports', 403);
        $s = self::ownedSchedule($pdo, (int)$args['sid'], (int)$cur['id']);
        if (!$s) return Http::error($res, 'Schedule not found', 404);
        $pdo->prepare("DELETE FROM report_schedules WHERE id = ?")->execute([(int)$s['id']]);
        Audit::write($pdo, (int)$cur['id'], 'report_schedules', (int)$s['id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ---- helpers ----------------------------------------------------------

    private static function ownedReport(PDO $pdo, int $repId, int $memberId): bool
    {
        $st = $pdo->prepare("SELECT 1 FROM report_definitions WHERE id = ? AND owner_id = ?");
        $st->execute([$repId, $memberId]);
        return (bool)$st->fetchColumn();
    }

    private static function ownedSchedule(PDO $pdo, int $sid, int $memberId): ?array
    {
        $st = $pdo->prepare("SELECT * FROM report_schedules WHERE id = ? AND owner_id = ?");
        $st->execute([$sid, $memberId]);
        return $st->fetch() ?: null;
    }

    /** @return array{0:string,1:?int,2:?int,3:int} */
    private static function cadenceFields(array $b): array
    {
        $cadence = in_array($b['cadence'] ?? '', ['daily', 'weekly', 'monthly'], true) ? $b['cadence'] : 'weekly';
        $dow = $cadence === 'weekly' ? (int)($b['day_of_week'] ?? 1) : null;
        $dom = $cadence === 'monthly' ? max(1, min(28, (int)($b['day_of_month'] ?? 1))) : null;
        $hour = max(0, min(23, (int)($b['send_hour'] ?? 6)));
        return [$cadence, $dow, $dom, $hour];
    }

    /** @return string[] valid, de-duped email addresses */
    private static function cleanEmails($raw): array
    {
        $parts = is_array($raw) ? $raw : preg_split('/[,;\s]+/', (string)$raw);
        $out = [];
        foreach ($parts as $p) {
            $p = trim((string)$p);
            if ($p !== '' && filter_var($p, FILTER_VALIDATE_EMAIL)) $out[strtolower($p)] = $p;
        }
        return array_values($out);
    }

    /**
     * Recipient emails that DON'T belong to an active member holding reports.view.
     * A scheduled report carries member PII, so it may only be delivered to people who
     * are already entitled to view reports — never an arbitrary external address.
     */
    private static function ineligibleRecipients(\PDO $pdo, array $emails): array
    {
        $bad = [];
        foreach ($emails as $e) {
            $s = $pdo->prepare("SELECT * FROM members WHERE LOWER(email) = LOWER(?) AND is_active = 1 LIMIT 1");
            $s->execute([$e]);
            $m = $s->fetch(\PDO::FETCH_ASSOC);
            if (!$m || !Permissions::memberCan($pdo, $m, 'reports.view', 'read')) $bad[] = $e;
        }
        return $bad;
    }

    private static function shape(array $s): array
    {
        $s['is_active'] = (bool)$s['is_active'];
        $s['summary'] = ReportSchedule::describe($s);
        if (isset($s['params']) && is_string($s['params'])) $s['params'] = json_decode($s['params'], true);
        return $s;
    }
}
