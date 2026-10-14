<?php
declare(strict_types=1);

/**
 * Exportiert DVG-Verwaltungsgrenzen als statische GeoJSON-Dateien (WGS84) – für die Demo auf GitHub Pages.
 * Braucht keine Datenbank.
 *
 *   php bin/export-geojson.php --dvg=/pfad/dvg2_EPSG25832_Shape.zip --out=/pfad/zielordner
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\ShapefileReader;
use Kritis\Geo\Simplify;
use Kritis\Geo\Utm32;

$opt = getopt('', ['dvg:', 'out:', 'simplify::']);
if (!isset($opt['dvg'], $opt['out'])) {
    fwrite(STDERR, "Aufruf: php bin/export-geojson.php --dvg=DATEI.zip|VERZEICHNIS --out=ZIELORDNER [--simplify=METER]\n");
    exit(1);
}
$cfg = (require dirname(__DIR__, 2) . '/config/boundaries.php')['dvg'];
$src = (string) $opt['dvg'];
$out = rtrim((string) $opt['out'], '/');
$tol = (float) ($opt['simplify'] ?? 0);
@mkdir($out, 0775, true);

$dir = $src;
$tmp = null;
if (is_file($src)) {
    $tmp = sys_get_temp_dir() . '/kritis-export-' . bin2hex(random_bytes(4));
    mkdir($tmp, 0700, true);
    $zip = new ZipArchive();
    if ($zip->open($src) !== true) {
        fwrite(STDERR, "ZIP nicht lesbar: $src\n");
        exit(2);
    }
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if (preg_match('/\.(shp|shx|dbf|cpg)$/i', $name) && !str_contains($name, '..')) {
            file_put_contents($tmp . '/' . basename($name), $zip->getFromIndex($i));
        }
    }
    $zip->close();
    $dir = $tmp;
}

$files = [];
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
    foreach ($cfg['files'] as $level => $re) {
        if (!isset($files[$level]) && preg_match($re, $f->getFilename())) {
            $files[$level] = $f->getPathname();
        }
    }
}
if (!isset($files['regbez'], $files['kreis'])) {
    fwrite(STDERR, "DVG-Dateien für Regierungsbezirke/Kreise nicht gefunden.\n");
    exit(3);
}

$round = fn (array $g) => ['type' => $g['type'], 'coordinates' => Utm32::mapCoords($g['coordinates'], fn ($x, $y) => [round($x, 5), round($y, 5)])];
$meta = ['generatedAt' => gmdate('Y-m-d H:i:s'), 'source' => $cfg['source'], 'license' => $cfg['license'], 'attribution' => $cfg['attribution'], 'levels' => []];
$regbezPolys = [];
foreach ($files as $level => $file) {
    $features = [];
    foreach (ShapefileReader::read($file) as $f) {
        $code = BoundaryImporter::normalizeCode((string) $f['properties'][$cfg['code_field']], $level);
        $geom = $round(Utm32::geometryToWgs84(Simplify::geometry($f['geometry'], $tol)));
        $features[] = ['type' => 'Feature', 'properties' => [
            'code' => $code,
            'name' => trim((string) $f['properties'][$cfg['name_field']]),
            'regbez' => in_array($level, ['kreis', 'gemeinde'], true) ? substr($code, 0, 3) : null,
            'kreis' => $level === 'gemeinde' ? substr($code, 0, 5) : null,
        ], 'geometry' => $geom];
        if ($level === 'regbez') {
            array_push($regbezPolys, ...($geom['type'] === 'Polygon' ? [$geom['coordinates']] : $geom['coordinates']));
        }
    }
    usort($features, fn ($a, $b) => strcmp($a['properties']['code'], $b['properties']['code']));
    file_put_contents("$out/boundaries-$level.json", json_encode(['type' => 'FeatureCollection', 'features' => $features], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $meta['levels'][$level] = count($features);
    printf("%-8s %4d Gebiete\n", $level, count($features));
}
if (!isset($files['land'])) {
    // ohne Landesgrenzen-Datei: Regierungsbezirke als Landesfläche (nur Darstellung)
    file_put_contents("$out/boundaries-land.json", json_encode(['type' => 'FeatureCollection', 'features' => [[
        'type' => 'Feature', 'properties' => ['code' => '05', 'name' => 'Nordrhein-Westfalen', 'regbez' => null, 'kreis' => null],
        'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $regbezPolys],
    ]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $meta['levels']['land'] = 1;
}
file_put_contents("$out/meta.json", json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
if ($tmp) {
    array_map('unlink', glob("$tmp/*") ?: []);
    rmdir($tmp);
}
echo "Export nach $out abgeschlossen.\n";
