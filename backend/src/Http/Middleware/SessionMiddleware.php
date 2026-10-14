<?php
declare(strict_types=1);

namespace Kritis\Http\Middleware;

use Kritis\Security\SessionStore;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

final class SessionMiddleware implements MiddlewareInterface
{
    public function __construct(private SessionStore $store, private bool $secure)
    {
    }

    public function cookieName(): string
    {
        return $this->secure ? '__Host-kl_sid' : 'kl_sid';
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $cookies = $request->getCookieParams();
        $cookieId = $cookies[$this->cookieName()] ?? null;
        $session = $this->store->load(is_string($cookieId) ? $cookieId : null);
        $response = $handler->handle($request->withAttribute('session', $session));

        $hadCookie = is_string($cookieId);
        $id = $this->store->save($session);
        if ($session->destroyed) {
            return $response->withAddedHeader('Set-Cookie', $this->cookie('', 0));
        }
        if ($id !== null && $id !== $cookieId) {
            $response = $response->withAddedHeader('Set-Cookie', $this->cookie($id, null));
        } elseif (!$hadCookie && $id !== null) {
            $response = $response->withAddedHeader('Set-Cookie', $this->cookie($id, null));
        }
        return $response;
    }

    private function cookie(string $value, ?int $maxAge): string
    {
        $c = $this->cookieName() . '=' . $value . '; Path=/; HttpOnly; SameSite=Strict';
        if ($this->secure) {
            $c .= '; Secure';
        }
        if ($maxAge !== null) {
            $c .= '; Max-Age=' . $maxAge;
        }
        return $c;
    }
}
