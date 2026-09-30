<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Outbound email. Prefers authenticated SMTP when configured (reliable for
 * sending invites to outside recipients); otherwise falls back to PHP mail().
 *
 * SMTP config (.env):
 *   SMTP_HOST        e.g. mail.tulsaroboticscenter.org  (or smtp.gmail.com)
 *   SMTP_PORT        587 (STARTTLS) or 465 (SSL)        — default 587
 *   SMTP_USER        the full mailbox login              e.g. noreply@tulsaroboticscenter.org
 *   SMTP_PASS        the mailbox password / app password
 *   SMTP_ENCRYPTION  tls | ssl | none                    — default tls (auto ssl if port 465)
 *   SMTP_FROM        From address (defaults to SMTP_USER, then noreply@…)
 *   ORG_NAME         From display name
 */
final class Mailer
{
    private static ?string $lastError = null;

    /** The reason the last send() failed (for surfacing in admin UIs). Null on success. */
    public static function lastError(): ?string { return self::$lastError; }


    /**
     * Effective SMTP settings: the DB-stored config (system_config category 'smtp')
     * takes precedence over .env, which takes precedence over built-in defaults.
     * The DB is read fresh each call, so changes made in the admin UI apply on the
     * very next send (no PHP-FPM restart needed, unlike .env-only config).
     */
    private static function settings(): array
    {
        $db = [];
        try {
            $s = Database::pdo()->prepare("SELECT `values` FROM system_config WHERE category = 'smtp'");
            $s->execute();
            if (($r = $s->fetch()) && $r['values']) {
                $j = json_decode((string)$r['values'], true);
                if (is_array($j)) $db = $j;
            }
        } catch (\Throwable $e) { /* row/table may not exist yet — fall back to .env */ }
        $pick = fn(string $k, string $env): string =>
            (isset($db[$k]) && (string)$db[$k] !== '') ? (string)$db[$k] : (string)(Config::get($env, '') ?? '');
        return [
            'host' => $pick('host', 'SMTP_HOST'),
            'port' => $pick('port', 'SMTP_PORT'),
            'user' => $pick('user', 'SMTP_USER'),
            'pass' => $pick('pass', 'SMTP_PASS'),
            'encryption' => $pick('encryption', 'SMTP_ENCRYPTION'),
            'from' => $pick('from', 'SMTP_FROM'),
        ];
    }

    /** SMTP is used whenever a host is set. AUTH is attempted only if user+pass are present
     *  (so an unauthenticated relay like relay4.tulsaconnect.com works with host alone). */
    private static function smtpConfigured(): bool
    {
        return self::settings()['host'] !== '';
    }

    /** Send an HTML email (optional CC + Reply-To). Returns true on apparent success. */
    /**
     * @param array|null $attachments File attachments (#102), each:
     *   ['path' => absolute file path, 'name' => filename, 'mime' => content-type].
     *   When null/empty the message is byte-identical to the pre-attachment behavior.
     */
    public static function send(string $to, string $subject, string $html, ?string $text = null, ?string $cc = null, ?string $replyTo = null, ?array $attachments = null): bool
    {
        self::$lastError = null;
        $to = trim($to);
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            self::$lastError = 'No valid recipient address.';
            return false;
        }
        // $cc may be a comma-separated list (e.g. a member's enabled alternate emails).
        if ($cc) {
            $valid = array_filter(array_map('trim', explode(',', $cc)), fn($a) => $a !== '' && filter_var($a, FILTER_VALIDATE_EMAIL) && strcasecmp($a, $to) !== 0);
            $cc = $valid ? implode(', ', array_unique($valid)) : null;
        }

        $bcc = '';   // no blanket archive copy; youth-contact oversight is handled per-send elsewhere

        if (self::smtpConfigured()) {
            try {
                return self::smtpSend($to, $cc, $subject, $html, $replyTo, $attachments, $bcc);
            } catch (\Throwable $e) {
                self::$lastError = 'SMTP: ' . $e->getMessage();
                error_log('[TRCMS Mailer] ' . self::$lastError);
                return false;
            }
        }

        // Fallback: PHP mail() via the local MTA.
        $from = Config::get('SMTP_FROM', 'noreply@tulsaroboticscenter.org');
        $org  = Config::get('ORG_NAME', 'Tulsa Robotics Center');
        [$ctype, $body] = self::mimeParts($html, $attachments ?? []);
        $headers = "MIME-Version: 1.0\r\n"
                 . $ctype . "\r\n"
                 . 'From: ' . self::encodeName((string)$org) . ' <' . $from . ">\r\n";
        if ($cc) $headers .= 'Cc: ' . $cc . "\r\n";
        if ($bcc) $headers .= 'Bcc: ' . $bcc . "\r\n";
        if ($replyTo) $headers .= 'Reply-To: ' . $replyTo . "\r\n";
        try {
            $ok = @mail($to, $subject, $body, $headers);
            if (!$ok) self::$lastError = 'PHP mail() returned false (local mail server may be unavailable).';
            return $ok;
        } catch (\Throwable $e) {
            self::$lastError = 'mail(): ' . $e->getMessage();
            return false;
        }
    }

    /**
     * Build the Content-Type header + message body. With no attachments this is a
     * plain text/html part (identical to the original behavior); with attachments
     * it's a multipart/mixed message. Returns [contentTypeHeader, body].
     */
    private static function mimeParts(string $html, array $attachments): array
    {
        $attachments = array_values(array_filter($attachments, fn($a) => !empty($a['path']) && is_file($a['path'])));
        if (!$attachments) {
            return ['Content-Type: text/html; charset=UTF-8', $html];
        }
        $boundary = 'trcms_' . bin2hex(random_bytes(12));
        $b = "--$boundary\r\n"
           . "Content-Type: text/html; charset=UTF-8\r\n"
           . "Content-Transfer-Encoding: 8bit\r\n\r\n"
           . $html . "\r\n";
        foreach ($attachments as $a) {
            $data = @file_get_contents($a['path']);
            if ($data === false) continue;
            $name = preg_replace('/[\r\n"]/', '', (string)($a['name'] ?? 'attachment'));
            $mime = preg_replace('/[\r\n;]/', '', (string)($a['mime'] ?? 'application/octet-stream'));
            $b .= "--$boundary\r\n"
               . "Content-Type: $mime; name=\"$name\"\r\n"
               . "Content-Transfer-Encoding: base64\r\n"
               . "Content-Disposition: attachment; filename=\"$name\"\r\n\r\n"
               . chunk_split(base64_encode($data)) . "\r\n";
        }
        $b .= "--$boundary--\r\n";
        return ['Content-Type: multipart/mixed; boundary="' . $boundary . '"', $b];
    }

    /** True if outbound email is configured (SMTP creds present). */
    public static function enabled(): bool
    {
        return self::smtpConfigured();
    }

    /** The effective From address (DB settings → .env → default). */
    public static function fromAddress(): string
    {
        return self::settings()['from'] ?: 'noreply@tulsaroboticscenter.org';
    }

    /** True in non-production — lets recovery endpoints surface the reset link in the response. */
    public static function devMode(): bool
    {
        return Config::get('ENVIRONMENT', 'development') !== 'production';
    }

    // ── Minimal authenticated-SMTP client (no external dependencies) ──────────

    private static function smtpSend(string $to, ?string $cc, string $subject, string $html, ?string $replyTo = null, ?array $attachments = null, ?string $bcc = null): bool
    {
        $cfg  = self::settings();
        $host = $cfg['host'];
        $user = $cfg['user'];
        $pass = $cfg['pass'];
        $useAuth = $user !== '' && $pass !== '';
        // Default port: 587 for authenticated submission, 25 for a plain relay.
        $port = (int)($cfg['port'] ?: ($useAuth ? 587 : 25));
        // Default encryption: ssl for 465, tls for authenticated submission, none for a plain relay.
        $enc  = strtolower($cfg['encryption'] ?: ($port === 465 ? 'ssl' : ($useAuth ? 'tls' : 'none')));
        $from = $cfg['from'] ?: ($user ?: 'noreply@tulsaroboticscenter.org');
        $org  = (string)Config::get('ORG_NAME', 'Tulsa Robotics Center');

        $transport = ($enc === 'ssl') ? "ssl://$host" : $host;
        // Verify the relay's TLS certificate against the OS trust store (F3). This context
        // applies to both an implicit-TLS (ssl://) connection and a STARTTLS upgrade, since
        // stream_socket_enable_crypto() reuses the socket's context. peer_name is pinned to
        // the configured host so name validation matches even over STARTTLS. For a plain
        // (encryption=none) relay no TLS is negotiated, so these settings are simply unused.
        // If the org's relay ever uses a self-signed cert, pin it here rather than disabling
        // verification globally.
        $ctx = stream_context_create(['ssl' => [
            'verify_peer'       => true,
            'verify_peer_name'  => true,
            'SNI_enabled'       => true,
            'peer_name'         => $host,
        ]]);
        $fp = @stream_socket_client("$transport:$port", $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) throw new \RuntimeException("connect failed ($errno $errstr)");
        stream_set_timeout($fp, 20);

        $read = function () use ($fp): array {
            $data = '';
            while (($line = fgets($fp, 515)) !== false) {
                $data .= $line;
                if (strlen($line) < 4 || $line[3] === ' ') break; // last line of a (possibly multiline) reply
            }
            return [(int)substr($data, 0, 3), $data];
        };
        $cmd = function (string $c, int $expect) use ($fp, $read): void {
            fwrite($fp, $c . "\r\n");
            [$code, $resp] = $read();
            if ($code !== $expect) throw new \RuntimeException("expected $expect, got: " . trim($resp));
        };

        [$code] = $read();                                  // server greeting
        if ($code !== 220) throw new \RuntimeException('no 220 greeting');
        $ehlo = 'EHLO ' . (gethostname() ?: 'trcms');
        $cmd($ehlo, 250);
        if ($enc === 'tls') {
            $cmd('STARTTLS', 220);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT
                | STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT)) {
                throw new \RuntimeException('STARTTLS negotiation failed');
            }
            $cmd($ehlo, 250);                               // re-EHLO after TLS
        }
        // AUTH LOGIN — only when credentials are configured (skipped for open relays).
        if ($useAuth) {
            $cmd('AUTH LOGIN', 334);
            $cmd(base64_encode($user), 334);
            $cmd(base64_encode($pass), 235);
        }

        $cmd('MAIL FROM:<' . $from . '>', 250);
        $cmd('RCPT TO:<' . $to . '>', 250);
        foreach ($cc ? array_map('trim', explode(',', $cc)) : [] as $c) {
            if ($c !== '') $cmd('RCPT TO:<' . $c . '>', 250);
        }
        // BCC: delivered as an envelope recipient only — deliberately NOT written into the
        // message headers, so it stays hidden from the To/Cc recipients.
        if ($bcc) $cmd('RCPT TO:<' . trim($bcc) . '>', 250);
        $cmd('DATA', 354);

        [$ctype, $rawBody] = self::mimeParts($html, $attachments ?? []);
        $headers = 'From: ' . self::encodeName($org) . ' <' . $from . ">\r\n"
            . 'To: ' . $to . "\r\n"
            . ($cc ? 'Cc: ' . $cc . "\r\n" : '')
            . ($replyTo ? 'Reply-To: ' . $replyTo . "\r\n" : '')
            . 'Subject: ' . self::encodeHeader($subject) . "\r\n"
            . 'MIME-Version: 1.0' . "\r\n"
            . $ctype . "\r\n"
            . 'Date: ' . date('r') . "\r\n";
        $body = preg_replace('/^\./m', '..', str_replace("\r\n", "\n", $rawBody)); // dot-stuff
        $body = str_replace("\n", "\r\n", (string)$body);
        $cmd($headers . "\r\n" . $body . "\r\n.", 250);
        @fwrite($fp, "QUIT\r\n");
        @fclose($fp);
        return true;
    }

    private static function encodeName(string $name): string
    {
        return preg_match('/[^\x20-\x7e]/', $name)
            ? '=?UTF-8?B?' . base64_encode($name) . '?='
            : '"' . str_replace('"', '', $name) . '"';
    }
    private static function encodeHeader(string $s): string
    {
        return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
    }

    /** Wrap body content in the branded layout used across the app's emails. */
    public static function wrap(string $title, string $bodyHtml): string
    {
        $org = Config::get('ORG_NAME', 'Tulsa Robotics Center');
        $url = Config::get('APP_URL', '');
        return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
            . 'body{font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto}'
            . '.header{background:#1a3a5c;color:#fff;padding:20px 28px;border-radius:8px 8px 0 0}'
            . '.body{background:#f8fafc;padding:28px;border:1px solid #e2e8f0}'
            . '.btn{display:inline-block;background:#1565c0;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none}'
            . '.footer{padding:14px 28px;font-size:11px;color:#aaa;text-align:center}</style></head><body>'
            . '<div class="header"><h1 style="margin:0;font-size:20px">' . htmlspecialchars($org) . '</h1></div>'
            . '<div class="body">' . $bodyHtml . '</div>'
            . '<div class="footer">' . htmlspecialchars($org) . ' · <a href="' . htmlspecialchars($url) . '">' . htmlspecialchars($url) . '</a></div>'
            . '</body></html>';
    }
}
