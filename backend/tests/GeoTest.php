<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\ShapefileReader;
use Kritis\Geo\Simplify;
use Kritis\Geo\Utm32;
use Kritis\Geo\Wkt;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class GeoTest extends TestCase
{
    /** Referenzwerte aus PROJ (pyproj, EPSG:4326 → EPSG:25832). */
    public static function referencePoints(): iterable
    {
        yield 'Mitte' => [7.0, 51.0, 359666.704, 5651728.683];
        yield 'Köln Dom' => [6.9603, 50.9375, 356689.074, 5644855.734];
        yield 'Südwesten (Aachen)' => [5.87, 50.32, 277194.885, 5578896.636];
        yield 'Nordosten (Minden)' => [9.46, 52.53, 531204.866, 5820088.404];
        yield 'Soest' => [8.0, 51.5, 430588.049, 5705903.24];
    }

    #[DataProvider('referencePoints')]
    public function testUtmForwardMatchesProj(float $lon, float $lat, float $e, float $n): void
    {
        [$x, $y] = Utm32::forward($lon, $lat);
        $this->assertEqualsWithDelta($e, $x, 0.005);
        $this->assertEqualsWithDelta($n, $y, 0.005);
    }

    #[DataProvider('referencePoints')]
    public function testUtmInverseMatchesProj(float $lon, float $lat, float $e, float $n): void
    {
        [$lo, $la] = Utm32::inverse($e, $n);
        $this->assertEqualsWithDelta($lon, $lo, 1e-7);
        $this->assertEqualsWithDelta($lat, $la, 1e-7);
    }

    public function testSimplifyKeepsShapeAndClosesRing(): void
    {
        $ring = [[0, 0], [0, 50], [0.4, 51], [0, 100], [100, 100], [100, 0], [0, 0]];
        $s = Simplify::ring($ring, 5);
        $this->assertSame([[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]], $s);
        $this->assertNull(Simplify::ring([[0, 0], [1, 1], [0, 0]], 5));
    }

    public function testWktRejectsGarbage(): void
    {
        $this->assertSame('POINT(7.0000000 51.0000000)', Wkt::fromGeoJson(['type' => 'Point', 'coordinates' => [7, 51]]));
        foreach ([
            ['type' => 'LineString', 'coordinates' => [[0, 0], [1, 1]]],
            ['type' => 'Polygon', 'coordinates' => [[[0, 0], [1, 1]]]],
            ['type' => 'Point', 'coordinates' => ['7; DROP TABLE x', 1]],
            ['type' => 'Point', 'coordinates' => [INF, 1]],
            ['type' => 'Polygon'],
        ] as $bad) {
            try {
                Wkt::fromGeoJson($bad);
                $this->fail('Ungültige Geometrie akzeptiert: ' . json_encode($bad));
            } catch (\InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function testShapefileReaderHandlesHolesAndUmlauts(): void
    {
        $feats = iterator_to_array(ShapefileReader::read(__DIR__ . '/fixtures/dvg/dvg2gem_nw.shp'), false);
        $this->assertCount(4, $feats);
        $koeln = $feats[3];
        $this->assertSame('Köln', $koeln['properties']['GN']);
        $this->assertSame('05315000', $koeln['properties']['KN']);
        $this->assertSame('Polygon', $koeln['geometry']['type']);
        $this->assertCount(2, $koeln['geometry']['coordinates'], 'Außenring + Loch');
        $this->assertTrue(ShapefileReader::pointInRing([375000, 5650000], $koeln['geometry']['coordinates'][1]));
    }
}
