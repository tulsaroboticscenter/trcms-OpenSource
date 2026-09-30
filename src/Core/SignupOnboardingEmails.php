<?php
declare(strict_types=1);

namespace App\Core;

use App\Controllers\CommunicationsController;
use PDO;

/**
 * The onboarding emails that go out automatically when an FTC/FRC family completes the
 * self-service signup, on top of the account-credentials welcome:
 *
 *   1. "FTC/FRC Youth & Parent Welcome / Getting Started" — one PER qualifying youth,
 *      personalised to that youth, sent to the youth's own address if they have one with
 *      the parent copied, otherwise to the parent.
 *   2. "FTC/FRC Parent Introduction" — once, to the parent only.
 *
 * Both are ordinary email templates (Communications → Email Templates) looked up by
 * NAME, so staff can edit the wording without a code change. If a template has been
 * renamed or deactivated, that send is reported as "template not found" in the staff
 * signup notice rather than failing silently.
 *
 * Only FTC/FRC youth trigger these — the same condition that puts a youth in the FDP.
 */
final class SignupOnboardingEmails
{
    public const TPL_WELCOME = 'FTC/FRC Youth & Parent Welcome / Getting Started';
    public const TPL_PARENT_MEETING = 'FTC/FRC Parent Introduction';

    /**
     * @param array $ctx {
     *   parent_member_id: ?int,   // the guardian's member id, if an account was created
     *   parent_name: string,
     *   parent_email: string,
     *   youth: [['member_id'=>int, 'name'=>string, 'own_email'=>?string]]  // FTC/FRC only
     * }
     * @return array<int,array> per-send records from CommunicationsController::sendNamedTemplate,
     *         each tagged with 'about' (who the email was for) for the staff notice.
     */
    public static function send(PDO $pdo, array $ctx): array
    {
        $youth = $ctx['youth'] ?? [];
        if (!$youth) return [];                 // no FTC/FRC youth → these don't apply

        $parentEmail = trim((string)($ctx['parent_email'] ?? ''));
        $parentName = trim((string)($ctx['parent_name'] ?? ''));
        $parentMemberId = $ctx['parent_member_id'] ?? null;

        $log = [];

        // 1. Welcome / Getting Started — one per qualifying youth, personalised.
        foreach ($youth as $y) {
            $ownEmail = trim((string)($y['own_email'] ?? ''));
            // The youth's own address if they have one distinct from the parent's, with
            // the parent copied so they always see it; otherwise straight to the parent.
            if ($ownEmail !== '' && strcasecmp($ownEmail, $parentEmail) !== 0) {
                $to = $ownEmail; $toName = (string)$y['name']; $cc = $parentEmail ?: null;
            } else {
                $to = $parentEmail; $toName = $parentName ?: (string)$y['name']; $cc = null;
            }
            $r = CommunicationsController::sendNamedTemplate(
                $pdo, self::TPL_WELCOME, 'member', (int)$y['member_id'], $to, $toName, $cc);
            $r['about'] = (string)$y['name'];
            $log[] = $r;
        }

        // 2. Parent Introduction — once, parent only.
        if ($parentEmail !== '') {
            if ($parentMemberId) {
                // Real parent account → {{first_name}} etc. resolve to the parent.
                $r = CommunicationsController::sendNamedTemplate(
                    $pdo, self::TPL_PARENT_MEETING, 'member', (int)$parentMemberId, $parentEmail, $parentName ?: null);
            } else {
                // No parent account (they declined one) — supply the name so the template's
                // {{first_name}}/{{full_name}} still fill in.
                [$pf] = array_pad(preg_split('/\s+/', $parentName) ?: [], 1, '');
                $r = CommunicationsController::sendNamedTemplate(
                    $pdo, self::TPL_PARENT_MEETING, 'general', 0, $parentEmail, $parentName ?: null, null,
                    ['first_name' => $pf, 'full_name' => $parentName, 'guardian1_name' => $parentName]);
            }
            $r['about'] = ($parentName ?: 'Parent') . ' (parent)';
            $log[] = $r;
        }

        return $log;
    }
}
