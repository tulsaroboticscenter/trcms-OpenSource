<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\EnrollmentService;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Port of app/modules/certifications/router.py (prefix /api/v1/certifications). */
final class CertificationsController
{
    private const CERT_FIELDS = ['code', 'name', 'section', 'level', 'status', 'points', 'is_tool_gate', 'tool_name', 'prerequisites', 'classroom_url', 'description'];
    private const CERT_BOOL = ['is_tool_gate'];
    private const CERT_INT = ['level', 'points'];
    private const CERT_JSON = ['prerequisites'];

    private static function perm(PDO $pdo, ?array $m, string $key, string $level): bool
    {
        return $m !== null && Permissions::memberCan($pdo, $m, $key, $level);
    }

    private static function codeSort(string $code): array
    {
        $num = preg_replace('/\D/', '', $code);
        $suf = preg_replace('/\d/', '', $code);
        return [$num !== '' ? (int)$num : 0, $suf];
    }

    private static function serializeCert(array $c, ?int $earnedCount = null, ?bool $hasQuiz = null): array
    {
        $d = [
            'id' => (int)$c['id'], 'code' => $c['code'], 'name' => $c['name'], 'section' => $c['section'],
            'level' => $c['level'] !== null ? (int)$c['level'] : null, 'status' => $c['status'],
            'points' => $c['points'] !== null ? (int)$c['points'] : null,
            'is_tool_gate' => (bool)$c['is_tool_gate'], 'tool_name' => $c['tool_name'],
            'prerequisites' => $c['prerequisites'] ? json_decode($c['prerequisites'], true) : [],
            'classroom_url' => $c['classroom_url'], 'description' => $c['description'],
        ];
        if ($earnedCount !== null) $d['earned_count'] = $earnedCount;
        if ($hasQuiz !== null) $d['has_quiz'] = $hasQuiz;   // a published quiz exists (LMS)
        return $d;
    }

    private static function serializeMemberCert(array $mc): array
    {
        return [
            'id' => (int)$mc['id'], 'certification_id' => (int)$mc['certification_id'],
            'code' => $mc['code'] ?? null, 'name' => $mc['cert_name'] ?? null,
            'section' => $mc['section'] ?? null, 'level' => isset($mc['level']) && $mc['level'] !== null ? (int)$mc['level'] : null,
            'is_tool_gate' => (bool)($mc['is_tool_gate'] ?? false), 'tool_name' => $mc['tool_name'] ?? null,
            'status' => $mc['status'], 'completed_date' => $mc['completed_date'],
            'awarded_by' => (($mc['ab_first'] ?? null) !== null || ($mc['ab_last'] ?? null) !== null)
                ? trim(($mc['ab_first'] ?? '') . ' ' . ($mc['ab_last'] ?? '')) : null,
            'notes' => $mc['notes'],
        ];
    }

    private static function serializeBadge(array $b): array
    {
        return [
            'id' => (int)$b['id'], 'name' => $b['name'], 'description' => $b['description'],
            'icon_name' => $b['icon_name'], 'color' => $b['color'], 'criteria_type' => $b['criteria_type'],
            'criteria_value' => (json_decode($b['criteria_value'] ?? '', true) ?: new \stdClass()),
            'is_active' => (bool)$b['is_active'],
        ];
    }

    // ── Program settings (Google Classroom link, etc.) ──────────────────
    private const SETTINGS_CATEGORY = 'certifications';

    private static function settingsRaw(PDO $pdo): array
    {
        $s = $pdo->prepare("SELECT `values` FROM system_config WHERE category = ?");
        $s->execute([self::SETTINGS_CATEGORY]);
        $r = $s->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        return is_array($v) ? $v : [];
    }

    // ── Certification Quiz Engine (LMS) — hidden until enabled ───────────
    // The whole quiz feature is gated so nothing reaches real users until an admin turns it
    // on: a settings flag (`lms_enabled`, default off) plus the `cert_lms.manage` / `cert_lms.take`
    // permissions (default "none"). Any admin (Admin or System Administrator) can build and take
    // quizzes even while the flag is off, so they can QA it in production while it stays hidden
    // from mentors, youth and parents.

    /** Is the quiz engine turned on for regular (non-admin) users? */
    public static function lmsEnabled(PDO $pdo): bool
    {
        return !empty(self::settingsRaw($pdo)['lms_enabled']);
    }

    /** May build / grade quizzes: any admin (the hidden-phase QA hatch) or an explicit grant. */
    private static function canManageLms(PDO $pdo, ?array $m): bool
    {
        return $m !== null && (Permissions::isSuperAdmin($pdo, $m) || self::perm($pdo, $m, 'cert_lms.manage', 'write'));
    }

    /** May take quizzes: any admin anytime (QA), or — once the flag is on — an explicit grant. */
    private static function canTakeLms(PDO $pdo, ?array $m): bool
    {
        if ($m === null) return false;
        if (Permissions::isSuperAdmin($pdo, $m)) return true;                 // admins QA even while hidden
        return self::lmsEnabled($pdo) && self::perm($pdo, $m, 'cert_lms.take', 'read');
    }

    /** GET /api/v1/certifications/settings — program-wide cert settings (classroom link). */
    public static function getSettings(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'certifications.view', 'read')) return Http::error($res, 'Access denied', 403);
        $s = self::settingsRaw($pdo);
        return Http::json($res, [
            'classroom_url' => $s['classroom_url'] ?? null,
            'can_manage' => self::perm($pdo, $m, 'certifications.manage', 'write'),
            // Certification Quiz Engine (hidden until enabled).
            'lms_enabled' => !empty($s['lms_enabled']),
            'can_manage_lms' => self::canManageLms($pdo, $m),
            'can_take_lms' => self::canTakeLms($pdo, $m),
        ]);
    }

    /** PUT /api/v1/certifications/settings — set the TRC Google Classroom link. */
    public static function updateSettings(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        $canCert = self::perm($pdo, $cur, 'certifications.manage', 'write');
        $canLms  = self::canManageLms($pdo, $cur);
        if (!$canCert && !$canLms) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $settings = self::settingsRaw($pdo);

        // Each field is updated only when supplied, so toggling one never wipes the other.
        if (array_key_exists('classroom_url', $d)) {
            if (!$canCert) return Http::error($res, 'Access denied', 403);
            $url = trim((string)$d['classroom_url']);
            if ($url !== '' && !preg_match('#^https?://#i', $url)) {
                return Http::error($res, 'Enter a full URL starting with http:// or https://', 422);
            }
            $settings['classroom_url'] = $url !== '' ? mb_substr($url, 0, 1000) : null;
        }
        // The quiz-engine kill switch — only an admin (or an explicit cert_lms.manage grant) flips it.
        if (array_key_exists('lms_enabled', $d)) {
            if (!$canLms) return Http::error($res, 'Access denied', 403);
            $settings['lms_enabled'] = (bool)filter_var($d['lms_enabled'], FILTER_VALIDATE_BOOLEAN);
        }

        $json = json_encode($settings);
        $ex = $pdo->prepare("SELECT id FROM system_config WHERE category = ?"); $ex->execute([self::SETTINGS_CATEGORY]);
        if ($row = $ex->fetch()) {
            $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE id = ?")->execute([$json, (int)$row['id']]);
        } else {
            $pdo->prepare("INSERT INTO system_config (category, label, `values`) VALUES (?, 'Certifications', ?)")->execute([self::SETTINGS_CATEGORY, $json]);
        }
        Audit::write($pdo, (int)$cur['id'], 'system_config', null, 'update', null, ['category' => 'certifications']);
        return Http::json($res, [
            'classroom_url' => $settings['classroom_url'] ?? null,
            'lms_enabled' => !empty($settings['lms_enabled']),
            'can_manage' => $canCert,
            'can_manage_lms' => $canLms,
        ]);
    }

    // ── Quiz builder (LMS) — author side, gated on canManageLms ───────────
    private static function certExists(PDO $pdo, int $certId): bool
    {
        $s = $pdo->prepare("SELECT 1 FROM certifications WHERE id = ?"); $s->execute([$certId]);
        return (bool)$s->fetchColumn();
    }

    private static function quizRow(PDO $pdo, int $certId): ?array
    {
        $s = $pdo->prepare("SELECT * FROM cert_quizzes WHERE certification_id = ?"); $s->execute([$certId]);
        return $s->fetch() ?: null;
    }

    private static function quizById(PDO $pdo, int $quizId): ?array
    {
        $s = $pdo->prepare("SELECT * FROM cert_quizzes WHERE id = ?"); $s->execute([$quizId]);
        return $s->fetch() ?: null;
    }

    /** Ensure a quiz row exists for a cert (created on first edit), returning it. */
    private static function ensureQuiz(PDO $pdo, int $certId, int $byId): array
    {
        if ($q = self::quizRow($pdo, $certId)) return $q;
        $pdo->prepare("INSERT INTO cert_quizzes (certification_id, pass_pct, is_published, created_by_id, created_at)
                       VALUES (?, 80, 0, ?, NOW())")->execute([$certId, $byId]);
        return self::quizRow($pdo, $certId);
    }

    /** Author view of a question, with the answer key. Reused (author=false) by the take flow later. */
    private static function serializeQuestion(PDO $pdo, array $r, bool $author): array
    {
        $os = $pdo->prepare("SELECT * FROM cert_quiz_options WHERE question_id = ? ORDER BY display_order, id");
        $os->execute([(int)$r['id']]);
        $options = [];
        foreach ($os->fetchAll() as $o) {
            $opt = ['id' => (int)$o['id'], 'label' => $o['label']];
            if ($author) $opt['is_correct'] = (bool)$o['is_correct'];
            $options[] = $opt;
        }
        $out = ['id' => (int)$r['id'], 'type' => $r['type'], 'prompt' => $r['prompt'],
                'points' => (int)$r['points'], 'display_order' => (int)$r['display_order'],
                'image_url' => $r['image_url'] ?? null, 'options' => $options];
        if ($author) {
            $out['explanation'] = $r['explanation'];
            $out['answer_key'] = $r['answer_key'] ? (json_decode($r['answer_key'], true) ?: []) : [];
        }
        return $out;
    }

    private static function serializeQuiz(PDO $pdo, array $q, bool $author): array
    {
        $qs = $pdo->prepare("SELECT * FROM cert_quiz_questions WHERE quiz_id = ? ORDER BY display_order, id");
        $qs->execute([(int)$q['id']]);
        $questions = array_map(fn ($r) => self::serializeQuestion($pdo, $r, $author), $qs->fetchAll());
        return [
            'id' => (int)$q['id'], 'certification_id' => (int)$q['certification_id'],
            'title' => $q['title'], 'instructions' => $q['instructions'],
            'pass_pct' => (int)$q['pass_pct'],
            'max_attempts' => $q['max_attempts'] !== null ? (int)$q['max_attempts'] : null,
            'shuffle_questions' => (bool)$q['shuffle_questions'],
            'hold_results' => (int)($q['hold_results'] ?? 0) === 1,
            'is_published' => (bool)$q['is_published'],
            'question_count' => count($questions),
            'total_points' => self::quizPossible($pdo, (int)$q['id']),
            'questions' => $questions,
        ];
    }

    /** Delete and re-insert a question's options in order — the builder sends the full set. */
    private static function saveOptions(PDO $pdo, int $questionId, array $options): void
    {
        $pdo->prepare("DELETE FROM cert_quiz_options WHERE question_id = ?")->execute([$questionId]);
        $i = 0;
        $ins = $pdo->prepare("INSERT INTO cert_quiz_options (question_id, label, is_correct, display_order) VALUES (?, ?, ?, ?)");
        foreach ($options as $o) {
            $label = trim((string)($o['label'] ?? ''));
            if ($label === '') continue;
            $ins->execute([$questionId, mb_substr($label, 0, 1000), (int)(bool)($o['is_correct'] ?? false), $i++]);
        }
    }

    private static function questionFields(array $d): array
    {
        $type = in_array($d['type'] ?? '', ['single', 'multi', 'truefalse', 'short'], true) ? $d['type'] : 'single';
        $key = null;
        if ($type === 'short' && is_array($d['answer_key'] ?? null)) {
            $clean = array_values(array_filter(array_map(fn ($x) => trim((string)$x), $d['answer_key']), fn ($x) => $x !== ''));
            $key = $clean ? json_encode($clean) : null;
        }
        $img = trim((string)($d['image_url'] ?? ''));
        return [
            'type' => $type,
            'prompt' => mb_substr(trim((string)($d['prompt'] ?? '')), 0, 4000),
            'points' => max(1, (int)($d['points'] ?? 1)),
            'answer_key' => $key,
            'explanation' => ($d['explanation'] ?? '') === '' ? null : mb_substr((string)$d['explanation'], 0, 4000),
            'image_url' => ($img === '' || !preg_match('#^https?://#i', $img)) ? null : mb_substr($img, 0, 1000),
        ];
    }

    /** Problems that must be fixed before a quiz can be published; empty = publishable. */
    private static function quizIssues(PDO $pdo, int $quizId): array
    {
        $rows = $pdo->query("SELECT * FROM cert_quiz_questions WHERE quiz_id = " . (int)$quizId . " ORDER BY display_order, id")->fetchAll();
        if (!$rows) return ['Add at least one question before publishing.'];
        $issues = [];
        foreach ($rows as $i => $r) {
            $n = $i + 1;
            if (trim((string)$r['prompt']) === '') $issues[] = "Question $n has no text.";
            if (in_array($r['type'], ['single', 'multi', 'truefalse'], true)) {
                $os = $pdo->prepare("SELECT is_correct FROM cert_quiz_options WHERE question_id = ?");
                $os->execute([(int)$r['id']]);
                $opts = $os->fetchAll();
                $correct = count(array_filter($opts, fn ($o) => (int)$o['is_correct'] === 1));
                if (count($opts) < 2) $issues[] = "Question $n needs at least two choices.";
                if ($r['type'] === 'multi') { if ($correct < 1) $issues[] = "Question $n needs at least one correct choice."; }
                else { if ($correct !== 1) $issues[] = "Question $n must have exactly one correct choice."; }
            }
        }
        return $issues;
    }

    /** GET /certifications/{cert_id}/quiz — author view (creates nothing; null if no quiz yet). */
    public static function getQuiz(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        if (!self::certExists($pdo, $certId)) return Http::error($res, 'Certification not found', 404);
        $q = self::quizRow($pdo, $certId);
        return Http::json($res, $q ? self::serializeQuiz($pdo, $q, true) : null);
    }

    /** PUT /certifications/{cert_id}/quiz — create or update quiz settings. */
    public static function upsertQuiz(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        if (!self::certExists($pdo, $certId)) return Http::error($res, 'Certification not found', 404);
        $d = (array)$req->getParsedBody();
        $q = self::ensureQuiz($pdo, $certId, (int)$cur['id']);
        $title = trim((string)($d['title'] ?? '')); $title = $title === '' ? null : mb_substr($title, 0, 300);
        $instr = ($d['instructions'] ?? '') === '' ? null : mb_substr((string)$d['instructions'], 0, 4000);
        $pass = min(100, max(1, (int)($d['pass_pct'] ?? $q['pass_pct'] ?? 80)));
        $maxA = ($d['max_attempts'] ?? '') === '' || $d['max_attempts'] === null ? null : max(1, (int)$d['max_attempts']);
        $shuffle = (int)(bool)($d['shuffle_questions'] ?? false);
        $hold = (int)(bool)($d['hold_results'] ?? false);
        $pdo->prepare("UPDATE cert_quizzes SET title=?, instructions=?, pass_pct=?, max_attempts=?, shuffle_questions=?, hold_results=?, updated_at=NOW() WHERE id=?")
            ->execute([$title, $instr, $pass, $maxA, $shuffle, $hold, (int)$q['id']]);
        return Http::json($res, self::serializeQuiz($pdo, self::quizById($pdo, (int)$q['id']), true));
    }

    /** POST /certifications/{cert_id}/quiz/questions — add a question (+ options). */
    public static function addQuizQuestion(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        if (!self::certExists($pdo, $certId)) return Http::error($res, 'Certification not found', 404);
        $q = self::ensureQuiz($pdo, $certId, (int)$cur['id']);
        $d = (array)$req->getParsedBody();
        if (trim((string)($d['prompt'] ?? '')) === '') return Http::error($res, 'The question needs some text.', 422);
        $f = self::questionFields($d);
        $ord = (int)$pdo->query("SELECT COALESCE(MAX(display_order),-1)+1 FROM cert_quiz_questions WHERE quiz_id=" . (int)$q['id'])->fetchColumn();
        $pdo->prepare("INSERT INTO cert_quiz_questions (quiz_id, type, prompt, points, answer_key, explanation, image_url, display_order, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())")
            ->execute([(int)$q['id'], $f['type'], $f['prompt'], $f['points'], $f['answer_key'], $f['explanation'], $f['image_url'], $ord]);
        $qid = (int)$pdo->lastInsertId();
        if (is_array($d['options'] ?? null)) self::saveOptions($pdo, $qid, $d['options']);
        return Http::json($res, self::serializeQuiz($pdo, self::quizById($pdo, (int)$q['id']), true), 201);
    }

    /** PATCH /cert-quiz/questions/{question_id} — edit a question (+ replace its options). */
    public static function updateQuizQuestion(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $qid = (int)$route['question_id'];
        $qr = $pdo->prepare("SELECT * FROM cert_quiz_questions WHERE id=?"); $qr->execute([$qid]);
        $question = $qr->fetch();
        if (!$question) return Http::error($res, 'Question not found', 404);
        $d = (array)$req->getParsedBody();
        $f = self::questionFields($d + ['type' => $question['type'], 'prompt' => $question['prompt'], 'points' => $question['points']]);
        $ord = array_key_exists('display_order', $d) ? (int)$d['display_order'] : (int)$question['display_order'];
        $pdo->prepare("UPDATE cert_quiz_questions SET type=?, prompt=?, points=?, answer_key=?, explanation=?, image_url=?, display_order=? WHERE id=?")
            ->execute([$f['type'], $f['prompt'], $f['points'], $f['answer_key'], $f['explanation'], $f['image_url'], $ord, $qid]);
        if (is_array($d['options'] ?? null)) self::saveOptions($pdo, $qid, $d['options']);
        return Http::json($res, self::serializeQuiz($pdo, self::quizById($pdo, (int)$question['quiz_id']), true));
    }

    /** DELETE /cert-quiz/questions/{question_id} — remove a question and its options. */
    public static function deleteQuizQuestion(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $qid = (int)$route['question_id'];
        $qr = $pdo->prepare("SELECT * FROM cert_quiz_questions WHERE id=?"); $qr->execute([$qid]);
        $question = $qr->fetch();
        if (!$question) return Http::error($res, 'Question not found', 404);
        $pdo->prepare("DELETE FROM cert_quiz_options WHERE question_id=?")->execute([$qid]);
        $pdo->prepare("DELETE FROM cert_quiz_questions WHERE id=?")->execute([$qid]);
        return Http::json($res, self::serializeQuiz($pdo, self::quizById($pdo, (int)$question['quiz_id']), true));
    }

    /** POST /certifications/{cert_id}/quiz/publish — {published:bool}. Validates before publishing. */
    public static function publishQuiz(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        $q = self::quizRow($pdo, $certId);
        if (!$q) return Http::error($res, 'Create the quiz first.', 404);
        $d = (array)$req->getParsedBody();
        $publish = (bool)filter_var($d['published'] ?? true, FILTER_VALIDATE_BOOLEAN);
        if ($publish) {
            $issues = self::quizIssues($pdo, (int)$q['id']);
            if ($issues) return Http::json($res, ['detail' => 'This quiz isn\'t ready to publish.', 'issues' => $issues], 422);
        }
        $pdo->prepare("UPDATE cert_quizzes SET is_published=?, updated_at=NOW() WHERE id=?")->execute([(int)$publish, (int)$q['id']]);
        Audit::write($pdo, (int)$cur['id'], 'cert_quizzes', (int)$q['id'], $publish ? 'publish' : 'unpublish', null, ['certification_id' => $certId]);
        return Http::json($res, self::serializeQuiz($pdo, self::quizById($pdo, (int)$q['id']), true));
    }

    // ── Quiz taking (LMS) — learner side, gated on canTakeLms ─────────────

    /** Prereqs the member must already hold before a quiz can start. Entries may be codes or ids. */
    private static function prereqsMet(PDO $pdo, array $cert, int $memberId): array
    {
        $pre = $cert['prerequisites'] ? (json_decode((string)$cert['prerequisites'], true) ?: []) : [];
        if (!$pre) return [true, []];
        $h = $pdo->prepare("SELECT c.id, c.code FROM member_certifications mc JOIN certifications c ON c.id = mc.certification_id
                             WHERE mc.member_id = ? AND mc.status = 'completed'");
        $h->execute([$memberId]);
        $ids = []; $codes = [];
        foreach ($h->fetchAll() as $r) { $ids[] = (int)$r['id']; $codes[] = mb_strtolower((string)$r['code']); }
        $missing = [];
        foreach ($pre as $p) {
            $ok = is_numeric($p) ? in_array((int)$p, $ids, true) : in_array(mb_strtolower((string)$p), $codes, true);
            if (!$ok) $missing[] = (string)$p;
        }
        return [count($missing) === 0, $missing];
    }

    /** Grade one submitted answer → [is_correct (bool|null=pending), points_earned]. */
    private static function gradeAnswer(array $q, array $opts, array $sub): array
    {
        $pts = (int)$q['points'];
        if ($q['type'] === 'short') {
            $norm = fn ($s) => mb_strtolower(trim(preg_replace('/\s+/', ' ', (string)$s)));
            $resp = $norm($sub['response_text'] ?? '');
            $key = $q['answer_key'] ? (json_decode((string)$q['answer_key'], true) ?: []) : [];
            if (!$key) return [null, 0.0, (float)$pts];          // no key → manual grade
            foreach ($key as $k) { if ($norm($k) !== '' && $norm($k) === $resp) return [true, (float)$pts, (float)$pts]; }
            return [false, 0.0, (float)$pts];
        }
        $correct = array_map(fn ($o) => (int)$o['id'], array_filter($opts, fn ($o) => (int)$o['is_correct'] === 1));
        $sel = array_map('intval', is_array($sub['selected_option_ids'] ?? null) ? $sub['selected_option_ids'] : []);
        sort($correct); $sel = array_values(array_unique($sel)); sort($sel);

        if ($q['type'] === 'multi') {
            // Partial credit: each correct answer is worth `points` (default 1). Student earns
            // `points` for each correct answer selected, and loses `points` for each selection
            // beyond the number of correct answers, floored at 0. So a 3-correct question is
            // worth 3: pick 2 correct → 2; pick 3 correct + 1 wrong → 2; pick 2 correct + 1 wrong → 2.
            $nCorrect = count($correct);
            $per = (float)$pts;
            $hits = count(array_intersect($sel, $correct));           // correct ones selected
            $excess = max(0, count($sel) - $nCorrect);                // over-selections
            $earned = $per * max(0, $hits - $excess);
            $possible = $per * $nCorrect;
            $isCorrect = ($possible > 0 && $earned >= $possible - 0.0001);
            return [$isCorrect, round($earned, 2), round($possible, 2)];
        }

        // single / truefalse — all-or-nothing
        $ok = ($sel !== [] && $correct === $sel);
        return [$ok, $ok ? (float)$pts : 0.0, (float)$pts];
    }

    /** Points one question can award — a multi question is worth `points` × (number of correct choices). */
    private static function questionPossible(PDO $pdo, array $q): float
    {
        if ($q['type'] === 'multi') {
            $n = (int)$pdo->query("SELECT COUNT(*) FROM cert_quiz_options WHERE question_id = " . (int)$q['id'] . " AND is_correct = 1")->fetchColumn();
            return (float)((int)$q['points'] * $n);
        }
        return (float)(int)$q['points'];
    }

    /** Total points a quiz can award (respects multi-answer partial-credit scaling). */
    private static function quizPossible(PDO $pdo, int $quizId): float
    {
        $total = 0.0;
        foreach ($pdo->query("SELECT * FROM cert_quiz_questions WHERE quiz_id = " . (int)$quizId)->fetchAll() as $q) {
            $total += self::questionPossible($pdo, $q);
        }
        return $total;
    }

    /** Auto-award the certification on a pass — ONLY ADD, never disturb an existing award. */
    private static function awardFromQuiz(PDO $pdo, int $memberId, int $certId, float $scorePct): bool
    {
        $ex = $pdo->prepare("SELECT id FROM member_certifications WHERE member_id = ? AND certification_id = ?");
        $ex->execute([$memberId, $certId]);
        if ($ex->fetch()) return false;                          // already holds it — leave the manual/prior record alone
        $pdo->prepare("INSERT INTO member_certifications (member_id, certification_id, status, completed_date, notes, awarded_by_id, created_at)
                       VALUES (?, ?, 'completed', ?, ?, NULL, NOW())")
            ->execute([$memberId, $certId, date('Y-m-d'), 'Passed quiz — ' . round($scorePct) . '%']);
        $mcId = (int)$pdo->lastInsertId();
        Audit::write($pdo, null, 'member_certifications', $mcId, 'quiz_award', null, ['member_id' => $memberId, 'certification_id' => $certId, 'score' => round($scorePct)]);
        self::evaluateMemberBadges($pdo, $memberId);
        return true;
    }

    private static function attemptOwned(PDO $pdo, int $attemptId, int $memberId): ?array
    {
        $s = $pdo->prepare("SELECT * FROM cert_quiz_attempts WHERE id = ? AND member_id = ?");
        $s->execute([$attemptId, $memberId]);
        return $s->fetch() ?: null;
    }

    /** Number of finished (submitted/graded) attempts a member has on a quiz. */
    private static function finishedAttempts(PDO $pdo, int $quizId, int $memberId): int
    {
        $s = $pdo->prepare("SELECT COUNT(*) FROM cert_quiz_attempts WHERE quiz_id = ? AND member_id = ? AND status <> 'in_progress'");
        $s->execute([$quizId, $memberId]);
        return (int)$s->fetchColumn();
    }

    /** Full result of a submitted attempt: score, pass, and a per-question review with answers. */
    private static function attemptResult(PDO $pdo, array $attempt, array $quiz): array
    {
        $qs = $pdo->prepare("SELECT * FROM cert_quiz_questions WHERE quiz_id = ? ORDER BY display_order, id");
        $qs->execute([(int)$quiz['id']]);
        $ans = $pdo->prepare("SELECT * FROM cert_quiz_answers WHERE attempt_id = ?");
        $ans->execute([(int)$attempt['id']]);
        $byQ = [];
        foreach ($ans->fetchAll() as $a) $byQ[(int)$a['question_id']] = $a;
        // Only a fully graded attempt reveals correct answers and the score. Anything still 'submitted'
        // (short answers awaiting grading, or a "hold results" quiz) shows only what the learner chose.
        $reveal = $attempt['status'] === 'graded';
        $review = [];
        foreach ($qs->fetchAll() as $q) {
            $os = $pdo->prepare("SELECT * FROM cert_quiz_options WHERE question_id = ? ORDER BY display_order, id");
            $os->execute([(int)$q['id']]);
            $opts = $os->fetchAll();
            $a = $byQ[(int)$q['id']] ?? null;
            $review[] = [
                'id' => (int)$q['id'], 'type' => $q['type'], 'prompt' => $q['prompt'], 'points' => (int)$q['points'],
                'points_possible' => self::questionPossible($pdo, $q),
                'image_url' => $q['image_url'] ?? null,
                'explanation' => $reveal ? $q['explanation'] : null,
                'options' => array_map(fn ($o) => ['id' => (int)$o['id'], 'label' => $o['label'],
                    'is_correct' => $reveal ? (bool)$o['is_correct'] : null], $opts),
                'answer_key' => $reveal && $q['answer_key'] ? (json_decode((string)$q['answer_key'], true) ?: []) : [],
                'your_option_ids' => $a && $a['selected_option_ids'] ? (json_decode((string)$a['selected_option_ids'], true) ?: []) : [],
                'your_text' => $a['response_text'] ?? null,
                'is_correct' => $reveal ? ($a ? ($a['is_correct'] === null ? null : (bool)$a['is_correct']) : false) : null,
                'points_earned' => $reveal ? ($a ? (float)$a['points_earned'] : 0.0) : null,
            ];
        }
        return [
            'attempt_id' => (int)$attempt['id'], 'status' => $attempt['status'],
            'score_pct' => $reveal && $attempt['score_pct'] !== null ? (float)$attempt['score_pct'] : null,
            'passed' => $reveal && $attempt['passed'] !== null ? (bool)$attempt['passed'] : null,
            'awarded' => $reveal && (bool)$attempt['awarded'],
            'pending_review' => $attempt['status'] === 'submitted',
            'total_points' => self::quizPossible($pdo, (int)$quiz['id']),
            'pass_pct' => (int)$quiz['pass_pct'],
            'submitted_at' => $attempt['submitted_at'],
            'questions' => $review,
        ];
    }

    /** POST /certifications/{cert_id}/quiz/start — begin or resume the learner's attempt. */
    public static function startQuiz(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canTakeLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        $cert = self::loadCert($pdo, $certId);
        if (!$cert) return Http::error($res, 'Certification not found', 404);
        $quiz = self::quizRow($pdo, $certId);
        // Only a published quiz is takeable — except an admin QA'ing while hidden.
        if (!$quiz || (!$quiz['is_published'] && !Permissions::isSuperAdmin($pdo, $cur))) return Http::error($res, 'No quiz available', 404);

        [$met, $missing] = self::prereqsMet($pdo, $cert, (int)$cur['id']);
        if (!$met) return Http::json($res, ['detail' => 'Finish the prerequisite certifications first.', 'missing' => $missing], 422);

        // Resume an in-progress attempt, or start a new one (respecting max_attempts).
        $ip = $pdo->prepare("SELECT * FROM cert_quiz_attempts WHERE quiz_id = ? AND member_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1");
        $ip->execute([(int)$quiz['id'], (int)$cur['id']]);
        $attempt = $ip->fetch();
        if (!$attempt) {
            $max = $quiz['max_attempts'] !== null ? (int)$quiz['max_attempts'] : null;
            if ($max !== null && self::finishedAttempts($pdo, (int)$quiz['id'], (int)$cur['id']) >= $max) {
                return Http::error($res, 'You have used all attempts for this quiz.', 403);
            }
            $pdo->prepare("INSERT INTO cert_quiz_attempts (quiz_id, member_id, status, started_at) VALUES (?, ?, 'in_progress', NOW())")
                ->execute([(int)$quiz['id'], (int)$cur['id']]);
            $attempt = self::attemptOwned($pdo, (int)$pdo->lastInsertId(), (int)$cur['id']);
        }

        $qs = $pdo->prepare("SELECT * FROM cert_quiz_questions WHERE quiz_id = ? ORDER BY display_order, id");
        $qs->execute([(int)$quiz['id']]);
        $questions = array_map(fn ($r) => self::serializeQuestion($pdo, $r, false), $qs->fetchAll());
        if ($quiz['shuffle_questions']) shuffle($questions);
        return Http::json($res, [
            'attempt_id' => (int)$attempt['id'],
            'certification_id' => $certId,
            'title' => $quiz['title'], 'instructions' => $quiz['instructions'],
            'pass_pct' => (int)$quiz['pass_pct'], 'is_published' => (bool)$quiz['is_published'],
            'hold_results' => (int)($quiz['hold_results'] ?? 0) === 1,
            'questions' => $questions,
        ]);
    }

    /** POST /cert-quiz/attempts/{attempt_id}/submit — grade the attempt and, on a pass, award the cert. */
    public static function submitQuiz(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canTakeLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $attempt = self::attemptOwned($pdo, (int)$route['attempt_id'], (int)$cur['id']);
        if (!$attempt) return Http::error($res, 'Attempt not found', 404);
        if ($attempt['status'] !== 'in_progress') return Http::error($res, 'This attempt was already submitted.', 409);
        $quiz = self::quizById($pdo, (int)$attempt['quiz_id']);
        if (!$quiz) return Http::error($res, 'Quiz not found', 404);

        $submitted = [];
        foreach ((array)($req->getParsedBody()['answers'] ?? []) as $a) {
            if (isset($a['question_id'])) $submitted[(int)$a['question_id']] = $a;
        }
        $qs = $pdo->prepare("SELECT * FROM cert_quiz_questions WHERE quiz_id = ?");
        $qs->execute([(int)$quiz['id']]);
        $questions = $qs->fetchAll();

        $pdo->beginTransaction();
        try {
            $pdo->prepare("DELETE FROM cert_quiz_answers WHERE attempt_id = ?")->execute([(int)$attempt['id']]);
            $possible = 0.0; $earned = 0.0; $pending = false;
            $ins = $pdo->prepare("INSERT INTO cert_quiz_answers (attempt_id, question_id, selected_option_ids, response_text, is_correct, points_earned) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($questions as $q) {
                $os = $pdo->prepare("SELECT * FROM cert_quiz_options WHERE question_id = ?");
                $os->execute([(int)$q['id']]);
                $opts = $os->fetchAll();
                $sub = $submitted[(int)$q['id']] ?? [];
                [$isCorrect, $pointsEarned, $pointsPossible] = self::gradeAnswer($q, $opts, $sub);
                if ($isCorrect === null) $pending = true;
                $possible += $pointsPossible;
                $earned += $pointsEarned;
                $sel = is_array($sub['selected_option_ids'] ?? null) ? array_map('intval', $sub['selected_option_ids']) : [];
                $ins->execute([(int)$attempt['id'], (int)$q['id'], $sel ? json_encode($sel) : null,
                    ($sub['response_text'] ?? '') === '' ? null : mb_substr((string)$sub['response_text'], 0, 2000),
                    $isCorrect === null ? null : (int)$isCorrect, $pointsEarned]);
            }
            $scorePct = $possible > 0 ? round($earned / $possible * 100, 2) : 0.0;
            // Quizzes flagged "hold results" wait for a manager to review and release, even when every
            // question graded automatically — the score and pass/fail stay hidden until then.
            $hold = (int)($quiz['hold_results'] ?? 0) === 1;
            $awarded = 0; $passed = null; $status = 'submitted';
            if (!$pending && !$hold) {
                $status = 'graded';
                $passed = $scorePct >= (int)$quiz['pass_pct'] ? 1 : 0;
                if ($passed) $awarded = self::awardFromQuiz($pdo, (int)$cur['id'], (int)$quiz['certification_id'], $scorePct) ? 1 : 0;
            }
            $pdo->prepare("UPDATE cert_quiz_attempts SET status = ?, score_pct = ?, passed = ?, awarded = ?, submitted_at = NOW() WHERE id = ?")
                ->execute([$status, $scorePct, $passed, $awarded, (int)$attempt['id']]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not grade this attempt.', 500);
        }
        return Http::json($res, self::attemptResult($pdo, self::attemptOwned($pdo, (int)$attempt['id'], (int)$cur['id']), $quiz));
    }

    /** GET /cert-quiz/attempts/{attempt_id} — the learner's own result. */
    public static function getAttempt(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canTakeLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $attempt = self::attemptOwned($pdo, (int)$route['attempt_id'], (int)$cur['id']);
        if (!$attempt) return Http::error($res, 'Attempt not found', 404);
        $quiz = self::quizById($pdo, (int)$attempt['quiz_id']);
        if (!$quiz) return Http::error($res, 'Quiz not found', 404);
        return Http::json($res, self::attemptResult($pdo, $attempt, $quiz));
    }

    /** GET /certifications/{cert_id}/quiz/mine — the learner's attempts + whether they can take it. */
    public static function myQuiz(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canTakeLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        $quiz = self::quizRow($pdo, $certId);
        $published = $quiz && (bool)$quiz['is_published'];
        $available = $quiz && ($published || Permissions::isSuperAdmin($pdo, $cur));
        if (!$available) return Http::json($res, ['available' => false, 'attempts' => []]);
        $s = $pdo->prepare("SELECT id, status, score_pct, passed, awarded, submitted_at FROM cert_quiz_attempts
                             WHERE quiz_id = ? AND member_id = ? ORDER BY id DESC");
        $s->execute([(int)$quiz['id'], (int)$cur['id']]);
        $attempts = array_map(fn ($a) => [
            'id' => (int)$a['id'], 'status' => $a['status'],
            'score_pct' => $a['score_pct'] !== null ? (float)$a['score_pct'] : null,
            'passed' => $a['passed'] === null ? null : (bool)$a['passed'],
            'awarded' => (bool)$a['awarded'], 'submitted_at' => $a['submitted_at'],
        ], $s->fetchAll());
        $max = $quiz['max_attempts'] !== null ? (int)$quiz['max_attempts'] : null;
        $finished = self::finishedAttempts($pdo, (int)$quiz['id'], (int)$cur['id']);
        $hasInProgress = (bool)array_filter($attempts, fn ($a) => $a['status'] === 'in_progress');
        $everPassed = (bool)array_filter($attempts, fn ($a) => $a['passed'] === true);
        return Http::json($res, [
            'available' => true, 'is_published' => $published,
            'title' => $quiz['title'], 'pass_pct' => (int)$quiz['pass_pct'],
            'hold_results' => (int)($quiz['hold_results'] ?? 0) === 1,
            'max_attempts' => $max, 'attempts_used' => $finished, 'ever_passed' => $everPassed,
            'can_take' => $hasInProgress || $max === null || $finished < $max,
            'attempts' => $attempts,
        ]);
    }

    // ── Gradebook (LMS) — manager side, gated on canManageLms ─────────────

    /** GET /certifications/{cert_id}/quiz/attempts — every attempt + the short-answer grading queue. */
    public static function quizAttempts(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $certId = (int)$route['cert_id'];
        $quiz = self::quizRow($pdo, $certId);
        if (!$quiz) return Http::json($res, ['exists' => false, 'attempts' => []]);
        $s = $pdo->prepare(
            "SELECT a.*, m.first_name, m.last_name FROM cert_quiz_attempts a
             JOIN members m ON m.id = a.member_id
             WHERE a.quiz_id = ? AND a.status <> 'in_progress'
             ORDER BY a.submitted_at DESC, a.id DESC");
        $s->execute([(int)$quiz['id']]);
        $rows = $s->fetchAll();
        $pendStmt = $pdo->prepare(
            "SELECT an.question_id, an.response_text, q.prompt, q.points, q.answer_key
               FROM cert_quiz_answers an JOIN cert_quiz_questions q ON q.id = an.question_id
              WHERE an.attempt_id = ? AND an.is_correct IS NULL");
        $attempts = [];
        $passed = 0; $pendingCount = 0;
        foreach ($rows as $a) {
            $pending = [];
            if ($a['status'] === 'submitted') {
                $pendStmt->execute([(int)$a['id']]);
                foreach ($pendStmt->fetchAll() as $p) {
                    $pending[] = ['question_id' => (int)$p['question_id'], 'prompt' => $p['prompt'],
                        'response_text' => $p['response_text'], 'points' => (int)$p['points'],
                        'answer_key' => $p['answer_key'] ? (json_decode((string)$p['answer_key'], true) ?: []) : []];
                }
                $pendingCount++;
            }
            if ($a['passed'] !== null && (int)$a['passed'] === 1) $passed++;
            $attempts[] = [
                'id' => (int)$a['id'], 'member_id' => (int)$a['member_id'],
                'member_name' => trim($a['first_name'] . ' ' . $a['last_name']),
                'status' => $a['status'],
                'score_pct' => $a['score_pct'] !== null ? (float)$a['score_pct'] : null,
                'passed' => $a['passed'] === null ? null : (bool)$a['passed'],
                'awarded' => (bool)$a['awarded'], 'submitted_at' => $a['submitted_at'],
                'pending' => $pending,
            ];
        }
        return Http::json($res, [
            'exists' => true, 'is_published' => (bool)$quiz['is_published'], 'pass_pct' => (int)$quiz['pass_pct'],
            'hold_results' => (int)($quiz['hold_results'] ?? 0) === 1,
            'total' => count($attempts), 'passed' => $passed, 'pending' => $pendingCount,
            'attempts' => $attempts,
        ]);
    }

    /** PATCH /cert-quiz/attempts/{attempt_id}/grade — resolve pending short answers, then finalize. */
    public static function gradeAttempt(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::canManageLms($pdo, $cur)) return Http::error($res, 'Not found', 404);
        $s = $pdo->prepare("SELECT * FROM cert_quiz_attempts WHERE id = ?"); $s->execute([(int)$route['attempt_id']]);
        $attempt = $s->fetch();
        if (!$attempt) return Http::error($res, 'Attempt not found', 404);
        if ($attempt['status'] !== 'submitted') return Http::error($res, 'This attempt has nothing awaiting review.', 409);
        $quiz = self::quizById($pdo, (int)$attempt['quiz_id']);
        if (!$quiz) return Http::error($res, 'Quiz not found', 404);

        $grades = (array)($req->getParsedBody()['grades'] ?? []);
        $ptsStmt = $pdo->prepare("SELECT points FROM cert_quiz_questions WHERE id = ?");
        $updStmt = $pdo->prepare("UPDATE cert_quiz_answers SET is_correct = ?, points_earned = ? WHERE attempt_id = ? AND question_id = ?");
        $pdo->beginTransaction();
        try {
            foreach ($grades as $g) {
                if (!isset($g['question_id'])) continue;
                $qid = (int)$g['question_id'];
                $ptsStmt->execute([$qid]); $pts = (int)$ptsStmt->fetchColumn();
                $ok = (int)(bool)($g['is_correct'] ?? false);
                $updStmt->execute([$ok, $ok ? (float)$pts : 0.0, (int)$attempt['id'], $qid]);
            }
            // Any answers still unresolved? Stay 'submitted'. Otherwise finalize (and maybe award).
            $stillPending = (int)$pdo->query("SELECT COUNT(*) FROM cert_quiz_answers WHERE attempt_id = " . (int)$attempt['id'] . " AND is_correct IS NULL")->fetchColumn();
            if ($stillPending === 0) {
                $possible = self::quizPossible($pdo, (int)$quiz['id']);
                $earned = (float)$pdo->query("SELECT COALESCE(SUM(points_earned),0) FROM cert_quiz_answers WHERE attempt_id = " . (int)$attempt['id'])->fetchColumn();
                $scorePct = $possible > 0 ? round($earned / $possible * 100, 2) : 0.0;
                $pass = $scorePct >= (int)$quiz['pass_pct'] ? 1 : 0;
                $awarded = $pass ? (self::awardFromQuiz($pdo, (int)$attempt['member_id'], (int)$quiz['certification_id'], $scorePct) ? 1 : 0) : 0;
                $pdo->prepare("UPDATE cert_quiz_attempts SET status = 'graded', score_pct = ?, passed = ?, awarded = ? WHERE id = ?")
                    ->execute([$scorePct, $pass, $awarded, (int)$attempt['id']]);
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not save the grade.', 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'cert_quiz_attempts', (int)$attempt['id'], 'grade', null, ['count' => count($grades)]);
        return Http::json($res, self::attemptResult($pdo, $pdo->query("SELECT * FROM cert_quiz_attempts WHERE id = " . (int)$attempt['id'])->fetch(), $quiz));
    }

    // ── Catalog ──────────────────────────────────────────────────────────
    public static function listCerts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'certifications.view', 'read')) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['status'])) { $where[] = "status = ?"; $args[] = $q['status']; }
        if (!empty($q['section'])) { $where[] = "section = ?"; $args[] = $q['section']; }
        $sql = "SELECT * FROM certifications" . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
        $s = $pdo->prepare($sql); $s->execute($args);
        $certs = $s->fetchAll();
        $cc = $pdo->query("SELECT certification_id, COUNT(id) AS n FROM member_certifications WHERE status = 'completed' GROUP BY certification_id")->fetchAll();
        $counts = [];
        foreach ($cc as $r) $counts[(int)$r['certification_id']] = (int)$r['n'];
        // Which certs have a published quiz (drives the learner "Take quiz" button).
        $pubQuiz = [];
        foreach ($pdo->query("SELECT certification_id FROM cert_quizzes WHERE is_published = 1")->fetchAll() as $r) $pubQuiz[(int)$r['certification_id']] = true;
        usort($certs, fn($a, $b) => [$a['section'] ?? '', self::codeSort($a['code'])] <=> [$b['section'] ?? '', self::codeSort($b['code'])]);
        $sections = [];
        foreach ($certs as $c) {
            $sec = $c['section'] ?: 'Other';
            $sections[$sec][] = self::serializeCert($c, $counts[(int)$c['id']] ?? 0, isset($pubQuiz[(int)$c['id']]));
        }
        $keys = array_keys($sections);
        usort($keys, function ($a, $b) {
            $ka = ctype_digit(substr($a, 0, 1)) ? self::codeSort(explode(' ', $a)[0]) : [9999, $a];
            $kb = ctype_digit(substr($b, 0, 1)) ? self::codeSort(explode(' ', $b)[0]) : [9999, $b];
            return $ka <=> $kb;
        });
        $ordered = [];
        foreach ($keys as $s2) $ordered[] = ['section' => $s2, 'certifications' => $sections[$s2]];
        return Http::json($res, [
            'sections' => $ordered, 'total' => count($certs),
            'active' => count(array_filter($certs, fn($c) => $c['status'] === 'active')),
            'pending' => count(array_filter($certs, fn($c) => $c['status'] === 'pending')),
        ]);
    }

    private static function certPayload(array $d): array
    {
        $out = [];
        foreach (self::CERT_FIELDS as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = $d[$f];
            if ($v !== null && in_array($f, self::CERT_BOOL, true)) $v = (int)(bool)$v;
            elseif ($v !== null && in_array($f, self::CERT_INT, true)) $v = (int)$v;
            elseif (in_array($f, self::CERT_JSON, true)) $v = json_encode($v ?? []);
            $out[$f] = $v;
        }
        return $out;
    }

    private static function loadCert(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM certifications WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function createCert(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $code = trim((string)($d['code'] ?? ''));
        $ex = $pdo->prepare("SELECT 1 FROM certifications WHERE code = ?"); $ex->execute([$code]);
        if ($ex->fetch()) return Http::error($res, "Certification code {$d['code']} already exists.", 400);
        $payload = self::certPayload($d);
        $payload['code'] = $code;
        if (!array_key_exists('status', $payload) || $payload['status'] === null) $payload['status'] = 'active';
        $cols = array_keys($payload);
        $ph = implode(',', array_fill(0, count($cols), '?'));
        $ins = $pdo->prepare("INSERT INTO certifications (" . implode(',', $cols) . ", created_at) VALUES ($ph, NOW())");
        $ins->execute(array_values($payload));
        $c = self::loadCert($pdo, (int)$pdo->lastInsertId());
        self::syncToolBadge($pdo, $c);
        self::evaluateAllMembers($pdo);
        Audit::write($pdo, (int)$cur['id'], 'certifications', (int)$c['id'], 'create', null, ['code' => $c['code'], 'name' => $c['name']]);
        return Http::json($res, self::serializeCert($c), 201);
    }

    public static function updateCert(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['cert_id'];
        if (!self::loadCert($pdo, $id)) return Http::error($res, 'Certification not found', 404);
        $payload = self::certPayload((array)$req->getParsedBody());
        if (isset($payload['code'])) $payload['code'] = trim((string)$payload['code']);
        if ($payload) {
            $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($payload)));
            $args = array_values($payload); $args[] = $id;
            $pdo->prepare("UPDATE certifications SET $set WHERE id = ?")->execute($args);
        }
        $c = self::loadCert($pdo, $id);
        self::syncToolBadge($pdo, $c);
        self::evaluateAllMembers($pdo);
        Audit::write($pdo, (int)$cur['id'], 'certifications', $id, 'update');
        return Http::json($res, self::serializeCert($c));
    }

    public static function deleteCert(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['cert_id'];
        $c = self::loadCert($pdo, $id);
        if (!$c) return Http::error($res, 'Certification not found', 404);
        Audit::write($pdo, (int)$cur['id'], 'certifications', $id, 'delete', ['code' => $c['code'], 'name' => $c['name']], null);
        $pdo->prepare("DELETE FROM certifications WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    // ── Member certifications ────────────────────────────────────────────
    private static function memberCertRows(PDO $pdo, int $memberId): array
    {
        $sql = "SELECT mc.*, c.code, c.name AS cert_name, c.section, c.level, c.is_tool_gate, c.tool_name,
                       ab.first_name AS ab_first, ab.last_name AS ab_last
                FROM member_certifications mc
                LEFT JOIN certifications c ON c.id = mc.certification_id
                LEFT JOIN members ab ON ab.id = mc.awarded_by_id
                WHERE mc.member_id = ?";
        $s = $pdo->prepare($sql); $s->execute([$memberId]);
        $rows = $s->fetchAll();
        usort($rows, fn($a, $b) => [$a['section'] ?? '', self::codeSort((string)($a['code'] ?? ''))] <=> [$b['section'] ?? '', self::codeSort((string)($b['code'] ?? ''))]);
        return $rows;
    }

    public static function memberCerts(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        // Security #13: your own, or a roster-viewer's (members.directory).
        if ((int)$me['id'] !== $mid && !Permissions::memberCan($pdo, $me, 'members.directory', 'read')) {
            return Http::error($res, 'Access denied', 403);
        }
        $rows = self::memberCertRows($pdo, $mid);
        $completed = array_map([self::class, 'serializeMemberCert'], array_values(array_filter($rows, fn($r) => $r['status'] === 'completed')));
        $inProgress = array_map([self::class, 'serializeMemberCert'], array_values(array_filter($rows, fn($r) => $r['status'] === 'in_progress')));
        return Http::json($res, ['member_id' => $mid, 'completed_count' => count($completed),
            'completed' => $completed, 'in_progress' => $inProgress]);
    }

    /**
     * POST /certifications/import-progress[?dry_run=1] — import the wide "Certification
     * Progress Chart" CSV: members are rows (Last, First in cols 6–7), certifications are
     * columns keyed by code (header row), and a dated cell means that member earned it.
     * Matches members by name and certifications by code; idempotent (re-running won't
     * duplicate). dry_run reports what WOULD happen without writing.
     */
    public static function importProgressChart(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.award', 'write')) return Http::error($res, 'Access denied', 403);
        $files = $req->getUploadedFiles();
        $file = $files['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded', 400);
        $dry = filter_var($req->getQueryParams()['dry_run'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)$file->getStream());
        $fh = fopen('php://temp', 'r+'); fwrite($fh, $text); rewind($fh);
        $rows = []; while (($c = fgetcsv($fh, 0, ',', '"', '')) !== false) $rows[] = $c;
        fclose($fh);
        if (count($rows) < 3) return Http::error($res, 'The file has no data rows.', 422);

        // Detect the code row (most cells from col 7 that look like cert codes).
        $codeRow = -1; $best = 0;
        foreach ($rows as $i => $r) {
            $n = 0; for ($j = 7; $j < count($r); $j++) if (preg_match('/^\d{3}[a-z]?$/i', trim((string)($r[$j] ?? '')))) $n++;
            if ($n > $best) { $best = $n; $codeRow = $i; }
        }
        if ($codeRow < 0) return Http::error($res, "Couldn't find the certification code row (e.g. 101, 201…).", 422);

        // Column index → certification id (via catalog code).
        $certByCode = [];
        foreach ($pdo->query("SELECT id, code FROM certifications")->fetchAll() as $c) $certByCode[strtolower(trim((string)$c['code']))] = (int)$c['id'];
        $colCert = []; $unknownCodes = [];
        for ($j = 7; $j < count($rows[$codeRow]); $j++) {
            $code = strtolower(trim((string)($rows[$codeRow][$j] ?? '')));
            if ($code === '') continue;
            if (isset($certByCode[$code])) $colCert[$j] = $certByCode[$code];
            else $unknownCodes[$code] = true;
        }

        // Member name → ids (case-insensitive "first|last").
        $byName = [];
        foreach ($pdo->query("SELECT id, first_name, last_name FROM members") as $m) {
            $key = strtolower(trim(($m['first_name'] ?? '') . '|' . ($m['last_name'] ?? '')));
            $byName[$key][] = (int)$m['id'];
        }

        $awarded = 0; $alreadyHad = 0; $membersMatched = 0; $notFound = []; $ambiguous = [];
        $existsStmt = $pdo->prepare("SELECT id FROM member_certifications WHERE member_id = ? AND certification_id = ?");
        $insStmt = $pdo->prepare("INSERT INTO member_certifications (member_id, certification_id, status, completed_date, awarded_by_id, created_at) VALUES (?, ?, 'completed', ?, ?, NOW())");
        $touched = [];
        foreach ($rows as $i => $r) {
            if ($i <= $codeRow) continue;
            $last = trim((string)($r[5] ?? '')); $first = trim((string)($r[6] ?? ''));
            if ($first === '' || $last === '') continue;
            $key = strtolower($first . '|' . $last);
            $ids = $byName[$key] ?? [];
            if (count($ids) === 0) { $notFound["$first $last"] = true; continue; }
            if (count($ids) > 1) { $ambiguous["$first $last"] = true; continue; }
            $mid = $ids[0]; $membersMatched++;
            foreach ($colCert as $j => $certId) {
                $val = trim((string)($r[$j] ?? ''));
                if ($val === '') continue;
                $date = null; $ts = strtotime($val); if ($ts !== false) $date = date('Y-m-d', $ts);
                $existsStmt->execute([$mid, $certId]);
                if ($existsStmt->fetch()) { $alreadyHad++; continue; }
                if (!$dry) { $insStmt->execute([$mid, $certId, $date, (int)$cur['id']]); $touched[$mid] = true; }
                $awarded++;
            }
        }
        if (!$dry) foreach (array_keys($touched) as $mid) self::evaluateMemberBadges($pdo, $mid);
        if (!$dry) Audit::write($pdo, (int)$cur['id'], 'member_certifications', null, 'import', null, ['awarded' => $awarded, 'members' => $membersMatched]);

        return Http::json($res, [
            'dry_run' => $dry,
            'members_matched' => $membersMatched,
            'certs_awarded' => $awarded,
            'certs_already_had' => $alreadyHad,
            'members_not_found' => array_keys($notFound),
            'members_ambiguous' => array_keys($ambiguous),
            'unknown_codes' => array_keys($unknownCodes),
            'cert_columns' => count($colCert),
        ]);
    }

    public static function awardCert(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.award', 'write')) return Http::error($res, 'Access denied', 403);
        $mid = (int)$route['member_id'];
        $d = (array)$req->getParsedBody();
        $certId = (int)($d['certification_id'] ?? 0);
        $mx = $pdo->prepare("SELECT 1 FROM members WHERE id = ?"); $mx->execute([$mid]);
        if (!$mx->fetch()) return Http::error($res, 'Member not found', 404);
        if (!self::loadCert($pdo, $certId)) return Http::error($res, 'Certification not found', 404);
        $status = $d['status'] ?? 'completed';
        $completedDate = $d['completed_date'] ?? ($status === 'completed' ? date('Y-m-d') : null);
        // Score is optional. When given (and no explicit note), record it the same way a quiz pass does
        // ("Passed exam — 92%"), so a migrated Google Classroom score displays like a TRCMS quiz score.
        $notes = $d['notes'] ?? null;
        if ($notes === null && isset($d['score']) && $d['score'] !== '' && $d['score'] !== null && is_numeric($d['score'])) {
            $notes = 'Passed exam — ' . round((float)$d['score']) . '%';
        }
        $ex = $pdo->prepare("SELECT id FROM member_certifications WHERE member_id = ? AND certification_id = ?");
        $ex->execute([$mid, $certId]); $existing = $ex->fetch();
        if ($existing) {
            $pdo->prepare("UPDATE member_certifications SET status = ?, completed_date = ?, notes = ?, awarded_by_id = ? WHERE id = ?")
                ->execute([$status, $completedDate, $notes, (int)$cur['id'], (int)$existing['id']]);
            $mcId = (int)$existing['id'];
        } else {
            $ins = $pdo->prepare("INSERT INTO member_certifications (member_id, certification_id, status, completed_date, notes, awarded_by_id, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?, NOW())");
            $ins->execute([$mid, $certId, $status, $completedDate, $notes, (int)$cur['id']]);
            $mcId = (int)$pdo->lastInsertId();
        }
        Audit::write($pdo, (int)$cur['id'], 'member_certifications', $mcId, 'update', null,
            ['member_id' => $mid, 'certification_id' => $certId, 'status' => $status]);
        if ($status === 'completed') self::evaluateMemberBadges($pdo, $mid);
        $row = null;
        foreach (self::memberCertRows($pdo, $mid) as $r) { if ((int)$r['id'] === $mcId) { $row = $r; break; } }
        return Http::json($res, self::serializeMemberCert($row), 201);
    }

    public static function removeMemberCert(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.award', 'write')) return Http::error($res, 'Access denied', 403);
        $s = $pdo->prepare("SELECT id FROM member_certifications WHERE member_id = ? AND certification_id = ?");
        $s->execute([(int)$route['member_id'], (int)$route['certification_id']]);
        $mc = $s->fetch();
        if (!$mc) return Http::error($res, 'Record not found', 404);
        $pdo->prepare("DELETE FROM member_certifications WHERE id = ?")->execute([(int)$mc['id']]);
        Audit::write($pdo, (int)$cur['id'], 'member_certifications', (int)$mc['id'], 'delete');
        return Http::json($res, ['ok' => true]);
    }

    // ── Badge engine ─────────────────────────────────────────────────────
    private static function memberQualifies(array $badge, array $completedIds, array $completedCodes, array $bySection, array $byLevel, array $codeToId): bool
    {
        $ct = $badge['criteria_type'];
        $cv = $badge['criteria_value'] ? json_decode($badge['criteria_value'], true) : [];
        if ($ct === 'count') return count($completedIds) >= (int)($cv['threshold'] ?? 0);
        if ($ct === 'section') {
            $needed = $bySection[$cv['section'] ?? ''] ?? [];
            return $needed && !array_diff($needed, $completedIds);
        }
        if ($ct === 'level') {
            $needed = $byLevel[(string)($cv['level'] ?? '')] ?? [];
            return $needed && !array_diff($needed, $completedIds);
        }
        if ($ct === 'tool') {
            $cid = $codeToId[(string)($cv['cert_code'] ?? '')] ?? null;
            return $cid !== null && in_array($cid, $completedIds, true);
        }
        if ($ct === 'bundle') {
            $codes = array_map('strval', $cv['cert_codes'] ?? []);
            return $codes && !array_diff($codes, $completedCodes);
        }
        return false;
    }

    private static function evaluateMemberBadges(PDO $pdo, int $memberId): int
    {
        $rs = $pdo->prepare("SELECT mc.certification_id, c.code FROM member_certifications mc
                             LEFT JOIN certifications c ON c.id = mc.certification_id
                             WHERE mc.member_id = ? AND mc.status = 'completed'");
        $rs->execute([$memberId]);
        $recs = $rs->fetchAll();
        $completedIds = array_map('intval', array_column($recs, 'certification_id'));
        $completedCodes = array_values(array_filter(array_column($recs, 'code')));
        $active = $pdo->query("SELECT id, section, level FROM certifications WHERE status = 'active'")->fetchAll();
        $codeToId = [];
        foreach ($pdo->query("SELECT id, code FROM certifications")->fetchAll() as $c) $codeToId[$c['code']] = (int)$c['id'];
        $bySection = []; $byLevel = [];
        foreach ($active as $c) {
            $bySection[$c['section'] ?? ''][] = (int)$c['id'];
            if ($c['level'] !== null) $byLevel[(string)$c['level']][] = (int)$c['id'];
        }
        $hv = $pdo->prepare("SELECT badge_id FROM cert_member_badges WHERE member_id = ?"); $hv->execute([$memberId]);
        $have = array_map('intval', array_column($hv->fetchAll(), 'badge_id'));
        $awarded = 0;
        foreach ($pdo->query("SELECT * FROM cert_badges WHERE is_active = true")->fetchAll() as $badge) {
            if (in_array((int)$badge['id'], $have, true)) continue;
            if (self::memberQualifies($badge, $completedIds, $completedCodes, $bySection, $byLevel, $codeToId)) {
                $pdo->prepare("INSERT INTO cert_member_badges (member_id, badge_id, earned_date, created_at) VALUES (?, ?, ?, NOW())")
                    ->execute([$memberId, (int)$badge['id'], date('Y-m-d')]);
                $awarded++;
            }
        }
        return $awarded;
    }

    private static function evaluateAllMembers(PDO $pdo): int
    {
        $rows = $pdo->query("SELECT DISTINCT member_id FROM member_certifications WHERE status = 'completed'")->fetchAll();
        $total = 0;
        foreach ($rows as $r) $total += self::evaluateMemberBadges($pdo, (int)$r['member_id']);
        return $total;
    }

    private static function syncToolBadge(PDO $pdo, array $cert): void
    {
        $all = $pdo->query("SELECT * FROM cert_badges WHERE criteria_type = 'tool'")->fetchAll();
        $existing = array_values(array_filter($all, function ($b) use ($cert) {
            $cv = $b['criteria_value'] ? json_decode($b['criteria_value'], true) : [];
            return ($cv['cert_code'] ?? null) === $cert['code'];
        }));
        if ((bool)$cert['is_tool_gate'] && $cert['status'] !== 'retired') {
            $label = $cert['tool_name'] ?: $cert['name'];
            $cv = json_encode(['cert_code' => $cert['code']]);
            if ($existing) {
                $pdo->prepare("UPDATE cert_badges SET name = ?, is_active = true, criteria_value = ? WHERE id = ?")
                    ->execute(["Cleared: {$label}", $cv, (int)$existing[0]['id']]);
            } else {
                $pdo->prepare("INSERT INTO cert_badges (name, description, icon_name, color, criteria_type, criteria_value, display_order, is_active, created_at)
                               VALUES (?, ?, 'ShieldCheck', '#c62828', 'tool', ?, 500, true, NOW())")
                    ->execute(["Cleared: {$label}", "Holds the {$cert['name']} certification.", $cv]);
            }
        } else {
            foreach ($existing as $b) $pdo->prepare("UPDATE cert_badges SET is_active = false WHERE id = ?")->execute([(int)$b['id']]);
        }
    }

    // ── Badges endpoints ─────────────────────────────────────────────────
    public static function listBadges(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'certifications.view', 'read')) return Http::error($res, 'Access denied', 403);
        $badges = $pdo->query("SELECT * FROM cert_badges WHERE is_active = true ORDER BY display_order, id")->fetchAll();
        $ec = $pdo->query("SELECT badge_id, COUNT(id) AS n FROM cert_member_badges GROUP BY badge_id")->fetchAll();
        $counts = [];
        foreach ($ec as $r) $counts[(int)$r['badge_id']] = (int)$r['n'];
        return Http::json($res, array_map(fn($b) => array_merge(self::serializeBadge($b), ['earned_count' => $counts[(int)$b['id']] ?? 0]), $badges));
    }

    private static function badgePayload(array $d): array
    {
        $out = [];
        $intF = ['display_order']; $boolF = ['is_active']; $jsonF = ['criteria_value'];
        foreach (['name', 'description', 'icon_name', 'color', 'criteria_type', 'criteria_value', 'display_order', 'is_active'] as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = $d[$f];
            if ($v !== null && in_array($f, $intF, true)) $v = (int)$v;
            elseif ($v !== null && in_array($f, $boolF, true)) $v = (int)(bool)$v;
            elseif (in_array($f, $jsonF, true)) $v = json_encode($v ?? new \stdClass());
            $out[$f] = $v;
        }
        return $out;
    }

    public static function createBadge(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $ins = $pdo->prepare("INSERT INTO cert_badges (name, description, icon_name, color, criteria_type, criteria_value, display_order, is_active, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, true, NOW())");
        $ins->execute([trim((string)($d['name'] ?? '')), $d['description'] ?? null, $d['icon_name'] ?? 'Medal',
            $d['color'] ?? '#6a1b9a', $d['criteria_type'] ?? '', json_encode($d['criteria_value'] ?? new \stdClass()), (int)($d['display_order'] ?? 0)]);
        $id = (int)$pdo->lastInsertId();
        $b = self::loadBadge($pdo, $id);
        Audit::write($pdo, (int)$cur['id'], 'cert_badges', $id, 'create', null, ['name' => $b['name']]);
        $awarded = self::evaluateAllMembers($pdo);
        return Http::json($res, array_merge(self::serializeBadge($b), ['newly_awarded' => $awarded]), 201);
    }

    private static function loadBadge(PDO $pdo, int $id): ?array
    {
        $s = $pdo->prepare("SELECT * FROM cert_badges WHERE id = ?"); $s->execute([$id]);
        return $s->fetch() ?: null;
    }

    public static function updateBadge(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['badge_id'];
        if (!self::loadBadge($pdo, $id)) return Http::error($res, 'Badge not found', 404);
        $payload = self::badgePayload((array)$req->getParsedBody());
        if ($payload) {
            $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($payload)));
            $args = array_values($payload); $args[] = $id;
            $pdo->prepare("UPDATE cert_badges SET $set WHERE id = ?")->execute($args);
        }
        $awarded = self::evaluateAllMembers($pdo);
        Audit::write($pdo, (int)$cur['id'], 'cert_badges', $id, 'update');
        return Http::json($res, array_merge(self::serializeBadge(self::loadBadge($pdo, $id)), ['newly_awarded' => $awarded]));
    }

    public static function deleteBadge(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $cur, 'certifications.manage', 'write')) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['badge_id'];
        $b = self::loadBadge($pdo, $id);
        if (!$b) return Http::error($res, 'Badge not found', 404);
        Audit::write($pdo, (int)$cur['id'], 'cert_badges', $id, 'delete', ['name' => $b['name']], null);
        $pdo->prepare("DELETE FROM cert_badges WHERE id = ?")->execute([$id]);
        return Http::json($res, ['ok' => true]);
    }

    public static function toolClearances(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'certifications.view', 'read')) return Http::error($res, 'Access denied', 403);
        $certs = $pdo->query("SELECT * FROM certifications WHERE is_tool_gate = true ORDER BY code")->fetchAll();
        $out = [];
        foreach ($certs as $c) {
            $rs = $pdo->prepare("SELECT mem.id, mem.first_name, mem.last_name FROM member_certifications mc
                                 JOIN members mem ON mem.id = mc.member_id
                                 WHERE mc.certification_id = ? AND mc.status = 'completed'");
            $rs->execute([(int)$c['id']]);
            $members = array_map(fn($r) => ['member_id' => (int)$r['id'], 'name' => trim($r['first_name'] . ' ' . $r['last_name'])], $rs->fetchAll());
            usort($members, fn($a, $b) => strcmp($a['name'], $b['name']));
            $out[] = ['code' => $c['code'], 'name' => $c['name'], 'tool_name' => $c['tool_name'] ?: $c['name'],
                'cleared_count' => count($members), 'members' => $members];
        }
        return Http::json($res, $out);
    }

    public static function memberBadges(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $me = Auth::currentMember($pdo, $req);
        if (!$me) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        // Security #13: your own, or a roster-viewer's (members.directory). Parents/volunteers
        // without directory access can only see their own badges.
        if ((int)$me['id'] !== $mid && !Permissions::memberCan($pdo, $me, 'members.directory', 'read')) {
            return Http::error($res, 'Access denied', 403);
        }
        $rs = $pdo->prepare("SELECT certification_id FROM member_certifications WHERE member_id = ? AND status = 'completed'");
        $rs->execute([$mid]);
        $completedIds = array_map('intval', array_column($rs->fetchAll(), 'certification_id'));
        $completedCount = count($completedIds);
        $active = $pdo->query("SELECT id, section, level FROM certifications WHERE status = 'active'")->fetchAll();
        $bySection = []; $byLevel = [];
        foreach ($active as $c) {
            $bySection[$c['section'] ?? ''][] = (int)$c['id'];
            if ($c['level'] !== null) $byLevel[(string)$c['level']][] = (int)$c['id'];
        }
        $eb = $pdo->prepare("SELECT badge_id, earned_date FROM cert_member_badges WHERE member_id = ?"); $eb->execute([$mid]);
        $earned = [];
        foreach ($eb->fetchAll() as $r) $earned[(int)$r['badge_id']] = $r['earned_date'];
        $outEarned = []; $outProgress = [];
        foreach ($pdo->query("SELECT * FROM cert_badges WHERE is_active = true ORDER BY display_order, id")->fetchAll() as $b) {
            $sb = self::serializeBadge($b);
            if (array_key_exists((int)$b['id'], $earned)) {
                $outEarned[] = array_merge($sb, ['earned_date' => $earned[(int)$b['id']]]);
            } else {
                $cv = $b['criteria_value'] ? json_decode($b['criteria_value'], true) : [];
                $have = 0; $need = 0;
                if ($b['criteria_type'] === 'count') { $need = (int)($cv['threshold'] ?? 0); $have = min($completedCount, $need); }
                elseif ($b['criteria_type'] === 'section') { $ids = $bySection[$cv['section'] ?? ''] ?? []; $need = count($ids); $have = count(array_intersect($ids, $completedIds)); }
                elseif ($b['criteria_type'] === 'level') { $ids = $byLevel[(string)($cv['level'] ?? '')] ?? []; $need = count($ids); $have = count(array_intersect($ids, $completedIds)); }
                if ($need > 0) $outProgress[] = array_merge($sb, ['have' => $have, 'need' => $need]);
            }
        }
        usort($outProgress, fn($a, $b) => ($b['need'] ? $b['have'] / $b['need'] : 0) <=> ($a['need'] ? $a['have'] / $a['need'] : 0));
        return Http::json($res, ['member_id' => $mid, 'earned' => $outEarned, 'progress' => array_slice($outProgress, 0, 4)]);
    }

    // ── Team scoring ─────────────────────────────────────────────────────
    private static function teamScore(int $certs, int $members): int
    {
        if ($members <= 0) return 0;
        return (int)ceil($certs / $members * 100);
    }

    private static function completedCounts(PDO $pdo): array
    {
        $rows = $pdo->query("SELECT member_id, COUNT(id) AS n FROM member_certifications WHERE status = 'completed' GROUP BY member_id")->fetchAll();
        $out = [];
        foreach ($rows as $r) $out[(int)$r['member_id']] = (int)$r['n'];
        return $out;
    }

    private static function currentSeasonLabel(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return $y . '-' . ($y + 1);
    }

    public static function leaderboard(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'certifications.view', 'read')) return Http::error($res, 'Access denied', 403);
        $season = self::currentSeasonLabel();
        $counts = self::completedCounts($pdo);
        $tss = $pdo->prepare("SELECT ts.id, ts.team_name, t.team_number, p.name AS program
                              FROM team_seasons ts JOIN teams t ON t.id = ts.team_id
                              LEFT JOIN programs p ON p.id = t.program_id WHERE ts.season = ?");
        $tss->execute([$season]);
        $teamsOut = [];
        foreach ($tss->fetchAll() as $ts) {
            $as = $pdo->prepare("SELECT m.id FROM team_member_assignments tma JOIN members m ON m.id = tma.member_id
                                 WHERE tma.team_season_id = ? AND tma.status = 'active' AND m.member_type = 'youth'
                                 AND (m.is_archived = false OR m.is_archived IS NULL)");
            $as->execute([(int)$ts['id']]);
            $mids = array_map('intval', array_column($as->fetchAll(), 'id'));
            if (!$mids) continue;
            $completed = array_sum(array_map(fn($mid) => $counts[$mid] ?? 0, $mids));
            $teamsOut[] = [
                'team_season_id' => (int)$ts['id'],
                'team_number' => $ts['team_number'],
                'team_name' => $ts['team_name'] ?: ($ts['team_number'] !== null ? 'Team ' . $ts['team_number'] : null),
                'program' => $ts['program'], 'member_count' => count($mids),
                'certs_completed' => $completed, 'score' => self::teamScore($completed, count($mids)),
            ];
        }
        usort($teamsOut, fn($a, $b) => [-$a['score'], -$a['certs_completed']] <=> [-$b['score'], -$b['certs_completed']]);
        foreach ($teamsOut as $i => &$t) $t['rank'] = $i + 1;
        unset($t);
        $groups = [];
        $groupDefs = [
            ['Mentors', "SELECT id FROM members WHERE member_type = 'mentor' AND is_active = true AND (is_junior_mentor = false OR is_junior_mentor IS NULL) AND (is_archived = false OR is_archived IS NULL)"],
            ['Junior Mentors', "SELECT id FROM members WHERE is_junior_mentor = true AND is_active = true AND (is_archived = false OR is_archived IS NULL)"],
        ];
        foreach ($groupDefs as [$label, $sql]) {
            $gm = array_map('intval', array_column($pdo->query($sql)->fetchAll(), 'id'));
            if (!$gm) continue;
            $gc = array_sum(array_map(fn($mid) => $counts[$mid] ?? 0, $gm));
            $groups[] = ['label' => $label, 'member_count' => count($gm), 'certs_completed' => $gc, 'score' => self::teamScore($gc, count($gm))];
        }
        return Http::json($res, ['season' => $season, 'teams' => $teamsOut, 'groups' => $groups]);
    }

    public static function teamCerts(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!self::perm($pdo, $m, 'certifications.view', 'read')) return Http::error($res, 'Access denied', 403);
        $tsid = (int)$route['team_season_id'];
        $ts = $pdo->prepare("SELECT ts.id, t.team_number FROM team_seasons ts LEFT JOIN teams t ON t.id = ts.team_id WHERE ts.id = ?");
        $ts->execute([$tsid]); $tsRow = $ts->fetch();
        if (!$tsRow) return Http::error($res, 'Team season not found', 404);
        $counts = self::completedCounts($pdo);
        $as = $pdo->prepare("SELECT m.id, m.first_name, m.last_name, m.photo_url FROM team_member_assignments tma
                             JOIN members m ON m.id = tma.member_id
                             WHERE tma.team_season_id = ? AND tma.status = 'active' AND m.member_type = 'youth'
                             AND (m.is_archived = false OR m.is_archived IS NULL)");
        $as->execute([$tsid]);
        $members = array_map(fn($a) => [
            'member_id' => (int)$a['id'], 'first_name' => $a['first_name'], 'last_name' => $a['last_name'],
            'photo_url' => $a['photo_url'], 'completed_count' => $counts[(int)$a['id']] ?? 0,
        ], $as->fetchAll());
        usort($members, fn($a, $b) => $b['completed_count'] <=> $a['completed_count']);
        $completed = array_sum(array_column($members, 'completed_count'));
        $mids = array_column($members, 'member_id');
        $teamBadges = [];
        if ($mids) {
            $ph = implode(',', array_fill(0, count($mids), '?'));
            $rows = $pdo->prepare("SELECT b.*, COUNT(mb.id) AS holder FROM cert_badges b
                                   JOIN cert_member_badges mb ON mb.badge_id = b.id
                                   WHERE mb.member_id IN ($ph) GROUP BY b.id");
            $rows->execute($mids);
            $teamBadges = array_map(fn($b) => array_merge(self::serializeBadge($b), ['holder_count' => (int)$b['holder']]), $rows->fetchAll());
            usort($teamBadges, fn($a, $b) => [-$a['holder_count'], $a['name']] <=> [-$b['holder_count'], $b['name']]);
        }
        return Http::json($res, [
            'team_season_id' => $tsid, 'team_number' => $tsRow['team_number'],
            'member_count' => count($members), 'certs_completed' => $completed,
            'score' => self::teamScore($completed, count($members)), 'members' => $members, 'badges' => $teamBadges,
        ]);
    }
}
