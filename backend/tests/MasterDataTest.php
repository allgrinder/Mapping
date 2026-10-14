<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Security\PasswordHasher;
use Kritis\Support\Seeder;
use PHPUnit\Framework\Attributes\DataProvider;

final class MasterDataTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        (new Seeder(self::$db, new PasswordHasher()))->run('seedadmin');
        $this->makeUser('adam', 'admin');
        $this->login('adam');
    }

    public static function kinds(): iterable
    {
        yield 'Kategorien' => ['categories', 4];
        yield 'Szenarien' => ['scenarios', 7];
    }

    #[DataProvider('kinds')]
    public function testSeedOrderAndCrud(string $kind, int $seeded): void
    {
        $items = $this->call('GET', "/api/$kind")['body']['items'];
        $this->assertCount($seeded, $items);
        $this->assertSame(range(10, $seeded * 10, 10), array_column($items, 'sortOrder'));

        $id = $this->call('POST', "/api/$kind", ['name' => 'Testeintrag', 'color' => '#1e7f46', 'symbol' => 'shield'])['body']['id'];
        $items = $this->call('GET', "/api/$kind")['body']['items'];
        $this->assertSame('Testeintrag', end($items)['name'], 'neuer Eintrag kommt ans Ende');
        $this->assertSame('#1E7F46', end($items)['color']);

        $this->assertSame(409, $this->call('POST', "/api/$kind", ['name' => 'Testeintrag', 'color' => '#000000', 'symbol' => 'box'])['status']);
        $this->assertSame(200, $this->call('PUT', "/api/$kind/$id", ['name' => 'Umbenannt', 'color' => '#000000', 'symbol' => 'box', 'active' => false])['status']);

        $ids = array_reverse(array_column($this->call('GET', "/api/$kind")['body']['items'], 'id'));
        $this->assertSame(200, $this->call('PUT', "/api/$kind/order", ['ids' => $ids])['status']);
        $this->assertSame($ids, array_column($this->call('GET', "/api/$kind")['body']['items'], 'id'));

        $this->assertSame(200, $this->call('DELETE', "/api/$kind/$id")['status']);
        $this->assertSame(404, $this->call('DELETE', "/api/$kind/$id")['status']);
    }

    #[DataProvider('kinds')]
    public function testValidation(string $kind): void
    {
        $bad = [
            ['name' => 'x', 'color' => '#000000', 'symbol' => 'box'],
            ['name' => 'Gut', 'color' => 'red', 'symbol' => 'box'],
            ['name' => 'Gut', 'color' => '#000000', 'symbol' => '<script>'],
            ['name' => ['a'], 'color' => '#000000', 'symbol' => 'box'],
            ['name' => 'Gut', 'color' => '#000000', 'symbol' => 'box', 'active' => 'ja'],
        ];
        foreach ($bad as $body) {
            $this->assertSame(422, $this->call('POST', "/api/$kind", $body)['status'], json_encode($body));
        }
        $ids = array_column($this->call('GET', "/api/$kind")['body']['items'], 'id');
        foreach ([[], array_slice($ids, 1), [...$ids, $ids[0]], [...array_slice($ids, 1), 99999], array_map('strval', $ids)] as $order) {
            $this->assertSame(422, $this->call('PUT', "/api/$kind/order", ['ids' => $order])['status']);
        }
    }

    public function testDeleteBlockedWhileInUse(): void
    {
        $cat = $this->call('GET', '/api/categories')['body']['items'][0]['id'];
        $scen = $this->call('GET', '/api/scenarios')['body']['items'][0]['id'];
        self::$db->prepare("INSERT INTO facilities (name, category_id, location) VALUES ('Test', ?, ST_GeomFromText('POINT(7 51)'))")->execute([$cat]);
        $fid = (int) self::$db->lastInsertId();
        self::$db->prepare('INSERT INTO facility_hazards (facility_id, scenario_id) VALUES (?, ?)')->execute([$fid, $scen]);

        $this->assertSame(409, $this->call('DELETE', "/api/categories/$cat")['status']);
        $this->assertSame(409, $this->call('DELETE', "/api/scenarios/$scen")['status']);
        $this->assertSame(1, $this->call('GET', '/api/categories')['body']['items'][0]['usageCount']);
    }

    public function testUserDisplayNameAndLastLogin(): void
    {
        $r = $this->call('POST', '/api/users', ['username' => 'eva.muster', 'displayName' => 'Eva Muster', 'role' => 'lesen']);
        $this->assertSame(201, $r['status']);
        $list = $this->call('GET', '/api/users')['body']['items'];
        $eva = array_values(array_filter($list, fn ($u) => $u['username'] === 'eva.muster'))[0];
        $this->assertSame('Eva Muster', $eva['displayName']);
        $this->assertNull($eva['lastLoginAt']);
        $adam = array_values(array_filter($list, fn ($u) => $u['username'] === 'adam'))[0];
        $this->assertNotNull($adam['lastLoginAt']);

        $this->assertSame(200, $this->call('PUT', '/api/users/' . $eva['id'], ['active' => false])['status']);
        $list = $this->call('GET', '/api/users')['body']['items'];
        $eva = array_values(array_filter($list, fn ($u) => $u['username'] === 'eva.muster'))[0];
        $this->assertFalse($eva['active']);
        $this->assertSame('lesen', $eva['role'], 'Teil-Update lässt Rolle unverändert');
        $this->assertSame('Eva Muster', $eva['displayName']);
    }
}
