<?php
// Router für den PHP-Entwicklungsserver: php -S 127.0.0.1:8000 -t public bin/dev-router.php
// Liefert statische Dateien aus public/, /api an index.php, alles andere an die SPA (index.html).
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$file = realpath(__DIR__ . '/../public' . $path);
if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/../public/index.php';
    return true;
}
if ($file !== false && str_starts_with($file, realpath(__DIR__ . '/../public')) && is_file($file) && !str_ends_with($file, '.php')) {
    return false;
}
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
readfile(__DIR__ . '/../public/index.html');
return true;
