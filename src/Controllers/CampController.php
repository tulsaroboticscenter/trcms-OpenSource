<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Mailer;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Summer Camp module — kept entirely separate from members so transient campers
 * never clutter the roster. Phase 1: season config (the public registration on/off
 * toggle + editable waiver text), reusable camp programs, and the per-year sessions
 * (program × week) that the public form will list. Public registration intake and
 * registration processing land in later phases.
 *
 * Permissions: camp.view (read), camp.manage (write).
 */
final class CampController
{
    private static function view(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'camp.view', 'read'); }
    private static function manage(PDO $pdo, ?array $m): bool { return $m !== null && Permissions::memberCan($pdo, $m, 'camp.manage', 'write'); }

    private static function i($v): ?int { return $v === null || $v === '' ? null : (int)$v; }
    private static function s($v): ?string { $v = trim((string)($v ?? '')); return $v === '' ? null : $v; }
    private static function num($v): ?float { $v = trim((string)($v ?? '')); return ($v === '' || !is_numeric($v)) ? null : (float)$v; }
    /** Trim + length-cap a public-submitted value (defends the TEXT columns from huge pastes). */
    private static function cap($v, int $max = 2000): ?string { $v = self::s($v); return $v === null ? null : mb_substr($v, 0, $max); }

    /** A privacy-preserving hash of the client IP (for rate limiting only). */
    private static function ipHash(Request $req): string
    {
        $sp = $req->getServerParams();
        $xff = $req->getHeaderLine('X-Forwarded-For');
        $ip = $xff !== '' ? trim(explode(',', $xff)[0]) : ($sp['REMOTE_ADDR'] ?? '0.0.0.0');
        return hash('sha256', 'camp|' . $ip);
    }

    // ── Seasons ──────────────────────────────────────────────────────────
    private static function serializeSeason(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'year' => (int)$r['year'], 'name' => $r['name'],
            'registration_open' => (bool)$r['registration_open'],
            'intro_text' => $r['intro_text'], 'waiver_liability' => $r['waiver_liability'],
            'waiver_media' => $r['waiver_media'], 'waiver_firstaid' => $r['waiver_firstaid'],
            'is_active' => (bool)$r['is_active'],
        ];
    }

    public static function listSeasons(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM camp_seasons ORDER BY year DESC")->fetchAll();
        return Http::json($res, array_map([self::class, 'serializeSeason'], $rows));
    }

    /** The active season with the highest year — the one the public form uses. */
    public static function currentSeason(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $r = $pdo->query("SELECT * FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch();
        return Http::json($res, $r ? self::serializeSeason($r) : null);
    }

    public static function saveSeason(Request $req, Response $res, array $route = []): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $id = isset($route['season_id']) ? (int)$route['season_id'] : self::i($d['id'] ?? null);
        $cols = [
            'year' => self::i($d['year'] ?? null) ?? (int)date('Y'),
            'name' => self::s($d['name'] ?? null) ?? ('Summer ' . date('Y') . ' Robotics Camp'),
            'registration_open' => !empty($d['registration_open']) ? 1 : 0,
            'intro_text' => self::s($d['intro_text'] ?? null),
            'waiver_liability' => self::s($d['waiver_liability'] ?? null),
            'waiver_media' => self::s($d['waiver_media'] ?? null),
            'waiver_firstaid' => self::s($d['waiver_firstaid'] ?? null),
            'is_active' => array_key_exists('is_active', $d) ? (!empty($d['is_active']) ? 1 : 0) : 1,
        ];
        if ($id) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($cols)));
            $args = array_values($cols); $args[] = $id;
            $pdo->prepare("UPDATE camp_seasons SET $set, updated_at = NOW() WHERE id = ?")->execute($args);
        } else {
            $keys = array_keys($cols); $ph = implode(',', array_fill(0, count($keys), '?'));
            $pdo->prepare("INSERT INTO camp_seasons (" . implode(',', $keys) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())")
                ->execute(array_values($cols));
            $id = (int)$pdo->lastInsertId();
        }
        Audit::write($pdo, (int)$cur['id'], 'camp_seasons', $id, $id ? 'update' : 'create', null, ['registration_open' => $cols['registration_open']]);
        $r = $pdo->prepare("SELECT * FROM camp_seasons WHERE id = ?"); $r->execute([$id]);
        return Http::json($res, self::serializeSeason($r->fetch()));
    }

    /** PATCH /camp/seasons/{id}/registration — flip the master public-registration switch. */
    public static function toggleRegistration(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['season_id'];
        $d = (array)$req->getParsedBody();
        $open = !empty($d['registration_open']) ? 1 : 0;
        $pdo->prepare("UPDATE camp_seasons SET registration_open = ?, updated_at = NOW() WHERE id = ?")->execute([$open, $id]);
        Audit::write($pdo, (int)$cur['id'], 'camp_seasons', $id, 'update', null, ['registration_open' => $open]);
        return Http::json($res, ['ok' => true, 'registration_open' => (bool)$open]);
    }

    // ── Programs ─────────────────────────────────────────────────────────
    public static function listPrograms(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $rows = $pdo->query("SELECT * FROM camp_programs ORDER BY display_order, name")->fetchAll();
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'name' => $r['name'], 'description' => $r['description'],
            'display_order' => (int)$r['display_order'], 'is_active' => (bool)$r['is_active'],
        ], $rows));
    }

    public static function saveProgram(Request $req, Response $res, array $route = []): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $id = isset($route['program_id']) ? (int)$route['program_id'] : self::i($d['id'] ?? null);
        $name = self::s($d['name'] ?? null);
        if (!$name && !$id) return Http::error($res, 'Program name is required', 422);
        if ($id) {
            $pdo->prepare("UPDATE camp_programs SET name = COALESCE(?, name), description = ?, display_order = ?, is_active = ? WHERE id = ?")
                ->execute([$name, self::s($d['description'] ?? null), (int)($d['display_order'] ?? 0),
                    array_key_exists('is_active', $d) ? (!empty($d['is_active']) ? 1 : 0) : 1, $id]);
        } else {
            $pdo->prepare("INSERT INTO camp_programs (name, description, display_order, is_active, created_at) VALUES (?, ?, ?, 1, NOW())")
                ->execute([$name, self::s($d['description'] ?? null), (int)($d['display_order'] ?? 0)]);
            $id = (int)$pdo->lastInsertId();
        }
        Audit::write($pdo, (int)$cur['id'], 'camp_programs', $id, 'save', null, ['name' => $name]);
        $r = $pdo->prepare("SELECT * FROM camp_programs WHERE id = ?"); $r->execute([$id]); $p = $r->fetch();
        return Http::json($res, ['id' => (int)$p['id'], 'name' => $p['name'], 'description' => $p['description'],
            'display_order' => (int)$p['display_order'], 'is_active' => (bool)$p['is_active']]);
    }

    // ── Sessions (per-year camp offerings) ───────────────────────────────
    private static function serializeSession(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'season_id' => (int)$r['season_id'],
            'program_id' => $r['program_id'] !== null ? (int)$r['program_id'] : null,
            'program_name' => $r['program_name'] ?? null,
            'title' => $r['title'], 'week_label' => $r['week_label'],
            'start_date' => $r['start_date'], 'end_date' => $r['end_date'],
            'start_time' => $r['start_time'], 'end_time' => $r['end_time'],
            'age_band' => $r['age_band'], 'price' => $r['price'] !== null ? (float)$r['price'] : null,
            'capacity' => $r['capacity'] !== null ? (int)$r['capacity'] : null,
            'public_blurb' => $r['public_blurb'],
            'event_id' => $r['event_id'] !== null ? (int)$r['event_id'] : null,
            'is_open' => (bool)$r['is_open'], 'display_order' => (int)$r['display_order'],
            'registered_count' => isset($r['registered_count']) ? (int)$r['registered_count'] : 0,
        ];
    }

    public static function listSessions(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ''; $args = [];
        if (!empty($q['season_id'])) { $where = 'WHERE s.season_id = ?'; $args[] = (int)$q['season_id']; }
        $sql = "SELECT s.*, p.name AS program_name,
                       (SELECT COUNT(id) FROM camp_registrations r WHERE r.session_id = s.id) AS registered_count
                FROM camp_sessions s LEFT JOIN camp_programs p ON p.id = s.program_id
                $where ORDER BY s.display_order, s.start_date, s.title";
        $st = $pdo->prepare($sql); $st->execute($args);
        return Http::json($res, array_map([self::class, 'serializeSession'], $st->fetchAll()));
    }

    public static function saveSession(Request $req, Response $res, array $route = []): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $id = isset($route['session_id']) ? (int)$route['session_id'] : self::i($d['id'] ?? null);
        // Coerce each column only if it was actually sent, so a partial save (e.g. the
        // open/close toggle, which sends only is_open) never nulls out the rest of the camp.
        $coerce = [
            'season_id' => fn($v) => self::i($v),
            'program_id' => fn($v) => self::i($v),
            'title' => fn($v) => self::s($v),
            'week_label' => fn($v) => self::s($v),
            'start_date' => fn($v) => self::s($v),
            'end_date' => fn($v) => self::s($v),
            'start_time' => fn($v) => self::s($v),
            'end_time' => fn($v) => self::s($v),
            'age_band' => fn($v) => self::s($v),
            'price' => fn($v) => self::num($v),
            'capacity' => fn($v) => self::i($v),
            'public_blurb' => fn($v) => self::s($v),
            'event_id' => fn($v) => self::i($v),
            'is_open' => fn($v) => !empty($v) ? 1 : 0,
            'display_order' => fn($v) => (int)$v,
        ];
        $cols = [];
        foreach ($coerce as $k => $fn) if (array_key_exists($k, $d)) $cols[$k] = $fn($d[$k]);
        if (!$id) {
            // New camp: apply defaults for anything not provided, then require the essentials.
            $cols += ['is_open' => 0, 'display_order' => 0];
            if (empty($cols['season_id'])) return Http::error($res, 'season_id is required', 422);
            if (empty($cols['title'])) return Http::error($res, 'title is required', 422);
        }
        if (!$cols) return Http::error($res, 'Nothing to update', 422);
        if ($id) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($cols)));
            $args = array_values($cols); $args[] = $id;
            $pdo->prepare("UPDATE camp_sessions SET $set, updated_at = NOW() WHERE id = ?")->execute($args);
        } else {
            $keys = array_keys($cols); $ph = implode(',', array_fill(0, count($keys), '?'));
            $pdo->prepare("INSERT INTO camp_sessions (" . implode(',', $keys) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())")
                ->execute(array_values($cols));
            $id = (int)$pdo->lastInsertId();
        }
        Audit::write($pdo, (int)$cur['id'], 'camp_sessions', $id, $id ? 'update' : 'create', null, ['title' => $cols['title']]);
        $r = $pdo->prepare("SELECT s.*, p.name AS program_name FROM camp_sessions s LEFT JOIN camp_programs p ON p.id = s.program_id WHERE s.id = ?");
        $r->execute([$id]);
        return Http::json($res, self::serializeSession($r->fetch()));
    }

    // ── Registrations (internal processing) ─────────────────────────────
    private static function serializeReg(array $r): array
    {
        return [
            'id' => (int)$r['id'], 'session_id' => (int)$r['session_id'], 'session_title' => $r['session_title'] ?? null,
            'camper' => [
                'id' => (int)$r['camper_id'], 'first_name' => $r['first_name'], 'last_name' => $r['last_name'],
                'grade' => $r['grade'], 'school' => $r['school'], 'shirt_size' => $r['camper_shirt'],
                'medical_notes' => $r['medical_notes'], 'food_allergies' => $r['food_allergies'],
                'accommodations' => $r['accommodations'], 'prior_experience' => $r['prior_experience'],
                'member_id' => $r['member_id'] !== null ? (int)$r['member_id'] : null,
            ],
            'contact' => ['id' => $r['contact_id'] !== null ? (int)$r['contact_id'] : null, 'name' => $r['contact_name'], 'email' => $r['contact_email'], 'phone' => $r['contact_phone']],
            'status' => $r['status'], 'payment_method' => $r['payment_method'], 'payment_status' => $r['payment_status'],
            'confirmation_sent' => (bool)$r['confirmation_sent'], 'shirt_size' => $r['shirt_size'], 'shirt_received' => (bool)$r['shirt_received'],
            'emergency1_name' => $r['emergency1_name'], 'emergency1_relation' => $r['emergency1_relation'], 'emergency1_phone' => $r['emergency1_phone'],
            'emergency2_name' => $r['emergency2_name'], 'emergency2_relation' => $r['emergency2_relation'], 'emergency2_phone' => $r['emergency2_phone'],
            'waiver_liability_agreed' => (bool)$r['waiver_liability_agreed'], 'waiver_media_agreed' => (bool)$r['waiver_media_agreed'],
            'waiver_firstaid_agreed' => (bool)$r['waiver_firstaid_agreed'], 'waiver_agreed_by' => $r['waiver_agreed_by'], 'waiver_agreed_at' => $r['waiver_agreed_at'],
            'notes' => $r['notes'], 'created_at' => $r['created_at'],
        ];
    }

    private const REG_SELECT = "SELECT cr.*, cr.shirt_size AS shirt_size, c.first_name, c.last_name, c.grade, c.school,
            c.shirt_size AS camper_shirt, c.medical_notes, c.food_allergies, c.accommodations, c.prior_experience, c.member_id, c.contact_id,
            ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone,
            s.title AS session_title
        FROM camp_registrations cr
        JOIN campers c ON c.id = cr.camper_id
        LEFT JOIN camp_contacts ct ON ct.id = c.contact_id
        JOIN camp_sessions s ON s.id = cr.session_id";

    public static function listRegistrations(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['session_id'])) { $where[] = 'cr.session_id = ?'; $args[] = (int)$q['session_id']; }
        if (!empty($q['season_id'])) { $where[] = 's.season_id = ?'; $args[] = (int)$q['season_id']; }
        if (!empty($q['status'])) { $where[] = 'cr.status = ?'; $args[] = $q['status']; }
        $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $st = $pdo->prepare(self::REG_SELECT . " $clause ORDER BY c.last_name, c.first_name, s.title");
        $st->execute($args);
        return Http::json($res, array_map([self::class, 'serializeReg'], $st->fetchAll()));
    }

    /**
     * GET /camp/email-recipients — resolve the distinct parent/guardian contacts
     * for a set of registrations, filtered by season / program / session / status,
     * de-duplicated by email and excluding opted-out or address-less contacts.
     * Feeds the "Email contacts" composer (#85); the actual send reuses the bulk
     * communications pipeline so every message is logged in Message History.
     */
    /** "Ava" / "Ava and Bo" / "Ava, Bo, and Cara" — for personalized greetings. */
    private static function joinNames(array $names): string
    {
        $n = array_values(array_filter($names));
        $c = count($n);
        if ($c === 0) return '';
        if ($c === 1) return $n[0];
        if ($c === 2) return $n[0] . ' and ' . $n[1];
        return implode(', ', array_slice($n, 0, -1)) . ', and ' . end($n);
    }

    public static function emailRecipients(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        // Sending is a manage action; resolving the audience is too (it exposes emails).
        if (!self::manage($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ["ct.email IS NOT NULL", "ct.email <> ''", "ct.opt_out = 0"]; $args = [];

        // Camps: accept a comma-separated session_ids list (multi-select) or a single session_id.
        $sessionIds = array_values(array_filter(array_map('intval',
            explode(',', (string)($q['session_ids'] ?? ''))), fn($v) => $v > 0));
        if (!$sessionIds && !empty($q['session_id'])) $sessionIds = [(int)$q['session_id']];
        if ($sessionIds) {
            $where[] = 'cr.session_id IN (' . implode(',', array_fill(0, count($sessionIds), '?')) . ')';
            array_push($args, ...$sessionIds);
        }
        if (!empty($q['season_id'])) { $where[] = 's.season_id = ?'; $args[] = (int)$q['season_id']; }
        if (!empty($q['program_id'])) { $where[] = 's.program_id = ?'; $args[] = (int)$q['program_id']; }

        // Statuses: accept a comma-separated statuses list (multi-select) or a single status.
        $valid = ['pending', 'confirmed', 'waitlist', 'cancelled'];
        $statuses = array_values(array_intersect($valid,
            array_map('trim', explode(',', (string)($q['statuses'] ?? '')))));
        if (!$statuses && !empty($q['status']) && in_array($q['status'], $valid, true)) $statuses = [$q['status']];
        if ($statuses) {
            $where[] = 'cr.status IN (' . implode(',', array_fill(0, count($statuses), '?')) . ')';
            array_push($args, ...$statuses);
        } else {
            $where[] = "cr.status <> 'cancelled'"; // don't email cancelled regs by default
        }
        $clause = 'WHERE ' . implode(' AND ', $where);
        $sql = "SELECT ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
                       c.first_name, c.last_name, s.title AS session_title
                FROM camp_registrations cr
                JOIN campers c ON c.id = cr.camper_id
                JOIN camp_contacts ct ON ct.id = c.contact_id
                JOIN camp_sessions s ON s.id = cr.session_id
                $clause
                ORDER BY ct.name";
        $st = $pdo->prepare($sql); $st->execute($args);

        // Collapse to one row per email; list each camper so the sender sees who
        // a contact is the guardian for. Also collect per-recipient merge variables
        // for personalized emails (#106): {{camper_first_name}}, {{camper_names}},
        // {{parent_name}}, {{camp_sessions}}.
        $byEmail = [];
        foreach ($st->fetchAll() as $r) {
            $email = trim((string)$r['contact_email']);
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
            $key = strtolower($email);
            if (!isset($byEmail[$key])) {
                $byEmail[$key] = ['email' => $email, 'name' => $r['contact_name'] ?: $email, 'campers' => [],
                    '_firsts' => [], '_sessions' => []];
            }
            $camper = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
            if ($camper !== '' && !in_array($camper, $byEmail[$key]['campers'], true)) {
                $byEmail[$key]['campers'][] = $camper;
            }
            $first = trim((string)($r['first_name'] ?? ''));
            if ($first !== '' && !in_array($first, $byEmail[$key]['_firsts'], true)) $byEmail[$key]['_firsts'][] = $first;
            $sess = trim((string)($r['session_title'] ?? ''));
            if ($sess !== '' && !in_array($sess, $byEmail[$key]['_sessions'], true)) $byEmail[$key]['_sessions'][] = $sess;
        }
        // Build display list + merge vars, dropping the internal accumulators.
        $out = [];
        foreach ($byEmail as $r) {
            $out[] = [
                'email' => $r['email'], 'name' => $r['name'], 'campers' => $r['campers'],
                'vars' => [
                    'parent_name' => $r['name'],
                    'camper_first_name' => self::joinNames($r['_firsts']),
                    'camper_names' => self::joinNames($r['campers']),
                    'camp_sessions' => implode(', ', $r['_sessions']),
                ],
            ];
        }
        return Http::json($res, $out);
    }

    private const REG_FIELDS = ['status', 'payment_method', 'payment_status', 'confirmation_sent', 'shirt_size',
        'shirt_received', 'emergency1_name', 'emergency1_relation', 'emergency1_phone',
        'emergency2_name', 'emergency2_relation', 'emergency2_phone', 'notes'];
    private const REG_BOOL = ['confirmation_sent', 'shirt_received'];

    public static function updateRegistration(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['reg_id'];
        $d = (array)$req->getParsedBody();
        // The registration row this edit belongs to (need the camper/contact ids for nested edits).
        $own = $pdo->prepare("SELECT cr.camper_id, cr.session_id, c.contact_id FROM camp_registrations cr JOIN campers c ON c.id = cr.camper_id WHERE cr.id = ?");
        $own->execute([$id]); $ownRow = $own->fetch();
        if (!$ownRow) return Http::error($res, 'Registration not found', 404);
        $changed = false;
        // 0) Transfer to a different camp (session). Guards: target must exist and the
        //    camper must not already be registered for it (UNIQUE camper+session).
        if (array_key_exists('session_id', $d)) {
            $newSid = self::i($d['session_id']);
            if ($newSid && $newSid !== (int)$ownRow['session_id']) {
                $sx = $pdo->prepare("SELECT 1 FROM camp_sessions WHERE id = ?"); $sx->execute([$newSid]);
                if (!$sx->fetch()) return Http::error($res, 'That camp no longer exists.', 404);
                $dup = $pdo->prepare("SELECT 1 FROM camp_registrations WHERE camper_id = ? AND session_id = ? AND id <> ?");
                $dup->execute([(int)$ownRow['camper_id'], $newSid, $id]);
                if ($dup->fetch()) return Http::error($res, 'This camper is already registered for that camp.', 409);
                $pdo->prepare("UPDATE camp_registrations SET session_id = ?, updated_at = NOW() WHERE id = ?")->execute([$newSid, $id]);
                $changed = true;
            }
        }
        // 1) Registration-level fields.
        $set = []; $args = [];
        foreach (self::REG_FIELDS as $f) {
            if (!array_key_exists($f, $d)) continue;
            $v = in_array($f, self::REG_BOOL, true) ? (!empty($d[$f]) ? 1 : 0) : self::s($d[$f]);
            $set[] = "$f = ?"; $args[] = $v;
        }
        if ($set) {
            $args[] = $id;
            $pdo->prepare("UPDATE camp_registrations SET " . implode(', ', $set) . ", updated_at = NOW() WHERE id = ?")->execute($args);
            $changed = true;
        }
        // 2) Camper personal details (sent under "camper": {...}).
        if (is_array($d['camper'] ?? null)) {
            if (self::updateCamper($pdo, (int)$ownRow['camper_id'], $d['camper'])) $changed = true;
        }
        // 3) Parent/guardian contact (sent under "contact": {...}); only if this camper has one.
        if (is_array($d['contact'] ?? null) && $ownRow['contact_id'] !== null) {
            if (self::updateContactRow($pdo, (int)$ownRow['contact_id'], $d['contact'])) $changed = true;
        }
        if (!$changed) return Http::error($res, 'Nothing to update', 422);
        Audit::write($pdo, (int)$cur['id'], 'camp_registrations', $id, 'update', null, $d);
        $st = $pdo->prepare(self::REG_SELECT . " WHERE cr.id = ?"); $st->execute([$id]);
        $row = $st->fetch();
        return $row ? Http::json($res, self::serializeReg($row)) : Http::error($res, 'Registration not found', 404);
    }

    /** Camper personal-detail columns and their length caps (0 / null = TEXT, default cap). */
    private const CAMPER_COLS = [
        'first_name' => 80, 'last_name' => 80, 'grade' => 20, 'school' => 160, 'age_band' => 60,
        'shirt_size' => 20, 'medical_notes' => 2000, 'food_allergies' => 2000, 'accommodations' => 2000, 'prior_experience' => 2000,
    ];

    /** Update only the camper columns actually present in $data. Returns true if anything changed. */
    private static function updateCamper(\PDO $pdo, int $camperId, array $data): bool
    {
        $set = []; $args = [];
        foreach (self::CAMPER_COLS as $col => $cap) {
            if (!array_key_exists($col, $data)) continue;
            $set[] = "$col = ?"; $args[] = self::cap($data[$col], $cap);
        }
        if (!$set) return false;
        $args[] = $camperId;
        $pdo->prepare("UPDATE campers SET " . implode(', ', $set) . ", updated_at = NOW() WHERE id = ?")->execute($args);
        return true;
    }

    /** Update only the contact columns present in $data. Returns true if anything changed. */
    private static function updateContactRow(\PDO $pdo, int $contactId, array $data): bool
    {
        $caps = ['name' => 160, 'email' => 190, 'phone' => 40];
        $set = []; $args = [];
        foreach ($caps as $col => $cap) {
            if (!array_key_exists($col, $data)) continue;
            $v = self::cap($data[$col], $cap);
            if ($col === 'email' && $v !== null && !filter_var($v, FILTER_VALIDATE_EMAIL)) $v = null;
            $set[] = "$col = ?"; $args[] = $v;
        }
        if (!$set) return false;
        $args[] = $contactId;
        $pdo->prepare("UPDATE camp_contacts SET " . implode(', ', $set) . ", updated_at = NOW() WHERE id = ?")->execute($args);
        return true;
    }

    /** POST /camp/registrations — staff manually add one camper to a camp (walk-in / phone signup). */
    public static function createRegistration(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $sessionId = self::i($d['session_id'] ?? null);
        if (!$sessionId) return Http::error($res, 'Please choose a camp.', 422);
        $sx = $pdo->prepare("SELECT id FROM camp_sessions WHERE id = ?"); $sx->execute([$sessionId]);
        if (!$sx->fetch()) return Http::error($res, 'That camp no longer exists.', 404);

        // Fast path: enroll an EXISTING camper in another camp (no re-entry of details).
        $existingCamperId = self::i($d['camper_id'] ?? null);
        if ($existingCamperId) {
            $mx = $pdo->prepare("SELECT id FROM campers WHERE id = ?"); $mx->execute([$existingCamperId]);
            if (!$mx->fetch()) return Http::error($res, 'Camper not found.', 404);
            $dup = $pdo->prepare("SELECT id FROM camp_registrations WHERE camper_id = ? AND session_id = ?");
            $dup->execute([$existingCamperId, $sessionId]);
            if ($dup->fetch()) return Http::error($res, 'This camper is already registered for that camp.', 409);
            // Carry the per-registration details (emergency contacts + notes) from the
            // camper's most recent registration so a second camp isn't missing them (#130).
            $pv = $pdo->prepare("SELECT emergency1_name, emergency1_relation, emergency1_phone,
                                        emergency2_name, emergency2_relation, emergency2_phone, notes
                                 FROM camp_registrations WHERE camper_id = ? ORDER BY id DESC LIMIT 1");
            $pv->execute([$existingCamperId]);
            $prev = $pv->fetch() ?: [];
            $pdo->prepare("INSERT INTO camp_registrations (camper_id, session_id, status, payment_status,
                             emergency1_name, emergency1_relation, emergency1_phone,
                             emergency2_name, emergency2_relation, emergency2_phone, notes, created_at, updated_at)
                           VALUES (?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
                ->execute([$existingCamperId, $sessionId, self::s($d['status'] ?? null) ?? 'confirmed',
                    $prev['emergency1_name'] ?? null, $prev['emergency1_relation'] ?? null, $prev['emergency1_phone'] ?? null,
                    $prev['emergency2_name'] ?? null, $prev['emergency2_relation'] ?? null, $prev['emergency2_phone'] ?? null,
                    $prev['notes'] ?? null]);
            $regId = (int)$pdo->lastInsertId();
            Audit::write($pdo, (int)$cur['id'], 'camp_registrations', $regId, 'create', null, ['camper_id' => $existingCamperId, 'session_id' => $sessionId, 'added_camp' => true]);
            $st = $pdo->prepare(self::REG_SELECT . " WHERE cr.id = ?"); $st->execute([$regId]);
            return Http::json($res, self::serializeReg($st->fetch()));
        }

        $camper = is_array($d['camper'] ?? null) ? $d['camper'] : [];
        $contact = is_array($d['contact'] ?? null) ? $d['contact'] : [];
        $first = self::cap($camper['first_name'] ?? null, 80);
        if (!$first) return Http::error($res, "The camper's first name is required.", 422);
        $last = self::cap($camper['last_name'] ?? null, 80);
        if (!$last) return Http::error($res, "The camper's last name is required.", 422);

        $cName = self::cap($contact['name'] ?? null, 160);
        $cEmail = self::cap($contact['email'] ?? null, 190);
        if ($cEmail !== null && !filter_var($cEmail, FILTER_VALIDATE_EMAIL)) $cEmail = null;
        $cPhone = self::cap($contact['phone'] ?? null, 40);

        $pdo->beginTransaction();
        try {
            // Contact: dedupe by email when given, else create a fresh record (or none).
            $contactId = null;
            if ($cEmail !== null) {
                $x = $pdo->prepare("SELECT id FROM camp_contacts WHERE email = ? LIMIT 1"); $x->execute([$cEmail]);
                $h = $x->fetch();
                if ($h) {
                    $contactId = (int)$h['id'];
                    $pdo->prepare("UPDATE camp_contacts SET name = COALESCE(?, name), phone = COALESCE(?, phone), updated_at = NOW() WHERE id = ?")
                        ->execute([$cName, $cPhone, $contactId]);
                }
            }
            if ($contactId === null && ($cName !== null || $cEmail !== null || $cPhone !== null)) {
                $pdo->prepare("INSERT INTO camp_contacts (name, email, phone, marketing_consent, source, created_at, updated_at) VALUES (?, ?, ?, 0, 'staff_entry', NOW(), NOW())")
                    ->execute([$cName ?? '(unknown)', $cEmail, $cPhone]);
                $contactId = (int)$pdo->lastInsertId();
            }

            // Camper: reuse an existing one under this contact with the same name, else create.
            $camperId = null;
            if ($contactId !== null) {
                $mx = $pdo->prepare("SELECT id FROM campers WHERE contact_id = ? AND first_name = ? AND COALESCE(last_name,'') = COALESCE(?, '') LIMIT 1");
                $mx->execute([$contactId, $first, $last]); $mh = $mx->fetch();
                if ($mh) $camperId = (int)$mh['id'];
            }
            if ($camperId === null) {
                $cf = [
                    self::cap($camper['grade'] ?? null, 20), self::cap($camper['school'] ?? null, 160), self::cap($camper['age_band'] ?? null, 60),
                    self::cap($camper['shirt_size'] ?? null, 20), self::cap($camper['accommodations'] ?? null), self::cap($camper['medical_notes'] ?? null),
                    self::cap($camper['food_allergies'] ?? null), self::cap($camper['prior_experience'] ?? null),
                ];
                $pdo->prepare("INSERT INTO campers (contact_id, first_name, last_name, grade, school, age_band, shirt_size, accommodations, medical_notes, food_allergies, prior_experience, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
                    ->execute(array_merge([$contactId, $first, $last], $cf));
                $camperId = (int)$pdo->lastInsertId();
            }

            $pdo->prepare("INSERT INTO camp_registrations
                (camper_id, session_id, status, payment_method, payment_status, shirt_size,
                 emergency1_name, emergency1_relation, emergency1_phone, emergency2_name, emergency2_relation, emergency2_phone, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE updated_at = NOW()")
                ->execute([
                    $camperId, $sessionId,
                    self::s($d['status'] ?? null) ?? 'confirmed',
                    self::cap($d['payment_method'] ?? null, 40),
                    self::s($d['payment_status'] ?? null) ?? 'unpaid',
                    self::cap($d['shirt_size'] ?? null, 20),
                    self::cap($d['emergency1_name'] ?? null, 160), self::cap($d['emergency1_relation'] ?? null, 80), self::cap($d['emergency1_phone'] ?? null, 40),
                    self::cap($d['emergency2_name'] ?? null, 160), self::cap($d['emergency2_relation'] ?? null, 80), self::cap($d['emergency2_phone'] ?? null, 40),
                    self::cap($d['notes'] ?? null),
                ]);
            $regId = (int)$pdo->lastInsertId();
            if (!$regId) { // ON DUPLICATE hit — already registered for this camp
                $ex = $pdo->prepare("SELECT id FROM camp_registrations WHERE camper_id = ? AND session_id = ?");
                $ex->execute([$camperId, $sessionId]); $regId = (int)$ex->fetchColumn();
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not add the camper. Please try again.', 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'camp_registrations', $regId, 'create', null, ['session_id' => $sessionId, 'camper' => $first]);
        $st = $pdo->prepare(self::REG_SELECT . " WHERE cr.id = ?"); $st->execute([$regId]);
        return Http::json($res, self::serializeReg($st->fetch()));
    }

    /** POST /camp/campers/{camper_id}/convert-to-member — promote a camper into a youth member. */
    public static function convertToMember(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['camper_id'];
        $cx = $pdo->prepare("SELECT * FROM campers WHERE id = ?"); $cx->execute([$id]); $camper = $cx->fetch();
        if (!$camper) return Http::error($res, 'Camper not found', 404);
        if ($camper['member_id'] !== null) return Http::error($res, 'This camper is already linked to a member.', 409);
        $contact = null;
        if ($camper['contact_id'] !== null) { $tx = $pdo->prepare("SELECT * FROM camp_contacts WHERE id = ?"); $tx->execute([(int)$camper['contact_id']]); $contact = $tx->fetch() ?: null; }
        $pdo->beginTransaction();
        try {
            $memberId = MembersController::createFromCamper($pdo, $camper, $contact, (int)$cur['id']);
            $pdo->prepare("UPDATE campers SET member_id = ?, updated_at = NOW() WHERE id = ?")->execute([$memberId, $id]);
            if ($contact && $contact['member_id'] === null) {
                // leave the guardian contact as-is (parent isn't auto-created); just note the link if desired
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Could not convert camper: ' . $e->getMessage(), 500);
        }
        Audit::write($pdo, (int)$cur['id'], 'members', $memberId, 'camp.convert_to_member', null, ['camper_id' => $id]);
        return Http::json($res, ['ok' => true, 'member_id' => $memberId]);
    }

    // ── Attendance ───────────────────────────────────────────────────────
    /** GET /camp/sessions/{id}/attendance — the camp's day range × each registered camper's present-days. */
    public static function getAttendance(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $sid = (int)$route['session_id'];
        $sx = $pdo->prepare("SELECT start_date, end_date, title FROM camp_sessions WHERE id = ?"); $sx->execute([$sid]);
        $sess = $sx->fetch();
        if (!$sess) return Http::error($res, 'Camp not found', 404);
        $days = [];
        if ($sess['start_date']) {
            $end = $sess['end_date'] ?: $sess['start_date'];
            $d = new \DateTime($sess['start_date']); $e = new \DateTime($end);
            for ($i = 0; $d <= $e && $i < 60; $i++, $d->modify('+1 day')) $days[] = $d->format('Y-m-d');
        }
        // Attendance is for confirmed campers only — pending/waitlist/cancelled
        // registrations are excluded so cancelled campers don't appear (#71, #72).
        $rx = $pdo->prepare("SELECT cr.id AS reg_id, c.first_name, c.last_name FROM camp_registrations cr
                             JOIN campers c ON c.id = cr.camper_id
                             WHERE cr.session_id = ? AND cr.status = 'confirmed'
                             ORDER BY c.last_name, c.first_name");
        $rx->execute([$sid]);
        $regs = $rx->fetchAll();
        $ax = $pdo->prepare("SELECT registration_id, day_date, present FROM camp_attendance
                             WHERE registration_id IN (SELECT id FROM camp_registrations WHERE session_id = ?)");
        $ax->execute([$sid]);
        $present = [];
        foreach ($ax->fetchAll() as $a) $present[(int)$a['registration_id']][$a['day_date']] = (bool)$a['present'];
        return Http::json($res, [
            'session' => ['id' => $sid, 'title' => $sess['title']],
            'days' => $days,
            'campers' => array_map(fn($r) => [
                'registration_id' => (int)$r['reg_id'], 'name' => trim($r['first_name'] . ' ' . ($r['last_name'] ?? '')),
                'present' => $present[(int)$r['reg_id']] ?? (object)[],
            ], $regs),
        ]);
    }

    /** POST /camp/attendance — mark one camper present/absent for one day. */
    public static function markAttendance(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $regId = self::i($d['registration_id'] ?? null);
        $day = self::s($d['day_date'] ?? null);
        if (!$regId || !$day) return Http::error($res, 'registration_id and day_date are required', 422);
        $present = !empty($d['present']) ? 1 : 0;
        $pdo->prepare("INSERT INTO camp_attendance (registration_id, day_date, present, created_at) VALUES (?, ?, ?, NOW())
                       ON DUPLICATE KEY UPDATE present = VALUES(present)")->execute([$regId, $day, $present]);
        return Http::json($res, ['ok' => true, 'registration_id' => $regId, 'day_date' => $day, 'present' => (bool)$present]);
    }

    // ── Staffing visibility: who worked each camp, from the linked event's check-ins ──
    /**
     * GET /camp/staffing?season_id= — group the season's camps by their linked
     * calendar event ("week"); for each, list every member who CHECKED IN to that
     * event (with total hours + days present from `checkins`) and which camp(s)
     * they're tagged to. Hours are per-event, so a floater's time spans both camps.
     */
    public static function getStaffing(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $seasonId = self::i($req->getQueryParams()['season_id'] ?? null);
        if (!$seasonId) {
            $s = $pdo->query("SELECT id FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch();
            $seasonId = $s ? (int)$s['id'] : 0;
        }
        // Camps in the season that are linked to an event (only linked camps have check-in data).
        $cx = $pdo->prepare("SELECT s.id, s.title, s.week_label, s.event_id, e.name AS event_name, e.event_date, e.end_date
                             FROM camp_sessions s JOIN events e ON e.id = s.event_id
                             WHERE s.season_id = ? ORDER BY e.event_date, s.display_order, s.title");
        $cx->execute([$seasonId]);
        $rows = $cx->fetchAll();

        // Assignments for this season's camps: session_id => [member_id => role].
        $assign = [];
        $ax = $pdo->prepare("SELECT a.session_id, a.member_id, a.role FROM camp_worker_assignments a
                             JOIN camp_sessions s ON s.id = a.session_id WHERE s.season_id = ?");
        $ax->execute([$seasonId]);
        foreach ($ax->fetchAll() as $a) $assign[(int)$a['session_id']][(int)$a['member_id']] = $a['role'];

        // Group camps by their event (the "week").
        $weeks = [];
        foreach ($rows as $r) {
            $eid = (int)$r['event_id'];
            if (!isset($weeks[$eid])) {
                $weeks[$eid] = ['event_id' => $eid, 'event_name' => $r['event_name'],
                    'event_date' => $r['event_date'], 'end_date' => $r['end_date'], 'camps' => [], 'workers' => []];
            }
            $weeks[$eid]['camps'][] = ['session_id' => (int)$r['id'], 'title' => $r['title'], 'week_label' => $r['week_label']];
        }

        // For each week's event, pull check-ins aggregated per member.
        foreach ($weeks as $eid => &$wk) {
            $q = $pdo->prepare("SELECT c.member_id, m.first_name, m.last_name,
                        SUM(CASE WHEN c.time_out IS NOT NULL THEN " . \App\Controllers\ActivityController::checkinMinutesSql('c') . " ELSE 0 END) AS minutes,
                        COUNT(DISTINCT DATE(c.time_in)) AS days,
                        SUM(CASE WHEN c.time_out IS NULL THEN 1 ELSE 0 END) AS open_count
                     FROM checkins c JOIN members m ON m.id = c.member_id
                     WHERE c.event_id = ? GROUP BY c.member_id, m.first_name, m.last_name
                     ORDER BY m.last_name, m.first_name");
            $q->execute([$eid]);
            foreach ($q->fetchAll() as $w) {
                $mid = (int)$w['member_id'];
                $camps = [];
                foreach ($wk['camps'] as $c) if (array_key_exists($mid, $assign[$c['session_id']] ?? [])) $camps[] = $c['session_id'];
                $wk['workers'][] = [
                    'member_id' => $mid,
                    'name' => trim(($w['first_name'] ?? '') . ' ' . ($w['last_name'] ?? '')),
                    'minutes' => (int)$w['minutes'], 'hours' => round(((int)$w['minutes']) / 60, 1),
                    'days' => (int)$w['days'], 'open_count' => (int)$w['open_count'],
                    'assigned_session_ids' => $camps, 'is_floater' => count($camps) > 1,
                ];
            }
        }
        unset($wk);
        return Http::json($res, ['season_id' => $seasonId, 'weeks' => array_values($weeks)]);
    }

    /** POST /camp/staffing/assign — tag/untag a worker to a camp. Body: session_id, member_id, assigned(bool), role?. */
    public static function assignWorker(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $sessionId = self::i($d['session_id'] ?? null);
        $memberId = self::i($d['member_id'] ?? null);
        if (!$sessionId || !$memberId) return Http::error($res, 'session_id and member_id are required', 422);
        $assigned = !array_key_exists('assigned', $d) || !empty($d['assigned']);
        if ($assigned) {
            $pdo->prepare("INSERT INTO camp_worker_assignments (session_id, member_id, role, created_at) VALUES (?, ?, ?, NOW())
                           ON DUPLICATE KEY UPDATE role = VALUES(role)")
                ->execute([$sessionId, $memberId, self::cap($d['role'] ?? null, 60)]);
        } else {
            $pdo->prepare("DELETE FROM camp_worker_assignments WHERE session_id = ? AND member_id = ?")->execute([$sessionId, $memberId]);
        }
        Audit::write($pdo, (int)$cur['id'], 'camp_worker_assignments', $sessionId, $assigned ? 'create' : 'delete', null, ['member_id' => $memberId]);
        return Http::json($res, ['ok' => true, 'session_id' => $sessionId, 'member_id' => $memberId, 'assigned' => $assigned]);
    }

    // ── Resources (#68): planning links grouped into General + per-week buckets ──
    private const RESOURCE_BUCKETS = ['general', 'week1', 'week2', 'week3'];

    public static function listResources(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $seasonId = self::i($req->getQueryParams()['season_id'] ?? null);
        if (!$seasonId) {
            $s = $pdo->query("SELECT id FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch();
            $seasonId = $s ? (int)$s['id'] : 0;
        }
        $st = $pdo->prepare("SELECT * FROM camp_resources WHERE season_id = ? ORDER BY bucket, display_order, id");
        $st->execute([$seasonId]);
        return Http::json($res, array_map(fn($r) => [
            'id' => (int)$r['id'], 'season_id' => (int)$r['season_id'], 'bucket' => $r['bucket'],
            'title' => $r['title'], 'url' => $r['url'], 'resource_type' => $r['resource_type'],
            'notes' => $r['notes'], 'display_order' => (int)$r['display_order'],
        ], $st->fetchAll()));
    }

    public static function saveResource(Request $req, Response $res, array $route = []): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $id = isset($route['resource_id']) ? (int)$route['resource_id'] : self::i($d['id'] ?? null);
        $bucket = self::s($d['bucket'] ?? null);
        if ($bucket !== null && !in_array($bucket, self::RESOURCE_BUCKETS, true)) $bucket = 'general';
        $title = self::cap($d['title'] ?? null, 200);
        if ($id) {
            $pdo->prepare("UPDATE camp_resources SET bucket = COALESCE(?, bucket), title = COALESCE(?, title),
                              url = ?, resource_type = ?, notes = ?, display_order = ?, updated_at = NOW() WHERE id = ?")
                ->execute([$bucket, $title, self::cap($d['url'] ?? null, 1000), self::cap($d['resource_type'] ?? null, 30),
                    self::cap($d['notes'] ?? null), (int)($d['display_order'] ?? 0), $id]);
        } else {
            $seasonId = self::i($d['season_id'] ?? null);
            if (!$seasonId) return Http::error($res, 'season_id is required', 422);
            if (!$title) return Http::error($res, 'Title is required', 422);
            $pdo->prepare("INSERT INTO camp_resources (season_id, bucket, title, url, resource_type, notes, display_order, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
                ->execute([$seasonId, $bucket ?: 'general', $title, self::cap($d['url'] ?? null, 1000),
                    self::cap($d['resource_type'] ?? null, 30), self::cap($d['notes'] ?? null), (int)($d['display_order'] ?? 0)]);
            $id = (int)$pdo->lastInsertId();
        }
        $r = $pdo->prepare("SELECT * FROM camp_resources WHERE id = ?"); $r->execute([$id]); $row = $r->fetch();
        return Http::json($res, ['id' => (int)$row['id'], 'season_id' => (int)$row['season_id'], 'bucket' => $row['bucket'],
            'title' => $row['title'], 'url' => $row['url'], 'resource_type' => $row['resource_type'],
            'notes' => $row['notes'], 'display_order' => (int)$row['display_order']]);
    }

    public static function deleteResource(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['resource_id'];
        $pdo->prepare("DELETE FROM camp_resources WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'camp_resources', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    // ── Staff applications ───────────────────────────────────────────────
    public static function listStaffApps(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = ''; $args = [];
        if (!empty($q['season_id'])) { $where = 'WHERE a.season_id = ?'; $args[] = (int)$q['season_id']; }
        $st = $pdo->prepare("SELECT a.*, m.first_name AS m_first, m.last_name AS m_last FROM camp_staff_apps a
                             LEFT JOIN members m ON m.id = a.member_id $where ORDER BY a.created_at DESC");
        $st->execute($args);
        return Http::json($res, array_map(fn($a) => [
            'id' => (int)$a['id'], 'season_id' => $a['season_id'] !== null ? (int)$a['season_id'] : null,
            'member_id' => $a['member_id'] !== null ? (int)$a['member_id'] : null,
            'member_name' => $a['m_first'] ? trim($a['m_first'] . ' ' . $a['m_last']) : null,
            'name' => $a['name'], 'email' => $a['email'], 'phone' => $a['phone'], 'affiliation' => $a['affiliation'],
            'sessions_applied' => $a['sessions_applied'], 'roles_applied' => $a['roles_applied'],
            'prior_summers' => $a['prior_summers'], 'first_experience' => $a['first_experience'], 'shirt_size' => $a['shirt_size'],
            'why_interested' => $a['why_interested'], 'qualifications' => $a['qualifications'], 'status' => $a['status'], 'notes' => $a['notes'],
        ], $st->fetchAll()));
    }

    public static function saveStaffApp(Request $req, Response $res, array $route = []): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $id = isset($route['app_id']) ? (int)$route['app_id'] : self::i($d['id'] ?? null);
        // Auto-link to a member by matching email when one exists.
        $memberId = self::i($d['member_id'] ?? null);
        $email = self::s($d['email'] ?? null);
        if (!$memberId && $email) {
            $mx = $pdo->prepare("SELECT id FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1"); $mx->execute([$email]);
            $hit = $mx->fetch(); if ($hit) $memberId = (int)$hit['id'];
        }
        $cols = [
            'season_id' => self::i($d['season_id'] ?? null), 'member_id' => $memberId,
            'name' => self::s($d['name'] ?? null), 'email' => $email, 'phone' => self::s($d['phone'] ?? null),
            'affiliation' => self::s($d['affiliation'] ?? null), 'sessions_applied' => self::s($d['sessions_applied'] ?? null),
            'roles_applied' => self::s($d['roles_applied'] ?? null), 'prior_summers' => self::s($d['prior_summers'] ?? null),
            'first_experience' => self::s($d['first_experience'] ?? null), 'shirt_size' => self::s($d['shirt_size'] ?? null),
            'why_interested' => self::s($d['why_interested'] ?? null), 'qualifications' => self::s($d['qualifications'] ?? null),
            'status' => self::s($d['status'] ?? null) ?? 'pending', 'notes' => self::s($d['notes'] ?? null),
        ];
        if (!$id && !$cols['name']) return Http::error($res, 'Applicant name is required', 422);
        if ($id) {
            $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($cols)));
            $args = array_values($cols); $args[] = $id;
            $pdo->prepare("UPDATE camp_staff_apps SET $set, updated_at = NOW() WHERE id = ?")->execute($args);
        } else {
            $keys = array_keys($cols); $ph = implode(',', array_fill(0, count($keys), '?'));
            $pdo->prepare("INSERT INTO camp_staff_apps (" . implode(',', $keys) . ", created_at, updated_at) VALUES ($ph, NOW(), NOW())")->execute(array_values($cols));
            $id = (int)$pdo->lastInsertId();
        }
        Audit::write($pdo, (int)$cur['id'], 'camp_staff_apps', $id, 'save', null, ['name' => $cols['name']]);
        return Http::json($res, ['ok' => true, 'id' => $id]);
    }

    // ── Contacts (promo list) ───────────────────────────────────────────
    public static function listContacts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $q = $req->getQueryParams();
        $where = []; $args = [];
        if (!empty($q['consent'])) $where[] = 'ct.marketing_consent = 1 AND ct.opt_out = 0';
        if (!empty($q['search'])) { $where[] = '(ct.name LIKE ? OR ct.email LIKE ?)'; $args[] = '%' . $q['search'] . '%'; $args[] = '%' . $q['search'] . '%'; }
        $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $st = $pdo->prepare("SELECT ct.*, (SELECT COUNT(id) FROM campers c WHERE c.contact_id = ct.id) AS camper_count
                             FROM camp_contacts ct $clause ORDER BY ct.name");
        $st->execute($args);
        return Http::json($res, array_map(fn($c) => [
            'id' => (int)$c['id'], 'name' => $c['name'], 'email' => $c['email'], 'phone' => $c['phone'],
            'marketing_consent' => (bool)$c['marketing_consent'], 'opt_out' => (bool)$c['opt_out'],
            'source' => $c['source'], 'member_id' => $c['member_id'] !== null ? (int)$c['member_id'] : null,
            'camper_count' => (int)$c['camper_count'],
        ], $st->fetchAll()));
    }

    public static function updateContact(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['contact_id'];
        $d = (array)$req->getParsedBody();
        $set = []; $args = [];
        foreach (['name', 'email', 'phone', 'notes'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = self::s($d[$f]); }
        foreach (['marketing_consent', 'opt_out'] as $f) if (array_key_exists($f, $d)) { $set[] = "$f = ?"; $args[] = !empty($d[$f]) ? 1 : 0; }
        if (!$set) return Http::error($res, 'Nothing to update', 422);
        $args[] = $id;
        $pdo->prepare("UPDATE camp_contacts SET " . implode(', ', $set) . ", updated_at = NOW() WHERE id = ?")->execute($args);
        Audit::write($pdo, (int)$cur['id'], 'camp_contacts', $id, 'update', null, $d);
        return Http::json($res, ['ok' => true]);
    }

    /** GET /camp/contacts/export[?consent=1] — CSV of the promo list. */
    public static function exportContacts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $consentOnly = !empty($req->getQueryParams()['consent']);
        $where = $consentOnly ? 'WHERE marketing_consent = 1 AND opt_out = 0' : '';
        $rows = $pdo->query("SELECT name, email, phone, marketing_consent, opt_out, source FROM camp_contacts $where ORDER BY name")->fetchAll();
        $out = fopen('php://temp', 'r+');
        fputcsv($out, ['Name', 'Email', 'Phone', 'Marketing Consent', 'Opted Out', 'Source']);
        // Security #12: neutralize spreadsheet formula injection on user-supplied cells.
        $fs = fn ($v) => \App\Core\Csv::formulaSafe($v);
        foreach ($rows as $r) fputcsv($out, [$fs($r['name']), $fs($r['email']), $fs($r['phone']), $r['marketing_consent'] ? 'yes' : 'no', $r['opt_out'] ? 'yes' : 'no', $fs($r['source'])]);
        rewind($out); $csv = stream_get_contents($out); fclose($out);
        $res->getBody()->write($csv);
        return $res->withHeader('Content-Type', 'text/csv; charset=utf-8')
                   ->withHeader('Content-Disposition', 'attachment; filename="camp-contacts.csv"');
    }

    // ── Reporting ────────────────────────────────────────────────────────
    /** GET /camp/report?season_id= — shirt-size rollups + per-camp counts. */
    public static function report(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!self::view($pdo, Auth::currentMember($pdo, $req))) return Http::error($res, 'Access denied', 403);
        $seasonId = (int)($req->getQueryParams()['season_id'] ?? 0);
        if (!$seasonId) { $r = $pdo->query("SELECT id FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch(); $seasonId = $r ? (int)$r['id'] : 0; }

        // Camper shirts (registrations in this season; prefer the registration shirt, else camper's).
        $camperShirts = [];
        $cs = $pdo->prepare("SELECT COALESCE(NULLIF(cr.shirt_size,''), c.shirt_size) AS sz, COUNT(*) AS n
                             FROM camp_registrations cr JOIN campers c ON c.id = cr.camper_id JOIN camp_sessions s ON s.id = cr.session_id
                             WHERE s.season_id = ? GROUP BY sz");
        $cs->execute([$seasonId]);
        foreach ($cs->fetchAll() as $r) $camperShirts[$r['sz'] ?: '(unspecified)'] = (int)$r['n'];

        $ss = $pdo->prepare("SELECT COALESCE(NULLIF(shirt_size,''),'(unspecified)') AS sz, COUNT(*) AS n FROM camp_staff_apps WHERE season_id = ? GROUP BY sz");
        $ss->execute([$seasonId]);
        $staffShirts = [];
        foreach ($ss->fetchAll() as $r) $staffShirts[$r['sz']] = (int)$r['n'];

        // Ordered by week then camp (#99) so the Reports tab reads the same way as
        // the others. Natural-ish week order via LENGTH+value handles Week 2 < Week 10.
        $bc = $pdo->prepare("SELECT s.id, s.title, s.week_label,
                               (SELECT COUNT(id) FROM camp_registrations r WHERE r.session_id = s.id) AS registered,
                               (SELECT COUNT(id) FROM camp_registrations r WHERE r.session_id = s.id AND r.status = 'confirmed') AS confirmed,
                               (SELECT COUNT(id) FROM camp_registrations r WHERE r.session_id = s.id AND r.payment_status = 'paid') AS paid
                             FROM camp_sessions s WHERE s.season_id = ?
                             ORDER BY (s.week_label IS NULL OR s.week_label = ''), LENGTH(s.week_label), s.week_label, s.title");
        $bc->execute([$seasonId]);
        $byCamp = array_map(fn($r) => ['title' => $r['title'], 'week_label' => $r['week_label'], 'registered' => (int)$r['registered'], 'confirmed' => (int)$r['confirmed'], 'paid' => (int)$r['paid']], $bc->fetchAll());

        return Http::json($res, ['camper_shirts' => (object)$camperShirts, 'staff_shirts' => (object)$staffShirts, 'by_camp' => $byCamp]);
    }

    // ── Importer (one-time load of past Google-Form responses) ───────────
    private const MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

    /** Parse a Google-Form camp choice like "Week 1 – 22-26 June 9am-noon FIRST Lego League Robots". */
    private static function parseCampChoice(string $text): ?array
    {
        $t = trim($text);
        if ($t === '') return null;
        $waitlist = stripos($t, 'sold out') !== false || stripos($t, 'waitlist') !== false;
        if (!preg_match('/week\s*(\d+)/i', $t, $wm)) return null;
        $week = (int)$wm[1];
        $start = $end = null;
        if (preg_match('/(\d{1,2})\s*[-\x{2013}\x{2014}]\s*(\d{1,2})\s+([A-Za-z]{3,9})/u', $t, $dm)) {
            $mon = self::MONTHS[strtolower(substr($dm[3], 0, 3))] ?? null;
            if ($mon) { $start = sprintf('2026-%02d-%02d', $mon, (int)$dm[1]); $end = sprintf('2026-%02d-%02d', $mon, (int)$dm[2]); }
        }
        $tl = strtolower($t);
        $program = str_contains($tl, 'lego league') ? 'FIRST LEGO League'
            : (str_contains($tl, 'tech challenge') ? 'FIRST Tech Challenge'
            : (str_contains($tl, '3d print') ? '3D Printing'
            : (str_contains($tl, 'battle bot') ? 'Lego Battle Bots' : null)));
        if (!$program) return null;
        return ['week' => $week, 'week_label' => "Week $week", 'start' => $start, 'end' => $end, 'program' => $program, 'waitlist' => $waitlist];
    }

    /**
     * POST /camp/import-registrations — load the camp reg-form export into the live
     * season: contacts + campers + registrations, auto-creating the programs and the
     * camps (sessions) referenced by each row's camp choice. Captures emergency
     * contacts, payment method/status, shirt, and waiver agreement. Idempotent
     * (dedupes contact by email, camper by name, registration by camper+session).
     */
    public static function importContacts(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $files = $req->getUploadedFiles();
        $file = $files['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded', 400);
        $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)$file->getStream());
        // Parse via a stream so quoted fields with embedded newlines (waiver text,
        // medical notes) stay intact — splitting on line breaks would corrupt them.
        $fh = fopen('php://temp', 'r+'); fwrite($fh, $text); rewind($fh);
        $header = null; $contacts = 0; $campers = 0; $regs = 0; $errors = [];
        $find = function (array $row, array $needles) {
            foreach ($row as $k => $v) foreach ($needles as $n) if (str_contains($k, $n)) return trim((string)$v);
            return '';
        };

        // Find-or-create the active season to load into.
        $season = $pdo->query("SELECT * FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch();
        if (!$season) {
            $pdo->prepare("INSERT INTO camp_seasons (year, name, registration_open, is_active, created_at, updated_at) VALUES (?, ?, 0, 1, NOW(), NOW())")
                ->execute([(int)date('Y'), 'Summer ' . date('Y') . ' Robotics Camp']);
            $season = ['id' => (int)$pdo->lastInsertId()];
        }
        $seasonId = (int)$season['id'];
        $progCache = []; $sessCache = [];
        $program = function (string $name) use ($pdo, &$progCache) {
            if (isset($progCache[$name])) return $progCache[$name];
            $x = $pdo->prepare("SELECT id FROM camp_programs WHERE name = ? LIMIT 1"); $x->execute([$name]); $h = $x->fetch();
            if (!$h) { $pdo->prepare("INSERT INTO camp_programs (name, is_active, created_at) VALUES (?, 1, NOW())")->execute([$name]); $id = (int)$pdo->lastInsertId(); }
            else $id = (int)$h['id'];
            return $progCache[$name] = $id;
        };
        $session = function (array $c, string $ageBand) use ($pdo, $seasonId, $program, &$sessCache) {
            $pid = $program($c['program']);
            $key = $c['week_label'] . '|' . $pid;
            if (isset($sessCache[$key])) return $sessCache[$key];
            $x = $pdo->prepare("SELECT id, age_band FROM camp_sessions WHERE season_id = ? AND week_label = ? AND program_id = ? LIMIT 1");
            $x->execute([$seasonId, $c['week_label'], $pid]); $h = $x->fetch();
            if ($h) {
                if ($h['age_band'] && $ageBand && stripos($h['age_band'], $ageBand) === false)
                    $pdo->prepare("UPDATE camp_sessions SET age_band = '4th–12th grade' WHERE id = ?")->execute([(int)$h['id']]);
                return $sessCache[$key] = (int)$h['id'];
            }
            $pdo->prepare("INSERT INTO camp_sessions (season_id, program_id, title, week_label, start_date, end_date, start_time, end_time, age_band, is_open, display_order, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?, ?, '9:00 AM', '12:00 PM', ?, 0, ?, NOW(), NOW())")
                ->execute([$seasonId, $pid, $c['week_label'] . ' — ' . $c['program'], $c['week_label'], $c['start'], $c['end'], $ageBand, $c['week']]);
            return $sessCache[$key] = (int)$pdo->lastInsertId();
        };

        $idx = 0;
        while (($cells = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            $idx++;
            if ($header === null) { $header = array_map(fn($h) => strtolower(trim((string)$h)), $cells); continue; }
            if (count(array_filter($cells, fn($c) => trim((string)$c) !== '')) === 0) continue;
            $row = [];
            foreach ($header as $i => $h) $row[$h] = $cells[$i] ?? '';
            $gName = $find($row, ['name of person completing', 'parent', 'guardian']);
            $gEmail = $find($row, ['email address of person completing']); if ($gEmail === '') $gEmail = $find($row, ['email address', 'email']);
            $camperName = $find($row, ['camper name']);
            if ($camperName === '' && $gName === '') continue;
            if ($gEmail !== '' && !filter_var($gEmail, FILTER_VALIDATE_EMAIL)) $gEmail = '';
            try {
                // Contact (dedupe by email, else create).
                $contactId = null;
                if ($gEmail !== '') { $x = $pdo->prepare("SELECT id FROM camp_contacts WHERE email = ? LIMIT 1"); $x->execute([$gEmail]); $h = $x->fetch(); if ($h) $contactId = (int)$h['id']; }
                if ($contactId === null) {
                    $pdo->prepare("INSERT INTO camp_contacts (name, email, phone, marketing_consent, source, created_at, updated_at) VALUES (?, ?, ?, 0, 'import', NOW(), NOW())")
                        ->execute([$gName ?: '(unknown)', $gEmail ?: null, $find($row, ['phone number of person completing'])]);
                    $contactId = (int)$pdo->lastInsertId(); $contacts++;
                }
                if ($camperName === '') continue;
                // Camper (dedupe by contact + name).
                $parts = preg_split('/\s+/', trim($camperName), 2);
                $first = $parts[0]; $last = $parts[1] ?? '';
                $shirt = self::cap($find($row, ['t-shirt size']), 20);
                $camperFields = [
                    self::cap($find($row, ['grade in', 'camper grade', 'current grade']), 20),
                    self::cap($find($row, ['school']), 160), $shirt,
                    $find($row, ['medical conditions', 'medical']), $find($row, ['food allerg']),
                    $find($row, ['accommodations', 'supports']), $find($row, ['previous experience', 'experience with'])];
                $dup = $pdo->prepare("SELECT id FROM campers WHERE contact_id <=> ? AND first_name = ? AND COALESCE(last_name,'')=? LIMIT 1");
                $dup->execute([$contactId, $first, $last]); $mh = $dup->fetch();
                if ($mh) { $camperId = (int)$mh['id']; }
                else {
                    $pdo->prepare("INSERT INTO campers (contact_id, first_name, last_name, grade, school, shirt_size, medical_notes, food_allergies, accommodations, prior_experience, created_at, updated_at)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
                        ->execute(array_merge([$contactId, $first, $last], $camperFields));
                    $camperId = (int)$pdo->lastInsertId(); $campers++;
                }

                // Registrations from the two camp-choice columns.
                $choices = [];
                $c48 = self::parseCampChoice($find($row, ['4th-8th'])); if ($c48) $choices[] = [$c48, '4th–8th grade'];
                $c712 = self::parseCampChoice($find($row, ['7th-12th'])); if ($c712) $choices[] = [$c712, '7th–12th grade'];
                if (!$choices) continue;
                $payMethod = self::cap($find($row, ['how will you be paying']), 40);
                $paid = stripos($find($row, ['payment']), 'paid') !== false || $find($row, ['payment']) !== '';
                $confirmed = $find($row, ['conf email sent']) !== '' && stripos($find($row, ['conf email sent']), 'false') === false;
                $em = [self::cap($find($row, ['emergency contact name 1']), 120), self::cap($find($row, ["emergency contact 1's relation", 'relation to camper']), 60), self::cap($find($row, ["emergency contact 1's daytime"]), 40),
                       self::cap($find($row, ['emergency contact name 2']), 120), self::cap($find($row, ["emergency contact 2's relation"]), 60), self::cap($find($row, ["emergency contact 2's daytime"]), 40)];
                $wL = $find($row, ['liability waiver']) !== '' ? 1 : 0;
                $wM = $find($row, ['media release']) !== '' ? 1 : 0;
                $wF = $find($row, ['first aid', 'render first aid']) !== '' ? 1 : 0;
                foreach ($choices as [$c, $band]) {
                    $sid = $session($c, $band);
                    $status = $c['waitlist'] ? 'waitlist' : ($confirmed ? 'confirmed' : 'pending');
                    $pdo->prepare("INSERT INTO camp_registrations
                        (camper_id, session_id, status, payment_method, payment_status, confirmation_sent, shirt_size,
                         emergency1_name, emergency1_relation, emergency1_phone, emergency2_name, emergency2_relation, emergency2_phone,
                         waiver_liability_agreed, waiver_media_agreed, waiver_firstaid_agreed, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                        ON DUPLICATE KEY UPDATE status=VALUES(status), payment_method=VALUES(payment_method), payment_status=VALUES(payment_status),
                          confirmation_sent=VALUES(confirmation_sent), shirt_size=VALUES(shirt_size),
                          emergency1_name=VALUES(emergency1_name), emergency1_relation=VALUES(emergency1_relation), emergency1_phone=VALUES(emergency1_phone),
                          emergency2_name=VALUES(emergency2_name), emergency2_relation=VALUES(emergency2_relation), emergency2_phone=VALUES(emergency2_phone),
                          waiver_liability_agreed=VALUES(waiver_liability_agreed), waiver_media_agreed=VALUES(waiver_media_agreed), waiver_firstaid_agreed=VALUES(waiver_firstaid_agreed), updated_at=NOW()")
                        ->execute([$camperId, $sid, $status, $payMethod ?: null, $paid ? 'paid' : 'unpaid', $confirmed ? 1 : 0, $shirt ?: null,
                            $em[0] ?: null, $em[1] ?: null, $em[2] ?: null, $em[3] ?: null, $em[4] ?: null, $em[5] ?: null, $wL, $wM, $wF]);
                    $regs++;
                }
            } catch (\Throwable $e) {
                $errors[] = "Row $idx: " . $e->getMessage();
            }
        }
        fclose($fh);
        Audit::write($pdo, (int)$cur['id'], 'camp_registrations', null, 'import', null, ['contacts' => $contacts, 'campers' => $campers, 'registrations' => $regs]);
        return Http::json($res, ['ok' => true, 'contacts_created' => $contacts, 'campers_created' => $campers, 'registrations_created' => $regs, 'errors' => $errors]);
    }

    /** POST /camp/import-staff[?season_id=] — CSV of staff-application responses → camp_staff_apps. */
    public static function importStaffApps(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $files = $req->getUploadedFiles();
        $file = $files['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded', 400);
        $seasonId = self::i($req->getQueryParams()['season_id'] ?? null);
        $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)$file->getStream());
        $fh = fopen('php://temp', 'r+'); fwrite($fh, $text); rewind($fh);
        $header = null; $created = 0; $errors = [];
        $find = function (array $row, array $needles) {
            foreach ($row as $k => $v) foreach ($needles as $n) if (str_contains($k, $n)) return trim((string)$v);
            return '';
        };
        $idx = 0;
        while (($cells = fgetcsv($fh, 0, ',', '"', '')) !== false) {
            $idx++;
            if ($header === null) { $header = array_map(fn($h) => strtolower(trim((string)$h)), $cells); continue; }
            if (count(array_filter($cells, fn($c) => trim((string)$c) !== '')) === 0) continue;
            $row = [];
            foreach ($header as $i => $h) $row[$h] = $cells[$i] ?? '';
            $name = $find($row, ['name of person completing', 'name']);
            if ($name === '') continue;
            $email = $find($row, ['email address of person completing', 'email address', 'email']);
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) $email = '';
            try {
                $memberId = null;
                if ($email !== '') { $mx = $pdo->prepare("SELECT id FROM members WHERE LOWER(email) = LOWER(?) LIMIT 1"); $mx->execute([$email]); $h = $mx->fetch(); if ($h) $memberId = (int)$h['id']; }
                $pdo->prepare("INSERT INTO camp_staff_apps (season_id, member_id, name, email, phone, affiliation, sessions_applied, roles_applied, prior_summers, first_experience, shirt_size, why_interested, qualifications, status, notes, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())")
                    ->execute([$seasonId, $memberId, mb_substr($name, 0, 160), $email ?: null, $find($row, ['phone number', 'phone']),
                        $find($row, ['affiliated with', 'affiliation']), $find($row, ['which session', 'session(s)']), $find($row, ['staff role', 'role(s)']),
                        $find($row, ['previous summers']), $find($row, ['seasons of first', 'first robotics experience']),
                        $find($row, ['t-shirt size', 'shirt size']),
                        mb_substr($find($row, ['what appeals', 'appeals to you']), 0, 2000),
                        mb_substr($find($row, ['qualifications']), 0, 2000), mb_substr($find($row, ['notes/questions', 'notes']), 0, 2000)]);
                $created++;
            } catch (\Throwable $e) { $errors[] = "Row $idx: " . $e->getMessage(); }
        }
        fclose($fh);
        Audit::write($pdo, (int)$cur['id'], 'camp_staff_apps', null, 'import', null, ['created' => $created]);
        return Http::json($res, ['ok' => true, 'created' => $created, 'errors' => $errors]);
    }

    // ── Public registration (no auth — embedded on the WordPress site) ───
    /** GET /camp/public/registration — what the public form needs: open? + open camps + waivers. */
    public static function publicRegistration(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $season = $pdo->query("SELECT * FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch();
        if (!$season || !(int)$season['registration_open']) {
            return Http::json($res, ['open' => false, 'message' => 'Summer camp registration is not open right now. Please check back soon!']);
        }
        $st = $pdo->prepare("SELECT s.*, p.name AS program_name,
                               (SELECT COUNT(id) FROM camp_registrations r WHERE r.session_id = s.id) AS registered_count
                             FROM camp_sessions s LEFT JOIN camp_programs p ON p.id = s.program_id
                             WHERE s.season_id = ? AND s.is_open = 1 ORDER BY s.display_order, s.start_date, s.title");
        $st->execute([(int)$season['id']]);
        $sessions = array_map(function ($s) {
            $cap = $s['capacity'] !== null ? (int)$s['capacity'] : null;
            $reg = (int)$s['registered_count'];
            return [
                'id' => (int)$s['id'], 'title' => $s['title'], 'program_name' => $s['program_name'],
                'week_label' => $s['week_label'], 'age_band' => $s['age_band'],
                'start_date' => $s['start_date'], 'end_date' => $s['end_date'],
                'start_time' => $s['start_time'], 'end_time' => $s['end_time'],
                'price' => $s['price'] !== null ? (float)$s['price'] : null,
                'public_blurb' => $s['public_blurb'],
                'spots_left' => $cap !== null ? max(0, $cap - $reg) : null,
                'is_full' => $cap !== null && $reg >= $cap,
            ];
        }, $st->fetchAll());
        return Http::json($res, [
            'open' => true,
            'season' => [
                'name' => $season['name'], 'intro_text' => $season['intro_text'],
                'waiver_liability' => $season['waiver_liability'], 'waiver_media' => $season['waiver_media'],
                'waiver_firstaid' => $season['waiver_firstaid'],
            ],
            'sessions' => $sessions,
        ]);
    }

    /** POST /camp/public/register — a parent submits a registration (no auth). Lands as 'pending'. */
    public static function publicRegister(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $d = (array)$req->getParsedBody();
        // Honeypot: a hidden field bots fill in. Pretend success so they don't retry.
        if (self::s($d['website'] ?? null) !== null) return Http::json($res, ['ok' => true, 'registered' => 0]);

        // Per-IP rate limit: no more than 15 submissions/hour from one address.
        $ipHash = self::ipHash($req);
        $rl = $pdo->prepare("SELECT COUNT(id) FROM camp_submit_log WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 HOUR)");
        $rl->execute([$ipHash]);
        if ((int)$rl->fetchColumn() >= 15) return Http::error($res, 'Too many submissions from this connection. Please try again later.', 429);
        $pdo->prepare("INSERT INTO camp_submit_log (ip_hash, created_at) VALUES (?, NOW())")->execute([$ipHash]);

        $season = $pdo->query("SELECT * FROM camp_seasons WHERE is_active = 1 ORDER BY year DESC LIMIT 1")->fetch();
        if (!$season || !(int)$season['registration_open']) return Http::error($res, 'Registration is not open.', 403);

        $gName = self::cap($d['guardian_name'] ?? null, 160);
        $gEmail = self::cap($d['guardian_email'] ?? null, 190);
        $camperFirst = self::cap($d['camper_first_name'] ?? null, 80);
        $camperLast = self::cap($d['camper_last_name'] ?? null, 80);
        $sessionIds = is_array($d['session_ids'] ?? null) ? array_slice(array_values(array_unique(array_map('intval', $d['session_ids']))), 0, 10) : [];
        if (!$gName || !$gEmail) return Http::error($res, 'Your name and email are required.', 422);
        if (!filter_var($gEmail, FILTER_VALIDATE_EMAIL)) return Http::error($res, 'Please enter a valid email address.', 422);
        if (!$camperFirst) return Http::error($res, "The camper's first name is required.", 422);
        if (!$camperLast) return Http::error($res, "The camper's last name is required.", 422);
        if (!$sessionIds) return Http::error($res, 'Please choose at least one camp.', 422);
        if (empty($d['waiver_liability_agreed']) || empty($d['waiver_firstaid_agreed'])) {
            return Http::error($res, 'The liability waiver and first-aid consent must be agreed to.', 422);
        }

        // Only sessions that are open in the current season, with room.
        $in = implode(',', array_fill(0, count($sessionIds), '?'));
        $sx = $pdo->prepare("SELECT s.id, s.capacity, (SELECT COUNT(id) FROM camp_registrations r WHERE r.session_id = s.id) AS reg
                             FROM camp_sessions s WHERE s.id IN ($in) AND s.season_id = ? AND s.is_open = 1");
        $sx->execute(array_merge($sessionIds, [(int)$season['id']]));
        $valid = [];
        foreach ($sx->fetchAll() as $r) {
            if ($r['capacity'] !== null && (int)$r['reg'] >= (int)$r['capacity']) continue; // full
            $valid[] = (int)$r['id'];
        }
        if (!$valid) return Http::error($res, 'The selected camp(s) are no longer available. Please go back and pick another.', 409);

        $pdo->beginTransaction();
        try {
            // Contact (guardian) — dedupe by email; this is the durable promo record.
            $cx = $pdo->prepare("SELECT id FROM camp_contacts WHERE email = ? LIMIT 1"); $cx->execute([$gEmail]);
            $cRow = $cx->fetch();
            $consent = !empty($d['marketing_consent']) ? 1 : 0;
            if ($cRow) {
                $contactId = (int)$cRow['id'];
                $pdo->prepare("UPDATE camp_contacts SET name = ?, phone = COALESCE(?, phone), marketing_consent = ?, updated_at = NOW() WHERE id = ?")
                    ->execute([$gName, self::s($d['guardian_phone'] ?? null), $consent, $contactId]);
            } else {
                $pdo->prepare("INSERT INTO camp_contacts (name, email, phone, marketing_consent, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'public_form', NOW(), NOW())")
                    ->execute([$gName, $gEmail, self::s($d['guardian_phone'] ?? null), $consent]);
                $contactId = (int)$pdo->lastInsertId();
            }

            // Camper — dedupe by contact + name so a resubmit doesn't duplicate.
            $camperLast = self::s($d['camper_last_name'] ?? null);
            $mx = $pdo->prepare("SELECT id FROM campers WHERE contact_id = ? AND first_name = ? AND COALESCE(last_name,'') = COALESCE(?, '') LIMIT 1");
            $mx->execute([$contactId, $camperFirst, $camperLast]);
            $mRow = $mx->fetch();
            $camperFields = [self::cap($d['camper_grade'] ?? null, 20), self::cap($d['camper_school'] ?? null, 160), self::cap($d['camper_age_band'] ?? null, 60),
                self::cap($d['shirt_size'] ?? null, 20), self::cap($d['accommodations'] ?? null), self::cap($d['medical_notes'] ?? null),
                self::cap($d['food_allergies'] ?? null), self::cap($d['prior_experience'] ?? null)];
            if ($mRow) {
                $camperId = (int)$mRow['id'];
                $pdo->prepare("UPDATE campers SET grade=?, school=?, age_band=?, shirt_size=?, accommodations=?, medical_notes=?, food_allergies=?, prior_experience=?, updated_at=NOW() WHERE id=?")
                    ->execute(array_merge($camperFields, [$camperId]));
            } else {
                $pdo->prepare("INSERT INTO campers (contact_id, first_name, last_name, grade, school, age_band, shirt_size, accommodations, medical_notes, food_allergies, prior_experience, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())")
                    ->execute(array_merge([$contactId, $camperFirst, $camperLast], $camperFields));
                $camperId = (int)$pdo->lastInsertId();
            }

            // Snapshot the exact waiver wording agreed to, so the record stands on its
            // own even if the season's waiver text is edited later.
            $snap = [];
            if (!empty($d['waiver_liability_agreed']) && $season['waiver_liability']) $snap[] = "LIABILITY WAIVER:\n" . $season['waiver_liability'];
            if (!empty($d['waiver_media_agreed']) && $season['waiver_media']) $snap[] = "MEDIA RELEASE:\n" . $season['waiver_media'];
            if (!empty($d['waiver_firstaid_agreed']) && $season['waiver_firstaid']) $snap[] = "FIRST-AID CONSENT:\n" . $season['waiver_firstaid'];
            $waiverSnapshot = $snap ? implode("\n\n", $snap) : null;

            // One registration per chosen session (idempotent on camper+session).
            $ins = $pdo->prepare("INSERT INTO camp_registrations
                (camper_id, session_id, status, payment_method, shirt_size,
                 emergency1_name, emergency1_relation, emergency1_phone, emergency2_name, emergency2_relation, emergency2_phone,
                 waiver_liability_agreed, waiver_media_agreed, waiver_firstaid_agreed, waiver_agreed_by, waiver_agreed_at, waiver_snapshot, notes, created_at, updated_at)
                VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE payment_method=VALUES(payment_method), shirt_size=VALUES(shirt_size),
                  emergency1_name=VALUES(emergency1_name), emergency1_relation=VALUES(emergency1_relation), emergency1_phone=VALUES(emergency1_phone),
                  emergency2_name=VALUES(emergency2_name), emergency2_relation=VALUES(emergency2_relation), emergency2_phone=VALUES(emergency2_phone),
                  waiver_liability_agreed=VALUES(waiver_liability_agreed), waiver_media_agreed=VALUES(waiver_media_agreed),
                  waiver_firstaid_agreed=VALUES(waiver_firstaid_agreed), waiver_agreed_by=VALUES(waiver_agreed_by), waiver_agreed_at=NOW(),
                  waiver_snapshot=VALUES(waiver_snapshot), notes=VALUES(notes), updated_at=NOW()");
            $args0 = [
                self::cap($d['payment_method'] ?? null, 40), self::cap($d['shirt_size'] ?? null, 20),
                self::cap($d['emergency1_name'] ?? null, 160), self::cap($d['emergency1_relation'] ?? null, 80), self::cap($d['emergency1_phone'] ?? null, 40),
                self::cap($d['emergency2_name'] ?? null, 160), self::cap($d['emergency2_relation'] ?? null, 80), self::cap($d['emergency2_phone'] ?? null, 40),
                !empty($d['waiver_liability_agreed']) ? 1 : 0, !empty($d['waiver_media_agreed']) ? 1 : 0, !empty($d['waiver_firstaid_agreed']) ? 1 : 0,
                self::cap($d['waiver_agreed_by'] ?? null, 160) ?? $gName, $waiverSnapshot, self::cap($d['notes'] ?? null),
            ];
            foreach ($valid as $sid) {
                $ins->execute(array_merge([$camperId, $sid], $args0));
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            return Http::error($res, 'Something went wrong saving your registration. Please try again.', 500);
        }

        // Best-effort acknowledgement email to the parent (never block the registration on it).
        try {
            if ($gEmail && Mailer::enabled()) {
                $titles = [];
                $tq = $pdo->prepare("SELECT title FROM camp_sessions WHERE id IN (" . implode(',', array_fill(0, count($valid), '?')) . ")");
                $tq->execute($valid);
                foreach ($tq->fetchAll() as $t) $titles[] = htmlspecialchars($t['title']);
                $body = "<p>Hi " . htmlspecialchars($gName) . ",</p>"
                    . "<p>Thanks for registering <strong>" . htmlspecialchars($camperFirst) . "</strong> for " . ($season['name'] ? htmlspecialchars($season['name']) : 'summer camp') . ". We've received your registration for:</p>"
                    . "<ul><li>" . implode("</li><li>", $titles) . "</li></ul>"
                    . "<p>We'll follow up with payment and confirmation details. Reply to this email with any questions.</p>";
                Mailer::send($gEmail, 'TRC Summer Camp — registration received', Mailer::wrap('Registration received', $body));
            }
        } catch (\Throwable $e) { /* email is best-effort */ }

        return Http::json($res, ['ok' => true, 'registered' => count($valid),
            'message' => 'Thanks! Your registration has been received. We\'ll be in touch with payment and confirmation details.']);
    }

    public static function deleteSession(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!self::manage($pdo, $cur)) return Http::error($res, 'Access denied', 403);
        $id = (int)$route['session_id'];
        $n = (int)$pdo->query("SELECT COUNT(id) FROM camp_registrations WHERE session_id = " . $id)->fetchColumn();
        if ($n > 0) return Http::error($res, "Can't delete — $n registration(s) are attached to this camp. Close it instead.", 409);
        $pdo->prepare("DELETE FROM camp_sessions WHERE id = ?")->execute([$id]);
        Audit::write($pdo, (int)$cur['id'], 'camp_sessions', $id, 'delete', null, null);
        return Http::json($res, ['ok' => true, 'deleted' => true]);
    }
}
