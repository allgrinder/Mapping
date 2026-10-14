<?php
declare(strict_types=1);

/**
 * Importiert Verwaltungsgrenzen und PLZ-Gebiete aus lokalen Dateien.
 *
 *   php bin/import-boundaries.php --dvg=/pfad/dvg2_EPSG25832_Shape.zip
 *   php bin/import-boundaries.php --plz5=/pfad/plz-5stellig.geojson [--plz2=/pfad/plz-2stellig.geojson]
 *
 * Bezugsquellen und Lizenzen: config/services.php → boundaries. Ohne --plz2 werden die
 * Leitregionen aus den 5-stelligen Gebieten zusammengesetzt.
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\BoundaryImporter;
use Kritis\Support\Config;
use Kritis\Support\Database;

$opt = getopt('', ['dvg:', 'plz5:', 'plz2:']);
if (!$opt) {
    fwrite(STDERR, "Aufruf: php bin/import-boundaries.php --dvg=DATEI.zip|VERZEICHNIS  und/oder  --plz5=DATEI.geojson [--plz2=DATEI.geojson]\n");
    exit(1);
}
$config = Config::load();
$db = Database::connect($config);
$importer = new BoundaryImporter($db, require dirname(__DIR__, 2) . '/config/boundaries.php', fn ($m) => print("  $m\n"));
try {
    if (isset($opt['dvg'])) {
        echo "Verwaltungsgrenzen (DVG):\n";
        $importer->importDvg((string) $opt['dvg']);
    }
    if (isset($opt['plz5'])) {
        echo "PLZ-Gebiete:\n";
        $importer->importPlz((string) $opt['plz5'], isset($opt['plz2']) ? (string) $opt['plz2'] : null);
    }
    echo "Fertig. Hinweis: Einrichtungen werden beim nächsten Speichern neu zugeordnet.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Fehler: ' . $e->getMessage() . "\n");
    exit(2);
}
