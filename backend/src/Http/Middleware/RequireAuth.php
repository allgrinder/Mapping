<?php
declare(strict_types=1);

namespace Kritis\Http\Middleware;

use Kritis\Security\Session;
use Kritis\Support\HttpException;
use PDO;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Verlangt eine angemeldete Sitzung und optional eine Rolle.
 * Bei ausstehender Passwortänderung sind nur Routen mit $allowPasswordChange erreichbar.
 */
final class RequireAuth implements MiddlewareInterface
{
    /** @param list<string> $roles leer = jede Rolle */
    public function __construct(private PDO $db, private array $roles = [], private bool $allowPasswordChange = false)
    {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        /** @var Session $session */
        $session = $request->getAttribute('session');
        if ($session->userId === null) {
            throw new HttpException(401, 'unauthenticated', 'Anmeldung erforderlich.');
        }
        $st = $this->db->prepare('SELECT id, username, role, must_change_password, active FROM users WHERE id = ?');
        $st->execute([$session->userId]);
        $u = $st->fetch();
        if (!$u || !(int) $u['active']) {
            $session->destroy();
            throw new HttpException(401, 'unauthenticated', 'Anmeldung erforderlich.');
        }
        if ((int) $u['must_change_password'] && !$this->allowPasswordChange) {
            throw new HttpException(403, 'password_change_required', 'Das Initialpasswort muss zuerst geändert werden.');
        }
        if ($this->roles && !in_array($u['role'], $this->roles, true)) {
            throw new HttpException(403, 'forbidden', 'Keine Berechtigung.');
        }
        return $handler->handle($request->withAttribute('user', [
            'id' => (int) $u['id'],
            'username' => $u['username'],
            'role' => $u['role'],
            'mustChangePassword' => (bool) (int) $u['must_change_password'],
        ]));
    }
}
