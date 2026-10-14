<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Geo\TileService;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class MapController
{
    private const LEVELS = ['land', 'regbez', 'kreis', 'gemeinde', 'plz2', 'plz5'];

    public function __construct(private PDO $db, private array $basemaps, private TileService $tiles, private string $cacheDir)
    {
    }

    /** Kartenkonfiguration für den Client: Raster, Ausdehnung, Hintergründe, Quellen. */
    public function config(Request $req, Response $res): Response
    {
        $imports = $this->imports();
        $bms = [];
        foreach ($this->basemaps['basemaps'] as $id => $b) {
            $available = $b['type'] === 'boundaries'
                ? isset($imports['regbez'])
                : ($this->tiles->hasLocalTiles($id) || $this->tiles->upstream($id) !== null);
            $bms[] = ['id' => $id, 'label' => $b['label'], 'type' => $b['type'], 'available' => $available, 'attribution' => $b['attribution']];
        }
        $attr = array_values(array_unique(array_column($imports, 'attribution')));
        return Json::respond($res, [
            'grid' => $this->basemaps['grid'],
            'viewExtent' => $this->basemaps['view_extent'],
            'defaultBasemap' => $this->basemaps['default'],
            'basemaps' => $bms,
            'boundaries' => array_values($imports),
            'attributions' => $attr,
        ]);
    }

    /** GeoJSON einer Grenzebene (WGS84), dateibasiert gecacht, mit ETag. */
    public function boundaries(Request $req, Response $res, array $args): Response
    {
        $level = (string) ($args['level'] ?? '');
        if (!in_array($level, self::LEVELS, true)) {
            throw new HttpException(404, 'not_found', 'Unbekannte Ebene.');
        }
        $imp = $this->imports()[$level] ?? null;
        if (!$imp) {
            return Json::respond($res, ['type' => 'FeatureCollection', 'features' => []])
                ->withHeader('Cache-Control', 'private, no-cache');
        }
        $etag = '"' . $level . '-' . strtotime($imp['importedAt'] . ' UTC') . '"';
        $cached = $res->withHeader('ETag', $etag)->withHeader('Cache-Control', 'private, no-cache');
        if ($req->getHeaderLine('If-None-Match') === $etag) {
            return $cached->withStatus(304);
        }
        $file = sprintf('%s/boundaries-%s-%s.json', $this->cacheDir, $level, trim($etag, '"'));
        if (!is_file($file)) {
            @mkdir($this->cacheDir, 0775, true);
            foreach (glob("{$this->cacheDir}/boundaries-$level-*.json") ?: [] as $old) {
                @unlink($old);
            }
            $st = $this->db->prepare('SELECT code, name, regbez, kreis, ST_AsGeoJSON(geom, 6) AS g FROM boundaries WHERE level = ? ORDER BY code');
            $st->execute([$level]);
            $out = fopen($file . '.tmp', 'wb');
            fwrite($out, '{"type":"FeatureCollection","features":[');
            $first = true;
            while ($r = $st->fetch()) {
                $props = json_encode(['code' => $r['code'], 'name' => $r['name'], 'regbez' => $r['regbez'], 'kreis' => $r['kreis']], JSON_UNESCAPED_UNICODE);
                fwrite($out, ($first ? '' : ',') . '{"type":"Feature","properties":' . $props . ',"geometry":' . $r['g'] . '}');
                $first = false;
            }
            fwrite($out, ']}');
            fclose($out);
            rename($file . '.tmp', $file);
        }
        $cached->getBody()->write((string) file_get_contents($file));
        return $cached->withHeader('Content-Type', 'application/geo+json; charset=utf-8');
    }

    public function tile(Request $req, Response $res, array $args): Response
    {
        foreach (['z', 'x', 'y'] as $k) {
            if (!ctype_digit((string) ($args[$k] ?? ''))) {
                throw new HttpException(404, 'not_found', 'Kachel nicht gefunden.');
            }
        }
        $bytes = $this->tiles->get((string) $args['basemap'], (int) $args['z'], (int) $args['x'], (int) $args['y']);
        if ($bytes === null) {
            return $res->withStatus(404)->withHeader('Cache-Control', 'no-store');
        }
        $res->getBody()->write($bytes);
        return $res->withHeader('Content-Type', 'image/png')->withHeader('Cache-Control', 'private, max-age=604800');
    }

    /** @return array<string,array> */
    private function imports(): array
    {
        $out = [];
        foreach ($this->db->query('SELECT level, source, license, attribution, feature_count, imported_at FROM boundary_imports') as $r) {
            $out[$r['level']] = ['level' => $r['level'], 'source' => $r['source'], 'license' => $r['license'], 'attribution' => $r['attribution'], 'count' => (int) $r['feature_count'], 'importedAt' => $r['imported_at']];
        }
        return $out;
    }
}
