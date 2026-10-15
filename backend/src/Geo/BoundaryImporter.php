<?php
declare(strict_types=1);

namespace Kritis\Geo;

use PDO;
use RuntimeException;

/** Importiert Verwaltungsgrenzen (DVG-Shapefiles) und PLZ-Gebiete (GeoJSON) nach MariaDB in WGS84. */
final class BoundaryImporter
{
    private const CODE_LEN = ['land' => 2, 'regbez' => 3, 'kreis' => 5, 'gemeinde' => 8];

    /** @var callable(string):void */
    private $log;

    public function __construct(private PDO $db, private array $config, ?callable $log = null)
    {
        $this->log = $log ?? static fn (string $m) => null;
    }

    /** @return array<string,int> importierte Anzahl je Ebene */
    public function importDvg(string $path): array
    {
        $cfg = $this->config['dvg'];
        [$dir, $cleanup] = $this->unpack($path);
        try {
            $files = $this->findFiles($dir, $cfg['files']);
            foreach (['regbez', 'kreis', 'gemeinde'] as $required) {
                if (!isset($files[$required])) {
                    throw new RuntimeException("Im DVG-Paket fehlt die Datei für Ebene „{$required}“.");
                }
            }
            $result = [];
            foreach ($files as $level => $file) {
                $rows = [];
                foreach (ShapefileReader::read($file) as $f) {
                    $p = $f['properties'];
                    if (!array_key_exists($cfg['code_field'], $p) || !array_key_exists($cfg['name_field'], $p)) {
                        throw new RuntimeException(sprintf('Feld %s/%s fehlt in %s. Vorhanden: %s', $cfg['code_field'], $cfg['name_field'], basename($file), implode(', ', array_keys($p))));
                    }
                    $code = self::normalizeCode((string) $p[$cfg['code_field']], $level);
                    $geom = $f['geometry'];
                    if ($cfg['srs'] === 25832) {
                        $geom = Simplify::geometry($geom, (float) $cfg['simplify_m']);
                        $geom = Utm32::geometryToWgs84($geom);
                    }
                    $rows[$code] = [
                        'code' => $code,
                        'name' => trim((string) $p[$cfg['name_field']]),
                        'regbez' => in_array($level, ['kreis', 'gemeinde'], true) ? substr($code, 0, 3) : null,
                        'kreis' => $level === 'gemeinde' ? substr($code, 0, 5) : null,
                        'geom' => $geom,
                    ];
                }
                $this->replaceLevel($level, array_values($rows), $cfg);
                $result[$level] = count($rows);
                ($this->log)(sprintf('%-8s %4d Gebiete importiert', $level, count($rows)));
            }
            if (!isset($files['land'])) {
                $this->deriveLand($cfg);
                $result['land'] = 1;
            }
            return $result;
        } finally {
            $cleanup();
        }
    }

    /** @return array<string,int> */
    /** @param ?string $source Herkunftsangabe (z. B. mit Datenstand); sonst aus config/boundaries.php */
    public function importPlz(string $plz5File, ?string $plz2File = null, ?string $source = null): array
    {
        $cfg = $this->config['plz'];
        if ($source !== null) {
            $cfg['source'] = $source;
        }
        if (!$this->db->query("SELECT 1 FROM boundaries WHERE level = 'land' LIMIT 1")->fetchColumn()) {
            throw new RuntimeException('Bitte zuerst die Verwaltungsgrenzen (DVG) importieren – sie werden zum Zuschnitt auf NRW benötigt.');
        }
        $result = ['plz5' => $this->importPlzFile($plz5File, 'plz5', 5, $cfg)];
        if ($plz2File !== null) {
            $result['plz2'] = $this->importPlzFile($plz2File, 'plz2', 2, $cfg);
        } else {
            $result['plz2'] = $this->derivePlz2($cfg);
        }
        foreach ($result as $l => $n) {
            ($this->log)(sprintf('%-8s %4d Gebiete importiert', $l, $n));
        }
        return $result;
    }

    private function importPlzFile(string $file, string $level, int $len, array $cfg): int
    {
        ini_set('memory_limit', '2G');
        $data = json_decode((string) @file_get_contents($file), true);
        if (!is_array($data) || ($data['type'] ?? '') !== 'FeatureCollection') {
            throw new RuntimeException("Keine GeoJSON-FeatureCollection: $file");
        }
        // NRW-Ausdehnung (WGS84) mit Rand – grober Vorfilter vor dem exakten Zuschnitt in der Datenbank
        $bbox = [5.7, 50.2, 9.6, 52.6];
        $groups = [];
        foreach ($data['features'] as $f) {
            $p = $f['properties'] ?? [];
            $code = null;
            foreach ($cfg['code_fields'] as $k) {
                if (isset($p[$k]) && $p[$k] !== '') { $code = (string) $p[$k]; break; }
            }
            if ($code === null || !preg_match('/^\d{' . $len . '}$/', $code = str_pad($code, $len, '0', STR_PAD_LEFT)) || !isset($f['geometry']['type'])) {
                continue;
            }
            $geom = $f['geometry'];
            if (!in_array($geom['type'], ['Polygon', 'MultiPolygon'], true)) {
                continue;
            }
            $first = $geom['type'] === 'Polygon' ? $geom['coordinates'][0][0] : $geom['coordinates'][0][0][0];
            $isUtm = abs((float) $first[0]) > 180;
            if ($isUtm) {
                $geom = Utm32::geometryToWgs84($geom);
            }
            if (!$this->bboxIntersects($geom, $bbox)) {
                continue;
            }
            $utm = Simplify::geometry(Utm32::geometryToUtm($geom), (float) $cfg['simplify_m']);
            $geom = Utm32::geometryToWgs84($utm);
            if ($geom['coordinates'] === []) {
                continue;
            }
            $name = '';
            foreach ($cfg['name_fields'] as $k) {
                if (!empty($p[$k])) { $name = trim(preg_replace('/^\d+\s*/', '', (string) $p[$k])); break; }
            }
            $polys = $geom['type'] === 'Polygon' ? [$geom['coordinates']] : $geom['coordinates'];
            $groups[$code] ??= ['name' => $name, 'polys' => []];
            array_push($groups[$code]['polys'], ...$polys);
        }
        $rows = [];
        foreach ($groups as $code => $g) {
            $rows[] = ['code' => (string) $code, 'name' => $g['name'] ?: (string) $code, 'regbez' => null, 'kreis' => null,
                'geom' => count($g['polys']) === 1 ? ['type' => 'Polygon', 'coordinates' => $g['polys'][0]] : ['type' => 'MultiPolygon', 'coordinates' => $g['polys']]];
        }
        $this->replaceLevel($level, $rows, $cfg);
        // exakter Zuschnitt: nur Gebiete, die NRW berühren
        $this->db->exec("DELETE b FROM boundaries b JOIN boundaries l ON l.level = 'land'
            WHERE b.level = '$level' AND NOT (MBRIntersects(b.geom, l.geom) AND ST_Intersects(b.geom, l.geom))");
        $n = (int) $this->db->query("SELECT COUNT(*) FROM boundaries WHERE level = '$level'")->fetchColumn();
        $this->recordImport($level, $cfg, $n);
        return $n;
    }

    /** PLZ-Leitregionen (2-stellig) durch Vereinigung der 5-stelligen Gebiete. */
    private function derivePlz2(array $cfg): int
    {
        $prefixes = $this->db->query("SELECT DISTINCT LEFT(code, 2) FROM boundaries WHERE level = 'plz5' ORDER BY 1")->fetchAll(PDO::FETCH_COLUMN);
        $this->db->beginTransaction();
        $this->db->exec("DELETE FROM boundaries WHERE level = 'plz2'");
        $sel = $this->db->prepare("SELECT id FROM boundaries WHERE level = 'plz5' AND code LIKE ? ORDER BY code");
        foreach ($prefixes as $pre) {
            $sel->execute([$pre . '%']);
            $ids = $sel->fetchAll(PDO::FETCH_COLUMN);
            $this->db->prepare("SET @u = (SELECT geom FROM boundaries WHERE id = ?)")->execute([array_shift($ids)]);
            $step = $this->db->prepare("SET @u = ST_Union(@u, (SELECT geom FROM boundaries WHERE id = ?))");
            foreach ($ids as $id) {
                $step->execute([$id]);
            }
            $this->db->prepare("INSERT INTO boundaries (level, code, name, geom, source, license) VALUES ('plz2', ?, ?, @u, ?, ?)")
                ->execute([$pre, 'PLZ-Region ' . $pre, $cfg['source'], $cfg['license']]);
        }
        $this->db->commit();
        $this->recordImport('plz2', $cfg, count($prefixes));
        return count($prefixes);
    }

    private function deriveLand(array $cfg): void
    {
        $ids = $this->db->query("SELECT id FROM boundaries WHERE level = 'regbez' ORDER BY code")->fetchAll(PDO::FETCH_COLUMN);
        $this->db->prepare('SET @u = (SELECT geom FROM boundaries WHERE id = ?)')->execute([array_shift($ids)]);
        foreach ($ids as $id) {
            $this->db->prepare('SET @u = ST_Union(@u, (SELECT geom FROM boundaries WHERE id = ?))')->execute([$id]);
        }
        $this->db->exec("DELETE FROM boundaries WHERE level = 'land'");
        $this->db->prepare("INSERT INTO boundaries (level, code, name, geom, source, license) VALUES ('land', '05', 'Nordrhein-Westfalen', @u, ?, ?)")
            ->execute([$cfg['source'], $cfg['license']]);
        $this->recordImport('land', $cfg, 1);
    }

    private function replaceLevel(string $level, array $rows, array $cfg): void
    {
        $this->db->beginTransaction();
        try {
            $this->db->prepare('DELETE FROM boundaries WHERE level = ?')->execute([$level]);
            $ins = $this->db->prepare('INSERT INTO boundaries (level, code, name, regbez, kreis, geom, source, license) VALUES (?,?,?,?,?, ST_GeomFromText(?),?,?)');
            foreach ($rows as $r) {
                $ins->execute([$level, $r['code'], mb_substr($r['name'], 0, 160), $r['regbez'], $r['kreis'], Wkt::fromGeoJson($r['geom']), $cfg['source'], $cfg['license']]);
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
        $this->recordImport($level, $cfg, count($rows));
    }

    private function recordImport(string $level, array $cfg, int $n): void
    {
        $this->db->prepare('REPLACE INTO boundary_imports (level, source, license, attribution, feature_count, imported_at) VALUES (?,?,?,?,?, UTC_TIMESTAMP())')
            ->execute([$level, $cfg['source'], $cfg['license'], $cfg['attribution'], $n]);
    }

    /** Schlüssel auf AGS-Länge der Ebene kürzen (DVG-KN ist ggf. mit Nullen aufgefüllt). */
    public static function normalizeCode(string $raw, string $level): string
    {
        $digits = preg_replace('/\D/', '', $raw);
        $len = self::CODE_LEN[$level];
        if (strlen($digits) < $len || !str_starts_with($digits, '05')) {
            throw new RuntimeException("Unerwarteter Gebietsschlüssel „{$raw}“ für Ebene $level (erwartet NRW-Schlüssel mit 05…).");
        }
        return substr($digits, 0, $len);
    }

    private function bboxIntersects(array $geom, array $b): bool
    {
        $minX = $minY = INF; $maxX = $maxY = -INF;
        Utm32::mapCoords($geom['coordinates'], function ($x, $y) use (&$minX, &$minY, &$maxX, &$maxY) {
            $minX = min($minX, $x); $maxX = max($maxX, $x); $minY = min($minY, $y); $maxY = max($maxY, $y);
            return [$x, $y];
        });
        return $minX <= $b[2] && $maxX >= $b[0] && $minY <= $b[3] && $maxY >= $b[1];
    }

    /** @return array{string, callable} */
    private function unpack(string $path): array
    {
        if (is_dir($path)) {
            return [$path, static fn () => null];
        }
        if (!is_file($path) || !str_ends_with(strtolower($path), '.zip')) {
            throw new RuntimeException("Pfad ist weder Verzeichnis noch ZIP-Datei: $path");
        }
        $tmp = sys_get_temp_dir() . '/kritis-dvg-' . bin2hex(random_bytes(4));
        $files = \Kritis\Support\ZipReader::read($path, fn (string $n) => (bool) preg_match('/\.(shp|shx|dbf|cpg|prj)$/i', $n) && !str_contains($n, '..'));
        mkdir($tmp, 0700, true);
        foreach ($files as $name => $data) {
            file_put_contents($tmp . '/' . basename($name), $data);
        }
        return [$tmp, static function () use ($tmp) {
            array_map('unlink', glob("$tmp/*") ?: []);
            @rmdir($tmp);
        }];
    }

    /** @return array<string,string> */
    private function findFiles(string $dir, array $patterns): array
    {
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
        $found = [];
        foreach ($it as $f) {
            foreach ($patterns as $level => $re) {
                if (!isset($found[$level]) && preg_match($re, $f->getFilename())) {
                    $found[$level] = $f->getPathname();
                }
            }
        }
        return $found;
    }
}
