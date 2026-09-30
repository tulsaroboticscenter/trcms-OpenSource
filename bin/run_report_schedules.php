<?php
declare(strict_types=1);

/**
 * Scheduled-report runner (Reports Engine Phase 3). Finds due report_schedules,
 * runs each report AS ITS OWNER (their field-tier + row-scope entitlement),
 * renders an HTML table + CSV, emails it to the recipients, and advances
 * next_run_at. Idempotent per due-window; safe to run every 15-30 min.
 *
 * Usage (Plesk cron, e.g. every 15 min):
 *   php bin/run_report_schedules.php
 *   php bin/run_report_schedules.php --dry     # log what would send, send nothing
 */

use App\Core\Config;
use App\Core\Database;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Reports\DatasetRegistry;
use App\Reports\ReportAccess;
use App\Reports\ReportCompiler;
use App\Reports\ReportSchedule;
use App\Reports\SimplePdf;

require __DIR__ . '/../vendor/autoload.php';
Config::load(dirname(__DIR__));

$dry = in_array('--dry', $argv, true);
$pdo = Database::pdo();
$now = date('Y-m-d H:i:s');

$due = $pdo->prepare(
    "SELECT s.*, d.name AS report_name, d.dataset, d.definition
       FROM report_schedules s
       JOIN report_definitions d ON d.id = s.definition_id
      WHERE s.is_active = 1 AND s.next_run_at IS NOT NULL AND s.next_run_at <= ?"
);
$due->execute([$now]);
$schedules = $due->fetchAll(PDO::FETCH_ASSOC);

if (!$schedules) { fwrite(STDOUT, "No schedules due.\n"); exit(0); }

$sent = 0; $failed = 0;
foreach ($schedules as $s) {
    $sid = (int)$s['id'];
    try {
        $ds = DatasetRegistry::get($s['dataset']);
        $owner = null;
        if ($s['owner_id'] !== null) {
            $om = $pdo->prepare("SELECT * FROM members WHERE id = ?");
            $om->execute([(int)$s['owner_id']]);
            $owner = $om->fetch(PDO::FETCH_ASSOC) ?: null;
        }
        if (!$ds || !$owner) { advance($pdo, $s, $dry); fwrite(STDOUT, "  [skip] #$sid: dataset or owner missing\n"); continue; }

        $access = ReportAccess::forViewer($pdo, $owner, $s['dataset']);
        $definition = json_decode($s['definition'], true) ?: [];
        $params = $s['params'] ? (json_decode($s['params'], true) ?: []) : [];
        $ctx = [
            'scope' => $access['row_scope'],
            'maxTier' => $access['max_field_tier'],
            'memberId' => (int)$s['owner_id'],
            'params' => $params,
            'teamSeasonId' => $s['team_season_id'] !== null ? (int)$s['team_season_id'] : null,
        ];
        $r = (new ReportCompiler())->compile($ds, $definition, $ctx);
        $st = $pdo->prepare($r['sql']);
        $st->execute($r['params']);
        $rows = $st->fetchAll(PDO::FETCH_NUM);

        $recipients = array_filter(array_map('trim', explode(',', (string)$s['recipient_emails'])));
        // Security backstop (independent of the create-time check): a report carries member
        // PII, so deliver ONLY to active members entitled to view reports — never an arbitrary
        // address that may have been grandfathered in before recipients were validated.
        $skipped = [];
        $recipients = array_values(array_filter($recipients, function ($to) use ($pdo, &$skipped) {
            if (recipientEligible($pdo, $to)) return true;
            $skipped[] = $to; return false;
        }));
        if ($skipped) fwrite(STDERR, "  [skip-recipient] #$sid: not report-eligible members, not sent: " . implode(', ', $skipped) . "\n");
        if (!$recipients) { advance($pdo, $s, $dry); fwrite(STDOUT, "  [skip] #$sid: no eligible recipients\n"); continue; }

        if ($dry) {
            fwrite(STDOUT, "  [dry] #$sid \"{$s['report_name']}\" -> " . implode(', ', $recipients) . " ({" . count($rows) . "} rows)\n");
        } else {
            $html = renderHtml($s['report_name'], $r['columns'], $rows, ReportSchedule::describe($s));
            $base = slug($s['report_name']);
            $csvPath = writeTemp(csvBytes($r['columns'], $rows), 'csv');
            $pdfPath = writeTemp(SimplePdf::render('TRCMS Report: ' . $s['report_name'], $r['columns'], $rows), 'pdf');
            $attach = [
                ['path' => $pdfPath, 'name' => $base . '.pdf'],
                ['path' => $csvPath, 'name' => $base . '.csv'],
            ];
            $subject = 'TRCMS Report: ' . $s['report_name'];
            foreach ($recipients as $to) {
                if (Mailer::send($to, $subject, $html, null, null, null, $attach)) $sent++;
                else { $failed++; fwrite(STDERR, "  [mail-fail] #$sid -> $to: " . (Mailer::lastError() ?? 'unknown') . "\n"); }
            }
            @unlink($csvPath);
            @unlink($pdfPath);
            try {
                $pdo->prepare("INSERT INTO report_runs (definition_id, member_id, dataset, format, row_count, created_at) VALUES (?,?,?,?,?,NOW())")
                    ->execute([(int)$s['definition_id'], (int)$s['owner_id'], $s['dataset'], 'email', count($rows)]);
            } catch (\Throwable $e) { /* best-effort */ }
            fwrite(STDOUT, "  [sent] #$sid \"{$s['report_name']}\" -> " . count($recipients) . " recipient(s), " . count($rows) . " rows\n");
        }
        advance($pdo, $s, $dry);
    } catch (\Throwable $e) {
        $failed++;
        fwrite(STDERR, "  [error] schedule #$sid: " . $e->getMessage() . "\n");
        advance($pdo, $s, $dry);   // still advance so a broken report doesn't wedge the queue
    }
}

fwrite(STDOUT, sprintf("\nProcessed %d due schedule(s); %d email(s) sent, %d failure(s).%s\n",
    count($schedules), $sent, $failed, $dry ? " (dry run)" : ""));
exit(0);

// ---- helpers ---------------------------------------------------------------

/** True only if the email belongs to an active member holding reports.view. */
function recipientEligible(PDO $pdo, string $email): bool
{
    $s = $pdo->prepare("SELECT * FROM members WHERE LOWER(email) = LOWER(?) AND is_active = 1 LIMIT 1");
    $s->execute([$email]);
    $m = $s->fetch(PDO::FETCH_ASSOC);
    return $m && Permissions::memberCan($pdo, $m, 'reports.view', 'read');
}

function advance(PDO $pdo, array $s, bool $dry): void
{
    if ($dry) return;
    $next = date('Y-m-d H:i:s', ReportSchedule::nextRun(
        $s['cadence'],
        $s['day_of_week'] !== null ? (int)$s['day_of_week'] : null,
        $s['day_of_month'] !== null ? (int)$s['day_of_month'] : null,
        (int)$s['send_hour']
    ));
    $pdo->prepare("UPDATE report_schedules SET last_run_at = NOW(), next_run_at = ? WHERE id = ?")
        ->execute([$next, (int)$s['id']]);
}

function renderHtml(string $name, array $columns, array $rows, string $cadence): string
{
    $esc = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES);
    $head = '';
    foreach ($columns as $c) $head .= '<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #1a3a5c;font-size:12px;color:#1a3a5c;">' . $esc($c['label']) . '</th>';
    $body = '';
    foreach (array_slice($rows, 0, 200) as $row) {
        $tds = '';
        foreach ($row as $v) $tds .= '<td style="padding:5px 10px;border-bottom:1px solid #eee;font-size:13px;">' . ($v === null ? '&mdash;' : $esc($v)) . '</td>';
        $body .= "<tr>$tds</tr>";
    }
    $more = count($rows) > 200 ? '<p style="color:#888;font-size:12px;">Showing first 200 of ' . count($rows) . ' rows — see the attached CSV for all.</p>' : '';
    $inner = '<p style="color:#666;">Your scheduled report (' . $esc($cadence) . ') — ' . count($rows) . ' row' . (count($rows) === 1 ? '' : 's') . '.</p>'
        . '<table style="border-collapse:collapse;width:100%;"><thead><tr>' . $head . '</tr></thead><tbody>' . $body . '</tbody></table>' . $more;
    return Mailer::wrap($name, $inner);
}

function csvBytes(array $columns, array $rows): string
{
    $fh = fopen('php://temp', 'r+');
    fputcsv($fh, array_map(fn($c) => $c['label'], $columns));
    foreach ($rows as $row) fputcsv($fh, array_map(fn($v) => $v ?? '', $row));
    rewind($fh);
    $out = stream_get_contents($fh);
    fclose($fh);
    return (string)$out;
}

function writeTemp(string $bytes, string $ext): string
{
    $path = tempnam(sys_get_temp_dir(), 'rpt');
    if ($path === false) $path = sys_get_temp_dir() . '/rpt_' . uniqid();
    file_put_contents($path, $bytes);
    return $path;
}

function slug(string $s): string
{
    return strtolower(preg_replace('/[^a-zA-Z0-9]+/', '_', $s)) ?: 'report';
}
