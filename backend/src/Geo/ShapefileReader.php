<?php
declare(strict_types=1);

namespace Kritis\Geo;

use RuntimeException;

/**
 * Minimaler ESRI-Shapefile-Leser (Polygon, PolygonZ, PolygonM) mit DBF-Attributen.
 * Liefert GeoJSON-Features in den Koordinaten der Quelldatei (bei DVG: EPSG:25832).
 */
final class ShapefileReader
{
    /** @return \Generator<int, array{type:string, geometry:array, properties:array<string,mixed>}> */
    public static function read(string $shpPath): \Generator
    {
        $base = preg_replace('/\.shp$/i', '', $shpPath);
        $shp = self::open($shpPath);
        $dbfPath = self::sibling($base, 'dbf');
        $dbf = $dbfPath ? self::open($dbfPath) : null;
        $encoding = self::encoding($base);

        $header = fread($shp, 100);
        if (strlen($header) !== 100 || unpack('N', substr($header, 0, 4))[1] !== 9994) {
            throw new RuntimeException("Keine gültige Shapefile-Datei: $shpPath");
        }
        $shapeType = unpack('V', substr($header, 32, 4))[1];
        if (!in_array($shapeType, [5, 15, 25], true)) {
            throw new RuntimeException("Nur Polygon-Shapefiles werden unterstützt (Typ $shapeType): $shpPath");
        }
        $fields = $dbf ? self::dbfHeader($dbf) : null;

        while (($recHead = fread($shp, 8)) !== false && strlen($recHead) === 8) {
            $len = unpack('N', substr($recHead, 4, 4))[1] * 2;
            $content = $len > 0 ? fread($shp, $len) : '';
            $props = $fields ? self::dbfRecord($dbf, $fields, $encoding) : [];
            $type = unpack('V', substr($content, 0, 4))[1];
            if ($type === 0) {
                continue; // Null-Shape
            }
            yield ['type' => 'Feature', 'geometry' => self::polygon($content), 'properties' => $props];
        }
        fclose($shp);
        if ($dbf) {
            fclose($dbf);
        }
    }

    private static function polygon(string $c): array
    {
        $numParts = unpack('V', substr($c, 36, 4))[1];
        $numPoints = unpack('V', substr($c, 40, 4))[1];
        $parts = array_values(unpack('V' . $numParts, substr($c, 44, 4 * $numParts)));
        $ptsOffset = 44 + 4 * $numParts;
        $coords = array_values(unpack('e' . ($numPoints * 2), substr($c, $ptsOffset, 16 * $numPoints)));
        $rings = [];
        for ($p = 0; $p < $numParts; $p++) {
            $start = $parts[$p];
            $end = $p + 1 < $numParts ? $parts[$p + 1] : $numPoints;
            $ring = [];
            for ($i = $start; $i < $end; $i++) {
                $ring[] = [$coords[2 * $i], $coords[2 * $i + 1]];
            }
            $rings[] = $ring;
        }
        // Außenringe sind im Shapefile im Uhrzeigersinn orientiert, Löcher gegen den Uhrzeigersinn.
        $polys = [];
        $holes = [];
        foreach ($rings as $r) {
            if (self::signedArea($r) <= 0) {
                $polys[] = [$r];
            } else {
                $holes[] = $r;
            }
        }
        if ($polys === []) { // falsch orientierte Daten: alles als Außenringe behandeln
            $polys = array_map(fn ($r) => [$r], $holes);
            $holes = [];
        }
        foreach ($holes as $h) {
            $target = count($polys) - 1;
            foreach ($polys as $i => $pl) {
                if (self::pointInRing($h[0], $pl[0])) {
                    $target = $i;
                    break;
                }
            }
            $polys[$target][] = $h;
        }
        return count($polys) === 1 ? ['type' => 'Polygon', 'coordinates' => $polys[0]] : ['type' => 'MultiPolygon', 'coordinates' => $polys];
    }

    public static function signedArea(array $ring): float
    {
        $s = 0.0;
        for ($i = 0, $n = count($ring); $i < $n - 1; $i++) {
            $s += $ring[$i][0] * $ring[$i + 1][1] - $ring[$i + 1][0] * $ring[$i][1];
        }
        return $s / 2;
    }

    public static function pointInRing(array $p, array $ring): bool
    {
        $in = false;
        for ($i = 0, $j = count($ring) - 1, $n = count($ring); $i < $n; $j = $i++) {
            [$xi, $yi] = $ring[$i];
            [$xj, $yj] = $ring[$j];
            if (($yi > $p[1]) !== ($yj > $p[1]) && $p[0] < ($xj - $xi) * ($p[1] - $yi) / (($yj - $yi) ?: 1e-12) + $xi) {
                $in = !$in;
            }
        }
        return $in;
    }

    private static function dbfHeader($dbf): array
    {
        $h = fread($dbf, 32);
        $headerLen = unpack('v', substr($h, 8, 2))[1];
        $fields = [];
        while (ftell($dbf) < $headerLen - 1) {
            $f = fread($dbf, 32);
            if ($f[0] === "\r") {
                break;
            }
            $fields[] = ['name' => rtrim(substr($f, 0, 11), "\0 "), 'type' => $f[11], 'len' => ord($f[16])];
        }
        fseek($dbf, $headerLen);
        return $fields;
    }

    private static function dbfRecord($dbf, array $fields, string $encoding): array
    {
        $recLen = 1 + array_sum(array_column($fields, 'len'));
        $raw = fread($dbf, $recLen);
        $out = [];
        $pos = 1;
        foreach ($fields as $f) {
            $v = trim(substr($raw, $pos, $f['len']));
            $pos += $f['len'];
            if ($encoding !== 'UTF-8') {
                $v = mb_convert_encoding($v, 'UTF-8', $encoding);
            } elseif (!mb_check_encoding($v, 'UTF-8')) {
                $v = mb_convert_encoding($v, 'UTF-8', 'Windows-1252');
            }
            $out[$f['name']] = match ($f['type']) {
                'N', 'F' => $v === '' ? null : (str_contains($v, '.') ? (float) $v : (int) $v),
                'L' => in_array(strtoupper($v), ['Y', 'T'], true),
                default => $v,
            };
        }
        return $out;
    }

    private static function encoding(string $base): string
    {
        $cpg = self::sibling($base, 'cpg');
        if ($cpg) {
            $e = strtoupper(trim((string) file_get_contents($cpg)));
            if (in_array($e, ['UTF-8', 'UTF8'], true)) {
                return 'UTF-8';
            }
            if (preg_match('/1252|LATIN1|8859-1/', $e)) {
                return 'Windows-1252';
            }
        }
        return 'UTF-8'; // mit Fallback auf Windows-1252 bei ungültigem UTF-8
    }

    private static function sibling(string $base, string $ext): ?string
    {
        foreach ([$ext, strtoupper($ext)] as $e) {
            if (is_file("$base.$e")) {
                return "$base.$e";
            }
        }
        return null;
    }

    private static function open(string $path)
    {
        $h = @fopen($path, 'rb');
        if ($h === false) {
            throw new RuntimeException("Datei nicht lesbar: $path");
        }
        return $h;
    }
}
