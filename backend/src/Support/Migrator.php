<?php
declare(strict_types=1);

namespace Kritis\Support;

use PDO;

final class Migrator
{
    public function __construct(private PDO $db, private string $dir)
    {
    }

    /** @return list<string> angewandte Migrationen */
    public function run(): array
    {
        $this->db->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()) ENGINE=InnoDB');
        $done = $this->db->query('SELECT name FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN);
        $files = glob($this->dir . '/*.sql') ?: [];
        sort($files);
        $applied = [];
        foreach ($files as $f) {
            $name = basename($f);
            if (in_array($name, $done, true)) {
                continue;
            }
            foreach (array_filter(array_map('trim', explode(";\n", (string) file_get_contents($f)))) as $stmt) {
                $this->db->exec($stmt);
            }
            $this->db->prepare('INSERT INTO schema_migrations (name) VALUES (?)')->execute([$name]);
            $applied[] = $name;
        }
        return $applied;
    }
}
