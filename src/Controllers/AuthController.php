<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\GeoIp;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use App\Core\RateLimiter;
use App\Core\Totp;
use App\Core\EnrollmentService;
use App\Core\ComplianceService;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Port of app/core/auth.py routes: POST /token and GET /me.
 * (Security-policy lockout/geo from the Python app is a later port; the happy
 * path mirrors create_access_token + the /me payload shape.)
 */
final class AuthController
{
    /**
     * Security #10: fixed bcrypt hash used to run password_verify on the unknown-username
     * path, so a login for a non-existent user costs roughly the same as one for a real user.
     * Otherwise bcrypt only ran when the member existed, making response time a username oracle.
     */
    private const DUMMY_HASH = '$2y$12$dvUHG952Lg4oYhq.Qep4VuHg0P8ilEVd2So/.FpGu7QEIFYddmfMa';

    /** Security #8: per-IP login throttle (catches password spraying the per-username lockout misses). */
    private const IP_FAIL_THRESHOLD = 30;
    private const IP_FAIL_WINDOW_MIN = 15;

    /** True if this IP has had too many FAILED sign-ins recently (across all usernames). */
    private static function ipLoginThrottled(PDO $pdo, ?string $ip): bool
    {
        if ($ip === null || $ip === '') return false;
        try {
            $w = self::IP_FAIL_WINDOW_MIN;
            $s = $pdo->prepare(
                "SELECT COUNT(*) FROM login_attempts
                  WHERE ip_address = ? AND success = 0 AND created_at >= (NOW() - INTERVAL $w MINUTE)");
            $s->execute([$ip]);
            return (int)$s->fetchColumn() >= self::IP_FAIL_THRESHOLD;
        } catch (\Throwable $e) {
            return false;   // fail open — never let throttling break login
        }
    }

    /** Best-effort client IP (first hop of X-Forwarded-For, else REMOTE_ADDR). */
    /** Delegates to the shared helper so there is one implementation. */
    private static function clientIp(Request $request): string
    {
        return Http::clientIp($request) ?? '';
    }

    /** Record a login attempt (success or failure) in login_attempts (Security log). */
    private static function recordLogin(PDO $pdo, Request $request, string $username, ?int $memberId, bool $success, ?string $reason): void
    {
        try {
            $ip = self::clientIp($request);
            $ua = $request->getHeaderLine('User-Agent');
            $country = GeoIp::country($ip);   // null until a GeoIP database is configured
            $pdo->prepare(
                "INSERT INTO login_attempts (username, member_id, ip_address, user_agent, country, success, reason, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())"
            )->execute([
                substr($username, 0, 150), $memberId, $ip, substr($ua, 0, 400), $country,
                $success ? 1 : 0, $reason,
            ]);
        } catch (\Throwable $e) {
            // Never let logging break login.
            error_log('[TRCMS login log] ' . $e->getMessage());
        }
    }

    /** Effective lockout/security policy (system_config 'security_settings' merged over defaults). */
    private static function securityPolicy(PDO $pdo): array
    {
        $defaults = ['lockout_enabled' => true, 'lockout_threshold' => 5,
            'lockout_window_minutes' => 15, 'lockout_duration_minutes' => 15,
            'two_factor_enabled' => false,
            'geo_block_enabled' => false, 'allowed_countries' => ['US', 'CA']];
        try {
            $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'security_settings'");
            $s->execute(); $r = $s->fetch();
            if ($r && $r['values']) { $v = json_decode($r['values'], true); if (is_array($v)) return array_merge($defaults, $v); }
        } catch (\Throwable $e) { /* fall back to defaults */ }
        return $defaults;
    }

    /**
     * Lockout state for a username, based on failed login_attempts since the last success.
     * Returns [locked(bool), failCount(int), retryAfter(?string 'Y-m-d H:i:s')].
     * Account locks once failures since the last successful login reach the threshold
     * (counted within the window); the lock clears `duration` minutes after the last failure.
     */
    private static function lockState(PDO $pdo, array $policy, string $username, ?string $ip = null): array
    {
        if (empty($policy['lockout_enabled']) || $username === '') return [false, 0, null];
        $threshold = max(1, (int)$policy['lockout_threshold']);
        $window    = max(1, (int)$policy['lockout_window_minutes']);
        $duration  = max(1, (int)$policy['lockout_duration_minutes']);
        try {
            // Security #15: lockout is keyed on (username, IP), not username alone. Otherwise an
            // attacker could lock ANY account (including every admin) from anywhere with 5 bad
            // guesses — a denial-of-service. Now a lockout only blocks the offending IP; the real
            // user signing in from their own IP is unaffected. (IP is #7-trusted; per-IP spray
            // across accounts is separately capped by #8.) A NULL/empty IP falls back to
            // username-only so lockout still functions when the IP can't be determined.
            $ipClause = ($ip !== null && $ip !== '') ? "AND ip_address = ?" : "";
            $s = $pdo->prepare(
                "SELECT COUNT(*) AS fails,
                        DATE_FORMAT(MAX(created_at) + INTERVAL $duration MINUTE, '%Y-%m-%d %H:%i:%s') AS retry_after,
                        ((MAX(created_at) + INTERVAL $duration MINUTE) > NOW()) AS still_active
                 FROM login_attempts
                 WHERE LOWER(username) = LOWER(?) AND success = 0 $ipClause
                   AND created_at >= (NOW() - INTERVAL $window MINUTE)
                   AND created_at > COALESCE((SELECT MAX(created_at) FROM login_attempts WHERE LOWER(username) = LOWER(?) AND success = 1), '1970-01-01')"
            );
            $params = [$username];
            if ($ipClause !== '') $params[] = $ip;
            $params[] = $username;
            $s->execute($params);
            $row = $s->fetch();
            $fails = (int)($row['fails'] ?? 0);
            if ($fails < $threshold || empty($row['retry_after'])) return [false, $fails, null];
            $locked = (int)$row['still_active'] === 1;
            return [$locked, $fails, $locked ? $row['retry_after'] : null];
        } catch (\Throwable $e) {
            return [false, 0, null]; // never let lockout logic break login
        }
    }

    public static function token(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $body = (array)$request->getParsedBody();
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $policy = self::securityPolicy($pdo);

        // Case-insensitive username match — independent of the DB column collation
        // (prod may use a case-sensitive collation), so users can sign in
        // regardless of how they capitalize their username.
        $stmt = $pdo->prepare("SELECT * FROM members WHERE LOWER(username) = LOWER(?) ORDER BY id LIMIT 1");
        $stmt->execute([$username]);
        $member = $stmt->fetch();
        $memberId = $member ? (int)$member['id'] : null;

        // Geo-restriction: block sign-ins from countries not on the allow-list. Fails OPEN on an
        // unknown location (no GeoIP database, private IP, or lookup error), so a missing database
        // never locks anyone out. Checked by location before credentials.
        $reqIp = self::clientIp($request);

        // Security #8: per-IP throttle BEFORE credential work — stops password spraying (one
        // password against many usernames, which never trips the per-username lockout).
        if (self::ipLoginThrottled($pdo, $reqIp)) {
            self::recordLogin($pdo, $request, $username, $memberId, false, 'IP throttled');
            return Http::error($response, 'Too many sign-in attempts from your network. Please wait a few minutes and try again.', 429);
        }

        $country = GeoIp::country($reqIp);
        if (GeoIp::isBlocked($country, (bool)($policy['geo_block_enabled'] ?? false), (array)($policy['allowed_countries'] ?? []))) {
            self::recordLogin($pdo, $request, $username, $memberId, false, 'Blocked location (' . $country . ')');
            Audit::write($pdo, null, 'login_attempts', $memberId, 'geo_block', null,
                ['username' => $username, 'country' => $country], null, self::clientIp($request));
            return Http::error($response, 'Sign-in from your location is not allowed.', 403);
        }

        // Reject (and log) if the account is currently locked out — before checking the password.
        [$locked, , $retryAfter] = self::lockState($pdo, $policy, $username, $reqIp);
        if ($locked) {
            self::recordLogin($pdo, $request, $username, $memberId, false, 'Account locked');
            // actor_id is NULL, not the target: whoever is submitting these is unknown
            // and is very likely NOT the account holder. Recording the victim as the
            // actor makes a brute-force attempt read as self-inflicted. The account is
            // in record_id / target_member_id.
            Audit::write($pdo, null, 'login_attempts', $memberId, 'lockout',
                null, ['username' => $username, 'target_member_id' => $memberId,
                       'retry_after' => $retryAfter, 'state' => 'blocked'], null, self::clientIp($request));
            return Http::error($response, 'Too many failed attempts. This account is temporarily locked. Please try again later.', 429);
        }

        if (!$member) {
            // Security #10: burn a bcrypt cycle so an unknown username takes about as long as a
            // known one — removes the response-timing oracle for harvesting valid usernames.
            password_verify($password, self::DUMMY_HASH);
            self::recordLogin($pdo, $request, $username, null, false, 'Unknown username');
            return Http::error($response, 'Incorrect username or password', 401);
        }
        if (!password_verify($password, $member['password_hash'])) {
            self::recordLogin($pdo, $request, $username, (int)$member['id'], false, 'Incorrect password');
            // Did this failure just trip the lockout threshold? If so, log the lockout event.
            [$nowLocked, $fails, $retry] = self::lockState($pdo, $policy, $username, $reqIp);
            if ($nowLocked) {
                Audit::write($pdo, null, 'login_attempts', (int)$member['id'], 'lockout',
                    null, ['username' => $username, 'target_member_id' => (int)$member['id'],
                           'failed_attempts' => $fails, 'retry_after' => $retry, 'state' => 'triggered'],
                    null, self::clientIp($request));
            }
            return Http::error($response, 'Incorrect username or password', 401);
        }
        if (!$member['is_active']) {
            self::recordLogin($pdo, $request, $username, (int)$member['id'], false, 'Account inactive');
            return Http::error($response, 'This account is inactive.', 403);
        }

        // ── Second factor (TOTP) ──────────────────────────────────────────────
        // If the feature is on and this user has 2FA enabled, require a valid code
        // (or a one-time backup code) before issuing a token. The password is
        // already verified at this point, so this is a genuine second factor.
        // Security #16: honour a member's OWN 2FA regardless of the org-wide flag. Previously the
        // global two_factor_enabled (default off) was checked FIRST, so a member who enrolled and
        // saw "2FA on" was not actually challenged unless an admin had flipped the global switch.
        if (!empty($member['totp_enabled']) && !empty($member['totp_secret'])) {
            $code = trim((string)($body['code'] ?? $body['totp_code'] ?? ''));
            if ($code === '') {
                return Http::json($response, ['two_factor_required' => true], 200);
            }
            $step = Totp::verifyGetStep((string)$member['totp_secret'], $code);
            $ok = false;
            if ($step !== null) {
                // Reject replay of the same or an earlier time-step (RFC 6238 §5.2).
                $lastStep = $member['totp_last_step'] !== null ? (int)$member['totp_last_step'] : null;
                if ($lastStep === null || $step > $lastStep) {
                    $pdo->prepare("UPDATE members SET totp_last_step = ? WHERE id = ?")->execute([$step, (int)$member['id']]);
                    $ok = true;
                }
            } elseif (self::consumeBackupCode($pdo, (int)$member['id'], $code)) {
                $ok = true;
            }
            if (!$ok) {
                self::recordLogin($pdo, $request, $username, (int)$member['id'], false, '2FA failed');
            // A failed second factor means someone HAS the password. That belongs in the
            // audit log, not only in login_attempts.
            Audit::write($pdo, null, 'login_attempts', (int)$member['id'], '2fa_failed',
                null, ['username' => $username, 'target_member_id' => (int)$member['id']], null, self::clientIp($request));
                return Http::json($response, ['two_factor_required' => true, 'error' => 'Invalid or already-used authentication code.'], 401);
            }
        }
        self::recordLogin($pdo, $request, $username, (int)$member['id'], true, null);

        $roles = self::roleNames($pdo, (int)$member['id']);
        // Sessions slide: while a member keeps using the app their token is renewed (see
        // Auth::refreshed + the refresh middleware), so an ACTIVE user is never logged out.
        // The `idle` window is how long they can be AWAY before the token lapses:
        //   - "Keep me logged in" → SESSION_REMEMBER_DAYS (default 3 days).
        //   - otherwise           → SESSION_IDLE_MINUTES (default 12 hours).
        // Station/kiosk accounts keep a long fixed token (no sliding).
        $remember = !empty($body['remember']);
        $tv = (int)($member['token_version'] ?? 0);   // security #3: session-revocation stamp
        if (!empty($member['is_kiosk'])) {
            $token = Auth::encode([
                'sub' => (string)$member['id'], 'roles' => $roles, 'type' => $member['member_type'], 'tv' => $tv,
            ], 365 * 24 * 3600);
        } else {
            $idle = $remember
                ? Config::int('SESSION_REMEMBER_DAYS', 3) * 86400
                : Config::int('SESSION_IDLE_MINUTES', 720) * 60;
            $token = Auth::encode([
                'sub' => (string)$member['id'], 'roles' => $roles, 'type' => $member['member_type'],
                'idle' => $idle, 'tv' => $tv,
            ], $idle);
        }

        return Http::json($response, [
            'access_token' => $token,
            'token_type'   => 'bearer',
            'member_id'    => (int)$member['id'],
            'roles'        => $roles,
        ]);
    }

    public static function me(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $member = Auth::currentMember($pdo, $request);
        if (!$member) {
            return Http::error($response, 'Invalid token', 401);
        }

        $perms = Permissions::resolve(
            $pdo,
            Permissions::effectiveRolesFor($pdo, $member),
            !empty($member['is_kiosk'])
        );

        return Http::json($response, [
            'id'             => (int)$member['id'],
            'member_number'  => $member['member_number'],
            'username'       => $member['username'],
            'first_name'     => $member['first_name'],
            'last_name'      => $member['last_name'],
            'member_type'    => $member['member_type'],
            'roles'          => self::roleNames($pdo, (int)$member['id']),
            'is_kiosk'       => (bool)$member['is_kiosk'],
            'photo_url'      => $member['photo_url'],
            'force_password_change' => (bool)$member['force_password_change'],
            'permissions'        => $perms['resources'],
            'module_permissions' => $perms['modules'],
            'team_ids'       => self::teamIds($pdo, (int)$member['id']),
            'group_names'    => self::groupNames($pdo, (int)$member['id']),
            'teams'          => self::currentTeams($pdo, (int)$member['id']),
            'enrollment_status'  => EnrollmentService::status($pdo, (int)$member['id']),
            'mentor_tc_status'   => $member['member_type'] === 'mentor'
                                        ? EnrollmentService::mentorTcStatus($pdo, (int)$member['id']) : null,
            'renewal_reminder'   => self::renewalReminder($pdo),
            'compliance_warning' => self::complianceWarning($pdo, $member),
            // Org-wide module enable/disable (open-source Phase 2). The SPA hides
            // nav/tiles/routes for modules in this (resolved) disabled set.
            'disabled_modules'   => \App\Core\Modules::disabledSet($pdo),
            // First-run setup (Phase 1). false only on a freshly bootstrapped install
            // that hasn't finished the wizard; absent 'install' marker (e.g. an
            // established org) => complete, so the wizard never appears.
            'setup_complete'     => (bool)(((new \App\Core\Installer())->installState($pdo)['setup_complete']) ?? true),
        ]);
    }

    /** POST /auth/change-password — self-service change (requires current password). */
    public static function changePassword(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $member = Auth::currentMember($pdo, $request);
        if (!$member) {
            return Http::error($response, 'Invalid token', 401);
        }
        $d = (array)$request->getParsedBody();
        $current = (string)($d['current_password'] ?? '');
        $new = (string)($d['new_password'] ?? '');
        if (!password_verify($current, $member['password_hash'])) {
            return Http::error($response, 'Current password is incorrect.', 400);
        }
        if ($err = Auth::passwordError($new)) {
            return Http::error($response, $err, 400);
        }
        if ($current === $new) {
            return Http::error($response, 'New password must be different from your current password.', 400);
        }
        $pdo->prepare("UPDATE members SET password_hash = ?, force_password_change = false WHERE id = ?")
            ->execute([password_hash($new, PASSWORD_BCRYPT), (int)$member['id']]);
        // Security #3: invalidate every previously issued token (logs out any attacker holding a
        // stolen token), then re-issue THIS session's token with the new version so the member who
        // just changed their password isn't bounced to the login screen. The SPA adopts the fresh
        // token from the X-Refresh-Token header (see api.ts).
        Auth::bumpTokenVersion($pdo, (int)$member['id']);
        $response = self::reissueCurrentSession($pdo, (int)$member['id'], $member['member_type'] ?? null, $response);
        Audit::write($pdo, (int)$member['id'], 'members', (int)$member['id'], 'password_change',
            null, ['method' => 'self_service'], null, self::clientIp($request));
        return Http::json($response, ['ok' => true, 'message' => 'Password changed successfully.']);
    }

    /**
     * WHERE fragment (+ bound args) that matches a typed email against a member's
     * own email, their ENABLED alternate emails, or a guardian email. Fixes
     * "forgot password/username did nothing" when a member enters an address that
     * isn't their primary email (a very common cause of non-delivery).
     */
    private static function emailMatchSql(string $email): array
    {
        $sql = "(LOWER(email) = ?"
             . " OR (alt_email1_enabled = 1 AND LOWER(alt_email1) = ?)"
             . " OR (alt_email2_enabled = 1 AND LOWER(alt_email2) = ?)"
             . " OR LOWER(guardian1_email) = ? OR LOWER(guardian2_email) = ?)";
        return [$sql, [$email, $email, $email, $email, $email]];
    }

    /** The member's enabled alternate emails as a comma list for CC (or null). */
    private static function altEmailCc(array $m): ?string
    {
        $out = [];
        if (!empty($m['alt_email1_enabled']) && !empty($m['alt_email1'])) $out[] = trim((string)$m['alt_email1']);
        if (!empty($m['alt_email2_enabled']) && !empty($m['alt_email2'])) $out[] = trim((string)$m['alt_email2']);
        return $out ? implode(', ', $out) : null;
    }

    /** POST /auth/forgot-password — email a time-limited reset link (anti-enumeration). */
    public static function forgotPassword(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $email = trim(strtolower((string)(((array)$request->getParsedBody())['email'] ?? '')));
        $generic = ['ok' => true, 'message' => 'If an account with that email exists, a password reset link has been sent.'];
        // Security #8: cap reset requests per IP (each can fan out to ~10 emails). Over the limit
        // we return the same generic response but send nothing — no email bomb, no info leak.
        if (RateLimiter::overLimit($pdo, $request, 'forgot_password', 5, 15)) {
            return Http::json($response, $generic);
        }
        if ($email !== '') {
            // Match own / enabled-alternate / guardian emails, and prefer accounts
            // whose OWN or alternate email matches (so a shared guardian email doesn't
            // resolve to a sibling). Send a reset for EVERY matching account so no
            // account is silently skipped when an address is shared across records.
            // Match on email OR username: people very often type their username into the
            // reset box, which silently matched nothing before and looked like "no email
            // ever arrives". A username hit still delivers to the account's email on file.
            [$match, $args] = self::emailMatchSql($email);
            $match = "($match OR LOWER(username) = ?)";
            $args[] = $email;
            $stmt = $pdo->prepare(
                "SELECT * FROM members WHERE $match
                 ORDER BY (LOWER(email) = ? OR (alt_email1_enabled = 1 AND LOWER(alt_email1) = ?)
                           OR (alt_email2_enabled = 1 AND LOWER(alt_email2) = ?)) DESC, id
                 LIMIT 10"
            );
            $stmt->execute(array_merge($args, [$email, $email, $email]));
            $members = $stmt->fetchAll();
            $devLinks = [];
            foreach ($members as $m) {
                $raw = bin2hex(random_bytes(32));
                $hash = hash('sha256', $raw);
                // invalidate any prior unused tokens, then issue a fresh 1-hour token
                $pdo->prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE member_id = ? AND used_at IS NULL")->execute([(int)$m['id']]);
                $pdo->prepare("INSERT INTO password_reset_tokens (member_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))")
                    ->execute([(int)$m['id'], $hash]);
                $link = rtrim((string)Config::get('APP_URL', ''), '/') . '/reset-password?token=' . $raw;
                $body = '<p>Hi ' . htmlspecialchars((string)($m['first_name'] ?? '')) . ',</p>'
                      . '<p>We received a request to reset your password. This link is valid for one hour:</p>'
                      // Inline styles (not a CSS class) so the button stays readable in
                      // mail clients that strip <style> blocks (Gmail app, Outlook, etc.).
                      . '<p><a href="' . htmlspecialchars($link) . '" style="display:inline-block;background:#1565c0;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Reset your password</a></p>'
                      . '<p style="font-size:12px;color:#667">Or paste this link into your browser: ' . htmlspecialchars($link) . '</p>'
                      . '<p>If you did not request this, you can safely ignore this email.</p>';
                // Deliver to the member's primary email (fallback: the address typed),
                // and CC any enabled alternate emails so it reaches them wherever they
                // read mail. Log a delivery failure so silent non-sends are visible.
                $to = (string)($m['email'] ?: $email);
                $sent = Mailer::send($to, 'Reset your password', Mailer::wrap('Password reset', $body), null, self::altEmailCc($m));
                if (!$sent) error_log('[TRCMS] password reset email failed for member ' . (int)$m['id'] . ': ' . (Mailer::lastError() ?? 'unknown'));
                Audit::write($pdo, (int)$m['id'], 'members', (int)$m['id'], 'password_reset_requested',
                    null, ['email' => $email, 'sent' => $sent, 'to' => $to], null, self::clientIp($request));
                $devLinks[] = $link;
            }
            if (Mailer::devMode() && $devLinks) $generic['dev_reset_links'] = $devLinks;   // dev-only convenience
        }
        return Http::json($response, $generic);
    }

    /** POST /auth/reset-password — set a new password using a reset token. */
    public static function resetWithToken(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $d = (array)$request->getParsedBody();
        $raw = (string)($d['token'] ?? '');
        $new = (string)($d['new_password'] ?? '');
        if ($raw === '') {
            return Http::error($response, 'This reset link is invalid or has expired. Please request a new one.', 400);
        }
        $stmt = $pdo->prepare("SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1");
        $stmt->execute([hash('sha256', $raw)]);
        $tok = $stmt->fetch();
        if (!$tok) {
            return Http::error($response, 'This reset link is invalid or has expired. Please request a new one.', 400);
        }
        if ($err = Auth::passwordError($new)) {
            return Http::error($response, $err, 400);
        }
        $pdo->prepare("UPDATE members SET password_hash = ?, force_password_change = false WHERE id = ?")
            ->execute([password_hash($new, PASSWORD_BCRYPT), (int)$tok['member_id']]);
        // Security #3: a reset means the account may be compromised — invalidate every existing
        // token for it. The user logs in fresh afterwards, so no re-issue here.
        Auth::bumpTokenVersion($pdo, (int)$tok['member_id']);
        $pdo->prepare("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?")->execute([(int)$tok['id']]);
        Audit::write($pdo, (int)$tok['member_id'], 'members', (int)$tok['member_id'], 'password_reset',
            null, ['method' => 'reset_token'], null, self::clientIp($request));
        return Http::json($response, ['ok' => true, 'message' => 'Your password has been reset. You can now log in.']);
    }

    /** POST /auth/forgot-username — email the username(s) on file (anti-enumeration). */
    public static function forgotUsername(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $email = trim(strtolower((string)(((array)$request->getParsedBody())['email'] ?? '')));
        $generic = ['ok' => true, 'message' => 'If an account with that email exists, the username has been sent to it.'];
        if ($email !== '') {
            [$match, $args] = self::emailMatchSql($email);
            $stmt = $pdo->prepare("SELECT username FROM members WHERE $match ORDER BY id");
            $stmt->execute($args);
            $names = array_column($stmt->fetchAll(), 'username');
            if ($names) {
                $body = '<p>Hi,</p><p>The username(s) associated with this email address:</p><ul>'
                      . implode('', array_map(fn($u) => '<li><b>' . htmlspecialchars($u) . '</b></li>', $names))
                      . '</ul><p>You can sign in at <a href="' . htmlspecialchars(rtrim((string)Config::get('APP_URL', ''), '/')) . '">the login page</a>.</p>';
                Mailer::send($email, 'Your username', Mailer::wrap('Username reminder', $body));
                if (Mailer::devMode()) $generic['dev_usernames'] = $names;   // dev-only convenience
            }
        }
        return Http::json($response, $generic);
    }

    /** GET /auth/me/preferences — the user's saved UI prefs (panel layouts, etc.). */
    public static function getPreferences(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $member = Auth::currentMember($pdo, $request);
        if (!$member) {
            return Http::error($response, 'Invalid token', 401);
        }
        $prefs = ($member['ui_preferences'] ?? null) ? json_decode($member['ui_preferences'], true) : [];
        return Http::json($response, (is_array($prefs) && $prefs) ? $prefs : new \stdClass());
    }

    /** PATCH /auth/me/preferences — shallow-merge the given keys into ui_preferences. */
    public static function updatePreferences(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        $member = Auth::currentMember($pdo, $request);
        if (!$member) {
            return Http::error($response, 'Invalid token', 401);
        }
        $data = (array)$request->getParsedBody();
        $current = ($member['ui_preferences'] ?? null) ? json_decode($member['ui_preferences'], true) : [];
        if (!is_array($current)) {
            $current = [];
        }
        $merged = array_merge($current, $data);
        $pdo->prepare("UPDATE members SET ui_preferences = ? WHERE id = ?")
            ->execute([json_encode($merged), (int)$member['id']]);
        return Http::json($response, $merged ?: new \stdClass());
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /** Mentor compliance warning for the dashboard (null if compliant/no warning). */
    private static function complianceWarning(\PDO $pdo, array $member)
    {
        if ($member['member_type'] !== 'mentor') return null;
        $cs = ComplianceService::memberComplianceStatus($pdo, (int)$member['id']);
        return ($cs['has_warning'] || !$cs['is_compliant']) ? $cs : null;
    }

    /** Admin-set renewal reminder banner (system_config category "renewal_reminder"). */
    private static function renewalReminder(\PDO $pdo)
    {
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'renewal_reminder'");
        $stmt->execute();
        $row = $stmt->fetch();
        if (!$row || !$row['values']) return null;
        $vals = json_decode($row['values'], true);
        if (!is_array($vals) || !isset($vals[0])) return null;
        $reminder = json_decode((string)$vals[0], true);
        return (is_array($reminder) && !empty($reminder['enabled'])) ? $reminder : null;
    }

    /**
     * Security #3: after bumping a member's own token_version (a self-service credential change),
     * re-issue their CURRENT session token with the fresh version and attach it as X-Refresh-Token,
     * so the member who just made the change isn't logged out. Reads token_version AFTER the bump.
     */
    private static function reissueCurrentSession(\PDO $pdo, int $memberId, ?string $memberType, Response $res): Response
    {
        $tvq = $pdo->prepare("SELECT token_version FROM members WHERE id = ?");
        $tvq->execute([$memberId]);
        $tv = (int)$tvq->fetchColumn();
        $idle = Config::int('SESSION_IDLE_MINUTES', 720) * 60;
        $fresh = Auth::encode([
            'sub' => (string)$memberId, 'roles' => self::roleNames($pdo, $memberId),
            'type' => $memberType, 'idle' => $idle, 'tv' => $tv,
        ], $idle);
        return $res->withHeader('X-Refresh-Token', $fresh);
    }

    private static function roleNames(\PDO $pdo, int $memberId): array
    {
        $stmt = $pdo->prepare(
            "SELECT sr.name FROM member_system_roles msr
             JOIN system_roles sr ON sr.id = msr.role_id
             WHERE msr.member_id = ? AND sr.is_active = true"
        );
        $stmt->execute([$memberId]);
        return array_column($stmt->fetchAll(), 'name');
    }

    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return $y . '-' . ($y + 1);
    }

    private static function teamIds(\PDO $pdo, int $memberId): array
    {
        $stmt = $pdo->prepare(
            "SELECT DISTINCT ts.team_id
             FROM team_member_assignments tma
             JOIN team_seasons ts ON ts.id = tma.team_season_id
             WHERE tma.member_id = ?
             ORDER BY ts.team_id"
        );
        $stmt->execute([$memberId]);
        return array_map('intval', array_column($stmt->fetchAll(), 'team_id'));
    }

    /** Names of the member groups this member belongs to — lets the UI gate group-scoped
     *  features (e.g. the TRCF Board meeting manager) by group NAME, stable across envs. */
    private static function groupNames(\PDO $pdo, int $memberId): array
    {
        $stmt = $pdo->prepare(
            "SELECT g.name FROM member_group_members gm
             JOIN member_groups g ON g.id = gm.group_id
             WHERE gm.member_id = ? ORDER BY g.name"
        );
        $stmt->execute([$memberId]);
        $names = array_values(array_column($stmt->fetchAll(), 'name'));
        // The auto-managed YLC group draws its members from youth_roles.ylc_member, NOT the
        // manual member_group_members table — so include it here, or a YLC youth is never
        // recognized as a YLC member (and gets no YLC nav entry / group access).
        $y = $pdo->prepare("SELECT 1 FROM youth_roles WHERE member_id = ? AND ylc_member = 1 LIMIT 1");
        $y->execute([$memberId]);
        if ($y->fetchColumn()) {
            $ylc = $pdo->query("SELECT name FROM member_groups WHERE source = 'ylc' LIMIT 1")->fetchColumn();
            if ($ylc && !in_array($ylc, $names, true)) $names[] = $ylc;
        }
        return $names;
    }

    private static function currentTeams(\PDO $pdo, int $memberId): array
    {
        $stmt = $pdo->prepare(
            "SELECT ts.id AS team_season_id, t.team_number, ts.team_name
             FROM team_member_assignments tma
             JOIN team_seasons ts ON ts.id = tma.team_season_id
             JOIN teams t ON t.id = ts.team_id
             WHERE tma.member_id = ? AND tma.status = 'active' AND ts.season = ?"
        );
        $stmt->execute([$memberId, self::currentSeason()]);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = [
                'team_season_id' => (int)$r['team_season_id'],
                'team_number'    => $r['team_number'],
                'team_name'      => $r['team_name'] ?: ('Team ' . $r['team_number']),
            ];
        }
        return $out;
    }

    // ── Two-factor authentication (TOTP) ─────────────────────────────────────

    /** GET /auth/2fa/status — is the feature on, and is this user enrolled? */
    public static function twoFactorStatus(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, [
            // Security #16: 2FA is a per-member opt-in and is always available to set up; a member's
            // own enrollment is honoured at login regardless of any org-wide flag.
            'feature_enabled' => true,
            'enabled' => (bool)($m['totp_enabled'] ?? false),
        ]);
    }

    /** POST /auth/2fa/setup — start enrollment: create a pending secret + otpauth URI. */
    public static function twoFactorSetup(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        // Security #16: 2FA enrollment is always available per-member (no org-wide gate).
        $secret = Totp::generateSecret();
        $pdo->prepare("UPDATE members SET totp_pending_secret = ? WHERE id = ?")->execute([$secret, (int)$m['id']]);
        // Log the START of enrollment, not just the finish. Enrolling a second
        // authenticator is a common way to persist after an account takeover, and
        // previously only a later '2fa_enabled' row existed. The secret is NEVER logged.
        Audit::write($pdo, (int)$m['id'], 'members', (int)$m['id'], '2fa_setup_started',
            null, ['already_enabled' => (bool)($m['totp_enabled'] ?? false)], null, self::clientIp($req));
        $label = (string)($m['username'] ?: ($m['email'] ?: ('member' . $m['id'])));
        return Http::json($res, [
            'secret' => $secret,
            'otpauth_uri' => Totp::otpauthUri($secret, $label, 'Tulsa Robotics Center'),
        ]);
    }

    /** POST /auth/2fa/enable — verify a code against the pending secret, activate, return backup codes. */
    public static function twoFactorEnable(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $pending = (string)($m['totp_pending_secret'] ?? '');
        if ($pending === '') return Http::error($res, 'Start setup first.', 400);
        $code = trim((string)(((array)$req->getParsedBody())['code'] ?? ''));
        if (!Totp::verify($pending, $code)) return Http::error($res, 'That code is not correct. Try again.', 400);

        $codes = self::regenerateBackupCodes($pdo, (int)$m['id']);
        $pdo->prepare("UPDATE members SET totp_secret = ?, totp_pending_secret = NULL, totp_enabled = 1, totp_enrolled_at = NOW() WHERE id = ?")
            ->execute([$pending, (int)$m['id']]);
        // Security #3: a 2FA change invalidates existing tokens; re-issue this session so the member stays in.
        Auth::bumpTokenVersion($pdo, (int)$m['id']);
        $res = self::reissueCurrentSession($pdo, (int)$m['id'], $m['member_type'] ?? null, $res);
        Audit::write($pdo, (int)$m['id'], 'members', (int)$m['id'], '2fa_enabled', null, null);
        return Http::json($res, ['ok' => true, 'backup_codes' => $codes]);
    }

    /** POST /auth/2fa/disable — turn off own 2FA (requires a current code or password). */
    public static function twoFactorDisable(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $code = trim((string)($d['code'] ?? ''));
        $password = (string)($d['password'] ?? '');
        $okCode = !empty($m['totp_secret']) && Totp::verify((string)$m['totp_secret'], $code);
        $okPass = $password !== '' && password_verify($password, (string)$m['password_hash']);
        if (!$okCode && !$okPass) return Http::error($res, 'Enter your current code or password to disable.', 400);
        self::clearTwoFactor($pdo, (int)$m['id']);
        // Security #3: a 2FA change invalidates existing tokens; re-issue this session so the member stays in.
        Auth::bumpTokenVersion($pdo, (int)$m['id']);
        $res = self::reissueCurrentSession($pdo, (int)$m['id'], $m['member_type'] ?? null, $res);
        Audit::write($pdo, (int)$m['id'], 'members', (int)$m['id'], '2fa_disabled', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /members/{member_id}/2fa/reset — admin removes a user's 2FA (recovery). */
    public static function twoFactorReset(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur || !Permissions::hasAnyRole($pdo, $cur, ['Admin', 'System Administrator'])) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['member_id'];
        self::clearTwoFactor($pdo, $id);
        // Security #3: kick the target's existing sessions (their 2FA just changed).
        Auth::bumpTokenVersion($pdo, $id);
        Audit::write($pdo, (int)$cur['id'], 'members', $id, '2fa_reset', null, null);
        return Http::json($res, ['ok' => true]);
    }

    private static function clearTwoFactor(PDO $pdo, int $memberId): void
    {
        $pdo->prepare("UPDATE members SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0, totp_enrolled_at = NULL WHERE id = ?")->execute([$memberId]);
        $pdo->prepare("DELETE FROM member_backup_codes WHERE member_id = ?")->execute([$memberId]);
    }

    /** Replace a member's backup codes; return the plaintext set (shown once). */
    private static function regenerateBackupCodes(PDO $pdo, int $memberId): array
    {
        $pdo->prepare("DELETE FROM member_backup_codes WHERE member_id = ?")->execute([$memberId]);
        $ins = $pdo->prepare("INSERT INTO member_backup_codes (member_id, code_hash, created_at) VALUES (?, ?, NOW())");
        $codes = [];
        for ($i = 0; $i < 10; $i++) {
            $code = strtolower(bin2hex(random_bytes(4))); // 8 hex chars
            $codes[] = $code;
            $ins->execute([$memberId, password_hash($code, PASSWORD_BCRYPT)]);
        }
        return $codes;
    }

    /** Consume a backup code if it matches an unused one; returns true on success. */
    private static function consumeBackupCode(PDO $pdo, int $memberId, string $code): bool
    {
        $code = strtolower(preg_replace('/\s+/', '', $code));
        if ($code === '') return false;
        $s = $pdo->prepare("SELECT id, code_hash FROM member_backup_codes WHERE member_id = ? AND used_at IS NULL");
        $s->execute([$memberId]);
        foreach ($s->fetchAll() as $row) {
            if (password_verify($code, (string)$row['code_hash'])) {
                $pdo->prepare("UPDATE member_backup_codes SET used_at = NOW() WHERE id = ?")->execute([(int)$row['id']]);
                return true;
            }
        }
        return false;
    }
}
