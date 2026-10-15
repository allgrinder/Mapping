<?php
declare(strict_types=1);

/**
 * Start-Vorbereitung im Container (docker/app/entrypoint.sh): wartet auf die Datenbank, spielt Migrationen ein,
 * legt Stammdaten und den Admin an (Initialpasswort erscheint einmalig im Container-Log) und importiert
 * Verwaltungsgrenzen, falls noch keine vorhanden sind:
 *   1. Dateien aus storage/import/ (DVG-ZIP bzw. PLZ-GeoJSON) – für Betrieb ohne Internet
 *   2. sonst Download der DVG2 von Geobasis NRW (URL aus config/services.php), abschaltbar mit AUTO_IMPORT_BOUNDARIES=false
 * Idempotent: bei jedem Start ausführbar.
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\BoundaryImporter;
use Kritis\Security\PasswordHasher;
use Kritis\Support\Config;
use Kritis\Support\Database;
use Kritis\Support\HttpClient;
use Kritis\Support\Migrator;
use Kritis\Support\Seeder;

$say = fn (string $m) => print('[kritis] ' . $m . PHP_EOL);
$config = Config::load();
$root = dirname(__DIR__, 2);

$db = null;
for ($i = 1; $i <= 60; $i++) {
    try {
        $db = Database::connect($config);
        break;
    } catch (Throwable $e) {
        if ($i === 1 || $i % 10 === 0) {
            $say("Warte auf Datenbank ({$config->get('db.host')}) … " . $e->getMessage());
        }
        sleep(2);
    }
}
if (!$db) {
    $say('Datenbank nicht erreichbar – Abbruch.');
    exit(1);
}

$applied = (new Migrator($db, __DIR__ . '/../migrations'))->run();
$say($applied ? 'Migrationen: ' . implode(', ', $applied) : 'Datenbank ist aktuell.');

$pw = (new Seeder($db, new PasswordHasher()))->run(getenv('ADMIN_USER') ?: 'admin');
if ($pw !== null) {
    $line = str_repeat('=', 64);
    echo "\n$line\n  Admin angelegt. Benutzername: " . (getenv('ADMIN_USER') ?: 'admin') . "\n  Initialpasswort: $pw\n"
        . "  (muss bei der ersten Anmeldung geändert werden; vergessen? → bin/reset-password.php)\n$line\n\n";
}

$has = fn (string $level) => (bool) $db->query("SELECT 1 FROM boundaries WHERE level = " . $db->quote($level) . ' LIMIT 1')->fetchColumn();
$importer = new BoundaryImporter($db, require "$root/config/boundaries.php", fn ($m) => $say("  $m"));
$importDir = $config->get('storage') . '/import';
@mkdir($importDir, 0775, true);

try {
    if (!$has('regbez')) {
        $local = array_merge(glob("$importDir/dvg*.zip") ?: [], glob("$importDir/*dvg*", GLOB_ONLYDIR) ?: []);
        if ($local) {
            $say('Verwaltungsgrenzen aus ' . basename($local[0]) . ' …');
            $importer->importDvg($local[0]);
        } elseif (strtolower((string) getenv('AUTO_IMPORT_BOUNDARIES')) !== 'false') {
            $services = require "$root/config/services.php";
            $url = $services['boundaries']['dvg2']['url'];
            $say("Lade Verwaltungsgrenzen (DVG2, dl-de/zero-2.0): $url");
            $http = new HttpClient((string) $config->get('outbound_proxy', ''), 180, (string) $services['http']['user_agent']);
            $r = $http->get($url);
            if ($r['status'] !== 200 || !str_starts_with($r['body'], "PK")) {
                throw new RuntimeException("Download fehlgeschlagen (HTTP {$r['status']}). Datei manuell nach storage/import/ legen.");
            }
            $file = "$importDir/dvg2_EPSG25832_Shape.zip";
            file_put_contents($file, $r['body']);
            $importer->importDvg($file);
        } else {
            $say('Keine Verwaltungsgrenzen vorhanden (AUTO_IMPORT_BOUNDARIES=false, nichts in storage/import/).');
        }
    }
    // PLZ-Gebiete aus einer abgelegten Datei (amtlich oder eigener OSM-Vorrat). Der OSM-Abruf selbst läuft danach im
    // Hintergrund (bin/import-plz-osm.php --auto), damit der Start nicht minutenlang wartet.
    if ($has('land') && !$has('plz5') && ($plz = glob("$importDir/*plz*5*.geojson") ?: glob("$importDir/*plz*.geojson"))) {
        $say('PLZ-Gebiete aus ' . basename($plz[0]) . ' …');
        $osm = basename($plz[0]) === 'plz-osm-nrw.geojson';
        $base = $osm ? (json_decode((string) file_get_contents($plz[0]), true)['osmBase'] ?? null) : null;
        $importer->importPlz($plz[0], null, $osm ? 'OpenStreetMap (boundary=postal_code' . ($base ? ', Stand ' . substr($base, 0, 10) : '') . ')' : null);
    }
} catch (Throwable $e) {
    // Die App läuft auch ohne Grenzen (Karte ohne politische Ebene); Fehler nur melden
    $say('Grenzimport übersprungen: ' . $e->getMessage());
}
$say('Bereit.');
