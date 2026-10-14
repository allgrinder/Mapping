<?php
declare(strict_types=1);

namespace Kritis\Tests;

use PHPUnit\Framework\Attributes\DataProvider;

/** Jede geschützte Route × anonym / lesen / admin. Neue Routen müssen hier eingetragen werden. */
final class RoleMatrixTest extends TestCase
{
    /** @return iterable<string,array{string,string,?array,int,int,int}> method, path, body, anon, lesen, admin */
    public static function routes(): iterable
    {
        yield 'users list' => ['GET', '/api/users', null, 401, 403, 200];
        yield 'users create' => ['POST', '/api/users', ['username' => 'neu.user', 'role' => 'lesen'], 401, 403, 201];
        yield 'users update' => ['PUT', '/api/users/1', ['role' => 'lesen', 'active' => true], 401, 403, 200];
        yield 'users delete' => ['DELETE', '/api/users/1', null, 401, 403, 200];
        yield 'users reset' => ['POST', '/api/users/1/reset-password', null, 401, 403, 200];
        yield 'change password' => ['POST', '/api/auth/change-password', ['currentPassword' => 'x', 'newPassword' => 'y'], 401, 422, 422];
    }

    #[DataProvider('routes')]
    public function testMatrix(string $method, string $path, ?array $body, int $anon, int $lesen, int $admin): void
    {
        $this->makeUser('lena', 'lesen');
        $this->makeUser('adam', 'admin');
        $target = $this->makeUser('ziel', 'lesen'); // id 3
        $path = str_replace('/1', '/' . $target, $path);

        $this->freshClient();
        $this->assertSame($anon, $this->call($method, $path, $body)['status'], 'anonym');
        $this->login('lena');
        $this->assertSame($lesen, $this->call($method, $path, $body)['status'], 'lesen');
        $this->login('adam');
        $this->assertSame($admin, $this->call($method, $path, $body)['status'], 'admin');
    }

    public function testHealthAndMeArePublic(): void
    {
        $this->assertSame(200, $this->call('GET', '/api/health')['status']);
        $this->assertSame(200, $this->call('GET', '/api/auth/me')['status']);
    }

    public function testAdminCannotRemoveLastAdminOrSelf(): void
    {
        $id = $this->makeUser('adam', 'admin');
        $this->login('adam');
        $this->assertSame(409, $this->call('PUT', "/api/users/$id", ['role' => 'lesen', 'active' => true])['status']);
        $this->assertSame(409, $this->call('PUT', "/api/users/$id", ['role' => 'admin', 'active' => false])['status']);
        $this->assertSame(409, $this->call('DELETE', "/api/users/$id")['status']);
    }

    public function testRoleChangeEndsTargetSessionsAndNewUserMustChangePassword(): void
    {
        $this->makeUser('adam', 'admin');
        $this->login('adam');
        $created = $this->call('POST', '/api/users', ['username' => 'frisch', 'role' => 'lesen']);
        $this->assertSame(201, $created['status']);
        $initial = $created['body']['initialPassword'];
        $this->assertGreaterThanOrEqual(12, strlen($initial));
        $admin = [$this->cookies, $this->csrf];

        $login = $this->login('frisch', $initial);
        $this->assertTrue($login['body']['user']['mustChangePassword']);

        [$this->cookies, $this->csrf] = $admin;
        $dup = $this->call('POST', '/api/users', ['username' => 'frisch', 'role' => 'lesen']);
        $this->assertSame(409, $dup['status']);
    }

    public function testInvalidUserInputRejected(): void
    {
        $this->makeUser('adam', 'admin');
        $this->login('adam');
        $this->assertSame(422, $this->call('POST', '/api/users', ['username' => 'a b', 'role' => 'lesen'])['status']);
        $this->assertSame(422, $this->call('POST', '/api/users', ['username' => 'okay.name', 'role' => 'root'])['status']);
        $this->assertSame(422, $this->call('POST', '/api/users', ['username' => ['$gt' => ''], 'role' => 'lesen'])['status']);
        $this->assertSame(404, $this->call('PUT', '/api/users/abc', ['role' => 'lesen'])['status']);
    }
}
