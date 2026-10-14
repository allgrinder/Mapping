<?php
declare(strict_types=1);

/**
 * Externe Dienste und Datenquellen. Recherchiert am 2026-10-14.
 * `verified`: true  = URL aus amtlicher/primärer Quelle bestätigt,
 *             false = Quelle bekannt, exakte URL/Parameter vor Inbetriebnahme prüfen.
 * Aus der Entwicklungsumgebung waren die Hosts nicht erreichbar (Proxy-Sperre) – Livetests stehen aus.
 * Alle Abrufe laufen serverseitig (Proxy/Import); der Browser spricht nie direkt mit diesen Hosts.
 */
$env = static fn (string $k, mixed $d = null): mixed => ($v = getenv($k)) === false || $v === '' ? $d : $v;

return [
    'boundaries' => [
        'dvg2' => [
            'label' => 'Digitale Verwaltungsgrenzen NRW, niedrige Stützpunktdichte (DVG2), Shape, EPSG:25832',
            'url' => 'https://www.opengeodata.nrw.de/produkte/geobasis/vkg/dvg/dvg2/dvg2_EPSG25832_Shape.zip',
            'product_page' => 'https://www.opengeodata.nrw.de/produkte/geobasis/vkg/dvg/dvg2/',
            'license' => 'dl-de/zero-2.0',
            'attribution' => '© Geobasis NRW',
            'verified' => true,
            'note' => 'Aktualisierung jährlich zum 1. Oktober. Alternativ DVG1 (hohe Stützpunktdichte) unter …/dvg/dvg1/dvg1_EPSG25832_Shape.zip.',
        ],
        'plz' => [
            'label' => 'PLZ-Gebiete (5-stellig) aus OpenStreetMap',
            'url' => null,
            'product_page' => 'https://www.suche-postleitzahl.org/downloads',
            'license' => 'ODbL-1.0',
            'attribution' => '© OpenStreetMap-Mitwirkende (ODbL)',
            'verified' => false,
            'note' => 'Dateiname der GeoJSON-Datei „plz-5stellig“ auf der Download-Seite prüfen. ODbL: Namensnennung auf Karte und Ausdruck; abgeleitete Datenbank bleibt ODbL.',
        ],
    ],
    'wms' => [
        'dtk' => [
            'label' => 'WMS NW Digitale Topographische Karten (Geobasis NRW)',
            'url' => 'https://www.wms.nrw.de/geobasis/wms_nw_dtk',
            'capabilities' => 'https://www.wms.nrw.de/geobasis/wms_nw_dtk?REQUEST=GetCapabilities&SERVICE=WMS',
            'version' => '1.3.0',
            // Layername aus den GetCapabilities übernehmen und per Umgebungsvariable setzen – nicht geraten.
            'layers' => $env('DTK_WMS_LAYERS', ''),
            'license' => 'dl-de/zero-2.0 (BKG-Anteile DTK250/DTK500: dl-de/by-2.0)',
            'attribution' => '© Geobasis NRW, © BKG',
            'verified' => true,
        ],
        // Stufe 2: Hochwassergefahrenkarten – URL wird bei Umsetzung recherchiert.
    ],
    'geocoding' => [
        // Anbieter austauschbar; leer lassen (GEOCODER_URL=off), wenn kein Internetzugang besteht – dann Marker per Klick setzen.
        'provider' => 'nominatim',
        'url' => $env('GEOCODER_URL', 'https://nominatim.openstreetmap.org/search'),
        'usage_policy' => 'https://operations.osmfoundation.org/policies/nominatim/',
        'license' => 'ODbL-1.0',
        'attribution' => '© OpenStreetMap-Mitwirkende',
        'min_interval_ms' => (int) $env('GEOCODER_MIN_INTERVAL_MS', 1100), // Nominatim: max. 1 Anfrage/Sekunde
        'cache_days' => 30,
        'viewbox' => '5.8,52.6,9.5,50.3', // NRW (lon/lat), Ergebnisse werden darauf begrenzt
        'verified' => true,
    ],
    'warnings' => [
        // Stufe 2: NINA/MoWaS, DWD
    ],
    'http' => [
        'timeout' => (int) $env('HTTP_TIMEOUT', 10),
        'user_agent' => $env('HTTP_USER_AGENT', 'KRITIS-Lagekarte-NRW/1.0 (Landesverwaltung NRW)'),
    ],
];
