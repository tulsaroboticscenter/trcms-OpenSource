<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\EnrollmentService;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * CSV import for the Recruitment module. One endpoint imports three list types:
 *   - prospects        → visitors (the youth-interest pipeline)
 *   - waitlist         → visitors + a waitlist_entries row (FLL)
 *   - mentor_prospects → the adult mentor/volunteer pipeline
 * De-dupes by email so it is safe to re-run; supports dry_run to preview.
 * Access mirrors Visitors (Mentor+).
 */
final class RecruitmentImportController
{
    private const VISITOR_STATUS = ['new', 'visited', 'follow_up', 'waitlisted', 'not_interested', 'enrolled'];
    private const WAITLIST_STATUS = ['waiting', 'offered', 'accepted', 'declined', 'expired', 'withdrawn'];
    private const MENTOR_STAGE = ['interested', 'contacted', 'onboarding', 'active', 'declined'];

    private static function guard(PDO $pdo, Request $req): ?array
    {
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return ['err' => 401, 'detail' => 'Invalid token'];
        if (!Permissions::hasAnyRole($pdo, $m, ['Mentor', 'Admin', 'System Administrator'])) return ['err' => 403, 'detail' => 'Access denied'];
        return ['member' => $m];
    }

    private static function currentSeason(): string
    {
        $y = EnrollmentService::currentEnrollmentYear();
        return "$y-" . ($y + 1);
    }

    private static function nextVisitorNumber(PDO $pdo, array &$reserved): string
    {
        $used = $reserved;
        foreach ($pdo->query("SELECT visitor_number FROM visitors")->fetchAll() as $r) {
            if ($r['visitor_number'] !== null && ctype_digit((string)$r['visitor_number'])) $used[(int)$r['visitor_number']] = true;
        }
        for ($n = 10000; $n < 100000; $n++) if (empty($used[$n])) { $reserved[$n] = true; return (string)$n; }
        throw new \RuntimeException('No visitor numbers available');
    }

    /** POST /recruitment/import?dry_run=1  (multipart: file=<csv>, body: type=) */
    public static function import(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        if ($g = self::guard($pdo, $req)) if (isset($g['err'])) return Http::error($res, $g['detail'], $g['err']);
        $cur = $g['member'];

        $type = (string)(($req->getParsedBody()['type'] ?? $req->getQueryParams()['type'] ?? ''));
        if (!in_array($type, ['prospects', 'waitlist', 'mentor_prospects'], true)) {
            return Http::error($res, "type must be 'prospects', 'waitlist', or 'mentor_prospects'.", 422);
        }
        $file = $req->getUploadedFiles()['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No CSV file uploaded.', 400);
        $dry = filter_var($req->getQueryParams()['dry_run'] ?? ($req->getParsedBody()['dry_run'] ?? false), FILTER_VALIDATE_BOOLEAN);

        $text = preg_replace('/^\xEF\xBB\xBF/', '', (string)$file->getStream());
        $fh = fopen('php://temp', 'r+'); fwrite($fh, $text); rewind($fh);
        $rows = []; while (($c = fgetcsv($fh, 0, ',', '"', '')) !== false) $rows[] = $c;
        fclose($fh);
        if (count($rows) < 2) return Http::error($res, 'The file has no data rows.', 422);

        // Header → column index (case-insensitive, trimmed).
        $hdr = array_map(fn($h) => strtolower(trim((string)$h)), $rows[0]);
        $col = array_flip($hdr);
        $get = function (array $r, string $name) use ($col) {
            $i = $col[$name] ?? null;
            if ($i === null || !array_key_exists($i, $r)) return null;
            $v = trim((string)$r[$i]);
            return $v === '' ? null : $v;
        };

        // Program name → id (for prospects / waitlist).
        $progByName = [];
        foreach ($pdo->query("SELECT id, name FROM programs")->fetchAll() as $p) $progByName[strtolower(trim((string)$p['name']))] = (int)$p['id'];

        // Existing emails to de-dupe against (and, for visitors, keep the id so a
        // waitlist row can attach to a prospect that's already on file).
        $existing = []; $visitorByEmail = [];
        if ($type === 'mentor_prospects') {
            foreach ($pdo->query("SELECT LOWER(email) e FROM mentor_prospects WHERE email IS NOT NULL")->fetchAll() as $r) $existing[$r['e']] = true;
        } else {
            foreach ($pdo->query("SELECT id, LOWER(email) e FROM visitors WHERE email IS NOT NULL")->fetchAll() as $r) { $existing[$r['e']] = true; $visitorByEmail[$r['e']] = (int)$r['id']; }
        }

        $created = 0; $dupes = 0; $blank = 0; $linked = 0; $errors = []; $seenInFile = []; $reserved = [];
        $season = self::currentSeason();

        // Attach a waitlist entry to a visitor (avoiding duplicates), and make sure
        // they read as waitlisted (unless they've already enrolled).
        $addWaitlist = function (int $vid, ?int $progId, string $wStatus, ?string $notes) use ($pdo, $season, $cur) {
            if (!$progId || !in_array($wStatus, self::WAITLIST_STATUS, true)) return;
            $ex = $pdo->prepare("SELECT 1 FROM waitlist_entries WHERE visitor_id = ? AND program_id = ? AND season = ?");
            $ex->execute([$vid, $progId, $season]);
            if ($ex->fetch()) return;
            $pdo->prepare("INSERT INTO waitlist_entries (visitor_id, program_id, season, status, requested_date, notes, created_by_id) VALUES (?,?,?,?,?,?,?)")
                ->execute([$vid, $progId, $season, $wStatus, date('Y-m-d'), $notes, (int)$cur['id']]);
            $pdo->prepare("UPDATE visitors SET status = 'waitlisted' WHERE id = ? AND status <> 'enrolled'")->execute([$vid]);
            // Carry the program onto a linked prospect that didn't have one.
            $pdo->prepare("UPDATE visitors SET program_interest_id = ? WHERE id = ? AND program_interest_id IS NULL")->execute([$progId, $vid]);
        };

        for ($i = 1; $i < count($rows); $i++) {
            $r = $rows[$i];
            if (!array_filter($r, fn($v) => trim((string)$v) !== '')) { continue; } // wholly empty line
            $lineNo = $i + 1;

            if ($type === 'mentor_prospects') {
                $name = $get($r, 'name') ?: trim(($get($r, 'first_name') ?? '') . ' ' . ($get($r, 'last_name') ?? ''));
                $email = $get($r, 'email');
                if ($name === '' && !$email) { $blank++; continue; }
                $key = $email ? strtolower($email) : null;
                if ($key && (isset($existing[$key]) || isset($seenInFile[$key]))) { $dupes++; continue; }
                if ($key) $seenInFile[$key] = true;
                $stage = $get($r, 'stage') ?? 'interested';
                if (!in_array($stage, self::MENTOR_STAGE, true)) $stage = 'interested';
                if (!$dry) {
                    $pdo->prepare("INSERT INTO mentor_prospects (name, kind, email, phone, source, stage, notes, created_by_id) VALUES (?,?,?,?,?,?,?,?)")
                        ->execute([$name ?: 'Unknown', 'mentor', $email, $get($r, 'phone'), $get($r, 'source') ?? 'event', $stage, $get($r, 'notes'), (int)$cur['id']]);
                }
                $created++;
                continue;
            }

            // prospects / waitlist → visitors
            $fn = $get($r, 'first_name'); $ln = $get($r, 'last_name'); $email = $get($r, 'email');
            if (!$fn && !$ln && !$email) { $blank++; continue; }
            $key = $email ? strtolower($email) : null;
            $progName = strtolower((string)($get($r, 'program_interest') ?? ''));
            $progId = $progByName[$progName] ?? null;
            $wStatus = strtolower((string)($get($r, 'waitlist_status') ?? ''));

            // Waitlist: if this person is already a prospect on file, attach the
            // waitlist entry to that record instead of skipping them as a duplicate.
            if ($type === 'waitlist' && $key && isset($visitorByEmail[$key])) {
                if (!$dry) $addWaitlist($visitorByEmail[$key], $progId, $wStatus, $get($r, 'notes'));
                $linked++;
                continue;
            }

            // Otherwise de-dupe on email (both against the DB and within the file).
            if ($key && (isset($existing[$key]) || isset($seenInFile[$key]))) { $dupes++; continue; }
            if ($key) $seenInFile[$key] = true;

            $vStatus = $type === 'waitlist' ? ($get($r, 'visitor_status') ?? 'waitlisted') : ($get($r, 'status') ?? 'new');
            if (!in_array($vStatus, self::VISITOR_STATUS, true)) $vStatus = $type === 'waitlist' ? 'waitlisted' : 'new';

            if (!$dry) {
                try {
                    $vnum = self::nextVisitorNumber($pdo, $reserved);
                    $pdo->prepare("INSERT INTO visitors (visitor_number, first_name, last_name, email, guardian1_name, guardian1_email,
                        referral_source, referral_detail, program_interest_id, additional_info, status, parent_mentor_interest)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,0)")
                        ->execute([$vnum, $fn ?: '(unknown)', $ln ?: '', $email, $get($r, 'guardian1_name') ?: (trim(($fn ?? '') . ' ' . ($ln ?? '')) ?: null),
                            $get($r, 'guardian1_email') ?: $email, $get($r, 'referral_source'), $get($r, 'referral_detail'),
                            $progId, $get($r, 'notes'), $vStatus]);
                    $vid = (int)$pdo->lastInsertId();
                    if ($key) $visitorByEmail[$key] = $vid;
                    if ($type === 'waitlist') $addWaitlist($vid, $progId, $wStatus, $get($r, 'notes'));
                } catch (\Throwable $e) {
                    $errors[] = "Line $lineNo: " . $e->getMessage();
                    continue;
                }
            }
            $created++;
        }

        if (!$dry) Audit::write($pdo, (int)$cur['id'], 'visitors', null, 'import', null, ['type' => $type, 'created' => $created]);

        return Http::json($res, [
            'dry_run' => $dry, 'type' => $type,
            'created' => $created, 'linked_to_existing' => $linked,
            'skipped_duplicates' => $dupes, 'skipped_blank' => $blank,
            'errors' => array_slice($errors, 0, 25),
        ]);
    }
}
