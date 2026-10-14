<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Geo\SituationService;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Kritis\Support\Validator;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Lagemodus-Abfragen und gespeicherte Ereignisse. Speichern/Öffnen: alle Rollen; Löschen: Admin. */
final class SituationController
{
    public function __construct(private PDO $db, private SituationService $svc)
    {
    }

    public function query(Request $req, Response $res): Response
    {
        $b = (array) $req->getParsedBody();
        return Json::respond($res, $this->svc->query($b['definition'] ?? null, $b['bufferM'] ?? 0, $b['scenarioId'] ?? null));
    }

    public function list(Request $req, Response $res): Response
    {
        $rows = $this->db->query('SELECT e.id, e.name, e.scenario_id, s.name AS scenario_name, e.occurred_at, e.buffer_m, e.definition, e.result_snapshot, e.created_at, e.updated_at, u.username AS created_by
            FROM events e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN scenarios s ON s.id = e.scenario_id ORDER BY e.occurred_at DESC, e.id DESC')->fetchAll();
        return Json::respond($res, ['items' => array_map(function ($r) {
            $snap = json_decode((string) $r['result_snapshot'], true) ?: [];
            $risk = fn (array $l) => count(array_filter($l, fn ($f) => !empty($f['atRisk'])));
            return [
                'id' => (int) $r['id'], 'name' => $r['name'], 'occurredAt' => $r['occurred_at'], 'bufferM' => (float) $r['buffer_m'],
                'scenarioId' => $r['scenario_id'] !== null ? (int) $r['scenario_id'] : null, 'scenarioName' => $r['scenario_name'],
                'label' => $snap['label'] ?? '', 'counts' => ['inArea' => count($snap['inArea'] ?? []), 'inBuffer' => count($snap['inBuffer'] ?? []),
                    'atRisk' => $r['scenario_id'] !== null ? $risk($snap['inArea'] ?? []) + $risk($snap['inBuffer'] ?? []) : null],
                'createdAt' => $r['created_at'], 'createdBy' => $r['created_by'], 'updatedAt' => $r['updated_at'],
            ];
        }, $rows)]);
    }

    public function get(Request $req, Response $res, array $args): Response
    {
        $r = $this->find($this->id($args));
        return Json::respond($res, $this->present($r));
    }

    public function create(Request $req, Response $res): Response
    {
        [$name, $occurred, $result] = $this->validate((array) $req->getParsedBody());
        $actor = $req->getAttribute('user')['id'];
        $this->db->prepare('INSERT INTO events (name, scenario_id, occurred_at, geom, buffer_m, definition, result_snapshot, created_by, updated_by)
            VALUES (?, ?, ?, ST_GeomFromText(?), ?, ?, ?, ?, ?)')
            ->execute([$name, $result['scenario']['id'] ?? null, $occurred, \Kritis\Geo\Wkt::fromGeoJson($result['area']), (int) round($result['bufferM']), json_encode($result['definition']), json_encode($this->snapshot($result), JSON_UNESCAPED_UNICODE), $actor, $actor]);
        return Json::respond($res, $this->present($this->find((int) $this->db->lastInsertId())), 201);
    }

    public function update(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $this->find($id);
        [$name, $occurred, $result] = $this->validate((array) $req->getParsedBody());
        $this->db->prepare('UPDATE events SET name = ?, scenario_id = ?, occurred_at = ?, geom = ST_GeomFromText(?), buffer_m = ?, definition = ?, result_snapshot = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?')
            ->execute([$name, $result['scenario']['id'] ?? null, $occurred, \Kritis\Geo\Wkt::fromGeoJson($result['area']), (int) round($result['bufferM']), json_encode($result['definition']), json_encode($this->snapshot($result), JSON_UNESCAPED_UNICODE), $req->getAttribute('user')['id'], $id]);
        return Json::respond($res, $this->present($this->find($id)));
    }

    public function delete(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $this->find($id);
        $this->db->prepare('DELETE FROM events WHERE id = ?')->execute([$id]);
        return Json::respond($res, ['ok' => true]);
    }

    /** @return array{string,string,array} */
    private function validate(array $b): array
    {
        $v = new Validator($b);
        $name = $v->string('name', 2, 200);
        $occurred = gmdate('Y-m-d H:i:s');
        if (isset($b['occurredAt'])) {
            $t = is_string($b['occurredAt']) ? strtotime($b['occurredAt']) : false;
            $t === false ? $v->fail('occurredAt', 'Ungültiger Zeitpunkt.') : $occurred = gmdate('Y-m-d H:i:s', $t);
        }
        $v->assertValid();
        return [$name, $occurred, $this->svc->query($b['definition'] ?? null, $b['bufferM'] ?? 0, $b['scenarioId'] ?? null)];
    }

    private function snapshot(array $r): array
    {
        $slim = fn ($f) => ['id' => $f['id'], 'name' => $f['name'], 'categoryId' => $f['categoryId'], 'address' => $f['address'], 'location' => $f['location'], 'admin' => $f['admin'], 'hazards' => $f['hazards'], 'contact' => $f['contact'], 'atRisk' => $f['atRisk'] ?? null];
        return ['label' => $r['label'], 'scenario' => $r['scenario'], 'takenAt' => gmdate('Y-m-d H:i:s'), 'inArea' => array_map($slim, $r['inArea']), 'inBuffer' => array_map($slim, $r['inBuffer'])];
    }

    private function present(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'name' => $r['name'], 'occurredAt' => $r['occurred_at'], 'bufferM' => (float) $r['buffer_m'],
            'scenarioId' => $r['scenario_id'] !== null ? (int) $r['scenario_id'] : null,
            'definition' => json_decode((string) $r['definition'], true), 'snapshot' => json_decode((string) $r['result_snapshot'], true),
            'createdAt' => $r['created_at'], 'createdBy' => $r['created_by'], 'updatedAt' => $r['updated_at'], 'updatedBy' => $r['updated_by'],
        ];
    }

    private function find(int $id): array
    {
        $st = $this->db->prepare('SELECT e.*, cu.username AS created_by, uu.username AS updated_by FROM events e LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users uu ON uu.id = e.updated_by WHERE e.id = ?');
        $st->execute([$id]);
        return $st->fetch() ?: throw new HttpException(404, 'not_found', 'Ereignis nicht gefunden.');
    }

    private function id(array $args): int
    {
        if (!ctype_digit((string) ($args['id'] ?? ''))) {
            throw new HttpException(404, 'not_found', 'Nicht gefunden.');
        }
        return (int) $args['id'];
    }
}
