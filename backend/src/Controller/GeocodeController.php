<?php
declare(strict_types=1);

namespace Kritis\Controller;

use Kritis\Support\HttpClient;
use Kritis\Support\HttpException;
use Kritis\Support\Json;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

/** Adresssuche über den konfigurierten Anbieter (Standard Nominatim) mit Cache und Ratenbegrenzung. */
final class GeocodeController
{
    public function __construct(private array $cfg, private ?HttpClient $http, private string $cacheDir)
    {
    }

    public function search(Request $req, Response $res): Response
    {
        $q = $req->getQueryParams()['q'] ?? '';
        if (!is_string($q) || mb_strlen(trim($q)) < 3 || mb_strlen($q) > 200) {
            throw new HttpException(422, 'validation_failed', 'Bitte mindestens 3 Zeichen eingeben.');
        }
        $q = trim(preg_replace('/\s+/', ' ', $q));
        if (empty($this->cfg['url']) || $this->cfg['url'] === 'off' || !$this->http) {
            throw new HttpException(503, 'geocoder_unavailable', 'Adresssuche ist nicht eingerichtet. Bitte den Standort auf der Karte setzen.');
        }
        $file = $this->cacheDir . '/geocode/' . sha1(mb_strtolower($q)) . '.json';
        if (is_file($file) && filemtime($file) > time() - 86400 * (int) ($this->cfg['cache_days'] ?? 30)) {
            return Json::respond($res, ['items' => json_decode((string) file_get_contents($file), true), 'cached' => true]);
        }
        $this->throttle();
        $url = $this->cfg['url'] . '?' . http_build_query([
            'q' => $q, 'format' => 'jsonv2', 'addressdetails' => 1, 'limit' => 6, 'countrycodes' => 'de',
            'viewbox' => $this->cfg['viewbox'] ?? '5.8,52.6,9.5,50.3', 'bounded' => 1, 'accept-language' => 'de',
        ]);
        try {
            $r = $this->http->get($url);
        } catch (\Throwable) {
            throw new HttpException(503, 'geocoder_unavailable', 'Die Adresssuche ist derzeit nicht erreichbar. Bitte den Standort auf der Karte setzen.');
        }
        $data = json_decode($r['body'], true);
        if ($r['status'] !== 200 || !is_array($data)) {
            throw new HttpException(503, 'geocoder_unavailable', 'Die Adresssuche ist derzeit nicht erreichbar. Bitte den Standort auf der Karte setzen.');
        }
        $items = [];
        foreach ($data as $d) {
            if (!isset($d['lon'], $d['lat'])) {
                continue;
            }
            $a = $d['address'] ?? [];
            $street = trim(($a['road'] ?? $a['pedestrian'] ?? '') . ' ' . ($a['house_number'] ?? ''));
            $city = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? '';
            $items[] = [
                'label' => (string) ($d['display_name'] ?? ''),
                'street' => $street, 'zip' => (string) ($a['postcode'] ?? ''), 'city' => (string) $city,
                'lon' => (float) $d['lon'], 'lat' => (float) $d['lat'],
            ];
        }
        @mkdir(dirname($file), 0775, true);
        file_put_contents($file, json_encode($items, JSON_UNESCAPED_UNICODE));
        return Json::respond($res, ['items' => $items, 'cached' => false]);
    }

    /** Global höchstens eine Anfrage pro Intervall (Nutzungsbedingungen Nominatim), auch über mehrere PHP-Prozesse. */
    private function throttle(): void
    {
        @mkdir($this->cacheDir, 0775, true);
        $h = fopen($this->cacheDir . '/geocode.lock', 'c+');
        if (!$h) {
            return;
        }
        flock($h, LOCK_EX);
        $last = (float) stream_get_contents($h);
        $wait = $last + ($this->cfg['min_interval_ms'] ?? 1100) / 1000 - microtime(true);
        if ($wait > 0) {
            usleep((int) ($wait * 1e6));
        }
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, (string) microtime(true));
        flock($h, LOCK_UN);
        fclose($h);
    }
}
