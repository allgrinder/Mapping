<?php
declare(strict_types=1);

namespace Kritis\Http\Middleware;

use Kritis\Support\HttpException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/** Parst JSON-Bodies strikt (nur Objekte, begrenzte Größe und Tiefe). */
final class JsonBodyMiddleware implements MiddlewareInterface
{
    public function __construct(private int $maxBytes = 2_000_000)
    {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (in_array($request->getMethod(), ['POST', 'PUT', 'PATCH'], true)) {
            $raw = (string) $request->getBody();
            if (strlen($raw) > $this->maxBytes) {
                throw new HttpException(413, 'too_large', 'Anfrage zu groß.');
            }
            $data = [];
            if ($raw !== '') {
                if (!str_contains(strtolower($request->getHeaderLine('Content-Type')), 'application/json')) {
                    throw new HttpException(415, 'unsupported_media_type', 'Content-Type application/json erforderlich.');
                }
                try {
                    $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    throw new HttpException(400, 'invalid_json', 'Ungültiges JSON.');
                }
                if (!is_array($data) || array_is_list($data) && $data !== []) {
                    throw new HttpException(400, 'invalid_json', 'JSON-Objekt erwartet.');
                }
            }
            $request = $request->withParsedBody($data);
        }
        return $handler->handle($request);
    }
}
