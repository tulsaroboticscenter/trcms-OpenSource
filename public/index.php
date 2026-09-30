<?php
declare(strict_types=1);

/**
 * Front controller for TRCPMS-PHP.
 * Serves the JSON API under /api/v1 and (later) the React build for all other paths.
 */

use App\Core\Config;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

// When running under the PHP built-in dev server (`php -S`), serve real static
// files (the React build's /assets/*, favicon, etc.) directly instead of routing
// them into Slim. Behind Plesk/Apache this is handled by public/.htaccess.
if (PHP_SAPI === 'cli-server') {
    $uriPath = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
    $candidate = __DIR__ . $uriPath;
    if ($uriPath !== '/' && is_file($candidate) && basename($candidate) !== 'index.php') {
        return false; // let the built-in server stream the file as-is
    }
}

require __DIR__ . '/../vendor/autoload.php';

// Ensure the Authorization (Bearer) header reaches PHP. Apache behind PHP-FPM/CGI
// often delivers it as REDIRECT_HTTP_AUTHORIZATION (via the .htaccess rewrite) or
// only via apache_request_headers() — normalize all of those into HTTP_AUTHORIZATION
// before Slim builds the request, so JWT auth works on any host config.
if (empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $auth = null;
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $auth = $v; break; }
        }
    }
    if ($auth) $_SERVER['HTTP_AUTHORIZATION'] = $auth;
}

$root = dirname(__DIR__);
Config::load($root);

$app = AppFactory::create();

// Parse JSON and form-urlencoded bodies (the /token endpoint posts a form).
$app->addBodyParsingMiddleware();
$app->addRoutingMiddleware();

// Audit context — capture the caller's IP and any impersonation role ONCE per
// request, so every Audit::write() records them without each call site remembering.
$app->add(function (Request $request, $handler): Response {
    $impersonating = null;
    $auth = $request->getHeaderLine('Authorization');
    if (stripos($auth, 'Bearer ') === 0) {
        $claims = \App\Core\Auth::decode(trim(substr($auth, 7)));
        if (is_array($claims) && !empty($claims['impersonating'])) {
            $impersonating = (string)$claims['impersonating'];
        }
    }
    \App\Core\Audit::setRequestContext(\App\Core\Http::clientIp($request), $impersonating);
    try {
        return $handler->handle($request);
    } finally {
        \App\Core\Audit::clearRequestContext();
    }
});

// Sliding sessions — while a member keeps using the app, hand back a renewed token in the
// X-Refresh-Token response header so an active user is never logged out mid-session. Only
// sliding sessions (an `idle` claim) renew; kiosk tokens are left alone. See Auth::refreshed.
$app->add(function (Request $request, $handler): Response {
    $response = $handler->handle($request);
    $auth = $request->getHeaderLine('Authorization');
    if (stripos($auth, 'Bearer ') === 0) {
        $fresh = \App\Core\Auth::refreshed(trim(substr($auth, 7)), \App\Core\Database::pdo());
        if ($fresh !== null) $response = $response->withHeader('X-Refresh-Token', $fresh);
    }
    return $response;
});

// CORS — allowed origins from ALLOWED_ORIGINS.
$app->add(function (Request $request, $handler): Response {
    $response = $handler->handle($request);
    $origin = $request->getHeaderLine('Origin');
    $allowed = Config::corsOrigins();
    if ($origin && in_array($origin, $allowed, true)) {
        $response = $response
            ->withHeader('Access-Control-Allow-Origin', $origin)
            ->withHeader('Access-Control-Allow-Credentials', 'true')
            ->withHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
            ->withHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
            // Let the SPA read the renewed session token on cross-origin responses.
            ->withHeader('Access-Control-Expose-Headers', 'X-Refresh-Token');
    }
    return $response;
});

// JSON error handler (matches FastAPI's {"detail": ...} shape).
$errorMiddleware = $app->addErrorMiddleware(
    Config::get('ENVIRONMENT', 'development') !== 'production',
    true,
    true
);
$errorMiddleware->setDefaultErrorHandler(function (Request $request, \Throwable $e) use ($app) {
    $isHttp = $e instanceof \Slim\Exception\HttpException;
    $status = $isHttp ? $e->getCode() : 500;
    // Security #11: in production, never return raw exception text (PDOException messages carry
    // SQLSTATE codes and query fragments). HTTP exceptions (404/403/…) carry intentional,
    // safe messages, so keep those; for everything else return a generic message plus a
    // correlation id and log the real detail server-side so support can still trace it.
    $isProd = Config::get('ENVIRONMENT', 'development') === 'production';
    if ($isProd && !$isHttp) {
        $ref = bin2hex(random_bytes(6));
        error_log('[' . $ref . '] ' . get_class($e) . ': ' . $e->getMessage()
            . ' @ ' . $e->getFile() . ':' . $e->getLine());
        $payload = ['detail' => 'An unexpected error occurred. Please try again, and quote reference ' . $ref . ' if it persists.', 'ref' => $ref];
    } else {
        $payload = ['detail' => $e->getMessage()];
    }
    $response = $app->getResponseFactory()->createResponse((int)$status);
    $response->getBody()->write(json_encode($payload, JSON_UNESCAPED_SLASHES));
    return $response->withHeader('Content-Type', 'application/json');
});

// Security #6: response security headers. Added AFTER the error middleware so it is the
// outermost wrapper and decorates every response, including error responses. The SPA HTML
// document is served through PHP (see the SPA fallback below), so this CSP protects it.
// The built SPA loads only same-origin module scripts (no inline <script>), so script-src
// 'self' is the key XSS control and does not break the app; payments are a full-page redirect
// to the provider's hosted page (not an iframe/SDK), so no payment origins are needed here.
$app->add(function (Request $request, $handler): Response {
    $response = $handler->handle($request);
    $csp = implode('; ', [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",      // React sets element.style (not blocked); covers any runtime <style>
        "img-src 'self' data: blob: https:",     // uploaded/robot photos, data: previews
        "font-src 'self' data:",
        "connect-src 'self'",                      // API is same-origin (baseURL "")
        "form-action 'self'",
        "frame-src 'self'",
        "upgrade-insecure-requests",
    ]);
    $response = $response
        ->withHeader('Content-Security-Policy', $csp)
        ->withHeader('X-Content-Type-Options', 'nosniff')
        ->withHeader('X-Frame-Options', 'SAMEORIGIN')
        ->withHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
        ->withHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
    // HSTS only over HTTPS, and WITHOUT includeSubDomains — sibling subdomains
    // (e.g. fll.tulsaroboticscenter.org) manage their own TLS.
    $uri = $request->getUri();
    $https = $uri->getScheme() === 'https'
        || strtolower($request->getHeaderLine('X-Forwarded-Proto')) === 'https';
    if ($https) {
        $response = $response->withHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    return $response;
});

// Preflight: answer OPTIONS for any route.
$app->options('/{routes:.+}', fn(Request $r, Response $res) => $res);

// Register API routes (defined before the SPA fallback below).
(require __DIR__ . '/../src/Routes/api.php')($app);

// SPA fallback / health. Serves the React build's index.html for any non-API
// path (so deep links like /members/5 work behind Plesk's Apache). Real static
// assets are served directly by the web server and never reach PHP.
$app->get('/{path:.*}', function (Request $r, Response $res, array $args): Response {
    $path = $args['path'] ?? '';
    if (str_starts_with($path, 'api/')) {
        $res->getBody()->write(json_encode(['detail' => 'Not Found']));
        return $res->withHeader('Content-Type', 'application/json')->withStatus(404);
    }
    // Let the web server handle the Scout PWA directory directly; don't serve the
    // React SPA shell for /scout paths (it would redirect straight to /login).
    if ($path === 'scout' || str_starts_with($path, 'scout/')) {
        return $res->withHeader('Location', '/scout/index.html')->withStatus(302);
    }
    $spa = __DIR__ . '/index.html';   // the React build's entry (copied into public/)
    if (is_file($spa)) {
        $res->getBody()->write((string)file_get_contents($spa));
        return $res->withHeader('Content-Type', 'text/html');
    }
    $res->getBody()->write(json_encode(['message' => 'TRCPMS-PHP API', 'status' => 'ok']));
    return $res->withHeader('Content-Type', 'application/json');
});

$app->run();
