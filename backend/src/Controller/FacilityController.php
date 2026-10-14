<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Geo\AdminResolver;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Kritis\Support\Normalize;
use Kritis\Support\Validator;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class FacilityController
{
    private const SELECT = 'SELECT f.id, f.name, f.category_id, f.street, f.zip, f.city, ST_X(f.location) AS lon, ST_Y(f.location) AS lat,
        f.regbez, f.kreis, f.gemeinde, f.plz5, f.contact_person, f.contact_function, f.contact_phone, f.contact_email, f.note,
        f.external_id, f.source, f.created_at, f.updated_at, cu.username AS created_by, uu.username AS updated_by,
        (SELECT GROUP_CONCAT(h.scenario_id ORDER BY h.scenario_id) FROM facility_hazards h WHERE h.facility_id = f.id) AS hazards
        FROM facilities f LEFT JOIN users cu ON cu.id = f.created_by LEFT JOIN users uu ON uu.id = f.updated_by';

    private ?bool $boundariesLoaded = null;

    public function __construct(private PDO $db, private AdminResolver $resolver)
    {
    }

    /** Liste mit kombinierbaren Filtern: category (Liste), scenario, regbez, kreis, plz (Präfix), q (Freitext). */
    public function list(Request $req, Response $res): Response
    {
        $q = $req->getQueryParams();
        $where = [];
        $args = [];
        $ids = static function (mixed $v): array {
            $v = is_array($v) ? $v : explode(',', (string) $v);
            return array_values(array_filter(array_map('intval', array_filter($v, 'is_scalar')), fn ($i) => $i > 0));
        };
        if (array_key_exists('category', $q) && (!is_array($q['category']) || array_is_list($q['category']))) {
            $c = $ids($q['category']);
            $where[] = $c ? 'f.category_id IN (' . implode(',', array_fill(0, count($c), '?')) . ')' : '1 = 0';
            array_push($args, ...$c);
        }
        if (isset($q['scenario']) && is_scalar($q['scenario']) && ctype_digit((string) $q['scenario'])) {
            $where[] = 'EXISTS (SELECT 1 FROM facility_hazards h WHERE h.facility_id = f.id AND h.scenario_id = ?)';
            $args[] = (int) $q['scenario'];
        }
        foreach (['regbez' => 3, 'kreis' => 5] as $k => $len) {
            if (isset($q[$k]) && is_scalar($q[$k]) && preg_match('/^\d{' . $len . '}$/', (string) $q[$k])) {
                $where[] = "f.$k = ?";
                $args[] = (string) $q[$k];
            }
        }
        if (isset($q['plz']) && is_scalar($q['plz']) && preg_match('/^\d{1,5}$/', (string) $q['plz'])) {
            $where[] = '(f.zip LIKE ? OR f.plz5 LIKE ?)';
            $args[] = $q['plz'] . '%';
            $args[] = $q['plz'] . '%';
        }
        if (isset($q['q']) && is_scalar($q['q']) && trim((string) $q['q']) !== '') {
            $term = '%' . addcslashes(mb_substr(trim((string) $q['q']), 0, 100), '%_\\') . '%';
            $where[] = '(f.name LIKE ? OR f.city LIKE ? OR f.street LIKE ? OR f.zip LIKE ?)';
            array_push($args, $term, $term, $term, $term);
        }
        $sql = self::SELECT . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY f.name';
        $st = $this->db->prepare($sql);
        $st->execute($args);
        $items = array_map(self::present(...), $st->fetchAll());
        $asOf = $this->db->query('SELECT GREATEST(COALESCE(MAX(updated_at), "1970-01-01"), COALESCE((SELECT MAX(at) FROM audit_log WHERE action = "facility_deleted"), "1970-01-01")) FROM facilities')->fetchColumn();
        return Json::respond($res, ['items' => $items, 'dataAsOf' => $asOf, 'servedAt' => gmdate('Y-m-d H:i:s')]);
    }

    public function get(Request $req, Response $res, array $args): Response
    {
        return Json::respond($res, $this->find($this->id($args)));
    }

    public function create(Request $req, Response $res): Response
    {
        $data = $this->validate((array) $req->getParsedBody());
        $this->db->beginTransaction();
        $id = $this->insert($data, (int) $req->getAttribute('user')['id']);
        $this->db->commit();
        return Json::respond($res, $this->find($id), 201);
    }

    public function update(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $this->find($id);
        $data = $this->validate((array) $req->getParsedBody());
        $this->db->beginTransaction();
        $this->store($id, $data, (int) $req->getAttribute('user')['id']);
        $this->db->commit();
        return Json::respond($res, $this->find($id));
    }

    public function delete(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $f = $this->find($id);
        $this->db->prepare('DELETE FROM facilities WHERE id = ?')->execute([$id]);
        $this->db->prepare('INSERT INTO audit_log (user_id, action, detail) VALUES (?, "facility_deleted", ?)')
            ->execute([$req->getAttribute('user')['id'], $f['name'] . ' (#' . $id . ')']);
        return Json::respond($res, ['ok' => true]);
    }

    /** Gebietszuordnung eines Punkts (für das Formular vor dem Speichern). */
    public function resolve(Request $req, Response $res): Response
    {
        $q = $req->getQueryParams();
        [$lon, $lat] = $this->coords($q['lon'] ?? null, $q['lat'] ?? null);
        $r = $this->resolver->resolve($lon, $lat);
        $names = [];
        $codes = array_filter([$r['regbez'], $r['kreis'], $r['gemeinde']]);
        if ($codes) {
            $st = $this->db->prepare('SELECT level, code, name FROM boundaries WHERE level IN ("regbez","kreis","gemeinde") AND code IN (' . implode(',', array_fill(0, count($codes), '?')) . ')');
            $st->execute(array_values($codes));
            foreach ($st->fetchAll() as $b) {
                $names[$b['level']] = $b['name'];
            }
        }
        return Json::respond($res, $r + ['names' => $names, 'boundariesLoaded' => $this->boundariesLoaded()]);
    }

    /** @return array<string,mixed> */
    public function validate(array $body, bool $import = false): array
    {
        $v = new Validator($body);
        $d = [
            'name' => $v->string('name', 2, 255),
            'street' => $v->has('street') && $body['street'] !== null ? $v->string('street', 0, 255) : '',
            'zip' => $v->has('zip') && $body['zip'] !== null ? $v->string('zip', 0, 5, '/^(\d{5})?$/') : '',
            'city' => $v->string('city', 2, 120),
            'contactPerson' => $this->opt($v, $body, 'contactPerson', 160),
            'contactFunction' => $this->opt($v, $body, 'contactFunction', 160),
            'contactPhone' => $this->opt($v, $body, 'contactPhone', 60, '/^[0-9+()\/\s.\-]*$/'),
            'contactEmail' => $this->opt($v, $body, 'contactEmail', 190),
            'note' => $this->opt($v, $body, 'note', 4000),
            'externalId' => $import ? $this->opt($v, $body, 'externalId', 120) : null,
            'source' => $import ? 'import' : 'manual',
            'importBatchId' => $import ? ($body['importBatchId'] ?? null) : null,
        ];
        if ($d['contactEmail'] !== null && !filter_var($d['contactEmail'], FILTER_VALIDATE_EMAIL)) {
            $v->fail('contactEmail', 'Keine gültige E-Mail-Adresse.');
        }
        $cat = $body['categoryId'] ?? null;
        if (!is_int($cat) || !$this->exists('categories', $cat)) {
            $v->fail('categoryId', 'Bitte eine Kategorie wählen.');
        }
        $d['categoryId'] = is_int($cat) ? $cat : 0;
        $hz = $body['hazards'] ?? [];
        if (!is_array($hz) || !array_is_list($hz) || array_filter($hz, fn ($h) => !is_int($h)) || count($hz) > 50) {
            $v->fail('hazards', 'Ungültige Szenarien.');
            $hz = [];
        }
        $hz = array_values(array_unique($hz));
        foreach ($hz as $h) {
            if (!$this->exists('scenarios', $h)) {
                $v->fail('hazards', 'Unbekanntes Szenario.');
            }
        }
        $d['hazards'] = $hz;
        try {
            [$d['lon'], $d['lat']] = $this->coords($body['location']['lon'] ?? null, $body['location']['lat'] ?? null);
        } catch (HttpException) {
            $v->fail('location', 'Bitte den Standort auf der Karte setzen.');
            $d['lon'] = $d['lat'] = 0.0;
        }
        $v->assertValid();
        $adm = $this->resolver->resolve($d['lon'], $d['lat']);
        if ($this->boundariesLoaded() && !$adm['inNrw']) {
            throw new HttpException(422, 'validation_failed', 'Eingaben ungültig.', ['location' => 'Der Standort liegt außerhalb von Nordrhein-Westfalen.']);
        }
        return $d + ['admin' => $adm];
    }

    /** Legt eine validierte Einrichtung an (Transaktion übernimmt der Aufrufer). */
    public function insert(array $data, int $actor): int
    {
        $this->db->prepare('INSERT INTO facilities (name, category_id, street, zip, city, location, regbez, kreis, gemeinde, plz5,
            contact_person, contact_function, contact_phone, contact_email, note, normalized_key, external_id, source, import_batch_id, created_by, updated_by)
            VALUES (?,?,?,?,?, ST_GeomFromText(?), ?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?)')
            ->execute([...$this->columns($data), $data['externalId'], $data['source'], $data['importBatchId'], $actor, $actor]);
        $id = (int) $this->db->lastInsertId();
        $this->saveHazards($id, $data['hazards']);
        return $id;
    }

    /** Überschreibt eine bestehende Einrichtung mit validierten Daten; eine externe ID aus dem Import wird übernommen. */
    public function store(int $id, array $data, int $actor): void
    {
        $this->db->prepare('UPDATE facilities SET name = ?, category_id = ?, street = ?, zip = ?, city = ?, location = ST_GeomFromText(?),
            regbez = ?, kreis = ?, gemeinde = ?, plz5 = ?, contact_person = ?, contact_function = ?, contact_phone = ?, contact_email = ?,
            note = ?, normalized_key = ?, external_id = COALESCE(?, external_id), updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?')
            ->execute([...$this->columns($data), $data['externalId'], $actor, $id]);
        $this->saveHazards($id, $data['hazards']);
    }

    private function columns(array $d): array
    {
        $a = $d['admin'];
        return [
            $d['name'], $d['categoryId'], $d['street'] ?: null, $d['zip'] ?: null, $d['city'],
            sprintf('POINT(%.7F %.7F)', $d['lon'], $d['lat']),
            $a['regbez'], $a['kreis'], $a['gemeinde'], $a['plz5'],
            $d['contactPerson'], $d['contactFunction'], $d['contactPhone'], $d['contactEmail'], $d['note'],
            Normalize::facilityKey($d['name'], $d['zip'], $d['street']),
        ];
    }

    public function saveHazards(int $id, array $hazards): void
    {
        $this->db->prepare('DELETE FROM facility_hazards WHERE facility_id = ?')->execute([$id]);
        $ins = $this->db->prepare('INSERT INTO facility_hazards (facility_id, scenario_id) VALUES (?, ?)');
        foreach ($hazards as $h) {
            $ins->execute([$id, $h]);
        }
    }

    private function opt(Validator $v, array $body, string $key, int $max, ?string $pattern = null): ?string
    {
        if (!array_key_exists($key, $body) || $body[$key] === null || $body[$key] === '') {
            return null;
        }
        $s = $v->string($key, 0, $max, $pattern);
        return $s === '' ? null : $s;
    }

    /** @return array{float,float} */
    private function coords(mixed $lon, mixed $lat): array
    {
        if (!is_numeric($lon) || !is_numeric($lat)) {
            throw new HttpException(422, 'validation_failed', 'Koordinaten fehlen.', ['location' => 'Koordinaten fehlen.']);
        }
        $lon = (float) $lon;
        $lat = (float) $lat;
        // grobe NRW-Ausdehnung mit Rand
        if ($lon < 5.5 || $lon > 9.8 || $lat < 50.0 || $lat > 52.8) {
            throw new HttpException(422, 'validation_failed', 'Koordinaten außerhalb von NRW.', ['location' => 'Der Standort liegt außerhalb von Nordrhein-Westfalen.']);
        }
        return [$lon, $lat];
    }

    private function boundariesLoaded(): bool
    {
        return $this->boundariesLoaded ??= (bool) $this->db->query("SELECT 1 FROM boundaries WHERE level IN ('land','regbez') LIMIT 1")->fetchColumn();
    }

    private function exists(string $table, int $id): bool
    {
        $st = $this->db->prepare("SELECT 1 FROM $table WHERE id = ?");
        $st->execute([$id]);
        return (bool) $st->fetchColumn();
    }

    private function id(array $args): int
    {
        if (!ctype_digit((string) ($args['id'] ?? ''))) {
            throw new HttpException(404, 'not_found', 'Nicht gefunden.');
        }
        return (int) $args['id'];
    }

    /** @return array<string,mixed> */
    public function find(int $id): array
    {
        $st = $this->db->prepare(self::SELECT . ' WHERE f.id = ?');
        $st->execute([$id]);
        $r = $st->fetch();
        if (!$r) {
            throw new HttpException(404, 'not_found', 'Einrichtung nicht gefunden.');
        }
        return self::present($r);
    }

    public static function present(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'name' => $r['name'], 'categoryId' => (int) $r['category_id'],
            'address' => ['street' => $r['street'], 'zip' => $r['zip'], 'city' => $r['city']],
            'location' => ['lon' => round((float) $r['lon'], 7), 'lat' => round((float) $r['lat'], 7)],
            'admin' => ['regbez' => $r['regbez'], 'kreis' => $r['kreis'], 'gemeinde' => $r['gemeinde'], 'plz5' => $r['plz5']],
            'hazards' => $r['hazards'] ? array_map('intval', explode(',', $r['hazards'])) : [],
            'contact' => ['person' => $r['contact_person'], 'function' => $r['contact_function'], 'phone' => $r['contact_phone'], 'email' => $r['contact_email']],
            'note' => $r['note'], 'externalId' => $r['external_id'] ?? null, 'source' => $r['source'] ?? 'manual',
            'createdAt' => $r['created_at'], 'createdBy' => $r['created_by'] ?? null,
            'updatedAt' => $r['updated_at'], 'updatedBy' => $r['updated_by'] ?? null,
        ];
    }
}
