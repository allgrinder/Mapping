<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Kritis\Security\PasswordHasher;
use Kritis\Support\Config;
use Kritis\Support\Database;
use Kritis\Support\Seeder;

$db = Database::connect(Config::load());
$pw = (new Seeder($db, new PasswordHasher()))->run($argv[1] ?? 'admin');
if ($pw === null) {
    echo "Seed-Daten vorhanden; Admin existiert bereits.\n";
} else {
    echo "Admin angelegt. Initialpasswort (einmalig, muss beim ersten Login geändert werden):\n  $pw\n";
}
