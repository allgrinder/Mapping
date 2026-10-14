<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\BoundaryImporter;
use Kritis\Geo\Utm32;
use Kritis\Security\PasswordHasher;
use Kritis\Support\Seeder;

final class ImportTest extends TestCase
{
    private int $cat;
    private array $scen;

    protected function setUp(): void
    {
        parent::setUp();
        (new Seeder(self::$db, new PasswordHasher()))->run('seedadmin');
        (new BoundaryImporter(self::$db, require dirname(__DIR__, 2) . '/config/boundaries.php'))->importDvg(__DIR__ . '/fixtures/dvg');
        $this->cat = (int) self::$db->query('SELECT id FROM categories ORDER BY sort_order LIMIT 1')->fetchColumn();
        $this->scen = array_map('intval', self::$db->query('SELECT id FROM scenarios ORDER BY sort_order')->fetchAll(\PDO::FETCH_COLUMN));
        $this->makeUser('adam', 'admin');
        $this->login('adam');
    }

    private function data(string $name, array $over = [], float $e = 315000, float $n = 5685000): array
    {
        [$lon, $lat] = Utm32::inverse($e, $n);
        return array_replace([
            'name' => $name, 'categoryId' => $this->cat, 'street' => 'Musterstraße 1', 'zip' => '40210', 'city' => 'Düsseldorf',
            'location' => ['lon' => $lon, 'lat' => $lat], 'hazards' => [$this->scen[0]],
        ], $over);
    }

    private function facilityCount(): int
    {
        return (int) self::$db->query('SELECT COUNT(*) FROM facilities')->fetchColumn();
    }

    public function testCommitCreatesAllRowsWithBatchAndAudit(): void
    {
        $r = $this->call('POST', '/api/import/commit', ['fileName' => 'liste.xlsx', 'rows' => [
            ['row' => 2, 'action' => 'create', 'data' => $this->data('Hochschule A', ['externalId' => 'HS-1'])],
            ['row' => 3, 'action' => 'create', 'data' => $this->data('Archiv B', ['street' => 'Weg 2'], 330000, 5620000)],
        ]]);
        $this->assertSame(200, $r['status'], json_encode($r['body']));
        $this->assertSame(2, $r['body']['created']);
        $rows = self::$db->query('SELECT source, import_batch_id, external_id, gemeinde FROM facilities ORDER BY name')->fetchAll();
        $this->assertSame('import', $rows[0]['source']);
        $this->assertSame($r['body']['batchId'], $rows[0]['import_batch_id']);
        $this->assertSame('05158008', $rows[0]['gemeinde']);
        $this->assertSame('HS-1', $rows[1]['external_id']);
        $this->assertStringContainsString('liste.xlsx', (string) self::$db->query('SELECT detail FROM audit_log WHERE action = "facilities_imported"')->fetchColumn());
    }

    public function testOneInvalidRowRejectsWholeImport(): void
    {
        $r = $this->call('POST', '/api/import/commit', ['rows' => [
            ['row' => 2, 'action' => 'create', 'data' => $this->data('Gültig')],
            ['row' => 3, 'action' => 'create', 'data' => $this->data('Ungültig', ['zip' => '12', 'contactEmail' => 'x'])],
            ['row' => 4, 'action' => 'create', 'data' => $this->data('Bayern', [], 700000, 5330000)],
        ]]);
        $this->assertSame(422, $r['status']);
        $this->assertSame('import_invalid', $r['body']['error']['code']);
        $byRow = array_column($r['body']['error']['rows'], 'fields', 'row');
        $this->assertSame([3, 4], array_keys($byRow));
        $this->assertArrayHasKey('zip', $byRow[3]);
        $this->assertArrayHasKey('contactEmail', $byRow[3]);
        $this->assertArrayHasKey('location', $byRow[4]);
        $this->assertSame(0, $this->facilityCount());
    }

    public function testDuplicatesAgainstStockAndWithinFileAreRejected(): void
    {
        $this->assertSame(201, $this->call('POST', '/api/facilities', $this->data('Uni-Klinik  Nord', ['street' => 'Haupt-Str. 5']))['status']);
        $r = $this->call('POST', '/api/import/commit', ['rows' => [
            ['row' => 2, 'action' => 'create', 'data' => $this->data('uniklinik nord', ['street' => 'Hauptstraße 5'])],
            ['row' => 3, 'action' => 'create', 'data' => $this->data('Neu', ['externalId' => 'X'])],
            ['row' => 4, 'action' => 'create', 'data' => $this->data('Anders', ['externalId' => 'X'])],
        ]]);
        $this->assertSame(422, $r['status']);
        $rows = $r['body']['error']['rows'];
        $this->assertSame([2, 4], array_column($rows, 'row'));
        $this->assertTrue($rows[0]['duplicate']);
        $this->assertStringContainsString('bestehender', $rows[0]['fields']['_']);
        $this->assertStringContainsString('Zeile 3', $rows[1]['fields']['_']);
        $this->assertSame(1, $this->facilityCount());
    }

    public function testUpdateOverwritesExistingAndKeepsCreator(): void
    {
        $id = $this->call('POST', '/api/facilities', $this->data('Archiv'))['body']['id'];
        $this->makeUser('ida', 'admin');
        $this->login('ida');
        $r = $this->call('POST', '/api/import/commit', ['rows' => [
            ['row' => 2, 'action' => 'update', 'id' => $id, 'data' => $this->data('Archiv', ['note' => 'aus Import', 'externalId' => 'A-7', 'hazards' => []])],
        ]]);
        $this->assertSame(200, $r['status'], json_encode($r['body']));
        $this->assertSame(1, $r['body']['updated']);
        $f = $this->call('GET', "/api/facilities/$id")['body'];
        $this->assertSame('aus Import', $f['note']);
        $this->assertSame('A-7', $f['externalId']);
        $this->assertSame([], $f['hazards']);
        $this->assertSame('adam', $f['createdBy']);
        $this->assertSame('ida', $f['updatedBy']);
        $this->assertSame(422, $this->call('POST', '/api/import/commit', ['rows' => [['action' => 'update', 'id' => 999999, 'data' => $this->data('X')]]])['status']);
    }

    public function testLimitsAndShape(): void
    {
        $this->assertSame(422, $this->call('POST', '/api/import/commit', ['rows' => 'abc'])['status']);
        $this->assertSame(422, $this->call('POST', '/api/import/commit', ['rows' => array_fill(0, 5001, ['action' => 'create', 'data' => []])])['status']);
        $r = $this->call('POST', '/api/import/commit', ['rows' => [['action' => 'drop', 'data' => []]]]);
        $this->assertSame(422, $r['status']);
        $this->login('adam');
        $this->makeUser('lena', 'lesen');
        $this->login('lena');
        $this->assertSame(403, $this->call('POST', '/api/import/commit', ['rows' => [['action' => 'create', 'data' => $this->data('X')]]])['status']);
    }
}
