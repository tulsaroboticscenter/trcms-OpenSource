<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Database;
use App\Core\Http;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\UploadedFileInterface;

/** Port of app/modules/uploads/router.py (prefix /api/v1/uploads). */
final class UploadsController
{
    private const ALLOWED = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    private const ALLOWED_DOCS = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
        '.txt', '.csv', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
    private const MAX_SIZE = 5 * 1024 * 1024;
    private const MAX_DOC_SIZE = 20 * 1024 * 1024;

    /** Stored under public/uploads so the web server serves them at /uploads/ directly. */
    private static function uploadsDir(): string
    {
        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'uploads';
    }

    private static function safeFilename(string $original, string $prefix, array $allowed): ?string
    {
        $ext = strtolower('.' . pathinfo($original, PATHINFO_EXTENSION));
        if (!in_array($ext, $allowed, true)) return null;
        return $prefix . '_' . bin2hex(random_bytes(16)) . $ext;
    }

    private static function handle(Request $req, Response $res, string $prefix, ?array $allowed = null, ?int $maxSize = null): Response
    {
        $allowed ??= self::ALLOWED;
        $maxSize ??= self::MAX_SIZE;
        $pdo = Database::pdo();
        if (!Auth::currentMember($pdo, $req)) return Http::error($res, 'Invalid token', 401);
        $files = $req->getUploadedFiles();
        /** @var UploadedFileInterface|null $file */
        $file = $files['file'] ?? null;
        if (!$file || $file->getError() !== UPLOAD_ERR_OK) return Http::error($res, 'No file uploaded', 400);
        if ($file->getSize() > $maxSize) return Http::error($res, 'File too large (max ' . (int)($maxSize / 1048576) . ' MB)', 400);
        $original = $file->getClientFilename() ?: 'file';
        $filename = self::safeFilename($original, $prefix, $allowed);
        if ($filename === null) {
            return Http::error($res, 'File type not allowed. Use: ' . implode(', ', $allowed), 400);
        }
        $dir = self::uploadsDir();
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        // Surface the real reason instead of a bare 500 — on some hosts public/uploads
        // isn't writable by the PHP process, which is the usual cause of "upload failed".
        if (!is_dir($dir) || !is_writable($dir)) {
            error_log("[uploads] directory not writable: $dir");
            return Http::error($res, "The server couldn't save the file — the uploads folder isn't writable. An administrator needs to make public/uploads writable on the server.", 500);
        }
        try {
            $file->moveTo($dir . DIRECTORY_SEPARATOR . $filename);
        } catch (\Throwable $e) {
            error_log("[uploads] moveTo failed for $filename: " . $e->getMessage());
            return Http::error($res, "The server couldn't save the uploaded file. Please try again, or contact an administrator.", 500);
        }
        // Serve via the app route (works even where the host 403s static /uploads/).
        // Kept relative so it resolves against whatever origin the app is served from.
        // Keep a readable display name (original, minus extension) for documents.
        $display = pathinfo($original, PATHINFO_FILENAME);
        return Http::json($res, ['url' => '/api/v1/public/upload/' . $filename, 'filename' => $filename, 'name' => $display]);
    }

    public static function photo(Request $req, Response $res): Response
    {
        $pdo = Database::pdo();
        $m = Auth::currentMember($pdo, $req);
        if (!$m) return Http::error($res, 'Invalid token', 401);
        return self::handle($req, $res, 'member_' . (int)$m['id']);
    }

    /**
     * Serve an uploaded image through PHP so it works on hosts that return 403 for
     * static files under public/uploads. Public (no auth) — an <img> tag can't send a
     * bearer token, and filenames are unguessable random hex. Images only.
     */
    public static function serve(Request $req, Response $res, array $route): Response
    {
        $name = basename((string)($route['name'] ?? ''));   // strip any path traversal
        $ext = strtolower('.' . pathinfo($name, PATHINFO_EXTENSION));
        $mimes = ['.jpg' => 'image/jpeg', '.jpeg' => 'image/jpeg', '.png' => 'image/png',
                  '.gif' => 'image/gif', '.webp' => 'image/webp'];
        if (!isset($mimes[$ext])) return Http::error($res, 'Not found', 404);
        $path = self::uploadsDir() . DIRECTORY_SEPARATOR . $name;
        if (!is_file($path)) return Http::error($res, 'Not found', 404);
        $res->getBody()->write((string)file_get_contents($path));
        return $res->withHeader('Content-Type', $mimes[$ext])
                   ->withHeader('Cache-Control', 'public, max-age=86400');
    }

    public static function teamAsset(Request $req, Response $res): Response
    {
        $assetType = $req->getQueryParams()['asset_type'] ?? 'logo';
        return self::handle($req, $res, 'team_' . $assetType);
    }

    /** Document upload (PDF/Office/text/image, up to 20 MB) — used by Hall of Fame. */
    public static function document(Request $req, Response $res): Response
    {
        return self::handle($req, $res, 'doc', self::ALLOWED_DOCS, self::MAX_DOC_SIZE);
    }
}
