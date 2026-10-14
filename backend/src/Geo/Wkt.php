<?php
declare(strict_types=1);

namespace Kritis\Geo;

use InvalidArgumentException;

/** GeoJSON-Geometrie (Polygon/MultiPolygon/Point) → WKT, mit Plausibilitätsprüfung. */
final class Wkt
{
    public static function fromGeoJson(array $g): string
    {
        $type = $g['type'] ?? null;
        $c = $g['coordinates'] ?? null;
        if (!is_array($c)) {
            throw new InvalidArgumentException('Geometrie ohne Koordinaten.');
        }
        return match ($type) {
            'Point' => 'POINT(' . self::pt($c) . ')',
            'Polygon' => 'POLYGON' . self::poly($c),
            'MultiPolygon' => 'MULTIPOLYGON(' . implode(',', array_map(self::poly(...), $c)) . ')',
            default => throw new InvalidArgumentException('Nicht unterstützter Geometrietyp: ' . (is_string($type) ? $type : '?')),
        };
    }

    private static function poly(array $rings): string
    {
        if ($rings === []) {
            throw new InvalidArgumentException('Leeres Polygon.');
        }
        return '(' . implode(',', array_map(function ($ring) {
            if (!is_array($ring) || count($ring) < 4) {
                throw new InvalidArgumentException('Ring mit weniger als 4 Punkten.');
            }
            if ($ring[0] != $ring[count($ring) - 1]) {
                $ring[] = $ring[0];
            }
            return '(' . implode(',', array_map(self::pt(...), $ring)) . ')';
        }, $rings)) . ')';
    }

    private static function pt(mixed $p): string
    {
        if (!is_array($p) || !isset($p[0], $p[1]) || !is_numeric($p[0]) || !is_numeric($p[1]) || !is_finite((float) $p[0]) || !is_finite((float) $p[1])) {
            throw new InvalidArgumentException('Ungültige Koordinate.');
        }
        return sprintf('%.7F %.7F', $p[0], $p[1]);
    }
}
