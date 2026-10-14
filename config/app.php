<?php
declare(strict_types=1);

/**
 * Zentrale Anwendungskonfiguration. Alle Werte per Umgebungsvariable überschreibbar.
 * Externe Dienste (WMS, Geokodierung, Warnungen) stehen in services.php, Hintergrundkarten in basemaps.php.
 */
$env = static fn (string $k, mixed $d = null): mixed => ($v = getenv($k)) === false || $v === '' ? $d : $v;
$bool = static fn (mixed $v): bool => in_array(strtolower((string) $v), ['1', 'true', 'yes', 'on'], true);

return [
    'env' => $env('APP_ENV', 'production'),
    // Mindest-PHP-Version; per Umgebungsvariable anpassbar (Standard 8.3)
    'php_min_version' => $env('PHP_MIN_VERSION', '8.3.0'),
    'db' => [
        'host' => $env('DB_HOST', '127.0.0.1'),
        'port' => (int) $env('DB_PORT', 3306),
        'name' => $env('DB_NAME', 'kritis'),
        'user' => $env('DB_USER', 'kritis'),
        'pass' => $env('DB_PASS', ''),
    ],
    'session' => [
        'cookie_secure' => $bool($env('COOKIE_SECURE', 'true')),
        'idle_ttl' => (int) $env('SESSION_IDLE_TTL', 1800),
        'absolute_ttl' => (int) $env('SESSION_ABSOLUTE_TTL', 28800),
    ],
    'security' => [
        // Nur auf true setzen, wenn ein vertrauenswürdiger Reverse-Proxy X-Forwarded-For setzt.
        'trust_proxy_headers' => $bool($env('TRUST_PROXY_HEADERS', 'false')),
        'login_max_per_user' => (int) $env('LOGIN_MAX_PER_USER', 5),
        'login_max_per_ip' => (int) $env('LOGIN_MAX_PER_IP', 30),
        'login_window' => (int) $env('LOGIN_WINDOW', 900),
        'password_min_length' => (int) $env('PASSWORD_MIN_LENGTH', 12),
        'hsts' => $bool($env('HSTS', 'true')),
    ],
    // Ausgehender Proxy (IT.NRW), z. B. http://proxy.example:3128 – leer = direkt
    'outbound_proxy' => $env('OUTBOUND_PROXY', ''),
    'storage' => dirname(__DIR__) . '/backend/storage',
];
