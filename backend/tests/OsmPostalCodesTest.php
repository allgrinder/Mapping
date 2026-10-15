<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\OsmPostalCodes;

/** PLZ-Gebiete aus OpenStreetMap: Ringe aus Teilstücken, Löcher, Plausibilität und Import. */
final class OsmPostalCodesTest extends TestCase
{
    /** Overpass-Antwort wie bei „.r out body; way(r.r); out geom;“ – Knoten-IDs und Koordinaten im Raum Düsseldorf. */
    private function overpass(): string
    {
        // Knotenraster: id → [lon, lat]
        $n = [1 => [6.70, 51.20], 2 => [6.75, 51.20], 3 => [6.80, 51.20], 4 => [6.80, 51.25], 5 => [6.75, 51.25], 6 => [6.70, 51.25],
            7 => [6.72, 51.22], 8 => [6.73, 51.22], 9 => [6.73, 51.23], 10 => [6.72, 51.23], 11 => [6.9, 51.3], 12 => [6.95, 51.3]];
        $way = fn (int $id, array $nodes) => ['type' => 'way', 'id' => $id, 'nodes' => $nodes, 'geometry' => array_map(fn ($k) => ['lat' => $n[$k][1], 'lon' => $n[$k][0]], $nodes)];
        $els = [
            ['type' => 'relation', 'id' => 100, 'tags' => ['boundary' => 'postal_code', 'postal_code' => '40210', 'note' => '40210 Düsseldorf'],
                'members' => [['type' => 'way', 'ref' => 1, 'role' => 'outer'], ['type' => 'way', 'ref' => 3, 'role' => 'outer'], ['type' => 'way', 'ref' => 2, 'role' => 'outer'], ['type' => 'way', 'ref' => 9, 'role' => 'inner']]],
            ['type' => 'relation', 'id' => 101, 'tags' => ['boundary' => 'postal_code', 'postal_code' => '40211', 'note' => '40211 Düsseldorf'],
                'members' => [['type' => 'way', 'ref' => 2, 'role' => 'outer'], ['type' => 'way', 'ref' => 4, 'role' => ''], ['type' => 'way', 'ref' => 5, 'role' => 'outer']]],
            ['type' => 'relation', 'id' => 102, 'tags' => ['boundary' => 'postal_code', 'postal_code' => 'D-4021'], 'members' => [['type' => 'way', 'ref' => 9, 'role' => 'outer']]],
            ['type' => 'relation', 'id' => 103, 'tags' => ['boundary' => 'postal_code', 'postal_code' => '40212'], 'members' => [['type' => 'way', 'ref' => 6, 'role' => 'outer']]],
            $way(1, [1, 2]),            // unten links
            $way(2, [5, 2]),            // gemeinsame Grenze 40210/40211 (Richtung egal)
            $way(3, [5, 6, 1]),         // oben links → zurück zum Start
            $way(4, [2, 3, 4]),
            $way(5, [5, 4]),            // umgekehrt orientiert
            $way(6, [11, 12]),          // nicht geschlossen → entfällt
            $way(9, [7, 8, 9, 10, 7]),  // geschlossenes Loch
        ];
        return json_encode(['osm3s' => ['timestamp_osm_base' => '2026-10-15T08:00:00Z'], 'elements' => $els]);
    }

    public function testAssemblesRingsHolesAndSkipsInvalid(): void
    {
        $r = OsmPostalCodes::fromOverpassJson($this->overpass());
        $this->assertSame('2026-10-15T08:00:00Z', $r['osmBase']);
        $by = array_column(array_map(fn ($f) => ['plz' => $f['properties']['plz'], 'f' => $f], $r['geojson']['features']), 'f', 'plz');
        $this->assertSame(['40210', '40211'], array_map('strval', array_keys($by)), 'ungültige PLZ und offene Ringe entfallen');
        $a = $by['40210']['geometry'];
        $this->assertSame('Polygon', $a['type']);
        $this->assertCount(2, $a['coordinates'], 'Außenring + Loch');
        $this->assertSame($a['coordinates'][0][0], end($a['coordinates'][0]), 'Ring geschlossen');
        $this->assertCount(5, $a['coordinates'][0]);
        $this->assertSame('40211 Düsseldorf', $by['40211']['properties']['note']);
        $this->assertCount(5, $by['40211']['geometry']['coordinates'][0], 'Rolle "" zählt als außen, umgedrehte Teilstücke werden angefügt');
    }

    public function testImportsIntoBoundaries(): void
    {
        $cfg = require dirname(__DIR__, 2) . '/config/boundaries.php';
        $imp = new BoundaryImporter(self::$db, $cfg);
        $imp->importDvg(__DIR__ . '/fixtures/dvg');
        $file = tempnam(sys_get_temp_dir(), 'plz');
        file_put_contents($file, json_encode(OsmPostalCodes::fromOverpassJson($this->overpass())['geojson']));
        $res = $imp->importPlz($file, null, 'OpenStreetMap (boundary=postal_code, Stand 2026-10-15)');
        unlink($file);
        $this->assertSame(2, $res['plz5']);
        $this->assertEquals(['40210' => 'Düsseldorf', '40211' => 'Düsseldorf'], array_column(self::$db->query("SELECT code, name FROM boundaries WHERE level = 'plz5' ORDER BY code")->fetchAll(), 'name', 'code'));
        $this->assertStringStartsWith('OpenStreetMap', (string) self::$db->query("SELECT source FROM boundary_imports WHERE level = 'plz5'")->fetchColumn());
        // Punkt im Loch gehört nicht zu 40210
        $in = fn ($lon, $lat) => (new \Kritis\Geo\AdminResolver(self::$db))->resolve($lon, $lat)['plz5'];
        $this->assertSame('40210', $in(6.71, 51.21));
        $this->assertNull($in(6.725, 51.225));
        $this->assertSame('40211', $in(6.78, 51.22));
    }

    public function testRetriesOnOverloadAndFallsBackToNextServer(): void
    {
        $http = new class ($this->overpass()) extends \Kritis\Support\HttpClient {
            public array $calls = [];
            public function __construct(private string $ok) { parent::__construct(); }
            public function get(string $url): array
            {
                $this->calls[] = parse_url($url, PHP_URL_HOST);
                // Server a: zweimal überlastet, dann ok
                if (str_contains($url, 'a.example') && count($this->calls) <= 2) {
                    return ['status' => 504, 'body' => '', 'contentType' => 'text/html'];
                }
                if (str_contains($url, 'b.example')) {
                    return ['status' => 200, 'body' => $this->ok, 'contentType' => 'application/json'];
                }
                return str_contains($url, 'a.example') ? ['status' => 200, 'body' => $this->ok, 'contentType' => 'application/json'] : ['status' => 404, 'body' => '', 'contentType' => 'text/plain'];
            }
        };
        $waits = [];
        $svc = new OsmPostalCodes(['overpass_url' => 'https://a.example/api/interpreter'], $http, function ($s) use (&$waits) { $waits[] = $s; });
        $this->assertCount(2, $svc->fetch()['geojson']['features']);
        $this->assertSame([30, 60], $waits, 'Wartezeiten nach Overpass-Regeln');

        // 404 beim ersten Server → sofort der nächste aus der Liste, ohne Warten
        $http->calls = [];
        $waits = [];
        $svc = new OsmPostalCodes(['overpass_url' => 'https://c.example/api/interpreter, https://b.example/api/interpreter'], $http, function ($s) use (&$waits) { $waits[] = $s; });
        $this->assertCount(2, $svc->fetch()['geojson']['features']);
        $this->assertSame(['c.example', 'b.example'], $http->calls);
        $this->assertSame([], $waits);
    }

    public function testRejectsUnexpectedResponses(): void
    {
        $this->expectExceptionMessage('unerwartete Antwort');
        OsmPostalCodes::fromOverpassJson('<html>rate limited</html>');
    }
}
