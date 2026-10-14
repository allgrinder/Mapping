<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Kritis\Support\Validator;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Gemeinsame Pflege für Kategorien und Krisenszenarien. */
final class MasterDataController
{
    /** Symbol-Schlüssel, die das Frontend kennt (frontend/src/ui/icons.js). */
    public const SYMBOLS = ['cap', 'cross', 'flask', 'box', 'building', 'shield', 'wave', 'rain', 'fire', 'wind', 'power', 'hazard'];

    private string $table;
    private string $usageSql;

    public function __construct(private PDO $db, string $kind)
    {
        [$this->table, $this->usageSql] = match ($kind) {
            'categories' => ['categories', 'SELECT COUNT(*) FROM facilities WHERE category_id = ?'],
            'scenarios' => ['scenarios', 'SELECT COUNT(*) FROM facility_hazards WHERE scenario_id = ?'],
        };
    }

    public function list(Request $req, Response $res): Response
    {
        $count = $this->table === 'categories'
            ? '(SELECT COUNT(*) FROM facilities f WHERE f.category_id = t.id)'
            : '(SELECT COUNT(*) FROM facility_hazards h WHERE h.scenario_id = t.id)';
        $rows = $this->db->query("SELECT t.*, $count AS usage_count FROM {$this->table} t ORDER BY sort_order, name")->fetchAll();
        return Json::respond($res, ['items' => array_map($this->present(...), $rows)]);
    }

    public function create(Request $req, Response $res): Response
    {
        [$name, $color, $symbol, $active] = $this->validate((array) $req->getParsedBody());
        $this->assertUniqueName($name, null);
        $actor = $req->getAttribute('user')['id'];
        $next = (int) $this->db->query("SELECT COALESCE(MAX(sort_order), 0) + 10 FROM {$this->table}")->fetchColumn();
        $this->db->prepare("INSERT INTO {$this->table} (name, color, symbol, sort_order, active, created_by, updated_by) VALUES (?,?,?,?,?,?,?)")
            ->execute([$name, $color, $symbol, $next, (int) $active, $actor, $actor]);
        return Json::respond($res, ['id' => (int) $this->db->lastInsertId()], 201);
    }

    public function update(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $this->find($id);
        [$name, $color, $symbol, $active] = $this->validate((array) $req->getParsedBody());
        $this->assertUniqueName($name, $id);
        $this->db->prepare("UPDATE {$this->table} SET name = ?, color = ?, symbol = ?, active = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?")
            ->execute([$name, $color, $symbol, (int) $active, $req->getAttribute('user')['id'], $id]);
        return Json::respond($res, ['ok' => true]);
    }

    public function delete(Request $req, Response $res, array $args): Response
    {
        $id = $this->id($args);
        $this->find($id);
        $st = $this->db->prepare($this->usageSql);
        $st->execute([$id]);
        if ((int) $st->fetchColumn() > 0) {
            throw new HttpException(409, 'in_use', 'Löschen nicht möglich: Es sind noch Einrichtungen zugeordnet.');
        }
        $this->db->prepare("DELETE FROM {$this->table} WHERE id = ?")->execute([$id]);
        return Json::respond($res, ['ok' => true]);
    }

    /** Body: {"ids":[3,1,2]} – vollständige neue Reihenfolge. */
    public function reorder(Request $req, Response $res): Response
    {
        $ids = ((array) $req->getParsedBody())['ids'] ?? null;
        $existing = array_map('intval', $this->db->query("SELECT id FROM {$this->table}")->fetchAll(PDO::FETCH_COLUMN));
        if (!is_array($ids) || !array_is_list($ids) || array_filter($ids, fn ($v) => !is_int($v)) !== []
            || count($ids) !== count(array_unique($ids)) || array_diff($existing, $ids) !== [] || array_diff($ids, $existing) !== []) {
            throw new HttpException(422, 'validation_failed', 'Die Reihenfolge muss alle Einträge genau einmal enthalten.', ['ids' => 'Ungültige Liste.']);
        }
        $st = $this->db->prepare("UPDATE {$this->table} SET sort_order = ?, updated_at = UTC_TIMESTAMP(), updated_by = ? WHERE id = ?");
        $actor = $req->getAttribute('user')['id'];
        $this->db->beginTransaction();
        foreach ($ids as $i => $id) {
            $st->execute([($i + 1) * 10, $actor, $id]);
        }
        $this->db->commit();
        return Json::respond($res, ['ok' => true]);
    }

    /** @return array{string,string,string,bool} */
    private function validate(array $data): array
    {
        $v = new Validator($data);
        $name = $v->string('name', 2, 120);
        $color = $v->string('color', 7, 7, '/^#[0-9A-Fa-f]{6}$/');
        $symbol = $v->enum('symbol', self::SYMBOLS);
        $active = $v->bool('active', true);
        $v->assertValid();
        return [$name, strtoupper($color), $symbol, $active];
    }

    private function assertUniqueName(string $name, ?int $exceptId): void
    {
        $st = $this->db->prepare("SELECT id FROM {$this->table} WHERE name = ? AND id <> ?");
        $st->execute([$name, $exceptId ?? 0]);
        if ($st->fetchColumn()) {
            throw new HttpException(409, 'conflict', 'Der Name ist bereits vergeben.', ['name' => 'Der Name ist bereits vergeben.']);
        }
    }

    private function id(array $args): int
    {
        if (!ctype_digit((string) ($args['id'] ?? ''))) {
            throw new HttpException(404, 'not_found', 'Nicht gefunden.');
        }
        return (int) $args['id'];
    }

    private function find(int $id): void
    {
        $st = $this->db->prepare("SELECT 1 FROM {$this->table} WHERE id = ?");
        $st->execute([$id]);
        if (!$st->fetchColumn()) {
            throw new HttpException(404, 'not_found', 'Nicht gefunden.');
        }
    }

    private function present(array $r): array
    {
        return [
            'id' => (int) $r['id'], 'name' => $r['name'], 'color' => $r['color'], 'symbol' => $r['symbol'],
            'sortOrder' => (int) $r['sort_order'], 'active' => (bool) (int) $r['active'],
            'usageCount' => (int) $r['usage_count'], 'updatedAt' => $r['updated_at'],
        ];
    }
}
