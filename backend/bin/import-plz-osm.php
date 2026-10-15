<?php
declare(strict_types=1);

/**
 * PLZ-Gebiete (5-stellig) für NRW aus OpenStreetMap laden und importieren – mit Vorrat für den Offline-Betrieb.
 *
 *   php bin/import-plz-osm.php                 # jetzt laden, als storage/import/plz-osm-nrw.geojson speichern, importieren
 *   php bin/import-plz-osm.php --auto          # nur wenn fehlend oder älter als PLZ_REFRESH_DAYS (Standard 30) – für Start/Cron;
 *                                              #   amtliche/manuell importierte PLZ-Daten werden nie überschrieben
 *   php bin/import-plz-osm.php --out=DATEI     # nur laden und als GeoJSON speichern (Rechner mit Internet → Datei kopieren)
 *   php bin/import-plz-osm.php --from=DATEI    # gespeicherte Datei (GeoJSON oder Overpass-JSON) importieren – ohne Internet
 *   php bin/import-plz-osm.php --demo-out=DIR  # GeoJSON für die Demo (GitHub Pages) schreiben, ohne Datenbank
 *
 * Fällt der Abruf aus, bleibt der vorhandene Stand unverändert. Lizenz: ODbL, © OpenStreetMap-Mitwirkende – nicht amtlich.
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\OsmPostalCodes;
use Kritis\Geo\Simplify;
use Kritis\Geo\Utm32;
use Kritis\Support\Config;
use Kritis\Support\Database;
use Kritis\Support\HttpClient;

ini_set('memory_limit', '3G');
set_time_limit(0);
$opt = getopt('', ['auto', 'out:', 'from:', 'demo-out:']);
$say = fn (string $m) => print('[plz] ' . $m . PHP_EOL);
$root = dirname(__DIR__, 2);
$config = Config::load();
$services = require "$root/config/services.php";
$svc = $services['boundaries']['plz'];
$saved = $config->get('storage') . '/import/plz-osm-nrw.geojson';

$fetch = function () use ($svc, $services, $config, $say): array {
    $say('Lade PLZ-Gebiete NRW aus OpenStreetMap (Overpass) … das dauert einige Minuten.');
    $http = new HttpClient((string) $config->get('outbound_proxy', ''), 1200, (string) $services['http']['user_agent'], 1_000_000_000);
    $r = (new OsmPostalCodes($svc, $http))->fetch(fn ($m) => print('[plz] ' . $m . PHP_EOL));
    $n = count($r['geojson']['features']);
    if ($n < 50) {
        throw new RuntimeException("Unplausibel wenige PLZ-Gebiete ($n) – Abbruch, vorhandener Stand bleibt.");
    }
    $say("$n PLZ-Gebiete erhalten (OSM-Stand " . ($r['osmBase'] ?? 'unbekannt') . ').');
    return $r;
};
$write = function (string $file, array $r): void {
    @mkdir(dirname($file), 0775, true);
    $r['geojson']['osmBase'] = $r['osmBase'];
    file_put_contents($file . '.tmp', json_encode($r['geojson'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    rename($file . '.tmp', $file);
};

try {
    if (isset($opt['demo-out'])) {
        $r = isset($opt['from']) ? OsmPostalCodes::fromOverpassJson((string) file_get_contents((string) $opt['from'])) : $fetch();
        $features = [];
        // Zuschnitt auf NRW ohne Datenbank: Gebiet behalten, wenn ein Teil seiner Stützpunkte in der Landesfläche liegt
        $landFile = rtrim((string) $opt['demo-out'], '/') . '/boundaries-land.json';
        $land = is_file($landFile) ? (json_decode((string) file_get_contents($landFile), true)['features'][0]['geometry'] ?? null) : null;
        $inNrw = function (array $geom) use ($land): bool {
            if (!$land) {
                return true;
            }
            $rings = $geom['type'] === 'Polygon' ? [$geom['coordinates'][0]] : array_map(fn ($p) => $p[0], $geom['coordinates']);
            foreach ($rings as $ring) {
                $step = max(1, intdiv(count($ring), 25));
                for ($i = 0; $i < count($ring); $i += $step) {
                    if (\Kritis\Geo\GeoUtil::contains($land, (float) $ring[$i][0], (float) $ring[$i][1])) {
                        return true;
                    }
                }
            }
            return false;
        };
        foreach ($r['geojson']['features'] as $f) {
            if (!$inNrw($f['geometry'])) {
                continue;
            }
            $g = Utm32::geometryToWgs84(Simplify::geometry(Utm32::geometryToUtm($f['geometry']), 15));
            if (!$g['coordinates']) {
                continue;
            }
            $g['coordinates'] = Utm32::mapCoords($g['coordinates'], fn ($x, $y) => [round($x, 5), round($y, 5)]);
            $features[] = ['type' => 'Feature', 'properties' => ['code' => $f['properties']['plz'], 'name' => trim(preg_replace('/^\d+\s*/', '', $f['properties']['note'])) ?: $f['properties']['plz']], 'geometry' => $g];
        }
        usort($features, fn ($a, $b) => strcmp($a['properties']['code'], $b['properties']['code']));
        $dir = rtrim((string) $opt['demo-out'], '/');
        file_put_contents("$dir/boundaries-plz5.json", json_encode(['type' => 'FeatureCollection', 'features' => $features], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $metaFile = "$dir/meta.json";
        $meta = is_file($metaFile) ? json_decode((string) file_get_contents($metaFile), true) : ['levels' => []];
        $meta['levels']['plz5'] = count($features);
        $meta['plz'] = ['source' => 'OpenStreetMap (boundary=postal_code)', 'license' => $svc['license'], 'attribution' => $svc['attribution'], 'osmBase' => $r['osmBase']];
        file_put_contents($metaFile, json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        $say(count($features) . " Gebiete nach $dir/boundaries-plz5.json geschrieben.");
        exit(0);
    }
    if (isset($opt['out'])) {
        $write((string) $opt['out'], $fetch());
        $say('Gespeichert: ' . $opt['out'] . ' – nach storage/import/ des Zielservers kopieren und dort `--from` ausführen bzw. Container neu starten.');
        exit(0);
    }

    $db = Database::connect($config);
    $importer = new BoundaryImporter($db, require "$root/config/boundaries.php", fn ($m) => $say("  $m"));
    $last = $db->query("SELECT source, imported_at FROM boundary_imports WHERE level = 'plz5'")->fetch() ?: null;

    if (isset($opt['from'])) {
        $file = (string) $opt['from'];
        $raw = (string) @file_get_contents($file);
        $isOverpass = str_contains(substr($raw, 0, 2000), '"elements"');
        $geo = $isOverpass ? OsmPostalCodes::fromOverpassJson($raw) : ['geojson' => json_decode($raw, true), 'osmBase' => json_decode($raw, true)['osmBase'] ?? null];
        unset($raw);
        if ($isOverpass) {
            $write($saved, $geo);
            $file = $saved;
        }
        $importer->importPlz($file, null, 'OpenStreetMap (boundary=postal_code' . ($geo['osmBase'] ? ', Stand ' . substr($geo['osmBase'], 0, 10) : '') . ')');
        exit(0);
    }

    if (isset($opt['auto'])) {
        if (strtolower((string) getenv('AUTO_IMPORT_PLZ')) === 'false') {
            exit(0);
        }
        if (!$db->query("SELECT 1 FROM boundaries WHERE level = 'land' LIMIT 1")->fetchColumn()) {
            $say('Noch keine Verwaltungsgrenzen – PLZ-Import später.');
            exit(0);
        }
        if ($last && !str_starts_with((string) $last['source'], 'OpenStreetMap')) {
            exit(0); // andere (z. B. amtliche) PLZ-Daten: nicht automatisch ersetzen
        }
        if ($last && strtotime($last['imported_at'] . ' UTC') > time() - max(1, (int) $svc['refresh_days']) * 86400) {
            exit(0); // Vorrat aktuell genug
        }
    }

    try {
        $r = $fetch();
        $write($saved, $r);
    } catch (Throwable $e) {
        $say('Abruf nicht möglich: ' . $e->getMessage());
        if ($last) {
            $say('Vorhandene PLZ-Gebiete bleiben unverändert (Stand ' . $last['imported_at'] . ' UTC).');
            exit(isset($opt['auto']) ? 0 : 2);
        }
        if (!is_file($saved)) {
            $say('Ohne Internet: auf einem Rechner mit Netz `--out=plz-osm-nrw.geojson` ausführen und die Datei nach storage/import/ kopieren.');
            exit(isset($opt['auto']) ? 0 : 2);
        }
        $say('Nutze gespeicherten Vorrat ' . basename($saved) . '.');
        $r = ['osmBase' => json_decode((string) file_get_contents($saved), true)['osmBase'] ?? null];
    }
    $importer->importPlz($saved, null, 'OpenStreetMap (boundary=postal_code' . (!empty($r['osmBase']) ? ', Stand ' . substr($r['osmBase'], 0, 10) : '') . ')');
} catch (Throwable $e) {
    $say('Fehler: ' . $e->getMessage());
    exit(isset($opt['auto']) ? 0 : 1);
}
