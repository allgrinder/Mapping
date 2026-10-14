<?php
declare(strict_types=1);

namespace Kritis\Tests;

final class AuthTest extends TestCase
{
    public function testSessionCookieIsHardened(): void
    {
        $secure = $this->config->with(['session.cookie_secure' => true]);
        $this->app = \Kritis\App::create($secure, self::$db);
        $r = $this->call('GET', '/api/auth/me');
        $cookie = $r['headers']['Set-Cookie'][0];
        $this->assertStringStartsWith('__Host-kl_sid=', $cookie);
        foreach (['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/'] as $flag) {
            $this->assertStringContainsString($flag, $cookie);
        }
        $this->assertStringNotContainsString('Domain=', $cookie);
    }

    public function testSecurityHeadersAreSent(): void
    {
        $r = $this->call('GET', '/api/health');
        $this->assertStringContainsString("default-src 'self'", $r['headers']['Content-Security-Policy'][0]);
        $this->assertStringNotContainsString('unsafe-inline', $r['headers']['Content-Security-Policy'][0]);
        $this->assertSame('nosniff', $r['headers']['X-Content-Type-Options'][0]);
        $this->assertSame('no-store', $r['headers']['Cache-Control'][0]);
    }

    public function testLoginWithoutCsrfTokenIsRejected(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->freshClient();
        $r = $this->call('POST', '/api/auth/login', ['username' => 'anna', 'password' => self::PW], false);
        $this->assertSame(403, $r['status']);
        $this->assertSame('csrf_invalid', $r['body']['error']['code']);
    }

    public function testForeignOriginIsRejected(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->freshClient();
        $r = $this->call('POST', '/api/auth/login', ['username' => 'anna', 'password' => self::PW], true, ['Origin' => 'https://evil.example']);
        $this->assertSame(403, $r['status']);
        $this->assertSame('origin_invalid', $r['body']['error']['code']);
    }

    public function testLoginSuccessRegeneratesSessionAndCsrf(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->freshClient();
        $before = $this->cookies['kl_sid'];
        $csrfBefore = $this->csrf;
        $r = $this->call('POST', '/api/auth/login', ['username' => 'anna', 'password' => self::PW]);
        $this->assertSame(200, $r['status']);
        $this->assertSame('anna', $r['body']['user']['username']);
        $this->assertNotSame($before, $this->cookies['kl_sid'], 'Session-ID muss nach Login neu vergeben werden');
        $this->assertNotSame($csrfBefore, $this->csrf);
        $this->assertSame(0, (int) self::$db->query("SELECT COUNT(*) FROM sessions WHERE id_hash = '" . hash('sha256', $before) . "'")->fetchColumn());
    }

    public function testOldSessionIdIsUselessAfterLogin(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->freshClient();
        $fixated = $this->cookies['kl_sid'];
        $this->call('POST', '/api/auth/login', ['username' => 'anna', 'password' => self::PW]);
        $this->cookies = ['kl_sid' => $fixated];
        $r = $this->call('GET', '/api/auth/me');
        $this->assertNull($r['body']['user']);
    }

    public function testWrongPasswordAndUnknownUserLookIdentical(): void
    {
        $this->makeUser('anna', 'lesen');
        $a = $this->login('anna', 'falsch-falsch-1A');
        $b = $this->login('niemand', 'falsch-falsch-1A');
        $this->assertSame(401, $a['status']);
        $this->assertSame($a['body'], $b['body']);
    }

    public function testInactiveUserCannotLogin(): void
    {
        $id = $this->makeUser('anna', 'lesen');
        self::$db->exec("UPDATE users SET active = 0 WHERE id = $id");
        $this->assertSame(401, $this->login('anna')['status']);
    }

    public function testLoginIsRateLimitedPerUser(): void
    {
        $this->makeUser('anna', 'lesen');
        for ($i = 0; $i < 5; $i++) {
            $this->assertSame(401, $this->login('anna', 'falsch-falsch-1A')['status']);
        }
        $r = $this->login('anna');
        $this->assertSame(429, $r['status']);
        $this->assertArrayHasKey('Retry-After', $r['headers']);
    }

    public function testRateLimitAlsoBlocksFromOtherIpForSameUser(): void
    {
        $this->makeUser('anna', 'lesen');
        for ($i = 0; $i < 5; $i++) {
            $this->login('anna', 'falsch-falsch-1A');
        }
        $this->ip = '10.9.9.9';
        $this->assertSame(429, $this->login('anna')['status']);
    }

    public function testLoginIsRateLimitedPerIp(): void
    {
        $this->config = $this->config->with(['security.login_max_per_ip' => 3]);
        $this->app = \Kritis\App::create($this->config, self::$db);
        for ($i = 0; $i < 3; $i++) {
            $this->login('user' . $i, 'falsch-falsch-1A');
        }
        $this->assertSame(429, $this->login('user99', 'falsch-falsch-1A')['status']);
    }

    public function testInitialPasswordMustBeChangedBeforeAnythingElse(): void
    {
        $this->makeUser('neu', 'admin', true);
        $r = $this->login('neu');
        $this->assertTrue($r['body']['user']['mustChangePassword']);
        $this->assertSame('password_change_required', $this->call('GET', '/api/users')['body']['error']['code']);

        $bad = $this->call('POST', '/api/auth/change-password', ['currentPassword' => self::PW, 'newPassword' => 'kurz']);
        $this->assertSame(422, $bad['status']);
        $same = $this->call('POST', '/api/auth/change-password', ['currentPassword' => self::PW, 'newPassword' => self::PW]);
        $this->assertSame(422, $same['status']);

        $ok = $this->call('POST', '/api/auth/change-password', ['currentPassword' => self::PW, 'newPassword' => 'Anderes-Kennwort-77x']);
        $this->assertSame(200, $ok['status']);
        $this->assertSame(200, $this->call('GET', '/api/users')['status']);

        $this->assertSame(401, $this->login('neu')['status'], 'altes Passwort darf nicht mehr gehen');
        $this->assertSame(200, $this->login('neu', 'Anderes-Kennwort-77x')['status']);
    }

    public function testPasswordIsStoredAsArgon2id(): void
    {
        $this->makeUser('anna', 'lesen');
        $h = (string) self::$db->query("SELECT password_hash FROM users WHERE username='anna'")->fetchColumn();
        $this->assertStringStartsWith('$argon2id$', $h);
    }

    public function testLogoutDestroysSession(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->login('anna');
        $old = $this->cookies['kl_sid'];
        $this->call('POST', '/api/auth/logout');
        $this->cookies = ['kl_sid' => $old];
        $this->assertNull($this->call('GET', '/api/auth/me')['body']['user']);
    }

    public function testIdleSessionExpires(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->login('anna');
        self::$db->exec('UPDATE sessions SET last_seen = last_seen - 100000');
        $this->assertNull($this->call('GET', '/api/auth/me')['body']['user']);
    }

    public function testDeactivatedUserLosesSession(): void
    {
        $id = $this->makeUser('anna', 'lesen');
        $this->login('anna');
        self::$db->exec("UPDATE users SET active = 0 WHERE id = $id");
        $this->assertSame(401, $this->call('POST', '/api/auth/change-password', ['currentPassword' => 'x', 'newPassword' => 'y'])['status']);
    }

    public function testSqlInjectionAndTypeConfusionInLogin(): void
    {
        $this->makeUser('anna', 'lesen');
        $this->assertSame(401, $this->login("anna' OR '1'='1", "x' OR '1'='1")['status']);
        $this->freshClient();
        $r = $this->call('POST', '/api/auth/login', ['username' => ['$ne' => ''], 'password' => ['x']]);
        $this->assertSame(422, $r['status']);
        $r = $this->call('POST', '/api/auth/login', ['username' => 5, 'password' => true]);
        $this->assertSame(422, $r['status']);
    }

    public function testMalformedAndNonJsonBodies(): void
    {
        $this->freshClient();
        $r = $this->call('POST', '/api/auth/login', null);
        $this->assertSame(422, $r['status']);
        $this->assertSame(404, $this->call('GET', '/api/gibtsnicht')['status']);
    }
}
