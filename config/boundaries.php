<?php
declare(strict_types=1);

/**
 * Zuordnung der Quelldateien für den Grenzimport (bin/import-boundaries.php).
 * Die Dateien werden einmalig beschafft (siehe services.php → boundaries) und lokal eingespielt –
 * ein Internetzugang des Servers ist nicht nötig.
 */
return [
    'dvg' => [
        // Dateinamen im DVG-Paket (Geobasis NRW, z. B. dvg2_EPSG25832_Shape.zip): dvg2bld_nw, dvg2rbz_nw, dvg2krs_nw, dvg2gem_nw
        'files' => ['land' => '/bld_nw\.shp$/i', 'regbez' => '/rbz_nw\.shp$/i', 'kreis' => '/krs_nw\.shp$/i', 'gemeinde' => '/gem_nw\.shp$/i'],
        'code_field' => 'KN',   // amtlicher Schlüssel
        'name_field' => 'GN',   // Gebietsname
        'srs' => 25832,
        'simplify_m' => 0,      // DVG2 ist bereits generalisiert (~50 m)
        'source' => 'Geobasis NRW – Digitale Verwaltungsgrenzen (DVG)',
        'license' => 'dl-de/zero-2.0',
        'attribution' => '© Geobasis NRW',
    ],
    'plz' => [
        'code_fields' => ['plz', 'PLZ', 'postcode', 'postal_code'],
        'name_fields' => ['note', 'name', 'ort'],
        'simplify_m' => 15,     // OSM-Polygone sind sehr detailliert
        'source' => 'OpenStreetMap (PLZ-Gebiete, z. B. über suche-postleitzahl.org)',
        'license' => 'ODbL-1.0',
        'attribution' => '© OpenStreetMap-Mitwirkende (ODbL)',
    ],
];
