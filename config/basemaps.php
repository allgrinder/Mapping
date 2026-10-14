<?php
declare(strict_types=1);

/**
 * Hintergrundkarten – austauschbar ohne Codeänderung (Offline-first).
 *
 * type "boundaries": wird im Browser aus den lokal gespeicherten Verwaltungsgrenzen gezeichnet – braucht nie Netz.
 * type "tiles":      Kacheln aus storage/tiles/<id>/{z}/{x}/{y}.png. Fehlt eine Kachel und ist `upstream` gesetzt,
 *                    holt der Server sie einmalig (über den ausgehenden Proxy) und legt sie im Cache ab.
 *                    Ohne Internet: Kacheln mit bin/prefetch-tiles.php auf einem anderen Rechner erzeugen und
 *                    das Verzeichnis kopieren – oder ein vorhandenes Kachelpaket im gleichen Raster einspielen.
 */
$env = static fn (string $k, mixed $d = null): mixed => ($v = getenv($k)) === false || $v === '' ? $d : $v;

return [
    // Kachelraster in EPSG:25832, deckt NRW mit Rand ab. Nicht ändern, sobald Kacheln erzeugt wurden.
    'grid' => [
        'srs' => 'EPSG:25832',
        'origin' => [270000, 5850000],
        'extent' => [270000, 5550000, 570000, 5850000],
        'tile_size' => 256,
        'resolutions' => [1171.875, 585.9375, 292.96875, 146.484375, 73.2421875, 36.62109375, 18.310546875, 9.1552734375, 4.57763671875, 2.288818359375, 1.1444091796875, 0.57220458984375],
    ],
    // Sichtbarer/navigierbarer Bereich (NRW + Rand), EPSG:25832
    'view_extent' => [255000, 5545000, 560000, 5850000],
    'default' => $env('BASEMAP_DEFAULT', 'politisch'),
    'basemaps' => [
        'topografisch' => [
            'label' => 'Topografisch',
            'type' => 'tiles',
            'format' => 'png',
            'attribution' => '© Geobasis NRW, © BKG',
            // 'dtk' = fehlende Kacheln beim WMS aus services.php → wms.dtk nachladen; 'none' = nur lokaler Vorrat (kein Netzzugriff)
            'upstream' => ($u = $env('TOPO_UPSTREAM', 'dtk')) === 'none' ? null : $u,
        ],
        'politisch' => [
            'label' => 'Politisch',
            'type' => 'boundaries',
            'attribution' => '© Geobasis NRW',
        ],
    ],
];
