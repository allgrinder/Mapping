<?php
declare(strict_types=1);

namespace Kritis\Http\Middleware;

use Kritis\Security\Session;
use Kritis\Support\HttpException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/** Synchronizer-Token im Header X-CSRF-Token plus Origin-Prüfung für alle ändernden Methoden. */
final class CsrfMiddleware implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (!in_array($request->getMethod(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            /** @var Session $session */
            $session = $request->getAttribute('session');
            $sent = $request->getHeaderLine('X-CSRF-Token');
            $expected = $session->peekCsrf();
            if ($expected === null || $sent === '' || !hash_equals($expected, $sent)) {
                throw new HttpException(403, 'csrf_invalid', 'Ungültiges oder fehlendes CSRF-Token.');
            }
            $origin = $request->getHeaderLine('Origin');
            if ($origin !== '') {
                // Hostname-Vergleich (Port/Schema können hinter TLS-Terminierung abweichen; Slim entfernt den Port aus Host).
                $oh = parse_url($origin, PHP_URL_HOST);
                if (!is_string($oh) || strcasecmp($oh, $request->getUri()->getHost()) !== 0) {
                    throw new HttpException(403, 'origin_invalid', 'Ungültiger Origin.');
                }
            }
        }
        return $handler->handle($request);
    }
}
