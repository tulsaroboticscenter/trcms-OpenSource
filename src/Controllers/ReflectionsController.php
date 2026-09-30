<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\EnrollmentService;
use App\Core\Http;
use App\Core\Permissions;
use App\Core\Time;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * "My Reflections" — a member's private answers to purpose/impact/growth questions
 * for the season, shown on their own profile.
 *
 * PRIVACY: deliberately narrow. Only the member themselves may read AND write their
 * own answers. Everyone else needs members.view_reflections (seeded to Admin /
 * System Administrator only) and gets READ access — mentors and parents are NOT
 * included by design, and no one but the member can edit their words.
 */
final class ReflectionsController
{
    /** Default question catalog; override wholesale via system_config 'reflection_questions'. */
    private const DEFAULT_QUESTIONS = [
        ['key' => 'accomplish',         'group' => 'My purpose',            'label' => 'What would I like to accomplish as a member of the TRC?'],
        ['key' => 'legacy',             'group' => 'My purpose',            'label' => 'What would I like my legacy at the TRC to be? When I graduate, what will I be remembered for?'],
        ['key' => 'after_trc',          'group' => 'My purpose',            'label' => 'Where do I want robotics to take me after TRC — college, a career, or something I want to carry with me?'],
        ['key' => 'impact_team',        'group' => 'My impact this season', 'label' => 'How will I impact my team this season?'],
        ['key' => 'impact_trc',         'group' => 'My impact this season', 'label' => 'How will I impact the TRC this season?'],
        ['key' => 'impact_community',   'group' => 'My impact this season', 'label' => 'How will I make an impact on the community this year?'],
        ['key' => 'help_someone',       'group' => 'My impact this season', 'label' => 'How will I help someone else on the team succeed?'],
        ['key' => 'skills',             'group' => 'My growth',             'label' => 'What skills do I want to develop this year?'],
        ['key' => 'growth_edge',        'group' => 'My growth',             'label' => 'What is one thing I want to get better at that feels hard, or a little scary?'],
        ['key' => 'success_looks_like', 'group' => 'My growth',             'label' => 'What does success look like for me at the end of this season?'],
        ['key' => 'obstacles',          'group' => 'My growth',             'label' => "What might get in my way this season, and what's my plan for it?"],
    ];

    /**
     * Adults (mentors, volunteers, parents, staff) get the same private space, but the
     * youth prompts don't fit them — "when I graduate" and "where will robotics take me"
     * assume a member who is passing through. These ask about the season they're about
     * to mentor. Question keys are distinct from the youth set so nothing collides if
     * someone's member_type changes (a youth who returns later as a mentor keeps both).
     */
    private const ADULT_QUESTIONS = [
        ['key' => 'a_why',              'group' => 'Why I am here',            'label' => 'Why am I giving my time to the TRC this season?'],
        ['key' => 'a_legacy',           'group' => 'Why I am here',            'label' => 'What do I want the youth I work with to remember about this season?'],
        ['key' => 'a_impact_youth',     'group' => 'My impact this season',    'label' => 'How will I make a difference for the youth on my team this season?'],
        ['key' => 'a_impact_trc',       'group' => 'My impact this season',    'label' => 'How will I make the TRC stronger this season?'],
        ['key' => 'a_impact_community', 'group' => 'My impact this season',    'label' => 'How will I help the TRC show up for the wider community this year?'],
        ['key' => 'a_lift_someone',     'group' => 'My impact this season',    'label' => 'Who is one person — youth or adult — I want to help grow this season, and how?'],
        ['key' => 'a_skills',           'group' => 'My growth',                'label' => 'What do I want to get better at this season — technical, or how I coach?'],
        ['key' => 'a_growth_edge',      'group' => 'My growth',                'label' => 'What part of mentoring do I find hardest, and what will I try differently?'],
        ['key' => 'a_step_back',        'group' => 'My growth',                'label' => 'Where do I need to let the youth lead, even when it would be faster to do it myself?'],
        ['key' => 'a_success',          'group' => 'My growth',                'label' => 'What does a successful season look like for me, apart from how the robot performs?'],
        ['key' => 'a_sustainable',      'group' => 'My growth',                'label' => 'What will I do to keep this sustainable, so I finish the season still enjoying it?'],
    ];

    /** True when this member should get the adult prompts rather than the youth ones. */
    private static function isAdult(PDO $pdo, int $memberId): bool
    {
        $s = $pdo->prepare("SELECT member_type FROM members WHERE id = ?");
        $s->execute([$memberId]);
        return ((string)($s->fetchColumn() ?: 'youth')) !== 'youth';
    }

    /**
     * Question set for a member. Adults get ADULT_QUESTIONS, youth get DEFAULT_QUESTIONS.
     * A system_config override still wins for both: set category 'reflection_questions'
     * for everyone, or 'reflection_questions_adult' to override only the adult set.
     *
     * @return array<int,array{key:string,group:string,label:string}>
     */
    private static function questions(PDO $pdo, int $memberId = 0): array
    {
        $adult = $memberId > 0 && self::isAdult($pdo, $memberId);
        $fallback = $adult ? self::ADULT_QUESTIONS : self::DEFAULT_QUESTIONS;
        $category = $adult ? 'reflection_questions_adult' : 'reflection_questions';

        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([$category]);
        $row = $s->fetch();
        // Adults fall back to the shared override before the built-in set, so an admin
        // who customised 'reflection_questions' for everyone still gets what they set.
        if ((!$row || !$row['values']) && $adult) {
            $row = $pdo->query("SELECT `values` FROM system_config WHERE category = 'reflection_questions'")->fetch();
        }
        $v = ($row && $row['values']) ? json_decode((string)$row['values'], true) : null;
        if (!is_array($v) || !$v) return $fallback;
        $out = [];
        foreach ($v as $q) {
            if (empty($q['key']) || empty($q['label'])) continue;
            $out[] = ['key' => (string)$q['key'], 'group' => (string)($q['group'] ?? 'Reflection'), 'label' => (string)$q['label']];
        }
        return $out ?: $fallback;
    }

    private static function year(Request $req): int
    {
        $y = (int)($req->getQueryParams()['year'] ?? 0);
        return $y ?: EnrollmentService::currentEnrollmentYear();
    }

    /**
     * Read access: the member viewing their OWN reflections (gated on members.own_reflections
     * so the pane can be turned off per role in Role Management), or a holder of
     * members.view_reflections viewing someone else's.
     */
    private static function canRead(PDO $pdo, array $cur, int $memberId): bool
    {
        if ((int)$cur['id'] === $memberId) return Permissions::memberCan($pdo, $cur, 'members.own_reflections', 'read');
        return Permissions::memberCan($pdo, $cur, 'members.view_reflections', 'read');
    }

    /** GET /members/{member_id}/reflections?year= */
    public static function get(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if (!self::canRead($pdo, $cur, $mid)) return Http::error($res, 'Access denied', 403);
        $year = self::year($req);

        $s = $pdo->prepare("SELECT question_key, answer, updated_at FROM member_reflections WHERE member_id = ? AND enrollment_year = ?");
        $s->execute([$mid, $year]);
        $saved = []; $lastUpdated = null;
        foreach ($s->fetchAll() as $r) {
            $saved[$r['question_key']] = $r['answer'];
            if ($r['updated_at'] && (!$lastUpdated || $r['updated_at'] > $lastUpdated)) $lastUpdated = $r['updated_at'];
        }

        $questions = array_map(fn($q) => $q + ['answer' => $saved[$q['key']] ?? null], self::questions($pdo, $mid));
        $answered = count(array_filter($questions, fn($q) => trim((string)$q['answer']) !== ''));

        return Http::json($res, [
            'member_id' => $mid, 'enrollment_year' => $year,
            'year_label' => $year . '-' . ($year + 1),
            'is_self' => (int)$cur['id'] === $mid,
            'can_edit' => (int)$cur['id'] === $mid,      // only the member writes their own words
            'questions' => $questions,
            'answered_count' => $answered, 'question_count' => count($questions),
            'last_updated' => Time::naiveIso($lastUpdated),
        ]);
    }

    /** PUT /members/{member_id}/reflections — save answers (the member only). */
    public static function save(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ((int)$cur['id'] !== $mid) return Http::error($res, 'These are your own reflections — only you can edit them.', 403);
        if (!Permissions::memberCan($pdo, $cur, 'members.own_reflections', 'read')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $year = (int)($d['year'] ?? 0) ?: EnrollmentService::currentEnrollmentYear();
        $answers = is_array($d['answers'] ?? null) ? $d['answers'] : [];

        $valid = [];
        foreach (self::questions($pdo, $mid) as $q) $valid[$q['key']] = true;
        $saved = 0;
        foreach ($answers as $key => $val) {
            if (!isset($valid[(string)$key])) continue;
            $text = trim((string)$val);
            $pdo->prepare("INSERT INTO member_reflections (member_id, enrollment_year, question_key, answer, updated_by_id, created_at, updated_at)
                           VALUES (?,?,?,?,?,NOW(),NOW())
                           ON DUPLICATE KEY UPDATE answer = VALUES(answer), updated_by_id = VALUES(updated_by_id), updated_at = NOW()")
                ->execute([$mid, $year, (string)$key, $text !== '' ? $text : null, (int)$cur['id']]);
            $saved++;
        }
        // Don't log the answers themselves — just that a save happened.
        Audit::write($pdo, (int)$cur['id'], 'member_reflections', $mid, 'reflections.save', null, ['year' => $year, 'fields' => $saved]);
        return self::get($req->withQueryParams(['year' => (string)$year]), $res, $route);
    }
}
