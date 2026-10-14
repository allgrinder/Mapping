<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Security\PasswordHasher;
use Kritis\Security\PasswordPolicy;
use Kritis\Security\SessionStore;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Kritis\Support\Validator;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class UserController
{
    private const ROLES = ['lesen', 'admin'];

    public function __construct(private PDO $db, private PasswordHasher $hasher, private SessionStore $sessions)
    {
    }

    public function list(Request $req, Response $res): Response
    {
        $rows = $this->db->query('SELECT id, username, role, active, must_change_password, created_at, updated_at FROM users ORDER BY username')->fetchAll();
        return Json::respond($res, ['items' => array_map($this->present(...), $rows)]);
    }

    public function create(Request $req, Response $res): Response
    {
        $v = new Validator((array) $req->getParsedBody());
        $username = $v->string('username', 3, 64, '/^[A-Za-z0-9._@-]+$/');
        $role = $v->enum('role', self::ROLES);
        $v->assertValid();
        $exists = $this->db->prepare('SELECT 1 FROM users WHERE username = ?');
        $exists->execute([$username]);
        if ($exists->fetchColumn()) {
            throw new HttpException(409, 'conflict', 'Benutzername existiert bereits.', ['username' => 'Benutzername existiert bereits.']);
        }
        $initial = PasswordPolicy::generate();
        $actor = $req->getAttribute('user')['id'];
        $this->db->prepare('INSERT INTO users (username, password_hash, role, must_change_password, created_by, updated_by) VALUES (?,?,?,1,?,?)')
            ->execute([$username, $this->hasher->hash($initial), $role, $actor, $actor]);
        return Json::respond($res, ['id' => (int) $this->db->lastInsertId(), 'initialPassword' => $initial], 201);
    }

    public function update(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $v = new Validator((array) $req->getParsedBody());
        $role = $v->enum('role', self::ROLES);
        $active = $v->bool('active', true);
        $v->assertValid();
        $actor = $req->getAttribute('user')['id'];
        $target = $this->find($id);
        if ($target['role'] === 'admin' && ($role !== 'admin' || !$active)) {
            $this->assertNotLastAdmin($id);
        }
        $this->db->prepare('UPDATE users SET role = ?, active = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?')
            ->execute([$role, (int) $active, $actor, $id]);
        if (!$active || $role !== $target['role']) {
            $this->sessions->deleteForUser($id);
        }
        return Json::respond($res, ['ok' => true]);
    }

    public function delete(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $target = $this->find($id);
        if ($id === $req->getAttribute('user')['id']) {
            throw new HttpException(409, 'conflict', 'Das eigene Konto kann nicht gelöscht werden.');
        }
        if ($target['role'] === 'admin') {
            $this->assertNotLastAdmin($id);
        }
        $this->db->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
        return Json::respond($res, ['ok' => true]);
    }

    public function resetPassword(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $this->find($id);
        $initial = PasswordPolicy::generate();
        $this->db->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?')
            ->execute([$this->hasher->hash($initial), $req->getAttribute('user')['id'], $id]);
        $this->sessions->deleteForUser($id);
        return Json::respond($res, ['initialPassword' => $initial]);
    }

    private function id(array $args): int
    {
        if (!isset($args['id']) || !ctype_digit((string) $args['id'])) {
            throw new HttpException(404, 'not_found', 'Nicht gefunden.');
        }
        return (int) $args['id'];
    }

    /** @return array<string,mixed> */
    private function find(int $id): array
    {
        $st = $this->db->prepare('SELECT id, username, role, active FROM users WHERE id = ?');
        $st->execute([$id]);
        return $st->fetch() ?: throw new HttpException(404, 'not_found', 'Benutzer nicht gefunden.');
    }

    private function assertNotLastAdmin(int $id): void
    {
        $st = $this->db->prepare("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id <> ?");
        $st->execute([$id]);
        if ((int) $st->fetchColumn() === 0) {
            throw new HttpException(409, 'conflict', 'Der letzte aktive Administrator kann nicht entfernt werden.');
        }
    }

    /** @param array<string,mixed> $r */
    private function present(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'username' => $r['username'], 'role' => $r['role'],
            'active' => (bool) (int) $r['active'], 'mustChangePassword' => (bool) (int) $r['must_change_password'],
            'createdAt' => $r['created_at'] ?? null, 'updatedAt' => $r['updated_at'] ?? null,
        ];
    }
}
