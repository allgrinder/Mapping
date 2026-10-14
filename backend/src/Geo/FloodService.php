<?php
declare(strict_types=1);

namespace Kritis\Geo;

use Kritis\Support\HttpClient;

/**
 * Hochwassergefahrenkarten NRW (WMS): Layer aus GetCapabilities ermitteln, Kartenbilder über den Proxy (mit Cache)
 * und Punktabfrage per GetFeatureInfo für die Hinweise beim Speichern einer Einrichtung.
 */
class FloodService
{
    public const SCENARIOS = ['hq_haeufig' => 'HQhäufig', 'hq100' => 'HQ100', 'hq_extrem' => 'HQextrem'];

    public function __construct(private array $svc, private ?HttpClient $http, private string $cacheDir)
    {
    }

    public function configured(): bool
    {
        return !empty($this->svc['url']) && $this->http !== null;
    }

    /** @return array<string,string> Szenario → Layername */
    public function layers(): array
    {
        $fixed = array_filter($this->svc['layers'] ?? []);
        if (count($fixed) === 3) {
            return $fixed;
        }
        $file = $this->cacheDir . '/hwgk-layers.json';
        if (is_file($file) && filemtime($file) > time() - 7 * 86400) {
            return $fixed + (json_decode((string) file_get_contents($file), true) ?: []);
        }
        if (!$this->configured()) {
            return $fixed;
        }
        $r = $this->http->get($this->svc['url'] . '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=' . ($this->svc['version'] ?? '1.3.0'));
        if ($r['status'] !== 200) {
            throw new \RuntimeException("GetCapabilities: HTTP {$r['status']}");
        }
        $found = self::discoverLayers($r['body']);
        @mkdir($this->cacheDir, 0775, true);
        file_put_contents($file, json_encode($found));
        return $fixed + $found;
    }

    /** Sucht in den Capabilities benannte Layer, deren Titel/Name auf HQhäufig, HQ100 bzw. HQextrem hinweist. */
    public static function discoverLayers(string $xml): array
    {
        $prev = libxml_use_internal_errors(true);
        $doc = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET | LIBXML_NOCDATA);
        libxml_use_internal_errors($prev);
        if ($doc === false) {
            return [];
        }
        $out = [];
        $patterns = [
            'hq_haeufig' => '/HQ\s*h(ä|ae)ufig|hohe\s+Wahrscheinlichkeit/iu',
            'hq100' => '/HQ\s*100|mittlere\s+Wahrscheinlichkeit/iu',
            'hq_extrem' => '/HQ\s*extrem|niedrige\s+Wahrscheinlichkeit/iu',
        ];
        $layers = $doc->xpath('//*[local-name()="Layer"][*[local-name()="Name"]]') ?: [];
        foreach ($layers as $l) {
            $name = trim((string) ($l->xpath('./*[local-name()="Name"]')[0] ?? ''));
            $title = trim((string) ($l->xpath('./*[local-name()="Title"]')[0] ?? ''));
            foreach ($patterns as $key => $re) {
                // bevorzugt Überflutungsflächen/-ausdehnung, nicht Tiefen- oder Risikolayer
                if (!isset($out[$key]) && (preg_match($re, $title) || preg_match($re, $name)) && !preg_match('/tiefe|risiko|geschwindigkeit/iu', $title)) {
                    $out[$key] = $name;
                }
            }
        }
        return $out;
    }

    /** Kartenbild (PNG) für einen Ausschnitt in EPSG:25832, gecacht. */
    public function getMap(array $bbox, int $w, int $h): ?string
    {
        $layers = implode(',', array_values($this->layers()));
        if ($layers === '') {
            return null;
        }
        $key = sha1($layers . '|' . implode(',', array_map(fn ($v) => round($v, 1), $bbox)) . "|$w|$h");
        $file = $this->cacheDir . "/hwgk/$key.png";
        if (is_file($file) && filemtime($file) > time() - 30 * 86400) {
            return (string) file_get_contents($file);
        }
        if (!$this->configured()) {
            return null;
        }
        $url = $this->svc['url'] . '?' . http_build_query([
            'SERVICE' => 'WMS', 'VERSION' => $this->svc['version'] ?? '1.3.0', 'REQUEST' => 'GetMap', 'LAYERS' => $layers, 'STYLES' => '',
            'CRS' => 'EPSG:25832', 'BBOX' => implode(',', $bbox), 'WIDTH' => $w, 'HEIGHT' => $h, 'FORMAT' => 'image/png', 'TRANSPARENT' => 'TRUE',
        ]);
        try {
            $r = $this->http->get($url);
        } catch (\Throwable) {
            return null;
        }
        if ($r['status'] !== 200 || !str_starts_with($r['body'], "\x89PNG")) {
            return null;
        }
        @mkdir(dirname($file), 0775, true);
        file_put_contents($file, $r['body']);
        return $r['body'];
    }

    /** @return list<string> Szenarien (HQhäufig/HQ100/HQextrem), in deren Gefahrenfläche der Punkt liegt */
    public function pointHits(float $lon, float $lat): array
    {
        [$e, $n] = Utm32::forward($lon, $lat);
        $hits = [];
        foreach ($this->layers() as $key => $layer) {
            $d = 5; // 10 m × 10 m Abfragefenster
            $url = $this->svc['url'] . '?' . http_build_query([
                'SERVICE' => 'WMS', 'VERSION' => '1.3.0', 'REQUEST' => 'GetFeatureInfo', 'LAYERS' => $layer, 'QUERY_LAYERS' => $layer, 'STYLES' => '',
                'CRS' => 'EPSG:25832', 'BBOX' => implode(',', [$e - $d, $n - $d, $e + $d, $n + $d]), 'WIDTH' => 11, 'HEIGHT' => 11, 'I' => 5, 'J' => 5,
                'INFO_FORMAT' => 'text/xml', 'FEATURE_COUNT' => 1,
            ]);
            $r = $this->http?->get($url);
            if (!$r || $r['status'] !== 200) {
                throw new \RuntimeException('GetFeatureInfo nicht erreichbar.');
            }
            if (self::featureInfoHasHit($r['body'])) {
                $hits[] = self::SCENARIOS[$key];
            }
        }
        return $hits;
    }

    /** Wertet eine GetFeatureInfo-Antwort (XML/GML) aus: Treffer, wenn mindestens ein Feature/Attributsatz enthalten ist. */
    public static function featureInfoHasHit(string $body): bool
    {
        $t = trim($body);
        if ($t === '' || preg_match('/ServiceException/i', $t)) {
            return false;
        }
        $prev = libxml_use_internal_errors(true);
        $doc = simplexml_load_string($t, 'SimpleXMLElement', LIBXML_NONET);
        libxml_use_internal_errors($prev);
        if ($doc === false) {
            return !preg_match('/no (features|results)|keine/i', $t) && strlen($t) > 0 && !str_starts_with($t, '<');
        }
        $features = $doc->xpath('//*[local-name()="featureMember" or local-name()="FIELDS" or local-name()="Feature" or local-name()="featureMembers"]') ?: [];
        foreach ($features as $f) {
            if (count($f->xpath('./*') ?: []) > 0 || count($f->attributes()) > 0 || trim((string) $f) !== '') {
                return true;
            }
        }
        return false;
    }
}
