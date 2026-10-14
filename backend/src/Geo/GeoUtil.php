<?php
declare(strict_types=1);

namespace Kritis\Geo;

/** Einfache Geometrie-Helfer in WGS84 für Warngebiete (Bounding-Box, Point-in-Polygon). */
final class GeoUtil
{
    public static function bbox(array $geom): ?array
    {
        $b = [INF, INF, -INF, -INF];
        $walk = function ($c) use (&$walk, &$b) {
            if (is_array($c) && isset($c[0]) && is_numeric($c[0]) && isset($c[1]) && is_numeric($c[1])) {
                $b = [min($b[0], $c[0]), min($b[1], $c[1]), max($b[2], $c[0]), max($b[3], $c[1])];
            } elseif (is_array($c)) {
                foreach ($c as $x) {
                    $walk($x);
                }
            }
        };
        if (($geom['type'] ?? '') === 'GeometryCollection') {
            foreach ($geom['geometries'] ?? [] as $g) {
                $walk($g['coordinates'] ?? []);
            }
        } else {
            $walk($geom['coordinates'] ?? []);
        }
        return is_finite($b[0]) ? $b : null;
    }

    public static function intersectsBox(array $a, array $b): bool
    {
        return $a[0] <= $b[2] && $a[2] >= $b[0] && $a[1] <= $b[3] && $a[3] >= $b[1];
    }

    public static function contains(array $geom, float $lon, float $lat): bool
    {
        $type = $geom['type'] ?? '';
        if ($type === 'GeometryCollection') {
            foreach ($geom['geometries'] ?? [] as $g) {
                if (self::contains($g, $lon, $lat)) {
                    return true;
                }
            }
            return false;
        }
        $polys = $type === 'Polygon' ? [$geom['coordinates']] : ($type === 'MultiPolygon' ? $geom['coordinates'] : []);
        foreach ($polys as $rings) {
            if (!$rings || !ShapefileReader::pointInRing([$lon, $lat], $rings[0])) {
                continue;
            }
            $inHole = false;
            foreach (array_slice($rings, 1) as $h) {
                if (ShapefileReader::pointInRing([$lon, $lat], $h)) {
                    $inHole = true;
                    break;
                }
            }
            if (!$inHole) {
                return true;
            }
        }
        return false;
    }

    public static function distanceKm(float $lon1, float $lat1, float $lon2, float $lat2): float
    {
        $r = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;
        return 2 * $r * asin(min(1, sqrt($a)));
    }
}
