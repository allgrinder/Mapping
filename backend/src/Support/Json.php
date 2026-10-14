<?php
declare(strict_types=1);

namespace Kritis\Support;

use Psr\Http\Message\ResponseInterface;

final class Json
{
    public static function respond(ResponseInterface $r, mixed $data, int $status = 200): ResponseInterface
    {
        $r->getBody()->write(json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        return $r->withStatus($status)->withHeader('Content-Type', 'application/json; charset=utf-8');
    }
}
