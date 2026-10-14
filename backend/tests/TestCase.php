<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\App;
use Kritis\Security\PasswordHasher;
use Kritis\Support\Config;
use Kritis\Support\Database;
use Kritis\Support\Migrator;
use PDO;
use PHPUnit\Framework\TestCase as Base;
use Slim\App as SlimApp;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\Factory\StreamFactory;

abstract class TestCase extends Base
{
    protected static PDO $db;
    protected Config $config;
    protected SlimApp $app;
    /** @var array<string,string> */
    protected array $cookies = [];
    protected ?string $csrf = null;
    protected string $ip = '10.0.0.1';
    protected const PW = 'Start-Passwort-2024x';

    public static function setUpBeforeClass(): void
    {
        $c = Config::load();
        self::$db = Database::connect($c);
        $m = new Migrator(self::$db, dirname(__DIR__) . '/migrations');
        $m->run();
    }

    protected function setUp(): void
    {
        $this->config = Config::load()->with(['session.cookie_secure' => false, 'security.hsts' => false]);
        self::$db->exec('SET FOREIGN_KEY_CHECKS=0');
        foreach (['sessions', 'rate_limits', 'audit_log', 'facility_hazards', 'facilities', 'boundaries', 'events', 'users', 'categories', 'scenarios'] as $t) {
            self::$db->exec("TRUNCATE TABLE $t");
        }
        self::$db->exec('SET FOREIGN_KEY_CHECKS=1');
        $this->app = App::create($this->config, self::$db);
        $this->cookies = [];
        $this->csrf = null;
        $this->ip = '10.0.0.1';
    }

    protected function makeUser(string $name, string $role, bool $mustChange = false, string $pw = self::PW): int
    {
        static $hash = [];
        $hash[$pw] ??= (new PasswordHasher())->hash($pw);
        self::$db->prepare('INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?,?,?,?)')
            ->execute([$name, $hash[$pw], $role, (int) $mustChange]);
        return (int) self::$db->lastInsertId();
    }

    /** @return array{status:int, body:array<string,mixed>, headers:array<string,array<int,string>>} */
    protected function call(string $method, string $path, ?array $body = null, bool $withCsrf = true, array $headers = []): array
    {
        $req = (new ServerRequestFactory())->createServerRequest($method, 'http://localhost' . $path, ['REMOTE_ADDR' => $this->ip]);
        if ($this->cookies) {
            $req = $req->withCookieParams($this->cookies);
        }
        if ($withCsrf && $this->csrf !== null && $method !== 'GET') {
            $req = $req->withHeader('X-CSRF-Token', $this->csrf);
        }
        foreach ($headers as $k => $v) {
            $req = $req->withHeader($k, $v);
        }
        if ($body !== null) {
            $req = $req->withHeader('Content-Type', 'application/json')
                ->withBody((new StreamFactory())->createStream(json_encode($body)));
        }
        $res = $this->app->handle($req);
        foreach ($res->getHeader('Set-Cookie') as $sc) {
            [$pair] = explode(';', $sc, 2);
            [$n, $v] = explode('=', $pair, 2);
            if ($v === '') {
                unset($this->cookies[$n]);
            } else {
                $this->cookies[$n] = $v;
            }
        }
        $json = json_decode((string) $res->getBody(), true);
        $data = is_array($json) ? $json : [];
        if (isset($data['csrfToken']) && is_string($data['csrfToken'])) {
            $this->csrf = $data['csrfToken'];
        }
        return ['status' => $res->getStatusCode(), 'body' => $data, 'headers' => $res->getHeaders()];
    }

    /** Neue Sitzung (Browser) starten und CSRF-Token holen. */
    protected function freshClient(): void
    {
        $this->cookies = [];
        $this->csrf = null;
        $this->call('GET', '/api/auth/me');
    }

    protected function login(string $user, string $pw = self::PW): array
    {
        $this->freshClient();
        return $this->call('POST', '/api/auth/login', ['username' => $user, 'password' => $pw]);
    }
}
