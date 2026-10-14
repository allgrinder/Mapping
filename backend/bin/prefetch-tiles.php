<?php
declare(strict_types=1);

/**
 * Füllt den Kachel-Cache einer Hintergrundkarte vorab (z. B. NRW-Übersicht in niedrigen Zoomstufen),
 * damit die Karte ohne Internet funktioniert. Auf einem Rechner mit Netz ausführen und
 * backend/storage/tiles/<id>/ auf den Zielserver kopieren.
 *
 *   php bin/prefetch-tiles.php --basemap=topografisch --max-zoom=7                 # ganz NRW bis ca. 1:65.000
 *   php bin/prefetch-tiles.php --basemap=topografisch --min-zoom=8 --max-zoom=10 \
 *       --extent=340000,5620000,380000,5660000                                     # ein Kreis in Detailstufen
 *   … --dry-run   zeigt nur Anzahl und geschätzte Größe
 *
 * Bereits vorhandene Kacheln werden übersprungen – ein abgebrochener Lauf kann einfach neu gestartet werden.
 * --delay-ms (Standard 100) hält Abstand zwischen Abrufen, um den Dienst nicht zu überlasten.
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\TileService;
use Kritis\Support\Config;
use Kritis\Support\HttpClient;

$opt = getopt('', ['basemap:', 'min-zoom:', 'max-zoom:', 'extent:', 'delay-ms:', 'dry-run']);
if (!isset($opt['basemap'], $opt['max-zoom'])) {
    fwrite(STDERR, "Aufruf: php bin/prefetch-tiles.php --basemap=ID --max-zoom=N [--min-zoom=0] [--extent=minx,miny,maxx,maxy (EPSG:25832)] [--delay-ms=100] [--dry-run]\n");
    exit(1);
}
$root = dirname(__DIR__, 2);
$config = Config::load();
$services = require "$root/config/services.php";
$basemaps = require "$root/config/basemaps.php";
$tiles = new TileService($basemaps, $services, $config->get('storage') . '/tiles',
    new HttpClient((string) $config->get('outbound_proxy', ''), (int) $services['http']['timeout'], (string) $services['http']['user_agent']),
    $config->get('storage') . '/cache');
$id = (string) $opt['basemap'];
$g = $basemaps['grid'];
$minZ = (int) ($opt['min-zoom'] ?? 0);
$maxZ = min((int) $opt['max-zoom'], count($g['resolutions']) - 1);
$ext = $g['extent'];
if (isset($opt['extent'])) {
    $e = array_map('floatval', explode(',', (string) $opt['extent']));
    if (count($e) !== 4 || $e[0] >= $e[2] || $e[1] >= $e[3]) {
        fwrite(STDERR, "--extent erwartet minx,miny,maxx,maxy in EPSG:25832 (Meter).\n");
        exit(1);
    }
    $ext = [max($e[0], $g['extent'][0]), max($e[1], $g['extent'][1]), min($e[2], $g['extent'][2]), min($e[3], $g['extent'][3])];
}
/** @return array{int,int,int,int} Kachelspalten/-zeilen x0..x1, y0..y1 für den Ausschnitt */
$range = function (int $z) use ($g, $ext): array {
    $span = $g['resolutions'][$z] * $g['tile_size'];
    return [(int) floor(($ext[0] - $g['origin'][0]) / $span), (int) ceil(($ext[2] - $g['origin'][0]) / $span) - 1,
        (int) floor(($g['origin'][1] - $ext[3]) / $span), (int) ceil(($g['origin'][1] - $ext[1]) / $span) - 1];
};
$total = 0;
for ($z = $minZ; $z <= $maxZ; $z++) {
    [$x0, $x1, $y0, $y1] = $range($z);
    $n = ($x1 - $x0 + 1) * ($y1 - $y0 + 1);
    $total += $n;
    printf("Zoom %2d (%7.2f m/Pixel): %8d Kacheln\n", $z, $g['resolutions'][$z], $n);
}
printf("Gesamt: %d Kacheln, geschätzt %.1f GB (bei ~40 KB je Kachel)\n", $total, $total * 40 / 1024 / 1024);
if (isset($opt['dry-run'])) {
    exit(0);
}
$svc = $tiles->isTileBasemap($id) ? $tiles->upstream($id) : null;
if ($svc === null) {
    fwrite(STDERR, "Hintergrund „{$id}“: keine Quelle erreichbar bzw. kein Layer ermittelbar (basemaps.php / services.php, `php bin/wms-layers.php dtk`, ggf. DTK_WMS_LAYERS).\n");
    exit(2);
}
echo "Quelle: {$svc['url']} · Layer: {$svc['layers']}" . (!empty($svc['layersDiscovered']) ? ' (automatisch gewählt)' : '') . "\n";
$delay = max(0, (int) ($opt['delay-ms'] ?? 100)) * 1000;
$ok = $fail = $have = 0;
for ($z = $minZ; $z <= $maxZ; $z++) {
    [$x0, $x1, $y0, $y1] = $range($z);
    for ($x = $x0; $x <= $x1; $x++) {
        for ($y = $y0; $y <= $y1; $y++) {
            if (is_file($tiles->path($id, $z, $x, $y))) {
                $have++;
                continue;
            }
            $tiles->get($id, $z, $x, $y) !== null ? $ok++ : $fail++;
            if ($delay) {
                usleep($delay);
            }
        }
    }
    printf("Zoom %2d fertig: %d neu, %d schon vorhanden, %d fehlgeschlagen\n", $z, $ok, $have, $fail);
}
echo "Kacheln liegen in " . $config->get('storage') . "/tiles/$id/ – dieses Verzeichnis auf den Zielserver kopieren.\n";
exit($fail > 0 ? 3 : 0);
