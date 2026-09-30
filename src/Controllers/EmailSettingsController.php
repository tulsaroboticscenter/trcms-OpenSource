<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Admin email (SMTP) settings + test send. Settings persist in system_config
 * (category 'smtp') and take precedence over .env; the password is write-only
 * (never returned to the client).
 */
final class EmailSettingsController
{
    private const FIELDS = ['host', 'port', 'user', 'encryption', 'from', 'purchasing_email', 'visitor_email', 'signup_email', 'reservation_email', 'resource_email', 'payment_email', 'checkout_email', 'volunteer_email', 'scholarship_email', 'cc_address', 'cc_enabled'];

    /**
     * The always-CC address for Communications sends when the toggle is on (#172) —
     * e.g. info@ so a copy of every member/visitor email is retained. Null when off,
     * unset, or not a valid email.
     */
    public static function alwaysCc(PDO $pdo): ?string
    {
        $db = self::dbValues($pdo);
        if (empty($db['cc_enabled'])) return null;
        $addr = trim((string)($db['cc_address'] ?? ''));
        return ($addr !== '' && filter_var($addr, FILTER_VALIDATE_EMAIL)) ? $addr : null;
    }

    /** Where "payment received" notifications go. Configurable in Admin → Email Settings. */
    public const DEFAULT_PAYMENT_EMAIL = 'info@tulsaroboticscenter.org';
    public static function paymentEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['payment_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_PAYMENT_EMAIL;
    }

    /** Where BOM order-request notifications go. Configurable in Admin → Email Settings. */
    public const DEFAULT_PURCHASING_EMAIL = 'info@tulsaroboticscenter.org';
    public static function purchasingEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['purchasing_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_PURCHASING_EMAIL;
    }

    /** Where new-visitor signup notifications go. Configurable in Admin → Email Settings. */
    public const DEFAULT_VISITOR_EMAIL = 'info@tulsaroboticscenter.org';
    public static function visitorEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['visitor_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_VISITOR_EMAIL;
    }

    /**
     * Where the self-service signup notice goes — the record of what the system changed
     * when a visitor converted themselves from a join link. Configurable in
     * Admin → Email Settings. Falls back to the new-visitor address, since the same
     * mailbox usually wants both.
     */
    public static function signupEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['signup_email'] ?? ''));
        return $v !== '' ? $v : self::visitorEmail($pdo);
    }

    /**
     * Where the nightly auto-checkout report goes — the list of people the midnight
     * cron had to check out. Configurable in Admin → Email Settings; falls back to the
     * org info box.
     */
    public const DEFAULT_CHECKOUT_EMAIL = 'info@tulsaroboticscenter.org';
    public static function checkoutEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['checkout_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_CHECKOUT_EMAIL;
    }

    /** Where "new volunteer sign-up" notices go — someone created a volunteer account from
     *  the public form. Configurable in Admin → Email Settings; defaults to the org info box. */
    public const DEFAULT_VOLUNTEER_EMAIL = 'info@tulsaroboticscenter.org';
    public static function volunteerEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['volunteer_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_VOLUNTEER_EMAIL;
    }

    /** Where "new scholarship application" notices go — a family submitted a confidential
     *  scholarship application during registration. Configurable in Admin → Email Settings;
     *  defaults to the org info box. Point it at the admin-team distribution address. */
    public const DEFAULT_SCHOLARSHIP_EMAIL = 'info@tulsaroboticscenter.org';
    public static function scholarshipEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['scholarship_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_SCHOLARSHIP_EMAIL;
    }

    /** Where new room/resource reservation requests go. Configurable in Admin → Email Settings. */
    public const DEFAULT_RESERVATION_EMAIL = 'info@tulsaroboticscenter.org';
    public static function reservationEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['reservation_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_RESERVATION_EMAIL;
    }

    /** Where resource access-requests go — ONE mailbox, not every manager. Configurable in Admin → Email Settings. */
    public const DEFAULT_RESOURCE_EMAIL = 'info@tulsaroboticscenter.org';
    public static function resourceEmail(PDO $pdo): string
    {
        $v = trim((string)(self::dbValues($pdo)['resource_email'] ?? ''));
        return $v !== '' ? $v : self::DEFAULT_RESOURCE_EMAIL;
    }

    private static function dbValues(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'smtp'");
        $s->execute();
        $r = $s->fetch();
        if ($r && $r['values']) { $j = json_decode((string)$r['values'], true); if (is_array($j)) return $j; }
        return [];
    }

    /** GET /admin/email-settings — effective config (password masked) + where each value comes from. */
    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'read')) return Http::error($res, 'Access denied', 403);
        $db = self::dbValues($pdo);
        $envMap = ['host' => 'SMTP_HOST', 'port' => 'SMTP_PORT', 'user' => 'SMTP_USER', 'encryption' => 'SMTP_ENCRYPTION', 'from' => 'SMTP_FROM', 'purchasing_email' => 'PURCHASING_EMAIL', 'visitor_email' => 'VISITOR_EMAIL', 'signup_email' => 'SIGNUP_EMAIL', 'reservation_email' => 'RESERVATION_EMAIL', 'resource_email' => 'RESOURCE_EMAIL', 'payment_email' => 'PAYMENT_EMAIL', 'checkout_email' => 'CHECKOUT_EMAIL', 'volunteer_email' => 'VOLUNTEER_EMAIL', 'scholarship_email' => 'SCHOLARSHIP_EMAIL'];
        $out = []; $source = [];
        foreach (self::FIELDS as $k) {
            // A field with no env mapping is database-only. This used to be a hard
            // lookup, so adding a key to FIELDS without adding it here made the whole
            // endpoint fail — which left the settings page blank and made a Save
            // overwrite every setting with empty strings.
            $env = $envMap[$k] ?? null;
            if (isset($db[$k]) && (string)$db[$k] !== '') { $out[$k] = (string)$db[$k]; $source[$k] = 'database'; }
            else {
                $val = $env !== null ? (string)(Config::get($env, '') ?? '') : '';
                $out[$k] = $val; $source[$k] = $val !== '' ? 'env' : 'unset';
            }
        }
        // Notification addresses default to the org info box until set.
        if ($out['purchasing_email'] === '') { $out['purchasing_email'] = self::DEFAULT_PURCHASING_EMAIL; $source['purchasing_email'] = 'default'; }
        if ($out['visitor_email'] === '') { $out['visitor_email'] = self::DEFAULT_VISITOR_EMAIL; $source['visitor_email'] = 'default'; }
        if ($out['reservation_email'] === '') { $out['reservation_email'] = self::DEFAULT_RESERVATION_EMAIL; $source['reservation_email'] = 'default'; }
        if ($out['resource_email'] === '') { $out['resource_email'] = self::DEFAULT_RESOURCE_EMAIL; $source['resource_email'] = 'default'; }
        if ($out['payment_email'] === '') { $out['payment_email'] = self::DEFAULT_PAYMENT_EMAIL; $source['payment_email'] = 'default'; }
        if (($out['checkout_email'] ?? '') === '') { $out['checkout_email'] = self::DEFAULT_CHECKOUT_EMAIL; $source['checkout_email'] = 'default'; }
        if (($out['volunteer_email'] ?? '') === '') { $out['volunteer_email'] = self::DEFAULT_VOLUNTEER_EMAIL; $source['volunteer_email'] = 'default'; }
        if (($out['scholarship_email'] ?? '') === '') { $out['scholarship_email'] = self::DEFAULT_SCHOLARSHIP_EMAIL; $source['scholarship_email'] = 'default'; }
        $hasPassDb = isset($db['pass']) && (string)$db['pass'] !== '';
        $hasPassEnv = (string)(Config::get('SMTP_PASS', '') ?? '') !== '';
        $out['has_password'] = $hasPassDb || $hasPassEnv;
        $out['password_source'] = $hasPassDb ? 'database' : ($hasPassEnv ? 'env' : 'unset');
        $out['source'] = $source;
        $out['configured'] = $out['host'] !== '';
        return Http::json($res, $out);
    }

    /** PUT /admin/email-settings — save SMTP settings to system_config (admin). */
    public static function update(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $existing = self::dbValues($pdo);

        $vals = [];
        foreach (self::FIELDS as $k) {
            if (array_key_exists($k, $d)) $vals[$k] = trim((string)$d[$k]);
            elseif (isset($existing[$k])) $vals[$k] = $existing[$k];
        }
        if (isset($vals['encryption']) && !in_array(strtolower($vals['encryption']), ['tls', 'ssl', 'none', ''], true)) {
            return Http::error($res, 'Encryption must be tls, ssl, or none.', 422);
        }

        // Refuse a save that blanks the entire server config at once while one is
        // currently set. That is the signature of a form that never loaded its
        // values, not of someone editing a field -- and it silently stops ALL email
        // until a human notices. Deliberately clearing SMTP is still possible with
        // confirm_wipe, which the UI does not send by accident.
        $wouldWipe = trim((string)($vals['host'] ?? '')) === ''
            && trim((string)($vals['from'] ?? '')) === ''
            && trim((string)($vals['port'] ?? '')) === ''
            && trim((string)($vals['user'] ?? '')) === '';
        $hadHost = trim((string)($existing['host'] ?? '')) !== '';
        if ($wouldWipe && $hadHost && empty($d['confirm_wipe'])) {
            return Http::error($res,
                'That would clear the whole SMTP configuration (host, port, username and From are all empty), '
                . 'which stops every email the system sends. If the form looks blank, reload the page before saving. '
                . 'To clear it deliberately, resend with confirm_wipe.', 422);
        }
        // Password is write-only: set when a non-empty value is sent, cleared when
        // clear_password is true, otherwise left as-is.
        if (!empty($d['clear_password'])) $vals['pass'] = '';
        elseif (array_key_exists('pass', $d) && trim((string)$d['pass']) !== '') $vals['pass'] = trim((string)$d['pass']);
        elseif (isset($existing['pass'])) $vals['pass'] = $existing['pass'];

        $json = json_encode($vals);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = 'smtp'"); $ex->execute();
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES ('smtp', 'Email (SMTP) Settings', ?)")->execute([$json]);
        }
        // Audit without the password.
        $audit = $vals; unset($audit['pass']); $audit['has_password'] = ($vals['pass'] ?? '') !== '';
        Audit::write($pdo, (int)$cur['id'], 'system_config', null, 'update', null, ['category' => 'smtp'] + $audit);
        return self::get($req, $res);
    }

    /** POST /admin/email-settings/test — send a test email and report the result. */
    public static function test(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $to = trim((string)($d['to'] ?? $cur['email'] ?? ''));
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'Enter a valid email address to send the test to.', 422);
        $org = (string)(Config::get('ORG_NAME', 'Tulsa Robotics Center') ?? 'Tulsa Robotics Center');
        $when = gmdate('Y-m-d H:i:s') . ' UTC';
        $html = "<p>This is a test email from <strong>" . htmlspecialchars($org) . "</strong>'s management system.</p>"
              . "<p>If you received this, outbound email is working. Sent at $when.</p>";
        $ok = Mailer::send($to, 'TRCMS test email', $html);
        return Http::json($res, ['ok' => $ok, 'to' => $to, 'error' => $ok ? null : (Mailer::lastError() ?? 'Unknown error.')]);
    }
}
