<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\SituationService;
use Kritis\Geo\Utm32;
use Kritis\Security\PasswordHasher;
use Kritis\Support\Seeder;

/** Lagemodus: räumliche Abfragen (ST_Intersects, Puffer per ST_Buffer in UTM) und gespeicherte Ereignisse. */
final class SituationTest extends TestCase
{
    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        (new Seeder(self::$db, new PasswordHasher()))->run('seedadmin');
        (new BoundaryImporter(self::$db, require dirname(__DIR__, 2) . '/config/boundaries.php'))->importDvg(__DIR__ . '/fixtures/dvg');
        $this->makeUser('adam', 'admin');
        $this->login('adam');
        $cat = (int) self::$db->query('SELECT id FROM categories LIMIT 1')->fetchColumn();
        foreach (['a' => [315000, 5685000], 'b' => [330000, 5620000], 'c' => [360000, 5650000], 'd' => [375000, 5650000]] as $k => [$e, $n]) {
            [$lon, $lat] = Utm32::inverse($e, $n);
            $r = $this->call('POST', '/api/facilities', ['name' => "Einrichtung $k", 'categoryId' => $cat, 'city' => 'Ort', 'location' => ['lon' => $lon, 'lat' => $lat], 'hazards' => []]);
            $this->assertSame(201, $r['status'], json_encode($r['body']));
            $this->ids[$k] = $r['body']['id'];
        }
    }

    private function names(array $list): array
    {
        $n = array_map(fn ($f) => substr($f['name'], -1), $list);
        sort($n);
        return $n;
    }

    private function query(array $def, int|float $buffer = 0): array
    {
        $r = $this->call('POST', '/api/situation/query', ['definition' => $def, 'bufferM' => $buffer]);
        $this->assertSame(200, $r['status'], json_encode($r['body']));
        return $r['body'];
    }

    public function testBoundaryAreaWithBufferSeparatesZones(): void
    {
        $r = $this->query(['type' => 'boundary', 'level' => 'kreis', 'code' => '05111']);
        $this->assertSame(['a'], $this->names($r['inArea']));
        $this->assertSame([], $r['inBuffer']);
        $this->assertNull($r['buffer']);
        $this->assertSame('Kreis/Stadt Düsseldorf', $r['label']);

        // c liegt 10 km östlich der Kreisgrenze, b 30 km südlich
        $r = $this->query(['type' => 'boundary', 'level' => 'kreis', 'code' => '05111'], 20000);
        $this->assertSame(['a'], $this->names($r['inArea']));
        $this->assertSame(['c'], $this->names($r['inBuffer']), 'Pufferzone enthält nur zusätzliche Einrichtungen');
        $this->assertContains($r['buffer']['type'], ['Polygon', 'MultiPolygon']);

        $r = $this->query(['type' => 'boundary', 'level' => 'kreis', 'code' => '05111'], 9000);
        $this->assertSame([], $r['inBuffer'], '9 km Puffer reicht nicht bis c');
    }

    public function testCircleAroundPoint(): void
    {
        [$lon, $lat] = Utm32::inverse(316000, 5685000); // 1 km östlich von a
        $this->assertSame([], $this->query(['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => 900])['inArea']);
        $r = $this->query(['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => 1100]);
        $this->assertSame(['a'], $this->names($r['inArea']));
        $this->assertSame('Radius 1,1 km', $r['label']);
        // c liegt ~56 km, b ~66 km, d ~69 km vom Mittelpunkt entfernt: Radius 30 km + Puffer 30 km = 60 km
        $r = $this->query(['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => 30000], 30000);
        $this->assertSame(['a'], $this->names($r['inArea']));
        $this->assertSame(['c'], $this->names($r['inBuffer']));
    }

    public function testDrawnPolygonAndHole(): void
    {
        $ring = array_map(fn ($p) => Utm32::inverse(...$p), [[355000, 5640000], [380000, 5640000], [380000, 5660000], [355000, 5660000]]);
        $this->assertSame(['c', 'd'], $this->names($this->query(['type' => 'polygon', 'coordinates' => $ring])['inArea']));
        // d liegt im Loch der Gemeinde Köln
        $this->assertSame(['c'], $this->names($this->query(['type' => 'boundary', 'level' => 'gemeinde', 'code' => '05315000'])['inArea']));
        $this->assertSame(['c', 'd'], $this->names($this->query(['type' => 'boundary', 'level' => 'kreis', 'code' => '05315'])['inArea']));
        $this->assertSame(['a', 'b'], $this->names($this->query(['type' => 'boundary', 'level' => 'regbez', 'code' => '051'])['inArea']));
    }

    public function testInvalidDefinitions(): void
    {
        $bow = array_map(fn ($p) => Utm32::inverse(...$p), [[355000, 5640000], [380000, 5660000], [380000, 5640000], [355000, 5660000]]);
        [$lon, $lat] = Utm32::inverse(316000, 5685000);
        $bad = [
            [['type' => 'polygon', 'coordinates' => $bow], 0],
            [['type' => 'polygon', 'coordinates' => [[7, 51], [7.1, 51]]], 0],
            [['type' => 'polygon', 'coordinates' => [[7, 51], [7.1, 51], ['x', 51]]], 0],
            [['type' => 'polygon', 'coordinates' => [[13.4, 52.5], [13.5, 52.5], [13.5, 52.6]]], 0],
            [['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => 10], 0],
            [['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => '1000'], 0],
            [['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => 1000], '500'],
            [['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => 1000], 60000],
            [['type' => 'boundary', 'level' => 'staat', 'code' => '05'], 0],
            [['type' => 'boundary', 'level' => 'kreis', 'code' => "05111' OR 1=1"], 0],
            [['type' => 'boundary', 'level' => 'kreis', 'code' => '09999'], 0],
            [['type' => 'sql'], 0],
            ['nichts', 0],
        ];
        foreach ($bad as [$def, $buf]) {
            $this->assertSame(422, $this->call('POST', '/api/situation/query', ['definition' => $def, 'bufferM' => $buf])['status'], json_encode($def) . ' / ' . json_encode($buf));
        }
        $this->assertTrue(SituationService::selfIntersects(array_map(fn ($p) => $p, [[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]])));
        $this->assertFalse(SituationService::selfIntersects([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]));
    }

    public function testScenarioRatesFacilitiesAtRisk(): void
    {
        $scen = array_column(self::$db->query('SELECT name, id FROM scenarios')->fetchAll(), 'id', 'name');
        $flood = (int) $scen['Hochwasser'];
        $power = (int) $scen['Langanhaltender Stromausfall'];
        // d ist für Hochwasser markiert, c nicht
        self::$db->prepare('INSERT INTO facility_hazards (facility_id, scenario_id) VALUES (?, ?)')->execute([$this->ids['d'], $flood]);
        $def = ['type' => 'boundary', 'level' => 'kreis', 'code' => '05315'];
        $q = fn ($sid) => $this->call('POST', '/api/situation/query', ['definition' => $def, 'bufferM' => 0, 'scenarioId' => $sid]);

        $r = $q(null)['body'];
        $this->assertNull($r['scenario']);
        $this->assertSame([null, null], array_column($r['inArea'], 'atRisk'));

        $r = $q($flood)['body'];
        $this->assertSame(['id' => $flood, 'name' => 'Hochwasser', 'areaWide' => false], $r['scenario']);
        $this->assertSame(['Einrichtung d', 'Einrichtung c'], array_column($r['inArea'], 'name'), 'Gefährdete zuerst');
        $this->assertSame([true, false], array_column($r['inArea'], 'atRisk'));

        $r = $q($power)['body'];
        $this->assertTrue($r['scenario']['areaWide']);
        $this->assertSame([true, true], array_column($r['inArea'], 'atRisk'), 'Flächiges Szenario betrifft alle im Gebiet');

        $this->assertSame(422, $q(999999)['status']);
        $this->assertSame(422, $q('1')['status']);

        // Szenario „flächig“ in den Stammdaten umschalten
        $this->assertSame(200, $this->call('PUT', "/api/scenarios/$flood", ['name' => 'Hochwasser', 'color' => '#2F6FDE', 'symbol' => 'wave', 'areaWide' => true])['status']);
        $this->assertSame([true, true], array_column($q($flood)['body']['inArea'], 'atRisk'));
        $list = array_column($this->call('GET', '/api/scenarios')['body']['items'], 'areaWide', 'name');
        $this->assertTrue($list['Hochwasser']);
        $this->assertFalse($list['Starkregen']);
        $this->assertSame(200, $this->call('PUT', "/api/scenarios/$flood", ['name' => 'Hochwasser', 'color' => '#2F6FDE', 'symbol' => 'wave', 'areaWide' => false])['status']);

        // Ereignis merkt sich Szenario und Bewertung
        $e = $this->call('POST', '/api/events', ['name' => 'Hochwasser Sieg', 'definition' => $def, 'bufferM' => 0, 'scenarioId' => $flood]);
        $this->assertSame(201, $e['status'], json_encode($e['body']));
        $this->assertSame($flood, $e['body']['scenarioId']);
        $this->assertSame('Hochwasser', $e['body']['snapshot']['scenario']['name']);
        $this->assertSame([true, false], array_column($e['body']['snapshot']['inArea'], 'atRisk'));
        $item = $this->call('GET', '/api/events')['body']['items'][0];
        $this->assertSame('Hochwasser', $item['scenarioName']);
        $this->assertSame(1, $item['counts']['atRisk']);
    }

    public function testEventsStoreSnapshotAndRoles(): void
    {
        $def = ['type' => 'boundary', 'level' => 'kreis', 'code' => '05111'];
        $r = $this->call('POST', '/api/events', ['name' => 'Hochwasser Rhein', 'definition' => $def, 'bufferM' => 20000]);
        $this->assertSame(201, $r['status'], json_encode($r['body']));
        $id = $r['body']['id'];
        $this->assertSame(['a'], $this->names($r['body']['snapshot']['inArea']));
        $this->assertSame(['c'], $this->names($r['body']['snapshot']['inBuffer']));
        $this->assertSame($def, $r['body']['definition']);

        $list = $this->call('GET', '/api/events')['body']['items'];
        $this->assertSame(['inArea' => 1, 'inBuffer' => 1, 'atRisk' => null], $list[0]['counts']);

        // Lesende Rolle darf öffnen und speichern, aber nicht löschen
        $this->makeUser('lena', 'lesen');
        $this->login('lena');
        $this->assertSame(200, $this->call('GET', "/api/events/$id")['status']);
        $u = $this->call('PUT', "/api/events/$id", ['name' => 'Hochwasser Rhein (aktualisiert)', 'definition' => $def, 'bufferM' => 0]);
        $this->assertSame(200, $u['status']);
        $this->assertSame([], $u['body']['snapshot']['inBuffer']);
        $this->assertSame('lena', $u['body']['updatedBy']);
        $this->assertSame(403, $this->call('DELETE', "/api/events/$id")['status']);
        $this->assertSame(422, $this->call('POST', '/api/events', ['name' => 'x', 'definition' => $def])['status']);

        $this->login('adam');
        $this->assertSame(200, $this->call('DELETE', "/api/events/$id")['status']);
        $this->assertSame(404, $this->call('GET', "/api/events/$id")['status']);
    }
}
