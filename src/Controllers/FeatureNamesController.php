<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * The "Feature Names" glossary — the nicknames the program gives new TRCMS features, shown
 * on an in-app page to any signed-in member. Each feature is tied to the member it's named
 * after (by name), so the page can show that person's profile photo.
 *
 * ADD A ROW each release. Keep it in sync with the [[project_named_features]] memory and the
 * version log. Newest first.
 */
final class FeatureNamesController
{
    /** first/last identify the member the feature is named after (for their photo). */
    private const FEATURES = [
        [
            'nickname' => 'The “Need a Ride?” Feature',
            'description' => 'Transportation planning on off-site events — an organizer turns on “How will you get to this event?” and each member answers (I have a ride / I need a ride / I can drive others, with open seats / not sure), so a coordinator can match the members who need a ride with those offering seats.',
            'release' => 'Release 4.10', 'date' => 'Sep 16, 2026',
            'first' => 'Bonnie', 'last' => 'Griffin',
        ],
        [
            'nickname' => 'The Bonnie Feature',
            'description' => 'Potluck / “what are you bringing” sign-up on events — for a special event an organizer lists the items they need with a quantity (Side Dishes ×5, Desserts ×4, …) and attending members sign up for what they’ll bring, so the party comes together without five people all bringing chips.',
            'release' => 'Release 4.9', 'date' => 'Aug 23, 2026',
            'first' => 'Bonnie', 'last' => 'Griffin',
        ],
        [
            'nickname' => 'The Ripleigh Feature',
            'description' => 'Extra ways to pay at the parent checkout — Apply for a Scholarship, Request a Payment Plan, or Pay with Cash/Check, right alongside paying by card.',
            'release' => 'Release 4.5', 'date' => 'Jul 29, 2026',
            'first' => 'Ripleigh', 'last' => 'Degenhardt',
        ],
        [
            'nickname' => 'The Jace Feature',
            'description' => '“Keep Me Logged In.” Stay signed in for up to three days instead of getting kicked out every 12 hours — and daily use keeps the clock rolling.',
            'release' => 'Release 4.5', 'date' => 'Jul 29, 2026',
            'first' => 'Jace', 'last' => 'Lindhardt',
        ],
        [
            'nickname' => 'The Eli Feature',
            'description' => 'On the Equipment Checked Out page, request to keep a checked-out item longer — the ask goes to the checkout queue for approval.',
            'release' => 'Release 4.4', 'date' => 'Jul 27, 2026',
            'first' => 'Eli', 'last' => 'Lorenzen',
        ],
        [
            'nickname' => 'The Anita Feature',
            'description' => 'Reply to and confirm your own feedback — a “Confirm this works as requested” button records your sign-off and a comment thread lets you tell the team a fix tested well, or reopen it if something’s still off.',
            'release' => 'Release 4.2', 'date' => 'Jul 23, 2026',
            'first' => 'Anita', 'last' => 'Hundley',
        ],
        [
            'nickname' => 'The Eli Hundley Feature',
            'description' => 'Drag-and-drop ordering for team roles — a drag handle on each role card (for team leaders and admins) sets the order the roles appear in.',
            'release' => 'Release 4.2', 'date' => 'Jul 23, 2026',
            'first' => 'Eli', 'last' => 'Hundley',
        ],
        [
            'nickname' => 'The Anthony Feature',
            'description' => 'Your photo in the top-right corner — click it to jump straight to your profile from anywhere in the system.',
            'release' => 'Release 3.6', 'date' => 'Jul 8, 2026',
            'first' => 'Anthony', 'last' => 'Pollard',
        ],
    ];

    /** GET /feature-names — the glossary (any signed-in member). */
    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);

        $lookup = $pdo->prepare(
            "SELECT first_name, last_name, photo_url FROM members
              WHERE LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?)
                AND (is_archived = 0 OR is_archived IS NULL)
              ORDER BY id LIMIT 1");

        $out = array_map(function (array $f) use ($lookup) {
            $member = null;
            $lookup->execute([$f['first'], $f['last']]);
            if ($m = $lookup->fetch()) {
                $member = [
                    'name' => trim($m['first_name'] . ' ' . $m['last_name']),
                    'photo_url' => ($m['photo_url'] ?? '') !== '' ? $m['photo_url'] : null,
                ];
            }
            return [
                'nickname' => $f['nickname'],
                'description' => $f['description'],
                'release' => $f['release'],
                'date' => $f['date'],
                // Fall back to the first letter of the nickname when there's no member/photo.
                'member' => $member,
            ];
        }, self::FEATURES);

        return Http::json($res, $out);
    }
}
