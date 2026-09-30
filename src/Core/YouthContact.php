<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Child-safety oversight for direct-to-youth email.
 *
 * When the system emails youth at their OWN address with no parent or mentor on the
 * message, this sends ONE summary to the info address naming who sent it and which youth
 * received it — one notice per send operation, never one per youth. Any send flow that can
 * reach a youth directly should collect those recipients and call notify() once.
 */
final class YouthContact
{
    /** Oversight address (default info@…, overridable via INFO_EMAIL in .env). */
    public static function infoEmail(): string
    {
        return (string) (Config::get('INFO_EMAIL') ?: 'info@tulsaroboticscenter.org');
    }

    /**
     * @param array $youths list of ['name'=>string, 'email'=>string]
     */
    public static function notify(string $senderName, string $subject, array $youths): void
    {
        $youths = array_values(array_filter($youths, fn($y) => !empty($y['email'])));
        if (!$youths || !Mailer::enabled()) return;
        $rows = implode('', array_map(
            fn($y) => '<li>' . htmlspecialchars((string) $y['name']) . ' &lt;' . htmlspecialchars((string) $y['email']) . '&gt;</li>',
            $youths
        ));
        $n = count($youths);
        $body = '<p>For youth-safety oversight: a system email was sent directly to ' . $n . ' youth'
              . ' (no parent or mentor was copied).</p>'
              . '<p><strong>Sent by:</strong> ' . htmlspecialchars($senderName !== '' ? $senderName : 'System')
              . '<br><strong>Subject:</strong> ' . htmlspecialchars($subject) . '</p>'
              . '<p><strong>Youth emailed:</strong></p><ul>' . $rows . '</ul>';
        Mailer::send(self::infoEmail(), 'Youth contacted directly — ' . $subject,
            Mailer::wrap('Youth contact notice', $body), strip_tags($body));
    }
}
