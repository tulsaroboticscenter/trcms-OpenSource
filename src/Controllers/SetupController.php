<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Installer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * First-run setup wizard (open-source Phase 1, web half).
 * Runs AFTER bin/install.php has bootstrapped the database. The single System
 * Administrator signs in and is routed here (setup_complete=false) to finish
 * configuration: organization identity, email (SMTP — reuses EmailSettings),
 * modules (reuses ModulesController), and cron instructions. Finishing flips
 * system_config 'install'.setup_complete to true.
 *
 * All endpoints require admin.config; on an established install (no 'install'
 * marker, e.g. TRC) setup is considered complete and the wizard never appears.
 */
final class SetupController
{
    private const ORG_CATEGORY = 'org_identity';

    /** Cron jobs a typical install wants running, with recommended schedules. */
    private const CRON_JOBS = [
        ['script' => 'run_compliance_reminders.php',      'when' => '0 7 * * *',   'desc' => 'YPT / background-check renewal reminders (daily)'],
        ['script' => 'run_pastdue_reminders.php',         'when' => '0 8 * * *',   'desc' => 'Past-due payment reminders (daily)'],
        ['script' => 'run_payment_reminders.php',         'when' => '0 8 * * *',   'desc' => 'Payment-plan installment reminders (daily)'],
        ['script' => 'run_fdp_reminders.php',             'when' => '0 8 * * *',   'desc' => 'FDP interview/progress reminders (daily)'],
        ['script' => 'run_visitor_followup_reminders.php','when' => '0 9 * * *',   'desc' => 'Visitor follow-up reminders (daily)'],
        ['script' => 'send_incident_notifications.php',   'when' => '*/5 * * * *', 'desc' => 'Incident-report notifications (every 5 minutes)'],
        ['script' => 'run_auto_checkout.php',             'when' => '55 23 * * *', 'desc' => 'Auto check-out anyone left checked in (nightly)'],
        ['script' => 'run_report_schedules.php',          'when' => '0 6 * * *',   'desc' => 'Scheduled report emails (daily)'],
    ];

    /** GET /public/branding — org name/wordmark/logo for the UI. No auth (used pre-login). */
    public static function publicBranding(Request $req, Response $res): Response
    {
        return Http::json($res, \App\Core\Branding::resolve(Database::pdo()));
    }

    private static function requireAdmin(PDO $pdo, Request $req): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::memberCan($pdo, $m, 'admin.config', 'write')) return null;
        return $m;
    }

    private static function org(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category=?");
        $s->execute([self::ORG_CATEGORY]);
        $v = $s->fetchColumn();
        $d = $v ? json_decode((string)$v, true) : [];
        return is_array($d) ? $d : [];
    }

    /** GET /setup/status — what the wizard needs to render. */
    public static function status(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = self::requireAdmin($pdo, $req);
        if (!$m) return Http::error($res, 'Access denied', 403);
        $inst = new Installer();
        $state = $inst->installState($pdo) ?? ['setup_complete' => true];
        return Http::json($res, [
            'bootstrapped'   => $inst->isInstalled($pdo),
            'setup_complete' => (bool)($state['setup_complete'] ?? true),
            'org'            => self::org($pdo),
            'app_url'        => \App\Core\Config::get('APP_URL', ''),
        ]);
    }

    /** PUT /setup/org — organization identity. */
    public static function saveOrg(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = self::requireAdmin($pdo, $req);
        if (!$m) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $org = [
            'name'       => trim((string)($d['name'] ?? '')),
            'short_name' => mb_substr(trim((string)($d['short_name'] ?? '')), 0, 12),
            'tagline'    => mb_substr(trim((string)($d['tagline'] ?? '')), 0, 60),
            'website'    => trim((string)($d['website'] ?? '')),
            'logo_url'   => trim((string)($d['logo_url'] ?? '')),
            'timezone'   => trim((string)($d['timezone'] ?? 'America/Chicago')),
            'contact_email' => trim((string)($d['contact_email'] ?? '')),
        ];
        if ($org['name'] === '') return Http::error($res, 'Organization name is required.', 422);
        $json = json_encode($org);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category=?");
        $ex->execute([self::ORG_CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values`=?, updated_at=NOW() WHERE id=?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category,label,`values`) VALUES (?, 'Organization', ?)")->execute([self::ORG_CATEGORY, $json]);
        }
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'update', null, ['category' => self::ORG_CATEGORY]);
        return Http::json($res, ['ok' => true, 'org' => $org]);
    }

    /** GET /setup/cron — copy-paste crontab lines for this install. */
    public static function cron(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = self::requireAdmin($pdo, $req);
        if (!$m) return Http::error($res, 'Access denied', 403);
        $php  = PHP_BINARY ?: 'php';
        $root = dirname(__DIR__, 2);
        $jobs = [];
        foreach (self::CRON_JOBS as $j) {
            $script = $root . '/bin/' . $j['script'];
            $jobs[] = [
                'description' => $j['desc'],
                'schedule'    => $j['when'],
                'command'     => sprintf('%s %s', $php, $script),
                'crontab'     => sprintf('%s %s %s', $j['when'], $php, $script),
            ];
        }
        return Http::json($res, ['php_binary' => $php, 'project_root' => $root, 'jobs' => $jobs]);
    }

    /** POST /setup/complete — finish the wizard. */
    public static function complete(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = self::requireAdmin($pdo, $req);
        if (!$m) return Http::error($res, 'Access denied', 403);
        $inst = new Installer();
        if (!$inst->isInstalled($pdo)) return Http::error($res, 'Not bootstrapped.', 409);
        $inst->markSetupComplete($pdo);
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'update', null, ['category' => Installer::INSTALL_CATEGORY, 'setup_complete' => true]);
        return Http::json($res, ['ok' => true]);
    }
}
