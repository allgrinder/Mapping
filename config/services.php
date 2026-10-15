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
            // PLZ-Gebiete aus OpenStreetMap (boundary=postal_code) – nicht amtlich. Abruf über die Overpass API
            // (Nutzungsregeln: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html – ein Abruf je Monat ist unkritisch).
            'label' => 'PLZ-Gebiete (5-stellig) aus OpenStreetMap',
            'overpass_url' => $env('OSM_OVERPASS_URL', 'https://overpass-api.de/api/interpreter'), // mehrere durch Komma = Ausweichserver (z. B. eigener Overpass-Server)
            'refresh_days' => (int) $env('PLZ_REFRESH_DAYS', 30),
            'license' => 'ODbL-1.0',
            'attribution' => '© OpenStreetMap-Mitwirkende (ODbL)',
            'verified' => true, // im GitHub-Build am 15.10.2026 geprüft: 1401 Gebiete im Rechteck, 945 in NRW
            'note' => 'ODbL: Namensnennung auf Karte und Ausdruck; abgeleitete Datenbank bleibt ODbL. Amtliche Alternative: BKG/Deutsche Post Direkt (lizenzpflichtig).',
        ],
    ],
    'wms' => [
        'dtk' => [
            'label' => 'WMS NW Digitale Topographische Karten (Geobasis NRW)',
            'url' => 'https://www.wms.nrw.de/geobasis/wms_nw_dtk',
            'capabilities' => 'https://www.wms.nrw.de/geobasis/wms_nw_dtk?REQUEST=GetCapabilities&SERVICE=WMS',
            'version' => '1.3.0',
            // Leer = Layer automatisch aus den GetCapabilities wählen (Sammellayer, farbig, EPSG:25832; wird gemerkt).
            // Zum Festlegen den Namen aus `php bin/wms-layers.php dtk` per Umgebungsvariable setzen.
            'layers' => $env('DTK_WMS_LAYERS', ''),
            'prefer' => 'dtk',
            'license' => 'dl-de/zero-2.0 (BKG-Anteile DTK250/DTK500: dl-de/by-2.0)',
            'attribution' => '© Geobasis NRW, © BKG',
            'verified' => true,
        ],
        'hochwasser' => [
            'label' => 'WMS Hochwasser-Gefahrenkarte NRW (LANUK)',
            'url' => $env('HWGK_WMS_URL', 'https://www.wms.nrw.de/umwelt/wasser/HW_Gefahrenkarte'),
            'capabilities' => 'https://www.wms.nrw.de/umwelt/wasser/HW_Gefahrenkarte?REQUEST=GetCapabilities&SERVICE=WMS',
            'version' => '1.3.0',
            // Layernamen werden aus den GetCapabilities ermittelt (Titel mit HQ100/HQhäufig/HQextrem);
            // per Umgebungsvariable überschreibbar, z. B. HWGK_LAYER_HQ100=…
            'layers' => [
                'hq_haeufig' => $env('HWGK_LAYER_HQHAEUFIG', ''),
                'hq100' => $env('HWGK_LAYER_HQ100', ''),
                'hq_extrem' => $env('HWGK_LAYER_HQEXTREM', ''),
            ],
            'license' => 'dl-de/zero-2.0',
            'attribution' => '© LANUK NRW (Hochwassergefahrenkarten)',
            'verified' => true,
            'note' => 'Quelle: Geodatenkatalog/INSPIRE-Metadaten „WMS Hochwasser-Gefahrenkarte NRW“. Alternativ-URL laut Metadaten: …/umwelt/HW_Gefahrenkarte',
        ],
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
        'interval_s' => (int) $env('WARNINGS_INTERVAL', 300),
        'nina' => [
            // OpenAPI: https://github.com/bundesAPI/nina-api (Server https://warnung.bund.de/api31)
            'base' => $env('NINA_BASE_URL', 'https://warnung.bund.de/api31'),
            'feeds' => ['mowas' => '/mowas/mapData.json', 'dwd' => '/dwd/mapData.json'],
            'geojson' => '/warnings/{id}.geojson',
            'license' => 'Nutzungsbedingungen BBK/NINA; DWD-Warnungen © Deutscher Wetterdienst',
            'attribution' => 'Warnungen: BBK (MoWaS) · Deutscher Wetterdienst',
            'max_details' => 300,
            'verified' => true,
        ],
        'wbi' => [
            // Stationsliste *_stations_list.txt (Latin-1, „;“) und je Station *_recent_<id>_v*.csv.gz mit 7-Tage-Prognose
            'base' => $env('DWD_WBI_URL', 'https://opendata.dwd.de/climate_environment/CDC/derived_germany/fire_danger_index/woodland/forecast/recent/'),
            'state' => 'Nordrhein-Westfalen',
            'license' => 'CC BY 4.0 (Deutscher Wetterdienst)',
            'attribution' => 'Waldbrandgefahrenindex: Deutscher Wetterdienst',
            'radius_km' => 30,
            'verified' => true,
        ],
    ],
    'http' => [
        'timeout' => (int) $env('HTTP_TIMEOUT', 10),
        'user_agent' => $env('HTTP_USER_AGENT', 'KRITIS-Lagekarte-NRW/1.0 (Landesverwaltung NRW)'),
    ],
];
