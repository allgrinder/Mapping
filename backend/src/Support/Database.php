<?php
declare(strict_types=1);

namespace Kritis\Support;

use PDO;

final class Database
{
    public static function connect(Config $c): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $c->get('db.host'),
            $c->get('db.port'),
            $c->get('db.name')
        );
        return new PDO($dsn, (string) $c->get('db.user'), (string) $c->get('db.pass'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'",
        ]);
    }
}
