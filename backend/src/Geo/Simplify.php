<?php
declare(strict_types=1);

namespace Kritis\Geo;

/** Douglas-Peucker für GeoJSON-Polygone in metrischen Koordinaten (UTM). Ringe bleiben geschlossen und gültig (≥ 4 Punkte). */
final class Simplify
{
    public static function geometry(array $geom, float $tolerance): array
    {
        if ($tolerance <= 0) {
            return $geom;
        }
        $poly = fn (array $rings) => array_values(array_filter(
            array_map(fn ($r) => self::ring($r, $tolerance), $rings),
            fn ($r) => $r !== null
        ));
        if ($geom['type'] === 'Polygon') {
            $geom['coordinates'] = $poly($geom['coordinates']);
        } elseif ($geom['type'] === 'MultiPolygon') {
            $geom['coordinates'] = array_values(array_filter(array_map($poly, $geom['coordinates']), fn ($p) => $p !== []));
        }
        return $geom;
    }

    /** @return list<array{float,float}>|null null, wenn der Ring zu klein wird */
    public static function ring(array $ring, float $tol): ?array
    {
        $n = count($ring);
        if ($n < 4) {
            return null;
        }
        // Ring an seinem am weitesten vom Startpunkt entfernten Punkt aufteilen, dann beide Hälften vereinfachen.
        $far = 0; $max = -1.0;
        for ($i = 1; $i < $n - 1; $i++) {
            $d = ($ring[$i][0] - $ring[0][0]) ** 2 + ($ring[$i][1] - $ring[0][1]) ** 2;
            if ($d > $max) { $max = $d; $far = $i; }
        }
        $a = self::line(array_slice($ring, 0, $far + 1), $tol);
        $b = self::line(array_slice($ring, $far), $tol);
        $out = array_merge($a, array_slice($b, 1));
        if (count($out) < 4) {
            return count($ring) >= 4 && $tol > 0 && self::area($ring) > 0 ? self::ring($ring, $tol / 4) : null;
        }
        return $out;
    }

    public static function line(array $pts, float $tol): array
    {
        $n = count($pts);
        if ($n < 3) {
            return $pts;
        }
        $keep = array_fill(0, $n, false);
        $keep[0] = $keep[$n - 1] = true;
        $stack = [[0, $n - 1]];
        while ($stack) {
            [$s, $e] = array_pop($stack);
            $max = 0.0; $idx = -1;
            for ($i = $s + 1; $i < $e; $i++) {
                $d = self::segDist($pts[$i], $pts[$s], $pts[$e]);
                if ($d > $max) { $max = $d; $idx = $i; }
            }
            if ($idx >= 0 && $max > $tol) {
                $keep[$idx] = true;
                $stack[] = [$s, $idx];
                $stack[] = [$idx, $e];
            }
        }
        $out = [];
        foreach ($pts as $i => $p) {
            if ($keep[$i]) {
                $out[] = $p;
            }
        }
        return $out;
    }

    private static function segDist(array $p, array $a, array $b): float
    {
        $dx = $b[0] - $a[0]; $dy = $b[1] - $a[1];
        $len = $dx * $dx + $dy * $dy;
        $t = $len > 0 ? max(0, min(1, (($p[0] - $a[0]) * $dx + ($p[1] - $a[1]) * $dy) / $len)) : 0;
        return hypot($p[0] - ($a[0] + $t * $dx), $p[1] - ($a[1] + $t * $dy));
    }

    public static function area(array $ring): float
    {
        $s = 0.0;
        for ($i = 0, $n = count($ring); $i < $n - 1; $i++) {
            $s += $ring[$i][0] * $ring[$i + 1][1] - $ring[$i + 1][0] * $ring[$i][1];
        }
        return abs($s) / 2;
    }
}
