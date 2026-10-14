<?php
declare(strict_types=1);

/**
 * Zeigt die Layer eines WMS aus config/services.php und welcher Layer automatisch für die Hintergrundkarte gewählt wird.
 * Ergebnis wird gemerkt (storage/cache/wms-<dienst>-layer.json). Zum Festlegen: DTK_WMS_LAYERS=<Name> setzen.
 *
 *   php bin/wms-layers.php dtk            # Liste + automatische Wahl (frisch abgerufen)
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\TileService;
use Kritis\Support\Config;
use Kritis\Support\HttpClient;

$key = $argv[1] ?? 'dtk';
$root = dirname(__DIR__, 2);
$config = Config::load();
$services = require "$root/config/services.php";
$basemaps = require "$root/config/basemaps.php";
$svc = $services['wms'][$key] ?? null;
if (!$svc) {
    fwrite(STDERR, "Unbekannter Dienst „{$key}“. Vorhanden: " . implode(', ', array_keys($services['wms'])) . "\n");
    exit(1);
}
$http = new HttpClient((string) $config->get('outbound_proxy', ''), (int) $services['http']['timeout'], (string) $services['http']['user_agent']);
echo "Dienst: {$svc['url']}\n";
try {
    $r = $http->get($svc['url'] . '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=' . ($svc['version'] ?? '1.3.0'));
} catch (\Throwable $e) {
    fwrite(STDERR, "Nicht erreichbar: {$e->getMessage()}\n(Ausgehenden Proxy prüfen: OUTBOUND_PROXY)\n");
    exit(2);
}
if ($r['status'] !== 200) {
    fwrite(STDERR, "GetCapabilities: HTTP {$r['status']}\n");
    exit(2);
}
$doc = simplexml_load_string($r['body'], 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOCDATA);
foreach ($doc ? ($doc->xpath('//*[local-name()="Layer"][*[local-name()="Name"]]') ?: []) : [] as $l) {
    $depth = count($l->xpath('ancestor::*[local-name()="Layer"]') ?: []);
    printf("%s%-40s %s\n", str_repeat('  ', $depth), (string) $l->xpath('./*[local-name()="Name"]')[0], (string) ($l->xpath('./*[local-name()="Title"]')[0] ?? ''));
}
$tiles = new TileService($basemaps, $services, $config->get('storage') . '/tiles', $http, $config->get('storage') . '/cache');
$pick = $tiles->discoveredLayer($key, $svc, true);
echo "\nAutomatische Wahl: " . ($pick ?? '— keine (bitte DTK_WMS_LAYERS setzen)') . "\n";
if (!empty($svc['layers'])) {
    echo "Fest eingestellt (hat Vorrang): {$svc['layers']}\n";
}
