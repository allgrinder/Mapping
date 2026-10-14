<?php
declare(strict_types=1);

namespace Kritis\Tests;

use Kritis\Controller\HazardController;
use Kritis\Geo\FloodService;
use Kritis\Geo\WarningService;
use Kritis\Security\PasswordHasher;
use Kritis\Support\HttpClient;
use Kritis\Support\Seeder;
use Slim\Psr7\Factory\ResponseFactory;
use Slim\Psr7\Factory\ServerRequestFactory;

/** Simulierter HTTP-Client: URL-Muster → Antwort; zählt Aufrufe; kann komplett „ausfallen“. */
final class FakeHttp extends HttpClient
{
    public array $calls = [];
    public bool $down = false;

    public function __construct(private array $routes)
    {
        parent::__construct();
    }

    public function get(string $url): array
    {
        $this->calls[] = $url;
        if ($this->down) {
            throw new \RuntimeException('Dienst nicht erreichbar: Timeout');
        }
        foreach ($this->routes as $re => $resp) {
            if (preg_match($re, $url)) {
                return is_array($resp) ? $resp : ['status' => 200, 'body' => $resp, 'contentType' => 'application/json'];
            }
        }
        return ['status' => 404, 'body' => '', 'contentType' => 'text/plain'];
    }
}

final class HazardTest extends TestCase
{
    private string $cache;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cache = sys_get_temp_dir() . '/kritis-hazard-' . bin2hex(random_bytes(4));
        mkdir($this->cache, 0700, true);
        (new Seeder(self::$db, new PasswordHasher()))->run('seedadmin');
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->cache));
    }

    private function cfg(): array
    {
        return (require dirname(__DIR__, 2) . '/config/services.php')['warnings'];
    }

    private function routes(): array
    {
        $poly = fn ($x0, $y0, $x1, $y1) => json_encode(['type' => 'FeatureCollection', 'features' => [['type' => 'Feature', 'properties' => [], 'geometry' => ['type' => 'Polygon', 'coordinates' => [[[$x0, $y0], [$x1, $y0], [$x1, $y1], [$x0, $y1], [$x0, $y0]]]]]]]);
        $csv = gzencode("Station;Date;D0;D1;D2;D3;D4;D5;D6\n1078;20261014 04:17;2;3;4;4;3;2;-999\n");
        $list = mb_convert_encoding("Stationsindex;Hoehe;Breite;Laenge;Name;Bundesland\n1078;37;51.2960;6.7686;Düsseldorf;Nordrhein-Westfalen\n3379;515;48.1632;11.5429;München-Stadt;Bayern\n", 'ISO-8859-1', 'UTF-8');
        return [
            '#/mowas/mapData\.json$#' => json_encode([
                ['id' => 'mow.DE-NW-K-001', 'version' => 1, 'severity' => 'Severe', 'type' => 'Alert', 'startDate' => '2026-10-14T08:00:00+02:00', 'i18nTitle' => ['de' => 'Gefahrstoffaustritt in Köln-Porz']],
                ['id' => 'mow.DE-BY-M-002', 'version' => 1, 'severity' => 'Minor', 'type' => 'Alert', 'i18nTitle' => ['de' => 'Warnung München']],
            ]),
            '#/dwd/mapData\.json$#' => json_encode([['id' => 'dwd.2.49.0.1.276.0.DWD.PVW.1', 'version' => 3, 'severity' => 'Moderate', 'type' => 'Alert', 'i18nTitle' => ['de' => 'Amtliche Warnung vor STARKREGEN']]]),
            '#/warnings/mow\.DE-NW-K-001\.geojson$#' => $poly(6.95, 50.85, 7.15, 50.95),
            '#/warnings/mow\.DE-BY-M-002\.geojson$#' => $poly(11.4, 48.0, 11.7, 48.3),
            '#/warnings/dwd\..*\.geojson$#' => $poly(6.7, 51.15, 6.9, 51.35),
            '#/recent/$#' => ['status' => 200, 'body' => '<a href="woodland_stations_list.txt">x</a><a href="fdi_woodland_recent_1078_v2-3.csv.gz">y</a><a href="fdi_woodland_recent_3379_v2-3.csv.gz">z</a>', 'contentType' => 'text/html'],
            '#_stations_list\.txt$#' => ['status' => 200, 'body' => $list, 'contentType' => 'text/plain'],
            '#_recent_1078_.*\.csv\.gz$#' => ['status' => 200, 'body' => $csv, 'contentType' => 'application/gzip'],
        ];
    }

    public function testWarningsAreFilteredToNrwAndCached(): void
    {
        $http = new FakeHttp($this->routes());
        $now = 1_800_000_000;
        $svc = new WarningService($this->cfg(), $http, $this->cache, fn () => $now);
        $d = $svc->get();
        $titles = array_column($d['warnings'], 'title');
        sort($titles);
        $this->assertSame(['Amtliche Warnung vor STARKREGEN', 'Gefahrstoffaustritt in Köln-Porz'], $titles, 'München liegt außerhalb NRW');
        $this->assertSame('ok', $d['sources']['mowas']['status']);
        $this->assertSame(3, array_column($d['warnings'], 'level', 'source')['mowas']);
        // WBI: nur NRW-Station, Umlaute korrekt, -999 ignoriert
        $this->assertCount(1, $d['wbi']['stations']);
        $this->assertSame('Düsseldorf', $d['wbi']['stations'][0]['name']);
        $this->assertSame([2, 3, 4, 4, 3, 2], $d['wbi']['stations'][0]['forecast']);
        $this->assertSame(2, $d['wbi']['max']);

        $calls = count($http->calls);
        $svc->get();
        $this->assertSame($calls, count($http->calls), 'innerhalb des Intervalls kein erneuter Abruf');
    }

    public function testServiceOutageKeepsLastStateAndReportsStatus(): void
    {
        $http = new FakeHttp($this->routes());
        $t = 1_800_000_000;
        $svc = new WarningService($this->cfg(), $http, $this->cache, function () use (&$t) { return $t; });
        $svc->get();
        $http->down = true;
        $t += 3600;
        $d = $svc->get();
        $this->assertSame('error', $d['sources']['mowas']['status']);
        $this->assertTrue($d['sources']['mowas']['stale']);
        $this->assertStringContainsString('Timeout', $d['sources']['mowas']['error']);
        $this->assertCount(2, $d['warnings'], 'letzter Stand bleibt sichtbar');
        $this->assertSame('error', $d['sources']['wbi']['status']);
        $this->assertNotNull($d['wbi']);
    }

    public function testFloodLayerDiscoveryAndFeatureInfo(): void
    {
        $caps = '<?xml version="1.0"?><WMS_Capabilities xmlns="http://www.opengis.net/wms"><Capability><Layer><Title>HW</Title>'
            . '<Layer><Name>hwgk_hq_haeufig</Name><Title>Überflutungsfläche HQhäufig</Title></Layer>'
            . '<Layer><Name>hwgk_tiefe_hq100</Name><Title>Wassertiefe HQ100</Title></Layer>'
            . '<Layer><Name>hwgk_hq100</Name><Title>Überflutungsfläche HQ100 (mittlere Wahrscheinlichkeit)</Title></Layer>'
            . '<Layer><Name>hwgk_hq_extrem</Name><Title>Überflutungsfläche HQextrem</Title></Layer></Layer></Capability></WMS_Capabilities>';
        $this->assertSame(['hq_haeufig' => 'hwgk_hq_haeufig', 'hq100' => 'hwgk_hq100', 'hq_extrem' => 'hwgk_hq_extrem'], FloodService::discoverLayers($caps));
        $this->assertSame([], FloodService::discoverLayers('<kaputt'));

        $this->assertTrue(FloodService::featureInfoHasHit('<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:app="http://example.org/app"><gml:featureMember><app:hq100><app:gew>Rhein</app:gew></app:hq100></gml:featureMember></wfs:FeatureCollection>'), 'Feature-Inhalt in fremdem Namespace');
        $this->assertFalse(FloodService::featureInfoHasHit('<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs"></wfs:FeatureCollection>'));
        $this->assertFalse(FloodService::featureInfoHasHit('<ServiceExceptionReport><ServiceException>LayerNotQueryable</ServiceException></ServiceExceptionReport>'));
        $this->assertTrue(FloodService::featureInfoHasHit('<FeatureInfoResponse><FIELDS GEWAESSER="Rhein" HQ="100"/></FeatureInfoResponse>'));
    }

    public function testHintsSuggestScenariosAndReportOutages(): void
    {
        $routes = $this->routes() + [
            '#REQUEST=GetCapabilities#' => '<WMS_Capabilities><Capability><Layer><Layer><Name>hq100</Name><Title>HQ100</Title></Layer></Layer></Capability></WMS_Capabilities>',
            '#REQUEST=GetFeatureInfo#' => ['status' => 200, 'body' => '<FeatureCollection><featureMember><x>1</x></featureMember></FeatureCollection>', 'contentType' => 'text/xml'],
        ];
        $http = new FakeHttp($routes);
        $services = require dirname(__DIR__, 2) . '/config/services.php';
        $ctl = new HazardController(self::$db, new WarningService($services['warnings'], $http, $this->cache), new FloodService($services['wms']['hochwasser'], $http, $this->cache), $services);
        $call = function (array $body) use ($ctl) {
            $req = (new ServerRequestFactory())->createServerRequest('POST', '/api/facilities/hints')->withParsedBody($body);
            $res = $ctl->hints($req, (new ResponseFactory())->createResponse());
            return json_decode((string) $res->getBody(), true);
        };
        // Düsseldorf: im DWD-Starkregengebiet, in Hochwasserfläche, WBI-Station mit Stufe 4 in der Prognose
        $r = $call(['lon' => 6.77, 'lat' => 51.25]);
        $scen = array_column($r['hints'], 'scenario');
        sort($scen);
        $this->assertSame(['Hochwasser', 'Starkregen', 'Waldbrand'], $scen);
        $this->assertNotNull($r['hints'][0]['scenarioId']);
        $this->assertStringContainsString('HQ100', array_column($r['hints'], 'text', 'scenario')['Hochwasser']);
        // Köln-Porz: Gefahrstoffwarnung (MoWaS)
        $this->assertContains('Gefahrstoffunfall', array_column($call(['lon' => 7.05, 'lat' => 50.9])['hints'], 'scenario'));

        $http->down = true;
        $r = $call(['lon' => 8.5, 'lat' => 52.0]);
        $this->assertContains('Hochwassergefahrenkarten derzeit nicht erreichbar.', $r['status']);
    }
}
