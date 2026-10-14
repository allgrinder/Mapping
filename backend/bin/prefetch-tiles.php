<?php
declare(strict_types=1);

/**
 * Füllt den Kachel-Cache einer Hintergrundkarte vorab (z. B. NRW-Übersicht in niedrigen Zoomstufen),
 * damit die Karte ohne Internet funktioniert. Auf einem Rechner mit Netz ausführen und
 * backend/storage/tiles/<id>/ auf den Zielserver kopieren.
 *
 *   php bin/prefetch-tiles.php --basemap=topografisch --max-zoom=5
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\TileService;
use Kritis\Support\Config;
use Kritis\Support\HttpClient;

$opt = getopt('', ['basemap:', 'min-zoom::', 'max-zoom:']);
if (!isset($opt['basemap'], $opt['max-zoom'])) {
    fwrite(STDERR, "Aufruf: php bin/prefetch-tiles.php --basemap=ID --max-zoom=N [--min-zoom=0]\n");
    exit(1);
}
$root = dirname(__DIR__, 2);
$config = Config::load();
$services = require "$root/config/services.php";
$basemaps = require "$root/config/basemaps.php";
$tiles = new TileService($basemaps, $services, $config->get('storage') . '/tiles',
    new HttpClient((string) $config->get('outbound_proxy', ''), (int) $services['http']['timeout'], (string) $services['http']['user_agent']));
$id = (string) $opt['basemap'];
if (!$tiles->isTileBasemap($id) || $tiles->upstream($id) === null) {
    fwrite(STDERR, "Hintergrund „$id“ hat keine konfigurierte Quelle (basemaps.php / services.php, z. B. DTK_WMS_LAYERS).\n");
    exit(2);
}
$g = $basemaps['grid'];
$ok = $fail = 0;
for ($z = (int) ($opt['min-zoom'] ?? 0); $z <= (int) $opt['max-zoom']; $z++) {
    $span = $g['resolutions'][$z] * $g['tile_size'];
    $nx = (int) ceil(($g['extent'][2] - $g['extent'][0]) / $span);
    $ny = (int) ceil(($g['extent'][3] - $g['extent'][1]) / $span);
    for ($x = 0; $x < $nx; $x++) {
        for ($y = 0; $y < $ny; $y++) {
            $tiles->get($id, $z, $x, $y) !== null ? $ok++ : $fail++;
        }
    }
    printf("Zoom %2d: %d Kacheln vorhanden, %d fehlgeschlagen\n", $z, $ok, $fail);
}
exit($fail > 0 ? 3 : 0);
