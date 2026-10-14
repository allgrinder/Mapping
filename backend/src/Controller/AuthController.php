<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Security\PasswordHasher;
use Kritis\Security\PasswordPolicy;
use Kritis\Security\RateLimiter;
use Kritis\Security\Session;
use Kritis\Security\SessionStore;
use Kritis\Support\Config;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Kritis\Support\Validator;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class AuthController
{
    public function __construct(
        private PDO $db,
        private Config $config,
        private PasswordHasher $hasher,
        private PasswordPolicy $policy,
        private RateLimiter $limiter,
        private SessionStore $sessions,
    ) {
    }

    /** Liefert Sitzungszustand und CSRF-Token (legt bei Bedarf eine anonyme Sitzung an). */
    public function me(Request $req, Response $res): Response
    {
        /** @var Session $s */
        $s = $req->getAttribute('session');
        $user = null;
        if ($s->userId !== null) {
            $st = $this->db->prepare('SELECT id, username, display_name, role, must_change_password FROM users WHERE id = ? AND active = 1');
            $st->execute([$s->userId]);
            if ($row = $st->fetch()) {
                $user = $this->present($row);
            } else {
                $s->destroy();
            }
        }
        return Json::respond($res, ['user' => $user, 'csrfToken' => $s->destroyed ? null : $s->csrfToken()]);
    }

    public function login(Request $req, Response $res): Response
    {
        $v = new Validator((array) $req->getParsedBody());
        $username = $v->string('username', 1, 64);
        $password = $v->string('password', 1, 256, null, false);
        $v->assertValid();

        $ip = $this->clientIp($req);
        $uBucket = 'login:u:' . hash('sha256', mb_strtolower($username));
        $iBucket = 'login:ip:' . $ip;
        $max = (int) $this->config->get('security.login_max_per_user');
        $maxIp = (int) $this->config->get('security.login_max_per_ip');
        $win = (int) $this->config->get('security.login_window');
        $wait = max($this->limiter->blockedFor($uBucket, $max, $win), $this->limiter->blockedFor($iBucket, $maxIp, $win));
        if ($wait > 0) {
            $this->audit(null, 'login_blocked', $username, $ip);
            throw new HttpException(429, 'rate_limited', 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.', [], ['Retry-After' => (string) $wait]);
        }

        $st = $this->db->prepare('SELECT id, username, display_name, password_hash, role, must_change_password, active FROM users WHERE username = ?');
        $st->execute([$username]);
        $u = $st->fetch();
        $ok = $this->hasher->verify($password, $u ? $u['password_hash'] : $this->hasher->dummy());
        if (!$u || !$ok || !(int) $u['active']) {
            $this->limiter->hit($uBucket, $win);
            $this->limiter->hit($iBucket, $win);
            $this->audit($u ? (int) $u['id'] : null, 'login_failed', $username, $ip);
            throw new HttpException(401, 'invalid_credentials', 'Benutzername oder Passwort falsch.');
        }
        $this->limiter->reset($uBucket);
        $this->db->prepare('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$u['id']]);
        if ($this->hasher->needsRehash($u['password_hash'])) {
            $this->db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$this->hasher->hash($password), $u['id']]);
        }
        /** @var Session $s */
        $s = $req->getAttribute('session');
        $s->login((int) $u['id']);
        $this->audit((int) $u['id'], 'login_ok', null, $ip);
        return Json::respond($res, ['user' => $this->present($u), 'csrfToken' => $s->csrfToken()]);
    }

    public function logout(Request $req, Response $res): Response
    {
        /** @var Session $s */
        $s = $req->getAttribute('session');
        $s->destroy();
        return Json::respond($res, ['ok' => true]);
    }

    public function changePassword(Request $req, Response $res): Response
    {
        $user = $req->getAttribute('user');
        $v = new Validator((array) $req->getParsedBody());
        $current = $v->string('currentPassword', 1, 256, null, false);
        $new = $v->string('newPassword', 1, 256, null, false);
        $v->assertValid();

        $st = $this->db->prepare('SELECT password_hash FROM users WHERE id = ?');
        $st->execute([$user['id']]);
        $hash = (string) $st->fetchColumn();
        if (!$this->hasher->verify($current, $hash)) {
            throw new HttpException(422, 'invalid_credentials', 'Das aktuelle Passwort ist falsch.', ['currentPassword' => 'Das aktuelle Passwort ist falsch.']);
        }
        $this->policy->assert($new, $user['username'], $hash);
        $this->db->prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?')
            ->execute([$this->hasher->hash($new), $user['id'], $user['id']]);

        /** @var Session $s */
        $s = $req->getAttribute('session');
        $this->sessions->deleteForUser($user['id'], $s->id);
        $s->regenerate();
        $this->audit($user['id'], 'password_changed', null, $this->clientIp($req));
        return Json::respond($res, ['ok' => true, 'csrfToken' => $s->csrfToken()]);
    }

    /** @param array<string,mixed> $row */
    private function present(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'username' => $row['username'],
            'displayName' => $row['display_name'] ?? null,
            'role' => $row['role'],
            'mustChangePassword' => (bool) (int) $row['must_change_password'],
        ];
    }

    private function audit(?int $userId, string $action, ?string $detail, string $ip): void
    {
        $this->db->prepare('INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?,?,?,?)')->execute([$userId, $action, $detail, $ip]);
    }

    public function clientIp(Request $req): string
    {
        $ip = (string) ($req->getServerParams()['REMOTE_ADDR'] ?? '0.0.0.0');
        if ($this->config->get('security.trust_proxy_headers')) {
            $xff = trim(explode(',', $req->getHeaderLine('X-Forwarded-For'))[0]);
            if ($xff !== '' && filter_var($xff, FILTER_VALIDATE_IP)) {
                $ip = $xff;
            }
        }
        return substr($ip, 0, 45);
    }
}
