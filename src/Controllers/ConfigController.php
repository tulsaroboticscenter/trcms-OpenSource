<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Audit;
use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use App\Core\Permissions;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/**
 * Port of app/modules/admin/config_router.py (read endpoints).
 * Configurable option lists (system_config table). Values are stored as JSON.
 * (PUT/seed-on-read is a later write port; these rows already exist in the DB.)
 */
final class ConfigController
{
    /**
     * Categories/keys that must never be echoed back verbatim through the
     * generic read endpoints, even to a caller who holds admin.config read.
     * Secret-bearing settings each have their own dedicated admin endpoint
     * (EmailSettingsController, GitHubSettingsController) which already masks
     * these fields — this list keeps this generic pass-through endpoint from
     * bypassing that masking. Extend this if a future category stores a secret.
     */
    private const REDACTED_FIELDS = [
        'smtp'   => ['pass'],
        'github' => ['token'],
    ];

    public static function get(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        // Deliberately requires only an authenticated member, not admin.config —
        // several categories here (event_types, activity_areas, consent_sections,
        // reflection_questions, etc.) are ordinary option lists that non-admin
        // members' forms read every day. What must never happen is an ANONYMOUS
        // caller reaching this table (that was the vulnerability), so every
        // secret-bearing category is also unconditionally redacted below
        // regardless of who is asking. See CLAUDE.md / the delivered security
        // report, finding F1, for the full history of this check.
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) {
            return Http::error($response, 'Access denied', 401);
        }
        $category = trim((string)($route['category'] ?? ''));
        // An empty category means this was really a request for the whole list
        // (e.g. a trailing-slash route that Apache folded into {category}). Don't
        // return a lone object — the client expects an array here.
        if ($category === '') {
            return self::listAll($request, $response);
        }
        $stmt = $pdo->prepare("SELECT category, label, `values` FROM system_config WHERE category = ?");
        $stmt->execute([$category]);
        $row = $stmt->fetch();
        if (!$row) {
            return Http::json($response, ['category' => $category, 'label' => $category, 'values' => []]);
        }
        return Http::json($response, [
            'category' => $row['category'],
            'label'    => $row['label'],
            'values'   => self::redact($row['category'], self::decodeValues($row['values'])),
        ]);
    }

    public static function listAll(Request $request, Response $response): Response
    {
        $pdo = Database::pdo();
        // Same rationale as get() above: authenticated-member gate + unconditional
        // per-category redaction, not an admin.config gate, to avoid breaking
        // ordinary members' forms that read non-secret option-list categories.
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur) {
            return Http::error($response, 'Access denied', 401);
        }
        $rows = $pdo->query("SELECT category, label, `values` FROM system_config ORDER BY category")->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'category' => $r['category'],
                'label'    => $r['label'],
                'values'   => self::redact($r['category'], self::decodeValues($r['values'])),
            ];
        }
        return Http::json($response, $out);
    }

    /** Strip known secret fields (see REDACTED_FIELDS) before a category's values leave this controller. */
    private static function redact(string $category, array $values): array
    {
        foreach (self::REDACTED_FIELDS[$category] ?? [] as $key) {
            if (array_key_exists($key, $values)) {
                unset($values[$key]);
            }
        }
        return $values;
    }

    /**
     * PUT /config/{category} — replace a category's list of values. Admin-only.
     * Only edits flat string-list categories; refuses to overwrite structured
     * config (e.g. profile_layout) that has its own dedicated editor.
     */
    public static function update(Request $request, Response $response, array $route): Response
    {
        $pdo = Database::pdo();
        $cur = Auth::currentMember($pdo, $request);
        if (!$cur || !Permissions::memberCan($pdo, $cur, 'admin.config', 'write')) {
            return Http::error($response, 'Access denied', 403);
        }
        $category = trim((string)($route['category'] ?? ''));
        if ($category === '') return Http::error($response, 'Category is required.', 422);
        $d = (array)$request->getParsedBody();
        if (!array_key_exists('values', $d) || !is_array($d['values'])) {
            return Http::error($response, 'values must be an array.', 422);
        }
        // Clean: trim, drop blanks, de-duplicate, keep order.
        $values = [];
        foreach ($d['values'] as $v) {
            $s = trim((string)$v);
            if ($s !== '' && !in_array($s, $values, true)) $values[] = $s;
        }

        $ex = $pdo->prepare("SELECT label, `values` FROM system_config WHERE category = ?");
        $ex->execute([$category]);
        $row = $ex->fetch();
        if (!$row) return Http::error($response, 'Unknown configuration category.', 404);

        // Don't let the list editor clobber a structured (object) config category.
        $existing = json_decode((string)$row['values'], true);
        if (is_array($existing) && $existing !== [] && array_keys($existing) !== range(0, count($existing) - 1)) {
            return Http::error($response, 'This setting has its own editor and can’t be changed here.', 400);
        }

        $old = is_array($existing) ? $existing : [];
        $pdo->prepare("UPDATE system_config SET `values` = ?, updated_at = NOW() WHERE category = ?")
            ->execute([json_encode(array_values($values)), $category]);
        Audit::write($pdo, (int)$cur['id'], 'system_config', null, 'update', ['category' => $category, 'values' => $old], ['category' => $category, 'values' => $values]);

        return Http::json($response, ['category' => $category, 'label' => $row['label'] ?? $category, 'values' => $values]);
    }

    private static function decodeValues(?string $json): array
    {
        if ($json === null || $json === '') {
            return [];
        }
        $v = json_decode($json, true);
        return is_array($v) ? $v : [];
    }
}
