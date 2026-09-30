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

/** Port of app/modules/event_participants/router.py (room-assignments deferred). */
final class ParticipantsController
{
    private static function statuses(PDO $pdo): array
    {
        $stmt = $pdo->prepare("SELECT `values` FROM system_config WHERE category = 'event_participant_statuses'"); $stmt->execute();
        $r = $stmt->fetch();
        $v = ($r && $r['values']) ? json_decode($r['values'], true) : null;
        return (is_array($v) && $v) ? $v : ['No Reply', 'Attending', 'Not Attending', 'Maybe'];
    }

    private static function serialize(array $p): array
    {
        return [
            'id' => (int)$p['id'], 'event_id' => (int)$p['event_id'],
            'member_id' => $p['member_id'] !== null ? (int)$p['member_id'] : null,
            'participant_type' => $p['participant_type'], 'other_name' => $p['other_name'],
            'section_label' => $p['section_label'], 'status' => $p['status'],
            'separate_travel_to' => (bool)($p['separate_travel_to'] ?? false),
            'separate_travel_from' => (bool)($p['separate_travel_from'] ?? false),
            'separate_housing' => (bool)($p['separate_housing'] ?? false),
            'notes' => $p['notes'], 'display_order' => $p['display_order'] !== null ? (int)$p['display_order'] : null,
            'first_name' => $p['first_name'] ?? null, 'last_name' => $p['last_name'] ?? null,
            'member_type' => $p['member_type'] ?? null, 'photo_url' => $p['photo_url'] ?? null,
        ];
    }

    private static function load(PDO $pdo, int $id): ?array
    {
        $stmt = $pdo->prepare("SELECT ep.*, m.first_name, m.last_name, m.member_type, m.photo_url
                               FROM event_participants ep LEFT JOIN members m ON m.id = ep.member_id WHERE ep.id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    /**
     * Keep a team-linked event's participant roster in step with the CURRENT team rosters:
     * add active members of linked teams who aren't on the list yet, and move a youth who
     * transferred to the team they're on now (their old "Team …" snapshot label is corrected).
     * Never deletes — individually-invited people and custom sections are left alone. Only run
     * for coordinators (it writes), and it's idempotent.
     */
    private static function reconcileTeamRosters(PDO $pdo, int $eid): void
    {
        $tq = $pdo->prepare(
            "SELECT ts.id AS tsid, ts.team_name, t.team_number, p.name AS prog
               FROM event_team_links l
               JOIN team_seasons ts ON ts.id = l.team_season_id
               JOIN teams t ON t.id = ts.team_id
               LEFT JOIN programs p ON p.id = t.program_id
              WHERE l.event_id = ?");
        $tq->execute([$eid]);
        $teams = $tq->fetchAll();
        if (!$teams) return;

        $typeSection = ['mentor' => 'Mentors', 'parent' => 'Parents', 'volunteer' => 'Volunteers'];
        // member_id => [current team label(s) they're actively on], and their type.
        $memberLabels = []; $memberType = []; $roster = [];
        $rq = $pdo->prepare(
            "SELECT a.member_id, m.member_type FROM team_member_assignments a
               JOIN members m ON m.id = a.member_id
              WHERE a.team_season_id = ? AND a.status = 'active' AND (m.is_active = 1 OR m.is_active IS NULL)");
        foreach ($teams as $tm) {
            $label = trim("Team {$tm['team_number']} — " . ($tm['team_name'] ?? '') . " ({$tm['prog']})", " —()");
            $rq->execute([(int)$tm['tsid']]);
            foreach ($rq->fetchAll() as $a) {
                $mid = (int)$a['member_id'];
                $memberType[$mid] = $a['member_type'];
                $memberLabels[$mid][] = $label;
                $roster[$mid] = true;
            }
        }
        if (!$roster) return;

        $find = $pdo->prepare("SELECT id, section_label FROM event_participants WHERE event_id = ? AND member_id = ?");
        $ins  = $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, section_label, status) VALUES (?, ?, 'member', ?, 'No Reply')");
        $upd  = $pdo->prepare("UPDATE event_participants SET section_label = ? WHERE id = ?");
        foreach (array_keys($roster) as $mid) {
            $type = $memberType[$mid] ?? 'youth';
            $labels = $memberLabels[$mid];
            $desired = $typeSection[$type] ?? $labels[0];   // youth → their team label; adults → role section
            $find->execute([$eid, $mid]);
            $row = $find->fetch();
            if (!$row) { $ins->execute([$eid, $mid, $desired]); continue; }
            // Relabel a youth who transferred: current label is a team snapshot but not one of the
            // teams they're on now. Leave custom sections and already-correct labels untouched.
            if ($type === 'youth'
                && str_starts_with((string)($row['section_label'] ?? ''), 'Team ')
                && !in_array($row['section_label'], $labels, true)) {
                $upd->execute([$labels[0], (int)$row['id']]);
            }
        }
    }

    public static function list(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $req);
        if (!$cur) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        // The Logistics participants panel passes ?sync=1: a coordinator viewing it gets a live
        // roster (add current team members, correct transfers). Other loads stay read-only so a
        // deliberately-removed participant isn't silently re-added.
        $sync = filter_var($req->getQueryParams()['sync'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if ($sync && Permissions::hasAnyRole($pdo, $cur, ['Mentor'])) self::reconcileTeamRosters($pdo, $eid);
        $stmt = $pdo->prepare("SELECT ep.*, m.first_name, m.last_name, m.member_type, m.photo_url
                               FROM event_participants ep LEFT JOIN members m ON m.id = ep.member_id
                               WHERE ep.event_id = ? AND (m.is_system = 0 OR m.is_system IS NULL)
                               ORDER BY ep.display_order, ep.section_label");
        $stmt->execute([$eid]);
        $rows = $stmt->fetchAll();
        // Outside-volunteer privacy: a volunteer sees no attendee roster at all; anyone
        // without events.view_volunteers (i.e. everyone but Admins and Lead Mentors) sees
        // the roster with outside volunteers removed.
        if (($cur['member_type'] ?? '') === 'volunteer') {
            $rows = [];
        } elseif (!Permissions::memberCan($pdo, $cur, 'events.view_volunteers', 'read')) {
            $rows = array_values(array_filter($rows, fn ($p) => ($p['member_type'] ?? '') !== 'volunteer'));
        }
        $sections = []; $byStatus = [];
        foreach ($rows as $p) {
            $label = $p['section_label'] ?: 'Others';
            $sections[$label][] = self::serialize($p);
            $byStatus[$p['status']] = ($byStatus[$p['status']] ?? 0) + 1;
        }
        foreach ($sections as &$arr) {
            usort($arr, fn($a, $b) => strcasecmp((string)($a['last_name'] ?: $a['other_name'] ?: ''), (string)($b['last_name'] ?: $b['other_name'] ?: '')));
        }
        unset($arr);
        $order = ['Mentors' => 1000, 'Parents' => 1001, 'Others' => 1002];
        uksort($sections, fn($a, $b) => [$order[$a] ?? 0, $a] <=> [$order[$b] ?? 0, $b]);
        $ordered = [];
        foreach ($sections as $label => $members) {
            $ordered[] = ['section_label' => $label, 'participants' => $members, 'count' => count($members)];
        }
        return Http::json($res, ['sections' => $ordered, 'total' => count($rows),
            'by_status' => $byStatus, 'available_statuses' => self::statuses($pdo)]);
    }

    public static function add(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $memberId = $d['member_id'] ?? null; $otherName = $d['other_name'] ?? null;
        if (!$memberId && !$otherName) return Http::error($res, 'Either member_id or other_name is required.', 400);
        if ($memberId) {
            $ex = $pdo->prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND member_id = ?"); $ex->execute([$eid, (int)$memberId]);
            if ($ex->fetch()) return Http::error($res, 'This member is already on the participant list.', 400);
        }
        $ins = $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, other_name, section_label, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $ins->execute([$eid, $memberId ? (int)$memberId : null, $memberId ? 'member' : 'other',
            $memberId ? null : $otherName, $d['section_label'] ?? 'Others', ($d['status'] ?? '') ?: 'No Reply', $d['notes'] ?? null]);
        $pid = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'event_participants', $pid, 'create', null, $d);
        return Http::json($res, self::serialize(self::load($pdo, $pid)), 201);
    }

    public static function update(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id']; $pid = (int)$route['participant_id'];
        $cur = $pdo->prepare("SELECT * FROM event_participants WHERE id = ? AND event_id = ?"); $cur->execute([$pid, $eid]);
        $p = $cur->fetch();
        if (!$p) return Http::error($res, 'Participant not found', 404);
        if ($p['member_id'] != $m['id'] && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $d = (array)$req->getParsedBody();
        $bools = ['separate_travel_to', 'separate_travel_from', 'separate_housing'];
        $set = []; $args = [];
        foreach (['status', 'notes', 'section_label', ...$bools] as $f) {
            if (array_key_exists($f, $d) && $d[$f] !== null) {
                $set[] = "$f = ?"; $args[] = in_array($f, $bools, true) ? (int)(bool)$d[$f] : $d[$f];
            }
        }
        if ($set) { array_push($args, $pid); $pdo->prepare("UPDATE event_participants SET " . implode(',', $set) . " WHERE id = ?")->execute($args); }
        Audit::write($pdo, (int)$m['id'], 'event_participants', $pid, 'update', null, $d);
        return Http::json($res, self::serialize(self::load($pdo, $pid)));
    }

    public static function remove(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id']; $pid = (int)$route['participant_id'];
        $cur = $pdo->prepare("SELECT 1 FROM event_participants WHERE id = ? AND event_id = ?"); $cur->execute([$pid, $eid]);
        if (!$cur->fetch()) return Http::error($res, 'Participant not found', 404);
        $pdo->prepare("DELETE FROM event_participants WHERE id = ?")->execute([$pid]);
        Audit::write($pdo, (int)$m['id'], 'event_participants', $pid, 'delete', null, null);
        return Http::json($res, ['ok' => true]);
    }

    public static function myRsvp(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $stmt = $pdo->prepare("SELECT id, status FROM event_participants WHERE event_id = ? AND member_id = ?");
        $stmt->execute([(int)$route['event_id'], (int)$m['id']]);
        $p = $stmt->fetch();
        return Http::json($res, $p ? ['status' => $p['status'], 'participant_id' => (int)$p['id']] : ['status' => null, 'participant_id' => null]);
    }

    /**
     * Bulk RSVP: set the current member's status on many events at once (the
     * calendar's list-mode multi-select). Body: { event_ids: [..], status }.
     * Upserts each participant row the same way single rsvp() does.
     */
    public static function bulkRsvp(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $d = (array)$req->getParsedBody();
        $status = $d['status'] ?? '';
        if (!in_array($status, ['Attending', 'Not Attending', 'Maybe'], true)) {
            return Http::error($res, 'Status must be one of: Attending, Not Attending, Maybe', 400);
        }
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($d['event_ids'] ?? [])))));
        if (!$ids) return Http::error($res, 'No events selected.', 400);

        $labels = ['youth' => 'Youth Members', 'mentor' => 'Mentors', 'parent' => 'Parents', 'volunteer' => 'Volunteers'];
        $section = $labels[$m['member_type']] ?? 'Members';
        $in = implode(',', array_fill(0, count($ids), '?'));
        $valid = $pdo->prepare("SELECT id FROM events WHERE id IN ($in)");
        $valid->execute($ids);
        $valid = array_map('intval', $valid->fetchAll(PDO::FETCH_COLUMN));

        $find = $pdo->prepare("SELECT id FROM event_participants WHERE event_id = ? AND member_id = ?");
        $upd  = $pdo->prepare("UPDATE event_participants SET status = ? WHERE id = ?");
        $ins  = $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, section_label, status) VALUES (?, ?, 'member', ?, ?)");
        $done = 0;
        foreach ($valid as $eid) {
            $find->execute([$eid, (int)$m['id']]);
            $row = $find->fetch();
            if ($row) { $upd->execute([$status, (int)$row['id']]); }
            else { $ins->execute([$eid, (int)$m['id'], $section, $status]); }
            $done++;
        }
        Audit::write($pdo, (int)$m['id'], 'event_participants', 0, 'bulk_rsvp', null, ['status' => $status, 'events' => $valid]);
        return Http::json($res, ['ok' => true, 'status' => $status, 'updated' => $done]);
    }

    public static function rsvp(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $status = $d['status'] ?? '';
        if (!in_array($status, ['Attending', 'Not Attending', 'Maybe'], true)) {
            return Http::error($res, 'Status must be one of: Attending, Not Attending, Maybe', 400);
        }
        $ev = $pdo->prepare("SELECT 1 FROM events WHERE id = ?"); $ev->execute([$eid]);
        if (!$ev->fetch()) return Http::error($res, 'Event not found', 404);

        // A parent/guardian may RSVP on behalf of a youth in their own family.
        $targetId = isset($d['member_id']) && (int)$d['member_id'] > 0 ? (int)$d['member_id'] : (int)$m['id'];
        $target = $m;
        if ($targetId !== (int)$m['id']) {
            if (!MembersController::isFamilyParentOf($pdo, $m, $targetId)) {
                return Http::error($res, 'You can only RSVP for yourself or a youth in your family.', 403);
            }
            $t = $pdo->prepare("SELECT id, member_type FROM members WHERE id = ?"); $t->execute([$targetId]);
            $target = $t->fetch();
            if (!$target) return Http::error($res, 'Member not found', 404);
        }

        $labels = ['youth' => 'Youth Members', 'mentor' => 'Mentors', 'parent' => 'Parents', 'volunteer' => 'Volunteers'];
        $section = $labels[$target['member_type']] ?? 'Members';
        $ex = $pdo->prepare("SELECT id FROM event_participants WHERE event_id = ? AND member_id = ?"); $ex->execute([$eid, $targetId]);
        $exist = $ex->fetch();
        if ($exist) {
            $pdo->prepare("UPDATE event_participants SET status = ? WHERE id = ?")->execute([$status, (int)$exist['id']]);
            Audit::write($pdo, (int)$m['id'], 'event_participants', (int)$exist['id'], 'update', null, ['status' => $status, 'for_member' => $targetId]);
            return Http::json($res, ['ok' => true, 'status' => $status, 'participant_id' => (int)$exist['id'], 'member_id' => $targetId, 'action' => 'updated']);
        }
        $ins = $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, section_label, status) VALUES (?, ?, 'member', ?, ?)");
        $ins->execute([$eid, $targetId, $section, $status]);
        $pid = (int)$pdo->lastInsertId();
        Audit::write($pdo, (int)$m['id'], 'event_participants', $pid, 'create', null, ['event_id' => $eid, 'status' => $status, 'for_member' => $targetId]);
        return Http::json($res, ['ok' => true, 'status' => $status, 'participant_id' => $pid, 'member_id' => $targetId, 'action' => 'created']);
    }

    /**
     * Get-or-create the stable RSVP token for (event × member). Reused across
     * re-sends so a member's email links stay valid. Used by the email composer
     * to embed per-recipient RSVP buttons (#96).
     */
    public static function tokenFor(PDO $pdo, int $eventId, int $memberId): string
    {
        $s = $pdo->prepare("SELECT token FROM event_rsvp_tokens WHERE event_id = ? AND member_id = ?");
        $s->execute([$eventId, $memberId]);
        if ($row = $s->fetch()) return $row['token'];
        $token = sprintf('%04x%04x%04x%04x%04x%04x', random_int(0, 0xffff), random_int(0, 0xffff),
            random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff));
        // Race-safe: INSERT IGNORE then re-read (another send may have created it).
        $pdo->prepare("INSERT IGNORE INTO event_rsvp_tokens (event_id, member_id, token) VALUES (?, ?, ?)")
            ->execute([$eventId, $memberId, $token]);
        $s->execute([$eventId, $memberId]);
        $row = $s->fetch();
        return $row ? $row['token'] : $token;
    }

    /** Tiny standalone HTML page returned to a browser after clicking an email link. */
    private static function htmlPage(Response $res, string $title, string $bodyHtml, int $status = 200): Response
    {
        $html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            . '<title>' . htmlspecialchars($title) . '</title></head>'
            . '<body style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;margin:0;padding:40px 16px;color:#1a3a5c">'
            . '<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;text-align:center">'
            . $bodyHtml . '</div></body></html>';
        $res->getBody()->write($html);
        return $res->withHeader('Content-Type', 'text/html; charset=utf-8')->withStatus($status);
    }

    /**
     * PUBLIC (no login) — record an RSVP from an emailed token link.
     *   GET /events/{event_id}/rsvp-link/{token}?r=Attending|Not%20Attending|Maybe
     * Validates the token → member, upserts event_participants.status, and shows
     * a confirmation page with the other two options so they can change their mind.
     */
    public static function rsvpByToken(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $eid = (int)$route['event_id'];
        $token = trim((string)($route['token'] ?? ''));
        $resp = (string)($req->getQueryParams()['r'] ?? '');

        $s = $pdo->prepare("SELECT member_id FROM event_rsvp_tokens WHERE event_id = ? AND token = ?");
        $s->execute([$eid, $token]);
        $tok = $s->fetch();
        $ev = $pdo->prepare("SELECT name, bring_enabled FROM events WHERE id = ?"); $ev->execute([$eid]); $event = $ev->fetch();
        if (!$tok || !$event) {
            return self::htmlPage($res, 'RSVP', '<h2 style="margin:0 0 8px">Link not recognized</h2>'
                . '<p style="color:#667">This RSVP link is invalid or has expired. Please contact the organizer.</p>', 404);
        }
        $memberId = (int)$tok['member_id'];
        $eventName = htmlspecialchars((string)$event['name']);

        // If a valid response was supplied, record it; otherwise just show the chooser.
        $recorded = null;
        if (in_array($resp, ['Attending', 'Not Attending', 'Maybe'], true)) {
            $mt = $pdo->prepare("SELECT member_type FROM members WHERE id = ?"); $mt->execute([$memberId]);
            $type = ($r = $mt->fetch()) ? (string)$r['member_type'] : '';
            $labels = ['youth' => 'Youth Members', 'mentor' => 'Mentors', 'parent' => 'Parents', 'volunteer' => 'Volunteers'];
            $section = $labels[$type] ?? 'Members';
            $ex = $pdo->prepare("SELECT id FROM event_participants WHERE event_id = ? AND member_id = ?");
            $ex->execute([$eid, $memberId]); $exist = $ex->fetch();
            if ($exist) {
                $pdo->prepare("UPDATE event_participants SET status = ? WHERE id = ?")->execute([$resp, (int)$exist['id']]);
                Audit::write($pdo, $memberId, 'event_participants', (int)$exist['id'], 'rsvp_email', null, ['status' => $resp]);
            } else {
                $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, section_label, status) VALUES (?, ?, 'member', ?, ?)")
                    ->execute([$eid, $memberId, $section, $resp]);
                Audit::write($pdo, $memberId, 'event_participants', (int)$pdo->lastInsertId(), 'rsvp_email', null, ['event_id' => $eid, 'status' => $resp]);
            }
            $recorded = $resp;
        }

        // Build the three option buttons (the current choice highlighted).
        $base = self::appUrl();
        $opts = ['Attending' => '#2e7d32', 'Not Attending' => '#c62828', 'Maybe' => '#f57f17'];
        $buttons = '';
        foreach ($opts as $label => $color) {
            $sel = ($recorded === $label);
            $href = $base . "/api/v1/events/$eid/rsvp-link/" . rawurlencode($token) . '?r=' . rawurlencode($label);
            $buttons .= '<a href="' . $href . '" style="display:inline-block;margin:5px;padding:11px 20px;border-radius:7px;'
                . 'text-decoration:none;font-weight:700;font-size:14px;border:2px solid ' . $color . ';'
                . ($sel ? "background:$color;color:#fff" : "background:#fff;color:$color") . '">' . htmlspecialchars($label) . '</a>';
        }

        $heading = $recorded
            ? '<h2 style="margin:0 0 6px">You\'re marked “' . htmlspecialchars($recorded) . '”</h2>'
              . '<p style="color:#667;margin:0 0 18px">Your RSVP for <strong>' . $eventName . '</strong> is saved. Changed your mind? Pick another:</p>'
            : '<h2 style="margin:0 0 6px">RSVP to ' . $eventName . '</h2>'
              . '<p style="color:#667;margin:0 0 18px">Let us know if you can make it:</p>';

        // When they're Attending and this event asks people to bring things, nudge them to
        // the event page to sign up for what they'll bring.
        $bring = '';
        if ($recorded === 'Attending' && !empty($event['bring_enabled'])) {
            $eventPage = rtrim(self::appUrl(), '/') . '/events/' . $eid;
            $bring = '<div style="margin-top:22px;padding-top:18px;border-top:1px solid #eef2f7">'
                . '<p style="color:#7b341e;font-weight:700;margin:0 0 10px">🍽️ Can you bring something?</p>'
                . '<a href="' . htmlspecialchars($eventPage) . '" style="display:inline-block;padding:11px 20px;border-radius:7px;'
                . 'text-decoration:none;font-weight:700;font-size:14px;background:#00695c;color:#fff">Tell us what you\'re bringing →</a>'
                . '<p style="color:#889;font-size:12px;margin:10px 0 0">Sign in to pick from the list of what we still need.</p></div>';
        }
        return self::htmlPage($res, 'RSVP — ' . $eventName, $heading . '<div>' . $buttons . '</div>' . $bring);
    }

    private static function appUrl(): string
    {
        return \App\Core\Config::get('APP_URL', 'http://localhost:5173');
    }

    public static function bulkTeam(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $tsid = (int)($d['team_season_id'] ?? 0);
        $sx = $pdo->prepare("SELECT ts.team_name, t.team_number, p.name AS prog FROM team_seasons ts
                             JOIN teams t ON t.id = ts.team_id LEFT JOIN programs p ON p.id = t.program_id WHERE ts.id = ?");
        $sx->execute([$tsid]); $s = $sx->fetch();
        if (!$s) return Http::error($res, 'Team season not found', 404);
        $label = trim("Team {$s['team_number']} — " . ($s['team_name'] ?? '') . " ({$s['prog']})", " —()");
        // Section adults by their role so they don't clutter the team's youth list.
        $typeSection = ['mentor' => 'Mentors', 'parent' => 'Parents', 'volunteer' => 'Volunteers'];
        $assigns = $pdo->prepare("SELECT a.member_id, m.member_type FROM team_member_assignments a
                                  JOIN members m ON m.id = a.member_id
                                  WHERE a.team_season_id = ? AND a.status = 'active'");
        $assigns->execute([$tsid]);
        $added = 0; $skipped = 0;
        foreach ($assigns->fetchAll() as $a) {
            $ex = $pdo->prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND member_id = ?"); $ex->execute([$eid, (int)$a['member_id']]);
            if ($ex->fetch()) { $skipped++; continue; }
            $section = $typeSection[$a['member_type']] ?? $label;
            $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, section_label, status) VALUES (?, ?, 'member', ?, 'No Reply')")
                ->execute([$eid, (int)$a['member_id'], $section]);
            $added++;
        }
        Audit::write($pdo, (int)$m['id'], 'event_participants', $eid, 'create', null,
            ['bulk' => 'team', 'team_season_id' => $tsid, 'event_id' => $eid, 'added' => $added, 'skipped' => $skipped, 'section_label' => $label]);
        return Http::json($res, ['ok' => true, 'added' => $added, 'skipped' => $skipped, 'section_label' => $label], 201);
    }

    public static function bulkType(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m || !Permissions::isSuperAdmin($pdo, $m)) return Http::error($res, 'Access denied', 403);
        $eid = (int)$route['event_id'];
        $d = (array)$req->getParsedBody();
        $type = $d['member_type'] ?? '';
        $labels = ['mentor' => 'Mentors', 'parent' => 'Parents', 'volunteer' => 'Volunteers'];
        $label = $labels[$type] ?? (ucfirst($type) . 's');
        $members = $pdo->prepare("SELECT id FROM members WHERE member_type = ? AND is_active = true"); $members->execute([$type]);
        $added = 0; $skipped = 0;
        foreach ($members->fetchAll() as $mem) {
            $ex = $pdo->prepare("SELECT 1 FROM event_participants WHERE event_id = ? AND member_id = ?"); $ex->execute([$eid, (int)$mem['id']]);
            if ($ex->fetch()) { $skipped++; continue; }
            $pdo->prepare("INSERT INTO event_participants (event_id, member_id, participant_type, section_label, status) VALUES (?, ?, 'member', ?, 'No Reply')")
                ->execute([$eid, (int)$mem['id'], $label]);
            $added++;
        }
        Audit::write($pdo, (int)$m['id'], 'event_participants', $eid, 'create', null,
            ['bulk' => 'type', 'member_type' => $type, 'event_id' => $eid, 'added' => $added, 'skipped' => $skipped, 'section_label' => $label]);
        return Http::json($res, ['ok' => true, 'added' => $added, 'skipped' => $skipped, 'section_label' => $label], 201);
    }

    public static function memberUpcoming(Request $req, Response $res, array $route): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        $mid = (int)$route['member_id'];
        if ($m['id'] != $mid && !Permissions::hasAnyRole($pdo, $m, ['Mentor'])) return Http::error($res, 'Access denied', 403);
        $stmt = $pdo->prepare(
            "SELECT ep.status, e.id AS event_id, e.name, e.event_date, e.end_date, e.start_time, e.location, e.event_type
             FROM event_participants ep JOIN events e ON e.id = ep.event_id
             WHERE ep.member_id = ? AND ep.status IN ('Attending','Maybe') AND COALESCE(e.end_date, e.event_date) >= ?
             ORDER BY e.event_date, e.start_time"
        );
        $stmt->execute([$mid, date('Y-m-d')]);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $out[] = ['event_id' => (int)$r['event_id'], 'rsvp_status' => $r['status'], 'name' => $r['name'],
                'event_date' => $r['event_date'], 'end_date' => $r['end_date'], 'start_time' => $r['start_time'],
                'location' => $r['location'], 'event_type' => $r['event_type']];
        }
        return Http::json($res, $out);
    }

    public static function participantStatuses(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        return Http::json($res, self::statuses($pdo));
    }
}
