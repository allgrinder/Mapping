<?php
declare(strict_types=1);

/**
 * Aktualisiert die Live-Warnlage (für Cron, z. B. alle 5 Minuten). Die Weboberfläche aktualisiert sonst bei Bedarf selbst.
 *   php bin/refresh-warnings.php
 */

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Geo\WarningService;
use Kritis\Support\Config;
use Kritis\Support\HttpClient;

$config = Config::load();
$services = require dirname(__DIR__, 2) . '/config/services.php';
$svc = new WarningService($services['warnings'], new HttpClient((string) $config->get('outbound_proxy', ''), (int) $services['http']['timeout'], (string) $services['http']['user_agent']), $config->get('storage') . '/cache');
$d = $svc->get(true);
foreach ($d['sources'] as $k => $s) {
    printf("%-6s %-5s %3d %s\n", $k, $s['status'], $s['count'] ?? 0, $s['error'] ?? '');
}
exit(in_array('error', array_column($d['sources'], 'status'), true) ? 1 : 0);
