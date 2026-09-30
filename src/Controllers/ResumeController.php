<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Grade;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Resume builder for youth.
 *
 * A guided questionnaire whose answers, combined with facts the system already holds
 * (school, grade, TRC teams, FIRST seasons, certifications, whether reflections are
 * done), render a one-page printable resume. Every youth can build their own; a
 * parent/guardian and the Dev Program manager can view it.
 *
 * Answers are a JSON blob keyed by question, so the catalog below can grow without a
 * schema change. Skills and positions come from system_config so they're admin-editable.
 */
final class ResumeController
{
    /**
     * The question catalog. `type` drives the input: 'text' (short), 'textarea' (long),
     * 'number', 'skills' (checkbox list from config), 'positions' (checkbox list from
     * config). `pulled` questions are answered from system data, shown read-only.
     */
    private const QUESTIONS = [
        ['key' => 'objective',        'label' => 'Career / college goals', 'type' => 'textarea',
            'help' => 'A sentence or two on what you want to study or do. This becomes the summary at the top of your resume.'],
        ['key' => 'colleges',         'label' => 'Colleges or trade schools you\'re interested in', 'type' => 'textarea',
            'help' => 'List any schools you\'re considering.'],
        ['key' => 'positions',        'label' => 'Position(s) you\'re looking for on a team', 'type' => 'positions'],
        ['key' => 'experience_years', 'label' => 'Years of experience in robotics', 'type' => 'number'],
        ['key' => 'skills',           'label' => 'Skills you\'ve developed', 'type' => 'skills'],
        ['key' => 'leadership',       'label' => 'Leadership roles or responsibilities you\'ve held', 'type' => 'textarea',
            'help' => 'Team captain, subteam lead, mentoring younger youth, running an event…'],
        ['key' => 'awards_robotics',  'label' => 'Awards earned through robotics', 'type' => 'textarea'],
        ['key' => 'awards_other',     'label' => 'Awards earned outside of robotics', 'type' => 'textarea'],
        ['key' => 'projects',         'label' => 'Personal projects (completed or in progress)', 'type' => 'textarea'],
        ['key' => 'community',        'label' => 'Volunteer / community service', 'type' => 'textarea',
            'help' => 'What you did, and roughly how many hours.'],
        ['key' => 'outreach',         'label' => 'Outreach, demos and competitions you\'ve taken part in', 'type' => 'textarea'],
        ['key' => 'organizations',    'label' => 'Other organizations you\'re part of', 'type' => 'textarea'],
        ['key' => 'gpa',              'label' => 'GPA', 'type' => 'text'],
        ['key' => 'languages',        'label' => 'Foreign languages studied (note any you\'re fluent in)', 'type' => 'textarea'],
    ];

    private static function canManage(PDO $pdo, array $m): bool
    {
        return Permissions::memberCan($pdo, $m, 'fdp.manage', 'write');
    }

    /** May this actor mark ANOTHER member's resume complete? Role-configurable. */
    private static function canMarkComplete(PDO $pdo, array $m): bool
    {
        return Permissions::memberCan($pdo, $m, 'resume.mark_complete', 'write');
    }

    /**
     * May this actor VIEW another member's resume? Two kinds of access:
     *  • Role-configurable (Admin → Role Management): resume.view_others, plus the FDP
     *    manager permission fdp.manage. NO role names are hardcoded.
     *  • Fixed relationships (not roles, so not Role-Management-configurable): self, a
     *    guardian, a member of the team the youth has an open interview with, and a youth
     *    already on a team viewing an FDP-eligible candidate.
     */
    private static function canView(PDO $pdo, array $actor, int $memberId): bool
    {
        $aid = (int)$actor['id'];
        if ($aid === $memberId) return true;                                            // self
        if (MembersController::isFamilyParentOf($pdo, $actor, $memberId)) return true;   // guardian
        if (self::canManage($pdo, $actor)) return true;                                 // FDP manager (fdp.manage)
        if (Permissions::memberCan($pdo, $actor, 'resume.view_others', 'read')) return true; // configurable staff view
        if (self::onInterviewingTeam($pdo, $aid, $memberId)) return true;               // on the interviewing team
        if (self::actorOnAnyTeam($pdo, $aid) && self::isFdpEligible($pdo, $memberId)) return true; // team youth ↔ eligible candidate
        return false;
    }

    /** $actor is on the current roster of a team the youth has an open (requested/scheduled) FDP interview with. */
    private static function onInterviewingTeam(PDO $pdo, int $actorId, int $youthId): bool
    {
        $s = $pdo->prepare(
            "SELECT 1 FROM fdp_interviews i
               JOIN team_member_assignments tma
                 ON tma.team_season_id = i.team_season_id AND tma.date_left IS NULL
              WHERE i.member_id = ? AND i.status IN ('requested', 'scheduled')
                AND tma.member_id = ? LIMIT 1");
        $s->execute([$youthId, $actorId]);
        return (bool)$s->fetchColumn();
    }

    /** $actor is currently on any team. */
    private static function actorOnAnyTeam(PDO $pdo, int $actorId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM team_member_assignments WHERE member_id = ? AND date_left IS NULL LIMIT 1");
        $s->execute([$actorId]);
        return (bool)$s->fetchColumn();
    }

    /** Youth has completed FDP requirements this season (active membership + board review passed). */
    private static function isFdpEligible(PDO $pdo, int $youthId): bool
    {
        $year = \App\Core\EnrollmentService::currentEnrollmentYear();
        $s = $pdo->prepare(
            "SELECT 1 FROM fdp_progress p
               JOIN fdp_memberships f ON f.member_id = p.member_id AND f.enrollment_year = ? AND f.status = 'active'
              WHERE p.member_id = ? AND p.board_review_outcome = 'passed' LIMIT 1");
        $s->execute([$year, $youthId]);
        return (bool)$s->fetchColumn();
    }

    private static function configList(PDO $pdo, string $cat, array $default): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([$cat]);
        $v = ($r = $s->fetch()) ? json_decode((string)$r['values'], true) : null;
        return (is_array($v) && $v) ? array_values(array_filter(array_map('strval', $v))) : $default;
    }

    /** Facts pulled from system data, shown on the resume without the youth typing them. */
    private static function pulled(PDO $pdo, array $m): array
    {
        $mid = (int)$m['id'];
        $year = \App\Core\EnrollmentService::currentEnrollmentYear();

        // TRC teams (number + season), most recent first.
        $ts = $pdo->prepare(
            "SELECT DISTINCT t.team_number, ts.season, ts.team_name
               FROM team_member_assignments tma
               JOIN team_seasons ts ON ts.id = tma.team_season_id
               JOIN teams t ON t.id = ts.team_id
              WHERE tma.member_id = ?
              ORDER BY ts.season DESC");
        $ts->execute([$mid]);
        $teams = array_map(fn ($r) => [
            'team' => trim((string)$r['team_number'] . ($r['team_name'] ? ' · ' . $r['team_name'] : '')),
            'season' => $r['season'],
        ], $ts->fetchAll());

        // Distinct FIRST seasons participated (from team membership).
        $seasons = array_values(array_unique(array_map(fn ($t) => $t['season'], $teams)));

        // Completed certifications, by name.
        $cs = $pdo->prepare(
            "SELECT DISTINCT c.name FROM member_certifications mc
               JOIN certifications c ON c.id = mc.certification_id
              WHERE mc.member_id = ? AND mc.completed_date IS NOT NULL
              ORDER BY c.name");
        $cs->execute([$mid]);
        $certs = array_column($cs->fetchAll(), 'name');

        // Whether this youth has recorded any season reflections.
        $rf = $pdo->prepare("SELECT COUNT(*) FROM member_reflections WHERE member_id = ? AND answer IS NOT NULL AND answer <> ''");
        $rf->execute([$mid]);
        $reflectionsDone = (int)$rf->fetchColumn() > 0;

        $grade = $m['graduation_year'] !== null
            ? Grade::label(Grade::fromGraduationYear((int)$m['graduation_year'], $year)) : null;

        return [
            'name' => trim($m['first_name'] . ' ' . $m['last_name']),
            'grade_label' => $grade,
            'school' => $m['school'] ?: null,
            'email' => $m['email'] ?: null,
            'teams' => $teams,
            'first_seasons' => $seasons,
            'first_seasons_count' => count($seasons),
            'certifications' => $certs,
            'reflections_done' => $reflectionsDone,
        ];
    }

    private static function answersRow(PDO $pdo, int $memberId): array
    {
        $s = $pdo->prepare("SELECT * FROM resume_answers WHERE member_id = ?");
        $s->execute([$memberId]);
        $r = $s->fetch();
        $answers = ($r && $r['answers']) ? json_decode((string)$r['answers'], true) : [];
        return [
            'answers' => is_array($answers) ? $answers : [],
            'show_contact' => $r ? (bool)$r['show_contact'] : false,
            'uploaded_url' => ($r && $r['uploaded_url']) ? (string)$r['uploaded_url'] : null,
            'completed_at' => ($r && $r['completed_at']) ? Time::naiveIso($r['completed_at']) : null,
            'completed' => (bool)($r['completed_at'] ?? false),
        ];
    }

    /**
     * Does this member have a resume on file — either they finished the builder OR they
     * uploaded their own file. Both count for the FDP.
     */
    public static function isComplete(PDO $pdo, int $memberId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM resume_answers WHERE member_id = ? AND (completed_at IS NOT NULL OR (uploaded_url IS NOT NULL AND uploaded_url <> ''))");
        $s->execute([$memberId]);
        return (bool)$s->fetchColumn();
    }

    /** Which of these member ids have a resume on file. Batch of isComplete(). */
    public static function completedSet(PDO $pdo, array $memberIds): array
    {
        $ids = array_values(array_unique(array_map('intval', $memberIds)));
        if (!$ids) return [];
        $in = implode(',', array_fill(0, count($ids), '?'));
        $s = $pdo->prepare("SELECT member_id FROM resume_answers
                             WHERE member_id IN ($in)
                               AND (completed_at IS NOT NULL OR (uploaded_url IS NOT NULL AND uploaded_url <> ''))");
        $s->execute($ids);
        $out = [];
        foreach ($s->fetchAll() as $r) $out[(int)$r['member_id']] = true;
        return $out;
    }

    private static function payload(PDO $pdo, array $member): array
    {
        $data = self::answersRow($pdo, (int)$member['id']);
        return [
            'member_id' => (int)$member['id'],
            'questions' => self::QUESTIONS,
            'skill_options' => self::configList($pdo, 'resume_skills', []),
            'position_options' => self::configList($pdo, 'resume_positions', []),
            'answers' => $data['answers'],
            'show_contact' => $data['show_contact'],
            'uploaded_url' => $data['uploaded_url'],
            'completed' => $data['completed'],
            'completed_at' => $data['completed_at'],
            'pulled' => self::pulled($pdo, $member),
        ];
    }

    /** GET /resume/me — the signed-in youth's resume workspace. */
    public static function mine(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::payload($pdo, $m) + ['can_edit' => true]);
    }

    /** GET /resume/member/{member_id} — view a youth's resume (self, parent, manager). */
    public static function forMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if (!self::canView($pdo, $actor, $mid)) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $s->execute([$mid]);
        $m = $s->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);
        return Http::json($res, self::payload($pdo, $m) + [
            'can_edit' => ((int)$actor['id'] === $mid),
            'can_mark_complete' => self::canMarkComplete($pdo, $actor),
        ]);
    }

    /**
     * POST /resume/member/{member_id}/complete — a permitted staff member marks another
     * member's resume complete (as if built outside the system) or reopens it. Gated on
     * the role-configurable resume.mark_complete permission. Body: { complete?: bool }.
     */
    public static function markComplete(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canMarkComplete($pdo, $actor)) return Http::error($res, 'You do not have permission to mark resumes complete.', 403);
        $mid = (int)$route['member_id'];
        $ex = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ex->execute([$mid]);
        $m = $ex->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);
        $complete = array_key_exists('complete', (array)$req->getParsedBody()) ? (bool)((array)$req->getParsedBody())['complete'] : true;
        $pdo->prepare("INSERT INTO resume_answers (member_id, created_at) VALUES (?, NOW())
                       ON DUPLICATE KEY UPDATE member_id = member_id")->execute([$mid]);
        $pdo->prepare("UPDATE resume_answers SET completed_at = ?, updated_at = NOW() WHERE member_id = ?")
            ->execute([$complete ? date('Y-m-d H:i:s') : null, $mid]);
        \App\Core\Audit::write($pdo, (int)$actor['id'], 'resume_answers', $mid, $complete ? 'resume_mark_complete' : 'resume_reopen', null, ['member_id' => $mid]);
        return Http::json($res, self::payload($pdo, $m) + ['can_edit' => false, 'can_mark_complete' => true]);
    }

    /**
     * PUT /resume/member/{member_id}/uploaded-url — a permitted staff member (resume.mark_complete)
     * attaches an externally-built resume for a youth by link (#187), and marks it on file. An empty
     * url clears it. Prod can't host uploads, so this stores a hosted link (e.g. a Drive URL).
     */
    public static function setMemberUpload(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $actor = Auth::currentMember($pdo, $req);
        if (!$actor) return Http::error($res, 'Invalid token', 401);
        if (!self::canMarkComplete($pdo, $actor)) return Http::error($res, 'You do not have permission to manage resumes.', 403);
        $mid = (int)$route['member_id'];
        $ex = $pdo->prepare("SELECT * FROM members WHERE id = ?"); $ex->execute([$mid]);
        $m = $ex->fetch();
        if (!$m) return Http::error($res, 'Member not found', 404);

        $url = trim((string)(((array)$req->getParsedBody())['uploaded_url'] ?? ''));
        if ($url !== '' && !preg_match('#^https?://#i', $url)) {
            return Http::error($res, 'Enter a full link starting with http:// or https:// (e.g. a shared Drive link).', 422);
        }
        $pdo->prepare("INSERT INTO resume_answers (member_id, created_at) VALUES (?, NOW())
                       ON DUPLICATE KEY UPDATE member_id = member_id")->execute([$mid]);
        // Setting a link marks the resume on file; clearing it reopens.
        $pdo->prepare("UPDATE resume_answers SET uploaded_url = ?, completed_at = ?, updated_at = NOW() WHERE member_id = ?")
            ->execute([$url !== '' ? $url : null, $url !== '' ? date('Y-m-d H:i:s') : null, $mid]);
        \App\Core\Audit::write($pdo, (int)$actor['id'], 'resume_answers', $mid, 'resume_upload_for_member', null, ['member_id' => $mid, 'has_url' => $url !== '']);
        return Http::json($res, self::payload($pdo, $m) + ['can_edit' => false, 'can_mark_complete' => true]);
    }

    /**
     * PUT /resume/me — save the signed-in member's own answers. Youth and mentors may
     * build a resume. Body: { answers: {..}, show_contact?: bool, complete?: bool }
     */
    public static function save(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        if (!in_array($m['member_type'] ?? '', ['youth', 'mentor'], true)) {
            return Http::error($res, 'The resume builder is for youth and mentors.', 422);
        }
        $mid = (int)$m['id'];
        $d = (array)$req->getParsedBody();

        // Keep only known question keys; skills/positions are arrays, the rest strings.
        $known = array_column(self::QUESTIONS, 'type', 'key');
        $incoming = (array)($d['answers'] ?? []);
        $clean = [];
        foreach ($incoming as $k => $v) {
            if (!isset($known[$k])) continue;
            if (in_array($known[$k], ['skills', 'positions'], true)) {
                $clean[$k] = array_values(array_filter(array_map('strval', (array)$v), fn ($x) => $x !== ''));
            } else {
                $clean[$k] = trim((string)$v);
            }
        }

        $pdo->prepare("INSERT INTO resume_answers (member_id, created_at) VALUES (?, NOW())
                       ON DUPLICATE KEY UPDATE member_id = member_id")->execute([$mid]);

        $set = ['answers = ?']; $args = [json_encode($clean)];
        if (array_key_exists('show_contact', $d)) { $set[] = 'show_contact = ?'; $args[] = (int)(bool)$d['show_contact']; }
        if (array_key_exists('uploaded_url', $d)) {
            // The youth's own uploaded resume file (they built one, tweaked it elsewhere,
            // and re-uploaded). Empty string clears it.
            $u = trim((string)$d['uploaded_url']);
            $set[] = 'uploaded_url = ?'; $args[] = $u !== '' ? $u : null;
        }
        if (array_key_exists('complete', $d)) {
            // Marking complete stamps the time; un-marking clears it. This is the
            // "resume on file" signal, so it must be settable both ways.
            $set[] = 'completed_at = ?';
            $args[] = (bool)$d['complete'] ? date('Y-m-d H:i:s') : null;
        }
        $set[] = 'updated_at = NOW()';
        $args[] = $mid;
        $pdo->prepare("UPDATE resume_answers SET " . implode(', ', $set) . " WHERE member_id = ?")->execute($args);

        return Http::json($res, self::payload($pdo, $m) + ['can_edit' => true]);
    }

    /** GET /resume/skills — the skill + position option lists (for the form). */
    public static function options(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, [
            'skills' => self::configList($pdo, 'resume_skills', []),
            'positions' => self::configList($pdo, 'resume_positions', []),
        ]);
    }
}
