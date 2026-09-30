<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Config;
use App\Core\Database;
use App\Core\Permissions;
use App\Core\Mailer;
use App\Core\FllEligibility;
use App\Core\Audit;
use App\Core\Http;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;

/**
 * FLL Season Planning — Phase 1: collect availability.
 *
 * Families state, per season + program (FLLc/FLLe), which nights each youth is
 * available and whether each parent will mentor. Collected three ways, all
 * writing to season_availability:
 *   - a tokenized no-login link emailed to the family (resolveInvite/submitInvite)
 *   - the logged-in family view (myForm/saveMyForm)
 *   - admin back-office entry (adminSave)
 * The form resolves to the whole FAMILY, so a co-parent sees answers already
 * entered and everyone's siblings.
 */
final class SeasonPlanningController
{
    private static function admin(PDO $pdo, ?array $m): bool
    {
        return $m !== null && Permissions::isSuperAdmin($pdo, $m); // Admin / System Administrator
    }

    private static function familyIdOf(PDO $pdo, int $memberId): ?int
    {
        $s = $pdo->prepare("SELECT family_id FROM family_members WHERE member_id = ? LIMIT 1");
        $s->execute([$memberId]);
        $r = $s->fetch();
        return $r ? (int)$r['family_id'] : null;
    }

    /** The form data for a whole family: members + their current answers + the season's nights. */
    private static function formPayload(PDO $pdo, int $familyId, string $season, ?int $programId): array
    {
        $fam = $pdo->prepare("SELECT family_name FROM families WHERE id = ?"); $fam->execute([$familyId]);
        $familyName = $fam->fetchColumn() ?: 'Your family';

        $nStmt = $pdo->prepare("SELECT id, name FROM program_nights WHERE program_id = ? AND season = ? AND is_active = 1 ORDER BY display_order, id");
        $nStmt->execute([$programId, $season]);
        $nights = array_map(fn($n) => ['id' => (int)$n['id'], 'name' => $n['name']], $nStmt->fetchAll());

        $mStmt = $pdo->prepare(
            "SELECT m.id, m.first_name, m.last_name, m.member_type
             FROM family_members fm JOIN members m ON m.id = fm.member_id
             WHERE fm.family_id = ? AND (m.is_active = 1 OR m.is_active IS NULL) ORDER BY m.member_type, m.last_name, m.first_name"
        );
        $mStmt->execute([$familyId]);
        $members = [];
        foreach ($mStmt->fetchAll() as $m) {
            $a = $pdo->prepare("SELECT sa.*, TRIM(CONCAT(COALESCE(sb.first_name,''),' ',COALESCE(sb.last_name,''))) AS submitted_by_name
                                FROM season_availability sa LEFT JOIN members sb ON sb.id = sa.submitted_by_id
                                WHERE sa.member_id = ? AND sa.season = ? AND (sa.program_id <=> ?)");
            $a->execute([(int)$m['id'], $season, $programId]);
            $av = $a->fetch();
            $members[] = [
                'member_id'   => (int)$m['id'],
                'name'        => trim($m['first_name'] . ' ' . $m['last_name']),
                'member_type' => $m['member_type'],
                'is_guardian' => in_array($m['member_type'], ['parent', 'mentor', 'volunteer'], true),
                'availability' => $av ? [
                    'mentor_willing'    => $av['mentor_willing'],
                    'flexible'          => (bool)$av['flexible'],
                    'night_prefs'       => $av['night_prefs'] ? json_decode((string)$av['night_prefs'], true) : (object)[],
                    'siblings_together' => $av['siblings_together'] === null ? null : (bool)$av['siblings_together'],
                    'notes'             => $av['notes'],
                    'submitted_by_name' => trim((string)$av['submitted_by_name']) ?: null,
                    'submitted_at'      => Time::naiveIso($av['submitted_at'] ?? null),
                ] : null,
            ];
        }

        $pName = null;
        if ($programId) { $p = $pdo->prepare("SELECT name FROM programs WHERE id = ?"); $p->execute([$programId]); $pName = $p->fetchColumn() ?: null; }

        return ['season' => $season, 'program_id' => $programId, 'program_name' => $pName,
                'family_id' => $familyId, 'family_name' => $familyName, 'nights' => $nights, 'members' => $members];
    }

    /** Upsert one family's responses. $responses: [{member_id, mentor_willing?, flexible, night_prefs{}, siblings_together?, notes?}] */
    private static function saveResponses(PDO $pdo, int $familyId, string $season, ?int $programId, array $responses, ?int $submittedById): int
    {
        // Only members that actually belong to this family may be written.
        $ids = [];
        $fm = $pdo->prepare("SELECT member_id FROM family_members WHERE family_id = ?"); $fm->execute([$familyId]);
        foreach ($fm->fetchAll(PDO::FETCH_COLUMN) as $mid) $ids[(int)$mid] = true;

        $now = gmdate('Y-m-d H:i:s'); $count = 0;
        foreach ($responses as $r) {
            $mid = (int)($r['member_id'] ?? 0);
            if (!isset($ids[$mid])) continue;
            $willing = in_array($r['mentor_willing'] ?? null, ['lead', 'assist', 'admin', 'no'], true) ? $r['mentor_willing'] : null;
            $flexible = !empty($r['flexible']) ? 1 : 0;
            $prefs = isset($r['night_prefs']) && is_array($r['night_prefs']) ? json_encode($r['night_prefs']) : null;
            $sib = array_key_exists('siblings_together', $r) && $r['siblings_together'] !== null ? (int)!empty($r['siblings_together']) : null;
            $notes = isset($r['notes']) ? trim((string)$r['notes']) : null;
            $pdo->prepare("INSERT INTO season_availability
                    (member_id, season, program_id, mentor_willing, flexible, night_prefs, siblings_together, notes, submitted_by_id, submitted_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE mentor_willing=VALUES(mentor_willing), flexible=VALUES(flexible),
                    night_prefs=VALUES(night_prefs), siblings_together=VALUES(siblings_together), notes=VALUES(notes),
                    submitted_by_id=VALUES(submitted_by_id), submitted_at=VALUES(submitted_at)")
                ->execute([$mid, $season, $programId, $willing, $flexible, $prefs, $sib, $notes, $submittedById, $now]);
            $count++;
        }
        return $count;
    }

    private static function validInvite(PDO $pdo, string $token): ?array
    {
        $s = $pdo->prepare("SELECT * FROM availability_invites WHERE token = ?"); $s->execute([$token]);
        $inv = $s->fetch();
        if (!$inv) return null;
        if ($inv['revoked_at']) return null;
        if ($inv['expires_at'] && strtotime((string)$inv['expires_at']) < time()) return null;
        return $inv;
    }

    // ── Public (no login) ─────────────────────────────────────────────────────

    /** GET /public/season-availability/{token} */
    public static function resolveInvite(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $inv = self::validInvite($pdo, (string)$route['token']);
        if (!$inv) return Http::error($res, 'This link is invalid or has expired. Please contact the TRC team.', 404);
        return Http::json($res, self::formPayload($pdo, (int)$inv['family_id'], $inv['season'], $inv['program_id'] !== null ? (int)$inv['program_id'] : null));
    }

    /** POST /public/season-availability/{token} */
    public static function submitInvite(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $inv = self::validInvite($pdo, (string)$route['token']);
        if (!$inv) return Http::error($res, 'This link is invalid or has expired.', 404);
        $d = (array)$req->getParsedBody();
        $n = self::saveResponses($pdo, (int)$inv['family_id'], $inv['season'], $inv['program_id'] !== null ? (int)$inv['program_id'] : null, (array)($d['responses'] ?? []), null);
        $pdo->prepare("UPDATE availability_invites SET used_at = NOW() WHERE id = ?")->execute([(int)$inv['id']]);
        Audit::write($pdo, null, 'season_availability', (int)$inv['family_id'], 'season.availability_submit', null, ['via' => 'invite', 'members' => $n]);
        return Http::json($res, ['ok' => true, 'saved' => $n]);
    }

    // ── Logged-in family ──────────────────────────────────────────────────────

    /** GET /season-planning/my-form?season=&program_id= */
    public static function myForm(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $fid = self::familyIdOf($pdo, (int)$m['id']);
        if (!$fid) return Http::error($res, 'You are not part of a family record yet.', 404);
        $q = $req->getQueryParams();
        return Http::json($res, self::formPayload($pdo, $fid, (string)($q['season'] ?? ''), !empty($q['program_id']) ? (int)$q['program_id'] : null));
    }

    /** POST /season-planning/my-form */
    public static function saveMyForm(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $fid = self::familyIdOf($pdo, (int)$m['id']);
        if (!$fid) return Http::error($res, 'You are not part of a family record yet.', 404);
        $d = (array)$req->getParsedBody();
        $season = (string)($d['season'] ?? ''); $pid = !empty($d['program_id']) ? (int)$d['program_id'] : null;
        $n = self::saveResponses($pdo, $fid, $season, $pid, (array)($d['responses'] ?? []), (int)$m['id']);
        Audit::write($pdo, (int)$m['id'], 'season_availability', $fid, 'season.availability_submit', null, ['via' => 'self', 'members' => $n]);
        return Http::json($res, ['ok' => true, 'saved' => $n]);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /**
     * GET /season-planning/dashboard?season=&program_id=&show_all=
     * Only families with a youth who is AGE-ELIGIBLE for this program OR has shown
     * interest in it (on the waitlist, enrolled before, on a team, or a converted
     * visitor who asked about it). show_all=1 falls back to every family with a youth.
     */
    public static function dashboard(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $season = (string)($q['season'] ?? ''); $pid = !empty($q['program_id']) ? (int)$q['program_id'] : null;
        $showAll = !empty($q['show_all']);

        $bands = FllEligibility::bands($pdo);
        $band = $pid ? ($bands[$pid] ?? ['min' => 0, 'max' => 99]) : ['min' => 0, 'max' => 99];
        $refYear = FllEligibility::refYear($season);
        $progName = 'FLL';
        if ($pid) { $p = $pdo->prepare("SELECT name FROM programs WHERE id = ?"); $p->execute([$pid]); $progName = $p->fetchColumn() ?: 'FLL'; }

        // Interest signals (each keyed by member_id).
        $wait = [];
        if ($pid) {
            $w = $pdo->prepare("SELECT DISTINCT member_id FROM waitlist_entries WHERE program_id = ? AND season = ? AND member_id IS NOT NULL AND status IN ('waiting','offered','accepted')");
            $w->execute([$pid, $season]);
            foreach ($w->fetchAll(PDO::FETCH_COLUMN) as $id) $wait[(int)$id] = true;
        }
        $enr = [];
        if ($pid) {
            $e = $pdo->prepare("SELECT member_id, MAX(enrollment_year) y FROM enrollments WHERE program_id = ? GROUP BY member_id");
            $e->execute([$pid]);
            foreach ($e->fetchAll() as $r) $enr[(int)$r['member_id']] = (int)$r['y'];
        }
        $roster = [];
        if ($pid) {
            $rs = $pdo->prepare("SELECT DISTINCT tma.member_id FROM team_member_assignments tma
                                 JOIN team_seasons ts ON ts.id = tma.team_season_id
                                 JOIN teams t ON t.id = ts.team_id
                                 WHERE t.program_id = ? AND ts.season IN (?, ?) AND (tma.status IS NULL OR tma.status <> 'inactive')");
            $rs->execute([$pid, $season, self::priorSeason($season)]);
            foreach ($rs->fetchAll(PDO::FETCH_COLUMN) as $id) $roster[(int)$id] = true;
        }
        $vis = [];
        if ($pid) {
            $v = $pdo->prepare("SELECT DISTINCT converted_member_id FROM visitors WHERE program_interest_id = ? AND converted_member_id IS NOT NULL");
            $v->execute([$pid]);
            foreach ($v->fetchAll(PDO::FETCH_COLUMN) as $id) $vis[(int)$id] = true;
        }

        // All active youth, with family + birthday.
        $youthStmt = $pdo->query(
            "SELECT m.id, m.first_name, m.last_name, m.birthday,
                    (SELECT family_id FROM family_members fm WHERE fm.member_id = m.id LIMIT 1) family_id
             FROM members m WHERE m.member_type = 'youth' AND (m.is_active = 1 OR m.is_active IS NULL)"
        );
        $famYouth = []; // family_id => [ {member_id,name,age,reasons[]} ]
        foreach ($youthStmt->fetchAll() as $y) {
            $mid = (int)$y['id'];
            $age = FllEligibility::ageOnJan1($y['birthday'], $refYear);
            $reasons = [];
            if (FllEligibility::ageEligible($age, $band)) $reasons[] = "Age {$age}";
            if (isset($wait[$mid])) $reasons[] = 'On waitlist';
            if (isset($enr[$mid])) $reasons[] = 'Enrolled ' . $enr[$mid];
            if (isset($roster[$mid])) $reasons[] = "On a {$progName} team";
            if (isset($vis[$mid])) $reasons[] = 'Visitor interest';
            $isCandidate = count($reasons) > 0;
            if (!$isCandidate && !$showAll) continue;
            if (!$isCandidate && $age === null) $reasons[] = 'No birthdate on file';
            $famKey = $y['family_id'] !== null ? (int)$y['family_id'] : -$mid;
            $famYouth[$famKey][] = ['member_id' => $mid, 'name' => trim($y['first_name'] . ' ' . $y['last_name']),
                'age' => $age, 'reasons' => $reasons, 'is_candidate' => $isCandidate];
        }
        if (!$famYouth) {
            return Http::json($res, ['season' => $season, 'program_id' => $pid, 'families' => [], 'total' => 0, 'complete' => 0,
                'show_all' => $showAll, 'age_band' => $band, 'ref_year' => $refYear, 'program_name' => $progName]);
        }

        // Guardians per (real) family + who has responded, in bulk.
        $realFamIds = array_values(array_filter(array_keys($famYouth), fn($k) => $k > 0));
        $guardiansByFam = [];
        if ($realFamIds) {
            $in = implode(',', array_fill(0, count($realFamIds), '?'));
            $g = $pdo->prepare("SELECT fm.family_id, m.id, TRIM(CONCAT(m.first_name,' ',m.last_name)) name
                                FROM family_members fm JOIN members m ON m.id = fm.member_id
                                WHERE fm.family_id IN ($in) AND m.member_type IN ('parent','mentor','volunteer')
                                  AND (m.is_active = 1 OR m.is_active IS NULL)");
            $g->execute($realFamIds);
            foreach ($g->fetchAll() as $r) $guardiansByFam[(int)$r['family_id']][] = ['member_id' => (int)$r['id'], 'name' => $r['name']];
        }
        $responded = [];
        $ra = $pdo->prepare("SELECT member_id FROM season_availability WHERE season = ? AND (program_id <=> ?)");
        $ra->execute([$season, $pid]);
        foreach ($ra->fetchAll(PDO::FETCH_COLUMN) as $id) $responded[(int)$id] = true;

        $famNames = [];
        if ($realFamIds) {
            $in = implode(',', array_fill(0, count($realFamIds), '?'));
            $fn = $pdo->prepare("SELECT id, family_name FROM families WHERE id IN ($in)");
            $fn->execute($realFamIds);
            foreach ($fn->fetchAll() as $r) $famNames[(int)$r['id']] = $r['family_name'];
        }

        // Families the director has removed from this season/program's list stay hidden.
        $excluded = [];
        $ex = $pdo->prepare("SELECT fam_key, family_name FROM season_planning_exclusions WHERE season = ? AND program_id = ?");
        $ex->execute([$season, (int)($pid ?? 0)]);
        foreach ($ex->fetchAll() as $r) $excluded[(int)$r['fam_key']] = $r['family_name'];

        $out = [];
        foreach ($famYouth as $famKey => $youths) {
            if (array_key_exists((int)$famKey, $excluded)) continue;   // removed by the director
            $isReal = $famKey > 0;
            $guardians = $isReal ? ($guardiansByFam[$famKey] ?? []) : [];
            $roster_members = array_merge($guardians, array_map(fn($y) => ['member_id' => $y['member_id'], 'name' => $y['name']], $youths));
            $respCount = 0;
            foreach ($roster_members as $rm) if (isset($responded[$rm['member_id']])) $respCount++;
            $mc = count($roster_members);
            $inv = null;
            if ($isReal) {
                $iv = $pdo->prepare("SELECT sent_to, used_at FROM availability_invites WHERE family_id = ? AND season = ? AND (program_id <=> ?) ORDER BY id DESC LIMIT 1");
                $iv->execute([$famKey, $season, $pid]); $inv = $iv->fetch();
            }
            $out[] = [
                'key' => (int)$famKey,   // stable id for removal (>0 family, <0 lone youth)
                'family_id' => $isReal ? $famKey : 0,
                'family_name' => $isReal ? ($famNames[$famKey] ?? 'Family') : ($youths[0]['name'] . ' (no family record)'),
                'candidates' => $youths,
                'guardian_count' => count($guardians),
                'responded_count' => $respCount, 'member_count' => $mc,
                'complete' => $mc > 0 && $respCount === $mc,
                'invite_sent' => (bool)$inv, 'invite_used' => (bool)($inv && $inv['used_at']),
                'emailable' => count($guardians) > 0,
            ];
        }
        usort($out, fn($a, $b) => strcasecmp($a['family_name'], $b['family_name']));
        $done = array_filter($out, fn($x) => $x['complete']);
        $removed = [];
        foreach ($excluded as $k => $name) $removed[] = ['key' => (int)$k, 'family_name' => $name ?: 'Family'];
        usort($removed, fn($a, $b) => strcasecmp($a['family_name'], $b['family_name']));
        return Http::json($res, ['season' => $season, 'program_id' => $pid,
            'families' => $out, 'total' => count($out), 'complete' => count($done),
            'removed' => $removed,
            'show_all' => $showAll, 'age_band' => $band, 'ref_year' => $refYear, 'program_name' => $progName]);
    }

    /** POST /season-planning/exclude-family — remove a family from this season/program's list. */
    public static function excludeFamily(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = trim((string)($d['season'] ?? ''));
        $key = (int)($d['key'] ?? 0);
        if ($season === '' || $key === 0) return Http::error($res, 'season and key are required.', 422);
        $pid = (int)($d['program_id'] ?? 0);
        $pdo->prepare(
            "INSERT INTO season_planning_exclusions (season, program_id, fam_key, family_name, reason, created_by_id)
             VALUES (?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE family_name = VALUES(family_name), reason = VALUES(reason)"
        )->execute([$season, $pid, $key, (string)($d['family_name'] ?? '') ?: null,
                    (string)($d['reason'] ?? '') ?: null, $m ? (int)$m['id'] : null]);
        Audit::write($pdo, $m ? (int)$m['id'] : null, 'season_planning_exclusions', $key, 'season.exclude_family',
            null, ['season' => $season, 'program_id' => $pid, 'family_name' => $d['family_name'] ?? null]);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /season-planning/restore-family — put a removed family back on the list. */
    public static function restoreFamily(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = trim((string)($d['season'] ?? ''));
        $key = (int)($d['key'] ?? 0);
        if ($season === '' || $key === 0) return Http::error($res, 'season and key are required.', 422);
        $pid = (int)($d['program_id'] ?? 0);
        $pdo->prepare("DELETE FROM season_planning_exclusions WHERE season = ? AND program_id = ? AND fam_key = ?")
            ->execute([$season, $pid, $key]);
        Audit::write($pdo, $m ? (int)$m['id'] : null, 'season_planning_exclusions', $key, 'season.restore_family',
            null, ['season' => $season, 'program_id' => $pid]);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /season-planning/eligibility — the configurable FLL age bands. */
    public static function eligibilitySettings(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        return Http::json($res, ['bands' => FllEligibility::bands($pdo)]);
    }

    /** POST /season-planning/eligibility — save the age bands ({bands:{"1":{min,max},...}}). */
    public static function saveEligibilitySettings(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $bands = is_array($d['bands'] ?? null) ? $d['bands'] : [];
        FllEligibility::saveBands($pdo, $bands);
        Audit::write($pdo, (int)$m['id'], 'system_config', null, 'season.eligibility_save', null, ['bands' => $bands]);
        return Http::json($res, ['ok' => true, 'bands' => FllEligibility::bands($pdo)]);
    }

    /** POST /season-planning/admin-save — admin enters/edits availability for one family. */
    public static function adminSave(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $fid = (int)($d['family_id'] ?? 0);
        if (!$fid) return Http::error($res, 'family_id is required', 422);
        $n = self::saveResponses($pdo, $fid, (string)($d['season'] ?? ''), !empty($d['program_id']) ? (int)$d['program_id'] : null, (array)($d['responses'] ?? []), (int)$m['id']);
        Audit::write($pdo, (int)$m['id'], 'season_availability', $fid, 'season.availability_submit', null, ['via' => 'admin', 'members' => $n]);
        return Http::json($res, ['ok' => true, 'saved' => $n]);
    }

    // ── Phase 2: the planning board ───────────────────────────────────────────

    private static function priorSeason(string $season): string
    {
        if (preg_match('/^(\d{4})-(\d{4})$/', $season, $m)) return ((int)$m[1] - 1) . '-' . ((int)$m[2] - 1);
        return $season;
    }

    /** Bucket ids for a season+program (a member may sit in only one at a time). */
    private static function bucketIds(PDO $pdo, string $season, int $programId): array
    {
        $s = $pdo->prepare("SELECT id FROM plan_night_teams WHERE season = ? AND program_id = ?");
        $s->execute([$season, $programId]);
        return array_map('intval', $s->fetchAll(PDO::FETCH_COLUMN));
    }

    /**
     * GET /season-planning/preferences?season=&program_id= — a ROSTER-first listing for one
     * FLL program + season: every youth in the program (enrolled, on a team, or waitlisted),
     * prospective visitors (waitlisted or not yet), and the program's current mentors — each
     * with the night(s) they prefer / can also do / can't. Everyone in scope is listed even
     * with no preference on file, so gaps are visible. Night guidance resolves the same way
     * the board does: intake canonical prefs (night_preferences) overlaid by the availability
     * form (season_availability). Read-only; no placement, no side effects.
     */
    public static function preferences(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $season = trim((string)($q['season'] ?? ''));
        $pid = !empty($q['program_id']) ? (int)$q['program_id'] : 0;
        if (!$pid || $season === '') return Http::error($res, 'program_id and season are required.', 422);

        $pn = $pdo->prepare("SELECT name FROM programs WHERE id = ?"); $pn->execute([$pid]);
        $progName = $pn->fetchColumn() ?: 'FLL';

        // Active nights for this program+season (id -> name), in display order.
        $nights = []; $nightName = [];
        $ns = $pdo->prepare("SELECT id, name FROM program_nights WHERE program_id = ? AND season = ? AND is_active = 1 ORDER BY display_order, id");
        $ns->execute([$pid, $season]);
        foreach ($ns->fetchAll(PDO::FETCH_ASSOC) as $n) {
            $nights[] = ['id' => (int)$n['id'], 'name' => $n['name']];
            $nightName[(int)$n['id']] = $n['name'];
        }

        // available_night_ids + preferred_night_id, overlaid by the form's per-night pref.
        $resolve = function ($availableIds, $preferredId, $formPrefs) use ($nightName) {
            $state = [];
            foreach ((is_array($availableIds) ? $availableIds : []) as $nid) $state[(int)$nid] = 'ok';
            if ($preferredId) $state[(int)$preferredId] = 'preferred';
            foreach ((is_array($formPrefs) ? $formPrefs : []) as $nid => $v) {
                if (in_array($v, ['preferred', 'ok', 'no'], true)) $state[(int)$nid] = $v;
            }
            $out = ['preferred' => [], 'ok' => [], 'no' => []];
            foreach ($nightName as $nid => $name) {
                if (isset($state[$nid], $out[$state[$nid]])) $out[$state[$nid]][] = $name;
            }
            return $out;
        };
        $jarr = fn ($v) => $v ? (json_decode((string)$v, true) ?: []) : [];

        // Preference sources, indexed once: canonical (night_preferences) by member + visitor,
        // and the availability form (season_availability) by member.
        $npMember = []; $npVisitor = [];
        $np = $pdo->prepare("SELECT member_id, visitor_id, available_night_ids, preferred_night_id, flexible, notes
                             FROM night_preferences WHERE program_id = ? AND season = ?");
        $np->execute([$pid, $season]);
        foreach ($np->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if ($r['member_id']) $npMember[(int)$r['member_id']] = $r;
            elseif ($r['visitor_id']) $npVisitor[(int)$r['visitor_id']] = $r;
        }
        $saMember = [];
        $sa = $pdo->prepare("SELECT member_id, night_prefs, mentor_willing, flexible, notes
                             FROM season_availability WHERE season = ? AND (program_id <=> ?)");
        $sa->execute([$season, $pid]);
        foreach ($sa->fetchAll(PDO::FETCH_ASSOC) as $r) $saMember[(int)$r['member_id']] = $r;

        $prefsFor = function (?int $memberId, ?int $visitorId) use ($resolve, $jarr, &$npMember, &$npVisitor, &$saMember) {
            $c = $memberId ? ($npMember[$memberId] ?? null) : ($visitorId ? ($npVisitor[$visitorId] ?? null) : null);
            $f = $memberId ? ($saMember[$memberId] ?? null) : null;
            $row = $resolve($jarr($c['available_night_ids'] ?? null), $c['preferred_night_id'] ?? null, $jarr($f['night_prefs'] ?? null));
            $row['flexible'] = (bool)(($c['flexible'] ?? 0) || ($f['flexible'] ?? 0));
            $row['notes'] = ($c['notes'] ?? null) ?: ($f['notes'] ?? null);
            $row['responded'] = ($c !== null || $f !== null);
            return $row;
        };

        // Never on any list: mentors the director hid on the planning board, and the
        // System Administrator account (a ghost — must not appear on any roster).
        $exclude = [];
        foreach ($pdo->query("SELECT member_id FROM season_planning_hidden_mentors")->fetchAll(PDO::FETCH_COLUMN) as $id) $exclude[(int)$id] = true;
        foreach ($pdo->query("SELECT ms.member_id FROM member_system_roles ms JOIN system_roles r ON r.id = ms.role_id WHERE r.name = 'System Administrator'")->fetchAll(PDO::FETCH_COLUMN) as $id) $exclude[(int)$id] = true;

        // ── Interest signals for youth members (the same net the dashboard uses) ──
        $wait = [];
        $w = $pdo->prepare("SELECT DISTINCT member_id FROM waitlist_entries WHERE program_id = ? AND season = ? AND member_id IS NOT NULL AND status IN ('waiting','offered','accepted')");
        $w->execute([$pid, $season]);
        foreach ($w->fetchAll(PDO::FETCH_COLUMN) as $id) $wait[(int)$id] = true;
        $enr = [];
        $e = $pdo->prepare("SELECT member_id, MAX(enrollment_year) y FROM enrollments WHERE program_id = ? AND status <> 'expired' GROUP BY member_id");
        $e->execute([$pid]);
        foreach ($e->fetchAll() as $r) $enr[(int)$r['member_id']] = (int)$r['y'];
        $team = [];
        $rs = $pdo->prepare("SELECT DISTINCT tma.member_id FROM team_member_assignments tma
                             JOIN team_seasons ts ON ts.id = tma.team_season_id
                             JOIN teams t ON t.id = ts.team_id
                             WHERE t.program_id = ? AND ts.season IN (?, ?) AND (tma.status IS NULL OR tma.status <> 'inactive')");
        $rs->execute([$pid, $season, self::priorSeason($season)]);
        foreach ($rs->fetchAll(PDO::FETCH_COLUMN) as $id) $team[(int)$id] = true;

        // ── Youth & prospects ──
        $youth = [];
        $ids = array_values(array_unique(array_merge(array_keys($wait), array_keys($enr), array_keys($team))));
        if ($ids) {
            $in = implode(',', array_fill(0, count($ids), '?'));
            $ys = $pdo->prepare("SELECT id, first_name, last_name FROM members
                                 WHERE id IN ($in) AND member_type = 'youth' AND (is_active = 1 OR is_active IS NULL)
                                 ORDER BY last_name, first_name");
            $ys->execute($ids);
            foreach ($ys->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $mid = (int)$r['id'];
                if (isset($exclude[$mid])) continue;
                $status = isset($enr[$mid]) ? 'Enrolled' : (isset($wait[$mid]) ? 'Waitlisted' : 'On a team');
                $youth[] = ['kind' => 'member', 'id' => $mid, 'name' => trim("{$r['first_name']} {$r['last_name']}"),
                    'status' => $status] + $prefsFor($mid, null);
            }
        }
        // Waitlisted visitors (prospective youth not yet in the system).
        $wv = $pdo->prepare("SELECT DISTINCT we.visitor_id, v.first_name, v.last_name
                             FROM waitlist_entries we JOIN visitors v ON v.id = we.visitor_id
                             WHERE we.program_id = ? AND we.season = ? AND we.visitor_id IS NOT NULL
                               AND v.converted_member_id IS NULL AND we.status IN ('waiting','offered','accepted')
                             ORDER BY v.last_name, v.first_name");
        $wv->execute([$pid, $season]);
        foreach ($wv->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $vid = (int)$r['visitor_id'];
            $youth[] = ['kind' => 'visitor', 'id' => $vid, 'name' => trim("{$r['first_name']} {$r['last_name']}"),
                'status' => 'Waitlisted (visitor)'] + $prefsFor(null, $vid);
        }
        // Interested visitors not yet on the waitlist.
        $nv = $pdo->prepare("SELECT v.id, v.first_name, v.last_name FROM visitors v
                             WHERE v.program_interest_id = ? AND v.converted_member_id IS NULL
                               AND v.id NOT IN (SELECT visitor_id FROM waitlist_entries WHERE program_id = ? AND visitor_id IS NOT NULL)
                             ORDER BY v.last_name, v.first_name");
        $nv->execute([$pid, $pid]);
        foreach ($nv->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $vid = (int)$r['id'];
            $youth[] = ['kind' => 'visitor', 'id' => $vid, 'name' => trim("{$r['first_name']} {$r['last_name']}"),
                'status' => 'New visitor'] + $prefsFor(null, $vid);
        }

        // ── Mentors ASSIGNED to this program: on one of its teams (this or prior season)
        //    or placed on its planning board this season. Hidden mentors + the System
        //    Administrator ghost are excluded. ──
        $mentorIds = [];
        $mt = $pdo->prepare("SELECT DISTINCT m.id FROM team_member_assignments tma
                             JOIN team_seasons ts ON ts.id = tma.team_season_id
                             JOIN teams t ON t.id = ts.team_id
                             JOIN members m ON m.id = tma.member_id
                             WHERE t.program_id = ? AND ts.season IN (?, ?) AND m.member_type = 'mentor'
                               AND (m.is_active = 1 OR m.is_active IS NULL)
                               AND (tma.status IS NULL OR tma.status <> 'inactive')");
        $mt->execute([$pid, $season, self::priorSeason($season)]);
        foreach ($mt->fetchAll(PDO::FETCH_COLUMN) as $id) $mentorIds[(int)$id] = true;
        $mb = $pdo->prepare("SELECT DISTINCT m.id FROM plan_placements pp
                             JOIN plan_night_teams pnt ON pnt.id = pp.plan_night_team_id
                             JOIN members m ON m.id = pp.member_id
                             WHERE pnt.program_id = ? AND pnt.season = ? AND pp.role IN ('lead','assist')
                               AND m.member_type = 'mentor' AND (m.is_active = 1 OR m.is_active IS NULL)");
        $mb->execute([$pid, $season]);
        foreach ($mb->fetchAll(PDO::FETCH_COLUMN) as $id) $mentorIds[(int)$id] = true;

        $mentors = [];
        $mids = array_values(array_filter(array_keys($mentorIds), fn ($id) => !isset($exclude[$id])));
        if ($mids) {
            $in = implode(',', array_fill(0, count($mids), '?'));
            $ms = $pdo->prepare("SELECT id, first_name, last_name FROM members WHERE id IN ($in) ORDER BY last_name, first_name");
            $ms->execute($mids);
            foreach ($ms->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $mid = (int)$r['id'];
                $mentors[] = ['id' => $mid, 'name' => trim("{$r['first_name']} {$r['last_name']}"),
                    'mentor_willing' => $saMember[$mid]['mentor_willing'] ?? null] + $prefsFor($mid, null);
            }
        }

        // Per-night tally (first-choice + can-also-do) across youth + mentors.
        $all = array_merge($youth, $mentors);
        $tally = [];
        foreach ($nights as $n) {
            $pc = 0; $oc = 0;
            foreach ($all as $row) {
                if (in_array($n['name'], $row['preferred'], true)) $pc++;
                elseif (in_array($n['name'], $row['ok'], true)) $oc++;
            }
            $tally[] = ['night_id' => $n['id'], 'name' => $n['name'], 'preferred' => $pc, 'ok' => $oc];
        }

        return Http::json($res, [
            'season' => $season, 'program_id' => $pid, 'program_name' => $progName,
            'nights' => $nights, 'tally' => $tally,
            'youth' => $youth, 'mentors' => $mentors,
            'counts' => ['youth' => count($youth), 'mentors' => count($mentors)],
        ]);
    }

    /** GET /season-planning/board?season=&program_id= — nights, team buckets + placements, and the pool. */
    public static function board(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $season = (string)($q['season'] ?? ''); $pid = (int)($q['program_id'] ?? 0);
        if ($season === '' || !$pid) return Http::error($res, 'season and program_id are required', 422);

        $nStmt = $pdo->prepare("SELECT id, name, capacity, max_teams FROM program_nights WHERE program_id = ? AND season = ? AND is_active = 1 ORDER BY display_order, id");
        $nStmt->execute([$pid, $season]);
        $nights = array_map(fn($n) => ['id' => (int)$n['id'], 'name' => $n['name'], 'capacity' => (int)$n['capacity'], 'max_teams' => $n['max_teams'] !== null ? (int)$n['max_teams'] : null], $nStmt->fetchAll());

        // Grade + age for a youth (null for adults) — so the director can build FLLe/FLLc teams by
        // grade/age at a glance (#169). Grade is judged on the ACADEMIC (season) year — the earlier
        // year of "YYYY-YYYY" — while FLL age is judged on Jan 1 of the COMPETITION year ($refYear,
        // the later year). Passing $refYear into the grade formula read every youth one grade high
        // (Katlyn Hayes showed as 9th while her profile — correctly on the season year — showed 8th).
        $refYear = FllEligibility::refYear($season);
        $seasonYear = preg_match('/(\d{4})/', $season, $sm) ? (int)$sm[1] : ($refYear - 1);
        $youthMeta = function (string $memberType, $gradYear, $birthday) use ($refYear, $seasonYear): array {
            if ($memberType !== 'youth') return ['grade' => null, 'age' => null];
            $grade = $gradYear !== null && $gradYear !== '' ? \App\Core\Grade::label(\App\Core\Grade::fromGraduationYear((int)$gradYear, $seasonYear)) : null;
            return ['grade' => $grade, 'age' => FllEligibility::ageOnJan1($birthday, $refYear)];
        };

        // Teams (buckets) + placements
        $tStmt = $pdo->prepare("SELECT * FROM plan_night_teams WHERE season = ? AND program_id = ? ORDER BY night_id, display_order, id");
        $tStmt->execute([$season, $pid]);
        $teams = []; $placedIds = [];
        foreach ($tStmt->fetchAll() as $t) {
            $ps = $pdo->prepare("SELECT pp.member_id, pp.role, m.first_name, m.last_name, m.member_type, m.graduation_year, m.birthday
                                 FROM plan_placements pp JOIN members m ON m.id = pp.member_id WHERE pp.plan_night_team_id = ?");
            $ps->execute([(int)$t['id']]);
            $placements = [];
            foreach ($ps->fetchAll() as $p) {
                $placedIds[(int)$p['member_id']] = true;
                $placements[] = ['member_id' => (int)$p['member_id'], 'name' => trim($p['first_name'] . ' ' . $p['last_name']),
                    'member_type' => $p['member_type'], 'role' => $p['role'],
                    'is_guardian' => in_array($p['member_type'], ['parent', 'mentor', 'volunteer'], true)]
                    + $youthMeta($p['member_type'], $p['graduation_year'], $p['birthday']);
            }
            $teams[] = ['id' => (int)$t['id'], 'night_id' => (int)$t['night_id'], 'label' => $t['label'] ?: 'Team',
                'based_on_team_id' => $t['based_on_team_id'] !== null ? (int)$t['based_on_team_id'] : null,
                'is_holding' => (bool)($t['is_holding'] ?? 0), 'placements' => $placements];
        }

        // Youth on this program's waitlist this season → flag them in the pool.
        $waitlist = [];
        $wl = $pdo->prepare("SELECT DISTINCT member_id FROM waitlist_entries WHERE program_id = ? AND season = ? AND member_id IS NOT NULL AND status IN ('waiting','offered','accepted')");
        $wl->execute([$pid, $season]);
        foreach ($wl->fetchAll(PDO::FETCH_COLUMN) as $id) $waitlist[(int)$id] = true;

        // Pool — active youth + adults, with availability + YPT status. Two exclusions:
        // adults the director has "always hidden" (season_planning_hidden_mentors), and
        // any System Administrator account (never an assignable option on the board).
        $poolStmt = $pdo->query(
            "SELECT m.id, m.first_name, m.last_name, m.member_type, m.graduation_year, m.birthday,
                    ar.ypt_complete, ar.background_check_complete
             FROM members m LEFT JOIN adult_roles ar ON ar.member_id = m.id
             WHERE (m.is_active = 1 OR m.is_active IS NULL)
               AND m.member_type IN ('youth','mentor','parent','volunteer')
               AND (m.is_kiosk = 0 OR m.is_kiosk IS NULL)   -- never the check-in / parts-room / registration station accounts
               AND m.id NOT IN (SELECT member_id FROM season_planning_hidden_mentors)
               AND m.id NOT IN (
                    SELECT msr.member_id FROM member_system_roles msr
                     JOIN system_roles sr ON sr.id = msr.role_id
                    WHERE sr.name = 'System Administrator')
             ORDER BY m.member_type, m.last_name, m.first_name"
        );
        // Canonical night preference captured at intake/waitlist/enrollment (Core\NightPrefs)
        // — derive a per-night preferred/ok map so the guidance families gave shows on the
        // board even if they never filled the availability form. Preloaded per season+program.
        $npByMember = [];
        $npStmt = $pdo->prepare("SELECT member_id, available_night_ids, preferred_night_id FROM night_preferences
                                 WHERE season = ? AND program_id = ? AND member_id IS NOT NULL");
        $npStmt->execute([$season, (int)($pid ?? 0)]);
        foreach ($npStmt->fetchAll() as $r) {
            $prefs = [];
            $avail = $r['available_night_ids'] ? json_decode((string)$r['available_night_ids'], true) : [];
            foreach (is_array($avail) ? $avail : [] as $nid) $prefs[(int)$nid] = 'ok';
            if ($r['preferred_night_id']) $prefs[(int)$r['preferred_night_id']] = 'preferred';
            if ($prefs) $npByMember[(int)$r['member_id']] = $prefs;
        }

        $pool = [];
        foreach ($poolStmt->fetchAll() as $r) {
            $mid = (int)$r['id'];
            $av = $pdo->prepare("SELECT mentor_willing, flexible, night_prefs FROM season_availability WHERE member_id = ? AND season = ? AND (program_id <=> ?)");
            $av->execute([$mid, $season, $pid]);
            $a = $av->fetch();
            // Night guidance = intake canonical prefs, overlaid by the availability form's
            // explicit answers (which can also say "no"), so the form wins per night.
            $formPrefs = ($a && $a['night_prefs']) ? (json_decode((string)$a['night_prefs'], true) ?: []) : [];
            $nightPrefs = ($npByMember[$mid] ?? []) + [];
            foreach ((is_array($formPrefs) ? $formPrefs : []) as $k => $v) $nightPrefs[(int)$k] = $v;
            $isGuardian = in_array($r['member_type'], ['parent', 'mentor', 'volunteer'], true);
            $pool[] = [
                'member_id' => $mid, 'name' => trim($r['first_name'] . ' ' . $r['last_name']), 'member_type' => $r['member_type'],
                'is_guardian' => $isGuardian,
                'ypt_ok' => $isGuardian ? ((bool)$r['ypt_complete'] && (bool)$r['background_check_complete']) : null,
                'placed' => isset($placedIds[$mid]),
                'is_waitlist' => isset($waitlist[$mid]),
                'availability' => ($a || $nightPrefs) ? [
                    'mentor_willing' => $a['mentor_willing'] ?? null,
                    'flexible' => (bool)($a['flexible'] ?? false),
                    'night_prefs' => $nightPrefs ?: (object)[],
                ] : null,
            ] + $youthMeta($r['member_type'], $r['graduation_year'], $r['birthday']);
        }
        // The adults currently hidden from the pool, so the board can offer "unhide".
        $hidden = $pdo->query(
            "SELECT h.member_id, TRIM(CONCAT(m.first_name,' ',m.last_name)) name, m.member_type
             FROM season_planning_hidden_mentors h JOIN members m ON m.id = h.member_id
             ORDER BY m.last_name, m.first_name"
        )->fetchAll(PDO::FETCH_ASSOC);
        $hidden = array_map(fn($r) => ['member_id' => (int)$r['member_id'], 'name' => $r['name'], 'member_type' => $r['member_type']], $hidden);

        return Http::json($res, ['season' => $season, 'program_id' => $pid,
            'nights' => $nights, 'teams' => $teams, 'pool' => $pool, 'hidden' => $hidden]);
    }

    /** POST /season-planning/board/hide-mentor — always hide an adult from the board pool. */
    public static function hideMentor(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $mid = (int)(((array)$req->getParsedBody())['member_id'] ?? 0);
        if (!$mid) return Http::error($res, 'member_id is required.', 422);
        $pdo->prepare("INSERT IGNORE INTO season_planning_hidden_mentors (member_id, created_by_id) VALUES (?, ?)")
            ->execute([$mid, $m ? (int)$m['id'] : null]);
        Audit::write($pdo, $m ? (int)$m['id'] : null, 'season_planning_hidden_mentors', $mid, 'season.hide_mentor', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /season-planning/board/unhide-mentor — restore an adult to the board pool. */
    public static function unhideMentor(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $mid = (int)(((array)$req->getParsedBody())['member_id'] ?? 0);
        if (!$mid) return Http::error($res, 'member_id is required.', 422);
        $pdo->prepare("DELETE FROM season_planning_hidden_mentors WHERE member_id = ?")->execute([$mid]);
        Audit::write($pdo, $m ? (int)$m['id'] : null, 'season_planning_hidden_mentors', $mid, 'season.unhide_mentor', null, null);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /season-planning/board/team — add a team bucket to a night. */
    public static function addTeam(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = (string)($d['season'] ?? ''); $pid = (int)($d['program_id'] ?? 0); $nid = (int)($d['night_id'] ?? 0);
        if ($season === '' || !$pid || !$nid) return Http::error($res, 'season, program_id, night_id required', 422);
        $ord = (int)($pdo->query("SELECT COALESCE(MAX(display_order),0)+1 FROM plan_night_teams WHERE night_id = " . $nid)->fetchColumn());
        $pdo->prepare("INSERT INTO plan_night_teams (season, program_id, night_id, label, based_on_team_id, display_order) VALUES (?,?,?,?,?,?)")
            ->execute([$season, $pid, $nid, trim((string)($d['label'] ?? 'New Team')) ?: 'New Team', !empty($d['based_on_team_id']) ? (int)$d['based_on_team_id'] : null, $ord]);
        return Http::json($res, ['ok' => true, 'id' => (int)$pdo->lastInsertId()], 201);
    }

    /**
     * GET /season-planning/board/available-teams?season=&program_id= — existing team pages
     * for the program, so "Add team" can LINK a bucket to a real team up front (which lets
     * Publish write its roster). Reports each team's number, name, and whether it's already
     * on the board this season.
     */
    public static function availableTeams(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $pid = (int)($q['program_id'] ?? 0);
        $season = (string)($q['season'] ?? '');
        if (!$pid) return Http::error($res, 'program_id required', 422);
        $st = $pdo->prepare(
            "SELECT t.id, t.team_number,
                    (SELECT ts.team_name FROM team_seasons ts
                      WHERE ts.team_id = t.id AND COALESCE(ts.team_name,'') <> ''
                      ORDER BY ts.season DESC LIMIT 1) AS team_name
               FROM teams t WHERE t.program_id = ? ORDER BY t.team_number");
        $st->execute([$pid]);
        $on = $pdo->prepare("SELECT DISTINCT based_on_team_id FROM plan_night_teams WHERE season = ? AND program_id = ? AND based_on_team_id IS NOT NULL");
        $on->execute([$season, $pid]);
        $onBoard = array_fill_keys(array_map('intval', array_column($on->fetchAll(), 'based_on_team_id')), true);
        $out = [];
        foreach ($st->fetchAll() as $r) {
            $num = (string)$r['team_number'];
            $out[] = [
                'team_id' => (int)$r['id'], 'team_number' => $num, 'team_name' => $r['team_name'],
                'label' => trim('#' . $num . ' ' . (string)($r['team_name'] ?? '')),
                'on_board' => isset($onBoard[(int)$r['id']]),
            ];
        }
        return Http::json($res, $out);
    }

    /** PATCH /season-planning/board/team/{team_id} — rename or move to another night. */
    public static function updateTeam(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['team_id']; $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        if (array_key_exists('label', $d)) { $set[] = 'label = ?'; $args[] = trim((string)$d['label']); }
        if (!empty($d['night_id'])) { $set[] = 'night_id = ?'; $args[] = (int)$d['night_id']; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE plan_night_teams SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        return Http::json($res, ['ok' => true]);
    }

    /** DELETE /season-planning/board/team/{team_id} */
    public static function deleteTeam(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['team_id'];
        $pdo->prepare("DELETE FROM plan_placements WHERE plan_night_team_id = ?")->execute([$id]);
        $pdo->prepare("DELETE FROM plan_night_teams WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /season-planning/board/place — place (or move) a member into a bucket. */
    public static function place(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $tid = (int)($d['plan_night_team_id'] ?? 0); $mid = (int)($d['member_id'] ?? 0);
        $role = in_array($d['role'] ?? '', ['lead', 'assist', 'youth'], true) ? $d['role'] : 'youth';
        // Which season/program does this bucket belong to? (scope the "one bucket per member" rule.)
        $tr = $pdo->prepare("SELECT season, program_id FROM plan_night_teams WHERE id = ?"); $tr->execute([$tid]);
        $t = $tr->fetch();
        if (!$t) return Http::error($res, 'Team not found', 404);
        $buckets = self::bucketIds($pdo, $t['season'], (int)$t['program_id']);
        if ($buckets) {
            $in = implode(',', array_fill(0, count($buckets), '?'));
            $pdo->prepare("DELETE FROM plan_placements WHERE member_id = ? AND plan_night_team_id IN ($in)")->execute(array_merge([$mid], $buckets));
        }
        $pdo->prepare("INSERT INTO plan_placements (plan_night_team_id, member_id, role) VALUES (?,?,?)")->execute([$tid, $mid, $role]);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /season-planning/board/unplace — remove a member from the board (back to the pool). */
    public static function unplace(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $tid = (int)($d['plan_night_team_id'] ?? 0); $mid = (int)($d['member_id'] ?? 0);
        $pdo->prepare("DELETE FROM plan_placements WHERE plan_night_team_id = ? AND member_id = ?")->execute([$tid, $mid]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Night-first planning ──────────────────────────────────────────────────

    /** The per-night "holding" bucket (on this night, not yet on a team); created on demand. */
    private static function holdingBucket(PDO $pdo, string $season, int $pid, int $nightId): int
    {
        $s = $pdo->prepare("SELECT id FROM plan_night_teams WHERE season = ? AND program_id = ? AND night_id = ? AND is_holding = 1 LIMIT 1");
        $s->execute([$season, $pid, $nightId]);
        $id = (int)($s->fetchColumn() ?: 0);
        if ($id) return $id;
        $pdo->prepare("INSERT INTO plan_night_teams (season, program_id, night_id, label, is_holding, display_order) VALUES (?,?,?,?,1,0)")
            ->execute([$season, $pid, $nightId, 'On this night']);
        return (int)$pdo->lastInsertId();
    }

    /**
     * POST /season-planning/board/assign-night — put a member ON a night (holding area),
     * not yet on a team. {member_id, night_id, role?}. night_id=0 sends back to the pool.
     */
    public static function assignNight(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0); $nid = (int)($d['night_id'] ?? 0);
        $season = (string)($d['season'] ?? ''); $pid = (int)($d['program_id'] ?? 0);
        if (!$mid || $season === '' || !$pid) return Http::error($res, 'member_id, season, program_id required', 422);
        $role = in_array($d['role'] ?? '', ['lead', 'assist', 'youth'], true) ? $d['role'] : null;

        // Clear any current placement for this member in this season+program.
        $buckets = self::bucketIds($pdo, $season, $pid);
        if ($buckets) {
            $in = implode(',', array_fill(0, count($buckets), '?'));
            $pdo->prepare("DELETE FROM plan_placements WHERE member_id = ? AND plan_night_team_id IN ($in)")->execute(array_merge([$mid], $buckets));
        }
        if ($nid === 0) return Http::json($res, ['ok' => true, 'assigned' => false]); // back to pool

        if ($role === null) { // default role from member type
            $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?"); $mt->execute([$mid]);
            $role = $mt->fetchColumn() === 'youth' ? 'youth' : 'assist';
        }
        $bid = self::holdingBucket($pdo, $season, $pid, $nid);
        $pdo->prepare("INSERT INTO plan_placements (plan_night_team_id, member_id, role) VALUES (?,?,?)")->execute([$bid, $mid, $role]);
        return Http::json($res, ['ok' => true, 'assigned' => true, 'holding_id' => $bid]);
    }

    /**
     * POST /season-planning/board/availability — record one person's night preference/
     * willingness directly (admin entry, e.g. the FLL mentor list). Bypasses the family
     * form. {member_id, season, program_id, mentor_willing?, flexible?, night_prefs?}.
     */
    public static function setAvailability(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $mid = (int)($d['member_id'] ?? 0); $season = (string)($d['season'] ?? ''); $pid = !empty($d['program_id']) ? (int)$d['program_id'] : null;
        if (!$mid || $season === '') return Http::error($res, 'member_id and season required', 422);
        $willing = in_array($d['mentor_willing'] ?? null, ['lead', 'assist', 'admin', 'no'], true) ? $d['mentor_willing'] : null;
        $flexible = !empty($d['flexible']) ? 1 : 0;
        $prefs = isset($d['night_prefs']) && is_array($d['night_prefs']) ? json_encode($d['night_prefs']) : null;
        $now = gmdate('Y-m-d H:i:s');
        $pdo->prepare("INSERT INTO season_availability (member_id, season, program_id, mentor_willing, flexible, night_prefs, submitted_by_id, submitted_at)
                VALUES (?,?,?,?,?,?,?,?)
                ON DUPLICATE KEY UPDATE mentor_willing=VALUES(mentor_willing), flexible=VALUES(flexible),
                    night_prefs=VALUES(night_prefs), submitted_by_id=VALUES(submitted_by_id), submitted_at=VALUES(submitted_at)")
            ->execute([$mid, $season, $pid, $willing, $flexible, $prefs, (int)$m['id'], $now]);
        return Http::json($res, ['ok' => true]);
    }

    /** POST /season-planning/board/seed — carry forward last season's teams as a starting point. */
    public static function seedBoard(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = (string)($d['season'] ?? ''); $pid = (int)($d['program_id'] ?? 0);
        if ($season === '' || !$pid) return Http::error($res, 'season and program_id required', 422);
        // A night to drop the carried teams onto (admin re-assigns nights after).
        $firstNight = (int)($pdo->query("SELECT id FROM program_nights WHERE program_id = $pid AND season = " . $pdo->quote($season) . " AND is_active = 1 ORDER BY display_order, id LIMIT 1")->fetchColumn() ?: 0);
        if (!$firstNight) return Http::error($res, 'Add at least one night before seeding.', 422);
        if (self::bucketIds($pdo, $season, $pid)) return Http::error($res, 'The board already has teams — clear them first to re-seed.', 409);

        // Prefer the season we're planning if it ALREADY has rostered teams (someone
        // assigned youth directly) — start from those. Otherwise carry last season forward.
        $cStmt = $pdo->prepare("SELECT COUNT(*) FROM team_member_assignments tma
             JOIN team_seasons ts ON ts.id = tma.team_season_id
             JOIN teams t ON t.id = ts.team_id
             WHERE ts.season = ? AND t.program_id = ? AND (tma.status IS NULL OR tma.status <> 'inactive')");
        $cStmt->execute([$season, $pid]);
        $hasCurrent = (int)$cStmt->fetchColumn() > 0;
        $sourceSeason = $hasCurrent ? $season : self::priorSeason($season);

        // Teams for THIS program in the source season (season-scoped rosters carry over).
        $ts = $pdo->prepare("SELECT ts.id, ts.team_id, ts.team_name, t.team_number
                             FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
                             WHERE ts.season = ? AND t.program_id = ? ORDER BY t.team_number");
        $ts->execute([$sourceSeason, $pid]);
        $teamsCreated = 0; $placed = 0;
        foreach ($ts->fetchAll() as $row) {
            $label = trim(($row['team_number'] ? '#' . $row['team_number'] . ' ' : '') . ($row['team_name'] ?? '')) ?: 'Team';
            $pdo->prepare("INSERT INTO plan_night_teams (season, program_id, night_id, label, based_on_team_id, display_order) VALUES (?,?,?,?,?,?)")
                ->execute([$season, $pid, $firstNight, $label, (int)$row['team_id'], $teamsCreated + 1]);
            $bucketId = (int)$pdo->lastInsertId();
            // Carry returning, still-active members (skip roster spots marked inactive).
            $mem = $pdo->prepare("SELECT tma.member_id, mm.member_type FROM team_member_assignments tma JOIN members mm ON mm.id = tma.member_id
                                  WHERE tma.team_season_id = ? AND (mm.is_active = 1 OR mm.is_active IS NULL)
                                    AND (tma.status IS NULL OR tma.status <> 'inactive')");
            $mem->execute([(int)$row['id']]);
            foreach ($mem->fetchAll() as $mp) {
                $role = $mp['member_type'] === 'youth' ? 'youth' : 'lead';
                try { $pdo->prepare("INSERT INTO plan_placements (plan_night_team_id, member_id, role) VALUES (?,?,?)")->execute([$bucketId, (int)$mp['member_id'], $role]); $placed++; }
                catch (\Throwable $e) { /* member already placed on another carried team — skip */ }
            }
            $teamsCreated++;
        }
        Audit::write($pdo, (int)$m['id'], 'plan_night_teams', null, 'season.seed_board', null, ['season' => $season, 'source_season' => $sourceSeason, 'teams' => $teamsCreated, 'placed' => $placed]);
        return Http::json($res, ['ok' => true, 'teams_created' => $teamsCreated, 'members_placed' => $placed, 'from_season' => $sourceSeason, 'source' => $hasCurrent ? 'current' : 'prior']);
    }

    /** FLL first-team size cap: Challenge (program 2) = 10 students, Explore (1) = 6. */
    private static function teamMax(int $programId): int { return $programId === 2 ? 10 : 6; }

    private static function nightOk(?array $av, int $nightId): bool
    {
        if (!$av) return true;                       // no answer on file — don't block
        if (!empty($av['flexible'])) return true;
        $prefs = is_array($av['night_prefs'] ?? null) ? $av['night_prefs'] : [];
        return ($prefs[(string)$nightId] ?? $prefs[$nightId] ?? 'ok') !== 'no';
    }

    private static function nightWeight(?array $av, int $nightId): int
    {
        if (!$av) return 1;
        $prefs = is_array($av['night_prefs'] ?? null) ? $av['night_prefs'] : [];
        $p = $prefs[(string)$nightId] ?? $prefs[$nightId] ?? 'ok';
        return $p === 'preferred' ? 2 : ($p === 'no' ? -1 : 1);
    }

    /**
     * POST /season-planning/board/suggest — fill the existing buckets from availability.
     * Non-destructive: only unplaced members are added, existing placements are kept.
     * Respects night availability, per-team size caps, siblings-together, and assigns
     * YPT-compliant willing mentors as leads (then a second adult where possible).
     */
    public static function suggest(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = (string)($d['season'] ?? ''); $pid = (int)($d['program_id'] ?? 0);
        if ($season === '' || !$pid) return Http::error($res, 'season and program_id required', 422);
        $teamMax = self::teamMax($pid);

        // Buckets for this season+program (must already exist — seed or add first).
        $bStmt = $pdo->prepare("SELECT id, night_id, label FROM plan_night_teams WHERE season = ? AND program_id = ? AND is_holding = 0 ORDER BY night_id, display_order, id");
        $bStmt->execute([$season, $pid]);
        $buckets = $bStmt->fetchAll();
        if (!$buckets) return Http::error($res, 'Add or seed teams before auto-suggesting.', 422);

        // Current placements → per-bucket counts + who is already placed.
        $placed = []; $bucket = [];
        foreach ($buckets as $b) {
            $bid = (int)$b['id'];
            $bucket[$bid] = ['id' => $bid, 'night_id' => (int)$b['night_id'], 'youth' => 0, 'adults' => 0, 'lead' => false];
        }
        foreach ($pdo->query("SELECT pp.plan_night_team_id bid, pp.member_id, pp.role, ar.ypt_complete, ar.background_check_complete, mm.member_type
                              FROM plan_placements pp JOIN members mm ON mm.id = pp.member_id
                              LEFT JOIN adult_roles ar ON ar.member_id = pp.member_id
                              WHERE pp.plan_night_team_id IN (" . implode(',', array_keys($bucket)) . ")") as $p) {
            $placed[(int)$p['member_id']] = true;
            $bid = (int)$p['bid'];
            if (($p['member_type'] ?? '') === 'youth') $bucket[$bid]['youth']++;
            else {
                $bucket[$bid]['adults']++;
                if ($p['role'] === 'lead' && (bool)$p['ypt_complete'] && (bool)$p['background_check_complete']) $bucket[$bid]['lead'] = true;
            }
        }

        // Pool: unplaced active youth/adults with availability, YPT, and family (for siblings).
        $poolStmt = $pdo->prepare(
            "SELECT m.id, m.member_type, ar.ypt_complete, ar.background_check_complete,
                    sa.mentor_willing, sa.flexible, sa.night_prefs,
                    (SELECT family_id FROM family_members fm WHERE fm.member_id = m.id LIMIT 1) family_id
             FROM members m
             LEFT JOIN adult_roles ar ON ar.member_id = m.id
             LEFT JOIN season_availability sa ON sa.member_id = m.id AND sa.season = ? AND (sa.program_id <=> ?)
             WHERE (m.is_active = 1 OR m.is_active IS NULL) AND m.member_type IN ('youth','mentor','parent','volunteer')");
        $poolStmt->execute([$season, $pid]);
        $youthByFamily = []; $adults = [];
        foreach ($poolStmt->fetchAll() as $r) {
            $mid = (int)$r['id'];
            if (isset($placed[$mid])) continue;
            $av = ['flexible' => (bool)$r['flexible'], 'night_prefs' => $r['night_prefs'] ? json_decode((string)$r['night_prefs'], true) : [], 'mentor_willing' => $r['mentor_willing']];
            $hasAny = $r['flexible'] !== null || $r['night_prefs'] !== null || $r['mentor_willing'] !== null;
            $rec = ['id' => $mid, 'av' => $hasAny ? $av : null,
                    'ypt' => (bool)$r['ypt_complete'] && (bool)$r['background_check_complete'], 'willing' => $r['mentor_willing']];
            if ($r['member_type'] === 'youth') $youthByFamily[(int)($r['family_id'] ?: -$mid)][] = $rec;
            else $adults[] = $rec;
        }

        $addPlacement = function (int $bid, int $mid, string $role) use ($pdo) {
            $pdo->prepare("INSERT INTO plan_placements (plan_night_team_id, member_id, role) VALUES (?,?,?)")->execute([$bid, $mid, $role]);
        };

        // Pick the best bucket for a group of `size` youths who share availability `av`.
        $pickBucket = function (?array $av, int $size) use (&$bucket, $teamMax) {
            $best = null; $bestScore = PHP_INT_MIN;
            foreach ($bucket as $b) {
                if ($b['youth'] + $size > $teamMax) continue;
                if (!self::nightOk($av, $b['night_id'])) continue;
                // Prefer the member's preferred night, then the emptier team (balance).
                $score = self::nightWeight($av, $b['night_id']) * 100 - $b['youth'];
                if ($score > $bestScore) { $bestScore = $score; $best = $b['id']; }
            }
            return $best;
        };

        $placedYouth = 0; $placedAdults = 0;
        // Youth, siblings first (larger family groups get a bucket while room exists).
        uasort($youthByFamily, fn($a, $b) => count($b) <=> count($a));
        foreach ($youthByFamily as $sibs) {
            $av = $sibs[0]['av']; // siblings share a family answer in the common case
            $bid = count($sibs) > 1 ? $pickBucket($av, count($sibs)) : null;
            if ($bid !== null) { // whole sibling group into one team
                foreach ($sibs as $y) { $addPlacement($bid, $y['id'], 'youth'); $placed[$y['id']] = true; $placedYouth++; }
                $bucket[$bid]['youth'] += count($sibs);
            } else {
                foreach ($sibs as $y) {
                    $one = $pickBucket($y['av'], 1);
                    if ($one === null) continue; // no room / no acceptable night — leave in pool
                    $addPlacement($one, $y['id'], 'youth'); $placed[$y['id']] = true; $placedYouth++; $bucket[$one]['youth']++;
                }
            }
        }

        // Leads: teams with youth but no compliant lead → a willing YPT-clear mentor who can do that night.
        foreach ($bucket as &$b) {
            if ($b['youth'] === 0 || $b['lead']) continue;
            foreach ($adults as $i => $a) {
                if (!$a['ypt'] || $a['willing'] !== 'lead') continue;
                if (!self::nightOk($a['av'], $b['night_id'])) continue;
                $addPlacement($b['id'], $a['id'], 'lead'); $placed[$a['id']] = true; $placedAdults++;
                $b['adults']++; $b['lead'] = true; unset($adults[$i]); break;
            }
        }
        unset($b);
        // Second adult (assist): teams with a lead but only one adult → a willing helper for that night.
        foreach ($bucket as &$b) {
            if ($b['youth'] === 0 || $b['adults'] >= 2) continue;
            foreach ($adults as $i => $a) {
                if (!in_array($a['willing'], ['lead', 'assist'], true)) continue;
                if (!self::nightOk($a['av'], $b['night_id'])) continue;
                $addPlacement($b['id'], $a['id'], 'assist'); $placed[$a['id']] = true; $placedAdults++;
                $b['adults']++; unset($adults[$i]); break;
            }
        }
        unset($b);

        Audit::write($pdo, (int)$m['id'], 'plan_placements', null, 'season.suggest', null, ['season' => $season, 'program_id' => $pid, 'youth' => $placedYouth, 'adults' => $placedAdults]);
        return Http::json($res, ['ok' => true, 'youth_placed' => $placedYouth, 'adults_placed' => $placedAdults]);
    }

    private static function roleLabel(string $role): string
    {
        return $role === 'lead' ? 'Coach' : ($role === 'assist' ? 'Assistant Coach' : 'Student');
    }

    /**
     * POST /season-planning/board/publish — materialize the plan onto the EXISTING team
     * pages (team_seasons) for this program. Reuses each carried-forward team via
     * based_on_team_id; creates only the season row for that existing team (never a new
     * team). Buckets with no linked team page are skipped and reported back.
     */
    public static function publish(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = (string)($d['season'] ?? ''); $pid = (int)($d['program_id'] ?? 0);
        if ($season === '' || !$pid) return Http::error($res, 'season and program_id required', 422);

        $bStmt = $pdo->prepare("SELECT id, label, based_on_team_id FROM plan_night_teams WHERE season = ? AND program_id = ? AND is_holding = 0 ORDER BY display_order, id");
        $bStmt->execute([$season, $pid]);
        $buckets = $bStmt->fetchAll();
        if (!$buckets) return Http::error($res, 'Nothing to publish — the board is empty.', 422);

        $dateJoined = preg_match('/^(\d{4})/', $season, $mm) ? $mm[1] . '-07-01' : null;
        $teamsWritten = 0; $membersWritten = 0; $unmapped = [];

        foreach ($buckets as $b) {
            $teamId = $b['based_on_team_id'] !== null ? (int)$b['based_on_team_id'] : 0;
            // A bucket added by typing a team number (rather than seeded from an existing
            // team) has no based_on_team_id, so it used to be skipped even when a matching
            // team page already exists. Match it to an existing team of THIS program by the
            // number in its label (e.g. "#33451" / "33451 Titans"), and remember the link so
            // future publishes/auto-suggest reuse it. Still never CREATES a team.
            if (!$teamId && preg_match('/(\d{3,})/', (string)$b['label'], $mnum)) {
                $tm = $pdo->prepare("SELECT id FROM teams WHERE team_number = ? AND program_id = ? LIMIT 1");
                $tm->execute([$mnum[1], $pid]);
                $teamId = (int)($tm->fetchColumn() ?: 0);
                if ($teamId) {
                    $pdo->prepare("UPDATE plan_night_teams SET based_on_team_id = ? WHERE id = ?")->execute([$teamId, (int)$b['id']]);
                }
            }
            if (!$teamId) { $unmapped[] = $b['label'] ?: 'Team'; continue; }

            // Ensure the EXISTING team has a season row (reuse the team page; don't create a team).
            $ts = $pdo->prepare("SELECT id FROM team_seasons WHERE team_id = ? AND season = ? LIMIT 1");
            $ts->execute([$teamId, $season]);
            $tsId = (int)($ts->fetchColumn() ?: 0);
            if (!$tsId) {
                $name = $pdo->prepare("SELECT team_name FROM team_seasons WHERE team_id = ? ORDER BY season DESC LIMIT 1");
                $name->execute([$teamId]);
                $teamName = $name->fetchColumn() ?: null;
                $pdo->prepare("INSERT INTO team_seasons (team_id, season, team_name, status) VALUES (?,?,?, 'active')")->execute([$teamId, $season, $teamName]);
                $tsId = (int)$pdo->lastInsertId();
            }

            $ps = $pdo->prepare("SELECT member_id, role FROM plan_placements WHERE plan_night_team_id = ?");
            $ps->execute([(int)$b['id']]);
            foreach ($ps->fetchAll() as $p) {
                $mid = (int)$p['member_id']; $roleLabel = self::roleLabel((string)$p['role']);
                $ex = $pdo->prepare("SELECT id FROM team_member_assignments WHERE team_season_id = ? AND member_id = ? LIMIT 1");
                $ex->execute([$tsId, $mid]);
                $exId = (int)($ex->fetchColumn() ?: 0);
                if ($exId) {
                    $pdo->prepare("UPDATE team_member_assignments SET status = 'active', primary_role = ?, date_left = NULL WHERE id = ?")->execute([$roleLabel, $exId]);
                } else {
                    $pdo->prepare("INSERT INTO team_member_assignments (team_season_id, member_id, date_joined, status, primary_role) VALUES (?,?,?, 'active', ?)")
                        ->execute([$tsId, $mid, $dateJoined, $roleLabel]);
                }
                $membersWritten++;
            }
            $teamsWritten++;
        }

        Audit::write($pdo, (int)$m['id'], 'team_seasons', null, 'season.publish_plan', null,
            ['season' => $season, 'program_id' => $pid, 'teams' => $teamsWritten, 'members' => $membersWritten, 'unmapped' => count($unmapped)]);
        return Http::json($res, ['ok' => true, 'teams_written' => $teamsWritten, 'members_written' => $membersWritten, 'unmapped' => $unmapped]);
    }

    /** POST /season-planning/invites — create tokens + email the availability form to families. */
    public static function sendInvites(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::admin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $season = (string)($d['season'] ?? ''); $pid = !empty($d['program_id']) ? (int)$d['program_id'] : null;
        if ($season === '') return Http::error($res, 'season is required', 422);
        $familyIds = array_values(array_filter(array_map('intval', (array)($d['family_ids'] ?? []))));
        if (!$familyIds) return Http::error($res, 'Select at least one family.', 422);

        $base = rtrim((string)(Config::get('APP_URL') ?: ''), '/');
        $expires = gmdate('Y-m-d H:i:s', time() + 60 * 60 * 24 * 60); // 60 days
        $sent = 0; $skipped = [];
        foreach ($familyIds as $fid) {
            // Guardians' emails on this family.
            $gs = $pdo->prepare(
                "SELECT DISTINCT m.email, m.first_name FROM family_members fm JOIN members m ON m.id = fm.member_id
                 WHERE fm.family_id = ? AND m.member_type IN ('parent','mentor','volunteer') AND m.email IS NOT NULL AND m.email <> ''"
            );
            $gs->execute([$fid]);
            $recips = $gs->fetchAll();
            if (!$recips) { $skipped[] = $fid; continue; }
            $token = bin2hex(random_bytes(20));
            $pdo->prepare("INSERT INTO availability_invites (token, family_id, season, program_id, sent_to, expires_at, created_by_id) VALUES (?,?,?,?,?,?,?)")
                ->execute([$token, $fid, $season, $pid, implode(', ', array_column($recips, 'email')), $expires, (int)$m['id']]);
            $link = $base . '/season-availability/' . $token;
            if (Mailer::enabled()) {
                foreach ($recips as $r) {
                    $html = "<p>Hi " . htmlspecialchars($r['first_name'] ?: 'there') . ",</p>"
                        . "<p>We're planning the upcoming FLL season and need to know which evenings your family is available and whether any parents can help mentor. It only takes a minute, and no login is needed.</p>"
                        . "<p><a href=\"" . htmlspecialchars($link) . "\">Open your family's availability form &raquo;</a></p>"
                        . "<p>Anyone in your family can use this link — if another parent has already filled it in, you'll see their answers and can add your own.</p>"
                        . "<p>Thank you!<br>Tulsa Robotics Center</p>";
                    Mailer::send($r['email'], 'TRC — Tell us your FLL season availability', $html);
                }
            }
            $sent++;
        }
        Audit::write($pdo, (int)$m['id'], 'availability_invites', null, 'season.send_invites', null, ['season' => $season, 'families' => $sent]);
        return Http::json($res, ['ok' => true, 'sent' => $sent, 'skipped_no_email' => $skipped, 'email_enabled' => Mailer::enabled()]);
    }
}
