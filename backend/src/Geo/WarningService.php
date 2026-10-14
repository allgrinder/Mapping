<?php
declare(strict_types=1);

namespace Kritis\Geo;

use Kritis\Support\HttpClient;

/**
 * Live-Warnlage: NINA (MoWaS, DWD-Unwetter) und DWD-Waldbrandgefahrenindex.
 * Abruf höchstens im konfigurierten Intervall, Ergebnis als Datei gecacht. Fällt ein Dienst aus,
 * bleibt der letzte erfolgreiche Stand erhalten und der Status zeigt den Fehler (robustes Verhalten).
 */
class WarningService
{
    public const NRW_BBOX = [5.85, 50.32, 9.47, 52.54];
    public const LEVELS = ['Minor' => 1, 'Moderate' => 2, 'Severe' => 3, 'Extreme' => 4];

    public function __construct(private array $cfg, private ?HttpClient $http, private string $cacheDir, private ?\Closure $clock = null)
    {
    }

    private function now(): int
    {
        return $this->clock ? ($this->clock)() : time();
    }

    /** Aktuelle Warnlage (aus dem Cache; aktualisiert bei Bedarf). */
    public function get(bool $forceRefresh = false): array
    {
        $file = $this->cacheDir . '/warnings.json';
        $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        $interval = (int) ($this->cfg['interval_s'] ?? 300);
        if ($forceRefresh || !$data || ($data['checkedAt'] ?? 0) < $this->now() - $interval) {
            $lock = fopen($this->cacheDir . '/warnings.lock', 'c');
            if ($lock && flock($lock, LOCK_EX | LOCK_NB)) {
                $data = $this->refresh($data ?? []);
                @mkdir($this->cacheDir, 0775, true);
                file_put_contents($file . '.tmp', json_encode($data, JSON_UNESCAPED_UNICODE));
                rename($file . '.tmp', $file);
                flock($lock, LOCK_UN);
            }
            if ($lock) {
                fclose($lock);
            }
        }
        return ($data ?? []) + ['intervalS' => $interval];
    }

    private function refresh(array $prev): array
    {
        $out = ['checkedAt' => $this->now(), 'sources' => [], 'warnings' => [], 'wbi' => $prev['wbi'] ?? null];
        $prevBySource = [];
        foreach ($prev['warnings'] ?? [] as $w) {
            $prevBySource[$w['source']][] = $w;
        }
        foreach (($this->cfg['nina']['feeds'] ?? []) as $source => $path) {
            try {
                $list = $this->fetchNina($source, $path);
                $out['warnings'] = [...$out['warnings'], ...$list];
                $out['sources'][$source] = ['status' => 'ok', 'fetchedAt' => $this->now(), 'count' => count($list)];
            } catch (\Throwable $e) {
                $old = $prevBySource[$source] ?? [];
                $out['warnings'] = [...$out['warnings'], ...$old];
                $out['sources'][$source] = ['status' => 'error', 'error' => $e->getMessage(), 'fetchedAt' => $prev['sources'][$source]['fetchedAt'] ?? null, 'count' => count($old), 'stale' => (bool) $old];
            }
        }
        try {
            $out['wbi'] = $this->fetchWbi();
            $out['sources']['wbi'] = ['status' => 'ok', 'fetchedAt' => $this->now(), 'count' => count($out['wbi']['stations'])];
        } catch (\Throwable $e) {
            $out['sources']['wbi'] = ['status' => 'error', 'error' => $e->getMessage(), 'fetchedAt' => $prev['sources']['wbi']['fetchedAt'] ?? null, 'count' => count($out['wbi']['stations'] ?? []), 'stale' => (bool) ($out['wbi'] ?? null)];
        }
        return $out;
    }

    private function getJson(string $url): mixed
    {
        if (!$this->http) {
            throw new \RuntimeException('Kein Netzzugang konfiguriert.');
        }
        $r = $this->http->get($url);
        if ($r['status'] !== 200) {
            throw new \RuntimeException("HTTP {$r['status']}");
        }
        $d = json_decode($r['body'], true);
        if (!is_array($d)) {
            throw new \RuntimeException('Ungültige Antwort.');
        }
        return $d;
    }

    /** @return list<array> Warnungen mit Geometrie, die NRW berühren */
    private function fetchNina(string $source, string $path): array
    {
        $n = $this->cfg['nina'];
        $items = $this->getJson($n['base'] . $path);
        $out = [];
        $details = 0;
        foreach ($items as $it) {
            $id = (string) ($it['id'] ?? '');
            if ($id === '' || !preg_match('/^[A-Za-z0-9._-]{3,200}$/', $id)) {
                continue;
            }
            $version = (string) ($it['version'] ?? '0');
            $cacheFile = $this->cacheDir . '/nina/' . sha1($id . '|' . $version) . '.json';
            if (is_file($cacheFile)) {
                $geo = json_decode((string) file_get_contents($cacheFile), true);
            } else {
                if (++$details > (int) ($n['max_details'] ?? 300)) {
                    break;
                }
                $geo = $this->getJson($n['base'] . str_replace('{id}', rawurlencode($id), $n['geojson']));
                @mkdir(dirname($cacheFile), 0775, true);
                file_put_contents($cacheFile, json_encode($geo));
            }
            $geom = $this->mergeGeometry($geo);
            $bbox = $geom ? GeoUtil::bbox($geom) : null;
            if (!$bbox || !GeoUtil::intersectsBox($bbox, self::NRW_BBOX)) {
                continue;
            }
            $title = $it['i18nTitle']['de'] ?? $it['title'] ?? ($geo['features'][0]['properties']['headline'] ?? 'Warnung');
            $out[] = [
                'id' => $id, 'source' => $source, 'version' => $version,
                'title' => (string) $title, 'severity' => (string) ($it['severity'] ?? ''),
                'level' => self::LEVELS[$it['severity'] ?? ''] ?? 0,
                'type' => (string) ($it['type'] ?? ''),
                'start' => $it['startDate'] ?? null, 'end' => $it['expiresDate'] ?? null,
                'bbox' => $bbox, 'geometry' => $geom,
            ];
        }
        return $out;
    }

    /** NINA liefert eine FeatureCollection; Flächen zu einer Geometrie zusammenfassen. */
    private function mergeGeometry(mixed $geo): ?array
    {
        if (!is_array($geo)) {
            return null;
        }
        $feats = ($geo['type'] ?? '') === 'FeatureCollection' ? ($geo['features'] ?? []) : [$geo];
        $polys = [];
        foreach ($feats as $f) {
            $g = $f['geometry'] ?? (isset($f['coordinates']) ? $f : null);
            if (!$g) {
                continue;
            }
            if ($g['type'] === 'Polygon') {
                $polys[] = $g['coordinates'];
            } elseif ($g['type'] === 'MultiPolygon') {
                array_push($polys, ...$g['coordinates']);
            } elseif ($g['type'] === 'GeometryCollection') {
                foreach ($g['geometries'] as $gg) {
                    if ($gg['type'] === 'Polygon') {
                        $polys[] = $gg['coordinates'];
                    } elseif ($gg['type'] === 'MultiPolygon') {
                        array_push($polys, ...$gg['coordinates']);
                    }
                }
            }
        }
        return $polys ? ['type' => 'MultiPolygon', 'coordinates' => $polys] : null;
    }

    /** Waldbrandgefahrenindex (heutiger Wert) aller NRW-Stationen. */
    private function fetchWbi(): array
    {
        $w = $this->cfg['wbi'];
        if (!$this->http) {
            throw new \RuntimeException('Kein Netzzugang konfiguriert.');
        }
        $index = $this->http->get($w['base']);
        if ($index['status'] !== 200) {
            throw new \RuntimeException("HTTP {$index['status']}");
        }
        preg_match_all('/href="([^"]+)"/i', $index['body'], $m);
        $hrefs = array_map(fn ($h) => basename($h), $m[1]);
        $listFile = current(array_filter($hrefs, fn ($h) => str_ends_with($h, '_stations_list.txt')));
        if (!$listFile) {
            throw new \RuntimeException('Stationsliste nicht gefunden.');
        }
        $list = $this->http->get($w['base'] . $listFile);
        $stations = self::parseStationList($list['body'], $w['state'] ?? 'Nordrhein-Westfalen');
        $files = [];
        foreach ($hrefs as $h) {
            if (preg_match('/_recent_(\d+)_v[\d.\-]+\.csv\.gz$/', $h, $mm) && isset($stations[(int) $mm[1]])) {
                $files[(int) $mm[1]] = $h;
            }
        }
        $out = [];
        foreach ($files as $sid => $file) {
            $r = $this->http->get($w['base'] . $file);
            if ($r['status'] !== 200) {
                continue;
            }
            $vals = self::parseStationCsv((string) @gzdecode($r['body']));
            if ($vals) {
                $out[] = $stations[$sid] + ['forecast' => $vals, 'today' => $vals[0]];
            }
        }
        if (!$out) {
            throw new \RuntimeException('Keine Stationswerte für NRW.');
        }
        return ['stations' => $out, 'max' => max(array_column($out, 'today'))];
    }

    /** @return array<int,array{id:int,name:string,lat:float,lon:float}> */
    public static function parseStationList(string $raw, string $state): array
    {
        $text = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
        $out = [];
        foreach (preg_split('/\r?\n/', $text) as $line) {
            $p = array_map('trim', explode(';', $line));
            if (count($p) < 6 || !ctype_digit($p[0]) || $p[5] !== $state) {
                continue;
            }
            $out[(int) $p[0]] = ['id' => (int) $p[0], 'name' => $p[4], 'lat' => (float) $p[2], 'lon' => (float) $p[3]];
        }
        return $out;
    }

    /** Letzte Zeile: Station;Datum;Tag0..Tag6 → Liste der Stufen (1–5). */
    public static function parseStationCsv(string $text): array
    {
        $rows = array_values(array_filter(array_map(fn ($l) => str_getcsv($l, ';'), preg_split('/\r?\n/', trim($text))), fn ($r) => count($r) >= 3 && !preg_match('/^station/i', trim($r[0]))));
        if (!$rows) {
            return [];
        }
        $row = end($rows);
        $vals = [];
        foreach (array_slice($row, 2, 7) as $v) {
            $v = trim($v);
            if ($v === '' || $v === '-999' || $v === '-99' || !is_numeric($v)) {
                continue;
            }
            $vals[] = max(1, min(5, (int) round((float) $v)));
        }
        return $vals;
    }
}
