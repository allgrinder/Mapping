<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\Utm32;
use Kritis\Security\PasswordHasher;
use Kritis\Support\Seeder;

final class FacilityTest extends TestCase
{
    private int $cat;
    private int $cat2;
    private array $scen;

    protected function setUp(): void
    {
        parent::setUp();
        (new Seeder(self::$db, new PasswordHasher()))->run('seedadmin');
        (new BoundaryImporter(self::$db, require dirname(__DIR__, 2) . '/config/boundaries.php'))->importDvg(__DIR__ . '/fixtures/dvg');
        (new BoundaryImporter(self::$db, require dirname(__DIR__, 2) . '/config/boundaries.php'))->importPlz(__DIR__ . '/fixtures/plz5.geojson');
        [$this->cat, $this->cat2] = array_map('intval', self::$db->query('SELECT id FROM categories ORDER BY sort_order LIMIT 2')->fetchAll(\PDO::FETCH_COLUMN));
        $this->scen = array_map('intval', self::$db->query('SELECT id FROM scenarios ORDER BY sort_order')->fetchAll(\PDO::FETCH_COLUMN));
        $this->makeUser('adam', 'admin');
        $this->login('adam');
    }

    private function body(array $over = [], float $e = 315000, float $n = 5685000): array
    {
        [$lon, $lat] = Utm32::inverse($e, $n);
        return array_replace([
            'name' => 'Hochschule Testhausen', 'categoryId' => $this->cat,
            'street' => 'Musterstraße 1', 'zip' => '40210', 'city' => 'Düsseldorf',
            'location' => ['lon' => $lon, 'lat' => $lat], 'hazards' => [$this->scen[0], $this->scen[1]],
            'contactPerson' => 'Erika Muster', 'contactPhone' => '0211 555-0100', 'contactEmail' => 'krisenstab@example.org',
        ], $over);
    }

    public function testCreateAssignsAdminAreasAndMetadata(): void
    {
        $r = $this->call('POST', '/api/facilities', $this->body());
        $this->assertSame(201, $r['status'], json_encode($r['body']));
        $f = $r['body'];
        $this->assertSame(['regbez' => '051', 'kreis' => '05111', 'gemeinde' => '05111000', 'plz5' => '40210'], $f['admin']);
        $this->assertSame([$this->scen[0], $this->scen[1]], $f['hazards']);
        $this->assertSame('adam', $f['createdBy']);
        $this->assertSame('adam', $f['updatedBy']);
        $this->assertSame('krisenstab@example.org', $f['contact']['email']);
        $key = self::$db->query('SELECT normalized_key FROM facilities WHERE id = ' . $f['id'])->fetchColumn();
        $this->assertSame('hochschuletesthausen|40210|musterstrasse1', $key);
    }

    public function testUpdateMovesFacilityAndReassigns(): void
    {
        $id = $this->call('POST', '/api/facilities', $this->body())['body']['id'];
        $r = $this->call('PUT', "/api/facilities/$id", $this->body(['hazards' => []], 330000, 5620000));
        $this->assertSame(200, $r['status']);
        $this->assertSame('05158008', $r['body']['admin']['gemeinde']);
        $this->assertNull($r['body']['admin']['plz5']);
        $this->assertSame([], $r['body']['hazards']);
    }

    public function testValidation(): void
    {
        $cases = [
            ['name' => 'x'],
            ['categoryId' => 99999],
            ['categoryId' => '1'],
            ['hazards' => [99999]],
            ['hazards' => ['1; DROP TABLE facilities']],
            ['contactEmail' => 'keine-mail'],
            ['contactPhone' => '<script>'],
            ['zip' => '4021'],
            ['city' => ''],
            ['location' => ['lon' => 'abc', 'lat' => 51]],
            ['location' => ['lon' => 11.5, 'lat' => 48.1]],
        ];
        foreach ($cases as $over) {
            $this->assertSame(422, $this->call('POST', '/api/facilities', $this->body($over))['status'], json_encode($over));
        }
        // innerhalb der Grob-Box, aber außerhalb der (Test-)Landesfläche
        $r = $this->call('POST', '/api/facilities', $this->body([], 450000, 5650000));
        $this->assertSame(422, $r['status']);
        $this->assertStringContainsString('außerhalb', $r['body']['error']['fields']['location']);
        $this->assertSame(0, (int) self::$db->query('SELECT COUNT(*) FROM facilities')->fetchColumn());
    }

    public function testCombinedFilters(): void
    {
        $a = $this->call('POST', '/api/facilities', $this->body(['name' => 'Alpha Klinik']))['body']['id'];
        $b = $this->call('POST', '/api/facilities', $this->body(['name' => 'Beta Archiv', 'categoryId' => $this->cat2, 'zip' => '41000', 'hazards' => [$this->scen[2]]], 330000, 5620000))['body']['id'];
        $c = $this->call('POST', '/api/facilities', $this->body(['name' => 'Gamma Institut', 'city' => 'Köln', 'zip' => '50667', 'hazards' => []], 360000, 5650000))['body']['id'];
        $ids = fn (string $qs) => array_column($this->call('GET', '/api/facilities' . $qs)['body']['items'], 'id');

        $this->assertSame([$a, $b, $c], $ids(''));
        $this->assertSame([$b], $ids('?category=' . $this->cat2));
        $this->assertSame([$a, $c], $ids('?category=' . $this->cat));
        $this->assertSame([], $ids('?category='), 'leere Kategorienauswahl = nichts');
        $this->assertSame([$a], $ids('?scenario=' . $this->scen[0]));
        $this->assertSame([$a, $b], $ids('?regbez=051'));
        $this->assertSame([$b], $ids('?kreis=05158'));
        $this->assertSame([$b], $ids('?plz=41'));
        $this->assertSame([$a, $b], $ids('?plz=4'));
        $this->assertSame([$c], $ids('?q=köln'));
        $this->assertSame([$a], $ids('?q=alpha&regbez=051&category=' . $this->cat));
        $this->assertSame([], $ids('?q=%25'), 'Platzhalter werden maskiert');
        $this->assertSame([$a, $b, $c], $ids('?regbez=1%27%20OR%201=1'), 'ungültige Filterwerte werden ignoriert');
        $this->assertSame([$a, $b, $c], $ids('?category[$ne]=1&plz[]=4'));
    }

    public function testDeleteAndResolve(): void
    {
        $id = $this->call('POST', '/api/facilities', $this->body())['body']['id'];
        [$lon, $lat] = Utm32::inverse(315000, 5685000);
        $r = $this->call('GET', "/api/geo/resolve?lon=$lon&lat=$lat")['body'];
        $this->assertSame('Düsseldorf', $r['names']['kreis']);
        $this->assertTrue($r['inNrw']);
        $this->assertSame(200, $this->call('DELETE', "/api/facilities/$id")['status']);
        $this->assertSame(404, $this->call('GET', "/api/facilities/$id")['status']);
        $this->assertSame(0, (int) self::$db->query('SELECT COUNT(*) FROM facility_hazards')->fetchColumn());
    }

    public function testReaderCannotWrite(): void
    {
        $id = $this->call('POST', '/api/facilities', $this->body())['body']['id'];
        $this->makeUser('lena', 'lesen');
        $this->login('lena');
        $this->assertSame(200, $this->call('GET', '/api/facilities')['status']);
        $this->assertSame(403, $this->call('POST', '/api/facilities', $this->body())['status']);
        $this->assertSame(403, $this->call('PUT', "/api/facilities/$id", $this->body())['status']);
        $this->assertSame(403, $this->call('DELETE', "/api/facilities/$id")['status']);
        $this->assertSame(403, $this->call('GET', '/api/geocode?q=Köln')['status']);
    }

    public function testGeocoderOffGivesClearMessage(): void
    {
        putenv('GEOCODER_URL=off');
        try {
            $this->app = \Kritis\App::create($this->config, self::$db);
            $r = $this->call('GET', '/api/geocode?q=Rheinallee 1 Bonn');
            $this->assertSame(503, $r['status']);
            $this->assertSame('geocoder_unavailable', $r['body']['error']['code']);
            $this->assertSame(422, $this->call('GET', '/api/geocode?q=ab')['status']);
        } finally {
            putenv('GEOCODER_URL');
        }
    }
}
