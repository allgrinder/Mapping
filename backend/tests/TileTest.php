<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Geo\TileService;
use Kritis\Support\HttpClient;
use PHPUnit\Framework\TestCase as BaseTestCase;

final class TileFakeHttp extends HttpClient
{
    public array $calls = [];
    public bool $down = false;

    public function __construct(private string $caps)
    {
        parent::__construct();
    }

    public function get(string $url): array
    {
        $this->calls[] = $url;
        if ($this->down) {
            throw new \RuntimeException('Dienst nicht erreichbar');
        }
        if (str_contains($url, 'GetCapabilities')) {
            return ['status' => 200, 'body' => $this->caps, 'contentType' => 'text/xml'];
        }
        return ['status' => 200, 'body' => "\x89PNG-test", 'contentType' => 'image/png'];
    }
}

/** Hintergrundkarte: automatische Layerwahl aus GetCapabilities, Merken bei Ausfall, Kachel-Cache zuerst. */
final class TileTest extends BaseTestCase
{
    private string $dir;

    /** Ausgedachte Capabilities mit typischem Aufbau (Sammellayer farbig/grau, Blattschnitt, fremdes Bezugssystem). */
    private const CAPS = <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms"><Service><Name>WMS</Name></Service><Capability>
  <Layer><Name>dienst_gesamt</Name><Title>Topographische Karten</Title><CRS>EPSG:25832</CRS><CRS>EPSG:4326</CRS>
    <Layer><Name>tk_blattschnitt</Name><Title>Blattschnitte</Title></Layer>
    <Layer><Name>tk_sw</Name><Title>DTK Graustufen</Title>
      <Layer><Name>tk_sw_100</Name><Title>DTK100 grau</Title></Layer>
    </Layer>
    <Layer><Name>tk_farbe</Name><Title>DTK farbig</Title>
      <Layer><Name>tk_farbe_100</Name><Title>DTK100 farbig</Title></Layer>
      <Layer><Name>tk_farbe_25</Name><Title>DTK25 farbig</Title></Layer>
    </Layer>
  </Layer>
</Capability></WMS_Capabilities>
XML;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/kl-tiles-' . bin2hex(random_bytes(4));
        mkdir($this->dir . '/cache', 0775, true);
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->dir));
    }

    private function service(?HttpClient $http, string $layers = ''): TileService
    {
        $basemaps = require dirname(__DIR__, 2) . '/config/basemaps.php';
        $basemaps['basemaps']['topografisch']['upstream'] = 'dtk';
        $services = ['wms' => ['dtk' => ['url' => 'https://wms.example/dtk', 'version' => '1.3.0', 'layers' => $layers, 'prefer' => 'dtk']]];
        return new TileService($basemaps, $services, $this->dir . '/tiles', $http, $this->dir . '/cache');
    }

    public function testPicksCleanColourCompositeLayer(): void
    {
        $this->assertSame('tk_farbe', TileService::pickMapLayer(self::CAPS, 'dtk'));
        // ohne Sammellayer: einzelner farbiger Layer; fremdes Bezugssystem wird übergangen
        $caps = '<WMS_Capabilities><Capability><Layer><Title>x</Title><CRS>EPSG:4326</CRS>'
            . '<Layer><Name>nur_wgs</Name><Title>Karte</Title></Layer>'
            . '<Layer><Name>utm_karte</Name><Title>Karte</Title><CRS>EPSG:25832</CRS></Layer></Layer></Capability></WMS_Capabilities>';
        $this->assertSame('utm_karte', TileService::pickMapLayer($caps));
        $this->assertNull(TileService::pickMapLayer('<kein xml'));
        $this->assertNull(TileService::pickMapLayer('<WMS_Capabilities><Capability><Layer><Name>tk_blattschnitt</Name><Title>Blattschnitt</Title></Layer></Capability></WMS_Capabilities>'));
    }

    public function testDiscoveryIsRememberedAndSurvivesOutage(): void
    {
        $http = new TileFakeHttp(self::CAPS);
        $this->assertSame('tk_farbe', $this->service($http)->upstream('topografisch')['layers']);
        $this->assertCount(1, $http->calls);
        // neue Instanz (nächste Anfrage): aus der Datei, ohne Netz
        $this->assertSame('tk_farbe', $this->service($http)->upstream('topografisch')['layers']);
        $this->assertCount(1, $http->calls);

        // nach Ablauf der Frist und bei Ausfall: letztes Ergebnis bleibt gültig
        $file = $this->dir . '/cache/wms-dtk-layer.json';
        file_put_contents($file, json_encode(['layer' => 'tk_farbe', 'checkedAt' => time() - 40 * 86400]));
        $http->down = true;
        $this->assertSame('tk_farbe', $this->service($http)->upstream('topografisch')['layers']);

        // fest konfigurierter Layer hat Vorrang, kein Abruf
        $calls = count($http->calls);
        $this->assertSame('fest', $this->service($http, 'fest')->upstream('topografisch')['layers']);
        $this->assertCount($calls, $http->calls);
    }

    public function testFailureWithoutHistoryIsNotRetriedOnEveryRequest(): void
    {
        $http = new TileFakeHttp(self::CAPS);
        $http->down = true;
        $this->assertNull($this->service($http)->upstream('topografisch'));
        $this->assertNull($this->service($http)->upstream('topografisch'));
        $this->assertCount(1, $http->calls, 'Fehlschlag wird eine Stunde gemerkt');
        $this->assertNull($this->service(null)->upstream('topografisch'));
    }

    public function testTilesComeFromCacheFirstAndAreStoredOnFetch(): void
    {
        $http = new TileFakeHttp(self::CAPS);
        $svc = $this->service($http);
        $this->assertSame("\x89PNG-test", $svc->get('topografisch', 3, 2, 1));
        $tileCall = end($http->calls);
        $this->assertStringContainsString('LAYERS=tk_farbe', $tileCall);
        $this->assertStringContainsString('CRS=EPSG%3A25832', $tileCall);
        $this->assertFileExists($svc->path('topografisch', 3, 2, 1));
        $this->assertTrue($svc->hasLocalTiles('topografisch'));

        // ohne Netz: vorhandene Kachel kommt weiter, fehlende ergibt null
        $http->down = true;
        $calls = count($http->calls);
        $this->assertSame("\x89PNG-test", $svc->get('topografisch', 3, 2, 1));
        $this->assertCount($calls, $http->calls, 'vorhandene Kachel ohne Netzabruf');
        $this->assertNull($svc->get('topografisch', 3, 3, 1));
        $this->assertNull($svc->get('topografisch', 99, 0, 0));
    }
}
