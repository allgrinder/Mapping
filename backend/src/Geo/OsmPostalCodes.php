<?php
declare(strict_types=1);

namespace Kritis\Geo;

use Kritis\Support\HttpClient;

/**
 * PLZ-Gebiete (5-stellig) aus OpenStreetMap über die Overpass API: Relationen boundary=postal_code in NRW.
 * Die Grenzlinien (Ways) werden zu Ringen zusammengesetzt, Löcher den äußeren Ringen zugeordnet und als GeoJSON
 * (Properties plz, note) ausgegeben – im selben Format, das BoundaryImporter::importPlz() einliest.
 * Lizenz: ODbL – © OpenStreetMap-Mitwirkende. Nicht amtlich.
 */
final class OsmPostalCodes
{
    /** Relationen als ID-Liste, Ways einmal mit Geometrie (gemeinsame Grenzen nicht doppelt übertragen). */
    public const QUERY = '[out:json][timeout:900][maxsize:2000000000];'
        . 'area["ISO3166-2"="DE-NW"]["boundary"="administrative"]->.nrw;'
        . 'relation["boundary"="postal_code"](area.nrw)->.r;'
        . '.r out body;way(r.r);out geom;';

    public function __construct(private array $svc, private ?HttpClient $http)
    {
    }

    /** @return array{geojson:array, osmBase:?string} */
    public function fetch(): array
    {
        if (!$this->http || empty($this->svc['overpass_url'])) {
            throw new \RuntimeException('Kein Overpass-Dienst konfiguriert.');
        }
        $r = $this->http->get($this->svc['overpass_url'] . '?data=' . rawurlencode(self::QUERY));
        if ($r['status'] !== 200) {
            throw new \RuntimeException("Overpass: HTTP {$r['status']}" . ($r['status'] === 429 ? ' (zu viele Anfragen – später erneut)' : ''));
        }
        return self::fromOverpassJson($r['body']);
    }

    /** @return array{geojson:array, osmBase:?string} */
    public static function fromOverpassJson(string $json): array
    {
        $d = json_decode($json, true, 64);
        unset($json);
        if (!is_array($d) || !isset($d['elements']) || !is_array($d['elements'])) {
            throw new \RuntimeException('Overpass: unerwartete Antwort.');
        }
        $ways = [];
        $rels = [];
        foreach ($d['elements'] as $e) {
            if (($e['type'] ?? '') === 'way' && isset($e['geometry'], $e['nodes'])) {
                $ways[$e['id']] = ['nodes' => $e['nodes'], 'coords' => array_map(fn ($p) => [round((float) $p['lon'], 7), round((float) $p['lat'], 7)], $e['geometry'])];
            } elseif (($e['type'] ?? '') === 'relation') {
                $rels[] = $e;
            }
        }
        $features = [];
        foreach ($rels as $rel) {
            $tags = $rel['tags'] ?? [];
            $plz = trim((string) ($tags['postal_code'] ?? ''));
            if (!preg_match('/^\d{5}$/', $plz)) {
                continue;
            }
            $outer = $inner = [];
            foreach ($rel['members'] ?? [] as $m) {
                if (($m['type'] ?? '') === 'way' && isset($ways[$m['ref']])) {
                    ($m['role'] ?? '') === 'inner' ? $inner[] = $ways[$m['ref']] : $outer[] = $ways[$m['ref']];
                }
            }
            $polys = self::polygons(self::rings($outer), self::rings($inner));
            if (!$polys) {
                continue;
            }
            $features[] = ['type' => 'Feature', 'properties' => ['plz' => $plz, 'note' => (string) ($tags['note'] ?? $tags['name'] ?? '')],
                'geometry' => count($polys) === 1 ? ['type' => 'Polygon', 'coordinates' => $polys[0]] : ['type' => 'MultiPolygon', 'coordinates' => $polys]];
        }
        return ['geojson' => ['type' => 'FeatureCollection', 'features' => $features], 'osmBase' => $d['osm3s']['timestamp_osm_base'] ?? null];
    }

    /**
     * Setzt Ways über gemeinsame Endknoten zu geschlossenen Ringen zusammen (ggf. umgedreht). Nicht schließbare Reste entfallen.
     * @param list<array{nodes:list<int>,coords:list<array{float,float}>}> $ways
     * @return list<list<array{float,float}>>
     */
    public static function rings(array $ways): array
    {
        $rings = [];
        $pool = array_values(array_filter($ways, fn ($w) => count($w['nodes']) >= 2));
        while ($pool) {
            $cur = array_shift($pool);
            $nodes = $cur['nodes'];
            $coords = $cur['coords'];
            $guard = 0;
            while ($nodes[0] !== end($nodes) && $guard++ < 100000) {
                $last = end($nodes);
                $found = false;
                foreach ($pool as $i => $w) {
                    if ($w['nodes'][0] === $last) {
                        $add = $w;
                    } elseif (end($w['nodes']) === $last) {
                        $add = ['nodes' => array_reverse($w['nodes']), 'coords' => array_reverse($w['coords'])];
                    } else {
                        continue;
                    }
                    array_pop($nodes);
                    array_pop($coords);
                    $nodes = [...$nodes, ...$add['nodes']];
                    $coords = [...$coords, ...$add['coords']];
                    unset($pool[$i]);
                    $found = true;
                    break;
                }
                if (!$found) {
                    break;
                }
            }
            if ($nodes[0] === end($nodes) && count($nodes) >= 4) {
                $rings[] = $coords;
            }
        }
        return $rings;
    }

    /** Ordnet jeden inneren Ring dem äußeren Ring zu, der ihn enthält. @return list<list<list<array{float,float}>>> */
    public static function polygons(array $outer, array $inner): array
    {
        $polys = array_map(fn ($r) => [$r], $outer);
        foreach ($inner as $hole) {
            foreach ($polys as $i => $p) {
                if (ShapefileReader::pointInRing($hole[0], $p[0])) {
                    $polys[$i][] = $hole;
                    break;
                }
            }
        }
        return $polys;
    }
}
