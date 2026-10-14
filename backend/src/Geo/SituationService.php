<?php
declare(strict_types=1);

namespace Kritis\Geo;

use Kritis\Controller\FacilityController;
use Kritis\Support\HttpException;
use PDO;

/**
 * Lagemodus: Ereignisgebiet bilden (Fläche, Kreis um Punkt, Verwaltungs-/PLZ-Gebiet), optional puffern
 * und betroffene Einrichtungen räumlich ermitteln (ST_Intersects mit Spatial Index).
 * Puffer werden metrisch in EPSG:25832 berechnet (ST_Buffer auf UTM-Koordinaten), Projektion in PHP.
 */
final class SituationService
{
    public const MAX_VERTICES = 1000;
    public const MAX_BUFFER_M = 50000;
    public const MAX_RADIUS_M = 100000;
    public const MAX_AREAS = 60;
    private const LEVELS = ['regbez', 'kreis', 'gemeinde', 'plz2', 'plz5'];

    public function __construct(private PDO $db)
    {
    }

    /** @return array{definition:array, area:array, label:string} normalisierte Definition + Gebiet (GeoJSON WGS84) */
    public function buildArea(mixed $def): array
    {
        if (!is_array($def) || !is_string($def['type'] ?? null)) {
            throw $this->invalid('definition', 'Bitte ein Ereignisgebiet festlegen.');
        }
        switch ($def['type']) {
            case 'polygon':
                $ring = $def['coordinates'] ?? null;
                if (!is_array($ring) || !array_is_list($ring) || count($ring) < 3 || count($ring) > self::MAX_VERTICES) {
                    throw $this->invalid('definition', 'Die Fläche braucht mindestens drei Eckpunkte.');
                }
                $pts = [];
                foreach ($ring as $p) {
                    $pts[] = $this->lonLat($p);
                }
                if ($pts[0] !== $pts[count($pts) - 1]) {
                    $pts[] = $pts[0];
                }
                if (count($pts) < 4) {
                    throw $this->invalid('definition', 'Die Fläche braucht mindestens drei Eckpunkte.');
                }
                $utm = array_map(fn ($p) => Utm32::forward($p[0], $p[1]), $pts);
                if (Simplify::area($utm) < 1) {
                    throw $this->invalid('definition', 'Die Fläche ist zu klein.');
                }
                if (self::selfIntersects($utm)) {
                    throw $this->invalid('definition', 'Die Fläche überschneidet sich selbst. Bitte neu zeichnen.');
                }
                return ['definition' => ['type' => 'polygon', 'coordinates' => $pts], 'area' => ['type' => 'Polygon', 'coordinates' => [$pts]], 'label' => 'Gezeichnete Fläche'];
            case 'circle':
                [$lon, $lat] = $this->lonLat($def['center'] ?? null);
                $r = $def['radiusM'] ?? null;
                if (!is_int($r) && !is_float($r) || $r < 50 || $r > self::MAX_RADIUS_M) {
                    throw $this->invalid('radiusM', 'Der Radius muss zwischen 50 m und 100 km liegen.');
                }
                [$e, $n] = Utm32::forward($lon, $lat);
                $ring = [];
                for ($i = 0; $i <= 72; $i++) {
                    $a = 2 * M_PI * ($i % 72) / 72;
                    $ring[] = array_map(fn ($v) => round($v, 7), Utm32::inverse($e + $r * cos($a), $n + $r * sin($a)));
                }
                return ['definition' => ['type' => 'circle', 'center' => [$lon, $lat], 'radiusM' => (float) $r], 'area' => ['type' => 'Polygon', 'coordinates' => [$ring]], 'label' => sprintf('Radius %s km', rtrim(rtrim(number_format($r / 1000, 1, ',', ''), '0'), ','))];
            case 'boundary':
                // ein oder mehrere Gebiete derselben Ebene; mehrere werden zu einem Ereignisgebiet vereinigt
                $level = $def['level'] ?? null;
                $codes = $def['codes'] ?? (isset($def['code']) ? [$def['code']] : null);
                if (!in_array($level, self::LEVELS, true) || !is_array($codes) || !array_is_list($codes) || $codes === []
                    || count($codes) > self::MAX_AREAS || array_filter($codes, fn ($c) => !is_string($c) || !preg_match('/^\d{2,8}$/', $c))) {
                    throw $this->invalid('definition', 'Bitte ein Gebiet auswählen.');
                }
                $codes = array_values(array_unique($codes));
                $st = $this->db->prepare('SELECT code, name FROM boundaries WHERE level = ? AND code IN (' . implode(',', array_fill(0, count($codes), '?')) . ')');
                $st->execute([$level, ...$codes]);
                $names = array_column($st->fetchAll(), 'name', 'code');
                if (count($names) !== count($codes)) {
                    throw $this->invalid('definition', 'Das gewählte Gebiet ist nicht vorhanden.');
                }
                $geom = $this->unionBoundaries($level, $codes);
                $label = ['regbez' => ['Regierungsbezirk', 'Regierungsbezirke'], 'kreis' => ['Kreis/Stadt', 'Kreise/Städte'], 'gemeinde' => ['Gemeinde', 'Gemeinden'], 'plz2' => ['PLZ-Region', 'PLZ-Regionen'], 'plz5' => ['PLZ', 'PLZ-Gebiete']][$level];
                $list = array_map(fn ($c) => $names[$c], $codes);
                $text = count($list) === 1 ? "{$label[0]} {$list[0]}"
                    : $label[1] . ' ' . (count($list) <= 4 ? implode(', ', $list) : implode(', ', array_slice($list, 0, 3)) . ' und ' . (count($list) - 3) . ' weitere');
                $norm = count($codes) === 1 ? ['type' => 'boundary', 'level' => $level, 'code' => $codes[0]] : ['type' => 'boundary', 'level' => $level, 'codes' => $codes];
                return ['definition' => $norm, 'area' => $geom, 'label' => $text];
        }
        throw $this->invalid('definition', 'Unbekannter Gebietstyp.');
    }

    /** Vereinigt Gebietsflächen in der Datenbank (ST_Union paarweise; gemeinsame Grenzen entfallen). @return array GeoJSON */
    private function unionBoundaries(string $level, array $codes): array
    {
        $one = $this->db->prepare('SELECT ST_AsWKB(geom) FROM boundaries WHERE level = ? AND code = ?');
        $union = $this->db->prepare('SELECT ST_AsWKB(ST_Union(ST_GeomFromWKB(UNHEX(?)), geom)) FROM boundaries WHERE level = ? AND code = ?');
        $one->execute([$level, $codes[0]]);
        $acc = $one->fetchColumn();
        foreach (array_slice($codes, 1) as $c) {
            $union->execute([bin2hex($acc), $level, $c]);
            $next = $union->fetchColumn();
            if ($next) {
                $acc = $next;
            }
        }
        $st = $this->db->prepare('SELECT ST_AsGeoJSON(ST_GeomFromWKB(UNHEX(?)), 7)');
        $st->execute([bin2hex((string) $acc)]);
        return json_decode((string) $st->fetchColumn(), true);
    }

    /** Puffer in Metern um ein WGS84-Gebiet; liefert das gepufferte Gebiet (inkl. Ursprungsfläche). */
    public function buffer(array $area, float $meters): array
    {
        $utm = Utm32::geometryToUtm($area);
        $st = $this->db->prepare('SELECT ST_AsGeoJSON(ST_Buffer(ST_GeomFromText(?), ?), 3)');
        $st->execute([Wkt::fromGeoJson($utm), $meters]);
        $g = json_decode((string) $st->fetchColumn(), true);
        if (!is_array($g)) {
            throw new HttpException(500, 'buffer_failed', 'Die Pufferzone konnte nicht berechnet werden.');
        }
        return Utm32::geometryToWgs84($g);
    }

    /**
     * Mit Szenario wird jede Einrichtung bewertet (atRisk): bei flächigen Szenarien (z. B. Stromausfall) alle im Gebiet,
     * sonst nur die für das Szenario als gefährdet markierten. Gefährdete stehen zuerst. Ohne Szenario: atRisk = null.
     * @return array{area:array, buffer:?array, label:string, definition:array, bufferM:float, scenario:?array, inArea:list<array>, inBuffer:list<array>}
     */
    public function query(mixed $definition, mixed $bufferM, mixed $scenarioId = null): array
    {
        $scenario = $this->scenario($scenarioId);
        if ($bufferM !== null && !is_int($bufferM) && !is_float($bufferM) || is_numeric($bufferM) && ($bufferM < 0 || $bufferM > self::MAX_BUFFER_M)) {
            throw $this->invalid('bufferM', 'Die Pufferzone muss zwischen 0 und 50 km liegen.');
        }
        $bufferM = (float) ($bufferM ?? 0);
        $a = $this->buildArea($definition);
        $buffer = $bufferM > 0 ? $this->buffer($a['area'], $bufferM) : null;

        $sql = 'SELECT f.id, f.name, f.category_id, f.street, f.zip, f.city, ST_X(f.location) AS lon, ST_Y(f.location) AS lat,
            f.regbez, f.kreis, f.gemeinde, f.plz5, f.contact_person, f.contact_function, f.contact_phone, f.contact_email, f.note,
            f.created_at, f.updated_at,
            (SELECT GROUP_CONCAT(h.scenario_id ORDER BY h.scenario_id) FROM facility_hazards h WHERE h.facility_id = f.id) AS hazards
            FROM facilities f WHERE MBRIntersects(ST_GeomFromText(:g1), f.location) AND ST_Intersects(ST_GeomFromText(:g2), f.location)
            ORDER BY ST_Y(f.location) DESC, ST_X(f.location)';
        $run = function (array $geom) use ($sql): array {
            $wkt = Wkt::fromGeoJson($geom);
            $st = $this->db->prepare($sql);
            $st->execute([':g1' => $wkt, ':g2' => $wkt]);
            return array_map(FacilityController::present(...), $st->fetchAll());
        };
        $inArea = $run($a['area']);
        $inBuffer = [];
        if ($buffer) {
            $ids = array_flip(array_column($inArea, 'id'));
            $inBuffer = array_values(array_filter($run($buffer), fn ($f) => !isset($ids[$f['id']])));
        }
        $rate = function (array $list) use ($scenario): array {
            foreach ($list as &$f) {
                $f['atRisk'] = $scenario === null ? null : ($scenario['areaWide'] || in_array($scenario['id'], $f['hazards'], true));
            }
            unset($f);
            if ($scenario !== null) {
                // stabil: Gefährdete zuerst, sonst Reihenfolge Nord → Süd beibehalten
                $risk = array_values(array_filter($list, fn ($f) => $f['atRisk']));
                $rest = array_values(array_filter($list, fn ($f) => !$f['atRisk']));
                $list = [...$risk, ...$rest];
            }
            return $list;
        };
        return ['definition' => $a['definition'], 'label' => $a['label'], 'bufferM' => $bufferM, 'scenario' => $scenario,
            'area' => $a['area'], 'buffer' => $buffer, 'inArea' => $rate($inArea), 'inBuffer' => $rate($inBuffer)];
    }

    /** @return ?array{id:int,name:string,areaWide:bool} */
    private function scenario(mixed $id): ?array
    {
        if ($id === null) {
            return null;
        }
        if (!is_int($id)) {
            throw $this->invalid('scenarioId', 'Ungültiges Szenario.');
        }
        $st = $this->db->prepare('SELECT id, name, area_wide FROM scenarios WHERE id = ?');
        $st->execute([$id]);
        $r = $st->fetch() ?: throw $this->invalid('scenarioId', 'Unbekanntes Szenario.');
        return ['id' => (int) $r['id'], 'name' => $r['name'], 'areaWide' => (bool) (int) $r['area_wide']];
    }

    /** Prüft, ob sich nicht benachbarte Kanten eines geschlossenen Rings schneiden. */
    public static function selfIntersects(array $ring): bool
    {
        $n = count($ring) - 1;
        for ($i = 0; $i < $n; $i++) {
            for ($j = $i + 1; $j < $n; $j++) {
                if (abs($i - $j) <= 1 || ($i === 0 && $j === $n - 1)) {
                    continue;
                }
                if (self::segmentsCross($ring[$i], $ring[$i + 1], $ring[$j], $ring[$j + 1])) {
                    return true;
                }
            }
        }
        return false;
    }

    private static function segmentsCross(array $p1, array $p2, array $p3, array $p4): bool
    {
        $d = fn ($a, $b, $c) => ($b[0] - $a[0]) * ($c[1] - $a[1]) - ($b[1] - $a[1]) * ($c[0] - $a[0]);
        $d1 = $d($p3, $p4, $p1); $d2 = $d($p3, $p4, $p2); $d3 = $d($p1, $p2, $p3); $d4 = $d($p1, $p2, $p4);
        return (($d1 > 0 && $d2 < 0) || ($d1 < 0 && $d2 > 0)) && (($d3 > 0 && $d4 < 0) || ($d3 < 0 && $d4 > 0));
    }

    /** @return array{float,float} */
    private function lonLat(mixed $p): array
    {
        if (!is_array($p) || !array_is_list($p) || count($p) !== 2 || !is_numeric($p[0]) || !is_numeric($p[1])) {
            throw $this->invalid('definition', 'Ungültige Koordinate.');
        }
        $lon = round((float) $p[0], 7);
        $lat = round((float) $p[1], 7);
        if ($lon < 4.5 || $lon > 11 || $lat < 49.5 || $lat > 53.5) {
            throw $this->invalid('definition', 'Das Ereignisgebiet muss in oder bei NRW liegen.');
        }
        return [$lon, $lat];
    }

    private function invalid(string $field, string $msg): HttpException
    {
        return new HttpException(422, 'validation_failed', $msg, [$field => $msg]);
    }
}
