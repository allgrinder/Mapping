<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Support\Config;
use Kritis\Support\Database;
use Kritis\Support\Migrator;

$db = Database::connect(Config::load());
$applied = (new Migrator($db, __DIR__ . '/../migrations'))->run();
echo $applied ? 'Angewandt: ' . implode(', ', $applied) . PHP_EOL : "Datenbank ist aktuell.\n";
