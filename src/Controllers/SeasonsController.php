<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/seasons/router.py — FIRST seasons + member participation. */
final class SeasonsController
{
    private static function serializeSeason(array $s): array
    {
        return [
            'id' => (int)$s['id'],
            'season' => $s['season'],
            'theme' => $s['theme'],
            'fll_explore_game' => $s['fll_explore_game'],
            'fll_challenge_game' => $s['fll_challenge_game'],
            'ftc_game' => $s['ftc_game'],
            'frc_game' => $s['frc_game'],
            'fdp_game' => $s['fdp_game'],
            'notes' => $s['notes'],
            'display_order' => $s['display_order'] !== null ? (int)$s['display_order'] : 0,
        ];
    }

    public static function list(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $rows = $pdo->query("SELECT * FROM first_seasons ORDER BY season DESC")->fetchAll();
        return Http::json($res, array_map([self::class, 'serializeSeason'], $rows));
    }

    public static function create(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needRole($pdo, $req, [])) return $e($res);
        $actor = Auth::currentMember($pdo, $req);
        $d = (array)$req->getParsedBody();
        if (empty($d['season'])) return Http::error($res, 'season is required', 422);
        $chk = $pdo->prepare("SELECT 1 FROM first_seasons WHERE season = ?"); $chk->execute([$d['season']]);
        if ($chk->fetch()) return Http::error($res, 'Season already exists', 400);
        $cols = ['season', 'theme', 'fll_explore_game', 'fll_challenge_game', 'ftc_game', 'frc_game', 'fdp_game', 'notes', 'display_order'];
        $f = []; $ph = []; $args = [];
        foreach ($cols as $c) { if (array_key_exists($c, $d)) { $f[] = $c; $ph[] = '?'; $args[] = $d[$c]; } }
        $stmt = $pdo->prepare("INSERT INTO first_seasons (" . implode(',', $f) . ") VALUES (" . implode(',', $ph) . ")");
        $stmt->execute($args);
        $sid = (int)$pdo->lastInsertId();
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'first_seasons', $sid, 'create', null, $d);
        $rs = $pdo->prepare("SELECT * FROM first_seasons WHERE id = ?"); $rs->execute([$sid]);
        return Http::json($res, self::serializeSeason($rs->fetch()), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needRole($pdo, $req, [])) return $e($res);
        $actor = Auth::currentMember($pdo, $req);
        $id = (int)$route['season_id'];
        $cur = $pdo->prepare("SELECT 1 FROM first_seasons WHERE id = ?"); $cur->execute([$id]);
        if (!$cur->fetch()) return Http::error($res, 'Season not found', 404);
        $d = (array)$req->getParsedBody();
        $cols = ['theme', 'fll_explore_game', 'fll_challenge_game', 'ftc_game', 'frc_game', 'fdp_game', 'notes', 'display_order'];
        $set = []; $args = [];
        foreach ($cols as $c) if (array_key_exists($c, $d) && $d[$c] !== null) { $set[] = "$c = ?"; $args[] = $d[$c]; }
        if ($set) { $args[] = $id; $pdo->prepare("UPDATE first_seasons SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
            Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'first_seasons', $id, 'update', null, $d); }
        $stmt = $pdo->prepare("SELECT * FROM first_seasons WHERE id = ?"); $stmt->execute([$id]);
        return Http::json($res, self::serializeSeason($stmt->fetch()));
    }

    public static function delete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if ($e = self::needRole($pdo, $req, [], true)) return $e($res);  // sysadmin only
        $actor = Auth::currentMember($pdo, $req);
        $id = (int)$route['season_id'];
        $cur = $pdo->prepare("SELECT 1 FROM first_seasons WHERE id = ?"); $cur->execute([$id]);
        if (!$cur->fetch()) return Http::error($res, 'Season not found', 404);
        $pdo->prepare("DELETE FROM first_seasons WHERE id = ?")->execute([$id]);
        Audit::write($pdo, $actor ? (int)$actor['id'] : null, 'first_seasons', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    private static function calcExperience(PDO $pdo, int $memberId): int
    {
        $stmt = $pdo->prepare(
            "SELECT count(*) AS c FROM member_season_participation
             WHERE member_id = ? AND (participated_fll_explore OR participated_fll_challenge
                   OR participated_ftc OR participated_frc OR participated_fdp)"
        );
        $stmt->execute([$memberId]);
        return (int)$stmt->fetch()['c'];
    }

    private static function serializePart(array $p, array $s): array
    {
        $flags = ['participated_fll_explore', 'participated_fll_challenge', 'participated_ftc', 'participated_frc', 'participated_fdp'];
        $hasP = false;
        foreach ($flags as $f) if (!empty($p[$f])) $hasP = true;
        return [
            'id' => $p['id'] !== null ? (int)$p['id'] : null,
            'member_id' => (int)$p['member_id'],
            'season_id' => (int)$p['season_id'],
            'season' => $s['season'], 'theme' => $s['theme'],
            'fll_explore_game' => $s['fll_explore_game'], 'fll_challenge_game' => $s['fll_challenge_game'],
            'ftc_game' => $s['ftc_game'], 'frc_game' => $s['frc_game'], 'fdp_game' => $s['fdp_game'],
            'participated_fll_explore' => (bool)$p['participated_fll_explore'],
            'participated_fll_challenge' => (bool)$p['participated_fll_challenge'],
            'participated_ftc' => (bool)$p['participated_ftc'],
            'participated_frc' => (bool)$p['participated_frc'],
            'participated_fdp' => (bool)$p['participated_fdp'],
            'has_participation' => $hasP, 'notes' => $p['notes'],
        ];
    }

    public static function memberParticipation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $memberId = (int)$route['member_id'];
        if ($m['id'] != $memberId && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            && !MembersController::isFamilyParentOf($pdo, $m, $memberId)) return Http::error($res, 'Access denied', 403);

        $seasons = $pdo->query("SELECT * FROM first_seasons ORDER BY season DESC")->fetchAll();
        $pstmt = $pdo->prepare("SELECT * FROM member_season_participation WHERE member_id = ?");
        $pstmt->execute([$memberId]);
        $byseason = [];
        foreach ($pstmt->fetchAll() as $p) $byseason[(int)$p['season_id']] = $p;

        $out = [];
        foreach ($seasons as $s) {
            $p = $byseason[(int)$s['id']] ?? null;
            if ($p) {
                $out[] = self::serializePart($p, $s);
            } else {
                $out[] = [
                    'id' => null, 'member_id' => $memberId, 'season_id' => (int)$s['id'],
                    'season' => $s['season'], 'theme' => $s['theme'],
                    'fll_explore_game' => $s['fll_explore_game'], 'fll_challenge_game' => $s['fll_challenge_game'],
                    'ftc_game' => $s['ftc_game'], 'frc_game' => $s['frc_game'], 'fdp_game' => $s['fdp_game'],
                    'participated_fll_explore' => false, 'participated_fll_challenge' => false,
                    'participated_ftc' => false, 'participated_frc' => false, 'participated_fdp' => false,
                    'has_participation' => false, 'notes' => null,
                ];
            }
        }
        return Http::json($res, ['experience_years' => self::calcExperience($pdo, $memberId), 'seasons' => $out]);
    }

    public static function upsertParticipation(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $memberId = (int)$route['member_id']; $seasonId = (int)$route['season_id'];
        if ($m['id'] != $memberId && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])
            && !MembersController::isFamilyParentOf($pdo, $m, $memberId)) return Http::error($res, 'Access denied', 403);

        $sx = $pdo->prepare("SELECT * FROM first_seasons WHERE id = ?"); $sx->execute([$seasonId]);
        $season = $sx->fetch();
        if (!$season) return Http::error($res, 'Season not found', 404);

        $d = (array)$req->getParsedBody();
        // Postgres boolean params: bind as 0/1 (PDO binds PHP false as '' → error).
        $b = fn($k) => (!empty($d[$k]) && $d[$k] !== 'false') ? 1 : 0;
        $flags = ['participated_fll_explore', 'participated_fll_challenge', 'participated_ftc', 'participated_frc', 'participated_fdp'];
        $ex = $pdo->prepare("SELECT * FROM member_season_participation WHERE member_id = ? AND season_id = ?");
        $ex->execute([$memberId, $seasonId]);
        $p = $ex->fetch();
        if ($p) {
            $set = []; $args = [];
            foreach ($flags as $f) { $set[] = "$f = ?"; $args[] = $b($f); }
            if (array_key_exists('notes', $d)) { $set[] = "notes = ?"; $args[] = $d['notes']; }
            $args[] = $p['id'];
            $pdo->prepare("UPDATE member_season_participation SET " . implode(',', $set) . " WHERE id = ?")->execute($args);
            $pid = (int)$p['id'];
            Audit::write($pdo, (int)$m['id'], 'member_season_participation', $pid, 'update', null, $d);
        } else {
            $cols = array_merge(['member_id', 'season_id'], $flags, ['notes']);
            $vals = array_merge([$memberId, $seasonId], array_map($b, $flags), [$d['notes'] ?? null]);
            $st = $pdo->prepare("INSERT INTO member_season_participation (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")");
            $st->execute($vals);
            $pid = (int)$pdo->lastInsertId();
            Audit::write($pdo, (int)$m['id'], 'member_season_participation', $pid, 'create', null, $d);
        }
        // sync member experience cache
        $years = self::calcExperience($pdo, $memberId);
        $pdo->prepare("UPDATE members SET robotics_experience_years = ? WHERE id = ?")->execute([$years, $memberId]);

        $fin = $pdo->prepare("SELECT * FROM member_season_participation WHERE id = ?"); $fin->execute([$pid]);
        return Http::json($res, ['participation' => self::serializePart($fin->fetch(), $season), 'experience_years' => $years]);
    }

    /** Returns a closure(Response):Response when the role check fails, else null. */
    private static function needRole(PDO $pdo, Request $req, array $roles, bool $sysAdminOnly = false): ?callable
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return fn(Response $r) => Http::error($r, 'Invalid token', 401);
        $ok = $sysAdminOnly
            ? in_array('System Administrator', Permissions::effectiveRolesFor($pdo, $m), true)
            : Permissions::hasAnyRole($pdo, $m, $roles);
        if (!$ok) return fn(Response $r) => Http::error($r, 'You do not have permission to perform this action', 403);
        return null;
    }
}
