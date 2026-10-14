<?php
declare(strict_types=1);

namespace Kritis\Support;

use Kritis\Security\PasswordHasher;
use Kritis\Security\PasswordPolicy;
use PDO;

/** Startdaten: Kategorien, Szenarien, Admin. Keine Einrichtungen. Idempotent. */
final class Seeder
{
    public const CATEGORIES = [
        ['Hochschulen', '#0A66D8', 'graduation-cap'],
        ['Universitätskliniken', '#C42B2B', 'hospital'],
        ['Außeruniversitäre Forschungseinrichtungen', '#7A3FC4', 'flask'],
        ['Archive (inkl. Landesarchiv)', '#B7791F', 'archive'],
    ];
    public const SCENARIOS = [
        ['Hochwasser', '#2B7FD8', 'waves'],
        ['Starkregen', '#4C6FA8', 'cloud-rain'],
        ['Waldbrand', '#D9531E', 'flame'],
        ['Sturm', '#5E7A8C', 'wind'],
        ['Langanhaltender Stromausfall', '#E0A100', 'zap-off'],
        ['Gefahrstoffunfall', '#8E3B8E', 'hazard'],
        ['Cyberangriff', '#2F2F3A', 'shield-alert'],
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
        $this->db->prepare("INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?,?, 'admin', 1)")
            ->execute([$adminUser, $this->hasher->hash($pw)]);
        return $pw;
    }
}
