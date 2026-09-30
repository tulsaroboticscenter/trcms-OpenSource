<?php
declare(strict_types=1);

namespace App\Core;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\Psr7\Response as Psr7Response;

/**
 * Backend enforcement for org-wide module enable/disable (open-source Phase 2).
 *
 * When an optional, self-contained module is disabled for this install, its API
 * endpoints must stop responding. This middleware maps the request path to the
 * module that exclusively owns it (via Modules::moduleForPath) and returns 404
 * when that module is disabled — as if the route didn't exist.
 *
 * FAIL-OPEN by design: only clearly-optional modules declare `prefixes` in the
 * catalog. Core/shared paths (members, auth, config, admin, reports, events,
 * teams, …) map to no module and are always allowed, so a disabled setting can
 * never knock out shared infrastructure.
 */
final class ModuleGuard implements MiddlewareInterface
{
    private const API_PREFIX = '/api/v1';

    public function process(Request $request, Handler $handler): Response
    {
        $path = $request->getUri()->getPath();
        if (str_starts_with($path, self::API_PREFIX)) {
            $sub = substr($path, strlen(self::API_PREFIX));
            if ($sub === '') $sub = '/';
            $modKey = Modules::moduleForPath($sub);
            if ($modKey !== null && !Modules::isEnabled(Database::pdo(), $modKey)) {
                return Http::error(new Psr7Response(), 'This feature is not enabled.', 404);
            }
        }
        return $handler->handle($request);
    }
}
