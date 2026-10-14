<?php
declare(strict_types=1);

namespace Kritis\Geo;

/**
 * ETRS89 geografisch (≈ WGS84, EPSG:4326) ↔ ETRS89/UTM Zone 32N (EPSG:25832).
 * Krüger-Reihen 4. Ordnung (Karney 2011), Genauigkeit im Millimeterbereich.
 * Nötig, weil MariaDB 10.11 kein ST_Transform kennt.
 */
final class Utm32
{
    private const A = 6378137.0;
    private const F = 1 / 298.257222101;
    private const K0 = 0.9996;
    private const FE = 500000.0;
    private const LON0 = 9.0;

    private static ?array $c = null;

    private static function c(): array
    {
        if (self::$c !== null) {
            return self::$c;
        }
        $n = self::F / (2 - self::F);
        $n2 = $n * $n; $n3 = $n2 * $n; $n4 = $n3 * $n;
        return self::$c = [
            'n' => $n,
            'A' => self::A / (1 + $n) * (1 + $n2 / 4 + $n4 / 64),
            'alpha' => [$n / 2 - 2 * $n2 / 3 + 5 * $n3 / 16 + 41 * $n4 / 180, 13 * $n2 / 48 - 3 * $n3 / 5 + 557 * $n4 / 1440, 61 * $n3 / 240 - 103 * $n4 / 140, 49561 * $n4 / 161280],
            'beta' => [$n / 2 - 2 * $n2 / 3 + 37 * $n3 / 96 - $n4 / 360, $n2 / 48 + $n3 / 15 - 437 * $n4 / 1440, 17 * $n3 / 480 - 37 * $n4 / 840, 4397 * $n4 / 161280],
            'delta' => [2 * $n - 2 * $n2 / 3 - 2 * $n3 + 116 * $n4 / 45, 7 * $n2 / 3 - 8 * $n3 / 5 - 227 * $n4 / 45, 56 * $n3 / 15 - 136 * $n4 / 35, 4279 * $n4 / 630],
        ];
    }

    /** @return array{float,float} [Rechtswert E, Hochwert N] */
    public static function forward(float $lon, float $lat): array
    {
        $c = self::c();
        $phi = deg2rad($lat);
        $lam = deg2rad($lon - self::LON0);
        $e2n = 2 * sqrt($c['n']) / (1 + $c['n']);
        $t = sinh(atanh(sin($phi)) - $e2n * atanh($e2n * sin($phi)));
        $xi = atan2($t, cos($lam));
        $eta = atanh(sin($lam) / sqrt(1 + $t * $t));
        $x = $eta; $y = $xi;
        foreach ($c['alpha'] as $i => $a) {
            $j = 2 * ($i + 1);
            $x += $a * cos($j * $xi) * sinh($j * $eta);
            $y += $a * sin($j * $xi) * cosh($j * $eta);
        }
        return [self::FE + self::K0 * $c['A'] * $x, self::K0 * $c['A'] * $y];
    }

    /** @return array{float,float} [lon, lat] */
    public static function inverse(float $e, float $n): array
    {
        $c = self::c();
        $xi = $n / (self::K0 * $c['A']);
        $eta = ($e - self::FE) / (self::K0 * $c['A']);
        $xp = $xi; $ep = $eta;
        foreach ($c['beta'] as $i => $b) {
            $j = 2 * ($i + 1);
            $xp -= $b * sin($j * $xi) * cosh($j * $eta);
            $ep -= $b * cos($j * $xi) * sinh($j * $eta);
        }
        $chi = asin(sin($xp) / cosh($ep));
        $phi = $chi;
        foreach ($c['delta'] as $i => $d) {
            $phi += $d * sin(2 * ($i + 1) * $chi);
        }
        return [self::LON0 + rad2deg(atan2(sinh($ep), cos($xp))), rad2deg($phi)];
    }

    /** Wendet eine Koordinatenfunktion rekursiv auf GeoJSON-Koordinaten an. */
    public static function mapCoords(array $coords, callable $fn): array
    {
        if (isset($coords[0]) && !is_array($coords[0])) {
            return $fn((float) $coords[0], (float) $coords[1]);
        }
        return array_map(fn ($c) => self::mapCoords($c, $fn), $coords);
    }

    public static function geometryToWgs84(array $geom): array
    {
        $geom['coordinates'] = self::mapCoords($geom['coordinates'], fn ($x, $y) => array_map(fn ($v) => round($v, 7), self::inverse($x, $y)));
        return $geom;
    }

    public static function geometryToUtm(array $geom): array
    {
        $geom['coordinates'] = self::mapCoords($geom['coordinates'], fn ($x, $y) => array_map(fn ($v) => round($v, 3), self::forward($x, $y)));
        return $geom;
    }
}
