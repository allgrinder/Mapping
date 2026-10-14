<?php
declare(strict_types=1);

namespace Kritis\Geo;

use Kritis\Support\HttpClient;

/** Kachel-Cache im eigenen EPSG:25832-Raster mit optionalem WMS-Nachladen (Offline-first). */
final class TileService
{
    public function __construct(
        private array $basemaps,
        private array $services,
        private string $tileDir,
        private ?HttpClient $http,
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

    public function upstream(string $id): ?array
    {
        $key = $this->basemaps['basemaps'][$id]['upstream'] ?? null;
        $svc = $key ? ($this->services['wms'][$key] ?? null) : null;
        return $svc && !empty($svc['url']) && !empty($svc['layers']) ? $svc : null;
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
