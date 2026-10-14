<?php
declare(strict_types=1);

namespace Kritis\Support;

use Kritis\Security\PasswordHasher;
use Kritis\Security\PasswordPolicy;
use PDO;

/** Startdaten: Kategorien, Szenarien, Admin. Keine Einrichtungen. Idempotent. */
final class Seeder
{
    /** Farben und Symbol-Schlüssel entsprechen dem UI-Design (Administration). */
    public const CATEGORIES = [
        ['Hochschulen', '#2F6FDE', 'cap'],
        ['Universitätskliniken', '#D0364F', 'cross'],
        ['Außeruniversitäre Forschungseinrichtungen', '#7A4BD6', 'flask'],
        ['Archive (inkl. Landesarchiv)', '#A8620A', 'box'],
    ];
    public const SCENARIOS = [
        ['Hochwasser', '#2F6FDE', 'wave'],
        ['Starkregen', '#1F7A8C', 'rain'],
        ['Waldbrand', '#C2410C', 'fire'],
        ['Sturm', '#5B6472', 'wind'],
        ['Langanhaltender Stromausfall', '#A16207', 'power'],
        ['Gefahrstoffunfall', '#7A4BD6', 'hazard'],
        ['Cyberangriff', '#334155', 'shield'],
    ];

    public function __construct(private PDO $db, private PasswordHasher $hasher)
    {
    }

    /** @return string|null Initialpasswort des neu angelegten Admins, sonst null */
    public function run(string $adminUser = 'admin'): ?string
    {
        foreach (['categories' => self::CATEGORIES, 'scenarios' => self::SCENARIOS] as $table => $rows) {
            $st = $this->db->prepare("INSERT IGNORE INTO $table (name, color, symbol, sort_order) VALUES (?,?,?,?)");
            foreach ($rows as $i => [$name, $color, $symbol]) {
                $st->execute([$name, $color, $symbol, ($i + 1) * 10]);
            }
        }
        $has = $this->db->prepare('SELECT 1 FROM users WHERE username = ?');
        $has->execute([$adminUser]);
        if ($has->fetchColumn()) {
            return null;
        }
        $pw = PasswordPolicy::generate();
        $this->db->prepare("INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, 'Administrator', ?, 'admin', 1)")
            ->execute([$adminUser, $this->hasher->hash($pw)]);
        return $pw;
    }
}
