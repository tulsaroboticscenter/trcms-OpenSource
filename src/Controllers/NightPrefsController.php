<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\NightPrefs;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Staff-facing read/write for a youth's canonical meeting-night preference.
 *
 * Backs the "Which nights work?" prefill on the waitlist-add and enrollment screens:
 * given a youth (visitor or member) + program + season it returns the program's nights,
 * the youth's current answer, and the family default so a new sibling starts pre-filled.
 * The public visitor kiosk writes its answer through VisitorsController; this endpoint is
 * for logged-in staff.
 */
final class NightPrefsController
{
    private static function guard(PDO $pdo, Request $req): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, ['Mentor', 'Admin', 'System Administrator'])) {
            return ['err' => 403, 'detail' => 'Access denied'];
        }
        return ['member' => $m];
    }

    private static function intOrNull($v): ?int
    {
        return ($v === null || $v === '' || $v === '0') ? null : (int)$v;
    }

    /** The program's nights for a season, ordered for display. */
    private static function nights(PDO $pdo, int $programId, string $season): array
    {
        $s = $pdo->prepare("SELECT id, name, capacity, display_order FROM program_nights
                             WHERE program_id = ? AND season = ? AND is_active = 1
                             ORDER BY display_order, id");
        $s->execute([$programId, $season]);
        return array_map(fn($r) => [
            'id' => (int)$r['id'], 'name' => $r['name'],
            'capacity' => (int)$r['capacity'], 'display_order' => (int)$r['display_order'],
        ], $s->fetchAll(PDO::FETCH_ASSOC));
    }

    /**
     * GET /night-prefs/member/{member_id} — every FLL night preference on file for a member,
     * resolved (canonical night_preferences overlaid by the availability form), across the
     * programs + seasons they have data for. Also reports whether the member is FLL-enrolled
     * at all, so the profile can distinguish "no preference yet" from "not an FLL member."
     */
    public static function forMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $mid = (int)$route['member_id'];

        // (program_id, season) pairs the member has any night data for.
        $pairs = [];
        foreach (['night_preferences', 'season_availability'] as $tbl) {
            $s = $pdo->prepare("SELECT DISTINCT program_id, season FROM $tbl WHERE member_id = ? AND program_id IS NOT NULL");
            $s->execute([$mid]);
            foreach ($s->fetchAll(PDO::FETCH_ASSOC) as $r) $pairs[$r['program_id'] . '|' . $r['season']] = ['program_id' => (int)$r['program_id'], 'season' => (string)$r['season']];
        }

        $items = [];
        foreach ($pairs as $pr) {
            $pid = $pr['program_id']; $season = $pr['season'];
            $nights = self::nights($pdo, $pid, $season);
            if (!$nights) continue;   // program has no meeting nights → not FLL
            $nightName = []; foreach ($nights as $n) $nightName[$n['id']] = $n['name'];

            $c = $pdo->prepare("SELECT available_night_ids, preferred_night_id, flexible, siblings_together, notes FROM night_preferences WHERE member_id = ? AND program_id = ? AND season = ?");
            $c->execute([$mid, $pid, $season]); $cr = $c->fetch(PDO::FETCH_ASSOC) ?: [];
            $f = $pdo->prepare("SELECT night_prefs, mentor_willing, flexible, notes FROM season_availability WHERE member_id = ? AND (program_id <=> ?) AND season = ?");
            $f->execute([$mid, $pid, $season]); $fr = $f->fetch(PDO::FETCH_ASSOC) ?: [];

            $state = [];
            foreach ((json_decode((string)($cr['available_night_ids'] ?? '[]'), true) ?: []) as $nid) $state[(int)$nid] = 'ok';
            if (!empty($cr['preferred_night_id'])) $state[(int)$cr['preferred_night_id']] = 'preferred';
            foreach ((json_decode((string)($fr['night_prefs'] ?? '{}'), true) ?: []) as $nid => $v) {
                if (in_array($v, ['preferred', 'ok', 'no'], true)) $state[(int)$nid] = $v;
            }
            $pref = []; $ok = []; $no = [];
            foreach ($nightName as $nid => $name) {
                $st = $state[$nid] ?? null;
                if ($st === 'preferred') $pref[] = $name; elseif ($st === 'ok') $ok[] = $name; elseif ($st === 'no') $no[] = $name;
            }
            $pn = $pdo->prepare("SELECT name FROM programs WHERE id = ?"); $pn->execute([$pid]);
            $items[] = [
                'program_id' => $pid, 'program_name' => $pn->fetchColumn() ?: 'FLL', 'season' => $season,
                'preferred' => $pref, 'ok' => $ok, 'no' => $no,
                'flexible' => (bool)(($cr['flexible'] ?? 0) || ($fr['flexible'] ?? 0)),
                'siblings_together' => (bool)($cr['siblings_together'] ?? 0),
                'mentor_willing' => $fr['mentor_willing'] ?? null,
                'notes' => ($cr['notes'] ?? null) ?: ($fr['notes'] ?? null),
            ];
        }
        usort($items, fn($a, $b) => strcmp($b['season'], $a['season']) ?: strcmp($a['program_name'], $b['program_name']));

        // FLL-enrolled at all? (a program that defines meeting nights)
        $fll = $pdo->prepare("SELECT COUNT(*) FROM enrollments e WHERE e.member_id = ? AND e.program_id IN (SELECT DISTINCT program_id FROM program_nights)");
        $fll->execute([$mid]);
        return Http::json($res, ['member_id' => $mid, 'is_fll' => ((int)$fll->fetchColumn() > 0), 'items' => $items]);
    }

    /** GET /night-prefs?member_id=&visitor_id=&program_id=&season= */
    public static function get(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $q = $req->getQueryParams();
        $pid = (int)($q['program_id'] ?? 0);
        if (!$pid) return Http::error($res, 'program_id is required.', 422);
        $season = trim((string)($q['season'] ?? '')) ?: NightPrefs::currentSeason();
        $mid = self::intOrNull($q['member_id'] ?? null);
        $vid = self::intOrNull($q['visitor_id'] ?? null);

        $pref = ($mid || $vid) ? NightPrefs::get($pdo, $mid, $vid, $pid, $season) : null;
        $familyDefault = $mid ? NightPrefs::familyDefault($pdo, $mid, $pid, $season) : null;

        // Does night preference apply to this youth? FLL program + (known) age in band.
        $birthday = null;
        if ($mid) {
            $b = $pdo->prepare("SELECT birthday FROM members WHERE id = ?"); $b->execute([$mid]);
            $birthday = $b->fetchColumn() ?: null;
        } elseif ($vid) {
            $b = $pdo->prepare("SELECT birthday FROM visitors WHERE id = ?"); $b->execute([$vid]);
            $birthday = $b->fetchColumn() ?: null;
        }
        $applies = NightPrefs::applies($pdo, $pid, $birthday, $season);

        return Http::json($res, [
            'season'         => $season,
            'program_id'     => $pid,
            'nights'         => self::nights($pdo, $pid, $season),
            'preference'     => $pref,
            'family_default' => $familyDefault,
        ] + $applies);
    }

    /** POST /night-prefs — save a youth's preference (staff/admin). */
    public static function save(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];
        $d = (array)$req->getParsedBody();
        $pid = (int)($d['program_id'] ?? 0);
        $mid = self::intOrNull($d['member_id'] ?? null);
        $vid = self::intOrNull($d['visitor_id'] ?? null);
        if (!$pid || (!$mid && !$vid)) return Http::error($res, 'program_id and a member_id or visitor_id are required.', 422);
        $season = trim((string)($d['season'] ?? '')) ?: NightPrefs::currentSeason();

        $fields = self::extractFields($d);
        NightPrefs::save($pdo, $mid, $vid, $pid, $season, $fields, (string)($d['source'] ?? 'admin'), (int)$cur['id']);

        return Http::json($res, [
            'ok'         => true,
            'preference' => NightPrefs::get($pdo, $mid, $vid, $pid, $season),
        ]);
    }

    /**
     * Pull the night-preference fields out of a request body, keeping only keys that were
     * actually sent so a partial save doesn't clobber the rest.
     */
    public static function extractFields(array $d): array
    {
        $fields = [];
        if (array_key_exists('available_night_ids', $d)) {
            $fields['available_night_ids'] = $d['available_night_ids'] === null ? null : (array)$d['available_night_ids'];
        }
        if (array_key_exists('preferred_night_id', $d)) $fields['preferred_night_id'] = self::intOrNull($d['preferred_night_id']);
        if (array_key_exists('flexible', $d))            $fields['flexible'] = !empty($d['flexible']);
        if (array_key_exists('siblings_together', $d))   $fields['siblings_together'] = !empty($d['siblings_together']);
        if (array_key_exists('night_notes', $d))         $fields['notes'] = $d['night_notes'] !== null ? (string)$d['night_notes'] : null;
        return $fields;
    }
}
