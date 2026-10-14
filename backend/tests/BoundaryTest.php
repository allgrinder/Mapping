<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\AdminResolver;
use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\Utm32;

/** Grenzimport, Point-in-Polygon-Zuordnung und Karten-API gegen eine echte MariaDB. */
final class BoundaryTest extends TestCase
{
    private BoundaryImporter $importer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->importer = new BoundaryImporter(self::$db, require dirname(__DIR__, 2) . '/config/boundaries.php');
    }

    private function importAll(): void
    {
        $this->importer->importDvg(__DIR__ . '/fixtures/dvg');
        $this->importer->importPlz(__DIR__ . '/fixtures/plz5.geojson');
    }

    private function codes(string $level): array
    {
        return self::$db->query("SELECT code FROM boundaries WHERE level = '$level' ORDER BY code")->fetchAll(\PDO::FETCH_COLUMN);
    }

    public function testDvgImportNormalizesCodesAndParents(): void
    {
        $n = $this->importer->importDvg(__DIR__ . '/fixtures/dvg');
        $this->assertEquals(['regbez' => 2, 'kreis' => 3, 'gemeinde' => 4, 'land' => 1], $n);
        $this->assertSame(['051', '053'], $this->codes('regbez'));
        $this->assertSame(['05111', '05158', '05315'], $this->codes('kreis'));
        $row = self::$db->query("SELECT name, regbez, kreis FROM boundaries WHERE level='gemeinde' AND code='05158004'")->fetch();
        $this->assertSame(['name' => 'Erkrath', 'regbez' => '051', 'kreis' => '05158'], $row);
        // Land wurde aus den Regierungsbezirken vereinigt und deckt beide ab
        $area = (float) self::$db->query("SELECT ST_Area(geom) FROM boundaries WHERE level='land'")->fetchColumn();
        $sum = (float) self::$db->query("SELECT SUM(ST_Area(geom)) FROM boundaries WHERE level='regbez'")->fetchColumn();
        $this->assertEqualsWithDelta($sum, $area, $sum * 0.001);
    }

    public function testReimportReplacesInsteadOfDuplicating(): void
    {
        $this->importer->importDvg(__DIR__ . '/fixtures/dvg');
        $this->importer->importDvg(__DIR__ . '/fixtures/dvg');
        $this->assertCount(4, $this->codes('gemeinde'));
    }

    public function testPlzAreClippedToNrwMergedAndPlz2Derived(): void
    {
        $this->importAll();
        $this->assertSame(['40210', '40211', '50667'], $this->codes('plz5'), 'außerhalb NRW (35037, 80331) entfernt, 50667 ragt hinein und bleibt');
        $type = self::$db->query("SELECT ST_GeometryType(geom) FROM boundaries WHERE level='plz5' AND code='40211'")->fetchColumn();
        $this->assertSame('MULTIPOLYGON', strtoupper((string) $type), 'Dubletten werden zu einem Gebiet zusammengefasst');
        $this->assertSame(['40', '50'], $this->codes('plz2'));
        $this->assertSame('Düsseldorf', self::$db->query("SELECT name FROM boundaries WHERE level='plz5' AND code='40210'")->fetchColumn());
    }

    public function testPlzImportRequiresDvgFirst(): void
    {
        $this->expectExceptionMessage('zuerst die Verwaltungsgrenzen');
        $this->importer->importPlz(__DIR__ . '/fixtures/plz5.geojson');
    }

    public function testAdminResolverPointInPolygon(): void
    {
        $this->importAll();
        $r = new AdminResolver(self::$db);
        [$lon, $lat] = Utm32::inverse(315000, 5685000);
        $this->assertSame(['regbez' => '051', 'kreis' => '05111', 'gemeinde' => '05111000', 'plz5' => '40210', 'inNrw' => true], $r->resolve($lon, $lat));

        [$lon, $lat] = Utm32::inverse(330000, 5620000);
        $this->assertSame('05158008', $r->resolve($lon, $lat)['gemeinde']);

        // im Loch der Gemeinde Köln: Kreis ja, Gemeinde nein
        [$lon, $lat] = Utm32::inverse(375000, 5650000);
        $res = $r->resolve($lon, $lat);
        $this->assertSame('05315', $res['kreis']);
        $this->assertNull($res['gemeinde']);

        [$lon, $lat] = Utm32::inverse(450000, 5650000);
        $this->assertSame(['regbez' => null, 'kreis' => null, 'gemeinde' => null, 'plz5' => null, 'inNrw' => false], $r->resolve($lon, $lat));
    }

    public function testInvalidCodeAbortsImport(): void
    {
        $this->expectExceptionMessage('Unerwarteter Gebietsschlüssel');
        BoundaryImporter::normalizeCode('09162000', 'kreis');
    }

    public function testBoundaryApiServesGeoJsonWithEtag(): void
    {
        $this->importAll();
        $this->makeUser('lena', 'lesen');
        $this->login('lena');
        $r = $this->call('GET', '/api/boundaries/kreis');
        $this->assertSame(200, $r['status']);
        $this->assertSame('FeatureCollection', $r['body']['type']);
        $this->assertCount(3, $r['body']['features']);
        $f = $r['body']['features'][0];
        $this->assertSame(['code' => '05111', 'name' => 'Düsseldorf', 'regbez' => '051', 'kreis' => null], $f['properties']);
        $this->assertSame('Polygon', $f['geometry']['type']);
        [$lon, $lat] = $f['geometry']['coordinates'][0][0];
        $this->assertTrue($lon > 5 && $lon < 10 && $lat > 50 && $lat < 53, 'Koordinaten in WGS84');

        $etag = $r['headers']['ETag'][0];
        $this->assertSame(304, $this->call('GET', '/api/boundaries/kreis', null, true, ['If-None-Match' => $etag])['status']);
        $this->assertSame(404, $this->call('GET', '/api/boundaries/staaten')['status']);
    }

    public function testMapConfigAndTiles(): void
    {
        $this->makeUser('lena', 'lesen');
        $this->login('lena');
        $cfg = $this->call('GET', '/api/map/config')['body'];
        $this->assertSame('EPSG:25832', $cfg['grid']['srs']);
        $bm = array_column($cfg['basemaps'], null, 'id');
        $this->assertFalse($bm['politisch']['available'], 'ohne Grenzdaten nicht verfügbar');

        $this->importAll();
        $cfg = $this->call('GET', '/api/map/config')['body'];
        $this->assertTrue(array_column($cfg['basemaps'], null, 'id')['politisch']['available']);
        $this->assertContains('© OpenStreetMap-Mitwirkende (ODbL)', $cfg['attributions']);

        // Kachel aus dem lokalen Cache, ohne Netz
        $dir = $this->config->get('storage') . '/tiles/topografisch/0/0/0.png';
        @mkdir(dirname($dir), 0775, true);
        file_put_contents($dir, "\x89PNG\r\n\x1a\nTEST");
        try {
            $this->assertSame(200, $this->call('GET', '/api/tiles/topografisch/0/0/0.png')['status']);
            $this->assertSame(404, $this->call('GET', '/api/tiles/topografisch/0/5/5.png')['status'], 'außerhalb des Rasters');
            $this->assertSame(404, $this->call('GET', '/api/tiles/politisch/0/0/0.png')['status'], 'kein Kachelhintergrund');
            $this->assertSame(404, $this->call('GET', '/api/tiles/..%2Fetc/0/0/0.png')['status']);
        } finally {
            @unlink($dir);
            @rmdir(dirname($dir)); @rmdir(dirname($dir, 2)); @rmdir(dirname($dir, 3));
        }
    }
}
