<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Geo\FloodService;
use Kritis\Geo\GeoUtil;
use Kritis\Geo\WarningService;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Stufe 2: Warnlage, Hochwasser-WMS-Proxy und Hinweise beim Speichern (nur Vorschläge, keine automatische Änderung). */
final class HazardController
{
    /** Zuordnung von Warnungs-Stichworten zu Szenarien (Name in der Stammdatenliste). */
    private const KEYWORDS = [
        'Hochwasser' => '/hochwasser|überflutung|flut|pegel/iu',
        'Starkregen' => '/starkregen|dauerregen|unwetter.*regen|ergiebig/iu',
        'Sturm' => '/sturm|orkan|böen|wind|tornado/iu',
        'Waldbrand' => '/waldbrand|vegetationsbrand|brand/iu',
        'Gefahrstoffunfall' => '/gefahrstoff|chemie|rauch|gas|schadstoff|freisetzung/iu',
        'Langanhaltender Stromausfall' => '/strom/iu',
        'Cyberangriff' => '/cyber|it-sicherheit/iu',
    ];

    public function __construct(private PDO $db, private WarningService $warnings, private FloodService $flood, private array $services)
    {
    }

    public function warnings(Request $req, Response $res): Response
    {
        @set_time_limit(90); // ohne Hintergrunddienst aktualisiert diese Anfrage selbst (mit Zeitbudget)
        $d = $this->warnings->get();
        $sources = [];
        foreach (['mowas' => 'Bevölkerungswarnungen (MoWaS)', 'dwd' => 'Unwetterwarnungen (DWD)', 'wbi' => 'Waldbrandgefahrenindex (DWD)'] as $k => $label) {
            $s = $d['sources'][$k] ?? ['status' => 'pending'];
            $sources[] = ['id' => $k, 'label' => $label, 'status' => $s['status'], 'error' => $s['error'] ?? null, 'fetchedAt' => isset($s['fetchedAt']) ? gmdate('Y-m-d H:i:s', $s['fetchedAt']) : null, 'count' => $s['count'] ?? 0, 'stale' => $s['stale'] ?? false, 'pending' => $s['pending'] ?? 0, 'failed' => $s['failed'] ?? 0];
        }
        return Json::respond($res, [
            'checkedAt' => isset($d['checkedAt']) ? gmdate('Y-m-d H:i:s', $d['checkedAt']) : null,
            'intervalS' => $d['intervalS'],
            'sources' => $sources,
            'warnings' => array_map(fn ($w) => array_diff_key($w, ['bbox' => 1]), $d['warnings'] ?? []),
            'wbi' => $d['wbi'] ?? null,
            'attribution' => [$this->services['warnings']['nina']['attribution'], $this->services['warnings']['wbi']['attribution']],
        ]);
    }

    /** Hochwassergefahrenkarte als Bild für den aktuellen Kartenausschnitt (nur feste, geprüfte Parameter). */
    public function floodMap(Request $req, Response $res): Response
    {
        $q = $req->getQueryParams();
        $bbox = array_map('floatval', explode(',', (string) ($q['bbox'] ?? '')));
        $w = (int) ($q['width'] ?? 0);
        $h = (int) ($q['height'] ?? 0);
        if (count($bbox) !== 4 || $w < 16 || $h < 16 || $w > 4096 || $h > 4096 || $bbox[0] >= $bbox[2] || $bbox[1] >= $bbox[3]
            || $bbox[0] < 200000 || $bbox[2] > 650000 || $bbox[1] < 5450000 || $bbox[3] > 5950000) {
            throw new HttpException(422, 'validation_failed', 'Ungültiger Kartenausschnitt.');
        }
        try {
            $png = $this->flood->getMap($bbox, $w, $h);
        } catch (\Throwable) {
            $png = null;
        }
        if ($png === null) {
            return $res->withStatus(204)->withHeader('X-Service-Status', 'unavailable')->withHeader('Cache-Control', 'no-store');
        }
        $res->getBody()->write($png);
        return $res->withHeader('Content-Type', 'image/png')->withHeader('Cache-Control', 'private, max-age=86400');
    }

    /** Hinweise für einen Standort: Hochwassergefahrengebiet (GetFeatureInfo), aktive Warngebiete, Waldbrandindex. */
    public function hints(Request $req, Response $res): Response
    {
        $b = (array) $req->getParsedBody();
        $lon = $b['lon'] ?? null;
        $lat = $b['lat'] ?? null;
        if (!is_numeric($lon) || !is_numeric($lat) || $lon < 5.5 || $lon > 9.8 || $lat < 50 || $lat > 52.8) {
            throw new HttpException(422, 'validation_failed', 'Ungültiger Standort.');
        }
        $lon = (float) $lon;
        $lat = (float) $lat;
        $scen = [];
        foreach ($this->db->query('SELECT id, name FROM scenarios WHERE active = 1') as $r) {
            $scen[$r['name']] = (int) $r['id'];
        }
        $hints = [];
        $status = [];
        $add = function (string $scenario, string $text, string $source, string $kind) use (&$hints, $scen) {
            $hints[] = ['scenarioId' => $scen[$scenario] ?? null, 'scenario' => $scenario, 'text' => $text, 'source' => $source, 'kind' => $kind];
        };
        try {
            $hq = $this->flood->configured() ? $this->flood->pointHits($lon, $lat) : null;
            if ($hq === null) {
                $status[] = 'Hochwassergefahrenkarten nicht eingerichtet.';
            } elseif ($hq) {
                $add('Hochwasser', 'Der Standort liegt in einem amtlichen Hochwassergefahrengebiet (' . implode(', ', $hq) . ').', 'Hochwassergefahrenkarten NRW', 'flood');
            }
        } catch (\Throwable) {
            $status[] = 'Hochwassergefahrenkarten derzeit nicht erreichbar.';
        }
        $d = $this->warnings->get();
        foreach ($d['warnings'] ?? [] as $w) {
            if ($w['geometry'] && GeoUtil::contains($w['geometry'], $lon, $lat)) {
                foreach (self::KEYWORDS as $s => $re) {
                    if (preg_match($re, $w['title'])) {
                        $add($s, sprintf('Der Standort liegt in einem aktuellen Warngebiet (%s: %s).', $w['source'] === 'dwd' ? 'Unwetterwarnung' : 'Bevölkerungswarnung', $w['title']), $w['source'] === 'dwd' ? 'DWD' : 'MoWaS', 'warning');
                        break;
                    }
                }
            }
        }
        $radius = (float) ($this->services['warnings']['wbi']['radius_km'] ?? 30);
        $near = null;
        foreach ($d['wbi']['stations'] ?? [] as $s) {
            $dist = GeoUtil::distanceKm($lon, $lat, $s['lon'], $s['lat']);
            if ($dist <= $radius && (!$near || $dist < $near[1])) {
                $near = [$s, $dist];
            }
        }
        if ($near && max($near[0]['forecast']) >= 4) {
            $add('Waldbrand', sprintf('Hohe Waldbrandgefahr in der Umgebung (Station %s, Stufe %d von 5 in den nächsten Tagen).', $near[0]['name'], max($near[0]['forecast'])), 'DWD-Waldbrandgefahrenindex', 'wbi');
        }
        foreach ($d['sources'] ?? [] as $k => $s) {
            if ($s['status'] !== 'ok') {
                $status[] = ['mowas' => 'MoWaS', 'dwd' => 'DWD-Warnungen', 'wbi' => 'Waldbrandindex'][$k] . ' derzeit nicht erreichbar.';
            }
        }
        // Dubletten (gleiches Szenario) zusammenfassen
        $uniq = [];
        foreach ($hints as $h) {
            $uniq[$h['scenario']] ??= $h;
        }
        return Json::respond($res, ['hints' => array_values($uniq), 'status' => array_values(array_unique($status))]);
    }
}
