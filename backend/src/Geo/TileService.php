<?php
declare(strict_types=1);

namespace Kritis\Geo;

use Kritis\Support\HttpClient;

/**
 * Kachel-Cache im eigenen EPSG:25832-Raster mit optionalem WMS-Nachladen (Offline-first).
 * Vorhandene Kacheln werden immer zuerst geliefert; nur fehlende werden – falls Netz da ist – beim Dienst geholt und dauerhaft abgelegt.
 * Ist kein Layername konfiguriert, wird er aus den GetCapabilities des Dienstes ermittelt und gemerkt.
 */
final class TileService
{
    private const LAYER_TTL_OK = 30 * 86400;
    private const LAYER_TTL_FAIL = 3600;

    /** @var array<string,?string> */
    private array $layerMemo = [];

    public function __construct(
        private array $basemaps,
        private array $services,
        private string $tileDir,
        private ?HttpClient $http,
        private string $cacheDir = '',
    ) {
    }

    public function isTileBasemap(string $id): bool
    {
        return ($this->basemaps['basemaps'][$id]['type'] ?? null) === 'tiles';
    }

    public function path(string $id, int $z, int $x, int $y): string
    {
        return sprintf('%s/%s/%d/%d/%d.%s', $this->tileDir, $id, $z, $x, $y, $this->basemaps['basemaps'][$id]['format'] ?? 'png');
    }

    public function inGrid(int $z, int $x, int $y): bool
    {
        $g = $this->basemaps['grid'];
        if ($z < 0 || $z >= count($g['resolutions']) || $x < 0 || $y < 0) {
            return false;
        }
        $span = $g['resolutions'][$z] * $g['tile_size'];
        return $x < ceil(($g['extent'][2] - $g['extent'][0]) / $span) && $y < ceil(($g['extent'][3] - $g['extent'][1]) / $span);
    }

    /** @return array{float,float,float,float} */
    public function bbox(int $z, int $x, int $y): array
    {
        $g = $this->basemaps['grid'];
        $span = $g['resolutions'][$z] * $g['tile_size'];
        $minx = $g['origin'][0] + $x * $span;
        $maxy = $g['origin'][1] - $y * $span;
        return [$minx, $maxy - $span, $minx + $span, $maxy];
    }

    /** WMS-Quelle mit aufgelöstem Layernamen, oder null (keine Quelle bzw. Layer unbekannt und nicht ermittelbar). */
    public function upstream(string $id): ?array
    {
        $key = $this->basemaps['basemaps'][$id]['upstream'] ?? null;
        $svc = $key ? ($this->services['wms'][$key] ?? null) : null;
        if (!$svc || empty($svc['url'])) {
            return null;
        }
        if (empty($svc['layers'])) {
            $svc['layers'] = $this->discoveredLayer((string) $key, $svc);
            $svc['layersDiscovered'] = true;
        }
        return empty($svc['layers']) ? null : $svc;
    }

    /**
     * Layername aus den GetCapabilities (Ergebnis 30 Tage gemerkt; bei Ausfall bleibt ein früheres Ergebnis gültig,
     * ein Fehlschlag ohne früheres Ergebnis wird eine Stunde gemerkt, damit nicht jede Anfrage auf den Dienst wartet).
     */
    public function discoveredLayer(string $key, array $svc, bool $force = false): ?string
    {
        if (array_key_exists($key, $this->layerMemo) && !$force) {
            return $this->layerMemo[$key];
        }
        $file = $this->cacheDir !== '' ? $this->cacheDir . "/wms-$key-layer.json" : null;
        $cached = $file && is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
        $age = time() - (int) ($cached['checkedAt'] ?? 0);
        if (!$force && (($cached['layer'] ?? null) ? $age < self::LAYER_TTL_OK : ($cached !== [] && $age < self::LAYER_TTL_FAIL))) {
            return $this->layerMemo[$key] = $cached['layer'] ?? null;
        }
        $layer = null;
        $error = null;
        if ($this->http) {
            try {
                $r = $this->http->get($svc['url'] . '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=' . ($svc['version'] ?? '1.3.0'));
                $r['status'] === 200 ? $layer = self::pickMapLayer($r['body'], (string) ($this->services['wms'][$key]['prefer'] ?? '')) : $error = "HTTP {$r['status']}";
                if ($r['status'] === 200 && $layer === null) {
                    $error = 'Kein passender Layer in den GetCapabilities gefunden.';
                }
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        } else {
            $error = 'Kein HTTP-Client.';
        }
        if ($layer === null && ($cached['layer'] ?? null)) {
            $layer = $cached['layer']; // Dienst gerade nicht erreichbar → letztes bekanntes Ergebnis weiter nutzen
        }
        if ($file) {
            @mkdir(dirname($file), 0775, true);
            file_put_contents($file, json_encode(['layer' => $layer, 'checkedAt' => time(), 'error' => $error], JSON_UNESCAPED_UNICODE));
        }
        return $this->layerMemo[$key] = $layer;
    }

    /**
     * Wählt aus WMS-GetCapabilities den Layer für eine Hintergrundkarte: benannt, in EPSG:25832 abrufbar,
     * bevorzugt ein Sammellayer (maßstabsabhängige Unterlayer) – aber nur, wenn darunter keine Blattschnitte,
     * Beschriftungs-, Grenz- oder Graustufenlayer hängen –, farbig statt grau, möglichst weit oben in der Hierarchie.
     * $prefer (Text) bevorzugt zusätzlich Layer, deren Name/Titel ihn enthält (z. B. „dtk“).
     * @return ?string Layername oder null
     */
    public static function pickMapLayer(string $xml, string $prefer = ''): ?string
    {
        $prev = libxml_use_internal_errors(true);
        $doc = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOCDATA);
        libxml_use_internal_errors($prev);
        if ($doc === false) {
            return null;
        }
        $nonMap = '/blattschnitt|blattindex|blatt[ _-]?index|kachel|metadat|legende|beschriftung|grenze|gitter|raster[ _-]?netz|(^|[^a-z])grid([^a-z]|$)/u';
        $gray = '/(^|[^a-z])(sw|grau|grey|gray|pan)([^a-z]|$)|graustufen|schwarz[ _-]?weiß|schwarz[ _-]?weiss/u';
        $candidates = [];
        // liefert true, wenn der Teilbaum nur „saubere“ Kartenlayer enthält
        $walk = function (\SimpleXMLElement $layer, int $depth, array $crs) use (&$walk, &$candidates, $nonMap, $gray, $prefer): bool {
            foreach ($layer->xpath('./*[local-name()="CRS" or local-name()="SRS"]') ?: [] as $c) {
                $crs[] = strtoupper(trim((string) $c));
            }
            $name = trim((string) ($layer->xpath('./*[local-name()="Name"]')[0] ?? ''));
            $title = trim((string) ($layer->xpath('./*[local-name()="Title"]')[0] ?? ''));
            $text = mb_strtolower("$name $title");
            $clean = !preg_match($nonMap, $text) && !preg_match($gray, $text);
            $children = $layer->xpath('./*[local-name()="Layer"]') ?: [];
            $childrenClean = true;
            foreach ($children as $c) {
                $childrenClean = $walk($c, $depth + 1, $crs) && $childrenClean;
            }
            if ($name !== '' && $clean && ($crs === [] || in_array('EPSG:25832', $crs, true))) {
                $composite = $children !== [];
                if (!$composite || $childrenClean) {
                    $candidates[] = [
                        ($composite ? 4 : 0) + ($prefer !== '' && str_contains($text, mb_strtolower($prefer)) ? 3 : 0)
                            + (preg_match('/farb|colou?r|(^|[^a-z])col([^a-z]|$)/u', $text) ? 1 : 0) - $depth,
                        count($candidates), $name,
                    ];
                }
            }
            return $clean && $childrenClean;
        };
        foreach ($doc->xpath('//*[local-name()="Capability"]/*[local-name()="Layer"]') ?: [] as $root) {
            $walk($root, 0, []);
        }
        if (!$candidates) {
            return null;
        }
        usort($candidates, fn ($a, $b) => [$b[0], $a[1]] <=> [$a[0], $b[1]]); // höchste Wertung, bei Gleichstand Dokumentreihenfolge
        return $candidates[0][2];
    }

    public function hasLocalTiles(string $id): bool
    {
        return is_dir($this->tileDir . '/' . $id) && (glob($this->tileDir . '/' . $id . '/*', GLOB_ONLYDIR) ?: []) !== [];
    }

    /** Liefert Kachelbytes oder null (nicht vorhanden und nicht nachladbar). */
    public function get(string $id, int $z, int $x, int $y, bool $allowFetch = true): ?string
    {
        if (!$this->isTileBasemap($id) || !$this->inGrid($z, $x, $y)) {
            return null;
        }
        $file = $this->path($id, $z, $x, $y);
        if (is_file($file)) {
            return (string) file_get_contents($file);
        }
        $svc = $this->upstream($id);
        if (!$allowFetch || !$svc || !$this->http) {
            return null;
        }
        $size = $this->basemaps['grid']['tile_size'];
        $url = $svc['url'] . '?' . http_build_query([
            'SERVICE' => 'WMS', 'VERSION' => $svc['version'] ?? '1.3.0', 'REQUEST' => 'GetMap',
            'LAYERS' => $svc['layers'], 'STYLES' => '', 'CRS' => 'EPSG:25832',
            'BBOX' => implode(',', $this->bbox($z, $x, $y)), 'WIDTH' => $size, 'HEIGHT' => $size,
            'FORMAT' => 'image/png', 'TRANSPARENT' => 'FALSE',
        ]);
        try {
            $res = $this->http->get($url);
        } catch (\Throwable) {
            return null;
        }
        if ($res['status'] !== 200 || !str_starts_with($res['contentType'], 'image/') || !str_starts_with($res['body'], "\x89PNG")) {
            return null;
        }
        @mkdir(dirname($file), 0775, true);
        file_put_contents($file . '.tmp', $res['body']);
        rename($file . '.tmp', $file);
        return $res['body'];
    }
}
