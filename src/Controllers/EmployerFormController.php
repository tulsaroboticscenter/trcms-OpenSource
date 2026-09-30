<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Database;
use App\Core\Http;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * EmployerFormController — the no-login "tell us where you work" form.
 *
 * Parents and mentors get a personalized link in a Communications email
 * ({{employer_form_url}}). The link carries a signed token that identifies the
 * member without a password, so they can fill in employer + matching-gift info
 * on one screen. It writes to the same members.employer_* columns the profile
 * uses — the profile stays the source of truth. Fundraising staff read the
 * results in Reports → Employer Matching.
 *
 * The token is a random, DB-stored, single-purpose, revocable value (employer_form_invites),
 * mirroring visitor_signup_invites — NOT a session JWT. A leaked link exposes only this one
 * form for one member, is revocable, and expires. (Finding #1: the old purpose-scoped JWT
 * could be replayed as a full Bearer session.)
 */
final class EmployerFormController
{
    /** Link lifetime in days — long enough to cover a send plus reminder rounds, far short of the old 180d. */
    private const TOKEN_DAYS = 60;
    private const TRISTATE = ['yes', 'no', 'unsure'];

    /**
     * Mint (or reuse a still-live) no-login token for a member's employer form.
     * Returns null for a member who shouldn't get one (missing/archived/youth).
     */
    public static function tokenFor(int $memberId, ?string $sentTo = null, ?int $actorId = null): ?string
    {
        $pdo = Database::pdo();
        if (!self::loadAdult($pdo, $memberId)) return null;

        // Reuse an existing live invite so repeated sends share one link.
        $s = $pdo->prepare(
            "SELECT token FROM employer_form_invites
              WHERE member_id = ? AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())
              ORDER BY id DESC LIMIT 1");
        $s->execute([$memberId]);
        if ($tok = $s->fetchColumn()) return (string)$tok;

        $token = bin2hex(random_bytes(20));
        $pdo->prepare(
            "INSERT INTO employer_form_invites (token, member_id, sent_to, expires_at, created_by_id, created_at)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, NOW())")
            ->execute([$token, $memberId, $sentTo, self::TOKEN_DAYS, $actorId]);
        return $token;
    }

    /** Resolve a live token back to a member id, or null if invalid/expired/revoked. */
    private static function memberIdFromToken(string $token): ?int
    {
        if ($token === '') return null;
        $pdo = Database::pdo();
        $s = $pdo->prepare(
            "SELECT member_id FROM employer_form_invites
              WHERE token = ? AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > NOW())
              LIMIT 1");
        $s->execute([$token]);
        $id = $s->fetchColumn();
        return $id !== false ? (int)$id : null;
    }

    private static function loadAdult(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ? AND (is_archived = 0 OR is_archived IS NULL)");
        $s->execute([$id]);
        $m = $s->fetch();
        // Youth don't have an employer; the form is for parents/mentors/volunteers.
        if (!$m || ($m['member_type'] ?? '') === 'youth') return null;
        return $m;
    }

    /** GET /public/employer/{token} — prefill the form (no auth). */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $id = self::memberIdFromToken((string)($route['token'] ?? ''));
        if (!$id || !($m = self::loadAdult($pdo, $id))) {
            return Http::error($res, 'This link is invalid or has expired. Please ask TRC for a new one.', 404);
        }
        return Http::json($res, [
            'first_name' => $m['first_name'] ?? '',
            'org_name' => 'Tulsa Robotics Center',
            'employer_name' => $m['employer_name'] ?? '',
            'employer_job_title' => $m['employer_job_title'] ?? '',
            'employer_matches_donations' => $m['employer_matches_donations'] ?? '',
            'employer_volunteer_grants' => $m['employer_volunteer_grants'] ?? '',
            'employer_offers_grants' => $m['employer_offers_grants'] ?? '',
            'employer_program_info' => $m['employer_program_info'] ?? '',
            'employer_matching_help' => (bool)($m['employer_matching_help'] ?? false),
            'employer_notes' => $m['employer_notes'] ?? '',
            // True once they've told us anything, so the form can say "thanks, update anytime".
            'already_submitted' => trim((string)($m['employer_name'] ?? '')) !== '',
        ]);
    }

    /** POST /public/employer/{token} — save the answers to this member (no auth). */
    public static function save(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $id = self::memberIdFromToken((string)($route['token'] ?? ''));
        if (!$id || !($m = self::loadAdult($pdo, $id))) {
            return Http::error($res, 'This link is invalid or has expired. Please ask TRC for a new one.', 404);
        }
        $d = (array)$req->getParsedBody();
        $tri = fn($v) => in_array($v, self::TRISTATE, true) ? $v : null;
        $txt = fn($v, $max) => ($v === null || trim((string)$v) === '') ? null : mb_substr(trim((string)$v), 0, $max);

        $pdo->prepare("UPDATE members SET
                employer_name = ?, employer_job_title = ?, employer_matches_donations = ?,
                employer_volunteer_grants = ?, employer_offers_grants = ?, employer_program_info = ?,
                employer_matching_help = ?, employer_notes = ?
             WHERE id = ?")
            ->execute([
                $txt($d['employer_name'] ?? null, 255),
                $txt($d['employer_job_title'] ?? null, 255),
                $tri($d['employer_matches_donations'] ?? null),
                $tri($d['employer_volunteer_grants'] ?? null),
                $tri($d['employer_offers_grants'] ?? null),
                $txt($d['employer_program_info'] ?? null, 1000),
                !empty($d['employer_matching_help']) ? 1 : 0,
                $txt($d['employer_notes'] ?? null, 2000),
                $id,
            ]);
        $pdo->prepare("UPDATE employer_form_invites SET last_used_at = NOW() WHERE token = ?")
            ->execute([(string)($route['token'] ?? '')]);
        // Audit as the member themselves (self-service), matching how the profile edit records it.
        Audit::write($pdo, $id, 'members', $id, 'update', null, ['employer_form' => true]);
        return Http::json($res, ['ok' => true, 'first_name' => $m['first_name'] ?? '']);
    }
}
