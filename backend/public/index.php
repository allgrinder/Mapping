<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Kritis\App;
use Kritis\Support\Config;
use Kritis\Support\Database;

$config = Config::load();
App::create($config, Database::connect($config))->run();
