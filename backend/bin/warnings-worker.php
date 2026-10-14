<?php
declare(strict_types=1);

/**
 * Hintergrunddienst für die Live-Warnlage: aktualisiert NINA (MoWaS, DWD) und den Waldbrandindex im eingestellten
 * Intervall (WARNINGS_INTERVAL, Standard 300 s), unabhängig von Seitenaufrufen. Läuft im Docker-Image automatisch.
 * Solange er läuft, liefern Webanfragen nur den gespeicherten Stand (schnell, kein Warten auf externe Dienste).
 *   php bin/warnings-worker.php            # Dauerbetrieb
 *   php bin/warnings-worker.php --once     # ein Durchlauf (wie bin/refresh-warnings.php)
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\WarningService;
use Kritis\Support\Config;
use Kritis\Support\HttpClient;

set_time_limit(0);
$config = Config::load();
$services = require dirname(__DIR__, 2) . '/config/services.php';
$http = new HttpClient((string) $config->get('outbound_proxy', ''), (int) $services['http']['timeout'], (string) $services['http']['user_agent']);
$svc = new WarningService($services['warnings'], $http, $config->get('storage') . '/cache', null, 240.0);
$interval = max(60, (int) $services['warnings']['interval_s']);
$once = in_array('--once', $argv, true);

do {
    $svc->markWorkerAlive();
    try {
        $d = $svc->get(true);
        $line = [];
        foreach ($d['sources'] as $k => $s) {
            $line[] = "$k={$s['status']}" . ($s['status'] === 'ok' ? "({$s['count']}" . (!empty($s['pending']) ? ", {$s['pending']} folgen" : '') . ')' : ' – ' . ($s['error'] ?? ''));
        }
        echo '[warnlage] ' . gmdate('H:i:s') . ' ' . implode(' · ', $line) . PHP_EOL;
        // Zurückgestellte Warngebiete zügig nachladen statt ein ganzes Intervall zu warten
        $pending = array_sum(array_map(fn ($s) => (int) ($s['pending'] ?? 0), $d['sources']));
    } catch (Throwable $e) {
        echo '[warnlage] Fehler: ' . $e->getMessage() . PHP_EOL;
        $pending = 0;
    }
    if (!$once) {
        $wait = $pending > 0 ? 15 : $interval;
        for ($i = 0; $i < $wait; $i += 30) {
            sleep(min(30, $wait - $i));
            $svc->markWorkerAlive();
        }
    }
} while (!$once);
