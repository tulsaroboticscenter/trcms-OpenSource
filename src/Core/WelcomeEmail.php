<?php
declare(strict_types=1);

namespace App\Core;

use PDO;

/**
 * Issuing the welcome email — extracted from MembersController::sendWelcomeEmail so the
 * self-service visitor signup can send exactly the same message rather than growing a
 * second, drifting copy.
 *
 * NB this REPLACES the member's password with a temporary one. It is a credential reset,
 * not just an email, which is why the caller must do its own permission check first
 * (MembersController::sendWelcomeEmail keeps canManageCredentialsOf; the public signup
 * path is only reachable with a valid single-use invite token for that very visitor).
 */
final class WelcomeEmail
{
    /** Alternate addresses the member opted into. */
    private static function altEmails(array $m): string
    {
        $out = [];
        if (!empty($m['alt_email1_enabled']) && !empty($m['alt_email1'])) $out[] = trim((string)$m['alt_email1']);
        if (!empty($m['alt_email2_enabled']) && !empty($m['alt_email2'])) $out[] = trim((string)$m['alt_email2']);
        return implode(', ', $out);
    }

    public static function tempPassword(): string
    {
        $U = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; $L = 'abcdefghijkmnpqrstuvwxyz'; $D = '23456789'; $S = '!@#$%';
        $pick = fn(string $set, int $n) => implode('', array_map(fn() => $set[random_int(0, strlen($set) - 1)], range(1, $n)));
        $chars = str_split($pick($U, 3) . $pick($L, 5) . $pick($D, 3) . $pick($S, 2));
        for ($i = count($chars) - 1; $i > 0; $i--) { $j = random_int(0, $i); [$chars[$i], $chars[$j]] = [$chars[$j], $chars[$i]]; }
        return implode('', $chars);
    }

    /**
     * Which address the credentials go to. Youth prefer the guardian, copying the youth's
     * own address when they have a different one.
     * @return array{0:?string,1:?string,2:?string} [recipient, cc, guardianName]
     */
    public static function recipientFor(array $m): array
    {
        $recipient = $m['email'] ?: null; $guardianName = null; $cc = null;
        if (($m['member_type'] ?? '') === 'youth' && !empty($m['guardian1_email'])) {
            $recipient = $m['guardian1_email'];
            $guardianName = $m['guardian1_name'] ?: null;
            $cc = ($m['email'] && $m['email'] !== $m['guardian1_email']) ? $m['email'] : null;
        }
        $cc = trim(implode(', ', array_filter([$cc, self::altEmails($m)])), ', ') ?: null;
        return [$recipient, $cc, $guardianName];
    }

    /**
     * Reset to a temporary password, audit it, and send the credentials.
     * Returns the same payload shape the members endpoint has always returned.
     * `$error` is set (and nothing is reset) when the member has no address on file.
     */
    public static function issue(PDO $pdo, array $m, ?int $actorId, ?string $ip = null): array
    {
        [$recipient, $cc, $guardianName] = self::recipientFor($m);
        if (!$recipient) {
            return ['ok' => false, 'error' => 'This member has no email address on file. Add an email address first.'];
        }

        $temp = self::tempPassword();
        $pdo->prepare("UPDATE members SET password_hash = ?, force_password_change = true WHERE id = ?")
            ->execute([password_hash($temp, PASSWORD_BCRYPT), (int)$m['id']]);
        // Recorded as a password_reset (not just "email sent") so it can't be mistaken
        // for a self-service reset when reading the audit log later.
        Audit::write($pdo, $actorId, 'members', (int)$m['id'], 'password_reset', null,
            ['force_password_change' => true, 'welcome_email_sent' => true, 'method' => 'welcome_email'],
            null, $ip);

        $org = Config::get('ORG_NAME', 'Tulsa Robotics Center');
        $loginUrl = (string)Config::get('APP_URL', '');
        $subject = "Welcome to the {$org} Program Management System";
        $greeting = $guardianName ? "Dear {$guardianName}," : 'Dear ' . ($m['first_name'] ?? '') . ',';
        $intro = $guardianName
            ? "We're excited to welcome {$m['first_name']} {$m['last_name']} to the {$org} Program Management System!"
            : "Welcome to the {$org} Program Management System!";

        $bodyText = "{$greeting}\n\n{$intro}\n\nYour login credentials are below. Please log in and change your password at your earliest convenience.\n\n"
            . "  Login URL:  {$loginUrl}\n  Username:   {$m['username']}\n  Password:   {$temp}\n\n"
            . "IMPORTANT: This is a temporary password. You'll be asked to set your own password on first login.\n\n"
            . "If you have any trouble logging in, please contact a {$org} administrator.";
        $html = Mailer::wrap($subject,
            '<p>' . htmlspecialchars($greeting) . '</p><p>' . htmlspecialchars($intro) . '</p>'
            . '<p>Your login credentials:</p>'
            . '<table style="font-size:14px"><tr><td><b>Login</b></td><td><a href="' . htmlspecialchars($loginUrl) . '">' . htmlspecialchars($loginUrl) . '</a></td></tr>'
            . '<tr><td><b>Username</b></td><td>' . htmlspecialchars((string)$m['username']) . '</td></tr>'
            . '<tr><td><b>Temporary password</b></td><td><code>' . htmlspecialchars($temp) . '</code></td></tr></table>'
            . '<p>You\'ll be asked to set your own password the first time you log in.</p>');

        $sent = Mailer::send((string)$recipient, $subject, $html, $bodyText, $cc);
        $enabled = Mailer::enabled();

        return [
            'ok' => true,
            'email_sent' => $sent,
            'email_enabled' => $enabled,
            'send_error' => $sent ? null : ($enabled ? 'The mail server did not accept the message.' : null),
            'recipient_email' => $recipient,
            'cc_email' => $cc,
            'subject' => $subject,
            'body_text' => $bodyText,
            'temp_password' => $temp,
            'username' => $m['username'],
            'login_url' => $loginUrl,
        ];
    }
}
